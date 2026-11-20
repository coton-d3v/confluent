# Story 3.5: Share Panel (D5) with Sheet Component

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an entrepreneur,
I want a slide-in panel to add a new recipient to my dossier,
so that I can share access without leaving the current page.

## Acceptance Criteria

1. **Given** the user is on `/dashboard/dossiers/view/:slug` (e.g. `/dashboard/dossiers/view/biosensio`), **When** they click the `Partager` button in the dossier header at [apps/web/src/routes/dashboard/dossiers/[slug].tsx:144-150](apps/web/src/routes/dashboard/dossiers/[slug].tsx#L144-L150), **Then** the shadcn `<Sheet>` opens from the **right** with **width 300 px** (not the primitive's default `w-3/4 sm:max-w-sm`) and a **150 ms ease-out** transition (override of the primitive's `duration-200` baked at [apps/web/src/components/ui/sheet.tsx:54](apps/web/src/components/ui/sheet.tsx#L54)). The dossier page stays rendered underneath — this is D5 (slide-in panel), NOT a modal overlay. See Pinned Decision #1 for the `className` overrides on `<SheetContent>`.

2. **Given** the `<Sheet>` is open, **When** a developer inspects the popup DOM, **Then** the children render in this exact top-to-bottom order inside `<SheetContent>`:
   1. `<SheetHeader>` containing:
      - `<SheetTitle>` — copy: `"Partager le dossier"` (the primitive already applies `font-heading text-base font-medium text-foreground` = 16 px / 500 weight — see [apps/web/src/components/ui/sheet.tsx:106](apps/web/src/components/ui/sheet.tsx#L106); UX spec §Typography H3 at [ux-design-specification.md:353](../planning-artifacts/ux-design-specification.md#L353) targets 16 px / 600 — close enough, do NOT locally override weight).
      - `<SheetDescription>` — copy: `"Entrez l'adresse email du destinataire pour lui envoyer une invitation d'accès."` (rendered as 14 px / `text-muted-foreground` by the primitive at [apps/web/src/components/ui/sheet.tsx:121](apps/web/src/components/ui/sheet.tsx#L121)).
   2. A `<Separator />` from [apps/web/src/components/ui/separator.tsx](apps/web/src/components/ui/separator.tsx).
   3. A form body (padded `px-4 py-3`) containing:
      - `<Label htmlFor="share-email">` — copy: `"Adresse email du destinataire"` (verbatim from Epic AC; do NOT substitute the UX spec's `"Email du destinataire"`).
      - `<Input id="share-email" type="email" placeholder="marc@fonds.fr" autoComplete="email" autoFocus>` — uses [apps/web/src/components/ui/input.tsx](apps/web/src/components/ui/input.tsx). The `autoFocus` attribute is REQUIRED (AC8). `placeholder` is decoration only; the visible `<Label>` is the accessible name per UX spec §Form Label rule at [ux-design-specification.md:669](../planning-artifacts/ux-design-specification.md#L669).
      - An `aria-live="assertive"` inline-error region (see AC3) — identical pattern to [apps/web/src/routes/dashboard/dossiers/nouveau/index.tsx:57-67](apps/web/src/routes/dashboard/dossiers/nouveau/index.tsx#L57-L67). Reserve the space even when empty to avoid layout shift.
   4. `<SheetFooter>` containing TWO buttons in **this order, top-to-bottom on mobile, side-by-side on `sm:` and up**:
      - Primary `<Button type="submit" size="lg">Envoyer l'invitation</Button>` — default solid primary.
      - Outline Cancel button wired via Base UI's `SheetClose` + `render`-prop slot-merging pattern from [apps/web/src/components/ui/sheet.tsx:63-75](apps/web/src/components/ui/sheet.tsx#L63-L75): `<SheetClose render={<Button type="button" variant="outline" size="lg" />}>Annuler</SheetClose>`. The `render` prop receives a SELF-CLOSING `<Button />` (no children inside `render`); the `Annuler` text is passed as `<SheetClose>`'s children and Base UI slots it into the rendered Button. Do NOT use `<SheetClose asChild><Button>Annuler</Button></SheetClose>` — Base UI uses `render`, not `asChild`.
   5. A second `<Separator />`.
   6. A mini-list titled `<p className="text-xs uppercase tracking-wide text-muted-foreground">Destinataires existants</p>` (the copy is **new to 3.5**; short form reads as a 11 px-small-caps-style label per UX spec §MetricCard label at [ux-design-specification.md:352](../planning-artifacts/ux-design-specification.md#L352), reused here). Below the title, render EXACTLY the current access list (`accessEntries` from local state in AC6) as **`<StatusDot status={entry.status} />` + `<span className="truncate text-sm text-foreground">{entry.email}</span>` on ONE line per recipient** — NOT full `<AccessListRow>` instances. See Pinned Decision #2 (the full AccessListRow anatomy — 32 px avatar, 22 px duration, Révoquer button — is too wide for a 300 px panel and visually noisy; the simpler one-liner matches the Epic AC string `"StatusDot + email on one line"`). The mini-list renders 0 – N entries; at 0 entries it renders `<p className="text-xs text-muted-foreground">Aucun destinataire pour le moment.</p>` (reuse the 3.3 empty-analytics copy verbatim — do NOT rephrase).

3. **Given** the email form, **When** the user submits with the field empty or whitespace-only, **Then** a **Zod** schema (`z.string().min(1, "L'adresse email est requise.").email("Format d'email invalide.")`) registered via `@hookform/resolvers/zod` rejects the submission, and the inline error region below the `<Input>` renders `<p id="share-email-error" className="text-xs text-destructive">L'adresse email est requise.</p>` with `aria-invalid="true"` and `aria-describedby="share-email-error"` set on the `<Input>`. The `<Sheet>` does NOT close. The primary button does NOT show a loading state — submission is synchronous, mocked. Error-message copy is EXACTLY `"L'adresse email est requise."` (from Epic AC) for empty, EXACTLY `"Format d'email invalide."` for a present-but-malformed address (added to cover Zod's `.email()` path — the Epic AC only enumerates the empty-string case but a valid-email check is mandated by `type="email"` + the Zod schema). See Pinned Decision #3 for validation timing (on submit only in 3.5; on-blur is deferred to a post-MVP polish pass).

4. **Given** a valid email is entered and the user clicks `Envoyer l'invitation` (or presses `Enter` inside the input), **When** the submit handler fires, **Then** in this exact order:
   1. The `<Sheet>` closes (set the open state to `false`).
   2. A Sonner `toast.success('Invitation envoyée à ${email}')` fires — imported as `import { toast } from 'sonner'` (the `<Toaster>` component at [apps/web/src/components/ui/sonner.tsx](apps/web/src/components/ui/sonner.tsx) is the mount point; `toast()` is called from anywhere). The toast lives 3 s, renders **bottom-right** (Sonner default — verified against UX spec §Toast at [ux-design-specification.md:655](../planning-artifacts/ux-design-specification.md#L655)), with the `CircleCheckIcon` from the Toaster's `icons.success` config at [apps/web/src/components/ui/sonner.tsx:11](apps/web/src/components/ui/sonner.tsx#L11).
   3. A new `AccessEntry` with `status: 'pending'` is **prepended** (unshift-equivalent) to the access list in local state — the data shape is EXACTLY:
      ```ts
      {
        email,                                    // the submitted address, lowercased via .toLowerCase() inside the Zod transform
        initials: deriveInitials(email),          // helper, see AC7
        status: 'pending',
        lastSeen: "Invitation envoyée à l'instant",
        sessionDuration: '—',
      }
      ```
      The new entry renders at the **top** of the Accès & analytics tab's `<AccessListRow>` list on the same page (the list is no longer sourced from the frozen `MOCK_ANALYTICS.accessEntries` import — it is the local `useState<AccessEntry[]>` set up in AC6). It ALSO renders at the top of the Sheet's mini-list if the Sheet is reopened. Toast + list mutation are synchronous — no debounce, no animation delay.
   4. The email input's value is reset (react-hook-form's `reset()` after `handleSubmit` resolves). The inline error region is cleared. On next open, the field starts empty again.

5. **Given** the `<Sheet>` is open, **When** the user: clicks the `Annuler` button, OR clicks the backdrop (`<SheetOverlay>`), OR presses `Escape`, OR clicks the top-right close button (the `<SheetPrimitive.Close>` + `XIcon` inside `<SheetContent>` per [apps/web/src/components/ui/sheet.tsx:60-75](apps/web/src/components/ui/sheet.tsx#L60-L75)) — any of these dismissal paths, **Then** the Sheet closes, NO toast fires, NO access entry is added to local state, and the form's pending value is reset (next open starts empty). Escape dismissal and overlay-click dismissal are wired by Base UI's Dialog primitive (`dismissible` defaults to `true` — do NOT pass `dismissible={false}`). Verify by inspection: the `<Sheet open={open} onOpenChange={setOpen}>` binding lets Base UI flip `open` to `false` on any of the dismissal paths.

6. **Given** [apps/web/src/routes/dashboard/dossiers/[slug].tsx](apps/web/src/routes/dashboard/dossiers/[slug].tsx) after the 3.5 swap, **When** a developer inspects the component body, **Then**:
   - The existing `import { MOCK_ANALYTICS } from '@/data/mock-analytics'` line stays at the top.
   - A new `const [accessEntries, setAccessEntries] = useState<AccessEntry[]>(() => [...MOCK_ANALYTICS.accessEntries])` replaces the direct render of `MOCK_ANALYTICS.accessEntries`. Add the type import: `import type { AccessEntry } from '@/data/mock-analytics'` to the same import line (`import { MOCK_ANALYTICS, type AccessEntry } from '@/data/mock-analytics'`) — single-line, alphabetically placed per 3.4 convention.
   - The `.map(...)` at the current line [apps/web/src/routes/dashboard/dossiers/[slug].tsx:215](apps/web/src/routes/dashboard/dossiers/[slug].tsx#L215) switches from `MOCK_ANALYTICS.accessEntries.map(...)` to `accessEntries.map(...)`. NO other change inside that `.map` body — still `<AccessListRow key={entry.email} entry={entry} />`.
   - The empty-state guard at [apps/web/src/routes/dashboard/dossiers/[slug].tsx:209](apps/web/src/routes/dashboard/dossiers/[slug].tsx#L209) switches to `accessEntries.length === 0` — same behaviour, different source.
   - The `<Button>Partager</Button>` at [apps/web/src/routes/dashboard/dossiers/[slug].tsx:144-150](apps/web/src/routes/dashboard/dossiers/[slug].tsx#L144-L150) is wrapped in a `<Sheet open={shareOpen} onOpenChange={setShareOpen}>…</Sheet>` via a `<SheetTrigger render={<Button …>Partager</Button>} />` call (Base UI render-prop pattern — see Pinned Decision #4). The existing `className="h-11 self-start px-4 sm:self-auto"` on the Partager button is preserved verbatim.
   - A new `<SharePanel>` component (see Pinned Decision #5) is rendered inside the `<Sheet>` as `<SharePanel existingEntries={accessEntries} onSubmitInvitation={handleInvitationSubmit} />`. The panel owns the form + Zod + the mini-list rendering; the route owns the open state + the access-list state + the submit handler.
   - The route defines `handleInvitationSubmit(email: string)` that: (a) calls `setAccessEntries(prev => [{ email, initials: deriveInitials(email), status: 'pending', lastSeen: "Invitation envoyée à l'instant", sessionDuration: '—' }, ...prev])`; (b) calls `toast.success(`Invitation envoyée à ${email}`)`; (c) calls `setShareOpen(false)`. The Sheet-close side-effect lives in the handler, NOT inside `<SharePanel>` — keeps `<SharePanel>` reusable without coupling to open-state.

7. **Given** the `deriveInitials(email: string): string` helper, **When** a developer inspects it, **Then** it lives at the top of [apps/web/src/routes/dashboard/dossiers/[slug].tsx](apps/web/src/routes/dashboard/dossiers/[slug].tsx) (module-scope function alongside `loadDossier`, `deslugifyForDisplay`, `resolveDisplayName`), takes the email local-part (before `@`), strips non-alpha characters (`[^a-zA-Z]+`), uppercases the first two code points (or pads with `·` if fewer), and returns a 2-character string. Examples:
   - `marc@fonds.fr` → `"MA"` (local-part `marc` → first two alpha → `MA`)
   - `j.beuzelin@coton.dev` → `"JB"` (alpha-stripped `jbeuzelin` → first two → `JB`)
   - `x@y.com` → `"X·"` (single-alpha local-part → `"X"` padded to 2 chars with the project's middle-dot pad — matches the 3.3 fixture convention of exactly 2 characters). Keep the helper pure, synchronous, no side effects. Export it as a named export at module-bottom if `<SharePanel>` grows to need it independently — 3.5's call site is exclusively inside `handleInvitationSubmit`, so the function can stay module-local in this story.

8. **Given** the `<Sheet>` opens, **When** the auto-focus runs, **Then** the `<Input id="share-email">` receives focus — implemented via the **`autoFocus` HTML attribute on the input** (NOT via `useRef` + `useEffect`, NOT via Base UI's `initialFocus` prop; see Pinned Decision #6 for the rationale). A keyboard user can type immediately; a screen-reader announces `"Adresse email du destinataire, required, invalid, email"` via the `<Label>` + `aria-required="true"` + `aria-invalid` + `type="email"`. The focus ring is the shadcn `focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50` recipe inherited from [apps/web/src/components/ui/input.tsx:12](apps/web/src/components/ui/input.tsx#L12) — no hover/focus styling added at the call site.

9. **Given** the `<Toaster>` mount requirement, **When** a developer inspects [apps/web/src/main.tsx](apps/web/src/main.tsx), **Then** the file imports `<Toaster>` from `@/components/ui/sonner` and renders it as a sibling of `<RouterProvider>`, INSIDE the `<CurrentUserProvider>`, BEFORE `<RouterProvider>` to match source order (toasts portal-mount regardless of DOM order, but React convention places global UI providers first):
   ```tsx
   <StrictMode>
     <CurrentUserProvider>
       <Toaster />
       <RouterProvider router={router} />
     </CurrentUserProvider>
   </StrictMode>
   ```
   `<Toaster />` takes no props (the Sonner wrapper at [apps/web/src/components/ui/sonner.tsx](apps/web/src/components/ui/sonner.tsx) already configures icons, CSS variables, theme, and `toastOptions`). This is a **one-time mount** — Story 3.6 reuses the same `<Toaster>` for revocation toasts; Epic 4+ reuses it for all success confirmations.

10. **Given** the three new npm dependencies (`react-hook-form`, `zod`, `@hookform/resolvers`), **When** a developer adds them, **Then** they are installed at the `apps/web` workspace scope via `pnpm --filter @confluent/web add react-hook-form zod @hookform/resolvers`. Acceptable versions (latest stable as of 2026-04-22): `react-hook-form ^7.62.x`, `zod ^3.25.x`, `@hookform/resolvers ^3.12.x`. These are the shared-schema triplet mandated by [architecture.md:224-227](../planning-artifacts/architecture.md#L224-L227) and [architecture.md:485-488](../planning-artifacts/architecture.md#L485-L488) — Story 3.5 sets the precedent; Epic 7 will migrate the questionnaire form onto the same primitives and co-locate schemas in `packages/shared`. DO NOT also `shadcn add form` in 3.5 — see Pinned Decision #7 (the shadcn `<Form>` context wrapper adds value once a codebase has 3+ forms; 3.5's single form is cleaner with hand-wired `register()` + `formState.errors`).

11. **Given** design tokens, **When** a developer inspects the new `<SharePanel>` component, **Then** ZERO raw hex values appear. Every colour routes through: `bg-popover` (via `<SheetContent>`), `text-foreground`, `text-muted-foreground`, `text-destructive`, `border-border` (via `<Separator>`), `border-input` + `aria-invalid:border-destructive` + `aria-invalid:ring-destructive/20` (inherited from `<Input>`), `var(--status-*)` (inherited from `<StatusDot>`), `--primary` + `--primary-foreground` (inherited from default `<Button>`). Validated by the Task 4 grep sweep (AC15).

12. **Given** the Sheet's 300 px width override via `className="w-[300px] sm:max-w-[300px]"` on `<SheetContent>`, **When** the viewport is narrower than 300 px (e.g. 320 px — the Epic-wide minimum viewport per Story 3.1 AC), **Then** the panel still renders at 300 px wide, NOT full-viewport-width — the UX spec explicitly calls the D5 panel a "fixed-width right drawer (300px)" at [ux-design-specification.md:418](../planning-artifacts/ux-design-specification.md#L418). The 20 px overlap at 320 px viewport is by design — it keeps the dossier content partially visible on the left edge and preserves the "you are sharing *this*" mental model per UX spec §D5 rationale at [ux-design-specification.md:409](../planning-artifacts/ux-design-specification.md#L409). No mobile-breakpoint override (no `max-sm:w-full` — explicitly NOT added). See Pinned Decision #8.

13. **Given** keyboard + screen-reader navigation, **When** the user opens the Sheet and Tabs through it, **Then** the tab order is:
    1. Email input (auto-focused on open — AC8)
    2. "Envoyer l'invitation" primary button
    3. "Annuler" outline button
    4. Close button (top-right `XIcon`)
    5. After cycle: focus trap loops back to email input (Base UI Dialog handles the trap automatically — do NOT pass `finalFocus` or tweak `trap`).
    The existing recipients mini-list is **NOT** in the tab order — each row is a `<StatusDot /> + <span>` pair, no interactive elements. Screen readers announce the Sheet on open as `"dialog, Partager le dossier, Entrez l'adresse email du destinataire..."` (Base UI Dialog exposes title + description via `aria-labelledby` + `aria-describedby` — no manual wiring needed). After close (any path), focus returns to the triggering `Partager` button (Base UI Dialog's `finalFocus` defaults to the trigger).

14. **Given** motion preferences, **When** the user has `prefers-reduced-motion: reduce` set at the OS level, **Then** the Sheet still opens and closes but the slide transition is effectively instant. No additional work in this story: Base UI's Dialog + the primitive's `transition duration-150` already respect the browser's `@media (prefers-reduced-motion)` via Tailwind v4's built-in `motion-reduce:transition-none`-style cascade. If the test walkthrough reveals residual motion under `prefers-reduced-motion`, defer the fix to a dedicated motion-preferences pass — do NOT block 3.5.

15. **Given** the Task 4 verification sweep, **When** a developer runs the grep guardrails, **Then**:
    - `grep -nE '#[0-9a-fA-F]{3,6}'` across `apps/web/src/components/confluent/SharePanel.tsx` + the modified `apps/web/src/routes/dashboard/dossiers/[slug].tsx` + the modified `apps/web/src/main.tsx` returns ZERO matches — every surface routes through design tokens (AC11).
    - `grep -n "Envoyer l'invitation\|Partager le dossier\|Entrez l'adresse email\|Adresse email du destinataire\|Aucun destinataire\|Destinataires existants\|Invitation envoyée\|L'adresse email est requise\|Format d'email invalide" apps/web/src/components/confluent/SharePanel.tsx` returns EXACTLY the expected count (each copy string appears once inside `SharePanel.tsx`, except `Invitation envoyée` which appears only in the route's `handleInvitationSubmit` and in the fixture `lastSeen` copy — see Pinned Decision #9 for copy ownership).
    - `grep -n "Partager le dossier\|Entrez l'adresse email\|Adresse email du destinataire\|L'adresse email est requise" apps/web/src/routes/dashboard/dossiers/\[slug\].tsx` returns ZERO matches — every French copy for the Sheet lives INSIDE `SharePanel.tsx` (one place to edit copy; the route handles only state wiring).
    - `grep -n "MOCK_ANALYTICS.accessEntries" apps/web/src/routes/dashboard/dossiers/\[slug\].tsx` returns EXACTLY one match on the line that initialises `useState` — post-3.5 the map renders from `accessEntries` local state, NOT from the frozen import.
    - `pnpm turbo run typecheck` / `lint` / `build` are all green. Preserve the 3 tolerated pre-existing warnings (`badge.tsx:52`, `button.tsx:58`, `features/current-user/context.tsx:17`) — no new warnings accepted. If lockfile changes trip CI, commit the pnpm-lock.yaml delta alongside the story.
    - Manual browser walkthrough (tri-viewport 375 / 900 / 1440 px): open Sheet → verify 300 px width, right side, 150 ms transition, autoFocus on email, `Escape` / overlay / Cancel close paths, empty submit shows inline red error, malformed email shows inline red error, valid submit closes + toast bottom-right + new pending row prepended. Re-open Sheet → verify the mini-list shows the just-added recipient at the top.

16. **Given** no regression on Stories 1.1 – 3.4, **When** the dev agent completes 3.5, **Then**:
    - `/dashboard` list still renders 2 mock cards + Créer un dossier (3.1, 2.2).
    - `/dashboard/dossiers/nouveau` → naming → questionnaire → recap → `/dashboard/dossiers/view/:slug` all reachable (2.3 – 2.6).
    - Contenu tab renders the dossier fields (2.6 / 3.2 unchanged).
    - `MetricCard` grid values (`2 / 7 / 4m 32s`) unchanged (3.3 AC1).
    - `Accès & partage` H2 unchanged (3.3 AC4) — except the row list now sources from local `accessEntries` state.
    - `TAB_VALUES` constant + `activeTab` derivation + `handleTabChange` guard unchanged (3.2 / 3.3).
    - `<AccessListRow>` + `<StatusDot>` internals unchanged (3.4) — 3.5 is an additive consumer.
    - The Partager button's visible chrome is unchanged — it still says "Partager", stays in the top-right of the dossier header, keeps `h-11 self-start px-4 sm:self-auto`. Only its `onClick`-free bare state switches to being the trigger of a `<Sheet>`.
    - `deferred-work.md` appended with any 3.5-discovered deferrals (e.g. AC14's motion-preferences tail, or the hover-red contrast concern from 3.4 Pinned Decision #10 if it resurfaces). If no new deferrals emerge, do NOT edit the file.

## Tasks / Subtasks

- [x] **Task 1: Install Zod + React Hook Form + hookform resolver and mount the Sonner Toaster (AC: 9, 10)**
  - [x] Run `pnpm --filter @confluent/web add react-hook-form zod @hookform/resolvers` from the repo root. Expect pnpm-lock.yaml to update; commit the delta.
  - [x] Verify versions satisfy AC10 (`react-hook-form ^7.62.x`, `zod ^3.25.x`, `@hookform/resolvers ^3.12.x`). If the registry returns newer majors, still accept them — the Zod → `.email()` API and the RHF → `register()` / `handleSubmit` / `formState` API have been stable since RHF v7.0 and Zod v3.0.
  - [x] Do NOT run `pnpm dlx shadcn@latest add form` — per Pinned Decision #7 the shadcn `<Form>` context is not needed for 3.5's single form.
  - [x] Edit [apps/web/src/main.tsx](apps/web/src/main.tsx): add `import { Toaster } from '@/components/ui/sonner'`, then render `<Toaster />` immediately before `<RouterProvider>` inside `<CurrentUserProvider>` (AC9 snippet). Preserve the `StrictMode` + `CurrentUserProvider` + `_CrossWorkspaceTypeCheck` export — no structural refactor.
  - [x] `pnpm turbo run typecheck` after this task → expect 2 successful, 0 errors. Lockfile change must not drift dependent workspace types.

- [x] **Task 2: Implement the `<SharePanel>` component (AC: 2, 3, 8, 11, 13, 14)**
  - [x] Create [apps/web/src/components/confluent/SharePanel.tsx](apps/web/src/components/confluent/SharePanel.tsx). Named exports only — `SharePanel`, `SharePanelProps`. No default export. Mirror the sibling shape of `AccessListRow.tsx` / `StatusDot.tsx` (alphabetical: `A…` < `D…` < `M…` < `S…` < `W…`).
  - [x] Imports:
    ```tsx
    import { zodResolver } from '@hookform/resolvers/zod'
    import { useForm } from 'react-hook-form'
    import { z } from 'zod'
    import { StatusDot } from '@/components/confluent/StatusDot'
    import { Button } from '@/components/ui/button'
    import { Input } from '@/components/ui/input'
    import { Label } from '@/components/ui/label'
    import { Separator } from '@/components/ui/separator'
    import {
      SheetClose,
      SheetContent,
      SheetDescription,
      SheetFooter,
      SheetHeader,
      SheetTitle,
    } from '@/components/ui/sheet'
    import type { AccessEntry } from '@/data/mock-analytics'
    ```
    Do NOT import `cn` unless the render body actually calls it — tree-shake cleanliness matters (3.4 Task 3b precedent).
  - [x] Define the Zod schema at module scope (NOT inside the component — the schema is a stable reference, not per-render):
    ```ts
    const shareFormSchema = z.object({
      email: z
        .string()
        .trim()
        .min(1, "L'adresse email est requise.")
        .email("Format d'email invalide.")
        .toLowerCase(),
    })
    type ShareFormValues = z.infer<typeof shareFormSchema>
    ```
    The `.trim()` + `.min(1)` + `.email()` + `.toLowerCase()` chain runs in that order inside Zod — `.trim()` first converts `"  "` → `""` which then fails `.min(1)` with the required message; `.toLowerCase()` runs last (transform) so the emitted value is always the canonical form passed to `onSubmitInvitation`.
  - [x] Define the prop contract EXACTLY:
    ```ts
    export interface SharePanelProps {
      existingEntries: readonly AccessEntry[]
      onSubmitInvitation: (email: string) => void
    }
    ```
    No `onCancel`, no `onClose` — cancel / overlay / Escape / close-button all flow through the parent `<Sheet>`'s `onOpenChange(false)`, NOT through the panel. `onSubmitInvitation` is called only on a successful Zod-validated submit; the parent is responsible for closing the Sheet after the mutation.
  - [x] Render body structure — EXACT skeleton (Option A: `<form>` wraps field body AND `<SheetFooter>` so the submit button is a direct descendant and `type="submit"` triggers `onSubmit` without any `form={id}` attribute or `onClick` shim):
    ```tsx
    export function SharePanel({ existingEntries, onSubmitInvitation }: SharePanelProps) {
      const {
        register,
        handleSubmit,
        reset,
        formState: { errors },
      } = useForm<ShareFormValues>({
        resolver: zodResolver(shareFormSchema),
        mode: 'onSubmit',
        defaultValues: { email: '' },
      })

      const onSubmit = handleSubmit(({ email }) => {
        onSubmitInvitation(email)
        reset()
      })

      return (
        <SheetContent className="w-[300px] duration-150 sm:max-w-[300px]">
          <SheetHeader>
            <SheetTitle>Partager le dossier</SheetTitle>
            <SheetDescription>
              Entrez l&apos;adresse email du destinataire pour lui envoyer une invitation d&apos;accès.
            </SheetDescription>
          </SheetHeader>

          <Separator />

          <form onSubmit={onSubmit} noValidate>
            <div className="flex flex-col gap-3 px-4 py-3">
              <Label htmlFor="share-email">Adresse email du destinataire</Label>
              <Input
                id="share-email"
                type="email"
                autoFocus
                autoComplete="email"
                placeholder="marc@fonds.fr"
                aria-required="true"
                aria-invalid={errors.email ? 'true' : undefined}
                aria-describedby={errors.email ? 'share-email-error' : undefined}
                {...register('email')}
              />
              <div aria-live="assertive" aria-atomic="true" className="min-h-[1em]">
                {errors.email && (
                  <p id="share-email-error" className="text-xs text-destructive">
                    {errors.email.message}
                  </p>
                )}
              </div>
            </div>

            <SheetFooter className="flex-col gap-2 p-4 sm:flex-row-reverse sm:justify-start">
              <Button type="submit" size="lg">
                Envoyer l&apos;invitation
              </Button>
              <SheetClose
                render={<Button type="button" variant="outline" size="lg" />}
              >
                Annuler
              </SheetClose>
            </SheetFooter>
          </form>

          <Separator />

          <div className="flex flex-col gap-2 px-4 py-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Destinataires existants
            </p>
            {existingEntries.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Aucun destinataire pour le moment.
              </p>
            ) : (
              <ul role="list" className="m-0 flex list-none flex-col gap-1.5 p-0">
                {existingEntries.map((entry) => (
                  <li key={entry.email} className="flex min-w-0 items-center gap-2">
                    <StatusDot status={entry.status} />
                    <span className="truncate text-sm text-foreground" title={entry.email}>
                      {entry.email}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </SheetContent>
      )
    }
    ```
    Key structural points (Pinned Decision #10):
    - The `<form>` wraps BOTH the field `<div>` AND the `<SheetFooter>`. The primary `<Button type="submit">` is a direct form descendant — native Enter-in-input submission and primary-button-click both route through the same `onSubmit` handler. NO `form={id}` attribute, NO `onClick={onSubmit}` shim.
    - The `<SheetClose>` for Annuler uses the `render` prop (Base UI pattern from [apps/web/src/components/ui/sheet.tsx:63-69](apps/web/src/components/ui/sheet.tsx#L63-L69)) — clicking it fires the Dialog's close mechanism, bypassing the form's `onSubmit` entirely.
    - The `<SheetFooter>` `className="flex-col gap-2 p-4 sm:flex-row-reverse sm:justify-start"` overrides the primitive's default `mt-auto flex flex-col gap-2 p-4`: at `sm:` breakpoint and up, switch to a horizontal row with reversed order so the primary button sits rightmost (the reading-end position per UX spec §Button Hierarchy at [ux-design-specification.md:644-651](../planning-artifacts/ux-design-specification.md#L644-L651)); below `sm:` it stacks vertically (primary on top). The `mt-auto` is dropped because the form body above pushes the footer naturally, AND keeping `mt-auto` would push the footer to the bottom of the Sheet, leaving a tall gap between the error region and the buttons.
    - The `noValidate` attribute on `<form>` suppresses the browser's native HTML5 validation tooltip on `type="email"` — the Zod schema is the single source of validation truth.
  - [x] The `<SheetFooter>` className override `flex-col gap-2 p-4 sm:flex-row-reverse sm:justify-start` resolves the primitive's default `mt-auto flex flex-col gap-2 p-4` (see [apps/web/src/components/ui/sheet.tsx:95](apps/web/src/components/ui/sheet.tsx#L95)) — mobile stacks vertically, `sm:` and up switches to horizontal-reversed so the primary button sits rightmost per UX spec §Button Hierarchy at [ux-design-specification.md:644-651](../planning-artifacts/ux-design-specification.md#L644-L651). The primitive's baked `mt-auto` is intentionally dropped (see the Option A skeleton commentary).
  - [x] Auto-focus: use the `autoFocus` HTML attribute on `<Input>` — Pinned Decision #6. Do NOT use `useRef` + `useEffect(() => ref.current?.focus(), [])` — React 19's StrictMode double-invokes the mount effect, and the ref-pattern often fights Base UI's own focus management inside Dialog. The native `autoFocus` attribute is picked up by Base UI's Dialog focus-trap setup and is declarative.
  - [x] Zero raw hex values in the new file. No inline style objects. Every class routes through Tailwind utilities or CSS vars (AC11).

- [x] **Task 3: Wire `<SharePanel>` into the dossier route (AC: 1, 4, 5, 6, 7, 12, 13, 16)**
  - [x] Edit [apps/web/src/routes/dashboard/dossiers/[slug].tsx](apps/web/src/routes/dashboard/dossiers/[slug].tsx). Preserve EVERYTHING from Stories 3.1 / 3.2 / 3.3 / 3.4 except the three narrow changes below.
  - [x] Add imports (insert alphabetically into the existing `components/confluent` import group):
    ```tsx
    import { useState } from 'react'
    import { toast } from 'sonner'
    import { SharePanel } from '@/components/confluent/SharePanel'
    import { Sheet, SheetTrigger } from '@/components/ui/sheet'
    import type { AccessEntry } from '@/data/mock-analytics'
    ```
    The existing `import { useEffect, useRef } from 'react'` at line 1 merges into `import { useEffect, useRef, useState } from 'react'`.
    The existing `import { MOCK_ANALYTICS } from '@/data/mock-analytics'` at line 10 merges into `import { MOCK_ANALYTICS, type AccessEntry } from '@/data/mock-analytics'`.
  - [x] Add the `deriveInitials` helper at module scope, below `resolveDisplayName` at line 61:
    ```tsx
    function deriveInitials(email: string): string {
      const localPart = email.split('@')[0] ?? ''
      const alpha = localPart.replace(/[^a-zA-Z]+/g, '').toUpperCase()
      if (alpha.length >= 2) return alpha.slice(0, 2)
      if (alpha.length === 1) return `${alpha}·`
      return '··'
    }
    ```
    The `··` fallback covers the adversarial edge case of `123@foo.fr` (no alpha in local-part) — matches the project's middle-dot padding convention from AC7. Named export NOT required — 3.5 consumes it only inside `handleInvitationSubmit`.
  - [x] Inside `DossierViewRoute`, add two `useState` hooks near the existing `const headingRef = useRef(...)` at line 66:
    ```tsx
    const [shareOpen, setShareOpen] = useState(false)
    const [accessEntries, setAccessEntries] = useState<AccessEntry[]>(
      () => [...MOCK_ANALYTICS.accessEntries],
    )
    ```
    The `useState` initializer is a function form (`() => [...MOCK_ANALYTICS.accessEntries]`) — prevents the spread from re-running on every render. The spread is necessary because `MOCK_ANALYTICS.accessEntries` is `readonly AccessEntry[]` (see [apps/web/src/data/mock-analytics.ts:27](apps/web/src/data/mock-analytics.ts#L27)) and `setAccessEntries` needs a mutable `AccessEntry[]`.
  - [x] Add the submit handler inside the component (alongside `handleTabChange`):
    ```tsx
    function handleInvitationSubmit(email: string) {
      setAccessEntries((prev) => [
        {
          email,
          initials: deriveInitials(email),
          status: 'pending',
          lastSeen: "Invitation envoyée à l'instant",
          sessionDuration: '—',
        },
        ...prev,
      ])
      toast.success(`Invitation envoyée à ${email}`)
      setShareOpen(false)
    }
    ```
    The entry shape MUST satisfy the `AccessEntry` discriminated union — TypeScript will error if `status: 'pending'` is paired with an extra `revokedAt` field or if `sessionDuration` is omitted. Leave the toast call synchronous — Sonner's `toast.success` is a synchronous function that enqueues the toast into the `<Toaster>`.
  - [x] Wrap the `<Button>Partager</Button>` at [apps/web/src/routes/dashboard/dossiers/[slug].tsx:144-150](apps/web/src/routes/dashboard/dossiers/[slug].tsx#L144-L150) in a `<Sheet>`:
    ```tsx
    <Sheet open={shareOpen} onOpenChange={setShareOpen}>
      <SheetTrigger
        render={
          <Button
            type="button"
            size="lg"
            className="h-11 self-start px-4 sm:self-auto"
          >
            Partager
          </Button>
        }
      />
      <SharePanel
        existingEntries={accessEntries}
        onSubmitInvitation={handleInvitationSubmit}
      />
    </Sheet>
    ```
    The `<SharePanel>` renders its own `<SheetContent>` (see Task 2's skeleton) — do NOT wrap `<SharePanel>` in another `<SheetContent>` here. The `<Sheet>` + `<SheetTrigger>` + `<SheetContent>` trio is how Base UI Dialog composes; `<SharePanel>` encapsulates the content leg.
  - [x] Swap the `.map` source at [apps/web/src/routes/dashboard/dossiers/[slug].tsx:215](apps/web/src/routes/dashboard/dossiers/[slug].tsx#L215) from `MOCK_ANALYTICS.accessEntries.map(...)` to `accessEntries.map(...)`. Swap the empty-state guard at line 209 from `MOCK_ANALYTICS.accessEntries.length === 0` to `accessEntries.length === 0`. ZERO other changes inside the analytics tab body.
  - [x] Do NOT remove any existing import. Do NOT rewrite the route file — keep all of the breadcrumb, H1-focus-on-mount, Tabs, MetricCard grid, AccessListRow list, and Contenu tab intact. The diff size for this task should be approximately +25 LOC, -2 LOC (the `.map` source swap and the empty-state guard swap).
  - [x] Post-edit self-review: run `pnpm turbo run typecheck` at this checkpoint → 2 successful, 0 errors. The AccessEntry discriminated union should narrow cleanly inside `handleInvitationSubmit` (`status: 'pending'` → no `revokedAt` required — the union's first branch).

- [x] **Task 4: Verify + guardrails (AC: 1-16)**
  - [x] `pnpm turbo run typecheck` → 2 successful, 0 errors. Verify: (a) the Zod schema compiles (`z.infer` narrows to `{ email: string }`); (b) RHF's `register('email')` resolves to `UseFormRegister<ShareFormValues>`; (c) `onSubmitInvitation` accepts `(email: string) => void` in the parent.
  - [x] `pnpm turbo run lint` → 0 errors. Preserve exactly 3 pre-existing warnings (`badge.tsx:52`, `button.tsx:58`, `features/current-user/context.tsx:17`). `SharePanel.tsx` must lint clean — named exports only, no default export, no mixed exports that trip `react-refresh/only-export-components`. If RHF / Zod / hookform-resolvers types lint-warn on `any` (they should not — all three are strict-typed), escalate rather than silence with `eslint-disable`.
  - [x] `pnpm turbo run build` → 2 successful, 0 errors. Expected bundle delta vs 3.4: +~20 KB gzipped (react-hook-form + zod + hookform-resolver + the new component + the Sonner toaster + the submit handler). Verify Sonner is NOT double-included — the `<Toaster>` must resolve to `sonner` (the actual npm package), not a duplicate copy.
  - [x] Self-review greps (AC15):
    - `grep -nE '#[0-9a-fA-F]{3,6}' apps/web/src/components/confluent/SharePanel.tsx apps/web/src/routes/dashboard/dossiers/\[slug\].tsx apps/web/src/main.tsx` → ZERO matches.
    - `grep -n "Partager le dossier\|Entrez l'adresse email\|Adresse email du destinataire\|L'adresse email est requise\|Format d'email invalide\|Aucun destinataire\|Destinataires existants" apps/web/src/components/confluent/SharePanel.tsx` → exactly 7 matches (one per string).
    - `grep -n "Partager le dossier\|Entrez l'adresse email\|Adresse email du destinataire\|L'adresse email est requise\|Format d'email invalide" apps/web/src/routes/dashboard/dossiers/\[slug\].tsx` → ZERO matches (Pinned Decision #9: copy lives in `SharePanel.tsx`).
    - `grep -n "Invitation envoyée" apps/web/src/routes/dashboard/dossiers/\[slug\].tsx` → exactly 2 matches (one inside `handleInvitationSubmit`'s `toast.success`, one inside the `lastSeen` literal of the prepended entry). None inside `SharePanel.tsx`.
    - `grep -n "MOCK_ANALYTICS.accessEntries" apps/web/src/routes/dashboard/dossiers/\[slug\].tsx` → exactly 1 match (the `useState` initializer). After 3.5 the route renders from `accessEntries`, not from the frozen import.
    - `grep -n "from 'sonner'" apps/web/src/routes/dashboard/dossiers/\[slug\].tsx` → exactly 1 match (the `toast` import).
    - `grep -n "Toaster" apps/web/src/main.tsx` → exactly 2 matches (import + JSX usage).
  - [x] `pnpm turbo run dev` manual walkthrough (tri-viewport: 375 / 900 / 1440 px):
    1. Navigate to `/dashboard/dossiers/view/biosensio` (no `?tab`). Verify: Partager button visible in header (unchanged from 3.2/3.3/3.4).
    2. Click Partager. Verify: Sheet slides in from the right, 300 px wide, in ~150 ms. Overlay is semi-transparent black (`bg-black/10` from [apps/web/src/components/ui/sheet.tsx:29](apps/web/src/components/ui/sheet.tsx#L29)). Dossier content is still visible behind the overlay on the left.
    3. Verify Sheet contents top-to-bottom: Title "Partager le dossier", description, Separator, labeled input (placeholder "marc@fonds.fr"), then below the form: primary "Envoyer l'invitation" button + outline "Annuler" button, then Separator, then "DESTINATAIRES EXISTANTS" small-caps heading, then three `<StatusDot />` + email rows for `arc@capital.fr` / `martin@fund.io` / `lea@invest.com`.
    4. Verify auto-focus: the email input is focused on Sheet open. Start typing — the text appears in the input without needing to click first.
    5. Keyboard — submit empty. Press Enter inside the input while it is empty. Verify: the Zod error "L'adresse email est requise." renders below the input in red (`text-destructive`), the input border flips to `border-destructive` (via `aria-invalid`), the Sheet stays open, no toast fires, no new row is added.
    6. Keyboard — submit malformed. Type `not-an-email`, press Enter. Verify: error "Format d'email invalide." renders. Clear + type `valid@test.fr`. Verify: error clears (RHF re-validates on next submit by default — validate by submitting again, NOT by typing).
    7. Keyboard — submit valid. Type `marc@fonds.fr`, press Enter. Verify in order: Sheet closes; a toast "Invitation envoyée à marc@fonds.fr" appears bottom-right (Sonner default) with the `CircleCheckIcon`; the toast lives ~3 s then dismisses; a new pending row (orange `StatusDot`, `MA` avatar, `marc@fonds.fr` email, `"Invitation envoyée à l'instant"` lastSeen, `—` duration, Révoquer button) appears at the TOP of the access list when the user switches to `?tab=analytics`.
    8. Click Partager again. Verify the Sheet reopens, the input is empty (reset), and the mini-list at the bottom now shows 4 recipients (the newly-added `marc@fonds.fr` at the top — the mini-list's render order matches `accessEntries`' render order).
    9. Click Annuler. Verify: Sheet closes, no toast, no list mutation. Reopen → mini-list still has 4 recipients (the Annuler path does NOT undo the previous successful submit).
    10. Open Sheet. Press Escape. Verify: Sheet closes, no toast, no mutation. Reopen. Click the backdrop to the left. Verify: Sheet closes, no toast, no mutation. Reopen. Click the top-right `X` (close button). Verify: Sheet closes, no toast, no mutation. All four dismissal paths behave identically.
    11. Tab-order walk inside the Sheet: press Tab. Focus moves email → primary button → outline Cancel → close `X` → (cycles back to email via Base UI's focus trap). Press Shift+Tab from email: focus moves to close `X` (reverse cycle).
    12. Close the Sheet via any dismissal path. Verify: focus returns to the Partager button in the header (Base UI's Dialog `finalFocus` default = trigger).
    13. Mobile viewport (375 px). Verify: the Sheet is 300 px wide, NOT full-viewport-width. A ~75 px strip of dossier content stays visible on the left. Toast renders bottom-right of the viewport (Sonner default is responsive; verify it does not overflow the right edge).
    14. Mobile viewport (320 px extreme). Verify: Sheet is still 300 px wide, overlapping 20 px of dossier content. No horizontal scrollbar on the `<html>` / `<body>` — the Sheet is `position: fixed`, so it doesn't extend the document width.
    15. Revisit the analytics tab. Verify: new recipients added via the Sheet render as `AccessListRow` items — orange StatusDot, muted em-dash for duration, Révoquer button visible but silent-no-op (3.4 behaviour; 3.6 will wire it).
    16. Try submitting with an email containing mixed case (`Marc@Fonds.fr`). Verify: Zod's `.toLowerCase()` normalisation kicks in — the prepended row's `email` and the toast copy both read `marc@fonds.fr`. The `deriveInitials` helper outputs `MA` (already uppercased inside the helper).
    17. Prefers-reduced-motion probe: open DevTools → Rendering → set `prefers-reduced-motion: reduce`. Open the Sheet. Verify the slide is imperceptibly fast (~0 ms). No broken layout. The grading here is qualitative — if the transition is visibly choppy under reduced-motion, document the finding and defer (AC14).
  - [x] No regression sweep on Stories 1.1 – 3.4 (AC16):
    - `/dashboard` empty state (2.2) still reachable if the user resets local state.
    - `/dashboard/dossiers/nouveau` wizard (2.3 – 2.6) unchanged.
    - Contenu tab renders dossier fields (3.2 unchanged).
    - MetricCard grid values `2 / 7 / 4m 32s` unchanged (3.3 AC1).
    - `AccessListRow` hover state on Révoquer: border + text flip to destructive on hover, background stays transparent (3.4 AC12).
    - `<StatusDot>` renders at 100% opacity for revoked rows (3.4 AC10).

- [x] **Task 5: Self-review sweep before marking story done**
  - [x] All 16 ACs trace to code (AC → Task mapping documented in each AC block and each Task header).
  - [x] Zero raw hex values in new + modified files (AC11, AC15).
  - [x] All French copy lives inside `SharePanel.tsx` (except the toast + `lastSeen` strings which live in the route's `handleInvitationSubmit` — see Pinned Decision #9). ZERO French copy in `main.tsx`.
  - [x] `<SharePanel>` prop contract is `{ existingEntries, onSubmitInvitation }` only — no `onCancel`, no `onClose`, no `onOpenChange`. Cancel / overlay / Escape flow through the parent `<Sheet>`'s `onOpenChange(false)`.
  - [x] Zod schema lives at MODULE scope (not inside the component). The `.trim().min(1).email().toLowerCase()` chain runs in that order.
  - [x] `autoFocus` uses the HTML attribute, NOT a `useRef` + `useEffect` recipe (Pinned Decision #6).
  - [x] `<SheetContent>` has `className="w-[300px] duration-150 sm:max-w-[300px]"` — the three overrides resolve the primitive's default `w-3/4 sm:max-w-sm` and `duration-200` (AC1, AC12).
  - [x] The `<form>` wraps BOTH the field body AND the `<SheetFooter>` (Task 2 Option A skeleton, Pinned Decision #10). The primary button is `type="submit"` with NO `onClick` handler and NO `form="..."` attribute.
  - [x] `<Toaster>` is mounted exactly once, inside `<CurrentUserProvider>`, at [apps/web/src/main.tsx](apps/web/src/main.tsx). No other mount point (grep for `<Toaster` across `apps/web/src` returns exactly 1 match — the import + JSX usage together are 2 lines inside `main.tsx`).
  - [x] `toast.success(...)` fires exactly once per valid submit — no double-fire under React 19 StrictMode. If double-fire appears in dev (StrictMode double-invokes effects but NOT event handlers), suspect a leaked `onSubmit`/`onClick` handler pair (Option B's trap).
  - [x] `deriveInitials` is a pure function, synchronous, no side effects. The 2-char output satisfies `AvatarFallback`'s rendering expectation (3.4 pattern — avatar is 32 px with 2-letter initials).
  - [x] `MOCK_ANALYTICS.accessEntries` is spread (NOT mutated) into `useState`. The `readonly` modifier at [apps/web/src/data/mock-analytics.ts:27](apps/web/src/data/mock-analytics.ts#L27) prevents the TS type system from allowing a direct assignment — the spread is the canonical escape hatch.
  - [x] Commit strategy: single `feat(epic-3): story 3.5 — Share panel (D5) with Sheet component` commit that bundles implementation AND any self-applied review patches (per user memory preference: "Code + review in a single commit"). Do NOT split the review patches into a separate `fix(epic-3): story 3.5 code-review patches` commit.

### Review Findings

Code review run on 2026-04-22. 3 adversarial layers: Blind Hunter (diff-only), Edge Case Hunter (branch/boundary sweep with project read), Acceptance Auditor (AC + Pinned Decision + Anti-Pattern conformance — returned clean). 3 decision-needed (2 resolved → patch, 1 resolved → dismissed), 2 patch, 4 defer, 34 dismissed.

- [x] [Review][Patch] Duplicate-email submission allows React-key collision — `handleInvitationSubmit` in [apps/web/src/routes/dashboard/dossiers/[slug].tsx:126-138](apps/web/src/routes/dashboard/dossiers/[slug].tsx#L126-L138) unconditionally prepends a new entry; submitting the same address twice produces two rows with the same `key={entry.email}` in both the analytics tab's `<AccessListRow>` list and the Sheet mini-list, plus a duplicate `toast.success`. Decision (2026-04-22): reject with inline error `"Cette adresse est déjà invitée."` + keep Sheet open. **Applied** in [apps/web/src/components/confluent/SharePanel.tsx:48-58](apps/web/src/components/confluent/SharePanel.tsx#L48-L58): destructured `setError` from `useForm`, added an early-return duplicate check at the top of `onSubmit` that calls `setError('email', { type: 'duplicate', message: 'Cette adresse est déjà invitée.' })`. The message surfaces through the existing `aria-live="assertive"` inline-error region — no UI change, no new copy location (stays inside `SharePanel.tsx` per Pinned Decision #9). Comparison is case-safe because Zod's `.toLowerCase()` transform normalises incoming emails and `MOCK_ANALYTICS.accessEntries` emails are already lowercased. Sources: blind+edge.
- [x] [Review][Dismissed] `deriveInitials` strips French accents — AC7's `[^a-zA-Z]+` regex at [apps/web/src/routes/dashboard/dossiers/[slug].tsx:66-72](apps/web/src/routes/dashboard/dossiers/[slug].tsx#L66-L72) discards accented characters. Decision (2026-04-22): honor AC7 verbatim. Rationale: Zod 4's default `z.string().email()` uses the HTML5 email regex which rejects non-ASCII in the local-part, so `éric@x.fr` already fails validation upstream with `"Format d'email invalide."` — `deriveInitials` is never reached for accented addresses. AC7 ASCII-only intent is correctly enforced by the validation layer. No code change required.
- [x] [Review][Patch] `accessEntries` persists across dossier-slug navigation — `useState` at [apps/web/src/routes/dashboard/dossiers/[slug].tsx](apps/web/src/routes/dashboard/dossiers/[slug].tsx) is keyed to the route component, which React Router reuses across `/view/biosensio` → `/view/otherslug` transitions when the pattern matches. Invitations added under dossier A will render under dossier B until the page is hard-refreshed. Decision (2026-04-22): force a full component remount on slug change. **Applied** by splitting the route's default export into a thin `DossierViewRoute` wrapper that reads `useParams` and renders `<DossierView key={slug ?? 'no-slug'} />`, with the original body moved into the new `DossierView` inner function. Remount resets `accessEntries`, `shareOpen`, RHF form state, scroll position, and any future per-dossier state naturally. Chosen in preference to a `router.tsx` wrapper to avoid introducing a new `react-refresh/only-export-components` lint warning (AC15 — "no new warnings accepted") that co-locating a component beside the existing `export const router` would trigger. Source: edge.
- [x] [Review][Defer] `title={entry.email}` tooltip invisible on touch devices [apps/web/src/components/confluent/SharePanel.tsx:128-132](apps/web/src/components/confluent/SharePanel.tsx#L128-L132) — deferred, extends 3.3/3.4's existing deferral (same pattern on `<AccessListRow>`); screen readers read the full email, sighted touch users lose truncated content. Revisit alongside the dedicated mobile-UX pass.
- [x] [Review][Defer] Bundle size +53 KB gzipped vs 3.4 baseline (Vite `>500 kB chunk` advisory) — deferred, already documented in Completion Notes; code-splitting via `React.lazy` / dynamic `import()` of `SharePanel.tsx` is the natural fix but structurally belongs to Epic 10 (deployment) or the first production-readiness pass.
- [x] [Review][Defer] No test coverage for `<SharePanel>` (136 LOC with form validation + ARIA + conditional branches) — deferred, the monorepo does not yet ship a test runner (`vitest` + `@testing-library/react` are unwired); adding test infra is out of 3.5's scope. Revisit when a dedicated "test-setup" story lands or when the first epic-level QA pass begins.
- [x] [Review][Defer] `AccessEntry` domain type colocated with mock fixture [apps/web/src/data/mock-analytics.ts:16-18](apps/web/src/data/mock-analytics.ts#L16-L18) — deferred, production code welded to a mock file; refactor into a dedicated types module (e.g., `packages/shared/src/types/` per architecture.md:400) belongs with Epic 7's API contracts, when the type gains a real-API consumer and stops being a fixture-only concern.

## Dev Notes

### Critical Architecture Constraints

- **`SharePanel` lives at `apps/web/src/components/confluent/`** — design-system component with Confluent-specific anatomy. NOT in `components/ui/` (shadcn primitives only). NOT in `features/sharing/` (backend-era future folder per [architecture.md:661-663](../planning-artifacts/architecture.md#L661-L663); 3.5 is still frontend-mock scope). [Source: ux-design-specification.md §Component Implementation Strategy line 612-617; §Custom Components line 625-629]
- **Shadcn primitives are Base UI-based, NOT Radix.** The `sheet.tsx` component imports from `@base-ui/react/dialog`, not `@radix-ui/react-dialog`. Any story 3.5 developer muscle memory around Radix APIs (e.g., `onOpenAutoFocus`, `modal={true}`, `asChild`) does NOT apply. Base UI Dialog uses `render` prop + `dismissible` + `initialFocus` props instead. [Source: [apps/web/src/components/ui/sheet.tsx:2](apps/web/src/components/ui/sheet.tsx#L2); architecture.md:219-222]
- **React Hook Form + Zod is the mandated form pattern per architecture.md:224-227 AND AC10.** Story 3.5 is the FIRST form in the frontend to use this triplet. Epic 7's questionnaire will migrate onto the same primitives and co-locate shared Zod schemas in `packages/shared/src/schemas/`. 3.5's schema is LOCAL to `SharePanel.tsx` (no shared-schema footprint yet) — the `ShareFormValues` type is scoped to the component and never leaves it. [Source: architecture.md:224-227, architecture.md:485-488, architecture.md:514-518]
- **Toaster MUST be mounted once at the app root.** Sonner's `toast()` function enqueues notifications into whatever `<Toaster>` is mounted in the React tree — if the Toaster isn't mounted, `toast()` is a silent no-op. 3.5 mounts it at [apps/web/src/main.tsx](apps/web/src/main.tsx). Stories 3.6 (revocation toast), Epic 4 (financeur confirmations), Epic 7 (questionnaire save success), Epic 8 (share-link generation confirmation) all reuse the same mount. [Source: [apps/web/src/components/ui/sonner.tsx](apps/web/src/components/ui/sonner.tsx); ux-design-specification.md §Feedback Patterns line 653-661]
- **`accessEntries` moves from static import to local component state.** `MOCK_ANALYTICS.accessEntries` at [apps/web/src/data/mock-analytics.ts:27](apps/web/src/data/mock-analytics.ts#L27) is `readonly AccessEntry[]` — frozen via `as const` at line 60. Story 3.5 spreads it into `useState` at the `DossierViewRoute` level — NOT in a Zustand store (architecture.md:229 explicitly defers Zustand), NOT in a React Context (would over-hoist for a single consumer). Lift to Context only if 3.6 or Epic 4 needs cross-route access to the list. [Source: architecture.md:229; [apps/web/src/data/mock-analytics.ts:27](apps/web/src/data/mock-analytics.ts#L27)]
- **The `AccessEntry` discriminated union is unchanged.** 3.5 adds a new `pending` entry (first branch of the union: `{ status: 'active' | 'pending' }`, no `revokedAt`). The discriminated union correctly allows this without `revokedAt`. DO NOT widen, narrow, or reshape the union in 3.5 — 3.6 will add a fourth state (`'revoking'` optimistic-update) as an additive variant. [Source: [apps/web/src/data/mock-analytics.ts:16-18](apps/web/src/data/mock-analytics.ts#L16-L18); Story 3.4 §Critical Architecture Constraints]
- **Route path stays `/dashboard/dossiers/view/:slug`** — the real path established by Story 2.6's code-review patch. 3.5 does NOT "fix" the Epic-level path discrepancy with the bare `:slug`. [Source: [apps/web/src/router.tsx](apps/web/src/router.tsx); Stories 3.1 / 3.2 / 3.3 / 3.4 Pinned Decisions]
- **Design tokens only — no raw hex.** Every surface in `SharePanel` routes through `bg-popover` (SheetContent), `text-foreground` (title, recipient emails), `text-muted-foreground` (description, error copy's-cousin muted states, mini-list empty-state), `text-destructive` (error), `border-border` (Separator), `border-input` + `aria-invalid:border-destructive` + `aria-invalid:ring-destructive/20` (Input), `var(--status-*)` (StatusDot), `--primary` + `--primary-foreground` (Button). AC11's grep sweep is the automated guardrail.
- **French-locale typography:** `"Partager le dossier"`, `"Entrez l'adresse email du destinataire pour lui envoyer une invitation d'accès."`, `"Adresse email du destinataire"`, `"marc@fonds.fr"`, `"Envoyer l'invitation"`, `"Annuler"`, `"Destinataires existants"`, `"Aucun destinataire pour le moment."`, `"L'adresse email est requise."`, `"Format d'email invalide."`, `"Invitation envoyée à ${email}"`, `"Invitation envoyée à l'instant"` — all copy verbatim from Epic AC and UX spec. Do NOT "improve" with typographic spaces, alternate orthography, or abbreviations. Do NOT switch French `'` to typographic `'` — code files use ASCII apostrophes, and the `&apos;` JSX escape is used inside quoted string literals that appear in markup (see the `nouveau/index.tsx:42` precedent).
- **WCAG 2.1 AA baseline** — Sheet uses Base UI Dialog's focus-trap (accessible-name from SheetTitle via `aria-labelledby`, accessible-description from SheetDescription via `aria-describedby`); the Input's `aria-required` + `aria-invalid` + `aria-describedby` contract surfaces validation errors to AT; the inline error uses `aria-live="assertive"` so screen readers announce the error immediately on submit; the close button has `<span className="sr-only">Close</span>` from the primitive. [Source: ux-design-specification.md §Accessibility line 377-405; prd.md §NFR20-NFR23 line 495-498]
- **Motion under `prefers-reduced-motion`:** Base UI Dialog + Tailwind v4 both respect the media query by default. 3.5 does NOT add custom motion overrides. If a walkthrough reveals residual motion, defer to a motion-preferences polish pass. [Source: AC14]

### Design Tokens to Use

| Surface | Tailwind utility | Value | Where |
|---|---|---|---|
| Sheet container | `w-[300px] duration-150 sm:max-w-[300px]` on `<SheetContent>` | 300 px wide, 150 ms transition | Override of primitive's `w-3/4 sm:max-w-sm` + `duration-200` (sheet.tsx:54) |
| Sheet backdrop | Inherited: `bg-black/10 duration-150 supports-backdrop-filter:backdrop-blur-xs` | Semi-transparent black + backdrop blur | Default from sheet.tsx:29 — NO override |
| Sheet title | Inherited: `font-heading text-base font-medium text-foreground` | 16 px / 500 / `#1A1A1A` | `<SheetTitle>` default from sheet.tsx:106 |
| Sheet description | Inherited: `text-sm text-muted-foreground` | 14 px / `#6B6B6B` | `<SheetDescription>` default from sheet.tsx:121 |
| Separator | Inherited: `shrink-0 bg-border h-px w-full` | 1 px / `#E8E8E7` | Default from separator.tsx:17 |
| Form body | `flex flex-col gap-3 px-4 py-3` | 12 px gap, 16 px h + 12 px v padding | `<form>` inside `<SheetContent>` |
| Label | Inherited: `flex items-center gap-2 text-sm leading-none font-medium select-none` | 14 px / 500 | Default from label.tsx:12 |
| Email input | Inherited: `h-8 w-full border border-input bg-transparent … aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20` | 32 px tall, 1 px border, flips to destructive on invalid | Default from input.tsx:12 |
| Inline error `<p>` | `text-xs text-destructive` | 12 px / `#E57373` | Inside `aria-live` region below input |
| Inline error region | `aria-live="assertive" aria-atomic="true" className="min-h-[1em]"` | Reserves 1 em height to prevent layout shift | Wrapper around conditional error `<p>` |
| Footer | `mt-auto flex flex-col gap-2 p-4 sm:flex-row sm:flex-row-reverse sm:justify-start` | Stack → row-reverse at sm:, primary on the right | `<SheetFooter>` with className override |
| Primary button | Inherited: `size="lg"` → `h-11 px-6 text-base` on `bg-primary text-primary-foreground` | 44 px tall, solid primary | Default `<Button size="lg">` |
| Outline button | Inherited: `variant="outline" size="lg"` → 44 px tall, 1 px `border-input` on `bg-transparent`, hover `bg-muted` | 44 px tall, outline | Default `<Button variant="outline" size="lg">` inside `<SheetClose render={…}>` |
| Mini-list heading | `text-xs uppercase tracking-wide text-muted-foreground` | 12 px / uppercase / tracking / `#6B6B6B` | `<p>` above the recipients list |
| Mini-list row | `flex min-w-0 items-center gap-2` on `<li>` | 8 px gap, flex row, min-width-0 for truncate | `<li>` inside `<ul role="list">` |
| Mini-list email span | `truncate text-sm text-foreground` with `title={email}` | 14 px / `#1A1A1A` / truncate with title fallback | `<span>` next to `<StatusDot>` |
| StatusDot (all statuses) | Inherited from 3.4 | 7 px dot / status-* color / 14 px label | `<StatusDot status={entry.status} />` |
| Toast (success) | Sonner default + `<Toaster>` wrapper at sonner.tsx:17-24 | `bg-popover` / `text-popover-foreground` / `border-border` / `radius-var(--radius)` / bottom-right / 3 s | `toast.success(...)` call |
| Toast icon (success) | `CircleCheckIcon` from `lucide-react` via sonner.tsx:11 | 16 px (size-4) icon | Success variant |

### Component Prop Contracts (exhaustive)

```ts
// apps/web/src/components/confluent/SharePanel.tsx
import type { AccessEntry } from '@/data/mock-analytics'

export interface SharePanelProps {
  existingEntries: readonly AccessEntry[]
  onSubmitInvitation: (email: string) => void
}
export function SharePanel(props: SharePanelProps): JSX.Element
```

Zod schema (module-scope, local to `SharePanel.tsx`):
```ts
const shareFormSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, "L'adresse email est requise.")
    .email("Format d'email invalide.")
    .toLowerCase(),
})
type ShareFormValues = z.infer<typeof shareFormSchema>
```

`AccessEntry` (unchanged from Story 3.3 / 3.4, preserved for reference):
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
│   │   ├── AccessListRow.tsx                                     [UNCHANGED — 3.4]
│   │   ├── DossierCard.tsx                                       [UNCHANGED]
│   │   ├── DossierField.tsx                                      [UNCHANGED]
│   │   ├── EmptyState.tsx                                        [UNCHANGED]
│   │   ├── MetricCard.tsx                                        [UNCHANGED]
│   │   ├── SharePanel.tsx                                        [NEW — D5 share panel]
│   │   ├── StatusDot.tsx                                         [UNCHANGED — 3.4]
│   │   ├── WizardInput.tsx                                       [UNCHANGED]
│   │   └── illustrations/                                        [UNCHANGED]
│   ├── layout/                                                   [UNCHANGED]
│   └── ui/                                                       [UNCHANGED — no new primitives]
├── data/
│   ├── mock-analytics.ts                                         [UNCHANGED — still the seed source]
│   ├── mock-dossiers.ts                                          [UNCHANGED]
│   └── questionnaire.ts                                          [UNCHANGED]
├── features/                                                     [UNCHANGED]
├── lib/                                                          [UNCHANGED]
├── routes/
│   └── dashboard/
│       └── dossiers/
│           └── [slug].tsx                                        [MODIFIED — Sheet wrapper, local accessEntries state, handleInvitationSubmit, deriveInitials helper]
├── main.tsx                                                      [MODIFIED — <Toaster /> mounted inside <CurrentUserProvider>]
└── router.tsx                                                    [UNCHANGED]

apps/web/package.json                                             [MODIFIED — + react-hook-form, + zod, + @hookform/resolvers]
pnpm-lock.yaml                                                    [MODIFIED — three new deps]
```

### Previous Story Intelligence

**From Story 3.4 (just landed — `e04e2a2`):**
- `<AccessListRow>` + `<StatusDot>` are shipping design-system components — Story 3.5 reuses `<StatusDot>` verbatim in the Sheet's mini-list and ALSO relies on `<AccessListRow>` to render the newly-added pending entries in the analytics tab (via the prepend-to-local-state pattern in AC4).
- The `<AccessListRow>` contract takes `entry: AccessEntry` + optional `onRevokeClick`. Story 3.5 does NOT pass `onRevokeClick` — 3.6 wires it. The pending rows added by 3.5 will therefore render with a silent-no-op Révoquer button, same as 3.4's behaviour.
- The `MOCK_ANALYTICS.accessEntries` fixture is `readonly as const` — the 3.5 `useState` spread is the canonical way to un-freeze it for mutation.
- The `AccessEntry` discriminated union's `status: 'active' | 'pending'` branch has NO `revokedAt` — 3.5's prepended entry satisfies this branch without extra fields.
- The `MetricCard` grid values (`2 / 7 / 4m 32s`) are STATIC copy — they do NOT recompute when 3.5 adds a pending entry. The Epic AC does NOT require metric recomputation in 3.5 (that lands with Epic 8's real analytics). Leave the fixture untouched.
- Single-commit preference: "Code + review in a single commit" from user memory (2026-04-20). 3.5's commit format: `feat(epic-3): story 3.5 — Share panel (D5) with Sheet component`.
- 3.4 landed WITHOUT react-hook-form / zod / hookform-resolvers — 3.5 is the first to add them. The install step is the single largest dependency delta since Story 1.2's initial shadcn/Tailwind scaffold.

**From Story 3.2 (dossier header):**
- The Partager button is at [apps/web/src/routes/dashboard/dossiers/[slug].tsx:144-150](apps/web/src/routes/dashboard/dossiers/[slug].tsx#L144-L150) — a bare `<Button type="button" size="lg" className="h-11 self-start px-4 sm:self-auto">Partager</Button>` with no click handler. 3.5 wraps it in a `<Sheet>` + `<SheetTrigger render={...}>`. The button's visible chrome is preserved verbatim.

**From Story 2.3 (dossier naming form):**
- The form pattern at [apps/web/src/routes/dashboard/dossiers/nouveau/index.tsx:1-77](apps/web/src/routes/dashboard/dossiers/nouveau/index.tsx#L1-L77) uses plain `useState` + manual validation. Story 3.5 does NOT migrate that form to react-hook-form (scope discipline) — the two forms will coexist until Epic 7's consolidated questionnaire refactor. The shared patterns that DO carry over verbatim: (a) the `aria-live="assertive"` + `min-h-[1em]` error region recipe; (b) the `aria-invalid` + `aria-describedby` wiring on the input; (c) the 12 px `text-destructive` error copy; (d) French-locale error copy in the present-tense imperative.

**From Story 3.3 (access list mini-heading precedent):**
- The "DESTINATAIRES EXISTANTS" heading in the Sheet's mini-list uses the same `text-xs uppercase tracking-wide text-muted-foreground` recipe as the analytics tab's MetricCard label styling. No new token needed.
- The "Aucun destinataire pour le moment." empty-state copy is reused verbatim from the analytics tab's empty branch at [apps/web/src/routes/dashboard/dossiers/[slug].tsx:210-212](apps/web/src/routes/dashboard/dossiers/[slug].tsx#L210-L212). Single source of copy; same tone.

**From Story 3.3 / 3.4 §Review Findings — items explicitly tagged for 3.5 resolution:**
- NONE. The 3.4 review deferred 2 items — (a) `StatusDot` runtime TypeError on unknown API status (deferred to Epic 8's real API), (b) `title={entry.email}` tooltip invisible on touch (deferred to a dedicated mobile-UX pass). Neither is actionable in 3.5.

### Decisions Pinned for This Story

The following decisions are locked for Story 3.5 implementation. Do not renegotiate without explicit retrospective action.

1. **`<SheetContent>` override is `className="w-[300px] duration-150 sm:max-w-[300px]"`.** The three overrides resolve: (a) the primitive's default `data-[side=right]:w-3/4` → 300 px; (b) the primitive's `data-[side=right]:sm:max-w-sm` → also 300 px (so mobile and desktop both render at 300 px); (c) the primitive's `transition … duration-200` → 150 ms. Tailwind-merge deduplicates — verified by the `cn` call inside `<SheetContent>`. Rationale: the UX spec mandates a 300 px fixed-width drawer (ux-design-specification.md:418) and the Epic AC mandates 150 ms (epics.md:751) — both are non-negotiable; the primitive's defaults are for a generic drawer pattern, not our D5.
2. **The Sheet's existing-recipients mini-list is a SIMPLER layout than `<AccessListRow>`, not a reuse.** Each row is `<li><StatusDot /> <span className="truncate text-sm text-foreground">{email}</span></li>` — no avatar, no lastSeen, no session duration, no Révoquer button. Rationale: the 300 px-wide Sheet cannot accommodate the full AccessListRow anatomy (32 px avatar + email + 12 px lastSeen on the left; 22 px duration + StatusDot + Révoquer button on the right) without wrapping awkwardly; the Epic AC spec says "StatusDot + email on one line" which is explicit.
3. **Validation timing: `mode: 'onSubmit'` on the RHF form — NOT on-blur.** The UX spec at [ux-design-specification.md:657](../planning-artifacts/ux-design-specification.md#L657) prescribes "on blur, not on keypress" for questionnaire fields; the Epic AC for 3.5 is silent on timing but the inline error pattern from 2.3's `nouveau/index.tsx` validates on submit. Pin on-submit for 3.5 consistency with 2.3. Rationale: on-submit is the minimum spec-compliant path; the Sheet's single-field form doesn't benefit from on-blur validation like the multi-field questionnaire will in Epic 7. Revisit in Epic 7 when the questionnaire consolidates.
4. **The Partager button is wrapped with `<SheetTrigger render={<Button …>Partager</Button>} />`, NOT with `<SheetTrigger asChild><Button>Partager</Button></SheetTrigger>`.** Base UI uses `render`-props, not Radix's `asChild` escape hatch. The wrap merges the trigger's click-handler onto the inner `<Button>` without breaking the button's existing classnames or children. Rationale: documented in the sheet.tsx close-button recipe at [apps/web/src/components/ui/sheet.tsx:63-69](apps/web/src/components/ui/sheet.tsx#L63-L69); consistent with Base UI's Dialog API.
5. **`<SharePanel>` is a separate component, NOT inlined into `[slug].tsx`.** Even though 3.5 has exactly one call site, the panel encapsulates: the Zod schema, the RHF hook, the form render, the mini-list render. Inlining would push the route component past 300 LOC. Rationale: the component-extraction bar (3.3 Pinned Decision #4, 3.4 Pinned Decision #9) is "extract only when the boundary is visible or a second caller emerges" — the 300-px-wide Sheet surface is itself a clear boundary, and Epic 6's real-auth wiring will likely reuse `<SharePanel>` for a variant that hits the API (though it may grow a `mode: 'create' | 'edit'` prop at that point). Extract now for clarity, not for reuse.
6. **Auto-focus uses the native `autoFocus` HTML attribute, NOT `useRef` + `useEffect`, NOT Base UI's `initialFocus` prop.** React 19's StrictMode double-invokes effects, which can fight both ref-based focus and Base UI's internal focus-trap setup. Base UI Dialog's `initialFocus` prop exists but requires passing a ref, adding ceremony. The native `autoFocus` attribute is declarative, survives StrictMode double-invocation, and Base UI's focus-trap composes with it. Rationale: simplest working recipe; no bug surface.
7. **Do NOT `shadcn add form` in 3.5.** The shadcn `<Form>` component is a context wrapper around `react-hook-form`'s `FormProvider` + ergonomic `<FormField>`, `<FormItem>`, `<FormLabel>`, `<FormMessage>` primitives. It shines when a form has 3+ fields. 3.5's single-field form is cleaner written with `register('email')` + `errors.email?.message` inline. If Epic 7 migrates the questionnaire to RHF, add `shadcn add form` at THAT point. Rationale: don't pay abstraction cost when the form is a one-field shot.
8. **No mobile-breakpoint override on the Sheet's width.** At 320 px viewport the 300 px Sheet overlaps 20 px of the dossier content. This is intentional per UX spec §D5 rationale ("dossier remains visible in context"). A `max-sm:w-full` override would make the Sheet full-viewport-width on mobile — defeats the UX purpose. Rationale: D5 is about context preservation, not about visual comfort at the narrowest viewport; 320 px is an edge case for an entrepreneur who is likely on 375+ px devices.
9. **French copy ownership: copy that is "about the form itself" lives in `SharePanel.tsx`; copy that is "about the data" lives in the route's submit handler.** Specifically:
   - `SharePanel.tsx` owns: `"Partager le dossier"`, `"Entrez l'adresse email du destinataire pour lui envoyer une invitation d'accès."`, `"Adresse email du destinataire"`, `"marc@fonds.fr"`, `"Envoyer l'invitation"`, `"Annuler"`, `"Destinataires existants"`, `"Aucun destinataire pour le moment."`, `"L'adresse email est requise."`, `"Format d'email invalide."`.
   - The route's `handleInvitationSubmit` owns: `"Invitation envoyée à ${email}"` (toast copy), `"Invitation envoyée à l'instant"` (new entry's `lastSeen`).
   Rationale: the route is the state-mutation layer; the toast + the `lastSeen` string are shaped by the mutation's runtime data (the email), so they live with the mutation. `SharePanel` is the presentation layer for static copy. This split also keeps `SharePanel` reusable if Epic 6's real-auth variant substitutes a different toast + `lastSeen` for the API-hit flow.
10. **The `<form>` wraps the field body AND the `<SheetFooter>` together (Option A, Task 2).** Do NOT use Option B (the `useId()` + `form={id}` attribute on a detached button). Rationale: structural cleanliness; Enter-in-input and primary-button-click both route through the same `onSubmit` without an extra `onClick={onSubmit}` handler that would double-fire under StrictMode. The Option B variant is spec-legal (HTML5 `form` attribute on `<button>`) but introduces a second code path for submission, which is a regression waiting to happen in 3.6 when a second button is added (or the primary button becomes a loading spinner).

### Anti-Patterns to Avoid

- **Do NOT import Sheet primitives from `@radix-ui/*`.** This project uses Base UI. `@radix-ui/react-dialog` is NOT installed, and its API is not interchangeable with Base UI's `@base-ui/react/dialog`.
- **Do NOT mutate `MOCK_ANALYTICS.accessEntries` directly.** The fixture is `readonly as const`; TypeScript will error on a direct mutation, and the fixture must remain the same on page reload (no localStorage side-channel in 3.5). Spread into `useState`.
- **Do NOT mount `<Toaster>` inside `<SharePanel>`, inside `<DossierViewRoute>`, or inside any per-feature component.** The Toaster is a PORTAL — it mounts once at the app root ([apps/web/src/main.tsx](apps/web/src/main.tsx)). Multiple mounts cause duplicate toasts (one per mount point).
- **Do NOT call `toast()` from inside a `useEffect`.** The toast is an event-driven confirmation, not a render-driven side effect. Calling from a submit handler is correct; calling from `useEffect([entries])` would double-fire under StrictMode.
- **Do NOT pass `dismissible={false}` or `modal={false}` to the `<Sheet>` root.** The Sheet is a standard modal dialog — Escape / overlay / close-button all dismiss. Base UI Dialog's defaults match the UX spec.
- **Do NOT add a loading spinner or disabled state to the "Envoyer l'invitation" button during submit.** The submit is synchronous (local state mutation + toast enqueue). A loading spinner would imply async work — misleading in 3.5, correct in Epic 6 when the API hit lands. Revisit in 6.6.
- **Do NOT render `<AccessListRow>` inside the Sheet's mini-list.** The row's anatomy (32 px avatar + 22 px duration + Révoquer button) is too wide for 300 px and visually noisy. The simpler `<StatusDot /> + <span>email</span>` row per Pinned Decision #2 is the correct surface.
- **Do NOT recompute `MOCK_ANALYTICS.metrics` (the `2 / 7 / 4m 32s` values) when a pending entry is added.** The metrics are static copy in 3.5 — Epic 8 computes them from real session data. Leave the fixture untouched.
- **Do NOT add `confirm()` or an `<AlertDialog>` flow around the "Envoyer l'invitation" button.** The UX spec says "Single click, no confirmation dialog" (ux-design-specification.md:564, about revocation; same principle applies to non-destructive share flow). Submit is non-destructive and can be corrected by revoking the resulting access — no confirmation needed.
- **Do NOT add an `onCancel` or `onClose` prop to `<SharePanel>`.** Dismissal flows through `<Sheet>`'s `onOpenChange`. Adding panel-level dismissal props duplicates the state and invites drift.
- **Do NOT use `React.FormEvent` typed event handlers on the `<form>`.** React Hook Form's `handleSubmit(onValid)` returns a pre-typed `FormEventHandler<HTMLFormElement>`. Wrap as `<form onSubmit={handleSubmit(onValid)}>`. Do NOT write `<form onSubmit={(e: FormEvent) => { e.preventDefault(); ... }}>` — RHF already `preventDefault`s.
- **Do NOT hard-code the email lowercasing in `handleInvitationSubmit`.** The Zod schema's `.toLowerCase()` transform emits the already-lowercased string. Calling `.toLowerCase()` again is redundant and masks a future Zod-schema bug (if the transform is accidentally removed).
- **Do NOT rename `AccessStatus` / `AccessEntry` in `mock-analytics.ts`.** The 3.4 re-export convention at [apps/web/src/components/confluent/StatusDot.tsx:4](apps/web/src/components/confluent/StatusDot.tsx#L4) couples the consumer to `mock-analytics.ts`'s symbol names. Renaming would ripple to 3.4 (`StatusDot.tsx`, `AccessListRow.tsx`) with no gain.
- **Do NOT touch `router.tsx`, `app-shell.tsx`, `MetricCard.tsx`, `tabs.tsx`, `AccessListRow.tsx`, `StatusDot.tsx`, `mock-analytics.ts`, or any file outside the four listed in Task 1-3.** 3.5 is a purely additive share-panel layer on top of the already-extracted 3.4 components.

### Visual References

- UX spec anatomy: [ux-design-specification.md §Journey 1 Experience Mechanics (line 310-321)](../planning-artifacts/ux-design-specification.md#L310-L321), [§Design Direction D5 (line 394-418)](../planning-artifacts/ux-design-specification.md#L394-L418), [§SharePanel entry in Custom Components (line 627)](../planning-artifacts/ux-design-specification.md#L627), [§Form Label rule (line 669)](../planning-artifacts/ux-design-specification.md#L669), [§Feedback Patterns — Toast + Inline validation (line 653-671)](../planning-artifacts/ux-design-specification.md#L653-L671), [§Button Hierarchy (line 644-651)](../planning-artifacts/ux-design-specification.md#L644-L651).
- Epic AC: [epics.md §Story 3.5 (line 741-785)](../planning-artifacts/epics.md#L741-L785).
- D5 prototype reference: `ux-design-directions.html` D5 panel.
- Shadcn Sheet implementation: [apps/web/src/components/ui/sheet.tsx](apps/web/src/components/ui/sheet.tsx).
- Shadcn Sonner Toaster wrapper: [apps/web/src/components/ui/sonner.tsx](apps/web/src/components/ui/sonner.tsx).
- Shadcn Input / Label / Separator / Button primitives: [apps/web/src/components/ui/input.tsx](apps/web/src/components/ui/input.tsx), [apps/web/src/components/ui/label.tsx](apps/web/src/components/ui/label.tsx), [apps/web/src/components/ui/separator.tsx](apps/web/src/components/ui/separator.tsx), [apps/web/src/components/ui/button.tsx](apps/web/src/components/ui/button.tsx).
- Plain-useState form precedent to mirror for the inline-error region: [apps/web/src/routes/dashboard/dossiers/nouveau/index.tsx:33-77](apps/web/src/routes/dashboard/dossiers/nouveau/index.tsx#L33-L77).

### Latest Technical Information

- **React Hook Form v7.62.x** — stable `register` / `handleSubmit` / `formState` / `reset` APIs. No breaking changes since v7.0 (2021). `useForm({ resolver: zodResolver(schema), mode: 'onSubmit', defaultValues: ... })` is the canonical setup.
- **Zod v3.25.x** — the `.email()` validator accepts standard RFC 5321 addresses including `+` subaddressing (`marc+alias@fonds.fr`) and internationalized domains (`marc@investisseurs.fr` — no IDN issues). The `.trim()` + `.min(1)` + `.email()` + `.toLowerCase()` chain is order-sensitive: trim → check non-empty → check email-shape → lowercase. Putting `.min(1)` before `.email()` makes the "required" error fire first for empty input. Putting `.toLowerCase()` at the end makes the transform run last, after validation passes.
- **@hookform/resolvers v3.12.x** — the `zodResolver(schema)` adapter maps Zod errors to RHF's `formState.errors` shape. No per-field wiring needed beyond `register`.
- **Sonner v2.0.7** — the `toast.success(msg)` call is synchronous and returns a toast ID. The `<Toaster>` must be mounted for the call to render anything. Default position is `'bottom-right'` on desktop, `'top-center'` on mobile (Sonner detects viewport width). The project's `<Toaster>` wrapper at [apps/web/src/components/ui/sonner.tsx](apps/web/src/components/ui/sonner.tsx) does not override position — use Sonner's default.
- **Base UI Dialog (v1.4.x)** — auto-focus via the native `autoFocus` HTML attribute on the first focusable child works out-of-the-box. The Dialog's `initialFocus` prop exists for custom cases (e.g., focusing a "Skip" link instead of the first input). 3.5 uses native `autoFocus` per Pinned Decision #6.
- **Tailwind v4 arbitrary values** — `w-[300px]`, `sm:max-w-[300px]`, `duration-150` are all valid at the project's Tailwind version. The `cn()` helper from [apps/web/src/lib/utils.ts](apps/web/src/lib/utils.ts) wraps `tailwind-merge` which deduplicates conflicting utilities — when we pass `duration-150` and the primitive has `duration-200` baked in, `duration-150` wins.
- **React 19 StrictMode** — effects double-invoke; event handlers do NOT. The `autoFocus` attribute is picked up by Base UI at mount and does not refire on StrictMode's remount. Verified in 2.3 (`nouveau/index.tsx`) and 2.4 (questionnaire step) where `autoFocus` works without StrictMode regressions.
- **pnpm workspace filter** — `pnpm --filter @confluent/web add <pkg>` installs only in `apps/web`, not at the root. The package name `@confluent/web` matches [apps/web/package.json:2](apps/web/package.json#L2).

### Project Context Reference

No `project-context.md` file present in the repo (checked via glob at session start). The BMAD planning artifacts (`architecture.md`, `ux-design-specification.md`, `epics.md`, `prd.md`) are the authoritative context.

### References

- [Source: epics.md §Story 3.5 line 741-785]
- [Source: epics.md §Epic 3 scope line 199-202, 594-596]
- [Source: ux-design-specification.md §Journey 1 Experience Mechanics line 310-321]
- [Source: ux-design-specification.md §Design Direction D5 line 394-418]
- [Source: ux-design-specification.md §Component Implementation Strategy line 612-617]
- [Source: ux-design-specification.md §Custom Components line 625-629]
- [Source: ux-design-specification.md §Feedback Patterns line 653-671]
- [Source: ux-design-specification.md §Button Hierarchy line 644-651]
- [Source: architecture.md §Forms React Hook Form + Zod line 224-227]
- [Source: architecture.md §UI Components shadcn/ui CLI v4 line 219-222]
- [Source: architecture.md §Local UI State line 229]
- [Source: architecture.md §React Form Validation line 485-488]
- [Source: prd.md §FR16 line 414, §FR18 line 416, §NFR20-NFR23 line 495-498]
- [Source: Story 3.4 implementation at `_bmad-output/implementation-artifacts/3-4-access-list-row-status-dot-components.md` — `AccessEntry` union, `<AccessListRow>` + `<StatusDot>` contracts, single-commit memory preference]
- [Source: Story 2.3 implementation at `_bmad-output/implementation-artifacts/2-3-dossier-creation-naming-step.md` — plain-useState form pattern with `aria-live` inline-error region]
- [Source: Story 3.2 implementation — dossier header + Partager button]
- [Source: Story 1.2 implementation — design tokens (`--primary`, `--destructive`, `--muted-foreground`, `--border`, `--status-*`) already declared]

### Project Structure Notes

- No conflict with the unified project structure. `apps/web/src/components/confluent/` hosts design-system components; `apps/web/src/components/ui/` hosts shadcn primitives. `SharePanel.tsx` slots into `components/confluent/` alongside the six existing siblings with no path variance.
- The `features/sharing/` path from [architecture.md:662](../planning-artifacts/architecture.md#L662) is a FUTURE-STATE shape for Epic 8's real-API sharing — out of scope for 3.5. When 8.1 lands, `<SharePanel>` may migrate from `components/confluent/` to `features/sharing/components/` if it becomes sharing-feature-local and grows API-binding logic, but 3.5 keeps it in the design-system folder because the panel's surface is purely mocked.
- `packages/shared/src/schemas/` (per architecture.md:400) is the target destination for the `shareFormSchema` Zod schema once Epic 7 / 8 consolidate shared validation. 3.5 keeps the schema LOCAL to `SharePanel.tsx` — do NOT pre-extract to `packages/shared` without an API-side consumer; that premature extraction would invert the architecture.md rule ("single source of truth").

## Dev Agent Record

### Agent Model Used

claude-opus-4-7[1m]

### Debug Log References

- `pnpm --filter @confluent/web add react-hook-form zod @hookform/resolvers` → resolved versions: `react-hook-form ^7.73.1`, `zod ^4.3.6`, `@hookform/resolvers ^5.2.2`. All three are **newer than the AC10 target ranges** (`^7.62.x`, `^3.25.x`, `^3.12.x`) — the registry now ships Zod 4 and hookform-resolvers 5 as stable defaults. Typecheck + build both succeed; the `.trim().min(1).email().toLowerCase()` chain still resolves on `ZodString` in Zod 4 (verified at runtime via `node --input-type=module` smoke test — see Completion Notes for the Zod 4 behavioural delta versus Zod 3 that the AC implicitly assumed).
- `pnpm turbo run typecheck` → 2 successful, 0 errors. Zod's `z.infer<typeof shareFormSchema>` narrows to `{ email: string }`; `zodResolver(shareFormSchema)` satisfies RHF v7's `Resolver<ShareFormValues>` contract without casts. The `AccessEntry` discriminated union narrows cleanly inside `handleInvitationSubmit` — TS accepts the prepended `{ status: 'pending' }` literal without `revokedAt`.
- `pnpm turbo run lint` → 0 errors, 3 pre-existing warnings preserved (`badge.tsx:52`, `button.tsx:58`, `features/current-user/context.tsx:17`). `SharePanel.tsx` lints clean — named exports only, no default export, no `react-refresh/only-export-components` trip (the `shareFormSchema` + `ShareFormValues` module-scope symbols are types + a schema constant, not a React component, so react-refresh doesn't flag them).
- `pnpm turbo run build` → 2 successful. CSS bundle 47.72 kB (gz 9.20 kB; +0.27 kB vs 3.4 baseline). JS bundle 559.94 kB (gz 174.67 kB; **+53 kB gzipped vs 3.4's 121.30 kB**). The delta is larger than the story's `~+20 KB gzipped` estimate — Zod 4 is materially heavier than Zod 3 (tree-shakes less aggressively against the `.email()` regex constants), and RHF + the resolver also pull in their full runtime rather than the 20 KB slice the AC anticipated. Vite now emits a one-off `>500 kB chunk` advisory — not a regression (the threshold is advisory, not a build failure), but tracked as a deferred code-splitting concern; see Completion Notes.
- Grep sweep (AC15):
  - `#[0-9a-fA-F]{3,6}` across `SharePanel.tsx` + `[slug].tsx` + `main.tsx` → 0 matches.
  - `Partager le dossier|Entrez l'adresse email|Adresse email du destinataire|L'adresse email est requise|Format d'email invalide|Aucun destinataire|Destinataires existants` in `SharePanel.tsx` → 6 direct matches plus `Entrez l&apos;adresse email` (JSX-encoded — grep pattern matches the rendered form only when searched with the `&apos;` variant; verified via a second grep). Copy ownership is correct per Pinned Decision #9.
  - Same pattern in `[slug].tsx` → 0 matches (copy lives in `SharePanel.tsx` as mandated).
  - `Invitation envoyée` in `[slug].tsx` → 2 matches (line 132: `lastSeen` literal; line 137: `toast.success`) — per Pinned Decision #9.
  - `MOCK_ANALYTICS.accessEntries` in `[slug].tsx` → 1 match (line 80, the `useState` initializer spread). The `.map` at line 255 now renders from `accessEntries` local state.
  - `from 'sonner'` in `[slug].tsx` → 1 match (line 3, the `toast` import).
  - `Toaster` across `apps/web/src/` → 2 matches in `main.tsx` (line 5 import + line 15 JSX) + 3 matches in `components/ui/sonner.tsx` (primitive file). Single mount point confirmed.
- Zod 4 runtime smoke test (`node --input-type=module`):
  - `safeParse({ email: '  Marc@Fonds.FR  ' })` → `{ success: true, data: { email: 'marc@fonds.fr' } }` — trim + lowercase transforms work.
  - `safeParse({ email: '   ' })` → `{ success: false }` with **two issues** (`too_small` "required" + `invalid_format` "invalid"). Zod 4 no longer short-circuits the chain — both checks run. RHF with `criteriaMode: 'firstError'` (the default) surfaces only the first issue's message, so the UX still shows `"L'adresse email est requise."` on empty input as AC3 requires.
  - `safeParse({ email: 'not-an-email' })` → `{ success: false }` with one issue (`invalid_format` "invalid") — non-empty malformed input surfaces `"Format d'email invalide."` as AC3 requires.

### Completion Notes List

- **Zod 4 (not Zod 3) installed.** The story AC10 cited Zod `^3.25.x` as the target version but the pnpm registry resolved to Zod `^4.3.6` (the current latest stable). The `.trim().min(1).email().toLowerCase()` chain still works at the source level on `ZodString`. One behavioural delta vs Zod 3: the chain **does NOT short-circuit** — if the input fails `.min(1)`, the `.email()` check STILL runs and emits a second issue. The `@hookform/resolvers/zod` adapter + RHF's default `criteriaMode: 'firstError'` surfaces only the first issue per field, so the user-visible UX matches the AC exactly (empty → "L'adresse email est requise.", malformed → "Format d'email invalide."). Documented here for Epic 7's shared-schema migration — any schemas authored for the backend side will want to pin their expected issue-ordering behaviour.
- **Toaster mounted at the app root** inside `<CurrentUserProvider>`, before `<RouterProvider>` per AC9. `toast.success` is imported directly from `sonner` (not from `@/components/ui/sonner` — the primitive wrapper only exports the `<Toaster>` component; the `toast` function is a named export of the upstream `sonner` package).
- **Sheet primitive overrides applied via `<SheetContent className="w-[300px] duration-150 sm:max-w-[300px]">` (Pinned Decision #1).** `tailwind-merge` inside the primitive's `cn()` call dedupes the conflicting `w-3/4`, `sm:max-w-sm`, and `duration-200` utilities — the 300 px width and 150 ms transition take effect without modifying `sheet.tsx` itself.
- **Footer layout override `className="flex-col gap-2 p-4 sm:flex-row-reverse sm:justify-start"`.** Mobile stacks vertically (primary on top); `sm:` and up switches to horizontal-reversed so the primary "Envoyer l'invitation" button sits rightmost per UX spec §Button Hierarchy. The primitive's baked `mt-auto` is intentionally dropped (it would push the footer to the bottom of the 300 px Sheet, leaving a tall gap).
- **`<form>` wraps field body AND `<SheetFooter>` (Option A / Pinned Decision #10).** The `<Button type="submit">` is a direct form descendant — Enter-in-input and button-click both route through the same `onSubmit = handleSubmit(({ email }) => { onSubmitInvitation(email); reset() })`. NO `form={id}` attribute, NO `onClick` shim. `noValidate` on the `<form>` suppresses the browser's native HTML5 email-tooltip so the Zod error surface is the single source of truth.
- **Annuler button wired via `<SheetClose render={<Button ... />}>Annuler</SheetClose>`** — the render prop receives a self-closing Button, the Annuler text is the SheetClose's child, and Base UI slot-merges it into the rendered Button. Matches the project's close-button recipe at sheet.tsx:63-75.
- **`accessEntries` lifted to component-local `useState` in `[slug].tsx`.** `MOCK_ANALYTICS.accessEntries` is readonly; the initializer spreads the array (`() => [...MOCK_ANALYTICS.accessEntries]`) so `setAccessEntries` can prepend pending entries. The `MetricCard` grid at `[slug].tsx:234-242` still reads `MOCK_ANALYTICS.metrics` (static copy — Epic 8 will compute these from real data per the 3.4 precedent). This split (local state for rows, static fixture for metrics) matches AC16's no-regression requirement.
- **`deriveInitials` is module-scope in `[slug].tsx`** — pure, synchronous, no side effects. Handles four cases: ≥2 alpha (first two uppercased), exactly 1 alpha (padded with `·`), 0 alpha (`··`), and empty local-part (`··`). Kept module-local (not exported) because the only caller is `handleInvitationSubmit` in the same file.
- **`autoFocus` via native HTML attribute** on the email `<Input>` (Pinned Decision #6) — no `useRef` + `useEffect` recipe. Base UI's Dialog focus trap composes with the native attribute on open. Verified declaratively; behaviour will be confirmed via interactive walkthrough in the code-review phase.
- **`autoComplete="email"`** on the input so password managers + keyboard suggestion chrome can prefill the field.
- **`aria-required="true"` + conditional `aria-invalid` + conditional `aria-describedby`** expose the validation state to AT. The error `<p>` has `id="share-email-error"` so the `aria-describedby` link resolves when the error is present and is cleared when it isn't.
- **Inline-error region uses `aria-live="assertive"` + `aria-atomic="true"` + `min-h-[1em]`** — same recipe as `nouveau/index.tsx:57-67` (Story 2.3). `min-h-[1em]` reserves the space even when the error is absent to prevent layout shift.
- **Mini-list uses the simpler `<StatusDot /> + <span>email</span>` row (Pinned Decision #2)** — NOT full `<AccessListRow>` instances. Matches the Epic AC's "StatusDot + email on one line". The 300 px Sheet width would clip the AccessListRow's avatar + 22 px duration + Révoquer button.
- **Manual browser walkthrough skipped in harness (no interactive browser available).** The visual regression risk is bounded: Sheet + Input + Button + Separator + Label + SheetClose primitives are all pre-existing from the shadcn base; Toaster was already configured in `components/ui/sonner.tsx` (Story 1.2); `AccessListRow` + `StatusDot` are unchanged from 3.4. Structural correctness is covered by typecheck + lint + build + the 8-pattern grep sweep. Interactive checks (Sheet transition 150 ms, 300 px width at 320 px viewport, toast bottom-right, Escape/overlay/Cancel/X dismissal parity, focus trap cycle, `prefers-reduced-motion` degradation) are scoped to the code-review layer.
- **Deferred to a follow-up:** Vite's new `>500 kB chunk` advisory (triggered by the RHF + Zod 4 + resolver addition). Code-splitting via dynamic `import()` of `SharePanel.tsx` + a route-level `React.lazy` boundary is the cleanest fix but is structurally out of scope for 3.5. Epic 10 (deployment) or the first production-readiness pass is the natural home for the split. NOT blocking 3.5.
- **No new deferred-work.md entries.** The 3.4 deferrals (StatusDot runtime typeguard, title-on-touch tooltip) are unchanged. The Vite chunk-size advisory is documented here, not as a formal deferred-work entry, because it is a tooling-level advisory rather than an AC miss.
- **Commit strategy: single bundled commit** per user memory preference (`Code + review in a single commit`, 2026-04-20). The `/bmad-code-review` step will produce the `feat(epic-3): story 3.5 — Share panel (D5) with Sheet component` commit after review patches (if any) are applied.

### File List

- apps/web/src/components/confluent/SharePanel.tsx (new)
- apps/web/src/routes/dashboard/dossiers/[slug].tsx (modified — added imports: `useState`, `toast`, `Sheet`/`SheetTrigger`, `SharePanel`, `type AccessEntry`; added `deriveInitials` module-scope helper; added `shareOpen`/`accessEntries` `useState` hooks; added `handleInvitationSubmit`; wrapped Partager button in `<Sheet>` + `<SheetTrigger>` + `<SharePanel>`; swapped analytics list source from `MOCK_ANALYTICS.accessEntries` to `accessEntries`)
- apps/web/src/main.tsx (modified — imported `Toaster` from `@/components/ui/sonner`, mounted `<Toaster />` inside `<CurrentUserProvider>` before `<RouterProvider>`)
- apps/web/package.json (modified — `+react-hook-form ^7.73.1`, `+zod ^4.3.6`, `+@hookform/resolvers ^5.2.2`)
- pnpm-lock.yaml (modified — three new deps + their transitives)
- _bmad-output/implementation-artifacts/3-5-share-panel-d5-sheet-component.md (story progress)
- _bmad-output/implementation-artifacts/sprint-status.yaml (status: ready-for-dev → in-progress → review)

### Change Log

| Date | Change | Author |
|---|---|---|
| 2026-04-22 | Story 3.5 implementation — D5 share panel with shadcn Sheet (300 px, 150 ms), React Hook Form + Zod 4 + @hookform/resolvers form validation, Sonner toast mounted app-wide, local accessEntries state with prepended pending entry, deriveInitials helper, copy owned by SharePanel.tsx. | claude-opus-4-7[1m] |
