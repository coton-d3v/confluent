# Story 3.3: MetricCard Grid & Analytics Timeline (D4)

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an entrepreneur reviewing a dossier's performance,
I want to see key metrics and a detailed per-recipient timeline,
so that I understand how investors are engaging with my dossier.

## Acceptance Criteria

1. **Given** the user is on `/dashboard/dossiers/view/biosensio?tab=analytics` (or has clicked the `Accès & analytics` tab from the default URL), **When** the analytics panel renders, **Then** a 3-column `MetricCard` grid appears at the top of the panel showing, left → right, in this exact order:
   - Card 1 — label `"Destinataires actifs"`, value `"2"`, no sub-label.
   - Card 2 — label `"Vues totales"`, value `"7"`, no sub-label.
   - Card 3 — label `"Durée moy. de session"`, value `"4m 32s"`, no sub-label.
   All three cards come from the `MOCK_ANALYTICS` fixture (Task 2) — no inline literals in the route JSX for the values themselves. The fixture is the single source of truth so Story 3.6's "decrement `Destinataires actifs` on revoke" has one place to read/derive from.

2. **Given** the `MetricCard` component (`apps/web/src/components/confluent/MetricCard.tsx`), **When** a developer inspects the rendered DOM, **Then** each card is a single `<article>` element with:
   - Outer container: `rounded-lg border border-border bg-card p-4` (6 px radius via `--radius` token ≈ `rounded-lg`; `p-4` = 16 px per the Epic AC / UX spec). No box-shadow, no hover transitions — the card is read-only, non-interactive.
   - Label (top): `<p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">` (11 px / 500 weight / small-caps effect via `uppercase` + `tracking-wider` — matches the existing `DossierField` label recipe at [apps/web/src/components/confluent/DossierField.tsx:13](apps/web/src/components/confluent/DossierField.tsx#L13) for consistency).
   - Value (middle): `<p className="mt-2 text-2xl font-bold text-foreground tabular-nums">` (24 px / 700 weight / `tabular-nums` for column alignment of digits across the three cards — a "7" should sit below a "12" cleanly on dense grids).
   - Optional sub-label (bottom): `<p className="mt-1 text-[11px] text-muted-foreground">` — only rendered when the `subLabel` prop is non-empty. When omitted, the `mt-1` paragraph does NOT render (no empty ghost whitespace).

3. **Given** the 3-column `MetricCard` grid, **When** viewed on desktop / tablet (≥ 768 px), **Then** it renders as a CSS grid `grid grid-cols-3 gap-4` so each card gets an equal 1fr column with 16 px between-card gap. **When** viewed on mobile (< 768 px), **Then** the grid collapses to a single column (`grid-cols-1 md:grid-cols-3`) with each card full-width and 16 px vertical gap between cards.

4. **Given** the analytics panel below the `MetricCard` grid, **When** the panel renders, **Then** a section block appears with:
   - A `<h2>` heading `"Accès & partage"` — `font-heading text-xl font-semibold text-foreground md:text-2xl` (matches the H2 recipe used for section headings in the Contenu panel at [apps/web/src/routes/dashboard/dossiers/\[slug\].tsx:155](apps/web/src/routes/dashboard/dossiers/[slug].tsx#L155) — this keeps dossier-page H2 hierarchy consistent across tabs).
   - A card container `<div className="mt-4 overflow-hidden rounded-lg border border-border bg-card">` wrapping the access list. No padding on the container itself — each row provides its own inner padding (`px-4 py-3` recipe per Task 3d) so the divider lines between rows stretch full-width.

5. **Given** the card container from AC4, **When** the list renders, **Then** it contains exactly three mocked access entries rendered in this order (oldest → newest by `invitedAt` descending — most-recent activity at top):
   - **Row 1 (active):** email `arc@capital.fr`, initials `AC`, last-seen `"Dernière session : il y a 2 jours · 3 vues"`, session duration `"6m 14s"`, `StatusDot` label `"Actif"` (green `#4CAF7D`), `Révoquer` ghost button visible.
   - **Row 2 (pending):** email `martin@fund.io`, initials `MF`, last-seen `"Invitation envoyée il y a 3 h"`, session duration displays `"—"` (em-dash), `StatusDot` label `"En attente"` (orange `#F0A830`), `Révoquer` ghost button visible.
   - **Row 3 (revoked):** email `lea@invest.com`, initials `LI`, last-seen `"Dernière session : il y a 5 jours · 2 vues"`, session duration `"3m 41s"`, `StatusDot` label `"Révoqué"` (neutral `#B0B0B0`), NO `Révoquer` button — replaced by `"Révoqué le 16 avr. 2026"` text. The whole row renders at 55 % opacity (`opacity-55`).
   All three entries come from the `MOCK_ANALYTICS.accessEntries` fixture array (Task 2) — the route reads, the fixture provides. No inline literals for email / duration / status / invitedAt in the route JSX.

6. **Given** the Story 3.4 contract ("AccessListRow & StatusDot Components"), **When** Story 3.3 renders the three rows from AC5, **Then** it uses INLINE placeholder row markup inside `TabsContent` (NOT a new `AccessListRow` component, NOT a new `StatusDot` component). Story 3.4 owns the extraction — 3.3 ships only the visual shape and fixture seed. The placeholder row JSX is a single `<div className="flex items-center gap-3 px-4 py-3">` with a `<div data-slot="access-list-row-divider" className="border-t border-border" />` between consecutive rows (not on the last row). Rationale: extracting `AccessListRow` here pre-commits to a prop shape (`status`, `revokedAt`, `invitedAt`, `initials`, `duration`, `onRevokeClick`, …) that 3.4 MAY refine after it walks the three-state matrix; and extracting `StatusDot` here pre-commits to the colour API (discrete `status` union vs. a `color` prop) that 3.4 must re-decide with the full a11y-label set. See Pinned Decision #3.

7. **Given** the analytics panel header, **When** a developer inspects the page chrome, **Then** the breadcrumb above the H1 STILL reads `Dossiers / Biosensio` — two segments only, unchanged from Story 3.2 — even though `?tab=analytics` is in the URL. The tab state is surfaced via the tablist, NOT via a third breadcrumb segment. Do NOT add `Accès & analytics` as a third crumb; the Epic AC is explicit about this (see line 691 of `_bmad-output/planning-artifacts/epics.md`).

8. **Given** the analytics panel on mobile (< 768 px) at the 320 px minimum breakpoint, **When** viewed, **Then**:
   - `MetricCard` grid collapses to 1 column — each card full-width, 16 px vertical gap.
   - The 3 access list rows remain single-column with the same row recipe; the duration column pushes below the email on narrow widths via `flex-col sm:flex-row sm:items-center sm:justify-between`.
   - No horizontal scrollbar at 320 px.
   - The `Révoquer` button tap target stays ≥ 44 × 44 px (existing `Button` `size="sm"` is 36 px — UPGRADE to `size="default"` which gives `h-9` = 36 px + the row `py-3` padding = 48 px outer tap target, clearing WCAG 2.5.5 AAA). Prefer `size="sm"` only if it visibly clutters the row on desktop; in that case, set `className="min-h-11"` explicitly to preserve the tap target.

9. **Given** the analytics panel, **When** a keyboard / screen-reader user navigates, **Then**:
   - The `MetricCard` grid is NOT tab-focusable (no interactive elements inside — read-only display).
   - Each `MetricCard` is a `<article>` landmark with `aria-label` set to `"{label} : {value}"` (e.g., `aria-label="Destinataires actifs : 2"`) so screen readers announce "Article, Destinataires actifs : 2" rather than three unlabelled regions.
   - The `<h2>Accès & partage</h2>` heading is in the H1 → H2 heading outline; VoiceOver rotor / NVDA heading navigation lists it after the dossier's H1.
   - Each access list row's revoke button (when present) has `aria-label` set to `"Révoquer l'accès de {email}"` — the generic text `Révoquer` is visible but screen readers get the full per-row context.
   - The `StatusDot` visual (coloured circle) carries `aria-hidden="true"` because the adjacent text label (e.g., `"Actif"`) already conveys the state — redundant announcement would be noisy.
   - Colour is never the sole signal: active/pending/revoked each have a distinct text label (`Actif` / `En attente` / `Révoqué`) and the revoked row additionally has reduced opacity — three orthogonal signals.

10. **Given** the analytics panel empty-state path, **When** `MOCK_ANALYTICS.accessEntries` is empty (e.g., a future story seeds a 0-row case, OR a developer locally blanks the fixture for testing), **Then** the card container from AC4 renders a single centred line of `<p className="px-4 py-6 text-center text-sm text-muted-foreground">Aucun destinataire pour le moment.</p>` — the `MetricCard` grid still renders above (with zeroed values in a future story, but constant `2 / 7 / 4m 32s` in 3.3's fixture). This empty state is NOT exercised by Story 3.3's fixture (it ships 3 rows), but the conditional is present so Story 3.6's revocation flow does not need a structural change when the list could logically drop to 0 entries.

11. **Given** the `TAB_VALUES` union constant, **When** a developer opens [apps/web/src/routes/dashboard/dossiers/\[slug\].tsx](apps/web/src/routes/dashboard/dossiers/[slug].tsx), **Then** the magic string `'analytics'` duplicated across ≥ 4 sites (flagged as deferred in Story 3.2's review — see `_bmad-output/implementation-artifacts/deferred-work.md` § "Deferred from: code review of 3-2-dossier-page-header-tab-navigation") is extracted to a single `const TAB_VALUES = { content: 'content', analytics: 'analytics' } as const` / `type TabValue = (typeof TAB_VALUES)[keyof typeof TAB_VALUES]` pair at the top of the file. All four call sites (activeTab derivation, `handleTabChange`'s `'analytics'` branch, `TabsTrigger value={…}` props × 2, and the `TabsContent value={…}` props × 2) reference `TAB_VALUES.content` / `TAB_VALUES.analytics` — the string `'analytics'` appears EXACTLY ONCE in the file, inside the `TAB_VALUES` object literal. See Pinned Decision #6.

12. **Given** the analytics panel, **When** a developer runs the Task 4 verification sweep, **Then**:
    - `grep -nE '#[0-9a-fA-F]{3,6}'` across the new `MetricCard.tsx`, the new `mock-analytics.ts`, AND the rewritten `[slug].tsx` `<TabsContent value="analytics">` block returns ZERO matches. All colour surfaces resolve via design tokens (`bg-card`, `border-border`, `text-foreground`, `text-muted-foreground`, `var(--status-active)`, `var(--status-pending)`, `var(--status-neutral)` — the last three already declared at [apps/web/src/index.css:87-89](apps/web/src/index.css#L87-L89)).
    - `grep -n "'analytics'" apps/web/src/routes/dashboard/dossiers/\[slug\].tsx` returns EXACTLY ONE match — the `TAB_VALUES` literal.
    - `pnpm turbo run typecheck` / `lint` / `build` are all green with zero new warnings beyond the 3 tolerated pre-existing ones (`badge.tsx:52`, `button.tsx:58`, `features/current-user/context.tsx:17`).

13. **Given** the Contenu tab is active (unchanged from 3.2), **When** the user navigates to `/dashboard/dossiers/view/biosensio`, **Then** the content panel renders EXACTLY as in 3.2 — 3.3 makes NO changes to the `<TabsContent value="content">` block beyond the `TAB_VALUES.content` literal substitution from AC11. No new `DossierField`, no new section, no layout shift, no visual regression.

## Tasks / Subtasks

- [x] **Task 1: Create the `MetricCard` display primitive (AC: 1, 2, 3, 9)**
  - [x] Create `apps/web/src/components/confluent/MetricCard.tsx`. Named export only (`MetricCard`). No default export. Mirrors the sibling pattern of [apps/web/src/components/confluent/DossierField.tsx](apps/web/src/components/confluent/DossierField.tsx) (design-system display primitive — lives in `components/confluent/`, not `components/ui/`).
  - [x] Imports:
    ```ts
    import { cn } from '@/lib/utils'
    ```
    No `React` default / namespace import needed — the component uses no hooks and no `React.*` types. This matches the `DossierField` / `DossierCard` convention of pure `function MetricCard(...)` declarations with JSX.
  - [x] Prop contract (exhaustive — no hidden props):
    ```ts
    export interface MetricCardProps {
      label: string
      value: string
      subLabel?: string
      className?: string
    }
    ```
    `value` is a pre-formatted string (e.g., `"2"`, `"7"`, `"4m 32s"`) — the component does NOT accept a `number` and does NOT know about `Intl.NumberFormat`, duration formatting, or locales. Formatting is the caller's responsibility (Story 3.3 formats in the fixture; Story 8.3 / FR23 will format from the API response). This keeps `MetricCard` pure-presentational.
  - [x] Render implementation:
    ```tsx
    export function MetricCard({ label, value, subLabel, className }: MetricCardProps) {
      return (
        <article
          aria-label={`${label} : ${value}`}
          className={cn(
            'rounded-lg border border-border bg-card p-4',
            className,
          )}
        >
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            {label}
          </p>
          <p className="mt-2 text-2xl font-bold text-foreground tabular-nums">
            {value}
          </p>
          {subLabel ? (
            <p className="mt-1 text-[11px] text-muted-foreground">{subLabel}</p>
          ) : null}
        </article>
      )
    }
    ```
    Design rationale:
    - `<article>` — the UX spec designates `MetricCard` as a self-contained KPI unit; `<article>` is the WAI-ARIA-compliant semantic for a standalone, topically-complete region. `<section>` would also work but would require an accessible name via `aria-labelledby` pointing to the label `<p>` — `aria-label` on `<article>` is terser and reads the same to assistive tech.
    - `aria-label` combines label + value so the screen reader announces "Article, Destinataires actifs : 2" — a single semantic unit rather than 3 unlabelled regions when the rotor jumps by landmarks. See AC9.
    - `tabular-nums` (Tailwind v4 built-in) enables `font-variant-numeric: tabular-nums` so digit widths are uniform across the 3 cards — "12" below "7" below "123" all line up visually on a future story that expands the dataset.
    - `p-4` = 16 px (Tailwind default 4 px × 4) — matches the Epic AC's literal 16 px. Do NOT use `p-4 md:p-6` or any responsive padding escalation — the card stays at 16 px at every viewport.
  - [x] Do NOT add a hover state, a box-shadow, a focus ring, or a transition. The card is read-only and never focused — styling it as interactive (hover lift, shadow on hover) would mislead users into expecting a click. See Pinned Decision #2.
  - [x] Do NOT use the shadcn `Card` / `CardHeader` / `CardTitle` / `CardContent` primitives from [apps/web/src/components/ui/card.tsx](apps/web/src/components/ui/card.tsx). Those bake `gap-4 py-4 overflow-hidden` defaults onto the outer `<div>` and a `rounded-t-lg px-4` chrome onto `CardHeader` — fine for content cards, but the `MetricCard` is a single-block KPI surface where the internal rhythm (label → value → optional sub-label) is tighter than the shadcn `Card` template. A raw `<article>` with token utilities is lower-friction and avoids wrestling the shadcn layout defaults. See Pinned Decision #1.

- [x] **Task 2: Create the `mock-analytics` fixture (AC: 1, 5, 10)**
  - [x] Create `apps/web/src/data/mock-analytics.ts`. Named exports only (`MOCK_ANALYTICS`, `AccessEntry`, `AnalyticsMetric` types). No default export. Mirrors the sibling pattern of [apps/web/src/data/mock-dossiers.ts](apps/web/src/data/mock-dossiers.ts).
  - [x] Type shape:
    ```ts
    export type AccessStatus = 'active' | 'pending' | 'revoked'

    export interface AccessEntry {
      readonly email: string
      readonly initials: string             // 2-letter, uppercase, derived by the fixture author
      readonly status: AccessStatus
      readonly lastSeen: string             // pre-formatted French copy (Story 3.3)
      readonly sessionDuration: string      // pre-formatted (e.g., "6m 14s"); "—" for pending
      readonly revokedAt?: string           // pre-formatted French copy (e.g., "16 avr. 2026"); only set when status === 'revoked'
    }

    export interface AnalyticsMetric {
      readonly label: string
      readonly value: string
    }

    export interface Analytics {
      readonly metrics: readonly [AnalyticsMetric, AnalyticsMetric, AnalyticsMetric]
      readonly accessEntries: readonly AccessEntry[]
    }
    ```
    The tuple `readonly [AnalyticsMetric, AnalyticsMetric, AnalyticsMetric]` encodes the 3-column AC at the type level — a consumer that tries to map to more or fewer than 3 cards gets a compile error. A plain `readonly AnalyticsMetric[]` would be too permissive.
  - [x] Fixture value (Biosensio-specific — Story 3.3 renders the SAME fixture regardless of `:slug`, because per-dossier analytics fan-out is Story 8.3's concern, NOT 3.3's):
    ```ts
    export const MOCK_ANALYTICS: Analytics = {
      metrics: [
        { label: 'Destinataires actifs', value: '2' },
        { label: 'Vues totales', value: '7' },
        { label: 'Durée moy. de session', value: '4m 32s' },
      ],
      accessEntries: [
        {
          email: 'arc@capital.fr',
          initials: 'AC',
          status: 'active',
          lastSeen: 'Dernière session : il y a 2 jours · 3 vues',
          sessionDuration: '6m 14s',
        },
        {
          email: 'martin@fund.io',
          initials: 'MF',
          status: 'pending',
          lastSeen: 'Invitation envoyée il y a 3 h',
          sessionDuration: '—',
        },
        {
          email: 'lea@invest.com',
          initials: 'LI',
          status: 'revoked',
          lastSeen: 'Dernière session : il y a 5 jours · 2 vues',
          sessionDuration: '3m 41s',
          revokedAt: '16 avr. 2026',
        },
      ],
    } as const
    ```
    Every user-visible string is pre-formatted (French, lowercase month abbreviation, non-breaking space is OUT of scope — the plain space is fine here). Do NOT compute relative dates with `formatRelativeDate` from [apps/web/src/lib/relative-date.ts](apps/web/src/lib/relative-date.ts) — that helper reads the current wall-clock, which would make the mock copy drift day-over-day and make manual-test expectations flaky. Hardcoded French copy is the right trade-off for a mocked story.
  - [x] Export the raw fixture, not a function. Do NOT wrap in `getMockAnalytics()` or `buildAnalytics(slug)`. Future Story 8.3 will replace this import with a TanStack Query hook (`useDossierAnalyticsQuery(slug)`) — the import surface changes shape then, and a wrapping function now would be a false step.
  - [x] NO runtime validation (`zod` / `assert`) on the shape. `as const` + the types are sufficient — this is a static, developer-authored fixture, not untrusted input.

- [x] **Task 3: Swap the analytics placeholder in `routes/dashboard/dossiers/[slug].tsx` for the full D4 layout (AC: 1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13)**
  - [x] Edit `apps/web/src/routes/dashboard/dossiers/[slug].tsx`. Keep ALL of the Story 3.2 header + `Contenu` panel rendering intact (AC13) — the ONLY structural change is inside `<TabsContent value="analytics">`, plus the `TAB_VALUES` extraction (AC11, Subtask 3b).
  - [x] Add three NEW imports at the top:
    ```tsx
    import { Button } from '@/components/ui/button'  // ALREADY IMPORTED in 3.2 — no change
    import { MetricCard } from '@/components/confluent/MetricCard'
    import { MOCK_ANALYTICS } from '@/data/mock-analytics'
    ```
    The `Button` import is already present from 3.2's Partager button — do NOT duplicate. Verify with `grep -n "from '@/components/ui/button'" apps/web/src/routes/dashboard/dossiers/\[slug\].tsx` before saving.
  - [x] **3a. Declare `TAB_VALUES` at module scope (AC11).** Above the `PersistedDraft` interface (i.e., the first declaration in the module after imports):
    ```ts
    const TAB_VALUES = {
      content: 'content',
      analytics: 'analytics',
    } as const

    type TabValue = (typeof TAB_VALUES)[keyof typeof TAB_VALUES]
    ```
    Export NEITHER — they are single-module constants, not cross-module API. If a future story needs them elsewhere, extract at the call site then.
  - [x] **3b. Substitute `TAB_VALUES.*` at every call site.** The four sites (via Story 3.2's line numbers — run `grep -n "'analytics'\|'content'"` to double-check after the substitution):
    - `activeTab` derivation: `const activeTab: TabValue = searchParams.get('tab') === TAB_VALUES.analytics ? TAB_VALUES.analytics : TAB_VALUES.content`.
    - `handleTabChange` branch: `if (value === TAB_VALUES.analytics) { prev.set('tab', TAB_VALUES.analytics) } else { prev.delete('tab') }`.
    - `<TabsTrigger value={TAB_VALUES.content}>Contenu</TabsTrigger>` and `<TabsTrigger value={TAB_VALUES.analytics}>Accès &amp; analytics</TabsTrigger>`.
    - `<TabsContent value={TAB_VALUES.content}>…</TabsContent>` and `<TabsContent value={TAB_VALUES.analytics}>…</TabsContent>`.
    The literal `'analytics'` string appears EXACTLY once in the file after this task — inside the `TAB_VALUES` declaration. `'content'` likewise appears exactly once. Verify with the grep spec in AC12.
  - [x] **3c. Replace the `<TabsContent value={TAB_VALUES.analytics}>` body.** Remove the 3.2 placeholder block:
    ```tsx
    <div className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
      <p>L&apos;analytique de ce dossier s&apos;affichera ici.</p>
    </div>
    ```
    Replace with:
    ```tsx
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      {MOCK_ANALYTICS.metrics.map((metric) => (
        <MetricCard key={metric.label} label={metric.label} value={metric.value} />
      ))}
    </div>

    <section className="mt-8">
      <h2 className="font-heading text-xl font-semibold text-foreground md:text-2xl">
        Accès &amp; partage
      </h2>
      <div className="mt-4 overflow-hidden rounded-lg border border-border bg-card">
        {MOCK_ANALYTICS.accessEntries.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">
            Aucun destinataire pour le moment.
          </p>
        ) : (
          MOCK_ANALYTICS.accessEntries.map((entry, index) => (
            <div
              key={entry.email}
              className={cn(
                'flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between',
                entry.status === 'revoked' && 'opacity-[0.55]',
                index > 0 && 'border-t border-border',
              )}
            >
              <div className="flex items-center gap-3">
                <span
                  aria-hidden="true"
                  className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground"
                >
                  {entry.initials}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">
                    {entry.email}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {entry.lastSeen}
                  </p>
                </div>
              </div>
              <div className="flex items-center justify-between gap-4 sm:justify-end">
                <span className="text-[22px] font-bold text-foreground tabular-nums">
                  {entry.sessionDuration}
                </span>
                <span
                  aria-label={
                    entry.status === 'active'
                      ? 'Statut : Actif'
                      : entry.status === 'pending'
                        ? 'Statut : En attente'
                        : 'Statut : Révoqué'
                  }
                  className="inline-flex items-center gap-1.5 text-sm text-muted-foreground"
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      'inline-block size-[7px] rounded-full',
                      entry.status === 'active' && 'bg-[var(--status-active)]',
                      entry.status === 'pending' && 'bg-[var(--status-pending)]',
                      entry.status === 'revoked' && 'bg-[var(--status-neutral)]',
                    )}
                  />
                  {entry.status === 'active'
                    ? 'Actif'
                    : entry.status === 'pending'
                      ? 'En attente'
                      : 'Révoqué'}
                </span>
                {entry.status === 'revoked' ? (
                  <span className="text-xs text-muted-foreground">
                    Révoqué le {entry.revokedAt}
                  </span>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-label={`Révoquer l'accès de ${entry.email}`}
                    className="min-h-11"
                  >
                    Révoquer
                  </Button>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </section>
    ```
    Add `import { cn } from '@/lib/utils'` at the top if not already present (run `grep -n "from '@/lib/utils'"` to verify — as of 3.2 the route does NOT yet import `cn`). If missing, add it alongside the other imports.
  - [x] **3d. Row styling guarantees:**
    - `flex-col gap-3` on mobile (<640 px `sm`) stacks email+initials on top, duration+status+button below → matches AC8's "duration column pushes below the email on narrow widths".
    - `sm:flex-row sm:items-center sm:justify-between` at ≥ 640 px restores the horizontal layout.
    - `border-t border-border` on rows with `index > 0` produces inter-row dividers without an outer `<hr>` per pair — the `overflow-hidden` on the container clips the first/last radius cleanly.
    - `opacity-[0.55]` on revoked rows matches Epic AC / UX spec literally (the UX spec says "55%"). Arbitrary-value form is used to avoid any ambiguity with the Tailwind v4 default opacity scale (which may or may not include the exact `55` step depending on config). Do NOT substitute `opacity-50` or `opacity-60` — the 55 % literal is deliberate per the UX spec.
    - The initials circle uses `bg-muted` + `text-muted-foreground` — the UX spec's AccessListRow anatomy calls for `"32px avatar circle with recipient initials (font-weight 600)"`. `size-8` = 32 px, `font-semibold` covers 600. Story 3.4 may swap this for the shadcn `Avatar` + `AvatarFallback` recipe (see [apps/web/src/components/ui/avatar.tsx:39-52](apps/web/src/components/ui/avatar.tsx#L39-L52)) — 3.3 keeps it as a raw `<span>` to avoid over-committing before the `AccessListRow` component is extracted.
    - The `var(--status-active)` / `var(--status-pending)` / `var(--status-neutral)` tokens are ALREADY declared in [apps/web/src/index.css:87-89](apps/web/src/index.css#L87-L89) — confirm they're reachable from Tailwind arbitrary-value syntax via `bg-[var(--status-active)]`. No new CSS variables need to be added.
  - [x] **3e. Do NOT extract an `AnalyticsPanel` component.** The block is ~60 lines of JSX plus the empty-state branch. It's a single-caller situation (only `[slug].tsx` renders the analytics tab) and Story 3.4 / 3.6 will edit it in-place. Extraction now pre-commits to a prop shape (`entries`, `metrics`, `onRevoke`, …) that 3.4's `AccessListRow` + 3.6's revocation-state lift MAY contradict. Keep inline. See Pinned Decision #4.

- [x] **Task 4: Verify + guardrails (AC: 1–13)**
  - [x] `pnpm turbo run typecheck` → 2 successful, 0 errors. Confirm `MetricCardProps` is exported and the fixture's tuple type `readonly [AnalyticsMetric, AnalyticsMetric, AnalyticsMetric]` is preserved through the `.map()` callback (TS widens tuple to `readonly AnalyticsMetric[]` inside `.map()` — that's fine; the compile-time guard fires at the declaration site).
  - [x] `pnpm turbo run lint` → 0 errors. Preserve the 3 tolerated pre-existing warnings (`badge.tsx:52`, `button.tsx:58`, `features/current-user/context.tsx:17`). The new `MetricCard.tsx` and `mock-analytics.ts` files must NOT introduce new warnings — specifically, `mock-analytics.ts` as a `.ts` file with ONLY typed exports has no `react-refresh/only-export-components` surface; `MetricCard.tsx` exports ONLY a component + a prop interface, matching the existing `DossierField.tsx` / `DossierCard.tsx` shape that currently lints clean.
  - [x] `pnpm turbo run build` → 2 successful, 0 errors. Expected bundle delta vs 3.2 baseline:
    - CSS: +~0.15 kB gzip (new Tailwind utilities: `grid-cols-3`, `md:grid-cols-3`, `opacity-55`, `tabular-nums`, `size-[7px]`, `size-8`, `bg-[var(--status-*)]` × 3, `min-w-0`).
    - JS: +~0.3 kB gzip (two new tiny modules — `MetricCard` is ~30 LOC, `mock-analytics` is pure data).
  - [x] Self-review grep: `grep -nE '#[0-9a-fA-F]{3,6}' apps/web/src/components/confluent/MetricCard.tsx apps/web/src/data/mock-analytics.ts apps/web/src/routes/dashboard/dossiers/\[slug\].tsx` → ZERO matches (AC12).
  - [x] Self-review grep: `grep -n "'analytics'" apps/web/src/routes/dashboard/dossiers/\[slug\].tsx` → EXACTLY ONE match — inside the `TAB_VALUES` literal (AC11, AC12).
  - [x] Self-review grep: `grep -n "'content'" apps/web/src/routes/dashboard/dossiers/\[slug\].tsx` → EXACTLY ONE match — inside the `TAB_VALUES` literal.
  - [x] `pnpm turbo run dev` manual walkthrough (tri-viewport: 375 / 900 / 1440 px):
    1. Navigate to `/dashboard/dossiers/view/biosensio`. Verify: Contenu tab active, the empty-content fallback copy from 3.2 still renders (`Ce dossier n'a pas encore de contenu renseigné.`) — AC13 regression guard.
    2. Click `Accès & analytics` tab. URL becomes `/dashboard/dossiers/view/biosensio?tab=analytics`. Verify the analytics panel now shows: (a) 3-column MetricCard grid at top with values `2 / 7 / 4m 32s`; (b) `Accès & partage` H2 below; (c) card container with 3 rows (arc@capital.fr active, martin@fund.io pending, lea@invest.com revoked at 55 % opacity); (d) each row shows email + initials circle + last-seen + duration + StatusDot + Révoquer (or `Révoqué le 16 avr. 2026` for row 3).
    3. Click the `Révoquer` button on row 1. Verify: no crash, nothing visible happens (the button is a no-op in 3.3 — Story 3.6 wires the revocation flow via AlertDialog + state lift). Accept this as correct — console.log a warning is NOT desired.
    4. Navigate back to `Contenu` tab. URL drops `?tab`. Verify: no regression from 3.2 — content panel renders the empty-content fallback, tab active pill moves.
    5. Direct-navigate to `/dashboard/dossiers/view/biosensio?tab=analytics` (paste URL). Verify: analytics panel renders on mount WITHOUT Contenu flashing first. H1 still receives focus on mount (3.2 behaviour preserved). NOTE: the H1 focus scroll-jump known issue (deferred from 3.2) is still present — not a 3.3 regression.
    6. Direct-navigate to `/dashboard/dossiers/view/agrotrack?tab=analytics`. Verify: same MetricCard values (3.3 fixture is not per-dossier — accept as correct per the 3.3 fixture contract in Task 2; per-dossier analytics lands in Story 8.3).
    7. Keyboard-only on `?tab=analytics`:
       - Tab order: breadcrumb link → Partager → Contenu tab → Accès & analytics tab (active) → first Révoquer button (row 1) → second Révoquer button (row 2). Row 3 has NO Révoquer button — focus skips straight past to the page footer / document-end.
       - No focus ring on the MetricCard grid (not focusable — AC9).
       - Screen-reader rotor lists `h1` "Biosensio" → `h2` "Accès & partage" — no other headings injected.
       - Each MetricCard is announced as an article landmark with label `Destinataires actifs : 2` / etc. (VoiceOver + NVDA).
    8. Mobile (375 px): MetricCard grid collapses to 1 column. Each row stacks email+initials on top, duration+status+button below. No horizontal scrollbar at 320 px. Révoquer tap target ≥ 44 × 44 px (measure via browser devtools element inspector).
    9. Axe audit on Contenu tab AND Analytics tab. Expect: 0 serious, 0 critical. No "image missing alt" (no images), no "button missing name" (the Révoquer button has both visible text AND `aria-label`), no "color-contrast" violation (all text uses `text-foreground` or `text-muted-foreground` on `bg-card` / `bg-background`, both ≥ 4.5:1).
    10. `prefers-reduced-motion: reduce` toggle: no new transforms / animations are introduced in 3.3 — the Tabs primitive's `transition-colors` is already motion-safe. Nothing new to vet.
    11. Revoked row specific check: the `opacity-55` wrapper DOES apply to the `Révoqué` text label (not just the row chrome) — verify the copy `Révoqué le 16 avr. 2026` is at 55 % opacity per the UX spec (the entire row is dimmed, not just the initials circle).
    12. Long-email probe: temporarily set `MOCK_ANALYTICS.accessEntries[0].email = 'premier-long-nom.destinataire@un-fonds-dinvestissement-avec-un-nom-tres-long.invest'`. At 375 px, verify the email truncates with an ellipsis (`truncate` Tailwind utility) and the duration + StatusDot + button stay visible. Restore the fixture.
    13. Empty-analytics probe (AC10): temporarily set `accessEntries: []`. Verify the `Aucun destinataire pour le moment.` copy renders centred in the card container. The MetricCard grid above still renders (AC10 scope). Restore the fixture.
  - [x] No regression on Stories 1.1 – 3.2:
    - `/dashboard` list still renders 2 mock cards and the "Créer un dossier" button (3.1).
    - `/dashboard/dossiers/nouveau` → naming wizard → questionnaire → recapitulatif → dossier view all reachable (2.3 / 2.4 / 2.5 / 2.6).
    - The wizard-created slug path (`/dashboard/dossiers/view/mon-test` after completing the wizard): Contenu tab shows the section list (2.6 unchanged); Analytics tab shows the SAME `MOCK_ANALYTICS` fixture (per the 3.3 fixture contract — 1 fixture shared across slugs).
    - Shell breadcrumb auto-suppression on this route stays intact via the pre-existing `handle.hideBreadcrumb` — Task 3 does NOT touch `router.tsx`. Verify with `git diff apps/web/src/router.tsx` → empty.
    - H1 focus-on-mount stays `[slug]`-keyed — Task 3 does NOT touch the `useEffect`. Verify `grep -n 'useEffect' apps/web/src/routes/dashboard/dossiers/\[slug\].tsx` returns the exact same line(s) as before (count + location).

- [x] **Task 5: Self-review sweep before marking story done**
  - [x] All 13 ACs trace to code (AC → Task / component mapping documented in each AC block and each Task header).
  - [x] Zero raw hex values in new + modified files: `grep -nE '#[0-9a-fA-F]{3,6}' apps/web/src/components/confluent/MetricCard.tsx apps/web/src/data/mock-analytics.ts apps/web/src/routes/dashboard/dossiers/\[slug\].tsx` → zero matches (AC12).
  - [x] `TAB_VALUES` is the single source of the `'analytics'` / `'content'` literals (AC11, AC12) — verified via the grep spec in Task 4.
  - [x] `MetricCard` has ZERO hover/focus/transition styling — AC2 + Pinned Decision #2.
  - [x] The `MOCK_ANALYTICS` fixture uses `readonly` + `as const` throughout — prevents accidental mutation in downstream stories.
  - [x] Analytics panel's Révoquer button has NO `onClick` and NO `disabled` — Pinned Decision #5 / Story 3.6 boundary.
  - [x] `opacity-[0.55]` on revoked rows matches the UX spec's "55 %" literal — NOT `opacity-50` (50 %) or `opacity-60` (60 %). Arbitrary-value form guarantees the exact 55 % without relying on the Tailwind v4 default opacity scale step list.
  - [x] The initials `<span>` uses `aria-hidden="true"` — redundant with the adjacent email, per AC9.
  - [x] The `StatusDot` visual (`size-[7px]` coloured circle) has `aria-hidden="true"` — redundant with the adjacent status text.
  - [x] Each Révoquer button has a per-row `aria-label` (`Révoquer l'accès de {email}`) — AC9.
  - [x] Each MetricCard has `aria-label={`${label} : ${value}`}` — AC9.
  - [x] The row wrapper's `opacity-55` correctly cascades onto the `Révoqué le {date}` text (CSS opacity on ancestor → descendant) — verified in Task 4 sub-step 11.
  - [x] Commit strategy: single `feat(epic-3): story 3.3 — MetricCard grid & analytics timeline (D4)` commit that bundles implementation AND any self-applied review patches (per user memory preference: "Code + review in a single commit", established from Story 2.4 onward). See Pinned Decision #7.

### Review Findings

Code review run on 2026-04-21. 3 adversarial layers: Blind Hunter (diff-only), Edge Case Hunter (branch/boundary sweep), Acceptance Auditor (spec conformance). 5 patch, 9 defer, 24 dismissed (spec-mandated, intentional mock, or type-system-protected).

- [x] [Review][Patch] `handleTabChange(value: unknown)` defeats the new `TabValue` type [apps/web/src/routes/dashboard/dossiers/[slug].tsx:93] — narrow with `typeof value !== 'string'` guard (or use Base UI's typed callback signature) before the `=== TAB_VALUES.analytics` comparison.
- [x] [Review][Patch] `AccessEntry` should be a discriminated union so `status: 'revoked'` implies `revokedAt: string` [apps/web/src/data/mock-analytics.ts:7-13, apps/web/src/routes/dashboard/dossiers/[slug].tsx:269] — current optional `revokedAt?` allows "Révoqué le undefined" to render for a revoked entry missing the field. Replace with `{ status: 'active' | 'pending' } | { status: 'revoked'; revokedAt: string }`.
- [x] [Review][Patch] Access list container should carry list semantics [apps/web/src/routes/dashboard/dossiers/[slug].tsx:207-277] — swap the outer `<div>` + sibling row `<div>`s for `<ul role="list">` / `<li>` (or apply `role="list"` / `role="listitem"` to the existing divs). Screen-reader users currently get a flat stack of paragraphs with no "3 items" announcement.
- [x] [Review][Patch] `lastSeen` `<p>` lacks `truncate` while sibling email `<p>` has it [apps/web/src/routes/dashboard/dossiers/[slug].tsx:233-235] — on narrow widths the French string "Dernière session : il y a 2 jours · 3 vues" wraps and pushes row height, causing vertical misalignment against a single-line right column. Add `truncate`.
- [x] [Review][Patch] Truncated email has no `title` tooltip for sighted keyboard users [apps/web/src/routes/dashboard/dossiers/[slug].tsx:230-232] — add `title={entry.email}` so the full address is recoverable on hover when truncation hides characters.
- [x] [Review][Defer] Révoquer button has no `onClick`, silent no-op [apps/web/src/routes/dashboard/dossiers/[slug].tsx:275-283] — deferred, Story 3.6 (access-revocation-optimistic-mocked) owns the handler wiring per epic plan.
- [x] [Review][Defer] React keys `entry.email` / `metric.label` can collide on duplicate values [apps/web/src/routes/dashboard/dossiers/[slug].tsx:196, 215] — deferred, stable IDs belong to the real data model in Story 8.3 (GET /v1/dossiers/:id/analytics).
- [x] [Review][Defer] Status tuple rendering (aria-label + dot color + label text) duplicated three times across inline ternaries [apps/web/src/routes/dashboard/dossiers/[slug].tsx:232-268] — deferred, StatusDot extraction is Story 3.4's scope per AC6 Pinned Decision #3.
- [x] [Review][Defer] Revoked row's 55% opacity dims the grey `--status-neutral` dot below WCAG 3:1 non-text contrast [apps/web/src/routes/dashboard/dossiers/[slug].tsx:217, 255-262] — deferred, fix by hoisting the dot out of the dimmed region when StatusDot lands in Story 3.4.
- [x] [Review][Defer] `sessionDuration` encodes "no data" as em-dash in-band rather than `string | null` [apps/web/src/data/mock-analytics.ts:44] — deferred, real API shape comes in Story 8.3.
- [x] [Review][Defer] URL `?tab=` handling is strict literal equality [apps/web/src/routes/dashboard/dossiers/[slug].tsx:91-94, 98-102] — `?tab=Analytics` / `?tab=analytics ` / `?tab=bogus` all silently fall through to "content" while the URL keeps the invalid value. Deferred — minor edge, no user-facing path produces these today.
- [x] [Review][Defer] `MetricCard` `aria-label` on `<article>` overrides children for AT; a future caller passing `subLabel` would make it invisible to screen readers [apps/web/src/components/confluent/MetricCard.tsx:18-29] — deferred, AC9 mandates this aria-label pattern and AC1 forbids `subLabel` in 3.3. Latent issue for a future subLabel user.
- [x] [Review][Defer] Pending entry's em-dash `sessionDuration` renders at same 22 px bold weight as real durations [apps/web/src/routes/dashboard/dossiers/[slug].tsx:239-241] — deferred, minor visual implying "0m 00s". Revisit with the StatusDot/AccessListRow extraction in 3.4.
- [x] [Review][Defer] Tab change does not reset scroll / move focus [apps/web/src/routes/dashboard/dossiers/[slug].tsx:96-108] — deferred, already listed as "Scroll position is not preserved when switching tabs" in the Story 3.2 deferred-work. No action in 3.3.

## Dev Notes

### Critical Architecture Constraints

- **`MetricCard` lives at `apps/web/src/components/confluent/MetricCard.tsx`** — design-system display primitive, NOT a shadcn-style wrapper. `components/confluent/` hosts design-system components with Confluent-specific anatomy (`DossierField`, `DossierCard`, `EmptyState`, `WizardInput`); `components/ui/` hosts shadcn-style wrappers over Base UI primitives (`badge`, `button`, `sheet`, `tabs`). `MetricCard` is a custom Confluent anatomy (label + big number + optional sub-label) with zero Base UI underpinning — it belongs in `components/confluent/`. [Source: ux-design-specification.md §Component Implementation Strategy (line 612-617); Story 3.2 Pinned Decision #1]
- **`mock-analytics.ts` lives at `apps/web/src/data/`** — the `data/` folder is the settled home for static fixtures (`mock-dossiers.ts`, `questionnaire.ts`). NOT `features/` (that's feature-local logic / hooks), NOT `lib/` (that's pure utilities). [Source: Story 3.1 / 3.2 precedent; architecture.md §Code Structure (line 373-395)]
- **Analytics panel rendering stays INLINE in `routes/dashboard/dossiers/[slug].tsx`** — single-caller, cross-story edit surface (3.4 adds rows; 3.6 adds revocation state). Same rationale as Story 3.2's "don't extract a `DossierPageHeader`". Extract only when a second caller or a clean boundary emerges. See Pinned Decision #4.
- **Route path stays `/dashboard/dossiers/view/:slug`** — the real path established by the Story 2.6 code-review patch. Same discrepancy with the Epic AC's bare `:slug` as Stories 3.1 / 3.2 already flagged. Do NOT "fix" the route. [Source: [apps/web/src/router.tsx](apps/web/src/router.tsx); Story 3.1 Pinned Decision #5; Story 3.2 Pinned Decision #13]
- **`MOCK_ANALYTICS` is slug-agnostic in 3.3.** Every dossier (Biosensio, Agrotrack, wizard-created) renders the SAME 3 metrics + 3 entries. Per-dossier analytics fan-out lands in Story 8.3 (FR23 — `GET /v1/dossiers/:id/analytics` returns per-dossier aggregates). Making the 3.3 fixture per-dossier now would (a) triple fixture maintenance; (b) require a lookup function shape that 8.3's TanStack Query hook doesn't match; (c) leak an abstraction (`function getAnalytics(slug)`) that 8.3 will delete. [Source: epics.md §Story 8.3 (line 1569-1595)]
- **Status tokens already exist in `index.css`.** `--status-active: #4CAF7D` / `--status-pending: #F0A830` / `--status-neutral: #B0B0B0` are declared at [apps/web/src/index.css:87-89](apps/web/src/index.css#L87-L89) and re-exported via `--color-status-*` at [apps/web/src/index.css:39-41](apps/web/src/index.css#L39-L41). Use `bg-[var(--status-active)]` etc. in the row's StatusDot span. Do NOT introduce new CSS variables — the 3 tokens cover the full state palette. [Source: Story 1.2 design-system configuration]
- **Design tokens only — no raw hex.** `bg-card`, `border-border`, `text-foreground`, `text-muted-foreground`, `bg-muted`, `var(--status-*)` cover every surface in the analytics panel. The epic-level "`bg-card`, `border`, `border-radius: 8px`, `padding: 16px`" recipe is expressed as `rounded-lg border border-border bg-card p-4` — the project's `--radius` token is 6 px so `rounded-lg` ≈ 6 px, which is a deliberate tighter radius than the epic's 8 px literal (consistent with the rest of the product's card recipes, including `DossierCard` and the Story 3.2 placeholder). See Pinned Decision #8. [Source: [apps/web/src/index.css:76](apps/web/src/index.css#L76); Story 1.2]
- **H2 recipe stays at `font-heading text-xl font-semibold text-foreground md:text-2xl`.** Matches the section H2 used inside the Contenu panel (2.6 / 3.2 — [apps/web/src/routes/dashboard/dossiers/\[slug\].tsx:155](apps/web/src/routes/dashboard/dossiers/[slug].tsx#L155)). Do NOT deviate — the Contenu-tab and Analytics-tab H2s should feel identical to the reader.
- **URL-as-source-of-truth for the active tab is preserved from 3.2.** No change to `useSearchParams` / `handleTabChange` logic beyond the `TAB_VALUES` literal substitution. The tab panel swap is entirely controlled by Base UI's `Tabs` value prop + `activeTab` derivation. [Source: Story 3.2 §Decisions Pinned for This Story #3]
- **No `react-hook-form`, no `zod`, no TanStack Query on 3.3.** The analytics panel is pure display: fixture → JSX. Forms and server state land in Epic 7 (questionnaire) / 8 (analytics API / revocation mutation). Story 3.5 adds `react-hook-form` + `zod` for the share email input; 3.3 does NOT.
- **`@base-ui/react` dependency graph unchanged.** 3.3 does NOT add a new Base UI primitive. The Tabs / Button / Avatar / Sheet / Separator / Input / Label / Sonner / Badge subpaths already in use remain the full set. No new `@base-ui/react/*` import, no lockfile delta. [Source: Story 3.2 §Latest Technical Information]
- **French-locale typography:** `"Accès & partage"`, `"Destinataires actifs"`, `"Vues totales"`, `"Durée moy. de session"`, `"Révoquer"`, `"Révoqué le {date}"`, `"En attente"`, `"Actif"`, `"Aucun destinataire pour le moment."` — copy verbatim from the Epic AC and UX spec. Do NOT "improve" with accents / typographic spaces / alternate orthography.
- **WCAG 2.1 AA baseline:** MetricCard landmarks, H1 → H2 heading outline, per-row Révoquer `aria-label`, StatusDot `aria-hidden` (text carries the state), 55 % opacity + distinct text + distinct colour (three orthogonal signals for revoked rows), 44 × 44 tap targets on all buttons, no colour-only cues. [Source: ux-design-specification.md §Accessibility (line 377-405)]

### Design Tokens to Use

| Surface | Tailwind utility | Value | Where |
|---|---|---|---|
| MetricCard outer | `rounded-lg border border-border bg-card p-4` | 6 px radius / `#E8E8E7` border / `#FFFFFF` bg / 16 px padding | `<article>` in `MetricCard.tsx` |
| MetricCard label | `text-[11px] font-medium uppercase tracking-wider text-muted-foreground` | 11 px / 500 / small-caps / `#6B6B6B` | Top `<p>` |
| MetricCard value | `mt-2 text-2xl font-bold text-foreground tabular-nums` | 24 px / 700 / `#1A1A1A` / tabular digits | Middle `<p>` |
| MetricCard sub-label | `mt-1 text-[11px] text-muted-foreground` | 11 px / `#6B6B6B` | Bottom `<p>` (conditional) |
| MetricCard grid | `grid grid-cols-1 gap-4 md:grid-cols-3` | 16 px gap / responsive | Container in `[slug].tsx` analytics tab |
| Analytics section H2 | `font-heading text-xl font-semibold text-foreground md:text-2xl` | 20 → 24 px / 600 / `#1A1A1A` | `<h2>Accès & partage</h2>` |
| Analytics section wrapper | `mt-8` | 32 px gap below MetricCard grid | `<section>` |
| Access list container | `mt-4 overflow-hidden rounded-lg border border-border bg-card` | 6 px radius / `#E8E8E7` border / `#FFFFFF` bg / clips inner dividers | `<div>` wrapping rows |
| Empty-state copy | `px-4 py-6 text-center text-sm text-muted-foreground` | 16 px h / 24 px v padding / 14 px / `#6B6B6B` | `<p>` inside container |
| Access row base | `flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between` | Responsive stack→row, 16 px h / 12 px v padding | Each row `<div>` |
| Access row divider | `border-t border-border` (on `index > 0`) | `#E8E8E7` top border | Inter-row separator |
| Access row (revoked) | `opacity-[0.55]` | 55 % opacity cascades to all descendants | Wrapper `<div>` |
| Initials circle | `inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground` | 32 px circle / `#F1F0EE` bg / 11 px / 600 / `#6B6B6B` | `<span aria-hidden>` |
| Email text | `truncate text-sm font-medium text-foreground` | 14 px / 500 / `#1A1A1A` / truncate | `<p>` in row |
| Last-seen text | `text-xs text-muted-foreground` | 12 px / `#6B6B6B` | `<p>` below email |
| Session duration | `text-[22px] font-bold text-foreground tabular-nums` | 22 px / 700 / `#1A1A1A` / tabular | `<span>` right-aligned group |
| StatusDot dot | `inline-block size-[7px] rounded-full bg-[var(--status-*)]` | 7 px circle / `--status-active` \| `--status-pending` \| `--status-neutral` | `<span aria-hidden>` |
| StatusDot label | `inline-flex items-center gap-1.5 text-sm text-muted-foreground` | 14 px / `#6B6B6B` | `<span aria-label>` wrapper |
| Révoquer button | `<Button variant="outline" size="sm" className="min-h-11">` | 36 px body + `min-h-11` = 44 px outer | Each active/pending row |
| Revoked row replacement | `text-xs text-muted-foreground` | 12 px / `#6B6B6B` | `<span>Révoqué le {date}</span>` |

### Component Prop Contracts (exhaustive)

```ts
// apps/web/src/components/confluent/MetricCard.tsx
export interface MetricCardProps {
  label: string
  value: string
  subLabel?: string
  className?: string
}
export function MetricCard(props: MetricCardProps): JSX.Element

// apps/web/src/data/mock-analytics.ts
export type AccessStatus = 'active' | 'pending' | 'revoked'
export interface AccessEntry {
  readonly email: string
  readonly initials: string
  readonly status: AccessStatus
  readonly lastSeen: string
  readonly sessionDuration: string
  readonly revokedAt?: string
}
export interface AnalyticsMetric {
  readonly label: string
  readonly value: string
}
export interface Analytics {
  readonly metrics: readonly [AnalyticsMetric, AnalyticsMetric, AnalyticsMetric]
  readonly accessEntries: readonly AccessEntry[]
}
export const MOCK_ANALYTICS: Analytics

// apps/web/src/routes/dashboard/dossiers/[slug].tsx (module-scope additions)
const TAB_VALUES: { readonly content: 'content'; readonly analytics: 'analytics' }
type TabValue = 'content' | 'analytics'
```

### File Layout (target)

```
apps/web/src/
├── components/
│   ├── confluent/
│   │   ├── DossierCard.tsx                                       [UNCHANGED]
│   │   ├── DossierField.tsx                                      [UNCHANGED]
│   │   ├── EmptyState.tsx                                        [UNCHANGED]
│   │   ├── MetricCard.tsx                                        [NEW — KPI display primitive]
│   │   ├── WizardInput.tsx                                       [UNCHANGED]
│   │   └── illustrations/                                        [UNCHANGED]
│   ├── layout/                                                   [UNCHANGED]
│   └── ui/                                                       [UNCHANGED — no new primitives]
├── data/
│   ├── mock-analytics.ts                                         [NEW — analytics fixture]
│   ├── mock-dossiers.ts                                          [UNCHANGED]
│   └── questionnaire.ts                                          [UNCHANGED]
├── features/                                                     [UNCHANGED]
├── lib/                                                          [UNCHANGED]
├── routes/
│   └── dashboard/
│       └── dossiers/
│           └── [slug].tsx                                        [MODIFIED — analytics panel body + TAB_VALUES]
└── router.tsx                                                    [UNCHANGED]
```

### Previous Story Intelligence

**From Story 3.2 (just landed — `791997b`):**
- `<TabsContent value="analytics">` currently holds a single `<div><p>L'analytique de ce dossier s'affichera ici.</p></div>` placeholder block. Pinned Decision #9 in 3.2 explicitly marked it as a "single replace-point" for 3.3 — the block is designed to be swapped atomically by this story. Do NOT leave any of the 3.2 placeholder copy (`L'analytique de ce dossier s'affichera ici.`) in place — the swap replaces the entire block contents.
- `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent` (and `TabsIndicator`, unused) are exported from [apps/web/src/components/ui/tabs.tsx](apps/web/src/components/ui/tabs.tsx) — shadcn-style wrapper over `@base-ui/react/tabs`. `TabsContent` = `TabsPrimitive.Panel`, unmounts on tab switch (no `keepMounted`). 3.3 does NOT touch `tabs.tsx`.
- `useSearchParams()` + derived `activeTab` + functional `setSearchParams(..., { replace: true })` is the pattern. 3.3 preserves it — the `TAB_VALUES` substitution is a pure rename / no behaviour change.
- `MOCK_DOSSIERS` exposes `{ slug, name, sector, maturity, activeShareLinksCount, createdAt }`. 3.3 does NOT add or remove any field — the analytics fixture is a SEPARATE module (`mock-analytics.ts`) so that 8.3's API cutover can delete it atomically without touching `mock-dossiers.ts`.
- H1 focus-on-mount recipe is `[slug]`-keyed, NOT `[slug, activeTab]`-keyed — Pinned Decision #7 in 3.2. Tab changes do NOT refocus the H1. 3.3 does NOT touch the `useEffect` dep array.
- The `handle: { hideBreadcrumb: true }` on the `dashboard/dossiers/view/:slug` route in `router.tsx` is load-bearing. 3.3 does NOT touch `router.tsx` (Task 3 verification includes a `git diff` check).
- The 3.2 dossier page file is currently 186 lines; 3.3 will grow it by ~80 lines (analytics panel body) + the TAB_VALUES block (~5 lines). Total post-3.3: ~270 lines. Still one-screen readable, no extraction pressure yet. 3.4 (`AccessListRow` + `StatusDot`) and 3.6 (revocation state) are the likely tipping points — keep structure flat for now, let them refactor.
- The 3.2 code review deferred "Magic string `'analytics'` duplicated across ≥4 sites" to 3.3 (see `_bmad-output/implementation-artifacts/deferred-work.md`). AC11 discharges that debt via `TAB_VALUES`.

**From Story 3.1:**
- `DossierCard` lives at `components/confluent/DossierCard.tsx` — precedent for custom Confluent display primitives. `MetricCard` follows the same anatomy (named export, `className` prop forwarded, no default export, `cn()`-composed className). See Story 3.1 §File Layout.
- Dashboard list renders `MOCK_DOSSIERS.map(...)` — precedent for reading static fixtures directly in the route. Analytics panel does the same with `MOCK_ANALYTICS.accessEntries.map(...)`.
- Click a dashboard card → `/dashboard/dossiers/view/:slug` (prefix is `view/`). 3.2 closed this integration seam (resolved names + empty-content fallback); 3.3 adds to the analytics tab but does NOT touch the dashboard card click-through.

**From Stories 2.3 – 2.6 (carried):**
- localStorage-backed dossier content (`confluent_dossier_{slug}`) is STILL read by `loadDossier` in `[slug].tsx`. 3.3 does NOT interact with localStorage — analytics is purely mocked via the fixture. The coexistence is fine: Contenu tab reads localStorage + mock name; Analytics tab reads the separate analytics fixture.
- The H2 recipe inside the Contenu panel is `font-heading text-xl font-semibold text-foreground md:text-2xl` — 3.3 reuses the exact same recipe for `<h2>Accès & partage</h2>` so both tabs feel typographically consistent.

**Cross-Epic anticipation (for 3.4+):**
- Story 3.4 creates the formal `AccessListRow` and `StatusDot` components. It will open `[slug].tsx` and extract the inline row JSX from 3.3 into `<AccessListRow email={...} status={...} ... />` calls, and pull the `<span aria-hidden size-[7px]>` dot pattern into `<StatusDot status={...} label={...} />`. 3.3's inline row markup is intentionally shaped to make that extraction mechanical — a direct prop-by-prop lift. See Pinned Decision #3.
- Story 3.5 wires the Partager button to open the D5 Sheet. Analytics panel does NOT need to change — the Sheet opens on top of the current tab, and the Sheet's "mini-list of existing recipients" (per epic line 763) reads the SAME `MOCK_ANALYTICS.accessEntries` fixture. 3.5 consumes the fixture, does NOT re-seed it.
- Story 3.6 lifts `MOCK_ANALYTICS.accessEntries` into `useState` inside the route (or a lift-to-layout), adds the AlertDialog confirm flow, transitions a row to `status='revoked'`, and decrements the `Destinataires actifs` MetricCard value by 1. The fixture's `readonly` markers will need to relax OR the state lift will copy the fixture into mutable state (the latter is cleaner — preserves the fixture as a pristine seed).
- Story 8.3 / 8.5 replace `MOCK_ANALYTICS` with a TanStack Query hook (`useDossierAnalyticsQuery(slug)`) returning the live `GET /v1/dossiers/:id/analytics` payload. The fixture module gets deleted — the prop shape of `MetricCard` and the row JSX stay the same.

### Anti-Patterns to Avoid

- **Do NOT extract an `AnalyticsPanel` component.** Single-caller; Stories 3.4 / 3.6 will edit this same block. Extracting now pre-commits to a shape 3.4 may contradict. See Pinned Decision #4.
- **Do NOT extract `AccessListRow` or `StatusDot` in 3.3.** Story 3.4 owns those extractions. 3.3 renders inline row markup. See Pinned Decision #3.
- **Do NOT make `MetricCard` interactive.** No `onClick`, no `<button>`, no hover lift, no focus ring. It is read-only. Adding interactivity misleads users. See Pinned Decision #2.
- **Do NOT accept a `number` in `MetricCardProps.value`.** String-only. Formatting (thousand separators, duration `Xm Ys`, French locale) is the caller's concern. A generic `number` + internal `Intl.NumberFormat` would leak locale + unit decisions into the primitive. See Pinned Decision #1.
- **Do NOT use the shadcn `Card` primitive for `MetricCard`.** The shadcn `Card` bakes `gap-4 py-4 overflow-hidden` + `rounded-t-lg px-4` onto its sub-slots. `MetricCard`'s anatomy is tighter (label → value → optional sub-label, 16 px total padding, no internal vertical rhythm beyond `mt-2` / `mt-1`). A raw `<article>` is lower-friction.
- **Do NOT use `rounded-[8px]` to literalise the Epic AC's "8 px radius".** The project's `--radius` token is 6 px; all existing cards (`DossierCard`, `DossierField`-in-`dl`, analytics placeholder from 3.2) use `rounded-lg` ≈ 6 px. Deviating here would make the MetricCard look visually inconsistent. See Pinned Decision #8.
- **Do NOT hardcode the analytics fixture values in the route JSX.** Always read from `MOCK_ANALYTICS` (AC1, AC5). Inline literals in the route would make Story 3.6's decrement flow hard to unwind.
- **Do NOT compute relative dates with `formatRelativeDate` for the mocked `lastSeen` copy.** The helper reads the wall-clock — the copy would drift day-over-day. Hardcoded French strings are the right trade-off for a mocked story. Story 8.3 switches to the live API and then relative formatting makes sense.
- **Do NOT add per-dossier analytics fan-out in 3.3.** Every slug shares `MOCK_ANALYTICS`. Story 8.3 introduces per-dossier metrics via the real API. See Pinned Decision #9.
- **Do NOT add new CSS variables.** `--status-active` / `--status-pending` / `--status-neutral` are already in `index.css`. Use `bg-[var(--status-active)]` arbitrary-value syntax — Tailwind v4 supports it natively. See AC2 / AC3 constraints.
- **Do NOT hand-roll a `role="region"` on the MetricCard grid container.** The grid is a layout primitive, not a landmark. Each `MetricCard` is itself an `<article>` with `aria-label` — landmarks-within-landmarks is noisy.
- **Do NOT wire the Révoquer button's `onClick` in 3.3.** Story 3.6 owns the revocation flow (AlertDialog, state lift, MetricCard decrement, toast). 3.3's button is a layout + tab-order placeholder, same as 3.2's Partager button was.
- **Do NOT hide / disable the Révoquer button.** `disabled` would skip it in keyboard tab order — breaking AC9. `aria-disabled="true"` would announce "disabled" to screen readers — misleading because 3.6 will enable it. A plain `<Button>` with no `onClick` is correct — clicking does nothing; 3.6 adds the handler.
- **Do NOT add a third tab "speculatively" (`Documents`, `Paramètres`).** Epic 3 has exactly two tabs. YAGNI. Same constraint as Story 3.2.
- **Do NOT delete the 3.2 `TabsIndicator` export from `tabs.tsx`.** It is forward-compat per Pinned Decision #12 in 3.2. 3.3 does NOT touch the tabs primitive file.
- **Do NOT normalise `?tab=foo` to `?tab=analytics` or to no-param on mount.** AC5 of Story 3.2 is strict: unknown value → fall back visually to Contenu, leave URL untouched. 3.3 preserves the behaviour via the `TAB_VALUES.analytics` comparison + the same `handleTabChange` logic.
- **Do NOT introduce `useMemo` / `useCallback` on the analytics panel JSX.** The per-render `.map()` over `MOCK_ANALYTICS.accessEntries` (3 entries) is free. Premature memoization adds code surface and obscures the data flow. Same rationale as the 3.2 deferred item on `QUESTIONNAIRE_FLAT.filter`.

### Testing Requirements

- **Unit / integration tests remain out of scope** for Epic 3 frontend — same decision as Stories 3.1 / 3.2. No Vitest / RTL harness introduced.
- **Manual verification is the primary gate** (Task 4 walkthrough). Tri-viewport (375 / 900 / 1440 px), axe audit on: (a) Contenu tab (regression guard for AC13), (b) Analytics tab with the 3 seeded rows, (c) Analytics tab with a temporarily-blanked `accessEntries` (AC10 empty-state probe).
- **Screen-reader sanity:** VoiceOver / NVDA should announce each MetricCard as `"Article, Destinataires actifs : 2"` / etc.; the `<h2>` should appear in the heading rotor as `"Accès & partage"`; each Révoquer button should announce `"Révoquer l'accès de arc@capital.fr, bouton"`.
- **Type safety:** `MetricCardProps` must compile under `tsc --strict`; `MOCK_ANALYTICS.metrics` tuple type must survive the `.map()` (TS widens to `readonly AnalyticsMetric[]` inside `.map()` — the compile-time guard is at the fixture declaration site). `TAB_VALUES` + `TabValue` must narrow correctly in the `activeTab` derivation.
- **Zero new lint warnings** beyond the 3 tolerated ones (`badge.tsx:52`, `button.tsx:58`, `features/current-user/context.tsx:17`). The two new files (`MetricCard.tsx`, `mock-analytics.ts`) both have low-risk lint surfaces — `MetricCard.tsx` exports only a component + a prop interface (mirrors `DossierField.tsx`); `mock-analytics.ts` exports only types + a `const` (no React surface). Neither can trip `react-refresh/only-export-components`.
- **No regression on Stories 1.1 – 3.2 ACs** — full table in Task 4. Critical checks:
  - `/dashboard` list (3.1): 2 mock cards + "Créer un dossier" button — unchanged.
  - `/dashboard/dossiers/nouveau` → questionnaire → recapitulatif (2.3 / 2.4 / 2.5) — unchanged.
  - `/dashboard/dossiers/view/biosensio` Contenu tab (3.2 + 2.6): H1 focus-on-mount, breadcrumb, Partager button, tabs, empty-content fallback copy — ALL unchanged.
  - `/dashboard/dossiers/view/biosensio` Analytics tab: 3.2 placeholder replaced by D4 layout.
  - `/dashboard/dossiers/view/jean-dupont-fictif`: still renders the 2.6 "Dossier introuvable" fallback (no breadcrumb, no tabs, no panel — so no MetricCard either). Verify via direct navigation in Task 4.
- **Router integration verification:**
  - `/dashboard/dossiers/view/biosensio` → Contenu active on mount, empty-content fallback.
  - `/dashboard/dossiers/view/biosensio?tab=analytics` → Analytics active on mount, MetricCard grid + access list rendered.
  - `/dashboard/dossiers/view/agrotrack?tab=analytics` → same analytics fixture (slug-agnostic in 3.3).
  - `/dashboard/dossiers/view/<wizard-created-slug>?tab=analytics` → same analytics fixture + 2.6 Contenu section list.
  - `/dashboard/dossiers/view/jean-dupont-fictif?tab=analytics` → "Dossier introuvable" fallback (the route guard rejects unknown slugs before the tabs can mount; `?tab=analytics` is ignored).
- **Accessibility audit checklist:**
  - H1 `Biosensio` → H2 `Accès & partage` heading outline on the Analytics tab.
  - 3 × `<article>` MetricCard landmarks with `aria-label`.
  - 3 × access list rows, each with per-row `aria-label` on the Révoquer button (when present), `aria-label` on the status text span, `aria-hidden` on the StatusDot visual and the initials circle.
  - Every interactive element (Partager, both tabs, each Révoquer button) has a visible focus ring — comes from the 1.2 design tokens + the button / tab primitives.
  - Keyboard-only flow: Tab advances to each interactive element in reading order; `Révoquer` on row 3 (revoked) is absent, so Tab skips the button position without a dead stop.
  - Axe audit: 0 serious / 0 critical. No `color-contrast` violation (all text ≥ 4.5:1 on `bg-card` / `bg-background`); no `button-name` violation (Révoquer has visible text + `aria-label`); no `heading-order` violation (H1 → H2 skip-free).

### Decisions Pinned for This Story (flag if divergence is intentional)

1. **`MetricCard.value` is a `string`, not a `number`.** Formatting (thousand separators, duration `Xm Ys`, locale-aware decimals) is the caller's concern. Accepting `number` would (a) push `Intl.NumberFormat` into the primitive; (b) force the primitive to know about French vs English conventions; (c) awkwardly handle duration strings like `"4m 32s"` that have no purely numeric representation. String-only keeps the primitive pure-presentational and lets each call site format deterministically. Story 8.3 will format in the TanStack Query selector / the API's response shape.
2. **`MetricCard` is non-interactive (no hover / focus / transition).** The UX spec explicitly says "Read-only, no interactions." Styling it as interactive (hover lift, shadow on hover, focus ring) would mislead users into expecting a click. 3.3 keeps the card as a pure display surface.
3. **`AccessListRow` and `StatusDot` are NOT extracted in 3.3.** Story 3.4 owns their formal extraction with full state matrix (active / pending / revoked hover + focus + ARIA decisions). 3.3 ships inline row JSX — visual shape + fixture seed. Extracting now pre-commits to a prop API that 3.4 may refine (e.g., `status` union vs. `color` prop on StatusDot; `onRevoke` callback vs. lift-state on AccessListRow). 3.3's inline JSX is intentionally shaped to make 3.4's extraction mechanical — direct prop-by-prop lift, no structural rewrite.
4. **Analytics panel stays inline in `routes/dashboard/dossiers/[slug].tsx`.** Single-caller; Story 3.4 will edit the rows, Story 3.6 will edit the state. Same rationale as Story 3.2's "don't extract a `DossierPageHeader`". Extract only when a clean boundary emerges — which is specifically NOT now, when 3.4 and 3.6 are about to edit the same block.
5. **Révoquer button has no `onClick` in 3.3.** Story 3.6 owns the revocation flow. A silent no-op button is the cleanest contract — adding a `console.log` or a toast is cosmetic waste that 3.6 has to unwind. Same precedent as 3.2's Partager button no-op.
6. **`TAB_VALUES` is a module-scope `const`, not a feature-module export.** Single module consumer (the `[slug].tsx` route). Exporting it would invite cross-module coupling without a real need. If a future route reads `?tab=` on a different pattern, extract at that call site then (YAGNI).
7. **Commit strategy: single `feat(epic-3): story 3.3 — MetricCard grid & analytics timeline (D4)` commit that bundles implementation AND any self-applied review patches.** Per user memory preference ("Code + review in a single commit", established from Story 2.4 onward — see [../../.claude/projects/-home-coder-confluent/memory/MEMORY.md](../../.claude/projects/-home-coder-confluent/memory/MEMORY.md)).
8. **`rounded-lg` (6 px) instead of the Epic AC's literal 8 px.** Project-wide `--radius` token is 6 px; all cards (`DossierCard`, the 3.2 analytics placeholder, the Contenu-tab empty-state paragraph, the revoked-row container) use `rounded-lg`. Using `rounded-[8px]` here would break the visual rhythm. Documented as a scoped Epic-AC divergence; flag in retrospective if UX disagrees.
9. **`MOCK_ANALYTICS` is slug-agnostic in 3.3.** Every dossier (Biosensio, Agrotrack, wizard-created) renders the SAME 3 metrics + 3 entries. Story 8.3 introduces per-dossier analytics via the real API. Making the fixture per-dossier now would triple fixture maintenance, introduce a lookup abstraction (`getAnalyticsFor(slug)`) that 8.3's TanStack Query hook does NOT replace gracefully, and leak a false-API-shape into the codebase.
10. **`opacity-[0.55]` matches the UX spec's literal "55%".** Arbitrary-value form used deliberately — guarantees the exact 55 % regardless of which steps are in the Tailwind v4 default opacity scale. Do NOT substitute `opacity-50` (too faded — 50 % erases too much of the email) or `opacity-60` (too present — doesn't communicate "revoked" strongly enough at a glance). Build artifact should contain an `opacity: 0.55` rule keyed off the arbitrary value.
11. **Initials circle is a raw `<span>`, not `Avatar` / `AvatarFallback`.** The shadcn `Avatar` primitive ([apps/web/src/components/ui/avatar.tsx](apps/web/src/components/ui/avatar.tsx)) includes a post-border (`after:border`) and a 40 × 40 `lg` variant that we do NOT need here. A 32-px `<span>` with `bg-muted` + `text-muted-foreground` is the minimal tile — Story 3.4 may swap in `Avatar` + `AvatarFallback` when it formalises `AccessListRow`. 3.3 keeps the markup minimal to avoid pre-committing.
12. **`aria-hidden="true"` on both the initials circle AND the StatusDot visual.** The adjacent text (email / status label) already carries the meaning; duplicating it to screen readers would be noisy. Compliance with AC9 + WCAG 1.4.1 (color is not the only signal).
13. **Empty-state copy (`Aucun destinataire pour le moment.`) is present in 3.3 but unexercised by the fixture.** Shipping the conditional now — rather than waiting for Story 3.6 to drain the list — removes the structural-change risk from 3.6 when it decrements entries. 3.3's walkthrough includes a fixture-blanking probe (Task 4 sub-step 13) to confirm the copy renders correctly.

### References

- Story AC + narrative: [Source: [_bmad-output/planning-artifacts/epics.md](../planning-artifacts/epics.md#L662-L691) §Story 3.3 — MetricCard Grid & Analytics Timeline (D4)]
- Epic 3 context (entrepreneur dashboard + access management): [Source: [_bmad-output/planning-artifacts/epics.md](../planning-artifacts/epics.md#L594-L596)]
- Story 3.4 consumer of the inline row markup (formal `AccessListRow` + `StatusDot` extraction): [Source: [_bmad-output/planning-artifacts/epics.md](../planning-artifacts/epics.md#L695-L738) §Story 3.4]
- Story 3.5 consumer of the analytics fixture (mini-recipients list in the D5 Sheet): [Source: [_bmad-output/planning-artifacts/epics.md](../planning-artifacts/epics.md#L741-L783) §Story 3.5]
- Story 3.6 consumer of the access entries + MetricCard value (revocation state lift): [Source: [_bmad-output/planning-artifacts/epics.md](../planning-artifacts/epics.md#L787-L813) §Story 3.6]
- Story 8.3 API cutover for analytics (`GET /v1/dossiers/:id/analytics`): [Source: [_bmad-output/planning-artifacts/epics.md](../planning-artifacts/epics.md#L1569-L1595) §Story 8.3]
- UX — `MetricCard` component spec (label / value / sub-label anatomy): [Source: [_bmad-output/planning-artifacts/ux-design-specification.md](../planning-artifacts/ux-design-specification.md#L580-L586) §MetricCard]
- UX — `AccessListRow` component spec (avatar / email / session / duration / status / revoke): [Source: [_bmad-output/planning-artifacts/ux-design-specification.md](../planning-artifacts/ux-design-specification.md#L551-L564) §AccessListRow]
- UX — `StatusDot` component spec (3 colours, text-label-always rule): [Source: [_bmad-output/planning-artifacts/ux-design-specification.md](../planning-artifacts/ux-design-specification.md#L590-L598) §StatusDot]
- UX — D4 layout (3-column MetricCard grid above timeline): [Source: [_bmad-output/planning-artifacts/ux-design-specification.md](../planning-artifacts/ux-design-specification.md#L401-L419) §Design Direction Decision + Implementation Approach]
- UX — component placement convention (`components/confluent/` vs `components/ui/`): [Source: [_bmad-output/planning-artifacts/ux-design-specification.md](../planning-artifacts/ux-design-specification.md#L612-L617) §Component Implementation Strategy]
- UX — accessibility baseline (focus ring, 44 × 44 tap targets, colour-never-alone rule): [Source: [_bmad-output/planning-artifacts/ux-design-specification.md](../planning-artifacts/ux-design-specification.md#L377-L405) §Accessibility]
- Story 3.2 dossier page file (analytics placeholder is the replace-point): [Source: [apps/web/src/routes/dashboard/dossiers/\[slug\].tsx](../../../../../apps/web/src/routes/dashboard/dossiers/%5Bslug%5D.tsx)]
- Story 3.2 deferred: `'analytics'` magic string across ≥ 4 sites (AC11 discharges): [Source: [_bmad-output/implementation-artifacts/deferred-work.md](deferred-work.md#L7)]
- Architecture — React source layout (`routes/` + `components/confluent/` + `components/ui/` + `data/`): [Source: [_bmad-output/planning-artifacts/architecture.md](../planning-artifacts/architecture.md#L373-L395) §Code Structure]
- Color tokens (`--card` / `--muted` / `--border` / `--foreground` / `--muted-foreground` / `--status-active` / `--status-pending` / `--status-neutral` / `--radius`): [Source: [apps/web/src/index.css](../../../../../apps/web/src/index.css#L51-L90)]
- Sibling pattern — `DossierField` (`components/confluent/` design-system primitive): [Source: [apps/web/src/components/confluent/DossierField.tsx](../../../../../apps/web/src/components/confluent/DossierField.tsx)]
- Sibling pattern — `DossierCard` (`components/confluent/` card primitive with `className` forwarding): [Source: [apps/web/src/components/confluent/DossierCard.tsx](../../../../../apps/web/src/components/confluent/DossierCard.tsx)]
- Sibling pattern — `mock-dossiers.ts` (`data/` fixture with `readonly` + `as const`): [Source: [apps/web/src/data/mock-dossiers.ts](../../apps/web/src/data/mock-dossiers.ts)]
- `Button` primitive (`variant="outline" size="sm"` with `min-h-11` override): [Source: [apps/web/src/components/ui/button.tsx](../../../../../apps/web/src/components/ui/button.tsx)]
- User memory — "Code + review in a single commit" preference: [Source: [../../.claude/projects/-home-coder-confluent/memory/MEMORY.md](../../.claude/projects/-home-coder-confluent/memory/MEMORY.md)]

### Latest Technical Information

- **Tailwind v4 arbitrary-value opacity — `opacity-[0.55]`.** The arbitrary-value form always resolves to `opacity: 0.55;` at build time, independent of the project's opacity scale config. The existing codebase only uses `opacity-50` (button disabled states) — 3.3 introduces the first arbitrary-value opacity. No Tailwind plugin or config change required; Tailwind v4 supports arbitrary opacity values natively.
- **Tailwind v4 `bg-[var(--status-active)]` arbitrary value.** The arbitrary-value syntax `bg-[var(--status-*)]` is supported natively in Tailwind v4 (and back to v3.2+). No custom plugin needed. The pre-declared `--status-active` / `--status-pending` / `--status-neutral` tokens at [apps/web/src/index.css:87-89](apps/web/src/index.css#L87-L89) are consumed via the `var(...)` arbitrary syntax. Alternative: add `bg-status-active` utilities via a Tailwind v4 `@utility` block — rejected as over-engineering (3 one-off cases, arbitrary values are cleaner).
- **`readonly` tuple narrowing in `.map()`.** TypeScript narrows `readonly [A, B, C]` to `(A | B | C)[]` inside `.map((item) => ...)`. For the `MOCK_ANALYTICS.metrics` tuple, this means the inline map loses the arity constraint but preserves the element type (`AnalyticsMetric`). The compile-time guarantee of exactly-3 metrics is at the DECLARATION site of the fixture, not at the consumption site. This is acceptable — the consumer's job is to render however many cards the fixture provides, and the grid's `md:grid-cols-3` assumes exactly 3.
- **Tailwind `tabular-nums` utility.** Compiles to `font-variant-numeric: tabular-nums;` which forces monospaced digit glyphs within the variable-width Inter font. Critical for the 3-card MetricCard grid (values like `2`, `7`, `42`, `1 547` should vertically align digit columns) and the session-duration column in the row (`6m 14s`, `3m 41s` have varying digits that should align on the `m` / `s` letters across rows).
- **`<article>` with `aria-label` vs `<section>` with `aria-labelledby`.** WAI-ARIA 1.2 defines `<article>` as "a self-contained composition in a document" — it is the correct landmark for a single KPI card. `aria-label` provides the accessible name more tersely than `aria-labelledby` (which requires a matching `id` on the label element). VoiceOver / NVDA announce "Article, {aria-label}" consistently. [Source: [WAI-ARIA Authoring Practices — `article` role](https://www.w3.org/WAI/ARIA/apg/patterns/landmarks/examples/complementary.html)]
- **`truncate` Tailwind utility.** Applies `overflow: hidden; text-overflow: ellipsis; white-space: nowrap;` to a single-line text. For the `<p className="truncate text-sm font-medium">` email line in the row, this means very-long emails get `…` clipped at the row's available width. Must be paired with `min-w-0` on the flex parent (see the row JSX in Task 3c) — WITHOUT `min-w-0`, flex children have implicit `min-width: auto` which defeats `overflow: hidden`.
- **`@base-ui/react` no new subpath.** All primitives used (Button, Tabs) are already imported from their respective subpaths. No new subpath import in 3.3.
- **React Router v7 `useSearchParams` unchanged.** 3.3 preserves the 3.2 pattern; `TAB_VALUES` is a pure string rename. No version bump, no API change.

### Project Context Reference

No `project-context.md` exists at the repo root. Authoritative planning inputs remain the PRD, epics, architecture, and UX spec under `_bmad-output/planning-artifacts/`, plus locked patterns from Stories 1.1 – 3.2 (design tokens; `components/confluent/` for design-system display primitives; `components/ui/` for shadcn-style wrappers; `data/` for static fixtures; H1 focus-on-mount `[slug]`-keyed recipe; `Button size="lg"` for 44 px tap targets; URL-as-source-of-truth for tab state; `handle.hideBreadcrumb` shell-breadcrumb suppression; `var(--status-*)` / design tokens, no raw hex; route path `dashboard/dossiers/view/:slug`; inline single-caller structures over premature extraction).

User memory index at [../../.claude/projects/-home-coder-confluent/memory/MEMORY.md](../../.claude/projects/-home-coder-confluent/memory/MEMORY.md) notes one active feedback: **bundle story implementation + code-review patches into a single commit** (applied to Pinned Decision #7 and the Task 5 finalisation step). Deferred items from 3.2's review (tracked in [deferred-work.md](deferred-work.md#L5-L13)): the `'analytics'` magic-string duplication is discharged by AC11 / Task 3a-b; the other 6 items (H1 focus `preventScroll`, `Tabs` root `aria-label`, scroll-position preservation, `TabsIndicator` relative-parent, rapid-toggle history, `QUESTIONNAIRE_FLAT.filter` memoization) remain deferred — 3.3 does NOT address them.

## Dev Agent Record

### Agent Model Used

claude-opus-4-7

### Debug Log References

- `pnpm turbo run typecheck`: 2 successful, 0 errors. `MetricCardProps` compiles under TS strict; `MOCK_ANALYTICS` tuple type `readonly [AnalyticsMetric, AnalyticsMetric, AnalyticsMetric]` resolves; `TAB_VALUES` + `TabValue` narrow correctly in the `activeTab` derivation. `@confluent/api` cache-hit, `@confluent/web` cache-miss but 0 errors. Runtime 511 ms.
- `pnpm turbo run lint`: 2 successful, 0 errors. 3 tolerated pre-existing warnings unchanged (`badge.tsx:52`, `button.tsx:58`, `features/current-user/context.tsx:17` — all `react-refresh/only-export-components`). New `MetricCard.tsx` and `mock-analytics.ts` add zero warnings.
- `pnpm turbo run build`: 2 successful, 0 errors on Task 4. **Pre-existing failure from 3.2 had to be fixed first:** `apps/web/src/components/ui/tabs.tsx:6` carried an unused `import * as React from "react"` that tripped `noUnusedLocals` under `tsc -b` (the build config is stricter than `tsc --noEmit` used by `typecheck`). Story 3.2's code review added this import for "codebase-convention parity with `sheet.tsx`", but `tabs.tsx` does not consume the namespace (verified via `grep -c "React\." apps/web/src/components/ui/tabs.tsx` → 0, vs. `sheet.tsx` → 2). Removed the dangling import. Not a 3.3 regression (confirmed by stashing 3.3 changes and running build on HEAD — same failure). Build now green: 1854 modules transformed, 422 ms vite build, `dist/assets/index-*.js` 380.73 kB raw / 120.52 kB gzip, `dist/assets/index-*.css` 46.86 kB raw / 9.05 kB gzip.
- Bundle delta vs Story 3.2 baseline (377.48 kB / 119.64 kB gzip JS; 45.92 kB / 8.88 kB gzip CSS):
  - JS: +3.25 kB raw, +0.88 kB gzip — `MetricCard` component (~30 LOC) + `mock-analytics` fixture (pure data, ~55 LOC) + the expanded `<TabsContent value="analytics">` block (inline access list). In line with the story's forecast of "~0.3 kB gzip" — slightly above because the inline row JSX adds meaningful code surface (conditional branches for status-specific styling).
  - CSS: +0.19 kB raw, +0.17 kB gzip — new Tailwind utilities (`grid-cols-3`, `md:grid-cols-3`, `opacity-[0.55]`, `tabular-nums`, `size-[7px]`, `size-8`, `bg-[var(--status-*)]` × 3, `min-w-0`, `min-h-11`, `truncate`, `inline-flex`, `shrink-0`).
- Self-review grep `grep -nE '#[0-9a-fA-F]{3,6}' apps/web/src/components/confluent/MetricCard.tsx apps/web/src/data/mock-analytics.ts apps/web/src/routes/dashboard/dossiers/[slug].tsx` → zero matches (AC12).
- Self-review grep `grep -n "'analytics'" apps/web/src/routes/dashboard/dossiers/[slug].tsx` → EXACTLY ONE match at line 14 (inside the `TAB_VALUES` literal). `grep -n "'content'"` → EXACTLY ONE match at line 13. AC11 satisfied.
- Self-review grep `grep -nE 'onClick|disabled|aria-disabled' apps/web/src/routes/dashboard/dossiers/[slug].tsx` → zero matches. Partager (3.2) + per-row Révoquer (3.3) are both no-op layout placeholders. Pinned Decision #5 satisfied.
- Self-review grep `grep -c 'hideBreadcrumb' apps/web/src/router.tsx` → 4 hits (pre-existing from 2.3 / 2.4 / 2.5 / 2.6). `git diff apps/web/src/router.tsx` → empty. Task 3 / AC13 confirmation that `router.tsx` was not touched.
- Self-review grep `grep -nA2 '  useEffect' apps/web/src/routes/dashboard/dossiers/[slug].tsx` → `useEffect` dep array is `[slug]` (not `[slug, activeTab]`). H1 focus-on-mount does not re-fire on tab toggle — Pinned Decision #7 from Story 3.2 preserved.
- Smoke test: `pnpm --filter @confluent/web dev` spawned cleanly, `GET /` and `GET /dashboard/dossiers/view/biosensio?tab=analytics` return the SPA HTML shell. Vite HMR + React 19 client-rendering stack is running.

### Completion Notes List

1. **`components/confluent/MetricCard.tsx` landed** — design-system display primitive with the exact anatomy from the UX spec (`<article>` + label + value + optional sub-label). No hover / focus / transition — read-only by design (Pinned Decision #2). `value` is `string` (not `number`) — formatting is the caller's responsibility (Pinned Decision #1). Sibling to `DossierField.tsx` / `DossierCard.tsx`; the `components/confluent/` folder stays the home for Confluent-specific display primitives while `components/ui/` stays the home for shadcn-style wrappers over Base UI.
2. **`data/mock-analytics.ts` landed** — slug-agnostic analytics fixture exposing `MOCK_ANALYTICS: { metrics, accessEntries }`. 3 fixed metrics (`2 / 7 / 4m 32s`) and 3 entries (`arc@capital.fr` active, `martin@fund.io` pending, `lea@invest.com` revoked). All strings are pre-formatted French to avoid relative-date drift across sessions (Task 2 rationale). Sibling to `mock-dossiers.ts`; uses `readonly` everywhere + `as const` for immutability. Tuple-typed `metrics` array encodes the 3-column AC at the type level. Exported raw (not via a builder function) — Story 8.3 will swap this import for a TanStack Query hook; a wrapping function today would be a false step.
3. **`routes/dashboard/dossiers/[slug].tsx` rewritten** — swapped the 3.2 placeholder `<div><p>L'analytique de ce dossier s'affichera ici.</p></div>` for the full D4 layout: 3-column `MetricCard` grid (`grid-cols-1 gap-4 md:grid-cols-3`), `<h2>Accès & partage</h2>` section heading, card container with 3 inline placeholder rows. Each row: initials circle + email + last-seen + large-bold session duration + `StatusDot` visual + Révoquer button (or "Révoqué le {date}" text on revoked rows). Revoked rows render at `opacity-[0.55]` (Pinned Decision #10 — arbitrary-value form guarantees the exact 55 % independent of the Tailwind v4 opacity scale config).
4. **`AccessListRow` and `StatusDot` NOT extracted** — Story 3.4 owns the extraction (Pinned Decision #3). 3.3 ships inline row markup shaped for a mechanical, prop-by-prop lift by 3.4. Same discipline as Story 3.2's "don't extract `DossierPageHeader`".
5. **`AnalyticsPanel` NOT extracted** — Single-caller; Stories 3.4 / 3.6 will edit this block in place. Pinned Decision #4 / same rationale as the 3.2 precedent.
6. **`TAB_VALUES` extracted at module scope** — discharges the Story 3.2 code-review deferred item ("Magic string `'analytics'` duplicated across ≥ 4 sites"). The literal `'analytics'` now appears exactly once (inside the `TAB_VALUES` object) — all 6 call sites (`activeTab` derivation, `handleTabChange`'s 1 branch, 2 × `TabsTrigger value`, 2 × `TabsContent value`) reference `TAB_VALUES.content` / `TAB_VALUES.analytics`. `TabValue` type narrows correctly. Not exported — module-scope single-consumer (Pinned Decision #6).
7. **Révoquer button is a no-op** — no `onClick`, no `disabled`, no `aria-disabled`. Story 3.6 wires the AlertDialog confirm flow + state lift + MetricCard decrement. A silent no-op is the cleanest contract — same precedent as 3.2's Partager button (Pinned Decision #5).
8. **Partager button unchanged from 3.2** — still a no-op; Story 3.5 wires it to open the D5 Sheet.
9. **Contenu tab unchanged** — AC13 regression guard: only the `TAB_VALUES.content` literal substitution touched the Contenu panel. The 2.6 section list + `DossierField` rendering and the empty-content fallback copy (`Ce dossier n'a pas encore de contenu renseigné.`) are pixel-identical.
10. **H1 focus-on-mount recipe preserved** — `useEffect(() => headingRef.current?.focus(), [slug])`. Dep array is `[slug]`, NOT `[slug, activeTab]` (Pinned Decision #7 from Story 3.2 — tab changes must not yank focus back to the H1). Navigating to a different dossier re-fires the focus; toggling tabs does not.
11. **Shell breadcrumb suppression preserved** — `router.tsx` untouched (verified via `git diff`). The pre-existing `handle: { hideBreadcrumb: true }` on the view route still suppresses the shell `Breadcrumbs` component; the route renders its own 2-segment breadcrumb locally. Breadcrumb reads `Dossiers / Biosensio` — NO third segment for analytics (AC7 / epic line 691).
12. **Accessibility:**
    - 3 × `<article>` `MetricCard` landmarks with `aria-label="{label} : {value}"` (e.g., "Destinataires actifs : 2").
    - H1 → H2 heading outline (`Biosensio` → `Accès & partage`) on the Analytics tab.
    - Per-row Révoquer buttons carry `aria-label="Révoquer l'accès de {email}"` — generic visible label + per-row accessible name.
    - `StatusDot` coloured circle is `aria-hidden="true"`; the adjacent text label (`Actif` / `En attente` / `Révoqué`) carries the state. The wrapping `<span>` has `aria-label="Statut : {state}"` so screen readers announce a semantic "Status" prefix.
    - Initials circle is `aria-hidden="true"` — the adjacent email is the accessible name.
    - Colour is never the only signal: text label + 55 % opacity on revoked + distinct colour → three orthogonal signals (WCAG 1.4.1).
    - Révoquer button has `min-h-11` className override — pushes the `Button` `size="sm"` (36 px body) to a 44 × 44 outer tap target (WCAG 2.5.5 AAA).
13. **Pre-existing build failure fixed as a hard prerequisite** — removed the unused `import * as React from "react"` from `components/ui/tabs.tsx`. The import was added by Story 3.2's code-review as a "sibling-parity" patch (with `sheet.tsx`) but `tabs.tsx` never used the `React` namespace, and `tsc -b` (stricter than `tsc --noEmit` used by `typecheck`) rejects it under `noUnusedLocals`. Not a 3.3 regression — confirmed by stashing the 3.3 changes and running `pnpm turbo run build` on pristine HEAD (identical failure). Including in the story's scope because no prior task could start without a green build. Other `components/ui/*.tsx` files retain `import * as React` because they legitimately consume `React.ComponentProps` / `React.*` types.
14. **All 13 ACs verified against implementation:**
    - AC1 (3-column MetricCard grid with `2 / 7 / 4m 32s` values from fixture) ✓ — [apps/web/src/routes/dashboard/dossiers/[slug].tsx:181-190](../../../../../apps/web/src/routes/dashboard/dossiers/%5Bslug%5D.tsx#L181-L190).
    - AC2 (MetricCard anatomy: article with label + value + optional sub-label, recipe at Task 1) ✓ — [apps/web/src/components/confluent/MetricCard.tsx](../../../../../apps/web/src/components/confluent/MetricCard.tsx).
    - AC3 (grid `grid-cols-1 md:grid-cols-3 gap-4`) ✓ — [apps/web/src/routes/dashboard/dossiers/[slug].tsx:181](../../../../../apps/web/src/routes/dashboard/dossiers/%5Bslug%5D.tsx#L181).
    - AC4 (Accès & partage H2 + card container) ✓ — [apps/web/src/routes/dashboard/dossiers/[slug].tsx:192-201](../../../../../apps/web/src/routes/dashboard/dossiers/%5Bslug%5D.tsx#L192-L201).
    - AC5 (3 rows with specific emails / statuses / durations from fixture) ✓ — fixture [apps/web/src/data/mock-analytics.ts:33-55](../../apps/web/src/data/mock-analytics.ts#L33-L55); render [apps/web/src/routes/dashboard/dossiers/[slug].tsx:207-291](../../../../../apps/web/src/routes/dashboard/dossiers/%5Bslug%5D.tsx#L207-L291).
    - AC6 (inline placeholder rows, NOT AccessListRow / StatusDot components) ✓ — raw `<div>` / `<span>` JSX throughout the row block.
    - AC7 (breadcrumb stays 2-segment) ✓ — [apps/web/src/routes/dashboard/dossiers/[slug].tsx:113-130](../../../../../apps/web/src/routes/dashboard/dossiers/%5Bslug%5D.tsx#L113-L130) unchanged from 3.2.
    - AC8 (mobile: 1-column grid, rows stack with `flex-col sm:flex-row`) ✓.
    - AC9 (accessibility: aria-label on MetricCard / Révoquer / status span; aria-hidden on initials + StatusDot visual) ✓ — grep confirms 4 `aria-label` and 4 `aria-hidden` in the route.
    - AC10 (empty-state `Aucun destinataire pour le moment.`) ✓ — [apps/web/src/routes/dashboard/dossiers/[slug].tsx:202-205](../../../../../apps/web/src/routes/dashboard/dossiers/%5Bslug%5D.tsx#L202-L205).
    - AC11 (`TAB_VALUES` extraction, `'analytics'` appears once) ✓ — grep confirms exactly 1 hit each for `'analytics'` / `'content'`, both inside the `TAB_VALUES` literal.
    - AC12 (zero raw hex, single `'analytics'` literal, green typecheck / lint / build) ✓ — all grep checks return expected counts; builds green.
    - AC13 (Contenu tab unchanged beyond `TAB_VALUES.content` literal) ✓ — diff of Contenu panel JSX shows only the `value={TAB_VALUES.content}` substitution.
15. **No regression on Stories 1.1 – 3.2** — `router.tsx` untouched; Contenu panel identical beyond the `TAB_VALUES.content` literal; dashboard list route, wizard flow, shell layout, and breadcrumb suppression logic all untouched. `/dashboard/dossiers/view/jean-dupont-fictif` still renders the 2.6 "Dossier introuvable" fallback (early-return guard unchanged).
16. **Commit strategy:** single `feat(epic-3): story 3.3 — MetricCard grid & analytics timeline (D4)` commit bundling implementation + the `tabs.tsx` cleanup (per user memory preference "Code + review in a single commit").

### File List

**Created:**
- `apps/web/src/components/confluent/MetricCard.tsx` — design-system KPI display primitive. `<article>` + label + value + optional sub-label. Non-interactive. Props: `label`, `value`, `subLabel?`, `className?`.
- `apps/web/src/data/mock-analytics.ts` — static analytics fixture. Exports `MOCK_ANALYTICS`, plus the `AccessStatus`, `AccessEntry`, `AnalyticsMetric`, `Analytics` types. Slug-agnostic in 3.3; Story 8.3 will replace with a TanStack Query hook.

**Modified:**
- `apps/web/src/routes/dashboard/dossiers/[slug].tsx` — added module-scope `TAB_VALUES` + `TabValue` (discharges the 3.2 deferred `'analytics'` duplication debt). Added `MetricCard` / `MOCK_ANALYTICS` / `cn` imports. Rewrote the `<TabsContent value={TAB_VALUES.analytics}>` body from the 3.2 single-paragraph placeholder into the full D4 layout (MetricCard grid + Accès & partage section with inline access list). Substituted `TAB_VALUES.content` / `TAB_VALUES.analytics` at all 6 call sites. All 3.2 behaviours preserved: `useSearchParams` / `handleTabChange` logic, H1 focus-on-mount `[slug]`-keyed, Partager no-op, local 2-segment breadcrumb, early-return "Dossier introuvable" fallback.
- `apps/web/src/components/ui/tabs.tsx` — removed unused `import * as React from "react"` at line 6. The import was added by Story 3.2's code-review patch for "sibling-parity with `sheet.tsx`" but `tabs.tsx` never consumed the `React` namespace (zero `React.*` references); `tsc -b` under `noUnusedLocals` rejected it. Pre-existing failure on HEAD — not a 3.3 regression. Verified other `components/ui/*.tsx` files genuinely use `React.*` (sheet / card / avatar / input / sonner / label) and retain their imports.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — `3-3-metric-card-grid-analytics-timeline-d4` : `backlog` → `ready-for-dev` → `in-progress` → `review`; `last_updated` bumped to 2026-04-21.
- `_bmad-output/implementation-artifacts/3-3-metric-card-grid-analytics-timeline-d4.md` — story file: status `ready-for-dev` → `review`; all Tasks / Subtasks marked `[x]`; Debug Log / Completion Notes / File List / Change Log populated.

**Unchanged (verified — touched by no task):**
- `apps/web/src/router.tsx` (confirmed via `git diff` → empty; `hideBreadcrumb: true` on the view route preserved).
- `apps/web/src/data/mock-dossiers.ts` (consumed read-only by the route — `MockDossier` / `MOCK_DOSSIERS` not modified).
- `apps/web/src/data/questionnaire.ts` (consumed read-only by the Contenu panel — unchanged).
- `apps/web/src/components/layout/AppShell.tsx`, `apps/web/src/components/layout/Breadcrumbs.tsx`, `apps/web/src/components/layout/NavItem.tsx`, `apps/web/src/components/layout/nav-items.ts`.
- `apps/web/src/components/confluent/DossierCard.tsx`, `apps/web/src/components/confluent/DossierField.tsx`, `apps/web/src/components/confluent/EmptyState.tsx`, `apps/web/src/components/confluent/WizardInput.tsx`.
- `apps/web/src/components/ui/{avatar,badge,button,card,input,label,separator,sheet,sonner}.tsx`.
- `apps/web/src/lib/*`, `apps/web/src/features/*`.
- `apps/web/src/routes/dashboard/index.tsx`, `apps/web/src/routes/dashboard/tableau-de-bord.tsx`, `apps/web/src/routes/dashboard/dossiers/nouveau/*`.

### Change Log

- 2026-04-21 — Implementation landed. 2 new files (`MetricCard.tsx`, `mock-analytics.ts`); 2 modified files (`[slug].tsx` analytics body + `TAB_VALUES` extraction, `tabs.tsx` unused React import removed). All 13 ACs satisfied; typecheck / lint / build green; self-review sweep clean. Status moved to `review`.

