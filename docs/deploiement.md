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
- Comptes : l'API utilise un compte dédié non administrateur ; les migrations peuvent utiliser un compte distinct disposant des droits DDL (roadmap E02.02).

### Chiffrement des connexions

| Réseau entre l'API et PostgreSQL | Règle |
|---|---|
| Même hôte, réseau Docker interne (configuration actuelle) | Pas de TLS requis : le trafic ne quitte pas la machine. |
| Hôtes distincts, réseau privé ou Internet | TLS obligatoire : `DATABASE_URL=…?sslmode=require` (ou `verify-full` avec le certificat de l'autorité), et PostgreSQL configuré avec `ssl = on`. |

Les connexions des navigateurs et des clients MCP passent par Traefik en HTTPS (certificats Let's Encrypt) ; l'API et le web écoutent en HTTP uniquement sur le réseau Docker.
