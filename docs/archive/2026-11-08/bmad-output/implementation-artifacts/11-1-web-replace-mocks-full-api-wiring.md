# Story 11.1: Web — Replace All Mocks with Full API Wiring

Status: done

Closes the scope explicitly deferred from Stories 7.6 and 8.5: those landed only the `features/*/api.ts` helpers; mocks remained as runtime fallbacks. This story flips every web route to consume the real API via `@confluent/shared` types, deletes the mock fixtures, and wires the remaining admin / share-access / questionnaire-builder / audit / documents surfaces that had no client at all.

## AC

1. **Generic `useAsync` hook** lifted from `features/dossiers/hooks.ts` to [apps/web/src/lib/useAsync.ts](../../../../../apps/web/src/lib/useAsync.ts) so every feature uses one implementation (no per-feature copies, no new state-mgmt dep).
2. **Entrepreneur surfaces** all consume real endpoints:
   - `/dashboard` → `GET /v1/dossiers`
   - `/dashboard/tableau-de-bord` → `GET /v1/dossiers` (compteurs)
   - `/dashboard/dossiers/nouveau` → `POST /v1/dossiers` à l'étape 1 (le dossier existe serveur dès la saisie du nom)
   - `/dashboard/dossiers/nouveau/questionnaire?dossierId=…` → `GET /v1/questionnaires/active` + `GET/PUT /v1/dossiers/:id/answers`, autosave debouncée 800 ms
   - `/dashboard/dossiers/nouveau/recapitulatif?dossierId=…` → `GET /v1/dossiers/:id` + `POST /v1/dossiers/:id/submit`
   - `/dashboard/dossiers/view/:slug` → résolution slug→id côté client + `GET /v1/dossiers/:id` + `answers` + `documents` + `shares` + `analytics` + `audit-log`
3. **`SharePanel`** branche réellement `createShare` / `revokeShare` ; `AccessEntry` est extrait de `data/mock-analytics.ts` vers [apps/web/src/features/shares/access-entry.ts](../../../../../apps/web/src/features/shares/access-entry.ts) ; un helper `buildAccessEntries(shares, analytics)` mappe `ShareLink[]` + `perRecipient` → `AccessEntry[]`.
4. **Surfaces financeur publiques** : `/share/:token` valide le token via `GET /shares/:token` puis redirige direct vers `/share/:token/dossier` — **l'écran de saisie d'email est supprimé** (le token UUID suffit, aligné avec `ShareLinkGuard`).
5. **Surfaces admin** toutes branchées : `/admin` → `GET /v1/admin/analytics` ; `/admin/dossiers` (paginé `?page=`) → `GET /v1/admin/dossiers` ; `/admin/dossiers/:slug` → `GET /v1/admin/dossiers/:id` + `PATCH …/answers` + `audit-log` + `DELETE` shares admin ; `/admin/questionnaire` → `listVersions` + édition inline `patchField` ; `/admin/utilisateurs` → `listUsers` + `inviteUser` + `deactivate` + `reactivate`.
6. **Bouton "Se déconnecter"** branché dans `AppShell` sidebar → `POST /v1/auth/logout` + `setAuth(null)` + `navigate('/auth')`.
7. **Schémas Zod manquants** ajoutés à `@confluent/shared` : `questionnaire.schema.ts` (FieldType, QuestionnaireVersion/Field, ActiveQuestionnaire, CreateVersion / PatchField), `document.schema.ts` (DocumentGroup, DocumentVersion, UploadedDocument), `analytics.schema.ts` (DossierAnalytics, PlatformAnalytics), extension de `auth.schema.ts` (IssuedSession), `share-link.schema.ts` (FinanceurShareResponse, ShareLinkWithUrl), `dossier.schema.ts` (sector/maturityStage/submittedAt + AdminDossierList paginé).
8. **`apiRequest` ne force plus `Content-Type: application/json` sur les `FormData`** (utile pour `POST /v1/dossiers/:id/documents`).
9. **Mocks supprimés** : `mock-dossiers`, `mock-admin-dossiers`, `mock-admin-pipeline`, `mock-users`, `mock-analytics`, `mock-dossier`, `mock-questionnaire-builder`, `mock-tokens`, et le composant `QuestionnaireBuilderSection` (devenu obsolète). `data/questionnaire.ts` ne conserve que les types `Question`/`Section`/`QuestionMeta`.
10. `apps/web/.env.example` documente `VITE_API_URL` (défaut `http://localhost:3000`).
11. **Typecheck `pnpm -r typecheck` vert** + build `pnpm --filter @confluent/web build` réussit.

## Tasks

- [x] Extraire `useAsync` dans `lib/`
- [x] Étendre `@confluent/shared` avec schémas manquants + rebuild
- [x] Wrappers API web : `features/{questionnaire,documents,audit,share-access}/api.ts` + `features/admin/{dossiers,users,questionnaire,analytics,shares}.api.ts`
- [x] Brancher `/dashboard` + `/tableau-de-bord` + wizard 3 écrans + vue dossier
- [x] Refactor `SharePanel` async + adapter `ShareLink → AccessEntry`
- [x] Réécrire `/share/:token` et `/share/:token/dossier` sans gate email
- [x] Brancher toutes les pages `/admin/*` + audit log + édition inline réponses admin
- [x] Brancher bouton logout dans `AppShell`
- [x] Supprimer tous les mocks + nettoyer imports
- [x] `apiRequest` : ne pas surcharger le Content-Type sur `FormData`
- [x] Typecheck + build verts

## Décisions cadrées avec l'utilisateur

- Mocks **supprimés** (pas de fallback) — l'impersonation `?as=` ne fournit plus que l'identité dev.
- Dossier **créé serveur dès l'étape 1** du wizard (plus de `localStorage`).
- **Pas d'écran de saisie email** sur `/share/:token` (UUID seul).
- Data layer = `useAsync` custom étendu (pas de React Query).

## Limitations notées (à traiter ailleurs)

- `GET /shares/:token` ne renvoie aujourd'hui que `{ dossier:{id,name,slug}, share:{recipientEmail,status} }`. La vue `/share/:token/dossier` affiche un placeholder en attendant un endpoint qui exposerait `answers` + `documents` au financeur. À planifier (extension Story 8.3 ou nouveau ticket).
- Résolution slug→id côté admin se fait via `listAdminDossiers(1, 100)`.find(slug). OK pour V1 ; si la base dépasse 100 dossiers, ajouter `GET /v1/admin/dossiers/by-slug/:slug` côté API.

## Commit

`6b0a5d3 — feat(web): wire every route to the API via @confluent/shared` (53 fichiers, +1882/-1513).

## References

- [7-6-frontend-replace-mocks-dossier-api.md](7-6-frontend-replace-mocks-dossier-api.md) — story qui a livré uniquement les helpers
- [8-5-frontend-wiring-sharing-analytics.md](8-5-frontend-wiring-sharing-analytics.md) — idem côté sharing/analytics
- [apps/web/src/lib/useAsync.ts](../../../../../apps/web/src/lib/useAsync.ts)
- [apps/web/src/features/admin/dossiers.api.ts](../../../../../apps/web/src/features/admin/dossiers.api.ts)
- [packages/shared/src/schemas/questionnaire.schema.ts](../../../../../packages/shared/src/schemas/questionnaire.schema.ts)
