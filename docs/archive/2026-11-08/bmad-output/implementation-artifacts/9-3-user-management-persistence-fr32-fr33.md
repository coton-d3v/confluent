# Story 9.3: User Management Persistence (FR32, FR33)

Status: done

## AC

1. `GET /v1/admin/users` (AdminGuard) — lists users with `id, email, role, isActive, createdAt, updatedAt`.
2. `POST /v1/admin/users/invite` with `{ email, role }` — creates an `isActive: false` user row (or returns the existing row if email exists with `isActive: false` still), then reuses the 6.2 magic-link flow to send an invitation email (the email path is the same as the normal magic-link request → the existing `AuthService.requestMagicLink` will issue the token on first login).
3. `PATCH /v1/admin/users/:id/deactivate` — sets `isActive: false`. Audit entry `user_deactivated` with the admin actor id.
4. `PATCH /v1/admin/users/:id/reactivate` — sets `isActive: true`. Audit entry `user_reactivated`.
5. The existing `JwtStrategy.validate` doesn't yet check isActive; extend it so inactive users fail auth (401) — closes FR32 last AC.
6. Tests cover the invite/list/deactivate path.

## Tasks

- [ ] UsersService + module + controller (admin-only)
- [ ] JwtStrategy: reject inactive users
- [ ] Tests + commit

## File List
