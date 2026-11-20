# Environnement de développement

Ce fichier décrit les commandes et le dépannage. Le périmètre et le travail restant sont suivis uniquement dans [la roadmap](ROADMAP.md).

> Les services du serveur peuvent déjà être disponibles depuis Coder : vérifier les cibles configurées avant de lancer une deuxième instance. Le Compose local est un exemple ; il ne prouve pas la persistance de l'installation réelle.

---

## Prérequis

- Docker Desktop (ou Docker Engine + Compose plugin)
- Node 22+ (`node -v`)
- pnpm 10+ (`pnpm -v`)

---

## Première mise en route

### 1. Dépendances

```bash
pnpm install
```

### 2. Variables d'environnement

```bash
cp apps/api/.env.example apps/api/.env
# Adapter les hôtes, bases et identifiants aux services réellement utilisés
```

### 3. Services de fond

```bash
docker compose up -d
```

| Service  | Rôle                            | Port(s)           | UI                        |
|----------|---------------------------------|-------------------|---------------------------|
| postgres | Base de données PostgreSQL      | 5432              | —                         |
| minio    | Stockage S3-compatible (docs)   | 9000 (API)        | http://localhost:9001     |
| mailhog  | SMTP catch-all (emails dev)     | 1025 (SMTP)       | http://localhost:8025     |

> L'API refuse de démarrer si PostgreSQL n'est pas disponible. Les autres services peuvent être administrés séparément. Le provider de documents actuel est encore en mémoire : configurer `S3_*` ou lancer un serveur S3 ne suffit pas à y enregistrer les fichiers. Le raccordement est suivi dans l'épique E02 de la roadmap.

### 4. Migrations + seed

```bash
pnpm db:sync --seed
```

Applique toutes les migrations Prisma puis insère les fixtures dev (idempotent) :

| Email                       | Rôle           |
|-----------------------------|----------------|
| admin@localhost.dev         | admin          |
| entrepreneur@localhost.dev  | entrepreneur   |
| financeur@localhost.dev     | financeur      |

### 5. Lancer l'application

```bash
pnpm dev       # API :3000 + Web :5173 (logs interleaved)
```

Pour séparer les logs :

```bash
# Terminal 1
pnpm dev:api

# Terminal 2
pnpm dev:web
```

---

## Flux quotidien

```bash
docker compose up -d             # démarrer les services si pas encore lancés
pnpm dev                         # lancer l'application
pnpm db:migrate:status           # vérifier l'état des migrations
pnpm --filter @confluent/api db:studio  # Prisma Studio :5555
```

---

## Email en dev

Mailhog intercepte tous les emails — aucun email réel n'est envoyé.

| Commande                                            | Action                                  |
|-----------------------------------------------------|-----------------------------------------|
| `open http://localhost:8025`                        | UI Mailhog — voir les emails reçus      |
| `pnpm --filter @confluent/api email:preview`        | Preview HTML templates sur :4000        |
| `pnpm --filter @confluent/api email:test`           | Envoie des copies de test vers Mailhog  |

Pour tester le flow magic-link complet :

1. `docker compose up -d` (mailhog doit tourner)
2. Aller sur `/auth` → entrer `admin@localhost.dev`
3. Ouvrir http://localhost:8025 → cliquer le lien

---

## Tokens de test (sans email)

```bash
pnpm api:token -- admin@localhost.dev
```

Génère un JWT valide 15 min. Utile pour appeler l'API directement (curl / Swagger / tests).

---

## Dépannage

### `ECONNREFUSED 127.0.0.1:1025`

Mailhog n'est pas lancé :

```bash
docker compose up -d mailhog
```

Sans Docker disponible, voir [§ Environnement sans Docker](#environnement-sans-docker-coder--cloud-ide).

### `magic_link.unknown_email`

L'email n'existe pas en base.

- En dev avec Docker : `pnpm db:seed` pour insérer les fixtures.
- En dev sans Docker ou en prod : voir [Bootstrap premier admin](#bootstrap-premier-admin-en-production).

### `P3014` — permission denied to create database

`migrate dev` a besoin d'une base shadow. Sur un PostgreSQL partagé, prévoir une base shadow dédiée plutôt que d'accorder globalement `CREATEDB` au compte applicatif. Voir [Base et migrations](database-migrations.md).

### MinIO : bucket absent

Un serveur S3 neuf peut nécessiter la création du bucket privé. Utiliser l'outil d'administration correspondant au logiciel et à la version effectivement installés. Le client `mc` n'est pas garanti présent dans l'image serveur.

Les identifiants applicatifs doivent être limités au bucket de leur environnement ; les identifiants de démonstration du Compose ne sont pas une configuration de production.

---

## Environnement sans Docker (Coder / cloud IDE)

Si Docker n'est pas disponible, remplace les services locaux par des équivalents cloud.

### DB : base externe

Renseigne `DATABASE_URL` dans `apps/api/.env` avec l'URL de ta DB externe.
Les migrations s'appliquent normalement : `pnpm db:migrate:dev`.

Pour le premier lancement sans seed, crée le premier admin via le script bootstrap
plutôt que `pnpm db:seed` (voir [Bootstrap premier admin](#bootstrap-premier-admin-en-production)).

### Email : Ethereal (recommandé, zéro installation)

[Ethereal](https://ethereal.email) est le service SMTP de test officiel de Nodemailer.
Aucune inscription nécessaire — les credentials sont générés à la volée :

1. Aller sur https://ethereal.email/create
2. Cliquer "Create Ethereal Account" → credentials affichés instantanément
3. Copier dans `apps/api/.env` :

```env
SMTP_HOST=smtp.ethereal.email
SMTP_PORT=587
SMTP_USER=<username affiché>
SMTP_PASSWORD=<password affiché>
SMTP_FROM=noreply@confluent.local
```

4. Les emails sont capturés et consultables sur https://ethereal.email/messages (session de 24h)

### Email : Mailtrap (alternative, UI plus riche)

[Mailtrap](https://mailtrap.io) propose un inbox de test avec une UI soignée et un plan gratuit permanent :

1. S'inscrire (gratuit)
2. Créer un inbox → récupérer les SMTP credentials
3. Même format `.env` que ci-dessus

### Stockage fichiers : service S3-compatible externe à Coder

La cible retenue est un service S3-compatible persistant sur le serveur, hors du workspace Coder, avec espaces et identifiants dev/prod séparés. Renseigner les variables `S3_*` après installation et raccordement de l'adaptateur applicatif E02. Ne pas annoncer les uploads persistants avant un test de téléchargement et de redémarrage.

---

## Bootstrap premier admin en production

En prod, le seed dev ne tourne pas (`pnpm db:seed` est réservé au dev).
Pour créer le premier compte admin, utilise le script dédié :

```bash
# Depuis la racine du monorepo (avec DATABASE_URL pointant sur la prod)
DATABASE_URL=postgresql://user:pass@host:5432/db pnpm bootstrap:admin -- admin@votredomaine.com
```

Ou directement depuis le package API :

```bash
cd apps/api
DATABASE_URL=postgresql://... pnpm bootstrap:admin -- admin@votredomaine.com
```

Ou depuis le container API en prod :

```bash
docker exec <nom-container-api> \
  node -e "
    const { PrismaClient } = require('@prisma/client');
    const p = new PrismaClient();
    p.user.upsert({
      where: { email: 'admin@votredomaine.com' },
      update: { role: 'admin', isActive: true },
      create: { email: 'admin@votredomaine.com', role: 'admin', isActive: true, emailVerifiedAt: null }
    }).then(u => { console.log('Done', u.id); p.\$disconnect(); });
  "
```

Ce que fait le script :

- Crée le user s'il n'existe pas (`role: admin, isActive: true, emailVerifiedAt: null`)
- Le réactive et repasse en admin s'il existe déjà
- Est idempotent — peut être relancé sans risque

Ensuite :

1. Aller sur `/auth`
2. Entrer l'email admin
3. Recevoir le magic link (SMTP Brevo doit être configuré en prod)
4. Cliquer → premier login → `emailVerifiedAt` est automatiquement set en base
