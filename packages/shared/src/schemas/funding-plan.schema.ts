import { z } from 'zod'
import { FINANCING_AMOUNT_MAX_EUR } from './financing.schema.js'
import { fundingSourceFamilySchema } from './funding-source.schema.js'
import { FINANCING_STATUS_ACTORS, type FinancingStatusActor } from './status.schema.js'

// ROADMAP E06.03: the financing plan of a request in one workspace. It belongs to the candidature
// (one request × one workspace, E05.09/E06.01), like the financing status: its lines use the source
// categories of that workspace (E06.02), its owner and that workspace's conseillers keep it, and no
// other workspace, investor or share recipient reads it. Its target is the request's amount sought
// (`dossiers.amount_eur`, E05.07) — the « objectif » of a plan is that amount, not the request's
// `objective` text, which states what the money is for.
//
// Each line is an amount for one source category, in one state below, with an optional detail
// (« BNP », « Bourse French Tech »…); a category may have several lines. The aggregates are computed
// here only (`fundingPlanTotals`), by the API for every read and by nothing else. The closed lists
// and limits are kept equal to the CHECK constraint of migration 20261119000000_funding_plans.
//
// Promises (E06.04, E07.06) are not lines: they will be counted apart from these totals, so that an
// intention and the financing it becomes are never added together.

// planned: identified, not yet asked for; requested: asked for, decision pending; obtained: granted;
// refused: kept for the record, counted nowhere.
export const FUNDING_PLAN_LINE_STATES = ['planned', 'requested', 'obtained', 'refused'] as const
export const fundingPlanLineStateSchema = z.enum(FUNDING_PLAN_LINE_STATES, {
  message: 'Choisissez l’état de la source.',
})
export type FundingPlanLineState = z.infer<typeof fundingPlanLineStateSchema>

export const FUNDING_PLAN_LINE_STATE_LABELS: Record<FundingPlanLineState, string> = {
  planned: 'Envisagé',
  requested: 'En cours',
  obtained: 'Obtenu',
  refused: 'Refusé',
}

export const FUNDING_PLAN_LINE_STATE_HINTS: Record<FundingPlanLineState, string> = {
  planned: 'pas encore sollicité',
  requested: 'demandé, décision attendue',
  obtained: 'accordé',
  refused: 'gardé pour mémoire, compté nulle part',
}

// Closed by default: an unknown state counts as neither obtained nor in progress.
export function fundingPlanLineStateOf(raw: string | null | undefined): FundingPlanLineState {
  return (FUNDING_PLAN_LINE_STATES as readonly string[]).includes(raw ?? '')
    ? (raw as FundingPlanLineState)
    : 'planned'
}

export const FUNDING_PLAN_LIMITS = { label: 120, linesPerPlan: 50 } as const

// Who wrote a line last: the owner of the request or the workspace (never who among its members).
export type FundingPlanSide = FinancingStatusActor
export function fundingPlanSideOf(raw: string | null | undefined): FundingPlanSide {
  return raw === 'owner' ? 'owner' : 'workspace'
}

const amountSchema = z
  .number({ message: 'Indiquez un montant en euros.' })
  .int('Le montant s’indique en euros, sans centimes.')
  .min(1, 'Le montant est d’au moins 1 €.')
  .max(FINANCING_AMOUNT_MAX_EUR, 'Le montant dépasse le maximum accepté (1 milliard d’euros).')

// One line of plain text; blank clears it.
const lineLabelSchema = z
  .string()
  .transform((v) => v.replace(/\s+/g, ' ').trim())
  .pipe(
    z
      .string()
      .max(
        FUNDING_PLAN_LIMITS.label,
        `La précision compte au plus ${FUNDING_PLAN_LIMITS.label} caractères.`,
      ),
  )
  .transform((v) => (v === '' ? null : v))
  .nullable()

const categoryIdSchema = z.string().uuid('Choisissez une source.')

export const createFundingPlanLineSchema = z
  .object({
    categoryId: categoryIdSchema,
    amountEur: amountSchema,
    state: fundingPlanLineStateSchema,
    label: lineLabelSchema.optional(),
  })
  .strict()

// `version`: the version of the line the client saw; a line changed meanwhile is refused (409)
// rather than overwritten. Only what is sent changes.
export const updateFundingPlanLineSchema = z
  .object({
    version: z.number().int().min(1),
    categoryId: categoryIdSchema.optional(),
    amountEur: amountSchema.optional(),
    state: fundingPlanLineStateSchema.optional(),
    label: lineLabelSchema.optional(),
  })
  .strict()
  .refine(
    (v) =>
      v.categoryId !== undefined ||
      v.amountEur !== undefined ||
      v.state !== undefined ||
      v.label !== undefined,
    { message: 'Indiquez ce qui change sur la ligne.' },
  )

export const deleteFundingPlanLineQuerySchema = z
  .object({ version: z.coerce.number().int().min(1) })
  .strict()

// ── Aggregates ───────────────────────────────────────────────────────────────────────────────────

export interface FundingPlanTotals {
  // The request's amount sought; null while its owner has not stated it.
  objectiveEur: number | null
  obtainedEur: number
  requestedEur: number
  plannedEur: number
  refusedEur: number
  // What is not obtained yet: objective − obtained, never below 0; null without objective.
  remainingEur: number | null
  // What no source covers, even envisaged: objective − obtained − requested − planned, never below
  // 0; null without objective.
  uncoveredEur: number | null
  // Obtained beyond the objective (0 when not reached or without objective).
  beyondObjectiveEur: number
  // Obtained / objective, rounded down (100 only once reached); null without objective.
  obtainedPercent: number | null
}

// THE computation of a plan's totals, whole euros in, whole euros out (no rounding but the
// percentage, rounded down so that « 100 % » means reached).
export function fundingPlanTotals(
  objectiveEur: number | null,
  lines: ReadonlyArray<{ amountEur: number; state: string }>,
): FundingPlanTotals {
  const sum = (state: FundingPlanLineState) =>
    lines
      .filter((l) => fundingPlanLineStateOf(l.state) === state)
      .reduce((total, l) => total + l.amountEur, 0)
  const obtainedEur = sum('obtained')
  const requestedEur = sum('requested')
  const plannedEur = sum('planned')
  const objective = objectiveEur !== null && objectiveEur > 0 ? objectiveEur : null
  return {
    objectiveEur: objective,
    obtainedEur,
    requestedEur,
    plannedEur,
    refusedEur: sum('refused'),
    remainingEur: objective === null ? null : Math.max(0, objective - obtainedEur),
    uncoveredEur:
      objective === null ? null : Math.max(0, objective - obtainedEur - requestedEur - plannedEur),
    beyondObjectiveEur: objective === null ? 0 : Math.max(0, obtainedEur - objective),
    obtainedPercent: objective === null ? null : Math.floor((obtainedEur * 100) / objective),
  }
}

export type FundingPlanSegmentKind = 'obtained' | 'requested' | 'planned' | 'uncovered'

export const FUNDING_PLAN_SEGMENT_LABELS: Record<FundingPlanSegmentKind, string> = {
  obtained: 'Obtenu',
  requested: 'En cours',
  planned: 'Envisagé',
  uncovered: 'Sans source',
}

// The segmented bar: obtained, in progress, envisaged, then what no source covers, each as a share
// of the scale — the objective, or the sources identified when they exceed it (the objective is
// then marked at `objectiveAt`). Refused amounts are not drawn. Empty without objective nor line.
export function fundingPlanBar(totals: FundingPlanTotals): {
  segments: Array<{ kind: FundingPlanSegmentKind; amountEur: number; share: number }>
  objectiveAt: number | null
} {
  const identified = totals.obtainedEur + totals.requestedEur + totals.plannedEur
  const scale = Math.max(totals.objectiveEur ?? 0, identified)
  if (scale === 0) return { segments: [], objectiveAt: null }
  const parts: Array<[FundingPlanSegmentKind, number]> = [
    ['obtained', totals.obtainedEur],
    ['requested', totals.requestedEur],
    ['planned', totals.plannedEur],
    ['uncovered', totals.uncoveredEur ?? 0],
  ]
  return {
    segments: parts
      .filter(([, amountEur]) => amountEur > 0)
      .map(([kind, amountEur]) => ({ kind, amountEur, share: amountEur / scale })),
    objectiveAt:
      totals.objectiveEur !== null && scale > totals.objectiveEur
        ? totals.objectiveEur / scale
        : null,
  }
}

// ── Views ────────────────────────────────────────────────────────────────────────────────────────

const planCategorySchema = z.object({
  id: z.string().uuid(),
  key: z.string(),
  label: z.string(),
  family: fundingSourceFamilySchema,
  active: z.boolean(),
})

export const fundingPlanLineSchema = z.object({
  id: z.string().uuid(),
  category: planCategorySchema,
  label: z.string().nullable(),
  amountEur: z.number().int().positive(),
  state: fundingPlanLineStateSchema,
  version: z.number().int().min(1),
  updatedAt: z.string().datetime(),
  updatedBy: z.enum(FINANCING_STATUS_ACTORS),
})

export const fundingPlanTotalsSchema = z.object({
  objectiveEur: z.number().int().nullable(),
  obtainedEur: z.number().int(),
  requestedEur: z.number().int(),
  plannedEur: z.number().int(),
  refusedEur: z.number().int(),
  remainingEur: z.number().int().nullable(),
  uncoveredEur: z.number().int().nullable(),
  beyondObjectiveEur: z.number().int(),
  obtainedPercent: z.number().int().nullable(),
})

// A candidature's plan, as its owner and the workspace's conseillers read it: the lines in the
// order of the workspace's categories, the categories a new line may use (the active ones, in that
// order) and the totals.
export const fundingPlanSchema = z.object({
  candidatureId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  lines: z.array(fundingPlanLineSchema),
  categories: z.array(planCategorySchema),
  totals: fundingPlanTotalsSchema,
})

export type CreateFundingPlanLineInput = z.input<typeof createFundingPlanLineSchema>
export type UpdateFundingPlanLineInput = z.input<typeof updateFundingPlanLineSchema>
export type FundingPlanLine = z.infer<typeof fundingPlanLineSchema>
export type FundingPlan = z.infer<typeof fundingPlanSchema>
