# Base de données & migrations Prisma

Ce fichier décrit les procédures PostgreSQL/Prisma. Les priorités et les travaux d'infrastructure sont suivis dans [la roadmap](ROADMAP.md), épique E02.

> Avant toute écriture, identifier la base ciblée. `pnpm db:sync --seed` est réservé aux données de démonstration en développement. Le service de migration du déploiement doit utiliser la même cible que l'API.

Référence unique pour toute opération sur la DB Confluent.

---

## Prérequis (une fois par machine)

```bash
# 1. Installer les deps + générer le client Prisma (via postinstall)
pnpm install

# 2. Démarrer les services dev
docker compose up -d                          # postgres + minio + mailhog

# 3. Vérifier la cible et l'historique, sans appliquer de migration
pnpm db:migrate:status
```

Le compte utilisé est celui de `DATABASE_URL` dans la configuration de l'API. Si les services existent déjà sur le serveur, ne pas lancer une deuxième instance de PostgreSQL.

Pour générer des migrations, `migrate dev` utilise une base shadow. Sur le serveur partagé, faire préparer une base dédiée, par exemple `confluent_dev_shadow`, et un accès limité à celle-ci. Avec Prisma 5.22, son usage explicite demande `shadowDatabaseUrl = env("SHADOW_DATABASE_URL")` dans la datasource et la variable correspondante ; ce réglage reste à implémenter. Ne jamais utiliser une base contenant des données à conserver comme base shadow.

---

## Flow dev

### Premier lancement

```bash
pnpm db:sync --seed     # applique toutes les migrations + seed idempotent
pnpm dev                # api + web
```

### Ajouter une migration (changement de schéma)

```bash
# 1. Édite apps/api/prisma/schema.prisma

# 2. Génère + applique la migration
pnpm db:migrate:dev --name add_user_phone

# 3. Relis le SQL produit (apps/api/prisma/migrations/<ts>_add_user_phone/migration.sql)

# 4. Commit
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/
git commit -m "feat(db): add User.phone"
```

### Commandes quotidiennes

```bash
pnpm db:migrate:status  # historique migrations/ ↔ DB (lecture seule)
pnpm db:studio          # UI Prisma Studio (http://localhost:5555)
pnpm db:seed            # rejoue le seed (idempotent)
pnpm db:migrate:reset   # drop + recreate + apply all (destructif, dev only)
```

---

## Flow prod

### Déploiement standard

```bash
# En CI/CD ou manuellement sur le serveur
ssh prod
cd /srv/confluent
git pull                                               # récupère migrations/
export API_IMAGE=ghcr.io/confluent/api:sha-abc123
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

Ce qui se passe :

1. `postgres` démarre, passe son healthcheck.
2. `api-migrate` (one-shot) attend postgres healthy, exécute `prisma migrate deploy`, exit.
3. `api` démarre uniquement si `api-migrate` exit(0). En cas d'échec, le nouveau démarrage est bloqué ; le maintien de l'ancienne version dépend de la procédure de déploiement et n'est pas garanti par ce Compose.

### Vérifications post-deploy

```bash
docker compose -f docker-compose.prod.yml logs api-migrate   # doit dire "applied" ou "No pending migrations"
docker compose -f docker-compose.prod.yml logs api --tail=20
```

### Redémarrer l'API sans rejouer les migrations

```bash
docker compose -f docker-compose.prod.yml restart api
```

---

## Prod vs Dev — autorisations

| Commande | Dev | CI | Prod |
|---|:---:|:---:|:---:|
| `db:migrate` (= `migrate deploy`) | ✅ | ✅ | ✅ (via `api-migrate`) |
| `db:migrate:dev` | ✅ | ❌ | ❌ |
| `db:migrate:status` | ✅ | ✅ | ✅ |
| `db:migrate:reset` | ✅ | ❌ | ❌ |
| `db:seed` / `db:sync` / `db:studio` | ✅ | ❌ | ❌ |
| `prisma db push` | ❌ | ❌ | ❌ |

---

## Troubleshooting

### `P3014` — permission denied to create database

La création automatique de la base shadow n'est pas autorisée. Prévoir une base shadow dédiée et sa configuration explicite ; voir [Prérequis](#prérequis-une-fois-par-machine).

### Drift détecté

`pnpm db:migrate:status` compare l'historique des migrations, pas toutes les colonnes et contraintes du schéma réel :

- **Migrations locales absentes de la DB** → `pnpm db:migrate`.
- **Migrations en DB absentes du code** → reconstituer le SQL, commit.
- **Schéma modifié sans migration** → comparer le schéma réel, préparer une correction revue et vérifier le SQL. Ne marquer une migration « applied » que si son effet exact est déjà présent et vérifié.

### Rollback

Prisma n'a **pas de rollback auto**. Crée une nouvelle migration qui inverse le changement, déploie-la normalement. **Ne jamais** supprimer un fichier de `migrations/` déjà déployé.

### Baseline d'une DB existante

```bash
pnpm --filter @confluent/api exec prisma db pull
pnpm --filter @confluent/api exec prisma migrate diff \
  --from-empty --to-schema-datamodel ./apps/api/prisma/schema.prisma --script \
  > apps/api/prisma/migrations/<ts>_init/migration.sql
pnpm --filter @confluent/api exec prisma migrate resolve --applied <ts>_init
```

### Migration risquée (gros volume, lock)

Utilise `migrate dev --create-only` → édite le SQL à la main (`CREATE INDEX CONCURRENTLY`, `NOT VALID` + `VALIDATE CONSTRAINT`…) → documente le risque dans la PR.

---

## Règles inviolables

1. **Un `migration.sql` mergé est immuable.** Correction = nouvelle migration.
2. **`DATABASE_URL` prod vit en env runtime**, jamais commité. Validation Zod au boot ([config.schema.ts](../apps/api/src/config/config.schema.ts)).
3. **`audit_log` et `questionnaire_versions` sont append-only.** Pas d'`UPDATE`/`DELETE` applicatif.
4. **Le seed n'existe qu'en dev.** La prod se remplit via l'application.
5. **Pas de `prisma db push`**, jamais, nulle part.

---

## Structure de fichiers

```
apps/api/
├── Dockerfile
├── prisma/
│   ├── schema.prisma                  # source de vérité
│   ├── seed.ts                        # dev only, idempotent
│   └── migrations/
│       ├── migration_lock.toml
│       └── <timestamp>_<name>/migration.sql
└── scripts/
    └── db-sync.ts                     # wrapper dev

docker-compose.yml                     # dev : postgres + minio + mailhog
docker-compose.prod.yml                # prod : postgres + api-migrate + api
```
