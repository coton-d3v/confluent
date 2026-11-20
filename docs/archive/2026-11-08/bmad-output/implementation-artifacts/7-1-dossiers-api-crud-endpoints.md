# Story 7.1: Dossiers API — CRUD Endpoints

Status: done

## AC

1. `POST /v1/dossiers` → 201 + `{ id, userId, name, slug, questionnaireVersionId, createdAt, updatedAt }`. Slug is derived from `name` via a `slugify` helper; collisions get a `-{n}` suffix. Requires an `active` questionnaire version (fall back to a bootstrap version id if none exists; service lazily ensures one exists).
2. `GET /v1/dossiers` → 200 + array, scoped to `req.user.id`.
3. `GET /v1/dossiers/:id` → 200 if owner, 404 otherwise (no enumeration).
4. `PATCH /v1/dossiers/:id` → 200 + updated dossier (`name` + regenerated `slug`).
5. `DELETE /v1/dossiers/:id` → 204. Hard-delete via Prisma; cascade rules on the schema take care of children (`onDelete: Cascade` on answers / shareLinks / audit).
6. All routes are protected by the global `JwtAuthGuard` — no `@Public()`. Anonymous calls → 401.
7. Zod schemas for `createDossierSchema` / `updateDossierSchema` land in `packages/shared/src/schemas/dossier.schema.ts`; the API DTOs wrap them via `createZodDto`.
8. Unit tests cover the service (create + slug collisions, list scoped to user, getById 404 cross-user, update, delete). E2E tests cover all five endpoints with mocked Prisma.

## Tasks

- [ ] Extend shared `dossier.schema.ts` with create/update schemas
- [ ] `slugify` helper (existing in `apps/web/src/lib/slugify.ts` — create one on the API side too, small pure function)
- [ ] `DossiersModule` + controller + service + specs
- [ ] E2E spec
- [ ] Sweep + commit

## Dev Notes

- `prisma.dossier.create` needs a `questionnaireVersionId` — service ensures a default version exists (creates `{version: 1, isPublished: true}` on demand) and keeps the id cached in memory.
- For slug collisions, query existing slugs with `startsWith` and append a counter; acceptable at V1 scale.

## File List
