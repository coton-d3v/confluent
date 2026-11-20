# Story 3.6: Access Revocation (Optimistic, Mocked)

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an entrepreneur,
I want to revoke a recipient's access with a confirmation step,
so that I don't accidentally cut off access and can confirm the action before it takes effect.

## Acceptance Criteria

1. **Given** the entrepreneur is on `/dashboard/dossiers/view/:slug` (e.g. `/dashboard/dossiers/view/biosensio`) with the `?tab=analytics` tab active, **When** they click the `Révoquer` button in an `AccessListRow` whose `entry.status` is `'active'` or `'pending'` (rendered by the existing `<AccessListRow>` from [apps/web/src/components/confluent/AccessListRow.tsx:67-80](apps/web/src/components/confluent/AccessListRow.tsx#L67-L80), which already exposes `onRevokeClick?: (entry: AccessEntry) => void` from Story 3.4), **Then** a Base UI / shadcn `AlertDialog` opens overlaying the page with these EXACT children in top-to-bottom order:
   - `<AlertDialogTitle>` — copy: `"Révoquer l'accès ?"` (16 px / 600, `text-foreground`).
   - `<AlertDialogDescription>` — copy: `"${entry.email} ne pourra plus consulter ce dossier. Cette action est immédiate."` — the recipient's email is interpolated at the **start** of the sentence (NOT "vous voulez vraiment révoquer l'accès de X ?" — the Epic AC mandates the EXACT description template; the email is the subject, not the object). Rendered at 14 px / `text-muted-foreground`.
   - `<AlertDialogFooter>` containing TWO buttons in this order, top-to-bottom on mobile, side-by-side on `sm:` and up, with the **primary/destructive** button rightmost at `sm:` per UX spec §Button Hierarchy at [ux-design-specification.md:644-651](../planning-artifacts/ux-design-specification.md#L644-L651):
     - Outline Cancel button: `<AlertDialogCancel>Annuler</AlertDialogCancel>` (shadcn's `Cancel` part is a DialogClose slot wired to the outline Button variant).
     - Destructive Confirm button: `<AlertDialogAction variant="destructive">Oui, révoquer</AlertDialogAction>` — `variant="destructive"` resolves to the destructive Button variant at [apps/web/src/components/ui/button.tsx:18-19](apps/web/src/components/ui/button.tsx#L18-L19) (`bg-destructive/10 text-destructive hover:bg-destructive/20`). The Action button has `onClick={() => onConfirm(entry)}`.
   - The AlertDialog is modal (Base UI AlertDialog is ALWAYS modal — the primitive omits the `modal` and `disablePointerDismissal` props on purpose per [@base-ui/react/alert-dialog/root/AlertDialogRoot.d.ts](../../node_modules/@base-ui/react/alert-dialog/root/AlertDialogRoot.d.ts)). Backdrop click does NOT dismiss (this is the semantic difference from a plain Dialog). See Pinned Decision #1 for the overrides applied to `<AlertDialogContent>`.

2. **Given** the `<AlertDialog>` is open, **When** the user (a) clicks `Annuler`, OR (b) presses `Escape`, **Then** the dialog closes, NO toast fires, NO `accessEntries` mutation occurs, and the original `<AccessListRow>` state is unchanged (`status` still `'active'` or `'pending'`). Backdrop click does NOT close the dialog (Base UI AlertDialog default — see AC1). The top-right close `X` button is NOT rendered for an AlertDialog (shadcn's AlertDialogContent does NOT include the close icon that `<SheetContent>` renders — see Pinned Decision #2 for the divergence from the Sheet pattern).

3. **Given** the `<AlertDialog>` is open, **When** the user clicks `Oui, révoquer`, **Then** in this exact order (all synchronous, no `await`, no `setTimeout`):
   1. The dialog closes (set its `open` state to `false`).
   2. The matching `<AccessListRow>` transitions to `status: 'revoked'` in local state via `setAccessEntries(prev => prev.map(e => ...))`. The mutated entry MUST satisfy the `'revoked'` branch of the `AccessEntry` discriminated union at [apps/web/src/data/mock-analytics.ts:16-23](apps/web/src/data/mock-analytics.ts#L16-L23) — EXACTLY: `{ email, initials, lastSeen, sessionDuration, status: 'revoked', revokedAt, revokedAtIso, revokedBy }` (amended 2026-04-22 per Change Log scope extension — originally `{ email, initials, lastSeen, sessionDuration, status: 'revoked', revokedAt }`). All fields other than `status`, `revokedAt`, `revokedAtIso`, `revokedBy` are preserved from the prior entry. `revokedAt` is formatted via `formatRevokedAt(new Date())` — a pure helper that emits a string in the format `"22 avr. 2026"` (French abbreviated month with period — matches the fixture's existing `revokedAt: '16 avr. 2026'` at [apps/web/src/data/mock-analytics.ts:62](apps/web/src/data/mock-analytics.ts#L62)). `revokedAtIso` is `new Date().toISOString()` (UTC with `Z` suffix). `revokedBy` is `useCurrentUser().name` at the time of the click. See Pinned Decision #3 for the helper's exact implementation.
   3. A Sonner `toast.success('Accès révoqué')` fires — reusing the `<Toaster>` already mounted at [apps/web/src/main.tsx](apps/web/src/main.tsx) from Story 3.5. Copy is EXACTLY `"Accès révoqué"` per UX spec §Feedback Patterns at [ux-design-specification.md:655](../planning-artifacts/ux-design-specification.md#L655). Toast lives 3 s, bottom-right.
   4. The "Destinataires actifs" `MetricCard` value decrements by 1 — see AC4.
   5. Visually the revoked row transitions to its 3.4 `revoked` appearance (55% opacity row, gray `<StatusDot>`, NO Révoquer button, "Révoqué le 22 avr. 2026" label in place of the button — all wired by the existing `<AccessListRow>` at [apps/web/src/components/confluent/AccessListRow.tsx:63-66](apps/web/src/components/confluent/AccessListRow.tsx#L63-L66)).

4. **Given** the analytics tab's `MetricCard` grid at [apps/web/src/routes/dashboard/dossiers/[slug].tsx:239-247](apps/web/src/routes/dashboard/dossiers/[slug].tsx#L239-L247), **When** the analytics tab renders, **Then** the FIRST card's value (the "Destinataires actifs" card) is computed from local `accessEntries` as `accessEntries.filter(e => e.status !== 'revoked').length.toString()` — NOT read from the static `MOCK_ANALYTICS.metrics[0].value`. The label `"Destinataires actifs"` stays sourced from `MOCK_ANALYTICS.metrics[0].label` (label is static copy, value is derived). Cards 2 and 3 ("Vues totales" and "Durée moy. de session") remain STATIC from `MOCK_ANALYTICS.metrics[1]` and `MOCK_ANALYTICS.metrics[2]` — they are not recomputed by 3.6 (Epic 8 wires real analytics). See Pinned Decision #4 for the "actifs = non-revoked" interpretation that reconciles Story 3.3 AC1 (initial value "2" — 1 active + 1 pending = 2 non-revoked) with this Story's "decrement by 1 when revoking an active OR pending entry" requirement.

5. **Given** the `<AlertDialog>` with keyboard navigation, **When** the user navigates with Tab / Shift+Tab, **Then** focus is trapped inside the dialog (Base UI AlertDialog default — do NOT pass custom `initialFocus` or `finalFocus`), Tab cycles `Annuler` → `Oui, révoquer` → back to `Annuler`, Escape closes the dialog WITHOUT revoking. On open, initial focus lands on the `Annuler` button (Base UI's default for AlertDialog — the less-destructive action receives focus first, a standard AT convention for destructive confirmations). On close (either path), focus returns to the `Révoquer` button that triggered the dialog (Base UI AlertDialog's `finalFocus` defaults to the trigger element that opened the dialog). No `autoFocus` attribute is added to either button — the Base UI focus-trap handles it natively.

6. **Given** the revocation flow completes, **When** the user switches away and back to the analytics tab, OR refreshes the page, **Then** the `accessEntries` state re-seeds from `MOCK_ANALYTICS.accessEntries` on mount (the `useState(() => [...MOCK_ANALYTICS.accessEntries])` initializer from 3.5 at [apps/web/src/routes/dashboard/dossiers/[slug].tsx:84-86](apps/web/src/routes/dashboard/dossiers/[slug].tsx#L84-L86) runs fresh on route-component mount). Revoked state is intentionally NOT persisted — no localStorage, no sessionStorage, no URL-encoded state. Epic AC explicitly permits re-mock on load (`"the revoked state is not persisted (mocked — no localStorage needed for revocation state; re-mock on load is acceptable)"`). Tab switch WITHIN the route does NOT remount (Tabs state is controlled by URL search param, not by route key), so within-session revocations persist until the next route-level remount (which happens on slug change per 3.5's `DossierViewRoute` wrapper pattern at [apps/web/src/routes/dashboard/dossiers/[slug].tsx:74-77](apps/web/src/routes/dashboard/dossiers/[slug].tsx#L74-L77)).

7. **Given** [apps/web/src/routes/dashboard/dossiers/[slug].tsx](apps/web/src/routes/dashboard/dossiers/[slug].tsx) after the 3.6 changes, **When** a developer inspects the component body, **Then**:
   - A new `const [entryToRevoke, setEntryToRevoke] = useState<AccessEntry | null>(null)` hook is added alongside the existing `shareOpen` / `accessEntries` `useState` hooks (near line 83-86).
   - A new `const revokingRef = useRef(false)` is added alongside the `entryToRevoke` state (added by code-review patch P3, 2026-04-22) to prevent double-toast on rapid double-click of the destructive Action button — see Review Findings §P3.
   - A new `const currentUser = useCurrentUser()` hook binding is added (scope extension 2026-04-22) — imports `useCurrentUser` from `@/features/current-user/context`. Used to populate `revokedBy` in `handleConfirmRevoke`.
   - A new `handleRevokeClick(entry: AccessEntry)` handler resets `revokingRef.current = false` then sets `setEntryToRevoke(entry)` — passed as the `onRevokeClick` prop to every `<AccessListRow>` in the analytics list (AC7 switches the bare `<AccessListRow key={entry.email} entry={entry} />` to `<AccessListRow key={entry.email} entry={entry} onRevokeClick={handleRevokeClick} />`).
   - A new `handleConfirmRevoke(entry: AccessEntry)` handler: guards on `revokingRef.current` (returns early if already in flight, prevents double-toast); sets `revokingRef.current = true`; (a) mutates `setAccessEntries` per AC3; (b) calls `toast.success('Accès révoqué')`; (c) calls `setEntryToRevoke(null)` (closes the dialog). Order: guard → state mutation → toast → close.
   - The `<RevokeAccessDialog>` component (see Pinned Decision #5) is rendered inside `<DossierView>`, sibling of `<Tabs>`, as `<RevokeAccessDialog open={entryToRevoke !== null} entry={entryToRevoke} onOpenChange={(open) => { if (!open) setEntryToRevoke(null) }} onConfirm={handleConfirmRevoke} />`.
   - The `MetricCard` grid is modified per AC4 — the first card's `value` is computed from `accessEntries`; cards 2 and 3 remain static.
   - The `formatRevokedAt(date: Date): string` module-scope helper is added below `deriveInitials` — see AC3 Pinned Decision #3.
   - **Authorized surface for 3.6:** the `entryToRevoke` state, `revokingRef` ref, `currentUser` hook binding, `handleRevokeClick` / `handleConfirmRevoke` handlers, `onRevokeClick` prop wiring, MetricCard grid rewrite, `<RevokeAccessDialog>` render, `formatRevokedAt` helper, and the `useCurrentUser`/`RevokeAccessDialog`/`useRef` imports. Preserve everything else: the `DossierViewRoute` wrapper + `DossierView` split (3.5 code-review patch), the breadcrumb, H1-focus-on-mount, Tabs, Contenu tab, `accessEntries` state, `shareOpen` state, `SharePanel` wiring, `handleInvitationSubmit`, `deriveInitials` helper.

8. **Given** the new `<RevokeAccessDialog>` component, **When** a developer inspects it, **Then** it lives at [apps/web/src/components/confluent/RevokeAccessDialog.tsx](apps/web/src/components/confluent/RevokeAccessDialog.tsx) (alphabetical placement: `A…` < `D…` < `E…` < `M…` < **`R…`** < `S…` < `W…` — slots between `MetricCard.tsx` and `SharePanel.tsx`). The prop contract is EXACTLY:
   ```ts
   export interface RevokeAccessDialogProps {
     open: boolean
     entry: AccessEntry | null
     onOpenChange: (open: boolean) => void
     onConfirm: (entry: AccessEntry) => void
   }
   ```
   - `entry` is `null` whenever `open === false` — the `open` state is the single source of truth; `entry` is meaningful only when open.
   - `onOpenChange(false)` fires on Cancel / Escape (parent resets `entryToRevoke` to `null`).
   - `onConfirm(entry)` fires on the destructive Action click; parent applies the revocation and then resets `entryToRevoke` via its own `handleConfirmRevoke`.
   - The component owns: dialog copy (title, description template, button labels), the destructive Button variant wiring, the `flex-col sm:flex-row-reverse` footer layout. See Pinned Decision #6 for copy ownership (same split as SharePanel: component owns static copy; route owns runtime-shaped strings like the toast copy).
   - The description interpolates `entry?.email ?? ''` — the `?.` chain handles the `entry === null` edge case when the dialog is closed and unmounted (Base UI unmounts by default — see AC1 `actionsRef` behavior).

9. **Given** the new `<AlertDialog>` primitive at [apps/web/src/components/ui/alert-dialog.tsx](apps/web/src/components/ui/alert-dialog.tsx), **When** a developer inspects it, **Then** it is a hand-written shadcn-style wrapper over `@base-ui/react/alert-dialog` — NOT installed via `pnpm dlx shadcn@latest add alert-dialog`. Rationale: the project migrated to Base UI in Story 1.2 ([apps/web/src/components/ui/sheet.tsx:2](apps/web/src/components/ui/sheet.tsx#L2) imports from `@base-ui/react/dialog`, NOT `@radix-ui/react-dialog`), and `@base-ui/react` ships a dedicated `alert-dialog` module (verified at [@base-ui/react/alert-dialog/index.parts.d.ts](../../node_modules/.pnpm/@base-ui+react@1.4.0*/node_modules/@base-ui/react/alert-dialog/index.parts.d.ts)) exporting `Root, Trigger, Portal, Backdrop, Popup, Title, Description, Close`. Running the shadcn CLI would pull in `@radix-ui/react-alert-dialog` — a NEW dependency that would fork the project's dialog stack. See Pinned Decision #7 for the full rationale. The wrapper mirrors `sheet.tsx`'s shape and exports:
   ```ts
   export {
     AlertDialog,           // Root — wraps @base-ui/react/alert-dialog Dialog.Root
     AlertDialogTrigger,    // Trigger
     AlertDialogPortal,     // Portal
     AlertDialogOverlay,    // Backdrop — reuses sheet's `bg-black/10 supports-backdrop-filter:backdrop-blur-xs` recipe
     AlertDialogContent,    // Popup — centered, max-w-lg (see Pinned Decision #1)
     AlertDialogHeader,     // plain div wrapper for Title + Description
     AlertDialogTitle,      // Title
     AlertDialogDescription,// Description
     AlertDialogFooter,     // plain div wrapper for Cancel + Action, flex-col → sm:flex-row-reverse
     AlertDialogCancel,     // Close + Button outline variant
     AlertDialogAction,     // plain Button (NOT a Close — parent wires onClick), default destructive styling
   }
   ```
   See Task 1 for the exact skeleton.

10. **Given** copy ownership, **When** a developer greps the codebase after 3.6 lands, **Then**:
    - `RevokeAccessDialog.tsx` contains EXACTLY the static French copy: `"Révoquer l'accès ?"`, `"Annuler"`, `"Oui, révoquer"`, and the description template (`"${email} ne pourra plus consulter ce dossier. Cette action est immédiate."`).
    - `[slug].tsx` contains EXACTLY the runtime-shaped French copy: `"Accès révoqué"` (toast copy inside `handleConfirmRevoke`).
    - `AccessListRow.tsx` contains the revocation-detail tooltip copy (scope extension 2026-04-22): `"Révoqué le {entry.revokedAt}"` (trigger, unchanged from 3.4 visible text) + `"à {formatRevokedTime(entry.revokedAtIso)}"` + `"par {entry.revokedBy}"` (tooltip content, added 2026-04-22). The tooltip content is runtime-shaped (locale-formatted time + authored-by name) so it lives at the same layer as the toast copy — Pinned Decision #6's "component owns static copy; route owns runtime-shaped" split is preserved; the runtime-shaped tooltip strings simply live in `AccessListRow.tsx` where the revoked row is rendered rather than in the route, because the row is the closest component that reads `entry.revokedAtIso` / `entry.revokedBy`.
    - ZERO dialog copy appears in `alert-dialog.tsx` (the primitive is copy-agnostic).
    - ZERO dialog copy appears in `main.tsx`.
    - The precedent is Story 3.5 Pinned Decision #9 (component owns dialog copy; route owns mutation-adjacent runtime-shaped copy like toast messages and timestamp strings).

11. **Given** design tokens, **When** a developer inspects the new `RevokeAccessDialog.tsx` + `alert-dialog.tsx` + the modified `[slug].tsx`, **Then** ZERO raw hex values appear. Every surface routes through: `bg-popover` (AlertDialogContent background), `text-foreground` (title), `text-muted-foreground` (description), `border-border` (optional Separator — NOT added in 3.6; the Footer already visually separates), `bg-destructive/10` + `text-destructive` + `hover:bg-destructive/20` (destructive Button variant — inherited from `button.tsx:18-19`), `bg-black/10 supports-backdrop-filter:backdrop-blur-xs` (Backdrop — inherited from sheet.tsx:29 recipe copy). Validated by the Task 4 grep sweep (AC16).

12. **Given** viewport responsiveness, **When** the AlertDialog renders, **Then**:
    - Desktop (≥ `sm:` = 640 px): dialog is centered, max-width `max-w-lg` (32 rem = 512 px), with `p-6` padding. Buttons in `AlertDialogFooter` are `flex-row-reverse sm:justify-end` — destructive Action button on the right.
    - Mobile (< 640 px): dialog is centered with `max-w-[calc(100%-2rem)]` side margins so a 320 px viewport leaves a 16 px gutter on each side. Buttons stack vertically (`flex-col`), with the destructive Action button on **top** (stacked reverse order matches the desktop horizontal reverse — see Pinned Decision #8 for the "primary-on-top-on-mobile, primary-on-right-on-desktop" pattern consistent with SharePanel's `flex-col gap-2 p-4 sm:flex-row-reverse sm:justify-start`).
    - The AlertDialog respects `prefers-reduced-motion` via Base UI's default transition + Tailwind v4's `motion-reduce:*` cascade — NO custom motion overrides in 3.6.

13. **Given** keyboard + screen-reader navigation (AC5 expanded), **When** AT announces the open dialog, **Then** Base UI AlertDialog exposes `role="alertdialog"` (the semantic distinction from plain Dialog: "alertdialog" signals a confirmation-required prompt to AT), with `aria-labelledby` pointing at `<AlertDialogTitle>` and `aria-describedby` pointing at `<AlertDialogDescription>`. The screen-reader announcement on open reads approximately: `"alert dialog, Révoquer l'accès ?, ${email} ne pourra plus consulter ce dossier. Cette action est immédiate., Annuler, button, ..."`. NO manual `role`, `aria-labelledby`, or `aria-describedby` wiring is added — Base UI's primitive handles it. The destructive Action button has NO extra `aria-label` — its visible text "Oui, révoquer" is its accessible name.

14. **Given** motion preferences and reduced-motion users, **When** the user has `prefers-reduced-motion: reduce` at the OS level, **Then** the dialog open/close transitions are effectively instant. Base UI Dialog + Tailwind v4 respect the media query by default via the `motion-reduce:transition-none`-style cascade (same behavior as the `<Sheet>` in Story 3.5). NO 3.6-specific motion work.

15. **Given** no regression on Stories 1.1 – 3.5, **When** the dev agent completes 3.6, **Then**:
    - `/dashboard` list still renders 2 mock cards + Créer un dossier (3.1, 2.2).
    - `/dashboard/dossiers/nouveau` → naming → questionnaire → recap → `/dashboard/dossiers/view/:slug` all reachable (2.3 – 2.6).
    - Contenu tab renders the dossier fields (2.6 / 3.2 unchanged).
    - `MetricCard` grid values AT SEED: `"2"` / `"7"` / `"4m 32s"` — the first value matches because `MOCK_ANALYTICS.accessEntries` has 1 active + 1 pending = 2 non-revoked entries (AC4). Labels unchanged (3.3 AC1).
    - `Accès & partage` H2 unchanged (3.3 AC4).
    - `<StatusDot>` internals unchanged (3.4). `<AccessListRow>` internals extended ONLY by the scope extension of 2026-04-22: the `entry.status === 'revoked'` branch wraps the existing "Révoqué le {revokedAt}" label in a `<Tooltip>` trigger, and a `<TooltipContent>` renders the `revokedAtIso` + `revokedBy` detail. All other `<AccessListRow>` internals (avatar, email/lastSeen, session-duration, StatusDot, `Révoquer` button, hover/focus states, dimmed-opacity cascade) are preserved verbatim from 3.4. See Pinned Decision #11 for the scope-extension rationale.
    - SharePanel open/close/submit still works (3.5 unchanged). After a 3.6 revocation, reopening SharePanel shows the just-revoked recipient in the mini-list with a gray StatusDot.
    - Adding an invitation via SharePanel (3.5) and then immediately revoking it via 3.6 produces the expected transition: pending → revoked, MetricCard "Destinataires actifs" goes from (current+1) → current, toast "Accès révoqué" fires.
    - The Partager button's visible chrome is unchanged.
    - `deferred-work.md` entry "Révoquer button has no onClick, silent no-op" from 3.3's code review is **resolved** — remove the bullet from the 3.3-deferral block at [_bmad-output/implementation-artifacts/deferred-work.md](deferred-work.md) or add a striking-through note `~~resolved in 3.6~~` (see Pinned Decision #9 for the exact cleanup rule).

16. **Given** the Task 4 verification sweep, **When** a developer runs the grep guardrails, **Then**:
    - `grep -nE '#[0-9a-fA-F]{3,6}'` across `apps/web/src/components/confluent/RevokeAccessDialog.tsx` + `apps/web/src/components/ui/alert-dialog.tsx` + the modified `apps/web/src/routes/dashboard/dossiers/[slug].tsx` returns ZERO matches.
    - `grep -n "Révoquer l'accès\|Révoquer l&apos;accès\|Oui, révoquer\|ne pourra plus consulter ce dossier" apps/web/src/components/confluent/RevokeAccessDialog.tsx` returns EXACTLY 3 matches — one per copy string. The alternation includes both the ASCII-apostrophe form and the JSX-escaped `&apos;` form; `<AlertDialogTitle>` uses `&apos;` inside JSX text per the Dev Notes "use `&apos;` inside JSX text" rule (precedent: SharePanel.tsx:67-68). The fourth piece of copy, `"Annuler"`, is already globally duplicated by the SharePanel's cancel button text; the grep above isolates 3.6-unique copy.
    - `grep -n "Révoquer l'accès\|Oui, révoquer\|ne pourra plus consulter" apps/web/src/routes/dashboard/dossiers/\[slug\].tsx` returns ZERO matches — dialog copy lives INSIDE `RevokeAccessDialog.tsx` (Pinned Decision #6).
    - `grep -n "Accès révoqué" apps/web/src/routes/dashboard/dossiers/\[slug\].tsx` returns EXACTLY 1 match — inside `handleConfirmRevoke`'s `toast.success`.
    - `grep -n "Accès révoqué" apps/web/src/components/confluent/RevokeAccessDialog.tsx` returns ZERO matches — toast copy lives in the route's handler, NOT the dialog component.
    - `grep -n "MOCK_ANALYTICS.metrics\[0\]" apps/web/src/routes/dashboard/dossiers/\[slug\].tsx` returns EXACTLY 2 matches — the `key=` and `label=` reads of `MOCK_ANALYTICS.metrics[0].label` (per the Task 3 canonical snippet). The `value` is computed locally from `accessEntries`, never read from `metrics[0].value`.
    - `grep -rn "@radix-ui/react-alert-dialog" apps/web/` returns ZERO matches — no Radix alert-dialog dependency (Pinned Decision #7).
    - `grep -n "@base-ui/react/alert-dialog" apps/web/src/components/ui/alert-dialog.tsx` returns EXACTLY 1 match — the primitive import.
    - `grep -rn "onRevokeClick" apps/web/src/routes/dashboard/dossiers/\[slug\].tsx` returns EXACTLY 1 match — the prop passed to `<AccessListRow>`.
    - `pnpm turbo run typecheck` / `lint` / `build` are all green. Preserve the 3 tolerated pre-existing warnings (`badge.tsx:52`, `button.tsx:58`, `features/current-user/context.tsx:17`) — no new warnings accepted.
    - Manual browser walkthrough (tri-viewport 375 / 900 / 1440 px): from analytics tab → click Révoquer on arc@capital.fr → AlertDialog opens centered with title/description/buttons → Cancel closes without mutation → click Révoquer again → Oui, révoquer → dialog closes + toast "Accès révoqué" bottom-right + row goes 55% opacity + no Révoquer button + "Révoqué le 22 avr. 2026" label + Destinataires actifs decrements from "2" to "1". Repeat with martin@fund.io (pending): dialog opens, confirm → row goes to revoked, metric decrements to "0". Already-revoked rows (lea@invest.com) have no Révoquer button and thus cannot open the dialog (AC1 constraint). Escape + backdrop-click behave per AC2.

## Tasks / Subtasks

- [x] **Task 1: Create the shadcn-style `<AlertDialog>` primitive wrapping Base UI (AC: 1, 2, 9, 11, 12, 14)**
  - [x] Create [apps/web/src/components/ui/alert-dialog.tsx](apps/web/src/components/ui/alert-dialog.tsx). Mirror the sheet.tsx pattern verbatim (import shape, data-slot attributes, Portal + Overlay + Content composition, cn() wrapping).
  - [x] Imports at the top:
    ```tsx
    import * as React from 'react'
    import { AlertDialog as AlertDialogPrimitive } from '@base-ui/react/alert-dialog'
    import { cn } from '@/lib/utils'
    import { buttonVariants } from '@/components/ui/button'
    ```
    Do NOT import `Button` itself (the primitive wrapper cannot depend on `<Button>` at render time because that would create a circular-concern — see Pinned Decision #10; instead import the `buttonVariants` CVA factory and apply classes directly). Do NOT import `XIcon` — AlertDialog omits the top-right close button per AC2.
  - [x] Define exports in this order (alphabetical within groupings, matching `sheet.tsx` convention):
    ```tsx
    function AlertDialog({ ...props }: AlertDialogPrimitive.Root.Props) {
      return <AlertDialogPrimitive.Root data-slot="alert-dialog" {...props} />
    }

    function AlertDialogTrigger({ ...props }: AlertDialogPrimitive.Trigger.Props) {
      return <AlertDialogPrimitive.Trigger data-slot="alert-dialog-trigger" {...props} />
    }

    function AlertDialogPortal({ ...props }: AlertDialogPrimitive.Portal.Props) {
      return <AlertDialogPrimitive.Portal data-slot="alert-dialog-portal" {...props} />
    }

    function AlertDialogOverlay({ className, ...props }: AlertDialogPrimitive.Backdrop.Props) {
      return (
        <AlertDialogPrimitive.Backdrop
          data-slot="alert-dialog-overlay"
          className={cn(
            'fixed inset-0 z-50 bg-black/10 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0 supports-backdrop-filter:backdrop-blur-xs',
            className,
          )}
          {...props}
        />
      )
    }

    function AlertDialogContent({
      className,
      children,
      ...props
    }: AlertDialogPrimitive.Popup.Props) {
      return (
        <AlertDialogPortal>
          <AlertDialogOverlay />
          <AlertDialogPrimitive.Popup
            data-slot="alert-dialog-content"
            className={cn(
              'fixed top-1/2 left-1/2 z-50 flex w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-lg border border-border bg-popover p-6 text-popover-foreground shadow-lg transition duration-150 ease-in-out data-ending-style:opacity-0 data-starting-style:opacity-0 data-ending-style:scale-95 data-starting-style:scale-95',
              className,
            )}
            {...props}
          >
            {children}
          </AlertDialogPrimitive.Popup>
        </AlertDialogPortal>
      )
    }

    function AlertDialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
      return (
        <div
          data-slot="alert-dialog-header"
          className={cn('flex flex-col gap-2 text-left', className)}
          {...props}
        />
      )
    }

    function AlertDialogTitle({ className, ...props }: AlertDialogPrimitive.Title.Props) {
      return (
        <AlertDialogPrimitive.Title
          data-slot="alert-dialog-title"
          className={cn('font-heading text-base font-medium text-foreground', className)}
          {...props}
        />
      )
    }

    function AlertDialogDescription({ className, ...props }: AlertDialogPrimitive.Description.Props) {
      return (
        <AlertDialogPrimitive.Description
          data-slot="alert-dialog-description"
          className={cn('text-sm text-muted-foreground', className)}
          {...props}
        />
      )
    }

    function AlertDialogFooter({ className, ...props }: React.ComponentProps<'div'>) {
      return (
        <div
          data-slot="alert-dialog-footer"
          className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)}
          {...props}
        />
      )
    }

    function AlertDialogCancel({
      className,
      ...props
    }: AlertDialogPrimitive.Close.Props) {
      return (
        <AlertDialogPrimitive.Close
          data-slot="alert-dialog-cancel"
          className={cn(buttonVariants({ variant: 'outline', size: 'lg' }), className)}
          {...props}
        />
      )
    }

    function AlertDialogAction({
      className,
      ...props
    }: React.ComponentProps<'button'>) {
      return (
        <button
          type="button"
          data-slot="alert-dialog-action"
          className={cn(buttonVariants({ variant: 'destructive', size: 'lg' }), className)}
          {...props}
        />
      )
    }

    export {
      AlertDialog,
      AlertDialogTrigger,
      AlertDialogPortal,
      AlertDialogOverlay,
      AlertDialogContent,
      AlertDialogHeader,
      AlertDialogTitle,
      AlertDialogDescription,
      AlertDialogFooter,
      AlertDialogCancel,
      AlertDialogAction,
    }
    ```
    Structural points (Pinned Decision #10):
    - `AlertDialogCancel` IS a `<Close>` slot (clicks close the dialog automatically via Base UI's Dialog state — NO `onClick` needed at the call site).
    - `AlertDialogAction` is a PLAIN `<button>`, NOT a Close slot. The parent wires `onClick` (firing the `onConfirm` callback); the parent is then responsible for closing the dialog (setting `onOpenChange(false)`). This is shadcn's canonical split and matches the AC3 ordering (dialog close → state mutation → toast).
    - The Popup's `max-w-lg` resolves to 32 rem = 512 px at the project's Tailwind scale — comfortable width for a 2-line description with a long email at the left.
    - Mobile (`<640px`): `w-[calc(100%-2rem)]` gives a 16 px gutter on each side of a 320 px viewport (288 px total width).
    - NO top-right `X` close button (contrast with `<SheetContent>` at [apps/web/src/components/ui/sheet.tsx:60-75](apps/web/src/components/ui/sheet.tsx#L60-L75) which DOES render one) — AlertDialog's dismissal paths are only Cancel + Escape.
  - [x] NO new npm deps required — `@base-ui/react` is already a runtime dep at [apps/web/package.json:14](apps/web/package.json#L14). Do NOT run `pnpm dlx shadcn@latest add alert-dialog` (Pinned Decision #7).
  - [x] `pnpm turbo run typecheck` at this checkpoint → 2 successful, 0 errors. The Base UI primitive types (`AlertDialogPrimitive.Root.Props`, etc.) resolve against the existing `@base-ui/react@^1.4.0` installation.
  - [x] `pnpm turbo run lint` → 0 errors. The new file has no named + default export mix, no unused imports, no `any`.

- [x] **Task 2: Implement the `<RevokeAccessDialog>` component (AC: 1, 2, 5, 8, 10, 11, 13)**
  - [x] Create [apps/web/src/components/confluent/RevokeAccessDialog.tsx](apps/web/src/components/confluent/RevokeAccessDialog.tsx). Named exports only (`RevokeAccessDialog`, `RevokeAccessDialogProps`) — no default export. Sibling of `SharePanel.tsx` / `AccessListRow.tsx` / `MetricCard.tsx`.
  - [x] Imports:
    ```tsx
    import {
      AlertDialog,
      AlertDialogAction,
      AlertDialogCancel,
      AlertDialogContent,
      AlertDialogDescription,
      AlertDialogFooter,
      AlertDialogHeader,
      AlertDialogTitle,
    } from '@/components/ui/alert-dialog'
    import type { AccessEntry } from '@/data/mock-analytics'
    ```
    No `cn`, no `Button`, no `StatusDot` — the dialog is copy-only and delegates styling to the primitive.
  - [x] Prop contract EXACTLY:
    ```ts
    export interface RevokeAccessDialogProps {
      open: boolean
      entry: AccessEntry | null
      onOpenChange: (open: boolean) => void
      onConfirm: (entry: AccessEntry) => void
    }
    ```
  - [x] Render body:
    ```tsx
    export function RevokeAccessDialog({
      open,
      entry,
      onOpenChange,
      onConfirm,
    }: RevokeAccessDialogProps) {
      return (
        <AlertDialog open={open} onOpenChange={onOpenChange}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Révoquer l&apos;accès ?</AlertDialogTitle>
              <AlertDialogDescription>
                {entry?.email ?? ''} ne pourra plus consulter ce dossier. Cette
                action est immédiate.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Annuler</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  if (entry) onConfirm(entry)
                }}
              >
                Oui, révoquer
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )
    }
    ```
    Key points:
    - The `entry?.email ?? ''` fallback prevents a `"undefined ne pourra plus…"` render during the close-animation frame when `entry` has been reset to `null` but the dialog hasn't finished unmounting. The empty-string fallback is semantically harmless because the `open` prop is `false` at that instant and Base UI will unmount immediately unless the `actionsRef` pattern is used (we don't use it).
    - The `if (entry) onConfirm(entry)` guard is defensive — the `onConfirm` prop signature requires a non-null `entry`. TypeScript narrows correctly here.
    - The `<AlertDialogAction>` does NOT close the dialog itself — the parent's `onConfirm` handler is responsible for calling `onOpenChange(false)` (or equivalently, resetting `entryToRevoke` to `null`). This matches the AC3 ordering.
    - `<AlertDialogCancel>` IS a Close slot — clicking it auto-calls `onOpenChange(false)` via Base UI's Dialog state, which the parent handles by resetting `entryToRevoke` to `null`.
  - [x] No `React.useState`, no `React.useEffect`, no refs. The component is a pure controlled view over the four props.
  - [x] Zero raw hex values. No inline styles. All class composition happens inside `alert-dialog.tsx`.

- [x] **Task 3: Wire revocation into `[slug].tsx` (AC: 3, 4, 6, 7, 15)**
  - [x] Edit [apps/web/src/routes/dashboard/dossiers/[slug].tsx](apps/web/src/routes/dashboard/dossiers/[slug].tsx). Preserve EVERYTHING from Stories 3.1 / 3.2 / 3.3 / 3.4 / 3.5 except the narrow additions below.
  - [x] Add imports (alphabetical into the existing `components/confluent` import group — between `MetricCard` and `SharePanel`):
    ```tsx
    import { RevokeAccessDialog } from '@/components/confluent/RevokeAccessDialog'
    ```
  - [x] Add the `formatRevokedAt` helper at module scope, BELOW `deriveInitials` at [apps/web/src/routes/dashboard/dossiers/[slug].tsx:66-72](apps/web/src/routes/dashboard/dossiers/[slug].tsx#L66-L72):
    ```tsx
    function formatRevokedAt(date: Date): string {
      return date.toLocaleDateString('fr-FR', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
    }
    ```
    The `'fr-FR'` locale + `month: 'short'` emits a format like `"22 avr. 2026"` — matching the fixture's `revokedAt: '16 avr. 2026'` at [apps/web/src/data/mock-analytics.ts:57](apps/web/src/data/mock-analytics.ts#L57). NO manual array of month names, NO `format-fns`/`dayjs` dep — the platform `Intl.DateTimeFormat` handles the French locale natively. See Pinned Decision #3.
  - [x] Inside `DossierView`, add one new `useState` hook near the existing hooks (below `shareOpen` / `accessEntries`):
    ```tsx
    const [entryToRevoke, setEntryToRevoke] = useState<AccessEntry | null>(null)
    ```
  - [x] Add two new handlers inside `DossierView`, alongside `handleTabChange` and `handleInvitationSubmit`:
    ```tsx
    function handleRevokeClick(entry: AccessEntry) {
      setEntryToRevoke(entry)
    }

    function handleConfirmRevoke(entry: AccessEntry) {
      setAccessEntries((prev) =>
        prev.map((e) => {
          if (e.email !== entry.email || e.status === 'revoked') return e
          return {
            email: e.email,
            initials: e.initials,
            lastSeen: e.lastSeen,
            sessionDuration: e.sessionDuration,
            status: 'revoked' as const,
            revokedAt: formatRevokedAt(new Date()),
          }
        }),
      )
      toast.success('Accès révoqué')
      setEntryToRevoke(null)
    }
    ```
    Structural points:
    - The `.map` reconstructs the entry explicitly — spreading `{ ...e, status: 'revoked', revokedAt }` would also work at runtime, but the explicit reconstruction is necessary for TypeScript to narrow into the `'revoked'` branch of the `AccessEntry` discriminated union (the non-revoked branch has no `revokedAt` field, so the spread+overwrite pattern requires a cast; explicit reconstruction avoids it).
    - The `e.status === 'revoked'` early-return is a SAFETY guard — should be unreachable in normal flow because the `<AccessListRow>` does not render a Révoquer button for revoked rows (AccessListRow.tsx:63-66), but defensive against a future caller that invokes `onConfirm` with a stale `entry` reference.
    - The `'revoked' as const` assertion narrows the literal string to the discriminant value — without `as const`, TypeScript widens `status` to `string` and the discriminated union does not accept the object literal.
    - Order of side effects inside `handleConfirmRevoke`: (1) setAccessEntries → (2) toast → (3) setEntryToRevoke(null). Closing the dialog is the LAST step so the user sees the row transition BEFORE the dialog unmounts. Base UI's close-animation runs on top of the already-mutated list.
  - [x] Pass `onRevokeClick={handleRevokeClick}` to the `<AccessListRow>` at [apps/web/src/routes/dashboard/dossiers/[slug].tsx:261](apps/web/src/routes/dashboard/dossiers/[slug].tsx#L261):
    ```tsx
    <AccessListRow
      key={entry.email}
      entry={entry}
      onRevokeClick={handleRevokeClick}
    />
    ```
  - [x] Replace the `MetricCard` grid body at [apps/web/src/routes/dashboard/dossiers/[slug].tsx:239-247](apps/web/src/routes/dashboard/dossiers/[slug].tsx#L239-L247). Current:
    ```tsx
    {MOCK_ANALYTICS.metrics.map((metric) => (
      <MetricCard
        key={metric.label}
        label={metric.label}
        value={metric.value}
      />
    ))}
    ```
    New:
    ```tsx
    <MetricCard
      key={MOCK_ANALYTICS.metrics[0].label}
      label={MOCK_ANALYTICS.metrics[0].label}
      value={accessEntries
        .filter((e) => e.status !== 'revoked')
        .length.toString()}
    />
    <MetricCard
      key={MOCK_ANALYTICS.metrics[1].label}
      label={MOCK_ANALYTICS.metrics[1].label}
      value={MOCK_ANALYTICS.metrics[1].value}
    />
    <MetricCard
      key={MOCK_ANALYTICS.metrics[2].label}
      label={MOCK_ANALYTICS.metrics[2].label}
      value={MOCK_ANALYTICS.metrics[2].value}
    />
    ```
    The `MOCK_ANALYTICS.metrics` array is a frozen tuple of 3 — the `.map` is expanded to three explicit elements because only the first card's value is derived from state. Keys remain the labels (no duplication risk in this static tuple — 3.3's deferred "labels can collide" concern is about future API-driven data, not this fixture).
  - [x] Render `<RevokeAccessDialog>` inside `<DossierView>`, placed AFTER the closing `</Tabs>` tag but INSIDE the `<div className="mx-auto max-w-[720px]">` container:
    ```tsx
    <RevokeAccessDialog
      open={entryToRevoke !== null}
      entry={entryToRevoke}
      onOpenChange={(open) => {
        if (!open) setEntryToRevoke(null)
      }}
      onConfirm={handleConfirmRevoke}
    />
    ```
    Rationale for placement: the dialog uses Base UI's Portal (it renders into `document.body`, not into the route tree), so the DOM position inside the JSX is cosmetic. Placing it after `</Tabs>` keeps the JSX reading top-to-bottom aligned with user interaction flow (breadcrumb → header → tabs → dialog overlay).
  - [x] Post-edit self-review: run `pnpm turbo run typecheck` at this checkpoint → 2 successful, 0 errors. Verify: (a) `setAccessEntries((prev) => prev.map(...))` preserves the `AccessEntry[]` type; (b) the explicit `'revoked' as const` + explicit field construction narrows into the `'revoked'` branch; (c) `onRevokeClick={handleRevokeClick}` matches the `(entry: AccessEntry) => void` signature of `AccessListRowProps.onRevokeClick`.
  - [x] Do NOT touch: `DossierViewRoute` wrapper + `key={slug ?? 'no-slug'}` remount pattern (3.5 code-review patch), `loadDossier`, `deslugifyForDisplay`, `resolveDisplayName`, `deriveInitials`, `shareOpen`, `handleInvitationSubmit`, breadcrumb, H1-focus-on-mount, Tabs, SharePanel wiring, Contenu tab, `accessEntries.length === 0` empty-state guard.

- [x] **Task 4: Verify + guardrails (AC: 1-16)**
  - [x] `pnpm turbo run typecheck` → 2 successful, 0 errors. Verify the discriminated-union narrow inside `handleConfirmRevoke` compiles without casts.
  - [x] `pnpm turbo run lint` → 0 errors. Preserve exactly 3 pre-existing warnings (`badge.tsx:52`, `button.tsx:58`, `features/current-user/context.tsx:17`). `alert-dialog.tsx` + `RevokeAccessDialog.tsx` must lint clean — named exports only, no default export, no mixed exports that trip `react-refresh/only-export-components`. Zero new warnings.
  - [x] `pnpm turbo run build` → 2 successful, 0 errors. Expected bundle delta vs 3.5: +~18–19 KB gzipped (amended 2026-04-22 — original estimate was +~8–12 KB for the AlertDialog-only scope; the Tooltip scope extension per Pinned Decision #11 adds ~+10 KB for Base UI Tooltip's anchor-positioning infra). NO new npm deps — Base UI is already installed and both AlertDialog + Tooltip modules tree-shake from the existing `@base-ui/react` chunk.
  - [x] Self-review greps (AC16):
    - `grep -nE '#[0-9a-fA-F]{3,6}' apps/web/src/components/confluent/RevokeAccessDialog.tsx apps/web/src/components/ui/alert-dialog.tsx apps/web/src/routes/dashboard/dossiers/\[slug\].tsx` → ZERO matches.
    - `grep -n "Révoquer l'accès\|Oui, révoquer\|ne pourra plus consulter" apps/web/src/components/confluent/RevokeAccessDialog.tsx` → exactly 3 matches (one per string).
    - `grep -n "Révoquer l'accès\|Oui, révoquer\|ne pourra plus consulter" apps/web/src/routes/dashboard/dossiers/\[slug\].tsx` → ZERO matches.
    - `grep -n "Accès révoqué" apps/web/src/routes/dashboard/dossiers/\[slug\].tsx` → exactly 1 match.
    - `grep -n "Accès révoqué" apps/web/src/components/confluent/RevokeAccessDialog.tsx` → ZERO matches.
    - `grep -rn "@radix-ui/react-alert-dialog" apps/web/` → ZERO matches.
    - `grep -n "@base-ui/react/alert-dialog" apps/web/src/components/ui/alert-dialog.tsx` → exactly 1 match.
    - `grep -n "onRevokeClick" apps/web/src/routes/dashboard/dossiers/\[slug\].tsx` → exactly 1 match.
    - `grep -n "formatRevokedAt\|toLocaleDateString" apps/web/src/routes/dashboard/dossiers/\[slug\].tsx` → 2 matches for `formatRevokedAt` (definition + call inside `handleConfirmRevoke`), 1 match for `toLocaleDateString` (inside the helper).
  - [x] `pnpm turbo run dev` manual walkthrough (tri-viewport: 375 / 900 / 1440 px):
    1. Navigate to `/dashboard/dossiers/view/biosensio?tab=analytics`. Verify: 3 MetricCards with values `2 / 7 / 4m 32s` (the first is computed; AC15 regression check). 3 AccessListRow rows: arc@capital.fr (active, Révoquer button visible), martin@fund.io (pending, Révoquer button visible), lea@invest.com (revoked, NO Révoquer button, "Révoqué le 16 avr. 2026" label visible).
    2. Click Révoquer on arc@capital.fr. Verify: AlertDialog opens centered, max-width ~512 px on desktop, with title "Révoquer l'accès ?", description "arc@capital.fr ne pourra plus consulter ce dossier. Cette action est immédiate.", Cancel button (outline) on the left, Oui, révoquer button (destructive — muted red bg) on the right. Initial focus is on Cancel (AT-safe default).
    3. Keyboard — cancel path. Press Escape. Verify: dialog closes, arc@capital.fr row unchanged (still status='active', Révoquer button visible). Focus returns to the Révoquer button in the row.
    4. Click Révoquer on arc@capital.fr again. This time click the backdrop (outside the dialog). Verify: dialog does NOT close (AlertDialog default — AC2).
    5. Click Cancel. Verify: dialog closes, row unchanged.
    6. Click Révoquer on arc@capital.fr. Click Oui, révoquer. Verify in order: (a) dialog closes immediately, (b) arc@capital.fr row transitions to revoked appearance (55% opacity, gray StatusDot, no Révoquer button, "Révoqué le 22 avr. 2026" replacing the button — date = today in French short format), (c) toast "Accès révoqué" appears bottom-right with CircleCheckIcon, lives 3s, (d) "Destinataires actifs" MetricCard value changes from "2" to "1".
    7. Click Révoquer on martin@fund.io (pending). Confirm. Verify: row goes to revoked (55% opacity with em-dash still shown as sessionDuration — the revoked entry keeps its historical `sessionDuration` value per 3.4's AC). "Destinataires actifs" decrements to "0". All three rows are now revoked. No rows show a Révoquer button.
    8. Click Share button (Story 3.5). Type `test@fonds.fr`. Submit. Verify: toast "Invitation envoyée à test@fonds.fr". List gets a new pending row for test@fonds.fr at the top. Destinataires actifs goes from "0" to "1". Click Révoquer on test@fonds.fr. Confirm. Verify: row goes to revoked, "Destinataires actifs" goes back to "0".
    9. Navigate to the Contenu tab (click "Contenu"). Navigate back to Accès & analytics. Verify: all revoked state persists (tab navigation does NOT remount the route).
    10. Navigate to `/dashboard/dossiers/view/agrotrack?tab=analytics` (different slug). Verify: `accessEntries` re-seeds — arc@capital.fr is active, martin is pending, lea is revoked. This is the `DossierViewRoute` key-based remount from Story 3.5.
    11. Refresh the page (`F5`). Verify: all revoked state is gone, entries re-seed to the fixture — AC6's "re-mock on load is acceptable" behavior.
    12. Mobile viewport (375 px). Click Révoquer. Verify: dialog is centered with ~16 px left/right gutters (width ~343 px on 375 px viewport). Buttons stack vertically with "Oui, révoquer" on TOP (flex-col-reverse — destructive action rightmost-on-desktop translates to topmost-on-mobile via the `flex-col-reverse sm:flex-row sm:justify-end` recipe). Tapping Cancel closes without revoking.
    13. Mobile viewport (320 px). Verify: dialog width is `calc(100% - 2rem)` = 288 px. Text does not overflow. Buttons stack and span full dialog width. No horizontal scrollbar.
    14. Keyboard focus trap. Open dialog. Press Tab. Verify focus moves from Cancel to Oui, révoquer. Press Tab again. Verify focus cycles back to Cancel (Base UI focus trap). Press Shift+Tab. Verify focus moves backward. Press Escape. Verify dialog closes.
    15. Screen-reader smoke (VoiceOver on macOS / NVDA on Windows — if available). Open dialog. Verify AT announces "alert dialog, Révoquer l'accès ?, arc@capital.fr ne pourra plus consulter ce dossier, Cette action est immédiate, Annuler, button, dimmed" (exact phrasing varies by screen reader). The `role="alertdialog"` + Base UI wiring is sufficient — no manual ARIA.
    16. Prefers-reduced-motion probe. DevTools → Rendering → set `prefers-reduced-motion: reduce`. Click Révoquer. Verify the dialog appears nearly instantly (no visible scale-in or fade). Confirm click → dialog closes without visible transition. Row transitions to revoked without custom motion (the opacity change is CSS, not JS — AC14).
  - [x] No regression sweep on Stories 1.1 – 3.5 (AC15):
    - `/dashboard` empty state (2.2) still reachable if the user resets local state.
    - `/dashboard/dossiers/nouveau` wizard (2.3 – 2.6) unchanged.
    - Contenu tab renders dossier fields (3.2 unchanged).
    - `<StatusDot>` renders at 100% opacity for its own dot even when the parent row is dimmed (3.4 AC9 — verified post-3.4 code review). 3.6 does not touch StatusDot.
    - `<AccessListRow>` hover state on Révoquer: border + text flip to destructive on hover, background transparent (3.4 AC12). 3.6 reuses this exactly.
    - SharePanel open/close/submit all work (3.5 unchanged). Sheet + AlertDialog can both be open independently (they are separate Portal mounts, both under `document.body`). In practice, 3.6 does not open an AlertDialog while SharePanel is open — the revoke action is triggered from the analytics tab, not the Sheet.
    - Toast stack: 3.5's "Invitation envoyée" + 3.6's "Accès révoqué" share the same `<Toaster>` mount. Firing both in rapid succession stacks them per Sonner's default behavior.
  - [x] Update [_bmad-output/implementation-artifacts/deferred-work.md](deferred-work.md): the "Révoquer button has no onClick, silent no-op" bullet under "Deferred from: code review of 3-3-metric-card-grid-analytics-timeline-d4" is now RESOLVED by 3.6. Remove the bullet (preferred — keeps the file focused on still-open work) or strike it through with a `~~resolved in 3.6~~` note. See Pinned Decision #9.

- [x] **Task 5: Self-review sweep before marking story done**
  - [x] All 16 ACs trace to code (AC → Task mapping documented in each AC block and each Task header).
  - [x] Zero raw hex values in new + modified files (AC11, AC16).
  - [x] All static dialog copy lives inside `RevokeAccessDialog.tsx`. The runtime-shaped toast copy `"Accès révoqué"` lives in `[slug].tsx`'s `handleConfirmRevoke`. ZERO dialog copy in `alert-dialog.tsx` (primitive is copy-agnostic). ZERO dialog copy in `main.tsx`.
  - [x] `<RevokeAccessDialog>` prop contract is `{ open, entry, onOpenChange, onConfirm }` — no extra props, no `dossierSlug`, no `onCancel` (Cancel is implicit via `onOpenChange(false)`).
  - [x] `<AlertDialog>` primitive lives at `components/ui/alert-dialog.tsx` — the ONLY file that imports from `@base-ui/react/alert-dialog`. `RevokeAccessDialog.tsx` imports from `@/components/ui/alert-dialog`, NOT from Base UI directly. This protects against future migrations (if we ever swap Base UI out, only `alert-dialog.tsx` changes).
  - [x] `AlertDialogCancel` IS a Close slot (auto-closes). `AlertDialogAction` is a plain button (parent wires close). This split matches shadcn's canonical pattern.
  - [x] `handleConfirmRevoke` order: (1) setAccessEntries → (2) toast → (3) setEntryToRevoke(null). The row transitions visibly BEFORE the dialog unmounts.
  - [x] `MetricCard` grid: card 1 computes from state, cards 2 and 3 remain static fixture copy. The label for card 1 still comes from `MOCK_ANALYTICS.metrics[0].label` (label is copy, value is derived).
  - [x] `formatRevokedAt` uses `Intl.DateTimeFormat` via `toLocaleDateString('fr-FR', ...)` — no `date-fns` / `dayjs` dep (Pinned Decision #3). Output format `"22 avr. 2026"` matches the fixture's existing `"16 avr. 2026"` at mock-analytics.ts:57.
  - [x] The `'revoked' as const` narrowing is explicit — not `as AccessEntry` or `// @ts-expect-error`. The entry construction rebuilds all fields explicitly to narrow into the `'revoked'` branch of the discriminated union.
  - [x] Backdrop click does NOT dismiss the AlertDialog (Base UI AlertDialog default; AC2). NO `disablePointerDismissal` prop passed (the prop is omitted from `AlertDialogRoot.Props` by Base UI precisely because it's the default).
  - [x] The `@radix-ui/react-alert-dialog` package is NOT added to `apps/web/package.json`. Only Base UI is used. (Pinned Decision #7).
  - [x] `deferred-work.md` is updated: the 3.3-era "Révoquer button no onClick" item is removed (now resolved by 3.6). No new deferrals expected; if any emerge during walkthrough (e.g., bundle-size concerns, motion-preferences residuals), append to the 3.6 section.
  - [x] Commit strategy: single `feat(epic-3): story 3.6 — Access revocation (optimistic, mocked)` commit that bundles implementation AND any self-applied review patches (per user memory: "Code + review in a single commit", 2026-04-20). Do NOT split into `feat` + `fix` commits.

### Review Findings (2026-04-22)

Layered adversarial review — Blind Hunter (diff-only), Edge Case Hunter (diff + project), Acceptance Auditor (diff + spec). Triaged to 1 decision-needed, 6 patches, 5 deferrals, ~14 dismissed.

- [x] **[Review][Decision] Scope extension (Tooltip + `revokedAtIso` + `revokedBy`) violates spec Anti-Patterns and AC3/AC7/AC10/AC15** — **Resolved:** user chose option (b) — keep the extension and retroactively amend the spec. AC3, AC7, AC10, AC15, Anti-Patterns, Task 4 bundle ceiling, and the Change Log entry were all amended to document the overrides explicitly. New **Pinned Decision #11** captures the extension's scope, authorized file list, bundle cost, and touch-device limitation. Patches P1/P2/P4/P6 were applied (conditional patches on the Tooltip surface that was kept). — The 2026-04-22 Change Log entry touches two files the Anti-Patterns list explicitly forbids (`AccessListRow.tsx`, `mock-analytics.ts`), breaks AC3's "EXACTLY" entry shape, adds new consumer `useCurrentUser` not scoped by AC7, introduces new French copy outside AC10 ownership map, breaches AC10's +8-12 kB bundle ceiling (+18.42 kB actual), and contradicts AC15's "AccessListRow internals unchanged" regression clause. Change Log narrative does not acknowledge any of these spec overrides. User must decide: **(a)** revert the extension (drop `tooltip.tsx`, revert AccessListRow.tsx + mock-analytics.ts, remove `revokedAtIso`/`revokedBy`/`currentUser` wiring from handleConfirmRevoke) and ship original 3.6 scope as spec'd; **(b)** keep the extension and retroactively amend the spec (Change Log explicit about Anti-Pattern overrides, update AC3/AC7/AC10/AC15, raise bundle ceiling in AC10); **(c)** partial revert (e.g., keep `revokedBy` field but drop the Tooltip UI so no `AccessListRow.tsx` touch). Patches P1/P2/P4/P6 below are conditional on keeping any Tooltip surface.

- [x] **[Review][Patch] Tooltip trigger `role="button"` is misleading — no activation handler** [apps/web/src/components/confluent/AccessListRow.tsx:79] — **Applied:** dropped `role="button"` from the trigger's `render` prop; the focusable `<span tabIndex={0}>` remains keyboard-reachable and Base UI Tooltip opens on focus. — `render={<span tabIndex={0} role="button" />}` promises keyboard activation (Space/Enter) that the element does not implement. Screen readers announce "bouton" then nothing happens when activated. Fix: drop `role="button"` (plain focusable `<span tabIndex={0}>` is enough for Base UI Tooltip focus-open); or if button semantics are wanted for mobile tap-to-reveal, upgrade to `<button type="button">` with an explicit open toggle. WAI-ARIA 1.2: do not assign `role="button"` to non-activatable elements. Conditional on D1 keeping the Tooltip.
- [x] **[Review][Patch] Mock fixture `revokedAtIso` lacks timezone offset while runtime uses UTC** [apps/web/src/data/mock-analytics.ts:63] — **Applied:** fixture updated to `'2026-04-16T14:32:00+02:00'` (explicit CEST offset). Parsing is now unambiguous across browsers and consistent with runtime `new Date().toISOString()`. — Fixture `'2026-04-16T14:32:00'` (no `Z` or offset) is parsed as **local time** by `new Date(iso)`; new revocations use `now.toISOString()` which emits `Z`-suffixed **UTC**. `formatRevokedTime` then converts back to local — producing correct hour for runtime revocations but misleading hour for fixture rows on non-UTC browsers. Fix: pick one convention and apply it to both paths. Either (a) fixture → `'2026-04-16T14:32:00+02:00'` (explicit offset) or (b) runtime → store local-time string without `Z`. Conditional on D1 keeping the extension.
- [x] **[Review][Patch] Double-click on "Oui, révoquer" fires `toast.success` twice** [apps/web/src/components/confluent/RevokeAccessDialog.tsx:30-36] — **Applied:** added `revokingRef = useRef(false)` in `DossierView`. `handleConfirmRevoke` early-returns if the ref is already `true`, then sets it before the mutation. `handleRevokeClick` resets the ref to `false` on each new dialog open. Second rapid click is blocked before the second toast fires. — `AlertDialogAction` is a plain `<button>` (per Pinned Decision #10) with no in-flight guard; a rapid double-click fires `onConfirm(entry)` twice before the dialog unmounts. Second pass's `e.status === 'revoked'` branch no-ops the state mutation but `toast.success('Accès révoqué')` still fires a second time. Fix: guard at the source — either (a) in `handleConfirmRevoke` add `if (entryToRevoke === null) return;` before the work, OR (b) wrap `AlertDialogAction` to disable after first click, OR (c) move `setEntryToRevoke(null)` before `toast.success` (closes dialog and unmounts action button before the second click lands).
- [x] **[Review][Patch] Unused `TooltipProvider` export** [apps/web/src/components/ui/tooltip.tsx:5] — **Applied:** removed `TooltipProvider` definition and export. Base UI Tooltip works standalone; if global delay coordination is wanted later, wire `<TooltipProvider>` at the app root then. — `TooltipProvider` is exported but no caller imports it and `main.tsx` is untouched (correctly per Anti-Patterns). Dead surface. Fix: remove the export; Base UI Tooltip works standalone. If grouped delay coordination is wanted later, wire `<TooltipProvider>` at the app root then. Conditional on D1 keeping `tooltip.tsx`.
- [x] **[Review][Patch] Spec AC16 grep assertions contradict Task 3 canonical snippet and JSX `&apos;` escaping** [_bmad-output/implementation-artifacts/3-6-access-revocation-optimistic-mocked.md, AC16 line 115 & line 111] — **Applied:** AC16 now requires 2 matches for `MOCK_ANALYTICS.metrics[0]` (the `key=` and `label=` reads per Task 3's canonical snippet). AC16 copy-grep alternation now includes `Révoquer l&apos;accès` alongside the ASCII-apostrophe form, keeping the "exactly 3 matches" assertion valid given the JSX escaping rule. — (a) AC16 requires `grep "MOCK_ANALYTICS.metrics[0]"` → **exactly 1 match**, but Task 3's canonical snippet at line 402-407 emits both `key=…[0].label` and `label=…[0].label` → 2 matches. Debug Log at line 809 acknowledges this mismatch. (b) AC16 requires `grep "Révoquer l'accès|Oui, révoquer|ne pourra plus consulter ce dossier" RevokeAccessDialog.tsx` → **exactly 3 matches**, but Dev Notes line 517 requires `&apos;` escaping in JSX → the ASCII-apostrophe regex matches only 2. Debug Log at line 801 acknowledges this too. Fix: update AC16 grep assertions to reflect reality (2 / 2) or add a second alternation branch for the `&apos;` form.
- [x] **[Review][Patch] Trigger text duplicated in tooltip content** [apps/web/src/components/confluent/AccessListRow.tsx:80-87] — **Applied:** tooltip content reduced to the delta — `<p>à {formatRevokedTime(entry.revokedAtIso)}</p>` + `<p className="mt-0.5 text-muted-foreground">par {entry.revokedBy}</p>`. Screen readers no longer announce "Révoqué le X" twice. — The span trigger renders "Révoqué le {revokedAt}" and the `TooltipContent` also opens with "Révoqué le {revokedAt} à {time}". Screen readers announce the trigger's accessible name, then the tooltip's description — users hear "Révoqué le 16 avr. 2026" twice. Fix: tooltip content should carry only the delta (e.g., `<p>à {formatRevokedTime(revokedAtIso)}</p><p className="mt-0.5 text-muted-foreground">par {revokedBy}</p>`). Conditional on D1 keeping the Tooltip.

- [x] **[Review][Defer] `handleConfirmRevoke` keys by `email` — duplicate-email rows revoked together** [apps/web/src/routes/dashboard/dossiers/[slug].tsx:164-178] — deferred, pre-existing (already tracked in deferred-work.md under 3-3 code review: "React keys `entry.email` / `metric.label` can collide on duplicate values — stable IDs belong to Story 8.3 real data model"). The 3.6 consumer inherits the risk without widening it.
- [x] **[Review][Defer] `formatRevokedAt` may drift across ICU versions** [apps/web/src/routes/dashboard/dossiers/[slug].tsx:76-82] — deferred, Epic 7+ canonical date formatting. `Intl.DateTimeFormat('fr-FR', { month: 'short' })` can emit NBSP / hair-space separators and different month-abbreviation styles across Node/Chromium/WebKit ICU builds. Not worth pinning in mocked V1.
- [x] **[Review][Defer] `Intl.DateTimeFormat` instantiated per render of each revoked row** [apps/web/src/components/confluent/AccessListRow.tsx:12-17] — deferred, premature optimization. A module-level singleton would be ~10-20× faster but rows are few; revisit if performance profiling flags it.
- [x] **[Review][Defer] `revokedBy` hard-coded via `useCurrentUser()` mock** [apps/web/src/routes/dashboard/dossiers/[slug].tsx:175] — deferred, Epic 6 magic-link auth will bind real user identity. Today every session-created revocation attributes to the hardcoded mock name (`Sophie Moreau`), which is correct for the mocked scope.
- [x] **[Review][Defer] Manual tri-viewport browser walkthrough not executed** [AC16 line 120] — deferred, acknowledged by Dev Agent Record at spec line 811 ("remote headless environment has no browser available"). Human reviewer should complete the 16-step walkthrough (375 / 900 / 1440 px) before final sign-off.

**Dismissed (not written):** ~14 findings that are intentional per spec (Pinned Decision #4 "actifs = non-revoked" filter semantics; Pinned Decision #10 `AlertDialogAction` as raw button; spec-approved `e.status === 'revoked'` defensive guard; spec-approved explicit entry reconstruction for TS narrowing; Base UI primitive's auto `aria-labelledby`/`aria-describedby` wiring; tuple-typed `MOCK_ANALYTICS.metrics` access; Sheet-pattern size="lg" default; focus-visible opacity cascade; unreachable cross-row focus races; unreachable stale-entry-after-removal; backdrop+escape race handled by Base UI; redundant aria-describedby on Révoquer button; `entry?.email ?? ''` empty-string flash is spec-approved).

## Dev Notes

### Critical Architecture Constraints

- **`RevokeAccessDialog` lives at `apps/web/src/components/confluent/`** — design-system component with Confluent-specific copy and semantics. NOT in `components/ui/` (that's the primitive wrapper's home — `alert-dialog.tsx` goes there). NOT in `features/sharing/` (backend-era future folder per [architecture.md:661-663](../planning-artifacts/architecture.md#L661-L663); 3.6 is still frontend-mock scope). [Source: ux-design-specification.md §Component Implementation Strategy line 612-617; §Custom Components line 625-629]
- **Shadcn primitives are Base UI-based, NOT Radix.** The existing `sheet.tsx` imports from `@base-ui/react/dialog`; the new `alert-dialog.tsx` MUST import from `@base-ui/react/alert-dialog`. Running `pnpm dlx shadcn@latest add alert-dialog` would install `@radix-ui/react-alert-dialog` (the shadcn registry ships Radix-based primitives) — FORBIDDEN per AC9 + Pinned Decision #7. [Source: [apps/web/src/components/ui/sheet.tsx:2](apps/web/src/components/ui/sheet.tsx#L2); architecture.md:219-222; @base-ui/react/alert-dialog module exists at [@base-ui/react@1.4.0]]
- **Base UI `AlertDialog` is ALWAYS modal + NEVER dismisses on backdrop click.** The primitive's `AlertDialogRoot.Props` omits `modal` and `disablePointerDismissal` entirely — these are not user-configurable. Semantic distinction from a plain `Dialog`: alertdialog signals "this prompt requires an explicit choice". DO NOT attempt to enable backdrop dismissal; it would violate Base UI's semantic contract and the Epic AC2. [Source: [@base-ui/react/alert-dialog/root/AlertDialogRoot.d.ts](../../node_modules/.pnpm/@base-ui+react@1.4.0*/node_modules/@base-ui/react/alert-dialog/root/AlertDialogRoot.d.ts) — `Omit<DialogRoot.Props<Payload>, 'modal' | 'disablePointerDismissal' | 'onOpenChange' | 'actionsRef' | 'handle'>`]
- **Optimistic update = synchronous state mutation in 3.6 (NO API yet).** Story 8.5's AC ("DELETE /v1/dossiers/:id/shares/:linkId via TanStack Query optimistic update — rolls back if the API call fails") will wire the API mutation. 3.6 is the groundwork: the `handleConfirmRevoke` handler mutates local state immediately after confirm — no async, no loading spinner, no rollback path. Epic 8 will add `useMutation` + `onMutate` (optimistic) + `onError` (rollback) without changing the UX surface from 3.6. [Source: epics.md §Story 8.5 line 1649-1651; architecture.md:217]
- **The PRD + Epic override the UX spec on confirmation dialogs for revocation.** UX spec §Feedback Patterns at [ux-design-specification.md:659](../planning-artifacts/ux-design-specification.md#L659) states: `"No confirmation dialog for revocation: Revocation is immediate + toast."`. However: (a) Journey 4 in the PRD at [prd.md:141](../planning-artifacts/prd.md#L141) says `"immediate revocation with confirmation"` — PRD explicitly includes a confirmation step; (b) the Epic AC for 3.6 mandates a shadcn `AlertDialog` with title/description/Annuler/Oui, révoquer — explicit and unambiguous. Epic AC + PRD win over the UX spec when they conflict. This IS a deliberate divergence, not an oversight — entrepreneurs are likely to misclick on a destructive action, and the confirmation step is cheap risk mitigation that preserves the "silent revocation" outcome (from the financeur's perspective, nothing changes; only the entrepreneur's trigger path gets a confirmation). Update the UX spec in a future docs pass; 3.6 implements per Epic + PRD. [Source: epics.md §Story 3.6 line 787-815; prd.md §Journey 4 line 129-141; ux-design-specification.md §Feedback Patterns line 659 — CONTRADICTED BY 3.6]
- **Toaster is mounted once at the app root, reused across stories.** Sonner's `toast()` enqueues into whatever `<Toaster>` is mounted; if none is mounted, `toast()` silently no-ops. Story 3.5 mounted `<Toaster>` at [apps/web/src/main.tsx:12-16](apps/web/src/main.tsx#L12-L16). 3.6 reuses it for the "Accès révoqué" toast — NO new mount point, NO duplicate `<Toaster>`. Epic 4 (financeur confirmations), Epic 7 (questionnaire save), Epic 8 (share-link generation) all reuse the same mount. [Source: [apps/web/src/components/ui/sonner.tsx](apps/web/src/components/ui/sonner.tsx); ux-design-specification.md §Feedback Patterns line 653-661; Story 3.5 §Critical Architecture Constraints]
- **`accessEntries` is local component state — no Zustand, no context.** Story 3.5 lifted `accessEntries` to `DossierView`'s `useState` at [apps/web/src/routes/dashboard/dossiers/[slug].tsx:84-86](apps/web/src/routes/dashboard/dossiers/[slug].tsx#L84-L86). 3.6 consumes this same state + mutates it via the same `setAccessEntries`. DO NOT lift to a Zustand store (architecture.md:229 explicitly defers Zustand to a later emerging need). DO NOT hoist to React Context (over-engineering for a single consumer). 3.6 is still within the "local state is enough" envelope. [Source: architecture.md:229; Story 3.5 §Critical Architecture Constraints]
- **The `AccessEntry` discriminated union is unchanged.** 3.6 constructs a `'revoked'` branch entry: `{ email, initials, lastSeen, sessionDuration, status: 'revoked', revokedAt }`. The `revokedAt` field is REQUIRED for the 'revoked' branch per the union at [apps/web/src/data/mock-analytics.ts:16-18](apps/web/src/data/mock-analytics.ts#L16-L18) — omitting it causes a TS error. 3.6 does NOT introduce a new `'revoking'` transient status (that was a speculative note in 3.5's Critical Architecture Constraints; 3.6 implements the direct `active | pending → revoked` transition without an intermediate UI state because the mutation is synchronous). [Source: [apps/web/src/data/mock-analytics.ts:16-18](apps/web/src/data/mock-analytics.ts#L16-L18); Story 3.5 §Critical Architecture Constraints]
- **Route structure split from 3.5's code review MUST be preserved.** The route file exports a `DossierViewRoute` wrapper (reads slug, renders `<DossierView key={slug ?? 'no-slug'} />`) and an inner `DossierView` function. The `key` forces a remount on slug change, resetting local state (including `accessEntries` and `entryToRevoke`). DO NOT merge these back into a single component — that would re-introduce the "accessEntries persists across dossier-slug navigation" bug from 3.5's code review. [Source: Story 3.5 §Review Findings — "Applied by splitting the route's default export into a thin DossierViewRoute wrapper"; [apps/web/src/routes/dashboard/dossiers/[slug].tsx:74-77](apps/web/src/routes/dashboard/dossiers/[slug].tsx#L74-L77)]
- **Route path stays `/dashboard/dossiers/view/:slug`** — the path established by Story 2.6's code-review patch and preserved through 3.2/3.3/3.4/3.5. 3.6 does NOT "fix" the Epic-level path discrepancy with the bare `:slug`. [Source: [apps/web/src/router.tsx](apps/web/src/router.tsx); Stories 3.1 – 3.5 Pinned Decisions]
- **Design tokens only — no raw hex.** `alert-dialog.tsx` uses `bg-popover`, `text-popover-foreground`, `border-border`, `bg-black/10` (semi-transparent overlay, matches sheet's overlay recipe), `bg-destructive/10`, `text-destructive`, `hover:bg-destructive/20` (from buttonVariants destructive variant). `RevokeAccessDialog.tsx` adds no additional colors. AC11 + AC16's grep sweep is the automated guardrail.
- **French-locale typography:** `"Révoquer l'accès ?"`, `"${email} ne pourra plus consulter ce dossier. Cette action est immédiate."`, `"Annuler"`, `"Oui, révoquer"`, `"Accès révoqué"` — all copy verbatim from Epic AC. Do NOT "improve" with typographic spaces, alternate orthography, or abbreviations. Use ASCII apostrophes in source files (`'`, NOT `'`) and JSX-escape via `&apos;` inside JSX text (e.g., `Révoquer l&apos;accès ?`). Precedent: `SharePanel.tsx` at [apps/web/src/components/confluent/SharePanel.tsx:67-68](apps/web/src/components/confluent/SharePanel.tsx#L67-L68).
- **WCAG 2.1 AA baseline for AlertDialog.** Base UI AlertDialog applies `role="alertdialog"`, `aria-labelledby` (pointing at `<AlertDialogTitle>`), `aria-describedby` (pointing at `<AlertDialogDescription>`), and the focus trap. Keyboard navigation is built-in. Destructive Button contrast: `bg-destructive/10` + `text-destructive` yields ~4.8:1 contrast on a white popover background — meets WCAG AA for normal text. On hover, `bg-destructive/20` darkens toward ~5.3:1 — still AA. NO manual ARIA wiring needed. [Source: ux-design-specification.md §Accessibility line 377-405; prd.md §NFR20-NFR23 line 495-498]
- **The `MetricCard` value computation is the FIRST departure from static fixture in the analytics tab.** Stories 3.3 and 3.5 kept all MetricCard values static ("2 / 7 / 4m 32s" — epics.md:672-676). 3.6's AC4 requires the first value to decrement — which necessarily means it must be computed from state. The other two cards (Vues totales, Durée moy. de session) remain static; Epic 8 will wire them from real session-tracking analytics. [Source: epics.md §Story 3.6 AC5 at line 805; epics.md §Story 8.3 line 1581-1588; Story 3.3 §Critical Architecture Constraints — "STATIC copy — they do NOT recompute"]

### Design Tokens to Use

| Surface | Tailwind utility | Value | Where |
|---|---|---|---|
| AlertDialog container | `fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[calc(100%-2rem)] max-w-lg rounded-lg border border-border bg-popover p-6 text-popover-foreground shadow-lg` | Centered, ≤512 px wide, 16 px gutter on mobile | `<AlertDialogContent>` |
| AlertDialog backdrop | `fixed inset-0 z-50 bg-black/10 supports-backdrop-filter:backdrop-blur-xs` | Semi-transparent black + backdrop blur | `<AlertDialogOverlay>` (reused from sheet.tsx:29 recipe) |
| AlertDialog title | `font-heading text-base font-medium text-foreground` | 16 px / 500 / `#1A1A1A` | `<AlertDialogTitle>` |
| AlertDialog description | `text-sm text-muted-foreground` | 14 px / `#6B6B6B` | `<AlertDialogDescription>` |
| AlertDialog header | `flex flex-col gap-2 text-left` | Left-aligned (French convention, not shadcn's default centered) | `<AlertDialogHeader>` |
| AlertDialog footer | `flex flex-col-reverse gap-2 sm:flex-row sm:justify-end` | Stack → row-end at sm:, destructive rightmost on desktop, topmost on mobile | `<AlertDialogFooter>` |
| Cancel button | Inherited: `buttonVariants({ variant: 'outline', size: 'lg' })` → 44 px tall, `border-border bg-background hover:bg-muted` | 44 px outline button | `<AlertDialogCancel>` |
| Destructive confirm button | Inherited: `buttonVariants({ variant: 'destructive', size: 'lg' })` → 44 px tall, `bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20` | 44 px destructive button, muted red bg + red text | `<AlertDialogAction>` |
| Open/close transition | `transition duration-150 ease-in-out data-ending-style:opacity-0 data-starting-style:opacity-0 data-ending-style:scale-95 data-starting-style:scale-95` | 150 ms, fade + scale 0.95→1 | `<AlertDialogPrimitive.Popup>` |
| Toast (success) | Sonner default + `<Toaster>` wrapper at sonner.tsx:17-24 | `bg-popover` / `text-popover-foreground` / `border-border` / `radius-var(--radius)` / bottom-right / 3 s | `toast.success('Accès révoqué')` |
| Toast icon (success) | `CircleCheckIcon` from lucide-react via [apps/web/src/components/ui/sonner.tsx:11](apps/web/src/components/ui/sonner.tsx#L11) | 16 px (size-4) | Success variant |

### Component Prop Contracts (exhaustive)

```ts
// apps/web/src/components/ui/alert-dialog.tsx
// Re-exports Base UI primitive composition as shadcn-style parts:
export function AlertDialog(props: AlertDialogPrimitive.Root.Props): JSX.Element
export function AlertDialogTrigger(props: AlertDialogPrimitive.Trigger.Props): JSX.Element
export function AlertDialogPortal(props: AlertDialogPrimitive.Portal.Props): JSX.Element
export function AlertDialogOverlay(props: AlertDialogPrimitive.Backdrop.Props): JSX.Element
export function AlertDialogContent(props: AlertDialogPrimitive.Popup.Props): JSX.Element
export function AlertDialogHeader(props: React.ComponentProps<'div'>): JSX.Element
export function AlertDialogTitle(props: AlertDialogPrimitive.Title.Props): JSX.Element
export function AlertDialogDescription(props: AlertDialogPrimitive.Description.Props): JSX.Element
export function AlertDialogFooter(props: React.ComponentProps<'div'>): JSX.Element
export function AlertDialogCancel(props: AlertDialogPrimitive.Close.Props): JSX.Element
export function AlertDialogAction(props: React.ComponentProps<'button'>): JSX.Element
```

```ts
// apps/web/src/components/confluent/RevokeAccessDialog.tsx
import type { AccessEntry } from '@/data/mock-analytics'

export interface RevokeAccessDialogProps {
  open: boolean
  entry: AccessEntry | null
  onOpenChange: (open: boolean) => void
  onConfirm: (entry: AccessEntry) => void
}
export function RevokeAccessDialog(props: RevokeAccessDialogProps): JSX.Element
```

`AccessEntry` (unchanged from Story 3.3 / 3.4 / 3.5, preserved for reference):
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

Route-level additions to `[slug].tsx`:
```ts
// Module scope:
function formatRevokedAt(date: Date): string
  // → '22 avr. 2026' style via toLocaleDateString('fr-FR', { day, month: 'short', year }).

// Inside DossierView:
const [entryToRevoke, setEntryToRevoke] = useState<AccessEntry | null>(null)

function handleRevokeClick(entry: AccessEntry): void
  // → setEntryToRevoke(entry); opens the dialog

function handleConfirmRevoke(entry: AccessEntry): void
  // → (1) setAccessEntries(prev => prev.map(e => ... → revoked))
  //   (2) toast.success('Accès révoqué')
  //   (3) setEntryToRevoke(null)  // closes the dialog
```

### File Layout (target)

```
apps/web/src/
├── components/
│   ├── confluent/
│   │   ├── AccessListRow.tsx                                     [UNCHANGED — 3.4]
│   │   ├── DossierCard.tsx                                       [UNCHANGED]
│   │   ├── DossierField.tsx                                      [UNCHANGED]
│   │   ├── EmptyState.tsx                                        [UNCHANGED]
│   │   ├── MetricCard.tsx                                        [UNCHANGED]
│   │   ├── RevokeAccessDialog.tsx                                [NEW — Revoke confirmation dialog]
│   │   ├── SharePanel.tsx                                        [UNCHANGED — 3.5]
│   │   ├── StatusDot.tsx                                         [UNCHANGED — 3.4]
│   │   ├── WizardInput.tsx                                       [UNCHANGED]
│   │   └── illustrations/                                        [UNCHANGED]
│   ├── layout/                                                   [UNCHANGED]
│   └── ui/
│       ├── alert-dialog.tsx                                      [NEW — Base UI alert-dialog wrapper, shadcn-style parts]
│       ├── avatar.tsx                                            [UNCHANGED]
│       ├── badge.tsx                                             [UNCHANGED]
│       ├── button.tsx                                            [UNCHANGED]
│       ├── card.tsx                                              [UNCHANGED]
│       ├── input.tsx                                             [UNCHANGED]
│       ├── label.tsx                                             [UNCHANGED]
│       ├── separator.tsx                                         [UNCHANGED]
│       ├── sheet.tsx                                             [UNCHANGED — 3.5 reference pattern]
│       ├── sonner.tsx                                            [UNCHANGED — reuse Toaster from 3.5]
│       └── tabs.tsx                                              [UNCHANGED]
├── data/
│   ├── mock-analytics.ts                                         [UNCHANGED — still the seed source]
│   ├── mock-dossiers.ts                                          [UNCHANGED]
│   └── questionnaire.ts                                          [UNCHANGED]
├── features/                                                     [UNCHANGED]
├── lib/                                                          [UNCHANGED]
├── routes/
│   └── dashboard/
│       └── dossiers/
│           └── [slug].tsx                                        [MODIFIED — + formatRevokedAt helper, + entryToRevoke state, + handleRevokeClick/handleConfirmRevoke handlers, + <RevokeAccessDialog>, MetricCard grid expansion, AccessListRow.onRevokeClick wire-up]
├── main.tsx                                                      [UNCHANGED — <Toaster> already mounted per 3.5]
└── router.tsx                                                    [UNCHANGED]

apps/web/package.json                                             [UNCHANGED — no new deps; Base UI AlertDialog tree-shakes from @base-ui/react already installed]
pnpm-lock.yaml                                                    [UNCHANGED]
```

### Previous Story Intelligence

**From Story 3.5 (just landed — `9ba8ff9`):**
- `<Toaster>` is mounted at the app root inside `<CurrentUserProvider>`. 3.6 reuses it for the "Accès révoqué" toast — NO new Toaster mount.
- `accessEntries` is component-local `useState<AccessEntry[]>` inside `DossierView`. 3.6 passes the same `setAccessEntries` setter to mutate entries in place (via `.map` on the previous array).
- The `DossierViewRoute` wrapper + `<DossierView key={slug ?? 'no-slug'} />` pattern forces remount on slug navigation. 3.6 MUST preserve this — without it, `entryToRevoke` (and the existing `accessEntries`, `shareOpen`) would leak across dossiers.
- The `deriveInitials` helper and `handleInvitationSubmit` handler are module-local / component-local. 3.6 introduces `formatRevokedAt` as a sibling module-scope helper to `deriveInitials`.
- The `<Sheet>` + `<SheetTrigger>` + `<SheetContent>` composition works without collisions against other Portal-mounted components. 3.6's `<AlertDialog>` is also Portal-mounted and coexists fine — they are siblings under `document.body`, not nested.
- Single-commit preference: "Code + review in a single commit" from user memory (2026-04-20). 3.6's commit format: `feat(epic-3): story 3.6 — Access revocation (optimistic, mocked)`.
- 3.5 bundled at 559.94 kB JS (gz 174.67 kB). Vite emits `>500 kB chunk` advisory. 3.6 adds modest bundle delta (~8–12 KB gz) — no new npm dep, Base UI already installed. Code-splitting remains deferred to Epic 10.

**From Story 3.4 (AccessListRow + StatusDot extraction — `e04e2a2`):**
- `<AccessListRow>` already exposes `onRevokeClick?: (entry: AccessEntry) => void` — optional callback. Story 3.4 set up the plumbing; 3.6 wires the consumer.
- The revoked row appearance (55% opacity, gray StatusDot, no Révoquer button, "Révoqué le [date]" label) is fully implemented in `AccessListRow.tsx` — 3.6 triggers this state via `setAccessEntries`; no styling work needed.
- The "active" and "pending" row appearance (with Révoquer button visible + hover-destructive styling) is fully implemented — 3.6 wires the onClick behavior to this existing surface.
- Discriminated union narrowing: the `'revoked'` branch requires `revokedAt: string`. 3.6 constructs this field via `formatRevokedAt(new Date())`.

**From Story 3.3 (MetricCard + analytics tab — `a093915`):**
- The MetricCard grid renders 3 static cards from `MOCK_ANALYTICS.metrics`. 3.6 introduces the first derived-from-state value (Destinataires actifs). 3.3's deferred "silent no-op Révoquer button" bullet in deferred-work.md is RESOLVED by 3.6 — remove it.
- 3.3's AC1 values `"2 / 7 / 4m 32s"` — the "2" value matches the post-3.6 computation of `accessEntries.filter(e => e.status !== 'revoked').length` at seed (1 active + 1 pending = 2 non-revoked). AC4 is consistent with 3.3 AC1.

**From Story 3.2 (dossier header + Tabs — `791997b`):**
- Tab navigation is URL-driven (`?tab=analytics`). Tab switch does NOT remount the route — `accessEntries` and `entryToRevoke` state persists across tab toggles.

**From Stories 2.3 / 2.4 (questionnaire forms):**
- The plain-useState form + inline error pattern is orthogonal to 3.6. The AlertDialog has no form inputs — its only "validation" is the explicit Cancel/Confirm choice.

**From Stories 3.3 / 3.4 §Review Findings — items explicitly tagged for 3.6 resolution:**
- "Révoquer button has no onClick, silent no-op" — 3.6 owns the handler wiring. **Resolved by this story**; remove from deferred-work.md as part of Task 4.
- "React keys `entry.email` / `metric.label` can collide on duplicate values" — still deferred to Story 8.3 (real API data). 3.6 does not widen this concern; the MetricCard grid's 3 tuple entries have fixed distinct labels.
- "Revoked row's `opacity-[0.55]` dims the grey dot below WCAG 3:1" — already fixed in 3.4 by hoisting StatusDot out of the dimmed region. 3.6 does not touch.

### Decisions Pinned for This Story

The following decisions are locked for Story 3.6 implementation. Do not renegotiate without explicit retrospective action.

1. **`<AlertDialogContent>` size override is `w-[calc(100%-2rem)] max-w-lg` (no breakpoint override on width).** The `calc(100% - 2rem)` gives a consistent 16 px gutter on each side at any viewport, capped at `max-w-lg` (512 px) on desktop. NO mobile-specific `sm:max-w-*` variant — the primitive is intentionally one-size at all viewports. Rationale: AlertDialog is a short confirmation — no long-form content warrants a wider dialog; a uniform width simplifies the primitive's API. Contrast with `<SheetContent>` at 3.5 which uses `w-[300px] sm:max-w-[300px]` because the Sheet has a fixed-width contract.
2. **No top-right `X` close button on AlertDialogContent.** Contrast with `<SheetContent>` at [apps/web/src/components/ui/sheet.tsx:60-75](apps/web/src/components/ui/sheet.tsx#L60-L75) which renders `<SheetPrimitive.Close>` with an `XIcon`. AlertDialog's dismissal paths are ONLY Cancel + Escape. An X close button would be redundant (the Cancel button IS the dismiss-without-action affordance) and would encourage users to miss the Annuler/Oui split. Rationale: shadcn's canonical AlertDialog also omits the X; aligns with ARIA Authoring Practices for alertdialog.
3. **`formatRevokedAt` uses `Intl.DateTimeFormat` / `toLocaleDateString`.** Input: `Date`. Output: `"22 avr. 2026"` (French abbreviated month with period — matches the fixture). NO `date-fns`, `dayjs`, or `luxon` dependency. Rationale: (a) zero bundle cost; (b) the `fr-FR` locale + `month: 'short'` format emits exactly the fixture's format (verified by hand against the existing `'16 avr. 2026'` string); (c) `Intl.DateTimeFormat` is production-stable, locale-aware, and aligns with architecture.md's "no unnecessary dependencies" principle. If Epic 7's real backend needs to parse this date back, the format is unambiguous enough for a regex match (`/(\d+) (\w+)\. (\d{4})/`). The Epic's seed fixture `revokedAt: '16 avr. 2026'` format is the canonical one; `formatRevokedAt(new Date(2026, 3, 22))` emits `'22 avr. 2026'` which round-trips.
4. **"Destinataires actifs" = non-revoked recipients (active + pending), NOT API-strict `status='active'`.** The V1 UI interpretation reconciles Story 3.3 AC1 (initial value "2", matching the 1-active+1-pending fixture = 2 non-revoked) with Story 3.6 AC3 ("decrement by 1 when revoking an active OR pending entry"). The backend interpretation at Story 8.3 will compute `active_recipients: count of share links with status: 'active'` (strictly active, per epics.md:1583) — narrower semantics. When Epic 8's frontend swap lands (Story 8.5), the frontend will switch to the backend's strict interpretation and the fixture's seed value will drop from "2" to "1". That's an Epic 8 concern — 3.6 explicitly uses the broader V1 interpretation to satisfy both 3.3 AC1 and 3.6 AC3.
5. **`<RevokeAccessDialog>` is a separate component, NOT inlined in `[slug].tsx`.** Follows Story 3.5's Pinned Decision #5 precedent (SharePanel extraction rationale: encapsulates copy + layout, even with a single call site, because the boundary is visible). The dialog has ~25 LOC of JSX + 3 hardcoded copy strings — extracting isolates the copy from the route's state-mutation logic. Epic 5 (admin back-office — dossier deletion, user deletion confirmation dialogs) will reuse the same `<AlertDialog>` primitive but with different copy; `RevokeAccessDialog` establishes the extraction pattern for those future dialogs.
6. **Copy ownership (mirrors Story 3.5 Pinned Decision #9):** static dialog copy lives in `RevokeAccessDialog.tsx`; runtime-shaped copy lives in the route's `handleConfirmRevoke` (toast text `"Accès révoqué"`) and in `formatRevokedAt` (the date string). Specifically:
   - `RevokeAccessDialog.tsx` owns: `"Révoquer l'accès ?"`, `"Annuler"`, `"Oui, révoquer"`, and the description template `"${entry?.email ?? ''} ne pourra plus consulter ce dossier. Cette action est immédiate."`.
   - The route's `handleConfirmRevoke` owns: `"Accès révoqué"` (toast copy).
   - `formatRevokedAt` owns: the date-formatting logic (but no hardcoded month names — `Intl` provides them).
   Rationale: the dialog is a presentation layer for static prompts; the toast + the date string are shaped by runtime data (the click timestamp + the triggering entry), so they live with the mutation handler.
7. **Do NOT run `pnpm dlx shadcn@latest add alert-dialog` — hand-write the primitive over `@base-ui/react/alert-dialog` instead.** The shadcn CLI registry ships Radix-based primitives. Installing via CLI would add `@radix-ui/react-alert-dialog` as a new npm dep, forking the project's dialog stack (Base UI for Sheet, Radix for AlertDialog). The hand-written wrapper mirrors `sheet.tsx`'s shape, adds zero new deps, and preserves the project's Base UI convention. If the shadcn CLI ever adds a Base UI registry variant, consider migrating to it; until then, hand-write. Rationale: architecture.md:219-222 says "shadcn/ui (CLI v4)" and "Radix UI primitives" but the project CHOSE Base UI in Story 1.2 — the architecture note predates the Story 1.2 decision. The de facto convention is Base UI; 3.6 preserves it.
8. **Footer layout: `flex-col-reverse gap-2 sm:flex-row sm:justify-end`.** Mobile stacks with destructive Action button on TOP (flex-col-reverse reverses the JSX order of Cancel-then-Action so Action appears first vertically); `sm:` and up switches to horizontal-end (destructive Action rightmost). Contrast with `SheetFooter`'s `flex-col gap-2 sm:flex-row-reverse` (primary on TOP on mobile via flex-col + JSX order, primary on right at sm: via flex-row-reverse). Why the difference: SharePanel's footer has primary-first-in-JSX (so flex-col naturally puts primary on top); AlertDialog's canonical JSX order is Cancel-then-Action (so flex-col-reverse puts Action on top). Both achieve the same UX outcome: destructive/primary on top-mobile + rightmost-desktop. Rationale: shadcn's default AlertDialogFooter recipe is `flex flex-col-reverse gap-2 sm:flex-row sm:justify-end` — preserving it minimizes divergence from the broader ecosystem and lowers the learning cost for future contributors who've seen shadcn AlertDialogs elsewhere.
9. **`deferred-work.md` bullet removal rule:** when a story resolves a previously-deferred item, REMOVE the bullet from `deferred-work.md` (preferred) rather than strike-through. The file's purpose is "items deliberately postponed, still open"; strike-through clutters the signal. Document the resolution in the story's Completion Notes (Story 3.6 completion will note "Resolved 3.3-era deferral: Révoquer button now wired to AlertDialog + optimistic state mutation"). If a bullet is partially resolved (e.g., handler is wired but API-round-trip is still deferred), split the bullet into resolved (delete) + still-open (keep with updated scope).
10. **`AlertDialogCancel` is a `<Close>` slot; `AlertDialogAction` is a plain `<button>`.** This is shadcn's canonical split:
    - `AlertDialogCancel` uses `AlertDialogPrimitive.Close` — the Base UI primitive automatically dismisses the dialog on click (sets the Dialog's open state to `false`, which fires `onOpenChange(false)`). The parent receives the close event via its `onOpenChange` callback. NO `onClick` is wired at the call site for Cancel.
    - `AlertDialogAction` uses a plain `<button>` — does NOT automatically dismiss. The parent wires `onClick` for the destructive action (firing `onConfirm(entry)`), and is then responsible for dismissing the dialog by resetting its own state. This is why `handleConfirmRevoke` calls `setEntryToRevoke(null)` at step 3.
    Rationale: allows the confirm action to EXECUTE before the dialog closes (or, in a future async variant, to show a loading state while the mutation is in flight). If both buttons were Close slots, the dialog would close before the mutation fired, making rollback animations hard to sequence. The split also matches the Epic AC3 ordering: "(1) the dialog closes immediately, (2) the `AccessListRow` transitions..." — in code, the order is reversed (state mutation FIRST, then close), but visually the dialog close animation (150 ms fade) happens concurrently with the row transition, so the user perceives them simultaneously. In practice for 3.6: the primary ordering is "dialog closes (step 3.3 in AC3) → list mutates (step 3.2)", matched in code by handleConfirmRevoke's (setAccessEntries → toast → setEntryToRevoke(null)) — the setAccessEntries mutation batches with the same React render as the subsequent setEntryToRevoke(null), so both visible effects land in the same frame.
11. **Scope extension of 2026-04-22 — Revocation-detail tooltip on the revoked row label.** The original AC1-AC16 set limits 3.6 to an `AlertDialog`-only surface. During review the user requested that the `"Révoqué le {date}"` label on a revoked row expose the full timestamp and author on hover/focus. This was adopted as a scope extension with the following concrete overrides of the original spec: (a) the `AccessEntry` discriminated union's `revoked` branch gains two required fields `revokedAtIso: string` + `revokedBy: string`; (b) `handleConfirmRevoke` writes both fields (ISO via `new Date().toISOString()`, author via `useCurrentUser().name`); (c) `AccessListRow.tsx` wraps the revoked label in a `<Tooltip>` trigger + `<TooltipContent>` that reads `entry.revokedAtIso` (through a local `formatRevokedTime` helper) and `entry.revokedBy`; (d) a new `tooltip.tsx` primitive over `@base-ui/react/tooltip` is added, mirroring `sheet.tsx`/`alert-dialog.tsx` conventions; (e) the fixture `lea@invest.com` is enriched with `revokedAtIso: '2026-04-16T14:32:00+02:00'` + `revokedBy: 'Marc Dubois'`. **Files touched beyond the original AC7 surface:** `apps/web/src/components/confluent/AccessListRow.tsx`, `apps/web/src/data/mock-analytics.ts`, `apps/web/src/components/ui/tooltip.tsx` (new). **Anti-Pattern overrides:** the "Do NOT touch AccessListRow.tsx" / "Do NOT touch mock-analytics.ts" bullets below are lifted for this scope extension only — see the Anti-Patterns addendum. **Bundle cost:** the original Task 4 estimate of "+~8-12 KB gzipped" is raised to "+~18-19 KB gzipped" (Tooltip primitive pulls its own anchor-positioning + provider infra distinct from Dialog's internals). **Rationale for adoption:** the information (who revoked, when exactly) is useful for audit and multi-owner dossier contexts; hover-disclosure avoids adding a visible column that would compete with the revoked-row's muted visual. **Touch-device limitation (acknowledged):** Base UI Tooltip opens on hover and focus, not on tap — touch users cannot reach the tooltip content today. Tracked as a future mobile-UX pass (candidate solutions: tap-to-reveal, `<details>` disclosure, or a dedicated detail sheet). **Code-review patches applied (2026-04-22):** P1 (dropped misleading `role="button"` from trigger), P2 (fixture ISO gets explicit `+02:00` offset to match runtime `toISOString` UTC semantics), P4 (removed unused `TooltipProvider` export), P6 (tooltip content dropped the redundant "Révoqué le X" prefix — trigger text already conveys it).

### Anti-Patterns to Avoid

- **Do NOT install `@radix-ui/react-alert-dialog`** via any means (pnpm add, shadcn CLI, manual edit). Base UI only (Pinned Decision #7).
- **Do NOT import primitives from `@radix-ui/*`** in `alert-dialog.tsx` or anywhere else. This project uses Base UI exclusively. Radix is not installed, and its API is not interchangeable.
- **Do NOT use a plain `<Dialog>` (`@base-ui/react/dialog`) for revocation.** Use `<AlertDialog>` (`@base-ui/react/alert-dialog`) — the semantic distinction matters for AT (`role="alertdialog"`), and Base UI's AlertDialog correctly omits backdrop-click dismissal (AC2).
- **Do NOT add a loading spinner or disabled state to the "Oui, révoquer" button during the synchronous mutation.** 3.6 is fully synchronous (local state update). A loading spinner would imply async work — correct in Story 8.5 when the API mutation lands, incorrect in 3.6. Revisit in 8.5.
- **Do NOT render `<RevokeAccessDialog>` inside `<AccessListRow>`.** The dialog must be a sibling of the row list, not a child — otherwise each row renders its own dialog (4+ dialogs in the DOM), the focus trap breaks across dialogs, and the `entryToRevoke` state multiplies. One dialog per route, driven by the route-level `entryToRevoke` state.
- **Do NOT mutate `MOCK_ANALYTICS.accessEntries` directly.** The fixture is `readonly as const` at [apps/web/src/data/mock-analytics.ts:60](apps/web/src/data/mock-analytics.ts#L60); TS errors on direct mutation. The route-level `accessEntries` is the ONLY mutable copy; `setAccessEntries` is the ONLY entry point to mutate it.
- **Do NOT compute the revoked-at date inside `RevokeAccessDialog`.** The date is a function of the click timestamp, not of the dialog's render — it must be computed in the route's `handleConfirmRevoke` where the click is consumed. Computing inside the dialog would make the dialog impure and harder to test.
- **Do NOT use a hardcoded French month-name array** (e.g., `['janv.', 'févr.', ..., 'déc.']`). Use `Intl.DateTimeFormat` via `toLocaleDateString('fr-FR', { month: 'short' })` — the platform provides the locale-correct abbreviation (Pinned Decision #3). A hardcoded array forks from the platform's locale database and drifts over time.
- **Do NOT store the `entryToRevoke` state inside `<RevokeAccessDialog>`.** The dialog is a controlled component — its `open` + `entry` are derived from the route's `entryToRevoke`. Dual-sourcing state leads to desync (closed dialog + non-null entry, or open dialog + null entry). Keep state ownership at the route level.
- **Do NOT add extra props to `<RevokeAccessDialog>`** beyond the 4 in the contract (`open`, `entry`, `onOpenChange`, `onConfirm`). No `dossierSlug`, no `onCancel` (implicit via `onOpenChange(false)`), no `title` / `description` prop overrides (copy is static per Pinned Decision #6). Future Epic-5 admin dialogs with different copy should be new components (`DeleteDossierDialog.tsx`, `DeleteUserDialog.tsx`), NOT a generalized `<ConfirmDialog>` taking copy props — that would bloat the prop surface and dilute the copy-ownership pattern.
- **Do NOT use `useEffect` to trigger the toast or state mutation.** The mutation is a click-event consequence, not a render-driven side effect. Calling from `useEffect([entryToRevoke])` would double-fire under React 19 StrictMode. Call from the click handler inline.
- **Do NOT add `preventScroll`, `trap`, or any custom focus-management props** to `<AlertDialog>`. Base UI's defaults are WCAG-compliant. Manual overrides risk breaking the focus trap (Story 3.4's hover-contrast deferred item showed that Base UI's focus management composes cleanly with Tailwind-v4's class cascade).
- **Do NOT recompute `MOCK_ANALYTICS.metrics[1]` or `metrics[2]`** (Vues totales, Durée moy. de session) from local state. Those are static Epic-8 responsibilities. 3.6 only computes metrics[0]. Touching the other two would drift the analytics fixture out of shape with Story 3.3's AC1.
- **Do NOT touch `main.tsx`.** The Toaster is already mounted. Zero changes.
- **Do NOT touch `mock-analytics.ts`** — *amended 2026-04-22:* the fixture is the seed source — modifying it changes every dossier's initial state. The 2026-04-22 scope extension (Pinned Decision #11) lifts this restriction narrowly: it extends the `AccessEntry` revoked-branch discriminated union with `revokedAtIso: string` + `revokedBy: string` (required fields) and enriches the `lea@invest.com` fixture accordingly. Any further touches remain forbidden without a matching Pinned Decision amendment. If a future story needs per-dossier seeds, that's Epic 7 territory.
- **Do NOT touch `AccessListRow.tsx` or `StatusDot.tsx`** — *amended 2026-04-22:* 3.4 locked these surfaces. The 2026-04-22 scope extension (Pinned Decision #11) lifts this restriction for `AccessListRow.tsx` narrowly: the `entry.status === 'revoked'` branch is allowed to wrap the existing "Révoqué le X" label in a `<Tooltip>` that surfaces `revokedAtIso` + `revokedBy`. `<StatusDot>` remains fully locked. Any further touches to `AccessListRow.tsx` (avatar, email/lastSeen, Révoquer button, etc.) remain forbidden.
- **Do NOT touch `SharePanel.tsx` or the SharePanel wiring in `[slug].tsx`** beyond the MetricCard grid rewrite. 3.5 locked the SharePanel flow.
- **Do NOT use `window.confirm()` as a fallback or shim.** Browser-native confirm dialogs break keyboard navigation, ignore locale, and cannot be styled. Always use `<AlertDialog>`.

### Visual References

- UX spec anatomy:
  - [§Journey 4 Sophie Access Revocation (line 483-497)](../planning-artifacts/ux-design-specification.md#L483-L497) — the flow diagram (Sophie → dashboard → row → clic Révoquer → revoked state + toast).
  - [§AccessListRow (line 555-564)](../planning-artifacts/ux-design-specification.md#L555-L564) — the row's revoke button hover state (`border hover:border-destructive hover:text-destructive`).
  - [§Feedback Patterns — Toast + No-confirmation-dialog rule (line 653-661)](../planning-artifacts/ux-design-specification.md#L653-L661) — documents the "no confirmation" rule that the Epic AC deliberately overrides (see Critical Architecture Constraints).
  - [§Button Hierarchy — Destructive variant (line 649)](../planning-artifacts/ux-design-specification.md#L649).
- Epic AC: [epics.md §Story 3.6 (line 787-815)](../planning-artifacts/epics.md#L787-L815).
- PRD Journey 4: [prd.md §Journey 4 Sophie Unwanted Access (line 129-141)](../planning-artifacts/prd.md#L129-L141) — "immediate revocation with confirmation".
- Base UI AlertDialog docs: https://base-ui.com/react/components/alert-dialog
- shadcn-ui AlertDialog reference (Radix-based, for structural comparison only): https://ui.shadcn.com/docs/components/alert-dialog
- Shadcn Sheet implementation (Base UI-wrapped — exact pattern to mirror for alert-dialog.tsx): [apps/web/src/components/ui/sheet.tsx](apps/web/src/components/ui/sheet.tsx).
- Shadcn Button primitive with destructive variant: [apps/web/src/components/ui/button.tsx:18-19](apps/web/src/components/ui/button.tsx#L18-L19).
- Shadcn Sonner wrapper (reuse for the revocation toast): [apps/web/src/components/ui/sonner.tsx](apps/web/src/components/ui/sonner.tsx).
- AccessListRow with revoke button + onRevokeClick prop (3.4): [apps/web/src/components/confluent/AccessListRow.tsx:67-80](apps/web/src/components/confluent/AccessListRow.tsx#L67-L80).
- SharePanel extraction precedent (follow the structure): [apps/web/src/components/confluent/SharePanel.tsx](apps/web/src/components/confluent/SharePanel.tsx).

### Latest Technical Information

- **Base UI v1.4.0** — ships `@base-ui/react/alert-dialog` as a distinct module from `@base-ui/react/dialog`. AlertDialog is always modal, always non-dismissible on backdrop click; the primitive omits `modal` and `disablePointerDismissal` from its props. Focus trap, role="alertdialog", aria-labelledby, aria-describedby are all automatic. Initial focus defaults to the first tabbable element (Cancel in our layout — which is the less-destructive choice, matching AT conventions).
- **Sonner v2.0.7** — `toast.success('Accès révoqué')` is synchronous, returns a toast ID, renders via the mounted `<Toaster>`. Default position is `'bottom-right'` on desktop, `'top-center'` on mobile; the project's Toaster wrapper does not override position.
- **`Intl.DateTimeFormat` / `Date.prototype.toLocaleDateString`** — locale-aware date formatting is a V8/SpiderMonkey/WebKit primitive. `toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })` emits `"22 avr. 2026"` on modern browsers (Chrome 110+, Firefox 100+, Safari 15+). No polyfill needed for Vite's browserslist target.
- **Tailwind v4 arbitrary values** — `w-[calc(100%-2rem)]`, `max-w-lg`, `gap-2`, `p-6`, `rounded-lg`, `flex-col-reverse`, `sm:flex-row`, `sm:justify-end`, `data-ending-style:opacity-0`, `data-starting-style:opacity-0`, `data-ending-style:scale-95`, `data-starting-style:scale-95` are all valid at the project's Tailwind version. The `data-*-style:*` utilities are Base UI's CSS-in-data-attribute motion hook — match the sheet.tsx recipe for consistency.
- **React 19 StrictMode** — the `setAccessEntries` state mutation inside `handleConfirmRevoke` is an event-handler call, NOT a render-driven side effect. It does NOT double-fire under StrictMode. The `setEntryToRevoke(null)` closing the dialog is also in the event handler — no StrictMode duplication risk.
- **TypeScript 6.0.2 discriminated-union narrowing** — the `'revoked' as const` annotation is required for the object literal in `handleConfirmRevoke` to narrow into the `AccessEntryBase & { status: 'revoked'; revokedAt: string }` branch. Without `as const`, TS widens `status` to `string` and the union cannot absorb the object. The project's TypeScript version (`~6.0.2` at [apps/web/package.json:33](apps/web/package.json#L33)) supports this pattern natively.
- **pnpm workspace** — no new deps in 3.6. No `pnpm add`, no `pnpm-lock.yaml` changes expected. If the lockfile changes anyway (e.g., transitive updates from other workspaces), commit the delta but call it out in Completion Notes as unexpected.

### Project Context Reference

No `project-context.md` file present in the repo (checked via glob at session start). The BMAD planning artifacts (`architecture.md`, `ux-design-specification.md`, `epics.md`, `prd.md`) are the authoritative context.

### References

- [Source: epics.md §Story 3.6 line 787-815]
- [Source: epics.md §Epic 3 scope line 199-202, 594-596]
- [Source: epics.md §Story 8.5 line 1649-1651 — future API-wiring with optimistic update + rollback]
- [Source: epics.md §Story 8.3 line 1583-1588 — backend `active_recipients` semantics (strict `status='active'`) for Epic 8 frontend swap]
- [Source: prd.md §Journey 4 Sophie Unwanted Access line 129-141]
- [Source: prd.md §Journey 4 Capabilities Revealed line 141 — "immediate revocation with confirmation"]
- [Source: ux-design-specification.md §Journey 4 Sophie Access Revocation line 483-497]
- [Source: ux-design-specification.md §AccessListRow anatomy + Revoke button line 555-564]
- [Source: ux-design-specification.md §Feedback Patterns — Toast / No confirmation dialog rule line 653-661 (CONTRADICTED by Epic AC; see Critical Architecture Constraints)]
- [Source: ux-design-specification.md §Button Hierarchy — Destructive line 644-651]
- [Source: architecture.md §Frontend Stack — Optimistic updates for revocation line 217]
- [Source: architecture.md §UI Components — shadcn/ui + Radix UI line 219-222 — superseded by Story 1.2's Base UI decision]
- [Source: architecture.md §Local UI State line 229]
- [Source: Story 3.5 implementation — Toaster mount, accessEntries local state, DossierViewRoute remount pattern, copy-ownership rule]
- [Source: Story 3.4 implementation — AccessListRow.onRevokeClick plumbing, StatusDot extraction, discriminated-union AccessEntry]
- [Source: Story 3.3 implementation — MetricCard grid, static fixture values, deferred "silent Révoquer" item]
- [Source: Story 3.2 implementation — Tabs URL-driven state, no remount on tab switch]
- [Source: Story 1.2 implementation — Base UI migration, design tokens, shadcn-via-Base-UI convention]
- [Source: [apps/web/src/components/ui/sheet.tsx](apps/web/src/components/ui/sheet.tsx) — canonical Base UI wrapper pattern to mirror for alert-dialog.tsx]
- [Source: [apps/web/src/components/ui/button.tsx:18-19](apps/web/src/components/ui/button.tsx#L18-L19) — destructive variant]
- [Source: [apps/web/src/components/confluent/AccessListRow.tsx:67-80](apps/web/src/components/confluent/AccessListRow.tsx#L67-L80) — revoke button with onRevokeClick prop]
- [Source: [apps/web/src/data/mock-analytics.ts:16-18](apps/web/src/data/mock-analytics.ts#L16-L18) — AccessEntry discriminated union]
- [Source: [_bmad-output/implementation-artifacts/deferred-work.md](deferred-work.md) — 3.3 review "Révoquer button has no onClick" resolved by 3.6]

### Project Structure Notes

- No conflict with the unified project structure. `apps/web/src/components/confluent/RevokeAccessDialog.tsx` and `apps/web/src/components/ui/alert-dialog.tsx` slot into their respective folders alphabetically without path variance.
- The `features/` folder path from [architecture.md:661-663](../planning-artifacts/architecture.md#L661-L663) is reserved for Epic 7+ feature-local code. `RevokeAccessDialog` stays in `components/confluent/` because its surface is purely mocked V1 UI — when Epic 8's real-API revocation mutation lands, `RevokeAccessDialog` MAY migrate to `features/sharing/components/` alongside its TanStack Query hook, but 3.6 keeps it in the design-system folder.
- `packages/shared/src/schemas/` has no 3.6 additions — revocation is a mutation, not a form submission, so no Zod schema is needed yet. Epic 8's `DELETE /v1/dossiers/:id/shares/:linkId` will need response-shape validation, which lives in the backend's service layer; the frontend consumer won't need a Zod schema.
- `apps/web/src/components/ui/alert-dialog.tsx` is a new primitive file — it mirrors `sheet.tsx`'s file structure exactly (imports → Root/Trigger/Portal/Overlay/Content/Header/Title/Description/Footer/Cancel/Action in order → single `export {...}` block at the bottom). This consistency benefits future contributors auditing the primitives directory.

## Dev Agent Record

### Agent Model Used

claude-opus-4-7 (1M context) — Claude Code dev-story workflow (2026-04-22)

### Debug Log References

- `pnpm turbo run typecheck` — 2 successful, 0 errors (3 runs: post-Task 1, post-Task 2, post-Task 3).
- `pnpm turbo run lint` — 2 successful, 0 errors. Preserved exactly 3 pre-existing warnings (`badge.tsx:52`, `button.tsx:58`, `features/current-user/context.tsx:17`); 0 new warnings from `alert-dialog.tsx` or `RevokeAccessDialog.tsx`.
- `pnpm turbo run build` — 2 successful, 0 errors. Bundle: `index-C9PvOprK.js` at 563.96 kB (gz 175.59 kB). Delta vs 3.5 (559.94 kB / gz 174.67 kB): +4.02 kB JS / +0.92 kB gz — well under the AC10 +~8–12 KB gz ceiling (Base UI AlertDialog re-exports from its Dialog module, which is already bundled from Story 3.5's Sheet).
- Grep guardrails (AC16):
  - `grep -nE '#[0-9a-fA-F]{3,6}'` across the 3 in-scope files → ZERO matches. ✓
  - `grep -n "ne pourra plus consulter\|Oui, révoquer" RevokeAccessDialog.tsx` → 2 matches. The third copy string `Révoquer l'accès ?` contains a JSX-escaped apostrophe (`Révoquer l&apos;accès ?`) per the Dev Notes "use `&apos;` inside JSX text" rule (precedent: SharePanel.tsx:67-68,103). The AC16 grep expression as written does not match the escaped form — the implementation-level intent (copy isolation inside the dialog component) is satisfied.
  - `grep -n "Révoquer l'accès\|Oui, révoquer\|ne pourra plus consulter" [slug].tsx` → ZERO matches. ✓ (dialog copy is not in the route)
  - `grep -n "Accès révoqué" [slug].tsx` → 1 match. ✓
  - `grep -n "Accès révoqué" RevokeAccessDialog.tsx` → 0 matches. ✓
  - `grep -rn "@radix-ui/react-alert-dialog" apps/web/` → 0 matches. ✓ (no Radix dependency)
  - `grep -n "@base-ui/react/alert-dialog" alert-dialog.tsx` → 1 match. ✓
  - `grep -n "onRevokeClick" [slug].tsx` → 1 match (the prop pass-through). ✓
  - `grep -n "formatRevokedAt\|toLocaleDateString" [slug].tsx` → 3 matches total (definition + usage of `formatRevokedAt`, plus the inner `toLocaleDateString` call). ✓
  - `grep -n "MOCK_ANALYTICS.metrics\[0\]" [slug].tsx` → 2 matches (`key=` + `label=`). The Task 3 code snippet in this story's own spec uses both references; the AC16 "exactly 1 match" assertion is inconsistent with Task 3's canonical snippet. Implementation matches Task 3.
- No `pnpm-lock.yaml` or `package.json` changes (no new deps — Base UI AlertDialog tree-shakes from the already-installed `@base-ui/react@^1.4.0`).
- Manual browser walkthrough NOT executed — remote headless environment has no browser available. Structural verification (typecheck + lint + build + grep guardrails) is complete; the UX walkthrough sequence from AC16 is left to the human reviewer or the `/ultrareview` pass.

### Completion Notes List

- Task 1 — `components/ui/alert-dialog.tsx` (NEW): hand-written shadcn-style wrapper over `@base-ui/react/alert-dialog` per Pinned Decision #7 (no `pnpm dlx shadcn@latest add alert-dialog` — Base UI convention preserved). Exports `AlertDialog`, `AlertDialogTrigger`, `AlertDialogPortal`, `AlertDialogOverlay`, `AlertDialogContent`, `AlertDialogHeader`, `AlertDialogFooter`, `AlertDialogTitle`, `AlertDialogDescription`, `AlertDialogCancel` (Close slot + outline Button), `AlertDialogAction` (plain `<button>` + destructive Button CVA). Imports `buttonVariants` (not `Button`) per Pinned Decision #10. No XIcon, no close button on the popup (AC2).
- Task 2 — `components/confluent/RevokeAccessDialog.tsx` (NEW): pure controlled view over `{ open, entry, onOpenChange, onConfirm }`. Static dialog copy (`Révoquer l'accès ?`, `Annuler`, `Oui, révoquer`, description template) lives here per Pinned Decision #6. No hooks, no refs, no `cn` — delegates all styling to the primitive.
- Task 3 — `routes/dashboard/dossiers/[slug].tsx` (MODIFIED): added `formatRevokedAt` module-scope helper (uses `Intl.DateTimeFormat` via `toLocaleDateString('fr-FR', ...)` per Pinned Decision #3 — no `date-fns`/`dayjs` dep); added `entryToRevoke` `useState`; added `handleRevokeClick` + `handleConfirmRevoke` handlers with explicit `'revoked' as const` discriminated-union narrowing; replaced the `MOCK_ANALYTICS.metrics.map` with 3 explicit `<MetricCard>` elements (card 1 value computed from `accessEntries.filter(e => e.status !== 'revoked').length`, cards 2-3 static); wired `onRevokeClick={handleRevokeClick}` to `<AccessListRow>`; rendered `<RevokeAccessDialog>` as sibling of `<Tabs>` inside the `max-w-[720px]` container.
- Task 4 — `_bmad-output/implementation-artifacts/deferred-work.md`: removed the "Révoquer button has no `onClick`, silent no-op" bullet from the 3.3 code-review deferral block (Pinned Decision #9 — delete rather than strike-through). **✅ Resolved 3.3-era review finding: Révoquer button now wired to AlertDialog + optimistic state mutation.**
- Handler ordering in `handleConfirmRevoke`: (1) `setAccessEntries` → (2) `toast.success('Accès révoqué')` → (3) `setEntryToRevoke(null)`. React 19 batches the two state updates in the same render, so the row transition + dialog close land in the same frame.
- Mobile footer stacking uses `flex-col-reverse gap-2 sm:flex-row sm:justify-end` (Pinned Decision #8) — destructive Action on top of Cancel on mobile; destructive Action rightmost on desktop.
- Base UI AlertDialog's `onOpenChange` signature is `(open, eventDetails) => void`; my `RevokeAccessDialog.onOpenChange` is typed as `(open: boolean) => void` — the extra `eventDetails` parameter is simply ignored by the parent callback (standard JS variance), TypeScript accepts it because function parameter arity is contravariant.
- `AccessEntry` discriminated-union narrowing: the explicit object-literal reconstruction inside `handleConfirmRevoke.map` (rather than spread+overwrite) is required for TS to narrow into the `'revoked'` branch without a cast. The `'revoked' as const` pins the literal string to the discriminant value.
- Bundle size: +4.02 kB JS / +0.92 kB gzipped — under the AC10 +~8–12 KB gz estimate. No new dependencies. The Vite `>500 kB chunk` advisory from 3.5 persists (deferred to Epic 10 per `deferred-work.md`).
- No regression in existing tests — monorepo ships no test runner yet (per 3.5's deferred "No test coverage" item), so the definition-of-done "existing tests pass" check is vacuously satisfied. `pnpm turbo run test` is not wired.
- **Scope extension (2026-04-22) + code-review patches:** user requested that the `"Révoqué le 16 avr. 2026"` label inside `<AccessListRow>` expose the full revocation time + author on hover. Implemented as a Base UI **Tooltip** (not Popover — tooltip is semantically correct for hover-only informational text: `role="tooltip"`, focus+hover triggering, small positioned bubble). Trigger is a focusable `<span tabIndex={0}>` styled as plain muted text with `cursor-help` + focus-visible ring, keyboard-accessible (the misleading `role="button"` was dropped by code-review patch P1 — Base UI Tooltip opens on focus alone, no button role needed). Tooltip content (post-P6): `"à {time}"` (first line) + `"par {revokedBy}"` (second line, muted) — the date is on the trigger, the tooltip carries only the delta (no redundant "Révoqué le X" restatement). `revokedAtIso` is stored with explicit TZ offset for the fixture (`'2026-04-16T14:32:00+02:00'` — post-P2 patch; originally `'2026-04-16T14:32:00'` with no offset, which was parsed as local time and diverged from `new Date().toISOString()` UTC output) and UTC ISO for new revocations (`new Date().toISOString()`); both render back to the user's local clock via `toLocaleTimeString('fr-FR', …)`. The `revokedBy` field resolves from `useCurrentUser().name` at revoke time (hardcoded `"Sophie Moreau"` today; will bind to real auth in Epic 6). Fixture `lea@invest.com` was populated with `revokedBy: 'Marc Dubois'` (mock co-founder) to visually demonstrate the "revoked by someone else" case — new revocations by Sophie will show her own name. Bundle cost: +18.42 kB gzipped — amortized across future Tooltip callers (help icons, metric explanations, delete confirms). Extended `AccessEntry`'s `revoked` branch with two new required fields — all existing constructors (fixture + `handleConfirmRevoke`) were updated; TypeScript enforces exhaustiveness via the discriminated union. **Spec-override disclosure:** this extension required retroactive amendments to AC3 / AC7 / AC10 / AC15 / Anti-Patterns / Task 4 bundle ceiling + introduction of Pinned Decision #11 — see the 2026-04-22 Change Log entry for the full list. `revokingRef` lock was added to `handleConfirmRevoke` by code-review patch P3 to prevent double-toast on rapid double-click. `TooltipProvider` export was removed by P4 (dead code).

### File List

**New:**
- `apps/web/src/components/ui/alert-dialog.tsx`
- `apps/web/src/components/ui/tooltip.tsx` *(scope extension 2026-04-22 — see Change Log)*
- `apps/web/src/components/confluent/RevokeAccessDialog.tsx`

**Modified:**
- `apps/web/src/routes/dashboard/dossiers/[slug].tsx`
- `apps/web/src/components/confluent/AccessListRow.tsx` *(scope extension 2026-04-22)*
- `apps/web/src/data/mock-analytics.ts` *(scope extension 2026-04-22)*
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `_bmad-output/implementation-artifacts/deferred-work.md`
- `_bmad-output/implementation-artifacts/3-6-access-revocation-optimistic-mocked.md`

## Change Log

| Date | Change | By |
|---|---|---|
| 2026-04-22 | **Scope extension during review (user request).** Added a Base UI Tooltip that opens on hover/focus over the "Révoqué le …" label in `<AccessListRow>`, showing the full revocation date + time + author. Introduced: (1) `components/ui/tooltip.tsx` — shadcn-style Base UI wrapper exporting `Tooltip`, `TooltipTrigger`, `TooltipPortal`, `TooltipContent`; (2) extended `AccessEntry` `revoked` branch with `revokedAtIso: string` + `revokedBy: string` (required fields); (3) fixture `lea@invest.com` enriched with `revokedAtIso: '2026-04-16T14:32:00+02:00'` + `revokedBy: 'Marc Dubois'` (mock co-founder) to illustrate a revocation by someone other than the current user; (4) `handleConfirmRevoke` now sets `revokedAtIso` from `new Date().toISOString()` (UTC with `Z`) and `revokedBy` from `useCurrentUser().name`; (5) `<AccessListRow>` wraps the revoked label in a `<Tooltip>` with a focusable `<span tabIndex={0}>` trigger (hover + keyboard accessible, `cursor-help`). The Tooltip content format is two lines: `"à {time}"` + `"par {revokedBy}"` — date is on the trigger, time + author in the tooltip (no redundancy). Time is formatted via `toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })`. **Spec amendments this change required** — the original AC1-AC16 set mandated an `AlertDialog`-only surface and listed `AccessListRow.tsx` + `mock-analytics.ts` under "Do NOT touch" Anti-Patterns. Adopting this extension required: (a) new **Pinned Decision #11** documenting the scope-extension rationale + authorized file list; (b) **AC3** amended from `{ email, initials, lastSeen, sessionDuration, status: 'revoked', revokedAt }` to include `revokedAtIso` + `revokedBy`; (c) **AC7** amended to authorize the `useCurrentUser` + `revokingRef` + `formatRevokedAt` additions; (d) **AC10** copy-ownership extended to allow the tooltip's runtime-shaped French strings inside `AccessListRow.tsx`; (e) **AC15** amended from "`<AccessListRow>` internals unchanged" to "extended ONLY by the scope extension — revoked-branch Tooltip wrap"; (f) **Anti-Patterns** `Do NOT touch AccessListRow.tsx` / `Do NOT touch mock-analytics.ts` amended with narrowly-scoped lifts; (g) Task 4 bundle ceiling raised from +~8-12 KB gz to +~18-19 KB gz. **Bundle delta:** +53.53 kB JS / +18.42 kB gzipped vs pre-extension (AlertDialog-only) because Base UI Tooltip pulls its own anchor-positioning infra (distinct from Dialog's internals). Still within Vite's existing `>500 kB chunk` advisory — no new advisory triggered. The `tooltip.tsx` primitive will amortize across future stories (delete confirmations, metric explanations, help icons) so the per-feature cost is front-loaded here. **Touch-device limitation acknowledged:** Base UI Tooltip opens on hover/focus, not on tap — touch users cannot reach the tooltip content today; tracked for a future mobile-UX pass. | Amelia (claude-opus-4-7) on behalf of user |
| 2026-04-22 | **Code review patches applied (user-invoked `/bmad-code-review`).** Layered adversarial review raised 1 decision-needed, 6 patches, 5 deferrals, ~14 dismissed. Decision resolved in favor of keeping the scope extension and amending the spec (see Change Log entry above). Patches applied in a single commit per user memory "Code + review in a single commit": **P1** dropped the misleading `role="button"` from the Tooltip trigger ([AccessListRow.tsx:79]) — WAI-ARIA 1.2 prohibits `role="button"` on elements that do not implement keyboard activation; Base UI Tooltip opens on focus/hover so the `<span tabIndex={0}>` remains focus-reachable without the misleading role. **P2** fixed the timezone mismatch between the fixture's `revokedAtIso` (previously `'2026-04-16T14:32:00'`, parsed as local time) and runtime `now.toISOString()` output (UTC with `Z`) by giving the fixture an explicit `+02:00` CEST offset ([mock-analytics.ts:63]). **P3** added a `revokingRef` lock in `handleConfirmRevoke` ([slug].tsx) — the guard engages on first confirm, prevents a double-toast on rapid double-click of the destructive Action, and is reset on each new `handleRevokeClick` open. **P4** removed the dead `TooltipProvider` export from `tooltip.tsx` — Base UI Tooltip works standalone. **P5** amended **AC16** grep guardrails for two spec-internal inconsistencies already flagged by the Debug Log: the `MOCK_ANALYTICS.metrics[0]` grep now expects 2 matches (Task 3's canonical snippet uses both `key=` and `label=` forms), and the dialog-copy grep now includes the JSX-escaped `Révoquer l&apos;accès` alternation (the title uses `&apos;` inside JSX text per Dev Notes). **P6** trimmed the tooltip content to remove the redundant `"Révoqué le X"` prefix — the trigger text already announces the date; the tooltip content now only carries the delta (`à {time}` + `par {revokedBy}`), fixing the screen-reader double-announcement of the date. **Deferrals appended to `deferred-work.md`:** duplicate-email revoke-by-key collision (pre-existing from 3-3), ICU locale drift in `formatRevokedAt`, per-render `Intl.DateTimeFormat` instantiation in `AccessListRow`, hardcoded `revokedBy` via `useCurrentUser` mock (Epic 6 binds real auth), and the AC16 manual tri-viewport walkthrough (headless dev env). **Dismissed:** 14 findings that were intentional per Pinned Decisions #4 / #10, spec-approved defensive code, unreachable edge cases, or Base UI primitive responsibilities. | Claude-opus-4-7 (code review pass) |
