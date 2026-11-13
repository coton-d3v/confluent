# Installation

Deux chemins : les **images publiées** sur GHCR (chemin de la production) ou une **installation depuis les sources**. Dans les deux cas, la suite est la même : [configuration](configuration.md), [migrations](migrations.md), [premier administrateur](premier-admin.md).

## Architecture

```
navigateur ──HTTPS──► proxy (Traefik) ──► web  : nginx, site statique (port 80)
client MCP ──HTTPS──►                 └─► api  : Node (port 3000) — REST /v1, OAuth (/authorize, /token,
                                                   /register, /revoke, /.well-known/*), /mcp
                                          api ──► PostgreSQL 16 · bucket S3 privé · relais SMTP
```

- Le site et l'API ont **deux adresses HTTPS du même domaine**, par exemple `https://confluent.example.org` (site) et `https://api.confluent.example.org` (API). Le cookie de session est `SameSite=Strict` et `Secure` en production : deux domaines différents (`example.org` / `example.net`) empêchent de rester connecté.
- Le proxy termine TLS ; l'API et le site écoutent en HTTP sur le réseau interne. Il ne doit ni ajouter ni retirer d'en-tête `X-Robots-Tag`, ni réécrire `/w/<slug>` (voir [deploiement.md § Indexation](../deploiement.md#indexation-par-les-moteurs-de-recherche-e0906)). L'API fait confiance à **un** proxy (`trust proxy 1`) pour l'adresse IP du client.
- PostgreSQL n'est joignable que depuis l'API et le service de migration (aucun port publié).

## Prérequis

| Élément | Version ou exigence |
|---|---|
| Node.js | 24 (images et CI) ; 22 au minimum (`engines`) — sources seulement |
| pnpm | 10.33.0, fixé par `packageManager` : `corepack enable` suffit — sources seulement |
| Docker Engine + Compose v2 | images seulement |
| PostgreSQL | 16 (image `postgres:16-alpine` en production et en CI) ; deux comptes : migrations et application ([deploiement.md § PostgreSQL privé](../deploiement.md#postgresql-privé)) |
| Stockage S3 | bucket **privé** compatible S3, adressage par chemin (Garage en production, région `garage`) ; une clé limitée à ce bucket |
| SMTP | relais authentifié (Brevo en production) ; port 587 (STARTTLS exigé) ou 465 (TLS) ; le port 25 n'est accepté sans TLS que pour un relais local |
| DNS et TLS | deux noms (site et API) pointant vers le proxy ; certificats (Let's Encrypt via Traefik) |
| Réseau sortant de l'API | HTTPS vers Internet : les clients MCP publient leur fiche (CIMD) à une adresse que l'API lit |

## A. Depuis les images publiées (GHCR)

Les images sont construites par `.github/workflows/production-api.yml` et `production-web.yml` à chaque merge dans `production`, après la CI :

| Image | Étiquettes |
|---|---|
| `ghcr.io/coton-d3v/confluent-api` | `production-latest`, `production-api-vX.Y.Z` |
| `ghcr.io/coton-d3v/confluent-web` | `production-latest`, `production-web-vX.Y.Z` |

Préférer une étiquette versionnée à `production-latest` : c'est elle qui permet de revenir à la version précédente. Les paquets ne sont pas publics : se connecter avec un jeton GitHub qui a le droit `read:packages`.

```sh
echo "$GHCR_TOKEN" | docker login ghcr.io -u <compte-github> --password-stdin
```

**Limite de l'image web.** L'adresse de l'API (`VITE_API_URL`) est écrite dans le site au moment du build, à partir du projet Doppler de la production. L'image web publiée ne sert donc que l'installation pour laquelle elle a été construite. Pour une autre adresse, construire le site depuis les sources (étape B.3) et le servir avec la configuration nginx du dépôt.

### A.1 Fichiers sur le serveur

```sh
sudo mkdir -p /srv/confluent && cd /srv/confluent
# Fichier Compose de référence (à adapter au proxy : voir plus bas)
curl -fsSLO https://raw.githubusercontent.com/coton-d3v/confluent/production/docker-compose.prod.yml
install -m 600 /dev/null .env      # lisible par l'administrateur seul, jamais versionné
```

Remplir `.env` (variables : [configuration.md](configuration.md)) :

```env
API_IMAGE=ghcr.io/coton-d3v/confluent-api:production-api-vX.Y.Z
WEB_IMAGE=ghcr.io/coton-d3v/confluent-web:production-web-vX.Y.Z
POSTGRES_USER=postgres
POSTGRES_PASSWORD=change-me-postgres-superuser
POSTGRES_DB=confluent
DATABASE_URL=postgresql://confluent_app:change-me-app@postgres:5432/confluent
MIGRATION_DATABASE_URL=postgresql://confluent_migrator:change-me-migrator@postgres:5432/confluent
FRONTEND_URL=https://confluent.example.org
API_PUBLIC_URL=https://api.confluent.example.org
SMTP_HOST=smtp-relay.example.org
SMTP_PORT=587
SMTP_USER=change-me-smtp-login
SMTP_PASSWORD=change-me-smtp-key
SMTP_FROM=noreply@example.org
JWT_SECRET=<openssl rand -hex 32>
JWT_REFRESH_SECRET=<openssl rand -hex 32, différent>
S3_ENDPOINT=https://s3.example.org
S3_REGION=garage
S3_BUCKET=confluent-production
S3_ACCESS_KEY=change-me-s3-key
S3_SECRET_KEY=change-me-s3-secret
```

Avec Doppler, le `.env` ne contient que `API_IMAGE`, `WEB_IMAGE`, les variables `POSTGRES_*` et `DOPPLER_TOKEN` ; le reste vient du projet Doppler ([deploiement.md § Secrets](../deploiement.md#secrets--uniquement-à-lexécution)).

Le fichier de référence publie les ports `3000` (API) et `80` (site) sur l'hôte. Derrière Traefik, retirer ces `ports:` et ajouter au service `api` et au service `web` les étiquettes de routage vers leurs noms (port interne 3000 et 80). Le service `api` du fichier de référence ne transmet pas `SWAGGER_*` ni `RETENTION_PURGE_INTERVAL_MINUTES` : leurs valeurs par défaut s'appliquent (Swagger désactivé en production tant qu'aucun mot de passe n'est fourni, purge toutes les 6 h ; voir [configuration.md](configuration.md)).

### A.2 Base de données

```sh
docker compose -f docker-compose.prod.yml up -d postgres
docker compose -f docker-compose.prod.yml exec -T postgres psql -U postgres -d confluent <<'SQL'
CREATE ROLE confluent_migrator LOGIN PASSWORD 'change-me-migrator';
CREATE ROLE confluent_app LOGIN PASSWORD 'change-me-app';
ALTER SCHEMA public OWNER TO confluent_migrator;
GRANT CONNECT ON DATABASE confluent TO confluent_app;
GRANT USAGE ON SCHEMA public TO confluent_app;
ALTER DEFAULT PRIVILEGES FOR ROLE confluent_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO confluent_app;
ALTER DEFAULT PRIVILEGES FOR ROLE confluent_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO confluent_app;
SQL
```

Les mots de passe sont ceux de `DATABASE_URL` et `MIGRATION_DATABASE_URL`. Explications et reprise d'une base existante : [deploiement.md § PostgreSQL privé](../deploiement.md#postgresql-privé).

### A.3 Démarrage

```sh
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d postgres api-migrate api web   # sans « backup » (E11)
docker compose -f docker-compose.prod.yml logs api-migrate   # « using MIGRATION_DATABASE_URL », migrations appliquées
docker compose -f docker-compose.prod.yml logs api --tail=30 # « Document storage reachable. », « Application is running »
```

`api` ne démarre que si `api-migrate` s'est terminé sans erreur ([migrations.md](migrations.md)). Le service `backup` du fichier de référence relève d'E11 (non validé) et se construit depuis `ops/backup`, absent d'une installation par images : il est volontairement exclu de la commande ci-dessus ; ne jamais lancer `up -d` sans liste de services tant que sa destination n'est pas décidée.

Passer ensuite à [Vérifier l'installation](#vérifier-linstallation), puis au [premier administrateur](premier-admin.md).

## B. Depuis les sources

### B.1 Code et dépendances

```sh
git clone https://github.com/coton-d3v/confluent.git && cd confluent
git switch --detach api-vX.Y.Z      # ou rester sur `production`
corepack enable
pnpm install --frozen-lockfile      # génère aussi le client Prisma
```

L'avertissement « Ignored build scripts: @scarf/scarf, msw » est sans effet.

### B.2 API

```sh
pnpm --filter @confluent/shared build
pnpm --filter @confluent/api build
install -m 600 apps/api/.env.example apps/api/.env   # puis le remplir : configuration.md
```

L'API lit `apps/api/.env` (et `apps/api/.env.local`, prioritaire) dans le répertoire où elle démarre. En production, y mettre au moins `NODE_ENV=production` : sans cette ligne, l'API démarre en mode développement (Swagger ouvert, cookie non `Secure`).

Le compte de migration n'est **pas** dans ce fichier (l'API n'en a pas besoin) : il est lu dans l'environnement de la commande de migration ([migrations.md](migrations.md)).

```sh
install -m 600 /dev/null /etc/confluent/migrate.env
echo "MIGRATION_DATABASE_URL='postgresql://confluent_migrator:change-me-migrator@db.example.org:5432/confluent'" > /etc/confluent/migrate.env
( set -a; . /etc/confluent/migrate.env; set +a; pnpm db:migrate )
```

Démarrer l'API (sous un gestionnaire de processus : systemd, supervisord…, répertoire de travail `apps/api`) :

```sh
pnpm --filter @confluent/api start:prod      # = node dist/main dans apps/api
```

Sans base joignable, l'API s'arrête au démarrage (`Failed to start application`) : le gestionnaire de processus doit la relancer.

### B.3 Site

```sh
VITE_API_URL=https://api.confluent.example.org APP_VERSION=X.Y.Z \
  pnpm --filter @confluent/web build
```

`APP_VERSION` sans préfixe (le site affiche `vX.Y.Z`).

Servir `apps/web/dist` avec la configuration du dépôt (`apps/web/nginx.conf` : en-têtes `X-Robots-Tag`, page publique `/w/<slug>`, compression, cache), comme le fait la CI :

```sh
docker run -d --name confluent-web --restart unless-stopped -p 8080:80 \
  -v "$PWD/apps/web/dist:/usr/share/nginx/html:ro" \
  -v "$PWD/apps/web/nginx.conf:/etc/nginx/conf.d/default.conf:ro" nginx:alpine
```

Sans Docker, reprendre les blocs `location` de `apps/web/nginx.conf` dans le nginx de l'hôte, avec `root` sur `apps/web/dist`.

## Vérifier l'installation

```sh
curl -fsS https://api.confluent.example.org/          # {"status":"ok","service":"confluent-api","version":"…"}
curl -fsS https://api.confluent.example.org/.well-known/oauth-authorization-server | head -c 200
curl -fsSI https://confluent.example.org/ | grep -i x-robots-tag   # noindex, nofollow
```

- `GET /` de l'API répond sans interroger la base : il prouve que le processus tourne, pas que PostgreSQL ou le stockage répondent. Le journal de démarrage dit si le bucket est joignable (`Document storage reachable.`).
- `issuer` du document OAuth doit être exactement `API_PUBLIC_URL` (suivi d'un `/`).
- Ouvrir le site, demander un lien de connexion avec l'adresse du premier administrateur ([premier-admin.md](premier-admin.md)).
