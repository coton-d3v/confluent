import { z } from 'zod'
import { workspaceMemberRoleSchema } from './workspace-member.schema.js'

// Permissions an MCP client can be granted. `dossiers:write` implies `dossiers:read`. `forms:write`
// (designing form drafts, E04.06) and `forms:publish` are granted to whoever designs forms —
// administrators, and the managers of a workspace for its own forms (E05.09, E05.10) —: the server
// drops them from any other account's consent, whatever the client asks for. Submitting a dossier and
// publishing a form (E04.08) are permissions of their own, consented to as such, and so is presenting
// a financing request to others (E05.10: publishing it, choosing the documents it shows, sending it
// as a candidature to a workspace), granted to whoever may own companies: an application authorized
// before a permission existed does not gain it, even by refreshing its tokens (code review R52).
// E06.09: following the candidatures a workspace receives — keeping their financing plan and
// eligibilities as the structure, reading and writing its internal notes — is a permission of its
// own, granted to the conseillers of a workspace; deciding the follow-up of a candidature — its
// financing status, on either side, and as the structure the validation of a support step or the
// verification of an eligibility — is another, on the person's explicit request.
// E07.10: an investor's opportunities and positions are permissions of their own — reading them
// (and, as the conseiller of a workspace, the positions investors chose to show it), and taking a
// position (marking one's interest, pledging, showing it to a structure), which the owner or the
// structure then sees —; so are the diffusion of the owner's requests — following it (accesses,
// history, investors' positions) and sharing (inviting at a chosen level, changing it, revoking).
// Writing implies reading in both pairs. None is gained by an earlier authorization (R52).
// E08.07: a workspace's committees are permissions of their own — reading them as the site shows
// them to each role (conseillers: the committees, the requests presented and their progress;
// managers: also the participants, the notices and the participation requests of the public form;
// entrepreneurs: the committees of their candidatures; accepted participants: their sessions),
// changing a request's entry on a committee (applying, confirming, withdrawing; attaching,
// accepting, refusing), which implies reading, and deciding the participation requests (managers:
// an acceptance adds the person to the workspace as an investor). None is gained by an earlier
// authorization (R52).
export const OAUTH_SCOPES = {
  read: 'dossiers:read',
  write: 'dossiers:write',
  submit: 'dossiers:submit',
  present: 'dossiers:present',
  formsWrite: 'forms:write',
  formsPublish: 'forms:publish',
  support: 'candidatures:support',
  decide: 'candidatures:decide',
  opportunitiesRead: 'opportunities:read',
  opportunitiesWrite: 'opportunities:write',
  sharingRead: 'sharing:read',
  sharingWrite: 'sharing:write',
  committeesRead: 'committees:read',
  committeesWrite: 'committees:write',
  participationRequestsDecide: 'participation-requests:decide',
} as const

// ROADMAP E05.10: a connection reaches a workspace only if the person ticked it on the consent
// screen, among their active memberships — closed by default: none is ticked beforehand, and an
// authorization given before this choice existed reaches none. The choice is stored with the
// authorization, never widened by a refresh; the membership is checked again at every tool call.
export const oauthConsentWorkspaceSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  programName: z.string().nullable(),
  role: workspaceMemberRoleSchema,
})

export type OAuthConsentWorkspace = z.infer<typeof oauthConsentWorkspaceSchema>

// What the consent screen shows (GET /v1/oauth/requests/:id).
export const oauthConsentRequestSchema = z.object({
  id: z.string(),
  client: z.object({
    name: z.string(),
    // MCP spec: the redirect hostname MUST be shown to the user.
    redirectHost: z.string(),
    clientUri: z.string().nullable(),
    verifiedByMetadataDocument: z.boolean(),
  }),
  scopes: z.array(z.object({ scope: z.string(), label: z.string() })),
  // The workspaces the application may be allowed to reach. Absent from a server that predates them
  // (E05.10): nothing to choose.
  workspaces: z.array(oauthConsentWorkspaceSchema).optional(),
  expiresAt: z.string().datetime(),
})

export type OAuthConsentRequest = z.infer<typeof oauthConsentRequestSchema>

// The person's decision (POST /v1/oauth/requests/:id/decision). `scopes` absent: what was requested
// and this account may grant. `workspaceIds` absent or empty: no workspace.
export const oauthConsentDecisionSchema = z.object({
  approve: z.boolean(),
  scopes: z.array(z.string().max(100)).max(20).optional(),
  workspaceIds: z.array(z.string().max(100)).max(200).optional(),
})

export type OAuthConsentDecision = z.infer<typeof oauthConsentDecisionSchema>

// An AI application connected to the user's account (E01.08). Several authorizations of the same
// application (one per device or conversation) are grouped: revoking the application revokes them
// all (code review R21).
export const connectedApplicationSchema = z.object({
  clientId: z.string(),
  application: z.object({ name: z.string(), clientUri: z.string().nullable() }),
  scopes: z.array(z.object({ scope: z.string(), label: z.string() })),
  // E05.10: the workspaces its authorizations reach (absent from a server that predates them).
  workspaces: z.array(z.object({ id: z.string(), name: z.string() })).optional(),
  connections: z.number().int().positive(),
  connectedAt: z.string().datetime(),
  lastUsedAt: z.string().datetime().nullable(),
  expiresAt: z.string().datetime(),
})

export type ConnectedApplication = z.infer<typeof connectedApplicationSchema>
