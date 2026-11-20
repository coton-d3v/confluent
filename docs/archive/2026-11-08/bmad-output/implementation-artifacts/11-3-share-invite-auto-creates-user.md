# Story 11.3: Share Invite Auto-Creates User Row

Status: done

Avant cette story, `POST /v1/dossiers/:id/shares` stockait `recipientEmail` en string brute sans rien écrire dans `users`. Conséquence : un financeur invité par partage ne pouvait jamais se connecter via magic-link, parce que `AuthService.requestMagicLink` fait un no-op silencieux (anti-énumération) sur un email inconnu. La story aligne le flow d'invitation par partage sur celui d'invitation admin (Story 9.3) : le user est créé dès le partage, et peut ensuite s'identifier via le flow magic-link standard.

## AC

1. **`ShareLinksService.create`** ([apps/api/src/modules/share-links/share-links.service.ts](../../../../../apps/api/src/modules/share-links/share-links.service.ts)) — avant la création du `ShareLink` :
   - normalise `recipientEmail` (`.trim().toLowerCase()`),
   - lookup `users` par email,
   - si absent : crée `User { email, role: 'financeur', isActive: true, emailVerifiedAt: null }` (mêmes valeurs que Story 11.2 pour les invites admin),
   - si présent : aucune mutation (l'état existant est respecté, même si déjà inactif).
2. **Audit `share_link_created`** enrichi avec `metadata.recipientUserId` + `metadata.createdNewUser` (bool) — utile pour les rapports admin et pour répondre "qui a invité qui" via Story 8.4.
3. **Email envoyé** via `EmailTransport.sendShareInvite({ to, dossierName, shareUrl, locale })` (interface refactorée en Story 11.4). La `locale` lue depuis `recipient.locale` (V1 = toujours `'fr'`).
4. **Un seul email** part : le lien de partage. Pas de second email "magic-link". Le financeur consulte le dossier via le `shareUrl` sans login ; s'il veut s'authentifier plus tard, il peut visiter `/auth` (le user existe, donc `requestMagicLink` lui enverra un lien).
5. **Specs** [share-links.service.spec.ts](../../../../../apps/api/src/modules/share-links/share-links.service.spec.ts) couvre :
   - `recipient inconnu → user créé { role:'financeur', isActive:true, emailVerifiedAt:null }`
   - `recipient déjà existant → pas de mutation` + `audit.createdNewUser = false`
   - `sendShareInvite` appelé avec les bonnes valeurs (`to`, `dossierName`, `locale`).

## Tasks

- [x] Upsert user dans `ShareLinksService.create`
- [x] Enrichir metadata audit
- [x] Adapter à `EmailTransport.sendShareInvite` (interface typée — Story 11.4)
- [x] Mettre à jour le spec
- [x] Tests verts

## Décisions cadrées

- **1 email seulement** (vs deux : partage + magic-link) — moins intrusif. Le financeur peut accéder au dossier immédiatement via le share URL ; le magic-link reste à la demande sur `/auth`.
- **Pas de migration de schema** : `ShareLink.recipientEmail` reste la string. Le user est lié logiquement par email (cohérence garantie par le `.toLowerCase().trim()` côté API).
- **Pas d'audit séparé** "user_invited_via_share" : on enrichit le `share_link_created` existant via `metadata` plutôt que d'élargir l'enum `audit_action`.

## References

- [apps/api/src/modules/share-links/share-links.service.ts](../../../../../apps/api/src/modules/share-links/share-links.service.ts)
- Story 8.1 (Share Link Generation) — comportement antérieur (string brute)
- Story 9.3 (User Management Persistence) — flow d'invitation admin équivalent
- Story 11.2 (User State Separation) — fournit la sémantique `emailVerifiedAt: null`
