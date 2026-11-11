import { z } from 'zod'
import { accessLevelSchema } from './access-level.schema.js'

// ROADMAP E07.02 — the publication of a financing request in a workspace's pool (« vivier »): the
// requests a structure presents to its investors (glossary: « Catalogue privé des projets publiés —
// opportunités du workspace après consentement du propriétaire »). This file is the only place where
// its rules are described; the API applies them under the request's lock, the site only offers what
// they allow, and E07.03 (the investors' opportunities) reads the pool through `poolPublicationState`.
//
//  * One publication per candidature — one request presented to one workspace (E05.09) —, so per
//    (request × workspace): publishing in one workspace's pool never touches another workspace's,
//    a nominative share (E07.01), the candidature itself or the request's own publication (D03).
//  * Only its owner publishes, by an explicit consent — a dedicated action naming the workspace and
//    the level, dated, journaled — never implied by publishing the request, presenting it to a
//    structure or anything else. Only its owner withdraws it; archiving the request withdraws every
//    one of its pool publications (a closed request is diffused no further, E06.01); unarchiving it
//    restores none: publishing again is a new consent.
//  * What the workspace's investors will read (E07.03): exactly what the recipient of a nominative
//    share at the same level reads — the request's presentation, the profile answers, classification
//    and selected documents that level may read — through the same projection (`recipientViewSchema`,
//    share-link.schema.ts), and nothing else: neither the candidature's answers to the workspace's
//    form, nor its financing plan, eligibilities, support path, financing status or internal notes,
//    nor the entrepreneur's contact details. Showing more (e.g. eligibilities verified by the
//    structure, for E07.03's filters) needs a new, explicit consent, never a widening of this one.

// What a publication requires, besides its owner: a candidature sent to the workspace (the structure
// knows and follows the request), the request published (D03: presented as ready) and its financing
// status in that workspace still open. `null`: nothing stands in the way.
export const POOL_PUBLICATION_BLOCKERS = [
  'candidature_not_sent',
  'request_archived',
  'request_not_published',
  'financing_closed',
] as const
export type PoolPublicationBlocker = (typeof POOL_PUBLICATION_BLOCKERS)[number]

export const POOL_PUBLICATION_BLOCKER_LABELS: Record<PoolPublicationBlocker, string> = {
  candidature_not_sent: 'Envoyez d’abord la candidature à la structure.',
  request_archived: 'Cette demande est archivée : désarchivez-la puis publiez-la d’abord.',
  request_not_published: 'Publiez d’abord la demande (onglet « Demande »).',
  financing_closed:
    'Le suivi de cette demande est clos dans cette structure (financée, refusée ou abandonnée).',
}

// Closed by default: the financing statuses under which a request may sit in a pool are listed;
// any other value, known or not, keeps it out.
const OPEN_FINANCING_STATUSES: ReadonlyArray<string> = ['preparing', 'in_committee']

export function poolPublicationBlocker(
  request: { publicationStatus: string | null | undefined },
  candidature: { submittedAt: Date | string | null; financingStatus: string | null | undefined },
): PoolPublicationBlocker | null {
  if (candidature.submittedAt === null) return 'candidature_not_sent'
  if (request.publicationStatus === 'archived') return 'request_archived'
  if (request.publicationStatus !== 'published') return 'request_not_published'
  if (!OPEN_FINANCING_STATUSES.includes(candidature.financingStatus ?? ''))
    return 'financing_closed'
  return null
}

// Why a publication was withdrawn: by its owner, or with the archiving of the request.
export const POOL_WITHDRAWAL_REASONS = ['owner', 'archived'] as const
export const poolWithdrawalReasonSchema = z.enum(POOL_WITHDRAWAL_REASONS)
export type PoolWithdrawalReason = z.infer<typeof poolWithdrawalReasonSchema>

// Where a publication stands: `listed` — the workspace's investors will read it (E07.03); `paused` —
// consented, but hidden while the request is not published or its financing status is closed, back
// as soon as neither holds (its owner may withdraw it meanwhile); `withdrawn` — consent withdrawn.
export const POOL_PUBLICATION_STATES = ['listed', 'paused', 'withdrawn'] as const
export const poolPublicationStateSchema = z.enum(POOL_PUBLICATION_STATES)
export type PoolPublicationState = z.infer<typeof poolPublicationStateSchema>

export const POOL_PAUSE_REASONS = ['request_not_published', 'financing_closed'] as const
export const poolPauseReasonSchema = z.enum(POOL_PAUSE_REASONS)
export type PoolPauseReason = z.infer<typeof poolPauseReasonSchema>

export const POOL_PUBLICATION_STATE_LABELS: Record<PoolPublicationState, string> = {
  listed: 'Au vivier',
  paused: 'Au vivier, en pause',
  withdrawn: 'Retirée du vivier',
}

// THE rule of the pool: a publication is listed while it is not withdrawn, its candidature sent, its
// request published and its financing status open. E07.03 lists exactly these (in SQL: `withdrawn_at
// IS NULL`, `candidatures.submitted_at IS NOT NULL`, `financing_status IN ('preparing',
// 'in_committee')`, `dossiers.publication_status = 'published'`).
export function poolPublicationState(
  publication: { withdrawnAt: Date | string | null },
  request: { publicationStatus: string | null | undefined },
  candidature: { submittedAt: Date | string | null; financingStatus: string | null | undefined },
): { state: PoolPublicationState; pausedBecause: PoolPauseReason | null } {
  if (publication.withdrawnAt !== null) return { state: 'withdrawn', pausedBecause: null }
  const blocker = poolPublicationBlocker(request, candidature)
  if (blocker === null) return { state: 'listed', pausedBecause: null }
  return {
    state: 'paused',
    pausedBecause: blocker === 'financing_closed' ? 'financing_closed' : 'request_not_published',
  }
}

// Publishing (or republishing, or changing the level of) the request in the candidature's workspace
// pool: the level is chosen — none is assumed (as for a share, E07.01) — and the consent stated.
export const publishToPoolSchema = z
  .object({
    accessLevel: accessLevelSchema,
    consent: z.literal(true, {
      message: 'Cochez la case pour consentir à la publication dans le vivier.',
    }),
  })
  .strict()
export type PublishToPoolInput = z.infer<typeof publishToPoolSchema>

// A candidature's pool publication, as its owner and the workspace's conseillers read it; `null`
// on the candidature when the request was never published in that workspace's pool.
export const poolPublicationSchema = z.object({
  accessLevel: accessLevelSchema,
  state: poolPublicationStateSchema,
  pausedBecause: poolPauseReasonSchema.nullable(),
  // The latest consent: its first publication, a republication or a change of level.
  consentedAt: z.string().datetime(),
  withdrawnAt: z.string().datetime().nullable(),
  withdrawnBecause: poolWithdrawalReasonSchema.nullable(),
})
export type PoolPublication = z.infer<typeof poolPublicationSchema>
