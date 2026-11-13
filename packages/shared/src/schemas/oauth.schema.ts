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
// E09.07: a workspace's public page and the cards shown on it are permissions of their own — for its
// managers, reading the page's settings, preview, cards and the access requests sent from it;
// changing its texts and blocks or hiding a card, which implies reading; publishing or unpublishing
// it and allowing search engines to index it; deciding the access requests — and, for the owner of a
// request, reading its cards and consenting to show one or withdrawing it, which implies reading.
// None is gained by an earlier authorization (R52).
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
  publicPageRead: 'public-page:read',
  publicPageWrite: 'public-page:write',
  publicPagePublish: 'public-page:publish',
  accessRequestsDecide: 'access-requests:decide',
  showcaseRead: 'showcase:read',
  showcaseWrite: 'showcase:write',
} as const

// What each permission lets an application read or do, in plain French: shown on the consent
// screen, the « Applications IA » page and the privacy page (E10.10).
export const OAUTH_SCOPE_LABELS: Record<string, string> = {
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
    // E10.10 (U05): where the application's identity comes from. `verified`: its identifier is an
    // HTTPS address whose metadata document Confluent fetched (`originHost`, the host that publishes
    // it); `declared`: it registered itself (dynamic registration) — its name is what it says, only
    // the redirection host is known.
    origin: z.enum(['verified', 'declared']),
    originHost: z.string().nullable(),
  }),
  scopes: z.array(z.object({ scope: z.string(), label: z.string() })),
  // E10.10 (U05): how long what is granted lasts — each access token, its renewal, and the
  // authorization itself (the user reconnects afterwards; revocable at any time).
  durations: z.object({
    accessTokenMinutes: z.number().int().positive(),
    refreshTokenDays: z.number().int().positive(),
    connectionDays: z.number().int().positive(),
  }),
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
  // E10.10 (U06): the last tool it called on the person's behalf, from the journal (`null`: none yet,
  // or before E10.10 on a server that predates it).
  lastAction: z
    .object({ tool: z.string(), at: z.string().datetime(), succeeded: z.boolean() })
    .nullable()
    .optional(),
  expiresAt: z.string().datetime(),
})

export type ConnectedApplication = z.infer<typeof connectedApplicationSchema>
