# Story 7.3: Questionnaire Schema Versioning (FR14)

Status: done

## AC

1. `GET /v1/questionnaires/active` returns the currently-published questionnaire version with its ordered fields: `{ version: { id, version, isPublished }, fields: [{ id, section, label, fieldType, required, orderIndex }, ...] }`. `fields` ordered by `section, orderIndex`.
2. `GET /v1/dossiers/:id` is extended to include the snapshot `{ questionnaireVersion: { id, version, fields } }` — the structure at dossier-creation time, immutable for the lifetime of the dossier.
3. A bootstrap seeding routine at `apps/api/src/modules/questionnaires/questionnaire.seed.ts` inserts version 1 (the 3-section / 12-field baseline from Story 2.4) IF the `questionnaire_versions` table is empty. Runs lazily inside `QuestionnairesService.getActive` / `DossiersService.ensureDefaultQuestionnaireVersion` (the bootstrap call from 7.1 is swapped to the new service).
4. Prisma's existing `questionnaire_version_id` FK on `dossiers` already satisfies the immutability constraint — there is no `UPDATE` path on that column after dossier creation.
5. Unit tests cover: service returns the seeded version when empty, returns the latest published version when multiple exist, dossiers service delegates to the questionnaires service for bootstrap.

## Tasks

- [ ] QuestionnairesModule + service + controller + seed
- [ ] DossiersService.ensureDefaultQuestionnaireVersion → delegate to QuestionnairesService
- [ ] Extend GET /v1/dossiers/:id response with the version snapshot
- [ ] Tests + commit

## File List
