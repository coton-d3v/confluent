# Documentation API (Swagger)

Ce fichier décrit l'utilisation de l'API et de ses outils. Le serveur MCP et les fonctionnalités restant à livrer sont suivis dans [la roadmap](ROADMAP.md).

Le backend expose une doc OpenAPI 3 interactive à `/api/docs`.

## Accès

| Environnement | URL | Protection |
|---|---|---|
| Dev (`NODE_ENV=development`) | http://localhost:3000/api/docs | Ouverte |
| Prod (`NODE_ENV=production`) | `<origine-api-configurée>/api/docs` | **HTTP Basic Auth** si Swagger est activé |

En dev, la doc est accessible sans credentials — pensée pour l'itération rapide.

En prod, `express-basic-auth` exige les identifiants définis dans l'env :

- `SWAGGER_USER` (défaut `admin`)
- `SWAGGER_PASSWORD` (min 8 chars, à changer)

Le spec JSON brut est servi à `/api/docs-json` (même protection).

## Désactiver totalement

Pour des environnements hardened où même la doc ne doit pas être servie :

```env
SWAGGER_ENABLED=false
```

Aucune route `/api/docs*` n'est alors montée.

## Obtenir un JWT pour tester l'API

### Users fixtures

Après `pnpm db:seed`, 3 users sont toujours disponibles (idempotent) :

| Email | Rôle |
|---|---|
| `entrepreneur@localhost.dev` | entrepreneur |
| `financeur@localhost.dev` | financeur |
| `admin@localhost.dev` | admin |

Le namespace `@localhost.dev` est **réservé** aux fixtures — ne pas réutiliser ces emails pour de vrais comptes.

### Données métier seedées

| Entité | État | Notes |
|---|---|---|
| Dossier `biosensio` | Soumis, 12 réponses, `sector: Biotech`, `maturityStage: Seed` | Owned par l'entrepreneur. Utilisable pour tester l'affichage admin, les analytics, le partage. |
| Dossier `agrotech-innovations` | Draft (aucune réponse, pas soumis) | Empty-state du questionnaire. |
| Share link `11111111-2222-4333-a555-666666666666` | `active` → `financeur@localhost.dev` sur Biosensio | Token stable : `GET /v1/shares/11111111-2222-4333-a555-666666666666` marche direct. |

### CLI `api:token`

Signe un JWT access token valide **15 min** pour un user existant. Zero bypass, zero endpoint caché — le CLI utilise simplement `JWT_SECRET` + `DATABASE_URL` comme le ferait l'API :

```bash
pnpm api:token entrepreneur@localhost.dev
# eyJhbGciOiJIUzI1NiIs...
```

**Contract stable** (pipe-friendly pour scripting) :
- **stdout** = token brut uniquement
- **stderr** = contexte humain
- **exit codes** : `0` OK · `1` user inconnu · `2` env invalide · `3` user inactif

### Dans Swagger UI

1. http://localhost:3000/api/docs
2. Clique **Authorize** en haut à droite
3. Colle le token dans le schéma `jwt` (sans le préfixe `Bearer`)
4. Le token persiste tant que l'onglet reste ouvert (`persistAuthorization`)

### Dans un shell

```bash
export TOKEN=$(pnpm api:token admin@localhost.dev 2>/dev/null)
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/v1/admin/dossiers
```

### Tests HTTP et recette de préproduction

```bash
pnpm --filter @confluent/api test:e2e --runInBand
```

La suite actuelle démarre NestJS avec Prisma et les transports remplacés par des dépendances simulées. Elle vérifie les routes HTTP, sans utiliser une base ou des identifiants de préproduction. Elle ne réalise pas une recette de PostgreSQL, du SMTP ou du stockage réels.

La recette de l'installation cible est distincte : utiliser des comptes de test autorisés, vérifier les parcours du site et du MCP, les emails reçus, les téléchargements et les droits. Les scénarios sont définis dans [la roadmap](ROADMAP.md#7-définition-de-terminé-et-recette-finale). Il n'est pas nécessaire de semer des données sur un serveur réel pour exécuter la suite HTTP ci-dessus.

### Règles d'or

- Le CLI **n'est pas exposé en HTTP**. Il vit dans `apps/api/scripts/` ; le Dockerfile actuel copie ce répertoire dans l'image. Son accès et les secrets de signature doivent donc rester réservés aux opérateurs autorisés.
- L'API ne contient **aucune branche dev/prod** sur l'auth. Le CLI est strictement équivalent à avoir accès à `JWT_SECRET` + la DB — aucune surface d'attaque supplémentaire.
- Les users `@localhost.dev` sont réservés aux fixtures, pas aux vrais comptes.

## Authentification dans le Swagger UI

Deux schémas de sécurité déclarés :

1. **`jwt`** (Authorization: Bearer) — colle l'access token obtenu via `GET /v1/auth/verify`. Le bouton "Authorize" en haut à droite du UI accepte le token brut (sans `Bearer`).
2. **`refresh-cookie`** (cookie `confluent_refresh`) — utilisé par `POST /v1/auth/refresh`. Le cookie est posé automatiquement par `verify` ; à condition que `persistAuthorization` soit activé (c'est le cas), il reste en session.

## Tags

Les routes sont regroupées en domaines métier :

- **Auth** — magic-link + sessions JWT
- **Dossiers** — CRUD entrepreneur (scope user)
- **Questionnaire** — version active publique + réponses par dossier
- **Documents** — upload + versioning
- **Partages** — share links financeurs
- **Analytics** — stats de consultation par dossier
- **Audit** — journal append-only
- **Admin · Dossiers / Questionnaire / Utilisateurs / Analytics / Partages** — routes `role: admin`
- **Santé** — healthcheck

## Ajouter une route au Swagger

Les DTOs créés via `createZodDto()` de `nestjs-zod` sont détectés automatiquement. Minimum requis sur une nouvelle route :

```ts
@ApiTags('Dossiers')          // au niveau controller
@ApiBearerAuth('jwt')         // si JWT requis
@Controller('dossiers')
export class DossiersController {
  @Post()
  @ApiOperation({
    summary: 'Créer un dossier',
    description: 'Description métier détaillée…',
  })
  @ApiCreatedResponse({ description: 'Dossier créé.' })
  create(@Body() body: CreateDossierDto): Promise<Dossier> { … }
}
```

Pour un contrôle fin du schéma de réponse, ajouter `@ApiOkResponse({ schema: { example: {...} } })` ou un DTO de retour.
