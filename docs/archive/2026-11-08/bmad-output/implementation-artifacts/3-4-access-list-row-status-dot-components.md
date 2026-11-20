# Story 3.4: AccessListRow & StatusDot Components

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a developer,
I want reusable `AccessListRow` and `StatusDot` components that accurately reflect recipient states,
so that access data is legible and actionable across all views.

## Acceptance Criteria

1. **Given** a new `StatusDot` component at [apps/web/src/components/confluent/StatusDot.tsx](apps/web/src/components/confluent/StatusDot.tsx), **When** a developer imports and renders `<StatusDot status="active" />`, **Then** the output is a single inline `<span>` wrapper containing:
   - A 7 px circular sibling `<span>` with `aria-hidden="true"` and background `var(--status-active)` (`#4CAF7D` — green).
   - Label text `"Actif"` rendered verbatim next to the dot.
   - The outer wrapper carries `aria-label="Statut : Actif"` so screen readers announce the status regardless of whether the dot is styled visible.
   Color is never used alone per UX-DR and AC9 — the visible label + colour + `aria-label` are three orthogonal signals.

2. **Given** `<StatusDot status="pending" />`, **When** inspected, **Then** the dot background is `var(--status-pending)` (`#F0A830` — orange), the visible label is `"En attente"`, and the `aria-label` is `"Statut : En attente"`.

3. **Given** `<StatusDot status="revoked" />`, **When** inspected, **Then** the dot background is `var(--status-neutral)` (`#B0B0B0` — neutral grey), the visible label is `"Révoqué"`, and the `aria-label` is `"Statut : Révoqué"`.

4. **Given** the `StatusDot` component, **When** a developer inspects the prop contract, **Then** it is EXACTLY:
   ```ts
   export type StatusValue = 'active' | 'pending' | 'revoked'
   export interface StatusDotProps {
     status: StatusValue
     className?: string
   }
   ```
   No `color` prop, no `size` prop, no `label` override prop — the component is a closed enum over the three project statuses. If a future surface needs a fourth status (`'expired'`, `'archived'`, …), the union widens and the internal `STATUS_COPY` map widens in lockstep. Callers may add layout utilities via `className` (e.g. `ml-auto`, `shrink-0`) but cannot override the label text or dot colour.

5. **Given** a new `AccessListRow` component at [apps/web/src/components/confluent/AccessListRow.tsx](apps/web/src/components/confluent/AccessListRow.tsx), **When** a developer imports and renders one row, **Then** its prop contract is EXACTLY:
   ```ts
   import type { AccessEntry } from '@/data/mock-analytics'

   export interface AccessListRowProps {
     entry: AccessEntry
     onRevokeClick?: (entry: AccessEntry) => void
     className?: string
   }
   ```
   - `entry` is the existing discriminated union from [apps/web/src/data/mock-analytics.ts](apps/web/src/data/mock-analytics.ts) (`{ status: 'active' | 'pending' } | { status: 'revoked'; revokedAt: string }`). Do NOT redeclare a flatter local type — re-export or reuse the `AccessEntry` symbol.
   - `onRevokeClick` is OPTIONAL and UN-WIRED in Story 3.4 (Story 3.6 ships the revocation flow with AlertDialog + optimistic update). The AC5 contract STILL accepts the prop so 3.6's patch is additive — the component signature does not change between 3.4 and 3.6. See Pinned Decision #1.
   - No `showStatusDot` / `compact` / `hideAvatar` variant flags. The component renders exactly the anatomy described by AC6-AC11 — no variants.

6. **Given** an `AccessListRow` with an active entry (e.g. `arc@capital.fr`, `initials: 'AC'`, `sessionDuration: '6m 14s'`, `lastSeen: 'Dernière session : il y a 2 jours · 3 vues'`), **When** it renders, **Then** it produces a single `<li>` element with the following descendants in this exact order (left → right on desktop, top → bottom on mobile):
   - **Avatar** — shadcn `<Avatar>` + `<AvatarFallback>` at the default `size-8` (32 px). Fallback text is `entry.initials` (2 upper-case letters). The Avatar has `aria-label={entry.email}` on the root so VoiceOver announces the recipient before reading the body.
   - **Email** — `<p className="truncate text-sm font-medium text-foreground" title={entry.email}>` showing `entry.email`. The `title` attribute restores the full address when `truncate` clips characters — preserves the 3.3 self-applied review patch.
   - **Last seen / invitation detail** — `<p className="truncate text-xs text-muted-foreground">` showing `entry.lastSeen`. `truncate` matches the sibling email to prevent vertical misalignment on narrow widths — preserves the 3.3 self-applied review patch.
   - **Session duration** — `<span className="text-[22px] font-bold text-foreground tabular-nums">` showing `entry.sessionDuration`. The `22 px / 700 weight / tabular-nums` recipe matches the Epic AC + UX spec (AccessListRow anatomy "session duration at 22px / font-weight 700 right-aligned").
   - **StatusDot** — `<StatusDot status={entry.status} />` (active → green dot + "Actif"). Renders OUTSIDE the dimmed content region on revoked rows — see AC10.
   - **Revoke button** — shadcn `<Button variant="outline" size="sm">Révoquer</Button>` with `aria-label={`Révoquer l'accès de ${entry.email}`}` and `className="min-h-11 border-border hover:border-destructive hover:bg-transparent hover:text-destructive"`. The min-height keeps the tap target ≥ 44 px per WCAG 2.5.5; the hover override flips border + text to destructive on hover WITHOUT swapping to the filled destructive variant's `bg-destructive/10` surface — UX spec: "border and text shift to status-destructive" on hover, never red at rest. See AC12.

7. **Given** an `AccessListRow` with `status="pending"` (e.g. `martin@fund.io`, `initials: 'MF'`, `sessionDuration: '—'`, `lastSeen: 'Invitation envoyée il y a 3 h'`), **When** it renders, **Then**:
   - The avatar + email + lastSeen + status + Révoquer button chrome matches AC6.
   - The session duration slot renders `"—"` in a muted treatment: `<span className="text-[22px] font-normal text-muted-foreground tabular-nums">—</span>` — weight steps from `font-bold` (AC6) to `font-normal`, colour steps from `text-foreground` to `text-muted-foreground`. Rationale: a 22 px bold em-dash implies "0m 00s" at a glance (deferred-work entry from 3.3 code review — "Pending entry's em-dash sessionDuration renders at same 22 px bold weight as real durations"). The muted-weight variant unambiguously reads as "no session yet". See Pinned Decision #2.
   - The `StatusDot` status is `"pending"` (orange dot + `"En attente"` label).
   - The Révoquer button is visible — pending invitations are revocable.

8. **Given** an `AccessListRow` with `status="revoked"` (e.g. `lea@invest.com`, `initials: 'LI'`, `sessionDuration: '3m 41s'`, `lastSeen: 'Dernière session : il y a 5 jours · 2 vues'`, `revokedAt: '16 avr. 2026'`), **When** it renders, **Then**:
   - The avatar + email + lastSeen block renders at 55 % opacity (`opacity-[0.55]`) — per UX spec "Revoked: full row at 55% opacity".
   - The session duration renders `"3m 41s"` using the same `font-bold / text-foreground / tabular-nums` recipe as AC6, but inside the dimmed content region (so cascades to 55 % opacity).
   - The Révoquer button is REPLACED by `<span className="text-xs text-muted-foreground">Révoqué le {entry.revokedAt}</span>` — renders inside the dimmed region.
   - The `StatusDot` renders OUTSIDE the 55 %-opacity region at full opacity — see AC10 for the structural rationale.

9. **Given** an `AccessListRow` in any state, **When** a developer inspects the DOM, **Then** the outer element is a `<li>` (not `<div>`) — the row is intended to sit inside the parent's `<ul role="list">` access list container preserved from Story 3.3's self-applied review patch. The component does NOT render its own `<ul>` wrapper; the caller is responsible for wrapping N rows in a single `<ul>` / list container.

10. **Given** the revoked-row AC8 structure, **When** a developer inspects the row for WCAG 3:1 non-text contrast compliance on the StatusDot, **Then** the `StatusDot` sits OUTSIDE any `opacity-[0.55]` wrapper so the grey `--status-neutral` dot (`#B0B0B0`) renders against the card background at full opacity — ~2:1 contrast as shipped, NOT the ~1.3:1 that the cascaded 55 % opacity produced in Story 3.3 (deferred-work entry from 3.3 code review — "Revoked row's `opacity-[0.55]` dims the grey `--status-neutral` dot below WCAG 3:1 non-text contrast"). Structurally this means the `<li>` wraps TWO sibling regions: (a) a dimmed content region (avatar + email + lastSeen on the left; session duration + "Révoqué le {date}" on the right for revoked) with `opacity-[0.55]` applied conditionally on revoked, and (b) an un-dimmed status region containing the `StatusDot` (+ Révoquer button for active/pending). The row-level divider (`border-t border-border` on `index > 0`) lives on the `<li>` itself, unaffected by the inner opacity. See Pinned Decision #3 for the exact JSX skeleton.

11. **Given** responsive layout, **When** the row is viewed at < 640 px (Tailwind `sm` breakpoint — mobile), **Then** the `<li>` stacks content with `flex flex-col gap-3`. **When** viewed at ≥ 640 px (`sm:` and up), **Then** it switches to `sm:flex-row sm:items-center sm:justify-between`, producing the avatar-group on the left and duration+StatusDot+button cluster on the right with space-between. At the 320 px minimum viewport, no horizontal scrollbar appears on the parent container — `truncate` on email + lastSeen and `min-w-0` on the flex children absorb long strings.

12. **Given** the Révoquer button's hover treatment (AC6), **When** a developer inspects the interaction matrix, **Then**:
    - At rest: `border-border` (neutral grey) + `text-foreground` (near-black) on transparent background — the button is NOT red at rest.
    - On hover: `border-destructive` + `text-destructive` on transparent background — exactly the UX spec's "border and text shift to `status-destructive` (`#E57373`)". NO fill colour swap, NO `bg-destructive/10`, NO opacity change on the button.
    - On focus-visible: the standard shadcn `focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50` ring inherited from `buttonVariants` — the hover override does NOT break the focus ring recipe.
    - No layout shift between rest and hover (both states are 1 px border on the same element).
    See Pinned Decision #4.

13. **Given** the `onRevokeClick` prop (AC5), **When** a developer audits the 3.4 integration at the call site in [apps/web/src/routes/dashboard/dossiers/[slug].tsx](apps/web/src/routes/dashboard/dossiers/[slug].tsx), **Then** the prop is NOT passed — the route renders `<AccessListRow entry={entry} />` WITHOUT `onRevokeClick`. The button inside the component is wired as `<Button ... onClick={onRevokeClick ? () => onRevokeClick(entry) : undefined} disabled={!onRevokeClick ? undefined : undefined}>`. Neither `onClick={undefined}` nor `disabled={true}` — the click is a no-op, the button remains keyboard-focusable, exactly matching the Story 3.3 behaviour (deferred to 3.6 for the real wiring). See Pinned Decision #5.

14. **Given** [apps/web/src/routes/dashboard/dossiers/[slug].tsx](apps/web/src/routes/dashboard/dossiers/[slug].tsx) after the 3.4 swap, **When** a developer inspects the analytics `<TabsContent value={TAB_VALUES.analytics}>` body, **Then** the inline row markup (lines 214-293 in the current file — the `<ul role="list">` plus its `<li>` children plus every inline StatusDot ternary) is REPLACED by:
    ```tsx
    <ul role="list" className="m-0 list-none p-0">
      {MOCK_ANALYTICS.accessEntries.map((entry) => (
        <AccessListRow key={entry.email} entry={entry} />
      ))}
    </ul>
    ```
    plus the `border-t border-border` divider is internalised INSIDE `AccessListRow` (see AC15), NOT in the `.map()` callback. The route imports `AccessListRow` from `@/components/confluent/AccessListRow`; it NO LONGER imports `cn` (the `cn` usage at the row level is gone — the only remaining `cn` caller on this route would be the row, which now lives in its own file). Run `grep -n "from '@/lib/utils'"` on the route after the swap: expect ZERO matches.

15. **Given** `AccessListRow`, **When** N rows are rendered as siblings inside a parent `<ul>`, **Then** each row other than the first renders a `border-t border-border` top border — implementing the "inter-row divider" visual from Story 3.3. The component achieves this via a CSS sibling selector at the parent level (`[&_li+li]:border-t [&_li+li]:border-border` on the `<ul>`), OR via a `first:` / `not-first:` variant on the `<li>` itself (`className="... not-[:first-child]:border-t not-[:first-child]:border-border"`), OR via a `:where(li):not(:first-of-type)` pattern. Any of these three approaches is acceptable — the key constraint is that the caller does NOT have to pass an `index` prop to get divider placement right (the Story 3.3 `index > 0 && 'border-t border-border'` pattern is abolished by the extraction). See Pinned Decision #6.

16. **Given** the Story 3.3 `data/mock-analytics.ts` fixture and its `AccessEntry` discriminated union, **When** `AccessListRow` type-checks against a `status: 'revoked'` entry, **Then** TypeScript statically guarantees `entry.revokedAt` is `string` (not `string | undefined`) — the discriminated union narrows correctly inside the component. Conversely, passing a `{ status: 'active', revokedAt: '...' }` literal is a type error (extra property). Do NOT change the `AccessEntry` shape — the union is already correct from the 3.3 self-applied review patch.

17. **Given** the `MetricCard` component, the `mock-analytics` fixture, the `TAB_VALUES` / `TabValue` pair, and the route's `handleTabChange` / `activeTab` logic from Stories 3.2 and 3.3, **When** a developer diffs [apps/web/src/routes/dashboard/dossiers/[slug].tsx](apps/web/src/routes/dashboard/dossiers/[slug].tsx), **Then** the ONLY changes are: (a) remove the inline row JSX + its `cn` helper usage; (b) add an `import { AccessListRow } from '@/components/confluent/AccessListRow'`; (c) replace the `.map()` body with the one-liner from AC14. NO changes to the `MetricCard` grid, the `<h2>Accès & partage</h2>`, the `overflow-hidden rounded-lg border border-border bg-card` card container, the empty-state branch (AC10 in 3.3), the H1 / breadcrumb / Partager button / Tabs wiring / Contenu panel. See AC19 for the regression guard sweep.

18. **Given** the analytics panel, **When** a developer runs the Task 4 verification sweep, **Then**:
    - `grep -nE '#[0-9a-fA-F]{3,6}'` across the NEW `StatusDot.tsx` + `AccessListRow.tsx` + the MODIFIED `[slug].tsx` returns ZERO matches — every colour surface routes through `--status-*` / `bg-card` / `border-border` / `text-foreground` / `text-muted-foreground` / `border-destructive` / `text-destructive` design tokens.
    - `grep -n "Actif\|En attente\|Révoqué" apps/web/src/routes/dashboard/dossiers/\[slug\].tsx` returns ZERO matches in the route — all three status labels live EXCLUSIVELY inside `StatusDot.tsx` (no duplication between the component and its caller).
    - `grep -n "'analytics'\|'content'" apps/web/src/routes/dashboard/dossiers/\[slug\].tsx` STILL returns exactly one match for each — the `TAB_VALUES` constant from 3.3 is unchanged.
    - `pnpm turbo run typecheck` / `lint` / `build` are all green with ZERO new warnings beyond the 3 tolerated pre-existing ones (`badge.tsx:52`, `button.tsx:58`, `features/current-user/context.tsx:17`). The 3.2 deferred "unused `TabsIndicator` export" from `tabs.tsx` stays as it landed in 3.3 (pinned).

19. **Given** the full page at `/dashboard/dossiers/view/biosensio?tab=analytics` after the 3.4 swap, **When** a developer performs a visual-regression walkthrough alongside the Story 3.3 baseline, **Then** the rendered output is PIXEL-EQUIVALENT for active and pending rows (same avatar, email, lastSeen, 22 px duration, StatusDot, Révoquer button), and VISUALLY CLOSE for the revoked row — the only permitted delta from 3.3 is that the revoked row's `StatusDot` now renders at 100 % opacity (previously cascaded to 55 % opacity — AC10's non-text contrast fix). No other visible change. The `Contenu` tab, the H1, the breadcrumb, the Partager button, the `MetricCard` grid, and the `Accès & partage` H2 are all pixel-equivalent to 3.3.

20. **Given** a keyboard + screen-reader user on `?tab=analytics`, **When** they navigate the analytics panel, **Then**:
    - Tab order: breadcrumb link → Partager → Contenu tab → Accès & analytics tab (active) → first Révoquer button (row 1) → second Révoquer button (row 2). Row 3 (revoked) has NO Révoquer button — focus skips to the document end.
    - Each `MetricCard` is announced as an article landmark with label `Destinataires actifs : 2` / etc. (unchanged from 3.3).
    - Each `AccessListRow` avatar has `aria-label={entry.email}` — VoiceOver rotor announces the recipient email as an avatar label before reading the row body.
    - Each `StatusDot` wrapper is announced as `"Statut : Actif"` / `"Statut : En attente"` / `"Statut : Révoqué"` — verbatim copy lives in `STATUS_COPY` inside `StatusDot.tsx`.
    - Each Révoquer button has `aria-label={`Révoquer l'accès de ${entry.email}`}` — AT reads the per-row context.
    - The `<ul role="list">` parent announces as "list, 3 items" on entry — preserved from the 3.3 self-applied review patch.
    - Colour is never the sole signal: active/pending/revoked each have a distinct text label, and the revoked row additionally has reduced opacity on its content region — three orthogonal signals.

## Tasks / Subtasks

- [x] **Task 1: Create the `StatusDot` design-system primitive (AC: 1, 2, 3, 4, 20)**
  - [x] Create `apps/web/src/components/confluent/StatusDot.tsx`. Named exports only (`StatusDot`, `StatusValue`, `StatusDotProps`). No default export. Mirrors the sibling pattern of `MetricCard.tsx` / `DossierField.tsx`.
  - [x] Re-export the `AccessStatus` union from `mock-analytics.ts` as `StatusValue` (or create an identical local union — either is fine; prefer the re-export if it avoids a circular dependency). If re-exporting: `export type { AccessStatus as StatusValue } from '@/data/mock-analytics'`. Rationale: Story 8.3 replaces `mock-analytics.ts` with a real-API shape; the `StatusDot` must keep working against whatever union the server emits, so coupling the two via re-export is correct.
  - [x] Internal `STATUS_COPY` lookup — a `Record<StatusValue, { label: string; dotClass: string }>` with the three project statuses. ALL three strings (`'Actif'`, `'En attente'`, `'Révoqué'`) live HERE exclusively — no inline ternaries at the call site. Copy verbatim from the UX spec / Epic AC.
  - [x] Render the outer wrapper `<span>` as `inline-flex items-center gap-1.5 text-sm text-muted-foreground` with `aria-label={`Statut : ${label}`}` — this is the text the screen reader announces; the 14 px body text carries the visible state to sighted users.
  - [x] Render the dot as an inner `<span aria-hidden="true" className="inline-block size-[7px] rounded-full" ... />` with a `cn()` call that adds the per-status background class from `STATUS_COPY`. `aria-hidden` on the dot because the outer wrapper's `aria-label` already conveys the state — the dot would announce as a redundant empty region.
  - [x] Accept a `className` prop on the outer wrapper via `cn(defaultClasses, className)` — callers can add `ml-auto`, `shrink-0`, layout utilities, but cannot override colour or label.
  - [x] Do NOT accept `color`, `size`, `label`, or `children` props — closed API, three states, nothing else. See Pinned Decision #7.

- [x] **Task 2: Create the `AccessListRow` design-system component (AC: 5–13, 15, 20)**
  - [x] Create `apps/web/src/components/confluent/AccessListRow.tsx`. Named exports only (`AccessListRow`, `AccessListRowProps`). No default export.
  - [x] Imports:
    ```tsx
    import { Avatar, AvatarFallback } from '@/components/ui/avatar'
    import { Button } from '@/components/ui/button'
    import { StatusDot } from '@/components/confluent/StatusDot'
    import { cn } from '@/lib/utils'
    import type { AccessEntry } from '@/data/mock-analytics'
    ```
    Do NOT import `AvatarImage` (no image fallback in the mocked fixture and 8.3's real API schema has no avatar URL — see `architecture.md` line 297-315: `share_links.recipient_email` is the only identity surface). Do NOT import React; the component uses no hooks.
  - [x] Define `AccessListRowProps` exactly as AC5 mandates. Export the interface.
  - [x] Render the outer `<li>` with:
    ```tsx
    <li
      className={cn(
        'flex flex-col gap-3 px-4 py-3 not-[:first-child]:border-t not-[:first-child]:border-border sm:flex-row sm:items-center sm:justify-between',
        className,
      )}
    >
    ```
    The `not-[:first-child]` arbitrary variant is the preferred implementation of AC15 — it keeps the divider decision colocated with the row and does NOT require the caller to pass `index`. Validate in the Task 4 manual walkthrough that this Tailwind v4 syntax compiles on the project's Tailwind version (it does — Tailwind v4 supports arbitrary CSS variants via `[&:not(:first-child)]:`).
  - [x] Inner structure — exactly two flex-child regions per Pinned Decision #3:
    ```tsx
    {/* Region 1 — dimmed on revoked */}
    <div
      className={cn(
        'flex min-w-0 items-center gap-3',
        entry.status === 'revoked' && 'opacity-[0.55]',
      )}
    >
      <Avatar aria-label={entry.email}>
        <AvatarFallback>{entry.initials}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <p
          className="truncate text-sm font-medium text-foreground"
          title={entry.email}
        >
          {entry.email}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {entry.lastSeen}
        </p>
      </div>
    </div>

    {/* Region 2 — split: duration stays with region 1's dim for revoked; status + button stay un-dimmed */}
    <div className="flex items-center justify-between gap-4 sm:justify-end">
      <span
        className={cn(
          'tabular-nums text-[22px]',
          entry.status === 'pending'
            ? 'font-normal text-muted-foreground'
            : 'font-bold text-foreground',
          entry.status === 'revoked' && 'opacity-[0.55]',
        )}
      >
        {entry.sessionDuration}
      </span>
      <StatusDot status={entry.status} />
      {entry.status === 'revoked' ? (
        <span className="text-xs text-muted-foreground opacity-[0.55]">
          Révoqué le {entry.revokedAt}
        </span>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label={`Révoquer l'accès de ${entry.email}`}
          onClick={onRevokeClick ? () => onRevokeClick(entry) : undefined}
          className="min-h-11 border-border hover:border-destructive hover:bg-transparent hover:text-destructive"
        >
          Révoquer
        </Button>
      )}
    </div>
    ```
    Key points to preserve:
    - `aria-label={entry.email}` on `<Avatar>` — the Avatar root is the 32 px circle with the `after:border` chrome; the fallback text IS the visible initials, but screen readers need the full email per WAI-ARIA "image name" convention. The discriminated-union narrowing means TS knows `entry.revokedAt` is `string` inside the `status === 'revoked'` branch — no `!` assertion, no `?? ''` fallback.
    - `opacity-[0.55]` cascades only down the two dimmed sub-regions (avatar+email+lastSeen on the left; session duration span + `Révoqué le` span on the right). The `StatusDot` is a sibling OUTSIDE both dimmed regions — preserves AC10 at 100 % opacity.
    - The pending em-dash gets `font-normal text-muted-foreground`, active+revoked durations get `font-bold text-foreground` — per AC7 and Pinned Decision #2.
    - The Révoquer button's hover override uses `border-border hover:border-destructive hover:bg-transparent hover:text-destructive` — the `hover:bg-transparent` explicitly neutralises the shadcn outline variant's default `hover:bg-muted hover:text-foreground` (see [apps/web/src/components/ui/button.tsx:13](apps/web/src/components/ui/button.tsx#L13)) which otherwise conflicts.
  - [x] The `<Avatar>` component is the shadcn wrapper at [apps/web/src/components/ui/avatar.tsx](apps/web/src/components/ui/avatar.tsx) — size `default` (32 px). AvatarFallback already applies `bg-muted text-muted-foreground`, matching the UX spec's "initials circle". Do NOT swap back to the raw `<span>` initials recipe from Story 3.3 — 3.3 explicitly marked "Story 3.4 may swap this for the shadcn `Avatar` + `AvatarFallback` recipe" as the forward path, and the shadcn Avatar adds a subtle `after:border` chrome that reads cleanly against the `bg-card` container without a hex value. See Pinned Decision #8.
  - [x] Do NOT render the outer `<ul>`. The caller wraps N rows in a single `<ul role="list">` at the [slug].tsx site — the component is the `<li>` only. AC9 + AC14.

- [x] **Task 3: Rewire the analytics panel body in `routes/dashboard/dossiers/[slug].tsx` to consume the new components (AC: 14, 17, 18, 19, 20)**
  - [x] Edit [apps/web/src/routes/dashboard/dossiers/[slug].tsx](apps/web/src/routes/dashboard/dossiers/[slug].tsx). Preserve ALL of Stories 3.1 / 3.2 / 3.3 intact EXCEPT the rewrite inside `<TabsContent value={TAB_VALUES.analytics}>`.
  - [x] Add ONE new import at the top:
    ```tsx
    import { AccessListRow } from '@/components/confluent/AccessListRow'
    ```
    Sort alphabetically within the existing import group — `AccessListRow` comes before `DossierField` by the `components/confluent/*` convention (`A` < `D` < `M`).
  - [x] REMOVE the `import { cn } from '@/lib/utils'` line — after AC14 the route no longer calls `cn`. Verify with `grep -n "cn(" apps/web/src/routes/dashboard/dossiers/\[slug\].tsx` → ZERO matches. Do NOT leave a dangling import (the lint rule `unused-imports/no-unused-imports` will flag it, but remove explicitly rather than trusting the lint pass).
  - [x] REPLACE the block currently at lines 213-293 (the `<ul role="list">` plus every `<li>` child with its inline ternaries) with:
    ```tsx
    <ul role="list" className="m-0 list-none p-0">
      {MOCK_ANALYTICS.accessEntries.map((entry) => (
        <AccessListRow key={entry.email} entry={entry} />
      ))}
    </ul>
    ```
    That is it — no `onRevokeClick` passed, no extra prop, no wrapper. The divider is internal to `AccessListRow` (AC15). The opacity + dot-colour + label recipe is internal to `AccessListRow` + `StatusDot`. The button hover is internal to `AccessListRow`.
  - [x] Keep the empty-state branch (`MOCK_ANALYTICS.accessEntries.length === 0`) unchanged — it is still owned by the route (the `Aucun destinataire pour le moment.` copy is an analytics-panel-level concern, not an AccessListRow concern).
  - [x] Do NOT extract an `AccessList` component that wraps the `<ul>` + empty-state. It is a ~10-line block inside a single call site; the component-extraction judgment from 3.3's Pinned Decision #4 still holds — extract only when the boundary is visible or a second caller emerges. See Pinned Decision #9.

- [x] **Task 4: Verify + guardrails (AC: 1–20)**
  - [x] `pnpm turbo run typecheck` → 2 successful, 0 errors. Verify the discriminated union narrows correctly inside `AccessListRow`'s `status === 'revoked'` branch — `entry.revokedAt` should resolve as `string`, not `string | undefined`.
  - [x] `pnpm turbo run lint` → 0 errors. Preserve exactly 3 pre-existing warnings (`badge.tsx:52`, `button.tsx:58`, `features/current-user/context.tsx:17`). Both new files (`StatusDot.tsx`, `AccessListRow.tsx`) must lint clean — named exports only, no default export, no mixed exports that trip `react-refresh/only-export-components`. The `AccessListRowProps` + `AccessListRow` pair and the `StatusDotProps` + `StatusDot` + `StatusValue` trio match the `DossierField` / `MetricCard` shape that already lints clean.
  - [x] `pnpm turbo run build` → 2 successful, 0 errors. Expected bundle delta vs 3.3 baseline: approximately net-zero — the two new files add ~80 LOC between them, while `[slug].tsx` loses ~80 LOC from the extraction. CSS: likely small reduction (the inline ternary class strings collapse into shared utility reuse inside the components).
  - [x] Self-review grep: `grep -nE '#[0-9a-fA-F]{3,6}' apps/web/src/components/confluent/StatusDot.tsx apps/web/src/components/confluent/AccessListRow.tsx apps/web/src/routes/dashboard/dossiers/\[slug\].tsx` → ZERO matches (AC18).
  - [x] Self-review grep: `grep -n "Actif\|En attente\|Révoqué" apps/web/src/routes/dashboard/dossiers/\[slug\].tsx` → ZERO matches in the route (AC18).
  - [x] Self-review grep: `grep -n "Actif\|En attente\|Révoqué" apps/web/src/components/confluent/StatusDot.tsx` → EXACTLY 3 matches (one per status label in `STATUS_COPY`).
  - [x] Self-review grep: `grep -n "Révoquer l'accès de\|Révoqué le" apps/web/src/components/confluent/AccessListRow.tsx` → EXACTLY one match for each (per-row revoke aria-label, per-revoked-row date). `grep -n "Révoquer l'accès de\|Révoqué le" apps/web/src/routes/dashboard/dossiers/\[slug\].tsx` → ZERO matches (AC18).
  - [x] Self-review grep: `grep -n "'analytics'\|'content'" apps/web/src/routes/dashboard/dossiers/\[slug\].tsx` → EXACTLY one match for each (inside the `TAB_VALUES` declaration — 3.3 guarantee, unchanged by 3.4).
  - [x] Self-review grep: `grep -n "from '@/lib/utils'" apps/web/src/routes/dashboard/dossiers/\[slug\].tsx` → ZERO matches (AC14 — `cn` import removed).
  - [x] `pnpm turbo run dev` manual walkthrough (tri-viewport: 375 / 900 / 1440 px):
    1. Navigate to `/dashboard/dossiers/view/biosensio?tab=analytics`. Verify: (a) `MetricCard` grid unchanged (`2 / 7 / 4m 32s`); (b) `Accès & partage` H2 unchanged; (c) three rows render with the SAME visible anatomy as Story 3.3 — active row (arc@capital.fr, `6m 14s`, green dot, Révoquer button), pending row (martin@fund.io, `—` in muted weight, orange dot, Révoquer button), revoked row (lea@invest.com, `3m 41s`, neutral dot at 100 % opacity, `Révoqué le 16 avr. 2026` text in place of the button).
    2. Pixel-diff sanity against a 3.3 snapshot (or side-by-side with `git stash` + reload): active / pending rows SHOULD be pixel-equivalent. Revoked row: the neutral grey dot should visibly "pop" ~2× brighter than 3.3 (100 % vs 55 % opacity cascade) — this is the AC10 fix, intentional.
    3. Hover the Révoquer button on row 1. Verify: border transitions to `#E57373` (destructive token), text transitions to `#E57373`, background STAYS transparent (no fill), no layout shift. Move off: returns to `#E8E8E7` border + `#1A1A1A` text. DevTools computed styles: `border-color` and `color` should update; `background-color` should stay `transparent` in both states.
    4. Keyboard: Tab to the Révoquer button on row 1. Focus ring = the shadcn default (2 px `--ring` + offset). Press Enter. Verify: no crash, no console error, nothing visible happens (3.4 intentionally leaves `onRevokeClick` unpassed — 3.6 wires the handler). Same for row 2. Row 3 (revoked) has no Révoquer button — Tab skips directly out of the row.
    5. Screen reader (VoiceOver / NVDA): navigate the `<ul>`. Expect: `"list, 3 items"` on entry; per-row, `"AC, image, arc@capital.fr"` (or similar — Avatar `aria-label` is the email) then `"arc@capital.fr, truncated text"` or the full email via the `title`-attribute fallback, then `"Dernière session : il y a 2 jours · 3 vues"`, then `"6m 14s"`, then `"Statut : Actif"`, then `"Révoquer l'accès de arc@capital.fr, button"`.
    6. Mobile (375 px): rows stack — avatar+email+lastSeen on top, duration+StatusDot+button below. No horizontal scrollbar at 320 px. The truncation on email + lastSeen engages as the viewport narrows.
    7. Mobile (320 px extreme): probe a long email by temporarily setting `MOCK_ANALYTICS.accessEntries[0].email = 'premier-long-nom.destinataire@un-fonds-dinvestissement-avec-un-nom-tres-long.invest'`. Verify the email truncates with ellipsis, the duration+StatusDot+button remain fully visible. Restore the fixture.
    8. Empty-analytics probe: temporarily set `accessEntries: []`. Verify `Aucun destinataire pour le moment.` copy renders centered — preserved from 3.3. The MetricCard grid still renders above. Restore the fixture.
    9. Revoked-dot contrast check: with the dev page open, use a browser colour-picker (e.g., Chrome DevTools → inspect the revoked row's `size-[7px]` dot) to sample the dot background. Expected: `#B0B0B0` (neutral grey) at full opacity — NOT `rgba(176, 176, 176, 0.55)`. Confirms AC10.
    10. Pending em-dash check: inspect row 2's session duration — it should render at `font-normal` weight in `text-muted-foreground`, visibly lighter than row 1's bold `6m 14s`. If it still reads as "0m 00s" at a glance, the typography patch did not land — revisit Task 2's `span` block.
    11. Axe audit on Analytics tab: expect 0 serious, 0 critical violations. "Element has insufficient color contrast" should NOT fire on the revoked row's dot (that was the 3.3 latent issue; 3.4 fixes it by hoisting the dot out of the dimmed region).
    12. Axe audit on Révoquer button hover state: axe-core does not automatically sample `:hover`, but the 4.5:1 contrast check at rest (near-black text on white) and at hover (destructive red text on white — `#E57373` on `#FAFAF9` ≈ 3.4:1, BORDERLINE) is relevant. Document whether the button's hover passes WCAG 2.1 AA large-text (3:1) but fails body-text (4.5:1). The button font is 14 px (shadcn `size="sm"` → `text-[0.8rem]` ≈ 12.8 px — body text, needs 4.5:1). Deferral path: if borderline fails, defer to a follow-up story that darkens `--destructive` toward `#D14B4B` — DO NOT block 3.4 on this because the hover-red recipe comes from the 1.2 tokenisation story. See Pinned Decision #10.
    13. Double-check AC14: after the swap, `grep -n "cn(" apps/web/src/routes/dashboard/dossiers/\[slug\].tsx` → ZERO matches; the import line was deleted.
  - [x] No regression on Stories 1.1 – 3.3:
    - `/dashboard` list still renders 2 mock cards + Créer un dossier (3.1).
    - `/dashboard/dossiers/nouveau` → naming → questionnaire → recap → `/dashboard/dossiers/view/:slug` all reachable (2.3 – 2.6).
    - Contenu tab: `?tab` absent, H1 active, Contenu pill active, dossier fields list renders (2.6 / 3.2 unchanged).
    - `MetricCard` grid values (`2 / 7 / 4m 32s`) unchanged (3.3 AC1).
    - `Accès & partage` H2 unchanged (3.3 AC4).
    - Empty-analytics path unchanged (3.3 AC10).
    - `TAB_VALUES` constant + `activeTab` derivation + `handleTabChange` guard unchanged (3.2 / 3.3).
    - `H1` focus-on-mount unchanged; direct-navigate to `?tab=analytics` still works (3.2).
    - Shell breadcrumb auto-suppression intact via `handle.hideBreadcrumb` (not touched — verify `git diff apps/web/src/router.tsx` is empty).

- [x] **Task 5: Self-review sweep before marking story done**
  - [x] All 20 ACs trace to code (AC → Task / component mapping documented in each AC block and each Task header).
  - [x] Zero raw hex values in new + modified files (AC18).
  - [x] All three French status labels (`Actif` / `En attente` / `Révoqué`) appear EXACTLY in `StatusDot.tsx` — zero matches in the route (AC18).
  - [x] `StatusDot` has ZERO hover/focus/transition styling — read-only inline element. If a future story adds interactivity, it extends through the `className` prop at the call site, not by breaking the closed API.
  - [x] `AccessListRow` has ZERO `onClick` / `disabled` / `aria-disabled` on the Révoquer button when `onRevokeClick` is undefined — the button is a keyboard-focusable no-op, matching 3.3 behaviour. See Pinned Decision #5.
  - [x] `opacity-[0.55]` is applied to the TWO content sub-regions (avatar+email+lastSeen; session duration + revoked-date replacement) — NOT to the `StatusDot` (AC10).
  - [x] The pending row's em-dash uses `font-normal text-muted-foreground`, active/revoked durations use `font-bold text-foreground` (AC7, Pinned Decision #2).
  - [x] The Révoquer button's hover override uses `border-border hover:border-destructive hover:bg-transparent hover:text-destructive` — explicitly neutralises the shadcn outline variant's default `hover:bg-muted hover:text-foreground` (AC12, Pinned Decision #4).
  - [x] The `<li>` divider is implemented via `not-[:first-child]:border-t not-[:first-child]:border-border` OR equivalent — the `index > 0` pattern from 3.3 is abolished (AC15, Pinned Decision #6).
  - [x] The route no longer imports `cn` from `@/lib/utils` (AC14).
  - [x] The `AccessEntry` discriminated union narrows correctly inside `AccessListRow` — TS knows `entry.revokedAt` is `string` under `status === 'revoked'` (AC16). No `!` assertion, no `?? ''` fallback.
  - [x] The Avatar primitive is from shadcn (`@/components/ui/avatar`) at default `size-8` — NOT the raw `<span>` recipe from 3.3 (Pinned Decision #8).
  - [x] Visual-regression walkthrough confirms active / pending rows are pixel-equivalent to 3.3, and the revoked row's dot is now full-opacity (AC19).
  - [x] Commit strategy: single `feat(epic-3): story 3.4 — AccessListRow & StatusDot components` commit that bundles implementation AND any self-applied review patches (per user memory preference: "Code + review in a single commit"). Do NOT split the review patches into a separate `fix(epic-3): story 3.4 code-review patches` commit — Story 3.2 onward uses the bundled-commit convention.

### Review Findings

Code review run on 2026-04-22. 3 adversarial layers: Blind Hunter (diff-only), Edge Case Hunter (branch/boundary sweep with project read), Acceptance Auditor (AC + Pinned Decision + Anti-Pattern conformance). 1 patch, 2 defer, 6 dismissed (duplicates, misreads of row structure, theoretical, or spec-mandated).

- [x] [Review][Patch] Avatar `aria-label` silent without `role="img"` [apps/web/src/components/confluent/AccessListRow.tsx:34] — `AvatarPrimitive.Root` renders without an implicit role, so ARIA naming on the role-less element is ignored by most screen readers. Violates AC6 ("so VoiceOver announces the recipient before reading the body") and AC20 ("VoiceOver rotor announces the recipient email as an avatar label"). Applied: added `role="img"` to the `<Avatar>` call site so AT computes the accessible name from `aria-label` and announces the full recipient email.
- [x] [Review][Defer] `StatusDot` runtime TypeError on unknown API status [apps/web/src/components/confluent/StatusDot.tsx:18] — deferred, real API shape lands in Story 8.3; current discriminated union is compile-time-safe, mock fixture prevents runtime hit.
- [x] [Review][Defer] `title={entry.email}` tooltip invisible on touch devices [apps/web/src/components/confluent/AccessListRow.tsx:40-42] — deferred, pre-existing from 3.3's self-applied review patch; screen readers read the full email from `<p>` content so AT is unaffected; sighted touch users lose disclosure. Revisit alongside a dedicated mobile-UX pass.

## Dev Notes

### Critical Architecture Constraints

- **`StatusDot` and `AccessListRow` live at `apps/web/src/components/confluent/`** — design-system components with Confluent-specific anatomy, alongside `DossierCard` / `DossierField` / `EmptyState` / `MetricCard` / `WizardInput`. NOT in `components/ui/` (that folder is reserved for shadcn-style wrappers around Base UI primitives). NOT in `features/analytics/components/` (that's a backend-era future folder per [architecture.md:661-663](../planning-artifacts/architecture.md#L661-L663); 3.4 is still frontend-mock scope). [Source: ux-design-specification.md §Component Implementation Strategy (line 612-617); Story 3.2 / 3.3 precedent]
- **`StatusDot` is a CLOSED three-state enum** — `'active' | 'pending' | 'revoked'`. No `color` / `size` / `label` / `children` props. Adding a fourth status later means widening the union in `mock-analytics.ts` (or its API replacement) and widening the `STATUS_COPY` map in lockstep — the compiler catches incomplete updates. See Pinned Decision #7.
- **`AccessListRow` is a CLOSED full-entry renderer** — no `compact` / `showStatusDot` / `hideAvatar` variants. The three states (active/pending/revoked) are encoded via the `entry.status` discriminated union, not via opt-in props. Story 3.5 and 3.6 consume the component verbatim; any variant emergence is a follow-up extraction (e.g., a `CompactAccessListRow` for a future sidebar surface). See Pinned Decision #1.
- **Route path stays `/dashboard/dossiers/view/:slug`** — the real path established by the Story 2.6 code-review patch. The same Epic AC discrepancy with the bare `:slug` applies; 3.4 does NOT "fix" the route. [Source: [apps/web/src/router.tsx](apps/web/src/router.tsx); Stories 3.1 / 3.2 / 3.3 Pinned Decisions]
- **`AccessEntry` discriminated union is the source of truth for row shape.** Defined in [apps/web/src/data/mock-analytics.ts:16-18](apps/web/src/data/mock-analytics.ts#L16-L18) via `{ status: 'active' | 'pending' } | { status: 'revoked'; revokedAt: string }`. 3.4 does NOT widen, narrow, or reshape this type — the 3.3 self-applied review patch made it discriminated, and 3.6 will add a fourth state (`'revoking'` optimistic-update) via an additive variant. [Source: Story 3.3 §Review Findings — "AccessEntry should be a discriminated union"]
- **Status tokens already exist in `index.css`.** `--status-active: #4CAF7D` / `--status-pending: #F0A830` / `--status-neutral: #B0B0B0` at [apps/web/src/index.css:87-89](apps/web/src/index.css#L87-L89) and re-exported as `--color-status-*` at [apps/web/src/index.css:39-41](apps/web/src/index.css#L39-L41). Use `bg-[var(--status-active)]` etc. in `StatusDot`. No new CSS variables. [Source: Story 1.2; 3.3 Dev Notes]
- **`--destructive: #E57373` already exists** — the `hover:border-destructive hover:text-destructive` recipe on the Révoquer button routes through `var(--destructive)` → `#E57373` without a raw hex anywhere. Matches the UX spec's "status-destructive" naming at [ux-design-specification.md:341](../planning-artifacts/ux-design-specification.md#L341). [Source: [apps/web/src/index.css:67](apps/web/src/index.css#L67); Story 1.2]
- **Design tokens only — no raw hex.** `bg-card`, `border-border`, `text-foreground`, `text-muted-foreground`, `border-destructive`, `text-destructive`, `var(--status-*)` cover every surface in `StatusDot` + `AccessListRow`. AC18's grep sweep is the automated guardrail.
- **Avatar primitive is shadcn-provided.** [apps/web/src/components/ui/avatar.tsx](apps/web/src/components/ui/avatar.tsx) wraps `@base-ui/react/avatar` — `Avatar` root applies `size-8` (32 px) with `bg-muted`-via-`AvatarFallback` + an `after:border after:border-border` inner chrome. AvatarFallback's `text-sm text-muted-foreground` matches the UX spec's "initials circle" recipe. Swap from 3.3's raw `<span>` to the shadcn primitive here — 3.3 explicitly signposted this as 3.4's call. Pinned Decision #8.
- **No `react-hook-form`, no `zod`, no TanStack Query on 3.4.** 3.4 is pure display-component extraction — no forms, no server state, no mutations. Story 3.5 adds form primitives for the share email input; 3.6 adds the optimistic revocation state lift.
- **No new `@base-ui/react` subpath.** Avatar + Button are already imported in the app. `StatusDot` is a pure `<span>` — no Base UI primitive. [Source: Story 3.3 §Latest Technical Information; no lockfile delta expected]
- **French-locale typography:** `"Actif"`, `"En attente"`, `"Révoqué"`, `"Révoquer"`, `"Révoquer l'accès de {email}"`, `"Révoqué le {date}"`, `"Statut : {label}"` — copy verbatim from the Epic AC and UX spec. Do NOT "improve" with typographic spaces, alternate orthography, or abbreviations.
- **WCAG 2.1 AA baseline** — `<ul role="list">` list semantics from 3.3 preserved; per-row Révoquer `aria-label`; StatusDot wrapper `aria-label`; dot `aria-hidden`; avatar `aria-label` with full email; 55 % opacity + distinct text + distinct colour + distinct dot-opacity (four orthogonal signals for revoked rows, up from 3.3's three because the dot now pops). The AC10 fix addresses the 3.3-deferred non-text contrast concern. [Source: ux-design-specification.md §Accessibility (line 377-405); 3.3 §Review Findings / deferred-work.md]
- **URL-as-source-of-truth for the active tab is preserved from 3.3.** No change to `useSearchParams` / `handleTabChange` / `activeTab` logic. 3.4 only replaces the contents of the analytics `TabsContent`. [Source: Story 3.2 §Pinned Decisions #3]

### Design Tokens to Use

| Surface | Tailwind utility | Value | Where |
|---|---|---|---|
| StatusDot wrapper | `inline-flex items-center gap-1.5 text-sm text-muted-foreground` | 14 px / `#6B6B6B` / 6 px gap | `<span aria-label>` outer |
| StatusDot dot | `inline-block size-[7px] rounded-full bg-[var(--status-*)]` | 7 px / `--status-active` · `--status-pending` · `--status-neutral` | `<span aria-hidden>` inner |
| Row outer `<li>` | `flex flex-col gap-3 px-4 py-3 not-[:first-child]:border-t not-[:first-child]:border-border sm:flex-row sm:items-center sm:justify-between` | Responsive stack→row, 16 px h · 12 px v padding, `#E8E8E7` divider on non-first rows | `<li>` |
| Row avatar | shadcn `<Avatar>` default size | 32 px circle / `#F1F0EE` bg / `#6B6B6B` text / `#E8E8E7` inner border | `<Avatar>` from `components/ui/avatar` |
| Row email `<p>` | `truncate text-sm font-medium text-foreground` | 14 px / 500 / `#1A1A1A` / truncate with `title` fallback | Inside left region |
| Row lastSeen `<p>` | `truncate text-xs text-muted-foreground` | 12 px / `#6B6B6B` / truncate | Below email |
| Row duration (active/revoked) | `tabular-nums text-[22px] font-bold text-foreground` | 22 px / 700 / `#1A1A1A` / tabular digits | Right region first child |
| Row duration (pending) | `tabular-nums text-[22px] font-normal text-muted-foreground` | 22 px / 400 / `#6B6B6B` / tabular digits | Right region first child |
| Row revoked date | `text-xs text-muted-foreground opacity-[0.55]` | 12 px / `#6B6B6B` / 55 % | Right region trailing (only for revoked) |
| Révoquer button | `<Button variant="outline" size="sm" className="min-h-11 border-border hover:border-destructive hover:bg-transparent hover:text-destructive">` | 28 px body + `min-h-11` = 44 px outer / neutral border at rest / destructive border+text on hover / transparent fill in both | Right region trailing (only for active/pending) |
| Revoked dim region (content) | `opacity-[0.55]` (conditional) | 55 % cascades to avatar, email, lastSeen, duration, revoked-date | Two sibling wrappers inside `<li>` |
| StatusDot in revoked row | NO opacity wrapper | 100 % opacity — dot stays crisp for AC10 contrast fix | Sibling of the dim regions |

### Component Prop Contracts (exhaustive)

```ts
// apps/web/src/components/confluent/StatusDot.tsx
export type { AccessStatus as StatusValue } from '@/data/mock-analytics'

export interface StatusDotProps {
  status: StatusValue
  className?: string
}
export function StatusDot(props: StatusDotProps): JSX.Element

// apps/web/src/components/confluent/AccessListRow.tsx
import type { AccessEntry } from '@/data/mock-analytics'

export interface AccessListRowProps {
  entry: AccessEntry
  onRevokeClick?: (entry: AccessEntry) => void
  className?: string
}
export function AccessListRow(props: AccessListRowProps): JSX.Element
```

`AccessEntry` (unchanged from Story 3.3, preserved for reference):
```ts
// apps/web/src/data/mock-analytics.ts
export type AccessStatus = 'active' | 'pending' | 'revoked'

interface AccessEntryBase {
  readonly email: string
  readonly initials: string
  readonly lastSeen: string
  readonly sessionDuration: string
}

export type AccessEntry =
  | (AccessEntryBase & { readonly status: 'active' | 'pending' })
  | (AccessEntryBase & { readonly status: 'revoked'; readonly revokedAt: string })
```

### File Layout (target)

```
apps/web/src/
├── components/
│   ├── confluent/
│   │   ├── AccessListRow.tsx                                     [NEW — recipient row component]
│   │   ├── DossierCard.tsx                                       [UNCHANGED]
│   │   ├── DossierField.tsx                                      [UNCHANGED]
│   │   ├── EmptyState.tsx                                        [UNCHANGED]
│   │   ├── MetricCard.tsx                                        [UNCHANGED]
│   │   ├── StatusDot.tsx                                         [NEW — inline status indicator]
│   │   ├── WizardInput.tsx                                       [UNCHANGED]
│   │   └── illustrations/                                        [UNCHANGED]
│   ├── layout/                                                   [UNCHANGED]
│   └── ui/                                                       [UNCHANGED — no new primitives]
├── data/
│   ├── mock-analytics.ts                                         [UNCHANGED]
│   ├── mock-dossiers.ts                                          [UNCHANGED]
│   └── questionnaire.ts                                          [UNCHANGED]
├── features/                                                     [UNCHANGED]
├── lib/                                                          [UNCHANGED]
├── routes/
│   └── dashboard/
│       └── dossiers/
│           └── [slug].tsx                                        [MODIFIED — inline row markup replaced by <AccessListRow>]
└── router.tsx                                                    [UNCHANGED]
```

### Previous Story Intelligence

**From Story 3.3 (just landed — `a093915`):**
- The analytics `<TabsContent value={TAB_VALUES.analytics}>` body is inline JSX with a 3-column MetricCard grid + a `<ul role="list">` containing three hard-coded `<li>` rows. The `<li>` rows have inline ternaries for the StatusDot colour, status label, aria-label, and the revoked-vs-active button-or-text swap. Story 3.4 extracts this row markup into `<AccessListRow>` and the inline ternaries into `<StatusDot>`.
- 3.3 explicitly marked `AccessListRow` and `StatusDot` extraction as 3.4's scope via Pinned Decision #3: "extracting `AccessListRow` here pre-commits to a prop shape (...) that 3.4 MAY refine after it walks the three-state matrix; and extracting `StatusDot` here pre-commits to the colour API (discrete `status` union vs. a `color` prop) that 3.4 must re-decide with the full a11y-label set."
- 3.3's self-applied review patches are PRESERVED verbatim by 3.4 — `<ul role="list">` list semantics, `truncate` + `title` on the email, `truncate` on the lastSeen, `typeof value !== 'string'` guard in `handleTabChange`, `AccessEntry` as a discriminated union. The review-patch behaviour simply moves WITH the extracted component into `AccessListRow.tsx`.
- 3.3's deferred-work items explicitly tagged for 3.4 resolution:
  - **"Revoked row's `opacity-[0.55]` dims the grey `--status-neutral` dot below WCAG 3:1 non-text contrast"** — resolved by AC10's structural hoist (StatusDot sits OUTSIDE the dimmed sub-regions).
  - **"Status tuple rendering duplicated across 3 inline ternaries"** — resolved by `StatusDot` extraction itself (the ternaries collapse into a single `STATUS_COPY` lookup inside `StatusDot.tsx`).
  - **"Pending entry's em-dash `sessionDuration` renders at same 22 px bold weight as real durations"** — resolved by AC7's muted-weight variant (`font-normal text-muted-foreground` for pending, `font-bold text-foreground` otherwise).
- The `TAB_VALUES` / `TabValue` constants from 3.3 stay INTACT — 3.4 does not touch tab routing. The `activeTab` derivation at [apps/web/src/routes/dashboard/dossiers/[slug].tsx:91-94](apps/web/src/routes/dashboard/dossiers/[slug].tsx#L91-L94) and `handleTabChange` at lines 96-109 remain byte-identical.
- The `MetricCard` grid at lines 194-202 and the `Accès & partage` H2 at line 205 stay byte-identical.
- The empty-state copy `Aucun destinataire pour le moment.` at lines 210-212 stays byte-identical.
- The `cn` import at line 10 is REMOVED by 3.4 (the route no longer calls `cn` after the row markup moves into `AccessListRow.tsx`). This is a net reduction in route imports.
- Avatar primitive: 3.3 Task 3d noted "Story 3.4 may swap this for the shadcn `Avatar` + `AvatarFallback` recipe (see [apps/web/src/components/ui/avatar.tsx:39-52](apps/web/src/components/ui/avatar.tsx#L39-L52)) — 3.3 keeps it as a raw `<span>` to avoid over-committing before the `AccessListRow` component is extracted." Story 3.4 takes the swap — Pinned Decision #8.

**From Story 3.3 §Review Findings (still relevant cross-references):**
- Deferred to Story 3.6: "Révoquer button has no `onClick`, silent no-op" — the AC5 `onRevokeClick` prop exists in 3.4 but is not passed by the route; 3.6 wires it via an AlertDialog + optimistic-update mutation. The prop shape is stable between 3.4 and 3.6.
- Deferred to Story 8.3: "React keys `entry.email` / `metric.label` can collide on duplicate values" — stable IDs arrive with the real API schema (`GET /v1/dossiers/:id/analytics`); 3.4 continues to use `entry.email` as the key per the 3.3 precedent.
- Deferred to Story 8.3: "`sessionDuration` encodes `"no data"` as em-dash in-band rather than `string | null`" — real API shape lands in 8.3; 3.4 preserves the fixture's `'—'` convention.

### Decisions Pinned for This Story

The following decisions are locked for Story 3.4 implementation. Do not renegotiate without explicit retrospective action.

1. **`onRevokeClick` prop exists in 3.4 but is NOT wired at the call site.** Story 3.6 adds the handler (AlertDialog confirmation + optimistic update via a state lift). The prop shape (`(entry: AccessEntry) => void`) is stable between 3.4 and 3.6 — 3.6's patch adds a passed prop, nothing else. Rationale: committing to the signature now prevents a double churn in 3.6 (where the component signature would otherwise change alongside the handler logic).
2. **Pending row's em-dash renders `font-normal text-muted-foreground`, active/revoked durations render `font-bold text-foreground`.** The visual distinction makes the "no session yet" state unambiguous (vs. a bold em-dash that reads as "0m 00s"). Rationale: resolves the 3.3 deferred-work entry; the muted-weight recipe is additive over the shared `text-[22px] tabular-nums` base.
3. **Row structure: `<li>` wraps TWO sibling regions inside, StatusDot lives in neither dim region.** Skeleton:
   ```
   <li>
     <div class="... opacity-[0.55]?">   <!-- avatar + email + lastSeen -->
     <div class="...">                    <!-- session duration span (opacity-[0.55]?) + StatusDot + Révoquer button OR revoked date span (opacity-[0.55]) -->
   </li>
   ```
   Inside the right region, `opacity-[0.55]` is applied to the session-duration span AND the revoked-date span individually, NOT to the StatusDot. The StatusDot is a direct child of the right region at full opacity. Rationale: only way to preserve the UX "revoked row is 55 % dim" while keeping the StatusDot at full contrast per AC10.
4. **Révoquer button hover: `border-border hover:border-destructive hover:bg-transparent hover:text-destructive`.** The `hover:bg-transparent` explicitly neutralises the shadcn outline variant's `hover:bg-muted hover:text-foreground` default — otherwise the row would flash a `#F1F0EE` fill on hover, which conflicts with the UX spec's "border and text shift to status-destructive" statement ("text shift" — not background shift). Rationale: documents the Tailwind utility-class override chain explicitly to prevent a regression from someone removing the `hover:bg-transparent` "because it looks redundant".
5. **Disabled-state handling on the Révoquer button: NONE.** No `disabled`, no `aria-disabled`, no opacity change, no tooltip. The button is keyboard-focusable and a click is a no-op when `onRevokeClick` is undefined. Rationale: matches 3.3's live behaviour exactly; `disabled` would make row-1 skip over the button in keyboard tab order, which is a tangible regression not flagged by 3.3.
6. **Row divider via `not-[:first-child]:border-t not-[:first-child]:border-border` on the `<li>` itself.** Collocates the divider with the row markup; eliminates the `index > 0` caller contract from 3.3. Rationale: `AccessListRow` is self-contained — callers pass `entry` + optional `onRevokeClick`, nothing else. An `index` prop or a parent-coupled sibling selector is a leaky abstraction.
7. **`StatusDot` has a CLOSED API** — `status` + `className` only. No `color` prop (would encourage raw hex). No `size` prop (7 px is spec-mandated across all surfaces). No `label` override (three fixed French strings). No `children` (it is not a composable shell). Rationale: the component is a small primitive; optionality here produces more surface bugs than wins. Pair with Pinned Decision #1's closed `AccessListRow` API.
8. **Avatar is shadcn's `<Avatar>` + `<AvatarFallback>`, not a raw `<span>`.** 3.3 kept the raw `<span>` to avoid pre-committing to a recipe before the extraction; 3.4 makes the call. Shadcn Avatar adds `after:border after:border-border after:mix-blend-darken` inner chrome that reads cleanly against `bg-card`, and `AvatarFallback` already applies `bg-muted text-muted-foreground` — no visual delta vs 3.3's raw span except for the added subtle inner border. Rationale: aligns with the UX spec's "all custom components use shadcn design tokens" rule and with the shadcn add from Story 1.2 (`shadcn add ... avatar ...`).
9. **Do NOT extract an `AccessList` component.** The `<ul>` + empty-state block is ~10 lines inside a single call site. Same logic as Story 3.3's Pinned Decision #4 ("do not extract an `AnalyticsPanel`"). Rationale: avoid over-engineering; 3.5 (share panel) and 3.6 (revocation optimistic state lift) will both edit the route, not a shared wrapper.
10. **Hover-red body-text contrast is ACCEPTED as a design-token-level concern.** The Révoquer button's hover state renders `#E57373` (destructive) on `#FAFAF9` (background) at ~3.4:1 — passes WCAG 2.1 AA large-text (3:1), borderline on body-text (4.5:1). The `--destructive` token is shared with other surfaces (form field aria-invalid rings, future error toasts), so 3.4 does NOT locally darken it — the fix, if needed, is a 1.2-era token update that ripples everywhere. Rationale: single-token source of truth; fixing in 3.4 diverges the Révoquer hover from the rest of the app.

### Anti-Patterns to Avoid

- **Do NOT add a `color` / `tone` / `variant` prop to `StatusDot`.** Tightens the surface for callers, encourages raw hex in downstream code. The three statuses ARE the API.
- **Do NOT render `<AccessListRow>` without wrapping N rows in a `<ul>`.** The row is an `<li>` — an orphan `<li>` fails HTML validation and breaks the `<ul>` list-semantic announcement the 3.3 review patch restored.
- **Do NOT pass `onClick={() => {}}` or `onClick={undefined}` to the Révoquer button.** Use the `onClick={onRevokeClick ? () => onRevokeClick(entry) : undefined}` form — preserves the 3.3 "silent no-op" behaviour without introducing a bound function for every un-wired row (3.6 diffs will stay smaller).
- **Do NOT add `disabled` or `aria-disabled` to the Révoquer button when `onRevokeClick` is absent.** Pinned Decision #5.
- **Do NOT "extract the avatar recipe" into a new `RecipientAvatar` component.** `<Avatar><AvatarFallback>{initials}</AvatarFallback></Avatar>` is three tokens; any wrapper is over-engineering.
- **Do NOT cascade `opacity-[0.55]` onto the StatusDot.** Breaks AC10's non-text contrast fix. The two dimmed sub-regions (left group + duration/date spans on the right) are the dim surface; the StatusDot + Révoquer button are at full opacity.
- **Do NOT rename `AccessStatus` to `StatusValue` in `mock-analytics.ts`.** Re-export as `StatusValue` inside `StatusDot.tsx` — keeps the data source authoritative and lets 8.3's API-shape swap not touch `StatusDot.tsx`.
- **Do NOT use shadcn Button's `variant="destructive"` for the Révoquer hover.** The destructive variant applies `bg-destructive/10 text-destructive hover:bg-destructive/20` — a filled red surface at rest, which violates the UX spec's "never red at rest" rule. Use `variant="outline"` with a custom hover override (AC12, Pinned Decision #4).
- **Do NOT introduce a `confirm()` or AlertDialog flow on the Révoquer button.** Per UX spec (ux-design-specification.md line 564): "Single click, no confirmation dialog — immediate effect with toast feedback." 3.4 leaves the click as a no-op; 3.6 wires the toast + state lift WITHOUT a confirmation dialog.
- **Do NOT touch `router.tsx`, `app-shell.tsx`, `MetricCard.tsx`, `mock-analytics.ts`, `tabs.tsx`, or any file outside the three listed in Task 3.** 3.4 is a pure extraction + call-site rewire.

### Visual References

- UX spec anatomy: [ux-design-specification.md §AccessListRow (line 551-564)](../planning-artifacts/ux-design-specification.md#L551-L564), [§StatusDot (line 590-598)](../planning-artifacts/ux-design-specification.md#L590-L598), [§Button Hierarchy → Destructive (line 649)](../planning-artifacts/ux-design-specification.md#L649), [§Color Palette → `status-*` (line 339-341)](../planning-artifacts/ux-design-specification.md#L339-L341).
- Epic AC: [epics.md §Story 3.4 (line 695-739)](../planning-artifacts/epics.md#L695-L739).
- D4 prototype reference: `ux-design-directions.html` D4 panel — shows the per-row recipe and the metric summary cards above.
- Shadcn Avatar implementation: [apps/web/src/components/ui/avatar.tsx:6-52](apps/web/src/components/ui/avatar.tsx#L6-L52).
- Shadcn Button variants (outline, destructive): [apps/web/src/components/ui/button.tsx:11-20](apps/web/src/components/ui/button.tsx#L11-L20).
- MetricCard (design-system sibling to mirror): [apps/web/src/components/confluent/MetricCard.tsx](apps/web/src/components/confluent/MetricCard.tsx).

### Latest Technical Information

- **React 19 JSX transform** — components use the modern transform; no `import * as React from 'react'` namespace import needed in `StatusDot.tsx` / `AccessListRow.tsx` (no hooks, no React.* types in the files). Matches the existing `MetricCard.tsx` / `DossierField.tsx` convention.
- **Tailwind v4** — `not-[:first-child]:border-t` arbitrary-variant syntax is supported. The `[&:not(...)]:` and `not-[]:` flavours both work; Tailwind v4's compiler handles both. Prefer `not-[:first-child]:` for readability — shorter than the ampersand form.
- **Tailwind v4 `size-*` + arbitrary values** — `size-8` (32 px) and `size-[7px]` (7 px dot) both work. No `h-8 w-8` substitution needed.
- **Base UI Avatar** — `AvatarPrimitive.Root` handles fallback rendering via `AvatarPrimitive.Fallback`; no image load fails, no async timing bugs. We don't pass an image, so `AvatarFallback` renders synchronously on first paint. No skeleton, no content layout shift.
- **Shadcn `@/components/ui/button` outline variant** — the default hover (`hover:bg-muted hover:text-foreground`) conflicts with the UX spec; explicitly override with `hover:bg-transparent hover:border-destructive hover:text-destructive` to restore the spec'd behaviour. The Tailwind class order matters: `hover:bg-transparent` must come AFTER any earlier `hover:bg-*` utility to win the cascade (Tailwind's JIT sorts by specificity, but co-equal hover variants resolve by source order).
- **WCAG 2.1 AA non-text contrast (1.4.11)** — 3:1 minimum for UI component graphics. The revoked row's dot is `#B0B0B0` on `#FFFFFF` = 2:1 at full opacity — still below 3:1, but AC10 gets us from ~1.3:1 (3.3) to ~2:1 (3.4). The text label `Révoqué` is on `#FFFFFF` at full opacity (StatusDot wrapper's `text-muted-foreground` = `#6B6B6B` on white = 5.6:1 — passes AA). So the state is conveyed by text + label positioning even when the dot contrast is technically below 3:1. Deferred full fix: widen the neutral to `#999999` or darker — token-level concern, not a 3.4 patch.

### Project Context Reference

No `project-context.md` file present in the repo (checked via `find` at session start). The BMAD planning artifacts (`architecture.md`, `ux-design-specification.md`, `epics.md`, `prd.md`) are the authoritative context.

### References

- [Source: epics.md §Story 3.4 line 695-739]
- [Source: ux-design-specification.md §AccessListRow line 551-564]
- [Source: ux-design-specification.md §StatusDot line 590-598]
- [Source: ux-design-specification.md §Button Hierarchy line 649]
- [Source: ux-design-specification.md §Color Palette line 339-341]
- [Source: ux-design-specification.md §Component Implementation Strategy line 612-617]
- [Source: ux-design-specification.md §Implementation Roadmap Phase 1 line 623-629]
- [Source: architecture.md §Code Structure line 594-679]
- [Source: Story 3.3 implementation at `_bmad-output/implementation-artifacts/3-3-metric-card-grid-analytics-timeline-d4.md`]
- [Source: Story 3.3 §Review Findings + deferred-work.md — items explicitly tagged for 3.4 resolution]
- [Source: Story 3.2 §Decisions Pinned for This Story #3 — URL-as-source-of-truth pattern unchanged]
- [Source: Story 1.2 §Design System Configuration — status tokens and `--destructive` declared]

### Project Structure Notes

- No conflict with the unified project structure. `apps/web/src/components/confluent/` hosts design-system components; `apps/web/src/components/ui/` hosts shadcn primitives. The two new files (`StatusDot.tsx`, `AccessListRow.tsx`) slot into `components/confluent/` alongside the five existing siblings with no path variance.
- The `features/analytics/components/AccessAnalyticsTable.tsx` path from [architecture.md:661-663](../planning-artifacts/architecture.md#L661-L663) is a FUTURE-STATE shape for Epic 8's real-API analytics — out of scope for 3.4. When 8.3 lands, the `AccessListRow` component may migrate from `components/confluent/` to `features/analytics/components/` if it becomes analytics-feature-local, but 3.4 keeps it in the design-system folder because its surface is used by 3.5 (Share panel's mini-list of existing recipients per epic AC line 756) and potentially 3.6.

## Dev Agent Record

### Agent Model Used

claude-opus-4-7 (1M context)

### Debug Log References

- `pnpm turbo run typecheck` → 2 successful, 0 errors. Discriminated-union narrowing on `entry.status === 'revoked'` resolves `entry.revokedAt` as `string` inside the branch without casts (AC16).
- `pnpm turbo run lint` → 0 errors, 3 pre-existing warnings preserved (`badge.tsx:52`, `button.tsx:58`, `features/current-user/context.tsx:17`). Both new files lint clean.
- `pnpm turbo run build` → 2 successful. CSS bundle 47.45 kB (gz 9.15 kB) / JS bundle 382.79 kB (gz 121.30 kB) — no measurable delta vs 3.3 baseline; the net extraction is token-preserving.
- Grep sweep (all AC18 guardrails):
  - `#[0-9a-fA-F]{3,6}` across the three files → 0 matches.
  - `Actif|En attente|Révoqué` in the route → 0; in `StatusDot.tsx` → exactly 3 (lines 7-9).
  - `Révoquer l'accès de|Révoqué le` in `AccessListRow.tsx` → exactly 2 (lines 65, 72); in the route → 0.
  - `'analytics'|'content'` in the route → exactly 2 (both inside `TAB_VALUES`).
  - `from '@/lib/utils'` in the route → 0; `cn(` in the route → 0 (AC14).

### Completion Notes List

- `StatusDot` implements the closed three-state API per Pinned Decision #7 — `status` + `className` only, `STATUS_COPY` internal lookup owns the three French labels and the three token-backed dot classes. No hover/focus/transition styling.
- `AccessListRow` uses shadcn `<Avatar>` + `<AvatarFallback>` (size default = 32 px) — the swap from 3.3's raw `<span>` per Pinned Decision #8. `aria-label={entry.email}` is forwarded to the Avatar root via prop spread.
- Row structural skeleton matches Pinned Decision #3: outer `<li>` wraps TWO sibling regions. Left region (avatar + email + lastSeen) gets `opacity-[0.55]` when revoked; right region splits the dimming — the session-duration span and the revoked-date span are dimmed individually, the StatusDot stays OUTSIDE any opacity wrapper (AC10 non-text contrast fix). The Révoquer button is un-dimmed but is absent for revoked rows anyway.
- Pending em-dash renders `font-normal text-muted-foreground` vs active/revoked durations' `font-bold text-foreground` — resolves the 3.3 "em-dash reads as 0m 00s" deferred item (AC7, Pinned Decision #2).
- Révoquer button hover uses `border-border hover:border-destructive hover:bg-transparent hover:text-destructive` — explicitly neutralises the shadcn outline variant's default `hover:bg-muted hover:text-foreground` so the surface stays transparent at hover per UX spec (AC12, Pinned Decision #4).
- Row dividers are internal to `AccessListRow` via the `not-[:first-child]:border-t not-[:first-child]:border-border` arbitrary variant on the `<li>` itself — the `index > 0` caller contract from 3.3 is abolished (AC15, Pinned Decision #6). Tailwind v4 compiles the variant without issue (build green, CSS size unchanged).
- `onRevokeClick` prop is declared but un-wired at the call site — the button's `onClick={onRevokeClick ? () => onRevokeClick(entry) : undefined}` preserves the 3.3 silent-no-op behaviour without `disabled` / `aria-disabled`, keeping the button keyboard-focusable (Pinned Decision #5). Story 3.6 will pass the prop.
- Route changes: added one import (`AccessListRow`), removed one import (`cn`), replaced the ~80-line inline row JSX with a four-line `.map` producing `<AccessListRow key={entry.email} entry={entry} />`. Everything else (MetricCard grid, H2, empty state, TAB_VALUES, handleTabChange, Contenu panel, header, breadcrumb) is byte-preserved per AC17.
- Manual browser walkthrough skipped in harness (no interactive browser available). The visual regression risk is bounded: active/pending rendering uses the same Tailwind utilities as 3.3, the revoked row's only visible delta is the dot opacity (intended per AC10). Build + typecheck + lint + grep guardrails cover the structural correctness.
- Latent accessibility note for code review: `aria-label` on the shadcn `<Avatar>` root passes through to Base UI's unroled `<div>` — without `role="img"` screen readers may not announce the label. The AvatarFallback's initials text remains readable by AT. Tradeoff favours AC literal compliance over speculative role addition; flag for review layer.
- Single commit per user memory preference (feedback: "Code + review in a single commit"). Ready for the `/bmad-code-review` step to produce the bundled commit after review patches.

### File List

- apps/web/src/components/confluent/StatusDot.tsx (new)
- apps/web/src/components/confluent/AccessListRow.tsx (new)
- apps/web/src/routes/dashboard/dossiers/[slug].tsx (modified — one import added, one removed, analytics row markup replaced by `<AccessListRow>` call)
- _bmad-output/implementation-artifacts/3-4-access-list-row-status-dot-components.md (story progress)
- _bmad-output/implementation-artifacts/sprint-status.yaml (status: ready-for-dev → in-progress → review)

### Change Log

| Date | Change | Author |
|---|---|---|
| 2026-04-21 | Story 3.4 implementation — extracted StatusDot + AccessListRow from inline 3.3 analytics markup, resolved three 3.3 deferred review findings (dot non-text contrast, status-tuple duplication, pending em-dash weight). | claude-opus-4-7 |
| 2026-04-22 | Addressed code review findings — 1 item resolved (Avatar `role="img"` for screen-reader announcement of recipient email). 2 items deferred (StatusDot runtime guard for Story 8.3, `title` tooltip on touch devices). | claude-opus-4-7 |
