import { Injectable, NotFoundException } from '@nestjs/common'
import type { Document, Dossier, DossierAnswer } from '@prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { AnswersService, type AnswerInput } from '../answers/answers.service'
import {
  QuestionnairesService,
  type VersionStructure,
} from '../questionnaires/questionnaires.service'
import { AuditService } from '../audit/audit.service'

export interface AdminDossierListItem {
  id: string
  name: string
  slug: string
  sector: string | null
  maturityStage: string | null
  tagTechnologique: string | null
  ownerEmail: string
  companyName: string
  createdAt: Date
  activeShareLinksCount: number
}

export interface AdminDossierList {
  page: number
  pageSize: number
  total: number
  items: AdminDossierListItem[]
}

@Injectable()
export class AdminDossiersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly answers: AnswersService,
    private readonly audit: AuditService,
    private readonly questionnaires: QuestionnairesService,
  ) {}

  async list(page: number, pageSize: number): Promise<AdminDossierList> {
    const skip = (page - 1) * pageSize
    const [rows, total] = await Promise.all([
      this.prisma.dossier.findMany({
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        include: {
          user: { select: { email: true } },
          company: { select: { name: true } },
          shareLinks: { where: { status: 'active' }, select: { id: true } },
        },
      }),
      this.prisma.dossier.count(),
    ])
    const items = rows.map((d) => ({
      id: d.id,
      name: d.name,
      slug: d.slug,
      sector: d.sector,
      maturityStage: d.maturityStage,
      tagTechnologique: d.tagTechnologique,
      ownerEmail: d.user.email,
      companyName: d.company.name,
      createdAt: d.createdAt,
      activeShareLinksCount: d.shareLinks.length,
    }))
    return { page, pageSize, total, items }
  }

  // The dossier with its company profile's own questionnaire version (never the currently published
  // one): answers and edits must target the fields the profile was created with. Answers and
  // documents are the company's (E05.05), listed as the dossier presents them, with its id as
  // before.
  async detail(id: string): Promise<
    Dossier & {
      ownerEmail: string
      company: { id: string; name: string }
      questionnaireVersion: VersionStructure | null
      answers: Array<DossierAnswer & { dossierId: string }>
      documents: Array<Document & { dossierId: string }>
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
    const [questionnaireVersion, answers, documents] = await Promise.all([
      this.questionnaires.getVersion(dossier.questionnaireVersionId),
      this.answers.listForDossier(dossier),
      this.prisma.document.findMany({ where: { companyId: dossier.companyId } }),
    ])
    return {
      ...dossier,
      ownerEmail: dossier.user.email,
      questionnaireVersion,
      answers: answers.map((a) => ({ ...a, dossierId: dossier.id })),
      documents: documents.map((d) => ({ ...d, dossierId: dossier.id })),
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
