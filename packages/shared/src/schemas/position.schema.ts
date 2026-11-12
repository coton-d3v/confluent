import { z } from 'zod'
import { accessLevelSchema } from './access-level.schema.js'
import { interestIdentitySchema, opportunityInterestSchema } from './interest.schema.js'
import { opportunityListItemSchema } from './opportunity.schema.js'
import { opportunityPledgeSchema, pledgeIntentionSchema } from './pledge.schema.js'

// ROADMAP E07.07 — investors' positions (« positionnements »: their marks of interest, E07.05, and
// their pledges, E07.06) as each audience reads them, closed by default (D05 still open: where it is
// silent, the most restrictive option). This file is the only place where these rules are described;
// the API applies them, the site only offers what they allow.
//
//  * The investor (« Mes positionnements »): their own marks, pledges and structure consents, from
//    their account only, with where each request stands now — read as an opportunity (THE rule of
//    E07.03, `GET /v1/opportunities/:dossierId`) or not, closed (archived by its owner, E06.01) or
//    not. A request they no longer read is told by nothing but that: neither its title nor anything
//    else of it, only their own data on it (which they may still withdraw).
//  * The owner (« Positionnements des investisseurs »): what E07.05 and E07.06 already open to them,
//    in one view — the counts and the pledges' total of the investors who read the request now, and
//    for each investor what they chose to show. A mark and a pledge are put on one line only when the
//    investor shows their name on both; a pledge whose name is hidden stays apart (its amount alone,
//    if shown), so that no line links what the investor did not link.
//  * The structure (a workspace's conseillers and Confluent administrators, `canReviewCandidatures`):
//    an investor's position on a request only if that investor gave this very structure an explicit
//    consent for that request (« Montrer mon positionnement à {structure} »: no default, revocable at
//    any time, journaled) — nothing otherwise, not even a count. A consent is given on a request the
//    investor reads through the structure's pool (an active investor of it, the publication listed),
//    and it counts only while that lasts. What it shows: the investor's name and their organization
//    in that structure, their mark of interest (date) and their pledge (intention, amount, date) —
//    never the pledge's comment, which stays the investor's alone, nor what they show the owner.
//  * Nobody else — and never another investor — reads anyone's positions.

const workspaceRefSchema = z.object({ id: z.string().uuid(), name: z.string() })

// Body of `PUT /v1/opportunities/:dossierId/structures/:workspaceId`: the investor's explicit consent.
export const disclosePositionSchema = z
  .object({
    consent: z.literal(true, {
      message: 'Cochez la case pour montrer votre positionnement à cette structure.',
    }),
  })
  .strict()
export type DisclosePositionInput = z.infer<typeof disclosePositionSchema>

// A consent given to a structure on one request; withdrawn by its id
// (`DELETE /v1/positions/disclosures/:id`), even once the investor no longer reads the request.
export const positionDisclosureSchema = z.object({
  id: z.string().uuid(),
  workspace: workspaceRefSchema,
  disclosedAt: z.string().datetime(),
})
export type PositionDisclosure = z.infer<typeof positionDisclosureSchema>

// « Mes positionnements » (`GET /v1/positions`): one line per request on which the investor has a
// mark, a pledge or a structure consent, the latest activity first.
export const myPositionSchema = z.object({
  dossierId: z.string().uuid(),
  // Read as an opportunity now: only then does the position count for the owner (and for a
  // structure that has the investor's consent), and only then is anything of the request shown.
  readable: z.boolean(),
  // Archived by its owner: its pledge is closed (neither changed nor withdrawn).
  closed: z.boolean(),
  // The list's part of the opportunity's projection, at its level; `null` when not readable.
  dossier: opportunityListItemSchema.shape.dossier.nullable(),
  accessLevel: accessLevelSchema.nullable(),
  interest: opportunityInterestSchema.nullable(),
  pledge: opportunityPledgeSchema.nullable(),
  disclosures: z.array(positionDisclosureSchema),
})
export type MyPosition = z.infer<typeof myPositionSchema>

export const myPositionsSchema = z.object({ items: z.array(myPositionSchema) })
export type MyPositions = z.infer<typeof myPositionsSchema>

// What the owner reads (`GET /v1/dossiers/:id/positions`): the counts of E07.05/E07.06, the
// investors who show their name — with their mark when it shows their name, their pledge when it
// shows their name (its amount only if shown too) —, by name, and the amounts of the pledges that
// show their amount but not their name, the largest first. No intention, comment or address.
export const dossierPositionsSchema = z.object({
  interests: z.object({ count: z.number().int().min(0) }),
  pledges: z.object({
    count: z.number().int().min(0),
    totalEur: z.number().int().min(0),
  }),
  named: z.array(
    z.object({
      identity: interestIdentitySchema,
      interest: z.object({ markedAt: z.string().datetime() }).nullable(),
      pledge: z.object({ amountEur: z.number().int().min(1).nullable() }).nullable(),
    }),
  ),
  anonymousAmounts: z.array(z.number().int().min(1)),
})
export type DossierPositions = z.infer<typeof dossierPositionsSchema>

// What a structure reads (`GET /v1/workspaces/:id/positions`): each request listed in its pool now,
// with the positions its investors chose to show it, and their pledges' total.
export const workspacePositionsSchema = z.object({
  items: z.array(
    z.object({
      candidatureId: z.string().uuid(),
      dossier: z.object({ id: z.string().uuid(), name: z.string() }),
      company: z.object({ name: z.string() }),
      investors: z.array(
        z.object({
          identity: interestIdentitySchema,
          disclosedAt: z.string().datetime(),
          interest: z.object({ markedAt: z.string().datetime() }).nullable(),
          pledge: z
            .object({
              intention: pledgeIntentionSchema,
              amountEur: z.number().int().min(1),
              updatedAt: z.string().datetime(),
            })
            .nullable(),
        }),
      ),
      pledgedEur: z.number().int().min(0),
    }),
  ),
})
export type WorkspacePositions = z.infer<typeof workspacePositionsSchema>
