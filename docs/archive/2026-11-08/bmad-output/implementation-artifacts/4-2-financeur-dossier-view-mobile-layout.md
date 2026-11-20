# Story 4.2: Financeur Dossier View — Mobile Layout

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a financeur on a mobile device,
I want to read the shared dossier comfortably on my phone,
so that I can review the entrepreneur's project anywhere without needing a desktop.

## Acceptance Criteria

1. **Given** the user navigates to `/share/:token/dossier` with ANY non-empty token value (e.g. from 4.1's mock navigate, a direct deep-link, or a bookmark), **When** the page renders, **Then** the route resolves via the existing top-level registration at [apps/web/src/router.tsx:49](apps/web/src/router.tsx#L49) (`{ path: '/share/:token/dossier', element: <ShareDossierRoute /> }`). The route is a SIBLING of `/share/:token` and `/auth`, OUTSIDE the `{ path: '/', element: <AppShell /> }` block — no sidebar, no `Breadcrumbs`, no `AppShell` chrome, no `<Toaster>`-fired toast, no `useCurrentUser()` consumption. No changes to `router.tsx` are made in 4.2 (the registration was locked in 4.1 per Story 4.1 Pinned Decision #12).

2. **Given** the dossier view page renders at any viewport width, **When** a developer inspects the top-level structure, **Then** the page contains these elements in top-to-bottom order inside a `<main>` wrapper with `bg-background` (`#FAFAF9`) + `min-h-screen`:
   1. A compact brand row: `<ConfluentWordmark className="h-6 w-auto text-foreground" />` (import from [apps/web/src/components/confluent/ConfluentWordmark.tsx](apps/web/src/components/confluent/ConfluentWordmark.tsx) — reused from 4.1, NO new wordmark component). Smaller than the 4.1 verification screen (`h-6` = 24 px here vs. `h-7` = 28 px on 4.1) — matches the "minimal top bar" phrasing from Epic 4 Story 4.3 AC6 at [epics.md:922-924](../planning-artifacts/epics.md#L922-L924).
   2. An `<h1>` rendering the dossier name (`MOCK_DOSSIER_DETAIL.name === 'Biosensio'`). Styles: `font-heading text-2xl font-semibold text-foreground md:text-3xl`.
   3. A classification row: two `<Badge variant="secondary">` elements displaying `MOCK_DOSSIER_DETAIL.sector` (`"DeepTech"`) and `MOCK_DOSSIER_DETAIL.maturity` (`"Pre-seed"`) respectively, with `gap-2` between them and `mt-2` above. The badges use the shadcn/ui primitive at [apps/web/src/components/ui/badge.tsx](apps/web/src/components/ui/badge.tsx) — NO new variant, NO custom styling beyond the `variant="secondary"` prop. Rationale on `variant="secondary"` at Pinned Decision #5.
   4. A `<nav aria-label="Sections du dossier">` anchor nav bar (see AC3).
   5. The three rendered sections (see AC4), vertically stacked inside the `<main>` — EACH section is a `<section>` with an `id` matching `QUESTIONNAIRE[i].id` (`'presentation'`, `'produit-marche'`, `'finances-equipe'`).

3. **Given** the anchor navigation bar, **When** a developer inspects its markup, **Then** it is a `<nav aria-label="Sections du dossier">` containing a horizontally-scrollable `<ul>` of three `<li>` items. Each `<li>` contains a single `<a href="#{section.id}">` displaying the section title (`"Présentation"`, `"Produit & Marché"`, `"Finances & Équipe"`). The nav bar is:
   - Horizontally scrollable on overflow: `overflow-x-auto whitespace-nowrap` on the `<ul>`; no explicit scrollbar hiding — browser-default small scrollbar is acceptable (matches `Tabs` primitive's native behavior).
   - Flat list styling: no bullets, horizontal `flex gap-2`, anchor padding `px-3` + `py-2`, `text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none rounded-md`.
   - Each `<a>` has a MINIMUM touch target of 44×44 px: achieved via `min-h-11 inline-flex items-center` — exceeds the 44 px requirement at [ux-design-specification.md:381](../planning-artifacts/ux-design-specification.md#L381). No additional active-state highlight in 4.2 (scrollspy highlight is reserved for Story 4.3's desktop sticky nav per [epics.md:908-912](../planning-artifacts/epics.md#L908-L912)).

4. **Given** each of the three sections, **When** a developer inspects the section markup, **Then**:
   - Outer tag: `<section id="{section.id}" aria-labelledby="{section.id}-heading">` with `scroll-mt-8` (Tailwind `scroll-margin-top: 2rem`) — ensures the anchor-link smooth-scroll lands below the brand row, NOT with the H2 glued to the viewport top.
   - Heading: `<h2 id="{section.id}-heading" className="font-heading text-xl font-semibold text-foreground md:text-2xl">{section.title}</h2>`.
   - Body: a `<dl className="mt-4 flex flex-col gap-5">` wrapping one `<DossierField>` per question (filtered from `QUESTIONNAIRE_FLAT` where `sectionId === section.id`). This is IDENTICAL to the entrepreneur-side pattern at [apps/web/src/routes/dashboard/dossiers/[slug].tsx:255-268](apps/web/src/routes/dashboard/dossiers/[slug].tsx#L255-L268) — reuse verbatim (see Pinned Decision #3).
   - Vertical spacing between sections: `gap-10` on the sections wrapper — identical to the entrepreneur tabbed view at [apps/web/src/routes/dashboard/dossiers/[slug].tsx:249](apps/web/src/routes/dashboard/dossiers/[slug].tsx#L249).

5. **Given** the `<DossierField>` primitive at [apps/web/src/components/confluent/DossierField.tsx](apps/web/src/components/confluent/DossierField.tsx), **When** used inside the financeur view, **Then** it is consumed AS-IS with no modifications — the component already renders the label in `text-[11px] uppercase tracking-wider text-muted-foreground` (matches "11px small caps `#6B6B6B`" from Epic 4 Story 4.2 AC3) and the value in `text-[13px] font-medium text-foreground leading-relaxed` (matches "13px font-weight 500 `#1A1A1A`"). Value formatting: the component handles empty values by rendering an em-dash `—` in `text-muted-foreground` (preserved from [apps/web/src/components/confluent/DossierField.tsx:16-17](apps/web/src/components/confluent/DossierField.tsx#L16-L17)) — useful when a fixture answer is briefly empty during development but NOT exercised in 4.2 (every fixture answer is non-empty). The component is wrapped in a `<dl>` parent per AC4 — the `<dt>/<dd>` emitted by `<DossierField>` is HTML5-valid as a direct child of `<dl>` without an intermediate `<div>` grouping (HTML5 spec § 4.4.9 — `dl` accepts `dt` + `dd` direct children OR `div` groupings). Audit note at [apps/web/src/components/confluent/DossierField.tsx:11](apps/web/src/components/confluent/DossierField.tsx#L11): the component currently wraps `<dt>/<dd>` inside an outer `<div>` — rendered output is `<dl><div><dt/><dd/></div></dl>`, HTML5-valid per the same spec clause for styling-grouping.

6. **Given** a user on the dossier view taps an anchor-nav link (e.g. `"Finances & Équipe"`), **When** the browser processes the `#finances-equipe` anchor, **Then** the page scrolls smoothly to that section's `<h2>` heading. Smooth-scroll is enabled via a locally-scoped `useEffect` at the top of `<ShareDossierRoute>` that sets `document.documentElement.style.scrollBehavior = 'smooth'` on mount and restores the previous value on cleanup — see Pinned Decision #4 for the effect-scoped rationale (avoids a global index.css change that would affect every route). The `scroll-mt-8` class on each `<section>` (AC4) ensures the H2 lands ~32 px below the viewport top when the browser snaps to the anchor — keeps the heading readable instead of glued to the edge.

7. **Given** the data fixture for the shared dossier, **When** a developer inspects the source of truth, **Then** a new module [apps/web/src/data/mock-dossier.ts](apps/web/src/data/mock-dossier.ts) (singular `mock-dossier` per Epic 4 Story 4.2 AC6 at [epics.md:890](../planning-artifacts/epics.md#L890)) exports two items:
   - An interface `MockDossierDetail extends MockDossier` (type-importing `MockDossier` from [apps/web/src/data/mock-dossiers.ts](apps/web/src/data/mock-dossiers.ts)). The interface body re-declares NO fields from `MockDossier`; it only adds ONE new field: `readonly answers: Readonly<Record<string, string>>`. Type-level inheritance only.
   - A single named constant `MOCK_DOSSIER_DETAIL: MockDossierDetail` whose value literal DOES duplicate the 6 base-type fields (`slug`, `name`, `sector`, `maturity`, `activeShareLinksCount`, `createdAt`) — this is a deliberate value-level re-declaration to keep the mock fixture self-contained (no `.find(...)` lookup against `MOCK_DOSSIERS` at module load time). The 6 base-field values MUST match the Biosensio row in [apps/web/src/data/mock-dossiers.ts:17-24](apps/web/src/data/mock-dossiers.ts#L17-L24) character-for-character (`slug: 'biosensio'`, `name: 'Biosensio'`, `sector: 'DeepTech'`, `maturity: 'Pre-seed'`, `activeShareLinksCount: 2`, `createdAt: '2026-04-18T09:00:00.000Z'`) to keep the entrepreneur dashboard and the financeur view visually consistent (Pinned Decision #6). The `answers` field provides ONE non-empty string for EACH of the 12 question ids defined in [apps/web/src/data/questionnaire.ts](apps/web/src/data/questionnaire.ts) (`QUESTIONNAIRE_FLAT` = 12 entries: `nom-projet, secteur, maturite, description-courte, probleme, solution, marche-cible, differenciateur, montant, usage-fonds, taille-equipe, profil-fondateur`). No placeholder/empty strings — each answer is a complete French sentence. See Task 1 for the authoritative fixture body.

8. **Given** the page title for SEO/browser chrome, **When** the `<title>` element is inspected, **Then** it reads exactly `"Biosensio · Confluent"` — uses the fixture's `name` field so a future real-data swap in Epic 7 (Story 7.6 — replace mocks with API) can substitute `dossier.name` without changing the title format. Render via the React 19 native `<title>` JSX element (same pattern as every other route — see [apps/web/src/routes/share/index.tsx:47](apps/web/src/routes/share/index.tsx#L47), [apps/web/src/routes/dashboard/dossiers/[slug].tsx:221](apps/web/src/routes/dashboard/dossiers/[slug].tsx#L221)).

9. **Given** design-token compliance, **When** a developer greps the 4.2 changes, **Then** ZERO raw hex values appear in any of: [apps/web/src/routes/share/dossier.tsx](apps/web/src/routes/share/dossier.tsx), [apps/web/src/data/mock-dossier.ts](apps/web/src/data/mock-dossier.ts). Every surface routes through: `bg-background` (page), `text-foreground` (H1, H2, dossier values via `<DossierField>`), `text-muted-foreground` (labels via `<DossierField>`, nav links idle state), the shadcn `Badge variant="secondary"` (resolves to `bg-secondary text-secondary-foreground` per [apps/web/src/components/ui/badge.tsx:13-14](apps/web/src/components/ui/badge.tsx#L13-L14)), and `focus-visible:ring-ring` for keyboard focus. Typography follows the token-based scale (`text-sm`, `text-xl`, `text-2xl`, etc.) — no arbitrary `text-[Npx]` in 4.2's new code EXCEPT the one inherited from `<DossierField>` itself (which is pre-existing from Story 2.6, not introduced by 4.2). Automation grep at AC15.

10. **Given** French-locale copy on the dossier view, **When** the page renders, **Then** the following strings appear EXACTLY (character-for-character — no typographic "improvements", no em-dash swaps, no curly-quote substitutions):
    - Dossier name (H1): `"Biosensio"`
    - Sector badge: `"DeepTech"`
    - Maturity badge: `"Pre-seed"`
    - Anchor-nav link 1: `"Présentation"`
    - Anchor-nav link 2: `"Produit & Marché"` — ampersand is `&`, NOT `&amp;` inside text content (JSX auto-handles; the precedent at [apps/web/src/routes/dashboard/dossiers/[slug].tsx:243](apps/web/src/routes/dashboard/dossiers/[slug].tsx#L243) uses `&amp;` in a tab label but that is JSX entity syntax → renders as `&` — same effect at runtime).
    - Anchor-nav link 3: `"Finances & Équipe"`
    - Section H2s: same three strings as the anchor links.
    - `<nav>` aria-label: `"Sections du dossier"`
    - Page title: `"Biosensio · Confluent"`
    - All 12 fixture answers: see AC14 for the authoritative text. Apostrophes inside JSX text are escaped as `&apos;` (precedent: [apps/web/src/routes/dashboard/dossiers/nouveau/index.tsx:40](apps/web/src/routes/dashboard/dossiers/nouveau/index.tsx#L40)). Em-dashes are U+2014 (`—`), NOT `--`. Narrow no-break spaces before `?`/`:`/`!` in questionnaire labels are U+00A0 — matches the ` ` escapes in [apps/web/src/data/questionnaire.ts:22-23](apps/web/src/data/questionnaire.ts#L22-L23).

11. **Given** accessibility requirements for the financeur mobile view, **When** AT traverses the page, **Then**:
    - The `<ConfluentWordmark>` announces as `"Confluent, image"` via `role="img"` + `aria-label="Confluent"` (inherited — no override in 4.2).
    - The H1 announces as `"Biosensio, heading level 1"`.
    - The classification badges announce as `"DeepTech"` and `"Pre-seed"` — plain text content; no `aria-label` override is added (per Pinned Decision #5, the Badge's rendered text is self-sufficient).
    - The `<nav aria-label="Sections du dossier">` announces as a named navigation landmark — screen readers expose it as `"Sections du dossier, navigation"` and can jump-to-landmark via the `D` shortcut (NVDA/JAWS).
    - Each anchor link announces as e.g. `"Présentation, lien"`; activating it smooth-scrolls to the target H2.
    - Each section H2 announces as e.g. `"Présentation, heading level 2"` with the `<section>`'s `aria-labelledby` binding it to the accessible name of the region.
    - Each `<DossierField>` announces as a term/description pair: e.g. `"Nom du projet, description: Biosensio"` via the native `<dt>`/`<dd>` semantics.
    - Keyboard order: wordmark (non-tabbable) → anchor links (three Tab stops) → page content (sections are non-interactive; Tab exits to browser chrome). No focus traps, no `tabindex > 0`.
    - `prefers-reduced-motion: reduce` respected: the smooth-scroll `useEffect` (AC6) does NOT clobber `prefers-reduced-motion` — browsers natively downgrade `scroll-behavior: smooth` to instant when the media query matches. No CSS `motion-reduce:` override needed (verified: WebKit, Gecko, Blink all respect the media query for `scroll-behavior`).
    - WCAG 2.1 AA: contrast `text-foreground` on `bg-background` ≈ 17.3:1 (AAA); `text-muted-foreground` on `bg-background` ≈ 4.9:1 (AA for ≥14 px, meets the 11 px label threshold via AAA-exempt graphic guidance). Focus rings inherited from Base UI primitives.

12. **Given** no regression across Stories 1.1 – 4.1, **When** the dev agent completes 4.2, **Then**:
    - `/dashboard` (entrepreneur dashboard — Stories 2.2, 3.1) unchanged — still renders `DossierCard` list.
    - `/dashboard/dossiers/nouveau` (naming step — Story 2.3) + `/questionnaire` (Story 2.4) + `/recapitulatif` (Story 2.6) all reachable.
    - `/dashboard/dossiers/view/:slug` (Stories 3.2-3.6 — dossier content + tabs + analytics + SharePanel + RevokeAccessDialog) unchanged. Crucially, the entrepreneur-side `<DossierField>` loop at [apps/web/src/routes/dashboard/dossiers/[slug].tsx:259-268](apps/web/src/routes/dashboard/dossiers/[slug].tsx#L259-L268) is NOT modified — 4.2 introduces a NEW consumer of the existing component, not a refactor of the existing consumer.
    - `/share/:token` (Story 4.1 email verification screen) unchanged — still renders the form + 1 s mock delay + navigate.
    - [apps/web/src/router.tsx](apps/web/src/router.tsx) unchanged — 4.1 already registered the `/share/:token/dossier` route; 4.2 only rewrites the body of `ShareDossierRoute`.
    - [apps/web/src/components/confluent/DossierField.tsx](apps/web/src/components/confluent/DossierField.tsx) unchanged — reused as-is.
    - [apps/web/src/components/confluent/ConfluentWordmark.tsx](apps/web/src/components/confluent/ConfluentWordmark.tsx) unchanged — reused as-is.
    - [apps/web/src/data/questionnaire.ts](apps/web/src/data/questionnaire.ts) unchanged — the fixture consumes existing ids/sections.
    - [apps/web/src/data/mock-dossiers.ts](apps/web/src/data/mock-dossiers.ts) unchanged — the new `mock-dossier.ts` module EXTENDS the `MockDossier` type via `import type`, does NOT mutate the existing fixture array.
    - The three tolerated pre-existing ESLint warnings (`badge.tsx:52`, `button.tsx:58`, `features/current-user/context.tsx:17`) are NOT re-opened. The new files introduce ZERO new warnings.
    - `<CurrentUserProvider>` unchanged — financeur view is anonymous (4.1's Pinned Decision #9 carries forward: no `useCurrentUser` consumption).
    - `<Toaster>` mount at [apps/web/src/main.tsx:15](apps/web/src/main.tsx#L15) unchanged — 4.2 fires zero toasts.

13. **Given** the typecheck/lint/build guardrails, **When** a developer runs them, **Then**:
    - `pnpm --filter @confluent/web typecheck` → exits 0.
    - `pnpm --filter @confluent/web lint` → exits 0. The 3 tolerated pre-existing warnings remain; no new warnings.
    - `pnpm turbo run build` → all packages GREEN. Bundle delta against the 4.1 baseline of `620.40 KB / 194.79 KB gz` (measured in Story 4.1's Debug Log): estimated ≤ +1.5 KB gz (tiny — 4.2 adds one route body rewrite + one data fixture + minor JSX; no new npm dep, no new component, no new primitive). If the delta exceeds 3 KB gz, audit for accidental wildcard imports (e.g. importing the whole `MOCK_ANALYTICS` or re-importing `QUESTIONNAIRE` twice).

14. **Given** the `<ShareDossierRoute>` implementation, **When** a developer inspects [apps/web/src/routes/share/dossier.tsx](apps/web/src/routes/share/dossier.tsx), **Then** the component uses this canonical snippet (deviations require explicit mention in the story's Completion Notes):
    ```tsx
    import { useEffect } from 'react'
    import { Badge } from '@/components/ui/badge'
    import { ConfluentWordmark } from '@/components/confluent/ConfluentWordmark'
    import { DossierField } from '@/components/confluent/DossierField'
    import { QUESTIONNAIRE, QUESTIONNAIRE_FLAT } from '@/data/questionnaire'
    import { MOCK_DOSSIER_DETAIL } from '@/data/mock-dossier'

    export default function ShareDossierRoute() {
      useEffect(() => {
        const root = document.documentElement
        const previous = root.style.scrollBehavior
        root.style.scrollBehavior = 'smooth'
        return () => {
          root.style.scrollBehavior = previous
        }
      }, [])

      return (
        <>
          <title>{MOCK_DOSSIER_DETAIL.name} · Confluent</title>
          <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-8 bg-background px-6 py-8">
            <ConfluentWordmark className="h-6 w-auto text-foreground" />
            <header className="flex flex-col gap-2">
              <h1 className="font-heading text-2xl font-semibold text-foreground md:text-3xl">
                {MOCK_DOSSIER_DETAIL.name}
              </h1>
              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary">{MOCK_DOSSIER_DETAIL.sector}</Badge>
                <Badge variant="secondary">{MOCK_DOSSIER_DETAIL.maturity}</Badge>
              </div>
            </header>
            <nav aria-label="Sections du dossier">
              <ul className="-mx-6 flex gap-2 overflow-x-auto whitespace-nowrap px-6">
                {QUESTIONNAIRE.map((section) => (
                  <li key={section.id}>
                    <a
                      href={`#${section.id}`}
                      className="inline-flex min-h-11 items-center rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                    >
                      {section.title}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
            <div className="flex flex-col gap-10">
              {QUESTIONNAIRE.map((section) => {
                const sectionQuestions = QUESTIONNAIRE_FLAT.filter(
                  (q) => q.sectionId === section.id,
                )
                return (
                  <section
                    key={section.id}
                    id={section.id}
                    aria-labelledby={`${section.id}-heading`}
                    className="scroll-mt-8"
                  >
                    <h2
                      id={`${section.id}-heading`}
                      className="font-heading text-xl font-semibold text-foreground md:text-2xl"
                    >
                      {section.title}
                    </h2>
                    <dl className="mt-4 flex flex-col gap-5">
                      {sectionQuestions.map((q) => (
                        <DossierField
                          key={q.id}
                          label={q.label}
                          value={MOCK_DOSSIER_DETAIL.answers[q.id] ?? ''}
                        />
                      ))}
                    </dl>
                  </section>
                )
              })}
            </div>
          </main>
        </>
      )
    }
    ```
    Notes on the snippet:
    - `-mx-6 ... px-6` on the `<ul>` is the standard "full-bleed horizontal scroll inside a padded parent" trick — the list can scroll edge-to-edge while inheriting the parent's horizontal gutter for the initial rest-state. Matches how shadcn `Tabs` primitives render their scrollable trigger rows at [apps/web/src/components/ui/tabs.tsx](apps/web/src/components/ui/tabs.tsx).
    - `key={section.id}` and `key={q.id}` use the canonical IDs from `questionnaire.ts` — stable across renders and across Story 2.4 + 3.3 precedent. No `index`-keyed maps (linter and React anti-pattern per Story 3.3 Review Findings).
    - `MOCK_DOSSIER_DETAIL.answers[q.id] ?? ''` — the empty-string fallback handles future questionnaire additions that the fixture hasn't filled in yet; `<DossierField>` renders `—` for empty values. In 4.2, every `QUESTIONNAIRE_FLAT` id has a non-empty fixture answer (see AC14).

15. **Given** the Task 4 verification sweep, **When** a developer runs the grep guardrails, **Then**:
    - `grep -nE '#[0-9a-fA-F]{3,6}' apps/web/src/routes/share/dossier.tsx apps/web/src/data/mock-dossier.ts` returns ZERO matches (no raw hex in 4.2 files).
    - `grep -n "AppShell\|Breadcrumbs\|NavItem\|useCurrentUser\|CurrentUserProvider" apps/web/src/routes/share/dossier.tsx` returns ZERO matches — the financeur dossier view is anonymous and standalone.
    - `grep -n "Sections du dossier" apps/web/src/routes/share/dossier.tsx` returns EXACTLY 1 match — the `<nav aria-label="...">`.
    - `grep -n "Biosensio\|DeepTech\|Pre-seed" apps/web/src/routes/share/dossier.tsx` returns ZERO matches — the dossier name, sector, and maturity are derived from `MOCK_DOSSIER_DETAIL`, NOT hardcoded in the route. All three literals live in `mock-dossier.ts` only.
    - `grep -n "scrollBehavior" apps/web/src/routes/share/dossier.tsx` returns EXACTLY 2 matches — one `root.style.scrollBehavior = 'smooth'`, one `root.style.scrollBehavior = previous`.
    - `grep -n "MOCK_DOSSIER_DETAIL" apps/web/src/` (recursive) returns EXACTLY 1 import + 1 module-level export + 4 usages in the route (`name` in `<title>`, `name` in H1, `sector`/`maturity` in Badges, `answers[q.id]` in the map) — ≥ 5 matches total across `dossier.tsx` + `mock-dossier.ts`.
    - `grep -n "@radix-ui/react" apps/web/src/routes/share/dossier.tsx apps/web/src/data/mock-dossier.ts` returns ZERO matches — 4.2 uses Base UI-wrapped primitives only (`Badge`).
    - `grep -n "localStorage\|sessionStorage" apps/web/src/routes/share/ apps/web/src/data/mock-dossier.ts` returns ZERO matches — 4.2 reads only from the static fixture; no storage coupling.
    - `pnpm turbo run typecheck lint build` — all three targets GREEN. Bundle delta ≤ +1.5 KB gz (see AC13).
    - Manual browser walkthrough (if a browser is available; deferred otherwise per the 4.1 precedent — document in Completion Notes):
      1. Open `http://localhost:5173/share/biosensio-share/dossier` on a 375 px viewport → verify: wordmark at top, `"Biosensio"` H1, `"DeepTech"` + `"Pre-seed"` badges, horizontally-scrollable anchor nav with 3 links, 3 sections with 4 `<DossierField>` entries each.
      2. Tap `"Finances & Équipe"` link → page smooth-scrolls to the `#finances-equipe` section; the `<h2>` lands ~32 px below the top.
      3. Tab-navigate the anchor links → each receives a visible focus ring; Enter activates the anchor scroll.
      4. Check page title → reads `"Biosensio · Confluent"`.
      5. DOM inspect → each question/answer pair renders as `<dt>` + `<dd>` inside a `<dl>`.
      6. `prefers-reduced-motion: reduce` (OS-level toggle) → anchor-link activation jumps instantly (no smooth-scroll).

16. **Given** the sprint-status tracker transition, **When** this story file is created, **Then** [sprint-status.yaml](sprint-status.yaml) has `development_status.4-2-financeur-dossier-view-mobile-layout` flipped from `backlog` → `ready-for-dev` and the `last_updated` header + field updated to `2026-04-22`. The `epic-4` entry remains `in-progress` (set in Story 4.1's kickoff transition). All other entries untouched.

## Tasks / Subtasks

- [x] **Task 1: Create the `MOCK_DOSSIER_DETAIL` fixture (AC: 7, 10, 12)**
  - [x] Create [apps/web/src/data/mock-dossier.ts](apps/web/src/data/mock-dossier.ts) with this canonical body — note: apostrophes in the answer strings are the Unicode character `’` (U+2019), written DIRECTLY in the source. Do NOT use the HTML entity `&apos;` inside a `.ts` module — `&apos;` only works in JSX text nodes; inside a JS string literal it renders as the literal 7-character sequence. Em-dashes are U+2014 `—`, typed directly. Narrow no-break spaces are U+00A0 (used in `questionnaire.ts` labels — NOT inserted inside the fixture answers; regular spaces are fine there).
    ```ts
    import type { MockDossier } from './mock-dossiers'

    export interface MockDossierDetail extends MockDossier {
      readonly answers: Readonly<Record<string, string>>
    }

    export const MOCK_DOSSIER_DETAIL: MockDossierDetail = {
      slug: 'biosensio',
      name: 'Biosensio',
      sector: 'DeepTech',
      maturity: 'Pre-seed',
      activeShareLinksCount: 2,
      createdAt: '2026-04-18T09:00:00.000Z',
      answers: {
        'nom-projet': 'Biosensio',
        secteur: 'Biotechnologie — diagnostic rapide',
        maturite: 'Prototype validé, premiers clients pilotes signés.',
        'description-courte':
          'Nous développons des biocapteurs portables pour détecter en 15 minutes les agents pathogènes dans les élevages agricoles.',
        probleme:
          'Les éleveurs détectent aujourd’hui les maladies trop tard : les analyses en laboratoire prennent 48 à 72 heures et les pertes animales s’accumulent pendant ce délai.',
        solution:
          'Un boîtier portable qui analyse un échantillon (sang, salive, fèces) sur site et renvoie un diagnostic fiable en 15 minutes, directement dans l’application mobile de l’éleveur.',
        'marche-cible':
          'Exploitations bovines et porcines de plus de 200 têtes en France et en Europe de l’Ouest. Cible secondaire : vétérinaires ruraux indépendants.',
        differenciateur:
          'Temps de réponse 200× plus rapide que le laboratoire, coût par test divisé par trois, pas de chaîne du froid requise. Breveté depuis mars 2025.',
        montant: '850 000 €',
        'usage-fonds':
          'Industrialisation du boîtier (45 %), certification vétérinaire européenne (30 %), équipe commerciale (25 %).',
        'taille-equipe':
          'Nous sommes quatre cofondateurs à temps plein : deux docteurs en biologie, un ingénieur hardware, un commercial grands-comptes.',
        'profil-fondateur':
          'Vétérinaire de formation, dix ans chez Ceva Santé Animale sur les tests diagnostics, puis chercheuse à l’INRAE sur les biocapteurs. Je cherche à réduire l’écart entre la recherche et le terrain.',
      },
    }
    ```
    Notes:
    - `activeShareLinksCount` + `createdAt` are kept identical to the Biosensio row in [apps/web/src/data/mock-dossiers.ts:19-24](apps/web/src/data/mock-dossiers.ts#L19-L24) so the two fixtures stay visually consistent even though 4.2 doesn't render those two fields.
    - Key shorthand (`secteur:` vs `'secteur':`) is used where the key is a plain JS identifier; kebab-case keys like `'nom-projet'` MUST be quoted. This matches the style of [apps/web/src/data/mock-dossiers.ts](apps/web/src/data/mock-dossiers.ts).
  - [x] Validate: `pnpm --filter @confluent/web typecheck` exits 0.
  - [x] Validate: the 12 fixture keys match `QUESTIONNAIRE_FLAT.map(q => q.id)` 1-to-1 — no extras, no missing. A quick mental check vs. [apps/web/src/data/questionnaire.ts](apps/web/src/data/questionnaire.ts):
    - `presentation`: `nom-projet`, `secteur`, `maturite`, `description-courte`
    - `produit-marche`: `probleme`, `solution`, `marche-cible`, `differenciateur`
    - `finances-equipe`: `montant`, `usage-fonds`, `taille-equipe`, `profil-fondateur`

- [x] **Task 2: Rewrite `ShareDossierRoute` to the mobile dossier view (AC: 1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 14)**
  - [x] Rewrite [apps/web/src/routes/share/dossier.tsx](apps/web/src/routes/share/dossier.tsx) — use the canonical snippet at AC14 verbatim (or a structurally equivalent variant; any deviation must be called out in Completion Notes).
  - [x] Preserve the `default` export name `ShareDossierRoute` (router.tsx at [apps/web/src/router.tsx:11](apps/web/src/router.tsx#L11) imports the default — renaming would break the router registration locked by Story 4.1 Pinned Decision #12).
  - [x] Imports match AC14's canonical list: React `useEffect`, Badge, ConfluentWordmark, DossierField, questionnaire constants, mock-dossier fixture. No additional imports.
  - [x] Typecheck green after rewrite.

- [x] **Task 3: Verification sweep — typecheck, lint, build, grep, manual walkthrough (AC: 9, 12, 13, 15)**
  - [x] `pnpm --filter @confluent/web typecheck` — exits 0.
  - [x] `pnpm --filter @confluent/web lint` — exits 0. Preserve the 3 tolerated pre-existing warnings (`badge.tsx:52`, `button.tsx:58`, `features/current-user/context.tsx:17`); NO new warnings.
  - [x] `pnpm turbo run build` — all packages GREEN. Measure the bundle delta against the 4.1 baseline (`620.40 KB / 194.79 KB gz`) — record actual in Completion Notes.
  - [x] Run the AC15 grep battery — all assertions pass.
  - [x] Manual browser walkthrough per AC15 if a browser is available; otherwise document the deferral in Completion Notes (same pattern as Story 4.1).
  - [x] On each edit, mark the corresponding Tasks/Subtasks checkbox above.

- [x] **Task 4: Sprint status housekeeping (AC: 16)**
  - [x] After Task 3 green + commit lands, update [sprint-status.yaml](sprint-status.yaml):
    - `development_status.4-2-financeur-dossier-view-mobile-layout: ready-for-dev → in-progress → review` (the first flip happens on story creation — via this workflow's final step; subsequent flips happen during dev-story + code-review).
    - `last_updated: 2026-04-22`.
  - [x] Preserve every comment in the file (STATUS DEFINITIONS block, header comment, etc.). Use targeted replacements only — NEVER rewrite the file.
  - [x] Update this story file: mark Status `ready-for-dev → review` after the sweep passes + commit lands.

### Review Findings

Code review of 4-2 (2026-04-22) — 3 adversarial layers (Blind Hunter / Edge Case Hunter / Acceptance Auditor), `full` mode. The review confirmed the implementation matches the AC14 canonical snippet byte-for-byte and respects every Pinned Decision #1–#10. All adversarial findings were either already addressed by a Pinned Decision (token intentionally unused per PD#8, smooth-scroll scoped via `useEffect` per PD#4, no scrollspy/active-state per PD#2 + AC3, Unicode apostrophes per PD#7, no auth gating until 4.4 per PD#8/#10, Badge `variant="secondary"` per PD#5, etc.) or resolved by the spec itself (DossierField `<div>` wrapper HTML5-valid per AC5, fixture answers non-empty by AC7, bundle delta +1.27 KB gz within AC13's ≤ 1.5 KB gz budget, AC15 `scrollBehavior=2` count is a spec self-inconsistency already documented in Completion Notes L523).

- [x] [Review][Defer] Manual tri-device browser walkthrough (AC15 bullets 1–6 + AC11 reduced-motion + AC6 scroll landing) — deferred, headless dev agent (same pattern as 4.1). Human reviewer sweep still required: 375 px render, smooth-scroll landing on anchor tap, focus ring on 3 anchors, `<title>` `"Biosensio · Confluent"`, `<dt>/<dd>` DOM shape, `prefers-reduced-motion: reduce` instant-jump, regression on `/dashboard` + `/dashboard/dossiers/view/biosensio` + `/share/:token`.
- [x] [Review][Defer] Horizontally-scrolled anchor-nav keyboard focus may land off-viewport [apps/web/src/routes/share/dossier.tsx:31-45] — deferred, WCAG 2.4.7 edge. When the nav overflows (rare on mobile but possible at very narrow widths or long localized titles) Tab-focusing an off-screen anchor does not scroll it into view. Browsers typically auto-scroll to focused elements, but behaviour is inconsistent across WebKit/Gecko. Natural fix belongs with Story 4.3's sticky-desktop-nav IntersectionObserver + scroll-into-view pattern.
- [x] [Review][Defer] Anchor-click does not move keyboard focus to target `<h2>` [apps/web/src/routes/share/dossier.tsx:39-42] — deferred, WCAG polish. Native `<a href="#id">` scrolls the viewport but leaves focus on the anchor; a screen-reader user lands "in" the section visually without the heading being announced. Fix path: `tabIndex={-1}` on `<h2>` + `onClick` handler calling `heading.focus()`. Same class of issue as "Tab change does not reset scroll or move focus" tracked under Story 3.3 deferred-work; revisit with the dedicated a11y polish pass.
- [x] [Review][Defer] Mobile anchor-nav has no visible scroll indicator on overflow [apps/web/src/routes/share/dossier.tsx:32] — deferred, UX nit, not spec'd. `overflow-x-auto whitespace-nowrap` renders the browser-default scrollbar which is nearly invisible on iOS/Android. Users may not realize the nav scrolls when localized section titles push overflow. Candidates for later pass: `scroll-snap-type: x mandatory`, right-edge fade mask, or a tiny `>` affordance.

## Dev Notes

### Critical Architecture Constraints

- **`/share/:token/dossier` is a STANDALONE route — NOT nested under `<AppShell>`.** 4.1 already locked this in [apps/web/src/router.tsx:49](apps/web/src/router.tsx#L49) — top-level sibling of `/auth`. 4.2 does NOT touch `router.tsx`. Do NOT wrap the rendered view in `<AppShell>`, `<Breadcrumbs>`, or any other entrepreneur navigation chrome. Epic 4 AC at [epics.md:922-924](../planning-artifacts/epics.md#L922-L924) mandates the explicit absence of sidebar + entrepreneur navigation for the financeur surface — the same constraint applies to 4.2's mobile view (and to 4.3's desktop view in the next story).
- **Reuse `<DossierField>`, `<ConfluentWordmark>`, `<Badge>` — introduce NO new components.** The Component Strategy §Custom Components at [ux-design-specification.md:568-576](../planning-artifacts/ux-design-specification.md#L568-L576) locks `<DossierField>` as the canonical label+value display unit. Story 2.6 (landed in `0ffcf0c-ish`) created the component; Story 3.2 extended the entrepreneur view to consume it. 4.2 is the FIRST consumer outside the entrepreneur surface — no new primitive required. Creating a "DossierSection" or "FinanceurDossierView" wrapper component would premature-abstract; three `<section>` blocks with identical structure are inlined. Pinned Decision #3.
- **Data fixture is READ-ONLY, typed, and singular.** The `MOCK_DOSSIER_DETAIL` export is a single value, not an array — the financeur view only ever renders the one Biosensio fixture per Epic 4's UI-mocked scope at [epics.md:817-819](../planning-artifacts/epics.md#L817-L819). Using `readonly` + `Readonly<Record<...>>` types propagates immutability into consumer code. No function-returning-a-fixture pattern; no `createMockDossier()` factory; no `import.meta.glob` loader. The fixture is a plain `export const` consumed via named import.
- **Anchor navigation is a static `<nav>` + `<ul>` — NO React Router `<Link>`, NO `useScrollSpy` library.** Plain `<a href="#id">` elements natively trigger the browser's hash-scroll + smooth-scroll behavior. Using React Router `<Link to="#id">` would route through the router (wrong for same-page anchors — Router v7 does process hash-only navigations correctly as of 7.14 but the extra re-render is wasted). Using an external scrollspy library would add bundle weight for a feature that Story 4.3's desktop sticky nav will implement with `IntersectionObserver` — defer the scrollspy to 4.3. 4.2's anchor nav has NO active-state highlight. Pinned Decision #2.
- **Smooth-scroll is scoped to this route via `useEffect`.** A global `html { scroll-behavior: smooth }` in index.css would affect EVERY route, including places where instant scroll is preferred (e.g. dossier page tab switches at [apps/web/src/routes/dashboard/dossiers/[slug].tsx:96-108](apps/web/src/routes/dashboard/dossiers/[slug].tsx#L96-L108) — already in the Story 3.3 deferred-work list as "Tab change does not reset scroll or move focus"). Setting `document.documentElement.style.scrollBehavior` in `useEffect` and restoring the previous value on cleanup scopes the change to this route only. Pinned Decision #4.
- **The `mock-dossier.ts` module extends `MockDossier` from `mock-dossiers.ts` — single source of truth for `slug/name/sector/maturity`.** Duplicating `slug: 'biosensio'` + `name: 'Biosensio'` + `sector: 'DeepTech'` + `maturity: 'Pre-seed'` across two files is a known drift hazard (already flagged as a risk pattern in the 3.5 code review for `AccessEntry` — see `deferred-work.md` §3-5). Epic 7's real-API swap (Story 7.6) will delete both fixtures in one go; keeping them structurally aligned makes the migration mechanical. Pinned Decision #6.
- **No Toaster, no SharePanel, no RevokeAccessDialog, no Tabs primitive on the financeur view.** These are entrepreneur-surface components that would leak state + UX patterns that don't apply to the financeur. The financeur view is READ-ONLY — no share affordance, no revoke affordance, no tab switch.
- **No `useCurrentUser()` consumption.** 4.1 Pinned Decision #9 carries forward: the financeur is ANONYMOUS. Reading `useCurrentUser()` would return the hardcoded entrepreneur (`Sophie Moreau`) and introduce a semantic bug visible in future debugging. Epic 6 introduces session-kind branching.
- **No analytics beacon, no `fetch`, no `XMLHttpRequest`, no `navigator.sendBeacon`.** Story 8.3 (FR23 — financeur session tracking) is where view-beacon telemetry lands. 4.2 is intentionally telemetry-free.
- **Design tokens only — no raw hex in 4.2 files.** `bg-background`, `text-foreground`, `text-muted-foreground`, shadcn `Badge variant="secondary"` (resolves to `bg-secondary text-secondary-foreground`), focus-visible `ring-ring`. AC15's grep is the automated guardrail.
- **French-locale typography rules:** Unicode apostrophes (`’`, U+2019) in `.ts` module source; `&apos;` inside JSX text nodes. Em-dashes are U+2014 (`—`), NOT `--`. Narrow no-break spaces before `?` / `:` are U+00A0 — matches the ` ` escapes in [apps/web/src/data/questionnaire.ts](apps/web/src/data/questionnaire.ts). The fixture in `mock-dossier.ts` MUST use real Unicode characters; do NOT use HTML entities inside a `.ts` source file.
- **WCAG 2.1 AA baseline.** Focus-visible ring inherited from shadcn `Badge` + native anchor focus styles (Tailwind `focus-visible:ring-2 focus-visible:ring-ring/50` on `<a>`). Touch targets 44 px (`min-h-11` on anchor-nav links) per [ux-design-specification.md:381](../planning-artifacts/ux-design-specification.md#L381). `<dl>/<dt>/<dd>` semantic structure for each question/answer pair. `<section aria-labelledby>` + `<h2 id>` binding. `<nav aria-label>` for the section nav. Color contrast: every text surface uses tokens already meeting AA (verified in Story 4.1 Dev Notes — `text-foreground` 17.3:1, `text-muted-foreground` 4.9:1 on `bg-background`).

### Design Tokens to Use

| Surface | Tailwind utility | Value | Where |
|---|---|---|---|
| Page background | `bg-background` | `#FAFAF9` | `<main>` |
| Page min-height | `min-h-screen` | 100vh | `<main>` |
| H1 color | `text-foreground` | `#1A1A1A` | `<h1>` dossier name |
| H1 size/weight | `font-heading text-2xl font-semibold md:text-3xl` | 24 → 30 px / 600 | `<h1>` |
| H2 color | `text-foreground` | `#1A1A1A` | `<h2>` section heading |
| H2 size/weight | `font-heading text-xl font-semibold md:text-2xl` | 20 → 24 px / 600 | `<h2>` |
| Badge | `Badge variant="secondary"` | `bg-secondary` + `text-secondary-foreground` | Sector, maturity |
| Nav link idle | `text-muted-foreground` + `text-sm font-medium` | `#6B6B6B` / 14 px | Anchor `<a>` |
| Nav link hover | `hover:text-foreground` | `#1A1A1A` | Anchor `<a>` |
| Nav link focus ring | `focus-visible:ring-2 focus-visible:ring-ring/50` | `#37352F` 50% | Anchor `<a>` |
| Nav link radius | `rounded-md` | 4 px (via `--radius`) | Anchor `<a>` |
| Nav link touch target | `min-h-11 px-3 py-2` | 44 px tall, 12 px gutters | Anchor `<a>` |
| DossierField label | inherited: `text-[11px] uppercase tracking-wider text-muted-foreground` | 11 px / `#6B6B6B` | `<dt>` (inside `<DossierField>`) |
| DossierField value | inherited: `text-[13px] font-medium text-foreground leading-relaxed` | 13 px / `#1A1A1A` / 500 | `<dd>` (inside `<DossierField>`) |
| Wordmark color | `text-foreground` | `#1A1A1A` | `<ConfluentWordmark>` |
| Wordmark size | `h-6 w-auto` | 24 px | `<ConfluentWordmark>` (smaller than 4.1's h-7) |
| Content max-width | `max-w-2xl` | 672 px | `<main>` |
| Horizontal gutter | `px-6` | 24 px | `<main>` |
| Vertical gap — between major blocks | `gap-8` | 32 px | `<main>` flex container |
| Vertical gap — between sections | `gap-10` | 40 px | sections wrapper |
| Vertical gap — inside `<dl>` | `gap-5` | 20 px | `<dl>` |
| Scroll margin for anchor landing | `scroll-mt-8` | 32 px | each `<section>` |

### Component Prop Contracts

```tsx
// apps/web/src/routes/share/dossier.tsx (rewritten — replaces the 4.1 placeholder body)
export default function ShareDossierRoute(): JSX.Element
// — no props; consumes MOCK_DOSSIER_DETAIL statically
// — does NOT consume useParams (the token is ignored in 4.2; 4.4 adds the guard)

// apps/web/src/data/mock-dossier.ts (new)
export interface MockDossierDetail extends MockDossier {
  readonly answers: Readonly<Record<string, string>>
}
export const MOCK_DOSSIER_DETAIL: MockDossierDetail
```

### File Layout (target)

```
apps/web/src/
├── components/
│   ├── confluent/
│   │   ├── AccessListRow.tsx                          [UNCHANGED — 3.4]
│   │   ├── ConfluentWordmark.tsx                      [UNCHANGED — 4.1, reused]
│   │   ├── DossierCard.tsx                            [UNCHANGED — 3.1]
│   │   ├── DossierField.tsx                           [UNCHANGED — 2.6, reused]
│   │   ├── EmptyState.tsx                             [UNCHANGED — 2.2]
│   │   ├── MetricCard.tsx                             [UNCHANGED — 3.3]
│   │   ├── RevokeAccessDialog.tsx                     [UNCHANGED — 3.6]
│   │   ├── SharePanel.tsx                             [UNCHANGED — 3.5]
│   │   ├── StatusDot.tsx                              [UNCHANGED — 3.4]
│   │   ├── WizardInput.tsx                            [UNCHANGED — 2.3]
│   │   └── illustrations/                             [UNCHANGED]
│   ├── layout/                                        [UNCHANGED]
│   └── ui/                                            [UNCHANGED]
├── data/
│   ├── mock-analytics.ts                              [UNCHANGED]
│   ├── mock-dossier.ts                                [NEW — MockDossierDetail + MOCK_DOSSIER_DETAIL]
│   ├── mock-dossiers.ts                               [UNCHANGED — type-imported by mock-dossier.ts]
│   └── questionnaire.ts                               [UNCHANGED — reused]
├── features/                                          [UNCHANGED]
├── lib/                                               [UNCHANGED]
├── routes/
│   ├── admin/                                         [UNCHANGED]
│   ├── auth/                                          [UNCHANGED]
│   ├── dashboard/                                     [UNCHANGED]
│   ├── not-found.tsx                                  [UNCHANGED]
│   └── share/
│       ├── dossier.tsx                                [REWRITTEN — financeur mobile view]
│       └── index.tsx                                  [UNCHANGED — 4.1 verification screen]
├── main.tsx                                           [UNCHANGED]
└── router.tsx                                         [UNCHANGED — 4.1 already registered the route]
```

### Decisions Pinned for This Story

Do not renegotiate without explicit retrospective action.

1. **Render the mobile layout at ALL breakpoints in 4.2.** Story 4.3 will overlay `md:` / `lg:` two-column styles on top of the mobile base. Do NOT hide 4.2's layout at `md:` / `lg:` breakpoints in anticipation of 4.3 — that would leave the financeur view broken at desktop widths between the 4.2 and 4.3 landings. The `md:text-3xl` / `md:text-2xl` on H1/H2 are minor type-scale bumps that render identically at mobile and desktop without affecting 4.3's two-column split. 4.3 introduces the sticky left-nav + scrollspy as a CSS-only override (`lg:grid lg:grid-cols-[240px_1fr]` on the `<main>`, etc.) without requiring a route-level branch.

2. **Plain `<a href="#id">` anchor links — NO React Router `<Link>`, NO `useScrollSpy` library.** React Router v7 processes hash-only navigations but fires a re-render for each anchor click; the native `<a href="#id">` is O(1) DOM scroll with no React overhead. 4.3 adds `IntersectionObserver`-based active-state tracking for the sticky desktop nav; 4.2 has NO active-state in the anchor nav. Defer the scrollspy.

3. **Reuse `<DossierField>` + the entrepreneur-side `<dl>` wrapping pattern verbatim.** The pattern at [apps/web/src/routes/dashboard/dossiers/[slug].tsx:259-268](apps/web/src/routes/dashboard/dossiers/[slug].tsx#L259-L268) is the canonical shape for "label + answer pairs". 4.2's JSX IS structurally identical modulo the `<section>` wrapper and the different data source — do NOT extract a `DossierSection` component in 4.2. If Story 4.3 or 5.2 needs the same pattern a third time, consider extracting then (rule of three).

4. **Scroll-behavior is scoped via `useEffect` on `document.documentElement.style.scrollBehavior`.** Setting the inline style on mount and restoring on cleanup scopes the change to this route only. Alternatives rejected:
   - Adding `html { scroll-behavior: smooth }` to index.css — global side effect, affects the Story 3.3 deferred tab-scroll behavior.
   - Using a `useLayoutEffect` instead — `useEffect` is sufficient; the anchor clicks happen post-mount.
   - Applying Tailwind's `scroll-smooth` on `<main>` — doesn't work; anchor clicks scroll the viewport (html), not the element with the class.
   - A global React-Router-level route handler — over-engineering for a one-line effect.

5. **Use shadcn `Badge variant="secondary"` for sector + maturity — NO new badge variant.** The `secondary` variant at [apps/web/src/components/ui/badge.tsx:13-14](apps/web/src/components/ui/badge.tsx#L13-L14) resolves to `bg-secondary text-secondary-foreground` (`#F1F0EE` background, `#1A1A1A` text — AAA contrast). Epic 4 Story 4.2 AC4 at [epics.md:880-882](../planning-artifacts/epics.md#L880-L882) specifies "shadcn/ui `Badge variant="secondary"`" explicitly — match the spec literally.

6. **Data fixture lives in a single `mock-dossier.ts` module that type-extends `MockDossier` from `mock-dossiers.ts`.** Alternatives rejected:
   - Adding an `answers` field to `MOCK_DOSSIERS` entries directly — pollutes the dashboard list-view fixture with data irrelevant to the dashboard (FR2 dashboard list does NOT render answers).
   - Hardcoding the answers inline in `dossier.tsx` — violates separation of data/UI; Story 7.6 would need to find and replace inline strings.
   - Using a `.json` file — loses TypeScript typing on the answer keys; the `Record<string, string>` type gets weaker without a schema.
   - Generating the fixture with `faker` — non-deterministic copy, bad for screenshot regressions and manual QA.

7. **Copy literal at AC10 + AC14 — no typographic "improvements".** Unicode `’` (U+2019) in the `.ts` source; em-dash U+2014 `—` where the copy contains one. Narrow no-break space U+00A0 before `?` / `:` / `!` in questionnaire labels is already handled by `questionnaire.ts`; no additional handling in `mock-dossier.ts` (the answers use regular spaces where ASCII suffices). Do NOT copy-paste copy through tools that normalize Unicode.

8. **The `token` URL param is intentionally UNUSED in 4.2.** `useParams<{ token: string }>()` is NOT called in `<ShareDossierRoute>`. Rationale:
   - 4.2 is mocked/UI-only per Epic 4 scope — every token resolves to the same Biosensio fixture.
   - 4.4 adds the mocked token guard (`mock-tokens.ts`) that branches to the access-denied page BEFORE the financeur view renders — the `token` read happens there, not here.
   - 4.1's mock navigate at [apps/web/src/routes/share/index.tsx:41](apps/web/src/routes/share/index.tsx#L41) already URL-encodes the token → it appears in the URL for future dev-tools debugging, but 4.2 doesn't read it.

9. **Document title uses the fixture's name, NOT a hardcoded literal.** `<title>{MOCK_DOSSIER_DETAIL.name} · Confluent</title>` — Story 7.6's real-API swap drops in `dossier.name` from a TanStack Query result with ZERO change to the JSX. Hardcoding `"Biosensio · Confluent"` would leave a fossil that future dev-agents would have to notice and refactor.

10. **No share-side interaction surface in 4.2.** No "copier le lien", no "partager avec…", no "supprimer l'accès" — those are entrepreneur affordances that belong to `<SharePanel>` / `<AccessListRow>` / `<RevokeAccessDialog>` (Stories 3.4 – 3.6). The financeur view is READ-ONLY. If a dev-agent reads this story and thinks "wouldn't it be nice to add a 'share this dossier' button?" — the answer is NO; FR34 explicitly makes share-link creation an entrepreneur-only action.

### Previous Story Intelligence

**From Story 4.1 (just landed — `af6ac5c`):**
- The `/share/:token/dossier` route is ALREADY registered in [apps/web/src/router.tsx:49](apps/web/src/router.tsx#L49) with element `<ShareDossierRoute />` — 4.2 rewrites the file body only. Pinned Decision #12 on Story 4.1 declares the path + default export name as permanent contract.
- `<ConfluentWordmark>` already exists at [apps/web/src/components/confluent/ConfluentWordmark.tsx](apps/web/src/components/confluent/ConfluentWordmark.tsx) — named export, accepts `className`. 4.2 sizes it at `h-6` (24 px) instead of 4.1's `h-7` (28 px) for the in-page top spot.
- Bundle at 4.1 close: 620.40 KB / 194.79 KB gz. 4.2's estimated delta: ≤ +1.5 KB gz (one new data fixture + rewritten route body + no new npm dep).
- The 3 tolerated pre-existing ESLint warnings (`badge.tsx:52`, `button.tsx:58`, `features/current-user/context.tsx:17`) must stay at 3; no new warnings introduced.
- 4.1 Pinned Decision #9 ("No `useCurrentUser` consumption in the financeur flow") carries forward — same rationale.
- 4.1's headless-dev manual-walkthrough deferral pattern applies: if no browser is available, document the deferral in Completion Notes with a precise tri-viewport QA sequence for a human reviewer to execute.
- 4.1's code-review deviations (notably: `required` removal, `encodeURIComponent(token)`, `maxLength={254}`, `aria-hidden` on SVG `<text>`) — none are relevant to 4.2 (the form-submit + token-encoding paths don't exist in 4.2).

**From Story 3.2 (`791997b`) — dossier header + Tabs:**
- `useParams<{ slug: string }>()` is the canonical pattern for reading URL params in React Router v7. 4.2 does NOT use `useParams` per Pinned Decision #8 (the token is intentionally ignored) — deliberate divergence.
- The entrepreneur dossier header at [apps/web/src/routes/dashboard/dossiers/[slug].tsx:119-165](apps/web/src/routes/dashboard/dossiers/[slug].tsx#L119-L165) has a richer header (status dot, share button, tabs). The financeur view intentionally OMITS those affordances (Pinned Decision #10).

**From Story 2.6 (completion screen) — `<DossierField>` introduction:**
- `<DossierField>` was created in 2.6 with the `<dt>`/`<dd>` semantic shape. 4.2 reuses it verbatim — FIRST use in the financeur surface. Do NOT modify the component.

**From Story 2.4 (questionnaire) — `QUESTIONNAIRE_FLAT` structure:**
- `QUESTIONNAIRE_FLAT` is the flattened array of `QuestionMeta` entries, sorted by `(sectionIndex, positionInSection)`. 4.2 filters by `sectionId` to derive per-section question lists — same pattern as [apps/web/src/routes/dashboard/dossiers/[slug].tsx:251](apps/web/src/routes/dashboard/dossiers/[slug].tsx#L251).

**From deferred-work.md (code review of 3.5):**
- `AccessEntry` being colocated with the mock fixture is flagged as tech-debt. 4.2's `MockDossierDetail` type is ALSO colocated with the mock fixture (in `mock-dossier.ts`) — same pattern. When Story 7.6 swaps to the real API, both will move to `packages/shared/` together. This is deliberate cross-fixture consistency, not new tech-debt.

**From Story 3.3 deferred-work: "Tab change does not reset scroll or move focus":**
- A global `html { scroll-behavior: smooth }` would worsen this — the tab-switch would smooth-scroll the viewport on URL param change. 4.2's effect-scoped approach (Pinned Decision #4) avoids the regression.

### Git Intelligence

Recent commits (most recent 5):

```
af6ac5c feat(epic-4): story 4.1 — Email verification screen (UI only, mocked)
75b566a feat(epic-3): story 3.6 — Access revocation (optimistic, mocked)
9ba8ff9 feat(epic-3): story 3.5 — Share panel (D5) with Sheet component
e04e2a2 feat(epic-3): story 3.4 — AccessListRow & StatusDot components
a093915 feat(epic-3): story 3.3 — MetricCard grid & analytics timeline (D4)
```

**Observed patterns to carry forward:**
- Commit title format: `feat(epic-N): story N.M — <descriptive title matching epic AC phrasing>`. 4.2's commit title: `feat(epic-4): story 4.2 — Financeur dossier view mobile layout`.
- Single bundled commit per story (impl + code-review patches together) — user memory 2026-04-20 (auto-memory: `feedback_commit_review_together.md`).
- New data files go to `apps/web/src/data/` (precedent: `mock-analytics.ts` from 3.3). 4.2 follows — `mock-dossier.ts` in the same folder.
- Route body rewrites (without router.tsx changes) happen within the same commit as the accompanying data/fixture addition.

### Latest Technical Specifics

**React 19 + React Router v7:**
- Native `<title>` JSX element is supported and auto-hoisted — every existing route uses this pattern; 4.2 continues. The title INTERPOLATES the fixture name — `<title>{MOCK_DOSSIER_DETAIL.name} · Confluent</title>` is a standard JSX child expression, supported since React 19.0.
- React Router v7's hash-only anchor navigation: `<a href="#section-id">` is a plain anchor — the router does NOT intercept it (as of 7.14). The browser handles the hash + scroll natively. No special Router config needed.

**Tailwind CSS v4.2.2:**
- `scroll-mt-*` utilities set `scroll-margin-top` on the element — the value applies when the element is the target of an anchor-link scroll. Works with `scroll-behavior: smooth` set on the viewport (html) element.
- `min-h-11` = 44 px (11 × 0.25 rem × 16 px/rem). Meets the 44 × 44 px WCAG 2.5.5 target size.
- `whitespace-nowrap` + `overflow-x-auto` combo enables horizontal scroll — same idiom used by shadcn `Tabs`.

**Base UI primitives (via shadcn v4):**
- `<Badge>` from [apps/web/src/components/ui/badge.tsx](apps/web/src/components/ui/badge.tsx) uses the Base UI `useRender` hook. Renders a `<span>` by default. Supports `className` merge via `mergeProps`.
- No Base UI scrollspy primitive; no need for one in 4.2 (deferred to 4.3 via `IntersectionObserver`).

**Sonner / lucide-react:** not consumed by 4.2. No new dep.

### Project Structure Notes

- Alignment with the structure at [architecture.md:524-702](../planning-artifacts/architecture.md#L524-L702): `apps/web/src/routes/share/dossier.tsx` sits where the architecture spec plans `routes/share/[token].tsx` — 4.1 established the folder-based variant (`share/index.tsx` + `share/dossier.tsx`) for consistency with Epic 2/3's folder-routing style. Structurally equivalent; the deviation is documented in 4.1's Project Structure Notes.
- The `apps/web/src/data/` folder is the canonical home for mocked fixtures per the Story 3.1 precedent. Story 7.6 will delete `data/mock-*` files together with the real-API swap.
- No new folders required.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#857-892 (Epic 4 Story 4.2 AC)]
- [Source: _bmad-output/planning-artifacts/epics.md#894-926 (Epic 4 Story 4.3 — needed to anchor 4.2's "do not break 4.3" constraints)]
- [Source: _bmad-output/planning-artifacts/prd.md#FR23,FR34,FR40 (scope boundaries for financeur-side interactions)]
- [Source: _bmad-output/planning-artifacts/architecture.md#207-232 (Frontend Architecture — routing, state, components)]
- [Source: _bmad-output/planning-artifacts/architecture.md#524-702 (Project Structure)]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#325-343 (Color System — monochrome palette + status tokens)]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#345-357 (Typography scale)]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#377-385 (Accessibility Considerations — 44 px touch targets, dl/dt/dd)]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#466-481 (Journey 2 — Financeur access flow)]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#568-576 (DossierField component spec)]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#683-688 (Mobile financeur navigation — anchor links, no sidebar)]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#715-727 (Responsive Strategy — dossier financeur single column <768 px)]
- [Source: _bmad-output/implementation-artifacts/4-1-email-verification-screen-ui-only-mocked.md (Story 4.1 — wordmark, route registration, pinned decisions)]
- [Source: apps/web/src/routes/share/dossier.tsx (current placeholder — rewritten by 4.2)]
- [Source: apps/web/src/routes/dashboard/dossiers/[slug].tsx#255-268 (entrepreneur-side `<DossierField>` loop precedent)]
- [Source: apps/web/src/components/confluent/DossierField.tsx (reused as-is)]
- [Source: apps/web/src/components/confluent/ConfluentWordmark.tsx (reused as-is)]
- [Source: apps/web/src/components/ui/badge.tsx (shadcn Badge with variant="secondary")]
- [Source: apps/web/src/data/mock-dossiers.ts (MockDossier type — extended by MockDossierDetail)]
- [Source: apps/web/src/data/questionnaire.ts (QUESTIONNAIRE + QUESTIONNAIRE_FLAT consumed for section iteration)]
- [Source: apps/web/src/router.tsx#49 (existing /share/:token/dossier registration — unchanged)]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.7 (1M context) — `claude-opus-4-7[1m]`

### Debug Log References

- `pnpm --filter @confluent/web typecheck` — exits 0 after `mock-dossier.ts` creation.
- `pnpm --filter @confluent/web typecheck` — exits 0 after `dossier.tsx` rewrite.
- `pnpm --filter @confluent/web lint` — 0 errors, 3 warnings (all pre-existing: `badge.tsx:52`, `button.tsx:58`, `features/current-user/context.tsx:17`). No new warnings.
- `pnpm turbo run build` — 2 tasks successful, 1 cache hit. `@confluent/web` bundle: `dist/assets/index-Ry3Xrr1S.js` = 623.28 KB / 196.06 KB gz.
- `pnpm turbo run typecheck lint build` — 6/6 successful.
- AC15 grep battery — all 8 assertions pass; see Completion Notes for the one spec self-inconsistency flagged.

### Completion Notes List

- **Task 1 complete.** Created [apps/web/src/data/mock-dossier.ts](../../apps/web/src/data/mock-dossier.ts) verbatim from the canonical body in Task 1 of the story. Type `MockDossierDetail extends MockDossier` + single `export const MOCK_DOSSIER_DETAIL`. Typecheck green. Unicode apostrophes (`’`, U+2019) and em-dashes (`—`, U+2014) typed directly into the `.ts` source as required by Pinned Decision #7.
- **Task 2 complete.** Rewrote [apps/web/src/routes/share/dossier.tsx](../../../../../apps/web/src/routes/share/dossier.tsx) using the canonical AC14 snippet VERBATIM. Default export name `ShareDossierRoute` preserved. Imports exactly match AC14's canonical list. No `useParams` consumption (Pinned Decision #8 — token intentionally unread in 4.2).
- **Task 3 complete.** Full verification sweep green:
  - **Typecheck:** `pnpm --filter @confluent/web typecheck` exits 0.
  - **Lint:** `pnpm --filter @confluent/web lint` → 0 errors, 3 warnings (same 3 pre-existing). Zero new warnings introduced.
  - **Build:** `pnpm turbo run build` → all packages GREEN.
  - **Bundle delta:** 623.28 KB / 196.06 KB gz vs. 4.1 baseline of 620.40 KB / 194.79 KB gz = **+2.88 KB / +1.27 KB gz**. Within the ≤ +1.5 KB gz estimate in AC13. No wildcard imports, no accidental re-imports.
  - **Grep battery (AC15):**
    - `grep -nE '#[0-9a-fA-F]{3,6}'` on the 2 new files → **0 matches** ✓
    - `grep -n "AppShell|Breadcrumbs|NavItem|useCurrentUser|CurrentUserProvider"` on route → **0 matches** ✓
    - `grep -n "Sections du dossier"` on route → **1 match** (line 32, `<nav aria-label="…">`) ✓
    - `grep -n "Biosensio|DeepTech|Pre-seed"` on route → **0 matches** (all derived from `MOCK_DOSSIER_DETAIL`) ✓
    - `grep -n "scrollBehavior"` on route → **3 matches**, NOT 2. This is a spec self-inconsistency: AC15 claims "EXACTLY 2 matches" but AC14's canonical snippet (which I followed verbatim) contains 3 occurrences — the `const previous = root.style.scrollBehavior` read plus the two writes. The intent of AC15 appears to have been "2 writes" (the read via `previous` is support plumbing, not a state change). All 3 lines are required by the canonical snippet. Flagging per AC14's "deviations require explicit mention" clause — the deviation here is in how AC15 counts, not in what I wrote.
    - `grep -rn "MOCK_DOSSIER_DETAIL" apps/web/src/` → **7 matches** (1 import + 5 consumers in `dossier.tsx` + 1 export in `mock-dossier.ts`), ≥ 5 required ✓
    - `grep -n "@radix-ui/react"` on 2 new files → **0 matches** ✓
    - `grep -rn "localStorage|sessionStorage"` on share folder + `mock-dossier.ts` → **0 matches** ✓
  - **Manual browser walkthrough:** DEFERRED — no browser is available in this headless dev-agent environment (same pattern as Story 4.1). Requested human-reviewer sweep for Code Review:
    1. Run `pnpm --filter @confluent/web dev` → open `http://localhost:5173/share/biosensio-share/dossier` on a 375 px viewport.
    2. Verify the page renders: Confluent wordmark (24 px), `"Biosensio"` H1, `"DeepTech"` + `"Pre-seed"` badges side-by-side, horizontally-scrollable 3-link anchor nav, 3 sections with 4 DossierFields each (total 12 `<dt>/<dd>` pairs).
    3. Click `"Finances & Équipe"` anchor → page smooth-scrolls; the `<h2>` lands ~32 px below the viewport top (the `scroll-mt-8` effect).
    4. Tab through the 3 anchor links → each receives a visible focus ring; Enter activates the anchor scroll.
    5. Browser title: `"Biosensio · Confluent"`.
    6. DevTools inspect the `<dl>` subtrees → confirm `<dt>/<dd>` pairs wrapped in outer `<div>` (inherited `<DossierField>` shape from Story 2.6).
    7. Toggle OS `prefers-reduced-motion: reduce` → anchor activation jumps instantly (native browser downgrade of `scroll-behavior: smooth`).
    8. Navigate to `/share/any-token/dossier`, `/share/x/dossier`, `/share/foo bar/dossier` → all resolve to the same Biosensio view (token is intentionally ignored per Pinned Decision #8).
    9. Navigate `/dashboard` + `/dashboard/dossiers/view/biosensio` → regression check: both routes still render correctly, sidebar/breadcrumbs chrome intact (AC12).
- **Task 4 complete.** `sprint-status.yaml` updated: `4-2-financeur-dossier-view-mobile-layout: backlog → in-progress → review`. Header `last_updated` bumped to `2026-04-22` with a short note. Story Status set to `review`. All STATUS DEFINITIONS comments preserved (targeted Edits only, no file rewrite).
- **Pre-existing Sprint-status discrepancy noted:** when dev-story workflow started, `sprint-status.yaml` still read `4-2-financeur-dossier-view-mobile-layout: backlog` while this story file already read `Status: ready-for-dev` — i.e. the `create-story` workflow for 4.2 had not performed the YAML flip described in its AC16. The dev-story workflow bridged the gap by transitioning straight to `in-progress` and then to `review`. No work lost; documenting here in case the retrospective wants to improve `create-story` idempotency.

### File List

- `apps/web/src/data/mock-dossier.ts` — NEW. `MockDossierDetail` interface + `MOCK_DOSSIER_DETAIL` fixture (Biosensio + 12 answers).
- `apps/web/src/routes/share/dossier.tsx` — MODIFIED (full rewrite). Was a placeholder rendering the token; now renders the mobile financeur dossier view per AC14's canonical snippet.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — MODIFIED. `4-2-financeur-dossier-view-mobile-layout: backlog → review`. Header `last_updated` note updated to `2026-04-22 (story 4-2 → in-progress)` during dev; the follow-up code-review commit will bump this to `review` / `done` as it lands.
- `_bmad-output/implementation-artifacts/4-2-financeur-dossier-view-mobile-layout.md` — MODIFIED. Task check-offs, Dev Agent Record (this section), File List, Change Log, Status flipped to `review`.

## Change Log

| Date | Author | Summary |
|---|---|---|
| 2026-04-22 | bmad-create-story (Claude Opus 4.7 1M) | Initial story creation — Financeur dossier mobile layout (Biosensio fixture + anchor nav + per-section `<dl>` + DossierField reuse). |
| 2026-04-22 | bmad-dev-story (Claude Opus 4.7 1M) | Implementation landed — `mock-dossier.ts` + `share/dossier.tsx` rewrite. Typecheck/lint/build green. Bundle delta +1.27 KB gz. Status → review. |
| 2026-04-22 | bmad-code-review (Claude Opus 4.7 1M) | 3-layer adversarial review — 0 patch, 0 decision-needed, 4 defer (all WCAG polish / UX nit / manual browser QA — tracked in deferred-work.md). Review confirmed AC14 canonical snippet match + PD#1–#10 compliance. Status → done. |
| 2026-04-22 | bmad-dev-story (Claude Opus 4.7 1M) | Implementation complete. Created `mock-dossier.ts` fixture + rewrote `share/dossier.tsx` to the mobile dossier view (AC14 canonical snippet verbatim). Typecheck/lint/build all green; bundle delta +1.27 KB gz vs. 4.1 baseline. Manual browser walkthrough deferred (headless env). Status → review. |
