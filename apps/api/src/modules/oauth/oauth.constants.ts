import { createHash, randomBytes } from 'node:crypto'

// Scopes granted to MCP clients. `dossiers:write` implies `dossiers:read` (MCP spec: servers MUST honour
// scope hierarchies).
export const OAUTH_SCOPES = {
  read: 'dossiers:read',
  write: 'dossiers:write',
} as const
export const SUPPORTED_SCOPES: string[] = [OAUTH_SCOPES.read, OAUTH_SCOPES.write]
export const SCOPE_LABELS: Record<string, string> = {
  [OAUTH_SCOPES.read]: 'Lire votre profil, vos dossiers, leurs questionnaires et réponses',
  [OAUTH_SCOPES.write]: 'Modifier les réponses de vos dossiers',
}

export function expandScopes(scopes: readonly string[]): Set<string> {
  const set = new Set(scopes)
  if (set.has(OAUTH_SCOPES.write)) set.add(OAUTH_SCOPES.read)
  return set
}

export const AUTHORIZATION_REQUEST_TTL_MS = 10 * 60 * 1000
export const AUTHORIZATION_CODE_TTL_MS = 60 * 1000
export const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000
// A connected application stays authorized at most this long; the user reconnects afterwards.
export const GRANT_TTL_MS = 90 * 24 * 60 * 60 * 1000
// A rotated refresh token presented again within this window is a retry, not a replay.
export const REFRESH_REUSE_GRACE_MS = 30 * 1000

export function newOpaqueToken(prefix: string): string {
  return `${prefix}_${randomBytes(32).toString('base64url')}`
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export const mcpResourceUrl = (apiPublicUrl: string): string => `${apiPublicUrl}/mcp`
