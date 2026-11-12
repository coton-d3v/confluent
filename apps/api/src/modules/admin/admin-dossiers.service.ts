import { Injectable, NotFoundException } from '@nestjs/common'
import type { Document, Dossier, DossierAnswer, Prisma } from '@prisma/client'
import {
  documentTypeOf,
  publicationStatusOf,
  type AdminDossierListQuery,
  type DocumentType,
  type DossierDocumentSelected,
  type DossierPublicationStatus,
} from '@confluent/shared'
import { PrismaService } from '../../prisma/prisma.service'
import { AnswersService, type AnswerInput } from '../answers/answers.service'
import {
  QuestionnairesService,
  type VersionStructure,
} from '../questionnaires/questionnaires.service'
import { AuditService } from '../audit/audit.service'
import {
  DocumentsService,
  type DocumentGroup,
  type StoredVersion,
} from '../documents/documents.service'
import type { DossierRef } from '../dossiers/dossier-profile'

export interface AdminDossierListItem {
  id: string
  name: string
  slug: string
  sector: string | null
  maturityStage: string | null
  tagTechnologique: string | null
  ownerEmail: string
  companyName: string
  publicationStatus: DossierPublicationStatus
  createdAt: Date
  activeShareLinksCount: number
}

export interface AdminDossierList {
  page: number
  pageSize: number
  total: number
  q: string | null
  exactMatch: AdminDossierListItem | null
  items: AdminDossierListItem[]
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const LIST_INCLUDE = {
  user: { select: { email: true } },
  company: { select: { name: true } },
  shareLinks: { where: { status: 'active' as const }, select: { id: true } },
} satisfies Prisma.DossierInclude

// Whole values: a slug or an identifier is never matched by a part of it, nor an email address
// (code review R64).
function exactRef(ref: string): Prisma.DossierWhereInput[] {
  return [{ slug: ref.toLowerCase() }, ...(UUID.test(ref) ? [{ id: ref.toLowerCase() }] : [])]
}

// Prisma passes `contains` to LIKE as is: `%` and `_` typed in a search are characters, not patterns.
const likeText = (text: string) => text.replace(/[\\%_]/g, (c) => `\\${c}`)

// ROADMAP E10.05: what `q` finds (@confluent/shared `adminDossierListQuerySchema`).
function searchWhere(q: string): Prisma.DossierWhereInput {
  const text = likeText(q)
  return {
    OR: [
      ...exactRef(q),
      ...(UUID.test(q) ? [{ companyId: q.toLowerCase() }] : []),
      { user: { email: { equals: q, mode: 'insensitive' } } },
      { name: { contains: text, mode: 'insensitive' } },
      { company: { name: { contains: text, mode: 'insensitive' } } },
    ],
  }
}

type ListedDossier = Prisma.DossierGetPayload<{ include: typeof LIST_INCLUDE }>

function listItem(d: ListedDossier): AdminDossierListItem {
  return {
    id: d.id,
    name: d.name,
    slug: d.slug,
    sector: d.sector,
    maturityStage: d.maturityStage,
    tagTechnologique: d.tagTechnologique,
    ownerEmail: d.user.email,
    companyName: d.company.name,
    publicationStatus: publicationStatusOf(d.publicationStatus),
    createdAt: d.createdAt,
    activeShareLinksCount: d.shareLinks.length,
  }
}

const dossierNotFound = () =>
  new NotFoundException({ code: 'DOSSIER_NOT_FOUND', message: 'Dossier introuvable.' })

@Injectable()
export class AdminDossiersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly answers: AnswersService,
    private readonly audit: AuditService,
    private readonly questionnaires: QuestionnairesService,
    private readonly documents: DocumentsService,
  ) {}

  // Every request of the platform, or those `q` finds, a page at a time (E10.05: on the server, past
  // any number of requests). Ordered by creation then identifier, so that a page never repeats nor
  // skips a request created at the same instant.
  async list(query: AdminDossierListQuery): Promise<AdminDossierList> {
    const page = query.page ?? 1
    const pageSize = query.pageSize ?? 20
    const q = query.q ? query.q : null
    const where = q ? searchWhere(q) : {}
    const [rows, total, exact] = await Promise.all([
      this.prisma.dossier.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        include: LIST_INCLUDE,
      }),
      this.prisma.dossier.count({ where }),
      q
        ? this.prisma.dossier.findFirst({ where: { OR: exactRef(q) }, include: LIST_INCLUDE })
        : Promise.resolve(null),
    ])
    return {
      page,
      pageSize,
      total,
      q,
      exactMatch: exact ? listItem(exact) : null,
      items: rows.map(listItem),
    }
  }

  // « Aller à » : the request whose slug or identifier is exactly `ref` (a slug changes with the
  // title: a link by identifier keeps working).
  async lookup(ref: string): Promise<AdminDossierListItem> {
    const found = await this.prisma.dossier.findFirst({
      where: { OR: exactRef(ref) },
      include: LIST_INCLUDE,
    })
    if (!found) throw dossierNotFound()
    return listItem(found)
  }

  // E10.05: the company's whole library as the request presents it — every document and version,
  // with its availability and a download link, and how this request selects each one — as its owner
  // reads it on the request.
  async listDocuments(dossierId: string): Promise<DocumentGroup[]> {
    return this.documents.listForDossier(await this.dossierRef(dossierId), 'complet', 'owner')
  }

  // E10.05: a document deposited by an administrator through a request, into its company's library:
  // a new document (not selected by any request), or a new version of the document of that name and
  // question, which replaces the one in force. Same formats, size limit and storage as the owner's
  // deposits; journaled on the request with the version (`DocumentsService.upload`).
  async uploadDocument(params: {
    dossierId: string
    adminId: string
    filename: string
    buffer: Buffer
    fieldId: string | null
    type?: DocumentType
  }): Promise<StoredVersion> {
    return this.documents.upload({
      dossier: await this.dossierRef(params.dossierId),
      filename: params.filename,
      buffer: params.buffer,
      fieldId: params.fieldId,
      type: params.type,
      byAdministrator: params.adminId,
    })
  }

  private async dossierRef(id: string): Promise<DossierRef> {
    const dossier = await this.prisma.dossier.findUnique({
      where: { id },
      select: { id: true, companyId: true },
    })
    if (!dossier) throw dossierNotFound()
    return dossier
  }

  // The dossier with its company profile's own questionnaire version (never the currently published
  // one): answers and edits must target the fields the profile was created with. Answers and
  // documents are the company's (E05.05), listed as the dossier presents them, with its id as
  // before; each document version with its library document's field and type (E05.06). The
  // administrator reads the whole library and, apart, the documents this request selects (E05.07).
  async detail(id: string): Promise<
    Dossier & {
      ownerEmail: string
      company: { id: string; name: string }
      questionnaireVersion: VersionStructure | null
      answers: Array<DossierAnswer & { dossierId: string }>
      documents: Array<Document & { dossierId: string; fieldId: string | null; type: DocumentType }>
      documentSelection: DossierDocumentSelected[]
    }
  > {
    const dossier = await this.prisma.dossier.findUnique({
      where: { id },
      include: {
        user: { select: { email: true } },
        company: { select: { id: true, name: true } },
        shareLinks: true,
      },
    })
    if (!dossier) {
      throw new NotFoundException({ code: 'DOSSIER_NOT_FOUND', message: 'Dossier not found.' })
    }
    const [questionnaireVersion, answers, documents, selection] = await Promise.all([
      this.questionnaires.getVersion(dossier.questionnaireVersionId),
      this.answers.listForDossier(dossier),
      this.prisma.document.findMany({
        where: { companyId: dossier.companyId },
        include: { libraryDocument: { select: { fieldId: true, type: true } } },
      }),
      this.prisma.dossierDocument.findMany({
        where: { dossierId: dossier.id },
        select: { libraryDocumentId: true, pinnedVersionId: true },
        orderBy: { createdAt: 'asc' },
      }),
    ])
    return {
      ...dossier,
      ownerEmail: dossier.user.email,
      questionnaireVersion,
      answers: answers.map((a) => ({ ...a, dossierId: dossier.id })),
      documents: documents.map(({ libraryDocument, ...d }) => ({
        ...d,
        fieldId: libraryDocument.fieldId,
        type: documentTypeOf(libraryDocument.type),
        dossierId: dossier.id,
      })),
      documentSelection: selection.map((s) => ({
        documentId: s.libraryDocumentId,
        pinnedVersionId: s.pinnedVersionId,
      })),
    }
  }

  async editAnswers(dossierId: string, adminId: string, updates: AnswerInput[]): Promise<void> {
    const dossier = await this.prisma.dossier.findUnique({ where: { id: dossierId } })
    if (!dossier) {
      throw new NotFoundException({ code: 'DOSSIER_NOT_FOUND', message: 'Dossier not found.' })
    }
    const existing = await this.prisma.dossierAnswer.findMany({
      where: { companyId: dossier.companyId, fieldId: { in: updates.map((u) => u.fieldId) } },
    })
    const existingByField = new Map(existing.map((e) => [e.fieldId, e.value]))
    await this.answers.saveForDossier(dossier, updates, { userId: adminId, channel: 'admin' })
    for (const u of updates) {
      await this.audit.record({
        actionType: 'admin_edited_field',
        actorId: adminId,
        dossierId,
        metadata: {
          fieldId: u.fieldId,
          oldValue: existingByField.get(u.fieldId) ?? null,
          newValue: u.value,
        },
      })
    }
  }
}
