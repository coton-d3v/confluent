# Story 7.5: Automatic Dossier Classification (FR8)

Status: done

## AC

1. A `ClassificationService` at [apps/api/src/modules/classification/classification.service.ts](../../../../../apps/api/src/modules/classification/classification.service.ts) exposes `classify(dossierId)`. It:
   - Loads the dossier with its `questionnaireVersion` (fields) + answers.
   - Looks up the field whose `label === "Secteur d'activité"` (Section 1) and `label === "Stade de maturité"`.
   - Reads those two answers and writes `dossier.sector` + `dossier.maturityStage`.
   - If either answer is missing, sets the corresponding column to `null` and records a warning (no throw).
2. Classification runs as part of a new `POST /v1/dossiers/:id/submit` endpoint which also stamps `dossier.submittedAt = now()`. Ownership enforced.
3. The submit endpoint returns the updated dossier (including sector / maturityStage).
4. Unit tests cover: classification with both answers present, missing-answer fallback (null), submit endpoint marks `submittedAt`.
5. Typecheck/lint/test/build green.

## Tasks

- [ ] ClassificationService + spec
- [ ] Extend DossiersController with `POST /:id/submit` + DossiersService.submit
- [ ] Commit

## File List
