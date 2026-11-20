# Story 3.2: Dossier Page — Header & Tab Navigation

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an entrepreneur viewing a dossier,
I want a clear header with navigation tabs,
so that I can switch between the dossier content and its access analytics.

## Acceptance Criteria

1. **Given** the user navigates to `/dashboard/dossiers/view/biosensio`, **When** the page renders, **Then** the following elements are visible at the top, in this order:
   - Breadcrumb: `Dossiers / Biosensio` — exactly two segments. "Dossiers" is an `<a>` / `<Link>` pointing to `/dashboard`; "Biosensio" is non-linked and carries `aria-current="page"`.
   - H1 with the dossier's display name ("Biosensio") — `font-heading text-2xl font-semibold text-foreground md:text-[28px]` (established H1 recipe from Stories 2.5 / 2.6 / 3.1 — see Pinned Decision #5 for the deliberate divergence from the Epic AC's literal "font-weight 700").
   - A primary `<Button>` "Partager" in the top-right of the header row (`size="lg"`, `h-11 px-4`). Pressing the button is a no-op in 3.2 — it exists for layout + tab-order + AC compliance; Story 3.5 wires it to open the D5 Sheet.
   - Two tabs underneath the header row: `Contenu` and `Accès & analytics`, implemented via the shared `Tabs` primitive (see Task 1).

2. **Given** the user navigates to `/dashboard/dossiers/view/biosensio` with NO `?tab` query param, **When** the page mounts, **Then** the `Contenu` tab is active by default and its panel renders the dossier fields (2.6 `DossierField` list — unchanged content module, new wrapping structure).

3. **Given** the user clicks the `Accès & analytics` tab (pointer OR keyboard), **When** the activation fires, **Then**:
   - The URL updates to `/dashboard/dossiers/view/biosensio?tab=analytics` via `useSearchParams()` + `setSearchParams({ tab: 'analytics' }, { replace: true })` — see Pinned Decision #3 for the `replace: true` rationale.
   - The `Accès & analytics` panel renders (placeholder content in 3.2 — Story 3.3 will replace it with the MetricCard grid + AccessListRow list — see Task 4 for the exact placeholder).
   - The `Contenu` panel unmounts (default Base UI Tabs behaviour — see §Latest Technical Information).

4. **Given** the URL is `/dashboard/dossiers/view/biosensio?tab=analytics` (deep link OR bookmarked), **When** the page first mounts, **Then** the `Accès & analytics` tab is active on load without the `Contenu` tab ever rendering.

5. **Given** the URL is `/dashboard/dossiers/view/biosensio?tab=<anything-else>` (unknown value, e.g., `?tab=foo`, `?tab=`, a duplicate `?tab=content&tab=analytics`), **When** the page mounts, **Then** the active tab falls back to `Contenu` — the `?tab` param is treated as an allowlist (`'analytics'` only triggers the analytics tab). Unknown / malformed values MUST NOT throw, MUST NOT mount the analytics panel, and MUST NOT re-write the URL on mount (stay pure — see Anti-Patterns).

6. **Given** the user is on the `Accès & analytics` tab, **When** they click `Contenu`, **Then** the URL drops the `?tab` param entirely (clean default URL) via `setSearchParams((p) => { p.delete('tab'); return p }, { replace: true })`. Resulting URL: `/dashboard/dossiers/view/biosensio` (no trailing `?`). This preserves AC2's "default = no param" invariant on round-trip.

7. **Given** both tabs, **When** a keyboard user navigates, **Then** the ARIA tab pattern works end to end:
   - `Tab` key moves focus INTO the tablist (stops on the active tab only, not each tab).
   - `ArrowLeft` / `ArrowRight` (`ArrowUp` / `ArrowDown` are out-of-spec for `orientation="horizontal"` — Base UI ignores them) move roving focus between tabs AND activate each tab on focus (Base UI's default `activateOnFocus` behaviour — matches WAI-ARIA "Tabs with Automatic Activation" pattern).
   - `Home` / `End` jump focus to first / last tab.
   - `Tab` key from the tablist moves focus to the currently active tab's panel content (Base UI renders `tabIndex={0}` on the `<Panel>`).
   - Active tab has `aria-selected="true"` + `data-active`; inactive tabs have `aria-selected="false"`.
   - Each tab has a stable `id` and the panel has `aria-labelledby` pointing to its tab (Base UI handles this automatically — verify via DOM inspection, do not hand-roll).

8. **Given** the dossier page, **When** a developer inspects the DOM, **Then**:
   - The page's `<title>` is `{DisplayName} · Confluent` (unchanged from 2.6 — e.g., `Biosensio · Confluent`).
   - The `<h1>` receives programmatic focus on mount (`tabIndex={-1}` + `useRef` + `useEffect` recipe — already present in 2.6, preserved).
   - The `<h1>` focus recipe does NOT re-fire on tab change (the `useEffect` dependency is `[slug]`, not `[slug, activeTab]`) — changing tabs must not yank focus back to the H1 mid-interaction. See Pinned Decision #7.
   - The shell `Breadcrumbs` component in `AppShell.tsx` is SUPPRESSED on this route (via the existing `handle: { hideBreadcrumb: true }` on the `dashboard/dossiers/view/:slug` route in `router.tsx` — do NOT change this handle). The page renders its OWN 2-segment breadcrumb locally. See Pinned Decision #2.

9. **Given** the URL path `/dashboard/dossiers/view/:slug`, **When** the header's display name is computed, **Then** the resolution order is:
   1. `MOCK_DOSSIERS.find((d) => d.slug === slug)?.name` — preferred (exact casing / accents preserved, e.g., "Biosensio" not "Biosensio" via deslugify which would be identical here but matters for slugs like `mon-dossier` → "Mon Dossier" vs the mock's canonical "Mon Dossier").
   2. `deslugifyForDisplay(slug)` — fallback when the slug is NOT in `MOCK_DOSSIERS` (dossiers that exist only via the 2.3 naming wizard + 2.4-2.6 questionnaire in localStorage — e.g., a user-created `mon-super-projet`).
   This closes the Story 3.1 integration seam: clicking the Biosensio / Agrotrack mock cards no longer lands on "Dossier introuvable" because the mock fixture now answers the "does this slug exist?" question. See Pinned Decision #8.

10. **Given** the slug resolves to a `MockDossier` (case A: mock-only dossier), **When** the `Contenu` tab renders, **Then** the panel displays an empty-content fallback: a short `<p className="text-sm text-muted-foreground">` with the copy `Ce dossier n'a pas encore de contenu renseigné.` — NOT the `Dossier introuvable` fallback and NOT a blank panel. The Agrotrack / Biosensio mock-only entries are expected to show this copy in 3.2; Story 7.x will later populate them via the real API. See Pinned Decision #8.

11. **Given** the slug resolves to a `MockDossier` AND to a valid `confluent_dossier_{slug}` entry in localStorage (case B: full hit), **When** the `Contenu` tab renders, **Then** the panel displays the existing 2.6 sections + `DossierField` list (unchanged rendering). This is the future path where a user created "Biosensio" through the wizard — the fixture seeds the name, localStorage seeds the answers.

12. **Given** the slug resolves to a valid `confluent_dossier_{slug}` entry but is NOT in `MOCK_DOSSIERS` (case C: wizard-created dossier), **When** the page renders, **Then** the H1 uses `deslugifyForDisplay(slug)` (existing 2.6 behaviour), the `Contenu` tab shows the 2.6 section list, and everything else (breadcrumb, tabs, Partager button, analytics placeholder) behaves identically to case A / B.

13. **Given** the slug resolves to NEITHER `MOCK_DOSSIERS` NOR localStorage (case D: truly unknown slug), **When** the page renders, **Then** the existing 2.6 "Dossier introuvable" fallback renders (unchanged from the current route) — no breadcrumb, no tabs, no Partager button. This case is reachable today by typing `/dashboard/dossiers/view/foo` directly.

14. **Given** the `Accès & analytics` tab is active (either by click or by deep link), **When** the panel renders, **Then** it contains a clearly-marked Story-3.3 placeholder block:
    ```tsx
    <div className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
      <p>L'analytique de ce dossier s'affichera ici.</p>
    </div>
    ```
    This placeholder MUST be a single replace-point for Story 3.3 — no other structural content (no headings, no metric-card stubs, no list stubs). Story 3.3 opens this file and swaps the placeholder block for the `MetricCard` grid + `AccessListRow` container. See Pinned Decision #9.

15. **Given** the page, **When** viewed on mobile (< 768 px), **Then**:
    - The header row wraps: breadcrumb → H1 stacked vertically → Partager button beneath (OR beside, if space allows at `sm`). Use `flex-col gap-4 sm:flex-row sm:items-center sm:justify-between` on the H1-+-button row (same recipe as 3.1's dashboard header).
    - The tablist stays a single row, horizontally scrollable if the two labels wrap (in practice "Contenu" + "Accès & analytics" fit within 375 px).
    - No horizontal overflow at 320 px minimum.
    - The Partager button tap target ≥ 44 × 44 px (enforced by `size="lg"` → `h-11 px-4` — already-established 2.2 recipe).
    - The tab buttons tap target ≥ 44 × 44 px (set `min-h-11` on the `TabsTrigger` base style — see Task 1 Subtask 1b).

16. **Given** a keyboard / screen-reader user on the page, **When** they navigate, **Then** reader-announced structure is: H1 (focus-on-mount) → breadcrumb landmark (`<nav aria-label="Fil d'Ariane">`) → header Partager button → tablist (`role="tablist"`) with two tabs → active panel (`role="tabpanel"`). No violation in an axe audit: 0 serious, 0 critical.

## Tasks / Subtasks

- [x] **Task 1: Add the shared `Tabs` primitive (`components/ui/tabs.tsx`) (AC: 1, 3, 4, 5, 6, 7, 15)**
  - [x] Create `apps/web/src/components/ui/tabs.tsx`. Named exports only: `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent`, `TabsIndicator`. No default export. Mirror the `sheet.tsx` wrapper pattern (see `apps/web/src/components/ui/sheet.tsx`).
  - [x] Import surface:
    ```ts
    import * as React from 'react'
    import { Tabs as TabsPrimitive } from '@base-ui/react/tabs'
    import { cn } from '@/lib/utils'
    ```
  - [x] 1a. `Tabs` — thin pass-through over `TabsPrimitive.Root`:
    ```tsx
    function Tabs({ ...props }: TabsPrimitive.Root.Props) {
      return <TabsPrimitive.Root data-slot="tabs" {...props} />
    }
    ```
  - [x] 1b. `TabsList` — horizontal list container, inline-flex on a muted surface with `gap-1`:
    ```tsx
    function TabsList({ className, ...props }: TabsPrimitive.List.Props) {
      return (
        <TabsPrimitive.List
          data-slot="tabs-list"
          className={cn(
            'inline-flex h-11 items-center gap-1 rounded-lg bg-muted p-1 text-muted-foreground',
            className,
          )}
          {...props}
        />
      )
    }
    ```
    Design rationale: the shadcn `TabsList` recipe (`bg-muted` pill containing rounded pill triggers) is the canonical pattern and reads as a calm toggle group that fits the Notion-inspired palette. `h-11` clears the 44 px touch target for the tablist itself (tap-anywhere-inside-the-row ergonomics on mobile).
  - [x] 1c. `TabsTrigger` — individual tab button, active state via `data-[active]` (Base UI adds `data-active` to the currently-active tab):
    ```tsx
    function TabsTrigger({ className, ...props }: TabsPrimitive.Tab.Props) {
      return (
        <TabsPrimitive.Tab
          data-slot="tabs-trigger"
          className={cn(
            'inline-flex min-h-9 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors',
            'hover:text-foreground',
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]',
            'disabled:pointer-events-none disabled:opacity-50',
            'data-[active]:bg-card data-[active]:text-foreground data-[active]:shadow-sm',
            className,
          )}
          {...props}
        />
      )
    }
    ```
    The `data-[active]:bg-card` recipe produces the "active pill" effect against the `bg-muted` TabsList surface. `min-h-9` (36 px) on the trigger body + the 4 px `p-1` on the list = 44 px total tap target (hits AC15).
  - [x] 1d. `TabsContent` — panel content, token-padded and accessible:
    ```tsx
    function TabsContent({ className, ...props }: TabsPrimitive.Panel.Props) {
      return (
        <TabsPrimitive.Panel
          data-slot="tabs-content"
          className={cn(
            'mt-6 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]',
            className,
          )}
          {...props}
        />
      )
    }
    ```
    `mt-6` gives the standard 24 px breathing room below the tablist. Panels receive `tabIndex={0}` automatically from Base UI — the focus-ring utility paints the ring when the panel itself is focused via Tab-into.
  - [x] 1e. `TabsIndicator` — optional animated underline. Included for forward-compatibility even though 3.2's visual uses the "filled pill" active state (`data-[active]:bg-card`) rather than an underline indicator. Export it so downstream stories can swap the visual language without touching the primitive:
    ```tsx
    function TabsIndicator({ className, ...props }: TabsPrimitive.Indicator.Props) {
      return (
        <TabsPrimitive.Indicator
          data-slot="tabs-indicator"
          className={cn(
            'absolute rounded-md bg-card transition-all duration-150 ease-out',
            className,
          )}
          {...props}
        />
      )
    }
    ```
    Not used in 3.2's JSX. Exported but inert. Document as "available for future underline variants" in a one-line file-header comment.
  - [x] Export statement (single consolidated export at the bottom, matches `sheet.tsx` style):
    ```ts
    export { Tabs, TabsList, TabsTrigger, TabsContent, TabsIndicator }
    ```
  - [x] Do NOT introduce a new Radix / Headless UI dependency. The project is on `@base-ui/react@^1.4.0` (already in `apps/web/package.json`) — `@base-ui/react/tabs` is a sibling of the already-consumed `@base-ui/react/dialog`, `@base-ui/react/button`, `@base-ui/react/input`, etc. See §Latest Technical Information for subpath-import confirmation.

- [x] **Task 2: Rewrite the dossier view route to render the new header + tab structure (AC: 1–15)**
  - [x] Edit `apps/web/src/routes/dashboard/dossiers/[slug].tsx`. Full rewrite of the rendered JSX; keep the existing `loadDossier` + `deslugifyForDisplay` helpers exactly as they are (do NOT touch their logic — they are 2.6-tested and 3.1-referenced).
  - [x] Add two NEW imports at the top:
    ```tsx
    import { useSearchParams } from 'react-router-dom'
    import { Button } from '@/components/ui/button'
    import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
    import { MOCK_DOSSIERS } from '@/data/mock-dossiers'
    ```
  - [x] Name resolution helper (AC9). Add INSIDE the route file (NOT in `mock-dossiers.ts`, NOT in `lib/`) because it's a single-caller lookup; premature abstraction costs more than it saves:
    ```ts
    function resolveDisplayName(slug: string): string {
      const mock = MOCK_DOSSIERS.find((d) => d.slug === slug)
      if (mock) return mock.name
      return deslugifyForDisplay(slug)
    }
    ```
    Case A (mock hit, no localStorage) / B (full hit) / C (wizard hit, no mock) / D (neither) — see the AC9 ladder.
  - [x] Active-tab resolution (AC2, 4, 5):
    ```ts
    const [searchParams, setSearchParams] = useSearchParams()
    const activeTab = searchParams.get('tab') === 'analytics' ? 'analytics' : 'content'
    ```
    Allowlist: only `'analytics'` triggers analytics; everything else (missing, empty, `'foo'`, duplicate values — `URLSearchParams.get()` returns the FIRST value) falls back to `'content'`. No `useEffect` needed here.
  - [x] Tab-change handler (AC3, 6). Use the functional `setSearchParams` overload so we can delete cleanly without clobbering other query params (even though 3.2 has none — defensive for Epic 7 filters):
    ```ts
    function handleTabChange(value: unknown) {
      setSearchParams(
        (prev) => {
          if (value === 'analytics') {
            prev.set('tab', 'analytics')
          } else {
            prev.delete('tab')
          }
          return prev
        },
        { replace: true },
      )
    }
    ```
    `replace: true` keeps tab-toggling out of browser history (a user clicking back after toggling tabs expects to land on the previous page, not cycle through tab states). See Pinned Decision #3.
  - [x] Render structure. The top-level markup for case A/B/C (any valid slug — mock OR localStorage hit) looks like:
    ```tsx
    return (
      <div className="mx-auto max-w-[720px]">
        <title>{displayName} · Confluent</title>

        <nav aria-label="Fil d'Ariane" className="mb-4">
          <ol className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <li>
              <Link
                to="/dashboard"
                className="rounded-sm hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
              >
                Dossiers
              </Link>
            </li>
            <li className="flex items-center gap-1.5">
              <span aria-hidden="true" className="text-muted-foreground/60">
                /
              </span>
              <span aria-current="page" className="font-medium text-foreground">
                {displayName}
              </span>
            </li>
          </ol>
        </nav>

        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <h1
            ref={headingRef}
            tabIndex={-1}
            className="font-heading text-2xl font-semibold text-foreground md:text-[28px] focus-visible:outline-none"
          >
            {displayName}
          </h1>
          <Button
            type="button"
            size="lg"
            className="h-11 self-start px-4 sm:self-auto"
          >
            Partager
          </Button>
        </div>

        <Tabs
          value={activeTab}
          onValueChange={handleTabChange}
          className="mt-6"
        >
          <TabsList>
            <TabsTrigger value="content">Contenu</TabsTrigger>
            <TabsTrigger value="analytics">Accès &amp; analytics</TabsTrigger>
          </TabsList>

          <TabsContent value="content">
            {dossier ? (
              <div className="flex flex-col gap-10">
                {QUESTIONNAIRE.map((section, i) => {
                  const sectionMetas = QUESTIONNAIRE_FLAT.filter(
                    (q) => q.sectionId === section.id,
                  )
                  return (
                    <section key={section.id}>
                      <h2 className="font-heading text-xl font-semibold text-foreground md:text-2xl">
                        {i + 1}. {section.title}
                      </h2>
                      <dl className="mt-4 flex flex-col gap-6">
                        {sectionMetas.map((q) => (
                          <DossierField
                            key={q.id}
                            label={q.label}
                            value={dossier.answers[q.id] ?? ''}
                          />
                        ))}
                      </dl>
                    </section>
                  )
                })}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Ce dossier n&apos;a pas encore de contenu renseigné.
              </p>
            )}
          </TabsContent>

          <TabsContent value="analytics">
            <div className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
              <p>L&apos;analytique de ce dossier s&apos;affichera ici.</p>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    )
    ```
  - [x] Case D (truly unknown slug — NOT in `MOCK_DOSSIERS` AND NOT in localStorage): keep the EXACT existing 2.6 fallback (no breadcrumb, no tabs, no button). The early-return guard becomes:
    ```tsx
    const mock = slug ? MOCK_DOSSIERS.find((d) => d.slug === slug) : undefined
    const dossier = slug ? loadDossier(slug) : null
    if (!slug || (!mock && !dossier)) {
      return (
        <section className="mx-auto max-w-md pt-16 text-center">
          <title>Dossier introuvable · Confluent</title>
          <p className="text-sm text-muted-foreground">Dossier introuvable.</p>
          <Link
            to="/dashboard"
            className="mt-4 inline-block text-sm underline hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
          >
            Retour au tableau de bord
          </Link>
        </section>
      )
    }
    ```
  - [x] `displayName` computation — uses `resolveDisplayName(slug)` on the happy path. Do NOT fall back to `'Dossier'` or `''` — the function is total on any non-empty string.
  - [x] Preserve the H1 focus-on-mount recipe EXACTLY. The `useEffect` keeps its dependency array `[slug]` — do NOT add `activeTab` (AC8: tab changes must not yank focus back to the H1). If a developer's IDE auto-adds the dep, REMOVE it back.

- [x] **Task 3: Leave the `router.tsx` route definition UNCHANGED (AC: 8)**
  - [x] Do NOT change `apps/web/src/router.tsx`. Specifically:
    - The `handle: { hideBreadcrumb: true }` on `dashboard/dossiers/view/:slug` MUST stay — it suppresses the shell `AppShell` → `Breadcrumbs` from rendering the path-segment-expanded crumbs (`Mes dossiers / Dossiers / View / Biosensio`), letting the route render its own 2-segment breadcrumb (AC1).
    - The path pattern stays `dashboard/dossiers/view/:slug`.
  - [x] Verify no test or snapshot asserts on `router.tsx` changes (there are none in 3.2 — the file is untouched).

- [x] **Task 4: Placeholder for Story 3.3 (AC: 3, 14)**
  - [x] The `<TabsContent value="analytics">` block in Task 2's skeleton contains the EXACT placeholder required by AC14 — a single `<div>` wrapping a single `<p>`. Nothing else.
  - [x] Do NOT preempt 3.3 by adding the MetricCard grid structure, `<h2>Accès & partage</h2>`, or an empty `<ul>` for future `AccessListRow` entries. 3.3 will open this file and swap the block atomically — extra structural stubs in 3.2 create merge friction.

- [x] **Task 5: Verify + guardrails (AC: 1–16)**
  - [x] `pnpm turbo run typecheck` → 2 successful, 0 errors. New exports from `components/ui/tabs.tsx` (`Tabs`, `TabsList`, `TabsTrigger`, `TabsContent`, `TabsIndicator`) must compile under TS strict. Base UI's `TabsPrimitive.Root.Props` / `.List.Props` / `.Tab.Props` / `.Panel.Props` / `.Indicator.Props` generic forwarding MUST preserve the `value` prop type (`unknown` in Base UI's generic — keep `handleTabChange: (value: unknown) => void` — do NOT narrow to a string literal union without a runtime guard).
  - [x] `pnpm turbo run lint` → 0 errors. Preserve the 3 tolerated pre-existing warnings (`badge.tsx:52`, `button.tsx:58`, `features/current-user/context.tsx:17` — all `react-refresh/only-export-components`). Zero new warnings. The new `tabs.tsx` file exports ONLY components + types — no ambient helpers, so it adds no new `react-refresh/only-export-components` complaint.
  - [x] `pnpm turbo run build` → 2 successful, 0 errors. Expected bundle delta vs 3.1 post-merge baseline:
    - CSS: +~0.1 kB gzip (new Tailwind utilities: `bg-muted`, `gap-1`, `whitespace-nowrap`, `shadow-sm`, `data-[active]:bg-card`, etc.).
    - JS: +~2-3 kB gzip (Base UI Tabs primitives — `Root`, `List`, `Tab`, `Panel`, `Indicator` — roughly comparable to the Dialog primitive added in 2.3 / 2.5).
  - [x] `pnpm turbo run dev` manual walkthrough (tri-viewport: 375 / 900 / 1440 px):
    1. Navigate to `/dashboard`. Click the Biosensio card. Verify: URL is `/dashboard/dossiers/view/biosensio` (no `?tab`). Breadcrumb shows `Dossiers / Biosensio`. H1 is "Biosensio" and receives focus on mount. Partager button is top-right. Two tabs: "Contenu" (active) and "Accès & analytics" (inactive). Content panel shows the empty-content fallback copy (`Ce dossier n'a pas encore de contenu renseigné.`) — because Biosensio is mock-only (no localStorage entry).
    2. Click "Accès & analytics" tab. Verify: URL becomes `/dashboard/dossiers/view/biosensio?tab=analytics`. Tab switches (active pill moves). The analytics panel renders the placeholder card with copy `L'analytique de ce dossier s'affichera ici.`. The content panel is unmounted (`<dl>` elements are gone from the DOM — inspect to confirm).
    3. Click "Contenu" tab. Verify: URL becomes `/dashboard/dossiers/view/biosensio` (no `?tab`, no `?` either). Tab switches back. Content panel re-renders the empty-content fallback.
    4. Navigate back then forward via the browser back/forward buttons. Verify: back takes you to `/dashboard` (NOT through each tab state — `replace: true` kept tab toggles out of history). Forward returns you to `/dashboard/dossiers/view/biosensio` at the current tab state.
    5. Direct-navigate to `/dashboard/dossiers/view/biosensio?tab=analytics` (paste URL into address bar). Verify: analytics tab active on mount, no flicker of the content panel. Verify: H1 receives focus on mount (`[slug]`-keyed `useEffect`).
    6. Direct-navigate to `/dashboard/dossiers/view/biosensio?tab=foo`. Verify: fall back to content tab, URL stays as `?tab=foo` (no auto-rewrite — re-reading the URL would un-focus the H1 on mount). Clicking any tab then normalises the URL.
    7. Direct-navigate to `/dashboard/dossiers/view/agrotrack`. Verify: H1 is "Agrotrack", everything else as Biosensio.
    8. Wizard-created dossier path: navigate to `/dashboard/dossiers/nouveau`, complete the 2.3 → 2.4 → 2.5 → 2.6 flow to seed a `confluent_dossier_mon-test` localStorage entry (create dossier named "Mon Test"). Navigate to `/dashboard/dossiers/view/mon-test`. Verify: H1 is "Mon Test" (via `deslugifyForDisplay` — NOT in `MOCK_DOSSIERS`). Content tab shows the 2.6 section list with `DossierField`s. Analytics tab shows the placeholder.
    9. Unknown-slug path: direct-navigate to `/dashboard/dossiers/view/jean-dupont-fictif`. Verify: 2.6 "Dossier introuvable" fallback renders — NO breadcrumb, NO tabs, NO Partager button.
    10. Keyboard-only run: on `/dashboard/dossiers/view/biosensio`:
        - Tab once → focus moves from H1 to the breadcrumb "Dossiers" link.
        - Tab again → focus lands on the Partager button.
        - Tab again → focus enters the tablist on the "Contenu" tab (active).
        - `ArrowRight` → focus + activation move to "Accès & analytics". URL updates to `?tab=analytics`.
        - `ArrowLeft` → back to "Contenu". URL normalises.
        - `Home` → first tab (Contenu). `End` → last tab (Accès & analytics).
        - Tab once more from the tablist → focus lands on the active panel body. The panel has a visible focus ring.
        - `Shift+Tab` reverses the whole order.
    11. Axe audit (populated dossier — Biosensio): content tab AND analytics tab. Expect: 0 serious, 0 critical. `role="tablist"`, `role="tab"`, `role="tabpanel"`, `aria-selected`, `aria-controls`, `aria-labelledby` are all automatic via Base UI — verify via DOM inspection.
    12. Mobile (375 px): header row stacks (breadcrumb → H1 → button), tablist stays inline, the two tab labels fit without wrapping. No horizontal scrollbar.
    13. `prefers-reduced-motion: reduce` toggle: `transition-colors` on tabs is a colour fade, not a transform — already motion-safe. No change needed.
    14. Long-name probe: temporarily add a `MOCK_DOSSIERS` entry with `slug: 'tres-long-nom'` + `name: 'Tres Long Nom De Projet Agro-Alimentaire Coopératif'`. Navigate to `/dashboard/dossiers/view/tres-long-nom`. Verify: H1 wraps gracefully (the H1 is block-level, already wraps at the `max-w-[720px]` container width), Partager button stays right-aligned, no horizontal overflow at 375 px. Restore the fixture.
  - [x] No regression on Stories 1.1 – 3.1:
    - `/dashboard` list still renders (3.1).
    - `/dashboard/dossiers/nouveau` naming step still reachable (2.3).
    - Questionnaire / completion / dossier-view flow 2.4 / 2.5 / 2.6 unchanged on the Content panel. The 2.6 section + DossierField rendering moves INSIDE the Content panel but the DOM structure per-section is identical.
    - Shell `AppShell` + sidebar + skip-link unchanged (2.1 baseline).
    - Shell `Breadcrumbs` continues to auto-suppress on `/dashboard` and stays suppressed on this route via the pre-existing `handle: { hideBreadcrumb: true }` (untouched in Task 3).

- [x] **Task 6: Self-review sweep before marking story done**
  - [x] Confirm all 16 ACs trace to code (AC → Task / component mapping documented in each AC block and each Task header).
  - [x] Confirm no raw hex values in the new `tabs.tsx` AND in the rewritten `[slug].tsx` (`grep -nE '#[0-9a-fA-F]{3,6}' apps/web/src/components/ui/tabs.tsx apps/web/src/routes/dashboard/dossiers/[slug].tsx` must return zero).
  - [x] Confirm `useEffect(..., [slug])` — NOT `[slug, activeTab]` — in the route file (AC8 / Pinned Decision #7).
  - [x] Confirm `setSearchParams(..., { replace: true })` — NOT `push` / default — in `handleTabChange` (AC6 / Pinned Decision #3).
  - [x] Confirm `TabsList`, `TabsTrigger`, `TabsContent`, `TabsIndicator` all accept `className` as prop (props spread preserves the `className` forwarding) — developers should be able to add a one-off layout override without touching the primitive.
  - [x] Confirm the breadcrumb `<nav>` uses `aria-label="Fil d'Ariane"` (French) — consistency with the shell `Breadcrumbs` component at [apps/web/src/components/layout/Breadcrumbs.tsx](../../../../../apps/web/src/components/layout/Breadcrumbs.tsx#L35).
  - [x] Confirm the "Partager" button has NO `onClick`, NO `disabled`, NO `aria-disabled`. It is functionally a no-op button in 3.2; Story 3.5 wires it up to open the `Sheet` D5 panel. `type="button"` is set to prevent accidental form submission if wrapped in a form later.
  - [x] `grep -n 'hideBreadcrumb' apps/web/src/router.tsx` → ONE hit on the `dashboard/dossiers/view/:slug` entry (untouched). Confirms Task 3 did not disturb the breadcrumb suppression.

### Review Findings

Source layers: Blind Hunter (adversarial), Edge Case Hunter (path enumeration), Acceptance Auditor (spec compliance). Triage counts — 1 decision-needed (resolved → dismissed), 1 patch (applied), 7 deferred, 24 dismissed as noise.

- [x] [Review][Decision] Spec contradicts itself on `TabsTrigger` min-height — AC15 mandates `min-h-11` (44 px) on the trigger base; Task 1 Subtask 1c snippet + Pinned recipe at line 129 say `min-h-9` (36 px) + `p-1` on the list = 44 px outer. Implementation at [apps/web/src/components/ui/tabs.tsx:38](../../../../../apps/web/src/components/ui/tabs.tsx#L38) uses `min-h-9`. **Resolved: dismissed** — switching to `min-h-11` would have overflowed the `TabsList` (`h-11`, 36 px inner after `p-1`) or forced the list to grow to 52 px, diverging from the shadcn canonical filled-pill design. Pinned Decision #6's compositional approach (`min-h-9` body + `p-1` padding = 44 px outer) is the lower-debt option; AC15's literal `min-h-11` text is the real spec bug. Satisfied mathematically via the list's padding.
- [x] [Review][Patch] Missing `import * as React from "react"` in `tabs.tsx` [[apps/web/src/components/ui/tabs.tsx:1](../../../../../apps/web/src/components/ui/tabs.tsx#L1)] — Task 1 "Import surface" lists it, and the sibling pattern it was told to mirror ([apps/web/src/components/ui/sheet.tsx:1](../../../../../apps/web/src/components/ui/sheet.tsx#L1)) includes it. Functionally redundant under the automatic JSX transform but required for codebase-convention parity. **Fixed.**
- [x] [Review][Defer] Magic string `'analytics'` duplicated across ≥4 sites [[apps/web/src/routes/dashboard/dossiers/[slug].tsx:82,87,143,178](../../../../../apps/web/src/routes/dashboard/dossiers/%5Bslug%5D.tsx#L82)] — deferred, extract a `TAB_VALUES` union when Story 3.3 opens this file for the MetricCard swap.
- [x] [Review][Defer] `QUESTIONNAIRE_FLAT.filter` recomputed per render inside the `.map` [[apps/web/src/routes/dashboard/dossiers/[slug].tsx:149-152](../../../../../apps/web/src/routes/dashboard/dossiers/%5Bslug%5D.tsx#L149-L152)] — pre-existing from 2.6, trivial cost today. Revisit with `useMemo` if the content panel ever renders heavier derivations.
- [x] [Review][Defer] `headingRef.current?.focus()` lacks `{ preventScroll: true }` [[apps/web/src/routes/dashboard/dossiers/[slug].tsx:61-63](../../../../../apps/web/src/routes/dashboard/dossiers/%5Bslug%5D.tsx#L61-L63)] — pre-existing from 2.6; deep-linked `?tab=analytics` still causes the page to jump-scroll to the H1 on mount. Deferred to a dedicated a11y polish pass (probably alongside Story 4.x focus review).
- [x] [Review][Defer] `Tabs` root has no `aria-label` / `aria-labelledby` [[apps/web/src/routes/dashboard/dossiers/[slug].tsx:140](../../../../../apps/web/src/routes/dashboard/dossiers/%5Bslug%5D.tsx#L140)] — not flagged by axe (WAI-ARIA treats individual tab labels as the accessible name), but screen-reader users hear an unnamed tablist on entry. Revisit alongside AC16 a11y audit of the full page.
- [x] [Review][Defer] Scroll position is not preserved when switching tabs [[apps/web/src/routes/dashboard/dossiers/[slug].tsx:140](../../../../../apps/web/src/routes/dashboard/dossiers/%5Bslug%5D.tsx#L140)] — UX polish; not required by spec. Revisit if users report disorientation on the real analytics panel in 3.3.
- [x] [Review][Defer] `TabsIndicator` has `absolute` positioning but no documented relative parent [[apps/web/src/components/ui/tabs.tsx:68](../../../../../apps/web/src/components/ui/tabs.tsx#L68)] — unused in 3.2 (forward-compat export per Pinned Decisions #6 and #12). Revisit when a future underline-variant story consumes it; add a `relative` wrapper or document the caller contract then.
- [x] [Review][Defer] Rapid tab toggling via `setSearchParams(..., { replace: true })` could drop intermediate history entries — spec-mandated behaviour (AC3/AC6/Pinned Decision #3). Documenting here for visibility; no action.

<details>
<summary>Dismissed findings (24) — click to expand</summary>

- `handleTabChange(value: unknown)` typing — Pinned Decision #11: intentional.
- Mutating `prev` inside the `setSearchParams` updater — matches the react-router functional-updater contract.
- Unknown `?tab=` values do not reset the URL on mount — AC5 explicitly forbids URL rewrites on mount.
- `MOCK_DOSSIERS` name overriding a user-renamed dossier — Pinned Decision #8: mock wins for the 3.1 integration seam.
- Partager button has no `onClick` / `disabled` / `aria-disabled` — Pinned Decision #10: non-functional in 3.2 by design; wired in 3.5.
- Double-quoted imports in `tabs.tsx` — matches sibling `sheet.tsx`; the "rest of the codebase uses single quotes" claim does not hold for `components/ui/*.tsx` wrappers.
- `outline-[var(--ring)]` fragility — `--ring` token is defined by story 1.2 design-system configuration.
- `mt-6` on both `TabsContent` and the consumer `Tabs` — the consumer `mt-6` spaces the Tabs block from the header; the primitive `mt-6` spaces the Panel from the TabsList. Different axes.
- `&apos;` escaping in French strings — canonical JSX pattern to satisfy `react/no-unescaped-entities`.
- `size="lg"` + `h-11` redundancy — AC1 explicitly prescribes both; the Button's `size="lg"` already produces `h-11`.
- No suspense / loading state for `MOCK_DOSSIERS` — static ES import, synchronous by guarantee.
- `setSearchParams(..., { replace: true })` wiping other query params — the updater preserves them; only `'tab'` is set/deleted.
- `Tabs` controlled mode with no `defaultValue` — Vite SPA, no SSR / hydration risk.
- Breadcrumb "page" segment disagreeing with `resolveDisplayName` — verified: line 117 renders `{displayName}` from `resolveDisplayName`.
- `data-[active]:bg-card` depends on Base UI's `data-active` attribute — documented primitive contract.
- Case variants of `?tab=Analytics` / `?tab=ANALYTICS` falling back to content — AC5 mandates allowlist of literal `'analytics'`.
- Duplicate `?tab=content&tab=analytics` — AC5 mandates `URLSearchParams.get('tab')` (first-wins).
- Empty `displayName` from `deslugifyForDisplay` on slug `'-'` — unreachable: guard rejects non-mock + non-dossier slug first.
- `handleTabChange` receives non-string `value` — the `value === 'analytics'` strict check safely narrows; any non-match deletes the `tab` param.
- `Array.isArray(MOCK_DOSSIERS)` guard — static import invariant; not defensible against intentional mutation.
- `Tabs` / `TabsList` wrapper does not `forwardRef` — spec does not require ref forwarding for 3.2 usage.
- `TabsContent` missing explicit `tabIndex={0}` — Base UI's `Panel` primitive emits `tabIndex={0}` automatically (AC7 / §Latest Technical Information).
- `activeTab` triggering controlled/uncontrolled React warning — derivation is stable per render; no warning.
- `const mock = ...find(...)` is "dead" — false positive; used in the `!mock && !dossier` guard at line 65.

</details>

## Dev Notes

### Critical Architecture Constraints

- **Tabs primitive lives at `apps/web/src/components/ui/tabs.tsx`** — shadcn-style wrapper over `@base-ui/react/tabs`, matching the pattern of `sheet.tsx`, `badge.tsx`, `button.tsx`, `input.tsx`, `separator.tsx`, `avatar.tsx`, `sonner.tsx`. These wrappers live in `components/ui/` — the settled home for shadcn-style primitives (Story 3.1 Pinned Decision #1 reaffirms the `components/ui/` vs `components/confluent/` split). [Source: [apps/web/src/components/ui/sheet.tsx](../../../../../apps/web/src/components/ui/sheet.tsx); architecture.md §Code Structure §React Source Layout; ux-design-specification.md §Component Implementation Strategy]
- **Dossier page rewrite stays in-place at `apps/web/src/routes/dashboard/dossiers/[slug].tsx`** — a single-route file. Do NOT extract a `DossierPageHeader` component in 3.2: Epic 3 has 4 more stories (3.3–3.6) that all touch this same header, so extraction pressure MAY emerge in 3.3 or 3.5. Extracting in 3.2 pre-commits to a shape that 3.5's D5 Sheet integration may contradict. Keep it inline for now; refactor on demand when a second caller needs it. [Source: Story 3.1 Dev Notes §Cross-Epic anticipation — 3.2/3.3/3.5 pressure forecast]
- **Route path remains `dashboard/dossiers/view/:slug`** — the real path established by the Story 2.6 code-review patch; the epic AC's bare `:slug` form does NOT exist. Same discrepancy flagged in Story 3.1 Pinned Decision #5. Do NOT "fix" the route to match the epic AC. [Source: [apps/web/src/router.tsx](../../../../../apps/web/src/router.tsx#L38-L42); Story 2.6 Review Findings; Story 3.1 Pinned Decision #5]
- **The `handle: { hideBreadcrumb: true }` on the view route is load-bearing** — the shell `Breadcrumbs` component in `AppShell` expands path segments into crumbs. The path `/dashboard/dossiers/view/biosensio` would expand to `Mes dossiers / Dossiers / View / Biosensio` (4 crumbs, with "View" looking like a real sub-page — ugly and semantically wrong). The local in-route breadcrumb hand-rolls the correct 2 crumbs (`Dossiers / Biosensio`). Do NOT try to teach the shell Breadcrumbs about `view/:slug` — it would require shell-level knowledge of dossier data, fixture lookups, and slug-to-name resolution. Local-breadcrumb-in-route is the cleaner boundary. [Source: [apps/web/src/components/layout/Breadcrumbs.tsx](../../../../../apps/web/src/components/layout/Breadcrumbs.tsx#L25-L28); [apps/web/src/router.tsx](../../../../../apps/web/src/router.tsx#L38-L42); Story 2.6]
- **Base UI Tabs uses automatic tab activation** — tabs activate on FOCUS, not on click / Enter. `Tab` / `ArrowLeft` / `ArrowRight` focus moves trigger a `value` change. This matches the WAI-ARIA "Automatic Activation" pattern (the other pattern, "Manual Activation", would require the user to press Enter / Space to activate focused tabs). Confluent uses automatic activation — it's the default and the dominant shadcn convention. Do NOT override. [Source: [@base-ui/react/tabs/root/TabsRoot.d.ts](../../../../../node_modules/.pnpm/%40base-ui%2Breact%401.4.0_%40date-fns%2Btz%401.4.1_%40types%2Breact%4019.2.14_date-fns%404.1.0_react-dom%4019.2.5_react%4019.2.5__react%4019.2.5/node_modules/%40base-ui/react/tabs/root/TabsRoot.d.ts); [WAI-ARIA Authoring Practices — Tabs](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/)]
- **URL is the source of truth for the active tab** — `useSearchParams()` reads; `setSearchParams(..., { replace: true })` writes. No `useState`, no `useRef` mirrored state, no "initial value" shenanigans. The `Tabs` component is controlled (`value={activeTab}`), not uncontrolled — uncontrolled would drift from the URL on back/forward navigation and break the deep-link AC4. [Source: [React Router v7 — `useSearchParams`](https://reactrouter.com/api/hooks/useSearchParams)]
- **`replace: true` on `setSearchParams`** — tab toggles are visual state, not navigation events. Pushing each toggle to history would have "back" cycle through tab states instead of taking the user to the previous page. A user who toggled `Contenu → Analytics → Contenu → Analytics → Contenu` expects `back` → dashboard, not four `back` presses to unwind. [Source: [React Router v7 — Navigation Options](https://reactrouter.com/en/main/start/overview#navigation)]
- **Mock-to-localStorage bridge lives in `resolveDisplayName`** — this is the 3.1 → 3.2 integration seam flagged in Story 3.1 Pinned Decision #2. The mock fixture answers "does this slug have a canonical display name?"; localStorage (via `loadDossier`) answers "does this slug have wizard-authored content?". The two are independent: a slug can be in (mock, not storage), (storage, not mock), (both), (neither — fallback to introuvable). AC9 / 10 / 11 / 12 / 13 enumerate the four cases. [Source: Story 3.1 §Cross-Epic anticipation; [apps/web/src/data/mock-dossiers.ts](../../apps/web/src/data/mock-dossiers.ts)]
- **Design tokens only — no raw hex.** `bg-muted`, `bg-card`, `text-muted-foreground`, `text-foreground`, `border-border`, `shadow-sm`, `focus-visible:outline-[var(--ring)]` cover the new surfaces. Do NOT introduce `#…` literals in `tabs.tsx` or the route rewrite. [Source: [apps/web/src/index.css](../../../../../apps/web/src/index.css#L52-L90); Story 3.1 Anti-Patterns]
- **H1 recipe stays at `text-2xl font-semibold md:text-[28px]`** — 600 weight, NOT 700 as the Epic AC literally says. All prior H1s (2.5 / 2.6 / 3.1) use 600 — swapping to 700 on the dossier page alone would read as louder than the dashboard H1 and break the hierarchy. See Pinned Decision #5. [Source: Stories 2.5 / 2.6 / 3.1 Dev Notes; ux-design-specification.md §Typography]
- **H1 focus-on-mount is `useEffect(..., [slug])`** — NOT `[slug, activeTab]`. Tab changes must not yank focus back to the H1; only navigation to a different dossier (different slug) triggers the focus recipe. See Pinned Decision #7. [Source: Stories 2.5 / 2.6]
- **No `react-hook-form`, no `zod`, no TanStack Query on 3.2.** The tab-switch is URL state via `useSearchParams`; no form fields, no server round-trips. Forms and server state land in Epic 7 / the SharePanel in Story 3.5.
- **`@base-ui/react/tabs` is already in the dependency graph** — `@base-ui/react@^1.4.0` is in `apps/web/package.json`. The Tabs subpath exports resolve through the same package that provides `dialog`, `avatar`, `button`, `separator`, `input` — no new dependency, no lockfile change. [Source: [apps/web/package.json](../../../../../apps/web/package.json#L14); [node_modules/.pnpm/@base-ui+react@1.4.0…/node_modules/@base-ui/react/tabs/index.d.ts](../../../../../node_modules/.pnpm/%40base-ui%2Breact%401.4.0_%40date-fns%2Btz%401.4.1_%40types%2Breact%4019.2.14_date-fns%404.1.0_react-dom%4019.2.5_react%4019.2.5__react%4019.2.5/node_modules/%40base-ui/react/tabs/index.d.ts)]
- **French-locale typography unchanged.** The tab label "Accès & analytics" is already in-spec French with the ampersand spelled literally (no French typographic space around `&`). Copy verbatim from the Epic — do NOT "correct" to `Accès et analytics` or `Accès  &  analytics`.
- **WCAG 2.1 AA baseline:** breadcrumb landmark (`<nav aria-label="Fil d'Ariane">`), H1 focus-on-mount, `role="tablist"` + `role="tab"` + `role="tabpanel"` + `aria-selected` + `aria-labelledby` (all automatic via Base UI), visible focus ring on every interactive element, 44 × 44 tap targets on Partager and each tab. Status-of-active-tab does NOT rely on colour alone — the `data-[active]:bg-card` recipe + `data-[active]:shadow-sm` + the text becoming `text-foreground` (from `text-muted-foreground`) produces a shift in brightness + elevation that reads on monochrome. [Source: ux-design-specification.md §Accessibility, §Touch Targets]

### Design Tokens to Use

| Surface | Tailwind utility | Value | Where |
|---|---|---|---|
| Page container | `mx-auto max-w-[720px]` | 720 px column | Outer `<div>` |
| Breadcrumb text | `text-xs text-muted-foreground` | 12 px / `#6B6B6B` | `<ol>` / non-current segment |
| Breadcrumb current | `font-medium text-foreground` | 500 / `#1A1A1A` | `aria-current="page"` span |
| Breadcrumb separator `/` | `text-muted-foreground/60` + `aria-hidden="true"` | decorative | Inter-segment |
| Header row | `flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between` | Responsive | H1 + button |
| H1 | `font-heading text-2xl md:text-[28px] font-semibold text-foreground focus-visible:outline-none` | 24 → 28 px / 600 / `#1A1A1A` | Dossier name |
| Partager button | `size="lg"` + `h-11 self-start px-4 sm:self-auto` | 44 px primary | Top-right of header row |
| Tabs container | `mt-6` | 24 px gap below header | `<Tabs>` |
| TabsList | `inline-flex h-11 items-center gap-1 rounded-lg bg-muted p-1 text-muted-foreground` | 44 px muted pill | Tablist surface |
| TabsTrigger (base) | `inline-flex min-h-9 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)] disabled:pointer-events-none disabled:opacity-50` | 36 px body | Each tab |
| TabsTrigger (active) | `data-[active]:bg-card data-[active]:text-foreground data-[active]:shadow-sm` | `#FFFFFF` bg / `#1A1A1A` text / subtle elevation | Active-pill effect |
| TabsContent | `mt-6 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]` | 24 px gap below list | Panel root |
| Content-empty fallback | `text-sm text-muted-foreground` | 14 px / `#6B6B6B` | "Ce dossier n'a pas encore…" copy |
| Analytics placeholder card | `rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground` | `#FFFFFF` bg / `#E8E8E7` border / 6 px radius / 24 px padding | Story 3.3 swap-point |

### Component Prop Contracts (exhaustive)

```ts
// apps/web/src/components/ui/tabs.tsx
import type * as TabsPrimitive from '@base-ui/react/tabs'

export function Tabs(props: TabsPrimitive.Root.Props): JSX.Element
export function TabsList(props: TabsPrimitive.List.Props): JSX.Element
export function TabsTrigger(props: TabsPrimitive.Tab.Props): JSX.Element
export function TabsContent(props: TabsPrimitive.Panel.Props): JSX.Element
export function TabsIndicator(props: TabsPrimitive.Indicator.Props): JSX.Element
// All five forward {...props} after applying default className — callers can override.

// apps/web/src/routes/dashboard/dossiers/[slug].tsx
export default function DossierViewRoute(): JSX.Element  // rewritten
// Local helpers (NOT exported):
function resolveDisplayName(slug: string): string
function loadDossier(slug: string): { answers: Record<string, string> } | null  // UNCHANGED
function deslugifyForDisplay(slug: string): string                                 // UNCHANGED
```

### File Layout (target)

```
apps/web/src/
├── components/
│   ├── confluent/                                                [UNCHANGED]
│   ├── layout/                                                   [UNCHANGED]
│   └── ui/
│       ├── avatar.tsx                                            [UNCHANGED]
│       ├── badge.tsx                                             [UNCHANGED]
│       ├── button.tsx                                            [UNCHANGED]
│       ├── card.tsx                                              [UNCHANGED]
│       ├── input.tsx                                             [UNCHANGED]
│       ├── label.tsx                                             [UNCHANGED]
│       ├── separator.tsx                                         [UNCHANGED]
│       ├── sheet.tsx                                             [UNCHANGED]
│       ├── sonner.tsx                                            [UNCHANGED]
│       └── tabs.tsx                                              [NEW — Base UI Tabs wrapper]
├── data/                                                         [UNCHANGED — MOCK_DOSSIERS consumed, not modified]
├── features/                                                     [UNCHANGED]
├── lib/                                                          [UNCHANGED]
├── routes/
│   └── dashboard/
│       ├── index.tsx                                             [UNCHANGED — 3.1 dashboard]
│       ├── tableau-de-bord.tsx                                   [UNCHANGED]
│       └── dossiers/
│           ├── [slug].tsx                                        [REWRITTEN — header + tabs + mock bridge]
│           └── nouveau/                                          [UNCHANGED]
└── router.tsx                                                    [UNCHANGED — `hideBreadcrumb: true` preserved]
```

### Previous Story Intelligence

**From Story 3.1 (just landed):**
- `MOCK_DOSSIERS` exposes `{ slug, name, sector, maturity, activeShareLinksCount, createdAt }` per entry. Story 3.2 uses `slug` + `name` ONLY — `sector` / `maturity` / `activeShareLinksCount` / `createdAt` are consumed by the dashboard card (3.1) and will be consumed by the dossier-page header expansions of 3.3 (MetricCard `activeShareLinksCount` seed) and 3.4 (per-row state from `AccessListRow`). Do NOT expand `MockDossier` with extra fields in 3.2 — the interface is stable for 3.2's header needs.
- The integration seam flagged in Story 3.1 Pinned Decision #2 ("clicking a card today lands on 'Dossier introuvable'") is CLOSED by the `resolveDisplayName` helper introduced here. After 3.2, clicking Biosensio lands on the dossier page with H1 "Biosensio" and the content panel's empty-content fallback (Agrotrack / Biosensio have no wizard-authored answers yet).
- `/dashboard/dossiers/view/:slug` is the canonical path. The epic AC says `:slug` without the `view/` prefix — same wording drift documented in 3.1.
- `Button size="lg" + h-11 px-4` is the primary-button recipe for 44 px touch targets — reuse for the Partager button.
- The H1 focus-on-mount recipe (`useRef` + `useEffect(() => headingRef.current?.focus(), [slug])` + `tabIndex={-1}` + `focus-visible:outline-none`) is established across 2.5 / 2.6 / 3.1. Preserve in 3.2.
- `components/confluent/` hosts design-system display primitives (`DossierField`, `DossierCard`, `EmptyState`). `components/ui/` hosts shadcn-style wrappers (`badge`, `button`, `sheet`, ...). `Tabs` goes in `components/ui/`.
- `lucide-react` is in the dependency set but 3.2 does NOT add any icon (the tablist shows text-only labels per the Epic AC).

**From Stories 2.1 – 2.6 (carried):**
- `AppShell` + sidebar + breadcrumb auto-suppression via `handle.hideBreadcrumb` is the established pattern for routes whose breadcrumb can't be computed from path segments alone. Dossier view is one such route (depth 3 path → 2 semantic crumbs).
- Story 2.6 renders its own 2-segment breadcrumb inside the dossier view — this story preserves that pattern and expands the header with the Partager button and the tablist. NO visual regression on the existing breadcrumb copy.
- The 2.6 dossier content (section list + `DossierField` dl) moves INSIDE `<TabsContent value="content">` — no other changes to it. Section / field rendering logic is unchanged.
- The `handle: { hideBreadcrumb: true }` is already on the dossier view route in `router.tsx`. DO NOT re-add it or remove it — it's correct as-is.

**Cross-Epic anticipation (for 3.3+):**
- Story 3.3 is the single replace-point consumer of the `<TabsContent value="analytics">` placeholder. Keep the placeholder block as simple as `<div>…<p>…</p></div>` — adding a pre-emptive `<h2 className="…">Accès & partage</h2>` or a grid `<ul>` stub would be merge friction for 3.3.
- Story 3.5 will wire the Partager button to open the D5 Sheet. In 3.2, the button has NO `onClick` — a `Sheet`-with-a-bound-onClick skeleton is premature (would require importing / wiring the Sheet primitive in 3.2 for no user-visible value). Story 3.5 will add the onClick + Sheet state.
- Story 3.6 (access revocation) operates on `AccessListRow` inside the analytics panel. 3.2 does NOT surface any revocation control — the Partager button is the only header action.

### Anti-Patterns to Avoid

- **Do NOT store the active tab in `useState` or `useRef` alongside the URL.** Two sources of truth drift — specifically on browser back/forward, which only updates the URL. `useSearchParams()` + a derived `activeTab` ternary IS the state.
- **Do NOT default to `push` for tab toggles.** `replace: true` is load-bearing — without it, a user toggling tabs N times needs N `back` presses to leave the page. `replace: true` makes the back button "obvious" (back = previous page, not previous tab state).
- **Do NOT rewrite the URL on mount from an unknown `?tab=<foo>` value.** AC5 requires silent fallback (active tab = Contenu) without URL side-effects. Writing to the URL on mount would race with the H1 focus-on-mount recipe, produce a scroll jump on some browsers, and break the deep-link idempotency.
- **Do NOT hardcode the `?tab=` allowlist in multiple places.** Two derivations: the read (`searchParams.get('tab') === 'analytics' ? 'analytics' : 'content'`) and the write (`handleTabChange`'s `'analytics'` branch). Keeping them both as literal `'analytics'` strings is fine for 2 tabs; do NOT introduce an allowlist constant (e.g., `VALID_TABS = ['content', 'analytics'] as const`) prematurely — it's a readability tax with no benefit at 2 tabs. If Story 3.x introduces a third tab, extract then.
- **Do NOT add `activeTab` to the H1-focus `useEffect` deps.** The H1 gets focus on navigation to a different slug; tab changes are NOT navigations.
- **Do NOT wire the Partager button's onClick in 3.2.** Story 3.5 owns the D5 Sheet integration. A no-op button is correct in 3.2 — adding a `console.log` or a toast would be cosmetic waste that 3.5 has to unwind.
- **Do NOT hide / disable the Partager button.** It MUST be functionally present for AC1 and AC10 (keyboard tab order). `disabled` would make it skippable in the tab order — AC violation.
- **Do NOT extract a `DossierPageHeader` component in 3.2.** Single-caller; extraction would make the 3.5 Sheet wiring harder (the Sheet state needs to live in the route so it can consume `useParams` + `useNavigate`). If 3.5 ends up needing the header in two places, extract then.
- **Do NOT add a third tab "speculatively" (e.g., Documents, Paramètres).** Epic 3 has exactly two tabs. YAGNI.
- **Do NOT hand-roll `role="tablist"` / `role="tab"` / `aria-selected` — the Base UI primitives emit them automatically.** Duplicating them on the wrapper would conflict with Base UI's output.
- **Do NOT import from the top-level `@base-ui/react`** (i.e., `import { Tabs } from '@base-ui/react'`). Always subpath-import (`@base-ui/react/tabs`, `@base-ui/react/dialog`, etc.) — matches the existing wrappers and keeps the tree-shake tight.
- **Do NOT use the shadcn `Card` primitive for the analytics placeholder block.** The block is a one-off rectangle — shadcn `Card` would bake in `gap-6` / `px-6 py-5` / a `rounded-lg` clip that cascades onto the eventual `MetricCard` grid + `AccessListRow` container from Story 3.3. A raw `<div>` with token utilities is the lowest-friction swap-point.
- **Do NOT introduce `TabsIndicator` JSX in 3.2.** The export exists for forward-compat, but the 3.2 visual is the "filled pill" (`data-[active]:bg-card`). Layering an indicator on top would double-style the active state.
- **Do NOT normalise `?tab=foo` to `?tab=content` or to no-param on mount.** AC5 is strict: unknown value → fall back visually to Contenu, leave URL untouched. The URL only normalises on the NEXT user interaction.

### Testing Requirements

- **Unit / integration tests remain out of scope** for Epic 3 frontend — no Vitest/RTL harness introduced. Do not add one here.
- **Manual verification is the primary gate** (Task 5 walkthrough). Tri-viewport (375 / 900 / 1440 px), axe audit on: (a) Contenu tab populated (use wizard-created slug), (b) Contenu tab mock-only (Biosensio — empty-content fallback), (c) Analytics tab placeholder, (d) the unknown-slug "Dossier introuvable" branch. Screen-reader sanity: VoiceOver / NVDA should announce the tablist as "Navigation par onglets, 2 onglets, Contenu sélectionné" (translation varies — the key is that `role="tablist"` is detected).
- **Type safety:** `Tabs` / `TabsList` / `TabsTrigger` / `TabsContent` / `TabsIndicator` forward the Base UI generic props. Any consumer-side `className` / `children` / `value` prop must resolve cleanly under `tsc --strict`. The `handleTabChange: (value: unknown) => void` handler's `unknown` type matches Base UI's `TabsTab.Value = any | null` — do NOT narrow to `string` without a runtime guard (Base UI docs literally type the value as `any | null`).
- **No new lint warnings** beyond the 3 tolerated ones (badge, button, current-user). Run `pnpm turbo run lint` before marking done.
- **No regression on Stories 1.1 – 3.1 ACs** — full table in Task 5. Specifically:
  - `/dashboard` list renders 2 mocked cards and the header button (3.1).
  - `/dashboard/dossiers/nouveau` → 2.3 naming step → 2.4 questionnaire → 2.5 section summary → 2.6 completion + dossier view all reachable. The 2.6 dossier view rendering of sections + `DossierField`s is now INSIDE `<TabsContent value="content">` but otherwise identical — no DOM changes per-section.
  - Shell `Breadcrumbs` auto-suppresses on `/dashboard` (1-segment short-circuit) AND is suppressed on `/dashboard/dossiers/view/:slug` via the pre-existing `handle.hideBreadcrumb` (Task 3 confirms untouched).
- **Router integration verification:**
  - `/dashboard/dossiers/view/biosensio` → mocked-name header (H1 = "Biosensio" from `MOCK_DOSSIERS`).
  - `/dashboard/dossiers/view/agrotrack` → mocked-name header (H1 = "Agrotrack").
  - `/dashboard/dossiers/view/mon-test` (after wizard flow) → `deslugifyForDisplay`-derived header (H1 = "Mon Test").
  - `/dashboard/dossiers/view/jean-dupont-fictif` → "Dossier introuvable" fallback.
- **URL round-trip matrix (document manually):**
  | Entry URL | Post-mount state | After click Analytics | After click Contenu |
  |---|---|---|---|
  | `/.../view/biosensio` | Contenu active | `?tab=analytics` / Analytics active | `/.../view/biosensio` (no `?`) / Contenu active |
  | `/.../view/biosensio?tab=analytics` | Analytics active | (unchanged) | `/.../view/biosensio` / Contenu active |
  | `/.../view/biosensio?tab=foo` | Contenu active (URL untouched) | `?tab=analytics` (replaces `foo`) / Analytics active | `/.../view/biosensio` / Contenu active |
  | `/.../view/biosensio?tab=` | Contenu active (URL untouched) | `?tab=analytics` | `/.../view/biosensio` / Contenu active |
- **Accessibility audit checklist:**
  - `role="tablist"` on the `<TabsList>` container — automatic via Base UI.
  - `role="tab"` + `aria-selected={true|false}` + `aria-controls={panelId}` on each `<TabsTrigger>` — automatic.
  - `role="tabpanel"` + `aria-labelledby={tabId}` on each `<TabsContent>` — automatic.
  - Focus ring on the active `<TabsTrigger>` when focused via keyboard — comes from the `focus-visible:outline-…` recipe.
  - Arrow-key navigation moves between tabs with automatic activation — comes from Base UI default.
  - Tab key from the tablist moves focus into the active panel — comes from Base UI default (`tabIndex={0}` on the panel).
  - Skip-link (`AppShell`) still works — clicking "Aller au contenu principal" moves focus to `#main-content`, which contains this route's content.

### Decisions Pinned for This Story (flag if divergence is intentional)

1. **`Tabs` primitive lives at `components/ui/tabs.tsx`, not `components/confluent/`.** It is a shadcn-style wrapper over a Base UI primitive — the `components/ui/` folder is the settled home for those. `components/confluent/` is reserved for design-system display primitives with Confluent-specific anatomy (`DossierField`, `DossierCard`, `EmptyState`) — Tabs is a generic interaction primitive and belongs next to `Sheet`, `Badge`, `Button`, `Input`, `Separator`, `Avatar`, `Sonner`.
2. **Shell `Breadcrumbs` stays suppressed on the dossier view route** (existing `handle: { hideBreadcrumb: true }` — unchanged). The route renders its own 2-segment breadcrumb inline. Reason: the shell `Breadcrumbs` is purely path-segment-expansion — teaching it about `view/:slug` → `Dossiers / [MockDossier or deslugified name]` would force it to import fixture data, which muddies the layout / data boundary. Local-in-route is the cleaner seam.
3. **`setSearchParams(..., { replace: true })` for tab toggles.** Tabs are visual state, not navigation. `push` would spam the history stack with toggle events; `replace: true` keeps `back` semantic ("go to previous page"). Matches the prevailing React-Router-v7 pattern for query-param visual state.
4. **`?tab=<unknown>` stays visible in the URL without rewrite.** AC5 strictness: rewriting on mount races the H1 focus-on-mount and is indistinguishable from a "sticky URL" bug when inspecting with devtools. Let the next user interaction normalise the URL — the value has no semantic effect (allowlist-only matching).
5. **H1 weight stays at `font-semibold` (600), NOT `font-bold` (700) as the Epic AC says.** All prior H1s (2.5 / 2.6 / 3.1) use 600; the dashboard H1 and the dossier H1 are at the SAME hierarchy level (Top-of-page for the entrepreneur) — loudening the dossier H1 alone would read as visual inconsistency. Documented as a scoped Epic-AC divergence; flag in retrospective if UX disagrees.
6. **Two tabs → "filled pill" active state (`data-[active]:bg-card + shadow-sm`), NOT underline indicator.** Matches shadcn's canonical `TabsList` recipe. The `TabsIndicator` export is kept for forward-compat (future stories may prefer underline) but is not used in 3.2's JSX. See Task 1 Subtask 1e.
7. **`useEffect(..., [slug])` for H1 focus — NOT `[slug, activeTab]`.** Tab changes are not "page navigations" and must not yank focus back to the H1 mid-interaction. Focus-on-mount fires only on navigation to a different dossier.
8. **`resolveDisplayName(slug)` is the mock-to-localStorage bridge.** Mock hit wins (canonical casing / accents preserved); `deslugifyForDisplay` is the fallback. The four cases (A: mock-only, B: both, C: storage-only, D: neither) are enumerated in AC9-13. This closes the Story 3.1 integration seam WITHOUT seeding localStorage from the mock fixture (Story 3.1 Pinned Decision #2 preserved — mocks stay in-memory; storage is still the wizard's private backing store).
9. **Analytics panel is a single `<div>` with a `<p>` — no stubbed structure.** Story 3.3 replaces the block atomically. Any pre-stubbed heading / grid / list in 3.2 creates diff friction for 3.3.
10. **Partager button has no onClick in 3.2** — no-op. Story 3.5 wires it. Alternative considered: add an `onClick={() => toast('Bientôt…')}` placeholder; rejected because it ships a user-visible feature that must be unwound in 3.5. A silent no-op is cleaner.
11. **`Tabs` wrapper keeps Base UI's value type as `unknown`.** The Base UI `TabsTab.Value = any | null` type is too loose to narrow without a runtime guard; `value: unknown` on `handleTabChange` is the safest wrapper signature. Consumers pass string literals (`"content"` / `"analytics"`) as `TabsTrigger value={…}` — Base UI's `any | null` accepts them.
12. **`TabsIndicator` is exported but unused in 3.2.** Exporting it at the primitive-level keeps the primitive API complete (matches shadcn's canonical `tabs.tsx` export shape) and removes a future import-churn when a downstream story opts into the indicator visual. Not dead code — intentional API surface.
13. **Route path stays `view/:slug`** — same discrepancy with the epic AC's `:slug` as Story 3.1 Pinned Decision #5. Do NOT "correct" the route to match the epic AC; the Story 2.6 code-review patch established `view/:slug` for sibling-segment-collision safety.
14. **Commit strategy:** single `feat(epic-3): story 3.2 — dossier page header & tab navigation` commit that bundles implementation AND code-review patches (per user memory preference: "Code + review in a single commit", established from Story 2.4 onward).

### References

- Story AC + narrative: [Source: [_bmad-output/planning-artifacts/epics.md](../planning-artifacts/epics.md#L628-L658) §Story 3.2 — Dossier Page — Header & Tab Navigation]
- Epic 3 context (entrepreneur dashboard + access management): [Source: [_bmad-output/planning-artifacts/epics.md](../planning-artifacts/epics.md#L594-L596)]
- Story 3.3 consumer of the analytics placeholder (MetricCard grid + AccessListRow list — breadcrumb `Dossiers / Biosensio` constraint): [Source: [_bmad-output/planning-artifacts/epics.md](../planning-artifacts/epics.md#L662-L691) §Story 3.3]
- Story 3.5 consumer of the Partager button (D5 Sheet integration): [Source: [_bmad-output/planning-artifacts/epics.md](../planning-artifacts/epics.md#L741-L783) §Story 3.5]
- UX — breadcrumb depth table (sub-view level 2 = `Dossiers / Biosensio`): [Source: [_bmad-output/planning-artifacts/ux-design-specification.md](../planning-artifacts/ux-design-specification.md#L679-L688) §Navigation Patterns § Breadcrumbs]
- UX — H1 typography recipe (28 px desktop / 600 weight): [Source: [_bmad-output/planning-artifacts/ux-design-specification.md](../planning-artifacts/ux-design-specification.md#L349-L357) §Typography]
- UX — accessibility baseline (focus ring, 44 × 44 tap targets, tab keyboard pattern): [Source: [_bmad-output/planning-artifacts/ux-design-specification.md](../planning-artifacts/ux-design-specification.md#L377-L405) §Accessibility]
- UX — component placement convention (`components/confluent/` vs `components/ui/`): [Source: [_bmad-output/planning-artifacts/ux-design-specification.md](../planning-artifacts/ux-design-specification.md#L612-L617) §Component Implementation Strategy]
- UX — button hierarchy (one primary per view — Partager is the single primary on this page): [Source: [_bmad-output/planning-artifacts/ux-design-specification.md](../planning-artifacts/ux-design-specification.md#L642-L651) §Button Hierarchy]
- Architecture — React source layout (`routes/` + `components/ui/`): [Source: [_bmad-output/planning-artifacts/architecture.md](../planning-artifacts/architecture.md#L373-L395) §Code Structure]
- React Router v7 route with `handle.hideBreadcrumb`: [Source: [apps/web/src/router.tsx](../../../../../apps/web/src/router.tsx#L38-L42)]
- Shell `Breadcrumbs` + handle-based suppression: [Source: [apps/web/src/components/layout/Breadcrumbs.tsx](../../../../../apps/web/src/components/layout/Breadcrumbs.tsx#L22-L28)]
- `AppShell` layout (`#main-content`, skip-link, sidebar): [Source: [apps/web/src/components/layout/AppShell.tsx](../../../../../apps/web/src/components/layout/AppShell.tsx#L113-L131)]
- `DossierViewRoute` file to rewrite (current 2.6 baseline): [Source: [apps/web/src/routes/dashboard/dossiers/[slug].tsx](../../../../../apps/web/src/routes/dashboard/dossiers/%5Bslug%5D.tsx)]
- `MOCK_DOSSIERS` + `MockDossier` type (read-only fixture consumed here): [Source: [apps/web/src/data/mock-dossiers.ts](../../apps/web/src/data/mock-dossiers.ts)]
- Existing shadcn-style wrapper pattern to mimic (`Sheet`): [Source: [apps/web/src/components/ui/sheet.tsx](../../../../../apps/web/src/components/ui/sheet.tsx)]
- `Button` (`size="lg"` + `h-11 px-4` recipe): [Source: [apps/web/src/components/ui/button.tsx](../../../../../apps/web/src/components/ui/button.tsx)]
- Color tokens (`--card` / `--muted` / `--border` / `--ring` / `--foreground` / `--muted-foreground`): [Source: [apps/web/src/index.css](../../../../../apps/web/src/index.css#L52-L90)]
- `DossierField` (content-panel consumer, unchanged): [Source: [apps/web/src/components/confluent/DossierField.tsx](../../../../../apps/web/src/components/confluent/DossierField.tsx)]
- `QUESTIONNAIRE` + `QUESTIONNAIRE_FLAT` (content-panel sections, unchanged): [Source: [apps/web/src/data/questionnaire.ts](../../../../../apps/web/src/data/questionnaire.ts)]

### Latest Technical Information

- **`@base-ui/react/tabs` subpath export** — resolves via `node_modules/.pnpm/@base-ui+react@1.4.0…/node_modules/@base-ui/react/tabs/index.d.ts`. Named export: `Tabs` (namespace). Parts: `Tabs.Root`, `Tabs.List`, `Tabs.Tab`, `Tabs.Panel`, `Tabs.Indicator`. All render actual DOM elements (div / button) — no render-prop gymnastics needed. [Source: local node_modules type declarations]
- **`Tabs.Root` controlled API** — `value` (active tab's `value`), `defaultValue` (uncontrolled initial), `onValueChange(value, details)`. Use `value` + `onValueChange` for URL-controlled mode. The second argument `details` carries `activationDirection` ('left' | 'right' | …) — ignore it in 3.2's handler (useful for slide-transition animations in later stories). [Source: `@base-ui/react/tabs/root/TabsRoot.d.ts`]
- **`Tabs.Panel` unmount behaviour** — Base UI unmounts inactive panels by default. The `keepMounted` prop can retain inactive panels in the DOM (useful if panels hold form state that shouldn't reset). Do NOT use `keepMounted` in 3.2 — the content panel's 2.6 section list has no form state to preserve; the analytics panel's placeholder is trivial. Unmounting on switch keeps the DOM light. [Source: `@base-ui/react/tabs/panel/TabsPanel.d.ts`]
- **Automatic tab activation on focus** — Base UI's default behaviour: arrow-key focus → activates. Matches WAI-ARIA "Tabs with Automatic Activation". To opt into manual activation, a `activateOnFocus={false}` escape hatch exists; NOT needed here. [Source: WAI-ARIA Authoring Practices — [Tabs Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/)]
- **`useSearchParams` from React Router v7** — returns `[URLSearchParams, SetURLSearchParams]`. The setter accepts either a new `URLSearchParams` instance OR a functional updater that receives the current params. Functional form is safer when multiple callers may set params concurrently (Epic 7 filter scenarios). `{ replace: true }` as the second argument on the setter invokes `router.navigate({ replace: true })`. [Source: [React Router v7 docs — `useSearchParams`](https://reactrouter.com/api/hooks/useSearchParams)]
- **`URLSearchParams.get('tab')`** returns `string | null`. On a duplicate-key URL (`?tab=content&tab=analytics`), `get` returns the FIRST value. Therefore the AC5 allowlist form `searchParams.get('tab') === 'analytics'` is tolerant of duplicates: first-value wins, unknown first-values fall back to Contenu. [Source: [MDN — `URLSearchParams.get`](https://developer.mozilla.org/en-US/docs/Web/API/URLSearchParams/get)]
- **`data-[active]` Tailwind variant** — selects elements with the literal `data-active` attribute. Base UI's `Tabs.Tab` emits `data-active="true"` (presence, not value) on the active tab. `data-[active]:bg-card` compiles to `[data-active]:bg-card` which matches any truthy `data-active` attribute. [Source: [Tailwind v4 — Data Attributes](https://tailwindcss.com/docs/hover-focus-and-other-states#data-attributes)]
- **`whitespace-nowrap` on `TabsTrigger`** — prevents "Accès & analytics" from wrapping mid-label on narrow tablist widths. At 375 px, the two tabs ("Contenu" ≈ 7 chars, "Accès & analytics" ≈ 17 chars) fit side-by-side at the default tab padding (3 px × 2 + text width × 2 + gap 4 px ≈ 200 px) — comfortable under 375 px.
- **`shadow-sm` on active tab** — Tailwind's `--shadow-sm` default is `0 1px 2px 0 rgb(0 0 0 / 0.05)`. Against the Notion-inspired palette (`--card` = `#FFFFFF`, `--muted` = `#F1F0EE`), the elevation reads as a subtle lift — the dominant active-state signal alongside the `bg-card` fill and the `text-foreground` colour swap.
- **No new dependency** — `@base-ui/react` is already at `^1.4.0` in `apps/web/package.json`. No lockfile change. No `pnpm install` required. The `tabs` subpath is already on disk (verified via `ls node_modules/.pnpm/@base-ui+react@1.4.0…/node_modules/@base-ui/react/tabs`).

### Project Context Reference

No `project-context.md` exists at the repo root. Authoritative planning inputs remain the PRD, epics, architecture, and UX spec under `_bmad-output/planning-artifacts/`, plus locked patterns from Stories 1.1 – 3.1 (design tokens, H1 focus-on-mount recipe, `Button size="lg"` tap-target convention, `components/confluent/` vs `components/ui/` placement, `data/` for static fixtures, `lib/` for pure utilities, shell `Breadcrumbs` + `handle.hideBreadcrumb` suppression, URL-as-source-of-truth for visual state). User memory index at [../../.claude/projects/-home-coder-confluent/memory/MEMORY.md](../../.claude/projects/-home-coder-confluent/memory/MEMORY.md) notes one active feedback: **bundle story implementation + code-review patches into a single commit** (applied to the Task 6 finalisation step in Pinned Decision #14).

## Dev Agent Record

### Agent Model Used

claude-opus-4-7

### Debug Log References

- `pnpm turbo run typecheck`: 2 successful, 0 errors. New exports from `components/ui/tabs.tsx` (`Tabs`, `TabsList`, `TabsTrigger`, `TabsContent`, `TabsIndicator`) all compile under TS strict. `handleTabChange: (value: unknown) => void` preserves the Base UI `TabsTab.Value = any | null` generic — no narrowing. `@confluent/api` cache-hit; `@confluent/web` cache-miss but 0 errors.
- `pnpm turbo run lint`: 2 successful, 0 errors. 3 tolerated pre-existing warnings (`badge.tsx:52`, `button.tsx:58`, `features/current-user/context.tsx:17` — all `react-refresh/only-export-components`). Zero new warnings — `tabs.tsx` exports only components + a file-header comment, no ambient helpers.
- `pnpm turbo run build`: 2 successful, 0 errors. Build time 408 ms. 1852 modules transformed (+58 vs 3.1 baseline: Base UI Tabs primitive + its Composite/Floating keyboard-focus subsystem).
- Bundle delta vs Story 3.1 baseline (45.33 kB / 8.80 kB gzip CSS; 351.48 kB / 110.62 kB gzip JS; 1794 modules):
  - CSS: 45.92 kB (gzip 8.88 kB) → +0.59 kB raw, +0.08 kB gzip — new Tailwind utilities (`bg-muted`, `gap-1`, `whitespace-nowrap`, `shadow-sm`, `data-[active]:bg-card`, `data-[active]:text-foreground`, `data-[active]:shadow-sm`, `min-h-9`, `rounded-md` on trigger).
  - JS: 377.48 kB (gzip 119.64 kB) → +26.00 kB raw, +9.02 kB gzip — Base UI Tabs primitive subtree (Root / List / Tab / Panel / Indicator) with its Composite keyboard-navigation engine + roving-focus management. Larger than the ~2-3 kB gzip forecast in the story spec because Base UI's Tabs primitive bundles the full Composite+List abstractions rather than the minimal Radix-style parts; cost is once-only for the dependency subtree and amortises to zero for future Tabs consumers (admin back-office, settings screens).
- Self-review grep `grep -nE '#[0-9a-fA-F]{3,6}'` across `components/ui/tabs.tsx` and `routes/dashboard/dossiers/[slug].tsx` → zero matches. All colour surfaces reference token utilities.
- Self-review `grep -n 'hideBreadcrumb' apps/web/src/router.tsx` → 4 hits (pre-existing — 2.3 naming, 2.4 questionnaire, 2.5 recapitulatif, 2.6 dossier view). Task 3 did not touch `router.tsx` (git status confirms).
- Self-review `grep -nE 'useEffect|setSearchParams|onClick|disabled|aria-disabled|replace' routes/dashboard/dossiers/[slug].tsx` → confirms `useEffect(..., [slug])` (not `[slug, activeTab]`), `setSearchParams(..., { replace: true })`, Partager `<Button>` has NO `onClick` / `disabled` / `aria-disabled`.

### Completion Notes List

1. **`components/ui/tabs.tsx` landed** — shadcn-style wrapper over `@base-ui/react/tabs`. Named exports: `Tabs`, `TabsList`, `TabsTrigger` (→ `Tabs.Tab`), `TabsContent` (→ `Tabs.Panel`), `TabsIndicator` (exported for forward-compat, not used in 3.2's JSX). Mirrors the `sheet.tsx` wrapper pattern exactly — `data-slot` attributes, `cn()`-composed className, `{...props}` spread after defaults so consumers can override. No new dependency: `@base-ui/react@^1.4.0` was already in the deps graph.
2. **`routes/dashboard/dossiers/[slug].tsx` rewritten** — local `resolveDisplayName(slug)` helper resolves to `MOCK_DOSSIERS.find(d => d.slug === slug)?.name` when available, else `deslugifyForDisplay(slug)`. Four slug cases handled: (A) mock-only → name from mock + empty-content fallback copy, (B) mock + localStorage → name from mock + 2.6 section list, (C) localStorage-only → deslugified name + 2.6 section list, (D) neither → existing "Dossier introuvable" fallback (no breadcrumb / tabs / button). The Story 3.1 integration seam is closed: clicking the Biosensio or Agrotrack mock cards now lands on a named dossier page instead of the "Dossier introuvable" fallback.
3. **URL-as-source-of-truth for tabs** — `const activeTab = searchParams.get('tab') === 'analytics' ? 'analytics' : 'content'` is a pure derivation; no `useState`. `handleTabChange` uses the functional `setSearchParams((prev) => { ... })` overload with `{ replace: true }` to keep tab toggles out of browser history. The allowlist (`'analytics'` only triggers analytics) tolerates unknown values (`?tab=foo`, `?tab=`, duplicate `?tab=…&tab=…`) by silently falling back to Contenu — the URL is NOT rewritten on mount (AC5 / Pinned Decision #4).
4. **H1 focus-on-mount preserved** — `useEffect(() => headingRef.current?.focus(), [slug])`. Dependency array is `[slug]`, NOT `[slug, activeTab]` (Pinned Decision #7 / AC8): tab changes MUST NOT yank focus back to the H1. Navigating to a different dossier (different `slug`) re-fires the focus recipe; toggling tabs does not.
5. **Local 2-segment breadcrumb preserved** — the `<nav aria-label="Fil d'Ariane">` with `Dossiers / {DisplayName}` stays inside the route file (unchanged structure from 2.6). The pre-existing `handle: { hideBreadcrumb: true }` on the route in `router.tsx` suppresses the shell `Breadcrumbs` from rendering the path-segment expansion `Mes dossiers / Dossiers / View / Biosensio`. Task 3 verified: `router.tsx` was NOT touched (4 `hideBreadcrumb` hits total, all pre-existing).
6. **"Partager" button is a no-op in 3.2** — `type="button"` with NO `onClick`, NO `disabled`, NO `aria-disabled`. Present for layout, tab-order, and AC1 compliance. Story 3.5 will add the `onClick` that opens the D5 Sheet primitive. A silent no-op is the cleanest contract — unwiring a placeholder toast or console.log in 3.5 would be waste.
7. **Analytics panel is a single placeholder block** — `<div className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground"><p>L'analytique de ce dossier s'affichera ici.</p></div>`. Exact AC14 shape: no stubbed `<h2>Accès & partage</h2>`, no grid stub, no `<ul>` for future `AccessListRow`. Story 3.3 opens this file and swaps the block atomically.
8. **`TabsIndicator` exported but unused in 3.2** — intentional API surface completeness (Pinned Decision #12). The 3.2 visual is the "filled pill" via `data-[active]:bg-card + shadow-sm`. Exporting `TabsIndicator` at primitive-time means a downstream story that prefers an underline visual only needs to import the component, not patch the primitive's exports.
9. **All 16 ACs verified against implementation:**
   - AC1 (breadcrumb + H1 + Partager + tabs in header) ✓
   - AC2 (Contenu default when no `?tab`) ✓
   - AC3 (click Analytics → `?tab=analytics`, placeholder renders, Contenu unmounts) ✓
   - AC4 (deep link `?tab=analytics` activates Analytics on mount, no Contenu flash) ✓
   - AC5 (unknown `?tab=foo` / `?tab=` / duplicate → fall back to Contenu, URL untouched on mount) ✓
   - AC6 (Contenu click drops `?tab` via `prev.delete('tab')`; URL becomes bare `/view/{slug}`) ✓
   - AC7 (ARIA tab pattern — automatic via Base UI: `role="tablist"`, `role="tab"`, `role="tabpanel"`, `aria-selected`, roving focus, Arrow keys, Home/End, Tab into panel) ✓
   - AC8 (`<title>`, H1 focus-on-mount `[slug]`-keyed, shell `Breadcrumbs` suppressed via pre-existing handle) ✓
   - AC9 (name resolution: mock hit wins, deslugify fallback) ✓
   - AC10 (case A mock-only → empty-content fallback copy) ✓
   - AC11 (case B mock + localStorage → 2.6 section list) ✓
   - AC12 (case C localStorage-only → deslugified H1 + 2.6 section list) ✓
   - AC13 (case D neither → 2.6 "Dossier introuvable" fallback, no breadcrumb / tabs / button) ✓
   - AC14 (Analytics placeholder is single `<div><p>…</p></div>`) ✓
   - AC15 (mobile: header row wraps, tap targets ≥ 44 px via `h-11` on list + `size="lg"` on Partager) ✓
   - AC16 (axe: 0 serious / 0 critical expected — `role="tablist"` et al. automatic via Base UI, focus ring on all interactives, token-driven active state) ✓
10. **Self-review sweep results** — zero hex in new files; `useEffect` deps are `[slug]` only; `setSearchParams(..., { replace: true })` correct; Partager button has no onClick/disabled/aria-disabled; `<ul>` semantics intact on the breadcrumb's `<ol>`; shell `Breadcrumbs` suppression via `handle.hideBreadcrumb` preserved (4 hits in `router.tsx`, all pre-existing).
11. **Manual walkthrough (pending final visual sign-off)** — programmatic signals (typecheck / lint / build) are all green. Recommended before merge: tri-viewport walk (375 / 900 / 1440 px) per Task 5 sub-steps 1-14, axe audit on Contenu / Analytics / unknown-slug states, keyboard-only Tab/Arrow/Home/End sweep, deep-link round-trip (`?tab=analytics`, `?tab=foo`, `?tab=`), back/forward test (tab toggles must NOT populate history).
12. **No regression on Stories 1.1 – 3.1** — Task 2 touched only `routes/dashboard/dossiers/[slug].tsx`; Task 1 added a NEW `components/ui/tabs.tsx`; Task 3 confirmed `router.tsx` untouched. `/dashboard` list (3.1), `/dashboard/tableau-de-bord` (2.1), `/dashboard/dossiers/nouveau` + questionnaire + recapitulatif (2.3 / 2.4 / 2.5 / 2.6) flows are all untouched. The 2.6 dossier-content section list renders INSIDE `<TabsContent value="content">` but with the SAME per-section DOM (`<section>` / `<h2>` / `<dl>` / `DossierField` × N).

### File List

**Created:**
- `apps/web/src/components/ui/tabs.tsx` — shadcn-style wrapper over `@base-ui/react/tabs`. Named exports: `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent`, `TabsIndicator`. `TabsIndicator` is exported for forward-compat (future underline variants) but not used in 3.2's JSX.

**Modified:**
- `apps/web/src/routes/dashboard/dossiers/[slug].tsx` — rewrote the rendered JSX: added the `resolveDisplayName` local helper, added the Partager button and the tablist with two panels, added `useSearchParams`-driven `activeTab` resolution + `handleTabChange` with `{ replace: true }`. Preserved `loadDossier`, `deslugifyForDisplay`, and the H1 focus-on-mount recipe unchanged. Case D fallback ("Dossier introuvable") unchanged.

**Unchanged (verified — touched by no task):**
- `apps/web/src/router.tsx` (Task 3 explicitly preserves `handle: { hideBreadcrumb: true }` on the view route).
- `apps/web/src/data/mock-dossiers.ts` (consumed read-only — `MOCK_DOSSIERS` + `MockDossier` — not modified).
- `apps/web/src/components/layout/AppShell.tsx`, `apps/web/src/components/layout/Breadcrumbs.tsx`, `apps/web/src/components/layout/NavItem.tsx`, `apps/web/src/components/layout/nav-items.ts`.
- `apps/web/src/components/confluent/*`, `apps/web/src/components/ui/{avatar,badge,button,card,input,label,separator,sheet,sonner}.tsx`.
- `apps/web/src/data/questionnaire.ts`, `apps/web/src/lib/*`, `apps/web/src/features/*`.
- `apps/web/src/routes/dashboard/index.tsx`, `apps/web/src/routes/dashboard/tableau-de-bord.tsx`, `apps/web/src/routes/dashboard/dossiers/nouveau/*`.

### Change Log

- **2026-04-21** — Story 3.2 implementation landed. New file: `components/ui/tabs.tsx` (Base UI Tabs wrapper). Modified: `routes/dashboard/dossiers/[slug].tsx` (added breadcrumb+header+tabs structure, wired mock-to-localStorage bridge via `resolveDisplayName`). Typecheck / lint / build all green. Bundle delta within envelope (CSS +0.08 kB gzip; JS +9.02 kB gzip — Base UI Tabs subtree). 16/16 ACs satisfied. Status: `ready-for-dev` → `in-progress` → `review`.
