import { z } from 'zod'

// ROADMAP E06.02, decision D04 « Sources du plan et promesses » — STILL TO BE CONFIRMED by the
// product owner. Each workspace keeps its own list of the categories a financing plan is split
// into (E06.03 enters an amount and a state per source; E06.04 feeds them from the promises). The
// list a new workspace starts from is D04's proposal below: no list validated from Moneyplace is
// available (the archived scoping only mentions « the 5 Moneyplace sources » without naming them,
// then proposes these six, private money split in two). Adjusting D04 = changing
// DEFAULT_FUNDING_SOURCE_CATEGORIES for new workspaces; existing workspaces keep their own list,
// which their managers configure.
//
// A category has a stable `key` (what later tasks reference, never changed) distinct from its
// `label` (renamed at will), and a `family` from the closed list below, also fixed: the nature of
// the money, common to every workspace, which tells business angels / love money apart from
// investment funds whatever a workspace calls them — and which lets a promise (E06.04) find the
// line matching its investor's type. Categories are deactivated, never deleted, so that a plan
// entered against one keeps it after a rename or a deactivation. The closed lists and limits are
// kept equal to the CHECK constraints of migration 20261118000000_funding_source_categories.

export const FUNDING_SOURCE_FAMILIES = [
  'aides_publiques',
  'pret_honneur',
  'pret_bancaire',
  'business_angels_love_money',
  'fonds_investissement',
  'fonds_propres',
  'autre',
] as const
export const fundingSourceFamilySchema = z.enum(FUNDING_SOURCE_FAMILIES, {
  message: 'Choisissez la nature de la source.',
})
export type FundingSourceFamily = z.infer<typeof fundingSourceFamilySchema>

export const FUNDING_SOURCE_FAMILY_LABELS: Record<FundingSourceFamily, string> = {
  aides_publiques: 'Aides publiques (Bpifrance, collectivités…)',
  pret_honneur: 'Prêt d’honneur',
  pret_bancaire: 'Prêt bancaire',
  business_angels_love_money: 'Business angels / love money',
  fonds_investissement: 'Fonds d’investissement',
  fonds_propres: 'Fonds propres',
  autre: 'Autre',
}

// Closed by default: an unknown value is read as `autre`, which no promise feeds automatically.
export function fundingSourceFamilyOf(raw: string | null | undefined): FundingSourceFamily {
  return (FUNDING_SOURCE_FAMILIES as readonly string[]).includes(raw ?? '')
    ? (raw as FundingSourceFamily)
    : 'autre'
}

// D04's proposal, in its order: the categories every workspace starts with (at its creation, and
// for the workspaces existing before E06.02 by the migration's backfill, which repeats them).
export const DEFAULT_FUNDING_SOURCE_CATEGORIES: ReadonlyArray<{
  key: string
  label: string
  family: FundingSourceFamily
}> = [
  { key: 'bpifrance', label: 'Bpifrance', family: 'aides_publiques' },
  { key: 'pret_honneur', label: 'Prêt d’honneur', family: 'pret_honneur' },
  { key: 'pret_bancaire', label: 'Prêt bancaire', family: 'pret_bancaire' },
  {
    key: 'business_angels_love_money',
    label: 'Business angels / love money',
    family: 'business_angels_love_money',
  },
  { key: 'fonds_investissement', label: 'Fonds d’investissement', family: 'fonds_investissement' },
  { key: 'fonds_propres', label: 'Fonds propres', family: 'fonds_propres' },
]

export const FUNDING_SOURCE_CATEGORY_LIMITS = { label: 80, key: 60, perWorkspace: 30 } as const

// Lower-case ASCII words joined by single underscores, derived once from the first label.
export const FUNDING_SOURCE_CATEGORY_KEY_PATTERN = /^[a-z0-9]+(?:_[a-z0-9]+)*$/

// One line of plain text; compared without regard to case within a workspace.
const labelSchema = z
  .string()
  .transform((v) => v.replace(/\s+/g, ' ').trim())
  .pipe(
    z
      .string()
      .min(1, 'Le libellé est obligatoire.')
      .max(
        FUNDING_SOURCE_CATEGORY_LIMITS.label,
        `Le libellé compte au plus ${FUNDING_SOURCE_CATEGORY_LIMITS.label} caractères.`,
      ),
  )

// A category the workspace adds to its list; its key is derived from the label by the API.
export const createFundingSourceCategorySchema = z
  .object({ label: labelSchema, family: fundingSourceFamilySchema })
  .strict()

// Only what is sent changes; key and family never do.
export const updateFundingSourceCategorySchema = z
  .object({ label: labelSchema.optional(), active: z.boolean().optional() })
  .strict()
  .refine((v) => v.label !== undefined || v.active !== undefined, {
    message: 'Indiquez le libellé ou l’activation à modifier.',
  })

// The whole list in its new order: every category of the workspace once, deactivated ones included.
export const reorderFundingSourceCategoriesSchema = z
  .object({
    categoryIds: z
      .array(z.string().uuid())
      .min(1)
      .max(FUNDING_SOURCE_CATEGORY_LIMITS.perWorkspace)
      .refine((ids) => new Set(ids).size === ids.length, {
        message: 'Une source apparaît deux fois dans le nouvel ordre.',
      }),
  })
  .strict()

export const fundingSourceCategorySchema = z.object({
  id: z.string().uuid(),
  key: z.string(),
  label: z.string(),
  family: fundingSourceFamilySchema,
  position: z.number().int().nonnegative(),
  active: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})

export type CreateFundingSourceCategoryInput = z.input<typeof createFundingSourceCategorySchema>
export type UpdateFundingSourceCategoryInput = z.input<typeof updateFundingSourceCategorySchema>
export type ReorderFundingSourceCategoriesInput = z.input<
  typeof reorderFundingSourceCategoriesSchema
>
export type FundingSourceCategory = z.infer<typeof fundingSourceCategorySchema>
