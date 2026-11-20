# Story 11.2: User State Separation — `emailVerifiedAt` + `locale`

Status: done

`User.isActive` mélangeait deux états : "jamais consommé de magic-link" (post-invite) et "désactivé par l'admin". Conséquence : un user fraîchement invité recevait un access-token via `verifyMagicLink` mais la première requête authentifiée 401 immédiatement (`JwtStrategy.validate` rejette `!isActive`). Cette story sépare proprement les deux états, ajoute `User.locale` au passage (prérequis pour Story 11.4 i18n emails), et corrige le bug de login post-invitation.

## AC

1. **Migration Prisma** `20260512141407_add_user_email_verified_at_and_locale` ajoute :
   - `User.emailVerifiedAt: DateTime?` (nullable, défaut `NULL`)
   - `User.locale: String @default("fr")`
   - **Backfill** : `UPDATE users SET email_verified_at = NOW() WHERE is_active = TRUE` (les users déjà actifs au moment du déploiement sont considérés vérifiés ; les inactifs restent `null`, ce qui ne change rien à leur état antérieur de "bloqué").
2. **Sémantique nouvelle** :
   - `isActive` = toggle admin pur (true par défaut, `deactivate`/`reactivate` y touchent).
   - `emailVerifiedAt` = atteste qu'un magic-link a été consommé au moins une fois.
   - **Login autorisé ssi `isActive = true AND emailVerifiedAt IS NOT NULL`** — appliqué dans `JwtStrategy.validate` ([apps/api/src/modules/auth/strategies/jwt.strategy.ts](../../../../../apps/api/src/modules/auth/strategies/jwt.strategy.ts#L35)) et `AuthService.refreshSession` ([auth.service.ts:115](../../../../../apps/api/src/modules/auth/auth.service.ts#L115)). Code d'erreur inchangé (`INVALID_TOKEN`, opaque côté UX).
3. **`AuthService.verifyMagicLink`** ([auth.service.ts:70](../../../../../apps/api/src/modules/auth/auth.service.ts#L70)) — après consommation du token :
   - Set `emailVerifiedAt = now()` **si null** (idempotent, on ne ré-écrit pas si déjà set).
   - Enregistre un audit `magic_link_consumed` avec `metadata: { tokenId }` (l'action existait dans l'enum `audit_action` mais n'était jamais utilisée — voir aussi Story 8.4).
4. **`AdminUsersService.invite`** ([admin-users.service.ts:24](../../../../../apps/api/src/modules/admin/admin-users.service.ts#L24)) :
   - Création user : `isActive: true, emailVerifiedAt: null` (au lieu de `isActive: false`).
   - Update user existant invité-jamais-vérifié : `isActive: true` (cas re-invite acceptable).
   - 409 `USER_ALREADY_ACTIVE` rejeté ssi `existing.isActive && existing.emailVerifiedAt !== null` (un user déjà invité mais non vérifié peut être re-invité pour renvoyer un magic-link).
5. **Specs unitaires** — [auth.service.spec.ts](../../../../../apps/api/src/modules/auth/auth.service.spec.ts) couvre :
   - `verifyMagicLink — user.emailVerifiedAt=null → emailVerifiedAt set` ;
   - `verifyMagicLink — user.emailVerifiedAt déjà set → no-op` ;
   - audit `magic_link_consumed` enregistré ;
   - `refreshSession — emailVerifiedAt=null → 401`.
6. **e2e** [auth.e2e-spec.ts](../../../../../apps/api/test/auth.e2e-spec.ts) : mock `PrismaService.user.update` + `auditLog.create` pour couvrir la nouvelle write-path lors de `GET /v1/auth/verify`.

## Tasks

- [x] Édition `prisma/schema.prisma`
- [x] Génération SQL via `prisma migrate diff` (le user de la DB dev n'a pas `CREATEDB` → pas de shadow DB → SQL générée à la main et appliquée via `prisma migrate deploy`)
- [x] Application migration + `prisma generate`
- [x] Adapter `JwtStrategy.validate` + `AuthService.refreshSession`
- [x] Adapter `verifyMagicLink` (+ injection `AuditService`)
- [x] Adapter `AdminUsersService.invite`
- [x] Mettre à jour specs + e2e
- [x] Tests verts : 69/69 unit, 18/18 e2e

## Notes

- L'option **"keep isActive overloaded"** a été écartée pour rester state-of-the-art : la sémantique floue rendait `user_deactivated` / `user_reactivated` ambigus dans l'audit log et empêchait d'auditer correctement le passage "invité → vérifié".
- `User.locale` est introduit ici mais l'UI de changement n'est pas couverte en V1 — uniquement le default `'fr'`. Story 11.4 le consomme pour choisir le template email.

## References

- [apps/api/prisma/migrations/20260512141407_add_user_email_verified_at_and_locale/migration.sql](../../../../../apps/api/prisma/migrations/20260512141407_add_user_email_verified_at_and_locale/migration.sql)
- [apps/api/src/modules/auth/auth.service.ts](../../../../../apps/api/src/modules/auth/auth.service.ts)
- Story 6.3 (Magic Link Verification) — corrige le bug latent qu'elle laissait
