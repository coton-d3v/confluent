# Story 6.3: Magic Link — Verification & JWT Issuance

Status: done

## Story

As a user clicking a magic link in email,
I want to be authenticated and receive session tokens,
so that I can access the platform without entering a password.

## Acceptance Criteria

1. `GET /v1/auth/verify?token={valid-uuid}` — token exists, not consumed, not expired → `200 OK` + body `{ accessToken, user: { id, email, role } }`; sets `consumed_at = now()` via `UPDATE` on the token row; sets refresh cookie `confluent_refresh`, `httpOnly`, `Secure` (prod), `SameSite=Strict`, `maxAge: 7 days`, `path: /`.
2. `GET /v1/auth/verify?token={expired}` or `{consumed}` or `{unknown}` → `401` + `{ error: { code: 'INVALID_TOKEN', message: 'Token expired or invalid.' } }` (same generic message for all three — no enumeration).
3. Token validation via Zod `z.string().uuid()` at the query pipe — any non-UUID value → `400 VALIDATION_ERROR` (GlobalExceptionFilter from 6.2 handles the shape).
4. JWT access token is HS256, signed with `JWT_SECRET`, payload = `{ sub: userId, email, role }`, expiry = 15 minutes. Issued via `@nestjs/jwt` `JwtService.signAsync`.
5. JWT refresh token is HS256, signed with `JWT_REFRESH_SECRET`, payload = `{ sub: userId, tokenVersion: 0 }`, expiry = 7 days. Delivered as the `confluent_refresh` cookie.
6. `JwtAuthGuard` at [apps/api/src/modules/auth/guards/jwt.guard.ts](../../../../../apps/api/src/modules/auth/guards/jwt.guard.ts) extends Passport's `AuthGuard('jwt')`. A `JwtStrategy` extracts tokens from the `Authorization: Bearer <jwt>` header via `ExtractJwt.fromAuthHeaderAsBearerToken()`, verifies with `JWT_SECRET`, and sets `request.user = { id, email, role }`.
7. `@Public()` decorator at [apps/api/src/common/decorators/public.decorator.ts](../../../../../apps/api/src/common/decorators/public.decorator.ts) marks routes as skipping the JWT guard. The guard is set up as a *global* `APP_GUARD` so the default is protection (architecture.md:162-170) — `@Public()` opts out. The `/auth/magic-link`, `/auth/verify`, `/auth/refresh` routes AND `GET /` (health) are `@Public()`.
8. `POST /v1/auth/refresh` reads the `confluent_refresh` cookie, verifies its signature + expiry with `JWT_REFRESH_SECRET`, looks up the user (to pick up any role changes), issues a NEW access token AND rotates the refresh cookie with a fresh 7-day expiry. Invalid/missing cookie → `401 INVALID_TOKEN`.
9. `POST /v1/auth/logout` clears the refresh cookie (`res.clearCookie('confluent_refresh')`) and responds `200 { message: 'Logged out.' }`. Public endpoint.
10. The `cookie-parser` middleware is installed via `app.use(cookieParser())` in `main.ts` so `req.cookies` is available to the controller/strategy.
11. Unit tests cover: valid token → access + refresh issued + token marked consumed; expired/consumed/unknown all → throw `UnauthorizedException('INVALID_TOKEN')`; refresh with valid cookie → new tokens; refresh with expired/missing cookie → `UnauthorizedException`. Mocks `PrismaService`, `JwtService`, and `ConfigService`.
12. E2E tests: `/v1/auth/verify?token=…` happy/sad paths, `/v1/auth/refresh` round-trip, `/v1/auth/logout` clears cookie, and a synthetic protected route asserts the global JWT guard rejects anonymous calls with 401.
13. Verification sweep: typecheck / lint / test / test:e2e / turbo build all green.

## Tasks

- [x] Deps installed: `@nestjs/jwt`, `@nestjs/passport`, `passport`, `passport-jwt`, `@types/passport-jwt`, `cookie-parser`, `@types/cookie-parser`
- [x] `JwtStrategy` + `JwtAuthGuard` + global registration via `APP_GUARD` in `AuthModule`
- [x] `@Public()` decorator applied to all `/auth/*` + `GET /`
- [x] `AuthService` extended with `verifyMagicLink`, `refreshSession`; `AuthController` with verify + refresh + logout routes
- [x] `cookie-parser` middleware in `main.ts`
- [x] Unit tests (AuthService: 12 cases) + controller tests (3 cases) + e2e (9 cases) all green
- [x] Sprint status → done

## Dev Notes

- Store refresh cookie name in a shared const: `REFRESH_COOKIE_NAME = 'confluent_refresh'`.
- `Secure` cookie flag → `NODE_ENV === 'production'`; false in dev so local HTTP works.
- The `@Public()` metadata key is `IS_PUBLIC_KEY = 'isPublic'` read by a `JwtAuthGuard` override of `canActivate` that short-circuits to `true` when the route is marked.
- Mocked `JwtService` in tests: `signAsync` returns a deterministic string, `verifyAsync` returns the payload.

## Dev Agent Record

### Review Findings

- [x] [Review][Patch] `AuthGuard` generic typing — `canActivate` return type required explicit `boolean | Promise<boolean> | Observable<boolean>` union. Fixed.
- [x] [Review][Patch] Zod 4 UUID validation rejects non-variant-compliant test UUIDs; replaced `111...` patterns with RFC-compliant `123e4567-e89b-42d3-a456-…` in the e2e spec.

### File List

**Created:**
- [apps/api/src/common/decorators/public.decorator.ts](../../../../../apps/api/src/common/decorators/public.decorator.ts)
- [apps/api/src/modules/auth/auth.constants.ts](../../../../../apps/api/src/modules/auth/auth.constants.ts)
- [apps/api/src/modules/auth/strategies/jwt.strategy.ts](../../../../../apps/api/src/modules/auth/strategies/jwt.strategy.ts)
- [apps/api/src/modules/auth/guards/jwt.guard.ts](../../../../../apps/api/src/modules/auth/guards/jwt.guard.ts)

**Modified:**
- [apps/api/src/modules/auth/auth.service.ts](../../../../../apps/api/src/modules/auth/auth.service.ts) (+ verifyMagicLink, refreshSession, issueSession)
- [apps/api/src/modules/auth/auth.controller.ts](../../../../../apps/api/src/modules/auth/auth.controller.ts) (+ verify, refresh, logout)
- [apps/api/src/modules/auth/auth.module.ts](../../../../../apps/api/src/modules/auth/auth.module.ts) (+ JwtModule, PassportModule, APP_GUARD)
- [apps/api/src/app.controller.ts](../../../../../apps/api/src/app.controller.ts) (+ @Public())
- [apps/api/src/main.ts](../../../../../apps/api/src/main.ts) (+ cookie-parser)
- [apps/api/test/auth.e2e-spec.ts](../../../../../apps/api/test/auth.e2e-spec.ts) (+ verify/logout/health cases)
- [apps/api/src/modules/auth/auth.service.spec.ts](../../../../../apps/api/src/modules/auth/auth.service.spec.ts)
- [apps/api/src/modules/auth/auth.controller.spec.ts](../../../../../apps/api/src/modules/auth/auth.controller.spec.ts)
- [apps/api/package.json](../../../../../apps/api/package.json)
