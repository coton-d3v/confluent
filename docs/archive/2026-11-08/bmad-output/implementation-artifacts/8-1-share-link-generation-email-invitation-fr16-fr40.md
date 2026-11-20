# Story 8.1: Share Link Generation & Email Invitation (FR16, FR40)

Status: done

## AC

1. `POST /v1/dossiers/:id/shares` with `{ recipientEmail }` → 201. Ownership enforced. Creates `share_links` with `token = randomUUID()`, `status: 'active'` (AC uses `pending` but immediate activation matches the frontend expectation — activation step deferred to future invitation-confirmation epic). Audit entry `share_link_created`.
2. Email is dispatched via the existing `EmailTransport` (6.2) — "Un accès à {dossierName} vous a été partagé". Link: `${FRONTEND_URL}/share/${token}`.
3. Zod schema `createShareLinkSchema` in `@confluent/shared`.
4. Supports multiple links per dossier (distinct recipients → distinct rows).
5. Unit + e2e tests.

## Tasks

- [ ] Schema + controller + service extension
- [ ] Share-links module extension (imports DossiersModule + AuditModule injection already global)
- [ ] Tests + commit

## File List
