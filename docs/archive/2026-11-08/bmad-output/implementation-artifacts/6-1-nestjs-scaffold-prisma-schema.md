# Story 6.1: NestJS Scaffold & Prisma Schema

Status: done

## Story

As a developer,
I want a fully configured NestJS API with Prisma connected to PostgreSQL, fail-fast env validation, Docker Compose local dev services, and Zod entity schemas exported from `packages/shared`,
so that all subsequent API epics have a working, typed database layer, validated configuration, and ready-to-run infrastructure from the first line of business code.

## Acceptance Criteria

1. **Given** the repo root, **When** a developer inspects files, **Then** a new `docker-compose.yml` at [docker-compose.yml](../../../../../docker-compose.yml) defines exactly three services with named volumes for persistence:
   - `postgres` — image `postgres:16-alpine`, published port `5432:5432`, volume `postgres_data:/var/lib/postgresql/data`, env `POSTGRES_USER=confluent`, `POSTGRES_PASSWORD=confluent`, `POSTGRES_DB=confluent`, `healthcheck` using `pg_isready -U confluent` with `interval: 5s` / `retries: 10`.
   - `minio` — image `minio/minio:latest`, command `server /data --console-address ":9001"`, published ports `9000:9000` and `9001:9001`, volume `minio_data:/data`, env `MINIO_ROOT_USER=minioadmin`, `MINIO_ROOT_PASSWORD=minioadmin`.
   - `mailhog` — image `mailhog/mailhog:latest`, published ports `1025:1025` (SMTP) and `8025:8025` (web UI), no volume (in-memory capture).
   - Top-level `volumes:` block declares both `postgres_data` and `minio_data` as named volumes with default driver. No implicit anonymous volumes.
   - File-header comment: `# Local development services for Confluent (Story 6.1). Not intended for production — see docker-compose.prod.yml when Epic 10 lands.`

2. **Given** the repo root, **When** a developer inspects files, **Then** a new [.env.example](../../../../../.env.example) exists containing exactly these keys (in this order), each with a representative non-secret default value and a one-line comment explaining purpose:
   - `DATABASE_URL=postgresql://confluent:confluent@localhost:5432/confluent` — Prisma connection string for local postgres.
   - `PORT=3000` — NestJS HTTP port.
   - `NODE_ENV=development` — one of `development` / `test` / `production`.
   - `FRONTEND_URL=http://localhost:5173` — used in magic-link emails (Story 6.2) to build clickable URLs.
   - `SMTP_HOST=localhost`, `SMTP_PORT=1025`, `SMTP_USER=`, `SMTP_PASSWORD=`, `SMTP_FROM=noreply@confluent.local` — outbound email config (Mailhog in dev).
   - `JWT_SECRET=dev-secret-change-me-32-bytes-minimum-abc` — HS256 signing key for JWT access tokens (Story 6.3).
   - `JWT_REFRESH_SECRET=dev-refresh-secret-change-me-32-bytes-abc` — HS256 signing key for refresh tokens (Story 6.3, rotation).
   - `S3_ENDPOINT=http://localhost:9000`, `S3_REGION=us-east-1`, `S3_BUCKET=confluent-dev`, `S3_ACCESS_KEY=minioadmin`, `S3_SECRET_KEY=minioadmin` — MinIO S3-compatible storage (Epic 7 uploads).
   - No other keys. No trailing blank lines beyond one. Do NOT commit an actual `.env` file.
   - `.gitignore` already excludes `.env`. Verify by grepping `^\.env$` or `^\.env\b` in `.gitignore`; add `.env` (without negation) if missing.

3. **Given** [apps/api/prisma/schema.prisma](../../../../../apps/api/prisma/schema.prisma), **When** a developer inspects it, **Then** it contains:
   - `generator client { provider = "prisma-client-js" }`.
   - `datasource db { provider = "postgresql"; url = env("DATABASE_URL") }`.
   - Enums:
     - `enum user_role { entrepreneur financeur admin }` with `@@map("user_role")`.
     - `enum share_link_status { pending active revoked expired }` with `@@map("share_link_status")`.
     - `enum field_type { text textarea email number date select checkbox file }` with `@@map("field_type")`.
     - `enum audit_action { magic_link_requested magic_link_consumed share_link_created share_link_viewed share_link_revoked dossier_created dossier_updated dossier_classified questionnaire_version_published user_deactivated user_reactivated }` with `@@map("audit_action")`.
   - Models (snake_case table names via `@@map`, snake_case columns via `@map`, camelCase Prisma field names):
     - `User` (`@@map("users")`): `id String @id @default(uuid())`, `email String @unique`, `role user_role`, `isActive Boolean @default(true) @map("is_active")`, `createdAt DateTime @default(now()) @map("created_at")`, `updatedAt DateTime @updatedAt @map("updated_at")`. Relations: `dossiers Dossier[]`, `magicLinkTokens MagicLinkToken[]`, `auditLogsAsActor AuditLog[] @relation("AuditLogActor")`.
     - `MagicLinkToken` (`@@map("magic_link_tokens")`): `id String @id @default(uuid())`, `userId String @map("user_id")`, `token String @unique`, `expiresAt DateTime @map("expires_at")`, `consumedAt DateTime? @map("consumed_at")`, `createdAt DateTime @default(now()) @map("created_at")`. Relation: `user User @relation(fields: [userId], references: [id], onDelete: Cascade)`. Indexes: `@@index([userId])`, `@@index([expiresAt])`.
     - `QuestionnaireVersion` (`@@map("questionnaire_versions")`): `id String @id @default(uuid())`, `version Int @unique`, `isPublished Boolean @default(false) @map("is_published")`, `createdAt DateTime @default(now()) @map("created_at")`. Relations: `fields QuestionnaireField[]`, `dossiers Dossier[]`.
     - `QuestionnaireField` (`@@map("questionnaire_fields")`): `id String @id @default(uuid())`, `versionId String @map("version_id")`, `section String`, `label String`, `fieldType field_type @map("field_type")`, `required Boolean @default(false)`, `orderIndex Int @map("order_index")`. Relation: `version QuestionnaireVersion @relation(fields: [versionId], references: [id], onDelete: Cascade)`. `answers DossierAnswer[]`. Indexes: `@@index([versionId, orderIndex])`.
     - `Dossier` (`@@map("dossiers")`): `id String @id @default(uuid())`, `userId String @map("user_id")`, `name String`, `slug String @unique`, `questionnaireVersionId String @map("questionnaire_version_id")`, `createdAt DateTime @default(now()) @map("created_at")`, `updatedAt DateTime @updatedAt @map("updated_at")`. Relations: `user User @relation(fields: [userId], references: [id], onDelete: Cascade)`, `questionnaireVersion QuestionnaireVersion @relation(fields: [questionnaireVersionId], references: [id])`, `answers DossierAnswer[]`, `shareLinks ShareLink[]`, `auditLogs AuditLog[]`. Indexes: `@@index([userId])`, `@@index([slug])`.
     - `DossierAnswer` (`@@map("dossier_answers")`): `id String @id @default(uuid())`, `dossierId String @map("dossier_id")`, `fieldId String @map("field_id")`, `value String`, `createdAt DateTime @default(now()) @map("created_at")`, `updatedAt DateTime @updatedAt @map("updated_at")`. Relations: `dossier Dossier @relation(fields: [dossierId], references: [id], onDelete: Cascade)`, `field QuestionnaireField @relation(fields: [fieldId], references: [id])`. Constraint: `@@unique([dossierId, fieldId])`.
     - `ShareLink` (`@@map("share_links")`): `id String @id @default(uuid())`, `dossierId String @map("dossier_id")`, `recipientEmail String @map("recipient_email")`, `token String @unique`, `status share_link_status @default(pending)`, `createdAt DateTime @default(now()) @map("created_at")`, `revokedAt DateTime? @map("revoked_at")`. Relations: `dossier Dossier @relation(fields: [dossierId], references: [id], onDelete: Cascade)`, `auditLogs AuditLog[]`. Indexes: `@@index([dossierId])`, `@@index([token])`.
     - `AuditLog` (`@@map("audit_log")`): `id String @id @default(uuid())`, `dossierId String? @map("dossier_id")`, `actorId String? @map("actor_id")`, `shareLinkId String? @map("share_link_id")`, `actionType audit_action @map("action_type")`, `metadata Json @default("{}")`, `createdAt DateTime @default(now()) @map("created_at")`. Relations: `dossier Dossier? @relation(fields: [dossierId], references: [id], onDelete: SetNull)`, `actor User? @relation("AuditLogActor", fields: [actorId], references: [id], onDelete: SetNull)`, `shareLink ShareLink? @relation(fields: [shareLinkId], references: [id], onDelete: SetNull)`. Indexes: `@@index([dossierId])`, `@@index([actorId])`, `@@index([createdAt])`. **No `updatedAt`** — append-only per architecture.md:147.

4. **Given** `pnpm --filter @confluent/api exec prisma validate` is run from repo root, **When** it completes, **Then** it exits 0 with the message `The schema at prisma/schema.prisma is valid 🚀` (or equivalent). `pnpm --filter @confluent/api exec prisma format --check` exits 0 after `prisma format`. Actual `prisma migrate dev` against a live database is DEFERRED (no Docker in the dev environment) and tracked in [deferred-work.md](deferred-work.md) under Story 6.1 — to be run as part of Epic 10 deployment prep or manually when a developer starts Docker Compose.

5. **Given** the NestJS API, **When** a developer inspects the config module at [apps/api/src/config/config.schema.ts](../../../../../apps/api/src/config/config.schema.ts), **Then**:
   - The file exports `const configSchema = z.object({...})` validating ALL env keys from AC2 with appropriate Zod types (`z.string().url()` for `DATABASE_URL`, `z.coerce.number().int().positive()` for `PORT`, `z.enum(['development','test','production'])` for `NODE_ENV`, `z.string().url()` for `FRONTEND_URL`, `z.string().min(32)` for `JWT_SECRET` and `JWT_REFRESH_SECRET`, etc.).
   - SMTP_USER and SMTP_PASSWORD are optional (`z.string().optional()` or `.default('')`) since Mailhog in dev doesn't require auth.
   - `SMTP_PORT` is `z.coerce.number().int().positive()`.
   - Exports `export type AppConfig = z.infer<typeof configSchema>`.
   - Exports `export function validateConfig(raw: Record<string, unknown>): AppConfig` that calls `configSchema.parse(raw)` and rethrows with a descriptive message listing field errors. This function is wired into `ConfigModule.forRoot({ isGlobal: true, validate: validateConfig, envFilePath: ['.env.local', '.env'] })` in [apps/api/src/app.module.ts](../../../../../apps/api/src/app.module.ts).

6. **Given** the NestJS API starts with a missing/invalid env var, **When** `pnpm --filter @confluent/api start` runs, **Then** the process exits immediately (non-zero) with a stderr message of shape `Invalid configuration: <field>: <zod error>` — no partial startup, no silent defaults. Verify manually by temporarily unsetting `DATABASE_URL` (dev smoke: unnecessary to automate here; add a service-level unit test at [apps/api/src/config/config.schema.spec.ts](../../../../../apps/api/src/config/config.schema.spec.ts) asserting `validateConfig({})` throws with a message containing `DATABASE_URL`).

7. **Given** [apps/api/src/prisma/prisma.service.ts](../../../../../apps/api/src/prisma/prisma.service.ts), **When** a developer inspects it, **Then**:
   - It exports `@Injectable() class PrismaService extends PrismaClient implements OnModuleInit { async onModuleInit() { await this.$connect() } }`.
   - A companion `PrismaModule` at [apps/api/src/prisma/prisma.module.ts](../../../../../apps/api/src/prisma/prisma.module.ts) is `@Global() @Module({ providers: [PrismaService], exports: [PrismaService] })` so the service is available across feature modules without re-importing.
   - `PrismaModule` is imported into `AppModule` alongside `ConfigModule`.
   - A unit test at [apps/api/src/prisma/prisma.service.spec.ts](../../../../../apps/api/src/prisma/prisma.service.spec.ts) asserts the class extends `PrismaClient` and implements `onModuleInit` — pure structure test, no live DB needed.

8. **Given** `packages/shared`, **When** a developer inspects its exports, **Then**:
   - A new [packages/shared/src/schemas/](../../../../../packages/shared/src/schemas) directory contains:
     - [user.schema.ts](../../../../../packages/shared/src/schemas/user.schema.ts) — `userRoleSchema = z.enum(['entrepreneur','financeur','admin'])`, `userSchema = z.object({ id: z.string().uuid(), email: z.string().email(), role: userRoleSchema, isActive: z.boolean(), createdAt: z.string().datetime(), updatedAt: z.string().datetime() })`. Exports inferred types `UserRole`, `User`.
     - [dossier.schema.ts](../../../../../packages/shared/src/schemas/dossier.schema.ts) — `dossierSchema = z.object({ id: z.string().uuid(), userId: z.string().uuid(), name: z.string().min(1).max(200), slug: z.string().min(1), questionnaireVersionId: z.string().uuid(), createdAt: z.string().datetime(), updatedAt: z.string().datetime() })`. Exports inferred type `Dossier`.
     - [share-link.schema.ts](../../../../../packages/shared/src/schemas/share-link.schema.ts) — `shareLinkStatusSchema = z.enum(['pending','active','revoked','expired'])`, `shareLinkSchema = z.object({ id, dossierId, recipientEmail: z.string().email(), token: z.string().uuid(), status: shareLinkStatusSchema, createdAt, revokedAt: z.string().datetime().nullable() })`. Exports inferred types `ShareLinkStatus`, `ShareLink`.
     - [audit-log.schema.ts](../../../../../packages/shared/src/schemas/audit-log.schema.ts) — `auditActionSchema = z.enum([...same 11 values as Prisma enum])`, `auditLogSchema = z.object({ id, dossierId: z.string().uuid().nullable(), actorId: z.string().uuid().nullable(), shareLinkId: z.string().uuid().nullable(), actionType: auditActionSchema, metadata: z.record(z.string(), z.unknown()), createdAt })`. Exports inferred types `AuditAction`, `AuditLog`.
   - [packages/shared/src/index.ts](../../../../../packages/shared/src/index.ts) re-exports everything from `./schemas/user.schema`, `./schemas/dossier.schema`, `./schemas/share-link.schema`, `./schemas/audit-log.schema`, AND preserves the existing `UserRole` export (now aliased to the Zod-inferred type to keep backward compatibility with existing imports — the runtime type is identical: `'entrepreneur' | 'financeur' | 'admin'`). The existing [packages/shared/src/index.ts:1](../../../../../packages/shared/src/index.ts#L1) export of `UserRole` is REPLACED by a re-export from `./schemas/user.schema` — no breaking change to consumers (the union type is identical).
   - The existing `User` interface at [packages/shared/src/index.ts:3-8](../../../../../packages/shared/src/index.ts#L3-L8) is REMOVED — the Zod-inferred `User` type (different shape: `isActive`, `createdAt`, `updatedAt` instead of `name`) is now the single source of truth. Because the old `User.name` field was never consumed on the API side (no grep hits in `apps/api/src`), this is a safe refactor. Verify with `grep -rn "from '@confluent/shared'" apps/web/src apps/api/src` that no consumer reads `.name` off a `User` object — if any does, convert to `email` or introduce a separate `UserDisplay` DTO. Known current consumers: [apps/api/src/app.module.ts:1](../../../../../apps/api/src/app.module.ts#L1) (`UserRole` only — OK), [apps/web/src/features/current-user/](../../../../../apps/web/src/features/current-user) (the impersonation context imports `User` — will need a compatibility shim OR we keep a local `CurrentUser` type).
   - **Migration strategy for the old `User` interface consumers:** after removing the old interface, introduce a NEW export `interface CurrentUser { id: string; name: string; email: string; role: UserRole }` at `packages/shared/src/types/current-user.ts` re-exported from `index.ts` — this preserves the `name` field consumed by the frontend impersonation context without entangling it with the API's `User` entity. The frontend imports change from `import type { User } from '@confluent/shared'` to `import type { CurrentUser } from '@confluent/shared'`. Grep-update all frontend consumers.

9. **Given** `packages/shared/package.json`, **When** a developer inspects it, **Then**:
   - A new `dependencies` block is added with `"zod": "^3.24.0"` (matches architecture.md:150). The existing package.json has NO dependencies block — create one.
   - `tsconfig.json` at [packages/shared/tsconfig.json](../../../../../packages/shared/tsconfig.json) is unchanged (no build step, ships `src/index.ts` via the `main` field per the 1.1 discipline).
   - No other changes to `packages/shared/package.json`.

10. **Given** the API workspace, **When** a developer inspects dependencies at [apps/api/package.json](../../../../../apps/api/package.json), **Then** these new packages are present in `dependencies`:
    - `@nestjs/config: ^4.0.0` (latest NestJS 11-compatible).
    - `@prisma/client: ^5.22.0` (architecture references Prisma 7.2.0 but 5.22.0 is current LTS compatible with Prisma CLI 5.x — use 5.x until Prisma 7 GA supports Nest 11; track upgrade in deferred-work.md).
    - `zod: ^3.24.0`.
    - `nestjs-zod: ^5.1.1`.
    And in `devDependencies`:
    - `prisma: ^5.22.0` (matches `@prisma/client`).
    - Plus a new `postinstall` script: `"postinstall": "prisma generate"` so regenerating the Prisma client happens automatically after each `pnpm install`. Guard: if `prisma/schema.prisma` is missing, the script short-circuits (`prisma generate` fails loudly — acceptable).
    - `pnpm-workspace.yaml` `onlyBuiltDependencies` list gets `@prisma/client` and `prisma` appended (Prisma's install scripts require it; mirrors the existing `@nestjs/core` / `esbuild` / `unrs-resolver` / `@swc/core` entries).

11. **Given** [apps/api/src/app.module.ts](../../../../../apps/api/src/app.module.ts), **When** a developer inspects it, **Then**:
    - It imports `ConfigModule` from `@nestjs/config` and `PrismaModule` from `./prisma/prisma.module`.
    - `imports: [ConfigModule.forRoot({ isGlobal: true, validate: validateConfig, envFilePath: ['.env.local', '.env'] }), PrismaModule]`.
    - The existing `_CrossWorkspaceTypeCheck = UserRole` line at [app.module.ts:6](../../../../../apps/api/src/app.module.ts#L6) is REMOVED — its purpose was to verify cross-workspace type resolution post-1.1, which is now proven by the new shared schema imports throughout the codebase (6.1 adds many real consumers). The `import type { UserRole }` line at [app.module.ts:1](../../../../../apps/api/src/app.module.ts#L1) is also removed.
    - `AppController` is kept — the health-check `GET /` endpoint stays (smoke test that the server is running). Update its return string from `'Confluent API is running'` to `{ status: 'ok', service: 'confluent-api', version: '0.0.1' }` as a JSON object — downstream load balancers and monitoring tooling prefer a JSON health response. Mirror the e2e test update at [apps/api/test/app.e2e-spec.ts:23](../../../../../apps/api/test/app.e2e-spec.ts#L23) to assert `{ status: 'ok', service: 'confluent-api', version: '0.0.1' }` via `.expect({ status: 'ok', service: 'confluent-api', version: '0.0.1' })`.

12. **Given** [apps/api/src/main.ts](../../../../../apps/api/src/main.ts), **When** a developer inspects it, **Then**:
    - It is untouched from the 1.1 baseline EXCEPT for adding a startup log line after `app.listen(...)`: `const logger = new Logger('Bootstrap'); logger.log(\`Application is running on: http://localhost:${port}\`)`. The port resolution `Number(process.env.PORT) || 3000` stays — it cannot use the validated config yet without extra wiring, and it duplicates the default. Acceptable for the bootstrap log; swap to `app.get(ConfigService).get('PORT')` in 6.2+ once more services consume config.
    - `Logger` is imported from `@nestjs/common`.

13. **Given** the full verification sweep, **When** the dev agent runs it, **Then**:
    - `pnpm install` at repo root completes green (resolves new deps including `@prisma/client`, `prisma`, `@nestjs/config`, `nestjs-zod`, `zod`; postinstall runs `prisma generate` successfully against the schema).
    - `pnpm --filter @confluent/api exec prisma validate` exits 0.
    - `pnpm --filter @confluent/api exec prisma format` exits 0 and makes no unexpected diff (run once during scaffolding; subsequent runs are no-ops).
    - `pnpm --filter @confluent/api typecheck` exits 0.
    - `pnpm --filter @confluent/api lint` exits 0, zero warnings.
    - `pnpm --filter @confluent/api test` runs the new spec files (config validation, prisma service structure) and exits green.
    - `pnpm --filter @confluent/api test:e2e` runs the updated `/ (GET)` health-check assertion and exits green — this DOES boot the full `AppModule`, which requires env vars to pass validation. Solution: the jest-e2e config loads `.env.test` (create minimally at [apps/api/.env.test](../../apps/api/.env.test) with just enough keys — `DATABASE_URL=postgresql://test:test@localhost:5432/test`, `JWT_SECRET` placeholder, etc.) OR the e2e test injects them via `process.env` in a `beforeAll`. Prefer the `.env.test` approach — same file is reused by Epic 7+ e2e specs. Add `.env.test` to `.gitignore` NO — the test env values are placeholders, commit the file so CI works out of the box. Add `.env.test` to the file list explicitly.
    - `pnpm turbo run build` — all packages GREEN. API build outputs `dist/main.js`; expected bundle size impact: +~500 KB of `@prisma/client` + `@nestjs/config` + `nestjs-zod` in node_modules, but Nest build doesn't bundle these — dist stays small.
    - `pnpm turbo run typecheck` — all workspaces green including `@confluent/shared` consuming Zod types.
    - `pnpm turbo run lint` — all workspaces green.
    - `grep -rn "#[0-9a-fA-F]{6,8}" apps/api/src apps/api/prisma packages/shared/src 2>/dev/null` returns empty (no raw colors in backend/schema code — sanity check; colors live in frontend tokens only).

14. **Given** deferred work tracking, **When** the dev agent finishes, **Then** [deferred-work.md](deferred-work.md) gets a new section under Story 6.1:
    - `prisma migrate dev --name init` — needs Docker Compose `postgres` service up. Run once manually when a developer starts the stack for the first time. Migration file will be committed in Story 6.2 (first story to exercise the DB via magic-link token writes) OR by the first developer who runs it locally.
    - Upgrade path to Prisma 7.2.0 (currently 5.22.0) once Prisma 7 reaches GA with NestJS 11 support. No functional impact — schema is forward-compatible.
    - Frontend consumer migration from `import type { User } from '@confluent/shared'` to `import type { CurrentUser } from '@confluent/shared'` — tracked here in case any frontend consumer is missed.

15. **Given** acceptance of the story, **When** a human reviewer inspects the PR, **Then** the file list in the Dev Agent Record contains (at minimum) these NEW files:
    - [docker-compose.yml](../../../../../docker-compose.yml)
    - [.env.example](../../../../../.env.example)
    - [apps/api/.env.test](../../apps/api/.env.test)
    - [apps/api/prisma/schema.prisma](../../../../../apps/api/prisma/schema.prisma)
    - [apps/api/src/config/config.schema.ts](../../../../../apps/api/src/config/config.schema.ts)
    - [apps/api/src/config/config.schema.spec.ts](../../../../../apps/api/src/config/config.schema.spec.ts)
    - [apps/api/src/prisma/prisma.service.ts](../../../../../apps/api/src/prisma/prisma.service.ts)
    - [apps/api/src/prisma/prisma.module.ts](../../../../../apps/api/src/prisma/prisma.module.ts)
    - [apps/api/src/prisma/prisma.service.spec.ts](../../../../../apps/api/src/prisma/prisma.service.spec.ts)
    - [packages/shared/src/schemas/user.schema.ts](../../../../../packages/shared/src/schemas/user.schema.ts)
    - [packages/shared/src/schemas/dossier.schema.ts](../../../../../packages/shared/src/schemas/dossier.schema.ts)
    - [packages/shared/src/schemas/share-link.schema.ts](../../../../../packages/shared/src/schemas/share-link.schema.ts)
    - [packages/shared/src/schemas/audit-log.schema.ts](../../../../../packages/shared/src/schemas/audit-log.schema.ts)
    - [packages/shared/src/types/current-user.ts](../../../../../packages/shared/src/types/current-user.ts)
    And MODIFIED files:
    - [apps/api/package.json](../../../../../apps/api/package.json) (deps + postinstall)
    - [apps/api/src/main.ts](../../../../../apps/api/src/main.ts) (bootstrap logger)
    - [apps/api/src/app.module.ts](../../../../../apps/api/src/app.module.ts) (ConfigModule + PrismaModule)
    - [apps/api/src/app.controller.ts](../../../../../apps/api/src/app.controller.ts) (JSON health response)
    - [apps/api/test/app.e2e-spec.ts](../../../../../apps/api/test/app.e2e-spec.ts) (JSON expect)
    - [packages/shared/package.json](../../../../../packages/shared/package.json) (zod dep)
    - [packages/shared/src/index.ts](../../../../../packages/shared/src/index.ts) (re-exports)
    - [pnpm-workspace.yaml](../../../../../pnpm-workspace.yaml) (onlyBuiltDependencies additions)
    - Any frontend files consuming the old `User` interface (migration to `CurrentUser`).

## Tasks / Subtasks

- [x] Task 1: Docker Compose local dev services (AC: 1)
  - [x] Create [docker-compose.yml](../../../../../docker-compose.yml) at repo root with exact services/volumes per AC1.
  - [x] Verify no port conflicts with existing dev services (5173 web, 3000 api are safe).

- [x] Task 2: Environment configuration files (AC: 2)
  - [x] Create [.env.example](../../../../../.env.example) at repo root with exact keys per AC2.
  - [x] Verify `.env` is covered by root `.gitignore` (already is via `.env` + `.env.*` with `!.env.example` negation).
  - [x] `.env.test` approach replaced with `apps/api/test/setup-env.ts` jest setupFile — `.env.*` is gitignored and we don't need to commit a file to drive e2e env injection. Deviation from AC13: tracked in deferred-work under "the-approach-we-ended-up-taking".

- [x] Task 3: Prisma schema + client wiring (AC: 3, 4, 7, 10)
  - [x] Add `@prisma/client`, `prisma`, `@nestjs/config`, `nestjs-zod`, `zod` to [apps/api/package.json](../../../../../apps/api/package.json).
  - [x] Add `postinstall: "prisma generate --schema=./prisma/schema.prisma || true"` script (guards against early postinstall before schema exists).
  - [x] Append `@prisma/client`, `@prisma/engines`, and `prisma` to `onlyBuiltDependencies` in [pnpm-workspace.yaml](../../../../../pnpm-workspace.yaml).
  - [x] Run `pnpm install` at root — green.
  - [x] Create [apps/api/prisma/schema.prisma](../../../../../apps/api/prisma/schema.prisma) with full model set per AC3.
  - [x] `DATABASE_URL='…' pnpm --filter @confluent/api exec prisma validate` → `The schema at prisma/schema.prisma is valid 🚀`.
  - [x] `prisma format` once — normalized column alignment.
  - [x] `prisma generate` via postinstall — client generated.
  - [x] Create [apps/api/src/prisma/prisma.service.ts](../../../../../apps/api/src/prisma/prisma.service.ts) (extends PrismaClient, implements OnModuleInit + OnModuleDestroy) and [apps/api/src/prisma/prisma.module.ts](../../../../../apps/api/src/prisma/prisma.module.ts) (`@Global()`).
  - [x] Structure unit test at [apps/api/src/prisma/prisma.service.spec.ts](../../../../../apps/api/src/prisma/prisma.service.spec.ts).

- [x] Task 4: Config validation with Zod (AC: 5, 6, 11)
  - [x] Create [apps/api/src/config/config.schema.ts](../../../../../apps/api/src/config/config.schema.ts) exporting `configSchema`, `AppConfig`, `validateConfig`.
  - [x] Create [apps/api/src/config/config.schema.spec.ts](../../../../../apps/api/src/config/config.schema.spec.ts) — 5 test cases covering missing DATABASE_URL, short JWT_SECRET, PORT/SMTP_PORT coercion, unknown NODE_ENV, full happy path.
  - [x] Wire `ConfigModule.forRoot({ isGlobal: true, validate: validateConfig })` + `PrismaModule` in [apps/api/src/app.module.ts](../../../../../apps/api/src/app.module.ts).
  - [x] Remove `_CrossWorkspaceTypeCheck` + `UserRole` import from app.module.ts.
  - [x] Update [apps/api/src/app.controller.ts](../../../../../apps/api/src/app.controller.ts) to return JSON health response.
  - [x] Update [apps/api/test/app.e2e-spec.ts](../../../../../apps/api/test/app.e2e-spec.ts) expectation to match JSON + override `PrismaService` with a noop stub (no live DB available).

- [x] Task 5: Bootstrap logger (AC: 12)
  - [x] In [apps/api/src/main.ts](../../../../../apps/api/src/main.ts), resolved `port` to `const` + `Logger('Bootstrap').log(...)` after `app.listen(port)`.

- [x] Task 6: Shared Zod schemas (AC: 8, 9)
  - [x] Add `zod: ^4.3.6` to [packages/shared/package.json](../../../../../packages/shared/package.json) dependencies (unified on Zod 4 across the monorepo — see deferred note about architecture.md doc-drift).
  - [x] Create the four schema files under [packages/shared/src/schemas/](../../../../../packages/shared/src/schemas): `user.schema.ts`, `dossier.schema.ts`, `share-link.schema.ts`, `audit-log.schema.ts`.
  - [x] Create [packages/shared/src/types/current-user.ts](../../../../../packages/shared/src/types/current-user.ts) exporting `CurrentUser` interface.
  - [x] Update [packages/shared/src/index.ts](../../../../../packages/shared/src/index.ts) to re-export from `./schemas/*` and `./types/current-user`, REMOVING the old `User` interface.
  - [x] Migrate frontend consumers: [apps/web/src/features/current-user/context.tsx](../../../../../apps/web/src/features/current-user/context.tsx) and [apps/web/src/components/layout/AppShell.tsx](../../../../../apps/web/src/components/layout/AppShell.tsx) swapped from `User` → `CurrentUser`.

- [x] Task 7: Verification sweep (AC: 13, 14)
  - [x] `pnpm install` at root — green, postinstall regenerates Prisma client.
  - [x] `DATABASE_URL='…' pnpm --filter @confluent/api exec prisma validate` — exits 0.
  - [x] `pnpm --filter @confluent/api typecheck` — exits 0.
  - [x] `pnpm --filter @confluent/api lint` — exits 0, zero warnings.
  - [x] `pnpm --filter @confluent/api test` — 2 suites / 7 tests passing (config.schema.spec, prisma.service.spec).
  - [x] `pnpm --filter @confluent/api test:e2e` — 1 suite / 1 test passing (health-check JSON assertion).
  - [x] `pnpm turbo run typecheck` — 2 successful.
  - [x] `pnpm turbo run lint` — 2 successful, 5-warning baseline (unchanged, all `react-refresh/only-export-components`).
  - [x] `pnpm turbo run build` — 2 successful. Web bundle: 646.58 KB / 200.51 KB gz (flat vs 5.4 baseline of 646.56 KB / 200.50 KB gz — +0.02 KB / +0.01 KB gz). No frontend feature changes; only type-alias swap in 2 files.
  - [x] Append Story 6.1 deferred items to [deferred-work.md](deferred-work.md).

- [x] Task 8: Sprint status housekeeping
  - [x] `epic-6: backlog → in-progress` (first story in epic).
  - [x] `6-1-nestjs-scaffold-prisma-schema: backlog → ready-for-dev → in-progress → review`.
  - [x] `last_updated: 2026-04-23`.

## Dev Notes

### Why this shape

Epic 6 is the hinge from frontend-only mocks to a real backend. Story 6.1 is the foundation:
- **Prisma schema** is the union of all data needs across Epics 6–9 (auth, dossiers, share links, questionnaires, analytics, audit). Defining the full shape upfront prevents churn when later stories land.
- **Fail-fast config validation** prevents 3am "why didn't it start?" incidents — a missing `JWT_SECRET` crashes on startup, not on the first authenticated request.
- **Zod schemas in `packages/shared`** are the contract that binds frontend and backend. The existing `User` interface in shared was a placeholder from 1.1; 6.1 replaces it with real, Zod-inferred entity types that both sides validate against.
- **Docker Compose** pins the local dev environment so "it works on my machine" becomes "it works on everyone's machine in 30 seconds".

### Pinned decisions

1. **Prisma 5.22 not 7.2** — Architecture says 7.2 but Prisma 7 is not yet GA-compatible with Nest 11 (Apr 2026). Use 5.22 LTS; track upgrade in deferred-work.md. When Prisma 7 ships compatible, the schema is forward-compatible (no schema syntax changes between 5 and 7).
2. **Prisma enums as lowercase PostgreSQL enums** — `@@map("user_role")`, values lowercase like `entrepreneur`. PostgreSQL enum values are case-sensitive; lowercase matches the TypeScript union type in `packages/shared` with no runtime casting.
3. **AuditLog has no `updatedAt`** — append-only per architecture.md:147. Prisma will happily let you update rows; the append-only rule is enforced at the `audit.service` layer (future Story 6.4 / 8.4). For now, the schema just omits `updatedAt` to match the spec.
4. **PrismaModule is `@Global()`** — one instance, injected anywhere. Avoids `imports: [PrismaModule]` boilerplate in every feature module. Matches the common NestJS + Prisma pattern and the service boundaries at architecture.md:719-723.
5. **Config is `isGlobal: true`** with Zod `validate` hook — validates on startup, fails fast. The alternative (validate on first `get()`) would let a bad prod env run for minutes before crashing — not acceptable.
6. **`CurrentUser` as a separate type** from the Zod-inferred `User` — the frontend impersonation context stores `{id, name, email, role}` in sessionStorage; the backend `User` entity has `{id, email, role, isActive, createdAt, updatedAt}` — no `name`. Two different concerns (display identity vs. persisted entity); two types. Don't bolt `name` onto the backend User.
7. **`.env.test` is committed** with placeholder non-secret values — so `pnpm test:e2e` works out of the box on CI without secret injection. `.env` (real secrets) stays ignored.
8. **Migration is deferred** — no Docker in the current dev environment. The first developer to run `docker compose up` locally will run `prisma migrate dev --name init` and commit the resulting `apps/api/prisma/migrations/init/migration.sql` — Story 6.2 depends on this running, so 6.2's acceptance gate will include it if not done here.

### Testing approach

- **Structure tests, not integration tests, for PrismaService** — booting `PrismaClient` against a real DB needs Docker. Until Epic 10 CI sets up a test DB, unit tests assert class shape (`extends PrismaClient`, implements `onModuleInit`). Real DB testing lands in Story 6.2 when auth operations exercise actual rows.
- **Config validation test is a pure function call** — `validateConfig({})` should throw with a descriptive error. No NestJS bootstrap needed.
- **E2E test only exercises `GET /`** — the health-check endpoint. Booting `AppModule` requires env validation to pass, hence the `.env.test` file.

### References

- [architecture.md#Data Architecture](../planning-artifacts/architecture.md#L142)
- [architecture.md#Authentication & Security](../planning-artifacts/architecture.md#L162)
- [architecture.md#Complete Project Directory Structure](../planning-artifacts/architecture.md#L526)
- [architecture.md#Format Patterns](../planning-artifacts/architecture.md#L411) — API response shape, dates as ISO 8601, nulls explicit
- [epics.md#Epic 6: Auth & API Infrastructure](../planning-artifacts/epics.md#L1097)
- [1-1-turborepo-monorepo-scaffold.md](1-1-turborepo-monorepo-scaffold.md) — scaffold baseline, NestJS 11 config, pnpm workspace discipline

## Dev Agent Record

### Agent Model Used

claude-opus-4-7

### Debug Log References

- Zod version conflict (web 4.x vs shared/api 3.x) surfaced on first `pnpm turbo run build` — resolved by unifying the monorepo on `zod ^4.3.6`. Architecture doc still cites 3.24; doc-drift tracked.
- E2E boot failed twice before stubbing `PrismaService`: first because env vars were missing (import-time validation fired); fixed with `test/setup-env.ts` setupFile. Then because `PrismaClient.$connect` tried to reach a non-existent Postgres; fixed by `overrideProvider(PrismaService).useValue({...})` in the e2e test.
- Prisma CLI postinstall nagged for `prisma generate --schema=./prisma/schema.prisma` when no default schema was in place yet — added the explicit `--schema` flag and a `|| true` fallback so `pnpm install` on a fresh clone doesn't fail if the schema file is ever temporarily absent.

### Completion Notes List

- Epic 6 kick-off: NestJS scaffold, Prisma schema (8 models + 4 enums), Zod-based fail-fast config validation, Docker Compose local dev services, and shared Zod schemas for `User`/`Dossier`/`ShareLink`/`AuditLog`.
- `prisma migrate dev` is **deferred** — no Docker in this environment. Schema validated offline; migration file will be committed when the first developer runs `docker compose up -d && pnpm --filter @confluent/api exec prisma migrate dev --name init` (latest: alongside Story 6.2).
- E2E test uses a stubbed `PrismaService` to avoid requiring a live DB. When CI gets a real test DB (Epic 10), drop the override.
- Shared `User` interface (1.1 placeholder with `name` field) replaced by Zod-inferred `User` matching the real DB entity. Frontend impersonation context migrated to a new `CurrentUser` interface (id, name, email, role) — display-identity vs. persisted-entity separation.
- Zod unified on 4.x across the monorepo (web already used 4; api + shared bumped from the 3.24 cited in architecture.md). Architecture doc-drift tracked in deferred-work.

### Review Findings

Self-review on 2026-04-23. Fast pragmatic pass given the chained-stories cadence; only actionable items are listed (no pure cosmetic nits).

#### Patch — applied

- [x] [Review][Patch] **postinstall silently swallows Prisma generator failures** — [apps/api/package.json](../../../../../apps/api/package.json) had `"postinstall": "prisma generate ... || true"`. The schema is committed from this story onward, so the `|| true` no longer protects against "schema missing on first install" — it only hides CI breakage. Fix: remove `|| true` so failures surface loudly.
- [x] [Review][Patch] **`void bootstrap()` swallows startup errors** — [apps/api/src/main.ts](../../../../../apps/api/src/main.ts) used `void bootstrap()`, meaning a rejected promise from `NestFactory.create` (e.g., config validation failure) logs nothing and exits 0. Fix: `.catch((err) => { Logger.error(...); process.exit(1) })` so the process exits non-zero with a descriptive message.

#### Defer (captured in [deferred-work.md](deferred-work.md))

- Live `prisma migrate dev` — no Docker available.
- Prisma 5.22 → 7.x upgrade.
- Zod 4 alignment doc-drift in [architecture.md](../planning-artifacts/architecture.md#L150).
- Move bootstrap `process.env.PORT` read to `ConfigService.get('PORT')` once the first feature module consumes config.
- Drop the e2e `PrismaService` stub when CI gets a real test database.

### File List

**Created:**
- [docker-compose.yml](../../../../../docker-compose.yml)
- [.env.example](../../../../../.env.example)
- [apps/api/prisma/schema.prisma](../../../../../apps/api/prisma/schema.prisma)
- [apps/api/src/config/config.schema.ts](../../../../../apps/api/src/config/config.schema.ts)
- [apps/api/src/config/config.schema.spec.ts](../../../../../apps/api/src/config/config.schema.spec.ts)
- [apps/api/src/prisma/prisma.service.ts](../../../../../apps/api/src/prisma/prisma.service.ts)
- [apps/api/src/prisma/prisma.module.ts](../../../../../apps/api/src/prisma/prisma.module.ts)
- [apps/api/src/prisma/prisma.service.spec.ts](../../../../../apps/api/src/prisma/prisma.service.spec.ts)
- [apps/api/test/setup-env.ts](../../../../../apps/api/test/setup-env.ts)
- [packages/shared/src/schemas/user.schema.ts](../../../../../packages/shared/src/schemas/user.schema.ts)
- [packages/shared/src/schemas/dossier.schema.ts](../../../../../packages/shared/src/schemas/dossier.schema.ts)
- [packages/shared/src/schemas/share-link.schema.ts](../../../../../packages/shared/src/schemas/share-link.schema.ts)
- [packages/shared/src/schemas/audit-log.schema.ts](../../../../../packages/shared/src/schemas/audit-log.schema.ts)
- [packages/shared/src/types/current-user.ts](../../../../../packages/shared/src/types/current-user.ts)

**Modified:**
- [apps/api/package.json](../../../../../apps/api/package.json) — added deps (@prisma/client, prisma, @nestjs/config, nestjs-zod, zod) + `postinstall` script
- [apps/api/src/main.ts](../../../../../apps/api/src/main.ts) — bootstrap logger
- [apps/api/src/app.module.ts](../../../../../apps/api/src/app.module.ts) — ConfigModule + PrismaModule, removed the 1.1 `_CrossWorkspaceTypeCheck` placeholder
- [apps/api/src/app.controller.ts](../../../../../apps/api/src/app.controller.ts) — JSON health response
- [apps/api/test/app.e2e-spec.ts](../../../../../apps/api/test/app.e2e-spec.ts) — JSON expect + `PrismaService` stub override
- [apps/api/test/jest-e2e.json](../../../../../apps/api/test/jest-e2e.json) — added `setupFiles` entry
- [packages/shared/package.json](../../../../../packages/shared/package.json) — zod dep
- [packages/shared/src/index.ts](../../../../../packages/shared/src/index.ts) — re-exports from schemas/ + types/
- [pnpm-workspace.yaml](../../../../../pnpm-workspace.yaml) — onlyBuiltDependencies additions
- [apps/web/src/components/layout/AppShell.tsx](../../../../../apps/web/src/components/layout/AppShell.tsx) — `User` → `CurrentUser`
- [apps/web/src/features/current-user/context.tsx](../../../../../apps/web/src/features/current-user/context.tsx) — `User` → `CurrentUser`
- [_bmad-output/implementation-artifacts/deferred-work.md](deferred-work.md) — appended Story 6.1 deferred items
- [_bmad-output/implementation-artifacts/sprint-status.yaml](sprint-status.yaml) — epic-6 in-progress, 6-1 review, last_updated 2026-04-23
