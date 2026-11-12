import { z } from 'zod'
import { accessLevelSchema } from './access-level.schema.js'
import { FINANCING_AMOUNT_MAX_EUR, financingTypeSchema } from './financing.schema.js'
import { interestIdentitySchema, opportunityInterestSchema } from './interest.schema.js'
import { opportunityPledgeSchema } from './pledge.schema.js'
import { recipientViewSchema } from './share-link.schema.js'

// ROADMAP E07.03 — an investor's opportunities (« inbox »): the financing requests they may read,
// whichever way each reaches them —
//  * a direct share: an active nominative share sent to their address (E07.01);
//  * a pool: a publication listed in the pool of a workspace where they are an active investor
//    (E07.02, `poolPublicationState` in pool-publication.schema.ts) — never a pool of a workspace
//    where they are not, nor a publication withdrawn or paused.
// One opportunity per request, whatever the number of ways: it lists each of them (`sources`) and is
// read at the widest of their levels — each one alone already lets its reader see that much, the
// levels being nested (`grantsAccess`).
//
// What an opportunity shows is THE projection of a nominative share at that level
// (`recipientViewSchema`), nothing else: neither the candidature's answers to a structure's form,
// nor its financing plan, eligibilities, support path, financing status or internal notes. So the
// filters only bear on what that projection shows (a filter on hidden data would reveal it):
// sector (classification), amount and financing types (the request's presentation, once
// published), and a search in its title and summary. Neither eligibilities (E06.05) — no consent
// covers showing them to investors — nor committees (E08) are offered.

export const OPPORTUNITY_PAGE_SIZE = 20

export const OPPORTUNITY_SORTS = ['recent', 'amount_desc', 'amount_asc', 'name'] as const
export const opportunitySortSchema = z.enum(OPPORTUNITY_SORTS, { message: 'Tri inconnu.' })
export type OpportunitySort = z.infer<typeof opportunitySortSchema>

export const OPPORTUNITY_SORT_LABELS: Record<OpportunitySort, string> = {
  recent: 'Les plus récentes',
  amount_desc: 'Montant décroissant',
  amount_asc: 'Montant croissant',
  name: 'Nom (A → Z)',
}

// How an opportunity reaches its reader.
export const OPPORTUNITY_SOURCE_KINDS = ['share', 'pool'] as const
export const opportunitySourceKindSchema = z.enum(OPPORTUNITY_SOURCE_KINDS, {
  message: 'Provenance inconnue.',
})
export type OpportunitySourceKind = z.infer<typeof opportunitySourceKindSchema>

export const OPPORTUNITY_LIMITS = { search: 100, sector: 200 } as const

const amount = (message: string) =>
  z.coerce
    .number({ message })
    .int(message)
    .min(0, message)
    .max(FINANCING_AMOUNT_MAX_EUR, message)
    .optional()

// The list's query, every parameter optional: `q` searches the title and the summary (accents and
// case ignored), `sector` is one of the sectors the list offers, `amountMin`/`amountMax` bound the
// amount sought (a request without a shown amount matches no bound), `financingType` is one type the
// request seeks, `source` keeps the direct shares or the pools, `workspace` one workspace's pool (a
// workspace the reader is no investor of matches nothing), `page` from 1 (past the last, no item).
export const opportunitiesQuerySchema = z
  .object({
    q: z
      .string()
      .trim()
      .max(OPPORTUNITY_LIMITS.search, 'Recherche trop longue.')
      .optional()
      .transform((v) => (v ? v : undefined)),
    sector: z
      .string()
      .trim()
      .max(OPPORTUNITY_LIMITS.sector, 'Secteur inconnu.')
      .optional()
      .transform((v) => (v ? v : undefined)),
    amountMin: amount('Montant minimum invalide.'),
    amountMax: amount('Montant maximum invalide.'),
    financingType: financingTypeSchema.optional(),
    source: opportunitySourceKindSchema.optional(),
    workspace: z.string().uuid('Structure inconnue.').optional(),
    sort: opportunitySortSchema.optional(),
    page: z.coerce
      .number({ message: 'Page invalide.' })
      .int('Page invalide.')
      .min(1, 'Page invalide.')
      .max(10_000, 'Page invalide.')
      .optional(),
  })
  .strict()
  .refine(
    (q) => q.amountMin === undefined || q.amountMax === undefined || q.amountMin <= q.amountMax,
    {
      message: 'Le montant minimum dépasse le montant maximum.',
      path: ['amountMax'],
    },
  )

// One way an opportunity reaches its reader, with the level it alone grants and since when: the
// share's creation, or the latest consent of the pool publication.
export const opportunitySourceSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('share'),
    accessLevel: accessLevelSchema,
    since: z.string().datetime(),
  }),
  z.object({
    kind: z.literal('pool'),
    accessLevel: accessLevelSchema,
    since: z.string().datetime(),
    workspace: z.object({ id: z.string().uuid(), name: z.string() }),
  }),
])
export type OpportunitySource = z.infer<typeof opportunitySourceSchema>

// What an opportunity reads at: the widest level of its sources, and each of them (direct share
// first, then the pools by workspace name).
export const opportunityAccessSchema = z.object({
  accessLevel: accessLevelSchema,
  sources: z.array(opportunitySourceSchema).min(1),
  // The latest of its sources' dates.
  receivedAt: z.string().datetime(),
  // The reader's own mark of interest (E07.05, interest.schema.ts), `null` without one.
  interest: opportunityInterestSchema.nullable(),
  // The reader's own pledge (E07.06, pledge.schema.ts), `null` without one.
  pledge: opportunityPledgeSchema.nullable(),
})
export type OpportunityAccess = z.infer<typeof opportunityAccessSchema>

// A line of the list: a part of the opportunity's projection (`recipientViewSchema`), at its level.
export const opportunityListItemSchema = opportunityAccessSchema.extend({
  dossier: recipientViewSchema.shape.dossier.pick({
    id: true,
    name: true,
    sector: true,
    maturityStage: true,
    tagTechnologique: true,
    summary: true,
    amountEur: true,
    financingTypes: true,
    publicationStatus: true,
  }),
})
export type OpportunityListItem = z.infer<typeof opportunityListItemSchema>

const facet = <T extends z.ZodTypeAny>(value: T) =>
  z.array(z.object({ value, count: z.number().int().min(1) }))

export const opportunitiesSchema = z.object({
  // Over every opportunity of the reader, whatever the filters: how many, how many reach them by a
  // direct share, by each workspace's pool (the workspaces where they are an active investor, even
  // without opportunity), and the sectors and financing types their projections show — the values
  // the filters offer.
  counts: z.object({
    total: z.number().int().min(0),
    shares: z.number().int().min(0),
    pools: z.array(
      z.object({
        workspace: z.object({ id: z.string().uuid(), name: z.string() }),
        count: z.number().int().min(0),
      }),
    ),
    sectors: facet(z.string()),
    financingTypes: facet(financingTypeSchema),
  }),
  // The opportunities matching every filter, in the order asked: how many, and this page of them.
  total: z.number().int().min(0),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  items: z.array(opportunityListItemSchema),
})

// An opportunity: the projection of a nominative share at its level (`recipientViewSchema`) and how
// it reaches its reader, with who the owner would see should the reader show their name on their mark
// of interest (E07.05) or their pledge (E07.06). Reading it is journaled once (`opportunity_viewed`).
export const opportunitySchema = recipientViewSchema.extend({
  opportunity: opportunityAccessSchema.extend({ shownAs: interestIdentitySchema }),
})

export type OpportunitiesQuery = z.input<typeof opportunitiesQuerySchema>
export type Opportunities = z.infer<typeof opportunitiesSchema>
export type Opportunity = z.infer<typeof opportunitySchema>
