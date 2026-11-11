import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common'
import {
  PUBLICATION_REQUIREMENT_LABELS,
  financingTypesOf,
  highestAccessLevel,
  isPublished,
  missingForPublication,
  missingRequiredAnswers,
  type AccessLevel,
  type FinancingType,
} from '@confluent/shared'
import type { Dossier, Prisma } from '@prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { slugify } from '../../common/slug'
import { QuestionnairesService } from '../questionnaires/questionnaires.service'
import {
  ClassificationService,
  storedClassification,
} from '../classification/classification.service'
import { lockProfile } from './dossier-profile'
import { isPendingProposal } from '../answers/answer-provenance'
import { type ActionOrigin, originMetadata } from '../audit/action-origin'
import { AuditService } from '../audit/audit.service'
import { attachedFieldIds } from '../documents/attached-fields'
import { CompaniesService } from '../companies/companies.service'
import { assertCanOwnCompanies } from '../companies/company-access'
import {
  fieldVisibleAt,
  grantedLevel,
  presentationForShare,
  projectDossierForLevel,
  type DerivedDataContext,
  type DossierRelation,
} from './financeur-access'

export interface CreateDossierParams {
  // The authenticated account, never an identifier supplied by the client.
  owner: { id: string; role: string }
  name: string
}

// The company a dossier finances, as its owner reads it (E05.04).
const COMPANY_SUMMARY = { select: { id: true, name: true } } as const

export interface DossierReadAccess {
  dossier: Dossier
  // `complet` for the owner; for a financeur, the highest level among their active share links.
  accessLevel: AccessLevel
  // A financeur reads through a share: the documents the dossier selects, its presentation once
  // published (E05.07).
  relation: DossierRelation
}

// The title and presentation of a request (E05.07), as validated by `updateDossierSchema`: an
// undefined part is left as it is, null clears it.
export interface DossierChanges {
  name?: string
  summary?: string | null
  objective?: string | null
  description?: string | null
  amountEur?: number | null
  financingTypes?: FinancingType[]
}

export interface UpdateDossierParams {
  userId: string
  id: string
  changes: DossierChanges
}

const notPublishable = (missing: ReturnType<typeof missingForPublication>, published: boolean) =>
  new UnprocessableEntityException({
    code: 'DOSSIER_NOT_PUBLISHABLE',
    message: published
      ? 'Une demande publiée garde sa présentation complète : dépubliez-la avant de retirer ces informations.'
      : `${missing.length} information(s) manquante(s) avant de publier la demande.`,
    details: missing.map((item) => ({ item, label: PUBLICATION_REQUIREMENT_LABELS[item] })),
  })

@Injectable()
export class DossiersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly questionnaires: QuestionnairesService,
    private readonly classification: ClassificationService,
    private readonly audit: AuditService,
    private readonly companies: CompaniesService,
  ) {}

  // A new dossier comes with its own company, named after it and owned by the same account (E05.04),
  // both or neither; the company's profile answers the form currently assigned to it (E03.09).
  // Another request of an existing company: `createForCompany` (E05.07).
  async create(params: CreateDossierParams) {
    assertCanOwnCompanies(params.owner)
    const baseSlug = slugify(params.name)
    const slug = await this.uniqueSlug(baseSlug)
    const version = await this.questionnaires.ensureBootstrap()
    return this.prisma.$transaction(async (tx) => {
      const company = await this.companies.createForOwner(tx, params.owner, params.name, version.id)
      const dossier = await tx.dossier.create({
        data: {
          userId: company.ownerId,
          companyId: company.id,
          name: params.name,
          slug,
          questionnaireVersionId: company.profileVersionId,
        },
      })
      return { ...dossier, company: { id: company.id, name: company.name } }
    })
  }

  // E05.07: another financing request of a company its owner already has, presenting the same
  // profile (answers and library) without entering it again. It selects no document yet: its owner
  // chooses what its shares will show (closed by default). Owner only, like the company (404 for
  // another account's or an unknown company).
  async createForCompany(params: CreateDossierParams & { companyId: string }) {
    assertCanOwnCompanies(params.owner)
    const company = await this.companies.findOwned(params.companyId, params.owner)
    const slug = await this.uniqueSlug(slugify(params.name))
    const dossier = await this.prisma.dossier.create({
      data: {
        userId: company.ownerId,
        companyId: company.id,
        name: params.name,
        slug,
        questionnaireVersionId: company.profileVersionId,
      },
    })
    return { ...dossier, company: { id: company.id, name: company.name } }
  }

  async listForUser(user: { id: string; email: string; role: string }): Promise<Dossier[]> {
    if (user.role === 'financeur') {
      const rows = await this.prisma.dossier.findMany({
        where: {
          shareLinks: {
            some: { recipientEmail: user.email, status: 'active' },
          },
        },
        include: {
          user: { select: { email: true, firstName: true, lastName: true } },
          shareLinks: {
            where: { recipientEmail: user.email, status: 'active' },
            select: { accessLevel: true },
          },
        },
        orderBy: { createdAt: 'desc' },
      })
      return Promise.all(
        rows.map(async ({ user: owner, shareLinks, ...d }) => {
          const nameParts = [owner.firstName, owner.lastName].filter(Boolean)
          const ownerName = nameParts.length > 0 ? nameParts.join(' ') : undefined
          const level = highestAccessLevel(shareLinks.map((l) => grantedLevel(l.accessLevel)))
          return {
            ...presentationForShare(await this.projectForLevel(d, level ?? 'public')),
            ownerEmail: owner.email,
            ownerName,
          }
        }),
      )
    }
    const owned = await this.prisma.dossier.findMany({
      where: { userId: user.id },
      include: { company: COMPANY_SUMMARY },
      orderBy: { createdAt: 'desc' },
    })
    return owned.map(({ company, ...d }) => ({
      ...d,
      company: { id: company.id, name: company.name },
    }))
  }

  async getByIdForUser(id: string, userId: string): Promise<Dossier> {
    const dossier = await this.prisma.dossier.findUnique({ where: { id } })
    if (!dossier || dossier.userId !== userId) {
      throw new NotFoundException({ code: 'DOSSIER_NOT_FOUND', message: 'Dossier not found.' })
    }
    return dossier
  }

  async resolveReadAccess(
    id: string,
    user: { id: string; email: string; role: string },
  ): Promise<DossierReadAccess> {
    const dossier = await this.prisma.dossier.findUnique({ where: { id } })
    if (!dossier) {
      throw new NotFoundException({ code: 'DOSSIER_NOT_FOUND', message: 'Dossier not found.' })
    }
    if (user.role === 'financeur') {
      const links = await this.prisma.shareLink.findMany({
        where: { dossierId: id, recipientEmail: user.email, status: 'active' },
        select: { accessLevel: true },
      })
      const accessLevel = highestAccessLevel(links.map((l) => grantedLevel(l.accessLevel)))
      if (!accessLevel) {
        throw new NotFoundException({ code: 'DOSSIER_NOT_FOUND', message: 'Dossier not found.' })
      }
      return { dossier, accessLevel, relation: 'share' }
    }
    if (dossier.userId !== user.id) {
      throw new NotFoundException({ code: 'DOSSIER_NOT_FOUND', message: 'Dossier not found.' })
    }
    return { dossier, accessLevel: 'complet', relation: 'owner' }
  }

  // Ids of the questionnaire fields whose answers the given level may read.
  async visibleFieldIds(dossier: Dossier, accessLevel: AccessLevel): Promise<Set<string>> {
    const fields = await this.prisma.questionnaireField.findMany({
      where: { versionId: dossier.questionnaireVersionId },
      select: { id: true, minAccessLevel: true },
    })
    return new Set(fields.filter((f) => fieldVisibleAt(f, accessLevel)).map((f) => f.id))
  }

  async getWithQuestionnaire(id: string, user: { id: string; email: string; role: string }) {
    const { dossier, accessLevel, relation } = await this.resolveReadAccess(id, user)
    const snapshot = await this.questionnaires.getVersion(dossier.questionnaireVersionId)
    const questionnaireVersion = snapshot && {
      ...snapshot,
      fields: snapshot.fields.filter((f) => fieldVisibleAt(f, accessLevel)),
    }
    // The company is its owner's: a share shows the dossier only (E05.04).
    const company =
      relation === 'owner'
        ? await this.prisma.company.findUnique({
            where: { id: dossier.companyId },
            ...COMPANY_SUMMARY,
          })
        : null
    const projected = await this.projectForLevel(dossier, accessLevel)
    return {
      ...(relation === 'owner' ? projected : presentationForShare(projected)),
      ...(company ? { company: { id: company.id, name: company.name } } : {}),
      questionnaireVersion,
    }
  }

  // Derived data of a dossier as a share level may read it (code review R31): the only entry point
  // for every reader other than the owner and administrators.
  async projectForLevel<T extends Dossier>(dossier: T, level: AccessLevel): Promise<T> {
    return projectDossierForLevel(dossier, level, await this.derivedDataContext(dossier))
  }

  private async derivedDataContext(dossier: Dossier): Promise<DerivedDataContext> {
    const fields = await this.prisma.questionnaireField.findMany({
      where: { versionId: dossier.questionnaireVersionId },
      select: { key: true, minAccessLevel: true },
    })
    return { fieldLevels: new Map(fields.map((f) => [f.key, f.minAccessLevel])) }
  }

  // The title (a new slug with it) and the presentation of a request (E05.07). A published request
  // keeps what publication requires (422 otherwise): its owner unpublishes it first. Under the
  // dossier's lock, like publication, so neither sees the other half done.
  async update(params: UpdateDossierParams): Promise<Dossier> {
    const { id } = await this.getByIdForUser(params.id, params.userId)
    const { changes } = params
    const slug =
      changes.name !== undefined ? await this.uniqueSlug(slugify(changes.name), id) : undefined
    return this.prisma.$transaction(async (tx) => {
      const dossier = await lockDossier(tx, id)
      const data: Prisma.DossierUpdateInput = {
        name: changes.name,
        slug,
        summary: changes.summary,
        objective: changes.objective,
        description: changes.description,
        amountEur: changes.amountEur,
        financingTypes:
          changes.financingTypes === undefined
            ? undefined
            : financingTypesOf(changes.financingTypes),
      }
      if (isPublished(dossier)) {
        const merged = { ...dossier, ...withoutUndefined(data) } as Dossier
        const missing = missingForPublication(merged)
        if (missing.length > 0) throw notPublishable(missing, true)
      }
      return tx.dossier.update({ where: { id }, data })
    })
  }

  // E05.07: the owner declares the request ready (D03 « publié »). Requires its presentation
  // (summary, objective, amount, at least one type) and its company profile submitted for this
  // dossier — the submission checks the profile; publication presents the request. Its shares then
  // show the presentation; it opens or closes no share. Publishing a published request changes
  // nothing. Journaled (`dossier_published`).
  async publish(id: string, userId: string): Promise<Dossier> {
    const { id: dossierId } = await this.getByIdForUser(id, userId)
    const { dossier, changed } = await this.prisma.$transaction(async (tx) => {
      const current = await lockDossier(tx, dossierId)
      if (isPublished(current)) return { dossier: current, changed: false }
      const missing = missingForPublication(current)
      if (missing.length > 0) throw notPublishable(missing, false)
      const updated = await tx.dossier.update({
        where: { id: dossierId },
        data: { publicationStatus: 'published', publishedAt: new Date() },
      })
      return { dossier: updated, changed: true }
    })
    if (changed) {
      await this.audit.record({
        actionType: 'dossier_published',
        actorId: userId,
        dossierId,
        metadata: { publishedAt: dossier.publishedAt?.toISOString() ?? null },
      })
    }
    return dossier
  }

  // Back to a draft: the shares stop showing the presentation; they stay open. Journaled.
  async unpublish(id: string, userId: string): Promise<Dossier> {
    const { id: dossierId } = await this.getByIdForUser(id, userId)
    const { dossier, publishedAt } = await this.prisma.$transaction(async (tx) => {
      const current = await lockDossier(tx, dossierId)
      if (!isPublished(current)) return { dossier: current, publishedAt: null }
      const updated = await tx.dossier.update({
        where: { id: dossierId },
        data: { publicationStatus: 'draft', publishedAt: null },
      })
      return { dossier: updated, publishedAt: current.publishedAt }
    })
    if (publishedAt) {
      await this.audit.record({
        actionType: 'dossier_unpublished',
        actorId: userId,
        dossierId,
        metadata: { publishedAt: publishedAt.toISOString() },
      })
    }
    return dossier
  }

  // The company goes with its last dossier, and its profile (answers, history, documents) with it,
  // as deleting a dossier did before E05.05: its profile and library are reached through its
  // dossiers only, so a company without dossier would be kept out of sight (the site warns before
  // deleting the last request). Under the profile's lock, taken before the rows, like every write on
  // the profile.
  async delete(id: string, userId: string): Promise<void> {
    const dossier = await this.getByIdForUser(id, userId)
    await this.prisma.$transaction(async (tx) => {
      await lockProfile(tx, dossier.id)
      await tx.dossier.delete({ where: { id: dossier.id } })
      const remaining = await tx.dossier.count({ where: { companyId: dossier.companyId } })
      if (remaining === 0) await tx.company.delete({ where: { id: dossier.companyId } })
    })
  }

  // Verified on the server (E03.10): every required question of the company profile the dossier
  // presents is answered (E05.05). Submitting again refreshes the classification but keeps the first
  // submission date. Check, classification and submission happen under the profile's lock, so a save
  // in progress is either seen complete or waits for the submission (code review R40). The same
  // submission whatever the channel (E04.08): the site, or an AI application on the owner's explicit
  // instruction, which `origin` records in the journal. AI proposals still to confirm do not block
  // it (E04.05, D02).
  async submit(id: string, userId: string, origin: ActionOrigin): Promise<Dossier> {
    const { id: dossierId } = await this.getByIdForUser(id, userId)
    const { submitted, firstSubmission, pendingProposals } = await this.prisma.$transaction(
      async (tx) => {
        const dossier = await lockProfile(tx, dossierId)
        const [structure, answers, attached] = await Promise.all([
          this.questionnaires.getVersion(dossier.questionnaireVersionId),
          tx.dossierAnswer.findMany({ where: { companyId: dossier.companyId } }),
          attachedFieldIds(tx, dossier.companyId),
        ])
        const missing = missingRequiredAnswers(
          structure?.fields ?? [],
          Object.fromEntries(answers.map((a) => [a.fieldId, a.value])),
          attached,
        )
        if (missing.length > 0) {
          throw new UnprocessableEntityException({
            code: 'DOSSIER_INCOMPLETE',
            message: `${missing.length} réponse(s) obligatoire(s) manquante(s).`,
            details: missing.map((f) => ({ fieldId: f.id, label: f.label })),
          })
        }
        const classification = await this.classification.evaluate(dossier.companyId, tx)
        const updated = await tx.dossier.update({
          where: { id: dossierId },
          data: {
            ...(classification ? storedClassification(classification) : {}),
            submittedAt: dossier.submittedAt ?? new Date(),
          },
        })
        return {
          submitted: updated,
          firstSubmission: dossier.submittedAt === null,
          pendingProposals: answers.filter(isPendingProposal).length,
        }
      },
    )
    await this.audit.record({
      actionType: 'dossier_submitted',
      actorId: userId,
      dossierId,
      metadata: {
        ...originMetadata(origin),
        firstSubmission,
        submittedAt: submitted.submittedAt?.toISOString() ?? null,
        questionnaireVersionId: submitted.questionnaireVersionId,
        pendingProposals,
      },
    })
    return submitted
  }

  private async uniqueSlug(base: string, ignoreDossierId?: string): Promise<string> {
    const existing = await this.prisma.dossier.findMany({
      where: { slug: { startsWith: base } },
      select: { id: true, slug: true },
    })
    const taken = new Set(existing.filter((d) => d.id !== ignoreDossierId).map((d) => d.slug))
    if (!taken.has(base)) return base
    let n = 2
    while (taken.has(`${base}-${n}`)) n += 1
    return `${base}-${n}`
  }
}

// The dossier's row, held for the rest of the transaction: its presentation and publication change
// one at a time (E05.07).
async function lockDossier(tx: Prisma.TransactionClient, id: string): Promise<Dossier> {
  await tx.$queryRaw`SELECT 1 FROM "dossiers" WHERE "id" = ${id} FOR UPDATE`
  const dossier = await tx.dossier.findUnique({ where: { id } })
  if (!dossier) {
    throw new NotFoundException({ code: 'DOSSIER_NOT_FOUND', message: 'Dossier not found.' })
  }
  return dossier
}

function withoutUndefined<T extends object>(data: T): Partial<T> {
  return Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined)) as Partial<T>
}
