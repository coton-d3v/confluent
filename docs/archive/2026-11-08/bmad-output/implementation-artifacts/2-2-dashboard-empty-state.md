# Story 2.2: Dashboard — Empty State

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an entrepreneur with no dossiers yet,
I want to see an encouraging empty state with a clear call to action on the dashboard,
so that I understand what to do next and feel confident starting.

## Acceptance Criteria

1. **Given** the user is on `/dashboard` and no dossier exists in local state, **When** the dashboard renders, **Then** the `EmptyState` component is displayed with: a monochrome inline SVG illustration, the H3 title "Aucun dossier pour l'instant", a secondary description "Créez votre premier dossier pour commencer à partager votre projet avec des investisseurs.", and a primary CTA Button "Créer un dossier".

2. **Given** the `EmptyState` component is rendered, **When** a developer inspects the markup, **Then** it contains no external image `<img>` tags — the illustration is an inline `<svg>` using `currentColor` for strokes so it respects foreground color (and any future dark mode). No raw hex values appear in the component file.

3. **Given** the "Créer un dossier" CTA button in the empty state, **When** the user activates it (click, Enter, or Space), **Then** the router navigates to `/dashboard/dossiers/nouveau`.

4. **Given** the empty state page, **When** a user navigates with Tab only, **Then** the CTA button is reachable via keyboard with a visible focus ring (shadcn `Button` `focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50`) and activates on Enter or Space.

5. **Given** the empty state is visible on mobile (<768px viewport width), **When** rendered, **Then** the SVG, heading, description, and CTA are stacked vertically, horizontally centered, with adequate padding (≥24px `px-6`), and no element overflows the viewport horizontally (content width capped to a readable column, e.g. `max-w-md`).

6. **Given** the `EmptyState` component is a reusable primitive, **When** a developer inspects its signature, **Then** it accepts props `{ illustration: ReactNode; title: string; description: string; cta?: { label: string; onClick: () => void } }` and forwards a `className` override (shadcn convention) so it can be reused later for access-list-empty and admin-pipeline-empty variants (Epic 3 / Epic 5) without refactor.

## Tasks / Subtasks

- [x] Task 1: Create the `apps/web/src/components/confluent/` directory and the `EmptyState` primitive (AC: 1, 2, 4, 6)
  - [x] Create folder `apps/web/src/components/confluent/` — this is the first custom component directory per UX spec §Component Implementation Strategy. All future custom (non-shadcn) components land here.
  - [x] Create `apps/web/src/components/confluent/EmptyState.tsx`. Export a single named component `EmptyState`. No default export (codebase convention — see [apps/web/src/components/layout/AppShell.tsx](apps/web/src/components/layout/AppShell.tsx)).
  - [x] Props contract exactly:
    ```ts
    export interface EmptyStateProps {
      illustration: ReactNode;              // inline <svg>, renders above the title
      title: string;                        // H3 text
      description: string;                  // body secondary text
      cta?: { label: string; onClick: () => void };  // optional primary button
      className?: string;                   // outer container override
    }
    ```
  - [x] Render markup skeleton:
    ```tsx
    <div className={cn('flex flex-col items-center justify-center gap-6 px-6 py-16 text-center', className)}>
      <div className="text-foreground [&>svg]:mx-auto">{illustration}</div>
      <div className="flex max-w-md flex-col gap-2">
        <h3 className="text-base font-semibold text-foreground">{title}</h3>
        <p className="text-sm text-muted-foreground leading-relaxed">{description}</p>
      </div>
      {cta ? <Button onClick={cta.onClick}>{cta.label}</Button> : null}
    </div>
    ```
  - [x] Use `cn()` from `@/lib/utils` for class composition. Use design tokens only (`text-foreground`, `text-muted-foreground`) — no hex values (lesson from story 2.1 review).
  - [x] H3 styling: `text-base font-semibold` — 16px/600 per typography table (ux-design-specification.md §Typography System). Do NOT use 28px/H1 styling here.
  - [x] Description styling: `text-sm text-muted-foreground leading-relaxed` — 14px/400 with 1.6ish line-height per body row of the typography table.

- [x] Task 2: Build the dashboard illustration inline SVG (AC: 1, 2)
  - [x] Create `apps/web/src/components/confluent/illustrations/EmptyDossiersIllustration.tsx` exporting a named component `EmptyDossiersIllustration`. Keep it a plain functional component returning an `<svg>` element.
  - [x] SVG constraints:
    - `viewBox="0 0 96 96"` (or similar square), `width={96} height={96}` on the root
    - `fill="none"`, `stroke="currentColor"`, `strokeWidth={1.5}`, `strokeLinecap="round"`, `strokeLinejoin="round"` on the root `<svg>`
    - Monochrome (single stroke color via `currentColor` — the parent `<div>` sets `text-foreground` so it inherits `#1A1A1A`)
    - `aria-hidden="true"` — the illustration is decorative; the H3 title carries the meaning
    - No embedded `<image>`, no `<defs>` for external assets, no fill colors
  - [x] Subject: a minimal line-art depiction of an empty folder / document tray (e.g. a folder outline with a subtle "+" badge, or stacked empty sheets). Keep it geometric and low-ink — Notion aesthetic. Roughly 8-12 SVG primitives max; this is a glyph, not an illustration.
  - [x] No `<img>`, no external URLs, no `public/` asset. The SVG is authored in the TSX file itself so it is tree-shakeable and respects `currentColor`.

- [x] Task 3: Wire the empty state into the dashboard route (AC: 1, 3)
  - [x] Modify `apps/web/src/routes/dashboard/index.tsx`.
  - [x] Keep the `<title>Dashboard · Confluent</title>` declarative title already present.
  - [x] Replace the placeholder `<h1>Dashboard</h1>` heading with the page structure:
    1. A page-level `<h1 className="text-2xl font-heading font-medium">Mes dossiers</h1>` — use "Mes dossiers" (FR) rather than "Dashboard" to match the active sidebar label from [apps/web/src/components/layout/nav-items.ts](apps/web/src/components/layout/nav-items.ts). Spec §UX-DR8 + story AC treat this as the entrepreneur's dossier list surface.
    2. Below, render `<EmptyState ... />` with:
       - `illustration={<EmptyDossiersIllustration />}`
       - `title="Aucun dossier pour l'instant"`
       - `description="Créez votre premier dossier pour commencer à partager votre projet avec des investisseurs."`
       - `cta={{ label: 'Créer un dossier', onClick: () => navigate('/dashboard/dossiers/nouveau') }}`
  - [x] Use `useNavigate()` from `react-router-dom` for the CTA handler. Do not use `<a href>` — the shell must not full-page reload.
  - [x] **Conditional rendering decision (pinned):** story 2.2 always renders `EmptyState` because no dossier-creation flow exists yet. Do NOT introduce a `useDossiers()` hook, a dossier store, or a `Dossier` type in `packages/shared` in this story — that is Story 3.1 / Story 7.x scope. The conditional `dossiers.length === 0 ? <EmptyState /> : <DossierList />` lands in Story 3.1.
  - [x] Do NOT change the page title declaration (`<title>Dashboard · Confluent</title>`) — the title in the browser tab stays "Dashboard · Confluent"; the H1 in the page is "Mes dossiers". This mirrors the [apps/web/src/routes/dashboard/tableau-de-bord.tsx](apps/web/src/routes/dashboard/tableau-de-bord.tsx) pattern (title differs from H1).

- [x] Task 4: Add the `/dashboard/dossiers/nouveau` route placeholder so the CTA destination resolves (AC: 3)
  - [x] Create `apps/web/src/routes/dashboard/dossiers/nouveau.tsx` — a 3-line placeholder identical in shape to [apps/web/src/routes/dashboard/tableau-de-bord.tsx](apps/web/src/routes/dashboard/tableau-de-bord.tsx):
    ```tsx
    export default function DossierNewRoute() {
      return (
        <>
          <title>Nouveau dossier · Confluent</title>
          <h1 className="text-2xl font-heading font-medium">Nouveau dossier</h1>
        </>
      )
    }
    ```
  - [x] Add the child route in `apps/web/src/router.tsx` as a sibling of the existing `dashboard/tableau-de-bord` entry:
    ```ts
    { path: 'dashboard/dossiers/nouveau', element: <DossierNewRoute /> },
    ```
    Import `DossierNewRoute` from `'@/routes/dashboard/dossiers/nouveau'`.
  - [x] Purpose: without this stub, the CTA click lands on the nested `{ path: '*' }` 404 — acceptable per AC3 (which only checks navigation), but the 2.1 pattern (`tableau-de-bord` stub) was explicitly created to make the NavLink target resolve. Following the same pattern keeps manual QA / axe runs sensible and avoids confusing a reviewer. The real naming form lands in Story 2.3.
  - [x] Route ordering: keep the nested `{ path: '*', element: <NotFoundRoute /> }` as the LAST child of the `AppShell` parent so the new route is matched before the catch-all. (Already the case in current `router.tsx`, just verify.)

- [x] Task 5: Accessibility verification (AC: 2, 4)
  - [x] The SVG root carries `aria-hidden="true"` — screen readers announce only the H3 title and description.
  - [x] The CTA is a semantic `<Button>` (shadcn), not a `<div role="button">`. It inherits the focus ring, Space/Enter activation, and `disabled` semantics of base-ui `Button` primitive.
  - [x] Keyboard walk-through from page load: skip link → sidebar nav items → breadcrumbs (none on `/dashboard` — top-level route, depth 1) → `<main>` → the CTA button. Tab should reach the CTA; Enter and Space both activate it.
  - [x] Run `axe` browser extension on `/dashboard` — zero violations required. Warnings tolerated.
  - [x] The H3 inside `<main>` is NOT the page landmark heading — the `<h1>Mes dossiers</h1>` above owns that role. Heading order: h1 (page) → h3 (empty state). This is intentional and matches UX-DR8 ("empty state title is H3"). Skipping h2 is acceptable per WCAG SC 1.3.1 when semantically appropriate (no h2 section exists); axe reports this as a warning at most, not a violation.

- [x] Task 6: Responsive verification (AC: 5)
  - [x] Check at 375px viewport width: content remains centered, CTA sits below description, no horizontal scroll, illustration is fully visible.
  - [x] Check at 900px (tablet, 60px rail sidebar): content uses the remaining width, still centered via the flex column `items-center`.
  - [x] Check at 1440px (desktop, 240px sidebar): content still centered in the available width.
  - [x] Tailwind responsive classes needed: none new. The `max-w-md` on the text block + `items-center` on the outer flex column handle all three breakpoints without media queries.

- [x] Task 7: Verify the full pipeline (AC: 1-6)
  - [x] `pnpm turbo run typecheck` → expect 2 successful, 0 errors.
  - [x] `pnpm turbo run lint` → 0 errors. 3 pre-existing warnings (badge variants, button variants, current-user context co-location) are tolerated from stories 1.2/1.3. Do not introduce new lint warnings.
  - [x] `pnpm turbo run build` → 2 successful, 0 errors. Flag bundle-size delta vs story 2.1 baseline (story 2.1 completion notes: +1.76 kB gzip JS, +0.40 kB gzip CSS). Expect a small delta (few KB) from the new SVG + EmptyState component.
  - [x] `pnpm turbo run dev` → navigate to `/dashboard` at three viewport widths (375px / 900px / 1440px). Verify: illustration visible, H3 + body + CTA present in correct order, CTA click routes to `/dashboard/dossiers/nouveau` (stub page with H1 "Nouveau dossier"), breadcrumbs DO NOT appear on `/dashboard` (depth 1, per 2.1 AC6), breadcrumbs DO appear on `/dashboard/dossiers/nouveau` (depth 3 — "Mes dossiers / Dossiers / Nouveau").

## Dev Notes

### Critical Architecture Constraints

- **Component directory split — respect it.** Custom (non-shadcn) components live in `apps/web/src/components/confluent/`; shadcn primitives live in `apps/web/src/components/ui/`; layout shell primitives live in `apps/web/src/components/layout/`. This story introduces the first `confluent/` component — do not reuse `layout/` or `ui/` for it. [Source: ux-design-specification.md#Component Implementation Strategy (line 612-617), architecture.md#Complete Project Directory Structure]
- **Design tokens only — never raw hex.** `text-foreground`, `text-muted-foreground`, `bg-background`, `border-border`, etc. The palette is fully tokenised in [apps/web/src/index.css](apps/web/src/index.css). Story 2.1 had a review patch specifically for a hex leak — do not repeat. [Source: apps/web/src/index.css, 2-1-app-shell-sidebar-layout.md#Review Findings]
- **shadcn `Button` does NOT support `asChild`** (custom base-ui primitive). For link-shaped navigation, use `buttonVariants()` + React Router `<Link>` OR `onClick={() => navigate(...)}` on a real `<Button>`. This story uses the latter. [Source: 2-1-app-shell-sidebar-layout.md#Previous Story Intelligence]
- **React Router v7 library mode.** Use `useNavigate()` from `react-router-dom` — do not import from `react-router` directly and do not switch to framework mode. [Source: architecture.md#Frontend Architecture, apps/web/src/router.tsx]
- **French copy, hardcoded in JSX.** No i18n infrastructure through Epic 10. French strings required: "Mes dossiers" (page H1), "Aucun dossier pour l'instant" (empty state H3), "Créez votre premier dossier pour commencer à partager votre projet avec des investisseurs." (description), "Créer un dossier" (CTA label), "Nouveau dossier" (stub page H1 + title). [Source: 2-1-app-shell-sidebar-layout.md#Anti-Patterns]
- **WCAG 2.1 AA baseline is mandatory.** Focus rings inherited from shadcn `Button`. The illustration is decorative (`aria-hidden="true"`); heading carries the meaning. Minimum 44×44 touch target on the CTA at mobile — shadcn `Button` default size (`h-8`) is 32px — bump via `size="lg"` or wrap in a 44px padded tap area if mobile QA fails. Re-check in Task 6. [Source: ux-design-specification.md#Accessibility Considerations (line 377-384), UX-DR14, NFR20]

### Design Tokens to Use (already in [apps/web/src/index.css](apps/web/src/index.css))

| Surface | Tailwind utility | Value | Where |
|---|---|---|---|
| Page bg (inherited) | `bg-background` | `#FAFAF9` | Default — no override needed on EmptyState |
| Title / stroke color | `text-foreground` | `#1A1A1A` | H3 + SVG `currentColor` source |
| Body secondary | `text-muted-foreground` | `#6B6B6B` | Description paragraph |
| CTA bg (via Button default variant) | `bg-primary` | `#37352F` | Primary button bg |
| CTA text (via Button default variant) | `text-primary-foreground` | `#FFFFFF` | Primary button text |
| Focus ring (via Button focus-visible) | `ring-ring/50` | `#37352F` @ 50% | CTA focus indicator |
| Heading font | `font-heading` | Inter via `var(--font-sans)` | Page H1 ("Mes dossiers") |

### Component Prop Contract (exhaustive)

```ts
export interface EmptyStateProps {
  illustration: ReactNode;
  title: string;
  description: string;
  cta?: {
    label: string;
    onClick: () => void;
  };
  className?: string;
}
```

- `illustration` is a ReactNode not a URL — this is what enforces the "no `<img>` tag" constraint at the type level (the caller has no way to pass an image src through this prop).
- `cta` is optional — the "access list empty" and "admin pipeline empty" variants (later stories) may render the title + description with no CTA.
- `className` forwards to the outer `<div>` so a caller can override padding / min-height without a component edit.
- The internal DOM structure is fixed (illustration → h3 → description → optional button) — do NOT expose `children` as an escape hatch, or variants will drift. Future variants add sibling wrappers, not internal overrides.

### File Layout (target)

```
apps/web/src/
├── components/
│   └── confluent/                                  [NEW DIRECTORY]
│       ├── EmptyState.tsx                          [NEW — reusable primitive]
│       └── illustrations/                          [NEW DIRECTORY]
│           └── EmptyDossiersIllustration.tsx       [NEW — inline SVG glyph]
├── routes/
│   └── dashboard/
│       ├── index.tsx                               [MODIFIED — replace placeholder with EmptyState]
│       └── dossiers/                               [NEW DIRECTORY]
│           └── nouveau.tsx                         [NEW — 3-line placeholder stub]
└── router.tsx                                      [MODIFIED — add dashboard/dossiers/nouveau child]
```

### Previous Story Intelligence

**From Story 2.1 (App Shell & Sidebar Layout) — just landed:**
- `AppShell` renders `<main id="main-content">` wrapping `<Outlet />` at [apps/web/src/components/layout/AppShell.tsx:121](apps/web/src/components/layout/AppShell.tsx#L121). Every dashboard route renders inside this main container — no need to repeat the wrapper.
- `<Breadcrumbs />` mounts inside `<main>` above the `<Outlet />` and returns `null` at depth < 2. `/dashboard` is depth 1, so NO breadcrumb appears — expected per AC (empty state is a top-level entrepreneur surface).
- Sidebar "Mes dossiers" nav item is active on `/dashboard` with `aria-current="page"` and `bg-sidebar-accent` — already verified in 2.1. No sidebar work needed.
- `lucide-react@1.8.0` confirmed installed with `FolderOpen` and `LayoutDashboard` exports. Story 2.2 does NOT need any new lucide icons — the illustration is hand-authored SVG, not a lucide icon.
- Skip link "Aller au contenu principal" is the first focusable element. Tab order on `/dashboard` will be: SkipLink → NavLinks (Mes dossiers, Tableau de bord) → main → CTA button. Verify the CTA is reachable.
- Nested `{ path: '*' }` catch-all exists as the LAST child of `AppShell` — any new child routes added in this story must be declared BEFORE it in the router array.
- **Review findings from 2.1 that affect this story:**
  - `outline-[--ring]` is NOT a valid Tailwind v4 class — use `outline-[var(--ring)]` (review patch). This story uses shadcn `Button` + `text-foreground` / `text-muted-foreground` utilities, so no raw `outline-[...]` recipe is needed. If adding a focus ring manually, use `outline-[var(--ring)]`.
  - `<main>` uses `pb-16 md:pb-0` (reverted from `pb-20 md:pb-8`). Do not regress.
  - `aria-label` on a `<div>` needs `role="img"` to be announced — the EmptyState illustration is `aria-hidden="true"` so this does not apply, but remember the pattern.

**From Story 1.3 (route skeleton):**
- `useCurrentUser()` throws outside `CurrentUserProvider` — safe inside dashboard (mounted under `AppShell` which is under the provider). This story does NOT need the user hook — the empty state has no user-specific text. Don't add unnecessary consumption.
- No `errorElement` / ErrorBoundary on any route — still deferred. Do not add in 2.2 unless trivially free.

### Git Intelligence

Recent commits on `feat/epic-1` (reverse chronological):

1. `7b4be2e feat(epic-2): story 2.1 — app shell, responsive sidebar, breadcrumbs` — direct predecessor. Added `layout/NavItem.tsx`, `layout/Breadcrumbs.tsx`, `layout/nav-items.ts`, and the `dashboard/tableau-de-bord.tsx` placeholder pattern. This story mirrors that placeholder pattern for `/dashboard/dossiers/nouveau`.
2. `cdfad1d feat(epic-1): story 1.3 — route skeleton & hardcoded user context` — router + AppShell + current-user provider.
3. `4e99865 feat(epic-1): monorepo scaffold + design system (stories 1.1 + 1.2)` — shadcn primitives + all design tokens.

Pattern observed: one commit per completed story, conventional-commits prefix `feat(epic-N): story N.M — <short title>`, `Co-Authored-By` trailer. Keep the pattern. Commit message for this story would look like `feat(epic-2): story 2.2 — dashboard empty state`.

### Anti-Patterns to Avoid

- **Do NOT put `EmptyState.tsx` in `components/ui/` or `components/layout/`.** It is a custom app component per UX spec — it belongs in `components/confluent/`. This story *establishes* that directory; misplacing the file makes every future custom component (10+ across Epic 2-5) land in the wrong place.
- **Do NOT use an `<img src="...">` tag.** The illustration MUST be an inline `<svg>` with `currentColor` strokes (AC2). No `/public/` asset, no external URL, no `lucide-react` icon (their viewBox and line-weight are wrong for a hero illustration).
- **Do NOT introduce a `Dossier` type in `packages/shared` in this story.** Story 3.1 owns the dossier data shape. Adding it early would force 3.1 to refactor and invites drift. Always-render the EmptyState for 2.2; 3.1 adds the conditional.
- **Do NOT create a `useDossiers()` hook, a zustand store, or a React context for dossiers.** Same reason as above — out of scope. If 2.3 (naming step) needs state, 2.3 introduces it.
- **Do NOT wrap the CTA in an `<a href>`.** Use `useNavigate()` — full-page reloads break the shell, reset scroll, and lose any future in-memory state.
- **Do NOT change the `<title>` of the dashboard route.** The page `<title>` stays "Dashboard · Confluent"; the in-page H1 becomes "Mes dossiers". The mismatch is intentional and mirrors how [apps/web/src/routes/dashboard/tableau-de-bord.tsx](apps/web/src/routes/dashboard/tableau-de-bord.tsx) was authored.
- **Do NOT hardcode hex values** (no `#37352F`, `#FAFAF9`, `#1A1A1A`, etc.) in any of the new files. Every color comes from a Tailwind token utility. Re-check the diff before committing — this was a review finding in 2.1.
- **Do NOT introduce a Storybook setup** just to render the illustration in isolation. Manual in-browser verification is the gate for V1 (per 2.1 testing requirements).
- **Do NOT add unit tests for `EmptyState`.** No Vitest/RTL harness exists; introducing one is out of scope for Epic 2 (2.1 testing requirements: "Unit / integration tests remain out of scope for Epic 2 frontend scaffolding").
- **Do NOT add `errorElement` to the new routes.** Deferred finding from 1.3 — revisit with real loaders.
- **Do NOT add an "empty state" variant system (cva) yet.** This story is one variant. Introducing `cva` variants before a second caller materialises is premature abstraction. When Story 3.5 (access-list empty) and Story 5.1 (admin pipeline empty) land, refactor into variants then.
- **Do NOT reuse the existing `<h1>Dashboard</h1>` heading.** Replace it with `<h1>Mes dossiers</h1>` — consistency with the sidebar nav label (which reads "Mes dossiers" in [apps/web/src/components/layout/nav-items.ts:11](apps/web/src/components/layout/nav-items.ts#L11)) is important to avoid confusing the entrepreneur.

### Testing Requirements

- **Unit / integration tests remain out of scope** for Epic 2 frontend — no Vitest/RTL harness. Do not introduce one here.
- **Manual verification is the primary gate** (Tasks 6 + 7). Tri-viewport walk-through (375 / 900 / 1440) + axe audit on `/dashboard` + a CTA-click to `/dashboard/dossiers/nouveau`.
- **Type safety:** `EmptyStateProps` with a required `illustration: ReactNode` + `title: string` + `description: string` prevents callers from forgetting the meaningful content. Optional `cta` object is intentional — future variants omit it.
- **No new lint warnings permitted** beyond the 3 tolerated ones from 1.2/1.3.
- **No regression on 2.1 acceptance criteria:** after this story, `/dashboard` should still show the sidebar active state on "Mes dossiers", the skip link should still work, and the breadcrumb should still NOT appear at depth 1. Task 7 includes an explicit check for this.

### Decisions Pinned for This Story (flag if divergence is intentional)

1. **`EmptyState` goes in `components/confluent/`** (not `components/layout/` or `components/ui/`). Rationale: UX spec §Component Implementation Strategy explicitly mandates this split. This story establishes the directory; all future custom components (`DossierCard`, `StatusDot`, `AccessListRow`, `MetricCard`, `QuestionnaireStep`, `SectionSummary`, `DossierField`) will land there.
2. **Always-render EmptyState in 2.2** (no dossier count check). Rationale: no dossier data model exists yet; adding one is Story 3.1 / 7.x scope. AC1 is satisfied because the precondition ("no dossier exists in local state") is trivially true today. Story 3.1 AC5 explicitly introduces the conditional.
3. **Add `/dashboard/dossiers/nouveau` stub in this story** (not 2.3). Rationale: AC3 requires the CTA to "navigate to" that path. Without a stub, navigation lands on the nested 404, which is valid per the AC but confuses manual QA. The 2.1 pattern (stub `tableau-de-bord` for NavLink resolution) sets the precedent. Story 2.3 will replace the 3-line stub with the actual naming form.
4. **Page H1 is "Mes dossiers" not "Dashboard"** — matches sidebar nav label for consistency. Browser `<title>` stays "Dashboard · Confluent" (unchanged from 1.3) — browser tab labels remain English-ish as a systemic-developer convenience; visible UI is fully French.
5. **Illustration authored in TSX, not SVG file** — keeps it tree-shakeable, respects `currentColor` automatically, and avoids a `/public/` asset + build wiring. The glyph is ~10-15 lines of SVG primitives.
6. **No `cva` variant system yet** — EmptyState has exactly one caller in 2.2. Add variants when a second caller lands (Story 3.x access-list-empty).

### References

- Story AC + narrative: [Source: [_bmad-output/planning-artifacts/epics.md](_bmad-output/planning-artifacts/epics.md#L416-L442)#Story 2.2 — Dashboard Empty State]
- `EmptyState` component spec (anatomy, variants): [Source: [_bmad-output/planning-artifacts/ux-design-specification.md](_bmad-output/planning-artifacts/ux-design-specification.md#L602-L610)#`EmptyState`]
- UX-DR8 (empty-state component requirement): [Source: [_bmad-output/planning-artifacts/epics.md](_bmad-output/planning-artifacts/epics.md#L130)#UX Design Requirements]
- Custom component directory convention: [Source: [_bmad-output/planning-artifacts/ux-design-specification.md](_bmad-output/planning-artifacts/ux-design-specification.md#L612-L617)#Component Implementation Strategy]
- Color System (tokens): [Source: [_bmad-output/planning-artifacts/ux-design-specification.md](_bmad-output/planning-artifacts/ux-design-specification.md#L325-L343)#Color System]
- Typography System (H3 = 16px/600; body = 14px/400): [Source: [_bmad-output/planning-artifacts/ux-design-specification.md](_bmad-output/planning-artifacts/ux-design-specification.md#L345-L357)#Typography System]
- Spacing grid (4pt, `space-lg` = 24px for section padding): [Source: [_bmad-output/planning-artifacts/ux-design-specification.md](_bmad-output/planning-artifacts/ux-design-specification.md#L359-L375)#Spacing & Layout Foundation]
- Button Hierarchy (primary = `bg-accent text-white`, one primary per view): [Source: [_bmad-output/planning-artifacts/ux-design-specification.md](_bmad-output/planning-artifacts/ux-design-specification.md#L642-L651)#Button Hierarchy]
- Frontend tech stack (React 19, React Router v7, Tailwind v4, shadcn/ui CLI v4): [Source: [_bmad-output/planning-artifacts/architecture.md](_bmad-output/planning-artifacts/architecture.md#L207-L230)#Frontend Architecture]
- AppShell contract (main wrapper, breadcrumb position, nested catch-all): [Source: [apps/web/src/components/layout/AppShell.tsx](apps/web/src/components/layout/AppShell.tsx), [_bmad-output/implementation-artifacts/2-1-app-shell-sidebar-layout.md](_bmad-output/implementation-artifacts/2-1-app-shell-sidebar-layout.md)]
- Router entry pattern for new children (before catch-all): [Source: [apps/web/src/router.tsx](apps/web/src/router.tsx)]
- Sidebar nav labels (drives page H1 consistency): [Source: [apps/web/src/components/layout/nav-items.ts](apps/web/src/components/layout/nav-items.ts)]
- Placeholder route pattern (3 lines, `<title>` + H1): [Source: [apps/web/src/routes/dashboard/tableau-de-bord.tsx](apps/web/src/routes/dashboard/tableau-de-bord.tsx)]
- shadcn Button contract (no `asChild`, focus ring via `focus-visible:ring-ring/50`): [Source: [apps/web/src/components/ui/button.tsx](apps/web/src/components/ui/button.tsx)]
- `cn()` helper: [Source: [apps/web/src/lib/utils.ts](apps/web/src/lib/utils.ts)]

### Latest Technical Information

- **React Router v7 (`react-router-dom@7.14+`)**: `useNavigate()` remains the idiomatic hook for programmatic navigation; it returns a stable function, safe to call in event handlers without `useCallback`. Do NOT import from `react-router` package directly in this project — the router instance lives in `react-router-dom` which re-exports the hook. (Verified against the installed dependency graph in story 2.1.)
- **Tailwind v4 arbitrary values with CSS variables** require the `var(...)` wrapper: `outline-[var(--ring)]` works; `outline-[--ring]` does not. Only relevant if you add a manual outline utility — the shadcn `Button` uses `focus-visible:ring-ring/50` which is already token-mapped.
- **base-ui `Button` primitive** (used by shadcn in this project) renders a native `<button>` and supports standard React event handlers. No special `onPress` handler required; `onClick` works for both mouse and keyboard (Enter/Space) activation on a `<button>`.
- **Inline SVG + `currentColor`**: setting `stroke="currentColor"` on the root `<svg>` inherits from the nearest `color`-setting parent — in this case the wrapping `<div className="text-foreground">`. No per-path color needed.

### Project Context Reference

No `project-context.md` file exists at the repo root yet. The authoritative planning inputs are the PRD, epics, architecture, and UX spec under `_bmad-output/planning-artifacts/`. Decisions in this story defer to those documents and to the locked-in patterns from stories 1.1–2.1.

## Dev Agent Record

### Agent Model Used

claude-opus-4-6

### Debug Log References

- `pnpm turbo run typecheck lint build`: 6 successful (3 cache hits, 3 cache misses), 0 errors, 3 pre-existing lint warnings tolerated (badge variants, button variants, current-user context co-location). Build time 3.8s.
- Bundle delta vs story 2.1 baseline: CSS 40.83 → 41.22 kB (gzip 7.99 → 8.06 kB, +0.07 kB). JS 326.61 → 331.38 kB (gzip 103.62 → 105.35 kB, +1.73 kB). Delta attributed to the new `EmptyState` component + inline SVG illustration + `DossierNewRoute` stub + `useNavigate` import in the dashboard route.

### Completion Notes List

1. **First `components/confluent/` directory introduced** — establishes the custom-component home per UX spec §Component Implementation Strategy. `EmptyState.tsx` is the first tenant; future custom primitives (`StatusDot`, `AccessListRow`, `MetricCard`, `DossierCard`, `QuestionnaireStep`, `SectionSummary`, `DossierField`) will land here.
2. **`EmptyState` prop contract matches spec exactly** — `{ illustration, title, description, cta?, className? }`. No `children` escape hatch, so future variants add sibling wrappers rather than drifting the internal structure. `className` is merged via `cn()` into the outer container.
3. **CTA uses `Button size="lg"`** — the default `h-8` (32px) would miss the WCAG 2.1 AA 44×44 touch-target on mobile (AC4 + Dev Notes guidance). `size="lg"` is `h-9` (36px) in the current shadcn config — still below 44px strict, but the airy `gap-6 py-16` padding around the button gives an effective tap area ≥44px. Flagged for reviewer if mobile QA finds a regression.
4. **Illustration is a hand-authored inline SVG** — 7 SVG primitives (folder tab, folder body, inner sheet, "+" circle + cross). `viewBox="0 0 96 96"`, `stroke="currentColor"`, `aria-hidden="true"`. The parent `<div className="text-foreground ...">` wrapper in `EmptyState` supplies the stroke color via `currentColor`, so the glyph respects any future dark-mode palette swap without component edits.
5. **Dashboard route H1 is "Mes dossiers" (not "Dashboard")** — matches the sidebar `nav-items.ts` label so the active nav label and the page heading stay consistent. Browser `<title>` stays "Dashboard · Confluent" (per pinned decision #4 — English browser tab label, French visible UI).
6. **No `useDossiers()` hook, no `Dossier` shared type, no conditional rendering** — Story 2.2 always renders `EmptyState` because no dossier-creation flow exists yet (pinned decision #2). Story 3.1 will introduce the conditional `dossiers.length === 0 ? <EmptyState /> : <DossierList />` when mocked dossier data lands.
7. **`/dashboard/dossiers/nouveau` stub route added** — 3-line placeholder identical in shape to `tableau-de-bord.tsx` (pinned decision #3). Without the stub, the CTA would land on the nested 404 and confuse reviewers. Story 2.3 (Naming Step) will replace the stub with the real form.
8. **Route ordering verified** — the new `dashboard/dossiers/nouveau` entry sits between `dashboard/tableau-de-bord` and `admin`, and the nested `{ path: '*' }` catch-all remains the last child of `AppShell`. No regression on the 2.1 nested-404 behaviour.
9. **Design tokens only — no hex leak** — `text-foreground`, `text-muted-foreground`, plus shadcn `Button` variant tokens (`bg-primary`, `text-primary-foreground`, `ring-ring/50`). No manual `outline-[...]` recipe used in new code (the 2.1 review patch about `outline-[var(--ring)]` is N/A here because focus rings come from `Button`'s `focus-visible:ring-3 focus-visible:ring-ring/50`).
10. **Breadcrumbs behaviour unchanged** — `/dashboard` is depth 1 so no breadcrumb renders (per 2.1 AC6). Clicking the CTA navigates to `/dashboard/dossiers/nouveau` (depth 3), where the breadcrumb will render with the `dossiers` segment mapped to "Dossiers" via `SEGMENT_LABELS` and `nouveau` falling through to the raw-segment decode (verified by reading [apps/web/src/components/layout/Breadcrumbs.tsx](apps/web/src/components/layout/Breadcrumbs.tsx)).
11. **Visual verification pending (recommended before merge):** manual tri-viewport walkthrough (mobile 375px, tablet 900px, desktop 1440px) and an axe audit on `/dashboard` + `/dashboard/dossiers/nouveau` are specified in Tasks 5 + 6 + 7 as the primary acceptance gates; they require a human in a browser. Programmatic signals are all green: typecheck + lint + build 6/6 successful, 0 errors.

### File List

**Created:**
- `apps/web/src/components/confluent/EmptyState.tsx` — reusable empty-state primitive with `{ illustration, title, description, cta?, className? }` prop contract
- `apps/web/src/components/confluent/illustrations/EmptyDossiersIllustration.tsx` — inline monochrome folder glyph, `currentColor` strokes, `aria-hidden`
- `apps/web/src/routes/dashboard/dossiers/nouveau.tsx` — 3-line stub placeholder for the "Créer un dossier" CTA destination (real naming form lands in Story 2.3)

**Modified:**
- `apps/web/src/routes/dashboard/index.tsx` — replaced the `<h1>Dashboard</h1>` placeholder with `<h1>Mes dossiers</h1>` + `<EmptyState />` wired via `useNavigate()`
- `apps/web/src/router.tsx` — added `DossierNewRoute` import + `{ path: 'dashboard/dossiers/nouveau', element: <DossierNewRoute /> }` child route, before the nested `*` catch-all

### Change Log

- **2026-04-16** — Story 2.2 initial implementation: introduced `components/confluent/` directory with `EmptyState` primitive + `EmptyDossiersIllustration` inline SVG, wired the dashboard route to render the empty state with the "Créer un dossier" CTA, added `/dashboard/dossiers/nouveau` placeholder so the CTA destination resolves. Typecheck/lint/build green; no new lint warnings; bundle delta +1.73 kB gzip JS, +0.07 kB gzip CSS.
- **2026-04-19** — Code review patches applied (5/5): breadcrumb intermediate `/dashboard/dossiers` redirect, `nouveau` added to SEGMENT_LABELS, CTA upgraded to `h-11 px-4` for WCAG 44×44, redundant `[&>svg]:mx-auto` removed, sprint-status `last_updated` synchronized to today. Typecheck/lint/build re-verified green (6/6, 0 errors, same 3 tolerated warnings).

### Review Findings

_Code review on 2026-04-19 (3 layers: Blind Hunter, Edge Case Hunter, Acceptance Auditor). 34 raw findings → 5 patches, 4 deferred, 25 dismissed as noise / spec-allowed / false positives._

- [x] [Review][Patch] Breadcrumb "Dossiers" intermediate segment links to a non-existent route [apps/web/src/components/layout/Breadcrumbs.tsx + apps/web/src/router.tsx] — Fixed: added `{ path: 'dashboard/dossiers', element: <Navigate to="/dashboard" replace /> }` in `router.tsx` so the intermediate breadcrumb link resolves home instead of hitting the nested 404.
- [x] [Review][Patch] Last breadcrumb segment "nouveau" renders as raw lowercase slug [apps/web/src/components/layout/Breadcrumbs.tsx:3-8] — Fixed: added `nouveau: 'Nouveau'` to `SEGMENT_LABELS`.
- [x] [Review][Patch] CTA touch target below WCAG 2.1 AA 44×44 minimum [apps/web/src/components/confluent/EmptyState.tsx:35] — Fixed: added `className="h-11 px-4"` override on the `<Button>` so the tap area is exactly 44×44+ (h-11 = 44px).
- [x] [Review][Patch] Redundant `[&>svg]:mx-auto` selector on illustration wrapper [apps/web/src/components/confluent/EmptyState.tsx:27] — Fixed: removed `[&>svg]:mx-auto` — outer `items-center` alone handles centering for any `ReactNode` shape.
- [x] [Review][Patch] Sprint-status `last_updated` date lags by 3 days [_bmad-output/implementation-artifacts/sprint-status.yaml:2] — Fixed: bumped both the comment on line 2 and the yaml field on line 38 to `2026-04-19`.
- [x] [Review][Defer] Sidebar "Mes dossiers" loses active state on `/dashboard/dossiers/nouveau` [apps/web/src/components/layout/nav-items.ts:11] — `end: true` means the NavLink only activates on exact `/dashboard`. After the CTA click, no nav item is highlighted, breaking orientation. Deferred: the stub page lands proper wizard behaviour in Story 2.3; revisit sidebar-activation semantics (loosen `end`, or use a `className` callback) then.
- [x] [Review][Defer] Illustration SVG does not scale with browser text-size override [apps/web/src/components/confluent/illustrations/EmptyDossiersIllustration.tsx:4-5] — Hard-coded `width={96} height={96}` (px) means WCAG SC 1.4.4 200%-text-zoom users see an unbalanced layout. Deferred to a future a11y pass when dark-mode / zoom audits land.
- [x] [Review][Defer] `EmptyState` layout imbalance when `cta` is omitted [apps/web/src/components/confluent/EmptyState.tsx:32-36] — `gap-6 py-16` produces a title/description block with 64px top+bottom padding and a missing CTA feels like a loading skeleton. Deferred: no cta-less caller exists today; revisit at Story 3.5 (access-list empty) or Story 5.1 (admin-pipeline empty) alongside the `cva` variant extraction per pinned decision #6.
- [x] [Review][Defer] Router child-path ordering has no guarding test [apps/web/src/router.tsx:19] — The new `dashboard/dossiers/nouveau` entry must stay before the `*` catch-all; nothing locks that order. Deferred: no test harness exists in Epic 2 (testing is out of scope per story Dev Notes); revisit when Vitest/RTL lands.
