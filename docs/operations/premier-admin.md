# Premier administrateur

Une installation neuve n'a aucun compte et pas d'inscription ouverte : le premier administrateur est créé en ligne de commande, puis il se connecte par lien magique et invite les autres depuis le site.

## Créer le compte

Le script `bootstrap:admin` crée le compte (rôle `admin`, actif) ou, s'il existe, le repasse administrateur et le réactive. Il peut être relancé sans risque et fonctionne en production.

Images (la commande passe par le point d'entrée, donc par Doppler s'il est configuré) :

```sh
docker compose -f docker-compose.prod.yml run --rm --no-deps api \
  pnpm --filter @confluent/api bootstrap:admin admin@example.org
```

Sources (lit `apps/api/.env`) :

```sh
pnpm --filter @confluent/api bootstrap:admin admin@example.org
```

Sortie : `Admin user ready: admin@example.org (id: …)`. Une seule adresse est acceptée (`pnpm bootstrap:admin -- admin@example.org` aussi) ; sinon le script affiche son usage sans rien écrire.

## Se connecter

1. Ouvrir le site (`FRONTEND_URL`), page de connexion, saisir l'adresse.
2. Ouvrir le lien reçu par email (valable 15 minutes, usage unique). La première connexion confirme l'adresse.
3. Renseigner prénom et nom (demandés à la première connexion de chaque compte).
4. Le menu d'administration apparaît (Pipeline, Dossiers, Formulaires, Classification, Utilisateurs, Workspaces).

Rien n'arrive ? Le site répond pareil qu'une adresse soit connue ou non : regarder le journal de l'API (`Magic link email dispatch failed …` = problème SMTP, voir [incidents.md](incidents.md#emails-non-envoyés)) et l'orthographe de l'adresse.

## Ensuite

- **Formulaire des dossiers.** Une base neuve contient le formulaire « Profil de l'entreprise » sans aucune version publiée (« Jamais publié ») : l'administrateur le conçoit et le publie dans **Formulaires**, ou publie le questionnaire régional fourni avec le code, une seule fois (refusé ensuite en production) :

  ```sh
  docker compose -f docker-compose.prod.yml --profile seed run --rm api-seed-v2   # images
  pnpm --filter @confluent/api questionnaire:v2                                    # sources
  ```

  Dans le fichier de référence, `api-seed-v2` ne reçoit que `DATABASE_URL` du `.env` de l'hôte, sans `DOPPLER_TOKEN` : avec Doppler, lancer plutôt `docker compose -f docker-compose.prod.yml run --rm --no-deps api pnpm --filter @confluent/api questionnaire:v2`.
- **Autres comptes.** Administration › Utilisateurs : inviter (email d'invitation), désactiver, réactiver. Les membres d'un workspace s'invitent depuis le workspace ([workspaces.md](workspaces.md)).
- **Workspaces.** [workspaces.md](workspaces.md).

## Ce qui n'est pas pour la production

- `pnpm db:seed` (comptes `@localhost.dev`, `SEED_ADMIN_EMAIL`) : données de démonstration, refusé avec `NODE_ENV=production`.
- `pnpm api:token <email>` : émet un jeton au nom de n'importe quel compte ; **refusé hors `NODE_ENV` `development`/`test`** (« réservé au développement et aux tests », code de sortie 4 avec `pnpm --filter @confluent/api api:token`, 1 par la commande racine), sans contournement, même dans l'image de production qui contient le script.
- Créer un compte par SQL : le script ci-dessus fait la même chose, sans risque d'erreur de saisie sur les colonnes.
