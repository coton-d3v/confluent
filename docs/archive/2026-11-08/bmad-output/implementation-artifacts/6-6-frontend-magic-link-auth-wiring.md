# Story 6.6: Frontend — Magic Link Auth Wiring

Status: done

## Story

As a user on the frontend,
I want the magic link flow to work end-to-end,
so that I can log in against the real backend.

## Acceptance Criteria

1. An `ApiClient` module at [apps/web/src/lib/api-client.ts](../../../../../apps/web/src/lib/api-client.ts) wraps `fetch` with: base URL from `import.meta.env.VITE_API_URL` (fallback `http://localhost:3000`), `credentials: 'include'` to carry the refresh cookie, automatic `Authorization: Bearer <accessToken>` when an access token is in memory, and transparent `POST /v1/auth/refresh` retry on `401` (once).
2. An in-memory `authStore` module at [apps/web/src/features/auth/auth-store.ts](../../../../../apps/web/src/features/auth/auth-store.ts) holds `{ accessToken, user }` — plain module-scoped state with a subscribe/notify mechanism so React components can react to changes. No localStorage for tokens (per AC in epics — "stores the returned JWT in memory").
3. A mutation helper `requestMagicLink(email)` + `verifyMagicLink(token)` + `refreshSession()` in [apps/web/src/features/auth/api.ts](../../../../../apps/web/src/features/auth/api.ts) call the corresponding endpoints via the `ApiClient` and update the `authStore` on success.
4. The `/auth` route at [apps/web/src/routes/auth/index.tsx](../../../../../apps/web/src/routes/auth/index.tsx) becomes a real form that:
   - Collects an email via RHF+Zod (reusing `magicLinkRequestSchema` from `@confluent/shared`).
   - On submit, calls `requestMagicLink`, then replaces the form with a confirmation screen: `Vérifiez votre boîte mail. Un lien de connexion vous a été envoyé.` — no countdown, no resend button in v1.
   - On API error, shows an inline error message; does not leak the email-existence status to the user.
5. A new `/auth/verify` route at [apps/web/src/routes/auth/verify.tsx](../../../../../apps/web/src/routes/auth/verify.tsx):
   - Reads the `token` query param (`useSearchParams`) and calls `verifyMagicLink(token)` in an effect on mount.
   - On success → redirects to `/dashboard` (entrepreneur), `/admin` (admin). Financeurs do not arrive here — their magic-link is a different flow (share-token), so if a financeur returns, fall through to `/dashboard`.
   - On failure → shows `Lien invalide ou expiré.` with a button back to `/auth`.
   - Is registered in the router between `/auth` and `/share/:token`.
6. `useCurrentUser()` at [apps/web/src/features/current-user/context.tsx](../../../../../apps/web/src/features/current-user/context.tsx) prefers the `authStore` user when present; otherwise falls back to the dev impersonation fixture. The hook signature stays unchanged (returns `CurrentUser`) — call sites don't move. The dev-impersonation `?as=admin` / `?as=entrepreneur` path remains wired so demos without a real backend keep working.
7. Build + lint + typecheck all green. The web bundle delta stays under +20 KB gz (the new code is just plumbing, no heavy deps).

## Tasks

- [ ] api-client.ts (fetch wrapper + 401 retry)
- [ ] auth-store.ts (in-memory with subscribe)
- [ ] features/auth/api.ts
- [ ] /auth route wired to magic-link mutation
- [ ] /auth/verify route
- [ ] current-user/context.tsx — prefer real session
- [ ] Router entries
- [ ] Sweep

## Dev Notes

- No TanStack Query in the codebase; use plain fetch + React state to keep the diff tight. Upgrade to TanStack Query can land when more mutation surfaces appear (Epic 7.6 is the natural inflection point).
- The refresh retry MUST only trigger once per request to avoid infinite loops; a `hasAttemptedRefresh` flag on the request options does this.
- `sessionStorage` is still used for the dev impersonation role; the JWT path owns memory-only `authStore`.

## Dev Agent Record

### File List
