import { z } from 'zod'
import { FINANCING_STATUS_ACTORS, type FinancingStatusActor } from './status.schema.js'

// ROADMAP E06.05: schemes (« dispositifs » — JEIR, JEI, CIR and others) as declarative information
// and filters, NEVER a tax simulation: Confluent computes no benefit, no amount, no rate, and checks
// no condition. The roadmap's exclusions (« pas de simulateur fiscal ») stand.
//
// Each workspace keeps its own list of schemes (like its funding source categories, E06.02): a
// stable `key` fixed at creation, distinct from its `label`, an informative `description`, an order
// and an activation configured by its managers; deactivated, never deleted. A candidature (one
// request × one workspace, E05.09) records its eligibility to some of those schemes: declared by its
// owner or by the workspace, with an optional note, and marked verified by the workspace once it
// checked it. The workspace filters the candidatures it receives by scheme. Nobody else reads them:
// no other workspace, no investor, no share recipient, no MCP tool yet (E06.09).
//
// The default list, limits and closed values are kept equal to the backfill and CHECK constraints of
// migration 20261120000000_eligibilities.

// The schemes a workspace starts with (at its creation, and for the workspaces existing before
// E06.05 by the migration's backfill, which repeats them). JEIR, JEI and CIR are the ones the roadmap
// names; CII and IR-PME are the closest « others »: the innovation counterpart of the CIR, and the
// investors' income tax reduction the Moneyplace « JEIR (crédit d'impôt 50 %) » flag was about.
// Descriptions say what a scheme is, never what it yields.
export const DEFAULT_ELIGIBILITY_SCHEMES: ReadonlyArray<{
  key: string
  label: string
  description: string
}> = [
  {
    key: 'jeir',
    label: 'JEIR',
    description: 'Jeune entreprise innovante de rupture (statut fiscal de l’entreprise).',
  },
  {
    key: 'jei',
    label: 'JEI',
    description: 'Jeune entreprise innovante (statut fiscal de l’entreprise).',
  },
  {
    key: 'cir',
    label: 'CIR',
    description: 'Crédit d’impôt recherche, au titre des dépenses de recherche de l’entreprise.',
  },
  {
    key: 'cii',
    label: 'CII',
    description: 'Crédit d’impôt innovation, au titre des dépenses d’innovation d’une PME.',
  },
  {
    key: 'ir_pme',
    label: 'IR-PME',
    description:
      'Réduction d’impôt sur le revenu des personnes qui souscrivent au capital de la PME (dite « Madelin »).',
  },
]

export const ELIGIBILITY_SCHEME_LIMITS = {
  label: 80,
  key: 60,
  description: 300,
  perWorkspace: 30,
  note: 200,
} as const

// Lower-case ASCII words joined by single underscores, derived once from the first label.
export const ELIGIBILITY_SCHEME_KEY_PATTERN = /^[a-z0-9]+(?:_[a-z0-9]+)*$/

const oneLine = (v: string) => v.replace(/\s+/g, ' ').trim()

const labelSchema = z
  .string()
  .transform(oneLine)
  .pipe(
    z
      .string()
      .min(1, 'Le libellé est obligatoire.')
      .max(
        ELIGIBILITY_SCHEME_LIMITS.label,
        `Le libellé compte au plus ${ELIGIBILITY_SCHEME_LIMITS.label} caractères.`,
      ),
  )

// Plain text on one line; blank clears it.
const optionalText = (max: number, what: string) =>
  z
    .string()
    .transform(oneLine)
    .pipe(z.string().max(max, `${what} compte au plus ${max} caractères.`))
    .transform((v) => (v === '' ? null : v))
    .nullable()

const descriptionSchema = optionalText(ELIGIBILITY_SCHEME_LIMITS.description, 'La description')

// A scheme the workspace adds to its list; its key is derived from the label by the API.
export const createEligibilitySchemeSchema = z
  .object({ label: labelSchema, description: descriptionSchema.optional() })
  .strict()

// Only what is sent changes; the key never does.
export const updateEligibilitySchemeSchema = z
  .object({
    label: labelSchema.optional(),
    description: descriptionSchema.optional(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine((v) => v.label !== undefined || v.description !== undefined || v.active !== undefined, {
    message: 'Indiquez le libellé, la description ou l’activation à modifier.',
  })

// The whole list in its new order: every scheme of the workspace once, deactivated ones included.
export const reorderEligibilitySchemesSchema = z
  .object({
    schemeIds: z
      .array(z.string().uuid())
      .min(1)
      .max(ELIGIBILITY_SCHEME_LIMITS.perWorkspace)
      .refine((ids) => new Set(ids).size === ids.length, {
        message: 'Un dispositif apparaît deux fois dans le nouvel ordre.',
      }),
  })
  .strict()

export const eligibilitySchemeSchema = z.object({
  id: z.string().uuid(),
  key: z.string(),
  label: z.string(),
  description: z.string().nullable(),
  position: z.number().int().nonnegative(),
  active: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})

// ── A candidature's eligibilities ───────────────────────────────────────────────────────────────

// Who declared an eligibility, wrote it last or verified it: the owner of the request or the
// workspace — never who among its members (the journal keeps the author).
export type EligibilitySide = FinancingStatusActor
export function eligibilitySideOf(raw: string | null | undefined): EligibilitySide {
  return raw === 'owner' ? 'owner' : 'workspace'
}

const noteSchema = optionalText(ELIGIBILITY_SCHEME_LIMITS.note, 'La précision')
const schemeIdSchema = z.string().uuid('Choisissez un dispositif.')
const versionSchema = z.number().int().min(1)

// The owner declares an eligibility, with an optional note (« rescrit obtenu en 2025 »).
export const declareEligibilitySchema = z
  .object({ schemeId: schemeIdSchema, note: noteSchema.optional() })
  .strict()

// The workspace may also declare one, and mark it verified at once.
export const declareReceivedEligibilitySchema = declareEligibilitySchema
  .extend({ verified: z.boolean().optional() })
  .strict()

// `version`: the version the client saw; an eligibility changed meanwhile is refused (409) rather
// than overwritten. The owner changes the note only — which withdraws a verification, the workspace
// having checked what was declared before.
export const updateEligibilitySchema = z
  .object({ version: versionSchema, note: noteSchema })
  .strict()

// The workspace changes the note and/or verifies or withdraws its verification.
export const updateReceivedEligibilitySchema = z
  .object({ version: versionSchema, note: noteSchema.optional(), verified: z.boolean().optional() })
  .strict()
  .refine((v) => v.note !== undefined || v.verified !== undefined, {
    message: 'Indiquez la précision ou la vérification à modifier.',
  })

export const deleteEligibilityQuerySchema = z
  .object({ version: z.coerce.number().int().min(1) })
  .strict()

const eligibilitySchemeRefSchema = eligibilitySchemeSchema.pick({
  id: true,
  key: true,
  label: true,
  description: true,
  active: true,
})

export const candidatureEligibilitySchema = z.object({
  id: z.string().uuid(),
  scheme: eligibilitySchemeRefSchema,
  note: z.string().nullable(),
  declaredBy: z.enum(FINANCING_STATUS_ACTORS),
  declaredAt: z.string().datetime(),
  // Set once the workspace says it checked the eligibility; by the workspace, never by its owner.
  verifiedAt: z.string().datetime().nullable(),
  version: z.number().int().min(1),
  updatedAt: z.string().datetime(),
  updatedBy: z.enum(FINANCING_STATUS_ACTORS),
})

// A candidature's eligibilities, as its owner and the workspace's conseillers read them: in the
// order of the workspace's schemes, with the schemes a new declaration may use (the active ones not
// declared yet, in that order).
export const candidatureEligibilitiesSchema = z.object({
  candidatureId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  eligibilities: z.array(candidatureEligibilitySchema),
  schemes: z.array(eligibilitySchemeRefSchema),
})

// What the list of received candidatures says of each one's eligibilities.
export const eligibilityBadgeSchema = z.object({
  schemeId: z.string().uuid(),
  label: z.string(),
  verified: z.boolean(),
})

export type CreateEligibilitySchemeInput = z.input<typeof createEligibilitySchemeSchema>
export type UpdateEligibilitySchemeInput = z.input<typeof updateEligibilitySchemeSchema>
export type ReorderEligibilitySchemesInput = z.input<typeof reorderEligibilitySchemesSchema>
export type EligibilityScheme = z.infer<typeof eligibilitySchemeSchema>
export type DeclareEligibilityInput = z.input<typeof declareReceivedEligibilitySchema>
export type UpdateEligibilityInput = z.input<typeof updateReceivedEligibilitySchema>
export type CandidatureEligibility = z.infer<typeof candidatureEligibilitySchema>
export type CandidatureEligibilities = z.infer<typeof candidatureEligibilitiesSchema>
export type EligibilityBadge = z.infer<typeof eligibilityBadgeSchema>
