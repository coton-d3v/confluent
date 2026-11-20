# Story 8.4: Audit Log Endpoints

Status: done

## AC

1. `GET /v1/dossiers/:id/audit-log` (entrepreneur-scoped via ownership) returns audit entries for the dossier ordered by `createdAt desc`: `{ id, actionType, actorId, metadata, createdAt }`. Filtered to entrepreneur-visible action types (excludes `rate_limit_exceeded` and `share_link_access_denied` — ops-only noise).
2. `GET /v1/admin/dossiers/:id/audit-log` (admin-scoped, requires `role === 'admin'` JWT) returns the full audit log including ops-only entries.
3. Append-only: `AuditService` already rejects update/delete ops (architecture.md:147). No new mutation endpoint here.
4. An `AdminGuard` at `apps/api/src/modules/auth/guards/admin.guard.ts` checks `request.user.role === 'admin'` and throws `ForbiddenException` otherwise.
5. Tests cover ownership + admin role enforcement.

## Tasks

- [ ] `AdminGuard`
- [ ] Audit-log endpoints (2) + service
- [ ] Tests + commit

## File List
