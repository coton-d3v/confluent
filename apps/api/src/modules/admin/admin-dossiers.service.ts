import { Injectable, NotFoundException } from '@nestjs/common'
import type { Dossier } from '@prisma/client'
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
      createdAt: d.createdAt,
      activeShareLinksCount: d.shareLinks.length,
    }))
    return { page, pageSize, total, items }
  }

  // The dossier with its own questionnaire version (never the currently published one): answers
  // and edits must target the fields the dossier was created with.
  async detail(
    id: string,
  ): Promise<Dossier & { ownerEmail: string; questionnaireVersion: VersionStructure | null }> {
    const dossier = await this.prisma.dossier.findUnique({
      where: { id },
      include: {
        user: { select: { email: true } },
        answers: true,
        shareLinks: true,
        documents: true,
      },
    })
    if (!dossier) {
      throw new NotFoundException({ code: 'DOSSIER_NOT_FOUND', message: 'Dossier not found.' })
    }
    const questionnaireVersion = await this.questionnaires.getVersion(
      dossier.questionnaireVersionId,
    )
    return { ...dossier, ownerEmail: dossier.user.email, questionnaireVersion }
  }

  async editAnswers(dossierId: string, adminId: string, updates: AnswerInput[]): Promise<void> {
    const existing = await this.prisma.dossierAnswer.findMany({
      where: { dossierId, fieldId: { in: updates.map((u) => u.fieldId) } },
    })
    const existingByField = new Map(existing.map((e) => [e.fieldId, e.value]))
    const dossier = await this.prisma.dossier.findUnique({ where: { id: dossierId } })
    if (!dossier) {
      throw new NotFoundException({ code: 'DOSSIER_NOT_FOUND', message: 'Dossier not found.' })
    }
    await this.answers.saveForDossier(dossier, updates)
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
