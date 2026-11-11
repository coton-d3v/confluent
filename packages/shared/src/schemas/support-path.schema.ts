import { z } from 'zod'

// ROADMAP E06.06: the support path (« parcours d'accompagnement ») of a workspace — its steps, their
// order and explanations — and, for each candidature it receives (one request × one workspace,
// E05.09), the steps its conseillers validated: when, and by whom.
//
// A workspace keeps its own list of steps, like its funding source categories (E06.02) and its
// schemes (E06.05): a stable `key` fixed at creation, distinct from its `label`, an `explanation`
// for the entrepreneur, an order and an activation configured by its managers; deactivated, never
// deleted. A candidature's step is validated, or its validation withdrawn (« rouverte »), by the
// workspace alone — its active conseillers and Confluent administrators —, each change dated and
// kept in its history. The owner of the request reads the path and what was validated (when, by the
// structure: never who among its members); nobody else reads it: no other workspace, no investor, no
// share recipient, no MCP tool yet (E06.09). Its phase is computed from the validated steps
// (E06.07, below).
//
// The default steps, limits and closed values are kept equal to the backfill and CHECK constraints
// of migration 20261121000000_support_paths.

// The steps a workspace starts with (at its creation, and for the workspaces existing before E06.06
// by the migration's backfill, which repeats them): Moneyplace's three fixed steps — diagnostic,
// business plan, pitch —, which each workspace may rename, explain, reorder, deactivate or add to.
export const DEFAULT_SUPPORT_STEPS: ReadonlyArray<{
  key: string
  label: string
  explanation: string
}> = [
  {
    key: 'diagnostic',
    label: 'Diagnostic',
    explanation:
      'Un premier échange avec votre conseiller pour faire le point sur le projet, l’équipe et les besoins de financement, et convenir des étapes suivantes.',
  },
  {
    key: 'business_plan',
    label: 'Business plan',
    explanation:
      'Le business plan et le prévisionnel financier sont rédigés, puis relus avec votre conseiller.',
  },
  {
    key: 'pitch',
    label: 'Pitch',
    explanation:
      'La présentation du projet est prête et a été répétée avec votre conseiller avant d’être présentée aux financeurs.',
  },
]

export const SUPPORT_STEP_LIMITS = {
  label: 80,
  key: 60,
  explanation: 1000,
  perWorkspace: 30,
} as const

// Lower-case ASCII words joined by single underscores, derived once from the first label.
export const SUPPORT_STEP_KEY_PATTERN = /^[a-z0-9]+(?:_[a-z0-9]+)*$/

const oneLine = (v: string) => v.replace(/\s+/g, ' ').trim()

// Plain text in paragraphs: line breaks kept (at most one blank line in a row), spaces collapsed,
// every other control character dropped.
export function plainParagraphs(v: string): string {
  return (
    v
      .replace(/\r\n?/g, '\n')
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000E-\u001F\u007F-\u009F]/g, '')
      .split('\n')
      .map((line) => line.replace(/[^\S\n]+/g, ' ').trim())
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  )
}

// What looks like an HTML tag: an explanation (and an internal note, E06.08) is plain text, shown as
// written, never interpreted.
export const HTML_TAG = /<[A-Za-z!/?]/

const labelSchema = z
  .string()
  .transform(oneLine)
  .pipe(
    z
      .string()
      .min(1, 'Le libellé est obligatoire.')
      .max(
        SUPPORT_STEP_LIMITS.label,
        `Le libellé compte au plus ${SUPPORT_STEP_LIMITS.label} caractères.`,
      ),
  )

// Blank clears it.
const explanationSchema = z
  .string()
  .transform(plainParagraphs)
  .pipe(
    z
      .string()
      .max(
        SUPPORT_STEP_LIMITS.explanation,
        `L’explication compte au plus ${SUPPORT_STEP_LIMITS.explanation} caractères.`,
      )
      .refine((v) => !HTML_TAG.test(v), {
        message: 'L’explication est un texte simple : les balises HTML ne sont pas acceptées.',
      }),
  )
  .transform((v) => (v === '' ? null : v))
  .nullable()

// A step the workspace adds to its path; its key is derived from the label by the API.
export const createSupportStepSchema = z
  .object({ label: labelSchema, explanation: explanationSchema.optional() })
  .strict()

// Only what is sent changes; the key never does.
export const updateSupportStepSchema = z
  .object({
    label: labelSchema.optional(),
    explanation: explanationSchema.optional(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine((v) => v.label !== undefined || v.explanation !== undefined || v.active !== undefined, {
    message: 'Indiquez le libellé, l’explication ou l’activation à modifier.',
  })

// The whole path in its new order: every step of the workspace once, deactivated ones included.
export const reorderSupportStepsSchema = z
  .object({
    stepIds: z
      .array(z.string().uuid())
      .min(1)
      .max(SUPPORT_STEP_LIMITS.perWorkspace)
      .refine((ids) => new Set(ids).size === ids.length, {
        message: 'Une étape apparaît deux fois dans le nouvel ordre.',
      }),
  })
  .strict()

export const supportStepSchema = z.object({
  id: z.string().uuid(),
  key: z.string(),
  label: z.string(),
  explanation: z.string().nullable(),
  position: z.number().int().nonnegative(),
  active: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})

// ── The phase of a candidature (E06.07) ─────────────────────────────────────────────────────────

// Where a candidature stands in its workspace's support path, computed — never stored — from the
// path's active steps in their order and the candidature's validations, by `supportProgress` only:
// - `in_progress` (« En préparation »): at least one active step is not validated; the current step
//   is the first of them in the path's order (the order is indicative: a later step may be
//   validated first, the current step stays the first one left);
// - `ready` (« Prête à lever »): every active step is validated;
// - `no_path` (« Sans parcours »): the workspace uses no active step — readiness is never claimed
//   without a single validation.
// A deactivated step counts for nothing, validated or not (its validation stays shown, E06.06); a
// step added to the path, or reactivated, applies to every candidature at once, a ready one going
// back to preparation. The financing status (E06.01) is another axis: a funded or refused
// candidature keeps its phase, and both filter the portfolio together.
export const SUPPORT_PHASES = ['in_progress', 'ready', 'no_path'] as const
export const supportPhaseSchema = z.enum(SUPPORT_PHASES)
export type SupportPhase = z.infer<typeof supportPhaseSchema>

export const SUPPORT_PHASE_LABELS: Record<SupportPhase, string> = {
  in_progress: 'En préparation',
  ready: 'Prête à lever',
  no_path: 'Sans parcours',
}

export const supportProgressSchema = z.object({
  phase: supportPhaseSchema,
  // Active steps validated, out of the active steps of the path.
  validatedSteps: z.number().int().min(0),
  totalSteps: z.number().int().min(0),
  // The first active step not validated, in the path's order; `null` unless `in_progress`.
  currentStep: z.object({ id: z.string().uuid(), label: z.string() }).nullable(),
})
export type SupportProgress = z.infer<typeof supportProgressSchema>

// THE phase rule. `steps`: the workspace's steps in the path's order, each with this candidature's
// validation date (`null` when not validated); deactivated steps may be included, they are ignored.
export function supportProgress(
  steps: ReadonlyArray<{
    id: string
    label: string
    active: boolean
    validatedAt: string | Date | null
  }>,
): SupportProgress {
  const inPath = steps.filter((s) => s.active)
  const validatedSteps = inPath.filter((s) => s.validatedAt !== null).length
  const current = inPath.find((s) => s.validatedAt === null)
  const phase: SupportPhase = inPath.length === 0 ? 'no_path' : current ? 'in_progress' : 'ready'
  return {
    phase,
    validatedSteps,
    totalSteps: inPath.length,
    currentStep: current ? { id: current.id, label: current.label } : null,
  }
}

// ── A candidature's path ────────────────────────────────────────────────────────────────────────

// The two changes of a step's validation, kept in its history.
export const SUPPORT_STEP_CHANGES = ['validated', 'reopened'] as const
export type SupportStepChange = (typeof SUPPORT_STEP_CHANGES)[number]

// The workspace validates a step (`true`) or withdraws its validation (`false`), from the `version`
// of the step's validation the client saw — `0` for a step never validated: a step changed
// meanwhile is refused (409) rather than overwritten.
export const setSupportStepValidationSchema = z
  .object({ validated: z.boolean(), version: z.number().int().min(0) })
  .strict()

// One step of a candidature's path, as its owner reads it: validated or not, and when — never by
// whom. `active: false`: a step the workspace no longer uses, shown only while its validation stands.
export const candidatureSupportStepSchema = z.object({
  id: z.string().uuid(),
  key: z.string(),
  label: z.string(),
  explanation: z.string().nullable(),
  active: z.boolean(),
  validatedAt: z.string().datetime().nullable(),
  version: z.number().int().min(0),
})

// A candidature's path in the workspace's order: its active steps, and the deactivated ones still
// validated; and its phase.
export const candidatureSupportPathSchema = z.object({
  candidatureId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  steps: z.array(candidatureSupportStepSchema),
  // E06.07: its phase, by `supportProgress`.
  progress: supportProgressSchema,
})

const memberSchema = z.object({
  email: z.string(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
})

// As the workspace reads it: who validated each step, and every change, the latest first, with who
// made it (`null` once that account is gone).
export const receivedSupportStepSchema = candidatureSupportStepSchema.extend({
  validatedBy: memberSchema.nullable(),
})

export const supportStepHistoryEntrySchema = z.object({
  stepId: z.string().uuid(),
  stepLabel: z.string(),
  change: z.enum(SUPPORT_STEP_CHANGES),
  changedAt: z.string().datetime(),
  actor: memberSchema.nullable(),
})

export const receivedSupportPathSchema = candidatureSupportPathSchema.extend({
  steps: z.array(receivedSupportStepSchema),
  history: z.array(supportStepHistoryEntrySchema),
})

export type CreateSupportStepInput = z.input<typeof createSupportStepSchema>
export type UpdateSupportStepInput = z.input<typeof updateSupportStepSchema>
export type ReorderSupportStepsInput = z.input<typeof reorderSupportStepsSchema>
export type SupportStep = z.infer<typeof supportStepSchema>
export type SetSupportStepValidationInput = z.infer<typeof setSupportStepValidationSchema>
export type CandidatureSupportStep = z.infer<typeof candidatureSupportStepSchema>
export type CandidatureSupportPath = z.infer<typeof candidatureSupportPathSchema>
export type ReceivedSupportStep = z.infer<typeof receivedSupportStepSchema>
export type SupportStepHistoryEntry = z.infer<typeof supportStepHistoryEntrySchema>
export type ReceivedSupportPath = z.infer<typeof receivedSupportPathSchema>
