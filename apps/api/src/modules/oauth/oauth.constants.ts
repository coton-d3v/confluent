import { createHash, randomBytes } from 'node:crypto'
import { OAUTH_SCOPES, OAUTH_SCOPE_LABELS, canOwnCompanies } from '@confluent/shared'
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
  OAUTH_SCOPES.support,
  OAUTH_SCOPES.decide,
  OAUTH_SCOPES.opportunitiesRead,
  OAUTH_SCOPES.opportunitiesWrite,
  OAUTH_SCOPES.sharingRead,
  OAUTH_SCOPES.sharingWrite,
  OAUTH_SCOPES.committeesRead,
  OAUTH_SCOPES.committeesWrite,
  OAUTH_SCOPES.participationRequestsDecide,
  OAUTH_SCOPES.publicPageRead,
  OAUTH_SCOPES.publicPageWrite,
  OAUTH_SCOPES.publicPagePublish,
  OAUTH_SCOPES.accessRequestsDecide,
  OAUTH_SCOPES.showcaseRead,
  OAUTH_SCOPES.showcaseWrite,
]
// ROADMAP E10.10: the labels live in @confluent/shared, so that the privacy page lists the same words.
export const SCOPE_LABELS: Record<string, string> = OAUTH_SCOPE_LABELS

export function expandScopes(scopes: readonly string[]): Set<string> {
  const set = new Set(scopes)
  if (set.has(OAUTH_SCOPES.write)) set.add(OAUTH_SCOPES.read)
  // E07.10: taking a position starts from the opportunity and the pledge's version read; sharing,
  // from the list of accesses.
  if (set.has(OAUTH_SCOPES.opportunitiesWrite)) set.add(OAUTH_SCOPES.opportunitiesRead)
  if (set.has(OAUTH_SCOPES.sharingWrite)) set.add(OAUTH_SCOPES.sharingRead)
  // E08.07: changing an entry starts from the committee and the entry's version read.
  if (set.has(OAUTH_SCOPES.committeesWrite)) set.add(OAUTH_SCOPES.committeesRead)
  // E09.07: changing a page or a card starts from the page or the card read.
  if (set.has(OAUTH_SCOPES.publicPageWrite)) set.add(OAUTH_SCOPES.publicPageRead)
  if (set.has(OAUTH_SCOPES.showcaseWrite)) set.add(OAUTH_SCOPES.showcaseRead)
  return set
}

const FORM_SCOPES = new Set<string>([OAUTH_SCOPES.formsWrite, OAUTH_SCOPES.formsPublish])
const SHARING_SCOPES = new Set<string>([OAUTH_SCOPES.sharingRead, OAUTH_SCOPES.sharingWrite])
const PUBLIC_PAGE_SCOPES = new Set<string>([
  OAUTH_SCOPES.publicPageRead,
  OAUTH_SCOPES.publicPageWrite,
  OAUTH_SCOPES.publicPagePublish,
  OAUTH_SCOPES.accessRequestsDecide,
])
const SHOWCASE_SCOPES = new Set<string>([OAUTH_SCOPES.showcaseRead, OAUTH_SCOPES.showcaseWrite])

// What an account may grant to an application, whatever the client asks: the form permissions only
// if it designs forms somewhere — Confluent's own as an administrator, or those of a workspace it
// manages (`managesWorkspace`, E05.09) —, presenting financing requests only if it may own companies
// (E05.10); following received candidatures only if it reviews the candidatures of a workspace it is
// a member of (`reviewsCandidatures`, E06.09), deciding their follow-up if it does or may own
// companies (the owner's side of a financing status); following and sharing requests only if it may
// own companies (E07.10); any other or unknown role never receives them. Reading one's opportunities
// and taking a position are offered to every account: any account may be the recipient of a share
// or an investor of a pool, which the services check at each call. E08.07: reading committees is
// offered to whoever may own companies (their candidatures' committees) or is an active member of a
// workspace (its committees, or their sessions as a participant); changing a request's entry on one
// to whoever may own companies or reviews candidatures; deciding participation requests to whoever
// manages a workspace. E09.07: a workspace's public page — reading, changing, publishing it, deciding
// its access requests — to whoever manages a workspace; a request's cards on public pages to whoever
// may own companies. The services check the rights again at each call: a grant outlives a change
// of role or membership.
export interface GrantContext {
  managesWorkspace: boolean
  reviewsCandidatures?: boolean
  // E08.07: an active member of at least one workspace.
  memberOfWorkspace?: boolean
}

export function grantableScopes(
  scopes: Iterable<string>,
  user: { role: string },
  context: GrantContext = { managesWorkspace: false },
): string[] {
  const reviews = context.reviewsCandidatures === true
  return [...scopes].filter((s) => {
    if (FORM_SCOPES.has(s)) return canDesignForms(user) || context.managesWorkspace
    if (s === OAUTH_SCOPES.present) return canOwnCompanies(user)
    if (s === OAUTH_SCOPES.support) return reviews
    if (s === OAUTH_SCOPES.decide) return reviews || canOwnCompanies(user)
    if (SHARING_SCOPES.has(s)) return canOwnCompanies(user)
    if (s === OAUTH_SCOPES.committeesRead) {
      return canOwnCompanies(user) || context.memberOfWorkspace === true
    }
    if (s === OAUTH_SCOPES.committeesWrite) return reviews || canOwnCompanies(user)
    if (s === OAUTH_SCOPES.participationRequestsDecide) return context.managesWorkspace
    if (PUBLIC_PAGE_SCOPES.has(s)) return context.managesWorkspace
    if (SHOWCASE_SCOPES.has(s)) return canOwnCompanies(user)
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

// E10.10 (U05): where a client's identity comes from. Closed by default: only a metadata document
// Confluent fetched itself (`cimd`) from the HTTPS address that is the client's identifier makes it
// verified, naming the host that publishes it; a self-registered client (`dcr`) only declares it.
export function clientOrigin(client: { id: string; source: string }): {
  origin: 'verified' | 'declared'
  originHost: string | null
} {
  if (client.source !== 'cimd') return { origin: 'declared', originHost: null }
  try {
    const url = new URL(client.id)
    if (url.protocol === 'https:') return { origin: 'verified', originHost: url.host }
  } catch {
    // Not an address: declared.
  }
  return { origin: 'declared', originHost: null }
}
