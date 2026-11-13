# Incidents

Commandes données pour le Compose de référence (`docker compose -f docker-compose.prod.yml …`, abrégé `dc`) ; depuis les sources, lire la sortie du processus API.

```sh
alias dc='docker compose -f docker-compose.prod.yml'
```

## Journaux et sondes

| Où | Quoi |
|---|---|
| `dc logs api --since 1h` | Journal de l'API (sortie standard, format Nest : `[Contexte] message`). Jamais de lien de connexion, jeton ni secret ; des adresses email et identifiants de compte y figurent. |
| `dc logs api-migrate` | Dernière migration : compte utilisé, migrations appliquées ou erreur. |
| `dc logs web` | Accès nginx du site. |
| `dc logs postgres` | PostgreSQL. |
| `GET <API_PUBLIC_URL>/` | `{"status":"ok","service":"confluent-api","version":"…"}` : le processus répond. **N'interroge ni la base ni le stockage.** |
| `dc exec postgres pg_isready -U postgres` | La base accepte les connexions. |

Une erreur inattendue renvoie au client `500 INTERNAL_ERROR` (« Une erreur inattendue est survenue… ») sans détail ; la cause est dans le journal, ligne `[GlobalExceptionFilter] Unhandled exception on <méthode> <route>` suivie de la pile.

Lignes utiles au démarrage : `Document storage reachable.` / `Document storage unreachable: …`, `Application is running on: …`, `Swagger UI: …` ou `Swagger UI not served: …`. Toutes les 6 h (par défaut) : `[RetentionService] retention purge: {…}` ou `retention purge failed: …`.

## L'API ne répond plus

1. `dc ps` : état de `api` et `api-migrate`. `api` absent après un déploiement : `api-migrate` a échoué, voir [migrations.md](migrations.md#migration-en-échec).
2. `dc logs api --tail=100` :
   - `Invalid configuration: <VARIABLE>: …` → corriger la variable ([configuration.md](configuration.md)), puis `dc up -d --no-deps --force-recreate api` (voir [ci-dessous](#un-secret-est-compromis) pourquoi) ;
   - `Can't reach database server` au démarrage → voir la section suivante ;
   - arrêt sans message, redémarrages en boucle → mémoire : `docker stats`, section [Pic de mémoire ou de disque](#pic-de-mémoire-ou-de-disque).
3. `dc restart api`. Un site ouvert pendant la panne affiche « Confluent ne répond pas » avec un bouton pour réessayer ; les sessions sont conservées.

## La base est injoignable

Symptômes : toutes les pages de données en `500 INTERNAL_ERROR`, `GET /` toujours `ok`, journal `Can't reach database server at …`.

1. `dc ps postgres`, `dc logs postgres --tail=50`, `df -h` (volume plein ?).
2. Redémarrer PostgreSQL : `dc up -d postgres`. L'API se reconnecte seule à la requête suivante, sans redémarrage (vérifié le 13/11/2026).
3. Une API (re)démarrée pendant la panne s'arrête dès le démarrage (`Failed to start application`) et redémarre en boucle (`restart: unless-stopped`) jusqu'au retour de la base ; sinon `dc up -d api` une fois la base revenue.

Aucune donnée confirmée n'est perdue par une coupure : chaque écriture est une transaction. La restauration d'une base perdue relève d'E11 (D09).

## Le stockage des documents est injoignable

Symptômes : au démarrage `Document storage unreachable: …` ; dépôt d'un document ou d'un logo refusé en `503` avec « Le stockage … est momentanément indisponible : … n'a pas été enregistré. Réessayez dans quelques instants. » ; téléchargements impossibles ; dans les listes, les documents apparaissent « indisponibles » sans bloquer le dossier.

1. Vérifier l'adresse et le service S3 (`S3_ENDPOINT`, réseau, certificat), la région (`garage` pour Garage : une autre donne `SignatureDoesNotMatch`) et la clé (`AccessDenied`).
2. Rien n'est créé en base sans fichier : une fois le stockage revenu, les personnes redéposent leurs fichiers. Pas besoin de redémarrer l'API ; le redémarrage confirme seulement l'accès dans le journal.
3. `507 STORAGE_FULL` (« espace de stockage plein ») : quota du bucket atteint, à augmenter côté S3.
4. Fichiers « perdus » (objet absent du bucket) : `dc run --rm --no-deps api pnpm --filter @confluent/api documents:audit` liste les versions concernées ([deploiement.md § Pièces perdues](../deploiement.md#pièces-perdues)).

## Emails non envoyés

Symptômes : liens de connexion ou invitations jamais reçus. Le site répond toujours « Un lien de connexion vous a été envoyé » (il ne dit pas si l'adresse existe).

1. `dc logs api | grep -E 'Failed to send email|dispatch failed|notification email'` : la cause suit (`ECONNREFUSED`, `ETIMEDOUT`, authentification refusée, STARTTLS absent…). Vérifié : relais arrêté → `Failed to send email to <adresse>: connect ECONNREFUSED …`, la page de connexion répond quand même.
2. Corriger `SMTP_*` ([configuration.md](configuration.md) : sur 587 le serveur doit proposer STARTTLS), ou attendre le retour du relais. `dc up -d --no-deps --force-recreate api` après un changement de variable.
3. **Aucun renvoi automatique.** Un lien de connexion se redemande depuis la page de connexion. Une notification reste visible dans le site (cloche) ; son email est marqué `failed` (ou `to_send`/`sending` si l'API s'est arrêtée pendant l'envoi) dans `notifications.email_state`, sans nouvel essai. Une personne invitée dont l'email s'est perdu a déjà son compte : elle demande un lien depuis la page de connexion.
4. Vérifier que l'expéditeur `SMTP_FROM` est validé chez le relais (sinon les emails partent mais sont rejetés ou classés indésirables).

## Clients OAuth / MCP refusés

| Symptôme | Cause probable | Action |
|---|---|---|
| Toutes les applications reçoivent `401 invalid_token` après un changement de configuration | `API_PUBLIC_URL` a changé : les jetons portent l'ancienne ressource | Remettre l'ancienne valeur, ou faire reconnecter chaque application |
| La connexion échoue dès l'autorisation, `issuer` inattendu | `API_PUBLIC_URL` ≠ adresse réellement publiée par le proxy | `curl <API_PUBLIC_URL>/.well-known/oauth-authorization-server` : `issuer` doit valoir `API_PUBLIC_URL/` |
| `403 Origin not allowed` | client dans un navigateur, origine non autorisée | ajouter l'origine à `MCP_ALLOWED_ORIGINS` (les clients serveur n'en envoient pas) |
| `403 insufficient_scope` | autorisation donnée avant une nouvelle permission | l'utilisateur reconnecte l'application ([mcp.md](../mcp.md)) |
| `401` pour un seul compte | compte désactivé, adresse jamais confirmée, application révoquée, ou réutilisation d'un jeton de renouvellement (journal `oauth refresh token replay, grant … revoked`) | l'utilisateur se connecte au site puis reconnecte l'application |
| Fiche client (CIMD) illisible | l'API ne sort pas en HTTPS vers Internet | ouvrir le trafic sortant HTTPS de l'API |

## Pic de mémoire ou de disque

Un fichier envoyé est tenu en mémoire pendant sa réception et son envoi au stockage (environ 35 Mo pour un fichier de 20 Mo). L'API borne les envois simultanés à **3 par compte** et **8 par processus** : au-delà, `429` avec `Retry-After: 5`, et le site réessaie. Les documents d'une entreprise sont limités à **500 Mo** toutes versions comprises (`507 COMPANY_DOCUMENTS_FULL`). Ces bornes sont dans le code ([configuration.md § Limites](configuration.md#limites-fixées-dans-le-code)).

1. `docker stats` : la mémoire de `api` redescend une fois les envois terminés. Prévoir au moins 1 Go pour le conteneur API ; plusieurs processus multiplient le plafond de 8 envois.
2. Rafale anormale : les refus du limiteur de requêtes sont inscrits au journal d'audit (`SELECT actor_id, count(*) FROM audit_log WHERE action_type = 'rate_limit_exceeded' AND created_at > now() - interval '1 hour' GROUP BY 1;`) ; désactiver le compte en cause (Administration › Utilisateurs) si besoin.
3. Disque : les fichiers ne sont pas sur le serveur de l'API mais dans le bucket ; sur l'hôte, surveiller le volume `postgres_data` et les journaux Docker (`docker system df`).

## Un secret est compromis

Changer la valeur dans Doppler (ou le `.env` de l'hôte), puis **recréer** l'API : `dc up -d --no-deps --force-recreate api` (et `dc run --rm api-migrate` pour un compte de migration).

Un simple `dc up -d api` ne suffit pas avec Doppler : l'image, le Compose et `DOPPLER_TOKEN` n'ayant pas changé, Compose garde le conteneur déjà démarré, et le point d'entrée ne lit les secrets (`doppler run`) qu'au démarrage — les anciennes clés resteraient actives. La même règle vaut pour **tout changement de configuration fait dans Doppler**.

Vérifier ensuite : `dc ps api` montre un démarrage récent ; un jeton d'accès émis avant la rotation est refusé (`401`) ; une nouvelle connexion par lien magique réussit.

Effets :

| Secret | Effet du changement |
|---|---|
| `JWT_REFRESH_SECRET` | Toutes les sessions web sont fermées : chacun se reconnecte par lien magique (vérifié : le renouvellement répond `401`, retour à la page de connexion). |
| `JWT_SECRET` | Les jetons d'accès (15 min) ne valent plus ; les sessions se renouvellent seules si `JWT_REFRESH_SECRET` n'a pas changé. Les formulaires publics ouverts à ce moment sont à recharger. **En cas de compromission, changer les deux.** |
| Mot de passe du compte applicatif ou de migration | `ALTER ROLE confluent_app PASSWORD '…'` (avec le compte `postgres`), puis mettre à jour `DATABASE_URL` / `MIGRATION_DATABASE_URL`. |
| `S3_SECRET_KEY` | Nouvelle clé côté S3, ancienne révoquée ; `Document storage reachable.` au redémarrage. |
| `SMTP_PASSWORD` | Nouvelle clé chez le relais, ancienne révoquée. |
| `SWAGGER_PASSWORD` | Nouvelle valeur ; ou `SWAGGER_ENABLED=false`. |
| `DOPPLER_TOKEN` | Révoquer dans Doppler, en créer un autre ([deploiement.md](../deploiement.md#après-le-passage-à-cette-configuration)). |

Les jetons des applications IA ne dépendent pas des secrets JWT (jetons aléatoires stockés sous forme d'empreinte) : pour les couper, voir la section suivante.

## Révoquer une application IA

- **Par l'utilisateur** (cas normal) : menu **Applications IA › Révoquer** ; toutes ses connexions à cette application et leurs jetons sont révoqués aussitôt, l'appel suivant reçoit `401`, et c'est inscrit au journal.
- **Pour un compte** : Administration › Utilisateurs › désactiver le compte. Ses applications sont refusées dès l'appel suivant (le compte est vérifié à chaque jeton) ; la réactivation les rétablit tant qu'elles n'ont pas expiré.
- **Une application pour tout le monde** (client malveillant), en base, avec le compte de migration :

  ```sql
  BEGIN;
  UPDATE oauth_grants SET revoked_at = now() WHERE client_id = '<client_id>' AND revoked_at IS NULL;
  UPDATE oauth_tokens SET revoked_at = now()
    WHERE revoked_at IS NULL AND grant_id IN (SELECT id FROM oauth_grants WHERE client_id = '<client_id>');
  COMMIT;
  ```

  Le `client_id` se lit dans `oauth_clients` (`SELECT id, name, source FROM oauth_clients;`). Cette voie n'écrit pas d'entrée au journal de chaque utilisateur : la noter dans le suivi d'incident.

## Traiter une demande de suppression de compte

Une personne demande la suppression depuis **Mes données** (page Compte) ; elle peut la retirer tant qu'elle est en attente.

1. **Administration › Utilisateurs › Demandes de suppression** : chaque demande indique ce qui serait supprimé (entreprises, demandes, versions de documents, candidatures closes, positionnements, appartenances, applications IA, partages reçus révoqués).
2. **Supprimer le compte** puis **Oui, supprimer le compte** : définitif, en une transaction. Le journal garde les faits sans nommer la personne (adresse remplacée par `compte-supprime-xxxxxxxx`), les structures gardent leurs notes et décisions, les fichiers sont effacés du bucket. Un email de confirmation part à l'adresse.
3. Refusée tant qu'un **bloquant** subsiste (partage ouvert, publication à un vivier, carte publique, candidature envoyée en cours, entreprise préparée, dernier administrateur, sa propre demande) : le message le nomme ; la personne lève le bloquant, ou l'administrateur **refuse** la demande avec une note (notification à la personne).
4. Si l'email de confirmation n'est pas parti, l'écran le dit : prévenir la personne autrement. Si le stockage était injoignable, les fichiers restent en file (`storage_deletions`) et sont effacés à la purge suivante.

Export des données d'une personne : elle le télécharge elle-même depuis **Mes données** (JSON, 5 par heure).
