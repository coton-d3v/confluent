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
  [OAUTH_SCOPES.support]:
    'Comme conseiller, dans les workspaces autorisés : tenir le plan de financement et les dispositifs des candidatures reçues, lire et écrire leurs notes internes',
  [OAUTH_SCOPES.decide]:
    'Changer le statut de financement d’une candidature (comité, financé, refusé, abandon, reprise) et, comme conseiller, valider une étape du parcours ou vérifier un dispositif, uniquement à votre demande explicite',
  [OAUTH_SCOPES.opportunitiesRead]:
    'Comme investisseur : lire vos opportunités (demandes partagées avec vous, et celles des viviers des workspaces autorisés) et vos positionnements (marques d’intérêt, promesses, consentements donnés aux structures) ; comme conseiller d’un workspace autorisé : les positionnements que des investisseurs ont choisi de montrer à votre structure',
  [OAUTH_SCOPES.opportunitiesWrite]:
    'Marquer ou retirer votre intérêt, faire, modifier ou retirer une promesse (jamais un engagement ferme), montrer ou non votre positionnement à une structure, uniquement à votre demande explicite ; inclut la lecture de vos opportunités',
  [OAUTH_SCOPES.sharingRead]:
    'Lire les accès ouverts à vos demandes de financement, leur historique (consultations, accès, interventions de l’administration) et les positionnements des investisseurs, tels que le site vous les montre',
  [OAUTH_SCOPES.sharingWrite]:
    'Inviter un destinataire à lire une demande de financement au niveau choisi, changer ce niveau ou révoquer un accès, uniquement à votre demande explicite ; inclut le suivi de la diffusion',
  [OAUTH_SCOPES.committeesRead]:
    'Lire les comités tels que le site vous les montre : comme porteur, ceux de vos candidatures ; comme participant accepté, vos sessions ; comme conseiller d’un workspace autorisé, ses comités (notes internes comprises), les demandes présentées et leur avancement ; comme gestionnaire, aussi les participants, les notifications envoyées et les demandes de participation reçues (nom, organisation, adresse, message)',
  [OAUTH_SCOPES.committeesWrite]:
    'Candidater à un comité, confirmer une proposition ou retirer votre demande ; comme conseiller d’un workspace autorisé, rattacher une demande à un comité, accepter ou refuser une candidature, la retirer — uniquement à votre demande explicite ; inclut la lecture des comités',
  [OAUTH_SCOPES.participationRequestsDecide]:
    'Comme gestionnaire d’un workspace autorisé, accepter ou refuser une demande de participation à ses comités (une acceptation ajoute la personne au workspace comme investisseur et la prévient par email), uniquement à votre demande explicite',
  [OAUTH_SCOPES.publicPageRead]:
    'Comme gestionnaire d’un workspace autorisé, lire les réglages de sa page publique (textes, blocs, publication, indexation), son aperçu, les cartes des projets et les demandes d’accès envoyées depuis la page (nom, entreprise, adresse, message)',
  [OAUTH_SCOPES.publicPageWrite]:
    'Comme gestionnaire d’un workspace autorisé, modifier les critères, le contact et les blocs de sa page publique, masquer ou rétablir la carte d’un projet — visibles de tous si la page est publiée —, uniquement à votre demande explicite ; inclut la lecture de la page',
  [OAUTH_SCOPES.publicPagePublish]:
    'Comme gestionnaire d’un workspace autorisé, publier ou dépublier sa page publique et autoriser ou non son indexation par les moteurs de recherche, uniquement à votre demande explicite',
  [OAUTH_SCOPES.accessRequestsDecide]:
    'Comme gestionnaire d’un workspace autorisé, accepter ou refuser une demande d’accès envoyée depuis sa page publique (une acceptation crée le compte porteur de projet de la personne s’il n’existe pas et la prévient par email), uniquement à votre demande explicite',
  [OAUTH_SCOPES.showcaseRead]:
    'Lire les cartes de vos demandes sur les pages publiques des structures auxquelles vous les présentez (pseudonyme, région, état, aperçu)',
  [OAUTH_SCOPES.showcaseWrite]:
    'Afficher la carte anonyme d’une de vos demandes sur la page publique d’une structure sous le pseudonyme choisi, la modifier ou la retirer, uniquement à votre demande explicite ; inclut la lecture de vos cartes',
}

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
