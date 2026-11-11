import { Injectable } from '@nestjs/common'
import {
  ELIGIBILITY_CHANGES,
  FUNDING_PLAN_CHANGES,
  FUNDING_PLAN_FIELDS,
  financingStatusOf,
  fundingPlanLineStateOf,
  type Intervention,
  type InterventionJournal,
} from '@confluent/shared'
import type { AuditLog, Candidature, CandidatureNote, User } from '@prisma/client'
import { z } from 'zod'
import { PrismaService } from '../../prisma/prisma.service'
import { CandidaturesService } from '../candidatures/candidatures.service'
import type { WorkspaceActor } from '../workspaces/workspace-access'

// @confluent/shared `interventionJournalSchema`.
export type InterventionJournalView = InterventionJournal

// What the plan's and the eligibilities' journal entries say (E06.03, E06.05): read defensively —
// an entry this reader does not understand is left out rather than guessed.
const changeSchema = z.object({ field: z.string(), from: z.unknown(), to: z.unknown() })
const planEntrySchema = z.object({
  candidatureId: z.string(),
  side: z.literal('workspace'),
  change: z.enum(FUNDING_PLAN_CHANGES),
  lineId: z.string().optional(),
  line: z
    .object({
      category: z.string().nullable(),
      label: z.string().nullable(),
      amountEur: z.number().int().nullable(),
      state: z.string().nullable(),
    })
    .optional(),
  changes: z.array(changeSchema).optional(),
})
const eligibilityEntrySchema = z.object({
  candidatureId: z.string(),
  side: z.literal('workspace'),
  change: z.enum(ELIGIBILITY_CHANGES),
  scheme: z.string().nullable().optional(),
  verified: z.boolean().optional(),
  changes: z.array(changeSchema).optional(),
})

type PlanFieldChange = Extract<Intervention, { kind: 'funding_plan' }>['changes'][number]

const scalar = (v: unknown): string | number | null =>
  typeof v === 'string' || typeof v === 'number' ? v : null

// The journal of a workspace's interventions on a candidature it received (ROADMAP E06.08), in one
// chronological view, the latest first: its internal notes, the financing statuses it gave (E06.01),
// the plan lines it wrote (E06.03), the eligibilities it declared, rewrote, verified or removed
// (E06.05) and the steps it validated or reopened (E06.06). Read from the histories those features
// already keep — `candidature_status_changes`, `candidature_step_validation_changes`, the journal
// entries `funding_plan_updated` / `candidature_eligibility_updated` (which have no history table) —
// and the notes; nothing is copied. The entrepreneur's own actions are not the structure's
// interventions: they stay out. Read by the workspace's side of the candidature alone, through the
// candidatures' access rule (`404` outside the workspace, for a draft or another workspace's
// candidature, `403` for an investisseur); the owner of the request has no route to it.
@Injectable()
export class InterventionJournalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly candidatures: CandidaturesService,
  ) {}

  async get(
    actor: WorkspaceActor,
    workspaceId: string,
    candidatureId: string,
  ): Promise<InterventionJournalView> {
    const candidature = await this.candidatures.reachAs(
      { side: 'workspace', actor, workspaceId },
      candidatureId,
    )
    return this.view(actor, candidature)
  }

  // The journal of a candidature the caller already reached as the workspace (`reachAs`/`lockAs`).
  async view(actor: WorkspaceActor, candidature: Candidature): Promise<InterventionJournalView> {
    const { id, workspaceId } = candidature
    const [notes, statuses, validations, steps, logs, categories, schemes, lines] =
      await Promise.all([
        this.prisma.candidatureNote.findMany({ where: { candidatureId: id } }),
        this.prisma.candidatureStatusChange.findMany({
          where: { candidatureId: id, actorSide: 'workspace' },
        }),
        this.prisma.candidatureStepValidation.findMany({ where: { candidatureId: id } }),
        this.prisma.supportStep.findMany({ where: { workspaceId } }),
        this.prisma.auditLog.findMany({
          where: {
            dossierId: candidature.dossierId,
            actionType: { in: ['funding_plan_updated', 'candidature_eligibility_updated'] },
          },
        }),
        this.prisma.fundingSourceCategory.findMany({ where: { workspaceId } }),
        this.prisma.eligibilityScheme.findMany({ where: { workspaceId } }),
        this.prisma.fundingPlanLine.findMany({ where: { candidatureId: id } }),
      ])
    const stepChanges = validations.length
      ? await this.prisma.candidatureStepValidationChange.findMany({
          where: { validationId: { in: validations.map((v) => v.id) } },
        })
      : []
    // The request's journal covers its candidatures to every workspace: this one's only.
    const own = logs.filter((log) => metadataOf(log).candidatureId === id)
    const people = await this.prisma.user.findMany({
      where: {
        id: {
          in: [
            ...notes.map((n) => n.authorId),
            ...statuses.map((s) => s.actorId),
            ...stepChanges.map((c) => c.actorId),
            ...own.map((l) => l.actorId),
          ].filter((v): v is string => v !== null),
        },
      },
    })
    const personById = new Map(people.map((u) => [u.id, u]))
    const member = (userId: string | null) => memberOf(userId ? personById.get(userId) : undefined)
    const categoryLabel = labelsByKey(categories)
    const categoryById = new Map(categories.map((c) => [c.id, c.label]))
    // The source of a line an entry names: the line's now, else what its creation or deletion said
    // (a line updated, then deleted).
    const lineCategory = new Map<string, string | null>()
    for (const log of own) {
      const m = planEntrySchema.safeParse(log.metadata)
      if (m.success && m.data.lineId && m.data.line?.category) {
        lineCategory.set(
          m.data.lineId,
          categoryLabel.get(m.data.line.category) ?? m.data.line.category,
        )
      }
    }
    for (const l of lines) lineCategory.set(l.id, categoryById.get(l.categoryId) ?? null)
    const schemeLabel = labelsByKey(schemes)
    const stepById = new Map(steps.map((s) => [s.id, s]))
    const validationById = new Map(validations.map((v) => [v.id, v]))

    const entries: Intervention[] = [
      ...notes.map((note) => noteEntry(note, member(note.authorId), actor.id)),
      ...statuses.map(
        (s): Intervention => ({
          kind: 'financing_status',
          id: `status:${s.id}`,
          at: s.changedAt.toISOString(),
          actor: member(s.actorId),
          from: financingStatusOf(s.fromStatus),
          to: financingStatusOf(s.toStatus),
        }),
      ),
      ...stepChanges.flatMap((c): Intervention[] => {
        const step = stepById.get(validationById.get(c.validationId)?.stepId ?? '')
        if (!step) return []
        return [
          {
            kind: 'support_step',
            id: `step:${c.id}`,
            at: c.changedAt.toISOString(),
            actor: member(c.actorId),
            step: { id: step.id, label: step.label },
            change: c.change === 'validated' ? 'validated' : 'reopened',
          },
        ]
      }),
      ...own.flatMap((log): Intervention[] => {
        const base = {
          id: `journal:${log.id}`,
          at: log.createdAt.toISOString(),
          actor: member(log.actorId),
        }
        if (log.actionType === 'funding_plan_updated') {
          const parsed = planEntrySchema.safeParse(log.metadata)
          if (!parsed.success) return []
          const m = parsed.data
          const category = (key: unknown) =>
            typeof key === 'string' ? (categoryLabel.get(key) ?? key) : null
          const changes = (m.changes ?? []).flatMap((c): PlanFieldChange[] => {
            const field = FUNDING_PLAN_FIELDS.find((f) => f === c.field)
            if (!field) return []
            return field === 'category'
              ? [{ field, from: category(c.from), to: category(c.to) }]
              : [{ field, from: scalar(c.from), to: scalar(c.to) }]
          })
          const moved = changes.find((c) => c.field === 'category')
          return [
            {
              ...base,
              kind: 'funding_plan',
              change: m.change,
              category: m.line
                ? category(m.line.category)
                : typeof moved?.to === 'string'
                  ? moved.to
                  : ((m.lineId ? lineCategory.get(m.lineId) : null) ?? null),
              line: m.line
                ? {
                    label: m.line.label,
                    amountEur: m.line.amountEur,
                    state: m.line.state === null ? null : fundingPlanLineStateOf(m.line.state),
                  }
                : null,
              changes,
            },
          ]
        }
        const parsed = eligibilityEntrySchema.safeParse(log.metadata)
        if (!parsed.success) return []
        const m = parsed.data
        const verification = m.changes?.find((c) => c.field === 'verified')
        return [
          {
            ...base,
            kind: 'eligibility',
            change: m.change,
            scheme: m.scheme ? (schemeLabel.get(m.scheme) ?? m.scheme) : null,
            verified:
              m.change === 'declared'
                ? (m.verified ?? false)
                : typeof verification?.to === 'boolean'
                  ? verification.to
                  : null,
            noteChanged: m.change === 'updated' && !!m.changes?.some((c) => c.field === 'note'),
          },
        ]
      }),
    ]
    entries.sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id))
    return { candidatureId: id, workspaceId, entries }
  }
}

function noteEntry(
  note: CandidatureNote,
  author: Intervention['actor'],
  readerId: string,
): Intervention {
  return {
    kind: 'note',
    id: `note:${note.id}`,
    at: note.createdAt.toISOString(),
    actor: author,
    note: {
      id: note.id,
      body: note.deletedAt ? null : note.body,
      version: note.version,
      createdAt: note.createdAt.toISOString(),
      editedAt: note.editedAt?.toISOString() ?? null,
      deletedAt: note.deletedAt?.toISOString() ?? null,
      mine: note.authorId !== null && note.authorId === readerId,
    },
  }
}

function memberOf(user: User | undefined): Intervention['actor'] {
  return user ? { email: user.email, firstName: user.firstName, lastName: user.lastName } : null
}

function metadataOf(log: AuditLog): Record<string, unknown> {
  return log.metadata && typeof log.metadata === 'object' && !Array.isArray(log.metadata)
    ? (log.metadata as Record<string, unknown>)
    : {}
}

function labelsByKey(rows: Array<{ key: string; label: string }>): Map<string, string> {
  return new Map(rows.map((r) => [r.key, r.label]))
}
