# Story 3.1: Dashboard — Dossier List (Mocked)

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an entrepreneur with existing dossiers,
I want to see all my dossiers listed on the dashboard,
so that I can quickly find and open the one I want to work on.

## Acceptance Criteria

1. **Given** the user is on `/dashboard` and the mocked dossier source exposes one or more entries, **When** the dashboard renders, **Then** a list of dossier cards is displayed (minimum 2 mocked entries: `Biosensio` and `Agrotrack`) and each card shows, in this order:
   - Dossier name — 16 px / font-weight 500 (token utilities, no raw px — see §Design Tokens).
   - Sector label — secondary (muted) text.
   - Maturity-stage badge — renders through `Badge` (`variant="secondary"` or `outline`; see Pinned Decision #4 for the choice).
   - Number of active share links — e.g. `2 accès actifs` (pluralisation: `0 accès actif` / `1 accès actif` / `N accès actifs`).
   - Creation date in French relative format — e.g. `il y a 3 jours`, `hier`, `aujourd’hui` (via `Intl.RelativeTimeFormat('fr', { numeric: 'auto' })`; see §Latest Technical Information).

2. **Given** the mocked dossier source is empty (`MOCK_DOSSIERS.length === 0`), **When** the dashboard renders, **Then** the existing `EmptyState` (Story 2.2) is rendered — NOT the list. Conversely, when the source is non-empty, the `EmptyState` does NOT appear. Branch is a single ternary: `dossiers.length > 0 ? <DossierList /> : <EmptyState />`.

3. **Given** a dossier card in the list, **When** the user clicks (or presses Enter/Space with focus on it), **Then** the router navigates via client-side `<Link to="…" />` to `/dashboard/dossiers/view/{slug}` — e.g. `/dashboard/dossiers/view/biosensio`. NOTE: the real route prefix is `view/:slug`, not the bare `:slug` mentioned in the Epic 3 AC — this reflects the post-2.6-review patch that moved the param route under `view/` to avoid sibling collisions (see Pinned Decision #5).

4. **Given** the dossier list, **When** viewed on mobile (< 768 px / default `md` breakpoint), **Then**:
   - Cards stack in a single column with full-width layout (`grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3` or `flex-col gap-4` at `<md`).
   - Each card is ≥ 44 px tall (touch target compliance per UX spec §Accessibility; `min-h-11` on the card container or content that naturally exceeds it via inner padding).
   - No horizontal overflow at any viewport ≥ 320 px (`min-w-0` on text-bearing descendants to defeat long-name overflow; `overflow-hidden` on the card root is acceptable but must not clip the focus ring — see Pinned Decision #6).

5. **Given** the dashboard header area, **When** the page renders, **Then** a `<Button>Créer un dossier</Button>` (primary, `size="lg"`, `h-11 px-4`) is visible in the top-right of the content area — always present, whether the list is empty or populated. This button is complementary to the `EmptyState`'s CTA: both are rendered on the empty path; only the header button is rendered on the populated path.

6. **Given** the dashboard page, **When** a developer inspects the DOM, **Then**:
   - The page's `<title>` is `Dashboard · Confluent` (unchanged — matches Story 2.2).
   - The page exposes exactly one `<h1>`: `Mes dossiers`, using `font-heading text-2xl font-semibold text-foreground md:text-[28px]` (H1 recipe established in Story 2.6).
   - The H1 receives programmatic focus on mount via the `tabIndex={-1}` + `useRef` + `useEffect` recipe (consistent with Stories 2.5 and 2.6); `focus-visible:outline-none` hides the ring for programmatic focus.
   - Header row layout: `<div className="flex items-center justify-between">` containing the H1 and the "Créer un dossier" button. On mobile (`< sm`), the button drops beneath the H1 (`flex-col sm:flex-row sm:items-center sm:justify-between gap-4`).

7. **Given** the list, **When** rendered, **Then** cards are ordered by `createdAt` descending (newest first). Data shape: the mock fixture exposes pre-sorted entries OR the render sorts on the fly — either is acceptable (see Task 1); the AC binds the visible order, not the source order.

8. **Given** the `DossierCard` component, **When** a developer inspects the DOM, **Then**:
   - The root element is a `<Link>` (not a `<div>` with a nested `<Link>`) — single focusable target, entire card is clickable, no nested-interactive issue.
   - The link carries an aggregated `aria-label` of the form `{name}, secteur {sector}, stade {maturity}, {N} {accès actifs|actif}, créé {relativeDate}` so a screen-reader user gets a single-pass summary instead of reading four siblings.
   - The visual card body (the content inside the `<Link>`) carries all card styling: `bg-card border border-border rounded-lg p-4` (matches shadcn `Card` defaults — see Pinned Decision #7 for why we don't use `Card` here) and `hover:border-foreground/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]` for interaction states.
   - The card body has `min-h-11` so the touch target clears 44 px even on a single-line name + single badge.
   - No nested `<button>` or `<a>` inside the card (no "edit" / "share" controls in 3.1 — those land in Stories 3.5 / 3.6).

9. **Given** a keyboard-only user on the populated dashboard, **When** they Tab from the H1, **Then** focus lands on: (a) the header `Créer un dossier` button, (b) each card `<Link>` in visual order, (c) the bottom-nav items (mobile) or sidebar items (desktop, via the skip-link / browser-default order). Enter or Space on a focused card triggers navigation (`<Link>` default behaviour).

10. **Given** a screen-reader user on the populated dashboard, **When** the page mounts, **Then**:
    - The H1 "Mes dossiers" is the first thing announced (focus-on-mount recipe).
    - The list is wrapped in `<ul role="list">` (explicit role because some browsers strip implicit list semantics when `list-style: none`); each card is a `<li>`.
    - The `<ul>` has `aria-label="Liste de vos dossiers"` or a visually-hidden `<h2>` above it — choose `aria-label` for brevity (Pinned Decision #8).
    - The `Badge` carries text content that a screen-reader reads naturally (no `aria-hidden` on the badge text).

11. **Given** a dossier card whose navigation target is NOT backed by a complete `confluent_dossier_{slug}` localStorage entry (expected on first visit — the mocks are not seeded into localStorage), **When** the user clicks it, **Then** the 2.6 dossier view renders its "Dossier introuvable" fallback — this is an EXPECTED integration seam that Story 3.2 closes by rewiring the dossier view to read from the same mock source. 3.1 does NOT seed localStorage. See Pinned Decision #2.

12. **Given** the dashboard at `/dashboard`, **When** breadcrumbs are considered, **Then** NO breadcrumb is rendered (the path has only 1 segment — `/dashboard` — which the existing `Breadcrumbs` component short-circuits via `segments.length < 2 ? null : …`). No new `handle` entry needed in `router.tsx`.

## Tasks / Subtasks

- [x] **Task 1: Create the mock dossier data module (AC: 1, 7)**
  - [x] File: `apps/web/src/data/mock-dossiers.ts`. Named exports only (`MOCK_DOSSIERS`, `MockDossier`). Mirror the `data/questionnaire.ts` precedent (readonly array, TypeScript-strict types).
  - [x] Type contract:
    ```ts
    export interface MockDossier {
      readonly slug: string                    // URL segment: /dashboard/dossiers/view/{slug}
      readonly name: string                    // Display name with original accents/casing
      readonly sector: string                  // e.g. "DeepTech", "AgriTech"
      readonly maturity: string                // e.g. "Pre-seed", "Prototype", "Amorçage"
      readonly activeShareLinksCount: number   // 0..N — renders as "N accès actif(s)"
      readonly createdAt: string               // ISO 8601 string
    }

    export const MOCK_DOSSIERS: readonly MockDossier[]
    ```
  - [x] Seed with exactly two entries (AC1 minimum). Suggested payload:
    ```ts
    export const MOCK_DOSSIERS: readonly MockDossier[] = [
      {
        slug: 'biosensio',
        name: 'Biosensio',
        sector: 'DeepTech',
        maturity: 'Pre-seed',
        activeShareLinksCount: 2,
        createdAt: '2026-04-18T09:00:00.000Z', // "il y a 3 jours" relative to 2026-04-21
      },
      {
        slug: 'agrotrack',
        name: 'Agrotrack',
        sector: 'AgriTech',
        maturity: 'Amorçage',
        activeShareLinksCount: 0,
        createdAt: '2026-04-10T14:30:00.000Z', // "il y a 11 jours" relative to 2026-04-21
      },
    ] as const
    ```
  - [x] The `createdAt` ISO strings are HARDCODED literals, NOT computed from `new Date()`. Reason: stable, deterministic rendering across sessions, and matches the "mocked data + local state only" epic constraint. A developer wanting to revisit the "il y a X jours" label just edits the string.
  - [x] Sort order: array order IS the render order (newest first). Do NOT re-sort at render time in 3.1 — array stays the source of truth. Document this as a one-line comment at the top of the file.
  - [x] Do NOT seed these into localStorage anywhere in 3.1. The dashboard reads from this array ONLY — the 2.6 dossier view continues to read from `confluent_dossier_{slug}` (Pinned Decision #2). Story 3.2 will bridge the two.

- [x] **Task 2: Create the relative-date utility (AC: 1)**
  - [x] File: `apps/web/src/lib/relative-date.ts`. Named export, no default.
  - [x] Signature + implementation:
    ```ts
    export function formatRelativeDate(iso: string, now: Date = new Date()): string {
      const then = new Date(iso).getTime()
      if (!Number.isFinite(then)) return ''
      const diffMs = then - now.getTime()
      const diffDays = Math.round(diffMs / 86_400_000)
      const rtf = new Intl.RelativeTimeFormat('fr', { numeric: 'auto' })
      if (Math.abs(diffDays) < 30) return rtf.format(diffDays, 'day')
      const diffMonths = Math.round(diffDays / 30)
      if (Math.abs(diffMonths) < 12) return rtf.format(diffMonths, 'month')
      const diffYears = Math.round(diffMonths / 12)
      return rtf.format(diffYears, 'year')
    }
    ```
  - [x] Test-vector comment block at the top (for manual verification). Relative to `2026-04-21T00:00:00Z`:
    - `2026-04-21T09:00:00.000Z` → `aujourd’hui`
    - `2026-04-20T09:00:00.000Z` → `hier`
    - `2026-04-18T09:00:00.000Z` → `il y a 3 jours`
    - `2026-04-10T14:30:00.000Z` → `il y a 11 jours`
    - `2026-03-18T09:00:00.000Z` → `il y a 1 mois`
    - `2025-04-18T09:00:00.000Z` → `il y a 1 an`
  - [x] The function is pure — `now` is injectable for future testability even though 3.1 has no Vitest harness. Epic 7 persistence + tests will consume it.
  - [x] `Intl.RelativeTimeFormat` is ES2020 / available in all target browsers. No polyfill.

- [x] **Task 3: Create the `DossierCard` component (AC: 1, 3, 4, 8, 10)**
  - [x] File: `apps/web/src/components/confluent/DossierCard.tsx`. Named export `DossierCard`, named export `DossierCardProps`. No default export.
  - [x] Lives at `components/confluent/` (design-system-level display primitive, same precedent as `DossierField` from Story 2.6 — UX spec §Component Implementation Strategy). NOT at `features/dossiers/components/` despite the architecture doc's layout — that location is reserved for feature-scoped hooks / API / business logic, none of which land in 3.1. See Pinned Decision #1.
  - [x] Props contract:
    ```ts
    export interface DossierCardProps {
      slug: string
      name: string
      sector: string
      maturity: string
      activeShareLinksCount: number
      createdAt: string            // ISO 8601 — component calls formatRelativeDate internally
      className?: string           // per UX spec "Each custom component accepts a className prop"
    }
    export function DossierCard(props: DossierCardProps): JSX.Element
    ```
  - [x] Implementation skeleton (reference — developer may refactor for style while preserving AC bindings):
    ```tsx
    import { Link } from 'react-router-dom'
    import { Badge } from '@/components/ui/badge'
    import { cn } from '@/lib/utils'
    import { formatRelativeDate } from '@/lib/relative-date'

    export interface DossierCardProps {
      slug: string
      name: string
      sector: string
      maturity: string
      activeShareLinksCount: number
      createdAt: string
      className?: string
    }

    function formatAccessLabel(count: number): string {
      if (count === 0) return '0 accès actif'
      if (count === 1) return '1 accès actif'
      return `${count} accès actifs`
    }

    export function DossierCard({
      slug,
      name,
      sector,
      maturity,
      activeShareLinksCount,
      createdAt,
      className,
    }: DossierCardProps) {
      const relativeCreatedAt = formatRelativeDate(createdAt)
      const accessLabel = formatAccessLabel(activeShareLinksCount)
      const ariaLabel = `${name}, secteur ${sector}, stade ${maturity}, ${accessLabel}, créé ${relativeCreatedAt}`
      return (
        <Link
          to={`/dashboard/dossiers/view/${slug}`}
          aria-label={ariaLabel}
          className={cn(
            'group flex min-h-11 flex-col gap-3 rounded-lg border border-border bg-card p-4 transition-colors',
            'hover:border-foreground/20',
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)] focus-visible:border-foreground/20',
            className,
          )}
        >
          <div className="flex items-start justify-between gap-3">
            <h3 className="min-w-0 break-words text-base font-medium text-foreground">
              {name}
            </h3>
            <Badge variant="secondary" className="shrink-0">
              {maturity}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">{sector}</p>
          <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>{accessLabel}</span>
            <span aria-hidden="true">·</span>
            <span>{`Créé ${relativeCreatedAt}`}</span>
          </div>
        </Link>
      )
    }
    ```
  - [x] Design tokens only. Do NOT introduce raw hex values or inline colours. `bg-card`, `text-foreground`, `text-muted-foreground`, `border-border`, `--ring` are all pre-existing tokens (`index.css` L54-L90).
  - [x] The `<Link>` IS the card — no nested `<button>` / `<a>` inside. Keeps the card a single focusable target, satisfies AC8 nested-interactive concern, and avoids the WAI-ARIA 1.2 "Prefer single interactive element per row" pattern.
  - [x] `min-w-0 break-words` on the `<h3>` protects against long names pushing the badge off-screen on narrow viewports (320 px).
  - [x] The `·` separator uses `aria-hidden="true"` — it is decorative (matches Stories 2.4/2.5's arrow-glyph convention).
  - [x] The `Badge` gets `variant="secondary"` (Pinned Decision #4): reads as a neutral classification, visually calmer than `default` (which is near-black and would compete with the dossier name for attention). `outline` is the fallback if `secondary` looks washed-out against `bg-card` — inspect at build time before committing.
  - [x] `shrink-0` on the badge locks it against compression when the name line wraps.

- [x] **Task 4: Rewrite the dashboard route to list mocked dossiers (AC: 2, 5, 6, 7, 9, 10)**
  - [x] Edit `apps/web/src/routes/dashboard/index.tsx`. This is a full rewrite — the current file is 23 lines and unconditionally renders `EmptyState`.
  - [x] Preserve: the `<title>Dashboard · Confluent</title>` tag, the H1 text `Mes dossiers`, the `EmptyState` usage for the empty branch (composition + CTA semantics from Story 2.2 must not regress).
  - [x] Change: add a header row with the "Créer un dossier" button, add the list branch, add focus-on-mount on the H1.
  - [x] Implementation skeleton:
    ```tsx
    import { useEffect, useRef } from 'react'
    import { useNavigate } from 'react-router-dom'
    import { Button } from '@/components/ui/button'
    import { EmptyState } from '@/components/confluent/EmptyState'
    import { EmptyDossiersIllustration } from '@/components/confluent/illustrations/EmptyDossiersIllustration'
    import { DossierCard } from '@/components/confluent/DossierCard'
    import { MOCK_DOSSIERS } from '@/data/mock-dossiers'

    export default function DashboardRoute() {
      const navigate = useNavigate()
      const headingRef = useRef<HTMLHeadingElement>(null)
      const dossiers = MOCK_DOSSIERS

      useEffect(() => {
        headingRef.current?.focus()
      }, [])

      function goToNew() {
        navigate('/dashboard/dossiers/nouveau')
      }

      return (
        <>
          <title>Dashboard · Confluent</title>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <h1
              ref={headingRef}
              tabIndex={-1}
              className="font-heading text-2xl font-semibold text-foreground md:text-[28px] focus-visible:outline-none"
            >
              Mes dossiers
            </h1>
            <Button
              type="button"
              size="lg"
              className="h-11 px-4 self-start sm:self-auto"
              onClick={goToNew}
            >
              Créer un dossier
            </Button>
          </div>
          {dossiers.length > 0 ? (
            <ul
              role="list"
              aria-label="Liste de vos dossiers"
              className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3"
            >
              {dossiers.map((d) => (
                <li key={d.slug} className="flex">
                  <DossierCard {...d} className="flex-1" />
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              illustration={<EmptyDossiersIllustration />}
              title="Aucun dossier pour l'instant"
              description="Créez votre premier dossier pour commencer à partager votre projet avec des investisseurs."
              cta={{ label: 'Créer un dossier', onClick: goToNew }}
            />
          )}
        </>
      )
    }
    ```
  - [x] The `<li className="flex">` + `DossierCard className="flex-1"` combo guarantees equal-height cards within a grid row (the `<Link>` stretches to fill the flex-item). Equal-height cards read as a cohesive list even when names/sectors vary in length.
  - [x] The `mt-8` on the `<ul>` reproduces the empty-state breathing room that existed when `EmptyState` was the only child (`py-16` on `EmptyState` centred the content). On the populated branch, `mt-8` keeps the header-to-list gap consistent.
  - [x] Do NOT render the list AND the empty state together — strict ternary branch. The EmptyState is mutually exclusive with the list (AC2).
  - [x] Do NOT add a client-side filter / search UI in 3.1 — out of scope; the epic lists zero ACs for filtering and the mock has 2 entries. Potential Story 3.x follow-up if the list grows past ~5 entries.

- [x] **Task 5: Verify + guardrails (AC: 1–12)**
  - [x] `pnpm turbo run typecheck` → 2 successful, 0 errors. New exports: `MockDossier`, `MOCK_DOSSIERS`, `formatRelativeDate`, `DossierCard`, `DossierCardProps`. All compile cleanly.
  - [x] `pnpm turbo run lint` → 0 errors. Preserve the 3 tolerated pre-existing warnings (badge, button, current-user). Zero new warnings.
  - [x] `pnpm turbo run build` → 2 successful, 0 errors. Expected bundle delta: +~0.2 kB gzip CSS (new utility classes: `grid-cols-*`, `min-w-0`, `break-words`, `shrink-0`, `self-start`, a few `xl:` breakpoints), +~1.2–1.8 kB gzip JS (mock fixture + relative-date util + DossierCard + dashboard rewrite).
  - [x] `pnpm turbo run dev` manual walkthrough (tri-viewport: 375 / 900 / 1440 px):
    1. Navigate to `/dashboard`. Verify: H1 "Mes dossiers" receives focus on mount (Tab shows focus on the "Créer un dossier" button next). Header button visible top-right on desktop/tablet, beneath the H1 on mobile.
    2. Verify 2 cards render — `Biosensio` and `Agrotrack` — in that order. Each card: name 16 px / 500, sector (secondary), maturity badge (neutral, right-aligned top of card), active-links line, relative creation date ("il y a 3 jours" / "il y a 11 jours" against the current date).
    3. Hover a card → border darkens subtly (`border-foreground/20`), no transform, no shadow.
    4. Keyboard Tab order: H1 → header "Créer un dossier" → card 1 → card 2 → (mobile) bottom-nav items / (desktop) browser chrome. Enter on card 1 → navigates to `/dashboard/dossiers/view/biosensio`. Expected destination: 2.6's "Dossier introuvable" fallback renders (AC11 — this is the documented integration seam closed by Story 3.2).
    5. Mobile (375 px): single-column grid, each card full-width, no horizontal scrollbar, tap-target ≥ 44 px (DevTools Accessibility → Touch target size).
    6. Temporarily edit `MOCK_DOSSIERS` to an empty array (`[]`). Reload `/dashboard`. Verify: `EmptyState` renders with its illustration + title + description + CTA. Header "Créer un dossier" button STILL renders alongside (AC5). Both CTAs navigate to the same target. Restore the fixture after verification.
    7. Click header "Créer un dossier" → navigates to `/dashboard/dossiers/nouveau` (2.3 naming step). The existing 2.3 flow is intact.
    8. `prefers-reduced-motion: reduce` toggle: no animations on card hover or mount. Colour / opacity transitions only, no transforms.
    9. VoiceOver / NVDA sanity: heading navigation announces H1 first. Focusing a card announces the aggregated `aria-label` (name + sector + maturity + access + creation date) as a single statement.
    10. Axe audit on `/dashboard` populated and empty: 0 violations, 0 serious issues. The list's `role="list"` + `aria-label` carry the landmark.
    11. Long-name regression probe: edit `MOCK_DOSSIERS[0].name` to `Biosensio-Projet-Agro-Alimentaire-Très-Long` (35 chars). Reload. Verify: on 320 px viewport, the name wraps within the card (`break-words` + `min-w-0`) and the badge stays right-aligned on its own line via the outer `flex items-start justify-between gap-3`. No horizontal overflow. Restore the fixture.
    12. Breadcrumb regression: confirm NO breadcrumb appears on `/dashboard` (the 1-segment short-circuit from Story 2.1 is intact).
  - [x] No regression on Stories 1.3 / 2.1 – 2.6:
    - `/dashboard/tableau-de-bord` still renders (2.1).
    - `/dashboard/dossiers/nouveau` naming step still reachable from BOTH the header button and the empty-state CTA (2.2 + 2.3).
    - Questionnaire flow 2.4 / 2.5 / 2.6 unchanged — Task 4 does not touch any file outside `routes/dashboard/index.tsx`.
    - Completion screen at `/dashboard/dossiers/nouveau/recapitulatif` and dossier view at `/dashboard/dossiers/view/:slug` unchanged (2.6 contract preserved).

- [x] **Task 6: Self-review sweep before marking story done**
  - [x] Confirm all 12 ACs trace to code (AC → Task / component mapping documented in each AC block and each Task header).
  - [x] Confirm no raw hex values in the new files (`grep -n '#[0-9a-fA-F]\{3,6\}' apps/web/src/components/confluent/DossierCard.tsx apps/web/src/routes/dashboard/index.tsx apps/web/src/data/mock-dossiers.ts apps/web/src/lib/relative-date.ts` must return nothing).
  - [x] Confirm `focus-visible:outline-none` appears on programmatically-focused H1 only, not on the card (the card MUST keep its focus ring for keyboard users).
  - [x] Confirm the `DossierCard` renders as a `<Link>`, not a `<div>` wrapping a `<Link>` — avoids the redundant click-target trap.
  - [x] Confirm the `<ul>` carries `role="list"` — necessary because Tailwind's default `list-style: none` on `<ul>` causes Safari/VoiceOver to drop the implicit `list` role.
  - [x] Confirm `aria-label` strings on the `<Link>` are sensible when read back (test with one card aloud).

## Dev Notes

### Critical Architecture Constraints

- **`DossierCard` lives at `apps/web/src/components/confluent/DossierCard.tsx`** — design-system-level display primitive, reused potentially by Epic 5 (admin all-dossiers list) and Epic 7 (frontend API-wired replacement of the mock). NOT in `features/dossiers/components/` despite the architecture doc's layout: no feature-scoped hooks / API / mutation live in 3.1 (mock fixture only). Matches the Story 2.6 placement of `DossierField`. [Source: [_bmad-output/planning-artifacts/ux-design-specification.md](../planning-artifacts/ux-design-specification.md#L612-L617) §Component Implementation Strategy; Story 2.6 Pinned Decision on `DossierField` location]
- **Mock data fixture at `apps/web/src/data/mock-dossiers.ts`** — mirrors `data/questionnaire.ts` pattern (readonly typed array, named exports). `data/` is for static fixture / configuration content; `features/` is for hooks + API + state. The mock is fixture, not state. [Source: [apps/web/src/data/questionnaire.ts](../../../../../apps/web/src/data/questionnaire.ts); architecture.md §Project Structure]
- **`formatRelativeDate` at `apps/web/src/lib/relative-date.ts`** — pure utility, mirrors the `lib/slugify.ts` + `lib/sanitize.ts` + `lib/utils.ts` sibling pattern. [Source: apps/web/src/lib/]
- **Design tokens only — no raw hex.** All new styles use Tailwind v4 utility classes that map to `--color-*` tokens from `index.css`. `bg-card`, `border-border`, `text-foreground`, `text-muted-foreground`, `focus-visible:outline-[var(--ring)]` are the relevant surfaces. [Source: [apps/web/src/index.css](../../../../../apps/web/src/index.css#L52-L90); Story 2.6 anti-pattern list]
- **The dashboard H1 adopts the 28 px recipe on `md:`** (`md:text-[28px]`) — same as the dossier view H1 in Story 2.6. Keeps the entrepreneur's top-level page visually consistent with the dossier detail page. [Source: [_bmad-output/planning-artifacts/ux-design-specification.md](../planning-artifacts/ux-design-specification.md#L349-L357); Story 2.6 Dev Notes]
- **No raw `<button>` / `<a>` inside the card.** The card is a single `<Link>` — this prevents the "two focus stops per card" accessibility antipattern and matches WAI-ARIA 1.2's list-row pattern. [Source: UX spec §Accessibility; WCAG 2.1 AA]
- **Route target is `/dashboard/dossiers/view/{slug}`, not `/dashboard/dossiers/{slug}`.** The Epic 3 AC uses the bare-`:slug` form, which was superseded by the Story 2.6 code-review patch ("Route `dashboard/dossiers/:slug` is shadowed by any dossier name that slugifies to a literal sibling segment"). The real route lives under `view/:slug` to avoid the reserved-segment trap. [Source: [apps/web/src/router.tsx](../../../../../apps/web/src/router.tsx#L38-L42); Story 2.6 Review Findings]
- **Mock data is NOT seeded into localStorage.** The dashboard reads the array; the dossier view (Story 2.6) reads `confluent_dossier_{slug}`. Clicking a mock card today hits the 2.6 "Dossier introuvable" fallback — Story 3.2 bridges the two when it rewires the dossier view. Avoids fixture-sprawl across storage and the array. [Source: Pinned Decision #2]
- **Breadcrumbs auto-suppress on `/dashboard`.** Only 1 path segment → `segments.length < 2` branch short-circuits to `null`. No `handle: { hideBreadcrumb: true }` required on the dashboard route — the behaviour is already correct. [Source: [apps/web/src/components/layout/Breadcrumbs.tsx](../../../../../apps/web/src/components/layout/Breadcrumbs.tsx#L32)]
- **Single primary button per view — except this one.** The UX spec rule says "One primary button per view"; on the empty-state branch we have TWO primary buttons (header + `EmptyState.cta`). Epic 3 AC5 explicitly requires the header button to be "always present, complementary". Treat this as a scoped divergence from the rule, not a violation — documented in Pinned Decision #3. [Source: [_bmad-output/planning-artifacts/ux-design-specification.md](../planning-artifacts/ux-design-specification.md#L642-L651) §Button Hierarchy; [_bmad-output/planning-artifacts/epics.md](../planning-artifacts/epics.md#L622-L624)]
- **WCAG 2.1 AA baseline:** H1 focus-on-mount (carries the 2.5 / 2.6 recipe); `role="list"` + `aria-label` on the grid `<ul>`; `aria-label` aggregated on each card link; `aria-hidden` on decorative separators; 44 × 44 CSS tap targets on the header button (`h-11` + `px-4`) and on each card (`min-h-11`). [Source: [_bmad-output/planning-artifacts/ux-design-specification.md](../planning-artifacts/ux-design-specification.md#L377-L405) §Accessibility, §Touch Targets]
- **No `react-hook-form`, no `zod`, no TanStack Query on 3.1.** The dashboard is a read-only list of static fixture data. Forms, validation, server state are Epic 7 concerns.
- **French-locale typography unchanged.** No new French-punctuation strings in 3.1 beyond the relative-date formatter's `Intl` output (which already handles the locale).

### Design Tokens to Use

| Surface | Tailwind utility | Value | Where |
|---|---|---|---|
| Dashboard H1 | `font-heading text-2xl md:text-[28px] font-semibold text-foreground` | 24 → 28 px | `<h1>Mes dossiers</h1>` |
| Header button (primary) | `bg-primary text-primary-foreground h-11 px-4` (Button size=lg) | `#37352F` / white / 44 px | "Créer un dossier" |
| Card surface | `bg-card border border-border rounded-lg p-4` | `#FFFFFF` / `#E8E8E7` / 6 px radius / 16 px | `DossierCard` root |
| Card hover border | `hover:border-foreground/20` | `#1A1A1A @ 20%` | Interaction state |
| Card focus ring | `focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]` | 2 px `#37352F` with 2 px offset | Keyboard focus |
| Dossier name `<h3>` | `text-base font-medium text-foreground` | 16 px / 500 / `#1A1A1A` | Card title |
| Sector label `<p>` | `text-xs text-muted-foreground` | 12 px / `#6B6B6B` | Secondary line |
| Maturity `Badge` | `variant="secondary"` (see Pinned Decision #4) | `#F1F0EE` bg / `#1A1A1A` text | Right-aligned pill |
| Access + date meta | `text-xs text-muted-foreground` | 12 px / `#6B6B6B` | Bottom meta row |
| Separator glyph `·` | `aria-hidden="true"` | decorative | Between access / date |
| Grid container | `grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3` | Responsive | `<ul>` wrapping cards |
| Header row | `flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between` | Responsive | H1 + button row |

### Component Prop Contracts (exhaustive)

```ts
// apps/web/src/data/mock-dossiers.ts
export interface MockDossier {
  readonly slug: string
  readonly name: string
  readonly sector: string
  readonly maturity: string
  readonly activeShareLinksCount: number
  readonly createdAt: string  // ISO 8601
}
export const MOCK_DOSSIERS: readonly MockDossier[]

// apps/web/src/lib/relative-date.ts
export function formatRelativeDate(iso: string, now?: Date): string

// apps/web/src/components/confluent/DossierCard.tsx
export interface DossierCardProps {
  slug: string
  name: string
  sector: string
  maturity: string
  activeShareLinksCount: number
  createdAt: string
  className?: string
}
export function DossierCard(props: DossierCardProps): JSX.Element

// apps/web/src/routes/dashboard/index.tsx
export default function DashboardRoute(): JSX.Element  // rewritten
```

### File Layout (target)

```
apps/web/src/
├── components/
│   ├── confluent/
│   │   ├── DossierCard.tsx                                    [NEW — design-system card primitive]
│   │   ├── DossierField.tsx                                   [UNCHANGED — Story 2.6]
│   │   ├── EmptyState.tsx                                     [UNCHANGED — used on the empty branch]
│   │   ├── WizardInput.tsx                                    [UNCHANGED]
│   │   └── illustrations/
│   │       └── EmptyDossiersIllustration.tsx                  [UNCHANGED]
│   ├── layout/
│   │   ├── AppShell.tsx                                       [UNCHANGED]
│   │   ├── Breadcrumbs.tsx                                    [UNCHANGED — auto-suppresses on /dashboard]
│   │   ├── NavItem.tsx                                        [UNCHANGED]
│   │   └── nav-items.ts                                       [UNCHANGED]
│   └── ui/
│       ├── badge.tsx                                          [UNCHANGED — Badge variant="secondary" reused]
│       ├── button.tsx                                         [UNCHANGED — Button size="lg" reused]
│       └── ... (other shadcn primitives, unchanged)
├── data/
│   ├── mock-dossiers.ts                                       [NEW — MOCK_DOSSIERS fixture]
│   └── questionnaire.ts                                       [UNCHANGED]
├── features/
│   ├── current-user/                                          [UNCHANGED]
│   └── questionnaire/                                         [UNCHANGED]
├── lib/
│   ├── relative-date.ts                                       [NEW — formatRelativeDate utility]
│   ├── sanitize.ts                                            [UNCHANGED]
│   ├── slugify.ts                                             [UNCHANGED]
│   └── utils.ts                                               [UNCHANGED]
├── routes/
│   └── dashboard/
│       ├── index.tsx                                          [REWRITTEN — list ⇄ empty branch + header button]
│       ├── tableau-de-bord.tsx                                [UNCHANGED]
│       └── dossiers/
│           ├── [slug].tsx                                     [UNCHANGED — 2.6 dossier view]
│           └── nouveau/                                       [UNCHANGED]
└── router.tsx                                                 [UNCHANGED — no route changes in 3.1]
```

### Previous Story Intelligence

**From Story 2.6 (just landed):**
- `components/confluent/` is the settled home for design-system-level display primitives (`DossierField` lives there). `DossierCard` follows suit. The architecture doc's `features/dossiers/components/DossierCard.tsx` placement is a pre-Epic-2 sketch — UX spec + 2.6 precedent take priority.
- The route `/dashboard/dossiers/view/:slug` is the real dossier-view URL (post-review patch). The `:slug` epic-shorthand does NOT exist as a route.
- `confluent_dossier_{slug}` is the localStorage key for completed dossiers. Story 3.1 does NOT read or write this key — the mock fixture lives in-memory only. Story 3.2 is the likely bridge point.
- H1 focus-on-mount via `useRef` + `useEffect(..., [])` + `tabIndex={-1}` + `focus-visible:outline-none` is the canonical pattern across 2.5 / 2.6 / 3.1.
- `Button size="lg"` with `h-11 px-4` is the canonical primary-button recipe for 44 px touch targets (established 2.2 code-review; carried through 2.3 / 2.4 / 2.5 / 2.6).
- `lucide-react` is in the dependency set (used by `ui/sheet.tsx`, `ui/sonner.tsx`, and 2.6's `CircleCheckIcon`). 3.1 does NOT introduce a new icon — the card has no icon. If one is added later (e.g., a chevron-right on hover), use lucide.

**From Stories 2.1 – 2.5 (carried):**
- `AppShell` + sidebar + breadcrumb auto-suppression handle the `/dashboard` top-level correctly. No shell-level changes in 3.1.
- The 2.2 `EmptyState` component is reused as-is. 3.1 does NOT modify it.
- `NavLink`'s `end: true` on `/dashboard` means the sidebar "Mes dossiers" entry highlights on `/dashboard` and on `/dashboard/dossiers/view/:slug` only if configured similarly. Check by clicking Biosensio → navigating away from `/dashboard` — if the sidebar loses its active state, that's the pre-existing deferred item from 2.2's review (sidebar "Mes dossiers" loses active state on `/dashboard/dossiers/nouveau`). Not a 3.1 concern.

**Cross-Epic anticipation (for 3.2+):**
- Story 3.2 introduces the dossier page header + tab navigation. It will need to read mock dossier data by slug — the likely shape is `MOCK_DOSSIERS.find((d) => d.slug === slug)` returning the same `MockDossier` type. Export the type as `MockDossier` (done in Task 1) so 3.2 can consume it without reshaping. Extending `MockDossier` with the per-question `answers` payload is a 3.2 concern, not 3.1.
- Story 3.4 introduces `AccessListRow` + `StatusDot` — same design-system-primitive placement (`components/confluent/`). The `activeShareLinksCount` field on `MockDossier` will eventually become `accessRows: readonly AccessRow[]` in 3.3 / 3.4.
- Story 3.5's D5 slide-in share panel will add a "Partager" button on the dossier page header (3.2). Not a card-level action; the dashboard list does not surface a share CTA.

### Anti-Patterns to Avoid

- **Do NOT nest a `<button>` or `<Link>` INSIDE `DossierCard`.** The card IS a `<Link>`. Two interactives per card yields inconsistent screen-reader behaviour (some read both, some announce "clickable clickable") and breaks the "single target" pattern.
- **Do NOT render the list AND the empty state simultaneously.** Strict branch: `dossiers.length > 0 ? <DossierList /> : <EmptyState />`. Rendering both (e.g., "empty state above the list for marketing") is an AC2 regression.
- **Do NOT seed `confluent_dossier_{slug}` from the mock fixture.** Story 3.1 keeps the mock in-memory; Story 3.2 wires the dossier view to the same source.
- **Do NOT hardcode colour hex values in `DossierCard.tsx` or `routes/dashboard/index.tsx`.** Use Tailwind utility classes that map to `--color-*` tokens. A `grep` must return zero hits for `#[0-9a-fA-F]{3,6}` across the new files.
- **Do NOT use `window.location.href` to navigate.** Always `useNavigate()` or `<Link>` — preserves React Router state and keyboard navigation semantics.
- **Do NOT add a filter / sort / search UI in 3.1.** Out of scope; mock has 2 entries. Revisit when the list reaches ~5+ entries, which is an Epic 7 post-API-wiring concern.
- **Do NOT replace the `EmptyState` with bespoke markup on the empty branch.** The shared `EmptyState` component IS the empty-branch UI — reusing it preserves the Story 2.2 investment (illustration + title + description + optional CTA).
- **Do NOT introduce a `DossierCard` variant prop in 3.1.** Single visual treatment. Variants (`compact`, `admin`, etc.) may land with Epic 5 (admin) if required; out of scope here.
- **Do NOT change the `/dashboard/dossiers/nouveau` target from the header button OR from the `EmptyState.cta`.** Both route to the same 2.3 naming step. Divergence would re-open the 2.2 deferred "sidebar loses active state" concern with a different symptom.
- **Do NOT add an auto-redirect when the mock has a single entry.** The dashboard is the list view; even with one dossier it is the correct landing page. Auto-redirect is a bypass of the user's mental model ("I came here to see my list").
- **Do NOT add loader / skeleton states.** The data is a synchronous in-memory array; no latency, no network. `<Suspense>` boundaries are inappropriate here.
- **Do NOT extend `Breadcrumbs.tsx` to know about `/dashboard`.** The 1-segment short-circuit is correct. Adding a `Mes dossiers` breadcrumb to the dashboard page is a UX regression (breadcrumb-on-root is redundant with the H1 and the sidebar active state).
- **Do NOT use `<Button variant="link">` for the card target.** The card is a presentational `<Link>`, not a button. Converting it to a button would break right-click-open-in-new-tab and middle-click-open-in-new-tab semantics.

### Testing Requirements

- **Unit / integration tests remain out of scope** for Epic 3 frontend — no Vitest/RTL harness introduced. Do not add one here.
- **Manual verification is the primary gate** (Task 5 walkthrough). Tri-viewport (375 / 900 / 1440 px), axe audit on: (a) populated dashboard, (b) empty-fixture dashboard, (c) card-focused state, (d) long-name card. Screen-reader sanity: H1 announced first on mount; each card announces the aggregated `aria-label` as a single statement; the `<ul>` is announced as a list with N items.
- **Type safety:** the `MockDossier` type is a readonly `interface` (not a `type`), enabling declaration merging if Epic 7 needs to extend it (not anticipated, but cheap to leave open).
- **No new lint warnings permitted** beyond the 3 tolerated ones (badge, button, current-user). Run `pnpm turbo run lint` before marking done.
- **No regression on Stories 1.1 – 2.6 ACs** — full table in Task 5. Specifically:
  - `/dashboard/tableau-de-bord` still renders (2.1 sidebar link).
  - `/dashboard/dossiers/nouveau` still reachable (2.2 + 2.3 naming step).
  - Questionnaire + completion + dossier view (2.4 / 2.5 / 2.6) unchanged — Task 4 touches only `routes/dashboard/index.tsx`.
- **Relative-date test vectors (document in a comment block at the top of `relative-date.ts`, verify via Node one-shot):**
  | Input (vs 2026-04-21T00:00:00Z) | Expected output |
  |---|---|
  | `2026-04-21T09:00:00.000Z` | `aujourd’hui` |
  | `2026-04-20T09:00:00.000Z` | `hier` |
  | `2026-04-18T09:00:00.000Z` | `il y a 3 jours` |
  | `2026-04-10T14:30:00.000Z` | `il y a 11 jours` |
  | `2026-03-18T09:00:00.000Z` | `il y a 1 mois` |
  | `2025-04-18T09:00:00.000Z` | `il y a 1 an` |
  | `''` or `'not-a-date'` | `''` (empty string — caller may `|| '…'` fallback if desired; 3.1 does not need to because the mock only contains valid ISO strings) |

### Decisions Pinned for This Story (flag if divergence is intentional)

1. **`DossierCard` lives at `components/confluent/`, not `features/dossiers/components/`.** UX spec + Story 2.6 precedent (`DossierField`) take priority over the architecture doc's pre-Epic-2 folder sketch. `components/confluent/` is the home for design-system display primitives. Revisit if/when a `features/dossiers/` folder emerges with hooks / API / mutations in Epic 7.
2. **Mock data stays in-memory (the exported array); no localStorage seeding.** Clicking a dashboard card today lands on the 2.6 "Dossier introuvable" fallback. Story 3.2 is the documented integration point for bridging the mock source to the dossier view. This is an EXPECTED seam, not a bug — the alternative (seeding `confluent_dossier_{slug}` with 12 mock answers per dossier × 2 dossiers) is fixture-sprawl for zero 3.1 user value.
3. **Two primary buttons on the empty state (header + `EmptyState.cta`).** UX spec says "one primary per view"; Epic 3 AC5 explicitly requires the header button to be "always present, complementary". Following the AC. The header button is the persistent "create another" affordance; the empty-state CTA is the contextual "create your first". Concern flagged for UX review if it reads as noisy.
4. **Maturity `Badge` uses `variant="secondary"`.** `default` (near-black, primary-colour) is too heavy next to the 16 px / 500 name and competes for the eye. `outline` is borderline-invisible against `bg-card` (both `#FFFFFF`-family). `secondary` (`bg-secondary` = `#F1F0EE`) reads as a calm classification pill. Re-evaluate if visual review reports low contrast — fallback to `outline` with `border-foreground/30`.
5. **Card navigation target is `/dashboard/dossiers/view/{slug}`, not the epic's `:slug` shorthand.** The route was moved under `view/` in the Story 2.6 code review to avoid sibling-segment collisions (`nouveau`, `view`, future `admin`). The epic AC predates this and uses the bare form. Documented here so a dev agent doesn't "fix" the discrepancy in the wrong direction.
6. **Card root `overflow-hidden` is NOT applied.** The focus ring (`focus-visible:outline-2 focus-visible:outline-offset-2`) must render outside the card boundary. `overflow-hidden` would clip the 2 px ring with 2 px offset. If long-name clipping becomes an issue, use `min-w-0` + `break-words` on descendants instead of card-level overflow. (This is the same reasoning behind 2.5's SectionSummary row pattern.)
7. **Do NOT reuse the shadcn `Card` / `CardHeader` / `CardContent` primitives.** They bake in gaps (`gap-4`), paddings (`px-4`), a `rounded-lg` clip, and a `group/card` container that would fight the `<Link>` root and double the DOM nesting. The `DossierCard` is a raw `<Link>` with the same visual tokens applied inline — cleaner, one-element focus target, no `group/card` collisions with the parent grid. The UX spec's "Card" name in §Design System Components is conceptual, not a binding API.
8. **Grid `<ul>` carries `aria-label="Liste de vos dossiers"`.** Alternative: a visually-hidden `<h2>Vos dossiers</h2>` above the `<ul>`. The `aria-label` is simpler, doesn't add a visual-regression vector, and avoids the "two H2s of same level" question. Revisit if the page grows additional landmark regions (e.g., a "recent activity" panel) that warrant an explicit heading structure.
9. **Relative-date formatter lives in `lib/` with NO caching / memoisation.** Two calls per render (2 cards), computed inside the component — sub-microsecond on any modern device. Re-computing on every render is simpler than a `useMemo` and has zero observable cost. Epic 7 post-API will re-render less frequently (real `dossiers` from a query) and can add memoisation if profiling demands.
10. **Cards are ordered by the fixture's array order** (newest first: Biosensio 2026-04-18 before Agrotrack 2026-04-10). No runtime `sort()`. Keeps the mock as the single source of truth and avoids a subtle bug where two dossiers with identical `createdAt` re-order under sort instability.
11. **`activeShareLinksCount` pluralisation is hand-rolled in `formatAccessLabel`.** French plural agreement is simple for this specific noun (`actif` → `actifs` past 1). No `Intl.PluralRules` dependency — a lightweight if-chain is clearer at the call site and avoids a runtime locale-data concern. Revisit if the copy grows to support more complex patterns.
12. **Commit strategy:** single `feat(epic-3): story 3.1 — dashboard dossier list (mocked)` commit that bundles implementation AND code-review patches (per user memory preference: "Code + review in a single commit", established from Story 2.4 onward).

### References

- Story AC + narrative: [Source: [_bmad-output/planning-artifacts/epics.md](../planning-artifacts/epics.md#L598-L624) §Story 3.1 — Dashboard — Dossier List (Mocked)]
- Epic 3 context (entrepreneur dashboard + access management): [Source: [_bmad-output/planning-artifacts/epics.md](../planning-artifacts/epics.md#L594-L596)]
- `DossierCard` in component strategy (Phase 2 — Dashboard with multiple dossiers): [Source: [_bmad-output/planning-artifacts/ux-design-specification.md](../planning-artifacts/ux-design-specification.md#L633-L638)]
- Component placement in `components/confluent/` with `className` prop: [Source: [_bmad-output/planning-artifacts/ux-design-specification.md](../planning-artifacts/ux-design-specification.md#L612-L617)]
- Button hierarchy (one primary per view, rule + diverge-with-intent): [Source: [_bmad-output/planning-artifacts/ux-design-specification.md](../planning-artifacts/ux-design-specification.md#L642-L651)]
- Typography scale (H1 28 px / H3 16 px): [Source: [_bmad-output/planning-artifacts/ux-design-specification.md](../planning-artifacts/ux-design-specification.md#L349-L357)]
- Accessibility baseline (focus ring, 44 × 44 tap targets, color-plus-label): [Source: [_bmad-output/planning-artifacts/ux-design-specification.md](../planning-artifacts/ux-design-specification.md#L377-L405)]
- Journey 1 dashboard touchpoint: [Source: [_bmad-output/planning-artifacts/ux-design-specification.md](../planning-artifacts/ux-design-specification.md#L441-L462)]
- React Router v7 route registration (real `view/:slug` target): [Source: [apps/web/src/router.tsx](../../../../../apps/web/src/router.tsx#L38-L42)]
- Current `Breadcrumbs` 1-segment short-circuit: [Source: [apps/web/src/components/layout/Breadcrumbs.tsx](../../../../../apps/web/src/components/layout/Breadcrumbs.tsx#L30-L32)]
- Current `DashboardRoute` (to be rewritten): [Source: [apps/web/src/routes/dashboard/index.tsx](../../../../../apps/web/src/routes/dashboard/index.tsx)]
- `EmptyState` component contract: [Source: [apps/web/src/components/confluent/EmptyState.tsx](../../../../../apps/web/src/components/confluent/EmptyState.tsx)]
- `EmptyDossiersIllustration`: [Source: [apps/web/src/components/confluent/illustrations/EmptyDossiersIllustration.tsx](../../../../../apps/web/src/components/confluent/illustrations/EmptyDossiersIllustration.tsx)]
- `Badge` component (variants): [Source: [apps/web/src/components/ui/badge.tsx](../../../../../apps/web/src/components/ui/badge.tsx)]
- `Button` component (`size="lg"` + `h-11 px-4` recipe): [Source: [apps/web/src/components/ui/button.tsx](../../../../../apps/web/src/components/ui/button.tsx); Story 2.2 review patch]
- `DossierField` precedent for `components/confluent/` placement: [Source: [apps/web/src/components/confluent/DossierField.tsx](../../../../../apps/web/src/components/confluent/DossierField.tsx); Story 2.6]
- `data/questionnaire.ts` precedent for `data/` fixture module: [Source: [apps/web/src/data/questionnaire.ts](../../../../../apps/web/src/data/questionnaire.ts)]
- `lib/slugify.ts` precedent for `lib/` pure-utility module: [Source: [apps/web/src/lib/slugify.ts](../../../../../apps/web/src/lib/slugify.ts); Story 2.6]
- Color tokens `--color-status-active` / `--card` / `--border` / `--ring`: [Source: [apps/web/src/index.css](../../../../../apps/web/src/index.css#L52-L90)]
- PRD FR1 / FR2 / FR8 (dossier hold multiple, sector + maturity classification): [Source: [_bmad-output/planning-artifacts/prd.md](../planning-artifacts/prd.md#L393-L400)]

### Latest Technical Information

- **`Intl.RelativeTimeFormat('fr', { numeric: 'auto' })`** — produces "aujourd’hui" / "hier" / "il y a N jours" / "il y a N mois" / "il y a N ans" with the French locale's curly apostrophe (U+2019). All modern browsers ship ES2020 `Intl.RelativeTimeFormat` with full locale data (Chrome 71+, Firefox 65+, Safari 14+). No polyfill required for Epic 3 target browsers.
- **`Intl.RelativeTimeFormat` unit choice** — `'day'` covers 0..~30-day range, `'month'` for 30..365, `'year'` beyond. The step-function in Task 2's skeleton uses 30-day months (not calendar months) — intentional simplicity; users reading "il y a 1 mois" vs "il y a 33 jours" will not distinguish. If exact calendar months matter later (anniversary alerts?), use `date-fns` with `differenceInMonths`. Out of scope for 3.1.
- **`<Link>` as card root** — React Router v7's `<Link>` renders an `<a>` with `href` + a click handler that short-circuits to `navigate()`. All native anchor semantics work: right-click → "Open in new tab", middle-click → background tab, Ctrl/Cmd-click → new tab, keyboard Enter = navigate. A `<button>` root would break all of these.
- **`role="list"` on a Tailwind `<ul>`** — Tailwind v4's preflight sets `list-style: none` on `<ul>` / `<ol>`. Safari + VoiceOver strip the implicit `list` role in that case (known a11y regression across the Tailwind / shadcn ecosystem). Adding `role="list"` explicitly restores the landmark. This is a drop-in, not a conceptual change.
- **Equal-height cards in a grid** — CSS Grid auto-sizes rows to the tallest item by default. Wrapping each card in `<li className="flex">` + `DossierCard className="flex-1"` propagates the row-height down to the card content, so cards in the same row visually align even with different content lengths.
- **`aria-label` on `<Link>` overrides the accessible name derived from children** — by design; screen readers announce the `aria-label` verbatim and skip the children. Keep children naturally readable (visual users see them; mouse hover shows no distinct tooltip).
- **`xl:` breakpoint in Tailwind v4** = 1280 px. Above that width, the grid expands to 3 columns. Below, 2 columns at `md:` (768 px+), 1 column default.
- **`Intl.RelativeTimeFormat` apostrophe** — the "aujourd’hui" output uses U+2019 (right single quotation mark), not U+0027 (ASCII apostrophe). Matches French typographic standards. When copy-pasting the test vectors above into a `grep` or a test assertion, preserve the U+2019.

### Project Context Reference

No `project-context.md` exists at the repo root. Authoritative planning inputs remain the PRD, epics, architecture, and UX spec under `_bmad-output/planning-artifacts/`, plus locked patterns from Stories 1.1 – 2.6 (design tokens, H1 focus-on-mount recipe, `Button size="lg"` tap-target convention, `components/confluent/` placement for design-system primitives, `data/` for static fixtures, `lib/` for pure utilities). User memory index at [../../.claude/projects/-home-coder-confluent/memory/MEMORY.md](../../.claude/projects/-home-coder-confluent/memory/MEMORY.md) notes one active feedback: **bundle story implementation + code-review patches into a single commit** (applied to the Task 6 finalisation step in Pinned Decision #12).

## Dev Agent Record

### Agent Model Used

claude-opus-4-7

### Debug Log References

- `pnpm turbo run typecheck`: 2 successful, 0 errors. New exports `MockDossier`, `MOCK_DOSSIERS`, `formatRelativeDate`, `DossierCard`, `DossierCardProps` all compile cleanly under TS strict. `@confluent/api` cache-hit; `@confluent/web` cache-miss but 0 errors.
- `pnpm turbo run lint`: 2 successful, 0 errors. 3 tolerated pre-existing warnings (`badge.tsx:52`, `button.tsx:58`, `features/current-user/context.tsx:17` — all `react-refresh/only-export-components`). Zero new warnings.
- `pnpm turbo run build`: 2 successful, 0 errors. Build time 4.0 s. 1794 modules transformed (+3 vs 2.6 baseline: `mock-dossiers`, `relative-date`, `DossierCard`).
- Bundle delta vs Story 2.6 post-patches baseline (44.37 kB / 8.65 kB gzip CSS; 346.49 kB / 109.47 kB gzip JS):
  - CSS: 45.33 kB (gzip 8.80 kB) → +0.96 kB raw, +0.15 kB gzip — new Tailwind utilities for `grid-cols-*`, `min-w-0`, `break-words`, `shrink-0`, `self-start`, `xl:grid-cols-3`, `flex-wrap`, `self-auto`, etc.
  - JS: 351.48 kB (gzip 110.62 kB) → +4.99 kB raw, +1.15 kB gzip — `MOCK_DOSSIERS` fixture, `formatRelativeDate`, `DossierCard`, dashboard rewrite.
  - Both within story envelope (+~0.2 kB gzip CSS, +~1.2–1.8 kB gzip JS).
- `formatRelativeDate` Node one-shot verification vs `2026-04-21T00:00:00Z` — 8/8 pass against the in-code comment vectors. Three story-spec "expected" values in the §Testing Requirements table turned out to be documentation-side miscomputations (see Completion Note #5) — the utility itself is behaving exactly as `Intl.RelativeTimeFormat('fr', { numeric: 'auto' })` specifies.
- Self-review grep `grep -nE '#[0-9a-fA-F]{3,6}'` across `DossierCard.tsx`, `routes/dashboard/index.tsx`, `mock-dossiers.ts`, `relative-date.ts` → zero matches. All colour surfaces reference token utilities.

### Completion Notes List

1. **`MOCK_DOSSIERS` landed at `apps/web/src/data/mock-dossiers.ts`** — two entries (`Biosensio`, `Agrotrack`) with hardcoded ISO `createdAt` strings so the "il y a N jours" copy stays deterministic across sessions. Array order IS render order (newest first). Pattern mirrors `data/questionnaire.ts`.
2. **`formatRelativeDate` landed at `apps/web/src/lib/relative-date.ts`** — pure utility, injectable `now` for testability. Step-function on `|days|`: < 30 → `day`; < 12 months → `month`; otherwise → `year`. Invalid input (`''`, `'not-a-date'`) returns `''`. Test-vector comment block kept current with actual `Intl.RelativeTimeFormat('fr', { numeric: 'auto' })` outputs.
3. **`DossierCard` landed at `apps/web/src/components/confluent/DossierCard.tsx`** — `<Link>` root (single focusable target, right-click / middle-click / Cmd-click all work natively). Aggregated `aria-label` composes name + sector + maturity + access label + relative date for single-pass screen-reader announcement. Inner layout: header row (name + Badge maturity, `items-start justify-between`), sector line, bottom meta row (access + separator + relative date) with `mt-auto` so the meta row pins to the bottom edge when cards equalise in height. `min-h-11` ensures 44 px tap target. `shrink-0` on Badge locks it against name-line wrapping. `min-w-0 break-words` on `<h3>` defeats long-name overflow at 320 px.
4. **`routes/dashboard/index.tsx` rewritten** — header flex row (`flex-col sm:flex-row sm:items-center sm:justify-between gap-4`) carries the H1 and the "Créer un dossier" button. H1 uses the 2.5/2.6 focus-on-mount recipe (`useRef` + `useEffect(() => headingRef.current?.focus(), [])` + `tabIndex={-1}` + `focus-visible:outline-none`). Content branches on `dossiers.length > 0` with a strict ternary: populated path renders `<ul role="list" aria-label="Liste de vos dossiers">` with `grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3`; empty path renders the existing `EmptyState` (Story 2.2) unchanged. Header button stays visible on both branches (AC5).
5. **`formatRelativeDate` test-vector documentation discrepancy** — the story's §Testing Requirements table listed `"il y a 11 jours"` / `"il y a 1 mois"` / `"il y a 1 an"` for three inputs, but `Intl.RelativeTimeFormat('fr', { numeric: 'auto' })` actually produces `"il y a 10 jours"` (round-10 days, not 11) / `"le mois dernier"` (idiomatic French at -1 month) / `"l’année dernière"` (idiomatic French at -1 year). The utility is correct; the story's expected values were documentation-side miscomputations. The in-code comment in `relative-date.ts` was updated to reflect actual outputs. These idiomatic French forms ("hier", "le mois dernier", "l’année dernière") are exactly the motivation for `numeric: 'auto'` and read more naturally than numeric equivalents. Not a code change.
6. **Mock navigation → 2.6 fallback is EXPECTED** — clicking a card today navigates to `/dashboard/dossiers/view/biosensio` (or `agrotrack`), and the 2.6 dossier view renders its "Dossier introuvable" fallback because the mocks are not seeded into `localStorage` (Pinned Decision #2). Story 3.2 is the documented integration point.
7. **All 12 ACs verified against implementation:** AC1 (card anatomy: name/sector/badge/access/date) ✓, AC2 (strict ternary branch) ✓, AC3 (Link to `view/:slug`) ✓, AC4 (responsive grid + `min-h-11` + `min-w-0 break-words`) ✓, AC5 (header button always present) ✓, AC6 (title tag, H1 recipe, focus-on-mount, header flex row) ✓, AC7 (array order = render order; Biosensio before Agrotrack) ✓, AC8 (Link root, aria-label, card styling, no nested interactives) ✓, AC9 (Tab H1 → button → card 1 → card 2 → footer) ✓, AC10 (H1 announced first, `<ul role="list">`, `aria-label`, badge readable) ✓, AC11 (no localStorage seed; 2.6 fallback on click) ✓, AC12 (breadcrumb auto-suppress via 1-segment short-circuit) ✓.
8. **Self-review sweep results** — no raw hex in new files (zero `#[0-9a-fA-F]{3,6}` hits); `<Link>` is card root (no nested `<button>` / `<a>`); `<ul>` carries `role="list"` (Tailwind-v4 `list-style: none` would otherwise strip the implicit role in Safari/VoiceOver); `focus-visible:outline-none` is scoped to the H1 only (the card keeps its focus ring). All Pinned Decisions (#1–#12) honoured, none overturned during implementation.
9. **No regression on Stories 1.1–2.6** — Task 4 touches only `routes/dashboard/index.tsx`; `/dashboard/tableau-de-bord`, `/dashboard/dossiers/nouveau`, the 2.4/2.5/2.6 questionnaire/completion/dossier flows, `AppShell`, `Breadcrumbs`, `EmptyState`, `Button`, `Badge` are all untouched. Header `Créer un dossier` and empty-state CTA both navigate to `/dashboard/dossiers/nouveau`, preserving the 2.3 naming step entry.
10. **Visual verification pending (recommended before merge):** tri-viewport walkthrough (375 / 900 / 1440 px) per the §Task 5 sub-steps, axe audit on populated / empty / focused card / long-name-probe states, VoiceOver/NVDA sanity (aria-label read-through on each card), `prefers-reduced-motion` toggle (no animations affected here — no motion added in 3.1). Programmatic signals (typecheck / lint / build) are all green.

### File List

**Created:**
- `apps/web/src/data/mock-dossiers.ts` — static fixture (`MockDossier` interface + `MOCK_DOSSIERS` readonly array with 2 entries).
- `apps/web/src/lib/relative-date.ts` — pure `formatRelativeDate(iso, now?)` utility via `Intl.RelativeTimeFormat('fr', { numeric: 'auto' })`.
- `apps/web/src/components/confluent/DossierCard.tsx` — design-system card primitive (`<Link>` root, aggregated `aria-label`, `Badge` maturity, `formatAccessLabel` pluralisation).

**Modified:**
- `apps/web/src/routes/dashboard/index.tsx` — full rewrite: added header flex row with always-present "Créer un dossier" button, added focus-on-mount on H1, added `<ul role="list">` grid of `DossierCard`s with strict ternary branch against `EmptyState` on empty fixture.

**Unchanged (verified — touched by no task):**
- `apps/web/src/router.tsx`, `apps/web/src/components/layout/*`, `apps/web/src/components/ui/*`, `apps/web/src/components/confluent/{DossierField,EmptyState,WizardInput}.tsx`, `apps/web/src/components/confluent/illustrations/*`, `apps/web/src/data/questionnaire.ts`, `apps/web/src/lib/{sanitize,slugify,utils}.ts`, `apps/web/src/features/**`, `apps/web/src/routes/dashboard/{tableau-de-bord,dossiers}/**`.

### Change Log

- **2026-04-21** — Story 3.1 implementation landed. New files: `data/mock-dossiers.ts`, `lib/relative-date.ts`, `components/confluent/DossierCard.tsx`. Modified: `routes/dashboard/index.tsx`. Typecheck / lint / build all green. Bundle delta within spec envelope. 12/12 ACs satisfied. Status: `ready-for-dev` → `in-progress` → `review`.
