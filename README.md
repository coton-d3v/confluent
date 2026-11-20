# Confluent

Monorepo TypeScript — API NestJS 11 + Web React 19 + package partagé de schémas Zod.

## Structure

```
apps/
├── api/          NestJS 11 + Prisma 5.22 (PostgreSQL)
└── web/          React 19 + Vite 8 + TailwindCSS v4 + shadcn/ui
packages/
└── shared/       Schémas Zod + types TS partagés front/back
```

## Démarrage rapide

Si PostgreSQL et les autres services sont déjà configurés sur le serveur et accessibles depuis Coder, les réutiliser : ne pas démarrer une deuxième stack locale. Le Compose ci-dessous est un exemple de développement à adapter ; le stockage applicatif utilise encore la mémoire tant que l'adaptateur S3 de la roadmap E02 n'est pas livré.

```bash
pnpm install
docker compose up -d                 # seulement si des services locaux sont nécessaires
pnpm db:sync --seed                  # migrations + données de démonstration, dev uniquement
pnpm dev                             # api (:3000) + web (:5173)
```

Les logs préfixés `[api]` / `[web]` apparaissent dans le même terminal. Pour les séparer : `pnpm dev:api` et `pnpm dev:web` dans deux terminaux.

## Documentation

- [docs/ROADMAP.md](docs/ROADMAP.md) — **Référence produit unique** : priorités, épiques, tâches, critères de fin, couverture Moneyplace et décisions ouvertes. Le MCP Claude/ChatGPT est le premier jalon.
- [docs/development.md](docs/development.md) — **Environnement de développement** (services, email, tokens, dépannage, bootstrap admin).
- [docs/database-migrations.md](docs/database-migrations.md) — **Base de données & migrations Prisma** (workflow dev, workflow prod, règles inviolables).
- [docs/api-documentation.md](docs/api-documentation.md) — **Swagger / OpenAPI** (UI : http://localhost:3000/api/docs).
- [docs/archive/README.md](docs/archive/README.md) — **Archives** : anciens cadrages, comparatif Moneyplace, architecture/UX et suivis BMAD. Références historiques, sans valeur de suivi courant.

## Scripts courants

| Commande | Action |
|---|---|
| `pnpm dev` | API + Web (logs interleaved) |
| `pnpm dev:api` / `pnpm dev:web` | Un seul des deux (terminaux séparés) |
| `pnpm db:sync [--seed]` | `migrate deploy` + seed optionnel |
| `pnpm db:migrate:dev --name <x>` | Génère une nouvelle migration |
| `pnpm db:migrate:status` | État de l'historique des migrations ; ne vérifie pas à lui seul tout le schéma |
| `pnpm api:token <email>` | JWT de test (15 min) pour un user seedé |
| `pnpm build` / `pnpm lint` / `pnpm typecheck` | via Turbo |
| `pnpm --filter @confluent/api test` | Tests unitaires API |
| `pnpm --filter @confluent/api test:e2e` | Tests HTTP API avec dépendances simulées ; distincts d'une recette de production |
