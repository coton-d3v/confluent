---
stepsCompleted: ['step-01-validate-prerequisites', 'step-02-design-epics']
inputDocuments:
  - '_bmad-output/planning-artifacts/prd.md'
  - '_bmad-output/planning-artifacts/architecture.md'
  - '_bmad-output/planning-artifacts/ux-design-specification.md'
sequencingDecision: 'frontend-first — full entrepreneur arrival + questionnaire form before any API work'
---

# confluent - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for confluent, decomposing the requirements from the PRD, UX Design Specification, and Architecture into implementable stories.

**Sequencing decision (Coton, 2026-04-14):** Frontend-first approach. All frontend surfaces are built before API integration begins. The entrepreneur arrival flow and dossier creation questionnaire are the first frontend priority. Mock data / hardcoded fixtures are used during frontend development; API wiring comes in a dedicated epic phase.

---

## Requirements Inventory

### Functional Requirements

FR1: An entrepreneur can create a new dossier associated with their account
FR2: An entrepreneur can hold multiple dossiers (one per company or project)
FR3: An entrepreneur can edit the text content of their own dossier
FR4: An entrepreneur can upload documents to their dossier
FR5: An entrepreneur can replace an uploaded document with a newer version, with the previous version retained in history
FR6: An entrepreneur can revert a document to a previous version
FR7: An entrepreneur can delete a dossier
FR8: The system classifies each dossier by sector and maturity stage based on questionnaire answers
FR9: An administrator can edit the text content of any dossier (action logged and visible to entrepreneur)
FR10: An administrator can upload or replace documents on any dossier (action logged and visible to entrepreneur)
FR11: An entrepreneur can complete a structured questionnaire to populate their dossier
FR12: The questionnaire auto-saves progress so the entrepreneur can resume without data loss
FR13: An administrator can configure the questionnaire structure (sections, fields, field types, required/optional status, ordering)
FR14: An administrator can update the questionnaire; existing completed dossiers are not retroactively affected
FR15: An administrator can configure the classification taxonomy (sectors, maturity stages, TRL levels)
FR16: An entrepreneur can generate a unique access link for a named recipient identified by email address
FR17: The system sends an email invitation to the recipient upon link generation
FR18: An entrepreneur can generate multiple independent links for the same dossier (one per recipient)
FR19: An entrepreneur can view the full list of active access links for a dossier (recipient email, creation date, link status)
FR20: An entrepreneur can revoke an individual access link at any time with immediate effect
FR21: A revoked or invalid link returns an access-denied response to any access attempt
FR22: An administrator can revoke any access link on any dossier (action logged and visible to entrepreneur)
FR23: An entrepreneur can view access analytics per link: number of views, session duration, timestamps
FR24: An entrepreneur can view a chronological log of all administrator actions on their dossier (action type, timestamp, admin identity)
FR25: An administrator can view access analytics across all dossiers on the platform
FR26: An administrator can view the full action log for any dossier including all admin interventions
FR27: A recipient can access a dossier shared with their email address by verifying their identity via that email (magic link — no traditional account registration required)
FR28: A financeur can view a consolidated list of all dossiers that have been shared with their email address
FR29: The shared dossier displays structured content in a standardized, consistent format
FR30: The shared dossier displays the dossier's classification (sector, maturity stage)
FR31: A financeur cannot access or infer the existence of other recipients' links for the same dossier
FR32: An administrator can invite users to the platform and assign them a role (entrepreneur or financeur)
FR33: An administrator can deactivate or remove a user account
FR34: An administrator can view a platform-level overview of all dossiers (count, sector distribution, maturity stage distribution)
FR35: An administrator can read the full content of any dossier on the platform
FR36: A user can register for an account with explicit, informed consent to data processing
FR37 (Phase 2): An entrepreneur can request full deletion of their account and all associated data
FR38 (Phase 2): The system executes a full data deletion request completely and irreversibly
FR39: A user can update their account profile information
FR40: The system generates each access link using a cryptographically secure random token (non-guessable, non-sequential)
FR41: The system enforces rate limiting on link access attempts per IP address to prevent brute-force enumeration
FR42: The system logs failed access attempts (invalid or revoked links) accessible to administrators

### NonFunctional Requirements

NFR1: Dossier display (shared link access) loads within 3 seconds on a standard broadband connection
NFR2: Questionnaire auto-save triggers within 2 seconds of user inactivity with no visible session disruption
NFR3: Document upload provides real-time progress feedback for files larger than 1 MB
NFR4: Access revocation takes effect within 5 seconds — subsequent access attempts on a revoked link are denied immediately
NFR5: All data in transit is encrypted using TLS 1.2 or higher
NFR6: Share link tokens are generated with a minimum of 128 bits of cryptographic entropy (CSPRNG)
NFR7: Rate limiting blocks more than 10 link access attempts per IP address per minute
NFR8: User passwords are stored using Argon2 hashing — MD5 and SHA-1 are forbidden
NFR9: The admin action log is append-only — existing entries cannot be modified or deleted
NFR10: All failed link access attempts are logged with IP address and timestamp
NFR11: V1 architecture supports up to 500 entrepreneur accounts, 100 financeur identities, and 1,000 dossiers on a single server
NFR12: The platform deploys on a single server instance without requiring a distributed setup
NFR13: Target availability: 99% uptime for the official instance (≤7 hours unplanned downtime per month)
NFR14: No data is lost on application restart — all writes are durable before confirmation
NFR15: The official instance performs daily automated database backups with a minimum 30-day retention period
NFR16: Deployment documentation includes a backup and restore procedure for self-hosted instances
NFR17: The email delivery layer is abstracted behind a configurable interface — any SMTP-compatible provider or Brevo can be used without code changes
NFR18: The file storage layer is abstracted behind an S3-compatible interface — any S3-compatible provider can be substituted without code changes
NFR19: The database connection is fully configurable via standard PostgreSQL connection parameters
NFR20: The platform targets WCAG 2.1 AA compliance as a baseline
NFR21: All interactive elements are keyboard-navigable — the platform is fully usable without a mouse
NFR22: All UI components use semantic HTML with appropriate ARIA labels to support screen readers
NFR23: The questionnaire and dossier interfaces use plain, clear language free of jargon
NFR24: The platform is AI-readable: dossier content is rendered in structured, semantic markup
NFR25: Dossier data is structured for future machine-readable export (JSON or equivalent)
NFR26: The platform interface is responsive and usable on mobile devices

### Additional Requirements (Architecture)

- Turborepo monorepo scaffold: `npx create-turbo@latest confluent --package-manager pnpm` — this is the first implementation story (Epic 1, Story 1)
- Apps: `apps/api` (NestJS 11, port 3000) + `apps/web` (React 19 + Vite 8, port 5173) + `packages/shared` (shared Zod schemas + Prisma types)
- ORM: Prisma 7.2.0 with Prisma Migrate; core tables: `users`, `dossiers`, `share_links`, `audit_log`, `questionnaire_versions`, `questionnaire_fields`, `dossier_answers`
- Append-only constraint on `audit_log` table — no UPDATE/DELETE migrations permitted; enforced at application layer
- Questionnaire schema versioning: dossier stores `questionnaire_version_id` snapshot at submission time (satisfies FR14)
- Auth: JWT + Passport for entrepreneurs/admins (15min access token, 7-day httpOnly refresh cookie); Custom NestJS Guard for financeurs (share_token UUID v4 in URL params)
- CSPRNG: `crypto.randomUUID()` — Node.js built-in, 128 bits entropy, no external dependency (satisfies NFR6)
- Validation: Zod 3.24 + nestjs-zod 5.1; all DTOs as Zod schemas in `packages/shared`; same schemas reused on frontend
- Rate limiting: `@nestjs/throttler` 6.5 — 10 link access attempts/IP/minute (satisfies NFR7)
- API security: Helmet middleware, CORS restricted to known frontend origin, TLS at reverse proxy (Nginx/Caddy)
- Argon2 for password hashing (satisfies NFR8)
- API style: REST, URL prefix `/v1/`, resource-based routing (`/dossiers`, `/shares`, `/questionnaires`, `/users`)
- OpenAPI: `@nestjs/swagger` 11.2.7 — Swagger UI at `/api/docs`, JSON spec at `/api/docs-json`
- Frontend routing: React Router v7 (file-based, `src/routes/`); route groups: `/dashboard`, `/share/:token`, `/admin`, `/auth`
- Server state: TanStack Query v5 — all API fetching; optimistic updates for revocation actions
- UI: shadcn/ui CLI v4 + Tailwind CSS v4; components copied into `apps/web/src/components/ui/`
- Forms: React Hook Form + Zod resolvers; dynamic questionnaire driven by admin-defined schema
- Local dev: Docker Compose — `postgres:16-alpine` + `minio/minio` + `mailhog` (email capture)
- Config: `@nestjs/config` + Zod schema validation at startup; fail-fast on missing env vars; `.env.example` committed
- CI/CD: GitHub Actions — multi-stage Docker build + push to ghcr.io + SSH deploy to French regional provider
- Logging: NestJS Logger (stdout JSON in production); structured logs with correlation IDs
- Naming: snake_case in PostgreSQL (Prisma `@map`/`@@map`), camelCase in TypeScript everywhere else

### UX Design Requirements

UX-DR1: Configure shadcn/ui design tokens — override CSS variables in `globals.css` for Notion-inspired palette: background-base `#FAFAF9`, background-sidebar `#F1F0EE`, text-primary `#1A1A1A`, text-secondary `#6B6B6B`, border `#E8E8E7`, accent `#37352F`, status dots (active `#4CAF7D`, pending `#F0A830`, revoked `#B0B0B0`). Font: Inter (Google Fonts). Radius: 6px. 4pt spacing grid.
UX-DR2: Custom component `QuestionnaireStep` — Typeform-style single-question display: 3px progress bar, step indicator ("Section N · Question M sur P"), H1 question text (28px/700), optional hint text, bottom-border-only input (18px), OK button + "ou Entrée ↵" hint. Enter key advances, ↑/↓ footer nav, 200ms slide-up transition between steps. `aria-live` region for step progress.
UX-DR3: Custom component `SectionSummary` — checkpoint screen after each questionnaire section: H2 section title, list of Q/R pairs with per-row "Modifier" ghost link, "Valider cette section" primary button. This is a full step in the flow, not a modal.
UX-DR4: Custom component `AccessListRow` — recipient row in analytics timeline: 32px avatar (initials), email (500 weight), session detail (12px secondary), session duration (22px/700 right-aligned), `StatusDot`, revoke button. States: active (full opacity + revoke), pending (duration "—" + revoke), revoked (55% opacity, no revoke button, shows "Révoqué"). Revoke button turns destructive on hover only.
UX-DR5: Custom component `DossierField` — label (11px small caps, text-secondary) + value (13px, 500 weight); wrapped in `<dl>/<dt>/<dd>` semantic structure. Variants: short text, long text (line-height 1.6), numeric (larger weight + unit sub-label), classification (Badge components).
UX-DR6: Custom component `MetricCard` — label (11px small caps) + value (24px/700) + sub-label (11px secondary). Read-only. Used in 3-column grid above analytics timeline. bg-card, border, radius 8px, padding 16px.
UX-DR7: Custom component `StatusDot` — 7px colored dot + text label (always paired, never color alone). States: active (green `#4CAF7D`), pending (orange `#F0A830`), revoked (gray `#B0B0B0`).
UX-DR8: Custom component `EmptyState` — monochrome inline SVG + H3 title + body secondary description + optional CTA Button. Variants: dashboard (no dossiers), access list (no recipients), admin pipeline (empty platform).
UX-DR9: Magic link login screen — off-white background, Confluent logo centered, single email input (full-width), "Recevoir mon lien de connexion" primary button, sub-label "Pas de mot de passe — vérifiez votre boîte mail". No OAuth, no forgot password. Sole exception for placeholder-only field (unambiguous context).
UX-DR10: Analytics view layout (D4) — 3-column MetricCard grid at top (active recipients, total views, avg session duration), followed by `AccessListRow` timeline in a card container (bg-card, border, radius 8px). "Partager" primary button in header. Breadcrumb: `Dossiers / [Name] / Accès & analytics`.
UX-DR11: Share panel layout (D5) — shadcn/ui Sheet component (300px, right side). Content: title "Partager le dossier", description text, separator, email input with visible label, "Envoyer l'invitation" primary button, "Annuler" secondary button, separator, existing recipients mini-list with StatusDot. Panel closes automatically after send; toast confirms; new row appears in access list.
UX-DR12: Responsive — financeur dossier view: single-column stacked sections on mobile (<768px) with anchor nav at top; two-column card grid on desktop (1024px+). Minimum touch targets 44×44px on all interactive elements. This is the highest-priority responsive surface.
UX-DR13: Responsive — entrepreneur dashboard: bottom icon bar on mobile (<768px); icon-only collapsed sidebar (60px) on tablet (768–1023px); full sidebar (240px) on desktop (1024px+).
UX-DR14: WCAG 2.1 AA compliance implementation: visible focus ring (2px solid #37352F, offset 2px) on all interactive elements; `aria-live` on QuestionnaireStep; skip link ("Aller au contenu principal") on all pages; `aria-current="page"` on active sidebar item; `aria-busy` on loading containers; all status indicators use color + text label.
UX-DR15: Breadcrumb navigation — shown at depth level 2+ (not on top-level sidebar views). Each segment is a clickable `<a>` link ensuring shareable, bookmarkable URLs. Examples: `Dossiers / Biosensio`, `Dossiers / Biosensio / Accès & analytics`, `Admin / Questionnaire / Section 3`.

### FR Coverage Map

FR1: Epic 2 — Entrepreneur creates a dossier (UI hardcoded) / Epic 7 — persisted in database
FR2: Epic 3 — Multiple dossiers in dashboard (mocked) / Epic 7 — persisted
FR3: Epic 7 — Edit dossier content (API)
FR4: Epic 7 — Document upload
FR5: Epic 7 — Document version history
FR6: Epic 7 — Document revert
FR7: Epic 7 — Delete dossier
FR8: Epic 7 — Dossier classification from questionnaire answers
FR9: Epic 9 — Admin edits dossier (API + audit log)
FR10: Epic 9 — Admin uploads documents (API + audit log)
FR11: Epic 2 — Questionnaire UI hardcoded / Epic 7 — dynamic from admin schema
FR12: Epic 2 — Auto-save UI (simulated) / Epic 7 — real auto-save to API
FR13: Epic 5 — Questionnaire builder UI (mocked) / Epic 9 — persisted
FR14: Epic 7 — Schema versioning (questionnaire_version_id snapshot)
FR15: Epic 5 — Classification taxonomy UI / Epic 9 — persisted
FR16: Epic 3 — Share link UI (mocked) / Epic 8 — real link generation
FR17: Epic 8 — Email invitation sent on link generation
FR18: Epic 3 — Multiple links per dossier UI / Epic 8 — real
FR19: Epic 3 — Access list display (mocked) / Epic 8 — real
FR20: Epic 3 — Revoke UI (mocked) / Epic 8 — real revocation
FR21: Epic 4 — Access denied page (UI) / Epic 8 — enforced by API
FR22: Epic 9 — Admin revoke (API + audit log)
FR23: Epic 3 — Analytics timeline UI (mocked) / Epic 8 — real data
FR24: Epic 3 — Admin action log display / Epic 8 — real audit trail
FR25: Epic 9 — Admin analytics view (API)
FR26: Epic 9 — Admin full action log (API)
FR27: Epic 4 — Financeur dossier view UI (mocked) / Epic 6 — magic link auth real
FR28: Epic 4 — Financeur dossier list (mocked) / Epic 8 — real
FR29: Epic 4 — Standardized dossier display (UI)
FR30: Epic 4 — Classification tags in dossier view
FR31: Epic 4 — Financeur cannot see other recipients (enforced by API, Epic 8)
FR32: Epic 5 — User invite UI / Epic 9 — real user management
FR33: Epic 5 — Deactivate user UI / Epic 9 — real
FR34: Epic 5 — Platform pipeline overview UI / Epic 9 — real data
FR35: Epic 5 — Admin read dossier / Epic 9 — real access
FR36: Epic 6 — User registration with magic link auth
FR37: Phase 2 — Full data deletion (deferred)
FR38: Phase 2 — Data deletion execution (deferred)
FR39: Epic 6 — Update account profile (API)
FR40: Epic 6 — CSPRNG token generation (crypto.randomUUID)
FR41: Epic 6 — Rate limiting (@nestjs/throttler)
FR42: Epic 6 — Failed access attempt logging

---

## Epic List

### Epic 1: Project Foundation & Design System
Bootstrap the Turborepo monorepo, configure shadcn/ui with the Notion-inspired design tokens, establish React Router route structure, and set up a hardcoded user context (no auth required). This is the technical foundation that enables all subsequent frontend epics.
**FRs covered:** None directly (architectural prerequisite)
**Arch:** Turborepo scaffold, shadcn/ui CLI v4, Tailwind CSS v4, React Router v7 route skeleton
**UX-DRs:** UX-DR1

### Epic 2: Core Loop — Dashboard to Dossier (Frontend)
An entrepreneur lands on the dashboard (hardcoded user), creates a new dossier, answers a hardcoded questionnaire using the Typeform-style QuestionnaireStep component, completes each section with SectionSummary checkpoints, and sees their completed dossier displayed at the end. Zero API calls — everything runs in frontend state.
**FRs covered:** FR1 (UI), FR11 (UI), FR12 (simulated auto-save)
**UX-DRs:** UX-DR2, UX-DR3, UX-DR8 (empty states), UX-DR14 (a11y), UX-DR15 (breadcrumbs)

### Epic 3: Entrepreneur Dashboard & Access Management (Frontend)
An entrepreneur can view a dashboard listing multiple dossiers, open the D5 slide-in share panel to add a recipient by email, see the D4 analytics timeline with per-recipient session data, and revoke access — all with mocked data.
**FRs covered:** FR2 (UI), FR16 (UI), FR18 (UI), FR19 (UI), FR20 (UI), FR23 (UI), FR24 (UI)
**UX-DRs:** UX-DR4, UX-DR6, UX-DR7, UX-DR8, UX-DR10, UX-DR11, UX-DR13, UX-DR14, UX-DR15

### Epic 4: Financeur — Shared Dossier View (Frontend)
A financeur opens a shared link URL, sees a minimal email verification screen (mocked — no real magic link yet), and views the complete structured dossier in both mobile and desktop layouts. Includes the access denied page for revoked/invalid links.
**FRs covered:** FR21 (UI), FR27 (UI), FR28 (UI), FR29, FR30, FR31 (UI enforcement deferred)
**UX-DRs:** UX-DR5, UX-DR9 (magic link screen UI only), UX-DR12, UX-DR14

### Epic 5: Admin — Back-office (Frontend)
An administrator can view the regional pipeline overview with stats, navigate to a questionnaire builder to configure sections and fields, and access user management to invite/deactivate accounts — all mocked.
**FRs covered:** FR13 (UI), FR15 (UI), FR32 (UI), FR33 (UI), FR34 (UI), FR35 (UI)
**UX-DRs:** UX-DR8 (admin empty state)

### Epic 6: Auth & API Infrastructure
The real backend is live: NestJS + Prisma schema, magic link authentication for all roles, JWT + custom link guard, rate limiting, Docker Compose local dev environment, and environment configuration with fail-fast validation.
**FRs covered:** FR36, FR39, FR40, FR41, FR42
**NFRs:** NFR5, NFR6, NFR7, NFR8
**Arch:** NestJS scaffold, Prisma schema (all tables), JWT + Passport, custom link guard, @nestjs/throttler, Docker Compose, @nestjs/config + Zod startup validation, .env.example

### Epic 7: API — Dossiers & Questionnaire
The questionnaire saves to the database, dossiers persist, document upload works with S3-compatible storage, auto-save is real (debounced mutation), and dossier classification is computed from answers. Frontend switches from mocked data to real API calls.
**FRs covered:** FR1–FR12, FR14
**NFRs:** NFR2, NFR3, NFR14
**Arch:** Prisma dossier/questionnaire tables, S3 storage adapter, TanStack Query wiring, Zod schemas in packages/shared

### Epic 8: API — Sharing, Analytics & Audit
Share links are generated with real CSPRNG tokens, email invitations are sent via Brevo/SMTP, access is tracked per session, analytics are real, revocation is immediate (≤5s), and the audit log is append-only. Frontend switches from mocked access data to real API.
**FRs covered:** FR16–FR26, FR40–FR42
**NFRs:** NFR1, NFR4, NFR9, NFR10, NFR17
**Arch:** share_links table, audit_log append-only, optimistic updates (TanStack Query), Brevo SMTP adapter

### Epic 9: API — Administration
Admins can configure the questionnaire in the database, manage user accounts via real API, and see actual platform pipeline data. Admin actions on dossiers are logged and visible to entrepreneurs.
**FRs covered:** FR9, FR10, FR13, FR14, FR15, FR22, FR25, FR26, FR32, FR33, FR34, FR35
**NFRs:** NFR11, NFR12

### Epic 10: Production & Deployment
The platform is deployable: multi-stage Docker build, GitHub Actions CI/CD pipeline, Nginx/Caddy reverse proxy with TLS, daily database backups, and self-hosting documentation.
**NFRs:** NFR12, NFR13, NFR15, NFR16, NFR18, NFR19
**Arch:** GitHub Actions workflow, Docker multi-stage build, ghcr.io push, SSH deploy, Nginx config, backup procedure docs

### Epic 11: V1 Polish — Full Web Wiring, User State, Email Pipeline
Closes the deferred scope of Epics 7-8 (web routes still rendering mocks) and brings the user model + email pipeline to production quality: `User.emailVerifiedAt` separated from `isActive` (state-of-the-art identity model), auto-creation of `User` rows on share invite (financeurs invited by entrepreneurs can now self-login via magic-link), single-source HTML email templates with JSON-based i18n (compatible Outlook/Gmail/Apple Mail), Brevo SMTP relay for production, and dev tooling to preview/test emails. Provider-agnostic by design.
**FRs covered (gaps closed):** FR1–FR3, FR9, FR10, FR11, FR12, FR16–FR20, FR22, FR23, FR24, FR26, FR27, FR28, FR32–FR35 (frontend wiring) ; FR17 (email pipeline)
**NFRs:** NFR17 (Brevo abstraction)
**Arch:** `User.emailVerifiedAt` + `User.locale` Prisma migration, `EmailTransport` interface typée (`sendMagicLink`/`sendShareInvite`), HTML templates statiques ouvrables dans un navigateur, JSON i18n single-source, scripts `email:preview` + `email:test`

<!-- Stories will be appended below by epic -->

---

## Epic 1: Project Foundation & Design System

Bootstrap the Turborepo monorepo, configure shadcn/ui with Notion-inspired design tokens, establish React Router route structure, and inject a hardcoded user context. This is the technical prerequisite for all subsequent frontend epics.

### Story 1.1: Turborepo Monorepo Scaffold

As a developer,
I want a working Turborepo monorepo with apps/api, apps/web, and packages/shared,
So that frontend and backend can be developed in a unified codebase with shared TypeScript types from day one.

**Acceptance Criteria:**

**Given** the repository is cloned and `pnpm install` is run at the root,
**When** the install completes,
**Then** all three workspaces (`apps/api`, `apps/web`, `packages/shared`) install without errors and `node_modules` are correctly linked via pnpm workspaces.

**Given** the monorepo is installed,
**When** `pnpm turbo run dev` is executed at root,
**Then** `apps/web` starts on port 5173 (Vite) and `apps/api` starts on port 3000 (NestJS) with no startup errors.

**Given** `packages/shared/src/index.ts` exports a TypeScript type,
**When** that type is imported in both `apps/web` and `apps/api`,
**Then** TypeScript resolves the import without errors in both workspaces.

**Given** the monorepo root,
**When** `pnpm turbo run build` is executed,
**Then** both `apps/web` (Vite build) and `apps/api` (NestJS tsc) complete successfully with zero TypeScript errors.

**Given** the monorepo,
**When** `pnpm turbo run lint` is executed,
**Then** ESLint and Prettier report zero errors across all workspaces.

**Given** the project root,
**When** a developer inspects `turbo.json`,
**Then** pipeline tasks are defined for `dev`, `build`, `lint`, and `typecheck` with correct dependencies declared.

---

### Story 1.2: Design System Configuration

As a developer,
I want shadcn/ui initialized with Confluent's Notion-inspired design tokens,
So that all UI components use the correct palette, typography, and spacing from the very first component built.

**Acceptance Criteria:**

**Given** `apps/web/src/index.css` (or `globals.css`),
**When** the app loads in the browser,
**Then** the following CSS variables are defined and applied globally:
- `--background: #FAFAF9` (page base)
- `--card: #FFFFFF`
- `--foreground: #1A1A1A`
- `--muted-foreground: #6B6B6B`
- `--border: #E8E8E7`
- `--primary: #37352F`
- `--radius: 6px`

**Given** shadcn/ui CLI is initialized in `apps/web`,
**When** `npx shadcn add button input card sheet toast separator badge avatar label` is run,
**Then** all components are added to `apps/web/src/components/ui/` with no errors.

**Given** a primary Button is rendered,
**When** a user views it at rest,
**Then** background is `#37352F` and text is white.

**Given** a primary Button is rendered,
**When** a user hovers over it,
**Then** background darkens to `#1A1A1A` with no hue shift and no color transition.

**Given** the `index.html` of `apps/web`,
**When** the page loads,
**Then** Inter (Google Fonts) is loaded and applied as the default `font-family` across the entire app.

**Given** a Card component rendered on the base page background,
**When** a developer inspects it,
**Then** the card shows `background: #FFFFFF`, `border: 1px solid #E8E8E7`, `border-radius: 6px` on `background: #FAFAF9`.

**Given** Tailwind CSS v4 is configured,
**When** `pnpm turbo run build` is run,
**Then** only used CSS classes are included in the production bundle (no unused Tailwind output).

---

### Story 1.3: Route Skeleton & Hardcoded User Context

As a developer,
I want React Router v7 configured with all route groups and a globally available hardcoded user context,
So that every frontend epic can be built immediately without any authentication infrastructure.

**Acceptance Criteria:**

**Given** the app starts,
**When** a developer navigates to `/dashboard`,
**Then** a dashboard placeholder page renders with the page title "Dashboard" — no auth redirect occurs.

**Given** the app starts,
**When** a developer navigates to `/share/any-token`,
**Then** a financeur placeholder page renders with the page title "Dossier partagé".

**Given** the app starts,
**When** a developer navigates to `/admin`,
**Then** an admin placeholder page renders with the page title "Administration".

**Given** the app starts,
**When** a developer navigates to `/auth`,
**Then** an auth placeholder page renders with the page title "Connexion".

**Given** any component in `apps/web`,
**When** the `useCurrentUser()` hook is called,
**Then** it returns the hardcoded user object:
```json
{ "id": "hardcoded-1", "name": "Sophie Moreau", "email": "sophie@biosensio.fr", "role": "entrepreneur" }
```

**Given** the app layout includes a sidebar,
**When** a user is on `/dashboard`,
**Then** the Dashboard sidebar item is highlighted as active (`font-weight: 500`, darker background).

**Given** a user navigates to an undefined route,
**When** the router resolves the path,
**Then** a 404 page is displayed with a link back to `/dashboard`.

**Given** the route structure,
**When** a developer inspects `src/routes/`,
**Then** route files exist for all four route groups: `dashboard`, `share`, `admin`, `auth`.

---

## Epic 2: Core Loop — Dashboard to Dossier (Frontend)

An entrepreneur lands on the dashboard (hardcoded user: Sophie Moreau), creates a new dossier by naming it, answers a hardcoded questionnaire through Typeform-style single-question screens, validates each section at a SectionSummary checkpoint, and sees their completed dossier displayed at the end. Zero API calls — all state lives in React (with localStorage for simulated auto-save).

### Story 2.1: App Shell & Sidebar Layout

As an entrepreneur,
I want a consistent application shell with a responsive sidebar,
So that I can navigate between sections of the platform and always know where I am.

**Acceptance Criteria:**

**Given** the app loads on desktop (≥1024px),
**When** any authenticated route renders,
**Then** a 240px left sidebar is visible containing: the Confluent logo at the top, navigation links (Mes dossiers, Tableau de bord), and the hardcoded user's name + email at the bottom.

**Given** the app is viewed on tablet (768px–1023px),
**When** any authenticated route renders,
**Then** the sidebar collapses to 60px showing icons only (no labels), and the page content area expands accordingly.

**Given** the app is viewed on mobile (<768px),
**When** any authenticated route renders,
**Then** the sidebar is hidden and a bottom navigation bar appears with icon links to the main sections.

**Given** the sidebar is visible,
**When** the user is on `/dashboard`,
**Then** the "Mes dossiers" nav item has `aria-current="page"`, a darker background (`#F1F0EE`), and `font-weight: 500`.

**Given** the sidebar user block at the bottom,
**When** a developer inspects it,
**Then** it displays "Sophie Moreau" as the name and "sophie@biosensio.fr" as the email, sourced from `useCurrentUser()`.

**Given** any page with depth ≥ 2 (e.g. `/dashboard/dossiers/biosensio`),
**When** the breadcrumb component renders,
**Then** it appears above the page content as a horizontal trail of clickable `<a>` links separated by `/`, with the last segment non-linked and the full path bookmarkable.

**Given** all interactive elements in the sidebar,
**When** a user navigates with Tab and Enter only,
**Then** focus rings (2px solid `#37352F`, offset 2px) are visible on each focused element and activation works correctly.

---

### Story 2.2: Dashboard — Empty State

As an entrepreneur with no dossiers yet,
I want to see an encouraging empty state with a clear call to action,
So that I understand what to do next and feel confident starting.

**Acceptance Criteria:**

**Given** the user is on `/dashboard` and no dossier exists in local state,
**When** the dashboard renders,
**Then** the `EmptyState` component is displayed with: a monochrome inline SVG illustration, the H3 title "Aucun dossier pour l'instant", a secondary description "Créez votre premier dossier pour commencer à partager votre projet avec des investisseurs.", and a primary CTA Button "Créer un dossier".

**Given** the `EmptyState` component is rendered,
**When** a developer inspects the markup,
**Then** it contains no external image `<img>` tags — the illustration is an inline `<svg>` using `currentColor` for strokes so it respects dark mode.

**Given** the "Créer un dossier" CTA button in the empty state,
**When** the user clicks it,
**Then** the router navigates to `/dashboard/dossiers/nouveau`.

**Given** the empty state page,
**When** a user navigates with Tab,
**Then** the CTA button is reachable via keyboard and activatable with Enter or Space.

**Given** the empty state is visible,
**When** viewed on mobile (<768px),
**Then** the SVG, heading, description, and CTA are stacked vertically, centered, with adequate padding — no horizontal overflow.

---

### Story 2.3: Dossier Creation — Naming Step

As an entrepreneur,
I want to give my dossier a name before answering any questions,
So that my project is clearly identified from the start.

**Acceptance Criteria:**

**Given** the user navigates to `/dashboard/dossiers/nouveau`,
**When** the page renders,
**Then** a single-field form is displayed with: the label "Comment s'appelle votre projet ?", a bottom-border-only text input (no box border, only a 1px bottom border in `#E8E8E7`, growing to `#37352F` on focus), a primary button "Commencer →", and a sub-label hint "Vous pourrez modifier ce nom plus tard.".

**Given** the naming form,
**When** the user submits with an empty input,
**Then** an inline validation message "Le nom du projet est requis." appears below the input and the navigation does not proceed.

**Given** the naming form,
**When** the user types a valid name and presses Enter or clicks "Commencer →",
**Then** the dossier name is stored in React state (or localStorage), and the router navigates to the first question of the questionnaire at `/dashboard/dossiers/nouveau/questionnaire`.

**Given** the naming step page,
**When** a developer inspects the route,
**Then** no breadcrumb is shown (this is step 1 of a wizard flow, not a depth-2 nav item).

**Given** the naming input,
**When** the page loads,
**Then** focus is automatically placed on the input (`autoFocus`) so the user can type immediately without clicking.

---

### Story 2.4: QuestionnaireStep Component & Hardcoded Questions

As an entrepreneur filling out my dossier,
I want a focused, one-question-at-a-time interface,
So that the process feels clear, guided, and not overwhelming.

**Acceptance Criteria:**

**Given** the questionnaire route renders,
**When** the first question loads,
**Then** the `QuestionnaireStep` component displays:
- A thin 3px progress bar at the top of the viewport reflecting the current position (e.g. 2 of 12 questions = 16% width), using `#37352F` fill on `#E8E8E7` track
- A step indicator label "Section 1 · Question 1 sur 4" in 12px secondary text
- The question text as an H1 at 28px / font-weight 700
- An optional hint paragraph in 14px secondary color below the question
- A bottom-border-only input for text answers (consistent with Story 2.3 styling)
- An "OK →" primary button and a "ou Entrée ↵" ghost hint text beside it

**Given** the hardcoded question fixture file (`src/data/questionnaire.ts`),
**When** a developer inspects it,
**Then** it contains exactly 3 sections with the following structure:
- **Section 1 — Présentation** (4 questions): nom du projet, secteur d'activité, stade de maturité, description courte du projet
- **Section 2 — Produit & Marché** (4 questions): problème résolu, solution proposée, marché cible, différenciateur clé
- **Section 3 — Finances & Équipe** (4 questions): montant recherché, utilisation des fonds, taille de l'équipe, profil du fondateur

**Given** the user has typed an answer,
**When** they press Enter or click "OK →",
**Then** the next question slides in from the bottom with a 200ms ease-out CSS transition, the previous question slides out upward, and the progress bar animates to the new percentage.

**Given** the user is on any question that is not the first,
**When** they press the up arrow key (↑) or click the back chevron in the footer,
**Then** the previous question is shown and the current (partial) answer is preserved in state.

**Given** the user has answered at least one question and closes the browser tab,
**When** they return to `/dashboard/dossiers/nouveau/questionnaire`,
**Then** their answers are restored from `localStorage` (key: `confluent_draft_{dossierName}`) and the progress bar reflects the restored position.

**Given** the `QuestionnaireStep` component,
**When** a developer inspects the DOM,
**Then** there is an `aria-live="polite"` region that announces the current step indicator text on each question transition.

**Given** the questionnaire on mobile (<768px),
**When** the component renders,
**Then** the question H1 font-size reduces to 22px, touch targets for OK and nav buttons are ≥44px, and no element overflows the viewport horizontally.

---

### Story 2.5: SectionSummary — Inter-section Checkpoint

As an entrepreneur finishing a section of the questionnaire,
I want to review my answers before continuing,
So that I can correct any mistake before moving to the next topic.

**Acceptance Criteria:**

**Given** the user completes the last question of a section (Sections 1 or 2) and presses Enter / "OK →",
**When** the transition occurs,
**Then** the `SectionSummary` screen replaces the question view (full-screen, same container as `QuestionnaireStep`) — it is not a modal or drawer.

**Given** the `SectionSummary` screen renders,
**When** a developer inspects it,
**Then** it contains:
- An H2 with the section title (e.g. "Section 1 — Présentation")
- A list of Q/R pairs: each row shows the question label in 11px small caps secondary text, and the answer in 13px 500-weight primary text
- A "Modifier" ghost link on each row (styled as `text-secondary`, no underline, underline on hover) that navigates back to that specific question index
- A primary button "Valider cette section →" at the bottom

**Given** the user clicks "Modifier" on a row,
**When** the navigation occurs,
**Then** the questionnaire returns to the exact question for that row, the answer is pre-filled in the input, and a "← Retour au récapitulatif" ghost link is visible below the input so they can skip editing and return directly.

**Given** the user clicks "Valider cette section →",
**When** the action fires,
**Then** the first question of the next section appears with a slide-in transition, and the progress bar advances past the checkpoint.

**Given** the `SectionSummary` screen,
**When** a user navigates with keyboard only,
**Then** Tab cycles through all "Modifier" links and the "Valider cette section →" button, each with visible focus rings, and Enter activates each.

---

### Story 2.6: Completion Screen & Dossier Display

As an entrepreneur who has finished the questionnaire,
I want to see a confirmation and then view my completed dossier,
So that I know my work is saved and can review how it will appear to others.

**Acceptance Criteria:**

**Given** the user clicks "Valider cette section →" on the Section 3 summary,
**When** the final validation fires,
**Then** a full-screen completion view renders with: a checkmark icon (inline SVG, `#4CAF7D`), an H2 "Dossier complété !", a secondary description "Votre dossier Biosensio est prêt. Vous pouvez maintenant le consulter et le partager.", and a primary button "Voir mon dossier".

**Given** the user clicks "Voir mon dossier",
**When** the navigation fires,
**Then** the router navigates to `/dashboard/dossiers/biosensio` (slugified from the dossier name) and the page renders the full dossier view.

**Given** the dossier view page at `/dashboard/dossiers/:slug`,
**When** it renders,
**Then** the page displays:
- A breadcrumb `Dossiers / Biosensio` at the top (two segments, "Dossiers" links to `/dashboard`, "Biosensio" is the current non-linked segment)
- The dossier name as an H1
- All 12 answers grouped by section, each rendered as a `DossierField` component (`<dl>/<dt>/<dd>` structure, label 11px small caps `#6B6B6B`, value 13px 500-weight `#1A1A1A`)

**Given** the `DossierField` component,
**When** a developer inspects the DOM for a long-text answer (>100 characters),
**Then** the `<dd>` element uses `line-height: 1.6` and does not truncate the text.

**Given** the dossier page,
**When** viewed on mobile (<768px),
**Then** all `DossierField` items stack vertically in a single column with no horizontal overflow, and section headings remain visible as sticky or clearly separated sub-headings.

**Given** the dossier page renders with answers from localStorage,
**When** the user refreshes the browser,
**Then** the dossier content is still displayed (data persists in `localStorage` under `confluent_draft_{slug}`).

---

## Epic 3: Entrepreneur Dashboard & Access Management (Frontend)

An entrepreneur can view a dashboard listing multiple mocked dossiers, open a dossier to see its content and analytics, use the D5 slide-in share panel to invite a recipient, view the D4 analytics timeline with per-recipient session data, and revoke access — all with mocked data and local state only.

### Story 3.1: Dashboard — Dossier List (Mocked)

As an entrepreneur with existing dossiers,
I want to see all my dossiers listed on the dashboard,
So that I can quickly find and open the one I want to work on.

**Acceptance Criteria:**

**Given** the user is on `/dashboard` and dossier data exists in local mock state,
**When** the dashboard renders,
**Then** a list of dossier cards is displayed (minimum 2 mocked entries: "Biosensio" and "Agrotrack"), each card showing: dossier name (16px 500-weight), sector label, maturity stage badge, number of active share links, and creation date in relative format ("il y a 3 jours").

**Given** the dossier list is populated,
**When** the `EmptyState` component check runs,
**Then** the empty state (Story 2.2) is not rendered — it only appears when the list is truly empty.

**Given** a dossier card in the list,
**When** the user clicks on it,
**Then** the router navigates to `/dashboard/dossiers/:slug` (e.g. `/dashboard/dossiers/biosensio`).

**Given** the dossier list,
**When** viewed on mobile (<768px),
**Then** cards stack in a single column with full-width layout, touch targets for the card are ≥44px tall, and no horizontal overflow occurs.

**Given** the dashboard header area,
**When** the page renders,
**Then** a "Créer un dossier" primary button is visible in the top-right of the content area (complementary to the empty state CTA, always present).

---

### Story 3.2: Dossier Page — Header & Tab Navigation

As an entrepreneur viewing a dossier,
I want a clear header with navigation tabs,
So that I can switch between the dossier content and its access analytics.

**Acceptance Criteria:**

**Given** the user navigates to `/dashboard/dossiers/biosensio`,
**When** the page renders,
**Then** the following elements are visible at the top:
- Breadcrumb: `Dossiers / Biosensio` (two segments — "Dossiers" links to `/dashboard`, "Biosensio" is non-linked current segment)
- H1 with the dossier name "Biosensio" at 24px / font-weight 700
- A primary button "Partager" in the top-right of the header row
- Two tabs: "Contenu" and "Accès & analytics"

**Given** the dossier page first loads,
**When** no tab query param is present in the URL,
**Then** the "Contenu" tab is active by default, showing the dossier fields.

**Given** the user clicks the "Accès & analytics" tab,
**When** the tab activates,
**Then** the URL updates to `/dashboard/dossiers/biosensio?tab=analytics` and the analytics view renders (Story 3.3).

**Given** the URL includes `?tab=analytics`,
**When** the user shares or bookmarks the URL and visits it,
**Then** the "Accès & analytics" tab is active on load — the tab state is preserved in the URL.

**Given** both tabs,
**When** a user navigates with Tab/Arrow keys,
**Then** tab switching is keyboard-accessible per ARIA tab pattern (`role="tablist"`, `role="tab"`, `aria-selected`, arrow key navigation).

---

### Story 3.3: MetricCard Grid & Analytics Timeline (D4)

As an entrepreneur reviewing a dossier's performance,
I want to see key metrics and a detailed per-recipient timeline,
So that I understand how investors are engaging with my dossier.

**Acceptance Criteria:**

**Given** the "Accès & analytics" tab is active,
**When** the view renders,
**Then** a 3-column `MetricCard` grid appears at the top showing three cards:
- "Destinataires actifs" with value "2"
- "Vues totales" with value "7"
- "Durée moy. de session" with value "4m 32s"

**Given** the `MetricCard` component,
**When** a developer inspects it,
**Then** each card has: `background: var(--card)`, `border: 1px solid var(--border)`, `border-radius: 8px`, `padding: 16px`, label in 11px small caps `var(--muted-foreground)`, value in 24px / font-weight 700, optional sub-label in 11px secondary.

**Given** the MetricCard grid,
**When** viewed on mobile (<768px),
**Then** the 3-column grid collapses to a single column with each card full-width.

**Given** the analytics view below the MetricCard grid,
**When** the view renders,
**Then** a card container (`bg-card`, border, `border-radius: 8px`) displays a list of 3 mocked `AccessListRow` entries with mixed statuses: 1 active (arc@capital.fr), 1 pending (martin@fund.io), 1 revoked (lea@invest.com).

**Given** the analytics view header,
**When** a developer inspects it,
**Then** the section title "Accès & partage" appears above the `AccessListRow` list, and the breadcrumb reads `Dossiers / Biosensio` (no third segment — analytics is surfaced via tab, not a separate route depth).

---

### Story 3.4: AccessListRow & StatusDot Components

As a developer,
I want reusable `AccessListRow` and `StatusDot` components that accurately reflect recipient states,
So that access data is legible and actionable across all views.

**Acceptance Criteria:**

**Given** the `StatusDot` component rendered with `status="active"`,
**When** a developer inspects it,
**Then** a 7px filled circle with color `#4CAF7D` is displayed alongside the text label "Actif" — color is never used alone.

**Given** the `StatusDot` component rendered with `status="pending"`,
**When** inspected,
**Then** color is `#F0A830` and label is "En attente".

**Given** the `StatusDot` component rendered with `status="revoked"`,
**When** inspected,
**Then** color is `#B0B0B0` and label is "Révoqué".

**Given** an `AccessListRow` with `status="active"`,
**When** it renders,
**Then** it shows: 32px avatar circle with recipient initials (font-weight 600), recipient email at font-weight 500, session detail in 12px secondary text (last seen timestamp), session duration at 22px / font-weight 700 right-aligned, `StatusDot` with "Actif", and a "Révoquer" button.

**Given** the "Révoquer" button in an active `AccessListRow`,
**When** the button is at rest,
**Then** it renders as a ghost/outline button with no destructive styling.

**Given** the "Révoquer" button in an active `AccessListRow`,
**When** the user hovers over it,
**Then** the button transitions to destructive styling (red text + red border) with no layout shift.

**Given** an `AccessListRow` with `status="pending"`,
**When** it renders,
**Then** the session duration shows "—" instead of a time value, and the "Révoquer" button is present.

**Given** an `AccessListRow` with `status="revoked"`,
**When** it renders,
**Then** the entire row renders at 55% opacity, the "Révoquer" button is absent, and a "Révoqué le [date]" text is shown in place of the button.

**Given** all `AccessListRow` components,
**When** a developer audits WCAG compliance,
**Then** the avatar circle has `aria-label` with the recipient's name, the StatusDot has `aria-label` with the status text, and the row is readable by screen readers without relying on color alone.

---

### Story 3.5: Share Panel (D5) with Sheet Component

As an entrepreneur,
I want a slide-in panel to add a new recipient to my dossier,
So that I can share access without leaving the current page.

**Acceptance Criteria:**

**Given** the user clicks "Partager" in the dossier header,
**When** the click fires,
**Then** the shadcn/ui `Sheet` component slides in from the right at 300px width with a 150ms ease-out transition.

**Given** the Sheet is open,
**When** a developer inspects its content,
**Then** it contains, top to bottom:
- Title "Partager le dossier" (16px / 600 weight)
- Description "Entrez l'adresse email du destinataire pour lui envoyer une invitation d'accès."
- A `Separator` component
- A labeled email input ("Adresse email du destinataire") with `type="email"` and `placeholder="marc@fonds.fr"`
- Primary button "Envoyer l'invitation"
- Secondary/outline button "Annuler"
- A `Separator`
- A mini-list of existing recipients, each showing `StatusDot` + email on one line

**Given** the email input is submitted empty,
**When** validation runs (Zod resolver),
**Then** an inline error "L'adresse email est requise." appears below the input and the panel does not close.

**Given** a valid email is submitted,
**When** "Envoyer l'invitation" is clicked,
**Then**: (1) the Sheet closes, (2) a shadcn/ui toast notification appears "Invitation envoyée à marc@fonds.fr", (3) a new `AccessListRow` with `status="pending"` and the entered email is prepended to the access list in local state.

**Given** the "Annuler" button or the Sheet overlay,
**When** clicked,
**Then** the Sheet closes and no state change occurs.

**Given** the Sheet is open,
**When** the user presses Escape,
**Then** the Sheet closes (default shadcn/ui behavior via Radix Dialog).

**Given** the Sheet opens,
**When** focus is transferred,
**Then** focus moves to the email input automatically (first focusable element inside the panel).

---

### Story 3.6: Access Revocation (Optimistic, Mocked)

As an entrepreneur,
I want to revoke a recipient's access with a confirmation step,
So that I don't accidentally cut off access and can confirm the action before it takes effect.

**Acceptance Criteria:**

**Given** the user clicks "Révoquer" on an active or pending `AccessListRow`,
**When** the click fires,
**Then** a shadcn/ui `AlertDialog` opens with: title "Révoquer l'accès ?", description "arc@capital.fr ne pourra plus consulter ce dossier. Cette action est immédiate.", a destructive confirm button "Oui, révoquer", and a cancel button "Annuler".

**Given** the `AlertDialog` is open and the user clicks "Annuler" or presses Escape,
**When** the dismissal fires,
**Then** the dialog closes and the `AccessListRow` state is unchanged.

**Given** the `AlertDialog` is open and the user clicks "Oui, révoquer",
**When** the confirmation fires,
**Then**: (1) the dialog closes immediately, (2) the `AccessListRow` for that recipient transitions to `status="revoked"` (55% opacity, StatusDot gray, no Révoquer button, "Révoqué le [today's date]"), (3) the "Destinataires actifs" MetricCard value decrements by 1 in local state.

**Given** the revocation is applied in local state,
**When** the user refreshes the page,
**Then** the revoked state is not persisted (mocked — no localStorage needed for revocation state; re-mock on load is acceptable).

**Given** the `AlertDialog`,
**When** a user navigates with keyboard,
**Then** focus is trapped inside the dialog (Radix default), Tab cycles between the two buttons, and Escape closes without revoking.

---

## Epic 4: Financeur — Shared Dossier View (Frontend)

A financeur opens a shared link URL, sees a minimal email verification screen (mocked — no real magic link sent), and views the complete structured dossier in both mobile and desktop layouts. Includes the access denied page for revoked or invalid links.

### Story 4.1: Email Verification Screen (UI Only, Mocked)

As a financeur receiving a shared dossier link,
I want to see a clean, reassuring entry screen when I open the link,
So that I understand what to do to access the dossier.

**Acceptance Criteria:**

**Given** the user navigates to `/share/:token` with any token value,
**When** the page renders,
**Then** the following elements are displayed centered on an `#FAFAF9` background:
- The Confluent logo at the top (SVG, centered)
- An H1 or large heading "Accéder au dossier"
- A supporting description "Entrez votre adresse email pour recevoir votre lien d'accès."
- A full-width email input with `type="email"` and `placeholder="votre@email.fr"`
- A primary button "Recevoir mon lien de connexion" (full width)
- A sub-label below the button: "Pas de mot de passe — vérifiez votre boîte mail" in 12px secondary text

**Given** this is a mocked frontend-only epic,
**When** the user enters any email and clicks the button,
**Then** after a 1-second simulated delay (to mimic email send), the page transitions to the dossier view at `/share/:token/dossier` — no real email is sent.

**Given** the email input is submitted empty,
**When** validation runs,
**Then** an inline error "L'adresse email est requise." appears and navigation does not proceed.

**Given** the verification screen,
**When** a developer inspects the layout,
**Then** there is no sidebar, no top navigation bar, and no footer — the screen is a standalone centered layout, matching UX-DR9.

**Given** the verification screen,
**When** viewed on mobile (<768px),
**Then** the layout remains centered and single-column, the button is full-width, and no element overflows the viewport.

---

### Story 4.2: Financeur Dossier View — Mobile Layout

As a financeur on a mobile device,
I want to read the shared dossier comfortably on my phone,
So that I can review the entrepreneur's project anywhere without needing a desktop.

**Acceptance Criteria:**

**Given** the user is on `/share/:token/dossier` on a mobile device (<768px),
**When** the page renders,
**Then** a single-column layout is shown with:
- The dossier name as an H1 at the top
- An anchor navigation bar (horizontal scroll) listing section names as links: "Présentation", "Produit & Marché", "Finances & Équipe"
- Each section rendered below with an H2 section heading followed by `DossierField` components for each answer

**Given** the anchor navigation bar,
**When** a user taps a section link (e.g. "Finances & Équipe"),
**Then** the page scrolls smoothly to that section's H2 heading.

**Given** the `DossierField` components in the dossier view,
**When** a developer inspects the DOM,
**Then** each field uses `<dl>/<dt>/<dd>` semantic structure, with `<dt>` rendering the question label in 11px small caps `#6B6B6B` and `<dd>` rendering the answer in 13px font-weight 500 `#1A1A1A`.

**Given** the dossier view includes classification information,
**When** the page renders,
**Then** sector and maturity stage are displayed as Badge components (shadcn/ui `Badge` variant="secondary") near the dossier title, e.g. "Biotech" and "Seed".

**Given** the dossier view on mobile,
**When** the user interacts with any element,
**Then** all interactive elements (anchor links, any future buttons) have a minimum touch target of 44×44px.

**Given** this is a mocked view,
**When** a developer inspects the data source,
**Then** dossier content is imported from a static fixture file (`src/data/mock-dossier.ts`) containing hardcoded answers for "Biosensio" — not from localStorage or React state passed from the questionnaire flow.

---

### Story 4.3: Financeur Dossier View — Desktop Layout

As a financeur on a desktop browser,
I want a two-column dossier layout with sticky section navigation,
So that I can quickly jump between sections and read content without losing context.

**Acceptance Criteria:**

**Given** the user is on `/share/:token/dossier` on a desktop (≥1024px),
**When** the page renders,
**Then** a two-column layout is displayed: a left column (~240px, sticky) containing section navigation links, and a right column (remaining width) containing the dossier content.

**Given** the sticky left navigation,
**When** the user scrolls down through the dossier content,
**Then** the left navigation column remains fixed in the viewport and does not scroll away.

**Given** the left navigation column,
**When** the user scrolls to a section (e.g. "Produit & Marché" is in the viewport),
**Then** the corresponding nav link is visually highlighted (darker text, `font-weight: 500`) using an Intersection Observer.

**Given** the right content column,
**When** a developer inspects the layout,
**Then** section H2 headings, `DossierField` groups, and Classification badges are arranged vertically with clear visual separation between sections (e.g. a `Separator` or spacing of ≥32px).

**Given** the same page is resized from desktop to mobile width,
**When** the viewport drops below 768px,
**Then** the two-column layout switches to the single-column mobile layout (Story 4.2) with the anchor nav bar — no layout breakage occurs.

**Given** the dossier page on desktop,
**When** a developer inspects the page,
**Then** there is no sidebar (entrepreneur navigation is absent), only a minimal top bar with the Confluent logo and the dossier name.

---

### Story 4.4: Access Denied Page

As a financeur with an invalid or revoked link,
I want a clear, respectful error page,
So that I understand the link doesn't work without learning anything about the dossier or other recipients.

**Acceptance Criteria:**

**Given** the user navigates to `/share/revoked-token` or `/share/unknown-token`,
**When** the mocked token guard runs (checking a hardcoded list of valid tokens),
**Then** instead of the email verification screen, an access denied page renders.

**Given** the access denied page renders,
**When** a developer inspects its content,
**Then** it displays: a monochrome lock or warning inline SVG, an H1 "Accès refusé", a secondary description "Ce lien est invalide ou a été révoqué. Si vous pensez qu'il s'agit d'une erreur, contactez la personne qui vous a partagé ce lien.", and a ghost/outline button "Retour à l'accueil" linking to `/`.

**Given** the access denied page,
**When** a developer audits its content,
**Then** no information about the dossier name, entrepreneur identity, or other recipients is disclosed — the page is intentionally opaque.

**Given** the access denied page,
**When** the page title (`<title>`) is inspected,
**Then** it reads "Accès refusé — Confluent" and the HTTP-equivalent status (for future SSR use) would be 403/404 — the route does not redirect to a login page.

**Given** the mocked token guard,
**When** a developer inspects `src/data/mock-tokens.ts`,
**Then** it exports a list of valid token strings (e.g. `["valid-token-1", "biosensio-share"]`) — any token not in this list triggers the access denied page.

---

## Epic 5: Admin — Back-office (Frontend)

An administrator can view the regional pipeline overview with platform-level stats, browse all dossiers, inspect the questionnaire structure, and manage users — all with mocked data and local state. The admin role is hardcoded for development; real API wiring comes in Epic 9.

### Story 5.1: Admin Layout & Pipeline Dashboard

As an administrator,
I want a dedicated back-office layout with a pipeline overview dashboard,
So that I can assess the overall health of the platform at a glance.

**Acceptance Criteria:**

**Given** a user with `role: 'admin'` navigates to `/admin`,
**When** the page renders,
**Then** a distinct admin layout is shown with a left sidebar containing navigation links: "Pipeline", "Dossiers", "Questionnaire", "Utilisateurs", and the admin user identity at the bottom.

**Given** the admin sidebar,
**When** compared to the entrepreneur sidebar,
**Then** the admin sidebar uses the same Notion-inspired palette and layout structure, but its navigation links are distinct (no "Mes dossiers" link appears).

**Given** the `/admin` pipeline dashboard,
**When** it renders,
**Then** the following mocked stats are displayed using `MetricCard` components:
- "Dossiers total" with value "12"
- "Actifs ce mois" with value "5"
- "Secteurs représentés" with value "4"

**Given** the pipeline dashboard below the MetricCard grid,
**When** it renders,
**Then** a breakdown table or card list shows sector distribution: e.g. "Biotech — 4 dossiers", "Agri-tech — 3 dossiers", "Fintech — 3 dossiers", "Autre — 2 dossiers".

**Given** a hardcoded user with `role: 'entrepreneur'` navigates to `/admin`,
**When** the route guard checks the role,
**Then** the user is redirected to `/dashboard` — the admin section is not accessible to non-admin roles.

**Given** the admin dashboard,
**When** the breadcrumb renders,
**Then** it shows only "Admin" (single segment — top-level view, no breadcrumb trail needed per UX-DR15).

---

### Story 5.2: Admin — All Dossiers List

As an administrator,
I want to browse all dossiers on the platform,
So that I can monitor activity and access any dossier for review.

**Acceptance Criteria:**

**Given** the admin navigates to `/admin/dossiers`,
**When** the page renders,
**Then** a table or card list displays all mocked dossiers (minimum 5 entries) with columns: dossier name, entrepreneur email, sector, maturity stage, creation date, number of active share links.

**Given** the dossier list,
**When** the admin clicks on a dossier row,
**Then** the router navigates to `/admin/dossiers/:slug` and displays the dossier content in read-only mode using the same `DossierField` components as the entrepreneur view.

**Given** the admin dossier read view,
**When** it renders,
**Then** the breadcrumb reads `Admin / Dossiers / Biosensio` and an info banner is shown: "Vous consultez ce dossier en tant qu'administrateur." — distinguishing it from the entrepreneur's own view.

**Given** the dossier list page,
**When** a developer inspects the data source,
**Then** data is imported from `src/data/mock-admin-dossiers.ts` containing at least 5 hardcoded dossier entries with varied sectors and stages.

**Given** the dossier list on mobile (<768px),
**When** the table renders,
**Then** it switches to a card-based list layout (no horizontal scroll tables on mobile) showing name, entrepreneur, and sector on each card.

---

### Story 5.3: Questionnaire Builder (UI, Mocked)

As an administrator,
I want to see the questionnaire structure and understand how it can be configured,
So that I can prepare for the real configuration workflow that comes with the API.

**Acceptance Criteria:**

**Given** the admin navigates to `/admin/questionnaire`,
**When** the page renders,
**Then** the questionnaire structure is displayed as a list of sections, each expandable to show its fields. The mocked structure mirrors the 3-section hardcoded questionnaire from Story 2.4.

**Given** a section in the questionnaire builder,
**When** it is expanded,
**Then** each field is shown with: its label, its type (text, number, select), and a required/optional badge.

**Given** any "Modifier" button on a field or section,
**When** the admin clicks it,
**Then** a shadcn/ui toast appears: "Disponible prochainement — la configuration sera activée avec l'API dans une prochaine version." and no state change occurs.

**Given** the questionnaire builder page,
**When** the breadcrumb renders,
**Then** it shows `Admin / Questionnaire` (two segments — "Admin" links to `/admin`).

**Given** the questionnaire builder layout,
**When** viewed on mobile (<768px),
**Then** sections and fields stack vertically in a readable single-column layout with no horizontal overflow.

---

### Story 5.4: User Management (UI, Mocked)

As an administrator,
I want to invite new users and manage existing accounts,
So that I can control who has access to the platform.

**Acceptance Criteria:**

**Given** the admin navigates to `/admin/utilisateurs`,
**When** the page renders,
**Then** a list of mocked users is displayed with columns: email, role (Entrepreneur / Financeur / Admin badge), status (Actif / Inactif `StatusDot`), and a "Désactiver" action button for active users.

**Given** the mocked user list,
**When** a developer inspects the data,
**Then** it contains at least 4 entries with mixed roles and statuses, sourced from `src/data/mock-users.ts`.

**Given** the "Inviter un utilisateur" button in the page header,
**When** the admin clicks it,
**Then** a shadcn/ui `Dialog` opens with: an email input ("Adresse email"), a role selector (radio group or Select: "Entrepreneur" / "Financeur"), a primary button "Envoyer l'invitation", and a secondary button "Annuler".

**Given** the invitation dialog is submitted with a valid email and role,
**When** "Envoyer l'invitation" is clicked,
**Then** the dialog closes, a toast "Invitation envoyée à [email]" appears, and a new user row is prepended to the list in local state with status "Inactif" (invitation pending).

**Given** the "Désactiver" button on an active user row,
**When** clicked,
**Then** an `AlertDialog` opens: "Désactiver ce compte ?", description with the user's email, "Oui, désactiver" (destructive) and "Annuler" buttons.

**Given** the admin confirms deactivation,
**When** "Oui, désactiver" is clicked,
**Then** the dialog closes, a toast "Compte désactivé." appears, and the user row's StatusDot transitions to "Inactif" in local state — no "Désactiver" button is shown for inactive users.

**Given** the user management page,
**When** the breadcrumb renders,
**Then** it shows `Admin / Utilisateurs` (two segments).

---

## Epic 6: Auth & API Infrastructure

The real backend comes online: NestJS scaffold with Prisma schema, magic link authentication for all roles, JWT + custom link guard, rate limiting, Docker Compose local dev environment, and environment configuration with fail-fast validation. The frontend replaces mocked auth with real magic link flows.

### Story 6.1: NestJS Scaffold & Prisma Schema

As a developer,
I want a fully configured NestJS API with Prisma connected to PostgreSQL,
So that all subsequent API epics have a working, typed database layer from the start.

**Acceptance Criteria:**

**Given** `apps/api` is installed and `pnpm dev` is run from the monorepo root,
**When** Docker Compose services are running (`postgres`, `minio`, `mailhog`),
**Then** the NestJS server starts on port 3000 with no startup errors and logs "Application is running on: http://localhost:3000".

**Given** `apps/api/.env` is missing a required variable (e.g. `DATABASE_URL`),
**When** the server starts,
**Then** it throws a descriptive startup error identifying the missing variable and exits immediately (fail-fast via `@nestjs/config` + Zod validation).

**Given** the Prisma schema at `apps/api/prisma/schema.prisma`,
**When** a developer inspects it,
**Then** it defines the following tables with correct relations:
- `users` (id, email, role, is_active, created_at, updated_at)
- `magic_link_tokens` (id, user_id FK, token, expires_at, consumed_at)
- `dossiers` (id, user_id FK, name, slug, questionnaire_version_id FK, created_at, updated_at)
- `share_links` (id, dossier_id FK, recipient_email, token, status, created_at, revoked_at)
- `audit_log` (id, dossier_id FK, actor_id FK, action_type, metadata JSONB, created_at) — no updated_at, append-only
- `questionnaire_versions` (id, version, created_at)
- `questionnaire_fields` (id, version_id FK, section, label, field_type, required, order_index)
- `dossier_answers` (id, dossier_id FK, field_id FK, value, created_at, updated_at)

**Given** `pnpm prisma migrate dev` is run,
**When** it completes,
**Then** all tables are created in the PostgreSQL database with correct column types and foreign key constraints, with zero migration errors.

**Given** the `packages/shared` package,
**When** a developer inspects its exports,
**Then** it exports Zod schemas and TypeScript types for all major entities (User, Dossier, ShareLink, AuditLog entry) — the same schemas usable on both frontend and backend.

**Given** `docker-compose.yml` at the repository root,
**When** `docker compose up -d` is run,
**Then** three services start: `postgres:16-alpine` on port 5432, `minio/minio` on ports 9000/9001, and `mailhog` on ports 1025 (SMTP) / 8025 (web UI) — all with named volumes for data persistence.

---

### Story 6.2: Magic Link — Generation & Email Send

As a user (entrepreneur or financeur),
I want to request a magic link to my email address,
So that I can log in without a password.

**Acceptance Criteria:**

**Given** a `POST /v1/auth/magic-link` request with body `{ "email": "sophie@biosensio.fr" }`,
**When** the endpoint processes the request,
**Then** it responds with `200 OK` and body `{ "message": "Magic link sent." }` regardless of whether the email exists in the database (prevents email enumeration).

**Given** the magic link request is processed,
**When** the user exists in the database,
**Then** a new `magic_link_tokens` record is created with: a token generated by `crypto.randomUUID()`, `expires_at` set to 15 minutes from now, and `consumed_at: null`.

**Given** the magic link token is created,
**When** the email service sends the message,
**Then** an email is dispatched to the user's address via the configured SMTP adapter containing a link in the format `{FRONTEND_URL}/auth/verify?token={uuid}`.

**Given** the email service in development,
**When** the email is sent,
**Then** it is captured by Mailhog (visible at `http://localhost:8025`) — no real email is sent in dev.

**Given** the SMTP adapter,
**When** a developer inspects `apps/api/src/email/email.service.ts`,
**Then** the service depends on an interface (not a concrete implementation), and the SMTP provider is injected via `@nestjs/config` — swapping providers requires only an environment variable change, not code changes.

**Given** a `POST /v1/auth/magic-link` request with an invalid email format,
**When** Zod validation runs,
**Then** the endpoint returns `400 Bad Request` with a descriptive validation error message.

---

### Story 6.3: Magic Link — Verification & JWT Issuance

As a user clicking a magic link in their email,
I want to be authenticated and redirected to the correct page,
So that I can access the platform without entering a password.

**Acceptance Criteria:**

**Given** a `GET /v1/auth/verify?token={valid-uuid}` request where the token exists, is not consumed, and is not expired,
**When** the endpoint processes it,
**Then** it responds with `200 OK`, marks the token as consumed (`consumed_at = now()`), and returns a JWT access token in the response body plus sets an `httpOnly`, `Secure`, `SameSite=Strict` refresh token cookie (7-day expiry).

**Given** a `GET /v1/auth/verify?token={expired-token}` request,
**When** processed,
**Then** the endpoint returns `401 Unauthorized` with body `{ "error": "Token expired or invalid." }`.

**Given** a `GET /v1/auth/verify?token={already-consumed-token}` request,
**When** processed,
**Then** the endpoint returns `401 Unauthorized` with the same generic error (tokens are single-use).

**Given** a JWT access token is issued,
**When** a developer inspects its payload,
**Then** it contains: `sub` (user id), `email`, `role`, and `exp` set to 15 minutes from issuance.

**Given** a protected API route decorated with the JWT Passport Guard,
**When** a request is made without a valid Authorization header,
**Then** the endpoint returns `401 Unauthorized`.

**Given** a `POST /v1/auth/refresh` request with a valid refresh cookie,
**When** processed,
**Then** a new JWT access token is issued and the refresh cookie is rotated with a new 7-day expiry.

---

### Story 6.4: Financeur Share Token Guard

As a financeur accessing a shared dossier link,
I want my link token to be validated on every request,
So that revoked access takes effect immediately without requiring a login session.

**Acceptance Criteria:**

**Given** a custom NestJS Guard applied to all `/v1/shares/:token/*` routes,
**When** a request arrives with a valid, non-revoked `share_links.token` in the URL,
**Then** the guard allows the request through and attaches the resolved `ShareLink` record to `request.shareLink`.

**Given** the guard processes a request with an unknown token,
**When** the database lookup finds no matching record,
**Then** the guard returns `403 Forbidden` with body `{ "error": "Access denied." }` — no information about the dossier is disclosed.

**Given** the guard processes a request with a revoked token (`status = 'revoked'`),
**When** the database lookup runs,
**Then** the guard returns `403 Forbidden` with the same generic error — revocation takes effect on the next request (≤5 seconds per NFR4, since no caching is applied to this lookup).

**Given** the guard is applied,
**When** a developer inspects the route handler,
**Then** the route handler can access `request.shareLink.dossier_id` and `request.shareLink.recipient_email` to scope the response correctly.

**Given** a request to a share route with a token that passes the guard,
**When** the access occurs,
**Then** a view event is recorded in the `audit_log` table with `action_type: 'share_link_viewed'`, the `share_link_id`, and the current timestamp.

---

### Story 6.5: Rate Limiting & Security Hardening

As the platform operator,
I want rate limiting and security headers applied to the API,
So that brute-force enumeration and common web vulnerabilities are mitigated.

**Acceptance Criteria:**

**Given** `@nestjs/throttler` is configured,
**When** more than 10 requests to `/v1/auth/verify` or any `/v1/shares/:token/*` route arrive from the same IP within 60 seconds,
**Then** subsequent requests return `429 Too Many Requests` until the window resets.

**Given** a `429` response is returned,
**When** a developer inspects the failed attempt,
**Then** an entry is written to `audit_log` with `action_type: 'rate_limit_exceeded'`, the IP address (from `X-Forwarded-For` header, sanitized), and the timestamp.

**Given** Helmet middleware is applied,
**When** any API response is inspected,
**Then** security headers are present: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Strict-Transport-Security` (in production), and `Content-Security-Policy`.

**Given** CORS is configured,
**When** a request arrives from an origin other than the configured `FRONTEND_URL` env variable,
**Then** the response does not include `Access-Control-Allow-Origin` for that origin — the request is blocked at the CORS layer.

**Given** a failed share link access attempt (invalid or revoked token),
**When** the guard rejects it,
**Then** an entry is written to `audit_log` with `action_type: 'share_link_access_denied'`, the attempted token (hashed, not raw), the IP address, and the timestamp.

---

### Story 6.6: Frontend — Magic Link Auth Wiring

As a user on the frontend,
I want the magic link flow to work end-to-end,
So that I can actually log in and access my real account data.

**Acceptance Criteria:**

**Given** the user is on the email verification screen (Story 4.1),
**When** they submit a valid email,
**Then** the frontend calls `POST /v1/auth/magic-link` via TanStack Query mutation and replaces the form with a confirmation screen: "Vérifiez votre boîte mail. Un lien de connexion vous a été envoyé." (no countdown, no resend button in v1).

**Given** the user clicks the magic link in their email,
**When** the browser opens `/auth/verify?token={uuid}`,
**Then** the frontend calls `GET /v1/auth/verify?token={uuid}`, stores the returned JWT in memory (not localStorage), and redirects based on role: `entrepreneur` → `/dashboard`, `admin` → `/admin`.

**Given** a financeur's magic link is verified,
**When** the redirect occurs,
**Then** the financeur is redirected to `/share/{share_token}/dossier` — the share token is stored in the URL, not in auth state.

**Given** the JWT access token expires (15 minutes),
**When** a protected API call fails with `401`,
**Then** the frontend automatically calls `POST /v1/auth/refresh` using the httpOnly cookie, receives a new access token, and retries the original request — the user does not see a logout or error.

**Given** the frontend `useCurrentUser()` hook,
**When** the user is authenticated via real JWT,
**Then** it returns the authenticated user's data from the JWT payload instead of the hardcoded Sophie Moreau object — the hook signature remains unchanged so no call sites need to be updated.

**Given** the user navigates to `/dashboard` without a valid JWT,
**When** the route guard checks auth state,
**Then** the user is redirected to `/auth` — the hardcoded user bypass from Epic 1 is removed.

---

## Epic 7: API — Dossiers & Questionnaire

The questionnaire saves to the database, dossiers persist across sessions, document upload works with S3-compatible storage, auto-save is real, and dossier classification is computed from answers. The frontend replaces localStorage and fixture mocks with real TanStack Query calls.

### Story 7.1: Dossiers API — CRUD Endpoints

As an entrepreneur,
I want my dossiers to be created and persisted in the database,
So that my work is saved and accessible across sessions and devices.

**Acceptance Criteria:**

**Given** an authenticated entrepreneur sends `POST /v1/dossiers` with body `{ "name": "Biosensio" }`,
**When** the endpoint processes it,
**Then** it creates a dossier record owned by the authenticated user, generates a URL-safe slug from the name (e.g. `biosensio`), and returns `201 Created` with the full dossier object including `id`, `name`, `slug`, `created_at`.

**Given** an authenticated entrepreneur sends `GET /v1/dossiers`,
**When** the endpoint processes it,
**Then** it returns only the dossiers owned by the authenticated user — never dossiers belonging to other users.

**Given** an authenticated entrepreneur sends `GET /v1/dossiers/:id` for a dossier they own,
**When** processed,
**Then** the full dossier object is returned with `200 OK`.

**Given** an authenticated user sends `GET /v1/dossiers/:id` for a dossier owned by another user,
**When** processed,
**Then** the endpoint returns `404 Not Found` — the existence of the dossier is not disclosed.

**Given** an authenticated entrepreneur sends `PATCH /v1/dossiers/:id` with `{ "name": "Biosensio v2" }`,
**When** processed,
**Then** the dossier name and slug are updated and the response returns the updated dossier.

**Given** an authenticated entrepreneur sends `DELETE /v1/dossiers/:id`,
**When** processed,
**Then** the dossier and all associated answers, share links, and documents are soft-deleted (or hard-deleted — decision deferred to implementation), and `204 No Content` is returned.

**Given** all dossier endpoints,
**When** a request arrives without a valid JWT,
**Then** the JWT Guard returns `401 Unauthorized` before the handler executes.

**Given** all Dossier DTOs,
**When** a developer inspects `packages/shared/src/schemas/dossier.ts`,
**Then** Zod schemas are defined and exported for CreateDossierDto, UpdateDossierDto, and DossierResponse — the same schemas imported in both `apps/api` and `apps/web`.

---

### Story 7.2: Questionnaire Answers API & Real Auto-Save

As an entrepreneur filling out the questionnaire,
I want my answers saved automatically as I type,
So that I never lose progress if my browser crashes or I navigate away.

**Acceptance Criteria:**

**Given** an authenticated entrepreneur sends `PUT /v1/dossiers/:id/answers` with body `[{ "field_id": "uuid", "value": "Biosensio" }, ...]`,
**When** processed,
**Then** the endpoint upserts all provided answers (insert on first save, update on subsequent saves) and returns `200 OK` with the saved answers — the operation is idempotent.

**Given** an entrepreneur sends `GET /v1/dossiers/:id/answers`,
**When** processed,
**Then** all saved answers for that dossier are returned as an array of `{ field_id, value, updated_at }` objects.

**Given** the frontend QuestionnaireStep component (Story 2.4),
**When** the user has been idle for 500ms after typing an answer,
**Then** a TanStack Query mutation calls `PUT /v1/dossiers/:id/answers` with the current answers batch — no visible spinner is shown for auto-save (silent background save).

**Given** the auto-save mutation is in-flight,
**When** a developer inspects the UI,
**Then** a subtle "Enregistrement…" text indicator appears in the questionnaire footer (12px, secondary color) during the mutation and disappears after success — no disruptive loading state.

**Given** the auto-save mutation fails (network error),
**When** the error occurs,
**Then** the "Enregistrement…" indicator changes to "Erreur d'enregistrement — réessai dans 5s" and the mutation retries automatically — no data is lost from local state.

**Given** an entrepreneur reopens a dossier questionnaire after closing the browser,
**When** the questionnaire route loads,
**Then** it calls `GET /v1/dossiers/:id/answers`, restores all saved answers into form state, and positions the progress bar at the last answered question — the `localStorage` fallback from Epic 2 is replaced.

---

### Story 7.3: Questionnaire Schema Versioning (FR14)

As the platform operator,
I want completed dossiers to retain their questionnaire structure snapshot,
So that updating the questionnaire for future dossiers does not corrupt existing ones.

**Acceptance Criteria:**

**Given** an entrepreneur submits their questionnaire (clicks "Valider cette section →" on the final section),
**When** the submission is processed,
**Then** the dossier's `questionnaire_version_id` is set to the currently active `questionnaire_versions.id` — this snapshot is immutable after submission.

**Given** an admin later updates the questionnaire structure (adds or removes fields) in a subsequent epic,
**When** the change creates a new `questionnaire_versions` record,
**Then** the previously submitted dossier's `questionnaire_version_id` remains unchanged — it still points to the version that was active at submission time.

**Given** a request to `GET /v1/dossiers/:id` for a submitted dossier,
**When** the response is built,
**Then** it includes the questionnaire version metadata alongside the answers so the frontend can render the correct field labels for that version.

**Given** the `questionnaire_versions` and `questionnaire_fields` tables,
**When** the initial Prisma migration runs (Story 6.1),
**Then** a seed script populates version `1` with the 3-section / 12-field hardcoded structure from Story 2.4 — this is the baseline version for all Epic 7 dossiers.

---

### Story 7.4: Document Upload (FR4, FR5)

As an entrepreneur,
I want to upload supporting documents to my dossier,
So that I can provide investors with detailed files alongside my structured answers.

**Acceptance Criteria:**

**Given** an authenticated entrepreneur sends `POST /v1/dossiers/:id/documents` with a `multipart/form-data` body containing a file,
**When** processed,
**Then** the file is uploaded to the configured S3-compatible storage (MinIO in dev), and the endpoint returns `201 Created` with `{ "document_id", "filename", "version": 1, "url": "signed-url", "uploaded_at" }`.

**Given** the S3 storage adapter,
**When** a developer inspects `apps/api/src/storage/storage.service.ts`,
**Then** the service depends on an interface with `upload(key, buffer, mimetype)` and `getSignedUrl(key)` methods — the MinIO implementation is injected via `@nestjs/config`, and swapping to any S3-compatible provider requires only environment variable changes.

**Given** an entrepreneur uploads a new version of an existing document (same filename or explicit `document_id`),
**When** processed,
**Then** a new storage object is created with `version: 2`, the previous version is retained (not deleted), and `GET /v1/dossiers/:id/documents` returns the full version history for each document.

**Given** `GET /v1/dossiers/:id/documents`,
**When** processed,
**Then** the response includes each document's current version and a `versions` array with all historical versions (version number, uploaded_at, signed URL).

**Given** the frontend dossier page,
**When** the user selects a file larger than 1 MB for upload,
**Then** a progress bar (using `XMLHttpRequest` upload progress events or equivalent) displays real-time upload percentage — the UI does not appear frozen during upload (satisfies NFR3).

**Given** a file upload request,
**When** the file exceeds 20 MB,
**Then** the endpoint returns `413 Payload Too Large` before attempting storage.

---

### Story 7.5: Automatic Dossier Classification (FR8)

As a platform operator,
I want dossiers to be automatically classified by sector and maturity stage,
So that the admin pipeline view can filter and group dossiers without manual tagging.

**Acceptance Criteria:**

**Given** an entrepreneur submits their questionnaire (final section validated),
**When** the submission endpoint processes the answers,
**Then** a classification service runs synchronously and sets `dossier.sector` and `dossier.maturity_stage` based on the answer values.

**Given** the classification service v1,
**When** a developer inspects `apps/api/src/classification/classification.service.ts`,
**Then** it uses a deterministic mapping: the "secteur d'activité" answer (Section 1, Question 2) maps directly to `sector`, and the "stade de maturité" answer (Section 1, Question 3) maps directly to `maturity_stage` — no ML or fuzzy matching in v1.

**Given** the classification result,
**When** `GET /v1/dossiers/:id` is called after submission,
**Then** the response includes `sector: "Biotech"` and `maturity_stage: "Seed"` (or equivalent values based on the entrepreneur's answers).

**Given** the frontend dossier view (Story 2.6 / Story 4.2),
**When** it renders after API wiring,
**Then** `DossierField` classification values are replaced with real `sector` and `maturity_stage` from the API response — the Badge components display live data.

---

### Story 7.6: Frontend — Replace Mocks with Dossier API

As a developer,
I want the frontend to use real API data for dossiers and questionnaire,
So that entrepreneurs interact with persistent data instead of ephemeral local state.

**Acceptance Criteria:**

**Given** the entrepreneur dashboard (Story 3.1),
**When** the component mounts,
**Then** it calls `GET /v1/dossiers` via a TanStack Query `useQuery` hook and renders the real list of dossiers — the `mock-admin-dossiers.ts` fixture is no longer the data source.

**Given** the dossier questionnaire (Story 2.4),
**When** the flow starts after naming the dossier,
**Then** the frontend first calls `POST /v1/dossiers` to create the dossier in the database and stores the returned `id` — all subsequent answer saves use this real `id`.

**Given** the TanStack Query hooks,
**When** a developer inspects `apps/web/src/hooks/useDossiers.ts`,
**Then** the hook signatures are unchanged from the mocked versions — components that consumed the mocks do not need their JSX modified, only the data layer under the hook changes.

**Given** a loading state while `GET /v1/dossiers` is in-flight,
**When** the dashboard renders,
**Then** skeleton placeholder cards (shadcn/ui `Skeleton` component) are shown in place of dossier cards — no blank screen or layout shift.

**Given** the API returns an error (network failure or 5xx),
**When** the query fails after 3 retries (TanStack Query default),
**Then** an inline error state is shown on the dashboard with a "Réessayer" button that triggers a manual refetch.

---

## Epic 8: API — Sharing, Analytics & Audit

Share links are generated with real CSPRNG tokens, email invitations are sent via the SMTP adapter, access is tracked per session, analytics data is real, revocation is immediate, and the audit log is append-only. The frontend replaces all mocked access management data with live API calls.

### Story 8.1: Share Link Generation & Email Invitation (FR16, FR40)

As an entrepreneur,
I want to generate a unique access link for a named recipient,
So that I can share my dossier with a specific investor without creating a platform account for them.

**Acceptance Criteria:**

**Given** an authenticated entrepreneur sends `POST /v1/dossiers/:id/shares` with body `{ "recipient_email": "marc@fonds.fr" }`,
**When** processed,
**Then** the endpoint creates a `share_links` record with: a token generated by `crypto.randomUUID()` (128-bit entropy, satisfies NFR6), `status: 'pending'`, `recipient_email`, `dossier_id`, and `created_at`.

**Given** the share link is created,
**When** the email service is invoked,
**Then** an invitation email is sent to `recipient_email` containing: a personalised greeting, the dossier name, and a link in the format `{FRONTEND_URL}/share/{token}`.

**Given** the endpoint completes successfully,
**When** the response is returned,
**Then** it returns `201 Created` with `{ "share_link_id", "token", "recipient_email", "status": "pending", "share_url": "https://..." }`.

**Given** the same entrepreneur sends a second `POST /v1/dossiers/:id/shares` with a different `recipient_email`,
**When** processed,
**Then** a second independent `share_links` record is created — multiple links per dossier are supported (satisfies FR18).

**Given** the endpoint receives a request for a dossier not owned by the authenticated entrepreneur,
**When** the ownership check runs,
**Then** the endpoint returns `404 Not Found` — the share link is not created.

**Given** an invalid email format in the request body,
**When** Zod validation runs,
**Then** the endpoint returns `400 Bad Request` with a descriptive error before any database write occurs.

---

### Story 8.2: Share Link Listing & Revocation (FR19, FR20)

As an entrepreneur,
I want to see all share links for a dossier and revoke them individually,
So that I have full control over who can access my dossier at any moment.

**Acceptance Criteria:**

**Given** an authenticated entrepreneur sends `GET /v1/dossiers/:id/shares`,
**When** processed,
**Then** the endpoint returns all `share_links` for that dossier (active, pending, and revoked) ordered by `created_at` descending, with each entry including: `share_link_id`, `recipient_email`, `status`, `created_at`, `revoked_at` (null if not revoked).

**Given** an authenticated entrepreneur sends `DELETE /v1/dossiers/:id/shares/:linkId`,
**When** processed,
**Then** the `share_links` record is updated: `status → 'revoked'`, `revoked_at → now()`, and `200 OK` is returned with the updated record.

**Given** a revoked link is accessed via the financeur guard (Story 6.4),
**When** the guard checks the database,
**Then** the guard returns `403 Forbidden` — revocation takes effect on the next request with no caching delay (satisfies NFR4: ≤5 seconds).

**Given** a request to `DELETE /v1/dossiers/:id/shares/:linkId` for a link owned by a different dossier or entrepreneur,
**When** the ownership check runs,
**Then** the endpoint returns `404 Not Found`.

**Given** the frontend revocation flow (Story 3.6),
**When** the entrepreneur confirms revocation in the AlertDialog,
**Then** the frontend calls `DELETE /v1/dossiers/:id/shares/:linkId` via a TanStack Query mutation with an optimistic update — the row transitions to `status: 'revoked'` in the UI immediately, and rolls back if the API call fails.

---

### Story 8.3: Financeur Session Tracking & Analytics (FR23)

As an entrepreneur,
I want to see how each recipient is engaging with my dossier,
So that I can identify which investors are genuinely interested.

**Acceptance Criteria:**

**Given** a financeur accesses a dossier via a valid share link,
**When** the share token guard (Story 6.4) allows the request,
**Then** a `share_link_viewed` event is appended to `audit_log` with: `dossier_id`, `share_link_id`, `action_type: 'share_link_viewed'`, and `created_at`.

**Given** an authenticated entrepreneur sends `GET /v1/dossiers/:id/analytics`,
**When** processed,
**Then** the endpoint returns aggregated metrics:
- `active_recipients`: count of share links with `status: 'active'`
- `total_views`: total count of `share_link_viewed` events across all links for this dossier
- `avg_session_duration_seconds`: average duration computed from consecutive view events per session window (30-minute inactivity threshold defines session boundary)
- `per_recipient`: array of per-link analytics `{ share_link_id, recipient_email, status, view_count, last_viewed_at, avg_duration_seconds }`

**Given** a share link that has never been accessed,
**When** its analytics are returned,
**Then** `view_count: 0`, `last_viewed_at: null`, and `avg_duration_seconds: null` — no zero-division errors.

**Given** the frontend analytics tab (Story 3.3),
**When** it mounts after API wiring,
**Then** the three `MetricCard` values and all `AccessListRow` session details are populated from `GET /v1/dossiers/:id/analytics` — fixture data from `mock-dossier.ts` is no longer used.

---

### Story 8.4: Audit Log — Admin Actions & Access History (FR24, FR26)

As an entrepreneur,
I want a chronological log of all administrator actions on my dossier,
So that I have full visibility into who has accessed or modified my data.

**Acceptance Criteria:**

**Given** an authenticated entrepreneur sends `GET /v1/dossiers/:id/audit-log`,
**When** processed,
**Then** the endpoint returns all `audit_log` entries for that dossier ordered by `created_at` descending, including: `action_type`, `actor_id` (admin user id or null for system), `metadata` (JSON), and `created_at`.

**Given** the `audit_log` table,
**When** a developer inspects the Prisma schema and NestJS service layer,
**Then** there are no `UPDATE` or `DELETE` operations defined on `audit_log` — all writes are `INSERT` only (satisfies NFR9 append-only constraint).

**Given** an admin performs an action on a dossier (e.g. edits content — Epic 9),
**When** the action completes,
**Then** an `audit_log` entry is created with the admin's `actor_id` and a human-readable `action_type` (e.g. `'admin_edited_field'`, `'admin_uploaded_document'`).

**Given** an authenticated admin sends `GET /v1/admin/dossiers/:id/audit-log`,
**When** processed,
**Then** the full audit log is returned including both entrepreneur-visible entries and admin-only metadata — admins see more detail than entrepreneurs (satisfies FR26).

**Given** all failed share link access attempts (Story 6.5),
**When** a developer queries `audit_log` filtered by `action_type: 'share_link_access_denied'`,
**Then** all failed attempts are listed with IP address (hashed) and timestamp (satisfies FR42, NFR10).

---

### Story 8.5: Frontend — Wiring Sharing & Analytics

As a developer,
I want the sharing panel and analytics timeline to use real API data,
So that entrepreneurs see live sharing activity instead of fixture mocks.

**Acceptance Criteria:**

**Given** the share panel (Story 3.5) after API wiring,
**When** the entrepreneur submits a valid email,
**Then** the frontend calls `POST /v1/dossiers/:id/shares` and on success: closes the Sheet, shows a toast, and invalidates the `GET /v1/dossiers/:id/shares` TanStack Query cache — the access list refreshes automatically.

**Given** the analytics tab (Story 3.3) after API wiring,
**When** the tab activates,
**Then** `GET /v1/dossiers/:id/analytics` is called and the three `MetricCard` values display real aggregated data.

**Given** the `AccessListRow` list after API wiring,
**When** it renders,
**Then** rows are populated from `GET /v1/dossiers/:id/shares` joined with per-recipient analytics from `GET /v1/dossiers/:id/analytics` — no rows are hardcoded.

**Given** the revocation mutation (Story 3.6) after API wiring,
**When** the entrepreneur confirms revocation,
**Then** `DELETE /v1/dossiers/:id/shares/:linkId` is called with a TanStack Query optimistic update — the row changes to `status: 'revoked'` immediately in the UI, rolling back on API failure with a toast "Erreur — révocation non effectuée."

**Given** the financeur dossier view (Story 4.2 / 4.3) after API wiring,
**When** it loads via a valid share token,
**Then** dossier content is fetched from `GET /v1/shares/:token/dossier` (a share-token-guarded endpoint) — the static `mock-dossier.ts` fixture is no longer used.

---

## Epic 9: API — Administration

Admins can configure the questionnaire in the database, manage user accounts via real API, see actual platform pipeline data, and perform moderation actions on dossiers — all logged in the append-only audit trail. The admin frontend replaces all mocked data with live API calls.

### Story 9.1: Admin Dossier Access & Editing (FR9, FR10, FR35)

As an administrator,
I want to read and edit any dossier on the platform,
So that I can assist entrepreneurs and ensure content quality — with every action transparently logged.

**Acceptance Criteria:**

**Given** an authenticated admin sends `GET /v1/admin/dossiers`,
**When** processed,
**Then** the endpoint returns all dossiers on the platform (all entrepreneurs) with pagination (default 20 per page), including: `id`, `name`, `slug`, `sector`, `maturity_stage`, `owner_email`, `created_at`, `active_share_links_count`.

**Given** an authenticated admin sends `GET /v1/admin/dossiers/:id`,
**When** processed,
**Then** the full dossier is returned including all answers, all share links (with status), document list, and audit log summary — more detail than the entrepreneur's own `GET /v1/dossiers/:id`.

**Given** an authenticated admin sends `PATCH /v1/admin/dossiers/:id/answers` with modified answer values,
**When** processed,
**Then** the answers are updated AND an `audit_log` entry is appended with: `action_type: 'admin_edited_field'`, `actor_id` (admin's user id), `metadata: { field_id, old_value, new_value }`, and `created_at`.

**Given** an authenticated admin sends `POST /v1/admin/dossiers/:id/documents` with a file upload,
**When** processed,
**Then** the document is stored in S3 AND an `audit_log` entry is appended with `action_type: 'admin_uploaded_document'`, `actor_id`, and `metadata: { filename, version }`.

**Given** a non-admin JWT attempts to access any `/v1/admin/*` route,
**When** the admin role guard checks the token,
**Then** the request is rejected with `403 Forbidden` before the handler executes.

**Given** the frontend admin dossier list (Story 5.2) after API wiring,
**When** it mounts,
**Then** it calls `GET /v1/admin/dossiers` and renders real dossier data — the `mock-admin-dossiers.ts` fixture is no longer used.

---

### Story 9.2: Questionnaire Builder — Persistence (FR13, FR14, FR15)

As an administrator,
I want to configure the questionnaire structure and publish new versions,
So that the intake process can evolve without affecting dossiers already submitted.

**Acceptance Criteria:**

**Given** an authenticated admin sends `GET /v1/admin/questionnaire/versions`,
**When** processed,
**Then** all questionnaire versions are returned with their `id`, `version` number, `created_at`, and `is_active` flag.

**Given** an authenticated admin sends `POST /v1/admin/questionnaire/versions` with a new version payload (sections + fields),
**When** processed,
**Then** a new `questionnaire_versions` record is created and marked as active — the previous version's `is_active` is set to `false`.

**Given** a new questionnaire version is activated,
**When** an entrepreneur starts a new dossier,
**Then** their dossier is linked to the new active version — existing submitted dossiers remain linked to their original version (satisfies FR14).

**Given** an authenticated admin sends `PATCH /v1/admin/questionnaire/versions/:id/fields/:fieldId` to update a field label or type,
**When** processed,
**Then** the field is updated on the specified version only — other versions are unaffected.

**Given** the frontend questionnaire builder (Story 5.3) after API wiring,
**When** the admin clicks "Modifier" on a field,
**Then** instead of a "Disponible prochainement" toast, a real edit dialog opens — the change calls `PATCH /v1/admin/questionnaire/versions/:id/fields/:fieldId` and the updated label appears in the builder on success.

**Given** an admin updates the classification taxonomy (sectors, maturity stages),
**When** `PATCH /v1/admin/questionnaire/taxonomy` is called,
**Then** the allowed values for sector and maturity stage fields are updated — existing dossier classifications are not retroactively changed (satisfies FR15).

---

### Story 9.3: User Management — Persistence (FR32, FR33)

As an administrator,
I want to invite users and manage their accounts via the API,
So that platform access is controlled and auditable.

**Acceptance Criteria:**

**Given** an authenticated admin sends `POST /v1/admin/users/invite` with `{ "email": "new@entrepreneur.fr", "role": "entrepreneur" }`,
**When** processed,
**Then** a `users` record is created with `is_active: false`, and a magic link invitation email is sent to the provided address — the user activates their account on first login.

**Given** the invitation magic link is clicked by the new user,
**When** the auth verify endpoint (Story 6.3) processes it,
**Then** the user's `is_active` is set to `true` and a JWT is issued — the account is now fully active.

**Given** an authenticated admin sends `PATCH /v1/admin/users/:id/deactivate`,
**When** processed,
**Then** the user's `is_active` is set to `false`, all active JWT sessions for that user are invalidated (via a token blacklist or version counter), and `200 OK` is returned.

**Given** an authenticated admin sends `GET /v1/admin/users`,
**When** processed,
**Then** all users are returned (all roles) with: `id`, `email`, `role`, `is_active`, `created_at`, and `last_login_at`.

**Given** the frontend user management page (Story 5.4) after API wiring,
**When** the admin submits the invite dialog,
**Then** `POST /v1/admin/users/invite` is called, and on success the new user row appears in the list with `is_active: false` sourced from the real API response — mock state is no longer used.

**Given** a deactivated user attempts to call any protected API endpoint with an old JWT,
**When** the JWT guard runs,
**Then** the request is rejected with `401 Unauthorized` — deactivated users cannot use existing tokens.

---

### Story 9.4: Admin Analytics & Platform Pipeline (FR25, FR34)

As an administrator,
I want platform-wide analytics and pipeline statistics,
So that I can monitor the health of the regional startup ecosystem.

**Acceptance Criteria:**

**Given** an authenticated admin sends `GET /v1/admin/analytics`,
**When** processed,
**Then** the endpoint returns:
- `total_dossiers`: total count of all dossiers
- `active_this_month`: dossiers created or updated in the current calendar month
- `by_sector`: array of `{ sector, count }` ordered by count descending
- `by_maturity_stage`: array of `{ stage, count }` ordered by count descending
- `total_share_links`: total active share links across the platform
- `total_views_this_month`: total `share_link_viewed` audit events in the current month

**Given** the frontend admin pipeline dashboard (Story 5.1) after API wiring,
**When** it mounts,
**Then** `GET /v1/admin/analytics` is called and the three `MetricCard` values and sector breakdown table display real data — the hardcoded mock stats are removed.

**Given** the analytics endpoint,
**When** there are zero dossiers on the platform,
**Then** all counts return `0` and arrays return `[]` — no division-by-zero errors and no 500 responses.

**Given** the admin analytics endpoint,
**When** called by a non-admin JWT,
**Then** the role guard returns `403 Forbidden` before any database query executes.

---

### Story 9.5: Admin Share Link Revocation (FR22)

As an administrator,
I want to revoke any share link on any dossier,
So that I can enforce compliance or protect entrepreneurs if needed — with the action transparently logged.

**Acceptance Criteria:**

**Given** an authenticated admin sends `DELETE /v1/admin/dossiers/:dossierId/shares/:linkId`,
**When** processed,
**Then** the `share_links` record is updated: `status → 'revoked'`, `revoked_at → now()`, and an `audit_log` entry is appended with `action_type: 'admin_revoked_share_link'`, `actor_id` (admin's user id), and `metadata: { recipient_email, revoked_at }`.

**Given** the revocation is applied,
**When** the affected financeur attempts their next request via the share guard (Story 6.4),
**Then** the guard returns `403 Forbidden` — the revocation is effective immediately (satisfies NFR4).

**Given** the entrepreneur views their dossier audit log (`GET /v1/dossiers/:id/audit-log`),
**When** an admin has revoked a share link,
**Then** the `admin_revoked_share_link` entry is visible in the entrepreneur's log including the admin identity and timestamp — the entrepreneur is informed transparently (satisfies FR22, FR24).

**Given** a request to `DELETE /v1/admin/dossiers/:dossierId/shares/:linkId` where the link does not exist,
**When** processed,
**Then** the endpoint returns `404 Not Found` — no audit log entry is created for non-existent resources.

---

## Epic 10: Production & Deployment

The platform is deployable end-to-end: multi-stage Docker builds, GitHub Actions CI/CD pipeline, Nginx/Caddy reverse proxy with TLS, daily database backups with 30-day retention, and self-hosting documentation for non-developer operators.

### Story 10.1: Docker Multi-Stage Builds

As a developer,
I want optimized Docker images for the API and web frontend,
So that the platform can be deployed as lightweight, production-ready containers.

**Acceptance Criteria:**

**Given** `apps/api/Dockerfile`,
**When** `docker build` runs,
**Then** a two-stage build completes: stage 1 installs pnpm dependencies and compiles TypeScript; stage 2 produces a `node:22-alpine` image containing only the compiled output and production dependencies — no `node_modules/` devDependencies or TypeScript source in the final image.

**Given** `apps/web/Dockerfile`,
**When** `docker build` runs,
**Then** a two-stage build completes: stage 1 runs `pnpm turbo run build --filter=web` producing the Vite dist; stage 2 serves the static output via `nginx:alpine` — no Node.js runtime in the final web image.

**Given** both images are built,
**When** `docker images` is inspected,
**Then** the API image is under 250 MB and the web image is under 50 MB.

**Given** `docker-compose.prod.yml` at the repository root,
**When** `docker compose -f docker-compose.prod.yml up -d` is run with all required environment variables set,
**Then** the API container starts on port 3000 and the web container starts on port 80 with no errors.

**Given** the production Docker Compose file,
**When** a developer inspects it,
**Then** it references images from `ghcr.io/{owner}/confluent-api` and `ghcr.io/{owner}/confluent-web` (not local builds) — the prod compose file is for deployment, not local development.

---

### Story 10.2: GitHub Actions CI/CD Pipeline

As a developer,
I want automated CI checks on every PR and automated deployment on merge to main,
So that the main branch is always in a deployable state and deployments require no manual steps.

**Acceptance Criteria:**

**Given** a pull request is opened or updated on any branch,
**When** the CI workflow triggers,
**Then** the following steps run in sequence: `pnpm install`, `pnpm turbo run lint`, `pnpm turbo run typecheck`, `pnpm turbo run build` — a failure at any step marks the PR check as failed and blocks merge.

**Given** a commit is merged to `main`,
**When** the CD workflow triggers,
**Then** it builds both Docker images using the multi-stage Dockerfiles (Story 10.1), tags them with the Git SHA and `latest`, and pushes them to `ghcr.io`.

**Given** the images are pushed to `ghcr.io`,
**When** the deploy step runs,
**Then** it SSHs into the production server using a GitHub Actions secret (`DEPLOY_SSH_KEY`), pulls the new images, and runs `docker compose -f docker-compose.prod.yml up -d --pull always` — zero-downtime via Docker Compose recreate.

**Given** the GitHub Actions workflow files,
**When** a developer inspects `.github/workflows/`,
**Then** two workflow files exist: `ci.yml` (PR checks) and `cd.yml` (deploy on main merge), using `ubuntu-latest` runners and pinned action versions (e.g. `actions/checkout@v4`).

**Given** the CD workflow requires secrets,
**When** a developer inspects the repository settings documentation,
**Then** `docs/self-hosting.md` lists all required GitHub Actions secrets: `DEPLOY_SSH_KEY`, `DEPLOY_HOST`, `DEPLOY_USER`, `GHCR_TOKEN`.

---

### Story 10.3: Reverse Proxy — Nginx/Caddy + TLS

As a platform operator,
I want HTTPS enforced with automatic certificate renewal,
So that all traffic is encrypted and the platform meets NFR5 without manual certificate management.

**Acceptance Criteria:**

**Given** a `Caddyfile` (or `nginx.conf` + certbot configuration) at the repository root,
**When** the reverse proxy starts on the production server with a valid domain pointing to it,
**Then** Let's Encrypt issues a TLS certificate automatically and HTTPS is served on port 443.

**Given** an HTTP request arrives on port 80,
**When** the proxy processes it,
**Then** it is redirected to HTTPS with a `301 Moved Permanently` — no plain HTTP traffic is served.

**Given** the proxy configuration,
**When** a request path starts with `/v1/` or `/api/`,
**Then** the request is proxied to the API container on port 3000 with correct `Host`, `X-Real-IP`, and `X-Forwarded-For` headers set.

**Given** all other request paths,
**When** the proxy processes them,
**Then** the request is proxied to the web (nginx) container on port 80.

**Given** the proxy configuration,
**When** an HTTPS response is returned,
**Then** the following security headers are present at the proxy level: `Strict-Transport-Security: max-age=31536000; includeSubDomains`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`.

**Given** the TLS certificate,
**When** it approaches expiry (within 30 days),
**Then** Let's Encrypt automatic renewal runs without operator intervention (Caddy handles this natively; certbot requires a cron entry documented in Story 10.5).

---

### Story 10.4: Database Backups & Restore Procedure (NFR15, NFR16)

As a platform operator,
I want daily automated database backups with a 30-day retention policy,
So that data can be recovered in the event of server failure or accidental deletion.

**Acceptance Criteria:**

**Given** a backup script at `scripts/backup-db.sh`,
**When** executed with the required environment variables set (`DATABASE_URL`, `BACKUP_STORAGE_PATH` or S3 credentials),
**Then** it runs `pg_dump` against the PostgreSQL instance, compresses the output (gzip), and writes the archive to the configured destination (local path or S3-compatible bucket) with a filename including the ISO 8601 timestamp (e.g. `confluent-backup-2026-04-14T03-00-00.sql.gz`).

**Given** the backup script runs daily via cron (or GitHub Actions scheduled workflow),
**When** more than 30 backup files exist at the destination,
**Then** files older than 30 days are deleted automatically — only the most recent 30 days of backups are retained.

**Given** a restore script at `scripts/restore-db.sh`,
**When** executed with a backup filename argument,
**Then** it downloads the specified archive, decompresses it, and applies it to the PostgreSQL instance via `psql` — the script exits with a non-zero code and a clear error message if the file is not found.

**Given** the `.env.example` file at the repository root,
**When** a developer inspects it,
**Then** it contains all required environment variables with placeholder values and inline comments explaining each variable's purpose, grouped by service: Database, Auth (JWT secrets, magic link expiry), Storage (S3/MinIO), Email (SMTP), App (frontend URL, port), and Backup (storage path or S3 bucket).

**Given** the backup destination is an S3-compatible bucket,
**When** the backup script runs,
**Then** it uses the AWS CLI or `mc` (MinIO client) configured from environment variables — no hardcoded credentials exist in the script.

---

### Story 10.5: Self-Hosting Documentation

As a non-developer operator,
I want step-by-step self-hosting documentation,
So that I can deploy and maintain the platform on my own server without needing to read the source code.

**Acceptance Criteria:**

**Given** `docs/self-hosting.md` exists in the repository,
**When** a developer inspects its structure,
**Then** it contains the following sections in order:
1. Prerequisites (server requirements: RAM, disk, OS; required software: Docker, Docker Compose, a domain name)
2. Initial Setup (clone repo, copy `.env.example` to `.env`, fill in variables)
3. First Deployment (pull images from ghcr.io, run `docker compose -f docker-compose.prod.yml up -d`, verify health)
4. Reverse Proxy Setup (Caddy or Nginx + certbot instructions with example config)
5. Backup Configuration (install cron entry or configure scheduled GitHub Action)
6. Updating the Platform (pull new images, recreate containers)
7. Backup & Restore Procedure (step-by-step using `scripts/backup-db.sh` and `scripts/restore-db.sh`)
8. Troubleshooting (common errors: DB connection refused, port conflicts, certificate not issued)

**Given** the documentation,
**When** a developer follows it on a fresh Ubuntu 22.04 server with Docker installed,
**Then** they can reach the platform over HTTPS within 30 minutes without consulting any other resource.

**Given** the self-hosting guide references GitHub Actions secrets,
**When** a developer reads the CD section,
**Then** the exact secret names (`DEPLOY_SSH_KEY`, `DEPLOY_HOST`, `DEPLOY_USER`, `GHCR_TOKEN`) and how to create them in GitHub repository settings are documented.

---

## Epic 11: V1 Polish — Full Web Wiring, User State, Email Pipeline

Closes the explicitly-deferred web-wiring scope of Stories 7.6 and 8.5 (those landed only `features/*/api.ts` helpers; mocks remained as runtime fallbacks), then brings the user identity model and email pipeline to production quality. Two motivating findings drove this epic:

1. **Latent bug post-Story 9.3** — `AdminUsersService.invite` created users with `isActive: false`, but `JwtStrategy.validate` rejected `!isActive`. So a freshly-invited user clicked their magic-link, received an access token, and the first authenticated request 401'd. The fix is structural: separate `emailVerifiedAt` (never verified) from `isActive` (deactivated by admin).
2. **Latent UX dead-end on share invite** — `POST /v1/dossiers/:id/shares` stored `recipientEmail` as a raw string without ever writing `users`. A financeur invited by a share couldn't ever request a magic-link (anti-enumeration `requestMagicLink` returns silently for unknown emails). The fix is to auto-create the user row at share creation time, with `role: 'financeur'`, `isActive: true`, `emailVerifiedAt: null`.

The epic also extracts the inline email HTML (Stories 6.2 + 8.1) into a real templating layer with i18n single-source (1 HTML + N JSON locales), aligns the production transport on Brevo's SMTP relay (NFR17), and ships dev tooling for cross-client validation.

### Story 11.1: Web — Replace All Mocks with Full API Wiring

As an end user (entrepreneur / admin / financeur),
I want every page of the web app to consume real backend data,
So that the app stops showing fake fixtures and reflects the real state of my account, dossiers, and shares.

**Acceptance Criteria:**

**Given** the dashboard routes (`/dashboard`, `/dashboard/tableau-de-bord`),
**When** the page renders,
**Then** dossier listings and counters come from `GET /v1/dossiers` (no `MOCK_DOSSIERS`).

**Given** the dossier creation wizard (`/dashboard/dossiers/nouveau` → `/questionnaire` → `/recapitulatif`),
**When** the user fills it in,
**Then** the dossier is **created server-side at step 1** (`POST /v1/dossiers`), the questionnaire structure is loaded from `GET /v1/questionnaires/active`, answers are persisted via `PUT /v1/dossiers/:id/answers` with debounced autosave (~800ms), and submission triggers `POST /v1/dossiers/:id/submit`. No `localStorage` draft state.

**Given** the entrepreneur dossier view (`/dashboard/dossiers/view/:slug`),
**When** the page renders,
**Then** it parallel-loads `getDossier`, `listAnswers`, `listDocuments`, `listShares`, `getAnalytics`, `getDossierAuditLog` and renders all sections from API data.

**Given** the SharePanel,
**When** the user invites a new recipient or revokes access,
**Then** `POST` / `DELETE /v1/dossiers/:id/shares` are called and the list is refetched on success.

**Given** the public share access route (`/share/:token`),
**When** the token resolves via `GET /shares/:token`,
**Then** the user is redirected directly to `/share/:token/dossier` (no email-gate screen — the UUID token is sufficient, aligned with `ShareLinkGuard`).

**Given** all admin routes (`/admin`, `/admin/dossiers`, `/admin/dossiers/:slug`, `/admin/questionnaire`, `/admin/utilisateurs`),
**When** rendered,
**Then** every read and mutation goes through real `/v1/admin/*` endpoints (pagination, inline answer editing, share revocation, audit log display, questionnaire field patching, user invite/deactivate/reactivate).

**Given** the AppShell sidebar,
**When** the user clicks "Se déconnecter",
**Then** `POST /v1/auth/logout` is called and the auth store is cleared.

**Given** `@confluent/shared`,
**When** the web imports DTOs,
**Then** `questionnaire`, `document`, `analytics` schemas and types are exported (plus `IssuedSession`, `FinanceurShareResponse`, `AdminDossierList`, `Dossier.sector`/`maturityStage`/`submittedAt`).

**Given** all mock fixtures,
**When** the project is built,
**Then** `apps/web/src/data/mock-*.ts` files are deleted (`mock-dossiers`, `mock-admin-dossiers`, `mock-admin-pipeline`, `mock-users`, `mock-analytics`, `mock-dossier`, `mock-questionnaire-builder`, `mock-tokens`). Only `data/questionnaire.ts` remains, stripped to type definitions (`Question`, `Section`, `QuestionMeta`).

**Given** `pnpm -r typecheck` + `pnpm --filter @confluent/web build`,
**When** run,
**Then** both are green.

---

### Story 11.2: User State Separation — `emailVerifiedAt` + `locale`

As a platform operator,
I want `User.isActive` to mean only "admin toggle" and a separate `emailVerifiedAt` column to track first verification,
So that the semantics of user state are unambiguous and invited users can log in via magic-link without the current latent bug.

**Acceptance Criteria:**

**Given** the Prisma schema,
**When** the migration `add_user_email_verified_at_and_locale` is applied,
**Then** `User` has two new columns: `emailVerifiedAt DateTime?` and `locale String @default("fr")`. Backfill applied: `UPDATE users SET email_verified_at = NOW() WHERE is_active = TRUE`.

**Given** `JwtStrategy.validate` and `AuthService.refreshSession`,
**When** a request is authenticated,
**Then** login is granted **iff `isActive === true AND emailVerifiedAt !== null`** (else 401 `INVALID_TOKEN`, opaque to UX).

**Given** `AuthService.verifyMagicLink`,
**When** the token is consumed,
**Then** the user's `emailVerifiedAt` is set to `now()` if previously null (idempotent — no-op if already set), and an audit `magic_link_consumed` row is written with `metadata: { tokenId }`.

**Given** `AdminUsersService.invite`,
**When** a user is invited (new or never-verified existing),
**Then** the user row is created/updated with `isActive: true, emailVerifiedAt: null` (role = invited role). The 409 `USER_ALREADY_ACTIVE` rejection now applies only to `existing.isActive && existing.emailVerifiedAt !== null`.

**Given** unit + e2e tests,
**When** run,
**Then** cases covered: emailVerifiedAt promotion from null on first verify, no-op on subsequent verifies, audit recorded, refresh rejects emailVerifiedAt=null. 69/69 unit + 18/18 e2e green.

---

### Story 11.3: Share Invite Auto-Creates User Row

As an entrepreneur sharing my dossier,
I want the recipient to be registered on the platform automatically,
So that they can later authenticate via magic-link and access their full account, not just the share token.

**Acceptance Criteria:**

**Given** `POST /v1/dossiers/:id/shares` with a recipient email unknown to the platform,
**When** the share is created,
**Then** a `User` row is created with `{ email, role: 'financeur', isActive: true, emailVerifiedAt: null }`. The recipient email is normalized (`.trim().toLowerCase()`) before lookup and creation.

**Given** the same call with a recipient that already exists,
**When** the share is created,
**Then** **no mutation** is performed on the existing row (state preserved, including role and `isActive`).

**Given** the audit row `share_link_created`,
**When** inspected,
**Then** `metadata` contains `recipientUserId` and `createdNewUser: boolean`.

**Given** the email layer,
**When** the share is created,
**Then** exactly one email is sent (`sendShareInvite` with the share URL) — no second magic-link email. The recipient consults the dossier via the share URL without login; if they want to authenticate, they visit `/auth` and the magic-link works because the User row now exists.

**Given** unit tests,
**When** run,
**Then** cases covered: unknown recipient → user created with the right shape ; known recipient → no upsert mutation ; audit metadata correct.

---

### Story 11.4: Email Templates — HTML Statique + i18n Single-Source

As a developer or designer,
I want all transactional email content to live in HTML files I can open in a browser, with translations in JSON files (one HTML for all languages),
So that I can iterate visually without recompiling and add a language by writing a single JSON file.

**Acceptance Criteria:**

**Given** the directory `apps/api/src/modules/auth/email/templates/`,
**When** inspected,
**Then** it contains: `magic-link.{html,txt}`, `share-invite.{html,txt}`, `i18n/fr.json`, `samples.json`, `README.md`.

**Given** any `.html` template,
**When** opened directly in a browser (`open templates/magic-link.html`),
**Then** the layout, typography, and colors render correctly (placeholders `{{key}}` visible as literal text — sufficient to validate visual quality without server).

**Given** the design tokens used in the templates,
**When** compared with `apps/web/src/index.css`,
**Then** they match the Notion-inspired palette (`#FAFAF9` background, `#37352F` primary, `#1A1A1A` foreground, `#6B6B6B` muted, `#E8E8E7` border, radius 6px) and the Inter font family + system fallback.

**Given** the target email clients (Outlook 2016+ Win+Mac, Outlook.com, Apple Mail iOS+macOS, Gmail web+iOS+Android, Yahoo web),
**When** the templates are inspected,
**Then** they comply with: XHTML 1.0 Transitional doctype, table-only layout (no flex/grid), 100% inline CSS (one MSO-conditional `<style>` exception), bulletproof CTA button pattern, hidden preheader, light-only color-scheme meta, no `<form>`/`<iframe>`/JS, hardcoded colors.

**Given** the i18n architecture,
**When** adding a new language,
**Then** the only change required is creating `i18n/<code>.json` (copy of `fr.json` with translated values) + extending the `Locale` type. **Zero changes to the HTML.**

**Given** the `TemplateRenderer` at [apps/api/src/modules/auth/email/template-renderer.ts](../../../../../apps/api/src/modules/auth/email/template-renderer.ts),
**When** `render(name, locale, dynamicVars)` is called,
**Then** it returns `{ subject, html, text }`. Subject is pulled from the i18n JSON. All variables substituted in the HTML are **HTML-escaped** (XSS-safe). Plain-text variables are **not escaped** (newlines preserved). Missing variables throw an explicit `Error("Missing email template variable: {{xxx}}")`. The HTML/JSON files are cached in memory after first read.

**Given** `EmailTransport`,
**When** inspected,
**Then** the interface exposes **typed methods per use case** (no generic `sendMail`): `sendMagicLink({ to, magicLinkUrl, locale })` and `sendShareInvite({ to, dossierName, shareUrl, locale })`. `type Locale = 'fr'` (extensible).

**Given** `nest-cli.json`,
**When** the API builds,
**Then** `compilerOptions.assets` copies `templates/**/*.{html,txt,json,md}` into `dist/` so `readFileSync(join(__dirname, 'templates', …))` works in prod.

**Given** the spec `template-renderer.spec.ts`,
**When** run,
**Then** all cases pass: substitution, missing variable throws, XSS-escape on HTML, no-escape on text, i18n loading.

---

### Story 11.5: Brevo SMTP Relay Integration

As a platform operator,
I want emails in production to be sent via Brevo's SMTP relay using standard SMTP credentials,
So that I can swap providers later (Mailgun, Postmark, …) by changing environment variables only, with zero code change.

**Acceptance Criteria:**

**Given** `NodemailerTransport`,
**When** configured,
**Then** `secure: true` is set only for port 465, `requireTLS: true` is set for any other port besides 25 (forces STARTTLS on 587 — Brevo's standard port). Auth credentials are attached only when `SMTP_USER` is non-empty.

**Given** the codebase,
**When** searched for `brevo` / `getbrevo`,
**Then** **no Brevo-specific dependency is present** — the code is SMTP-agnostic. Switching providers is an environment-variable change in Coolify.

**Given** `apps/api/.env.example`,
**When** inspected,
**Then** it documents two configurations: Mailhog defaults for dev (`SMTP_HOST=localhost`, `SMTP_PORT=1025`) and commented Brevo prod values (`smtp-relay.brevo.com:587`, login = Brevo account email, password = SMTP key from Brevo > SMTP & API, sender = verified sender from Brevo > Senders).

**Given** the `config.schema.ts`,
**When** compared with the .env,
**Then** no new env vars are introduced — `SMTP_HOST/PORT/USER/PASSWORD/FROM` already exist.

---

### Story 11.6: Email Preview & Test Tooling

As a developer or designer,
I want commands to preview email templates locally (visual iteration) and to send real test emails to a local SMTP catcher,
So that I can validate rendering before production deployment.

**Acceptance Criteria:**

**Given** `pnpm --filter @confluent/api email:preview`,
**When** run,
**Then** an HTTP server starts on `localhost:4000` that:
- Lists all available templates with a locale selector at `/`,
- Renders any template with sample values from `samples.json` at `/<name>?locale=fr`,
- Returns the text/plain version at `/<name>.txt?locale=fr`,
- Injects a 2-second auto-reload script into rendered HTML pages,
- Uses only `node:http` + existing `tsx` devDep — **no new dependency**.

**Given** `pnpm --filter @confluent/api email:test`,
**When** run,
**Then** it:
- Loads `.env`,
- Probes SMTP reachability (TCP connect 2s timeout) and fails fast with a clear help message if Mailhog/maildev is not running,
- Sends one `sendMagicLink` and one `sendShareInvite` to `EMAIL_TEST_TO` (default `test@confluent.local`) using the configured `NodemailerTransport`,
- Prints the Mailhog UI URL (`http://localhost:8025`).

**Given** `apps/api/package.json`,
**When** inspected,
**Then** both scripts are declared via `tsx scripts/email-preview.ts` and `tsx scripts/email-send-test.ts`.

---

### Story 11.7: `/auth` — Mention "Invitation Required"

As a user who mistyped my email or who has not yet been invited,
I want the auth page to tell me that no account is created automatically,
So that I understand why my magic-link never arrives and who to contact.

**Acceptance Criteria:**

**Given** the `/auth` page form is visible (before submission),
**When** rendered,
**Then** a `<p>` below the form reads: "Aucun compte n'est créé automatiquement. Pour recevoir un lien, vous devez avoir été invité par un administrateur ou par un entrepreneur qui partage un dossier avec vous."

**Given** the success state after submitting,
**When** rendered,
**Then** the new mention is NOT shown — only the existing "Vérifiez votre boîte mail" copy is.

**Given** the styling,
**When** inspected,
**Then** the new mention uses the same `text-center text-xs text-muted-foreground` classes as the existing "Pas de mot de passe" hint.

**Given** the documentation,
**When** inspected for language,
**Then** it is written in English, uses plain language, and avoids unexplained jargon — shell commands are provided as copy-pasteable blocks with expected output shown as comments.
