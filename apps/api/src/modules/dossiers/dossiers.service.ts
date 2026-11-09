import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common'
import { highestAccessLevel, missingRequiredAnswers, type AccessLevel } from '@confluent/shared'
import type { Dossier } from '@prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { slugify } from '../../common/slug'
import { QuestionnairesService } from '../questionnaires/questionnaires.service'
import { ClassificationService } from '../classification/classification.service'
import { lockDossier } from './dossier-lock'
import {
  fieldVisibleAt,
  grantedLevel,
  projectDossierForLevel,
  type DerivedDataContext,
} from './financeur-access'

export interface CreateDossierParams {
  userId: string
  name: string
}

export interface DossierReadAccess {
  dossier: Dossier
  // `complet` for the owner; for a financeur, the highest level among their active share links.
  accessLevel: AccessLevel
}

export interface UpdateDossierParams {
  userId: string
  id: string
  name?: string
}

@Injectable()
export class DossiersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly questionnaires: QuestionnairesService,
    private readonly classification: ClassificationService,
  ) {}

  async create(params: CreateDossierParams): Promise<Dossier> {
    const baseSlug = slugify(params.name)
    const slug = await this.uniqueSlug(baseSlug)
    const version = await this.questionnaires.ensureBootstrap()
    return this.prisma.dossier.create({
      data: {
        userId: params.userId,
        name: params.name,
        slug,
        questionnaireVersionId: version.id,
      },
    })
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
            ...(await this.projectForLevel(d, level ?? 'public')),
            ownerEmail: owner.email,
            ownerName,
          }
        }),
      )
    }
    return this.prisma.dossier.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
    })
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
      return { dossier, accessLevel }
    }
    if (dossier.userId !== user.id) {
      throw new NotFoundException({ code: 'DOSSIER_NOT_FOUND', message: 'Dossier not found.' })
    }
    return { dossier, accessLevel: 'complet' }
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
    const { dossier, accessLevel } = await this.resolveReadAccess(id, user)
    const snapshot = await this.questionnaires.getVersion(dossier.questionnaireVersionId)
    const questionnaireVersion = snapshot && {
      ...snapshot,
      fields: snapshot.fields.filter((f) => fieldVisibleAt(f, accessLevel)),
    }
    return { ...(await this.projectForLevel(dossier, accessLevel)), questionnaireVersion }
  }

  // Derived data of a dossier as a share level may read it (code review R31): the only entry point
  // for every reader other than the owner and administrators.
  async projectForLevel<T extends Dossier>(dossier: T, level: AccessLevel): Promise<T> {
    return projectDossierForLevel(dossier, level, await this.derivedDataContext(dossier))
  }

  private async derivedDataContext(dossier: Dossier): Promise<DerivedDataContext> {
    const [fields, rules] = await Promise.all([
      this.prisma.questionnaireField.findMany({
        where: { versionId: dossier.questionnaireVersionId },
        select: { key: true, minAccessLevel: true },
      }),
      this.prisma.classificationRule.findMany({ select: { dimension: true, fieldKey: true } }),
    ])
    return { fieldLevels: new Map(fields.map((f) => [f.key, f.minAccessLevel])), rules }
  }

  async update(params: UpdateDossierParams): Promise<Dossier> {
    const dossier = await this.getByIdForUser(params.id, params.userId)
    const data: { name?: string; slug?: string } = {}
    if (params.name !== undefined) {
      data.name = params.name
      data.slug = await this.uniqueSlug(slugify(params.name), dossier.id)
    }
    return this.prisma.dossier.update({ where: { id: dossier.id }, data })
  }

  async delete(id: string, userId: string): Promise<void> {
    const dossier = await this.getByIdForUser(id, userId)
    await this.prisma.dossier.delete({ where: { id: dossier.id } })
  }

  // Verified on the server (E03.10): every required question of the dossier's version is answered.
  // Submitting again refreshes the classification but keeps the first submission date. Check,
  // classification and submission happen under the dossier's lock, so a save in progress is either
  // seen complete or waits for the submission (code review R40).
  async submit(id: string, userId: string): Promise<Dossier> {
    const { id: dossierId } = await this.getByIdForUser(id, userId)
    return this.prisma.$transaction(async (tx) => {
      const dossier = await lockDossier(tx, dossierId)
      const [structure, answers] = await Promise.all([
        this.questionnaires.getVersion(dossier.questionnaireVersionId),
        tx.dossierAnswer.findMany({ where: { dossierId } }),
      ])
      const missing = missingRequiredAnswers(
        structure?.fields ?? [],
        Object.fromEntries(answers.map((a) => [a.fieldId, a.value])),
      )
      if (missing.length > 0) {
        throw new UnprocessableEntityException({
          code: 'DOSSIER_INCOMPLETE',
          message: `${missing.length} réponse(s) obligatoire(s) manquante(s).`,
          details: missing.map((f) => ({ fieldId: f.id, label: f.label })),
        })
      }
      const classification = await this.classification.compute(dossierId, tx)
      return tx.dossier.update({
        where: { id: dossierId },
        data: { ...classification, submittedAt: dossier.submittedAt ?? new Date() },
      })
    })
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
