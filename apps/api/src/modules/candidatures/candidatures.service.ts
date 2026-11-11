import { Injectable, NotFoundException } from '@nestjs/common'
import {
  canReviewCandidatures,
  financingStatusOf,
  financingTransition,
  financingTypesOf,
  isArchived,
  missingRequiredAnswers,
  publicationStatusOf,
  type CandidatureStatus,
  type ChangeFinancingStatusInput,
  type EligibilityBadge,
  type DossierPublicationStatus,
  type FinancingStatus,
  type FinancingStatusActor,
  type FinancingType,
} from '@confluent/shared'
import {
  Prisma,
  type Candidature,
  type CandidatureAnswer,
  type CandidatureAnswerRevision,
  type CandidatureStatusChange,
  type Dossier,
  type QuestionnaireField,
  type QuestionnaireSection,
  type QuestionnaireVersion,
} from '@prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import {
  declarationErrors,
  keepsRevision,
  provenanceColumns,
  provenanceView,
  revisionOf,
  type AnswerAuthor,
  type AnswerProvenanceView,
  type CheckedSource,
} from '../answers/answer-provenance'
import { AnswerSourcesService } from '../answers/answer-sources.service'
import {
  normalizeAnswers,
  submittedDossierErrors,
  validateAnswers,
} from '../answers/answer-validation'
import type { AnswerInput, AnswerRevisionView } from '../answers/answers.service'
import { InvalidAnswersException } from '../answers/invalid-answers.exception'
import { type ActionOrigin, SITE_ORIGIN, originMetadata } from '../audit/action-origin'
import { AuditService } from '../audit/audit.service'
import { assertCanOwnCompanies } from '../companies/company-access'
import { DossiersService, requestArchived } from '../dossiers/dossiers.service'
import { QuestionnairesService } from '../questionnaires/questionnaires.service'
import { WorkspaceAccessService, type WorkspaceActor } from '../workspaces/workspace-access'
import { CandidatureErrors } from './candidature-errors'

// The usage of a workspace's complementary form (@confluent/shared `formUsageSchema`).
const CANDIDATURE_USAGE = 'candidature'

// @confluent/shared `candidatureWorkspaceSchema`.
export interface CandidatureWorkspaceView {
  id: string
  name: string
  programName: string | null
  color: string | null
  presentation: string | null
}

// @confluent/shared `candidatureAnswerSchema`.
export interface CandidatureAnswerView {
  id: string
  candidatureId: string
  fieldId: string
  value: string
  createdAt: Date
  updatedAt: Date
  provenance: AnswerProvenanceView | null
  history: AnswerRevisionView[]
}

// @confluent/shared `candidatureSummarySchema`.
export interface CandidatureSummaryView {
  id: string
  dossierId: string
  workspace: { id: string; name: string; programName: string | null }
  status: CandidatureStatus
  submittedAt: Date | null
  financingStatus: FinancingStatus
  financingStatusChangedAt: Date
  createdAt: Date
  updatedAt: Date
}

// @confluent/shared `financingStatusChangeSchema`: which side, never who among the structure.
export interface FinancingStatusChangeView {
  from: FinancingStatus
  to: FinancingStatus
  by: FinancingStatusActor
  changedAt: Date
}

// @confluent/shared `receivedFinancingStatusChangeSchema`.
export interface ReceivedFinancingStatusChangeView extends FinancingStatusChangeView {
  actor: { email: string; firstName: string | null; lastName: string | null } | null
}

interface FormView {
  name: string
  version: QuestionnaireVersion
  sections: QuestionnaireSection[]
  fields: QuestionnaireField[]
}

// @confluent/shared `candidatureSchema`.
export interface CandidatureView extends CandidatureSummaryView {
  workspace: CandidatureWorkspaceView
  dossier: { id: string; slug: string; name: string; profileSubmitted: boolean }
  form: FormView
  answers: CandidatureAnswerView[]
  statusHistory: FinancingStatusChangeView[]
}

interface ReceivedAnswerView {
  fieldId: string
  value: string
}

// @confluent/shared `receivedCandidatureSummarySchema`.
export interface ReceivedCandidatureSummaryView {
  id: string
  submittedAt: Date
  financingStatus: FinancingStatus
  financingStatusChangedAt: Date
  company: { name: string }
  dossier: { name: string; amountEur: number | null; financingTypes: FinancingType[] }
}

// @confluent/shared `receivedCandidatureSchema`.
export interface ReceivedCandidatureView extends ReceivedCandidatureSummaryView {
  applicant: { email: string; firstName: string | null; lastName: string | null }
  dossier: ReceivedCandidatureSummaryView['dossier'] & {
    summary: string | null
    objective: string | null
    description: string | null
    publicationStatus: DossierPublicationStatus
  }
  profile: Omit<FormView, 'name'> & { answers: ReceivedAnswerView[] }
  form: FormView & { answers: ReceivedAnswerView[] }
  statusHistory: ReceivedFinancingStatusChangeView[]
}

// E06.05: a received candidature as the workspace lists it, with its eligibilities to the
// workspace's schemes (@confluent/shared `receivedCandidatureListItemSchema`).
export interface ReceivedCandidatureListItemView extends ReceivedCandidatureSummaryView {
  eligibilities: EligibilityBadge[]
}

// @confluent/shared `receivedCandidaturesQuerySchema`, parsed.
export interface ReceivedCandidaturesFilter {
  scheme?: string
  verified?: boolean
  financingStatus?: FinancingStatus
}

// Who acts on what a candidature carries for its two parties — its financing plan (E06.03), its
// eligibilities (E06.05): the owner of the request, or the workspace — its active conseillers and
// Confluent administrators, the people who read its candidatures (`canReviewCandidatures`).
export type CandidatureParty =
  | { side: 'owner'; userId: string }
  | { side: 'workspace'; actor: WorkspaceActor; workspaceId: string }

// A workspace's public identity, field by field: its settings (email domain, logo key…) and any
// column added later stay out.
function identityOf(workspace: CandidatureWorkspaceView): CandidatureWorkspaceView {
  const { id, name, programName, color, presentation } = workspace
  return { id, name, programName, color, presentation }
}

// Candidatures (ROADMAP E05.09, decision D01): a financing request presented to a workspace, which
// presents its company's common profile as is and answers the workspace's complementary form.
//
// The owner of the request — whoever works on its company as owner (`getByIdForUser`) — opens a
// candidature to a workspace that receives them (a published form assigned to its candidatures),
// fills in that form, submits it, and may withdraw it; a company prepared by a conseiller presents
// nothing before its entrepreneur owns it (E05.08). The candidature's answers are its own: stored
// apart from the profile, with the same validation, lock, provenance and history rules, read by its
// owner and — once submitted — by the conseillers of that workspace only. No other workspace, no
// share recipient, no other candidature of the company ever reads them; the share paths do not know
// them, and the MCP tools (E05.10) go through this service like the site. Every read and write of a
// workspace goes through the workspaces' single access rule, then `canReviewCandidatures`, at each
// request.
@Injectable()
export class CandidaturesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dossiers: DossiersService,
    private readonly workspaces: WorkspaceAccessService,
    private readonly questionnaires: QuestionnairesService,
    private readonly sources: AnswerSourcesService,
    private readonly audit: AuditService,
  ) {}

  // ── The owner of the request ─────────────────────────────────────────────────────────────────

  // The workspaces a request can be presented to, by their public identity, for whoever may own
  // companies: those with a published form assigned to their candidatures.
  async listOpenWorkspaces(user: { role: string }): Promise<CandidatureWorkspaceView[]> {
    assertCanOwnCompanies(user)
    const forms = await this.prisma.questionnaire.findMany({
      where: { usage: CANDIDATURE_USAGE, workspaceId: { not: null }, archivedAt: null },
    })
    const published = await this.prisma.questionnaireVersion.findMany({
      where: { questionnaireId: { in: forms.map((f) => f.id) }, status: 'published' },
    })
    const open = new Set(
      forms
        .filter((f) => published.some((v) => v.questionnaireId === f.id))
        .map((f) => f.workspaceId),
    )
    const workspaces = await this.prisma.workspace.findMany({
      where: { id: { in: [...open].filter((id): id is string => id !== null) } },
      orderBy: { name: 'asc' },
    })
    return workspaces.map(identityOf)
  }

  async listForDossier(dossierId: string, userId: string): Promise<CandidatureSummaryView[]> {
    const dossier = await this.dossiers.getByIdForUser(dossierId, userId)
    const rows = await this.prisma.candidature.findMany({
      where: { dossierId: dossier.id },
      orderBy: { createdAt: 'desc' },
    })
    const workspaces = await this.prisma.workspace.findMany({
      where: { id: { in: rows.map((r) => r.workspaceId) } },
    })
    const byId = new Map(workspaces.map((w) => [w.id, w]))
    return rows.map((row) => summaryView(row, byId.get(row.workspaceId)!))
  }

  // A candidature answers the version of the workspace's complementary form published at its
  // creation, kept afterwards (E03.08). At most one per request and workspace. Presenting a request
  // is diffusing it: refused while a conseiller prepares its company (409, E05.08) and while the
  // request is archived (409, E06.01).
  async create(dossierId: string, userId: string, workspaceId: string): Promise<CandidatureView> {
    const dossier = await this.dossiers.getForDiffusion(dossierId, userId)
    if (isArchived(dossier)) throw requestArchived()
    let created: Candidature
    try {
      created = await this.prisma.$transaction(async (tx) => {
        const version = await this.openFormVersion(tx, workspaceId)
        if (!version) throw CandidatureErrors.workspaceNotOpen()
        const existing = await tx.candidature.findFirst({
          where: { dossierId: dossier.id, workspaceId },
        })
        if (existing) throw CandidatureErrors.exists()
        return tx.candidature.create({
          data: { dossierId: dossier.id, workspaceId, formVersionId: version.id },
        })
      })
    } catch (err) {
      // Two requests at once: the unique index lets one through.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw CandidatureErrors.exists()
      }
      throw err
    }
    await this.audit.record({
      actionType: 'candidature_created',
      actorId: userId,
      dossierId: dossier.id,
      metadata: { candidatureId: created.id, workspaceId, formVersionId: created.formVersionId },
    })
    return this.ownerView(created, dossier)
  }

  async getForOwner(candidatureId: string, userId: string): Promise<CandidatureView> {
    const { candidature, dossier } = await this.findOwned(candidatureId, userId)
    return this.ownerView(candidature, dossier)
  }

  // The only way to write a candidature's answers. Every field must belong to the candidature's own
  // form version and every value fit its type — all or nothing (the profile's rules, E03.05); once
  // submitted, a required answer can be corrected but not cleared (E03.10). Under the candidature's
  // lock, the state read only afterwards (R40); each value with its provenance (E04.04), a state an
  // AI assistant is involved in kept in the history (E04.05). A cited source is one of the company's
  // documents, checked beforehand.
  async saveAnswers(
    candidatureId: string,
    userId: string,
    answers: AnswerInput[],
    author: AnswerAuthor,
  ): Promise<CandidatureAnswerView[]> {
    const { candidature, dossier } = await this.findOwned(candidatureId, userId)
    const cited = await this.sources.check(dossier, answers)
    const saved = await this.prisma.$transaction(async (tx) => {
      const current = await lockCandidature(tx, candidature.id, userId)
      const fields = await tx.questionnaireField.findMany({
        where: { versionId: current.formVersionId },
      })
      const normalized = normalizeAnswers(fields, answers)
      const errors = validateAnswers(fields, normalized)
      if (current.submittedAt) {
        errors.push(
          ...submittedDossierErrors(
            fields,
            normalized,
            'Réponse obligatoire : la candidature est envoyée, elle peut être corrigée mais pas effacée.',
          ),
        )
      }
      const labels = new Map(fields.map((f) => [f.id, f.label]))
      for (const e of [...declarationErrors(answers), ...cited.errors]) {
        errors.push({ ...e, label: labels.get(e.fieldId) })
      }
      if (errors.length) throw new InvalidAnswersException(errors)
      return upsertAnswers(tx, current.id, normalized, author, cited.sources)
    })
    return this.answerViews(dossier, saved)
  }

  // The owner sends the candidature: the workspace's conseillers read it from then on. It needs the
  // common profile submitted through this request (E03.10) and every required question of the
  // complementary form answered, and the request not archived (E06.01). Sending it again changes
  // nothing.
  async submit(
    candidatureId: string,
    userId: string,
    origin: ActionOrigin = SITE_ORIGIN,
  ): Promise<CandidatureView> {
    const { candidature, dossier } = await this.findOwned(candidatureId, userId)
    const { submitted, first } = await this.prisma.$transaction(async (tx) => {
      const current = await lockCandidature(tx, candidature.id, userId)
      const request = await tx.dossier.findUnique({ where: { id: current.dossierId } })
      if (!request?.submittedAt) throw CandidatureErrors.profileNotSubmitted()
      const [fields, answers] = await Promise.all([
        tx.questionnaireField.findMany({ where: { versionId: current.formVersionId } }),
        tx.candidatureAnswer.findMany({ where: { candidatureId: current.id } }),
      ])
      const missing = missingRequiredAnswers(
        fields,
        Object.fromEntries(answers.map((a) => [a.fieldId, a.value])),
        new Set(),
      )
      if (missing.length > 0) throw CandidatureErrors.incomplete(missing)
      if (current.submittedAt) return { submitted: current, first: false }
      if (isArchived(request)) throw requestArchived()
      // The financing status (`preparing`) dates from the sending: the workspace sees it from then on.
      const now = new Date()
      const updated = await tx.candidature.update({
        where: { id: current.id },
        data: { submittedAt: now, financingStatusChangedAt: now },
      })
      return { submitted: updated, first: true }
    })
    if (first) {
      await this.audit.record({
        actionType: 'candidature_submitted',
        actorId: userId,
        dossierId: dossier.id,
        metadata: {
          // E05.10: the site, or an AI application on the owner's explicit instruction.
          ...originMetadata(origin),
          candidatureId: submitted.id,
          workspaceId: submitted.workspaceId,
          submittedAt: submitted.submittedAt?.toISOString() ?? null,
        },
      })
    }
    return this.ownerView(submitted, dossier)
  }

  // The owner withdraws a draft candidature, with its answers; the journal of the request keeps the
  // trace. Once sent, the workspace follows it and keeps it, with its financing status and their
  // history (E06.01): its owner abandons it instead (409), which the workspace sees.
  async withdraw(candidatureId: string, userId: string): Promise<void> {
    const { candidature, dossier } = await this.findOwned(candidatureId, userId)
    const removed = await this.prisma.$transaction(async (tx) => {
      const current = await lockCandidature(tx, candidature.id, userId)
      if (current.submittedAt) throw CandidatureErrors.sent()
      await tx.candidature.delete({ where: { id: current.id } })
      return current
    })
    await this.audit.record({
      actionType: 'candidature_withdrawn',
      actorId: userId,
      dossierId: dossier.id,
      metadata: {
        candidatureId: removed.id,
        workspaceId: removed.workspaceId,
        submittedAt: removed.submittedAt?.toISOString() ?? null,
      },
    })
  }

  // ── The financing status (E06.01, decision D03 to be confirmed) ──────────────────────────────

  // The owner's side of the financing status of a sent candidature: the transitions
  // `FINANCING_STATUS_TRANSITIONS` gives to `owner` (abandon, reopen their own abandonment). E06.09:
  // journaled with its origin — the site, or an AI application on the owner's explicit instruction.
  async changeFinancingStatusAsOwner(
    candidatureId: string,
    userId: string,
    change: ChangeFinancingStatusInput,
    origin: ActionOrigin = SITE_ORIGIN,
  ): Promise<CandidatureView> {
    const { candidature, dossier } = await this.findOwned(candidatureId, userId)
    const changed = await this.prisma.$transaction(async (tx) => {
      const current = await lockCandidature(tx, candidature.id, userId)
      return applyFinancingStatus(tx, current, change, 'owner', userId)
    })
    await this.recordStatusChange(changed, change, 'owner', userId, originMetadata(origin))
    return this.ownerView(changed, dossier)
  }

  // The workspace's side: its conseillers and Confluent administrators — whoever reads its
  // candidatures (`404` outside the workspace, `403` for an investisseur) —, on a sent candidature
  // of this workspace only (`404` for a draft or another workspace's). Its journal entry belongs to
  // the request, which its owner reads: it never carries the structure's channel nor its words (an
  // MCP call keeps them in its own entry, outside the request's journal, E06.09).
  async changeFinancingStatusForWorkspace(
    actor: WorkspaceActor,
    workspaceId: string,
    candidatureId: string,
    change: ChangeFinancingStatusInput,
  ): Promise<ReceivedCandidatureView> {
    await this.assertCanReview(actor, workspaceId)
    const changed = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM "candidatures" WHERE "id" = ${candidatureId} FOR UPDATE`
      const current = await tx.candidature.findFirst({
        where: { id: candidatureId, workspaceId, submittedAt: { not: null } },
      })
      if (!current) throw CandidatureErrors.notFound()
      return applyFinancingStatus(tx, current, change, 'workspace', actor.id)
    })
    await this.recordStatusChange(changed, change, 'workspace', actor.id)
    return this.getReceived(actor, workspaceId, candidatureId)
  }

  private async recordStatusChange(
    candidature: Candidature,
    change: ChangeFinancingStatusInput,
    by: FinancingStatusActor,
    actorId: string,
    origin: Record<string, string> = {},
  ): Promise<void> {
    await this.audit.record({
      actionType: 'candidature_status_changed',
      actorId,
      dossierId: candidature.dossierId,
      metadata: {
        ...origin,
        candidatureId: candidature.id,
        workspaceId: candidature.workspaceId,
        from: change.from,
        to: change.to,
        by,
      },
    })
  }

  // ── The workspace's conseillers ──────────────────────────────────────────────────────────────

  // The submitted candidatures the workspace receives, the latest first, with their eligibilities to
  // its schemes (E06.05); filtered by scheme, verification and financing status when asked. Drafts
  // stay their owner's alone.
  async listReceived(
    actor: WorkspaceActor,
    workspaceId: string,
    filter: ReceivedCandidaturesFilter = {},
  ): Promise<ReceivedCandidatureListItemView[]> {
    return this.receivedListItems(workspaceId, await this.receivedRows(actor, workspaceId, filter))
  }

  // The rows of `listReceived`, after the workspace's read rule (`404`/`403`), the latest sent first:
  // E06.07's portfolio computes their phases before describing a page of them.
  async receivedRows(
    actor: WorkspaceActor,
    workspaceId: string,
    filter: ReceivedCandidaturesFilter = {},
  ): Promise<Candidature[]> {
    await this.assertCanReview(actor, workspaceId)
    const where: Prisma.CandidatureWhereInput = { workspaceId, submittedAt: { not: null } }
    if (filter.financingStatus) where.financingStatus = filter.financingStatus
    if (filter.scheme !== undefined || filter.verified) {
      // Only this workspace's eligibilities: another workspace's scheme matches nothing.
      const eligible = await this.prisma.candidatureEligibility.findMany({
        where: {
          workspaceId,
          ...(filter.scheme !== undefined ? { schemeId: filter.scheme } : {}),
          ...(filter.verified ? { verifiedAt: { not: null } } : {}),
        },
      })
      where.id = { in: [...new Set(eligible.map((e) => e.candidatureId))] }
    }
    return this.prisma.candidature.findMany({ where, orderBy: { submittedAt: 'desc' } })
  }

  // Received candidatures of `workspaceId` (rows of `receivedRows`) as the workspace lists them: its
  // company, request, financing status and eligibilities to the workspace's schemes.
  async receivedListItems(
    workspaceId: string,
    rows: Candidature[],
  ): Promise<ReceivedCandidatureListItemView[]> {
    if (rows.length === 0) return []
    const ids = rows.map((r) => r.id)
    const [dossiers, eligibilities, schemes] = await Promise.all([
      this.prisma.dossier.findMany({ where: { id: { in: rows.map((r) => r.dossierId) } } }),
      this.prisma.candidatureEligibility.findMany({ where: { candidatureId: { in: ids } } }),
      this.prisma.eligibilityScheme.findMany({
        where: { workspaceId },
        orderBy: [{ position: 'asc' }, { key: 'asc' }],
      }),
    ])
    const companies = await this.prisma.company.findMany({
      where: { id: { in: dossiers.map((d) => d.companyId) } },
    })
    const dossierById = new Map(dossiers.map((d) => [d.id, d]))
    const companyById = new Map(companies.map((c) => [c.id, c]))
    return rows.map((row) => {
      const dossier = dossierById.get(row.dossierId)!
      const own = new Map(
        eligibilities.filter((e) => e.candidatureId === row.id).map((e) => [e.schemeId, e]),
      )
      return {
        ...receivedSummary(row, dossier, companyById.get(dossier.companyId)!.name),
        eligibilities: schemes
          .filter((scheme) => own.has(scheme.id))
          .map((scheme) => ({
            schemeId: scheme.id,
            label: scheme.label,
            verified: own.get(scheme.id)!.verifiedAt !== null,
          })),
      }
    })
  }

  // One submitted candidature of the workspace: the request's presentation, the company's common
  // profile — its answers at the full level, attachments aside (documents are chosen per request and
  // reach a structure through E06/E07, never by a candidature) — and the candidature's own answers.
  // Values only: provenance and history stay the owner's. `404` for a candidature of another
  // workspace, a draft and an unknown one alike.
  async getReceived(
    actor: WorkspaceActor,
    workspaceId: string,
    candidatureId: string,
  ): Promise<ReceivedCandidatureView> {
    const row = await this.findReceived(actor, workspaceId, candidatureId)
    const dossier = (await this.prisma.dossier.findUnique({ where: { id: row.dossierId } }))!
    const [company, owner, profile, form, profileAnswers, ownAnswers, changes] = await Promise.all([
      this.prisma.company.findUnique({ where: { id: dossier.companyId } }),
      this.prisma.user.findUnique({ where: { id: dossier.userId } }),
      this.questionnaires.getVersion(dossier.questionnaireVersionId),
      this.formOf(row.formVersionId),
      this.prisma.dossierAnswer.findMany({ where: { companyId: dossier.companyId } }),
      this.prisma.candidatureAnswer.findMany({ where: { candidatureId: row.id } }),
      this.statusHistoryOf(row.id),
    ])
    const actors = await this.prisma.user.findMany({
      where: { id: { in: changes.flatMap((c) => (c.actorId ? [c.actorId] : [])) } },
    })
    const actorById = new Map(actors.map((u) => [u.id, u]))
    // The common profile, attachment questions aside.
    const profileFields = (profile?.fields ?? []).filter((f) => f.fieldType !== 'file')
    const profileFieldIds = new Set(profileFields.map((f) => f.id))
    const summary = receivedSummary(row, dossier, company!.name)
    return {
      ...summary,
      applicant: {
        email: owner!.email,
        firstName: owner!.firstName,
        lastName: owner!.lastName,
      },
      dossier: {
        ...summary.dossier,
        summary: dossier.summary,
        objective: dossier.objective,
        description: dossier.description,
        publicationStatus: publicationStatusOf(dossier.publicationStatus),
      },
      profile: {
        version: profile!.version,
        sections: profile!.sections.filter((s) => profileFields.some((f) => f.sectionId === s.id)),
        fields: profileFields,
        answers: profileAnswers
          .filter((a) => profileFieldIds.has(a.fieldId))
          .map(({ fieldId, value }) => ({ fieldId, value })),
      },
      form: { ...form, answers: ownAnswers.map(({ fieldId, value }) => ({ fieldId, value })) },
      statusHistory: changes.map((change) => {
        const actor = change.actorId ? actorById.get(change.actorId) : undefined
        return {
          ...changeView(change),
          actor: actor
            ? { email: actor.email, firstName: actor.firstName, lastName: actor.lastName }
            : null,
        }
      }),
    }
  }

  // The changes of a candidature's financing status, the latest first.
  private statusHistoryOf(candidatureId: string): Promise<CandidatureStatusChange[]> {
    return this.prisma.candidatureStatusChange.findMany({
      where: { candidatureId },
      orderBy: { changedAt: 'desc' },
    })
  }

  // ── Shared ───────────────────────────────────────────────────────────────────────────────────

  // THE workspace side's access to one candidature — what it reads of it, its financing status and
  // (E06.03) its financing plan: the rule below, then a candidature of this workspace once sent
  // (`404` alike for a draft, another workspace's and an unknown one). `tx`: read inside a
  // transaction, after its locks.
  async findReceived(
    actor: WorkspaceActor,
    workspaceId: string,
    candidatureId: string,
    tx: Prisma.TransactionClient = this.prisma,
  ): Promise<Candidature> {
    await this.assertCanReview(actor, workspaceId, tx)
    const row = await tx.candidature.findFirst({
      where: { id: candidatureId, workspaceId, submittedAt: { not: null } },
    })
    if (!row) throw CandidatureErrors.notFound()
    return row
  }

  // A candidature as one of its parties reaches it (E06.03, E06.05): `findOwned` for its owner (a
  // draft included), `findReceived` for the workspace (once sent). `tx`: the workspace's access read
  // inside a transaction.
  async reachAs(
    party: CandidatureParty,
    candidatureId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<Candidature> {
    return party.side === 'owner'
      ? (await this.findOwned(candidatureId, party.userId)).candidature
      : this.findReceived(party.actor, party.workspaceId, candidatureId, tx)
  }

  // Inside a write: locks the candidature's row, then reads the party's access again after the lock
  // — an owner who lost the request, a conseiller deactivated or a candidature removed meanwhile
  // writes nothing.
  async lockAs(
    tx: Prisma.TransactionClient,
    party: CandidatureParty,
    candidatureId: string,
  ): Promise<Candidature> {
    if (party.side === 'owner') return lockCandidature(tx, candidatureId, party.userId)
    await tx.$queryRaw`SELECT 1 FROM "candidatures" WHERE "id" = ${candidatureId} FOR UPDATE`
    return this.findReceived(party.actor, party.workspaceId, candidatureId, tx)
  }

  // Reading the candidatures a workspace receives: `404` for whoever is not in it (as for a
  // workspace that does not exist), then `403` for a member who is not one of its conseillers.
  private async assertCanReview(
    actor: WorkspaceActor,
    workspaceId: string,
    tx: Prisma.TransactionClient = this.prisma,
  ): Promise<void> {
    const scope = await this.workspaces.resolve(actor, workspaceId, tx)
    if (!canReviewCandidatures(actor, scope.membership)) throw CandidatureErrors.reviewForbidden()
  }

  // The published version of the form the workspace assigned to its candidatures, if any.
  private async openFormVersion(
    tx: Prisma.TransactionClient,
    workspaceId: string,
  ): Promise<QuestionnaireVersion | null> {
    const form = await tx.questionnaire.findFirst({
      where: { workspaceId, usage: CANDIDATURE_USAGE, archivedAt: null },
    })
    if (!form) return null
    return tx.questionnaireVersion.findFirst({
      where: { questionnaireId: form.id, status: 'published' },
    })
  }

  // THE owner access to a candidature — its answers, sending, financing status and (E06.03)
  // financing plan: the owner access to its request (`getByIdForUser`), else the same 404 as an
  // unknown candidature.
  async findOwned(
    candidatureId: string,
    userId: string,
  ): Promise<{ candidature: Candidature; dossier: Dossier }> {
    const candidature = await this.prisma.candidature.findUnique({ where: { id: candidatureId } })
    if (!candidature) throw CandidatureErrors.notFound()
    try {
      const dossier = await this.dossiers.getByIdForUser(candidature.dossierId, userId)
      return { candidature, dossier }
    } catch (err) {
      if (err instanceof NotFoundException) throw CandidatureErrors.notFound()
      throw err
    }
  }

  private async formOf(versionId: string): Promise<FormView> {
    const structure = (await this.questionnaires.getVersion(versionId))!
    const form = await this.prisma.questionnaire.findUnique({
      where: { id: structure.version.questionnaireId },
    })
    return { name: form!.name, ...structure }
  }

  private async ownerView(candidature: Candidature, dossier: Dossier): Promise<CandidatureView> {
    const [workspace, form, answers, request, changes] = await Promise.all([
      this.prisma.workspace.findUnique({ where: { id: candidature.workspaceId } }),
      this.formOf(candidature.formVersionId),
      this.prisma.candidatureAnswer.findMany({
        where: { candidatureId: candidature.id },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.dossier.findUnique({ where: { id: dossier.id } }),
      this.statusHistoryOf(candidature.id),
    ])
    return {
      ...summaryView(candidature, workspace!),
      workspace: identityOf(workspace!),
      dossier: {
        id: dossier.id,
        slug: request?.slug ?? dossier.slug,
        name: request?.name ?? dossier.name,
        profileSubmitted: (request ?? dossier).submittedAt !== null,
      },
      form,
      answers: await this.answerViews(dossier, answers),
      statusHistory: changes.map(changeView),
    }
  }

  private async answerViews(
    dossier: Dossier,
    rows: CandidatureAnswer[],
  ): Promise<CandidatureAnswerView[]> {
    const [documents, revisions] = await Promise.all([
      this.prisma.document.findMany({ where: { companyId: dossier.companyId } }),
      rows.length
        ? this.prisma.candidatureAnswerRevision.findMany({
            where: { answerId: { in: rows.map((r) => r.id) } },
            orderBy: { replacedAt: 'desc' },
          })
        : Promise.resolve([] as CandidatureAnswerRevision[]),
    ])
    const byId = new Map(documents.map((d) => [d.id, d]))
    return rows.map((row) => ({
      id: row.id,
      candidatureId: row.candidatureId,
      fieldId: row.fieldId,
      value: row.value,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      provenance: provenanceView(row, row.updatedAt, byId),
      history: revisions
        .filter((r) => r.answerId === row.id)
        .map((r) => ({
          value: r.value,
          provenance: provenanceView(r, r.recordedAt, byId),
          replacedAt: r.replacedAt,
        })),
    }))
  }
}

function summaryView(
  row: Candidature,
  workspace: { id: string; name: string; programName: string | null },
): CandidatureSummaryView {
  return {
    id: row.id,
    dossierId: row.dossierId,
    workspace: { id: workspace.id, name: workspace.name, programName: workspace.programName },
    status: row.submittedAt ? 'submitted' : 'draft',
    submittedAt: row.submittedAt,
    financingStatus: financingStatusOf(row.financingStatus),
    financingStatusChangedAt: row.financingStatusChangedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function receivedSummary(
  row: Candidature,
  dossier: Dossier,
  companyName: string,
): ReceivedCandidatureSummaryView {
  return {
    id: row.id,
    submittedAt: row.submittedAt!,
    financingStatus: financingStatusOf(row.financingStatus),
    financingStatusChangedAt: row.financingStatusChangedAt,
    company: { name: companyName },
    dossier: {
      name: dossier.name,
      amountEur: dossier.amountEur,
      financingTypes: financingTypesOf(dossier.financingTypes),
    },
  }
}

function changeView(change: CandidatureStatusChange): FinancingStatusChangeView {
  return {
    from: financingStatusOf(change.fromStatus),
    to: financingStatusOf(change.toStatus),
    by: change.actorSide === 'owner' ? 'owner' : 'workspace',
    changedAt: change.changedAt,
  }
}

// THE change of a candidature's financing status (D03, E06.01), under its row lock taken by the
// caller: only once sent (409), only from the status the client saw — a change made meanwhile is
// refused (409) rather than overwritten —, only along `FINANCING_STATUS_TRANSITIONS` and by the side
// it names (409 for a transition nobody makes, 403 for the other side's), dated and journaled in
// `candidature_status_changes` in the same transaction.
async function applyFinancingStatus(
  tx: Prisma.TransactionClient,
  current: Candidature,
  change: ChangeFinancingStatusInput,
  by: FinancingStatusActor,
  actorId: string,
): Promise<Candidature> {
  if (!current.submittedAt) throw CandidatureErrors.notSent()
  const status = financingStatusOf(current.financingStatus)
  if (status !== change.from) throw CandidatureErrors.statusChanged(status)
  const verdict = financingTransition(change.from, change.to, by)
  if (verdict === 'impossible') throw CandidatureErrors.transitionImpossible(change.from, change.to)
  if (verdict === 'forbidden') throw CandidatureErrors.transitionForbidden(change.to, by)
  const now = new Date()
  const updated = await tx.candidature.update({
    where: { id: current.id },
    data: { financingStatus: change.to, financingStatusChangedAt: now },
  })
  await tx.candidatureStatusChange.create({
    data: {
      candidatureId: current.id,
      fromStatus: change.from,
      toStatus: change.to,
      actorSide: by,
      actorId,
      changedAt: now,
    },
  })
  return updated
}

// The candidature's row, held for the rest of the transaction; still its owner's request once the
// lock is held (a request deleted meanwhile takes the candidature with it: 404).
async function lockCandidature(
  tx: Prisma.TransactionClient,
  id: string,
  ownerId: string,
): Promise<Candidature> {
  await tx.$queryRaw`SELECT 1 FROM "candidatures" WHERE "id" = ${id} FOR UPDATE`
  const candidature = await tx.candidature.findUnique({ where: { id } })
  if (!candidature) throw CandidatureErrors.notFound()
  const dossier = await tx.dossier.findUnique({ where: { id: candidature.dossierId } })
  if (!dossier || dossier.userId !== ownerId) throw CandidatureErrors.notFound()
  return candidature
}

// One statement at a time, like the profile's answers (an interactive transaction runs on a single
// connection); a state that gives way while an AI assistant is involved goes to the history.
async function upsertAnswers(
  tx: Prisma.TransactionClient,
  candidatureId: string,
  answers: AnswerInput[],
  author: AnswerAuthor,
  sources: Array<CheckedSource | null>,
): Promise<CandidatureAnswer[]> {
  const previous = new Map(
    (
      await tx.candidatureAnswer.findMany({
        where: { candidatureId, fieldId: { in: answers.map((a) => a.fieldId) } },
      })
    ).map((row) => [row.fieldId, row]),
  )
  const saved: CandidatureAnswer[] = []
  for (const [i, a] of answers.entries()) {
    const provenance = provenanceColumns(a, author, sources[i])
    const before = previous.get(a.fieldId)
    if (before && keepsRevision(before, { value: a.value, ...provenance })) {
      await tx.candidatureAnswerRevision.create({ data: revisionOf(before) })
    }
    const row = await tx.candidatureAnswer.upsert({
      where: { candidatureId_fieldId: { candidatureId, fieldId: a.fieldId } },
      create: { candidatureId, fieldId: a.fieldId, value: a.value, ...provenance },
      update: { value: a.value, ...provenance },
    })
    previous.set(a.fieldId, row)
    saved.push(row)
  }
  return saved
}
