import { z } from 'zod'
import { FINANCING_AMOUNT_MAX_EUR } from './financing.schema.js'
import { fundingSourceFamilySchema } from './funding-source.schema.js'
import { interestIdentitySchema } from './interest.schema.js'
import { FINANCING_STATUS_ACTORS, type FinancingStatusActor } from './status.schema.js'

// ROADMAP E06.03: the financing plan of a request in one workspace. It belongs to the candidature
// (one request × one workspace, E05.09/E06.01), like the financing status: its lines use the source
// categories of that workspace (E06.02), its owner and that workspace's conseillers keep it, and no
// other workspace, investor or share recipient reads it — but, once its owner consents to a public
// card (E09.02, showcase-card.schema.ts), its obtained, in progress and remaining totals. Its target is the request's amount sought
// (`dossiers.amount_eur`, E05.07) — the « objectif » of a plan is that amount, not the request's
// `objective` text, which states what the money is for.
//
// Each line is an amount for one source category, in one state below, with an optional detail
// (« BNP », « Bourse French Tech »…); a category may have several lines. The aggregates are computed
// here only (`fundingPlanTotals`), by the API for every read and by nothing else. The closed lists
// and limits are kept equal to the CHECK constraint of migration 20261119000000_funding_plans.
//
// Pledges (« promesses », E07.06) are not lines and never enter these totals: see E06.04 below.
//
// ── E06.04: pledges and validated financing ──────────────────────────────────────────────────────
//
//  * A pledge is an investor's non-binding intention; a line is financing the plan's parties state
//    (envisaged, in progress, obtained, refused). The plan shows the pledges apart, as « promis, non
//    engageant »: never in obtained, in progress, envisaged nor in the rest to finance.
//  * Which pledges a plan shows is THE rule of each side, unchanged (pledge.schema.ts,
//    position.schema.ts): its owner, the pledges of the investors who read the request now — all
//    counted in the total, known one by one only when the investor shows both name and amount —; the
//    structure, only the pledges of the investors who consented to show it their position and read
//    the request through its pool — nothing of the others, not even in a total. The same plan thus
//    shows each side its own figure; neither ever reads the other's.
//  * Confirming a pledge (`FUNDING_PLAN_PLEDGE_CONFIRMERS`: the owner only, by default — D03/D04 open,
//    see below) ties it to one line of the plan, in progress or obtained when confirmed
//    (`FUNDING_PLAN_PLEDGE_CONFIRMED_STATES`), at the pledge's revision the owner read. From then on
//    the plan counts that line and no longer the pledge: never both. At most one pledge per line and
//    one line per pledge in a plan; each plan (each structure) confirms on its own.
//  * Afterwards the line is the plan's like any other (either side changes or deletes it; deleted,
//    the pledge is promised again). If the investor changes their pledge (any change, hiding their
//    name or amount included, gives it a new revision), the confirmation no longer applies: the
//    pledge is promised again as it now is, the line stays, marked « changed » to whoever may read
//    that pledge, until the owner confirms it again or releases it. If the investor withdraws it,
//    the confirmation goes with it and the line stays. Nothing of a confirmation is told to the
//    investor, and a line tells a side which pledge it confirms only if that side reads the pledge.
//  * Why the owner only, and only a pledge showing name and amount: a confirmation removes the
//    pledge from the promised total; made on a pledge whose amount the owner cannot see — or by the
//    structure, whose disclosed pledges the owner may not see —, the owner's total would drop by an
//    amount hidden from them. Tying the confirmation to the revision keeps it so afterwards: a
//    pledge excluded from a total is always one the owner saw, as it was.

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

export type FundingPlanSegmentKind = 'obtained' | 'requested' | 'planned' | 'promised' | 'uncovered'

export const FUNDING_PLAN_SEGMENT_LABELS: Record<FundingPlanSegmentKind, string> = {
  obtained: 'Obtenu',
  requested: 'En cours',
  planned: 'Envisagé',
  promised: 'Promis, non engageant',
  uncovered: 'Sans source',
}

// The segmented bar: obtained, in progress, envisaged, then what no source covers, each as a share
// of the scale — the objective, or the sources identified when they exceed it (the objective is
// then marked at `objectiveAt`). Refused amounts are not drawn. Empty without objective nor line.
// `promisedEur` (E06.04, the pledges this side reads and no line confirms): drawn inside what no
// source covers, at most all of it — a non-binding share of the gap, never a source; the scale and
// the totals do not change.
export function fundingPlanBar(
  totals: FundingPlanTotals,
  promisedEur = 0,
): {
  segments: Array<{ kind: FundingPlanSegmentKind; amountEur: number; share: number }>
  objectiveAt: number | null
} {
  const identified = totals.obtainedEur + totals.requestedEur + totals.plannedEur
  const scale = Math.max(totals.objectiveEur ?? 0, identified)
  if (scale === 0) return { segments: [], objectiveAt: null }
  const uncovered = totals.uncoveredEur ?? 0
  const promised = Math.min(Math.max(0, promisedEur), uncovered)
  const parts: Array<[FundingPlanSegmentKind, number]> = [
    ['obtained', totals.obtainedEur],
    ['requested', totals.requestedEur],
    ['planned', totals.plannedEur],
    ['promised', promised],
    ['uncovered', uncovered - promised],
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

// A pledge as a side of the plan may know it one by one (E06.04): the investor's identity as that
// side reads it, the pledge's current amount, and — for the owner only, who may confirm it — its
// revision, sent back as read (`null` for the structure).
export const fundingPlanPledgeSchema = z.object({
  id: z.string().uuid(),
  identity: interestIdentitySchema,
  amountEur: z.number().int().min(1),
  version: z.number().int().min(1).nullable(),
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
  // E06.04: the pledge this line confirms, only if this side reads that pledge (`null` otherwise,
  // linked or not). `current: false` — the investor changed it since: it counts as promised again.
  pledge: fundingPlanPledgeSchema.extend({ current: z.boolean() }).nullable(),
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
// E06.04, apart from the totals: the pledges this side reads that no line of the plan confirms at
// their current revision — how many and their total (« promis, non engageant ») —, and those the
// owner may confirm (name and amount shown, held by no line of the plan; always empty for the
// structure), the largest first.
export const fundingPlanPledgesSchema = z.object({
  count: z.number().int().min(0),
  totalEur: z.number().int().min(0),
  confirmable: z.array(fundingPlanPledgeSchema),
})

export const fundingPlanSchema = z.object({
  candidatureId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  lines: z.array(fundingPlanLineSchema),
  categories: z.array(planCategorySchema),
  totals: fundingPlanTotalsSchema,
  pledges: fundingPlanPledgesSchema,
})

// ── E06.04: confirming a pledge (owner's routes only) ────────────────────────────────────────────

// Who may confirm a pledge in a plan. Kept to the owner (D03 « qui clôture les promesses » and D04
// « alimentation explicite par les promesses » still open): widening it to the structure needs a
// rule for the owner's total first (see above).
export const FUNDING_PLAN_PLEDGE_CONFIRMERS: readonly FundingPlanSide[] = ['owner']

// The states a line may have when it confirms a pledge: financing asked for or obtained, never
// merely envisaged (nor refused).
export const FUNDING_PLAN_PLEDGE_CONFIRMED_STATES = ['requested', 'obtained'] as const
export function confirmsPledge(state: FundingPlanLineState): boolean {
  return (FUNDING_PLAN_PLEDGE_CONFIRMED_STATES as readonly string[]).includes(state)
}

// The pledge confirmed and its revision as the owner read it (opaque, sent back as read — code
// review R63).
const pledgeRefSchema = z
  .object({
    id: z.string().uuid('Choisissez une promesse.'),
    version: z.number({ message: 'Indiquez la version de la promesse lue.' }).int().min(1),
  })
  .strict()

const NOT_CONFIRMING_STATE = {
  message: 'Une promesse se confirme par une source en cours ou obtenue.',
  path: ['state'],
}

// Owner's `POST …/funding-plan/lines`: a new line, which may confirm a pledge (`pledge`). The
// structure's route keeps `createFundingPlanLineSchema`, which refuses `pledge`.
export const createOwnerFundingPlanLineSchema = z
  .object({ ...createFundingPlanLineSchema.shape, pledge: pledgeRefSchema.optional() })
  .strict()
  .refine((v) => v.pledge === undefined || confirmsPledge(v.state), NOT_CONFIRMING_STATE)

// Owner's `PUT …/funding-plan/lines/:lineId/pledge`: this line, at the version the client saw,
// confirms this pledge at the revision read — confirmed again with its new revision once changed.
export const confirmFundingPlanPledgeSchema = z
  .object({ version: z.number().int().min(1), pledge: pledgeRefSchema })
  .strict()

export type CreateFundingPlanLineInput = z.input<typeof createFundingPlanLineSchema>
export type CreateOwnerFundingPlanLineInput = z.input<typeof createOwnerFundingPlanLineSchema>
export type ConfirmFundingPlanPledgeInput = z.input<typeof confirmFundingPlanPledgeSchema>
export type FundingPlanPledge = z.infer<typeof fundingPlanPledgeSchema>
export type FundingPlanPledges = z.infer<typeof fundingPlanPledgesSchema>
export type UpdateFundingPlanLineInput = z.input<typeof updateFundingPlanLineSchema>
export type FundingPlanLine = z.infer<typeof fundingPlanLineSchema>
export type FundingPlan = z.infer<typeof fundingPlanSchema>
