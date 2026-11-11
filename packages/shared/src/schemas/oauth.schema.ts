import { z } from 'zod'

// Permissions an MCP client can be granted. `dossiers:write` implies `dossiers:read`. `forms:write`
// (designing form drafts, E04.06) and `forms:publish` are granted to administrators only: the
// server drops them from any other account's consent, whatever the client asks for. Submitting a
// dossier and publishing a form (E04.08) are permissions of their own, consented to as such: an
// application authorized before they existed does not gain them, even by refreshing its tokens
// (code review R52).
export const OAUTH_SCOPES = {
  read: 'dossiers:read',
  write: 'dossiers:write',
  submit: 'dossiers:submit',
  formsWrite: 'forms:write',
  formsPublish: 'forms:publish',
} as const

// An AI application connected to the user's account (E01.08). Several authorizations of the same
// application (one per device or conversation) are grouped: revoking the application revokes them
// all (code review R21).
export const connectedApplicationSchema = z.object({
  clientId: z.string(),
  application: z.object({ name: z.string(), clientUri: z.string().nullable() }),
  scopes: z.array(z.object({ scope: z.string(), label: z.string() })),
  connections: z.number().int().positive(),
  connectedAt: z.string().datetime(),
  lastUsedAt: z.string().datetime().nullable(),
  expiresAt: z.string().datetime(),
})

export type ConnectedApplication = z.infer<typeof connectedApplicationSchema>
