# Story 9.1: Admin Dossier Access & Editing

Status: done

## AC

1. `GET /v1/admin/dossiers` (AdminGuard) — paginated list of dossiers with owner + active share count. Query params `page` / `pageSize` with defaults 1 / 20.
2. `GET /v1/admin/dossiers/:id` — full dossier (with answers + share links + documents list + audit summary).
3. `PATCH /v1/admin/dossiers/:id/answers` with `{ answers: [{ fieldId, value }] }` — upserts answers and writes an `admin_edited_field` audit entry per field.
4. All `/v1/admin/*` routes protected by `AdminGuard`.
5. New `audit_action` values: `admin_edited_field`, `admin_uploaded_document`, `admin_revoked_share_link`.
6. Tests cover the admin list + detail + edit-answers flow.

## Tasks

- [ ] Extend Prisma enum + Zod
- [ ] `AdminModule` + `AdminService` + `AdminController`
- [ ] Tests + commit

## File List
