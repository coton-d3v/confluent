# Story 4.3: Financeur Dossier View — Desktop Layout

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a financeur on a desktop browser,
I want a two-column dossier layout with sticky section navigation,
so that I can quickly jump between sections and read content without losing context.

## Acceptance Criteria

1. **Given** the existing `/share/:token/dossier` route registration at [apps/web/src/router.tsx:49](apps/web/src/router.tsx#L49), **When** a developer inspects the router, **Then** the entry is UNCHANGED — 4.3 rewrites the body of [apps/web/src/routes/share/dossier.tsx](apps/web/src/routes/share/dossier.tsx) only. The route stays a SIBLING of `/share/:token` and `/auth`, OUTSIDE the `{ path: '/', element: <AppShell /> }` block — no `<AppShell>`, no `<Breadcrumbs>`, no `<Toaster>`-fired toast, no `useCurrentUser()` consumption. The default export name `ShareDossierRoute` is preserved (Story 4.1 Pinned Decision #12 at [4-1-email-verification-screen-ui-only-mocked.md](4-1-email-verification-screen-ui-only-mocked.md); Story 4.2 Pinned Decision #1).

2. **Given** the viewport is below `lg` (<1024 px), **When** the page renders, **Then** the layout matches Story 4.2's mobile/tablet rendering byte-for-byte visible result: a single-column flex stack (`flex flex-col gap-8`) with `max-w-2xl` (672 px), `px-6`, `py-8`, `bg-background`, `min-h-screen`. The DOM order is: `<ConfluentWordmark>` → header (H1 + badges) → `<nav aria-label="Sections du dossier">` (horizontally-scrollable anchor bar) → three `<section>`s stacked with `gap-10`. This preserves every `<768 px` and `md:` (768–1023 px) acceptance behavior from Story 4.2 AC1–AC11 at [4-2-financeur-dossier-view-mobile-layout.md](4-2-financeur-dossier-view-mobile-layout.md) — Pinned Decision #1 on 4.2 already committed 4.3 to a CSS-only override strategy.

3. **Given** the viewport is ≥ `lg` (1024 px+), **When** the page renders, **Then** the `<main>` switches to a two-column CSS grid via Tailwind breakpoint overrides: `lg:max-w-6xl lg:grid lg:grid-cols-[240px_1fr] lg:gap-x-12 lg:gap-y-8 lg:px-10`. The grid-column template is LITERALLY `240px 1fr` (not `minmax(...)`, not a named template area) — the left column is a fixed 240 px, the right column takes the remaining width exactly as Epic 4 AC1 at [epics.md:902-904](../planning-artifacts/epics.md#L902-L904) mandates. The `max-w-6xl` (1152 px) + `lg:px-10` (40 px gutters) cap the total reading width at 1072 px inside the grid — a standard reading-comfortable desktop breakpoint. Horizontal gap between nav and content is 48 px (`lg:gap-x-12`); vertical gap between grid rows is 32 px (`lg:gap-y-8`).

4. **Given** the desktop grid placement, **When** a developer inspects the DOM order and grid-auto-placement, **Then** the four `<main>` children occupy the grid as follows:
   - `<ConfluentWordmark className="... lg:col-span-2" />` — row 1, spans both columns.
   - `<header>` containing `<h1>` + classification `<Badge>`s with `lg:col-span-2` — row 2, spans both columns (the "minimal top bar" for Epic 4 AC6 at [epics.md:922-924](../planning-artifacts/epics.md#L922-L924) is this wordmark + header block, NOT a separate top navigation chrome).
   - `<nav aria-label="Sections du dossier">` — row 3, column 1. With `lg:sticky lg:top-8 lg:self-start` applied, it sticks 32 px below the viewport top and self-aligns to the top of its grid cell (not stretched).
   - `<div className="flex flex-col gap-10">` containing the three `<section>`s — row 3, column 2. Grid-auto-placement yields this layout from source order alone; NO `grid-area` / `grid-row` / `grid-column` utilities are added on the nav or content div.

5. **Given** the sticky left navigation at ≥ `lg`, **When** the user scrolls down through the dossier content, **Then** the `<nav>` remains fixed at `top-8` (32 px below viewport top) and does not scroll away. Verification: the `<nav>` has `lg:sticky lg:top-8 lg:self-start` classes; `self-start` prevents `align-items: stretch` from inflating the nav to the row's full height, which would break sticky behavior (a sticky element must not fill its containing block's scroll region entirely). The grid cell's height is driven by the content column — the nav sticks within that cell's scrollable parent (the window). No `position: fixed` fallback is introduced; `sticky` is sufficient for the target browsers (Chrome 132+, Firefox 134+, Safari 18+ — all have mature sticky support).

6. **Given** the mobile anchor-nav's horizontal-scroll styling at base, **When** the `lg:` breakpoint activates, **Then** the `<ul>` transforms to a vertical list via overrides: `lg:mx-0 lg:flex-col lg:gap-1 lg:overflow-visible lg:whitespace-normal lg:px-0`. Breakdown:
   - `-mx-6 px-6 overflow-x-auto whitespace-nowrap` at base → full-bleed horizontal scroll on mobile (4.2 AC3).
   - `lg:mx-0 lg:px-0` → removes the mobile full-bleed inset at desktop (the nav is in a 240 px left column; no edge-to-edge needed).
   - `lg:flex-col lg:gap-1` → switches flex direction to column and tightens inter-link gap to 4 px for the vertical list.
   - `lg:overflow-visible lg:whitespace-normal` → unlocks wrapping + natural overflow behavior at desktop (no horizontal scrollbar needed on the 240 px column).
   Each `<a>` receives `lg:w-full` in addition to its base `inline-flex min-h-11 items-center` so the desktop nav items occupy the full 240 px column width with the 44 px min-height preserved (keyboard + touch targets unchanged).

7. **Given** the scrollspy requirement for the left nav, **When** the user scrolls through the dossier content at any viewport width, **Then** an `IntersectionObserver` instantiated in a `useEffect` on mount observes the three `<section>` elements (by id: `presentation`, `produit-marche`, `finances-equipe`) and updates a `activeSectionId` state. The observer uses `rootMargin: '-96px 0px -60% 0px'` + `threshold: 0` — meaning a section is "intersecting" only when any part of it overlaps the upper 40 % of the viewport, minus a 96 px top-offset (keeps the first section active when the user is at the page top and hasn't scrolled far). On each `IntersectionObserverCallback`, the callback filters to currently-intersecting entries and picks the one with the smallest `boundingClientRect.top` (the top-most visible section) as the active id. This is the standard "topmost-visible-section" scrollspy algorithm — no third-party library, no `scroll` event listener, no polling. The observer is cleaned up via `observer.disconnect()` on effect unmount. Initial value of `activeSectionId` is `QUESTIONNAIRE[0].id` (`'presentation'`) — matches the page-load-at-top natural state before any scroll happens. See AC17 for the canonical effect body.

8. **Given** the scrollspy's `activeSectionId`, **When** rendering each anchor link, **Then** the active link is styled with `lg:text-foreground` (darker, `#1A1A1A`) while idle links keep `text-muted-foreground` (`#6B6B6B`). Both states share `font-medium` (500 weight), matching Epic 4 Story 4.3 AC3 at [epics.md:910-912](../planning-artifacts/epics.md#L910-L912) which specifies "darker text, `font-weight: 500`". Critical: the active-state color override uses the `lg:` prefix — at `<lg` breakpoints (Story 4.2's mobile horizontal anchor bar) the active link styling is SUPPRESSED, preserving 4.2's "no active-state highlight" contract from Story 4.2 Pinned Decision #2 at [4-2-financeur-dossier-view-mobile-layout.md:382](4-2-financeur-dossier-view-mobile-layout.md#L382). Concretely: `className={cn('inline-flex min-h-11 items-center rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 lg:w-full', isActive && 'lg:text-foreground')`. Additionally, the active link gets `aria-current="location"` (NOT `"page"` — the user has not navigated to a new page, they have scrolled into a section of the same page); idle links omit `aria-current`.

9. **Given** the right content column at ≥ `lg`, **When** a developer inspects the section layout, **Then** the three `<section>`s render in the same vertical flex stack used on mobile: `<div className="flex flex-col gap-10">` wrapping three `<section id="{section.id}" aria-labelledby="{section.id}-heading" className="scroll-mt-8 lg:scroll-mt-10">` elements. The 40 px inter-section spacing (`gap-10`) satisfies Epic 4 AC4 at [epics.md:914-916](../planning-artifacts/epics.md#L914-L916) ("clear visual separation between sections (e.g. a `Separator` or spacing of ≥32px)") — we use the spacing option, NO `Separator` is introduced (Pinned Decision #4). Each `<section>` retains `scroll-mt-8` for mobile anchor-scroll landing (32 px buffer, inherited from 4.2 AC4) and gains `lg:scroll-mt-10` (40 px) for desktop — desktop has a slightly taller visual header zone above the sections when the sticky nav is present, so a marginally larger scroll-margin keeps the H2 cleanly framed below the viewport top when a user clicks an anchor link.

10. **Given** the section body content, **When** a developer inspects each section, **Then** the body composition is IDENTICAL to Story 4.2 AC4: `<h2 id="{section.id}-heading" className="font-heading text-xl font-semibold text-foreground md:text-2xl">{section.title}</h2>` followed by `<dl className="mt-4 flex flex-col gap-5">` wrapping one `<DossierField>` per question filtered from `QUESTIONNAIRE_FLAT`. The `<DossierField>` primitive at [apps/web/src/components/confluent/DossierField.tsx](apps/web/src/components/confluent/DossierField.tsx) is consumed AS-IS (Pinned Decision #3 on 4.2 carries forward — 4.3 is the second consumer outside the entrepreneur surface; do NOT extract a `DossierSection` wrapper, do NOT refactor `DossierField`). The `MOCK_DOSSIER_DETAIL.answers[q.id] ?? ''` fallback preserves the 4.2 pattern.

11. **Given** the viewport transitions from ≥ `lg` down to `<md`, **When** a developer resizes the browser continuously, **Then** no layout breakage occurs — the grid collapses back to the flex column, the sticky nav releases to a horizontally-scrollable bar, the max-width steps from `max-w-6xl` → `max-w-2xl`, the horizontal padding steps from `px-10` → `px-6`. All transitions happen at breakpoint boundaries via CSS only; no layout shift from JS state (the scrollspy's `activeSectionId` still updates but its `lg:text-foreground` override is responsively gated to desktop). Epic 4 Story 4.3 AC5 at [epics.md:918-920](../planning-artifacts/epics.md#L918-L920) mandates this graceful degradation. Probe: resize from 1400 px → 1200 px → 1023 px (crossing `lg` boundary) → 900 px → 768 px (crossing `md` boundary) → 375 px — at each step, content remains readable, no horizontal page scroll appears on `<main>`, no element overflows its container.

12. **Given** the tablet breakpoint (768–1023 px) specifically, **When** a developer inspects the rendering, **Then** the layout is IDENTICAL to the mobile single-column layout — same `max-w-2xl`, same `px-6`, same flex-col stacking, same horizontal anchor nav. The "wider margins" phrasing in [ux-design-specification.md:717-719](../planning-artifacts/ux-design-specification.md#L717-L719) resolves to the natural centering behavior of `mx-auto max-w-2xl` on a wider viewport (the content stays 672 px; the margins on either side grow as the viewport widens beyond 720 px). No `md:` prefix is added to change padding or max-width between mobile and tablet; the `lg:` breakpoint (1024 px) is the ONLY responsive inflection point for the layout in 4.3.

13. **Given** keyboard focus handling on the anchor-nav links, **When** a user Tab-navigates to an anchor link that is scrolled off-screen (possible on mobile when localized section titles create overflow, per Story 4.2 code-review deferral at [deferred-work.md:8](deferred-work.md#L8)), **Then** an `onFocus` handler on each `<a>` calls `event.currentTarget.scrollIntoView({ inline: 'nearest', block: 'nearest' })` to scroll the focused link into view inside its scroll container — the mobile horizontal scroll container OR the desktop left column. Rationale: `inline: 'nearest'` handles the mobile horizontal-scroll case; `block: 'nearest'` handles the desktop vertical-list case if it ever overflows. This closes the WCAG 2.4.7 Focus Visible deferral from 4.2's review in a single place. The handler is pure (no state updates, no side effects beyond the scroll) — no useEffect, no ref gymnastics. See AC17 for placement.

14. **Given** design-token compliance, **When** a developer greps the 4.3 changes, **Then** ZERO raw hex values appear in [apps/web/src/routes/share/dossier.tsx](apps/web/src/routes/share/dossier.tsx). Every surface routes through tokens: `bg-background`, `text-foreground`, `text-muted-foreground`, `hover:text-foreground`, `focus-visible:ring-ring/50`, `lg:text-foreground` for the active state (same token as the idle H1), Badge `variant="secondary"`. Typography uses the Tailwind scale (`text-sm`, `text-xl`, `text-2xl`, `text-3xl`); no new arbitrary `text-[Npx]` values. Grid template uses arbitrary value syntax `lg:grid-cols-[240px_1fr]` — 240 px is the single numeric literal mandated by the spec at [epics.md:902-904](../planning-artifacts/epics.md#L902-L904); `1fr` is a grid fraction, not a pixel value. Automation grep at AC18.

15. **Given** French-locale copy on the dossier view, **When** the page renders, **Then** the following strings appear EXACTLY (no change from 4.2 — 4.3 does NOT modify any French copy):
    - Dossier name (H1): `"Biosensio"` (from `MOCK_DOSSIER_DETAIL.name`)
    - Sector badge: `"DeepTech"` / Maturity badge: `"Pre-seed"`
    - Anchor-nav links + Section H2s: `"Présentation"`, `"Produit & Marché"`, `"Finances & Équipe"`
    - `<nav>` aria-label: `"Sections du dossier"`
    - Page title: `"Biosensio · Confluent"` (React 19 native `<title>` JSX, same pattern as 4.2)
    - All 12 fixture answers unchanged — `MOCK_DOSSIER_DETAIL.answers` is READ-ONLY in 4.3.

16. **Given** accessibility requirements at desktop, **When** AT traverses the page at ≥ `lg`, **Then**:
    - Landmark structure unchanged from 4.2: wordmark `role="img"` + aria-label, H1, named `<nav>` landmark, three `<section>` regions with `aria-labelledby`, `<dl>/<dt>/<dd>` term-description pairs inside each section.
    - Active anchor link announces with `aria-current="location"` — screen readers (NVDA / JAWS / VoiceOver) render this as "courante" / "current" paired with the link text ("Présentation, lien courant"). The `aria-current` state updates as the user scrolls, giving AT users the same position feedback sighted users get from the darker text color.
    - Keyboard order at desktop: wordmark (non-tabbable) → 3 anchor links (Tab stops 1–3, focus ring visible via `focus-visible:ring-ring/50`) → page content (sections are non-interactive; Tab exits to browser chrome). Focus wraps normally per browser default.
    - The scrollspy updates MUST NOT steal focus — the IntersectionObserver callback only calls `setActiveSectionId(...)`, never `.focus()`. Focus stays where the user put it.
    - `prefers-reduced-motion: reduce` respected: smooth-scroll `useEffect` from 4.2 is unchanged (browsers natively downgrade `scroll-behavior: smooth` under the media query); scrollspy `IntersectionObserver` has no animation at all; `scrollIntoView({ inline: 'nearest', block: 'nearest' })` is an instant scroll (NOT `behavior: 'smooth'`) — safe under reduced-motion.
    - WCAG 2.1 AA: `text-foreground` on `bg-background` ≈ 17.3 : 1 (AAA) for active links; `text-muted-foreground` on `bg-background` ≈ 4.9 : 1 (AA ≥14 px, meets the small-caps label threshold from 4.2). The 240 px column width gives every nav link a comfortable 240 × 44 px touch target on desktop — well above the 44 × 44 px minimum.

17. **Given** the `<ShareDossierRoute>` implementation, **When** a developer inspects [apps/web/src/routes/share/dossier.tsx](apps/web/src/routes/share/dossier.tsx), **Then** the component uses this canonical snippet (deviations require explicit mention in the story's Completion Notes):
    ```tsx
    import { useEffect, useState } from 'react'
    import { Badge } from '@/components/ui/badge'
    import { ConfluentWordmark } from '@/components/confluent/ConfluentWordmark'
    import { DossierField } from '@/components/confluent/DossierField'
    import { QUESTIONNAIRE, QUESTIONNAIRE_FLAT } from '@/data/questionnaire'
    import { MOCK_DOSSIER_DETAIL } from '@/data/mock-dossier'
    import { cn } from '@/lib/utils'

    export default function ShareDossierRoute() {
      const [activeSectionId, setActiveSectionId] = useState<string>(
        QUESTIONNAIRE[0].id,
      )

      useEffect(() => {
        const root = document.documentElement
        const previous = root.style.scrollBehavior
        root.style.scrollBehavior = 'smooth'
        return () => {
          root.style.scrollBehavior = previous
        }
      }, [])

      useEffect(() => {
        const sections = QUESTIONNAIRE.map((s) =>
          document.getElementById(s.id),
        ).filter((el): el is HTMLElement => el !== null)
        if (sections.length === 0) return

        const observer = new IntersectionObserver(
          (entries) => {
            const visible = entries.filter((e) => e.isIntersecting)
            if (visible.length === 0) return
            const topMost = visible.reduce((best, e) =>
              e.boundingClientRect.top < best.boundingClientRect.top ? e : best,
            )
            setActiveSectionId(topMost.target.id)
          },
          { rootMargin: '-96px 0px -60% 0px', threshold: 0 },
        )
        sections.forEach((el) => observer.observe(el))
        return () => observer.disconnect()
      }, [])

      return (
        <>
          <title>{MOCK_DOSSIER_DETAIL.name} · Confluent</title>
          <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-8 bg-background px-6 py-8 lg:grid lg:max-w-6xl lg:grid-cols-[240px_1fr] lg:gap-x-12 lg:gap-y-8 lg:px-10">
            <ConfluentWordmark className="h-6 w-auto text-foreground lg:col-span-2" />
            <header className="flex flex-col gap-2 lg:col-span-2">
              <h1 className="font-heading text-2xl font-semibold text-foreground md:text-3xl">
                {MOCK_DOSSIER_DETAIL.name}
              </h1>
              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary">{MOCK_DOSSIER_DETAIL.sector}</Badge>
                <Badge variant="secondary">{MOCK_DOSSIER_DETAIL.maturity}</Badge>
              </div>
            </header>
            <nav
              aria-label="Sections du dossier"
              className="lg:sticky lg:top-8 lg:self-start"
            >
              <ul className="-mx-6 flex gap-2 overflow-x-auto whitespace-nowrap px-6 lg:mx-0 lg:flex-col lg:gap-1 lg:overflow-visible lg:whitespace-normal lg:px-0">
                {QUESTIONNAIRE.map((section) => {
                  const isActive = activeSectionId === section.id
                  return (
                    <li key={section.id}>
                      <a
                        href={`#${section.id}`}
                        aria-current={isActive ? 'location' : undefined}
                        onFocus={(event) => {
                          event.currentTarget.scrollIntoView({
                            inline: 'nearest',
                            block: 'nearest',
                          })
                        }}
                        className={cn(
                          'inline-flex min-h-11 items-center rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 lg:w-full',
                          isActive && 'lg:text-foreground',
                        )}
                      >
                        {section.title}
                      </a>
                    </li>
                  )
                })}
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
                    className="scroll-mt-8 lg:scroll-mt-10"
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
    - `cn` import (from [apps/web/src/lib/utils.ts](apps/web/src/lib/utils.ts)) is the one NEW import compared to 4.2 — needed for the conditional active-state class. Every other consumer in the codebase uses `cn` from this path (see [apps/web/src/components/confluent/DossierField.tsx:1](apps/web/src/components/confluent/DossierField.tsx#L1) precedent).
    - The two `useEffect`s are separate: smooth-scroll effect runs exactly once (carries forward from 4.2); scrollspy effect runs exactly once after mount (reads DOM, attaches observer, returns cleanup). Keeping them separate preserves the 4.2 smooth-scroll contract verbatim and makes the scrollspy effect self-contained.
    - `document.getElementById(...)` in the scrollspy effect reads the `<section>`s rendered in the same component tree; `useEffect` fires AFTER commit → all three sections are present by the time the observer is created. No `useLayoutEffect`, no refs needed.
    - `filter((el): el is HTMLElement => el !== null)` is the standard TS type-narrowing predicate — `document.getElementById` returns `HTMLElement | null`; the predicate tells TS the remaining array is `HTMLElement[]`.
    - The `onFocus` handler is inline (no `useCallback`) — the component re-renders only when `activeSectionId` changes, and the scroll call is idempotent (already-visible elements get a no-op scroll). `useCallback` would add noise without measurable benefit at 3-link scale.
    - `aria-current={isActive ? 'location' : undefined}` — passing `undefined` for the idle case makes React OMIT the attribute entirely (rather than rendering `aria-current=""` which some AT interpret as `"true"`).

18. **Given** the verification sweep, **When** a developer runs the grep guardrails, **Then**:
    - `grep -nE '#[0-9a-fA-F]{3,6}' apps/web/src/routes/share/dossier.tsx` returns ZERO matches.
    - `grep -n "AppShell\|Breadcrumbs\|NavItem\|useCurrentUser\|CurrentUserProvider" apps/web/src/routes/share/dossier.tsx` returns ZERO matches.
    - `grep -n "IntersectionObserver" apps/web/src/routes/share/dossier.tsx` returns EXACTLY 1 match (the observer constructor call).
    - `grep -n "aria-current" apps/web/src/routes/share/dossier.tsx` returns EXACTLY 1 match (the anchor link's `aria-current={isActive ? 'location' : undefined}` prop).
    - `grep -n "lg:sticky\|lg:top-8\|lg:grid\|lg:col-span-2\|lg:grid-cols-\[240px_1fr\]" apps/web/src/routes/share/dossier.tsx` returns ≥ 5 matches (the desktop grid wiring).
    - `grep -n "scrollIntoView" apps/web/src/routes/share/dossier.tsx` returns EXACTLY 1 match (the `onFocus` handler).
    - `grep -n "Biosensio\|DeepTech\|Pre-seed" apps/web/src/routes/share/dossier.tsx` returns ZERO matches — all three literals still live only in `mock-dossier.ts`.
    - `grep -n "@radix-ui/react" apps/web/src/routes/share/dossier.tsx` returns ZERO matches — 4.3 uses Base UI-wrapped primitives only (`Badge`).
    - `grep -n "localStorage\|sessionStorage\|fetch(\|XMLHttpRequest\|sendBeacon" apps/web/src/routes/share/dossier.tsx` returns ZERO matches — 4.3 adds NO storage access, NO network calls, NO analytics beacons (FR23 telemetry belongs to Story 8.3).
    - `grep -n "useParams" apps/web/src/routes/share/dossier.tsx` returns ZERO matches — Pinned Decision #8 on 4.2 carries forward: the `token` URL param is intentionally unread until Story 4.4's mocked token guard.
    - `pnpm --filter @confluent/web typecheck` → exits 0.
    - `pnpm --filter @confluent/web lint` → 0 errors, same 3 tolerated pre-existing warnings (`badge.tsx:52`, `button.tsx:58`, `features/current-user/context.tsx:17`). ZERO new warnings.
    - `pnpm turbo run build` → all packages GREEN. Bundle delta against the 4.2 baseline of `623.28 KB / 196.06 KB gz`: estimated ≤ +1.2 KB gz (adds `useState`, IntersectionObserver logic, `cn` import, responsive classes, `onFocus` handler — no new npm dep, no new component, no new primitive).

19. **Given** no regression across Stories 1.1 – 4.2, **When** the dev agent completes 4.3, **Then**:
    - `/dashboard` (entrepreneur dashboard — Stories 2.2, 3.1) unchanged — `DossierCard` list rendering intact.
    - `/dashboard/dossiers/nouveau` / `/questionnaire` / `/recapitulatif` (Stories 2.3 – 2.6) reachable and unchanged.
    - `/dashboard/dossiers/view/:slug` (Stories 3.2 – 3.6) unchanged — tabs, analytics, SharePanel, RevokeAccessDialog all intact.
    - `/share/:token` (Story 4.1) unchanged.
    - `/share/:token/dossier` at `<lg` viewport: renders IDENTICALLY to Story 4.2's mobile view (AC1 of this story is the CSS-only override constraint). The `<CurrentUserProvider>` is never consumed; the `<Toaster>` fires no toasts.
    - [apps/web/src/router.tsx](apps/web/src/router.tsx) unchanged.
    - [apps/web/src/components/confluent/DossierField.tsx](apps/web/src/components/confluent/DossierField.tsx) / `ConfluentWordmark.tsx` / `ui/badge.tsx` unchanged — reused as-is.
    - [apps/web/src/data/mock-dossier.ts](apps/web/src/data/mock-dossier.ts) / `mock-dossiers.ts` / `questionnaire.ts` unchanged.
    - The 3 tolerated pre-existing ESLint warnings remain at 3 — ZERO new warnings.
    - No new npm dependency (no IntersectionObserver polyfill; no scrollspy library; no `framer-motion`; no `@tanstack/react-virtual`).

20. **Given** the sprint-status tracker transition, **When** this story file is created, **Then** [sprint-status.yaml](sprint-status.yaml) has `development_status.4-3-financeur-dossier-view-desktop-layout` flipped from `backlog` → `ready-for-dev` and the header `last_updated` + field bumped to `2026-04-22`. The `epic-4` entry remains `in-progress` (set during Story 4.1's kickoff). All other entries untouched.

## Tasks / Subtasks

- [x] **Task 1: Rewrite `ShareDossierRoute` to add the desktop grid + scrollspy (AC: 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17)**
  - [x] Replace the body of [apps/web/src/routes/share/dossier.tsx](apps/web/src/routes/share/dossier.tsx) using the canonical snippet at AC17 verbatim (or a structurally equivalent variant — any deviation must be called out in Completion Notes).
  - [x] Preserve the `default` export name `ShareDossierRoute` (router.tsx at [apps/web/src/router.tsx:11](apps/web/src/router.tsx#L11) imports the default; renaming would break the route registration locked in Story 4.1 Pinned Decision #12).
  - [x] Imports match AC17 exactly: `useEffect`, `useState` from `react`; `Badge`; `ConfluentWordmark`; `DossierField`; `QUESTIONNAIRE`, `QUESTIONNAIRE_FLAT`; `MOCK_DOSSIER_DETAIL`; `cn`. No additional imports (no `useRef`, no `useCallback`, no `useMemo`, no React Router hooks, no external scrollspy lib).
  - [x] Typecheck green after rewrite (`pnpm --filter @confluent/web typecheck` exits 0).

- [x] **Task 2: Verification sweep — typecheck, lint, build, grep, manual walkthrough (AC: 14, 18, 19)**
  - [x] `pnpm --filter @confluent/web typecheck` — exits 0.
  - [x] `pnpm --filter @confluent/web lint` — exits 0. Preserve the 3 tolerated pre-existing warnings (`badge.tsx:52`, `button.tsx:58`, `features/current-user/context.tsx:17`); ZERO new warnings.
  - [x] `pnpm turbo run build` — all packages GREEN. Measure the bundle delta against the 4.2 baseline (`623.28 KB / 196.06 KB gz`) — record actual in Completion Notes.
  - [x] Run the AC18 grep battery — every assertion passes. Notable counts: `IntersectionObserver` = 1, `aria-current` = 1, `scrollIntoView` = 1.
  - [x] Manual browser walkthrough (below) if a browser is available; otherwise document the deferral in Completion Notes (same pattern as 4.1 / 4.2).
    1. Open `http://localhost:5173/share/biosensio-share/dossier` at 1440 px → verify the two-column layout: left sticky nav with 3 links, right content column with wordmark + H1 + badges (top bar spanning both) + 3 sections each with 4 `<DossierField>`s.
    2. Scroll the content → the left nav remains sticky at 32 px top; the active link progressively highlights darker (`text-foreground`) as each `<section>` enters the upper 40 % of the viewport.
    3. Click a nav link (e.g. `"Finances & Équipe"`) → page smooth-scrolls; the target section's `<h2>` lands ~40 px below the top at desktop (`lg:scroll-mt-10`); the active-state flips after the scroll settles.
    4. Tab-navigate the 3 nav links → each receives a visible focus ring; Enter activates the anchor scroll. Tabbing does NOT steal scroll position elsewhere.
    5. Resize 1440 → 1024 px → 1023 px → 900 px → 768 px → 375 px — no broken layout; the grid collapses to flex-col at <1024 px; the horizontal anchor bar re-appears; active-state highlight disappears (`lg:text-foreground` is gated to ≥ lg).
    6. Verify `prefers-reduced-motion: reduce` (OS toggle) → anchor clicks jump instantly (no smooth-scroll); scrollspy still updates silently.
    7. Browser title: `"Biosensio · Confluent"` (unchanged from 4.2).
    8. DevTools inspect: `aria-current="location"` is present on exactly ONE anchor at any given time (no more, no less, unless all three sections are briefly off-screen between sections — documented edge).
    9. Regression check: `/dashboard` + `/dashboard/dossiers/view/biosensio` + `/share/:token` all render unchanged.
  - [x] On each edit, mark the corresponding Tasks/Subtasks checkbox above.

- [x] **Task 3: Sprint status housekeeping (AC: 20)**
  - [x] After Task 2 green + commit lands, update [sprint-status.yaml](sprint-status.yaml):
    - `development_status.4-3-financeur-dossier-view-desktop-layout: ready-for-dev → in-progress → review` (the first flip happens on story creation — this workflow's final step; subsequent flips happen during `dev-story` and `code-review`).
    - `last_updated: 2026-04-22` (or the current date when the transition runs).
  - [x] Preserve every comment in the file (STATUS DEFINITIONS block, header comment, etc.). Use targeted replacements only — NEVER rewrite the file.
  - [x] Update this story file: mark Status `ready-for-dev → in-progress → review` as transitions happen.

## Dev Notes

### Critical Architecture Constraints

- **CSS-only responsive override — NO route-level branch.** The entire 4.3 behavior layers on top of 4.2 via Tailwind `lg:` prefixes. There is NO `window.matchMedia('(min-width: 1024px)')` check, NO `useWindowSize` hook, NO conditional render for desktop vs. mobile. The same JSX tree renders at every viewport; the grid / sticky / vertical-stack behavior is activated by the CSS engine based on breakpoint. This is Pinned Decision #1 on 4.2 at [4-2-financeur-dossier-view-mobile-layout.md:380](4-2-financeur-dossier-view-mobile-layout.md#L380) — "4.3 introduces the sticky left-nav + scrollspy as a CSS-only override (`lg:grid lg:grid-cols-[240px_1fr]` on the `<main>`, etc.) without requiring a route-level branch."
- **Scrollspy is viewport-agnostic in JS; the visual highlight is `lg:`-gated.** The `IntersectionObserver` runs at every viewport width and updates `activeSectionId`. The `aria-current="location"` attribute is always emitted on the top-most visible section's anchor, at every width — AT users on mobile benefit from the position feedback too. Only the VISUAL darker-text highlight (`lg:text-foreground`) is responsively gated so Story 4.2's "no active-state highlight" contract (Pinned Decision #2 on 4.2) is preserved visually at `<lg`.
- **`/share/:token/dossier` remains STANDALONE — NOT nested under `<AppShell>`.** Same constraint as 4.1 / 4.2. Epic 4 AC6 on Story 4.3 at [epics.md:922-924](../planning-artifacts/epics.md#L922-L924) mandates "no sidebar (entrepreneur navigation is absent), only a minimal top bar with the Confluent logo and the dossier name." The "minimal top bar" at desktop is achieved by the `<ConfluentWordmark>` + `<header>` spanning both grid columns (`lg:col-span-2`) — NOT by introducing a new `<TopBar>` component, NOT by adding a `<header role="banner">` landmark (the native `<header>` tag is already a landmark when it's a direct child of `<body>` — but ours is inside `<main>`, so it's implicit `sectioning` content; this is fine for the minimal top-bar semantics without needing an explicit `role="banner"` since the wordmark provides the brand and the H1 provides the page name).
- **Reuse `<DossierField>`, `<ConfluentWordmark>`, `<Badge>` — introduce NO new components.** Pinned Decision #3 from 4.2 carries forward (rule of three: first use in 2.6/3.2, second use in 4.2, third use in 4.3 — at this point the pattern is stable, but the scope of 4.3 is still a route-body rewrite, NOT a component extraction). A "DossierSection" extraction would be premature; still only one route consumes the full `<section> + <h2> + <dl> + <DossierField>` shape on the financeur side. If Story 5.2 (admin all-dossiers list) ends up needing the same shape, extract then.
- **No new npm dependency.** `IntersectionObserver` is a browser native (97 %+ support per caniuse as of 2025; all target browsers per [architecture.md:180](../planning-artifacts/architecture.md#L180)). No scrollspy library (`react-use`, `@react-hooks-library/core`, `react-scrollspy-navigation`, etc.) is acceptable.
- **No `useRef` / `useLayoutEffect` for the scrollspy.** The section elements are found by `document.getElementById(...)` inside `useEffect` (runs after commit, DOM is ready). Using refs would require attaching them to each `<section>` in the JSX map which clutters the rendering without benefit at 3-section scale. Using `useLayoutEffect` would over-engineer the timing — the observer's first callback fires after the next paint anyway, so useEffect is correct.
- **`aria-current="location"` — NOT `"page"`, NOT `"true"`, NOT `"section"`.** The WAI-ARIA 1.2 spec defines `aria-current="location"` specifically for "the current location within an environment or context" — precisely the scrollspy-on-same-page case. `"page"` implies a cross-page navigation state (wrong). `"true"` is valid but less specific. `"section"` is not a defined value (the AT fallback varies). `"location"` is the canonical value used by GitHub's in-page docs navigation, MDN, and shadcn's own sidebar primitive for the same use case.
- **`scroll-behavior: smooth` scoped to this route via `useEffect`.** Pinned Decision #4 on 4.2 carries forward byte-for-byte — the effect setting `document.documentElement.style.scrollBehavior` on mount and restoring on unmount is UNCHANGED in 4.3. No global index.css change, no Tailwind `scroll-smooth` utility on `<main>` (the anchor scroll lives on `<html>`, not `<main>`, so the utility wouldn't work there anyway).
- **No Toaster, no SharePanel, no RevokeAccessDialog, no Tabs on the financeur view.** Entrepreneur-surface components belong to the entrepreneur surface. The financeur view is READ-ONLY.
- **No analytics beacon, no `fetch`, no `sendBeacon`.** Story 8.3 (FR23 financeur session tracking) owns telemetry. 4.3 is telemetry-free.
- **Design tokens only — no raw hex.** `bg-background`, `text-foreground`, `text-muted-foreground`, `ring-ring`, `Badge variant="secondary"`. The `240px` literal in the grid template is NOT a color hex and is explicitly spec'd at [epics.md:902-904](../planning-artifacts/epics.md#L902-L904). AC18 grep is the automated guardrail.
- **WCAG 2.1 AA baseline.** Inherit all 4.2 semantics; ADD `aria-current="location"` for scrollspy position feedback; ADD the `onFocus` scroll-into-view handler that closes the 4.2 deferral for off-viewport focus. No new landmarks, no new ARIA live regions (scrollspy position change is NOT an announcement-worthy state change — AT users navigate via landmark / heading jumps, not by listening to scroll position).

### Design Tokens to Use

| Surface | Tailwind utility | Value | Where |
|---|---|---|---|
| Page background | `bg-background` | `#FAFAF9` | `<main>` |
| Page min-height | `min-h-screen` | 100 vh | `<main>` |
| Content max-width (mobile/tablet) | `max-w-2xl` | 672 px | `<main>` (base) |
| Content max-width (desktop) | `lg:max-w-6xl` | 1152 px | `<main>` (lg+) |
| Horizontal gutter (mobile/tablet) | `px-6` | 24 px | `<main>` (base) |
| Horizontal gutter (desktop) | `lg:px-10` | 40 px | `<main>` (lg+) |
| Grid template (desktop) | `lg:grid-cols-[240px_1fr]` | 240 px fixed + remaining | `<main>` (lg+) |
| Horizontal grid gap (desktop) | `lg:gap-x-12` | 48 px | `<main>` (lg+) |
| Vertical grid gap (desktop) | `lg:gap-y-8` | 32 px | `<main>` (lg+) |
| Vertical flex gap (mobile/tablet) | `gap-8` | 32 px | `<main>` (base) |
| Sticky top offset (desktop) | `lg:top-8` | 32 px | `<nav>` (lg+) |
| Anchor nav item gap (desktop) | `lg:gap-1` | 4 px | `<ul>` (lg+) |
| Anchor nav item gap (mobile) | `gap-2` | 8 px | `<ul>` (base) |
| Anchor link idle | `text-muted-foreground` + `font-medium text-sm` | `#6B6B6B` / 500 / 14 px | `<a>` |
| Anchor link hover | `hover:text-foreground` | `#1A1A1A` | `<a>` |
| Anchor link active (desktop only) | `lg:text-foreground` | `#1A1A1A` | `<a>` when `isActive` |
| Anchor link focus ring | `focus-visible:ring-2 focus-visible:ring-ring/50` | `#37352F` 50 % | `<a>` |
| Anchor link radius | `rounded-md` | 4 px (via `--radius`) | `<a>` |
| Anchor link touch target | `min-h-11 px-3 py-2` | 44 px tall, 12 px gutters | `<a>` |
| Anchor link width (desktop) | `lg:w-full` | 100 % of 240 px column | `<a>` (lg+) |
| H1 color / size | `text-foreground` / `font-heading text-2xl font-semibold md:text-3xl` | `#1A1A1A` / 24 → 30 px / 600 | `<h1>` |
| H2 color / size | `text-foreground` / `font-heading text-xl font-semibold md:text-2xl` | `#1A1A1A` / 20 → 24 px / 600 | `<h2>` |
| Badge | `Badge variant="secondary"` | `bg-secondary` + `text-secondary-foreground` | Sector, maturity |
| Wordmark color / size | `text-foreground` / `h-6 w-auto` | `#1A1A1A` / 24 px | `<ConfluentWordmark>` |
| DossierField label / value | inherited (`<DossierField>`) | 11 px small-caps / 13 px 500 | `<dt>` / `<dd>` |
| Scroll margin (mobile/tablet) | `scroll-mt-8` | 32 px | each `<section>` |
| Scroll margin (desktop) | `lg:scroll-mt-10` | 40 px | each `<section>` (lg+) |

### Component Prop Contracts

```tsx
// apps/web/src/routes/share/dossier.tsx (rewritten — 4.3 replaces 4.2's body)
export default function ShareDossierRoute(): JSX.Element
// — no props; consumes MOCK_DOSSIER_DETAIL + QUESTIONNAIRE statically
// — does NOT consume useParams (token intentionally unread; Pinned Decision #8 on 4.2)
// — state: activeSectionId: string (scrollspy — initial = QUESTIONNAIRE[0].id)

// NO new data modules — mock-dossier.ts and questionnaire.ts unchanged.
// NO new components — DossierField, ConfluentWordmark, Badge reused as-is.
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
│   ├── mock-dossier.ts                                [UNCHANGED — 4.2]
│   ├── mock-dossiers.ts                               [UNCHANGED]
│   └── questionnaire.ts                               [UNCHANGED]
├── features/                                          [UNCHANGED]
├── lib/
│   └── utils.ts                                       [UNCHANGED — `cn` re-imported]
├── routes/
│   ├── admin/                                         [UNCHANGED]
│   ├── auth/                                          [UNCHANGED]
│   ├── dashboard/                                     [UNCHANGED]
│   ├── not-found.tsx                                  [UNCHANGED]
│   └── share/
│       ├── dossier.tsx                                [REWRITTEN — adds desktop grid + scrollspy + onFocus-scroll-into-view]
│       └── index.tsx                                  [UNCHANGED — 4.1]
├── main.tsx                                           [UNCHANGED]
└── router.tsx                                         [UNCHANGED]
```

### Decisions Pinned for This Story

Do not renegotiate without explicit retrospective action.

1. **`lg:grid-cols-[240px_1fr]` — NOT `lg:grid-cols-[minmax(220px,240px)_1fr]`, NOT `lg:grid-cols-[240px_minmax(0,720px)]`.** Epic 4 AC1 on Story 4.3 at [epics.md:902-904](../planning-artifacts/epics.md#L902-L904) mandates "a left column (~240px, sticky) [...] and a right column (remaining width)." The `~` in the spec leaves wiggle room but `240px 1fr` is the clean interpretation. Alternatives rejected: `minmax(220px, 240px)` for the nav — would let the column shrink below the 240 px intent at cramped widths; `minmax(0, 720px)` for the content — would cap the content at 720 px for reading comfort but diverges from the "remaining width" phrasing. Keep 240 px fixed and 1 fr fluid.

2. **Scrollspy via native `IntersectionObserver` — NO third-party library, NO custom hook module.** Acceptable libraries (`react-scroll-sync`, `react-scrollspy-navigation`, `@reach/visually-hidden`, etc.) add ≥ 2 KB gz and provide a feature-set we don't need (scrolling TO sections is handled by native `<a href="#id">`; we only need active-state detection). A `useScrollSpy` custom hook module is premature; the scrollspy is used in exactly one component in the codebase. Inline `useEffect` + `IntersectionObserver` is the pragmatic choice — extract a hook if a third consumer emerges.

3. **`rootMargin: '-96px 0px -60% 0px'` + `threshold: 0`.** Chosen to match the "topmost visible section becomes active" UX. Top offset of -96 px compensates for: sticky nav offset at `top-8` (32 px) + header height (~64 px including padding) — a section becomes "visible" only when its top reaches 96 px below the viewport top, giving the previous section a natural reign as the user starts scrolling a new section into view. Bottom -60 % shrinks detection to the upper 40 % of the viewport. Alternatives rejected: `-100px 0px -60% 0px` (almost identical, off by 4 px — not worth the pixel perfectionism); `threshold: [0, 0.25, 0.5, 0.75, 1]` (multi-threshold) — adds callback noise without improving the topmost-wins algorithm; `threshold: 0.5` — would only fire at 50 % visible, creating delayed active-state flips when a long section is barely visible at 40 %.

4. **No `<Separator>` between sections.** Epic 4 AC4 on Story 4.3 allows either a `Separator` OR ≥ 32 px spacing. We choose spacing — `gap-10` (40 px) in the sections wrapper. Adding a `Separator` would introduce visual heaviness that the monochrome Notion-inspired palette at [ux-design-specification.md:325-343](../planning-artifacts/ux-design-specification.md#L325-L343) deliberately avoids. The 40 px gap + 11 px small-caps label at the start of each field gives enough visual breathing room.

5. **`aria-current="location"` — NOT `"page"`.** See "Critical Architecture Constraints" above for the full rationale. Summary: WAI-ARIA 1.2 defines `"location"` as the correct value for in-page position (scrollspy on same-page anchors); `"page"` implies cross-page nav state.

6. **Active-state color gated to desktop via `lg:text-foreground`.** At `<lg` the scrollspy updates `activeSectionId` and emits `aria-current="location"` on the active anchor, but the darker-text visual highlight is SUPPRESSED to preserve Story 4.2's "no active-state highlight" contract (4.2 Pinned Decision #2 at [4-2-financeur-dossier-view-mobile-layout.md:382](4-2-financeur-dossier-view-mobile-layout.md#L382)). Alternatives rejected: showing active-state at all viewports — widens 4.2's behavior without user demand; using different active styling on mobile (e.g. underline) — introduces two visual patterns to maintain; gating the scrollspy's state update itself by viewport — adds a `matchMedia` listener that contradicts "CSS-only responsive override" (Pinned Decision #1 above).

7. **`onFocus={scrollIntoView({ inline: 'nearest', block: 'nearest' })}` on each anchor link.** Resolves the 4.2 code-review deferral at [deferred-work.md:8](deferred-work.md#L8). `inline: 'nearest'` handles the mobile horizontal-overflow case (Tab-focused off-screen anchor scrolls itself into the visible range); `block: 'nearest'` handles the desktop vertical case if the left column ever overflows (240 × 44-px-per-link × 3 links = 132 px — comfortably under any reasonable viewport). Alternatives rejected: setting `scroll-behavior` on the `<ul>` — doesn't trigger on focus; a global focus listener — over-engineered; `tabindex="0"` on the scroll container — unnecessary and adds an unwanted tab stop.

8. **`header` and `<ConfluentWordmark>` span both columns at desktop.** The "minimal top bar" from Epic 4 AC6 [epics.md:922-924](../planning-artifacts/epics.md#L922-L924) is rendered as: wordmark (row 1, `lg:col-span-2`) + `<header>` with H1 + badges (row 2, `lg:col-span-2`). This keeps the brand + dossier identity visible above BOTH the nav and the content at desktop. Alternatives rejected: placing the H1 inside the right content column and leaving only the wordmark in a full-width row — fragments the "top bar" notion; placing the wordmark ABOVE the nav in the left column — shrinks the wordmark's visual weight and loses the full-width brand presence.

9. **Reuse `cn` from `@/lib/utils` — no new utility.** Every conditional-class consumer in the codebase imports `cn` from `@/lib/utils`. Precedent: [apps/web/src/components/confluent/DossierField.tsx:1](apps/web/src/components/confluent/DossierField.tsx#L1), `AccessListRow.tsx`, `StatusDot.tsx`, `EmptyState.tsx`, etc. Do NOT write `clsx(...)` inline; do NOT `twMerge(...)` directly.

10. **4.2's Pinned Decisions #2 – #10 CARRY FORWARD.** No renegotiation. Specifically:
    - #2: plain `<a href="#id">`, no React Router `<Link>` — unchanged.
    - #3: reuse `<DossierField>` + `<dl>` wrapping pattern — unchanged.
    - #4: scroll-behavior scoped via `useEffect` — unchanged (verbatim).
    - #5: Badge `variant="secondary"` — unchanged.
    - #6: `MOCK_DOSSIER_DETAIL` singular fixture — unchanged (4.3 does not mutate).
    - #7: copy literals + Unicode typography — unchanged.
    - #8: `token` URL param unread — unchanged (4.4 adds the guard).
    - #9: document title uses fixture name — unchanged.
    - #10: no share-side interaction surface — unchanged (no "partager", no "supprimer l'accès").

### Previous Story Intelligence

**From Story 4.2 (just landed — `3cc245a`):**
- [apps/web/src/routes/share/dossier.tsx](apps/web/src/routes/share/dossier.tsx) is the ONLY file 4.3 modifies. Every constraint from 4.2's implementation (AC14 canonical snippet) is the base that 4.3 extends with `lg:` overrides + state + scrollspy effect + `onFocus` handler.
- Bundle at 4.2 close: `623.28 KB / 196.06 KB gz`. 4.3's estimated delta: ≤ +1.2 KB gz (one `useState`, one small `useEffect`, one `onFocus` handler, ~15 responsive class names, `cn` import). If the delta exceeds 2 KB gz, audit for accidental imports (e.g. `import * as Tabs from '@base-ui/react/tabs'` — wildcard). No new npm dep justifies any bundle growth beyond this estimate.
- The 3 tolerated pre-existing ESLint warnings (`badge.tsx:52`, `button.tsx:58`, `features/current-user/context.tsx:17`) must stay at 3; ZERO new warnings.
- 4.2's smooth-scroll `useEffect` copies verbatim — do NOT modify it.
- 4.2's mobile anchor-nav styling (`-mx-6 ... px-6 overflow-x-auto whitespace-nowrap`) copies verbatim as the BASE classes; 4.3 only ADDS `lg:` overrides.
- 4.2's scroll-mt-8 on each section stays; 4.3 ADDS `lg:scroll-mt-10`.
- 4.2 deferred 4 items in its review — 4.3 explicitly resolves #2 (anchor-nav keyboard focus off-viewport) via the `onFocus` handler (Pinned Decision #7). The other three (manual tri-device walkthrough, anchor-click not moving focus to H2, mobile scroll indicator) remain deferred; 4.3 does NOT implicitly take on the H2 focus fix (that belongs to the dedicated a11y polish pass cross-referenced from Stories 3.2 / 3.3 / 4.2).

**From Story 4.1 (`af6ac5c`):**
- Route registration in [apps/web/src/router.tsx:49](apps/web/src/router.tsx#L49) is PERMANENT — 4.3 does NOT touch router.tsx.
- `<ConfluentWordmark>` accepts `className` — 4.3 sizes it `h-6 w-auto text-foreground lg:col-span-2` (wordmark itself adds `lg:col-span-2` to span the grid; the `h-6` + `w-auto` sizing is unchanged from 4.2).
- Pinned Decision #9 from 4.1 ("no `useCurrentUser` consumption in the financeur flow") carries forward — 4.3 does NOT consume `useCurrentUser`.

**From Story 3.2 (`791997b`) — tab switching + focus management patterns:**
- The `headingRef.current?.focus()` pattern with `{ preventScroll: true }` is a known a11y polish item for same-page position-change focus management, tracked as a deferral. 4.3 does NOT implement that pattern — the scrollspy is a passive observer, NOT a navigation event. Active-state changes are position FEEDBACK, not focus-move actions.

**From Story 3.3 (`a093915`) — IntersectionObserver candidate:**
- 3.3's analytics panel did NOT use IntersectionObserver (the scroll-on-tab-change deferral was stubbed for a future a11y pass). 4.3 is the FIRST user of `IntersectionObserver` in the codebase. Pattern: construct in `useEffect`, observe DOM nodes found by id, disconnect in cleanup. Future consumers (admin dashboard, analytics scroll tracking) can follow the same shape.

**From Story 2.6 + 3.2 + 4.2 (three uses of `<DossierField>`):**
- `<DossierField>` is locked as the label + value display primitive. 4.3 is the SAME consumer as 4.2 (no new imports, no additional props). The rule-of-three has been met for the `<section> + <h2> + <dl> + <DossierField>` pattern; future Stories 5.2 / 7.6 can consider extracting a `DossierSection` if a fourth consumer emerges.

**From deferred-work.md (4.2 code review, line 8):**
- "Horizontally-scrolled anchor-nav keyboard focus may land off-viewport ... Natural fix belongs with Story 4.3's sticky-desktop-nav IntersectionObserver pattern — add `scrollIntoView({ inline: 'nearest' })` on the focus handler there." → 4.3 implements this via the `onFocus` handler (AC13, Pinned Decision #7).

### Git Intelligence

Recent commits (most recent 6):

```
3cc245a feat(epic-4): story 4.2 — Financeur dossier view mobile layout
af6ac5c feat(epic-4): story 4.1 — Email verification screen (UI only, mocked)
75b566a feat(epic-3): story 3.6 — Access revocation (optimistic, mocked)
9ba8ff9 feat(epic-3): story 3.5 — Share panel (D5) with Sheet component
e04e2a2 feat(epic-3): story 3.4 — AccessListRow & StatusDot components
a093915 feat(epic-3): story 3.3 — MetricCard grid & analytics timeline (D4)
```

**Observed patterns to carry forward:**
- Commit title format: `feat(epic-N): story N.M — <descriptive title matching epic AC phrasing>`. 4.3's commit title: `feat(epic-4): story 4.3 — Financeur dossier view desktop layout`.
- Single bundled commit per story (impl + code-review patches together) per the user's auto-memory at [feedback_commit_review_together.md](/home/coder/.claude/projects/-home-coder-confluent/memory/feedback_commit_review_together.md).
- Route body rewrites without router.tsx changes — the same pattern used by 4.2. 4.3 continues.
- No new file creation in 4.3 — route rewrite only. Contrast with 4.2 which added `mock-dossier.ts`.

### Latest Technical Specifics

**React 19 + React Router v7:**
- Native `<title>` JSX element is supported and auto-hoisted — carries forward from 4.2 verbatim.
- React 19 concurrent state updates: `setActiveSectionId(...)` inside the IntersectionObserver callback is batched automatically; no `startTransition` needed (the update is low-frequency and cheap).
- React Router v7's hash-only anchor navigation: `<a href="#section-id">` is a plain anchor; the router does NOT intercept it. Unchanged from 4.2.

**`IntersectionObserver` browser support (2025):**
- Chrome 58+ / Firefox 55+ / Safari 12.1+ / Edge 16+ — universal support in every target browser per [architecture.md](../planning-artifacts/architecture.md). No polyfill needed.
- `rootMargin` accepts percentages (`-60%`) — standard behavior since the spec's first draft; supported in every browser that has IntersectionObserver.
- `entries` are reported in no guaranteed order — always filter + sort / reduce to find the topmost. The AC17 snippet's `.reduce((best, e) => e.boundingClientRect.top < best.boundingClientRect.top ? e : best)` is the canonical "pick the topmost" pattern.

**Tailwind CSS v4.2.2:**
- `lg:` prefix = `@media (min-width: 1024px)` — matches [ux-design-specification.md:712](../planning-artifacts/ux-design-specification.md#L712) "Desktop minimum — sidebar becomes visible."
- Arbitrary value syntax `lg:grid-cols-[240px_1fr]` — supported since Tailwind 3.0; emits exactly one class name with a single CSS property `grid-template-columns: 240px 1fr`.
- `lg:sticky lg:top-8 lg:self-start` — `position: sticky` + `top: 2rem` + `align-self: start`. The `self-start` is CRITICAL for sticky inside a grid cell; without it, `align-items: stretch` fills the grid cell and sticky can't work.
- `lg:col-span-2` — `grid-column: span 2 / span 2`. At `<lg`, the element has no grid-column property and is placed naturally in the flex-col layout.
- `lg:scroll-mt-10` — `scroll-margin-top: 2.5rem` (40 px).

**Base UI primitives (via shadcn v4):**
- `<Badge>` unchanged from 4.2.
- No new Base UI primitive consumed in 4.3. Specifically: NO `<ScrollArea>` (the horizontal mobile nav uses browser-native scroll; the desktop vertical nav has `lg:overflow-visible`).

**Bundle budget:**
- `useState` + one `useEffect` + IntersectionObserver construction: negligible (≤ 200 bytes source).
- `cn` import: already in the bundle (tree-shakeable aggregation).
- Responsive class names: strings in source; Tailwind compiles them to CSS at build time; the bundle sees them only as string literals inside JSX. Each new class name is a few bytes.
- Total estimated source size delta: +80 lines of TSX ≈ +3 KB uncompressed ≈ +0.8 – 1.2 KB gz.

### Project Structure Notes

- Alignment with [architecture.md:524-702](../planning-artifacts/architecture.md#L524-L702): no new files. The only modified file, `apps/web/src/routes/share/dossier.tsx`, remains in its expected location.
- No new folders required. No shared-package changes required.
- If a future contributor considers introducing a `useScrollSpy` hook, the right home is `apps/web/src/lib/hooks/` — but Pinned Decision #2 on this story defers that extraction. Do NOT create the folder in 4.3.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#894-926 (Epic 4 Story 4.3 — Desktop Layout AC)]
- [Source: _bmad-output/planning-artifacts/epics.md#817-819 (Epic 4 scope — UI-mocked, no API wiring until Epic 7)]
- [Source: _bmad-output/planning-artifacts/epics.md#922-924 (minimal top bar + absence of sidebar mandate)]
- [Source: _bmad-output/planning-artifacts/prd.md#FR23,FR27,FR34 (financeur view scope; session tracking out of scope until Epic 8)]
- [Source: _bmad-output/planning-artifacts/architecture.md#180 (target browsers)]
- [Source: _bmad-output/planning-artifacts/architecture.md#207-232 (Frontend Architecture — routing, state, components)]
- [Source: _bmad-output/planning-artifacts/architecture.md#524-702 (Project Structure)]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#325-343 (Color System — monochrome palette + status tokens)]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#345-357 (Typography scale)]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#377-385 (Accessibility Considerations — 44 px touch targets, dl/dt/dd)]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#466-481 (Journey 2 — Financeur access flow)]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#568-576 (DossierField component spec)]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#704-727 (Responsive Strategy — `lg:` breakpoint, two-column dossier at 1024 px+)]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#762-773 (Implementation Guidelines — mobile-first CSS + `lg:` overrides)]
- [Source: _bmad-output/implementation-artifacts/4-2-financeur-dossier-view-mobile-layout.md (Story 4.2 — every Pinned Decision + AC14 canonical snippet as the extension base)]
- [Source: _bmad-output/implementation-artifacts/4-1-email-verification-screen-ui-only-mocked.md (Story 4.1 — route registration, wordmark, Pinned Decision #9/#12)]
- [Source: _bmad-output/implementation-artifacts/deferred-work.md#8 (4.2 code review deferral — keyboard focus off-viewport, closed by this story)]
- [Source: apps/web/src/routes/share/dossier.tsx (current body — rewritten by 4.3)]
- [Source: apps/web/src/router.tsx#49 (existing route registration — unchanged)]
- [Source: apps/web/src/data/questionnaire.ts (`QUESTIONNAIRE` + `QUESTIONNAIRE_FLAT` — unchanged, consumed)]
- [Source: apps/web/src/data/mock-dossier.ts (`MOCK_DOSSIER_DETAIL` — unchanged, consumed)]
- [Source: apps/web/src/components/confluent/DossierField.tsx (reused as-is)]
- [Source: apps/web/src/components/confluent/ConfluentWordmark.tsx (reused as-is)]
- [Source: apps/web/src/components/ui/badge.tsx (shadcn Badge with variant="secondary")]
- [Source: apps/web/src/lib/utils.ts (`cn` utility)]

## Dev Agent Record

### Agent Model Used

claude-opus-4-7 (Opus 4.7, 1M context)

### Debug Log References

- `pnpm --filter @confluent/web typecheck` → exit 0, no output.
- `pnpm --filter @confluent/web lint` → exit 0, 0 errors, 3 warnings (the three tolerated pre-existing — `badge.tsx:52`, `button.tsx:58`, `features/current-user/context.tsx:17`). ZERO new warnings.
- `pnpm turbo run build` → all 3 packages GREEN (`@confluent/api` cached; `@confluent/shared` cached via internal; `@confluent/web` cache miss, built in 519 ms). Web bundle: `624.12 KB / 196.42 KB gz`.
- AC18 grep battery results:
  - `#[0-9a-fA-F]{3,6}` → 0 matches ✔
  - `AppShell|Breadcrumbs|NavItem|useCurrentUser|CurrentUserProvider` → 0 matches ✔
  - `IntersectionObserver` → 1 match ✔
  - `aria-current` → 1 match ✔
  - `scrollIntoView` → 1 match ✔
  - `lg:sticky|lg:top-8|lg:grid|lg:col-span-2|lg:grid-cols-[240px_1fr]` → 6 occurrences (≥ 5) ✔
  - `Biosensio|DeepTech|Pre-seed` → 0 matches ✔ (all three literals live only in `mock-dossier.ts`)
  - `@radix-ui/react` → 0 matches ✔
  - `localStorage|sessionStorage|fetch(|XMLHttpRequest|sendBeacon` → 0 matches ✔
  - `useParams` → 0 matches ✔

### Completion Notes List

- **Implementation follows AC17 canonical snippet verbatim** — no deviations. Both `useEffect` blocks are kept separate (smooth-scroll carry-forward from 4.2 and new scrollspy), matching Pinned Decisions #1 and #10 plus the AC17 note. `cn` is the single new import relative to 4.2.
- **Bundle delta vs 4.2 baseline** (`623.28 KB / 196.06 KB gz`): +0.84 KB raw / +0.36 KB gz — well under the ≤ +1.2 KB gz budget projected in the story's "Latest Technical Specifics" section. Contributors to the delta: `useState` import, IntersectionObserver effect (~20 lines minified), `cn` import, new responsive Tailwind class strings, and the `onFocus` handler. No new npm dependency added.
- **CSS-only responsive strategy preserved** — no `window.matchMedia` check, no `useWindowSize` hook, no conditional render. The JSX tree is identical at every viewport; Tailwind `lg:` prefixes drive the grid/sticky/vertical-nav transformations, and the `lg:text-foreground` gate on the active-state class preserves 4.2's "no active-state highlight" contract at `<lg` while emitting `aria-current="location"` universally.
- **4.2 code-review deferral #2 closed** — the `onFocus={...scrollIntoView({ inline: 'nearest', block: 'nearest' })}` handler on each anchor link resolves the WCAG 2.4.7 focus-off-viewport concern raised in [deferred-work.md:8](deferred-work.md#L8) (Pinned Decision #7). The three other 4.2 deferrals (manual tri-device walkthrough, anchor-click H2 focus move, mobile scroll-indicator) remain deferred per AC scope.
- **Manual browser walkthrough — DEFERRED.** No browser available in this environment (consistent with 4.1 / 4.2 deferral pattern). Verification rests on the AC18 grep battery + typecheck + lint + build. A reviewer with a browser should exercise the 9-step walkthrough in Task 2 before merging.
- **Router / shared components / data modules UNCHANGED.** [apps/web/src/router.tsx](apps/web/src/router.tsx) is untouched; the route entry at line 49 still maps `/share/:token/dossier` → `ShareDossierRoute` as a sibling of the AppShell block (AC1, AC19). `DossierField`, `ConfluentWordmark`, `Badge`, `QUESTIONNAIRE(_FLAT)`, `MOCK_DOSSIER_DETAIL`, `mock-dossiers.ts` — all unchanged.
- **No new files, no folder changes.** Only [apps/web/src/routes/share/dossier.tsx](apps/web/src/routes/share/dossier.tsx) is modified; the 4.2 body is replaced wholesale with the canonical snippet.
- **4.2 Pinned Decisions #2–#10 carry forward verbatim** per this story's Pinned Decision #10 — no renegotiation.

### File List

**Modified:**
- `apps/web/src/routes/share/dossier.tsx` — rewrote the `ShareDossierRoute` body to add: desktop CSS grid (`lg:grid lg:grid-cols-[240px_1fr]`); sticky left nav (`lg:sticky lg:top-8 lg:self-start`) with vertical orientation at ≥ `lg`; wordmark + header spanning both grid columns (`lg:col-span-2`); scrollspy `useEffect` using `IntersectionObserver` + `rootMargin: '-96px 0px -60% 0px'` that drives `activeSectionId` state; conditional `aria-current="location"` + `lg:text-foreground` active styling; `onFocus` `scrollIntoView({ inline: 'nearest', block: 'nearest' })` on each anchor link to close the 4.2 keyboard-focus-off-viewport deferral. New imports: `useState` (react), `cn` (`@/lib/utils`). The smooth-scroll `useEffect` and all other 4.2 mobile classes are preserved verbatim.

**Created:** none.

**Deleted:** none.

### Review Findings

- [x] [Review][Defer] Deep-link `#section-id` on load highlights wrong section until observer fires [apps/web/src/routes/share/dossier.tsx:10] — deferred, out of spec scope (AC7 mandates initial `activeSectionId = QUESTIONNAIRE[0].id`; hash-fragment deep-link handling is not specified in 4.3).
- [x] [Review][Defer] IO initial-callback can race with hash-triggered smooth scroll and settle on the wrong active id [apps/web/src/routes/share/dossier.tsx:23-42] — deferred, same root as above (no hash-fragment contract in 4.3).
- [x] [Review][Defer] `scrollIntoView({inline:'nearest', block:'nearest'})` inherits `<html>`'s `scroll-behavior: smooth` set in the mount effect; not a forced-instant scroll as AC16 prose implies (browser only downgrades to instant under `prefers-reduced-motion`) [apps/web/src/routes/share/dossier.tsx:71] — deferred, cosmetic-only (spec AC13/Pinned Decision #7 prescribed the exact call site; `prefers-reduced-motion` path is still correct).

Three layers ran (Blind Hunter, Edge Case Hunter, Acceptance Auditor); 22 findings raised, 19 dismissed as spec-prescribed or out-of-scope noise, 0 patches, 3 deferrals (all in the same family: deep-link-fragment / smooth-scroll-inheritance). AC18 grep battery re-verified against the committed file; all guardrails green. Router, shared components, and data modules untouched.

## Change Log

| Date       | Change                                                                                                                     | Author     |
|------------|----------------------------------------------------------------------------------------------------------------------------|------------|
| 2026-04-22 | Story drafted by create-story workflow; sprint status flipped backlog → ready-for-dev.                                     | Bob (SM)   |
| 2026-04-22 | Dev-story workflow: rewrote `ShareDossierRoute` for desktop two-column grid + scrollspy; closes 4.2 focus-off-viewport deferral. All ACs satisfied; typecheck/lint/build/grep battery green. Status → review. | Amelia (Dev) |
| 2026-04-22 | Code-review workflow: 3-layer adversarial review (Blind Hunter + Edge Case Hunter + Acceptance Auditor). 0 patches, 3 deferrals appended to `deferred-work.md` (deep-link fragment, IO-init vs hash race, `scrollIntoView` smooth-inheritance). All 20 ACs pass. Status → done. | Murat (Reviewer) |
