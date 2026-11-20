# Story 7.2: Questionnaire Answers API

Status: done

Backend-only portion of 7.2 lands here (idempotent upsert endpoint + GET). Frontend auto-save wiring is folded into 7.6 when mocks are replaced across the dashboard.

## AC

1. `PUT /v1/dossiers/:id/answers` with body `{ answers: [{ fieldId, value }, ...] }` upserts answers scoped to the dossier; responds 200 with the saved array `[{ fieldId, value, updatedAt }, ...]`. Idempotent: calling twice with the same payload produces the same state.
2. `GET /v1/dossiers/:id/answers` returns the saved answers for the dossier (scoped to caller via the dossiers service ownership check).
3. Both routes are protected by the global `JwtAuthGuard` and enforce ownership by calling `DossiersService.getByIdForUser`.
4. Zod schemas land in `packages/shared/src/schemas/answer.schema.ts`: `answerSchema`, `upsertAnswersSchema` (array wrapper).
5. Unit tests cover: upsert with new answers, upsert updating existing answers, cross-user access → 404, list empty, list populated.

## Tasks

- [ ] `answer.schema.ts`
- [ ] `AnswersService` + controller nested under `/dossiers/:id/answers`
- [ ] AnswersModule + wiring
- [ ] Tests + commit

## Dev Notes

- `prisma.dossierAnswer` has `@@unique([dossierId, fieldId])` — use `upsert` inside a transaction per (dossierId, fieldId) pair.
- Controller takes the parent `:id` via `@Param`, resolves ownership via `DossiersService`, then delegates to `AnswersService`.

## File List
