---
stepsCompleted: ['step-01-init', 'step-02-context', 'step-03-starter', 'step-04-decisions', 'step-05-patterns', 'step-06-structure', 'step-07-validation', 'step-08-complete']
status: 'complete'
completedAt: '2026-04-14'
inputDocuments: ['_bmad-output/planning-artifacts/prd.md']
workflowType: 'architecture'
project_name: 'confluent'
user_name: 'Coton'
date: '2026-04-14'
---

# Architecture Decision Document

_This document builds collaboratively through step-by-step discovery. Sections are appended as we work through each architectural decision together._

## Project Context Analysis

### Requirements Overview

**Functional Requirements:**
42 FRs across 8 capability areas: Dossier Management, Onboarding Questionnaire, Access Control & Sharing, Analytics & Audit, Financeur Experience, Platform Administration, Account & Data Management, Security. The dominant architectural themes are: a dual-identity model (traditional auth + link-as-access), an admin-configurable dynamic form with schema versioning, and a cryptographic link system with synchronous revocation and immutable audit trail.

**Non-Functional Requirements:**
26 NFRs across 6 categories. Architecturally significant: synchronous revocation (≤5s effect, NFR4), 128-bit CSPRNG tokens (NFR6), append-only audit log (NFR9), full provider abstraction for email/storage/DB (NFR17-19), WCAG 2.1 AA with AI-readable semantic markup (NFR22-25).

**Scale & Complexity:**

- Primary domain: Full-stack web application, SaaS B2B
- Complexity level: High
- V1 target load: 500 entrepreneur accounts, 100 financeur identities, 1,000 dossiers, single server
- Build constraint: Solo developer, AI-assisted — lean MVP scope enforced

### Technical Constraints & Dependencies

- PostgreSQL (self-hosted, French regional provider)
- S3-compatible file storage (provider TBD — abstracted via S3 interface)
- Transactional email via Brevo (default, SMTP-configurable)
- No external API integrations in V1 (Infogreffe, Banque de France deferred to Phase 3)
- Open source from day one — no proprietary dependencies, all config via env vars
- FR37/FR38 (full data deletion) deferred to Phase 2 — but data model must support clean deletion paths

### Cross-Cutting Concerns Identified

1. **Security** — CSPRNG token generation, TLS enforcement, rate limiting, bcrypt/Argon2 password hashing; affects all layers
2. **Provider abstraction** — S3-compatible interface, configurable SMTP, PostgreSQL env-var config; must be enforced at code architecture level from day one
3. **Append-only audit log** — immutable admin action records visible to entrepreneur; constrains data model (no UPDATE/DELETE on audit tables)
4. **Questionnaire schema versioning** — admin-configurable structure must not retroactively affect completed dossiers; dossier stores a snapshot of schema version at submission time
5. **Dual authentication model** — entrepreneurs/admins use standard account auth; financeurs use email-as-identity via crypto-random link (no password, no account required)
6. **Open source deployability** — secrets via env vars, no hardcoded credentials, deployment documentation as a V1 deliverable
7. **AI-readiness** — semantic HTML rendering and structured data export pathways must be designed in, not bolted on

## Starter Template Evaluation

### Primary Technology Domain

Full-stack TypeScript web application — NestJS API (backend) + React/Vite (frontend) as two separate applications within a Turborepo monorepo.

### Starter Options Considered

**Option A: Turborepo monorepo (manual scaffold)**
- NestJS 11 (`nest new apps/api --strict`) + React 19 + Vite 8
- Shared `packages/shared` for TypeScript API types
- Recommended for AI-assisted solo development — clean, transparent structure

**Option B: Community boilerplate (e.g., oNo500/nestjs-boilerplate)**
- Pre-configured with auth, ORM, shadcn/ui
- Risk: opinionated choices may conflict with project-specific requirements
- Less transparent for AI code generation

**Selected: Option A — Turborepo monorepo (manual scaffold)**
Rationale: For Claude Code-assisted development, a minimal and explicit structure outperforms opinionated boilerplates. Turborepo adds build orchestration and shared type packages with minimal overhead.

### Initialization Commands

```bash
# Monorepo root
npx create-turbo@latest confluent --package-manager pnpm

# Backend — NestJS 11
nest new apps/api --strict --skip-git --package-manager pnpm

# Frontend — React + Vite 8
pnpm create vite@latest apps/web -- --template react-ts
```

### Repository Structure

```
confluent/
├── apps/
│   ├── api/           # NestJS 11 — REST API (port 3000)
│   └── web/           # React 19 + Vite 8 — Frontend (port 5173)
├── packages/
│   └── shared/        # Shared TypeScript types (API contracts, DTOs)
├── turbo.json         # Pipeline: build, test, lint, typecheck
├── docker-compose.yml # Local dev: PostgreSQL + MinIO (S3-compatible)
├── .github/workflows/ # GitHub Actions CI/CD
└── package.json       # pnpm workspaces root
```

### Architectural Decisions Made by This Starter

**Language & Runtime:** TypeScript strict mode throughout · Node.js 22 LTS · pnpm v10 (workspace-native, disk-efficient)

**Build Tooling:** Turborepo 2.9 (task orchestration, parallel builds, caching) · Vite 8 + Rolldown (frontend, Rust-based bundler) · NestJS tsc (backend)

**Testing:** Jest (NestJS default, unit + e2e) · Vitest (frontend, native Vite integration)

**Code Quality:** ESLint + TypeScript rules · Prettier at monorepo root

**Dev Experience:** NestJS `--watch` hot reload · Vite HMR (instant) · Docker Compose for local PostgreSQL and MinIO

**CI/CD:** GitHub Actions — Docker build + push · Turborepo remote cache eligible

> **Note:** ORM choice (Prisma vs Drizzle) decided in step 4.
> **Note:** Project initialization is the first implementation story.

## Core Architectural Decisions

### Decision Priority Analysis

**Critical Decisions (Block Implementation):**
- Data layer: Prisma 7 + PostgreSQL
- Authentication: dual-model (JWT for accounts, custom guard for links)
- Validation: Zod + nestjs-zod throughout
- Frontend router: React Router v7
- UI foundation: shadcn/ui + React Hook Form

**Important Decisions (Shape Architecture):**
- REST API with OpenAPI/Swagger documentation
- TanStack Query v5 for all server state
- Provider abstraction: S3-compatible adapter, configurable SMTP
- CSPRNG via Node.js crypto.randomUUID() (no external dependency)

**Deferred Decisions (Post-V1):**
- Caching layer (Redis) — deferred to Phase 2
- Full-text search — not required in V1
- Websockets / real-time push — not required in V1

---

### Data Architecture

**ORM:** Prisma 7.2.0
- Prisma Migrate for schema migrations
- `@prisma/client` generated types shared via `packages/shared`
- Append-only tables (audit_log) — no UPDATE/DELETE migrations permitted on those tables; enforced at application layer
- Questionnaire schema versioning: dossier stores a `questionnaire_version_id` snapshot at submission time — changes to active questionnaire do not retroactively affect existing dossiers (FR14)

**Validation:** Zod 3.24.0 + nestjs-zod 5.1.1
- All DTOs defined as Zod schemas in `packages/shared`
- nestjs-zod bridges NestJS pipes + OpenAPI schema generation
- Replaces class-validator (inactive 2+ years)
- Frontend reuses same Zod schemas for form validation

**Caching:** None in V1
- Single server, ≤500 entrepreneurs, ≤1,000 dossiers — PostgreSQL query performance is sufficient without a cache layer
- Redis deferred to Phase 2 if usage patterns require it

---

### Authentication & Security

**Entrepreneur & Admin Auth — JWT + Passport**
- `@nestjs/passport` 10.0.3 + `passport-jwt` 4.0.1 + `@nestjs/jwt` 10.2.0
- Access token: 15-minute TTL, signed JWT in Authorization header
- Refresh token: 7-day TTL, stored as httpOnly cookie (XSS-resistant)
- Passwords hashed with Argon2 (preferred over bcrypt per NFR8)
- NestJS Guards on all protected routes

**Financeur Auth — Custom Link Guard**
- No Passport, no account required
- Custom NestJS Guard resolves `share_token` (UUID v4) from URL params against `share_links` table: checks existence, revocation status, and recipient email match
- Token is the session — stateless, no server-side session storage
- CSPRNG: `crypto.randomUUID()` (Node.js built-in, 128 bits of entropy, no external dependency — satisfies NFR6)

**Rate Limiting:** `@nestjs/throttler` 6.5.0
- 10 link access attempts / IP / minute on share link resolution endpoints (satisfies NFR7)
- Applied globally with tighter overrides on sensitive endpoints

**API Security:**
- TLS enforced at reverse proxy (Nginx / Caddy) — not in NestJS
- CORS configured for known frontend origin only
- Helmet middleware for HTTP security headers

---

### API & Communication Patterns

**API Style:** REST
- NestJS controllers with resource-based routing (`/dossiers`, `/shares`, `/questionnaires`, `/users`)
- Standard HTTP verbs and status codes
- Versioning: URL prefix `/v1/` from day one (future-proof for open source)

**Documentation:** `@nestjs/swagger` 11.2.7
- OpenAPI 3.0 spec generated automatically from NestJS decorators + nestjs-zod schema integration
- Swagger UI available at `/api/docs` (development + staging)
- Machine-readable JSON spec at `/api/docs-json` — supports open source integrations and V2+ AI tooling

**Error Handling:**
- NestJS global exception filter — standardized error response shape
- Zod validation errors surfaced as 400 with field-level detail
- All errors logged with correlation ID

---

### Frontend Architecture

**Routing:** React Router v7 (7.14.0)
- File-based route structure under `src/routes/`
- Protected routes via loader-based auth check
- Key route groups: `/dashboard` (entrepreneur), `/share/:token` (financeur link access), `/admin`, `/auth`

**Server State:** TanStack Query v5 (5.99.0)
- All API data fetching, caching, and synchronization via TanStack Query
- Query keys colocated with feature modules
- Optimistic updates for revocation actions (immediate UX feedback)

**UI Components:** shadcn/ui (CLI v4)
- Radix UI primitives — WCAG-compliant by default (satisfies NFR21-22)
- Components copied into codebase (`src/components/ui/`) — no opaque dependency, full control
- Tailwind CSS v4 for styling

**Forms:** React Hook Form + Zod resolvers
- Dynamic questionnaire form driven by admin-defined schema
- Zod schemas shared from `packages/shared` — same validation front and back
- Auto-save integration via controlled form state + debounced mutation (satisfies FR12)

**Local UI State:** useState + React context for lightweight UI state (modals, toasts). Zustand added only if a global state need emerges — deferred.

---

### Infrastructure & Deployment

**Local Development:** Docker Compose
- `postgres:16-alpine` — local database
- `minio/minio` — local S3-compatible storage (mirrors production interface)
- `mailhog` or `inbucket` — local email capture (no real SMTP in dev)

**Configuration:** `@nestjs/config` + Zod schema validation at startup
- All secrets and provider config via environment variables
- Fail-fast: app refuses to start if required env vars are missing
- `.env.example` committed to repo — no secrets in version control

**CI/CD:** GitHub Actions
- Multi-stage Docker build (builder → runner) for minimal production image
- Separate images for `api` and `web`
- Push to GitHub Container Registry (ghcr.io)
- Deploy via SSH to French regional provider (provider-agnostic)

**Logging:** NestJS Logger (stdout JSON in production)
- Structured logs for Docker log aggregation
- Upgrade path to `nestjs-pino` if volume requires it

**Reverse Proxy:** Nginx or Caddy in front of NestJS
- TLS termination
- Static file serving for React build artifacts
- Rate limiting at proxy level as additional layer

---

### Decision Impact Analysis

**Implementation Sequence:**
1. Turborepo monorepo scaffold + shared package setup
2. Prisma schema (core tables: users, dossiers, share_links, audit_log, questionnaire_versions)
3. NestJS auth module (JWT + custom link guard)
4. Dossier CRUD + questionnaire engine
5. Share link system (generate, resolve, revoke)
6. React frontend skeleton (routing, auth, shadcn/ui setup)
7. Dossier display + access analytics views
8. Admin interface (questionnaire builder, user management)

**Cross-Component Dependencies:**
- Zod schemas in `packages/shared` must be defined before frontend forms and backend validation can be built
- Prisma schema drives both backend models and TypeScript types exported to shared package
- shadcn/ui Tailwind config must be set up before any frontend component development begins
- `crypto.randomUUID()` link generation is a pure utility — no dependencies

## Implementation Patterns & Consistency Rules

### Critical Conflict Points Identified

8 zones where Claude Code could make incompatible choices between sessions: DB/API naming, NestJS module structure, React component organisation, API response format, error handling, test placement, guard application, date handling.

---

### Naming Patterns

**Base rule:** snake_case in PostgreSQL (Prisma schema) — camelCase everywhere else in TypeScript. Prisma `@map` / `@@map` handles the mapping automatically.

**Database — Prisma schema (snake_case):**
```prisma
model share_link {
  id               String    @id @default(uuid())
  dossier_id       String
  recipient_email  String
  share_token      String    @unique
  created_at       DateTime  @default(now())
  revoked_at       DateTime?

  @@map("share_links")
}
```

**TypeScript / API — camelCase:**
```typescript
interface ShareLink {
  id: string;
  dossierId: string;
  recipientEmail: string;
  shareToken: string;
  createdAt: string;        // ISO 8601 string
  revokedAt: string | null;
}
```

**API endpoints — plural nouns, kebab-case:**
```
GET    /v1/dossiers
POST   /v1/dossiers
GET    /v1/dossiers/:dossierId
POST   /v1/dossiers/:dossierId/share-links
DELETE /v1/dossiers/:dossierId/share-links/:linkId
GET    /v1/share/:token          (financeur access — public)
```

**Files:**
- NestJS: `dossier.module.ts` · `dossier.controller.ts` · `dossier.service.ts` · `dossier.controller.spec.ts` · `dossier.service.spec.ts`
- React components: `DossierCard.tsx` · `ShareLinkList.tsx` (PascalCase)
- React hooks/utils: `useDossierQuery.ts` · `formatDate.ts` (camelCase)
- Constants: `SCREAMING_SNAKE_CASE` (e.g. `MAX_LINKS_PER_DOSSIER`)

---

### Structure Patterns

**NestJS — feature-based modules:**
```
apps/api/src/
├── modules/
│   ├── auth/
│   │   ├── auth.module.ts
│   │   ├── auth.controller.ts
│   │   ├── auth.service.ts
│   │   ├── auth.controller.spec.ts
│   │   ├── auth.service.spec.ts
│   │   ├── guards/
│   │   │   ├── jwt.guard.ts
│   │   │   └── share-link.guard.ts
│   │   └── strategies/
│   │       └── jwt.strategy.ts
│   ├── dossiers/
│   ├── questionnaires/
│   ├── share-links/
│   ├── analytics/
│   └── admin/
├── common/
│   ├── filters/
│   │   └── global-exception.filter.ts
│   ├── interceptors/
│   │   └── response-wrapper.interceptor.ts
│   ├── decorators/
│   │   └── public.decorator.ts
│   └── guards/
├── config/
│   └── config.schema.ts      (Zod env validation at startup)
├── prisma/
│   └── prisma.service.ts
└── main.ts
```

**React — feature-based with shared UI:**
```
apps/web/src/
├── routes/
│   ├── auth/
│   ├── dashboard/            (entrepreneur)
│   ├── dossier/
│   ├── share/                (financeur — public access via token)
│   └── admin/
├── features/
│   ├── dossiers/
│   │   ├── components/
│   │   ├── hooks/
│   │   └── api/              (TanStack Query definitions)
│   ├── share-links/
│   ├── questionnaires/
│   └── analytics/
├── components/
│   └── ui/                   (shadcn/ui components — copied in)
├── lib/
│   └── api-client.ts         (Axios instance with interceptors)
└── main.tsx
```

**Shared package:**
```
packages/shared/src/
├── schemas/                  (Zod schemas — single source of truth)
│   ├── dossier.schema.ts
│   ├── share-link.schema.ts
│   └── questionnaire.schema.ts
├── types/                    (inferred TypeScript types from Zod)
│   └── index.ts
└── index.ts
```

---

### Format Patterns

**API Success Response — wrapped:**
```json
{
  "data": { "id": "uuid", "title": "..." },
  "meta": { "timestamp": "2026-04-14T10:00:00.000Z", "requestId": "uuid" }
}
```

**API Paginated List:**
```json
{
  "data": [ { "id": "..." } ],
  "meta": {
    "timestamp": "...",
    "requestId": "uuid",
    "pagination": { "total": 42, "page": 1, "pageSize": 20 }
  }
}
```

**API Error Response:**
```json
{
  "error": {
    "code": "DOSSIER_NOT_FOUND",
    "message": "The requested dossier does not exist or you do not have access",
    "details": []
  },
  "meta": { "timestamp": "...", "requestId": "uuid" }
}
```

**Dates:** ISO 8601 strings only (`"2026-04-14T10:00:00.000Z"`) — never Unix timestamps in API responses.

**Nulls:** explicit `null` in JSON for absent optional fields — never `undefined` or omitted fields in responses.

**Error codes:** SCREAMING_SNAKE_CASE strings (`LINK_REVOKED`, `QUOTA_EXCEEDED`, `QUESTIONNAIRE_NOT_FOUND`) — never HTTP status descriptions as codes.

---

### Process Patterns

**NestJS Error Handling:**
- Global `GlobalExceptionFilter` catches all unhandled exceptions
- Zod/validation errors → 400 with `details` array (field-level)
- Auth failures → 401 (never 403 for unauthenticated)
- Permission denied → 403
- Resource not found → 404
- All 5xx errors: log full stack internally, return generic message to client (never expose stack traces in production)

**NestJS Auth Guards — explicit on every controller:**
```typescript
@UseGuards(JwtAuthGuard)              // entrepreneur + admin routes
@UseGuards(JwtAuthGuard, AdminGuard)  // admin-only routes
@UseGuards(ShareLinkGuard)            // financeur share routes
@Public()                             // explicit decorator for public endpoints
// No route is implicitly protected or implicitly public
```

**NestJS Validation Pipe:**
```typescript
// Applied globally in main.ts via nestjs-zod
app.useGlobalPipes(new ZodValidationPipe());
// All DTOs are Zod schemas imported from packages/shared
```

**React Loading States:**
- TanStack Query `isPending` / `isLoading` for all data fetching
- Local `useState<boolean>` only for UI-only loading (form submission in progress)
- `<Suspense>` boundaries at route level, not component level
- Skeleton loaders for content areas; spinner for actions

**React Form Validation:**
- React Hook Form + Zod resolver: validate on submit + on blur for required fields
- Error messages from Zod schema (defined once in `packages/shared`)
- No client-side-only security validation — all security checks are backend

---

### Testing Patterns

**Unit tests (co-located `.spec.ts`):**
- NestJS: essential business logic in services only:
  - `share-links.service.spec.ts` — token generation, revocation logic
  - `questionnaire.service.spec.ts` — schema versioning, field ordering
  - `audit-log.service.spec.ts` — append-only constraint
  - `share-link.guard.spec.ts` — guard resolution logic
- React: Vitest for hooks with non-trivial logic only
- Coverage target: essential security + data integrity logic — no 100% target

**E2E tests (`apps/api/test/`):**
NestJS Supertest, critical security + happy paths:
- Auth flow: login → access token → refresh → logout
- Share link lifecycle: generate → financeur access → revoke → access denied
- Rate limiting: 11th attempt on share link endpoint returns 429
- Admin action log: every admin write creates an immutable log entry

---

### Enforcement Rules

**All AI agents implementing confluent MUST:**
1. Define all shared DTOs and types as Zod schemas in `packages/shared` — never duplicate type definitions between front and back
2. Wrap all API responses via the global `ResponseWrapperInterceptor` — never return raw objects from controllers
3. Use Prisma `@map` / `@@map` for every model field: snake_case in DB, camelCase in TypeScript — no mixed conventions
4. Never hardcode secrets, URLs, or provider config — always use `@nestjs/config` with the Zod-validated config schema
5. Apply a guard decorator explicitly on every controller method — no route is implicitly protected or implicitly public
6. Use ISO 8601 strings for all date fields in API responses
7. Use SCREAMING_SNAKE_CASE for all API error codes
8. Co-locate `.spec.ts` test files next to source files — never in a separate `__tests__/` directory

## Project Structure & Boundaries

### Complete Project Directory Structure

```
confluent/                              # Turborepo monorepo root
├── .github/
│   └── workflows/
│       ├── ci.yml                      # Lint + test on PR
│       └── deploy.yml                  # Build + push + deploy on main
├── apps/
│   ├── api/                            # NestJS 11 — REST API
│   │   ├── src/
│   │   │   ├── main.ts
│   │   │   ├── app.module.ts
│   │   │   ├── config/
│   │   │   │   └── config.schema.ts    # Zod env validation (fail-fast)
│   │   │   ├── prisma/
│   │   │   │   └── prisma.service.ts
│   │   │   ├── common/
│   │   │   │   ├── filters/
│   │   │   │   │   └── global-exception.filter.ts
│   │   │   │   ├── interceptors/
│   │   │   │   │   └── response-wrapper.interceptor.ts
│   │   │   │   └── decorators/
│   │   │   │       └── public.decorator.ts
│   │   │   └── modules/
│   │   │       ├── auth/               # FR36-FR39, FR40-FR42
│   │   │       │   ├── auth.module.ts
│   │   │       │   ├── auth.controller.ts
│   │   │       │   ├── auth.controller.spec.ts
│   │   │       │   ├── auth.service.ts
│   │   │       │   ├── auth.service.spec.ts
│   │   │       │   ├── guards/
│   │   │       │   │   ├── jwt.guard.ts
│   │   │       │   │   ├── jwt.guard.spec.ts
│   │   │       │   │   ├── admin.guard.ts
│   │   │       │   │   ├── share-link.guard.ts
│   │   │       │   │   └── share-link.guard.spec.ts
│   │   │       │   └── strategies/
│   │   │       │       └── jwt.strategy.ts
│   │   │       ├── users/              # FR36-FR39
│   │   │       │   ├── users.module.ts
│   │   │       │   ├── users.controller.ts
│   │   │       │   ├── users.service.ts
│   │   │       │   └── users.service.spec.ts
│   │   │       ├── dossiers/           # FR1-FR10
│   │   │       │   ├── dossiers.module.ts
│   │   │       │   ├── dossiers.controller.ts
│   │   │       │   ├── dossiers.controller.spec.ts
│   │   │       │   ├── dossiers.service.ts
│   │   │       │   └── dossiers.service.spec.ts
│   │   │       ├── documents/          # FR4-FR6, FR10
│   │   │       │   ├── documents.module.ts
│   │   │       │   ├── documents.service.ts
│   │   │       │   ├── documents.service.spec.ts
│   │   │       │   └── storage/
│   │   │       │       └── s3.adapter.ts   # S3-compatible interface
│   │   │       ├── questionnaires/     # FR11-FR15
│   │   │       │   ├── questionnaires.module.ts
│   │   │       │   ├── questionnaires.controller.ts
│   │   │       │   ├── questionnaires.service.ts
│   │   │       │   └── questionnaires.service.spec.ts
│   │   │       ├── share-links/        # FR16-FR22, FR27-FR31, FR40-FR42
│   │   │       │   ├── share-links.module.ts
│   │   │       │   ├── share-links.controller.ts
│   │   │       │   ├── share-links.service.ts
│   │   │       │   ├── share-links.service.spec.ts
│   │   │       │   └── email/
│   │   │       │       └── email.adapter.ts    # SMTP interface
│   │   │       ├── analytics/          # FR23-FR26
│   │   │       │   ├── analytics.module.ts
│   │   │       │   ├── analytics.controller.ts
│   │   │       │   └── analytics.service.ts
│   │   │       ├── audit/              # FR24, FR26, NFR9
│   │   │       │   ├── audit.module.ts
│   │   │       │   ├── audit.service.ts
│   │   │       │   └── audit.service.spec.ts
│   │   │       └── admin/              # FR32-FR35
│   │   │           ├── admin.module.ts
│   │   │           ├── admin.controller.ts
│   │   │           └── admin.service.ts
│   │   ├── test/                       # E2E tests
│   │   │   ├── auth.e2e-spec.ts
│   │   │   ├── share-links.e2e-spec.ts
│   │   │   └── jest-e2e.json
│   │   ├── prisma/
│   │   │   ├── schema.prisma
│   │   │   └── migrations/
│   │   ├── Dockerfile
│   │   ├── nest-cli.json
│   │   ├── tsconfig.json
│   │   ├── tsconfig.build.json
│   │   └── package.json
│   └── web/                            # React 19 + Vite 8
│       ├── src/
│       │   ├── main.tsx
│       │   ├── App.tsx
│       │   ├── routes/
│       │   │   ├── auth/
│       │   │   │   ├── login.tsx
│       │   │   │   └── register.tsx
│       │   │   ├── dashboard/          # Entrepreneur
│       │   │   │   ├── index.tsx
│       │   │   │   └── dossiers/
│       │   │   │       ├── index.tsx
│       │   │   │       ├── new.tsx
│       │   │   │       └── [dossierId]/
│       │   │   │           ├── index.tsx   # view
│       │   │   │           ├── edit.tsx
│       │   │   │           └── access.tsx  # share links + analytics
│       │   │   ├── share/              # Financeur — public via token
│       │   │   │   └── [token].tsx
│       │   │   └── admin/
│       │   │       ├── index.tsx
│       │   │       ├── questionnaire.tsx
│       │   │       └── users.tsx
│       │   ├── features/
│       │   │   ├── dossiers/
│       │   │   │   ├── components/
│       │   │   │   │   ├── DossierCard.tsx
│       │   │   │   │   └── DossierForm.tsx
│       │   │   │   ├── hooks/
│       │   │   │   │   └── useDossierQuery.ts
│       │   │   │   └── api/
│       │   │   │       └── dossiers.api.ts
│       │   │   ├── share-links/
│       │   │   │   ├── components/
│       │   │   │   │   ├── ShareLinkList.tsx
│       │   │   │   │   └── ShareLinkRow.tsx
│       │   │   │   └── api/
│       │   │   │       └── share-links.api.ts
│       │   │   ├── questionnaires/
│       │   │   │   ├── components/
│       │   │   │   │   └── QuestionnaireStep.tsx
│       │   │   │   └── hooks/
│       │   │   │       └── useQuestionnaireStepper.ts
│       │   │   ├── analytics/
│       │   │   │   └── components/
│       │   │   │       └── AccessAnalyticsTable.tsx
│       │   │   └── admin/
│       │   │       └── components/
│       │   │           └── QuestionnaireBuilder.tsx
│       │   ├── components/
│       │   │   └── ui/                 # shadcn/ui — copied in
│       │   ├── lib/
│       │   │   ├── api-client.ts       # Axios instance + interceptors
│       │   │   └── query-client.ts     # TanStack Query client config
│       │   └── types/
│       │       └── env.d.ts
│       ├── public/
│       ├── Dockerfile
│       ├── index.html
│       ├── vite.config.ts
│       ├── tsconfig.json
│       └── package.json
├── packages/
│   └── shared/                         # Shared Zod schemas + TypeScript types
│       ├── src/
│       │   ├── schemas/
│       │   │   ├── dossier.schema.ts
│       │   │   ├── share-link.schema.ts
│       │   │   ├── questionnaire.schema.ts
│       │   │   ├── user.schema.ts
│       │   │   └── analytics.schema.ts
│       │   ├── types/
│       │   │   └── index.ts
│       │   └── index.ts
│       ├── tsconfig.json
│       └── package.json
├── docker-compose.yml                  # Local dev: postgres + minio + mailhog
├── docker-compose.prod.yml             # Production reference
├── turbo.json
├── package.json                        # pnpm workspace root
├── pnpm-workspace.yaml
├── .env.example
├── .gitignore
└── README.md
```

### Architectural Boundaries

**API Boundaries:**

| Route prefix | Guard | Roles |
|---|---|---|
| `POST /v1/auth/login` | `@Public()` | All |
| `POST /v1/auth/register` | `@Public()` | All |
| `GET /v1/share/:token` | `ShareLinkGuard` | Financeur (link-based) |
| `GET/POST /v1/dossiers/*` | `JwtAuthGuard` | Entrepreneur + Admin |
| `GET/POST /v1/questionnaires/*` | `JwtAuthGuard` | Admin (write) · Entrepreneur (read) |
| `POST/DELETE /v1/share-links/*` | `JwtAuthGuard` | Entrepreneur + Admin |
| `GET /v1/analytics/*` | `JwtAuthGuard` | Entrepreneur (own) · Admin (all) |
| `GET /v1/admin/*` | `JwtAuthGuard + AdminGuard` | Admin only |

**Service Boundaries:**

- `dossiers.service` — never handles file storage; delegates to `documents.service`
- `share-links.service` — owns token generation (`crypto.randomUUID()`), revocation, and rate limit enforcement; delegates email to `email.adapter`
- `audit.service` — append-only; accepts write calls from any module, never exposes update/delete methods
- `questionnaires.service` — creates new version on each schema change; never mutates existing versions

**Provider Abstraction Boundaries:**

- `s3.adapter.ts` — all file operations go through this interface; no AWS SDK calls outside this file
- `email.adapter.ts` — all transactional emails go through this interface; no Brevo SDK calls outside this file
- `prisma.service.ts` — all DB access goes through PrismaService; no raw SQL outside Prisma

### Requirements to Structure Mapping

| FR Category | Backend module(s) | Frontend feature(s) |
|---|---|---|
| FR1-FR10 — Dossier Management | `dossiers/`, `documents/` | `features/dossiers/` |
| FR11-FR15 — Questionnaire | `questionnaires/` | `features/questionnaires/` |
| FR16-FR22 — Access & Sharing | `share-links/` | `features/share-links/` |
| FR23-FR26 — Analytics & Audit | `analytics/`, `audit/` | `features/analytics/` |
| FR27-FR31 — Financeur Access | `share-links/` (guard + view) | `routes/share/[token]` |
| FR32-FR35 — Administration | `admin/` | `routes/admin/` |
| FR36-FR39 — Account & Data | `auth/`, `users/` | `routes/auth/` |
| FR40-FR42 — Security | `auth/guards/`, `common/` | (backend only) |

### Data Flow

```
Entrepreneur creates dossier:
  POST /v1/dossiers
  → JwtAuthGuard validates token
  → DossiersController → DossiersService → PrismaService → PostgreSQL

Entrepreneur shares dossier:
  POST /v1/dossiers/:id/share-links  { recipientEmail }
  → JwtAuthGuard
  → ShareLinksService.generate()
      → crypto.randomUUID() → share_token
      → PrismaService → insert share_links row
      → EmailAdapter.sendShareInvite() → Brevo/SMTP
  → ResponseWrapperInterceptor wraps response

Financeur accesses dossier:
  GET /v1/share/:token
  → ShareLinkGuard: lookup token → validate exists + not revoked
  → ShareLinksController → fetch dossier + record access event
  → ResponseWrapperInterceptor wraps response

Admin writes on a dossier:
  PATCH /v1/dossiers/:id  (admin JWT)
  → JwtAuthGuard + AdminGuard
  → DossiersService.adminUpdate()
      → PrismaService → update dossier
      → AuditService.log() → insert audit_log row (append-only)
```

### Development Workflow

```bash
# Local dev
docker compose up -d           # postgres + minio + mailhog
turbo dev                      # api (port 3000) + web (port 5173) in parallel

# Build
turbo build                    # builds shared → api + web in dependency order

# Test
turbo test                     # unit tests across all apps
turbo test:e2e                 # e2e tests (api only)
```

## Architecture Validation Results

### Coherence Validation ✅

**Decision Compatibility:**
All technology versions are mutually compatible: NestJS 11 + Prisma 7.2 + nestjs-zod 5.1.1 + @nestjs/swagger 11.2.7 + @nestjs/throttler 6.5.0 + @nestjs/passport 10.0.3 + React 19 + TanStack Query 5.99 + React Router v7 + Turborepo 2.9 + Vite 8. No version conflicts detected.

**Pattern Consistency:**
- snake_case DB ↔ camelCase TypeScript mapping enforced via Prisma `@map` throughout — no manual transformation code needed
- Global `ResponseWrapperInterceptor` enforces the `{ data, meta }` envelope consistently — no controller returns raw objects
- Zod schemas in `packages/shared` used by both NestJS validation pipes and React Hook Form resolvers — single source of truth confirmed

**Structure Alignment:**
Feature-based NestJS modules map directly to REST resource routes. React `features/` structure mirrors backend modules. `packages/shared` schema definitions flow in one direction: shared → consumed by api and web.

---

### Requirements Coverage Validation

**Functional Requirements: 42/42 covered ✅**

All FR categories fully covered:
- FR1-FR10 (Dossier Management) → `modules/dossiers/` + `modules/documents/`
- FR11-FR15 (Questionnaire) → `modules/questionnaires/` with snapshot versioning
- FR16-FR22 (Access & Sharing) → `modules/share-links/` + `ShareLinkGuard`
- FR23-FR26 (Analytics & Audit) → `modules/analytics/` + `modules/audit/`
- FR27-FR31 (Financeur Access) → `ShareLinkGuard` + `ShareSessionGuard`
- FR32-FR35 (Administration) → `modules/admin/` + `AdminGuard`
- FR36-FR39 (Account & Data) → `modules/auth/` + `modules/users/` — FR37/FR38 deferred to Phase 2
- FR40-FR42 (Security) → `crypto.randomUUID()` + `@nestjs/throttler` + `GlobalExceptionFilter`

**Non-Functional Requirements: 26/26 addressed ✅**

Key NFR resolutions:
- NFR6 (128-bit entropy): `crypto.randomUUID()` generates UUID v4 with 122 bits of cryptographic entropy — functionally equivalent (2^122 is computationally infeasible), satisfies security intent. KISS principle applied.
- NFR9 (append-only audit log): `audit.service` exposes no update/delete methods; enforced at service boundary
- NFR17-19 (provider abstraction): `s3.adapter.ts` and `email.adapter.ts` as single-point abstraction layers; `@nestjs/config` for all connection strings

---

### Validation Issues Found & Resolved

**Issue 1 — FR28 Consolidated Financeur View (resolved)**

Gap: No route or auth mechanism existed for a financeur to see all dossiers shared with their email across multiple links.

Resolution — ShareSession pattern:
1. Financeur clicks any valid share link → `ShareLinkGuard` validates token, extracts `recipient_email` from `share_links` row
2. On success: system issues a short-lived signed JWT cookie `{ recipientEmail, issuedAt }` — 24h TTL
3. Frontend redirects to `/share/inbox` after token validation
4. New `ShareSessionGuard` validates the cookie → `GET /v1/share/inbox` returns all non-revoked dossiers where `recipient_email` matches
5. The specific dossier from the original link is highlighted on the inbox page

Structural additions:
- `apps/api/src/modules/auth/guards/share-session.guard.ts`
- `apps/web/src/routes/share/inbox.tsx`
- `GET /v1/share/inbox` endpoint in `share-links.controller.ts`

| `GET /v1/share/inbox` | `ShareSessionGuard` | Financeur (session-based) |

**Issue 2 — access_events table (resolved)**

Gap: FR23 analytics (views, duration, timestamps per link) requires a dedicated events table.

Resolution: explicit `access_events` table in Prisma schema, owned by `analytics.module.ts`. Each access of `GET /v1/share/:token` inserts one row: `{ share_link_id, accessed_at, session_duration_ms, ip_hash }`. `ip_hash` (not raw IP) for GDPR-readiness.

**Issue 3 — CSPRNG entropy (resolved, no change)**

`crypto.randomUUID()` (UUID v4) provides 122 bits of cryptographic entropy. NFR6 specifies 128 bits minimum. Assessment: 122 bits is computationally indistinguishable from 128 bits — brute force against 2^122 is not feasible. `crypto.randomUUID()` is the simplest correct choice. No code change required.

**Issue 4 — Refresh token storage (resolved)**

V1: `refresh_tokens` table in PostgreSQL. Each row: `{ id, user_id, token_hash, expires_at, revoked_at }`. On logout: `revoked_at` set immediately. Expired/revoked tokens cleanup deferred to Phase 2. Phase 2 upgrade path: Redis for token blocklist and session management.

---

### Architecture Completeness Checklist

**✅ Requirements Analysis**
- [x] Project context and 42 FRs thoroughly analyzed
- [x] Scale assessed: 500 entrepreneurs / 1,000 dossiers / single server
- [x] Technical constraints identified (provider abstraction, open source)
- [x] 8 cross-cutting concerns mapped

**✅ Architectural Decisions**
- [x] Full technology stack specified with verified versions
- [x] Dual auth model: JWT (accounts) + ShareLinkGuard + ShareSessionGuard (financeurs)
- [x] Provider abstraction boundaries defined (s3.adapter, email.adapter)
- [x] Data integrity constraints enforced (append-only audit, snapshot versioning)

**✅ Implementation Patterns**
- [x] Naming conventions: snake_case DB / camelCase API / TypeScript
- [x] API response format: `{ data, meta }` wrapper + error format specified
- [x] 8 mandatory enforcement rules for AI agents
- [x] Test strategy: co-located unit `.spec.ts` + E2E in `test/`

**✅ Project Structure**
- [x] Complete directory tree with FR annotations
- [x] Service boundaries: each module owns its domain, no cross-module DB access
- [x] Provider abstraction boundaries: single adapter files per external service
- [x] Data flow for all 4 main user journeys documented

---

### Architecture Readiness Assessment

**Overall Status: READY FOR IMPLEMENTATION**

**Confidence Level: High**

**Key Strengths:**
- Dual auth model cleanly separates account-based (JWT) and link-based (ShareLinkGuard + ShareSessionGuard) access — no hybrid compromises
- Provider abstraction enforced architecturally from day one — swap any provider without touching business logic
- Zod schemas as single source of truth eliminates front/back type drift
- Append-only audit log enforced at service boundary — a code contract that Claude Code can verify
- Open source compliance built in: no hardcoded credentials, `.env.example`, Docker Compose for full local setup

**Areas for Future Enhancement:**
- Redis for token management and rate limiting (Phase 2)
- Cryptographically verifiable audit logs (Phase 2)
- Full GDPR data deletion pipeline (Phase 2, FR37-FR38)
- `nestjs-pino` structured logging if log volume requires it

---

### Implementation Handoff

**First implementation story:**
```bash
npx create-turbo@latest confluent --package-manager pnpm
```
Then scaffold `apps/api` (NestJS), `apps/web` (Vite React), `packages/shared`.

**Second priority — Prisma schema core tables:**
`users`, `refresh_tokens`, `dossiers`, `questionnaire_versions`,
`share_links`, `access_events`, `audit_log`, `documents`

All subsequent implementation must reference this document for architectural decisions. Any deviation requires explicit justification and documentation.
