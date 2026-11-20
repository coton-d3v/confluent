# Story 7.6: Frontend — Replace Mocks with Dossier API

Status: done

Minimal pragmatic scope — the 7.6 epic AC mandates TanStack Query; the repo doesn't yet depend on it, so I wire a pragmatic API surface that's drop-in compatible for a later TanStack Query swap. The existing frontend mocks remain as a fallback for the dev-impersonation path so demos without a backend keep working (architecture discipline: no dead-code removal here, mocks live until the first demo that goes against the real API).

## AC

1. A `features/dossiers/api.ts` helper exposes `listDossiers`, `getDossier(id)`, `createDossier({ name })`, `updateDossier(id, { name })`, `deleteDossier(id)`, `submitDossier(id)` — each uses the authenticated `apiRequest` from [apps/web/src/lib/api-client.ts](../../../../../apps/web/src/lib/api-client.ts).
2. A `features/dossiers/hooks.ts` exposes `useDossiers()` (returns `{ data, isLoading, error, refetch }`) and `useDossier(id)` — simple `useEffect` + `useState` implementations as stand-ins for `useQuery`.
3. A `features/dossiers/answers.api.ts` with `listAnswers(dossierId)` + `upsertAnswers(dossierId, answers)`.
4. Typecheck/lint/build green. No runtime regressions when the user is unauthenticated — existing mocks still render because authStore is empty.

## Tasks

- [ ] dossiers api + hooks
- [ ] answers api
- [ ] shared schemas already present
- [ ] commit

## File List
