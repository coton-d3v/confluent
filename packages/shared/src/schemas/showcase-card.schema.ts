import { z } from 'zod'
import { committeeOpenToCandidates } from './committee-application.schema.js'
import { publicCommitteeSchema } from './participation-request.schema.js'
import {
  POOL_PUBLICATION_BLOCKERS,
  poolPublicationBlocker,
  type PoolPublicationBlocker,
} from './pool-publication.schema.js'
import { HTML_TAG } from './support-path.schema.js'

// ROADMAP E09.02 — the anonymous cards of financing requests on a workspace's public page (`/w/<slug>`,
// E09.01). This file is the only place where their rules are described; the API applies them under
// the request's lock and builds every card through one projection (`toPublicCard`), the site only
// offers what they allow. D05/D06 are not confirmed: where they are silent, the most restrictive
// reading is applied.
//
//  * A card exists only by an explicit consent of the request's owner, given for one candidature —
//    one request presented to one workspace (E05.09) — through a dedicated action naming the
//    pseudonym, dated, journaled, revocable. Never implied by publishing the request, presenting it,
//    publishing it in the workspace's pool (E07.02) or sharing it (a nominative `public` share is
//    never a public card, E07.04). Only its owner gives or withdraws it; archiving the request
//    withdraws it (unarchiving restores nothing: a new consent is needed).
//  * A pseudonym chosen by the owner, required: a request without one is never shown, and no real
//    name stands in for it (D06). It may not be the company's name nor the request's title (whole
//    value, case, accents and punctuation ignored), nor carry an address, a link or markup.
//  * Shown while the workspace's page is published (E09.01) and the same conditions as the pool hold
//    (`poolPublicationBlocker`): the candidature sent, the request published (not archived) and its
//    financing status open in that workspace. Otherwise the card is paused — consented, hidden —,
//    back as soon as none holds; withdrawn, it is gone at the next public read.
//  * What the public reads (`PUBLIC_CARD_FIELDS`, nothing else): the pseudonym; the sector (the
//    request's classification as the narrowest share level reads it — the same rule, R31: shown only
//    if every field it comes from is readable at `public`); the region the owner chose, if any
//    (`SHOWCASE_REGIONS`: never a town, department or address); the amount sought; the financing
//    plan of that candidature in aggregate — obtained, in progress, remaining to finance — never its
//    lines, sources, categories, details, nor any pledge (not even a total, E06.04); and its
//    committee: « Prochain comité » with the session's name and time (`toPublicCommittee`) once the
//    request is retained for a planned session not started yet, « En attente de comité » otherwise —
//    an application pending, refused or withdrawn is never told apart from none.
//  * Never: the request's title, presentation, answers or documents, the company's name, the owner's
//    or any member's identity or contact, the candidature's answers, eligibilities, support path,
//    financing status or internal notes, investors or their interest, the committee's place, link,
//    shared information or notes, any identifier of the request, its candidature or its company.

export const SHOWCASE_CARD_LIMITS = {
  pseudonym: { min: 2, max: 60 },
  // Cards on one page, the latest consents first.
  cardsPerPage: 50,
} as const

// The regions of France (2016), and its overseas regions: the finest location a card shows.
export const SHOWCASE_REGIONS = [
  'auvergne-rhone-alpes',
  'bourgogne-franche-comte',
  'bretagne',
  'centre-val-de-loire',
  'corse',
  'grand-est',
  'hauts-de-france',
  'ile-de-france',
  'normandie',
  'nouvelle-aquitaine',
  'occitanie',
  'pays-de-la-loire',
  'provence-alpes-cote-d-azur',
  'guadeloupe',
  'guyane',
  'la-reunion',
  'martinique',
  'mayotte',
] as const
export const showcaseRegionSchema = z.enum(SHOWCASE_REGIONS, {
  message: 'Choisissez une région de la liste.',
})
export type ShowcaseRegion = z.infer<typeof showcaseRegionSchema>

export const SHOWCASE_REGION_LABELS: Record<ShowcaseRegion, string> = {
  'auvergne-rhone-alpes': 'Auvergne-Rhône-Alpes',
  'bourgogne-franche-comte': 'Bourgogne-Franche-Comté',
  bretagne: 'Bretagne',
  'centre-val-de-loire': 'Centre-Val de Loire',
  corse: 'Corse',
  'grand-est': 'Grand Est',
  'hauts-de-france': 'Hauts-de-France',
  'ile-de-france': 'Île-de-France',
  normandie: 'Normandie',
  'nouvelle-aquitaine': 'Nouvelle-Aquitaine',
  occitanie: 'Occitanie',
  'pays-de-la-loire': 'Pays de la Loire',
  'provence-alpes-cote-d-azur': 'Provence-Alpes-Côte d’Azur',
  guadeloupe: 'Guadeloupe',
  guyane: 'Guyane',
  'la-reunion': 'La Réunion',
  martinique: 'Martinique',
  mayotte: 'Mayotte',
}

// Closed by default: an unknown stored value shows no region.
export function showcaseRegionOf(raw: string | null | undefined): ShowcaseRegion | null {
  const parsed = showcaseRegionSchema.safeParse(raw)
  return parsed.success ? parsed.data : null
}

// What a pseudonym may not carry: an address or a link (contact details are never on a card).
const CONTACT_LIKE = /@|:\/\/|www\./i

// One line: control characters dropped, spaces collapsed, trimmed.
// eslint-disable-next-line no-control-regex
const oneLine = (v: string) =>
  v
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

export const pseudonymSchema = z
  .string({ message: 'Choisissez un pseudonyme.' })
  .transform(oneLine)
  .pipe(
    z
      .string()
      .min(1, 'Choisissez un pseudonyme.')
      // Counted in characters, as the database counts them (an emoji is one).
      .refine((v) => [...v].length >= SHOWCASE_CARD_LIMITS.pseudonym.min, {
        message: `Le pseudonyme compte au moins ${SHOWCASE_CARD_LIMITS.pseudonym.min} caractères.`,
      })
      .refine((v) => [...v].length <= SHOWCASE_CARD_LIMITS.pseudonym.max, {
        message: `Le pseudonyme compte au plus ${SHOWCASE_CARD_LIMITS.pseudonym.max} caractères.`,
      })
      .refine((v) => !HTML_TAG.test(v), {
        message: 'Le pseudonyme est un texte simple : les balises HTML ne sont pas acceptées.',
      })
      .refine((v) => !CONTACT_LIKE.test(v), {
        message: 'Le pseudonyme ne contient ni adresse email ni lien.',
      }),
  )

// A name compared as a whole (R64): case, accents, punctuation and spacing ignored — « Biosensio
// S.A.S. » is « biosensio sas ».
export function comparableName(v: string): string {
  return v
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '')
}

// Whether a pseudonym is one of the real names it hides (the company's, the request's title).
export function pseudonymRevealsName(
  pseudonym: string,
  names: ReadonlyArray<string | null | undefined>,
): boolean {
  const p = comparableName(pseudonym)
  return names.some((name) => name != null && comparableName(name) === p)
}

// Giving (or giving again, or changing the pseudonym or region of) the consent, from the version of
// the card the client read (`null`: it saw none). A card changed meanwhile is refused (409), never
// overwritten. No region is assumed: `null` shows none.
export const setShowcaseCardSchema = z
  .object({
    pseudonym: pseudonymSchema,
    region: showcaseRegionSchema.nullable(),
    consent: z.literal(true, {
      message: 'Cochez la case pour consentir à l’affichage de la carte sur la page publique.',
    }),
    version: z.number().int().min(1).nullable(),
  })
  .strict()
export type SetShowcaseCardInput = z.input<typeof setShowcaseCardSchema>

// ── Where a card stands ───────────────────────────────────────────────────────────────────────────

// What stands in the way of giving the consent: the conditions of the pool (E07.02), word for word.
export const SHOWCASE_CARD_BLOCKERS = POOL_PUBLICATION_BLOCKERS
export type ShowcaseCardBlocker = PoolPublicationBlocker
export const showcaseCardBlocker = poolPublicationBlocker

export const SHOWCASE_WITHDRAWAL_REASONS = ['owner', 'archived'] as const
export const showcaseWithdrawalReasonSchema = z.enum(SHOWCASE_WITHDRAWAL_REASONS)
export type ShowcaseWithdrawalReason = z.infer<typeof showcaseWithdrawalReasonSchema>

// `shown`: on the public page; `paused`: consented, hidden while a condition does not hold;
// `withdrawn`: consent withdrawn.
export const SHOWCASE_CARD_STATES = ['shown', 'paused', 'withdrawn'] as const
export const showcaseCardStateSchema = z.enum(SHOWCASE_CARD_STATES)
export type ShowcaseCardState = z.infer<typeof showcaseCardStateSchema>

export const SHOWCASE_PAUSE_REASONS = [
  'page_not_published',
  'request_not_published',
  'financing_closed',
] as const
export const showcasePauseReasonSchema = z.enum(SHOWCASE_PAUSE_REASONS)
export type ShowcasePauseReason = z.infer<typeof showcasePauseReasonSchema>

export const SHOWCASE_CARD_STATE_LABELS: Record<ShowcaseCardState, string> = {
  shown: 'Carte affichée',
  paused: 'Carte en pause',
  withdrawn: 'Carte retirée',
}

export const SHOWCASE_PAUSE_REASON_LABELS: Record<ShowcasePauseReason, string> = {
  page_not_published:
    'La page publique de la structure n’est pas publiée : la carte apparaîtra dès sa publication.',
  request_not_published:
    'La demande n’est plus publiée : la carte réapparaîtra dès sa nouvelle publication.',
  financing_closed:
    'Le suivi de cette demande est clos dans cette structure (financée, refusée ou abandonnée).',
}

// THE rule of the public cards: shown while the consent is not withdrawn, a pseudonym is set, the
// workspace's page is published and the pool's conditions hold.
export function showcaseCardState(
  card: { withdrawnAt: Date | string | null; pseudonym: string | null | undefined },
  request: { publicationStatus: string | null | undefined },
  candidature: { submittedAt: Date | string | null; financingStatus: string | null | undefined },
  page: { publicPagePublished: boolean },
): { state: ShowcaseCardState; pausedBecause: ShowcasePauseReason | null } {
  // Without a pseudonym there is nothing to show under (the database refuses one anyway).
  if (card.withdrawnAt !== null || !card.pseudonym?.trim()) {
    return { state: 'withdrawn', pausedBecause: null }
  }
  const blocker = showcaseCardBlocker(request, candidature)
  if (blocker !== null) {
    return {
      state: 'paused',
      pausedBecause: blocker === 'financing_closed' ? 'financing_closed' : 'request_not_published',
    }
  }
  if (page.publicPagePublished !== true) {
    return { state: 'paused', pausedBecause: 'page_not_published' }
  }
  return { state: 'shown', pausedBecause: null }
}

// ── Committee ─────────────────────────────────────────────────────────────────────────────────────

export const SHOWCASE_COMMITTEE_STATES = ['scheduled', 'awaiting'] as const
export type ShowcaseCommitteeState = (typeof SHOWCASE_COMMITTEE_STATES)[number]
export const SHOWCASE_COMMITTEE_LABELS: Record<ShowcaseCommitteeState, string> = {
  scheduled: 'Prochain comité',
  awaiting: 'En attente de comité',
}

// The committee a card names: the soonest session that retained the request (both sides agreed,
// E08.03) and is planned and not started. Anything else — no entry, an application or a proposal
// pending, a refusal, a withdrawal, a session held or cancelled — reads « en attente de comité ».
export function showcaseCommitteeOf<C extends { status: string; startsAt: string | Date }>(
  entries: ReadonlyArray<{ status: string; committee: C }>,
  now: number,
): C | null {
  const retained = entries
    .filter((e) => e.status === 'accepted' && committeeOpenToCandidates(e.committee, now))
    .map((e) => e.committee)
    .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime())
  return retained[0] ?? null
}

// ── Views ─────────────────────────────────────────────────────────────────────────────────────────

// What the public reads of a card — a closed list, copied field by field by the API.
export const PUBLIC_CARD_FIELDS = [
  'pseudonym',
  'sector',
  'region',
  'amountEur',
  'fundingPlan',
  'committee',
] as const

export const publicCardFundingPlanSchema = z
  .object({
    obtainedEur: z.number().int().min(0),
    requestedEur: z.number().int().min(0),
    // Amount sought − obtained, never below 0; null without an amount sought.
    remainingEur: z.number().int().min(0).nullable(),
  })
  .strict()

export const publicCardCommitteeSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('scheduled'), session: publicCommitteeSchema }).strict(),
  z.object({ state: z.literal('awaiting') }).strict(),
])

export const publicCardSchema = z
  .object({
    pseudonym: z.string(),
    sector: z.string().nullable(),
    region: showcaseRegionSchema.nullable(),
    amountEur: z.number().int().nullable(),
    fundingPlan: publicCardFundingPlanSchema,
    committee: publicCardCommitteeSchema,
  })
  .strict()
export type PublicCard = z.infer<typeof publicCardSchema>

// A candidature's card as its owner and the workspace's conseillers read it; `null` when its owner
// never consented.
export const showcaseCardSchema = z
  .object({
    pseudonym: z.string(),
    region: showcaseRegionSchema.nullable(),
    state: showcaseCardStateSchema,
    pausedBecause: showcasePauseReasonSchema.nullable(),
    // The latest consent: the first, a new one after a withdrawal, or a change of pseudonym/region.
    consentedAt: z.string().datetime(),
    withdrawnAt: z.string().datetime().nullable(),
    withdrawnBecause: showcaseWithdrawalReasonSchema.nullable(),
  })
  .strict()
export type ShowcaseCard = z.infer<typeof showcaseCardSchema>

// The owner's panel: the card, what would stop a consent now, whether the page is published, and the
// card as the public would read it — built by the same projection, under the stored pseudonym and
// region (`null` before any consent; the site shows the ones being typed instead).
export const ownerShowcaseCardSchema = z
  .object({
    workspace: z.object({ name: z.string(), slug: z.string() }).strict(),
    pagePublished: z.boolean(),
    card: showcaseCardSchema.nullable(),
    // The card's version, sent back with a change; null before any consent.
    version: z.number().int().min(1).nullable(),
    blocker: z.enum(SHOWCASE_CARD_BLOCKERS).nullable(),
    preview: publicCardSchema.extend({ pseudonym: z.string().nullable() }).strict(),
  })
  .strict()
export type OwnerShowcaseCard = z.infer<typeof ownerShowcaseCardSchema>

// What the workspace's conseillers read of a received candidature's card (read-only).
export const receivedShowcaseCardSchema = z
  .object({ pagePublished: z.boolean(), card: showcaseCardSchema.nullable() })
  .strict()
export type ReceivedShowcaseCard = z.infer<typeof receivedShowcaseCardSchema>
