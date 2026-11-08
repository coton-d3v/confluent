# Déploiement et exploitation

Guide technique de l'installation de production (API, web, PostgreSQL). Le périmètre et le travail restant sont suivis dans la roadmap produit, tenue hors de ce dépôt (voir `CLAUDE.md`).

## Secrets : uniquement à l'exécution

Aucun secret n'est écrit dans une image Docker (roadmap E02.09).

| Image | Où vivent les secrets | Mécanisme |
|---|---|---|
| API | Doppler (ou variables d'environnement du conteneur) | Le point d'entrée `confluent-entrypoint` lance `doppler run` **si `DOPPLER_TOKEN` est défini au démarrage** ; sinon le processus lit l'environnement fourni par le Compose. |
| Web | Aucun secret : `VITE_API_URL` et `VITE_APP_VERSION` sont publics (ils finissent dans le bundle JavaScript). | Au build, le jeton Doppler est un **secret BuildKit** (`--secret id=DOPPLER_TOKEN`), monté pour la seule commande de build : il n'apparaît ni dans une couche, ni dans les métadonnées, ni dans le cache. |

### Mise en service de l'API avec Doppler

Le jeton de service Doppler (`dp.st.…`) est fourni **au conteneur**, pas à l'image :

```yaml
services:
  api-migrate:
    image: ghcr.io/<org>/confluent-api:production-latest
    command: ['pnpm', '--filter', '@confluent/api', 'db:migrate:deploy']
    environment:
      DOPPLER_TOKEN: ${DOPPLER_TOKEN_API}
  api:
    image: ghcr.io/<org>/confluent-api:production-latest
    environment:
      DOPPLER_TOKEN: ${DOPPLER_TOKEN_API}
```

`DOPPLER_TOKEN_API` vient d'un fichier `.env` sur l'hôte, lisible par l'administrateur seul (`chmod 600`), jamais versionné. Le point d'entrée enveloppe déjà la commande dans `doppler run` : un `command` qui contient lui-même `doppler run -- …` reste fonctionnel mais devient redondant.

### Après le passage à cette configuration

Les images API publiées **avant** E02.09 contenaient le jeton Doppler dans leurs variables d'environnement (`docker inspect`). Il faut :

1. **révoquer** dans Doppler les jetons de service `DOPPLER_TOKEN_API_PRODUCTION` et `DOPPLER_TOKEN_WEB_PRODUCTION`, puis en créer de nouveaux ;
2. mettre à jour les secrets GitHub Actions du même nom et le `.env` de l'hôte ;
3. supprimer de GHCR les anciennes versions de l'image API (ou vérifier qu'elles n'ont jamais été publiques) ;
4. si une image a pu être tirée par un tiers, faire tourner aussi les secrets applicatifs (`JWT_SECRET`, `JWT_REFRESH_SECRET`, mot de passe PostgreSQL, SMTP, S3).

## PostgreSQL privé

- Le service `postgres` des fichiers Compose de production **ne publie aucun port** : il n'est joignable que par les conteneurs du même réseau Docker (`api`, `api-migrate`).
- Ne jamais ajouter de `ports:` au service `postgres` en production. Pour une intervention, utiliser `docker compose exec postgres psql …` ou un tunnel SSH vers l'hôte.
- Comptes (roadmap E02.02) : l'API tourne avec un compte applicatif sans droit de modifier le schéma (`DATABASE_URL`) ; les migrations utilisent un compte distinct propriétaire des tables (`MIGRATION_DATABASE_URL`, lu par `api-migrate`, et `DATABASE_URL` à défaut). Exemple de mise en place :

  ```sql
  CREATE ROLE confluent_migrator LOGIN PASSWORD '…';          -- propriétaire du schéma
  CREATE ROLE confluent_app LOGIN PASSWORD '…';               -- compte de l'API
  GRANT CONNECT ON DATABASE confluent TO confluent_app;
  GRANT USAGE ON SCHEMA public TO confluent_app;
  ALTER DEFAULT PRIVILEGES FOR ROLE confluent_migrator IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO confluent_app;
  ALTER DEFAULT PRIVILEGES FOR ROLE confluent_migrator IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO confluent_app;
  -- tables déjà existantes : GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO confluent_app;
  ```

  Pour une installation existante, où les tables appartiennent à l'ancien compte unique, rendre le schéma et ses objets au migrateur **avant** le premier déploiement avec deux comptes :

  ```sql
  ALTER SCHEMA public OWNER TO confluent_migrator;
  REASSIGN OWNED BY <ancien_compte> TO confluent_migrator;   -- tables, séquences, types énumérés
  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO confluent_app;
  GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO confluent_app;
  ```

  **Choix du compte avec Doppler (R35).** `api-migrate` reçoit `DATABASE_URL` (applicatif) et `MIGRATION_DATABASE_URL`. C'est `apps/api/scripts/migrate-deploy.sh`, exécuté **à l'intérieur** de `doppler run`, qui retient `MIGRATION_DATABASE_URL`. Une `DATABASE_URL` injectée par Doppler ne peut donc plus le remplacer.
  - Si Doppler fournit lui-même `MIGRATION_DATABASE_URL`, c'est cette valeur qui s'applique.
  - Sinon, celle du Compose s'applique, puisque Doppler ne remplace que les noms qu'il connaît.
  - Sans `MIGRATION_DATABASE_URL`, le script le signale et migre avec `DATABASE_URL`.

  Vérification après déploiement :
  - `docker compose logs api-migrate` affiche « using MIGRATION_DATABASE_URL » ;
  - `SELECT current_user` renvoie `confluent_app` depuis l'API ;
  - une tentative de `CREATE TABLE` avec le compte applicatif échoue (`permission denied for schema public`).

  Test sans base : `sh apps/api/scripts/tests/migrate-deploy.test.sh`.

  Les identifiants de développement et de production sont distincts (bases, comptes et projets Doppler séparés) : un identifiant de dev ne doit jamais ouvrir la base de production.

### Chiffrement des connexions

| Réseau entre l'API et PostgreSQL | Règle |
|---|---|
| Même hôte, réseau Docker interne (configuration actuelle) | Pas de TLS requis : le trafic ne quitte pas la machine. |
| Hôtes distincts, réseau privé ou Internet | TLS obligatoire : `DATABASE_URL=…?sslmode=require` (ou `verify-full` avec le certificat de l'autorité), et PostgreSQL configuré avec `ssl = on`. |

Les connexions des navigateurs et des clients MCP passent par Traefik en HTTPS (certificats Let's Encrypt) ; l'API et le web écoutent en HTTP uniquement sur le réseau Docker.

## Installation de référence et scripts de base de données

### Fichiers Compose

| Fichier | Rôle |
|---|---|
| `docker-compose.yml` | Développement local uniquement (PostgreSQL, MinIO, Mailhog). |
| `docker-compose.prod.yml` | Référence versionnée de la production : `postgres` (sans port publié), `api-migrate` (migrations avant démarrage), `api`, `web`. |
| Compose du serveur (Traefik + Doppler) | Variante réellement exécutée ; elle doit reprendre de la référence : `api-migrate` avant `api`, `DOPPLER_TOKEN` fourni à l'exécution, aucun port publié pour PostgreSQL. |

### Avant de déployer des migrations

Les migrations s'appliquent en production **toutes ensemble**, dans une même session, alors qu'en développement elles arrivent souvent une à une. Contrôler la chaîne complète sur une base vide et jetable :

```sh
MIGRATION_CHECK_DATABASE_URL=postgresql://…/base_jetable sh apps/api/scripts/check-migration-chain.sh
```

Le script :
1. applique les migrations antérieures aux formulaires ;
2. insère des données historiques qui entrent en collision une fois transformées en clés (`prisma/checks/forms-history.fixture.sql`) ;
3. déploie tout le reste en une commande ;
4. vérifie clés et réponses (`forms-history.assertions.sql`).

Compléter par un déploiement sur une copie restaurée de la production (voir « Restaurer »).

### Migration en échec

Chaque migration s'exécute dans une transaction : si elle échoue, **elle ne laisse rien en base**, ce qui a été vérifié sur PostgreSQL 16. Prisma l'enregistre toutefois comme échouée dans `_prisma_migrations` et refuse les déploiements suivants (P3009).

1. Lire l'erreur dans `docker compose logs api-migrate`. Vérifier que le schéma n'a pas changé (`prisma migrate status`, tables de la migration absentes).
2. Corriger la migration dans une nouvelle version de l'image, testée avec le contrôle ci-dessus.
3. Marquer l'échec comme annulé : `pnpm --filter @confluent/api exec prisma migrate resolve --rolled-back <nom_de_la_migration>`.
4. Relancer `api-migrate`. En cas de doute sur l'état de la base, restaurer d'abord la sauvegarde prise juste avant le déploiement.

### Ce qui est autorisé en production

| Commande | Production | Rôle |
|---|---|---|
| `db:migrate:deploy` (service `api-migrate`) | ✅ | Applique les migrations versionnées, seule façon de faire évoluer le schéma. |
| `questionnaire:v2` (profil `seed`) | ✅ création seulement | Publie la V2 si elle n'existe pas, en une transaction (dépublication et publication ensemble). Recréer une V2 existante est refusé ; en développement aussi dès qu'elle a des réponses. |
| `db:seed` | ❌ | Données de démonstration (`@localhost.dev`). |
| `db:migrate:reset` | ❌ | Supprime toutes les tables. |
| `prisma db push` | ❌ | Jamais, en aucun environnement partagé : le schéma diverge des migrations. |

Les commandes refusées s'arrêtent avec un message lorsque `NODE_ENV=production` (valeur des images de production). Pour une opération ponctuelle assumée, la relancer avec `CONFLUENT_ALLOW_DESTRUCTIVE=yes`, après une sauvegarde.
