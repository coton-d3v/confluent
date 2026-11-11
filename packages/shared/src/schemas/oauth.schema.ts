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
export const OAUTH_SCOPES = {
  read: 'dossiers:read',
  write: 'dossiers:write',
  submit: 'dossiers:submit',
  present: 'dossiers:present',
  formsWrite: 'forms:write',
  formsPublish: 'forms:publish',
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
