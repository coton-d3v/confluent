import { createHash, randomBytes } from 'node:crypto'
import { OAUTH_SCOPES, canOwnCompanies } from '@confluent/shared'
import { canDesignForms } from '../questionnaires/form-design-access'

// Scopes granted to MCP clients (names shared with the consent screen). `dossiers:write` implies
// `dossiers:read` (MCP spec: servers MUST honour scope hierarchies). `forms:write` stands alone: the
// form design tools (E04.06) also read with `dossiers:read`, like `get_form`.
export { OAUTH_SCOPES }
export const SUPPORTED_SCOPES: string[] = [
  OAUTH_SCOPES.read,
  OAUTH_SCOPES.write,
  OAUTH_SCOPES.submit,
  OAUTH_SCOPES.present,
  OAUTH_SCOPES.formsWrite,
  OAUTH_SCOPES.formsPublish,
]
export const SCOPE_LABELS: Record<string, string> = {
  [OAUTH_SCOPES.read]:
    'Lire votre profil, vos dossiers, leurs questionnaires, réponses et documents',
  [OAUTH_SCOPES.write]: 'Modifier les réponses de vos dossiers et y déposer des documents',
  [OAUTH_SCOPES.submit]: 'Soumettre un dossier, uniquement à votre demande explicite',
  [OAUTH_SCOPES.present]:
    'Publier une demande de financement, choisir les documents qu’elle présente et l’envoyer en candidature à une structure, uniquement à votre demande explicite',
  [OAUTH_SCOPES.formsWrite]:
    'Créer et modifier des brouillons de formulaires (sections, champs, choix, limites, niveaux de lecture), sans les publier',
  [OAUTH_SCOPES.formsPublish]:
    'Publier un brouillon de formulaire, uniquement à votre demande explicite',
}

export function expandScopes(scopes: readonly string[]): Set<string> {
  const set = new Set(scopes)
  if (set.has(OAUTH_SCOPES.write)) set.add(OAUTH_SCOPES.read)
  return set
}

const FORM_SCOPES = new Set<string>([OAUTH_SCOPES.formsWrite, OAUTH_SCOPES.formsPublish])

// What an account may grant to an application, whatever the client asks: the form permissions only
// if it designs forms somewhere — Confluent's own as an administrator, or those of a workspace it
// manages (`managesWorkspace`, E05.09) —, presenting financing requests only if it may own companies
// (E05.10); any other or unknown role never receives them. The services check the rights again at
// each call: a grant outlives a change of role or membership.
export function grantableScopes(
  scopes: Iterable<string>,
  user: { role: string },
  context: { managesWorkspace: boolean } = { managesWorkspace: false },
): string[] {
  return [...scopes].filter((s) => {
    if (FORM_SCOPES.has(s)) return canDesignForms(user) || context.managesWorkspace
    if (s === OAUTH_SCOPES.present) return canOwnCompanies(user)
    return true
  })
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
