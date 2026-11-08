# Confluent — conventions de travail

Référence unique du périmètre et des priorités : la roadmap produit (épiques E01 à E10, tâches `Exx.yy`), document privé de son propriétaire, **tenu hors de ce dépôt public**. Sa copie de travail locale, `docs/ROADMAP.md`, est ignorée par git et ne doit jamais être versionnée. Guides techniques : `docs/development.md`, `docs/database-migrations.md`, `docs/api-documentation.md`, `docs/mcp.md`.

## Pile et structure

```
apps/api      NestJS 11 + Prisma 5 (PostgreSQL) — REST sous /v1, OAuth 2.1 et MCP à la racine
apps/web      React 19 + Vite + Tailwind v4 + shadcn/ui
packages/shared  schémas Zod et types partagés (source de vérité des contrats API ↔ web)
```

Commandes : `pnpm dev:api`, `pnpm dev:web`, `pnpm typecheck`, `pnpm --filter @confluent/api test`, `pnpm --filter @confluent/api test:e2e`, `pnpm --filter @confluent/web build`, `pnpm db:migrate` (deploy), `pnpm db:migrate:status`, `pnpm api:token <email>`.

## Architecture — règles

- **Couches API** : contrôleur (HTTP, validation Zod via `createZodDto`, Swagger) → service (règles métier, droits) → Prisma. Aucune règle métier dans un contrôleur ; aucun accès Prisma depuis un contrôleur sauf lecture triviale déjà isolée.
- **Droits centralisés** : l'accès d'un utilisateur à un dossier passe par `DossiersService.resolveReadAccess` / `getByIdForUser` ; les niveaux de partage par `dossiers/financeur-access.ts`. Le MCP réutilise ces services — jamais de règle dupliquée, jamais d'identifiant d'utilisateur fourni par le client.
- **Contrats** : tout ce qui traverse API ↔ web est décrit dans `packages/shared` (Zod). Après modification : `pnpm --filter @confluent/shared build`.
- **Web** : `features/<domaine>/api.ts` (appels HTTP), composants dans `components/`, pages dans `routes/`. Pas d'appel `fetch` direct hors de `lib/api-client.ts`.
- **Fermé par défaut** : une valeur inconnue (niveau d'accès, scope, rôle) accorde le moins de droits.
- **Textes** : interface et messages d'erreur utilisateur en français ; code, noms et commentaires en anglais. Commentaires rares, qui expliquent le *pourquoi*.

## Base de données

- Toute modification de schéma passe par une **migration versionnée** dans `apps/api/prisma/migrations/` (générée avec `prisma migrate diff --from-url … --to-schema-datamodel …`), jamais par `db push`.
- Une migration doit réussir sur des données existantes (backfill ou renumérotation explicites) ; contraintes `CHECK` pour les colonnes texte à valeurs fermées.
- Avant PR, rejouer **toute la chaîne en une commande** sur une base vide : `MIGRATION_CHECK_DATABASE_URL=… sh apps/api/scripts/check-migration-chain.sh` (les helpers `pg_temp` sont recréés avec `CREATE OR REPLACE` et supprimés en fin de migration, car toutes les migrations partagent une session).

## Tests et vérifications (avant toute PR)

1. `pnpm typecheck` (shared, API, web) et eslint sur les fichiers touchés.
2. API : **tests unitaires ET e2e** (`test:e2e`, Prisma simulé avec état par `apps/api/src/testing/fake-prisma.ts`, exclu du build, aucune base requise). Un contrat HTTP modifié = test e2e adapté.
   Transactions, verrous, index et concurrence ne se démontrent pas avec le faux Prisma : `TEST_DATABASE_URL=<base jetable migrée> pnpm --filter @confluent/api test:pg` (`apps/api/test/pg/*.pg-spec.ts`, PostgreSQL réel).
3. Un correctif de bug s'accompagne d'un test de non-régression **dont on a vérifié qu'il échoue sans le correctif**.
4. Web : `vite build`, puis **recette dans un vrai navigateur** (Playwright Chromium headless, voir ci-dessous) pour tout écran modifié.
5. Recette réelle sur la base de dev quand c'est pertinent (API compilée `pnpm --filter @confluent/api start`), données de démonstration remises en état après coup.

Navigateur headless (sans root) : scripts dans `~/.local/share/pw-runner`, lancés avec
`D=$HOME/.local/share/chromium-deps FONTCONFIG_FILE=$D/fonts.conf LD_LIBRARY_PATH=$D/usr/lib/x86_64-linux-gnu:$D/lib/x86_64-linux-gnu node script.mjs`.
Connexion dans un script : créer une ligne `magic_link_tokens` via Prisma puis ouvrir `/auth/verify?token=…`.

## Pièges connus

- **Analyseurs de corps et Nest** : Nest n'installe ses analyseurs globaux que s'il ne trouve aucune couche Express *nommée* `jsonParser`/`urlencodedParser`. Tout `express.json()`/`express.urlencoded()` monté à la main doit être enveloppé dans une fonction au nom distinct.
- Les routes OAuth (`/authorize`, `/token`, `/register`, `/revoke`, `/.well-known/*`) et `/mcp` sont montées sur Express hors du préfixe `/v1`.
- Les refresh tokens (session web et OAuth) sont à usage unique : le web ne lance jamais deux refresh en parallèle (`refreshSession` dans `lib/api-client.ts`).

## Git et PR

- **Stacked PRs** avec l'extension officielle `gh stack` ; tronc **`production`** (branche par défaut ; `main` est obsolète). Nouvelle branche : `gh stack add feat/<tâche>-<sujet>[-api|-web]` ; publication : `gh stack submit --auto --open` ; vérification : `gh stack view --short`.
- **Une PR = une unité cohérente et détachable** (souvent API puis web), qui laisse `production` construisible si l'on merge jusqu'à elle. Ordonner pour qu'aucun état intermédiaire ne casse la prod (ex. client web adapté avant l'API plus stricte).
- **Un commit par PR** ; un correctif issu d'une revue va dans le commit de la PR concernée (`--amend`), puis les branches supérieures sont rebasées (`git rebase --onto`, dans un `git worktree` si le répertoire de travail contient des changements non commités) et poussées (`gh stack push`). Jamais de `git reset --hard`.
- N'ajouter que ses propres fichiers (`git add <chemins>`) : le répertoire de travail peut contenir des changements de documentation de l'utilisateur.
- Titre de PR avec l'identifiant de tâche de la roadmap (`E02.08 — …`). Description en français :
  - en-tête : `Stack : PR k/n · base … · suivante …` et `Périmètre` ;
  - `## Intention (avant cette PR)` — problème, état antérieur, référence roadmap ;
  - `## Ce qui est implémenté` ;
  - `## Subtilités et arbitrages` — chaque choix, ce qui est volontairement laissé de côté et pourquoi ;
  - `## Vérifications` — tests (comptes), recettes (scénario, environnement, date), échecs préexistants signalés ;
  - `## Déploiement` — migrations, variables, prérequis.
- Après vérification, cocher la tâche dans la copie locale de la roadmap (`docs/ROADMAP.md`, non versionnée) avec la PR et la mention « vérifié en dev, non déployé » ; ne jamais créer de second fichier de suivi.
