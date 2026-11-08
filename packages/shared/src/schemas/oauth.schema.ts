import { z } from 'zod'

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
