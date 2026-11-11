import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common'
import { highestAccessLevel, missingRequiredAnswers, type AccessLevel } from '@confluent/shared'
import type { Dossier } from '@prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { slugify } from '../../common/slug'
import { QuestionnairesService } from '../questionnaires/questionnaires.service'
import {
  ClassificationService,
  storedClassification,
} from '../classification/classification.service'
import { lockDossier } from './dossier-lock'
import { isPendingProposal } from '../answers/answer-provenance'
import { type ActionOrigin, originMetadata } from '../audit/action-origin'
import { AuditService } from '../audit/audit.service'
import { attachedFieldIds } from '../documents/attached-fields'
import { CompaniesService } from '../companies/companies.service'
import { assertCanOwnCompanies } from '../companies/company-access'
import {
  fieldVisibleAt,
  grantedLevel,
  projectDossierForLevel,
  type DerivedDataContext,
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
    private readonly audit: AuditService,
    private readonly companies: CompaniesService,
  ) {}

  // A new dossier comes with its own company, named after it and owned by the same account (E05.04),
  // both or neither: attaching a dossier to an existing company waits for the company's own profile
  // (E05.05) and several financing requests (E05.07), otherwise the profile would be asked again.
  async create(params: CreateDossierParams) {
    assertCanOwnCompanies(params.owner)
    const baseSlug = slugify(params.name)
    const slug = await this.uniqueSlug(baseSlug)
    const version = await this.questionnaires.ensureBootstrap()
    return this.prisma.$transaction(async (tx) => {
      const company = await this.companies.createForOwner(tx, params.owner, params.name)
      const dossier = await tx.dossier.create({
        data: {
          userId: company.ownerId,
          companyId: company.id,
          name: params.name,
          slug,
          questionnaireVersionId: version.id,
        },
      })
      return { ...dossier, company: { id: company.id, name: company.name } }
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
    // The company is its owner's: a share shows the dossier only (E05.04).
    const company =
      dossier.userId === user.id
        ? await this.prisma.company.findUnique({
            where: { id: dossier.companyId },
            ...COMPANY_SUMMARY,
          })
        : null
    return {
      ...(await this.projectForLevel(dossier, accessLevel)),
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

  async update(params: UpdateDossierParams): Promise<Dossier> {
    const dossier = await this.getByIdForUser(params.id, params.userId)
    const data: { name?: string; slug?: string } = {}
    if (params.name !== undefined) {
      data.name = params.name
      data.slug = await this.uniqueSlug(slugify(params.name), dossier.id)
    }
    return this.prisma.dossier.update({ where: { id: dossier.id }, data })
  }

  // The company goes with its last dossier: until E05.05 it holds nothing but its name, its profile
  // and documents being the dossier's. Once it has a profile of its own, it will stay.
  async delete(id: string, userId: string): Promise<void> {
    const dossier = await this.getByIdForUser(id, userId)
    await this.prisma.$transaction(async (tx) => {
      await tx.dossier.delete({ where: { id: dossier.id } })
      const remaining = await tx.dossier.count({ where: { companyId: dossier.companyId } })
      if (remaining === 0) await tx.company.delete({ where: { id: dossier.companyId } })
    })
  }

  // Verified on the server (E03.10): every required question of the dossier's version is answered.
  // Submitting again refreshes the classification but keeps the first submission date. Check,
  // classification and submission happen under the dossier's lock, so a save in progress is either
  // seen complete or waits for the submission (code review R40). The same submission whatever the
  // channel (E04.08): the site, or an AI application on the owner's explicit instruction, which
  // `origin` records in the journal. AI proposals still to confirm do not block it (E04.05, D02).
  async submit(id: string, userId: string, origin: ActionOrigin): Promise<Dossier> {
    const { id: dossierId } = await this.getByIdForUser(id, userId)
    const { submitted, firstSubmission, pendingProposals } = await this.prisma.$transaction(
      async (tx) => {
        const dossier = await lockDossier(tx, dossierId)
        const [structure, answers, attached] = await Promise.all([
          this.questionnaires.getVersion(dossier.questionnaireVersionId),
          tx.dossierAnswer.findMany({ where: { dossierId } }),
          attachedFieldIds(tx, dossierId),
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
        const classification = await this.classification.evaluate(dossierId, tx)
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
