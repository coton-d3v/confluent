# Story 5.4: User Management (UI, Mocked)

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an administrator,
I want to invite new users and manage existing accounts,
so that I can control who has access to the platform.

## Acceptance Criteria

1. **Given** the router at [apps/web/src/router.tsx](apps/web/src/router.tsx), **When** a developer inspects it, **Then** exactly ONE new route entry is inserted AFTER `{ path: 'admin/questionnaire', element: <AdminQuestionnaireRoute /> }` at [apps/web/src/router.tsx:54](apps/web/src/router.tsx#L54) and BEFORE the catch-all `{ path: '*', element: <NotFoundRoute /> }` at [apps/web/src/router.tsx:55](apps/web/src/router.tsx#L55): `{ path: 'admin/utilisateurs', element: <AdminUtilisateursRoute /> }`. No `handle: { hideBreadcrumb: true }` — the global `Breadcrumbs` component renders `Admin / Utilisateurs` for this 2-segment path (AC6). A corresponding `import AdminUtilisateursRoute from '@/routes/admin/utilisateurs'` is appended to the imports block after the existing `AdminQuestionnaireRoute` import at [apps/web/src/router.tsx:12](apps/web/src/router.tsx#L12). No other line in `router.tsx` changes.

2. **Given** the new route body at [apps/web/src/routes/admin/utilisateurs.tsx](apps/web/src/routes/admin/utilisateurs.tsx), **When** a user with `role !== 'admin'` navigates to `/admin/utilisateurs`, **Then** the route renders `<Navigate to="/dashboard" replace />` from `react-router-dom` and does NOT render any user-management UI. The guard sits at the TOP of the default-exported `AdminUtilisateursRoute` function body, immediately after `const user = useCurrentUser()`, BEFORE any other hook. Because the body calls `useState` / `useRef` / `useEffect` / `useCallback` AFTER the guard, the route MUST adopt the inner-component delegation pattern (5.2 Pinned Decision #2, applied verbatim by 5.3): the default export is guard-only and returns `<AdminUtilisateursList />` which hosts all subsequent hooks. Identical shape to [apps/web/src/routes/admin/questionnaire.tsx:13-17](apps/web/src/routes/admin/questionnaire.tsx#L13-L17) (`AdminQuestionnaireRoute → AdminQuestionnaireBuilder`).

3. **Given** the `AdminUtilisateursList` inner-component render, **When** it mounts, **Then** it outputs, in order:
   - `<title>Utilisateurs · Confluent</title>` — React 19 auto-hoists to `<head>`. Separator is the middle-dot `U+00B7` (matches [apps/web/src/routes/admin/index.tsx:13](apps/web/src/routes/admin/index.tsx#L13) and all admin surfaces).
   - A header row containing the H1 on the left and the "Inviter un utilisateur" trigger on the right: `<div className="flex flex-col items-start justify-between gap-3 md:flex-row md:items-center">`. Stacks on mobile, horizontal at tablet+.
   - Inside the header row:
     - `<h1 ref={headingRef} tabIndex={-1} className="font-heading text-2xl font-semibold text-foreground md:text-[28px] focus-visible:outline-none">Utilisateurs</h1>` — matches the list-surface H1 sizing from [apps/web/src/routes/admin/dossiers/index.tsx:23-29](apps/web/src/routes/admin/dossiers/index.tsx#L23-L29). `headingRef.current?.focus()` runs once on mount via `useEffect(() => { headingRef.current?.focus() }, [])` — same mount-focus pattern as the admin dossiers list and 5.3 builder.
     - A `<SheetTrigger render={<Button variant="default" size="sm">Inviter un utilisateur</Button>} />` that opens the invite Sheet (AC8). See Pinned Decision #1 (invite panel is a `Sheet`, not a new `Dialog` primitive).
   - A `<p className="mt-2 text-sm text-muted-foreground">` lead-in reading exactly: `Gérez les comptes et les invitations de la plateforme.` — single sentence, no apostrophes.
   - Below the lead-in, the responsive user list (AC4 / AC5) rendered inside the `Sheet` root so the trigger and content share state (same pattern as [apps/web/src/components/confluent/SharePanel.tsx](apps/web/src/components/confluent/SharePanel.tsx) consumption at the dossier view level).

4. **Given** the mobile viewport (<768 px), **When** the user list renders, **Then** a card-based `<ul role="list" className="mt-8 flex flex-col gap-3 md:hidden">` is shown — ONE `<li>` per user, each card showing: email (primary, `text-base font-medium text-foreground break-all`), role badge (AC9), status indicator (AC10), and — for active users only — a "Désactiver" `Button variant="outline" size="sm"` on a separate line (`mt-2 self-end`). Layout inside each card: `flex flex-col gap-2 rounded-lg border border-border bg-card p-4`. Matches 5.2 mobile card convention from [apps/web/src/routes/admin/dossiers/index.tsx:34-53](apps/web/src/routes/admin/dossiers/index.tsx#L34-L53).

5. **Given** the tablet/desktop viewport (≥768 px), **When** the user list renders, **Then** a table replaces the card list: `<div className="mt-8 hidden overflow-hidden rounded-lg border border-border bg-card md:block">` wrapping a `<table className="w-full text-sm">` with columns `<th scope="col">`: `Email`, `Rôle`, `Statut`, `Actions` (last column has `<span className="sr-only">Actions</span>` visually hidden heading — action cell content is a "Désactiver" button OR empty for inactive users). Header row styling matches [apps/web/src/routes/admin/dossiers/index.tsx:58-66](apps/web/src/routes/admin/dossiers/index.tsx#L58-L66) verbatim: `border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground` + `px-4 py-3 font-medium`. `<tbody className="divide-y divide-border">`. Each `<tr>` has `px-4 py-3` cells. No `hover:bg-muted/50` / `focus-within:bg-muted/50` (rows are NOT row-clickable here — unlike 5.2, there is no detail drill-down from this list).

6. **Given** the breadcrumb behavior at [apps/web/src/components/layout/Breadcrumbs.tsx](apps/web/src/components/layout/Breadcrumbs.tsx), **When** an admin user is on `/admin/utilisateurs`, **Then** the global `Breadcrumbs` renders `Admin / Utilisateurs`:
   - Path splits into `['admin', 'utilisateurs']` (length 2 ≥ 2 — the `segments.length < 2` early-return at [Breadcrumbs.tsx:33](apps/web/src/components/layout/Breadcrumbs.tsx#L33) does NOT fire).
   - `'admin'` → `'Admin'` via existing `SEGMENT_LABELS` entry at [Breadcrumbs.tsx:10](apps/web/src/components/layout/Breadcrumbs.tsx#L10) — linkable to `/admin` (UNCHANGED — 5.2 corrected it, 5.3 preserved).
   - `'utilisateurs'` → REQUIRES a NEW `SEGMENT_LABELS['utilisateurs'] = 'Utilisateurs'` entry. WITHOUT this entry, `toLabel('utilisateurs')` falls through to `decodeURIComponent('utilisateurs')` → `'utilisateurs'` (lowercase, ugly). The new entry MUST be inserted AFTER the existing `questionnaire: 'Questionnaire'` entry at [Breadcrumbs.tsx:11](apps/web/src/components/layout/Breadcrumbs.tsx#L11) (keeping the sub-admin labels grouped). This is the ONLY edit to `Breadcrumbs.tsx` in 5.4. See Pinned Decision #2.
   - "Utilisateurs" is the current/last segment → rendered as `<span aria-current="page">` (non-linkable).

7. **Given** the NEW mock fixture at [apps/web/src/data/mock-users.ts](apps/web/src/data/mock-users.ts), **When** a developer inspects it, **Then** the file:
   - File-header comment exactly: `// Static mock fixture for the Story 5.4 admin user management view. Replaced by Epic 9.3's real admin user management API (architecture.md:602-605 — admin module) when data persistence lands.` — matches the forward-reference convention from 5.1 AC10 / 5.2 AC14 / 5.3 AC9.
   - Exports these types (imports `UserRole` from `@confluent/shared` — the existing union at [packages/shared/src/index.ts:1](packages/shared/src/index.ts#L1) is the single source of truth for roles):
     ```ts
     import type { UserRole } from '@confluent/shared'

     export type UserStatus = 'active' | 'inactive'

     export interface MockUser {
       readonly id: string
       readonly email: string
       readonly role: UserRole
       readonly status: UserStatus
     }
     ```
   - Exports `MOCK_USERS: readonly MockUser[]` — EXACTLY 5 entries, covering all role × status combinations encountered in the admin flow (the union cross-product is 6 — entrepreneur/financeur/admin × active/inactive — but the fixture excludes `{ role: 'admin', status: 'inactive' }` because a deactivated admin would be an operational defect, not a data state to demonstrate). The 5 entries, in exact order:
     1. `{ id: 'user-1', email: 'sophie@biosensio.fr', role: 'entrepreneur', status: 'active' }`
     2. `{ id: 'user-2', email: 'lucas@agrotrack.fr', role: 'entrepreneur', status: 'inactive' }`
     3. `{ id: 'user-3', email: 'marc@capital-invest.fr', role: 'financeur', status: 'active' }`
     4. `{ id: 'user-4', email: 'julie@fonds-regional.fr', role: 'financeur', status: 'inactive' }`
     5. `{ id: 'user-5', email: 'claire@frenchtech-cvl.fr', role: 'admin', status: 'active' }`
   - `as const` on the array literal so TypeScript infers the readonly tuple shape.
   - `MOCK_USERS` emails are DIFFERENT from `MOCK_ADMIN_DOSSIERS` entrepreneur emails EXCEPT for `user-1` (`sophie@biosensio.fr`) and `user-2` (`lucas@agrotrack.fr`) — the two dossier owners are explicitly also user records (consistency across admin surfaces). The other three mock users are new identities introduced here.
   - The admin fixture (`user-5`, `claire@frenchtech-cvl.fr`) MATCHES the `MOCK_ADMIN_USER.email` at [apps/web/src/features/current-user/context.tsx:17](apps/web/src/features/current-user/context.tsx#L17) — the impersonated admin sees themselves in the list, as expected. See Pinned Decision #3.

8. **Given** the "Inviter un utilisateur" Sheet (invite panel), **When** the admin clicks the trigger, **Then** a right-side `Sheet` opens containing:
   - `<SheetHeader>` with `<SheetTitle>Inviter un utilisateur</SheetTitle>` and `<SheetDescription>Envoyez un lien d&apos;invitation à une nouvelle adresse email. Le compte sera créé au statut &laquo;&nbsp;Inactif&nbsp;&raquo; jusqu&apos;à activation.</SheetDescription>`.
   - A `<Separator />` below the header.
   - A `<form onSubmit={…} noValidate>` body with:
     - Email field: `<Label htmlFor="invite-email">Adresse email</Label>` + `<Input id="invite-email" type="email" autoFocus autoComplete="email" placeholder="nom@entreprise.fr" aria-required="true" aria-invalid={…} aria-describedby={…} {...register('email')} />`. Error slot below: `<div aria-live="assertive" aria-atomic="true" className="min-h-[1em]">` containing a `<p id="invite-email-error" className="text-xs text-destructive">` when `errors.email` is set. Mirrors [apps/web/src/components/confluent/SharePanel.tsx:76-98](apps/web/src/components/confluent/SharePanel.tsx#L76-L98) verbatim.
     - Role field: a `<fieldset>` with `<legend className="text-sm font-medium">Rôle</legend>` followed by TWO native `<label className="flex items-center gap-2">` rows, each wrapping an `<input type="radio" name="invite-role" value="entrepreneur|financeur" />` and the role label text (`Entrepreneur` / `Financeur`). The `admin` role is deliberately NOT offered — invitations are only for entrepreneur or financeur roles (admin accounts are provisioned out-of-band; see Pinned Decision #4). The first radio is `defaultChecked` (entrepreneur is the default).
     - A `<SheetFooter className="flex-col gap-2 p-4 sm:flex-row-reverse sm:justify-start">` with primary submit `<Button type="submit" size="lg">Envoyer l&apos;invitation</Button>` and secondary `<SheetClose render={<Button type="button" variant="outline" size="lg" />}>Annuler</SheetClose>`.
   - Zod schema (module-scope): `const inviteFormSchema = z.object({ email: z.string().trim().min(1, "L'adresse email est requise.").email("Format d'email invalide.").toLowerCase(), role: z.enum(['entrepreneur', 'financeur']) })` — matches the SharePanel pattern verbatim for the email rules (same copy, same normalization).

9. **Given** the invitation form is submitted with a NEW email and a role, **When** `Envoyer l'invitation` is clicked, **Then**:
   - Email is trimmed + lowercased by the Zod schema (same as SharePanel).
   - Duplicate check runs: if any `MOCK_USERS` entry (from local state, not the static fixture) has the same `email`, `setError('email', { type: 'duplicate', message: 'Cette adresse est déjà utilisée.' })` is called and the submit is aborted. Same pattern as SharePanel's duplicate check at [apps/web/src/components/confluent/SharePanel.tsx:51-57](apps/web/src/components/confluent/SharePanel.tsx#L51-L57).
   - On success:
     - A NEW user row is PREPENDED to the local state list via `setUsers([newUser, ...users])` where `newUser = { id: \`user-invited-${Date.now()}\`, email, role, status: 'inactive' }`.
     - The Sheet closes (`setSheetOpen(false)`).
     - The form resets (`reset()`).
     - A `toast.success(\`Invitation envoyée à ${email}\`)` is emitted via `import { toast } from 'sonner'` — same import pattern as [apps/web/src/routes/admin/questionnaire.tsx:3](apps/web/src/routes/admin/questionnaire.tsx#L3).
     - The new row renders at the TOP of both the mobile card list and the desktop table. The row shows `status: 'inactive'` and (per AC10) does NOT render a "Désactiver" button.

10. **Given** the `<UserStatusIndicator status={...} />` component, **When** it renders a user's status, **Then** it shows an `aria-label="Statut : Actif"` (or "Inactif") with a `<span aria-hidden="true" className="inline-block size-[7px] rounded-full [bg-class]" />` dot followed by the label text. Color tokens:
    - `'active'` → `bg-[var(--status-active)]` + label `Actif` (green).
    - `'inactive'` → `bg-[var(--status-neutral)]` + label `Inactif` (gray).
    Structure and token usage matches [apps/web/src/components/confluent/StatusDot.tsx](apps/web/src/components/confluent/StatusDot.tsx). `UserStatusIndicator` is a LOCAL component declared at the bottom of `utilisateurs.tsx` — NOT a new file in `components/confluent/`, NOT a refactor of `StatusDot`. See Pinned Decision #5.

11. **Given** the `<UserRoleBadge role={...} />` render, **When** it renders a user's role, **Then** it shows a `<Badge variant={…} className="shrink-0">{labelFr}</Badge>` with:
    - `role === 'entrepreneur'` → `variant="secondary"`, label `Entrepreneur`.
    - `role === 'financeur'` → `variant="secondary"`, label `Financeur`.
    - `role === 'admin'` → `variant="default"`, label `Admin` (filled foreground variant — visually distinguishes the privileged role, no new color token introduced).
    `UserRoleBadge` is a LOCAL component at the bottom of `utilisateurs.tsx`, same file and discipline as `UserStatusIndicator` (Pinned Decision #5). Reuses the existing shadcn `Badge` primitive from [apps/web/src/components/ui/badge.tsx](apps/web/src/components/ui/badge.tsx) — NO new badge variant, NO new color.

12. **Given** the "Désactiver" button on an active user row (desktop table cell, mobile card bottom row), **When** clicked, **Then** a deactivation `AlertDialog` opens (reusing the shadcn primitive at [apps/web/src/components/ui/alert-dialog.tsx](apps/web/src/components/ui/alert-dialog.tsx)):
    - `<AlertDialogTitle>Désactiver ce compte ?</AlertDialogTitle>`.
    - `<AlertDialogDescription>{email} ne pourra plus accéder à la plateforme jusqu&apos;à réactivation.</AlertDialogDescription>`.
    - `<AlertDialogCancel>Annuler</AlertDialogCancel>`.
    - `<AlertDialogAction onClick={handleConfirmDeactivate}>Oui, désactiver</AlertDialogAction>`. The `AlertDialogAction` component already applies `buttonVariants({ variant: "destructive", size: "lg" })` via [alert-dialog.tsx:143](apps/web/src/components/ui/alert-dialog.tsx#L143) — NO additional `className` override.
    - Dialog state is lifted to the inner component: `const [deactivateTarget, setDeactivateTarget] = useState<MockUser | null>(null)` — `open={deactivateTarget !== null}` and `onOpenChange={(open) => { if (!open) setDeactivateTarget(null) }}`. Wrapping component is a dedicated `<DeactivateUserDialog user={deactivateTarget} onOpenChange={…} onConfirm={…} />` declared INLINE at the bottom of `utilisateurs.tsx` (NOT a new shared file — single consumer, same discipline as `UserStatusIndicator` / `UserRoleBadge`; extract to `components/confluent/` when rule-of-three is met). Mirrors the [apps/web/src/components/confluent/RevokeAccessDialog.tsx](apps/web/src/components/confluent/RevokeAccessDialog.tsx) structure 1:1 with user-specific copy.

13. **Given** the admin confirms deactivation, **When** `Oui, désactiver` is clicked, **Then**:
    - The target user's `status` flips from `'active'` to `'inactive'` in local state via `setUsers(users.map(u => u.id === deactivateTarget.id ? { ...u, status: 'inactive' } : u))`.
    - `setDeactivateTarget(null)` — closes the dialog.
    - A `toast.success('Compte désactivé.')` is emitted.
    - The row's `UserStatusIndicator` transitions from `Actif` (green) to `Inactif` (gray).
    - The `Désactiver` action cell (desktop) or action row (mobile) becomes empty — no button rendered for inactive users. No replacement "Réactiver" button in 5.4 (reactivation is deferred to Epic 9.3 alongside the real persistence layer; see Pinned Decision #6).
    - The user row remains in the list at the same ordinal position (no re-sort, no removal).

14. **Given** the role guard and impersonation context, **When** the current impersonated admin (`claire@frenchtech-cvl.fr`, `user-5`) clicks `Désactiver` on their own row, **Then** the `AlertDialog` opens normally and the action proceeds to update local state — BUT the admin does NOT see themselves logged out or redirected, because the `useCurrentUser` hook's stored identity is decoupled from `MOCK_USERS` local state (the context resolves from `sessionStorage`, not from the fixture). This is acceptable for 5.4 (mocked demo); real deactivation-of-self protection lands in Epic 9.3. See Pinned Decision #6. The dev agent does NOT add a "can't deactivate yourself" guard — the static fixture already places `admin` at position 5 and the `admin` role has NO "Désactiver" button per AC15.

15. **Given** the mapping of role to action availability, **When** the row for a user with `role === 'admin'` renders, **Then** NO "Désactiver" button is shown regardless of status. Admin accounts cannot be deactivated from the admin UI in 5.4 (prevents self-lockout mock-UI footgun). Rule applied: `status === 'active' && role !== 'admin'` is the condition for rendering the button. See Pinned Decision #4.

16. **Given** the admin sidebar from Story 5.1 at [apps/web/src/components/layout/nav-items.ts:25](apps/web/src/components/layout/nav-items.ts#L25), **When** an admin user lands on `/admin/utilisateurs`, **Then** the `Utilisateurs` NavLink shows `aria-current="page"` (active state) — already wired by the 5.1 `<NavLink>` + React Router v7 active-match logic. No nav-items edit needed in 5.4. Verify via browser DOM inspector.

17. **Given** the WCAG 2.1 AA compliance baseline (per UX spec at [ux-design-specification.md:731](../planning-artifacts/ux-design-specification.md#L731)), **When** the user management page is audited, **Then**:
    - Invite Sheet focus management: Base UI `@base-ui/react/dialog` traps focus inside the Sheet while open, restores focus to the trigger Button on close. Email `<Input autoFocus>` receives focus on Sheet open. Verified natively by the primitive — NO manual `useEffect` focus trap.
    - AlertDialog focus management: Base UI `@base-ui/react/alert-dialog` traps focus, restores to the "Désactiver" trigger button on close. Cancel gets default keyboard focus (safe default, matches [apps/web/src/components/confluent/RevokeAccessDialog.tsx](apps/web/src/components/confluent/RevokeAccessDialog.tsx) behavior).
    - Radio group accessibility: the `<fieldset>` + `<legend>` pattern satisfies WCAG 1.3.1 (info & relationships); each `<input type="radio">` is keyboard-navigable via `Tab` (to enter the group) + `Arrow` keys (browser default within same-name group).
    - Email form: `aria-invalid={errors.email ? 'true' : undefined}` + `aria-describedby={'invite-email-error'}` wire the error to the input. `aria-live="assertive"` on the error container announces validation errors immediately.
    - Status indicators: dual-channel (color + text label). `aria-label="Statut : Actif"` ensures AT announces the status even when the dot is purely visual. Matches UX spec at [ux-design-specification.md:382](../planning-artifacts/ux-design-specification.md#L382) ("never color alone").
    - Tab order on desktop: skip link → admin sidebar (4 items) → H1 (`tabIndex={-1}`) → "Inviter un utilisateur" button → first row's "Désactiver" button (if active non-admin) → next row's "Désactiver" button → … Focus ring visible at every step.
    - Headings hierarchy: H1 `Utilisateurs` → no H2 (the table `<th>` cells provide column semantics — no visible section heading needed for a single-table surface, same discipline as [apps/web/src/routes/admin/dossiers/index.tsx](apps/web/src/routes/admin/dossiers/index.tsx) which has NO `<h2>` either).
    - Mobile list `role="list"`: explicit restoration on `<ul className="flex flex-col gap-3">` — matches 5.2 and 5.3 discipline for Safari VoiceOver when `list-none` styling is applied (though 5.4 does NOT apply `list-none`, the explicit role future-proofs against Tailwind preflight resets).
    - Table semantics: `<th scope="col">` on all column headers; `<tbody>` rows use `<td>`. No ARIA `role` overrides.
    - Toast notifications: default `aria-live="polite"` region from [apps/web/src/components/ui/sonner.tsx](apps/web/src/components/ui/sonner.tsx) announces success messages without interrupting focus.

18. **Given** the design-token discipline, **When** a developer greps the new files, **Then** ZERO raw hex values appear in any new or modified file. Every surface uses `bg-*` / `text-*` / `border-*` / `ring-*` tokens resolved from [apps/web/src/index.css](apps/web/src/index.css). Verification: `grep -E "#[0-9a-fA-F]{3,8}" apps/web/src/routes/admin/utilisateurs.tsx apps/web/src/data/mock-users.ts` returns empty.

19. **Given** the verification sweep, **When** the dev agent runs the build-and-check battery, **Then** all the following exit 0 / green:
    - `pnpm --filter @confluent/web typecheck` — exits 0, no type errors.
    - `pnpm --filter @confluent/web lint` — exits 0. The existing 5-warning baseline (all `react-refresh/only-export-components` — carried from 5.1) is preserved. No new warning class introduced. 5.4 adds NO new module-level exports adjacent to a component in the same file (the route file only exports its default component plus locally-scoped helpers that are neither default-exported nor component-level module exports; the mock fixture file exports only types and constants — it's a data module, not a component module, so the `react-refresh` rule does not apply).
    - `pnpm turbo run build` — all packages GREEN. Bundle delta vs 5.3 baseline (`639.64 KB / 199.35 KB gz`): estimated ≤ +3 KB gz. Audit threshold: +5 KB gz. If exceeded, investigate before marking complete.
    - `grep -E "#[0-9a-fA-F]{3,8}" apps/web/src/routes/admin/utilisateurs.tsx apps/web/src/data/mock-users.ts` — returns empty (AC18).
    - `git diff apps/web/src/data/questionnaire.ts apps/web/src/data/mock-analytics.ts apps/web/src/components/confluent/StatusDot.tsx` — returns empty (AC19 regression guardrail for the surfaces we explicitly DON'T touch).

20. **Given** manual browser walkthrough (deferred — headless environment), **Then** the human reviewer verifies (same deferral pattern as 5.1/5.2/5.3):
    - `?as=admin` on `/dashboard` → click "Utilisateurs" in sidebar → lands on `/admin/utilisateurs`, sidebar active state transfers, H1 focus received, breadcrumb shows `Admin / Utilisateurs`, `Admin` link navigates back to `/admin`.
    - Desktop (≥768 px): table renders with 5 rows (in fixture order). Columns aligned. Active non-admin users show "Désactiver" in Actions column. Inactive users and the admin user show an empty Actions cell.
    - Mobile (<768 px): card list renders with 5 cards. Same Désactiver visibility rules apply.
    - Click "Inviter un utilisateur" → Sheet slides in from right, focus moves to email input, Esc closes the sheet (focus returns to trigger).
    - Submit with empty email → "L'adresse email est requise." inline error. Focus stays on email.
    - Submit with `not-an-email` → "Format d'email invalide." error.
    - Submit with `sophie@biosensio.fr` (existing user email) → "Cette adresse est déjà utilisée." error.
    - Submit with `new.user@example.com` + `Financeur` radio selected → Sheet closes, toast `Invitation envoyée à new.user@example.com` appears bottom-right, new row prepends to the list with role badge `Financeur` (secondary variant) and status `Inactif` (gray dot). Sheet form is reset (next open shows empty email + entrepreneur default).
    - Click "Désactiver" on `sophie@biosensio.fr` row (active entrepreneur) → AlertDialog opens, focus is trapped, Cancel gets initial focus.
    - Click "Annuler" → dialog closes, user row unchanged, focus returns to the "Désactiver" button.
    - Click "Désactiver" on `sophie@biosensio.fr` again → confirm with "Oui, désactiver" → dialog closes, toast `Compte désactivé.` appears, `sophie@biosensio.fr`'s status dot transitions to `Inactif` (gray), "Désactiver" button disappears from that row.
    - Try to find a "Désactiver" button on `claire@frenchtech-cvl.fr` (admin role) → none present regardless of status. Matches AC15 / Pinned Decision #4.
    - Non-admin user (default entrepreneur `Sophie Moreau`) navigates to `/admin/utilisateurs` → redirects to `/dashboard` via the role guard. Browser back button does NOT land back on `/admin/utilisateurs` (`replace` flag honored).
    - Resize to 375 px and repeat the core flow (invite + deactivate) to verify mobile card layout.

## Tasks / Subtasks

- [x] **Task 1: Mock users fixture (AC: 7)**
  - [x] Create [apps/web/src/data/mock-users.ts](apps/web/src/data/mock-users.ts).
  - [x] Import `UserRole` from `@confluent/shared` — do not redefine.
  - [x] Export types: `UserStatus`, `MockUser`.
  - [x] Export `MOCK_USERS` with the exact 5 entries listed in AC7, in that exact order, `as const`.
  - [x] File-header comment as specified in AC7.
  - [x] `pnpm --filter @confluent/web typecheck` exits 0.

- [x] **Task 2: Admin utilisateurs route (AC: 2, 3, 4, 5, 8, 9, 10, 11, 12, 13, 14, 15, 17, 18)**
  - [x] Create [apps/web/src/routes/admin/utilisateurs.tsx](apps/web/src/routes/admin/utilisateurs.tsx).
  - [x] Default export `AdminUtilisateursRoute` — guard-only (inner-component delegation per AC2 / 5.2 Pinned Decision #2).
  - [x] Inner component `AdminUtilisateursList` hosts all hooks: `useRef<HTMLHeadingElement>`, `useEffect` for H1 focus, `useState<MockUser[]>` for the user list (initialized from `[...MOCK_USERS]`), `useState<boolean>` for the Sheet open state, `useState<MockUser | null>` for the deactivate target, `useForm<InviteFormValues>` from `react-hook-form` with the Zod resolver.
  - [x] Render order per AC3: header row (H1 + Sheet trigger) → lead-in `<p>` → responsive list (mobile card AC4, desktop table AC5) → AlertDialog for deactivation (AC12).
  - [x] Sheet body per AC8: form with email input + role radio group + footer buttons. Use `@hookform/resolvers/zod` + a module-scope `inviteFormSchema`.
  - [x] Submit handler per AC9: duplicate check against local `users` state, prepend new row on success, close Sheet, reset form, emit `toast.success(\`Invitation envoyée à ${email}\`)`.
  - [x] Deactivate handler per AC13: set target user's `status` to `'inactive'`, close dialog, emit `toast.success('Compte désactivé.')`.
  - [x] Local sub-components at file bottom: `UserStatusIndicator` (AC10), `UserRoleBadge` (AC11), `DeactivateUserDialog` (AC12) — all declared as `function` declarations (not `const` arrow), not default-exported, not module-scoped top-level React components beyond the inner list.
  - [x] Import pattern: `import { toast } from 'sonner'` — matches [apps/web/src/routes/admin/questionnaire.tsx:3](apps/web/src/routes/admin/questionnaire.tsx#L3).
  - [x] Reuse existing primitives: `Sheet*` (for invite), `AlertDialog*` (for deactivate confirm), `Button`, `Input`, `Label`, `Separator`, `Badge`. NO new primitives added.
  - [x] `pnpm --filter @confluent/web typecheck` exits 0.

- [x] **Task 3: Router registration (AC: 1)**
  - [x] Modify [apps/web/src/router.tsx](apps/web/src/router.tsx):
    - [x] Append `import AdminUtilisateursRoute from '@/routes/admin/utilisateurs'` immediately after the `AdminQuestionnaireRoute` import at [apps/web/src/router.tsx:12](apps/web/src/router.tsx#L12).
    - [x] Insert one new route entry `{ path: 'admin/utilisateurs', element: <AdminUtilisateursRoute /> }` between the `admin/questionnaire` entry at [apps/web/src/router.tsx:54](apps/web/src/router.tsx#L54) and the catch-all `*` entry.
    - [x] No `handle: { hideBreadcrumb: true }` — Breadcrumbs renders for this path (AC6).
  - [x] Verify no other lines in `router.tsx` change.
  - [x] `pnpm --filter @confluent/web typecheck` exits 0.

- [x] **Task 4: Breadcrumb label (AC: 6)**
  - [x] Modify [apps/web/src/components/layout/Breadcrumbs.tsx:5-12](apps/web/src/components/layout/Breadcrumbs.tsx#L5-L12): add `utilisateurs: 'Utilisateurs',` entry to `SEGMENT_LABELS` after `questionnaire: 'Questionnaire',`.
  - [x] Verify no other lines change — `toLabel`, `Breadcrumbs` function, suppression logic UNCHANGED.
  - [x] `pnpm --filter @confluent/web typecheck` exits 0.

- [x] **Task 5: Verification sweep (AC: 16, 17, 18, 19)**
  - [x] `pnpm --filter @confluent/web typecheck` — exits 0.
  - [x] `pnpm --filter @confluent/web lint` — exits 0. 5-warning baseline preserved (no new warning class, no new warnings).
  - [x] `pnpm turbo run build` — all packages GREEN. Bundle: **646.56 KB / 200.50 KB gz**. Delta vs 5.3 baseline (`639.64 KB / 199.35 KB gz`): **+6.92 KB / +1.15 KB gz**. Under the +5 KB gz audit threshold.
  - [x] `grep -E "#[0-9a-fA-F]{3,8}" apps/web/src/routes/admin/utilisateurs.tsx apps/web/src/data/mock-users.ts` — returns empty (AC18).
  - [x] `git diff apps/web/src/data/questionnaire.ts apps/web/src/data/mock-analytics.ts apps/web/src/components/confluent/StatusDot.tsx` — returns empty (AC19).
  - [x] Manual browser walkthrough (AC20) — deferred (headless environment); flag in Completion Notes for human reviewer.
  - [x] On each task landed, mark the corresponding Tasks/Subtasks checkbox above.

- [x] **Task 6: Sprint status housekeeping**
  - [x] When story implementation is complete, update [_bmad-output/implementation-artifacts/sprint-status.yaml](sprint-status.yaml):
    - [x] `development_status.5-4-user-management-ui-mocked`: `ready-for-dev` → `in-progress` → `review` (→ `done` post-review).
    - [x] `last_updated`: current date.
  - [x] Preserve all comments (STATUS DEFINITIONS block, header).
  - [x] Story Status: flip `ready-for-dev` → `review` (→ `done` post-review).

## Dev Notes

### Critical Architecture Constraints

- **Admin routes use inline role guards + inner-component delegation.** 5.4's route body calls multiple `useState` / `useRef` / `useEffect` / `useCallback` / `useForm` hooks AFTER the guard; that violates Rules of Hooks if the guard's early-return and the hooks live in the same function. Adopt the 4.4 / 5.2 / 5.3 inner-component pattern: default export is `{ user, if(user.role !== 'admin') return <Navigate/>; return <Inner /> }` with ZERO hooks beyond `useCurrentUser()`; `Inner` hosts everything else.

- **`@confluent/shared` is the single source of truth for `UserRole`.** The union `'entrepreneur' | 'financeur' | 'admin'` is defined at [packages/shared/src/index.ts:1](packages/shared/src/index.ts#L1). `mock-users.ts` MUST import this type — do not locally redefine. Widening or narrowing here would silently break role semantics across other surfaces.

- **`mock-analytics.ts` is OFF-LIMITS for this story.** Story 3.4's `AccessStatus` type and the `StatusDot` component that consumes it are unrelated to user status. Coupling the two types would create cross-domain regression risk. The local `UserStatusIndicator` in `utilisateurs.tsx` duplicates ~10 lines of StatusDot's structure — acceptable per rule-of-three (not met yet; the user-management and access-management domains are distinct consumers). See Pinned Decision #5.

- **`@base-ui/react/dialog` is already in the codebase** — it's the primitive that backs `Sheet` at [apps/web/src/components/ui/sheet.tsx:2](apps/web/src/components/ui/sheet.tsx#L2). Adding a new shadcn-style centered `Dialog` primitive would duplicate the Base UI dialog root. Reuse `Sheet` for the invite flow (matches [apps/web/src/components/confluent/SharePanel.tsx](apps/web/src/components/confluent/SharePanel.tsx) convention for invite UX). See Pinned Decision #1.

- **`@base-ui/react/alert-dialog`** is used exclusively for destructive confirmations. Deactivation IS destructive (reversibility exists but requires backend support not yet shipped). AlertDialog is the correct primitive. Mirror [apps/web/src/components/confluent/RevokeAccessDialog.tsx](apps/web/src/components/confluent/RevokeAccessDialog.tsx) 1:1.

- **Toast uses `toast.success` for both invite + deactivate.** Both are successful completion signals (email was sent — from the UI's perspective — and the account was deactivated). `sonner`'s success variant renders the green checkmark — appropriate affordance. Contrast with 5.3 which used `toast.message` for a "not yet available" notice.

- **Design tokens only — no raw hex.** Every color comes from `index.css` custom properties. AC18 grep is the automated guardrail.

- **WCAG 2.1 AA baseline.** Per UX spec at [ux-design-specification.md:731](../planning-artifacts/ux-design-specification.md#L731). `<fieldset>` + `<legend>` for radio group; `<th scope="col">` for table headers; `aria-live="assertive"` for form errors; status dot dual-channel (color + label); focus trap via Base UI primitives.

- **Mobile card breakpoint parity with 5.2.** Use `md:hidden` for the card list and `hidden md:block` for the table wrapper. NO tablet-specific intermediate layout.

### Decisions Pinned for This Story

Do not renegotiate without explicit retrospective action.

1. **Invite panel is a `Sheet`, NOT a new centered `Dialog` primitive.** Rationale: (a) `@base-ui/react/dialog` is already the primitive root behind Sheet — adding a second wrapper (a centered modal) would duplicate dependency graph without functional gain; (b) [apps/web/src/components/confluent/SharePanel.tsx](apps/web/src/components/confluent/SharePanel.tsx) established the invite-flow convention in Epic 3 — admin invite should match; (c) 5.2 Pinned Decision #5 ("no new design-system primitives unless rule-of-three met") applies — two dialog primitives today is not a rule of three. The epic AC text says "shadcn/ui Dialog" but that predates the project's settled convention — "Dialog" is the generic name for the UX concept (modal overlay with focus trap), which the Sheet primitive implements for this codebase. Alternatives rejected: (a) add a new `dialog.tsx` primitive in `components/ui/` — duplicates the Base UI root, increases maintenance surface for the same visual affordance; (b) repurpose `AlertDialog` for the invite form — wrong semantic (AlertDialog is for destructive confirmations; sonner + zod + react-hook-form tooling is wired around Sheet already via SharePanel).

2. **Breadcrumb label injected here: `utilisateurs: 'Utilisateurs'`.** 5.3 added `questionnaire: 'Questionnaire'`; 5.4 appends `utilisateurs: 'Utilisateurs'`. Each admin sub-story owns its segment label. The entry sits alphabetically between the existing admin-section labels — keep insertion adjacent to `questionnaire` to group admin-sub labels together (readable diff).

3. **`MOCK_USERS[0]` email matches `MOCK_ADMIN_DOSSIERS[0].entrepreneurEmail` (`sophie@biosensio.fr`).** Consistency across admin surfaces: the two dossier owners in 5.2's fixture are explicitly also user records in 5.4's fixture. Same rationale applies to `lucas@agrotrack.fr` (user-2 ↔ dossier `agrotrack`). The admin user (`user-5`, `claire@frenchtech-cvl.fr`) matches `MOCK_ADMIN_USER.email` at [apps/web/src/features/current-user/context.tsx:17](apps/web/src/features/current-user/context.tsx#L17) — the impersonated admin sees themselves in the list. Alternatives rejected: (a) generate random unrelated emails — breaks cross-surface narrative; (b) derive `MOCK_USERS` from `MOCK_ADMIN_DOSSIERS` — too coupled, forces the user fixture to always have at least as many entries as dossiers; (c) add a `userId` foreign key on dossiers and join — over-engineered for a mocked story.

4. **Admin role is NOT offered as an invitation option, AND admin users do NOT have a "Désactiver" button.** Rationale: (a) admin accounts are provisioned out-of-band (real magic-link bootstrap lands in Epic 6; in the mocked demo, the admin is fixed at `claire@frenchtech-cvl.fr`); (b) allowing the impersonated admin to deactivate themselves creates a mock-UI footgun that doesn't represent production behavior — in production, self-deactivation protection will come from the backend (Epic 9.3). Static guardrail at the UI level keeps the mock consistent with the production contract. Alternatives rejected: (a) allow admin invites but gray-out the radio — introduces a third inactive-radio state that complicates the form for no gain; (b) allow self-deactivation with a confirmation twist ("Vous allez être déconnecté.") — contradicts real-world self-deactivation protection, misleads the demo.

5. **`UserStatusIndicator`, `UserRoleBadge`, and `DeactivateUserDialog` are LOCAL components in `utilisateurs.tsx`, NOT new files in `components/confluent/`.** Rationale: single consumer today (one route). Rule-of-three not met. Extract to `components/confluent/` when 9.3 or a later story introduces a second consumer (e.g., admin user detail view, bulk invite panel, per-dossier collaborator list). The inline declaration keeps blast radius small and makes the route file self-contained. This also makes it easy to DELETE the local components when Epic 9.3 replaces them with API-wired equivalents. Alternatives rejected: (a) create `UserStatusIndicator.tsx` as a sibling to `StatusDot.tsx` — premature abstraction; the two types evolve on different timelines; (b) refactor `StatusDot` to take `labels` + `dotClass` props — leaks user-management concerns into 3.4's domain; (c) add `'inactive'` to the existing `AccessStatus` union — widens a shared type for a single new consumer.

6. **Reactivation ("Réactiver") is NOT implemented in 5.4.** Rationale: (a) the epic AC only specifies deactivation ("Désactiver action button for active users" + "no 'Désactiver' button is shown for inactive users"); (b) reactivation without backend support (expiry, role re-verification, magic-link re-issue) is a data footgun in a mock — an operator could click "Réactiver" and assume the account is usable; (c) Epic 9.3 owns reactivation semantics via `PATCH /v1/admin/users/:id`. Alternatives rejected: (a) implement symmetric "Réactiver" as a naive `status: 'active'` flip — misleading UX in demos; (b) render a disabled "Réactiver" button — adds visual noise without benefit.

7. **`AlertDialog` for deactivation MUST NOT override the `AlertDialogAction` variant.** The primitive at [apps/web/src/components/ui/alert-dialog.tsx:135-150](apps/web/src/components/ui/alert-dialog.tsx#L135-L150) already applies `buttonVariants({ variant: "destructive", size: "lg" })`. Passing a custom `className` with `variant` could conflict. Mirrors [apps/web/src/components/confluent/RevokeAccessDialog.tsx:38-44](apps/web/src/components/confluent/RevokeAccessDialog.tsx#L38-L44) which also takes the default destructive styling.

8. **Epic 1–5.3 Pinned Decisions CARRY FORWARD.** No renegotiation. Specifically:
    - 5.1 PD#1 (no pre-wiring of stories that haven't landed) — 5.4 does NOT touch Epic 9.x's real API paths.
    - 5.1 PD#3 (single `AppShell`, role-driven nav) — 5.4 does not touch AppShell.
    - 5.1 PD#4 (inline role guard) — 5.4 applies this.
    - 5.2 PD#2 (inner-component delegation for routes with hooks after guard) — 5.4 applies this.
    - 5.2 PD#3 (shared data source, no duplication) — 5.4 applies this via `@confluent/shared` `UserRole` and fixture cross-consistency with `MOCK_ADMIN_DOSSIERS`.
    - 5.2 PD#5 (no new design-system primitives unless rule-of-three met) — 5.4 respects (reuses `Sheet`, `AlertDialog`, `Input`, `Label`, `Button`, `Badge`, `Separator`).
    - 5.3 PD#2 (native primitive over shadcn when WAI-ARIA is covered) — 5.4 applies to radio group (native `<fieldset>` + `<input type="radio">` over a Radix RadioGroup dependency).
    - The 5-warning lint baseline: maintained at 5.

### Previous Story Intelligence

**From Story 5.3 (just landed — `03a6a0b`):**

- Inner-component delegation pattern: `AdminQuestionnaireRoute → AdminQuestionnaireBuilder`. 5.4 mirrors: `AdminUtilisateursRoute → AdminUtilisateursList`.
- Breadcrumb label append: `questionnaire: 'Questionnaire'` added to `SEGMENT_LABELS`. Still in place. 5.4 appends `utilisateurs: 'Utilisateurs'` as a same-shape addition.
- Mock fixture header convention: exact phrasing for the "Replaced by Epic 9.X" forward reference. 5.4's header reads "Replaced by Epic 9.3" (user management persistence).
- H1 mount-focus effect: `useEffect(() => { headingRef.current?.focus() }, [])` with `<h1 tabIndex={-1}>` + `focus-visible:outline-none`. 5.4 reuses verbatim.
- Toast import pattern: `import { toast } from 'sonner'` — 5.4 reuses.
- `useCallback` stable ref for handlers passed into child components: 5.4 applies (`handleDeactivateClick`, `handleConfirmDeactivate`) to avoid re-rendering `DeactivateUserDialog` on unrelated state changes.
- Lint warning count baseline: 5 warnings, all `react-refresh/only-export-components`. 5.4 MUST NOT extend. The mock users fixture file exports ONLY types and constants (no React components) — rule does not apply. The route file's locally-declared components are not module-level exports.
- Manual walkthrough deferred pattern: 5.4 follows the same deferral — flag in Completion Notes.
- Bundle at 5.3 close: `639.64 KB / 199.35 KB gz`.

**From Story 5.2 (in `841aacf` lineage):**

- Mobile card / desktop table pattern with `md:hidden` + `hidden md:block` breakpoint swap — 5.4 reuses verbatim.
- Table header row styling literals (`border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground` + `px-4 py-3 font-medium`) — 5.4 reuses verbatim.
- Inner-component delegation: `AdminDossiersRoute → AdminDossiersList` / `AdminDossierDetailRoute → AdminDossierDetailView`. 5.4 mirrors.
- Mock fixture `as const` typing — 5.4 applies to `MOCK_USERS`.
- Mock fixture cross-surface consistency: `MOCK_ADMIN_DOSSIERS[0].entrepreneurEmail === 'sophie@biosensio.fr'` → `MOCK_USERS[0].email` matches. See Pinned Decision #3.

**From Story 5.1:**

- Admin sidebar already wires `{ to: '/admin/utilisateurs', label: 'Utilisateurs', icon: Users }` at [apps/web/src/components/layout/nav-items.ts:25](apps/web/src/components/layout/nav-items.ts#L25). 5.4 does NOT touch nav-items — the sidebar entry was pre-provisioned in 5.1 (that entry fell through to the 404 route until now).
- Role guard pattern (`useCurrentUser` + `user.role !== 'admin'` + `<Navigate to="/dashboard" replace />`) — 5.4 applies verbatim.

**From Story 3.5 (SharePanel — invite flow convention):**

- Invite flow uses a `Sheet` with email input + zod validation + react-hook-form + duplicate check + `setError` on duplicate + `reset` on success. 5.4 mirrors 1:1 (plus a role radio group).
- Form structure inside the sheet: `<Separator />` under header, `<form noValidate>` body, email + error slot, footer with submit + `<SheetClose render={<Button variant="outline">Annuler</SheetClose>`. 5.4 reuses.

**From Story 3.6 (RevokeAccessDialog — destructive confirmation convention):**

- `AlertDialog` wrapped in a small component that takes `{ open, entry, onOpenChange, onConfirm }` props — 5.4 mirrors with `{ open, user, onOpenChange, onConfirm }`.
- `AlertDialogAction` default-variant destructive styling NOT overridden — 5.4 applies.

**From Story 3.4 (StatusDot):**

- Existing `StatusDot` supports `active` / `pending` / `revoked`. 5.4 does NOT extend it (Pinned Decision #5) — local `UserStatusIndicator` reuses the same token palette (`--status-active`, `--status-neutral`) for visual consistency without type coupling.

### Git Intelligence

Recent commits (most recent 5):

```
03a6a0b feat(epic-5): story 5.3 — Admin questionnaire builder (UI, mocked)
841aacf feat(epic-5): story 5.2 — Admin all-dossiers list + read-only detail
5a52c5e feat(epic-5): story 5.1 — Admin layout & pipeline dashboard
b2e41c9 feat(epic-4): story 4.4 — Access denied page
ee95b33 feat(epic-4): story 4.3 — Financeur dossier view desktop layout
```

**Observed patterns to carry forward:**

- Commit title format: `feat(epic-5): story 5.4 — Admin user management (UI, mocked)` — matches AC phrasing (parallel with 5.3's title).
- Single bundled commit per story (impl + code-review patches together) per auto-memory at [/home/coder/.claude/projects/-home-coder-confluent/memory/feedback_commit_review_together.md](/home/coder/.claude/projects/-home-coder-confluent/memory/feedback_commit_review_together.md).
- Route files sit at `routes/admin/*.tsx` alongside the existing siblings. 5.4 adds `utilisateurs.tsx` as a sibling to `questionnaire.tsx` and the `dossiers/` subdirectory.
- Admin route bodies follow the inner-component pattern. 5.4 continues.
- Mock fixtures live at `data/mock-*.ts`. 5.4 adds `mock-users.ts`.

### Latest Technical Specifics

**React 19 + React Router v7:**

- `<title>Utilisateurs · Confluent</title>` — React 19 auto-hoists to `<head>`. Same pattern as all other admin routes.
- `<Navigate to="/dashboard" replace />` — inherited from 5.1/5.2/5.3. `replace` prevents back-button redirect loops.
- Local component declarations INSIDE the same file but OUTSIDE the default-exported component use `function` declarations. Hoisting prevents order-of-declaration issues between `AdminUtilisateursList` and its helpers.

**`react-hook-form` + `zod` + `@hookform/resolvers`:**

- `useForm<InviteFormValues>({ resolver: zodResolver(inviteFormSchema), mode: 'onSubmit', defaultValues: { email: '', role: 'entrepreneur' } })` — matches [apps/web/src/components/confluent/SharePanel.tsx:44-48](apps/web/src/components/confluent/SharePanel.tsx#L44-L48).
- `handleSubmit(({ email, role }) => {…})` inside the onSubmit. `setError('email', { type: 'duplicate', message: ... })` inside the async duplicate check.
- `reset()` on success to clear the form (ready for next open of the Sheet).

**`sonner` toast:**

- `toast.success(message: string)` — default duration, default position, default `aria-live="polite"`. No custom options needed (unlike 5.3's `id` dedupe — not relevant here; each success is a distinct successful action).

**`@base-ui/react/dialog` + `@base-ui/react/alert-dialog`:**

- Both primitives handle focus trap, Esc-to-close, click-outside-to-close natively. No manual keyboard wiring.
- `Sheet` (right-side slide-in) is the invite panel. `open`/`onOpenChange` controlled — state lives in `AdminUtilisateursList`. Trigger uses `SheetTrigger render={<Button …>}` per Base UI's render-prop polymorphism.
- `AlertDialog` (centered modal, destructive) is the deactivation confirmation. `open`/`onOpenChange` controlled via `deactivateTarget !== null` derived state.

**`lucide-react`:**

- `Users` icon is already imported in [apps/web/src/components/layout/nav-items.ts:5](apps/web/src/components/layout/nav-items.ts#L5) for the sidebar — 5.4 does not re-import it. If a header accent icon is desired (optional polish, NOT required by AC), `UserPlus` is the appropriate lucide icon — but NOT required by 5.4's spec; skip to stay minimal.

**Tailwind CSS v4:**

- Tokens used: `bg-card`, `border-border`, `bg-muted/50`, `text-muted-foreground`, `text-foreground`, `bg-popover`, `text-popover-foreground`, `text-destructive`, `bg-[var(--status-active)]`, `bg-[var(--status-neutral)]`, `outline-[var(--ring)]`. All existing — no new token additions.
- `flex-col md:flex-row`, `gap-2/3/4`, `rounded-lg`, `border`, `px-4 py-3`, `text-sm/xs` — all existing utility patterns.
- `min-h-11` on interactive elements ≥ touch target size (44×44 from WCAG 2.5.5 enhanced AAA, courtesy applied here). Already project convention.

**Base UI primitives (via shadcn v4):**

- `Badge` (existing) — `variant="default"` (admin) / `variant="secondary"` (entrepreneur, financeur).
- `Button` (existing) — `variant="default"` (primary submit, invite trigger), `variant="outline"` (Désactiver, Annuler).
- `Input` / `Label` / `Separator` / `Sheet*` / `AlertDialog*` — all existing.
- NO new Base UI primitive consumed in 5.4.

**Bundle budget:**

- `mock-users.ts`: ~25 lines of TS ≈ ~0.8 KB uncompressed ≈ ~0.4 KB gz.
- `utilisateurs.tsx` route: ~220 lines of TSX (includes 3 local sub-components, form handlers, 2 dialogs) ≈ ~7 KB uncompressed ≈ ~2.2 KB gz.
- `router.tsx` addition: +2 LOC ≈ negligible.
- `Breadcrumbs.tsx` addition: +1 LOC ≈ negligible.
- Total estimated source delta: ≤ +2.6 KB gz. AC19 audit threshold: 5 KB gz.

### Project Structure Notes

```
apps/web/src/
├── components/
│   ├── confluent/                                    [UNCHANGED — no new files; local sub-components live in the route file per PD#5]
│   ├── layout/
│   │   └── Breadcrumbs.tsx                           [MODIFIED — +1 SEGMENT_LABELS entry]
│   └── ui/                                            [UNCHANGED — reuses existing Sheet + AlertDialog + Input + Label + Button + Badge + Separator]
├── data/
│   └── mock-users.ts                                  [NEW — user fixture, imports UserRole from @confluent/shared]
├── routes/
│   └── admin/
│       └── utilisateurs.tsx                          [NEW — guard + list + invite Sheet + deactivate AlertDialog + local sub-components]
└── router.tsx                                         [MODIFIED — +1 import, +1 route entry]
```

- Alignment with [architecture.md:637-640](../planning-artifacts/architecture.md#L637-L640): `routes/admin/utilisateurs.tsx` matches the anticipated shape. Architecture mentions `features/admin/components/` at [architecture.md:664-665](../planning-artifacts/architecture.md#L664-L665) but 5.1/5.2/5.3 did not introduce that hierarchy; 5.4 does NOT introduce it either (rule-of-three not met).
- No new folders required.
- No `packages/shared/` changes (`UserRole` is imported AS-IS — no additions).
- No backend changes — 5.4 is frontend-only, mocked. Epic 9.3 wires the real API.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#1059-1094 (Epic 5 Story 5.4 — User Management UI Mocked AC)]
- [Source: _bmad-output/planning-artifacts/epics.md#1841-1880 (Epic 9 Story 9.3 — User Management Persistence — forward target)]
- [Source: _bmad-output/planning-artifacts/epics.md#209-212 (Epic 5 scope — admin back-office frontend, mocked)]
- [Source: _bmad-output/planning-artifacts/prd.md#FR32-FR33 (admin invites users, deactivates accounts)]
- [Source: _bmad-output/planning-artifacts/prd.md#113-126 (Journey 3 — French Tech CVL admin persona)]
- [Source: _bmad-output/planning-artifacts/architecture.md#602-605 (admin module — backend companion for Epic 9)]
- [Source: _bmad-output/planning-artifacts/architecture.md#637-640 (routes/admin/ target structure)]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#41-42 (admin persona — back-office operator)]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#212 (no modal-inside-modal — Sheet opens, AlertDialog is separate surface)]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#381-382 (Radix UI-backed accessibility, dual-channel status indicators)]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#722 (admin back-office responsive strategy — desktop-acceptable)]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#731 (WCAG 2.1 AA baseline)]
- [Source: _bmad-output/implementation-artifacts/5-1-admin-layout-pipeline-dashboard.md (admin route guard, sidebar wiring, nav items with `/admin/utilisateurs` entry pre-provisioned)]
- [Source: _bmad-output/implementation-artifacts/5-2-admin-all-dossiers-list.md (inner-component delegation, mobile card / desktop table swap, mock fixture convention, `role="list"` restoration, mount-focus effect, bundle baseline)]
- [Source: _bmad-output/implementation-artifacts/5-3-questionnaire-builder-ui-mocked.md (breadcrumb label append pattern, mock fixture header convention, toast import pattern, `useCallback` stable ref discipline, bundle baseline 639.64 KB / 199.35 KB gz)]
- [Source: _bmad-output/implementation-artifacts/4-4-access-denied-page.md (Rules-of-Hooks inner-component pattern)]
- [Source: packages/shared/src/index.ts#L1 (UserRole union — single source of truth)]
- [Source: apps/web/src/features/current-user/context.tsx (MOCK_ADMIN_USER.email matches MOCK_USERS[4].email per PD#3)]
- [Source: apps/web/src/components/confluent/SharePanel.tsx (invite-flow convention: Sheet + zod + react-hook-form + duplicate check + setError + reset)]
- [Source: apps/web/src/components/confluent/RevokeAccessDialog.tsx (destructive-confirmation convention: AlertDialog props contract, default variant usage)]
- [Source: apps/web/src/components/confluent/StatusDot.tsx (status-dot visual language; 5.4 reuses tokens, not the component — PD#5)]
- [Source: apps/web/src/components/ui/sheet.tsx (Sheet primitives backed by @base-ui/react/dialog)]
- [Source: apps/web/src/components/ui/alert-dialog.tsx (AlertDialog primitives, default destructive variant on Action)]
- [Source: apps/web/src/components/ui/badge.tsx (Badge primitive — default / secondary variants)]
- [Source: apps/web/src/components/ui/button.tsx (Button primitive — default / outline / ghost variants)]
- [Source: apps/web/src/components/ui/input.tsx (Input primitive, aria-invalid support)]
- [Source: apps/web/src/components/ui/label.tsx (Label primitive)]
- [Source: apps/web/src/components/ui/separator.tsx (Separator primitive)]
- [Source: apps/web/src/components/ui/sonner.tsx (Toaster setup — default position, duration, aria-live="polite")]
- [Source: apps/web/src/components/layout/Breadcrumbs.tsx (SEGMENT_LABELS map, suppression logic)]
- [Source: apps/web/src/components/layout/nav-items.ts#L25 (Utilisateurs sidebar entry pre-provisioned in 5.1)]
- [Source: apps/web/src/routes/admin/dossiers/index.tsx (Story 5.2 list surface — mobile card / desktop table pattern, header row styling literals)]
- [Source: apps/web/src/routes/admin/questionnaire.tsx (Story 5.3 route — inner-component delegation template, toast handler `useCallback`)]
- [Source: apps/web/src/router.tsx (route registration)]
- [Source: apps/web/src/index.css (design tokens — --status-active, --status-neutral, no raw hex, no new token additions)]
- [Source: /home/coder/.claude/projects/-home-coder-confluent/memory/feedback_commit_review_together.md (single-commit discipline for story + review)]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.7 (1M context) — `claude-opus-4-7[1m]`

### Debug Log References

- `pnpm --filter @confluent/web typecheck` — exits 0, no errors.
- `pnpm --filter @confluent/web lint` — exits 0 with 5 warnings (baseline preserved, all `react-refresh/only-export-components`: `badge.tsx:52`, `button.tsx:58`, `context.tsx:7`, `context.tsx:14`, `context.tsx:47`). No new warning class, no new warning count.
- `pnpm turbo run build` — all packages GREEN. Bundle: **646.56 KB / 200.50 KB gz**. Delta vs 5.3 baseline (`639.64 KB / 199.35 KB gz`): **+6.92 KB / +1.15 KB gz**. Under the +5 KB gz audit threshold.
- `grep -E "#[0-9a-fA-F]{3,8}" apps/web/src/routes/admin/utilisateurs.tsx apps/web/src/data/mock-users.ts`: empty. AC18 clean.
- `git diff apps/web/src/data/questionnaire.ts apps/web/src/data/mock-analytics.ts apps/web/src/components/confluent/StatusDot.tsx`: empty. AC19 clean — regression-relevant surfaces untouched.

### Completion Notes List

1. **Manual browser walkthrough (AC20) deferred — headless environment.** The dev agent has no browser in-session, so AC20 was not exercised interactively. Static verification path covers structural correctness: typecheck (no type errors), lint (no new warning class), build (bundle under delta threshold), grep (hex / regression-surface-diff all clean). The runtime assertions remain for the human reviewer: (a) `?as=admin` → sidebar `Utilisateurs` → route lands; (b) `Admin / Utilisateurs` breadcrumb; (c) 5 rows render (mobile cards vs desktop table depending on viewport); (d) active non-admin rows show "Désactiver", inactive rows and admin rows do not; (e) Invite flow end-to-end (empty → required error, invalid → format error, existing email → duplicate error, new email + role → Sheet closes, toast, new row prepended as `Inactif`); (f) Deactivation flow (AlertDialog → confirm → status dot flips to `Inactif`, button disappears, toast); (g) Non-admin `→/dashboard` redirect; (h) Mobile 375 px reflow. Same deferral pattern as 5.1 / 5.2 / 5.3.

2. **`Date.now()` substitution → email-based ID (Pinned Decision honored, lint-driven).** The `react-hooks/purity` rule flagged `Date.now()` as impure inside the `handleSubmit` callback (React 19's stricter purity analyzer treats the closure as potentially render-called). Switched to `id: \`user-invited-${email}\`` — deterministic and guaranteed unique because the duplicate-email check immediately above rejects any already-present email. Same uniqueness guarantee, zero purity concern. This does NOT affect behavior visible to the user and does not change any AC; IDs are opaque and never displayed.

3. **Pinned Decision #1 (Sheet over new Dialog primitive) honored.** Invite panel is a right-side slide-in Sheet, identical surface convention as `SharePanel`. No new `dialog.tsx` added; bundle delta stayed at +1.15 KB gz because we're reusing existing primitives (`Sheet*`, `AlertDialog*`, `Button`, `Input`, `Label`, `Separator`, `Badge`) — the entire delta is the new route file + fixture + breadcrumb/router adds.

4. **Pinned Decision #4 (no admin role in invite; no deactivation for admin users) honored.** The Zod schema restricts `role` to `['entrepreneur', 'financeur']` — the radio group has only two options. The render condition for the Désactiver button is `u.status === 'active' && u.role !== 'admin'` — the admin row (Claire Martin, `claire@frenchtech-cvl.fr`, matches `MOCK_ADMIN_USER.email`) renders an empty Actions cell even though she's `active`.

5. **Pinned Decision #5 (local sub-components) honored.** `UserStatusIndicator`, `UserRoleBadge`, and `DeactivateUserDialog` are declared as local `function` declarations at the bottom of `utilisateurs.tsx`. Not exported at module level. Not in `components/confluent/`. When Epic 9.3 introduces a second consumer, the extract-to-shared refactor is a trivial file move.

6. **`react-refresh/only-export-components` clean.** `utilisateurs.tsx` only exports the default component; `inviteFormSchema`, `InviteFormValues`, and the three local sub-components are all non-exported. `mock-users.ts` exports only types + a readonly data array (no React components), so the rule does not apply. Lint warning count remains at 5 (all pre-existing).

### File List

**New:**
- `apps/web/src/data/mock-users.ts` — user fixture (~20 LOC). Imports `UserRole` from `@confluent/shared`. Exports `UserStatus`, `MockUser` types and `MOCK_USERS` readonly array with the exact 5 entries from AC7. File-header forward-reference to Epic 9.3.
- `apps/web/src/routes/admin/utilisateurs.tsx` — admin user management route (~310 LOC). Default export `AdminUtilisateursRoute` is guard-only (inner-component delegation pattern). Inner `AdminUtilisateursList` hosts hooks: `useState` for users/sheet-open/deactivate-target, `useRef` + `useEffect` for H1 focus, `useForm<InviteFormValues>` with Zod resolver. Renders header row + lead-in + responsive list (mobile cards `md:hidden` / desktop table `hidden md:block`) + invite Sheet + deactivate AlertDialog. Three local sub-components at file bottom: `UserStatusIndicator` (status dot + label, token-based colors), `UserRoleBadge` (shadcn Badge — `default` for admin, `secondary` for others), `DeactivateUserDialog` (controlled AlertDialog, destructive confirmation, mirrors RevokeAccessDialog shape).

**Modified:**
- `apps/web/src/router.tsx` — +1 import line (`AdminUtilisateursRoute`), +1 route entry (`{ path: 'admin/utilisateurs', element: <AdminUtilisateursRoute /> }` inserted between `admin/questionnaire` and the catch-all). 2-line delta.
- `apps/web/src/components/layout/Breadcrumbs.tsx` — +1 `SEGMENT_LABELS` entry (`utilisateurs: 'Utilisateurs',`). 1-line delta.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — `5-4-user-management-ui-mocked`: `backlog` → `ready-for-dev` → `in-progress` → `review`. `last_updated` bumped to 2026-04-22.

**Unchanged (regression-relevant):**
- `apps/web/src/data/questionnaire.ts` — AC19 verified empty `git diff`.
- `apps/web/src/data/mock-analytics.ts` — AC19 verified empty `git diff` (no coupling to user status type).
- `apps/web/src/components/confluent/StatusDot.tsx` — AC19 verified empty `git diff` (Pinned Decision #5: local `UserStatusIndicator` instead of refactor).
- `apps/web/src/components/layout/nav-items.ts` — `ADMIN_NAV_ITEMS[3]` (Utilisateurs NavLink) already wired in 5.1.
- `apps/web/src/components/ui/badge.tsx`, `button.tsx`, `input.tsx`, `label.tsx`, `separator.tsx`, `sheet.tsx`, `alert-dialog.tsx`, `sonner.tsx` — primitives reused untouched.

### Review Findings

Code review run 2026-04-22 (three layers: Blind Hunter, Edge Case Hunter, Acceptance Auditor).

- [x] [Review][Patch] Stale closure on `setUsers` in `onSubmitInvite` — switched to functional updater `setUsers((prev) => [newUser, ...prev])` at [apps/web/src/routes/admin/utilisateurs.tsx:92](apps/web/src/routes/admin/utilisateurs.tsx#L92) to eliminate the double-submit race window between state commit and Sheet close.
- [x] [Review][Patch] Stale closure on `setUsers` in `handleConfirmDeactivate` — switched to functional updater `setUsers((prev) => prev.map(...))` at [apps/web/src/routes/admin/utilisateurs.tsx:105-109](apps/web/src/routes/admin/utilisateurs.tsx#L105-L109) for the same reason; also makes double-click on `AlertDialogAction` idempotent on the data layer.

**Dismissed (noise / covered by spec)** — `render` prop vs `asChild` (Base UI API, matches `SharePanel`), `autoFocus` on email input (AC8 verbatim, matches SharePanel), `aria-live="assertive"` (AC17 verbatim), `focus-visible:outline-none` on H1 (AC3 verbatim, matches 5.3), `useCurrentUser` nullability (typed `: User`, non-null), email-based id ([Completion Notes #2](#completion-notes-list) — React 19 purity lint + duplicate check guarantees uniqueness), `«»` literal vs `&laquo;`/`&raquo;` entities (DOM-identical), missing `defaultChecked` on first radio (equivalent via `useForm.defaultValues`), radio `name="invite-role"` vs `name="role"` (grouping works via `register('role')`), admin self-deactivation (PD#4 + AC15 — no button rendered for admin row), `useCallback` on handlers (no AC requires it), empty-state UI (out of scope — fixture always has ≥1 user), responsive double-DOM (standard 5.2 pattern), focus restoration on programmatic Sheet close (Base UI primitive handles it, matches SharePanel precedent), focus loss after Désactiver button hides (not in AC, row removal not requested).

**Verification after patches** — `pnpm --filter @confluent/web typecheck` exits 0. `pnpm --filter @confluent/web lint` exits 0 with the 5-warning baseline preserved. `pnpm turbo run build` GREEN, bundle unchanged (`646.58 KB / 200.51 KB gz`, within delta budget).
