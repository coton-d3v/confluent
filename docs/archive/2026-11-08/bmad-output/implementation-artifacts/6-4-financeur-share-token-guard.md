# Story 6.4: Financeur Share Token Guard

Status: done

## Story

As a financeur accessing a shared dossier link,
I want my link token to be validated on every request,
so that revoked access takes effect immediately without requiring a login session.

## Acceptance Criteria

1. A `ShareLinkGuard` at [apps/api/src/modules/auth/guards/share-link.guard.ts](../../../../../apps/api/src/modules/auth/guards/share-link.guard.ts) resolves the `:token` route param against `share_links`. On `status === 'active'` and token found → allow and attach resolved record to `request.shareLink`. Otherwise (not found, revoked, expired, pending) → throw `ForbiddenException({ code: 'ACCESS_DENIED', message: 'Access denied.' })`.
2. The guard must be `@Public()`-equivalent from the JWT standpoint — financeur routes use token-based access, not JWT. The guard self-registers its public-ness: the guarded route is marked `@Public()` so the global `JwtAuthGuard` doesn't fire, and the `ShareLinkGuard` runs via `@UseGuards(ShareLinkGuard)` at the controller/route level.
3. An `AuditService` at [apps/api/src/modules/audit/audit.service.ts](../../../../../apps/api/src/modules/audit/audit.service.ts) exposes `record(entry: AuditLogEntry)` that calls `prisma.auditLog.create`. It is append-only — no update/delete methods. A `record` call NEVER throws into the caller — failures are logged at `warn` (audit write failure must not break the user flow).
4. An `AuditModule` (`@Global()` to keep boilerplate low) exports `AuditService`.
5. On a successful pass through the `ShareLinkGuard`, the guard invokes `AuditService.record({ actionType: 'share_link_viewed', shareLinkId, dossierId, metadata: { recipientEmail, userAgent, ip } })`. Userfacing path: `GET /v1/shares/:token` handler, which calls the service.
6. A new `ShareLinksModule` at [apps/api/src/modules/share-links/share-links.module.ts](../../../../../apps/api/src/modules/share-links/share-links.module.ts) declares:
   - `ShareLinksController` with `GET /shares/:token` (marked `@Public()` + `@UseGuards(ShareLinkGuard)`) — returns the scoped share payload `{ dossier: { id, name, slug }, share: { recipientEmail, expiresAt: null, status } }` (content of the dossier itself lands in Epic 7+).
   - `ShareLinksService` with `resolveForFinanceur(shareLink: ShareLink)` that loads the dossier scoped to what the financeur should see and also `recordView(shareLink, req)` that delegates to `AuditService`.
7. The `share-link.guard.spec.ts` unit test covers: known-active token → allow + attach; unknown token → 403; revoked → 403; pending → 403; expired → 403; the guard never rethrows DB errors as-is (wraps into a safe generic 403 + logs at warn).
8. E2E at [apps/api/test/share-links.e2e-spec.ts](../../../../../apps/api/test/share-links.e2e-spec.ts): happy path for an active share returns 200 + scoped payload AND triggers an `AuditService.record` call (spied); unknown token → 403 + `ACCESS_DENIED`; revoked token → 403.
9. Typecheck / lint / test / test:e2e / turbo build all green.

## Tasks

- [ ] `AuditService` + `AuditModule` (Global) + spec
- [ ] `ShareLinkGuard` + spec
- [ ] `ShareLinksController` + `ShareLinksService` + `ShareLinksModule` + specs
- [ ] Wire AuditModule + ShareLinksModule into AppModule
- [ ] E2E for share-links routes
- [ ] Sprint status → done

## Dev Notes

- No caching on share-link lookups (NFR4) — the DB is consulted on every request.
- `AuditService.record` returns `Promise<void>` and swallows errors; rationale: dropping an audit row must not break user-facing flow; external observability (logs) surfaces the failure.
- `ShareLinkGuard` reads the token from `request.params.token` via Nest's `ExecutionContext`.
- `request.shareLink` is typed via a module-augmentation file declaring `Request { shareLink?: ShareLinkWithDossier }`.
- Prisma's generated `ShareLink` type is used directly (`import type { ShareLink } from '@prisma/client'`).
- Financeur payload intentionally scoped: returns `dossier.name` + `slug` + `id` only; the actual questionnaire answers are in 7.x.

## Dev Agent Record

### File List

- **Created:** audit.service/module/spec, auth/guards/share-link.guard + spec, share-links.service/controller/module, test/share-links.e2e-spec.ts
- **Modified:** app.module.ts (+ AuditModule, ShareLinksModule), test/app.e2e-spec.ts (expand prisma mock)
