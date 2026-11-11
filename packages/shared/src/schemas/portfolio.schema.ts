import { z } from 'zod'
import {
  receivedCandidatureListItemSchema,
  receivedCandidaturesQuerySchema,
} from './candidature.schema.js'
import { supportPhaseSchema, supportProgressSchema } from './support-path.schema.js'

// ROADMAP E06.07: a workspace's portfolio — the candidatures it received, as its conseillers follow
// them by phase (`supportProgress`, support-path.schema.ts): counted per phase and per current step,
// filtered by phase, current step, financing status (E06.01) and eligibility (E06.05), a page at a
// time. Read by those who read the candidatures it receives (`canReviewCandidatures`), never by
// another workspace: the counts cover this workspace's sent candidatures only.

export const PORTFOLIO_PAGE_SIZE = 25

// The list's filters (scheme, verified, financingStatus), plus `phase`, `step` — the current step
// (an id unknown to the workspace matches nothing) — and `page` (from 1; past the last, no item).
export const portfolioQuerySchema = receivedCandidaturesQuerySchema
  .extend({
    phase: supportPhaseSchema.optional(),
    step: z.string().uuid('Étape inconnue.').optional(),
    page: z.coerce
      .number({ message: 'Page invalide.' })
      .int('Page invalide.')
      .min(1, 'Page invalide.')
      .max(10_000, 'Page invalide.')
      .optional(),
  })
  .strict()

export const portfolioItemSchema = receivedCandidatureListItemSchema.extend({
  progress: supportProgressSchema,
})

export const portfolioSchema = z.object({
  // Over the candidatures matching the financing status and eligibility filters, whatever their
  // phase and step: how many, how many per phase, and per current step — every active step of the
  // path, in its order, with the candidatures in preparation stopped at it.
  counts: z.object({
    total: z.number().int().min(0),
    phases: z.record(supportPhaseSchema, z.number().int().min(0)),
    steps: z.array(
      z.object({ stepId: z.string().uuid(), label: z.string(), count: z.number().int().min(0) }),
    ),
  }),
  // The candidatures matching every filter, the latest sent first: how many, and this page of them.
  total: z.number().int().min(0),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  items: z.array(portfolioItemSchema),
})

export type PortfolioQuery = z.input<typeof portfolioQuerySchema>
export type PortfolioItem = z.infer<typeof portfolioItemSchema>
export type Portfolio = z.infer<typeof portfolioSchema>
