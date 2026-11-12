import { z } from 'zod'

// ROADMAP E05.07: a financing dossier is one precise request of its company — a title (the dossier's
// name), a summary and a description, an objective, an amount, the types of financing sought, the
// documents of the library it selects and a publication status. A company can make several, each
// with its own presentation, selection and publication. Same rules for the site (immediate
// feedback) and the API (authoritative); the closed lists are also CHECK constraints (migration
// 20261113000000_financing_requests).

export const DOSSIER_PRESENTATION_LIMITS = {
  name: 200,
  summary: 300,
  objective: 1000,
  description: 5000,
} as const

// Whole euros: a request states an order of magnitude, never cents.
export const FINANCING_AMOUNT_MAX_EUR = 1_000_000_000

// Types of financing a request seeks (several allowed), a closed list kept equal to the
// `dossiers_financing_types_check` constraint. They describe the request; they grant no access.
export const FINANCING_TYPES = [
  'equity',
  'convertible',
  'bank_loan',
  'honor_loan',
  'public_funding',
  'grant',
  'crowdfunding',
  'other',
] as const

export const financingTypeSchema = z.enum(FINANCING_TYPES)
export type FinancingType = z.infer<typeof financingTypeSchema>

export const FINANCING_TYPE_LABELS: Record<FinancingType, string> = {
  equity: 'Levée de fonds en capital',
  convertible: 'Obligations convertibles, BSA AIR',
  bank_loan: 'Prêt bancaire',
  honor_loan: 'Prêt d’honneur',
  public_funding: 'Prêt ou avance remboursable public',
  grant: 'Subvention',
  crowdfunding: 'Financement participatif',
  other: 'Autre financement',
}

// Known types only, without duplicates, in the order of FINANCING_TYPES; unknown values are dropped
// (closed by default).
export function financingTypesOf(raw: ReadonlyArray<string> | null | undefined): FinancingType[] {
  const known = new Set(raw ?? [])
  return FINANCING_TYPES.filter((t) => known.has(t))
}

// Publication (D03): `draft` while the request is being prepared, `published` once its owner
// declares it ready, `archived` once closed — its statuses and transitions are in status.schema.ts
// (E06.01). Distinct from the submission, which checks the company profile and classifies the
// dossier. While not published, the recipients of the dossier's shares do not see its presentation;
// once published they do, and the request becomes eligible for the diffusions to come (workspace pool
// E07.02, showcase E09). Publication never opens nor closes a share.

// What a request needs before it can be published, and while it stays published.
export const PUBLICATION_REQUIREMENTS = [
  'summary',
  'objective',
  'amountEur',
  'financingTypes',
  'submitted',
] as const
export type PublicationRequirement = (typeof PUBLICATION_REQUIREMENTS)[number]

export const PUBLICATION_REQUIREMENT_LABELS: Record<PublicationRequirement, string> = {
  summary: 'Le résumé de la demande',
  objective: 'L’objectif du financement',
  amountEur: 'Le montant recherché',
  financingTypes: 'Au moins un type de financement',
  submitted: 'Le profil de l’entreprise soumis pour ce dossier',
}

export function missingForPublication(dossier: {
  summary: string | null
  objective: string | null
  amountEur: number | null
  financingTypes: ReadonlyArray<string>
  submittedAt: string | Date | null
}): PublicationRequirement[] {
  const missing: PublicationRequirement[] = []
  if (!dossier.summary?.trim()) missing.push('summary')
  if (!dossier.objective?.trim()) missing.push('objective')
  if (dossier.amountEur === null || dossier.amountEur <= 0) missing.push('amountEur')
  if (financingTypesOf(dossier.financingTypes).length === 0) missing.push('financingTypes')
  if (!dossier.submittedAt) missing.push('submitted')
  return missing
}

// Plain text, line breaks kept, never interpreted as HTML or Markdown wherever it is shown. Tags are
// refused so that nobody types HTML believing it will be rendered. Blank clears the value (null).
const HTML_TAG = /<\/?[a-z!][^>]*>/i
function plainTextSchema(label: string, max: number) {
  return z
    .string()
    .transform((v) => v.replace(/\r\n?/g, '\n').trim())
    .pipe(
      z
        .string()
        .max(max, `${label} compte au plus ${max} caractères.`)
        .refine((v) => !HTML_TAG.test(v), {
          message: `${label} est un texte simple : les balises HTML ne sont pas acceptées.`,
        }),
    )
    .transform((v) => (v === '' ? null : v))
    .nullable()
}

export const dossierNameSchema = z
  .string()
  .trim()
  .min(1, 'Le titre est obligatoire.')
  .max(
    DOSSIER_PRESENTATION_LIMITS.name,
    `Le titre compte au plus ${DOSSIER_PRESENTATION_LIMITS.name} caractères.`,
  )

// The presentation of a request, each part optional on update (null clears it).
export const dossierPresentationShape = {
  summary: plainTextSchema('Le résumé', DOSSIER_PRESENTATION_LIMITS.summary).optional(),
  objective: plainTextSchema('L’objectif', DOSSIER_PRESENTATION_LIMITS.objective).optional(),
  description: plainTextSchema(
    'La description',
    DOSSIER_PRESENTATION_LIMITS.description,
  ).optional(),
  amountEur: z
    .number()
    .int('Le montant s’indique en euros, sans centimes.')
    .min(1, 'Le montant est d’au moins 1 €.')
    .max(FINANCING_AMOUNT_MAX_EUR, 'Le montant dépasse le maximum accepté (1 milliard d’euros).')
    .nullable()
    .optional(),
  financingTypes: z
    .array(financingTypeSchema)
    .max(FINANCING_TYPES.length)
    .refine((v) => new Set(v).size === v.length, {
      message: 'Un type de financement n’est indiqué qu’une fois.',
    })
    .optional(),
}
