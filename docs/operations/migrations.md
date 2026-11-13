# Migrations et mises à jour

Le schéma n'évolue que par les migrations versionnées de `apps/api/prisma/migrations/`, appliquées par `prisma migrate deploy` (script `apps/api/scripts/migrate-deploy.sh`). Jamais `prisma db push`, `migrate dev` ni `migrate reset` sur une base partagée. Procédures Prisma détaillées : [database-migrations.md](../database-migrations.md) ; contrôles et migration en échec : [deploiement.md](../deploiement.md#avant-de-déployer-des-migrations).

## Quel compte

La migration utilise `MIGRATION_DATABASE_URL` (propriétaire du schéma) si elle est définie, sinon `DATABASE_URL`, et l'écrit dans son journal (`migrate-deploy: using MIGRATION_DATABASE_URL`). L'API n'a que des droits sur les données : une migration lancée avec son compte échoue (`permission denied for schema public`).

## Appliquer les migrations

Images :

```sh
docker compose -f docker-compose.prod.yml run --rm api-migrate
```

Sources (le compte de migration vient de l'environnement de la commande, pas de `apps/api/.env`) :

```sh
( set -a; . /etc/confluent/migrate.env; set +a; pnpm db:migrate )
```

Sortie attendue : `All migrations have been successfully applied.` ou `No pending migrations to apply.`

## État

```sh
# images (passe par Doppler s'il est configuré)
docker compose -f docker-compose.prod.yml run --rm --no-deps api-migrate pnpm --filter @confluent/api db:migrate:status
# sources
pnpm db:migrate:status
```

`Database schema is up to date!` : toutes les migrations du code sont appliquées. Le statut compare l'historique (`_prisma_migrations`), pas chaque colonne. Un code de sortie non nul signale une migration en attente ou en échec.

## Déployer une nouvelle version

Les migrations sont dans l'image de l'API : la nouvelle image applique les siennes **avant** que la nouvelle API démarre. L'ancienne API continue de servir pendant la migration.

1. Lire la PR ou la release : migrations, nouvelles variables, prérequis (section « Déploiement » de chaque PR).
2. Avant une migration risquée sur des données existantes, la rejouer sur une base jetable : `MIGRATION_CHECK_DATABASE_URL=… sh apps/api/scripts/check-migration-chain.sh` (voir [deploiement.md](../deploiement.md#avant-de-déployer-des-migrations)). Aucune sauvegarde automatique validée n'existe avant E11 (D09) : décider au cas par cas d'un `pg_dump` manuel.
3. Changer `API_IMAGE` et `WEB_IMAGE` dans `.env` (étiquettes versionnées), puis :

   ```sh
   docker compose -f docker-compose.prod.yml pull api-migrate api web
   docker compose -f docker-compose.prod.yml run --rm api-migrate     # échec = arrêt ici, l'ancienne API tourne encore
   docker compose -f docker-compose.prod.yml up -d api web
   ```

4. Vérifier : `curl -fsS https://api.confluent.example.org/` renvoie la nouvelle `version` ; `docker compose … logs api --tail=30` sans erreur ; connexion au site.

Ordre API / site : une PR web adaptée à une API plus stricte est mergée avant elle ; déployer l'API puis le site sauf indication contraire de la PR. Le site rechargé après un déploiement charge la nouvelle version tout seul (pages HTML en `no-cache`).

## Revenir à une version précédente

Prisma ne défait pas une migration. Pour chaque migration depuis `20261112000000_companies`, un script de retour arrière existe : `apps/api/prisma/checks/<migration>.down.sql`. Son en-tête dit ce qui serait perdu et dans quel ordre l'appliquer ; il est exercé par les tests PostgreSQL (`apps/api/test/pg/`).

1. Arrêter l'API : `docker compose -f docker-compose.prod.yml stop api`.
2. Défaire les migrations **de la plus récente à la plus ancienne**, chacune dans une transaction, avec le compte de migration. Si l'en-tête l'exige, accepter la perte explicitement dans la même transaction :

   ```sh
   psql "$MIGRATION_DATABASE_URL" --single-transaction -v ON_ERROR_STOP=1 \
     -c "SET LOCAL confluent.accept_privacy_loss = 'on'" \
     -f apps/api/prisma/checks/20261215000000_privacy.down.sql \
     -c "DELETE FROM \"_prisma_migrations\" WHERE migration_name = '20261215000000_privacy'"
   ```

   Avec les images (PostgreSQL sans port publié), le même appel dans le conteneur, le script lu sur l'entrée standard (fichier pris au tag de la version déployée) :

   ```sh
   docker compose -f docker-compose.prod.yml exec -T postgres \
     psql -U confluent_migrator -d confluent --single-transaction -v ON_ERROR_STOP=1 \
     -c "SET LOCAL confluent.accept_privacy_loss = 'on'" -f - \
     -c "DELETE FROM \"_prisma_migrations\" WHERE migration_name = '20261215000000_privacy'" \
     < 20261215000000_privacy.down.sql
   ```

   Sans le `SET LOCAL`, le script refuse dès qu'il trouve des données qu'il effacerait (`… would be lost …`), et rien n'est modifié, la ligne de `_prisma_migrations` comprise.
3. Remettre l'ancienne image (`API_IMAGE`, `WEB_IMAGE`) et `docker compose … up -d api web`. Ne pas relancer `api-migrate` avec la nouvelle image, qui réappliquerait la migration.
4. `db:migrate:status` avec l'ancienne image : `Database schema is up to date!`.

Une valeur ajoutée à un type énuméré PostgreSQL ne peut pas être retirée : les scripts le disent, l'ancienne application l'ignore.

## Migration en échec

Voir [deploiement.md § Migration en échec](../deploiement.md#migration-en-échec) : la migration est annulée par sa transaction, Prisma la marque en échec (`P3009`), on corrige dans une nouvelle image puis `prisma migrate resolve --rolled-back <migration>` avant de relancer `api-migrate`.
