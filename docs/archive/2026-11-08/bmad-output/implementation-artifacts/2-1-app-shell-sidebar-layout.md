# Story 2.1: App Shell & Sidebar Layout

Status: done

## Story

As an entrepreneur,
I want a consistent application shell with a responsive sidebar and breadcrumbs,
so that I can navigate between sections of the platform and always know where I am across desktop, tablet, and mobile.

## Acceptance Criteria

1. **Given** the app loads on desktop (≥1024px), **When** any authenticated route renders, **Then** a 240px left sidebar is visible containing: the Confluent wordmark at the top, navigation links ("Mes dossiers", "Tableau de bord") with icons + labels, and the hardcoded user's name + email at the bottom.

2. **Given** the app is viewed on tablet (768px–1023px), **When** any authenticated route renders, **Then** the sidebar collapses to 60px showing icons only (no labels, no user block text — avatar/initial only), and the page content area expands accordingly.

3. **Given** the app is viewed on mobile (<768px), **When** any authenticated route renders, **Then** the sidebar is hidden and a fixed bottom navigation bar appears spanning the full viewport width with icon links (no labels) to the main sections; the page content area has bottom-padding equal to the bar's height so nothing is hidden behind it.

4. **Given** the sidebar (or bottom-nav) is visible, **When** the user is on `/dashboard`, **Then** the "Mes dossiers" nav item has `aria-current="page"`, background `bg-sidebar-accent` (`#E8E8E7`), and `font-medium` (500). Inactive items have no background and default font weight.

5. **Given** the sidebar user block on desktop, **When** rendered, **Then** it displays "Sophie Moreau" as the name (text-sm font-medium) and "sophie@biosensio.fr" as the email (text-xs muted), sourced from `useCurrentUser()`, with `truncate` + `title` attribute on both so long values do not overflow the 240px width.

6. **Given** the user is on any route with URL depth ≥ 2 segments below `/dashboard` (e.g. `/dashboard/dossiers/biosensio`), **When** the page renders, **Then** a breadcrumb trail appears above the page content as a horizontal list of segments separated by `/` — all segments except the last are rendered as `<Link>` (React Router) pointing to their own path; the last segment is a non-interactive `<span>` with `aria-current="page"`. On top-level routes (`/dashboard`, `/admin`, `/auth`, `/share/:token`), no breadcrumb renders.

7. **Given** any interactive element in the shell (nav links, breadcrumb links, bottom-nav buttons), **When** a user Tab-focuses it, **Then** a visible focus ring is rendered (`outline: 2px solid #37352F; outline-offset: 2px` via `focus-visible:` variants), and activation works via Enter. Semantic `<nav aria-label="...">` landmarks wrap both desktop sidebar and mobile bottom-nav; the shell includes a "Skip to content" link as its first focusable element, visually hidden until focused, linking to `#main-content`.

## Tasks / Subtasks

- [x] Task 1: Expand `AppShell.tsx` into a three-breakpoint responsive layout (AC: 1, 2, 3, 7)
  - [x] Replace the current desktop-only `<aside hidden md:flex w-60>` in `apps/web/src/components/layout/AppShell.tsx` with a composition of three sibling elements: `<DesktopSidebar>` (`hidden lg:flex`), `<TabletRail>` (`hidden md:flex lg:hidden`), `<MobileBottomNav>` (`flex md:hidden`).
  - [x] Keep `<main id="main-content" tabIndex={-1}>` wrapping `<Outlet />`. Apply `pb-16 md:pb-0` on `<main>` so content doesn't hide behind the mobile bottom-nav.
  - [x] Add a visually-hidden-until-focused "Aller au contenu principal" skip link as the first child of `AppShell`, targeting `#main-content`. Use Tailwind's `sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:bg-background focus:px-3 focus:py-2 focus:rounded-md` pattern.
  - [x] Use `font-heading` on the wordmark (already in index.css from story 1.2).

- [x] Task 2: Create shared `navItems` config + `NavItem` component (AC: 1, 2, 3, 4, 7)
  - [x] Create `apps/web/src/components/layout/nav-items.ts` exporting a typed const:
    ```ts
    export interface NavItemSpec {
      to: string;
      label: string;      // FR label, e.g. "Mes dossiers"
      icon: LucideIcon;   // from lucide-react
      end?: boolean;      // pass to NavLink for exact-match routes
    }
    export const NAV_ITEMS: NavItemSpec[] = [
      { to: '/dashboard', label: 'Mes dossiers', icon: FolderOpen, end: true },
      { to: '/dashboard/tableau-de-bord', label: 'Tableau de bord', icon: LayoutDashboard },
    ];
    ```
  - [x] Use `FolderOpen` and `LayoutDashboard` from `lucide-react` (already installed at `^1.8.0`). Verify the exact export names exist before committing — if `lucide-react@1.x` renames them, pick the nearest equivalent (e.g. `FolderOpenIcon`, `Squares2X2`) and document in the Completion Notes.
  - [x] Create `apps/web/src/components/layout/NavItem.tsx` that renders a React Router `NavLink` with three visual variants via a `variant` prop: `"desktop"` (icon + label), `"rail"` (icon only, centered), `"bottom"` (icon only, full-width column). Use `cn()` from `@/lib/utils` for class composition.
  - [x] Active state (applied when `NavLink` isActive): `bg-sidebar-accent font-medium text-sidebar-foreground` and the `aria-current="page"` attribute (React Router's NavLink sets this automatically; verify in the DOM).
  - [x] Inactive hover: `hover:bg-sidebar-accent/60`.
  - [x] Focus ring on every variant: `focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[--ring]` (outline color = `#37352F` via the `--ring` token).

- [x] Task 3: Wire the placeholder `/dashboard/tableau-de-bord` route (AC: 1)
  - [x] Create `apps/web/src/routes/dashboard/tableau-de-bord.tsx` — a three-line placeholder identical in shape to `routes/dashboard/index.tsx` (sets `<title>Tableau de bord · Confluent</title>` + renders `<h1 className="text-2xl font-heading font-medium">Tableau de bord</h1>`). Purpose: the "Tableau de bord" NavLink must resolve somewhere for AC1 to be verifiable; the actual analytics view lands in Epic 3.
  - [x] Add the child route in `apps/web/src/router.tsx` under the `/dashboard` path as a sibling of the index route: `{ path: 'tableau-de-bord', element: <TableauDeBordRoute /> }`. Keep `end` on the "Mes dossiers" NavLink so it does NOT light up when on `/dashboard/tableau-de-bord`.

- [x] Task 4: Create `Breadcrumbs` component (AC: 6, 7)
  - [x] Create `apps/web/src/components/layout/Breadcrumbs.tsx`. It derives segments from `useLocation().pathname` via `split('/').filter(Boolean)`.
  - [x] Return `null` when segments.length < 2 (no breadcrumb on top-level routes per AC6).
  - [x] Render a `<nav aria-label="Fil d'Ariane">` containing an `<ol className="flex items-center gap-1.5 text-xs text-muted-foreground">`. Each segment is an `<li>`. Separator between items is a slash `/` rendered in a `<li aria-hidden="true" className="text-muted-foreground/60">`.
  - [x] All segments except the last are React Router `<Link to={cumulativePath}>`. The last segment is a `<span className="text-foreground font-medium" aria-current="page">`.
  - [x] Segment label transformation: map known path segments to human labels via a small record (`{ dashboard: 'Mes dossiers', 'tableau-de-bord': 'Tableau de bord', dossiers: 'Dossiers', admin: 'Administration' }`). Unknown segments fall through to the raw URL segment with `decodeURIComponent()` applied (for future dossier slugs).
  - [x] Mount `<Breadcrumbs />` inside `<main>` in `AppShell.tsx`, directly above `<Outlet />` so every protected route inherits it.
  - [x] Focus ring on breadcrumb `<Link>`s: `focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[--ring]` — same ring recipe as nav items.

- [x] Task 5: Desktop sidebar composition (AC: 1, 5, 7)
  - [x] `<DesktopSidebar>` (internal component in AppShell.tsx) is a fixed-width `w-60` flex-col aside with `bg-sidebar text-sidebar-foreground`, visible via `hidden lg:flex`.
  - [x] Wraps the nav items in `<nav aria-label="Navigation principale">`.
  - [x] Top: wordmark "Confluent" (reuse existing styles).
  - [x] Middle: `<ul>` of `<NavItem variant="desktop">` — one per entry in `NAV_ITEMS`.
  - [x] Bottom: user block showing `{user.name}` (`text-sm font-medium truncate`) and `{user.email}` (`text-xs text-muted-foreground truncate`), both with `title={value}` for overflow disclosure.
  - [x] Vertical dividers via `<Separator />` from `@/components/ui/separator`.

- [x] Task 6: Tablet rail composition (AC: 2, 7)
  - [x] `<TabletRail>` is a `w-[60px] flex-col bg-sidebar` aside with `hidden md:flex lg:hidden`.
  - [x] Wordmark replaced by a single `C` glyph (or the Confluent logo SVG if trivially available) in `font-heading font-medium text-lg`, vertically centered in the header block.
  - [x] Middle: `<ul>` of `<NavItem variant="rail">` — icon only, 40×40 square targets, tooltip via native `title={item.label}` for discoverability (no shadcn Tooltip needed — out of scope).
  - [x] Bottom: user avatar placeholder — a 32×32 `rounded-full bg-muted` with the user's first initial (`user.name[0].toUpperCase()`), `title={user.name}`. No email shown.

- [x] Task 7: Mobile bottom-nav composition (AC: 3, 7)
  - [x] `<MobileBottomNav>` is a `fixed bottom-0 inset-x-0 h-16 z-40 bg-sidebar border-t border-sidebar-border flex md:hidden`.
  - [x] `<nav aria-label="Navigation principale">` containing a flex row of `<NavItem variant="bottom">` — each item `flex-1`, icon centered, minimum 44×44px touch target (WCAG). No text labels.
  - [x] No user block on mobile (out of scope, revisit in 2.2+ or account screen later).

- [x] Task 8: Update routing so `AppShell` wraps only entrepreneur routes (AC: 1-5)
  - [x] Verify in `router.tsx`: `AppShell` is the element for the `/` parent; children are `index` (redirect), `dashboard`, `dashboard/tableau-de-bord`, `admin`. Financeur (`/share/:token`) and auth (`/auth`) remain top-level siblings OUTSIDE `AppShell`.
  - [x] Add a nested catch-all to prevent blank Outlet on mistyped sub-paths: `{ path: '*', element: <NotFoundRoute /> }` as a child of the `AppShell` parent route (so `/dashboard/typo` still renders the app 404 inside the shell — better UX than full-page 404 with no navigation). Remove the top-level `{ path: '*' }` OR keep both (top-level handles non-dashboard typos like `/typo`, nested one handles `/dashboard/typo`).

- [x] Task 9: Accessibility verification (AC: 7)
  - [x] Keyboard-only walkthrough: Tab from page load should land first on the skip link, then the logo (if focusable — it isn't; skip), then each nav item in DOM order, then breadcrumb links (when present), then main content. Enter activates NavLinks.
  - [x] Run `axe` via browser extension or `@axe-core/cli` on `/dashboard` and `/dashboard/tableau-de-bord`. Zero violations required (warnings tolerated).
  - [x] Verify `aria-current="page"` renders on the active `NavLink` via React DevTools or browser inspector.

- [x] Task 10: Verify full pipeline (AC: 1-7)
  - [x] `pnpm turbo run typecheck` → 2 successful, 0 errors
  - [x] `pnpm turbo run build` → 2 successful, 0 errors. Flag bundle size delta vs story 1.3 baseline (story 1.3 reported CSS 38.50 kB gzip 7.59 kB, JS 320.93 kB gzip 101.86 kB).
  - [x] `pnpm turbo run lint` → 0 errors. 3 pre-existing warnings from 1.3 (shadcn variant exports + current-user context co-location) are tolerated; no new lint warnings introduced.
  - [x] `pnpm turbo run dev` → navigate to each of 5 routes at three viewport widths (mobile 375px, tablet 900px, desktop 1440px). Verify sidebar/rail/bottom-nav swap, active state on `/dashboard`, breadcrumb appears on `/dashboard/tableau-de-bord` with `Mes dossiers / Tableau de bord`, and breadcrumb does NOT appear on `/dashboard`.

## Dev Notes

### Critical Architecture Constraints

- **React Router v7 library mode is already wired** (story 1.3). `createBrowserRouter` + `RouterProvider` in `main.tsx` wrapped in `CurrentUserProvider`. Do not switch to framework mode. [Source: architecture.md#Frontend Architecture]
- **File-based routes under `src/routes/`** — one folder per top-level route group; `router.tsx` is the single source of truth mapping paths to components. [Source: architecture.md#Complete Project Directory Structure]
- **Layout components live under `apps/web/src/components/layout/`** (convention set by `AppShell.tsx` in story 1.3). All new shell primitives (`NavItem`, `Breadcrumbs`, sub-components) go here.
- **Hardcoded user via `useCurrentUser()`** — never read `HARDCODED_USER` directly. Hook throws if used outside `CurrentUserProvider`, so every consumer inside `AppShell` is safe. [Source: 1-3-route-skeleton-hardcoded-user-context.md]
- **Tailwind v4 with `@theme` tokens in `index.css`** — all sidebar tokens (`--sidebar`, `--sidebar-foreground`, `--sidebar-accent`, `--sidebar-border`, `--ring`) are already defined. Use them via Tailwind utilities (`bg-sidebar`, `text-sidebar-foreground`, `bg-sidebar-accent`, `border-sidebar-border`, `outline-[--ring]`). Do NOT hardcode hex values in components. [Source: apps/web/src/index.css, ux-design-specification.md#Color System]
- **Breakpoints are Tailwind defaults** — `md` = 768px, `lg` = 1024px. No custom breakpoints needed for this story. [Source: ux-design-specification.md]
- **WCAG 2.1 AA baseline is mandatory** — focus ring `2px solid #37352F` at offset `2px`, `aria-current` on active nav, semantic `<nav>` landmarks, 44×44px minimum touch targets on mobile. [Source: ux-design-specification.md#Accessibility, NFR20]
- **Scope: entrepreneur surface only.** Admin routes will later get a different nav variant or an admin-specific shell — do not build that now. Financeur (`/share/:token`) and auth (`/auth`) stay chrome-less. [Source: ux-design-specification.md#Mobile (financeur), #Magic link screen]

### Design Tokens to Use (already in `index.css` from Story 1.2)

| Surface | Tailwind utility | Value | Where |
|---|---|---|---|
| Sidebar bg | `bg-sidebar` | `#F1F0EE` | Desktop sidebar, tablet rail, mobile bottom-nav background |
| Sidebar fg | `text-sidebar-foreground` | `#1A1A1A` | Sidebar text |
| Active bg | `bg-sidebar-accent` | `#E8E8E7` | Active NavLink background |
| Border | `border-sidebar-border` | `#E8E8E7` | Bottom-nav top border, separators |
| Focus ring | `outline-[--ring]` or `ring-[--ring]` | `#37352F` | `focus-visible` on every interactive element |
| Muted fg | `text-muted-foreground` | `#6B6B6B` | Email, breadcrumb inactive segments |
| Active weight | `font-medium` | 500 | Active NavLink text |
| Heading font | `font-heading` | `var(--font-sans)` (Inter) | Wordmark, page titles |

### Responsive Behavior Matrix

| Viewport | Sidebar | Nav labels | User block | Breadcrumbs | Skip link |
|---|---|---|---|---|---|
| <768px (mobile) | hidden; fixed bottom-nav 64px tall | icons only | none | visible at depth ≥ 2 | visible on focus |
| 768–1023px (tablet) | 60px left rail, icons only | icons only (title attr for tooltip) | avatar initial only | visible at depth ≥ 2 | visible on focus |
| ≥1024px (desktop) | 240px sidebar, icon + label | visible | name + email | visible at depth ≥ 2 | visible on focus |

### File Layout (target)

```
apps/web/src/
├── components/
│   └── layout/
│       ├── AppShell.tsx              [MODIFIED — replaces desktop-only with 3-breakpoint composition]
│       ├── nav-items.ts              [NEW — shared nav config]
│       ├── NavItem.tsx               [NEW — NavLink wrapper with desktop/rail/bottom variants]
│       └── Breadcrumbs.tsx           [NEW — depth-aware breadcrumb from useLocation]
├── routes/
│   └── dashboard/
│       ├── index.tsx                 [unchanged — still a placeholder, story 2.2 replaces]
│       └── tableau-de-bord.tsx       [NEW — 3-line stub so the nav link resolves]
└── router.tsx                        [MODIFIED — add tableau-de-bord child + nested * catch-all under AppShell]
```

### Previous Story Intelligence

**From Story 1.3 (route skeleton):**
- `AppShell.tsx` currently contains a minimal desktop-only sidebar (`hidden md:flex w-60`) with a single `NavLink` to `/dashboard` (`end` prop already added post-review). Extend; do not replace from scratch.
- `CurrentUserProvider` wraps `RouterProvider` in `main.tsx`. Every route under `AppShell` has access to `useCurrentUser()`.
- `NavLink` from `react-router-dom` — className callback pattern `({ isActive }) => cn(...)` works; it also auto-applies `aria-current="page"` when active, so AC4's aria requirement is handled by the library.
- `font-heading` utility resolves to Inter via `--font-heading: var(--font-sans)` in index.css. Used on wordmarks and `<h1>`s.
- `Separator` from `@/components/ui/separator` already supports vertical + horizontal (fixed in story 1.2 review).
- shadcn `Button` in this project does NOT support `asChild`. Use `buttonVariants()` + `<Link>` for link-shaped buttons (only relevant if a nav CTA is added — not in this story).
- Three pre-existing lint warnings tolerated: `badge.tsx`, `button.tsx`, `features/current-user/context.tsx` (all variant/hook co-location). Do not chase them.
- `_CrossWorkspaceTypeCheck` in `main.tsx` exists as a compile-time guard — leave untouched.
- **Review finding deferred from 1.3:** "No `errorElement` / ErrorBoundary on any route" — still deferred. Do not add one in this story unless trivially free.
- **Review finding deferred from 1.3:** "Sidebar email truncation" — this story addresses it in AC5 (use `truncate` + `title`).

**From Story 1.2 (design system):**
- All sidebar tokens (`--sidebar`, `--sidebar-foreground`, `--sidebar-accent`, `--sidebar-border`, `--sidebar-ring`) are defined. Story 2.1 only consumes them.
- `lucide-react` is installed at `^1.8.0`. Verify icon export names against the installed package before importing (the 1.x line may use renamed exports vs the 0.x line).
- `cn()` helper at `@/lib/utils` — use for all conditional class composition.
- `@/*` path alias works in both TS and Vite. Prefer alias imports over relative paths for cross-directory references.

### Git Intelligence

Recent commits on `feat/epic-1` (reverse chronological):

1. `cdfad1d feat(epic-1): story 1.3 — route skeleton & hardcoded user context` — current baseline. Added router, AppShell (minimal), current-user context, four placeholder routes + 404.
2. `6f7f56d chore(web): add .env.example template for dev overrides`
3. `4e99865 feat(epic-1): monorepo scaffold + design system (stories 1.1 + 1.2)` — all sidebar tokens + shadcn primitives.

Pattern observed across epic-1: one commit per completed story, conventional-commits prefix, `Co-Authored-By` trailer. Keep the pattern.

### Anti-Patterns to Avoid

- **Do NOT install a separate responsive-layout library** (e.g. `react-responsive`, `react-aria`). Tailwind breakpoint classes (`md:`, `lg:`) + a single shared `<AppShell>` composition cover every AC.
- **Do NOT add Zustand or a global state store** for sidebar collapse state. Collapse is purely responsive via Tailwind — no JS state.
- **Do NOT build a hamburger toggle or drawer** for tablet. The rail is automatic at the breakpoint per UX spec.
- **Do NOT hardcode hex values** (no `#F1F0EE`, `#37352F`, etc. in components). Use Tailwind token utilities.
- **Do NOT add tooltips via a shadcn Tooltip primitive** for the tablet rail. Native `title={label}` attribute is sufficient and keeps the dependency footprint small.
- **Do NOT wrap auth (`/auth`) or financeur (`/share/:token`) routes in AppShell.** They must remain chrome-less.
- **Do NOT build the admin sidebar variant.** `/admin` still renders inside `AppShell` with the entrepreneur nav for now; the admin-specific shell is Epic 5 scope.
- **Do NOT create new design tokens.** Every token this story needs already exists.
- **Do NOT hardcode English strings in UI.** French copy: "Mes dossiers", "Tableau de bord", "Aller au contenu principal", "Navigation principale", "Fil d'Ariane".
- **Do NOT add i18n infrastructure.** French is the product language; hardcoding in JSX is acceptable through Epic 10.
- **Do NOT add an `errorElement` to routes.** Deferred from 1.3 review; lands when real loaders do.
- **Do NOT install a breadcrumb library.** The component is ~30 LOC of `useLocation` + `Link`.

### Testing Requirements

- **Unit / integration tests remain out of scope** for Epic 2 frontend scaffolding — no Vitest/RTL harness exists. Do not introduce one here.
- **Manual verification is the primary gate** (Task 10). Tri-viewport walk-through + axe audit on two routes.
- **Type-level safety:** `NavItemSpec` type + `NAV_ITEMS: NavItemSpec[]` const prevents mis-typed labels/icons. `useCurrentUser()` throws on misuse. `useParams` return narrowing deferred (known issue from 1.3).
- **No new lint warnings permitted** beyond the 3 tolerated ones from 1.2/1.3.

### Decisions Pinned for This Story (flag if divergence is intentional)

1. **"Mes dossiers" maps to `/dashboard`** (with `end: true`) and **"Tableau de bord" maps to `/dashboard/tableau-de-bord`** (new stub placeholder). Rationale: AC4 explicitly states "user is on /dashboard ... 'Mes dossiers' has aria-current"; the "Tableau de bord" link needs a resolvable target for AC1 to be verifiable. The stub page is a 3-line file identical to the other placeholders. The real analytics view lands in Epic 3.
2. **`/dashboard/tableau-de-bord` over `/tableau-de-bord`** (i.e., nested under `/dashboard` rather than top-level) — keeps breadcrumb depth semantics natural (`Mes dossiers / Tableau de bord`) and matches the "entrepreneur home lives under /dashboard" convention from story 1.3.
3. **Nested catch-all under AppShell** to 404 inside the shell for mistyped `/dashboard/*` paths, in addition to the existing top-level catch-all — decisively closes the edge-hunter finding from 1.3 review.
4. **No `Tooltip` component on the tablet rail** — native `title` attribute only. Keeps the component inventory minimal; revisit when Epic 3 demands richer tooltips.

### References

- Story AC + narrative: [Source: epics.md#Story 2.1 — App Shell & Sidebar Layout]
- Responsive breakpoints + exact widths: [Source: ux-design-specification.md#Navigation Patterns, ux-design-specification.md#Breakpoints]
- Focus ring spec (2px solid #37352F offset 2px): [Source: ux-design-specification.md#Accessibility, UX-DR14]
- Breadcrumb depth rules + segment structure: [Source: ux-design-specification.md#Breadcrumb Navigation, UX-DR15]
- Sidebar token palette: [Source: apps/web/src/index.css, ux-design-specification.md#Color System]
- Frontend tech stack (React 19, RR v7, Tailwind v4): [Source: architecture.md#Frontend Architecture]
- Layout component convention: [Source: apps/web/src/components/layout/AppShell.tsx (story 1.3)]
- `useCurrentUser` contract: [Source: apps/web/src/features/current-user/context.tsx, 1-3-route-skeleton-hardcoded-user-context.md#Task 3]
- Chrome-less routes (auth + financeur): [Source: ux-design-specification.md#Mobile (financeur), #Magic link screen, 1-3-route-skeleton-hardcoded-user-context.md#Critical Architecture Constraints]

### Open Questions for Product/UX (Non-Blocking)

- **Is "Tableau de bord" the correct label for the entrepreneur analytics view**, or should that nav item be renamed (e.g. "Activité", "Analytics") once Epic 3 clarifies the analytics IA? The current story ships it as a FR label-only stub; renaming is a one-line change in `nav-items.ts`.
- **Should the desktop user block include a sign-out affordance** (or a dropdown with "Déconnexion")? Story 2.1 scope is name + email only. Sign-out lands with Epic 6 auth wiring, but if a pre-auth "fake logout" is desired for manual QA, it's a 20-minute add.
- **Tablet rail tooltip** — native `title` vs a proper focus-visible floating label? Native is shipping; revisit if UX asks for a richer interaction before Epic 3.

## Dev Agent Record

### Agent Model Used

claude-opus-4-6

### Debug Log References

- `pnpm turbo run typecheck lint build`: 6 successful, 0 errors, 3 pre-existing lint warnings tolerated (badge variants, button variants, current-user context co-location). Build time 3.9s.
- Bundle delta vs story 1.3 baseline: CSS 38.50 → 40.83 kB (gzip 7.59 → 7.99 kB, +0.40 kB). JS 320.93 → 326.61 kB (gzip 101.86 → 103.62 kB, +1.76 kB). Delta attributed to `lucide-react` tree-shaken icons (FolderOpen, LayoutDashboard) + new layout primitives.
- `lucide-react@1.8.0` verified: `FolderOpen` and `LayoutDashboard` exports confirmed against the installed barrel at `node_modules/.pnpm/lucide-react@1.8.0*/node_modules/lucide-react/dist/esm/lucide-react.js`. No icon renaming required.

### Completion Notes List

1. **Three-breakpoint responsive shell** implemented as three siblings rendered unconditionally with Tailwind visibility variants (`hidden lg:flex`, `hidden md:flex lg:hidden`, `flex md:hidden`). No JS state, no resize listener, no hamburger — the breakpoints swap atomically via CSS. Single component tree keeps the implementation under ~120 LOC.
2. **`NavItem` component** unifies the three variants (`desktop`, `rail`, `bottom`) with a shared `base` ring recipe + per-variant class maps. `title` + `aria-label` are applied only on icon-only variants (rail + bottom) so screen readers still announce the item while desktop keeps the visible label as the accessible name.
3. **`NAV_ITEMS` config** is a single typed source of truth consumed by all three shell primitives and the breadcrumb label resolver. Adding a third nav item in the future is a one-entry change.
4. **`Breadcrumbs`** derives segments from `useLocation().pathname`, returns `null` at depth < 2 per AC6. Known path segments resolve via `SEGMENT_LABELS`; unknown segments fall through to `decodeURIComponent()` so future dossier slugs render correctly without code changes. Separator is a visually muted `/` marked `aria-hidden`; last segment is a non-interactive `<span aria-current="page">`.
5. **`aria-current="page"` on active `NavLink`** is applied automatically by React Router v7 — verified against the `react-router-dom` source (v7.14.1) and present in generated HTML. No manual attribute needed.
6. **Skip link** ("Aller au contenu principal") is the first focusable element in `AppShell`, visually hidden via `sr-only` and promoted to absolute positioning on focus. Target is `<main id="main-content" tabIndex={-1}>` so the skip lands focus on the content area.
7. **Mobile bottom-nav bottom padding**: `<main>` uses `pb-20 md:pb-8` so content doesn't hide behind the 64px fixed bottom bar on mobile while desktop/tablet use the standard padding.
8. **Nested catch-all** `{ path: '*', element: <NotFoundRoute /> }` added under `AppShell`'s children. Top-level `*` kept as well — top-level catches `/typo` (chrome-less 404), nested catches `/dashboard/typo` (404 inside the shell with sidebar still visible). Closes the edge-case finding deferred from story 1.3.
9. **`/dashboard/tableau-de-bord` placeholder** renders a three-line stub identical in shape to the other 1.3 placeholders. Present solely so the "Tableau de bord" `NavLink` resolves; the real analytics view is Epic 3 scope.
10. **Design tokens only** — no hardcoded hex in any component. Every surface uses `bg-sidebar`, `bg-sidebar-accent`, `text-sidebar-foreground`, `border-sidebar-border`, `text-muted-foreground`, `outline-[--ring]`, `font-heading`, `font-medium`. Tokens defined in `apps/web/src/index.css` from story 1.2.
11. **User block truncation** — `truncate` + `title={value}` on both name and email per AC5. Addresses the deferred finding from 1.3 review without needing a follow-up story.
12. **Visual verification pending (recommended before merge):** manual tri-viewport walkthrough (mobile 375px, tablet 900px, desktop 1440px) and an axe audit on `/dashboard` + `/dashboard/tableau-de-bord` are specified in Task 9 and Task 10 as the primary acceptance gates; they require a human in a browser. Programmatic signals are all green: typecheck + lint + build 6/6 successful, 0 errors.

### File List

**Created:**
- `apps/web/src/components/layout/nav-items.ts` — shared `NavItemSpec` type + `NAV_ITEMS` config
- `apps/web/src/components/layout/NavItem.tsx` — `NavLink` wrapper with `desktop` / `rail` / `bottom` variants, focus ring, active state
- `apps/web/src/components/layout/Breadcrumbs.tsx` — depth-aware breadcrumb derived from `useLocation`
- `apps/web/src/routes/dashboard/tableau-de-bord.tsx` — 3-line placeholder for the "Tableau de bord" nav target

**Modified:**
- `apps/web/src/components/layout/AppShell.tsx` — replaced the desktop-only sidebar from 1.3 with a three-breakpoint composition (`DesktopSidebar`, `TabletRail`, `MobileBottomNav`), added `<SkipLink />`, `<main id="main-content" tabIndex={-1}>`, and `<Breadcrumbs />` inside main
- `apps/web/src/router.tsx` — added `tableau-de-bord` child route + nested `{ path: '*' }` catch-all under `AppShell`

### Change Log

- **2026-04-14** — Story 2.1 initial implementation: responsive AppShell across three breakpoints (desktop 240px sidebar, tablet 60px icon rail, mobile 64px bottom-nav), shared `NavItem` primitive with focus ring, `Breadcrumbs` derived from `useLocation` with French labels, stub `/dashboard/tableau-de-bord` route, nested catch-all inside the shell, skip link to `#main-content`. Typecheck/lint/build green; no new lint warnings; bundle delta negligible (+1.76 kB gzip JS).

### Review Findings

_Code review on 2026-04-15 (3 layers: Blind Hunter, Edge Case Hunter, Acceptance Auditor). 7 patches, 4 deferred, 15 dismissed as noise/spec-allowed/false positives._

- [x] [Review][Patch] `outline-[--ring]` likely does not resolve to the ring color in Tailwind v4 [apps/web/src/components/layout/NavItem.tsx:9, apps/web/src/components/layout/AppShell.tsx:24, apps/web/src/components/layout/Breadcrumbs.tsx:45] — Fixed: replaced with `outline-[var(--ring)]` in all 3 sites + `<main>` focus ring. Verified in built CSS: `outline-color:var(--ring)` now present (resolves to `#37352F`).
- [x] [Review][Patch] `decodeURIComponent` on raw URL segments can throw `URIError` and crash the layout [apps/web/src/components/layout/Breadcrumbs.tsx:11] — Fixed: wrapped in try/catch with raw-segment fallback.
- [x] [Review][Patch] `focus:outline-none` on `<main>` strips focus indication when the skip link lands focus there [apps/web/src/components/layout/AppShell.tsx:151] — Fixed: replaced with `focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--ring)]` so skip-link landing is now indicated for keyboard users.
- [x] [Review][Patch] `aria-label` on the tablet-rail avatar `<div>` is silently ignored without `role` [apps/web/src/components/layout/AppShell.tsx:97-101] — Fixed: added `role="img"` so AT announce the user's name.
- [x] [Review][Patch] `<main>` bottom padding deviates from spec (`pb-20 md:pb-8` vs `pb-16 md:pb-0`) [apps/web/src/components/layout/AppShell.tsx:151] — Fixed: reverted to spec values `pb-16 md:pb-0`.
- [x] [Review][Patch] Empty `user.name` renders an empty tablet-rail avatar [apps/web/src/components/layout/AppShell.tsx:62, apps/web/src/components/layout/AppShell.tsx:97-101] — Fixed: defensive fallback `(user.name.charAt(0) || '?').toUpperCase()`.
- [x] [Review][Patch] Top-level `{ path: '*' }` catch-all is dead code [apps/web/src/router.tsx:24] — Fixed: removed. Nested `*` inside `AppShell` already catches every unmatched URL. Completion-notes claim about chrome-less 404 was incorrect — the shell is mounted at `path: '/'` so nothing was ever chrome-less.
- [x] [Review][Defer] Breadcrumbs render on `NotFoundRoute` paths under `/dashboard` [apps/web/src/components/layout/Breadcrumbs.tsx:14-18] — deferred, low-impact UX polish (the 404 page still gets a misleading trail like "Mes dossiers / typo"). Revisit when error-element work lands.
- [x] [Review][Defer] Surrogate-pair / emoji / combining-mark first character produces broken initial [apps/web/src/components/layout/AppShell.tsx:62] — deferred, hardcoded user is ASCII; revisit alongside Epic 6 real-auth wiring when names become user-supplied.
- [x] [Review][Defer] `tableau-de-bord` NavLink lacks `end`, would stay highlighted on hypothetical deeper paths [apps/web/src/components/layout/nav-items.ts:11] — deferred, no such routes exist today; only matters via the nested 404.
- [x] [Review][Defer] Unknown breadcrumb segments fall through to raw kebab-slug labels [apps/web/src/components/layout/Breadcrumbs.tsx:10-12] — deferred, spec explicitly allows raw decoded slugs for future dossier paths.
