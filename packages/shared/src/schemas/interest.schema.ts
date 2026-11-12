import { z } from 'zod'

// ROADMAP E07.05 — an investor's mark of interest in a financing request, and what its owner sees of
// it (D05, closed by default where D05 is still open). This file is the only place where its rules are
// described; the API applies them, the site only offers what they allow.
//
//  * Who marks: an investor who reads the request as an opportunity right now (E07.03: an active
//    direct share to their address, or a listed publication in the pool of a workspace where they are
//    an active investor) — the very rule of `GET /v1/opportunities/:dossierId`, never another one.
//    At most one mark per investor and request; marking again only changes its name visibility.
//    No new mark, and no name newly shown, on an archived request; withdrawing, or hiding one's name,
//    is always possible.
//  * What the owner sees (D05): the number of marks, always; the name of an investor only when that
//    investor chose to show it on that mark (`nameVisible`, unchecked by default, changeable at any
//    time). Only the marks of investors who still read the request as an opportunity count: a mark of
//    an investor whose share was revoked, whose pool publication was withdrawn or paused, whose
//    membership or account was deactivated, is neither counted nor named while that lasts — the mark
//    itself stays theirs (withdrawable, back if access comes back).
//  * Nobody else: neither the workspace's conseillers or managers, nor administrators (outside the
//    raw journal), nor other investors, read the marks — except a structure the investor explicitly
//    consented to show their position on that request (E07.07, position.schema.ts).
//  * The name shown: the investor's account name (first and last name), and the organization their
//    membership records in each workspace whose pool brings them the request — none for a direct
//    share. Never their email address: an account without name shows « name not given ».

// Body of `PUT /v1/opportunities/:dossierId/interest`: the mark, and whether the owner may see who
// made it. No default: the investor answers explicitly.
export const markInterestSchema = z
  .object({
    nameVisible: z.boolean({ message: 'Indiquez si votre nom peut être montré au porteur.' }),
  })
  .strict()
export type MarkInterestInput = z.infer<typeof markInterestSchema>

// The investor's own mark on an opportunity, `null` when they have none.
export const opportunityInterestSchema = z.object({
  // The first mark; changing the name visibility keeps it.
  markedAt: z.string().datetime(),
  nameVisible: z.boolean(),
})
export type OpportunityInterest = z.infer<typeof opportunityInterestSchema>

// Who an investor is to the owner when they show their name: their account name (`null` when not
// given) and their organizations in the workspaces whose pools bring them the request.
export const interestIdentitySchema = z.object({
  name: z.string().nullable(),
  organizations: z.array(z.string()),
})
export type InterestIdentity = z.infer<typeof interestIdentitySchema>

// What the owner of a request reads of its marks (`GET /v1/dossiers/:id/interests`): how many
// investors who read it now marked their interest, and those of them who show their name, the latest
// first. No date nor any trace of the others.
export const dossierInterestsSchema = z.object({
  count: z.number().int().min(0),
  named: z.array(interestIdentitySchema.extend({ markedAt: z.string().datetime() })),
})
export type DossierInterests = z.infer<typeof dossierInterestsSchema>

// How an investor without a name given appears to the owner, and on their own preview.
export const UNNAMED_INVESTOR_LABEL = 'Investisseur (nom non renseigné)'

export function interestIdentityLabel(identity: InterestIdentity): string {
  const name = identity.name ?? UNNAMED_INVESTOR_LABEL
  return identity.organizations.length === 0
    ? name
    : `${name} — ${identity.organizations.join(', ')}`
}
