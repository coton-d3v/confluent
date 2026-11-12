import { z } from 'zod'
import { FINANCING_AMOUNT_MAX_EUR } from './financing.schema.js'
import { interestIdentitySchema } from './interest.schema.js'
import { HTML_TAG, plainParagraphs } from './support-path.schema.js'

// ROADMAP E07.06 — an investor's pledge (« promesse ») on a financing request: a declarative
// intention to finance it, never a firm commitment nor a financing obtained. This file is the only
// place where its rules are described; the API applies them, the site only offers what they allow.
// The closed list and the limits are kept equal to the CHECK constraint of migration
// 20261127000000_investor_pledges.
//
//  * Who pledges: an investor who reads the request as an opportunity right now — THE rule of
//    `GET /v1/opportunities/:dossierId` (E07.03), the very one of a mark of interest (E07.05).
//    At most one pledge per investor and request, separate from the mark of interest: an investor
//    may mark their interest without pledging, or pledge without marking.
//  * What it holds: an intention (closed list below), an amount in whole euros, an optional comment,
//    and two choices with no default — show their name, show their amount, to the owner.
//  * Until closure: the investor changes it from the version they read (a change made meanwhile, in
//    another tab, is refused, never overwritten) or withdraws it. A request is closed when its owner
//    archives it (E06.01, the request's only closure; unarchiving reopens it): its pledges are then
//    kept as they are — neither changed nor withdrawn —, except that an investor may always hide
//    their name or their amount (a consent stays revocable). A pledge on a request the investor no
//    longer reads (share revoked, publication withdrawn or paused) can still be withdrawn, not
//    changed.
//  * What the owner sees (decided: « l'entrepreneur voit le total ; l'investisseur choisit s'il
//    montre son nom et/ou son montant individuel »): how many pledges and their total, always; for
//    each pledge, the investor's name only if they chose to show it, their amount only if they chose
//    to show it. Neither the intention, the comment, nor any date. Only the pledges of investors who
//    still read the request count (the mark of interest's rule, E07.05): a pledge of an investor who
//    lost access is neither counted nor shown while that lasts, and stays theirs.
//  * Nobody else: neither other investors, nor the workspace's conseillers or managers, nor
//    administrators (outside the raw journal) read the pledges; their follow-up is E07.07.

// How firm the intention is — never a commitment, whatever the level.
export const PLEDGE_INTENTIONS = ['exploring', 'likely', 'strong'] as const
export const pledgeIntentionSchema = z.enum(PLEDGE_INTENTIONS, {
  message: 'Choisissez votre intention.',
})
export type PledgeIntention = z.infer<typeof pledgeIntentionSchema>

export const PLEDGE_INTENTION_LABELS: Record<PledgeIntention, string> = {
  exploring: 'À l’étude',
  likely: 'Probable',
  strong: 'Forte',
}

export const PLEDGE_INTENTION_HINTS: Record<PledgeIntention, string> = {
  exploring: 'vous étudiez le dossier avant de vous décider',
  likely: 'vous pensez investir si l’étude se confirme',
  strong: 'vous comptez investir, sous réserve de la documentation finale',
}

// Closed by default: an unknown intention reads as the least firm one.
export function pledgeIntentionOf(raw: string | null | undefined): PledgeIntention {
  return (PLEDGE_INTENTIONS as readonly string[]).includes(raw ?? '')
    ? (raw as PledgeIntention)
    : 'exploring'
}

export const PLEDGE_LIMITS = { comment: 1000 } as const

// Said before a pledge is made and wherever one is shown.
export const PLEDGE_NON_COMMITMENT =
  'Une promesse est une intention déclarative de financement : elle ne vous engage pas, ni le porteur, et ne vaut ni engagement ferme ni financement obtenu.'

const amountSchema = z
  .number({ message: 'Indiquez un montant en euros.' })
  .int('Le montant s’indique en euros, sans centimes.')
  .min(1, 'Le montant est d’au moins 1 €.')
  .max(FINANCING_AMOUNT_MAX_EUR, 'Le montant dépasse le maximum accepté (1 milliard d’euros).')

// Plain text in paragraphs (the internal notes' rule); blank means no comment.
const commentSchema = z
  .string()
  .transform(plainParagraphs)
  .pipe(
    z
      .string()
      .max(
        PLEDGE_LIMITS.comment,
        `Le commentaire compte au plus ${PLEDGE_LIMITS.comment} caractères.`,
      )
      .refine((v) => !HTML_TAG.test(v), {
        message: 'Le commentaire est un texte simple : les balises HTML ne sont pas acceptées.',
      }),
  )
  .transform((v) => (v === '' ? null : v))
  .nullable()

// Body of `PUT /v1/opportunities/:dossierId/pledge`: the whole pledge, as the investor wants it.
// `version`: the one they read, `null` for a first pledge — an opaque revision, never reused, not
// even after a withdrawal (code review R63): sent back as read, never computed. No default for
// either visibility.
export const pledgeInputSchema = z
  .object({
    intention: pledgeIntentionSchema,
    amountEur: amountSchema,
    comment: commentSchema.optional(),
    showName: z.boolean({ message: 'Indiquez si votre nom peut être montré au porteur.' }),
    showAmount: z.boolean({ message: 'Indiquez si votre montant peut être montré au porteur.' }),
    version: z
      .number({ message: 'Indiquez la version de la promesse que vous modifiez.' })
      .int()
      .min(1)
      .nullable(),
  })
  .strict()
export type PledgeInput = z.input<typeof pledgeInputSchema>
export type PledgeInputParsed = z.output<typeof pledgeInputSchema>

// The investor's own pledge on an opportunity, `null` when they have none.
export const opportunityPledgeSchema = z.object({
  intention: pledgeIntentionSchema,
  amountEur: z.number().int().min(1),
  comment: z.string().nullable(),
  showName: z.boolean(),
  showAmount: z.boolean(),
  version: z.number().int().min(1),
  pledgedAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})
export type OpportunityPledge = z.infer<typeof opportunityPledgeSchema>

// What the owner of a request reads of its pledges (`GET /v1/dossiers/:id/pledges`): how many
// investors who read it now pledged, the total of their amounts, and one line per pledge whose
// investor shows their name or their amount — the identity (`null` when hidden) and the amount
// (`null` when hidden). Lines with an amount first, the largest first, then by name; no date.
export const dossierPledgesSchema = z.object({
  count: z.number().int().min(0),
  totalEur: z.number().int().min(0),
  shown: z.array(
    z.object({
      identity: interestIdentitySchema.nullable(),
      amountEur: z.number().int().min(1).nullable(),
    }),
  ),
})
export type DossierPledges = z.infer<typeof dossierPledgesSchema>
