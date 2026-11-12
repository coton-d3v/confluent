import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common'
import {
  DOSSIER_PUBLICATION_STATUS_LABELS,
  PUBLICATION_REQUIREMENT_LABELS,
  PUBLICATION_TRANSITIONS,
  financingTypesOf,
  highestAccessLevel,
  isArchived,
  isPublished,
  missingForPublication,
  missingRequiredAnswers,
  publicationStatusOf,
  publicationTransition,
  type AccessLevel,
  type AuditAction,
  type FinancingType,
  type PublicationAction,
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
import { withdrawFromEveryPool, withdrawalEntry } from '../pool-publications/pool-publication'
import {
  showcaseWithdrawalEntry,
  withdrawEveryShowcaseCard,
} from '../showcase-cards/showcase-cards'
import { isPendingProposal } from '../answers/answer-provenance'
import { type ActionOrigin, SITE_ORIGIN, originMetadata } from '../audit/action-origin'
import { AuditService } from '../audit/audit.service'
import { attachedFieldIds } from '../documents/attached-fields'
import { CompaniesService } from '../companies/companies.service'
import {
  CompanyErrors,
  assertCanOwnCompanies,
  canOwnCompanies,
  userHoldsCompany,
} from '../companies/company-access'
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

// The company a dossier finances, as its owner reads it (E05.04), and whether a conseiller holds it
// for an entrepreneur (E05.08).
const COMPANY_SUMMARY = {
  select: { id: true, name: true, ownerId: true, preparedInWorkspaceId: true },
} as const

// What decides who works on a dossier as its owner: its company's holder (E05.08).
const HOLDING = { company: { select: { ownerId: true, preparedInWorkspaceId: true } } } as const

// The shares sent to an address, whatever its case: the share link's own rule (`ShareLinksService`,
// E02.08) and the opportunities' (E07.03), so that every channel reaches the same shares (E07.04).
// The query narrows; the comparison decides, whatever the query matched.
const sharedWith = (email: string) => ({ equals: email, mode: 'insensitive' as const })
const sentTo = (email: string) => (link: { recipientEmail: string }) =>
  link.recipientEmail.trim().toLowerCase() === email.trim().toLowerCase()

const dossierNotFound = () =>
  new NotFoundException({ code: 'DOSSIER_NOT_FOUND', message: 'Dossier not found.' })

function companySummary(company: {
  id: string
  name: string
  preparedInWorkspaceId: string | null
}) {
  return {
    id: company.id,
    name: company.name,
    inPreparation: company.preparedInWorkspaceId !== null,
  }
}

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

// E06.01: an archived request is closed — no edit of its presentation, no publication, no new
// presentation to a structure — until its owner unarchives it.
export const requestArchived = () =>
  new ConflictException({
    code: 'DOSSIER_ARCHIVED',
    message: 'Cette demande est archivée : désarchivez-la d’abord.',
  })

const publicationRefused = (current: Dossier, action: PublicationAction) =>
  isArchived(current)
    ? requestArchived()
    : new ConflictException({
        code: 'PUBLICATION_TRANSITION_REFUSED',
        message: `Une demande « ${DOSSIER_PUBLICATION_STATUS_LABELS[publicationStatusOf(current.publicationStatus)]} » ne peut pas passer à « ${DOSSIER_PUBLICATION_STATUS_LABELS[PUBLICATION_TRANSITIONS[action].to]} ».`,
      })

const PUBLICATION_AUDIT_ACTIONS = {
  publish: 'dossier_published',
  unpublish: 'dossier_unpublished',
  archive: 'dossier_archived',
  unarchive: 'dossier_unarchived',
} as const satisfies Record<PublicationAction, AuditAction>

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
      return { ...dossier, company: companySummary(company) }
    })
  }

  // E05.07: another financing request of a company its owner already has, presenting the same
  // profile (answers and library) without entering it again. It selects no document yet: its owner
  // chooses what its shares will show (closed by default). Owner only, like the company (404 for
  // another account's or an unknown company). E05.08: the conseiller holding a company prepared for
  // an entrepreneur adds requests to it too, whatever their global role; any other account that may
  // not own companies keeps its 403.
  async createForCompany(params: CreateDossierParams & { companyId: string }) {
    const company = canOwnCompanies(params.owner)
      ? await this.companies.findOwned(params.companyId, params.owner)
      : await this.companies.findOwned(params.companyId, params.owner).catch(() => null)
    if (!company || (!canOwnCompanies(params.owner) && company.preparedInWorkspaceId === null)) {
      throw CompanyErrors.ownersOnly()
    }
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
    return { ...dossier, company: companySummary(company) }
  }

  // E05.08: a company a conseiller prepares in a workspace for an entrepreneur, with its first
  // request named after it, inside the caller's transaction (which also records the invitation and
  // checked the workspace rule). The conseiller owns them until the entrepreneur accepts.
  async createPrepared(
    tx: Prisma.TransactionClient,
    params: { holderId: string; workspaceId: string; name: string },
  ) {
    const slug = await this.uniqueSlug(slugify(params.name))
    const version = await this.questionnaires.ensureBootstrap()
    const company = await tx.company.create({
      data: {
        ownerId: params.holderId,
        name: params.name,
        profileVersionId: version.id,
        preparedInWorkspaceId: params.workspaceId,
      },
    })
    const dossier = await tx.dossier.create({
      data: {
        userId: company.ownerId,
        companyId: company.id,
        name: params.name,
        slug,
        questionnaireVersionId: company.profileVersionId,
      },
    })
    return { company, dossier }
  }

  // The dossiers the account works on as owner (`holdsCompany`: for a conseiller, the companies
  // they prepare in a workspace where they still are one), whatever its global role; a financeur
  // also receives those shared with them.
  async listForUser(user: { id: string; email: string; role: string }): Promise<Dossier[]> {
    const owned = await this.listOwned(user)
    if (user.role !== 'financeur') return owned
    const ownedIds = new Set(owned.map((d) => d.id))
    const shared = (await this.listShared(user)).filter((d) => !ownedIds.has(d.id))
    return [...owned, ...shared].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
  }

  private async listOwned(user: { id: string }): Promise<Dossier[]> {
    const rows = await this.prisma.dossier.findMany({
      where: { userId: user.id },
      include: { company: COMPANY_SUMMARY },
      orderBy: { createdAt: 'desc' },
    })
    const companies = await this.companies.heldOnly(
      user,
      rows.map((r) => r.company),
    )
    const held = new Set(companies.map((c) => c.id))
    return rows
      .filter((r) => held.has(r.company.id))
      .map(({ company, ...d }) => ({ ...d, company: companySummary(company) }))
  }

  private async listShared(user: { id: string; email: string }): Promise<Dossier[]> {
    const rows = await this.prisma.dossier.findMany({
      where: {
        shareLinks: {
          some: { recipientEmail: sharedWith(user.email), status: 'active' },
        },
      },
      include: {
        user: { select: { email: true, firstName: true, lastName: true } },
        shareLinks: {
          where: { recipientEmail: sharedWith(user.email), status: 'active' },
          select: { accessLevel: true, recipientEmail: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    })
    const reached = rows.flatMap(({ shareLinks, ...row }) => {
      const level = highestAccessLevel(
        shareLinks.filter(sentTo(user.email)).map((l) => grantedLevel(l.accessLevel)),
      )
      return level ? [{ ...row, level }] : []
    })
    return Promise.all(
      reached.map(async ({ user: owner, level, ...d }) => {
        const nameParts = [owner.firstName, owner.lastName].filter(Boolean)
        const ownerName = nameParts.length > 0 ? nameParts.join(' ') : undefined
        return {
          ...presentationForShare(await this.projectForLevel(d, level)),
          ownerEmail: owner.email,
          ownerName,
        }
      }),
    )
  }

  // THE owner access to a dossier (every write, the owner's reads): its company's holder
  // (`holdsCompany`), else the same 404 as an unknown dossier.
  async getByIdForUser(id: string, userId: string): Promise<Dossier> {
    return (await this.findHeld(id, userId)).dossier
  }

  // E05.08: the owner access, for what diffuses a dossier — a share, a publication — which a
  // company prepared by a conseiller never allows: only its entrepreneur decides it, once owner.
  async getForDiffusion(id: string, userId: string): Promise<Dossier> {
    const { dossier, inPreparation } = await this.findHeld(id, userId)
    if (inPreparation) throw CompanyErrors.inPreparation()
    return dossier
  }

  private async findHeld(
    id: string,
    userId: string,
  ): Promise<{ dossier: Dossier; inPreparation: boolean }> {
    const row = await this.prisma.dossier.findUnique({ where: { id }, include: HOLDING })
    if (!row || row.userId !== userId) throw dossierNotFound()
    const { company, ...dossier } = row
    if (!(await userHoldsCompany(this.prisma, { id: userId }, company))) throw dossierNotFound()
    return { dossier, inPreparation: company.preparedInWorkspaceId !== null }
  }

  // The owner first, whatever the account's global role (a conseiller holding a prepared company
  // may be a financeur, E05.08); then a financeur through their active shares.
  async resolveReadAccess(
    id: string,
    user: { id: string; email: string; role: string },
  ): Promise<DossierReadAccess> {
    const row = await this.prisma.dossier.findUnique({ where: { id }, include: HOLDING })
    if (!row) throw dossierNotFound()
    const { company, ...dossier } = row
    if (dossier.userId === user.id) {
      if (!(await userHoldsCompany(this.prisma, user, company))) throw dossierNotFound()
      return { dossier, accessLevel: 'complet', relation: 'owner' }
    }
    if (user.role === 'financeur') {
      const links = await this.prisma.shareLink.findMany({
        where: { dossierId: id, recipientEmail: sharedWith(user.email), status: 'active' },
        select: { accessLevel: true, recipientEmail: true },
      })
      const accessLevel = highestAccessLevel(
        links.filter(sentTo(user.email)).map((l) => grantedLevel(l.accessLevel)),
      )
      if (!accessLevel) {
        throw new NotFoundException({ code: 'DOSSIER_NOT_FOUND', message: 'Dossier not found.' })
      }
      return { dossier, accessLevel, relation: 'share' }
    }
    throw dossierNotFound()
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
    const fields = snapshot?.fields.filter((f) => fieldVisibleAt(f, accessLevel)) ?? []
    const questionnaireVersion = snapshot && {
      ...snapshot,
      // E07.04: as in the share projection (`recipientView`), a recipient is not told the title of
      // a section none of whose questions their level reads.
      sections:
        relation === 'owner'
          ? snapshot.sections
          : snapshot.sections.filter((s) => fields.some((f) => f.sectionId === s.id)),
      fields,
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
      ...(company ? { company: companySummary(company) } : {}),
      questionnaireVersion,
    }
  }

  // Derived data of a dossier as a share level may read it (code review R31): the only entry point
  // for every reader other than the owner and administrators.
  async projectForLevel<T extends Dossier>(dossier: T, level: AccessLevel): Promise<T> {
    return projectDossierForLevel(dossier, level, await this.derivedDataContext(dossier))
  }

  // The same projection for several dossiers, each at its own level (E07.03's lists), reading the
  // fields of their versions once.
  async projectEachForLevel<T extends Dossier>(
    items: ReadonlyArray<{ dossier: T; level: AccessLevel }>,
  ): Promise<T[]> {
    const versionIds = [...new Set(items.map((i) => i.dossier.questionnaireVersionId))]
    const fields =
      versionIds.length === 0
        ? []
        : await this.prisma.questionnaireField.findMany({
            where: { versionId: { in: versionIds } },
            select: { versionId: true, key: true, minAccessLevel: true },
          })
    const levels = new Map<string, Map<string, string>>()
    for (const f of fields) {
      const version = levels.get(f.versionId) ?? new Map<string, string>()
      version.set(f.key, f.minAccessLevel)
      levels.set(f.versionId, version)
    }
    return items.map(({ dossier, level }) =>
      projectDossierForLevel(dossier, level, {
        fieldLevels: levels.get(dossier.questionnaireVersionId) ?? new Map(),
      }),
    )
  }

  private async derivedDataContext(dossier: Dossier): Promise<DerivedDataContext> {
    const fields = await this.prisma.questionnaireField.findMany({
      where: { versionId: dossier.questionnaireVersionId },
      select: { key: true, minAccessLevel: true },
    })
    return { fieldLevels: new Map(fields.map((f) => [f.key, f.minAccessLevel])) }
  }

  // The title (a new slug with it) and the presentation of a request (E05.07). A published request
  // keeps what publication requires (422 otherwise): its owner unpublishes it first; an archived one
  // is closed (409, E06.01): its owner unarchives it first. Under the
  // dossier's lock, like publication, so neither sees the other half done.
  async update(params: UpdateDossierParams): Promise<Dossier> {
    const { id } = await this.getByIdForUser(params.id, params.userId)
    const { changes } = params
    const slug =
      changes.name !== undefined ? await this.uniqueSlug(slugify(changes.name), id) : undefined
    return this.prisma.$transaction(async (tx) => {
      const dossier = await lockDossier(tx, id, params.userId)
      if (isArchived(dossier)) throw requestArchived()
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
  // nothing; an archived one is unarchived first (409). Journaled (`dossier_published`), with the
  // channel it was asked through (E04.08, E05.10).
  publish(id: string, userId: string, origin: ActionOrigin = SITE_ORIGIN): Promise<Dossier> {
    return this.changePublication(id, userId, 'publish', origin)
  }

  // Back to a draft: the shares stop showing the presentation; they stay open. Journaled.
  unpublish(id: string, userId: string): Promise<Dossier> {
    return this.changePublication(id, userId, 'unpublish')
  }

  // E06.01 (D03 « archivé »): the owner closes the request, published or not. Journaled. E07.02: it
  // withdraws its publication from every workspace's pool (journaled, reason `archived`), which
  // unarchiving does not restore; its shares and candidatures stay as they are.
  archive(id: string, userId: string): Promise<Dossier> {
    return this.changePublication(id, userId, 'archive')
  }

  // E06.01: an archived request goes back to a draft, to be published again if wanted. Journaled.
  unarchive(id: string, userId: string): Promise<Dossier> {
    return this.changePublication(id, userId, 'unarchive')
  }

  // Every change of a request's publication (D03, E06.01), as `PUBLICATION_TRANSITIONS` allows it:
  // by its owner only — publishing, which diffuses it, never while a conseiller prepares its company
  // (409, E05.08) —, under the dossier's lock so that two changes never interleave, asking again for
  // the current status changing nothing; journaled once applied.
  private async changePublication(
    id: string,
    userId: string,
    action: PublicationAction,
    origin: ActionOrigin = SITE_ORIGIN,
  ): Promise<Dossier> {
    const { id: dossierId } =
      action === 'publish'
        ? await this.getForDiffusion(id, userId)
        : await this.getByIdForUser(id, userId)
    const { dossier, previous, withdrawn } = await this.prisma.$transaction(async (tx) => {
      const current = await lockDossier(tx, dossierId, userId)
      const transition = publicationTransition(current.publicationStatus, action)
      if (transition === 'unchanged') return { dossier: current, previous: null, withdrawn: [] }
      if (transition === 'refused') throw publicationRefused(current, action)
      if (action === 'publish') {
        const missing = missingForPublication(current)
        if (missing.length > 0) throw notPublishable(missing, false)
      }
      const now = new Date()
      const to = PUBLICATION_TRANSITIONS[action].to
      const updated = await tx.dossier.update({
        where: { id: dossierId },
        data: {
          publicationStatus: to,
          publishedAt: to === 'published' ? now : null,
          archivedAt: to === 'archived' ? now : null,
        },
      })
      const withdrawn =
        action === 'archive' ? await withdrawFromEveryPool(tx, dossierId, userId, now) : []
      // E09.02: nor on any public page — journaled with the archiving's change.
      if (action === 'archive') {
        for (const card of await withdrawEveryShowcaseCard(tx, dossierId, userId, now)) {
          await this.audit.recordIn(
            tx,
            showcaseWithdrawalEntry(card, dossierId, userId, 'archived'),
          )
        }
      }
      return { dossier: updated, previous: current, withdrawn }
    })
    if (previous) {
      await this.audit.record({
        actionType: PUBLICATION_AUDIT_ACTIONS[action],
        actorId: userId,
        dossierId,
        metadata: {
          // E05.10: the site, or an AI application on the owner's explicit instruction.
          ...(action === 'publish' ? originMetadata(origin) : {}),
          from: publicationStatusOf(previous.publicationStatus),
          to: publicationStatusOf(dossier.publicationStatus),
          publishedAt: (dossier.publishedAt ?? previous.publishedAt)?.toISOString() ?? null,
          ...(action === 'unarchive'
            ? { archivedAt: previous.archivedAt?.toISOString() ?? null }
            : {}),
        },
      })
    }
    for (const publication of withdrawn) {
      await this.audit.record(withdrawalEntry(publication, dossierId, userId, 'archived'))
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
      await lockProfile(tx, dossier)
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
    const held = await this.getByIdForUser(id, userId)
    const dossierId = held.id
    const { submitted, firstSubmission, pendingProposals } = await this.prisma.$transaction(
      async (tx) => {
        const dossier = await lockProfile(tx, held)
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
// one at a time (E05.07), and so do its shares (E07.01). Still the owner's once the lock is held: a
// transfer of its company (E05.08) committed meanwhile leaves the former owner with a 404.
export async function lockDossier(
  tx: Prisma.TransactionClient,
  id: string,
  ownerId: string,
): Promise<Dossier> {
  await tx.$queryRaw`SELECT 1 FROM "dossiers" WHERE "id" = ${id} FOR UPDATE`
  const dossier = await tx.dossier.findUnique({ where: { id } })
  if (!dossier || dossier.userId !== ownerId) throw dossierNotFound()
  return dossier
}

function withoutUndefined<T extends object>(data: T): Partial<T> {
  return Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined)) as Partial<T>
}
