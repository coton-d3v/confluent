import { z } from 'zod'
import { fundingPlanLineStateSchema } from './funding-plan.schema.js'
import { financingStatusSchema } from './status.schema.js'
import { HTML_TAG, SUPPORT_STEP_CHANGES, plainParagraphs } from './support-path.schema.js'

// ROADMAP E06.08: what a workspace keeps for itself on a candidature it received (one request × one
// workspace, E05.09) — the internal notes of its conseillers — and the journal of its interventions
// on it, read in one chronological view.
//
// Internal notes are written by the people who follow the workspace's candidatures (its active
// conseillers and Confluent administrators, `canReviewCandidatures`), on a sent candidature, and
// read by them alone: never by the entrepreneur, an investor (even a member of the workspace),
// another workspace, a share recipient, the showcase or an MCP tool (E06.09 will decide). A note is
// plain text; only its author edits it — from the version they read — or deletes it, which erases
// its text and keeps the trace « note supprimée ». The journal lists the workspace's own
// interventions — its notes, the financing statuses it gave (E06.01), the plan lines it wrote
// (E06.03), the eligibilities it declared or verified (E06.05) and the steps it validated or
// reopened (E06.06) —, the latest first, from the histories those features already keep.
//
// The limits are kept equal to the CHECK constraints of migration 20261122000000_candidature_notes.

export const CANDIDATURE_NOTE_LIMITS = { body: 4000, perCandidature: 500 } as const

// Plain text in paragraphs (the support path's explanations' rule), never empty, without markup.
const noteBodySchema = z
  .string({ message: 'Le texte de la note est obligatoire.' })
  .transform(plainParagraphs)
  .pipe(
    z
      .string()
      .min(1, 'La note est vide.')
      .max(
        CANDIDATURE_NOTE_LIMITS.body,
        `Une note compte au plus ${CANDIDATURE_NOTE_LIMITS.body} caractères.`,
      )
      .refine((v) => !HTML_TAG.test(v), {
        message: 'Une note est un texte simple : les balises HTML ne sont pas acceptées.',
      }),
  )

export const createCandidatureNoteSchema = z.object({ body: noteBodySchema }).strict()

// The author rewrites their note from the version they read: a note changed or deleted meanwhile
// is refused (409), never overwritten.
export const updateCandidatureNoteSchema = z
  .object({ body: noteBodySchema, version: z.number().int().min(1) })
  .strict()

export const deleteCandidatureNoteQuerySchema = z
  .object({ version: z.coerce.number().int().min(1) })
  .strict()

export type CreateCandidatureNoteInput = z.input<typeof createCandidatureNoteSchema>
export type UpdateCandidatureNoteInput = z.input<typeof updateCandidatureNoteSchema>

// ── The journal of interventions ────────────────────────────────────────────────────────────────

const memberSchema = z.object({
  email: z.string(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
})

// Common to every entry: a key stable across reads, when, and who among the structure (`null` once
// that account is gone).
const entryBase = {
  id: z.string(),
  at: z.string().datetime(),
  actor: memberSchema.nullable(),
}

// A note: its text (`null` once deleted), when its author last rewrote it, when it was deleted, its
// version, and whether the reader wrote it (only its author edits or deletes it).
export const candidatureNoteSchema = z.object({
  id: z.string().uuid(),
  body: z.string().nullable(),
  version: z.number().int().min(1),
  createdAt: z.string().datetime(),
  editedAt: z.string().datetime().nullable(),
  deletedAt: z.string().datetime().nullable(),
  mine: z.boolean(),
})

export const FUNDING_PLAN_CHANGES = ['created', 'updated', 'deleted'] as const
export const FUNDING_PLAN_FIELDS = ['category', 'label', 'amountEur', 'state'] as const
export const ELIGIBILITY_CHANGES = ['declared', 'updated', 'removed'] as const

export const interventionSchema = z.discriminatedUnion('kind', [
  z.object({ ...entryBase, kind: z.literal('note'), note: candidatureNoteSchema }),
  z.object({
    ...entryBase,
    kind: z.literal('financing_status'),
    from: financingStatusSchema,
    to: financingStatusSchema,
  }),
  z.object({
    ...entryBase,
    kind: z.literal('support_step'),
    step: z.object({ id: z.string().uuid(), label: z.string() }),
    change: z.enum(SUPPORT_STEP_CHANGES),
  }),
  // A line of the plan: its source (the category's current label) and, created or deleted, what it
  // said; updated, each field changed (`category`: labels; `state`: a line state).
  z.object({
    ...entryBase,
    kind: z.literal('funding_plan'),
    change: z.enum(FUNDING_PLAN_CHANGES),
    category: z.string().nullable(),
    line: z
      .object({
        label: z.string().nullable(),
        amountEur: z.number().int().nullable(),
        state: fundingPlanLineStateSchema.nullable(),
      })
      .nullable(),
    changes: z.array(
      z.object({
        field: z.enum(FUNDING_PLAN_FIELDS),
        from: z.union([z.string(), z.number()]).nullable(),
        to: z.union([z.string(), z.number()]).nullable(),
      }),
    ),
  }),
  // An eligibility to one of the workspace's schemes (the scheme's current label): declared,
  // updated or removed; `verified`: whether it was verified at the declaration, or how its
  // verification changed (`null`: unchanged); `noteChanged`: its précision rewritten.
  z.object({
    ...entryBase,
    kind: z.literal('eligibility'),
    change: z.enum(ELIGIBILITY_CHANGES),
    scheme: z.string().nullable(),
    verified: z.boolean().nullable(),
    noteChanged: z.boolean(),
  }),
])

export const INTERVENTION_KINDS = [
  'note',
  'financing_status',
  'support_step',
  'funding_plan',
  'eligibility',
] as const
export type InterventionKind = (typeof INTERVENTION_KINDS)[number]

export const interventionJournalSchema = z.object({
  candidatureId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  // The latest first.
  entries: z.array(interventionSchema),
})

export type CandidatureNote = z.infer<typeof candidatureNoteSchema>
export type Intervention = z.infer<typeof interventionSchema>
export type InterventionJournal = z.infer<typeof interventionJournalSchema>
