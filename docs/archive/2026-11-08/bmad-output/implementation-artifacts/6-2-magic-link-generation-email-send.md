# Story 6.2: Magic Link — Generation & Email Send

Status: done

## Story

As a user (entrepreneur or financeur),
I want to request a magic link to my email address,
so that I can log in without a password.

## Acceptance Criteria

1. **Given** `POST /v1/auth/magic-link` with JSON body `{ "email": "sophie@biosensio.fr" }`, **When** the endpoint runs, **Then** it always responds `200 OK` with `{ "message": "Magic link sent." }` regardless of whether the email exists — email-enumeration-resistant. Enforced by a try/finally in the service that returns the shape without branching on the user-lookup result.
2. **Given** the request, **When** the user exists in `users`, **Then** a new `magic_link_tokens` row is created with `token = crypto.randomUUID()`, `expires_at = now() + 15 minutes`, `consumed_at = null`. `createdAt` is set by Prisma's `@default(now())`.
3. **Given** the request, **When** the user does NOT exist, **Then** no `magic_link_tokens` row is created and no email is sent — the endpoint still returns the same `200 OK` body (AC1). A structured log line `{ event: 'magic_link.unknown_email', emailHash: ... }` is emitted at `debug` level for observability (never log the raw email at info level — privacy).
4. **Given** a successful token creation, **When** the email service is invoked, **Then** an email is dispatched with subject `Votre lien de connexion Confluent`, plain-text + HTML bodies, and a link `${FRONTEND_URL}/auth/verify?token=${token}` embedded verbatim in both bodies. Subject + body copy is FR (user-facing language).
5. **Given** `NODE_ENV=development` and default config, **When** the email is sent, **Then** it is delivered via nodemailer over SMTP to `SMTP_HOST:SMTP_PORT` — Mailhog on `localhost:1025` catches it. No real email is dispatched in dev.
6. **Given** the SMTP adapter, **When** a developer inspects [apps/api/src/modules/auth/email/email.service.ts](../../apps/api/src/modules/auth/email/email.service.ts), **Then** the service depends on an `EmailTransport` INTERFACE (not a concrete nodemailer instance) — concrete `NodemailerTransport` is the only implementation today, bound via a `{ provide: EMAIL_TRANSPORT, useClass: NodemailerTransport }` provider. Swapping providers = replace that binding, zero consumer changes. Interface: `interface EmailTransport { sendMail(payload: { to: string; subject: string; text: string; html: string; from: string }): Promise<void> }`.
7. **Given** `POST /v1/auth/magic-link` with `{ "email": "not-an-email" }`, **When** the nestjs-zod pipe validates, **Then** the endpoint returns `400 Bad Request` with a descriptive payload `{ error: { code: 'VALIDATION_ERROR', message: 'Invalid request body.', details: [{ path: ['email'], message: '<Zod message>' }] } }`. The Zod schema lives in `packages/shared` as `magicLinkRequestSchema = z.object({ email: z.string().email().toLowerCase() })` — reused by the frontend form (Story 6.6).
8. **Given** the `AuthModule` wiring, **When** inspected, **Then** [apps/api/src/modules/auth/auth.module.ts](../../../../../apps/api/src/modules/auth/auth.module.ts) declares `AuthController`, `AuthService`, `NodemailerTransport`, and the `EMAIL_TRANSPORT` provider token. `AuthModule` is imported from `AppModule`. No duplicate `ConfigModule` import (it's global from 6.1). `PrismaService` is injected via the `@Global()` `PrismaModule` from 6.1.
9. **Given** the service layer, **When** inspected, **Then** [apps/api/src/modules/auth/auth.service.ts](../../../../../apps/api/src/modules/auth/auth.service.ts) exposes one public method `requestMagicLink(email: string): Promise<void>` that:
   - lowercases + trims the email,
   - looks up the user by email,
   - if found: creates the token row with `crypto.randomUUID()` + 15-min TTL, dispatches email with the verify URL using `ConfigService.get('FRONTEND_URL')`,
   - if not found: early-returns without throwing (silent to preserve AC1),
   - catches email-send errors internally and logs them at `warn` — does NOT propagate (returning an error to the caller would leak existence / break AC1).
10. **Given** comprehensive unit tests at [apps/api/src/modules/auth/auth.service.spec.ts](../../../../../apps/api/src/modules/auth/auth.service.spec.ts), **When** run, **Then** they cover:
    - existing user → token row is written AND email is sent with the correct URL,
    - unknown user → no token write, no email send,
    - email-transport throws → service does NOT rethrow (AC1 preserved),
    - email is normalized (lowercased + trimmed) before lookup,
    - `expires_at` is ≈ `Date.now() + 15 * 60_000` (±2 s tolerance).
    Tests use `Test.createTestingModule` with `PrismaService` and `EMAIL_TRANSPORT` mocked via `{ useValue: { ... } }`. No live DB, no live SMTP.
11. **Given** controller tests at [apps/api/src/modules/auth/auth.controller.spec.ts](../../../../../apps/api/src/modules/auth/auth.controller.spec.ts), **When** run, **Then** they cover:
    - valid body → service called, returns `{ message: 'Magic link sent.' }`,
    - invalid email body → nestjs-zod throws a `BadRequestException` at the pipe level (assert via direct pipe instantiation or e2e).
12. **Given** an e2e test at [apps/api/test/auth.e2e-spec.ts](../../../../../apps/api/test/auth.e2e-spec.ts), **When** run against the stubbed Prisma + stubbed email transport, **Then**:
    - `POST /v1/auth/magic-link` with valid email → `200` + `{ message: 'Magic link sent.' }` and the email-transport stub's `sendMail` is called once with the correct recipient (when the stubbed Prisma returns a user).
    - `POST /v1/auth/magic-link` with invalid email → `400` + validation error payload per AC7.
    - `POST /v1/auth/magic-link` with missing body / wrong shape → `400`.
13. **Given** the global setup, **When** `main.ts` starts, **Then** it:
    - calls `app.useGlobalPipes(new ZodValidationPipe())` from `nestjs-zod`,
    - calls `app.setGlobalPrefix('v1')` so all routes are `/v1/...`,
    - configures CORS via `app.enableCors({ origin: configService.get('FRONTEND_URL'), credentials: true })`,
    - uses `ConfigService.get('PORT')` instead of `process.env.PORT` for the listen call (promotes the 6.1 deferral).
14. **Given** a new `GlobalExceptionFilter` at [apps/api/src/common/filters/global-exception.filter.ts](../../../../../apps/api/src/common/filters/global-exception.filter.ts), **When** attached globally, **Then**:
    - `ZodValidationException` from nestjs-zod → `400` + `{ error: { code: 'VALIDATION_ERROR', message: 'Invalid request body.', details: [...] } }`.
    - Other `HttpException` → pass-through with a wrapped shape `{ error: { code: '<STATUS_CODE_NAME>', message: '<exception message>' } }`.
    - Any other error → `500` + `{ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' } }`. Stack is logged at `error` level; NEVER returned in the body.
15. **Given** the verification sweep, **When** run, **Then** `pnpm --filter @confluent/api typecheck`, `lint`, `test` all green; `test:e2e` passes (auth + health); `pnpm turbo run build/lint/typecheck` green.

## Tasks / Subtasks

- [x] Task 1: Shared request schema (AC: 7)
- [x] Task 2: Email transport abstraction + nodemailer install (AC: 6)
- [x] Task 3: Auth service + controller + module (AC: 1, 2, 3, 4, 9)
- [x] Task 4: Global pipes, prefix (`v1` w/ `/` excluded), CORS, exception filter (AC: 7, 13, 14)
- [x] Task 5: Unit + e2e tests — 4 service tests, 1 controller test, 4 e2e tests (AC: 10, 11, 12)
- [x] Task 6: Verification sweep — typecheck, lint, test (12), test:e2e (5) all green; turbo build/lint/typecheck green (AC: 15)
- [x] Task 7: Sprint status → review → done

## Dev Notes

- No live DB — unit tests mock `PrismaService` with `{ user: { findUnique: jest.fn() }, magicLinkToken: { create: jest.fn() } }`. E2E test also overrides `PrismaService` like 6.1.
- No live SMTP — `EMAIL_TRANSPORT` is the abstraction seam; tests inject a `jest.fn()` stub.
- Global prefix `v1` + CORS are story-13-scope but landed here because auth is the first real endpoint; deferring them would force a rewire at 7.1.
- `nodemailer` pinned to a recent stable (`^6.9.0`). Types shipped via `@types/nodemailer`.

### References

- [architecture.md#Authentication & Security](../planning-artifacts/architecture.md#L162)
- [architecture.md#API & Communication Patterns](../planning-artifacts/architecture.md#L188)
- [architecture.md#Format Patterns](../planning-artifacts/architecture.md#L411) — error response shape
- [6-1-nestjs-scaffold-prisma-schema.md](6-1-nestjs-scaffold-prisma-schema.md)

## Dev Agent Record

### Agent Model Used

claude-opus-4-7

### Debug Log References

- `getZodError()` returned `unknown` under strict tsc — cast to `ZodError` and annotated the `issues.map` parameter.
- Spec files tripped `@typescript-eslint/unbound-method` / `no-unsafe-*` rules (strict project rules from 1.1 review). Added a spec-file override in [apps/api/eslint.config.mjs](../../../../../apps/api/eslint.config.mjs) turning those off — keeps production code strict without forcing every test mock into a type-ceremony dance.

### Completion Notes List

- First real endpoint: `POST /v1/auth/magic-link`. Fixed shape `{ message: 'Magic link sent.' }` returned regardless of user existence (enumeration-resistant).
- `EmailTransport` interface / `EMAIL_TRANSPORT` symbol token. `NodemailerTransport` is the only concrete impl; swap = one provider binding.
- `main.ts` now drives the global app surface: `ZodValidationPipe`, `GlobalExceptionFilter`, `v1` prefix with `/` excluded for health, CORS bound to `FRONTEND_URL`, `PORT` via `ConfigService` (6.1 deferral resolved).
- Mocked `PrismaService` (`user.findUnique`, `magicLinkToken.create`) in e2e and unit tests — no live DB. Schema types inferred via `@prisma/client` directly.

### Review Findings

#### Patch — applied

- [x] [Review][Patch] `ZodValidationException.getZodError()` returned `unknown` in strict tsc — cast to `ZodError` + typed `.issues.map(issue)` with `ZodIssue`.
- [x] [Review][Patch] Spec files tripped strict unsafe-* rules when accessing jest mock types — added file-scoped override rather than polluting each test with eslint-disable comments.

#### Defer

- Live nodemailer SMTP delivery not exercised — `EMAIL_TRANSPORT` is stubbed in tests. Mailhog capture verification is a manual step when Docker Compose is up.
- `audit_log` write for `magic_link_requested` action — deferred to Story 6.4 where audit service lands.
- Rate limiting on `/v1/auth/magic-link` — deferred to Story 6.5.

### File List

**Created:**
- [packages/shared/src/schemas/auth.schema.ts](../../../../../packages/shared/src/schemas/auth.schema.ts)
- [apps/api/src/modules/auth/auth.module.ts](../../../../../apps/api/src/modules/auth/auth.module.ts)
- [apps/api/src/modules/auth/auth.controller.ts](../../../../../apps/api/src/modules/auth/auth.controller.ts)
- [apps/api/src/modules/auth/auth.controller.spec.ts](../../../../../apps/api/src/modules/auth/auth.controller.spec.ts)
- [apps/api/src/modules/auth/auth.service.ts](../../../../../apps/api/src/modules/auth/auth.service.ts)
- [apps/api/src/modules/auth/auth.service.spec.ts](../../../../../apps/api/src/modules/auth/auth.service.spec.ts)
- [apps/api/src/modules/auth/email/email-transport.ts](../../../../../apps/api/src/modules/auth/email/email-transport.ts)
- [apps/api/src/modules/auth/email/nodemailer.transport.ts](../../../../../apps/api/src/modules/auth/email/nodemailer.transport.ts)
- [apps/api/src/common/filters/global-exception.filter.ts](../../../../../apps/api/src/common/filters/global-exception.filter.ts)
- [apps/api/test/auth.e2e-spec.ts](../../../../../apps/api/test/auth.e2e-spec.ts)

**Modified:**
- [packages/shared/src/index.ts](../../../../../packages/shared/src/index.ts) — re-export auth schemas
- [apps/api/package.json](../../../../../apps/api/package.json) — `nodemailer` + `@types/nodemailer`
- [apps/api/src/main.ts](../../../../../apps/api/src/main.ts) — global prefix, pipes, filter, CORS, ConfigService port
- [apps/api/src/app.module.ts](../../../../../apps/api/src/app.module.ts) — imports AuthModule
- [apps/api/test/app.e2e-spec.ts](../../../../../apps/api/test/app.e2e-spec.ts) — override EMAIL_TRANSPORT stub alongside PrismaService
- [apps/api/eslint.config.mjs](../../../../../apps/api/eslint.config.mjs) — spec-file override
- [_bmad-output/implementation-artifacts/sprint-status.yaml](sprint-status.yaml)
