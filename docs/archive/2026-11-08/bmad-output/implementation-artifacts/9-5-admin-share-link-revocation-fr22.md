# Story 9.5: Admin Share Link Revocation (FR22)

Status: done

## AC

1. `DELETE /v1/admin/dossiers/:dossierId/shares/:linkId` (AdminGuard) revokes any share link regardless of the dossier owner; writes `admin_revoked_share_link` audit entry with metadata `{ recipientEmail, revokedAt }`.
2. 404 if the link does not exist OR its `dossierId` does not match the URL segment (no info leakage across dossiers).
3. Existing ShareLinkGuard (6.4) picks up the `status = 'revoked'` on the next request → 403.
4. Tests cover the admin revoke path + audit + 404 on mismatched ids.

## Tasks

- [ ] AdminSharesService + controller
- [ ] Tests + commit

## File List
