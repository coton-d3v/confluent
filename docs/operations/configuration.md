# Configuration

L'API valide sa configuration au démarrage (`apps/api/src/config/config.schema.ts`) et refuse de démarrer si une valeur manque ou est invalide : `Invalid configuration: <VARIABLE>: <raison>` dans son journal. Modèle commenté : `apps/api/.env.example`. Un test (`config-docs.spec.ts`) vérifie que chaque variable du schéma et chaque `VITE_*` du site figurent dans cette page et dans le modèle.

Où mettre les valeurs : projet Doppler ou `.env` de l'hôte en production (voir [deploiement.md § Secrets](../deploiement.md#secrets--uniquement-à-lexécution)) ; `apps/api/.env` pour une installation depuis les sources. Les fichiers qui contiennent des secrets sont en `chmod 600` et jamais versionnés.

Légende : **secret** = ne jamais l'écrire dans le dépôt, une image, un ticket ou un journal.

## API — validées au démarrage

| Variable | Requise | Défaut | Effet et précautions |
|---|---|---|---|
| `DATABASE_URL` | oui | — | Compte **applicatif** PostgreSQL (lecture/écriture des tables, aucun droit sur le schéma). Hôte distinct : ajouter `?sslmode=require`. **Secret.** |
| `PORT` | non | `3000` | Port HTTP d'écoute de l'API. |
| `NODE_ENV` | non | `development` | `development`, `test` ou `production` ; toute autre valeur est refusée. **Toujours `production` en production** (les images le fixent ; à écrire dans `.env` depuis les sources). En production : cookie de session `Secure`, Swagger derrière mot de passe, stockage `memory` refusé, seed et remise à zéro refusés, `pnpm api:token` refusé (code 4). |
| `FRONTEND_URL` | oui | — | Adresse du site, sans chemin, par exemple `https://confluent.example.org`. Seule origine autorisée par CORS, base des liens envoyés par email (connexion, invitations, notifications) et origine acceptée par `/mcp`. Un `/` final est retiré. |
| `API_PUBLIC_URL` | oui en production | `http://localhost:3000` | Adresse publique de l'API (un `/` final est retiré). Émetteur OAuth (`issuer`) et ressource MCP (`<API_PUBLIC_URL>/mcp`). **La changer invalide toutes les connexions d'applications IA** : leurs jetons portent l'ancienne ressource ; chaque utilisateur doit reconnecter son application. |
| `MCP_ALLOWED_ORIGINS` | non | vide | Origines de navigateur supplémentaires autorisées à appeler `/mcp`, séparées par des virgules. Les clients serveur (Claude, ChatGPT) n'envoient pas d'`Origin` et n'en ont pas besoin. Laisser vide sauf besoin identifié. |
| `SMTP_HOST` | oui | — | Relais SMTP. |
| `SMTP_PORT` | oui | — | `587` : STARTTLS **exigé** (échec si le serveur ne le propose pas) ; `465` : TLS direct ; `25` : sans TLS exigé, pour un relais local seulement. Tout autre port exige STARTTLS. |
| `SMTP_USER` | non | vide | Identifiant SMTP ; vide = pas d'authentification. |
| `SMTP_PASSWORD` | non | vide | Mot de passe ou clé SMTP. **Secret.** |
| `SMTP_FROM` | oui | — | Adresse d'expédition (une adresse seule, sans nom), vérifiée chez le relais. |
| `JWT_SECRET` | oui | — | 32 caractères au moins (`openssl rand -hex 32`). Signe les jetons d'accès des sessions web (15 min) et les jetons des formulaires publics. **Secret.** Le changer : sessions à rafraîchir, formulaires publics ouverts à recharger ([incidents.md](incidents.md#un-secret-est-compromis)). |
| `JWT_REFRESH_SECRET` | oui | — | 32 caractères au moins, **différent** de `JWT_SECRET`. Signe les jetons de renouvellement des sessions web (7 jours). **Secret.** Le changer déconnecte tout le monde. |
| `STORAGE_DRIVER` | non | `s3` | `s3` ou `memory`. `memory` garde les fichiers dans le processus (perdus à l'arrêt) : tests seulement, **refusé** avec `NODE_ENV=production`. |
| `S3_ENDPOINT` | oui | — | Adresse du serveur S3 (adressage par chemin). Exigée même avec `memory` (valeur quelconque). |
| `S3_REGION` | oui | — | Région de signature ; Garage n'accepte que `garage`. |
| `S3_BUCKET` | oui | — | Bucket **privé** de l'environnement (un par environnement). |
| `S3_ACCESS_KEY` | oui | — | Clé limitée à la lecture/écriture de ce bucket. **Secret.** |
| `S3_SECRET_KEY` | oui | — | **Secret.** |
| `SWAGGER_ENABLED` | non | `true` | Sert la documentation OpenAPI sur `/api/docs` et `/api/docs-json`. `false` : aucune de ces routes n'existe. Recommandé : `false` en production, sauf besoin. |
| `SWAGGER_USER` | non | `admin` | Identifiant HTTP Basic de Swagger, en production seulement. |
| `SWAGGER_PASSWORD` | non | `change-me-in-prod-min-8-chars` | 8 caractères au moins. Mot de passe HTTP Basic de Swagger en production. **Secret.** Tant qu'il garde la valeur par défaut (publique), Swagger n'est **pas** servi en production et le journal le signale. En développement, Swagger est ouvert sans mot de passe. |
| `RETENTION_PURGE_INTERVAL_MINUTES` | non | `360` | Fréquence de la purge de conservation (E10.10), de `0` à `10080` minutes ; `0` la désactive. Première passe une minute après le démarrage ; chaque instance la lance, un verrou PostgreSQL empêche deux passes simultanées. Jamais avec `NODE_ENV=test`. Les durées conservées sont fixées dans le code (`RETENTION_DAYS`, `packages/shared/src/schemas/privacy.schema.ts`) et affichées sur la page Confidentialité. |

## API — lues en dehors du schéma

| Variable | Où | Effet |
|---|---|---|
| `MIGRATION_DATABASE_URL` | service `api-migrate`, commande `pnpm db:migrate` | Compte propriétaire du schéma pour `prisma migrate deploy` (`apps/api/scripts/migrate-deploy.sh`). Absente : migration avec `DATABASE_URL` (message dans le journal). Ne pas la donner au service `api`. **Secret.** |
| `DOPPLER_TOKEN` | conteneurs `api`, `api-migrate` | Jeton de service Doppler : le point d'entrée lance `doppler run`. Absent : l'environnement du conteneur est utilisé. **Secret.** |
| `APP_VERSION` | build des images (argument) | Version affichée par `GET /`, Swagger, le serveur MCP et le badge du site (`dev` à défaut). |
| `SEED_ADMIN_EMAIL` | `pnpm db:seed` (développement) | Ajoute un administrateur aux données de démonstration. Sans effet en production, où le seed est refusé. |
| `CONFLUENT_ALLOW_DESTRUCTIVE` | scripts | `yes` force une seule fois une commande refusée en production (`db:seed`, `db:migrate:reset`). À ne pas utiliser sans sauvegarde. |
| `EMAIL_TEST_TO` | `pnpm --filter @confluent/api email:test` | Destinataire des emails de test. |
| `TEST_DATABASE_URL`, `MIGRATION_CHECK_DATABASE_URL` | tests PostgreSQL, contrôle de la chaîne de migrations | Bases **jetables** ; les scripts refusent la base de l'application. |

## Site — fixées au build

Les variables `VITE_*` sont écrites dans le JavaScript livré : **publiques**, jamais de secret. Les changer impose de reconstruire le site.

| Variable | Défaut | Effet |
|---|---|---|
| `VITE_API_URL` | `http://localhost:3000` | Adresse de l'API appelée par le site (`API_PUBLIC_URL`). |
| `APP_VERSION` | `dev` | Version affichée dans le site (exposée au code sous `VITE_APP_VERSION`, que l'on ne fixe pas soi-même). |
| `VITE_HOST` | `localhost` | Serveur de développement seulement : `true` écoute sur toutes les interfaces. |
| `VITE_ALLOWED_HOSTS` | — | Serveur de développement seulement : noms d'hôte acceptés derrière un proxy. |

## Compose de référence (`docker-compose.prod.yml`)

| Variable | Effet |
|---|---|
| `API_IMAGE`, `WEB_IMAGE` | Images à déployer (étiquette versionnée de préférence). |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | Super-utilisateur et base créés au premier démarrage du volume PostgreSQL. **Secret.** |
| `WEB_PORT` | Port publié du site sur l'hôte (`80`) ; sans objet derrière Traefik. |
| `BACKUP_*`, `DOCUMENTS_REMOTE`, `RCLONE_CONFIG_OFFSITE_*` | Service `backup` : reporté en E11 (D09), non validé. |

## Limites fixées dans le code

Non configurables ; les changer demande une nouvelle version.

| Limite | Valeur | Réponse au-delà |
|---|---|---|
| Taille d'un fichier | 20 Mo | `413` |
| Documents d'une entreprise, toutes versions | 500 Mo | `507 COMPANY_DOCUMENTS_FULL` |
| Envois simultanés par compte / par processus API | 3 / 8 | `429` avec `Retry-After: 5` |
| Requêtes par adresse IP | 100 par minute | `429` |
| Lien de connexion | 15 min, usage unique | lien refusé |
| Session web | accès 15 min, renouvellement 7 jours | reconnexion |
