# Story 9.2: Questionnaire Builder Persistence (FR13, FR14, FR15)

Status: done

## AC

1. `GET /v1/admin/questionnaire/versions` (AdminGuard) — lists versions, newest first.
2. `POST /v1/admin/questionnaire/versions` — creates a new version with its fields (sections + field defs) and sets the previous published version to `isPublished: false`. New version `isPublished: true`.
3. `PATCH /v1/admin/questionnaire/versions/:id/fields/:fieldId` — updates a single field's label and/or type on the specified version only. 404 if field not on that version.
4. `questionnaireVersionId` snapshot on dossiers ensures existing dossiers remain bound to their original version (FR14) — no schema change.
5. Tests cover: list, publish-rotation, field-patch scoped to a version.

## Tasks

- [ ] Extend QuestionnairesService with `listVersions`, `createVersion`, `updateField`
- [ ] AdminQuestionnaireController + module
- [ ] Shared Zod schemas for create-version payload
- [ ] Tests + commit

## File List
