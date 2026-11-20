# Story 2.3: Dossier Creation — Naming Step

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an entrepreneur,
I want to give my dossier a name before answering any questions,
so that my project is clearly identified from the start.

## Acceptance Criteria

1. **Given** the user navigates to `/dashboard/dossiers/nouveau` (the destination of the Story 2.2 empty-state CTA), **When** the page renders, **Then** a single-field form is displayed containing: a visible label "Comment s'appelle votre projet ?", a bottom-border-only text input (no box border; only a 1px bottom border in `border-border` / `#E8E8E7`, growing to `border-foreground` / `#37352F` on focus — no focus ring outline, the border *is* the focus indicator), a primary button "Commencer →", and a sub-label hint "Vous pourrez modifier ce nom plus tard." rendered in `text-sm text-muted-foreground` below the input and above the button.

2. **Given** the naming form, **When** the user submits with an empty or whitespace-only input (by clicking "Commencer →" or pressing Enter), **Then** an inline validation message "Le nom du projet est requis." appears below the input in `text-xs text-destructive`, the input receives `aria-invalid="true"` + `aria-describedby` wired to the error message, and navigation does NOT proceed. The error clears the moment the user begins typing a non-empty value.

3. **Given** the naming form with a non-empty trimmed value, **When** the user presses Enter inside the input OR clicks "Commencer →", **Then** the trimmed name is persisted via `localStorage.setItem('confluent_draft_name', trimmedName)` and the router navigates to `/dashboard/dossiers/nouveau/questionnaire`.

4. **Given** the user is on the naming step page (`/dashboard/dossiers/nouveau`) OR the questionnaire stub (`/dashboard/dossiers/nouveau/questionnaire`), **When** the shell renders, **Then** NO breadcrumb is shown — these are wizard-flow steps, not hierarchical navigation surfaces. The suppression is driven by a `handle: { hideBreadcrumb: true }` marker on the wizard routes, consumed by `Breadcrumbs` via `useMatches()`.

5. **Given** the naming input, **When** the page loads (first render), **Then** focus is automatically placed on the input via the `autoFocus` attribute so the user can type immediately without clicking.

6. **Given** the naming input, **When** the user pastes or types a name with leading/trailing whitespace, **Then** the value is trimmed at submit time (not on keypress) before validation and persistence. A whitespace-only value is treated as empty by AC2.

7. **Given** the naming step page, **When** viewed on mobile (<768px), **Then** content stacks vertically, the input is full-width within a readable `max-w-md` column centered inside `<main>`, the primary "Commencer →" button has a 44×44 minimum tap target (`h-11 px-4`, same fix as Story 2.2 code-review), and no element overflows the viewport.

## Tasks / Subtasks

- [x] Task 1: Create the reusable `WizardInput` primitive (AC: 1)
  - [x] Create `apps/web/src/components/confluent/WizardInput.tsx`. Export a named component `WizardInput`. No default export (confluent/ convention set by Story 2.2).
  - [x] Props contract exactly:
    ```ts
    export interface WizardInputProps extends Omit<ComponentProps<'input'>, 'type' | 'className'> {
      className?: string;
    }
    ```
    No `type` override — this input is always `type="text"` (no email/password/etc variants in the wizard). Forward every other native input prop (`value`, `onChange`, `placeholder`, `autoFocus`, `aria-*`, `onKeyDown`, etc.) via `{...rest}`.
  - [x] Render a native `<input type="text" />` — do NOT wrap `InputPrimitive` from `@base-ui/react/input` for this component; the bottom-border styling is a plain CSS affair and the Base UI wrapper adds no value here. Keep the element simple and predictable.
  - [x] Styling (use `cn()` from `@/lib/utils`):
    ```
    'w-full bg-transparent border-0 border-b border-border text-lg py-2 outline-none transition-colors
     placeholder:text-muted-foreground
     focus:border-foreground focus-visible:border-foreground
     aria-[invalid=true]:border-destructive'
    ```
    - `border-0 border-b`: kills the default box border on all sides; only the bottom border remains.
    - `border-border`/`border-foreground` use design tokens (no raw `#E8E8E7` / `#37352F`).
    - `text-lg` ≈ 18px (spec UX-DR2 for QuestionnaireStep input is "18px"; the naming step mirrors that styling per Story 2.4 AC "consistent with Story 2.3 styling").
    - `outline-none` removes the browser default — the border color shift IS the focus indicator, per spec AC1. Do NOT add a separate focus ring; that would conflict with the bottom-border visual pattern.
    - `aria-[invalid=true]:border-destructive` turns the underline red when the parent sets `aria-invalid="true"` (AC2).
  - [x] Do NOT import the shadcn `Input` from `components/ui/input.tsx` — that has a full box border, padding, and focus ring that clash with the wizard style.

- [x] Task 2: Add the `handle: { hideBreadcrumb: true }` mechanism (AC: 4)
  - [x] Modify `apps/web/src/components/layout/Breadcrumbs.tsx`.
  - [x] Import `useMatches` from `react-router-dom`.
  - [x] Declare a tiny type at the top of the file:
    ```ts
    type RouteHandle = { hideBreadcrumb?: boolean } | undefined
    ```
  - [x] In the component body, *before* the `segments.length < 2` early-return, add:
    ```ts
    const matches = useMatches()
    const suppressed = matches.some((m) => (m.handle as RouteHandle)?.hideBreadcrumb === true)
    if (suppressed) return null
    ```
  - [x] Do NOT add a hardcoded path-prefix list — the handle pattern is idiomatic React Router v7 and keeps wizard-step identification colocated with route declarations.
  - [x] Do NOT touch the depth-based `segments.length < 2` check — top-level routes (`/dashboard`) still correctly render nothing; the handle check only adds a second reason to hide.

- [x] Task 3: Restructure the `dashboard/dossiers/nouveau` route into a folder (AC: 1, 3)
  - [x] Delete `apps/web/src/routes/dashboard/dossiers/nouveau.tsx` (the 3-line stub from Story 2.2).
  - [x] Create `apps/web/src/routes/dashboard/dossiers/nouveau/index.tsx` — the naming-step form.
    - Default export `DossierNewRoute` (routes use default exports per Story 2.1/2.2 convention).
    - Declarative `<title>Nouveau dossier · Confluent</title>` — mirror the pattern from `dashboard/index.tsx`.
    - Local state: `const [name, setName] = useState('')` + `const [showError, setShowError] = useState(false)`.
    - Custom handler:
      ```tsx
      function handleSubmit(e: FormEvent<HTMLFormElement>) {
        e.preventDefault()
        const trimmed = name.trim()
        if (!trimmed) { setShowError(true); return }
        localStorage.setItem('confluent_draft_name', trimmed)
        navigate('/dashboard/dossiers/nouveau/questionnaire')
      }
      ```
    - Render a `<form onSubmit={handleSubmit}>` containing (in order):
      1. `<label htmlFor="dossier-name" className="text-2xl font-heading font-medium text-foreground">Comment s'appelle votre projet ?</label>`
      2. `<WizardInput id="dossier-name" value={name} onChange={…} autoFocus aria-invalid={showError || undefined} aria-describedby={showError ? 'dossier-name-error' : undefined} />`
      3. Error region — always in the DOM when `showError`, never rendered otherwise: `{showError && <p id="dossier-name-error" role="alert" className="text-xs text-destructive">Le nom du projet est requis.</p>}`
      4. Hint sub-label: `<p className="text-sm text-muted-foreground">Vous pourrez modifier ce nom plus tard.</p>`
      5. `<Button size="lg" type="submit" className="h-11 px-4 self-start">Commencer →</Button>`
    - Outer container: `<div className="mx-auto flex max-w-md flex-col gap-6 pt-8">...</div>` — centered column, airy top padding, consistent 24px (`gap-6`) rhythm between label/input/hint/button.
    - The `onChange` handler MUST also clear the error if one is showing:
      ```tsx
      onChange={(e) => { setName(e.target.value); if (showError) setShowError(false); }}
      ```
      This satisfies AC2's "The error clears the moment the user begins typing a non-empty value" — checking non-empty isn't necessary because we clear on any keystroke (more forgiving).
  - [x] Create `apps/web/src/routes/dashboard/dossiers/nouveau/questionnaire.tsx` — a stub for Story 2.4:
    ```tsx
    export default function QuestionnaireRoute() {
      return (
        <>
          <title>Questionnaire · Confluent</title>
          <h1 className="text-2xl font-heading font-medium">Questionnaire</h1>
        </>
      )
    }
    ```
    Mirror the tableau-de-bord/nouveau-stub pattern: the real QuestionnaireStep component lands in Story 2.4. Without the stub, the Story 2.3 AC3 navigation lands on the nested 404.

- [x] Task 4: Update `router.tsx` — path moves, add questionnaire stub, add handle markers (AC: 3, 4)
  - [x] Import both routes: `import DossierNewRoute from '@/routes/dashboard/dossiers/nouveau'` (the folder's `index.tsx` resolves automatically), and `import QuestionnaireRoute from '@/routes/dashboard/dossiers/nouveau/questionnaire'`.
  - [x] Replace the existing `{ path: 'dashboard/dossiers/nouveau', element: <DossierNewRoute /> }` with two entries and a handle marker:
    ```ts
    { path: 'dashboard/dossiers/nouveau', element: <DossierNewRoute />, handle: { hideBreadcrumb: true } },
    { path: 'dashboard/dossiers/nouveau/questionnaire', element: <QuestionnaireRoute />, handle: { hideBreadcrumb: true } },
    ```
  - [x] Keep the `{ path: 'dashboard/dossiers', element: <Navigate to="/dashboard" replace /> }` entry that was added during Story 2.2 code review — it still serves the `/dashboard/dossiers/:slug` tree when users manually visit the parent path. Do NOT add `handle: { hideBreadcrumb: true }` to it because it's a redirect, not a rendered page.
  - [x] Verify that `{ path: '*', element: <NotFoundRoute /> }` remains the LAST child of `AppShell` (ordering invariant from Story 2.1 + 2.2).
  - [x] Imports ordering: keep alphabetical-within-group unless a specific ordering already exists — follow what's already there.

- [x] Task 5: Accessibility verification (AC: 2, 4, 5)
  - [x] The `<label htmlFor="dossier-name">` + `<WizardInput id="dossier-name">` wiring is semantic — screen readers announce the label when the input gains focus.
  - [x] Error region uses `role="alert"` so assistive tech announces the validation message without user interaction — AND `aria-describedby="dossier-name-error"` on the input links error to input for SR description.
  - [x] `aria-invalid={showError || undefined}` — the `|| undefined` is intentional so the attribute is removed (not just set to `false`) when there is no error, avoiding "invalid but no error announcement" ambiguity.
  - [x] `autoFocus` — acceptable on this surface because it is a single-purpose wizard step with only ONE meaningful action; no competing focus target. Do NOT add `autoFocus` to competing elements; label is a `<label>` and not focusable.
  - [x] The button is a semantic `<Button type="submit">` — Enter within the form triggers submit natively via the browser; no custom `onKeyDown` needed to satisfy AC3.
  - [x] No breadcrumb renders on the naming step or questionnaire stub — verify via DOM inspection / axe.
  - [x] Run `axe` on `/dashboard/dossiers/nouveau` (naming step with AND without error) — zero violations required.

- [x] Task 6: Responsive verification (AC: 7)
  - [x] 375px mobile: form stacks naturally (flex-col), input full-width, button 44×44 reachable, no horizontal scroll. `autoFocus` triggers the keyboard on mobile — expected, matches Typeform pattern.
  - [x] 900px tablet: centered column `max-w-md`, ~448px wide, airy.
  - [x] 1440px desktop: same centered column, abundant whitespace around.
  - [x] Verify the bottom-border input renders crisply at each DPR — no sub-pixel border loss.

- [x] Task 7: Verify the full pipeline (AC: 1-7)
  - [x] `pnpm turbo run typecheck` → expect 2 successful, 0 errors.
  - [x] `pnpm turbo run lint` → 0 errors. Same 3 pre-existing warnings tolerated (badge, button, current-user). Zero new warnings.
  - [x] `pnpm turbo run build` → 2 successful, 0 errors. Bundle delta vs Story 2.2 baseline expected to be small (~+1-3 kB gzip JS from new component + new route + new handler).
  - [x] `pnpm turbo run dev` → manual walkthrough:
    1. Navigate `/dashboard`.
    2. Click "Créer un dossier" CTA → lands on `/dashboard/dossiers/nouveau` with input auto-focused, no breadcrumb visible, sidebar "Mes dossiers" no longer active (expected regression, deferred in 2.2 code review).
    3. Submit empty → error "Le nom du projet est requis." appears; input gains red underline via `aria-[invalid=true]:border-destructive`; no navigation.
    4. Type "Biosensio" → error disappears; press Enter → navigates to `/dashboard/dossiers/nouveau/questionnaire` (stub). Verify `localStorage.getItem('confluent_draft_name') === 'Biosensio'` via DevTools.
    5. Paste "  Biosensio  " (whitespace-padded) → submit → stored value is trimmed `"Biosensio"`.
    6. Navigate to `/dashboard/dossiers/biosensio` manually (no such route yet) — verify nested 404 inside the shell, and verify the breadcrumb DOES render on that path (it is not a wizard step; it will become a real dossier view in Story 2.6 / 3.2).

### Review Findings

Code review date: 2026-04-20. Three adversarial layers: Blind Hunter, Edge Case Hunter, Acceptance Auditor. ~50 raw findings → 6 patches, 5 defers, 28 dismissed (spec-pinned or noise). All decision-needed resolved.

**Patches (to apply):**

- [x] [Review][Patch] Add a guard on `/dashboard/dossiers/nouveau/questionnaire` that redirects to `/dashboard/dossiers/nouveau` when `localStorage.getItem('confluent_draft_name')` is missing — protects the wizard precondition for Story 2.4 [apps/web/src/routes/dashboard/dossiers/nouveau/questionnaire.tsx]
- [x] [Review][Patch] Add `maxLength={120}` to the naming input and document the single-line/multiline input length convention in `ux-design-specification.md#Form Patterns` (120 chars single-line, 2000 chars multiline baseline, per-field overrides allowed) [apps/web/src/components/confluent/WizardInput.tsx, _bmad-output/planning-artifacts/ux-design-specification.md]
- [x] [Review][Patch] Rehydrate the naming input from `localStorage` on mount — `useState(() => localStorage.getItem('confluent_draft_name') ?? '')` so back-navigation does not lose the draft [apps/web/src/routes/dashboard/dossiers/nouveau/index.tsx]
- [x] [Review][Patch] Wrap the inline error in a persistent `aria-live="assertive" aria-atomic="true"` container (always in the DOM, text swaps inside) so repeat empty-submit re-announces to screen readers [apps/web/src/routes/dashboard/dossiers/nouveau/index.tsx]
- [x] [Review][Patch] Create `apps/web/src/lib/sanitize.ts` exporting `stripNonPrintable(str)` that strips zero-width, soft-hyphen, RTL override, NUL, and other C0 controls; call it at submit time before the `.trim()` empty-check. Story 2.4 will reuse it for questionnaire answers [apps/web/src/lib/sanitize.ts, apps/web/src/routes/dashboard/dossiers/nouveau/index.tsx]
- [x] [Review][Patch] Refocus the naming input after a validation error (forwarded ref on `WizardInput` → `useRef` in the form → `inputRef.current?.focus()` after `setShowError(true)`) — WCAG recommends focus-on-first-invalid-field on submit failure [apps/web/src/components/confluent/WizardInput.tsx, apps/web/src/routes/dashboard/dossiers/nouveau/index.tsx]

**Deferred (acknowledged, not actionable now):**

- [x] [Review][Defer] Concurrent tabs stomp `confluent_draft_name` (same key, no per-tab scope) — deferred, Epic 7 real API will solve naturally.
- [x] [Review][Defer] Breadcrumb `handle` suppression has no "child un-suppresses parent" semantics; only `hideBreadcrumb === true` wins. Deferred — no concrete future route requires the inverse direction yet.
- [x] [Review][Defer] `RouteHandle` cast in `Breadcrumbs.tsx` trusts `useMatches` output shape; a non-object `handle` would silently no-op. Deferred — spec explicitly pinned this exact cast pattern; a runtime shape-check is pure type-safety polish.
- [x] [Review][Defer] Wizard step has no in-page cancel / back affordance (breadcrumb suppressed + no button) — user must rely on the browser back button. Deferred — UX decision outside the story's scope; revisit when Epic 2 ships and real user feedback arrives.
- [x] [Review][Defer] Cleanup of `confluent_draft_name` (TTL, clear-on-success, clear-on-revisit) — deferred to Story 2.6 (dossier completion screen), which will call `localStorage.removeItem` once the full creation flow lands end-to-end. Track explicitly in 2.6's context.

**Dismissed (spec-pinned, out-of-scope, or noise):** localStorage try/catch (spec: not needed), SSR safety (non-SSR app), `WizardInput` type lock (spec pinned #1), `className` Omit+redeclare (spec explicit), `autoFocus` concerns (spec pinned, "acceptable"), `aria-invalid || undefined` (spec pinned #8), no unit tests (Epic 2 out-of-scope), `<title>` inline (React 19 supports), `useMatches` perf (premature), URL normalization, magic-string localStorage key (spec pinned #3), `showError` not derived, deleted stub HMR (dev-only edge), arrow glyph RTL/SR (spec-pinned Unicode char), narrow nbsp vs U+202F (spec explicit `&nbsp;`), double-submit race (`navigate` idempotent), two `<title>` during transition (React 19 handles), `defaultValue + value`, `noValidate` without `required` (SPA), outer `<div>` vs `<form>` wrapper (semantically equivalent), Tailwind class ordering (cosmetic), whitespace-keystroke clears error (spec rationalized), IME composition (French-first app, accepted).

## Dev Notes

### Critical Architecture Constraints

- **Confluent custom components live in `components/confluent/`** — `WizardInput` is the second tenant (after `EmptyState`). Do NOT place it in `components/ui/` (shadcn) or `components/layout/`. [Source: ux-design-specification.md#Component Implementation Strategy, 2-2-dashboard-empty-state.md#Pinned Decision #1]
- **Design tokens only — never raw hex.** `border-border`, `border-foreground`, `text-muted-foreground`, `text-destructive`. The #E8E8E7 / #37352F hexes the epic AC mentions are the *values* of these tokens, not the literals to type. [Source: apps/web/src/index.css, 2-1/2-2 review findings]
- **shadcn `Button` does NOT support `asChild`** — for type="submit" use `<Button type="submit">...`, which works because base-ui's Button forwards native button props. Do NOT try `<Button asChild><button type="submit">...</button></Button>`. [Source: 2-1-app-shell-sidebar-layout.md#Previous Story Intelligence]
- **React Router v7 library mode.** `useNavigate` and `useMatches` both import from `react-router-dom`. The `handle` property on a route object is an arbitrary user-defined opaque value accessible via `useMatches()[i].handle` — type it as `unknown` on read and narrow with a type guard. [Source: architecture.md#Frontend Architecture, react-router-dom@7 docs]
- **No React Hook Form, no Zod schemas in this story.** The naming form has one field and one validation rule (non-empty after trim). `useState` + a synchronous check is strictly less code than any form library. Form libraries land in Story 2.4 ONLY if the questionnaire's dynamic fields need them — and given the questionnaire's single-question-per-step model, even 2.4 likely won't require a form library. Revisit at Epic 7 when real backend validation and schema-driven forms arrive. [Source: architecture.md#Frontend Architecture ("Forms: React Hook Form + Zod resolvers"), but architecture also notes that feature applies to the *dynamic admin-driven* questionnaire in Epic 7, not the static hardcoded Epic 2 version]
- **localStorage is the single persistence layer for Epic 2.** Keys: `confluent_draft_name` (this story), `confluent_draft_{name}` (Story 2.4 for answers). Do NOT introduce `sessionStorage`, a React context, a Zustand store, or an `IndexedDB` wrapper. Simple, direct, swap-ready for real API in Epic 7. [Source: epics.md#Epic 2 ("Zero API calls — all state lives in React (with localStorage for simulated auto-save)")]
- **French copy, hardcoded in JSX.** Strings: "Comment s'appelle votre projet ?" (label), "Commencer →" (CTA — arrow is the literal "→" Unicode char U+2192, NOT an icon), "Vous pourrez modifier ce nom plus tard." (hint), "Le nom du projet est requis." (error), "Nouveau dossier · Confluent" (page title), "Questionnaire · Confluent" (stub page title), "Questionnaire" (stub H1). No i18n setup. [Source: 2-1/2-2 anti-patterns]
- **WCAG 2.1 AA baseline.** Label/input pairing via `htmlFor` + `id`. `role="alert"` + `aria-describedby` for the error. Submit button at `h-11` (44px) per the Story 2.2 code-review patch. No focus-ring on the wizard input — the bottom-border color shift is the focus indicator per spec AC1. This is a spec-allowed deviation from the "visible focus ring" baseline on THIS specific input style; other interactive elements on the page (button) keep the standard ring. [Source: ux-design-specification.md#Accessibility, UX-DR14]

### Design Tokens to Use

| Surface | Tailwind utility | Value | Where |
|---|---|---|---|
| Input default underline | `border-border` | `#E8E8E7` | WizardInput bottom border at rest |
| Input focus underline | `border-foreground` (via `focus:border-foreground`) | `#37352F` | WizardInput bottom border when focused |
| Input invalid underline | `border-destructive` (via `aria-[invalid=true]:border-destructive`) | `#E57373` | WizardInput bottom border when error present |
| Placeholder color | `text-muted-foreground` via `placeholder:text-muted-foreground` | `#6B6B6B` | WizardInput placeholder text (none used today, but future-proof) |
| Label heading font | `font-heading font-medium` | Inter | Top-level question-style label |
| Hint sub-label | `text-sm text-muted-foreground` | 14px / `#6B6B6B` | "Vous pourrez modifier ce nom plus tard." |
| Error text | `text-xs text-destructive` | 12px / `#E57373` | "Le nom du projet est requis." |
| Button primary | `bg-primary text-primary-foreground` (via Button default variant) | `#37352F` / white | "Commencer →" CTA |
| Button tap target | `h-11 px-4` | 44px tall | WCAG 2.1 AA touch target (Story 2.2 review pattern) |

### Component Prop Contract (exhaustive)

```ts
// apps/web/src/components/confluent/WizardInput.tsx
export interface WizardInputProps
  extends Omit<ComponentProps<'input'>, 'type' | 'className'> {
  className?: string;
}
```

- `type` is omitted from the contract — this component is hardcoded to `type="text"`. A future "WizardNumber" or "WizardEmail" would be a sibling component, not a `type`-prop variant.
- `className` is explicitly re-declared so `cn()` handles overrides correctly (e.g., Story 2.4 may pass `className="text-[28px]"` to bump up the questionnaire question input).
- The `Omit` is critical: forgetting it would let callers accidentally pass `type="password"` through and get a bottom-border password field, which is semantically wrong.

### File Layout (target)

```
apps/web/src/
├── components/
│   ├── confluent/
│   │   ├── EmptyState.tsx                           [UNCHANGED]
│   │   ├── WizardInput.tsx                          [NEW — underline input primitive]
│   │   └── illustrations/
│   │       └── EmptyDossiersIllustration.tsx       [UNCHANGED]
│   └── layout/
│       └── Breadcrumbs.tsx                          [MODIFIED — useMatches() + handle.hideBreadcrumb check]
├── routes/
│   └── dashboard/
│       └── dossiers/
│           ├── nouveau.tsx                          [DELETED — replaced by folder]
│           └── nouveau/                             [NEW FOLDER]
│               ├── index.tsx                        [NEW — naming step form (replaces deleted stub)]
│               └── questionnaire.tsx                [NEW — 3-line stub for Story 2.4]
└── router.tsx                                       [MODIFIED — folder import, 2 handle markers, add questionnaire child]
```

### Previous Story Intelligence

**From Story 2.2 (just landed):**
- `/dashboard/dossiers` (parent of `nouveau`) now has a `Navigate to="/dashboard" replace` redirect route, added during Story 2.2 code review. Keep it intact — it prevents the intermediate breadcrumb link from 404ing.
- `SEGMENT_LABELS` in `Breadcrumbs.tsx` now includes `nouveau: 'Nouveau'`. This story hides the breadcrumb on wizard steps entirely via the `handle` mechanism, so the `nouveau` label only renders on non-wizard paths (future edit/view routes under `dashboard/dossiers/...`). No change needed.
- `EmptyState` + `EmptyDossiersIllustration` establish the `components/confluent/` directory — `WizardInput` is the second resident.
- Pinned decision from 2.2 #6 ("No `cva` variant system yet") carries over: do not wrap `WizardInput` in `cva` — one caller ships now, the Story 2.4 caller is the second, introduce variants only when a third caller diverges.
- Code-review patch: CTA uses `<Button size="lg" className="h-11 px-4">`. Reuse the exact same recipe here for "Commencer →" — do NOT invent a new button sizing.

**From Story 2.1 (app shell):**
- `AppShell` mounts `<main id="main-content" tabIndex={-1}>` with `focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--ring)]`. Wizard step renders inside this container — no need to rewrap.
- `Breadcrumbs` renders INSIDE `<main>` above `<Outlet />` — adding `useMatches` + handle check suppresses the trail before it ever enters the DOM.
- Skip link "Aller au contenu principal" is the first focusable element. Tab order on `/dashboard/dossiers/nouveau`: SkipLink → Sidebar nav items → (no breadcrumb) → Input (autoFocused initially; tab still traverses) → "Commencer →" button. The autofocus lands on input immediately so the user can type, but keyboard users can still Shift+Tab back up the tree.

**Deferred from Story 2.2 code review (still open):**
- Sidebar "Mes dossiers" loses `aria-current="page"` on `/dashboard/dossiers/nouveau` because `end: true` on the nav item. This story DOES reach that path. Do NOT fix here — the deferral reason was "revisit sidebar-activation semantics in 2.3 when wizard routes land". **Decision for 2.3:** wizard steps SHOULD be sidebar-less contextually (Typeform focus), so the sidebar deactivation is arguably correct behaviour for a wizard. Leave as-is — document in Completion Notes as a deliberate non-fix. If the user raises it during review, loosen `end: true` into a `className` callback matching `/dashboard` OR `/dashboard/dossiers/*`.
- SVG illustration zoom (EmptyDossiersIllustration) — not touched by this story.
- EmptyState CTA-less layout imbalance — not triggered by this story (always renders with CTA).

### Git Intelligence

Recent commits on `feat/epic-1` (reverse chronological):

1. `f8442b6 fix(epic-2): story 2.2 code-review patches` — most recent. Added `/dashboard/dossiers` redirect, `nouveau: 'Nouveau'` breadcrumb label, CTA h-11, removed `[&>svg]:mx-auto`.
2. `a38e7b2 feat(epic-2): story 2.2 — dashboard empty state` — added `components/confluent/` directory with `EmptyState` + `EmptyDossiersIllustration` + `dashboard/dossiers/nouveau.tsx` stub.
3. `7b4be2e feat(epic-2): story 2.1 — app shell, responsive sidebar, breadcrumbs` — added `Breadcrumbs` with `SEGMENT_LABELS` + `useLocation`-based rendering.

Pattern: one commit per story (`feat(epic-N): story N.M — <title>`), followed by a code-review patches commit (`fix(epic-N): story N.M code-review patches`). Keep this pattern. Story 2.3 should land as `feat(epic-2): story 2.3 — dossier creation naming step`.

### Anti-Patterns to Avoid

- **Do NOT reuse the shadcn `Input` component.** Its full box border, rounded corners, and focus ring conflict with the wizard underline style. `WizardInput` is a new primitive, not a variant of `Input`.
- **Do NOT add React Hook Form + Zod for a single-field form.** Pure `useState` + trim check. Form libraries arrive naturally in Epic 7 when dynamic fields + backend-schema validation become real constraints.
- **Do NOT persist the name in a React context or a Zustand store.** `localStorage.setItem('confluent_draft_name', …)` is the ONE persistence mechanism for Epic 2. Story 2.4 reads the same key.
- **Do NOT trim the value inside `onChange`.** Trim at submit time only — trimming during typing is a WCAG friction (deletes spaces the user is about to complete) and an unusual UX.
- **Do NOT show the error while the user is typing.** Error appears at submit time; clears the moment the user keeps typing (any keystroke clears). This matches the UX spec's "Validate on blur, not on keypress" principle applied to submit-time feedback.
- **Do NOT add a visible focus ring on `WizardInput`.** The AC explicitly says "growing to `#37352F` on focus" — the border IS the focus indicator. A separate ring would visually double up.
- **Do NOT hardcode hex values.** `#E8E8E7` and `#37352F` are the values of `border` and `foreground`/`ring` tokens. Always consume via Tailwind utility classes.
- **Do NOT introduce a `DossierDraftContext` or `useDossierDraft()` hook in this story.** Inline `localStorage` calls. Story 2.4 can extract a helper module if needed, but until a second caller emerges the abstraction is premature.
- **Do NOT rename `nouveau` to `new` / `create` / `draft`.** The route path is French-first (matches sidebar label language); renaming would break external links (even if no external deep-links exist yet, the principle holds).
- **Do NOT add a hardcoded list of wizard path prefixes in Breadcrumbs.** Use the `handle: { hideBreadcrumb: true }` pattern via `useMatches()`. The handle approach localises the wizard-flag with the route itself; a path-prefix list rots as routes are renamed.
- **Do NOT suppress the breadcrumb globally on `/dashboard/dossiers/*`.** Only the wizard steps (`nouveau`, `nouveau/questionnaire`) hide it; the future dossier view at `/dashboard/dossiers/:slug` (Story 2.6 / 3.2) SHOULD show the breadcrumb per spec. The handle-per-route pattern naturally respects this distinction.
- **Do NOT add `autoFocus` to the questionnaire stub or any downstream route in this story.** The stub is a 3-line placeholder; Story 2.4 owns the questionnaire interaction.
- **Do NOT add `errorElement` to the new routes.** Still deferred from Story 1.3.

### Testing Requirements

- **Unit / integration tests remain out of scope** for Epic 2 frontend — no Vitest/RTL harness. Do not introduce one here.
- **Manual verification is the primary gate** (Tasks 6 + 7). Tri-viewport walkthrough + axe audit on `/dashboard/dossiers/nouveau` with AND without the error state visible + localStorage round-trip check via DevTools.
- **Type safety:** `WizardInputProps` with `Omit<…, 'type' | 'className'>` prevents callers from mis-typing the input type. `useMatches()` returns `Match[]` with `handle: unknown` — the `RouteHandle` type guard in `Breadcrumbs.tsx` narrows safely.
- **No new lint warnings permitted** beyond the 3 tolerated ones.
- **No regression on Story 2.1 / 2.2 acceptance criteria:** `/dashboard` still renders the empty state with working CTA; breadcrumb still appears on `/dashboard/tableau-de-bord`; `/dashboard/dossiers` still redirects home.

### Decisions Pinned for This Story (flag if divergence is intentional)

1. **`WizardInput` lives in `components/confluent/`** — not in `components/ui/` (shadcn) and not in a `features/questionnaire/` module. Rationale: it is a design-system-level primitive shared by 2.3 and 2.4 (and any future wizard step), not a feature-scoped component.
2. **Breadcrumb suppression via `useMatches()` + route `handle`** — not a hardcoded path list, not a React context, not a prop drilled from the page. Handle pattern is idiomatic RR v7 and keeps the flag colocated with route config.
3. **localStorage inline in the route, no helper module** — matches Story 2.2 precedent of "no premature abstraction". `localStorage.setItem('confluent_draft_name', trimmed)` is one line; wrapping it is over-engineering for one caller.
4. **Single-field form uses bare `useState`, no React Hook Form.** HK Form + Zod arrive in Epic 7 when backend schemas land.
5. **No focus ring on `WizardInput`** — the bottom-border color shift is the focus indicator per AC1. Semantically: `outline-none` is intentional, not a WCAG regression, because an alternative *visible focus indicator* (the border color change) is present.
6. **Stub route for `/dashboard/dossiers/nouveau/questionnaire`** — 3-line placeholder (pattern from Story 2.2 nouveau stub). Story 2.4 replaces it with the real QuestionnaireStep.
7. **Sidebar deactivation on wizard routes is kept as-is** — Typeform-style focus intentionally removes ambient chrome. The "Mes dossiers" nav item loses `aria-current="page"` on wizard paths; this is a deliberate non-fix, continuing the Story 2.2 code-review deferral.
8. **`aria-invalid` toggled via `showError || undefined`** — removes the attribute entirely when false, rather than setting `aria-invalid="false"`. Matches the WAI-ARIA 1.2 recommendation to omit the attribute when invalid state doesn't apply.

### References

- Story AC + narrative: [Source: [_bmad-output/planning-artifacts/epics.md](_bmad-output/planning-artifacts/epics.md#L446-L472)#Story 2.3 — Dossier Creation Naming Step]
- QuestionnaireStep anatomy (bottom-border input, 18px): [Source: [_bmad-output/planning-artifacts/ux-design-specification.md](_bmad-output/planning-artifacts/ux-design-specification.md#L525-L532)#`QuestionnaireStep`]
- Form Patterns (validation on blur, no placeholder-only): [Source: [_bmad-output/planning-artifacts/ux-design-specification.md](_bmad-output/planning-artifacts/ux-design-specification.md#L663-L671)#Form Patterns]
- Color tokens (#E8E8E7 border, #37352F accent, #E57373 destructive): [Source: [_bmad-output/planning-artifacts/ux-design-specification.md](_bmad-output/planning-artifacts/ux-design-specification.md#L325-L343)#Color System]
- Typography scale (H1 = 28px/700 for question, body = 14px/400): [Source: [_bmad-output/planning-artifacts/ux-design-specification.md](_bmad-output/planning-artifacts/ux-design-specification.md#L345-L357)#Typography System]
- Breadcrumb depth rule + hide-on-wizard inference: [Source: [_bmad-output/planning-artifacts/ux-design-specification.md](_bmad-output/planning-artifacts/ux-design-specification.md#L673-L686)#Navigation Patterns]
- React Router v7 `useMatches` + `handle` pattern: [Source: react-router-dom@7.14+ docs]
- Story 2.2 `components/confluent/` directory precedent: [Source: [_bmad-output/implementation-artifacts/2-2-dashboard-empty-state.md](_bmad-output/implementation-artifacts/2-2-dashboard-empty-state.md)]
- Story 2.2 code-review patches (CTA h-11, `/dashboard/dossiers` redirect, `nouveau` label): [Source: commit `f8442b6 fix(epic-2): story 2.2 code-review patches`]
- Frontend tech stack (React 19, RR v7, Tailwind v4): [Source: [_bmad-output/planning-artifacts/architecture.md](_bmad-output/planning-artifacts/architecture.md#L207-L230)#Frontend Architecture]
- AppShell `<main>` wrapper contract: [Source: [apps/web/src/components/layout/AppShell.tsx](apps/web/src/components/layout/AppShell.tsx)]
- Breadcrumbs current logic (depth-based return null): [Source: [apps/web/src/components/layout/Breadcrumbs.tsx](apps/web/src/components/layout/Breadcrumbs.tsx)]
- shadcn Button contract (size, type="submit", no asChild): [Source: [apps/web/src/components/ui/button.tsx](apps/web/src/components/ui/button.tsx)]
- Existing route stubs for pattern reference: [Source: [apps/web/src/routes/dashboard/tableau-de-bord.tsx](apps/web/src/routes/dashboard/tableau-de-bord.tsx)]

### Latest Technical Information

- **React Router v7 `useMatches()`** — returns `UIMatch[]`, each with `{ id, pathname, params, data, handle }`. The `handle` property is `unknown` by design; callers type-guard at read time. The pattern is stable since React Router v6.4 Data APIs and unchanged in v7.
- **React 19 `autoFocus` prop** — applies natively to `<input>` via React's SSR-safe polyfill. Works on mount; subsequent renders don't re-focus. No effect cleanup needed.
- **Tailwind v4 arbitrary attribute selector `aria-[invalid=true]:border-destructive`** — valid syntax (v3 required `aria-invalid="true"`-style; v4 arbitrary selectors accept the bracket form). Alternative: `[&[aria-invalid=true]]:border-destructive`. Prefer the `aria-[]` shorthand.
- **localStorage synchronous API** — `setItem` / `getItem` are synchronous and throw only on quota (extremely rare for a 100-char name). No try/catch needed for this usage; Epic 7 swap to API persistence will handle error states.

### Project Context Reference

No `project-context.md` file exists at the repo root. Authoritative planning inputs remain the PRD, epics, architecture, and UX spec under `_bmad-output/planning-artifacts/`, plus locked patterns from Stories 1.1–2.2.

## Dev Agent Record

### Agent Model Used

claude-opus-4-7

### Debug Log References

- `pnpm turbo run typecheck lint build`: 6 successful, 0 errors, 3 pre-existing lint warnings tolerated (badge, button, current-user). Build time 4.2s.
- Bundle delta vs Story 2.2 baseline: CSS 41.21 → 41.63 kB (gzip 8.05 → 8.12 kB, +0.07 kB). JS 331.49 → 333.13 kB (gzip 105.36 → 105.91 kB, +0.55 kB). Delta attributed to `WizardInput`, the naming-form route, the questionnaire stub, and the `useMatches` import in Breadcrumbs.

### Completion Notes List

1. **`WizardInput` landed as the 2nd tenant of `components/confluent/`** — pure native `<input type="text">` with `type` + `className` omitted from the spread (type-safe per pinned decision: no password/email variants). Forwards every other native input prop via `{...rest}`, including `autoFocus`, `value`, `onChange`, `aria-*`, `id`, `onKeyDown`.
2. **Bottom-border-only styling** — `border-0 border-b border-border` kills the box border, `focus:border-foreground focus-visible:border-foreground` handles focus indication via color shift (no extra ring — the border IS the indicator per AC1 + pinned #5), `aria-[invalid=true]:border-destructive` turns the underline red when the parent sets `aria-invalid="true"`. All tokens from `index.css`; no raw hex.
3. **Breadcrumb suppression via `useMatches()` + route `handle`** — added a `RouteHandle` local type, a `useMatches` call, and a `matches.some()` check above the existing depth-based `segments.length < 2` guard. Both hide reasons coexist: top-level routes still hide via depth; wizard routes hide via handle. Zero hardcoded path-prefix lists.
4. **Route restructure from file to folder** — deleted `nouveau.tsx` (the 2-line stub from Story 2.2) and created `nouveau/index.tsx` + `nouveau/questionnaire.tsx`. The import path `@/routes/dashboard/dossiers/nouveau` still resolves (folder index resolution); no router import rename needed for `DossierNewRoute`.
5. **Router has 2 new `handle: { hideBreadcrumb: true }` markers** — one per wizard route. The `/dashboard/dossiers` redirect route from Story 2.2 is intentionally NOT marked (it's a redirect, never renders) and the `*` catch-all remains the LAST child of `AppShell` (ordering invariant preserved).
6. **Naming form implementation details:**
   - `useState('')` for name + `useState(false)` for showError (no form library, pinned #4).
   - `handleSubmit` trims at submit time only (pinned decision — no trim on keypress).
   - Error is inline in DOM only when `showError` is true — toggled by submit with an empty trimmed value, cleared on any keystroke.
   - `noValidate` on `<form>` suppresses the browser's native required-field popup; our inline "Le nom du projet est requis." owns the UX.
   - `aria-invalid={showError || undefined}` — attribute is OMITTED (not `false`) when no error, per pinned #8 / WAI-ARIA 1.2 recommendation.
   - `role="alert"` on the error region + `aria-describedby` on the input — screen readers announce the message when it appears and link it to the input for SR description.
   - Apostrophe in "s'appelle" uses `&apos;` and the French narrow no-break space before `?` uses `&nbsp;` — preserves typography without requiring the `.prettierrc` to special-case entities.
   - CTA uses `size="lg" className="h-11 px-4"` — same WCAG 44×44 recipe as the Story 2.2 code-review patch.
7. **localStorage key `confluent_draft_name`** — stored inline via `localStorage.setItem` directly in `handleSubmit`. No helper module, no context, no Zustand (pinned #3). Story 2.4 will read this key to derive the answers-storage key.
8. **Questionnaire stub at `nouveau/questionnaire.tsx`** — 7 lines, default export, declarative `<title>` + H1. Mirrors the `tableau-de-bord.tsx` placeholder pattern exactly.
9. **Sidebar deactivation on `/dashboard/dossiers/nouveau` kept as-is** — per pinned #7, this is a deliberate non-fix. The `end: true` on the "Mes dossiers" NavLink means no sidebar item lights up on wizard routes, which matches the Typeform focus intent of the wizard. If UX review challenges this, loosen `end: true` into a `className` callback matching `/dashboard` OR `/dashboard/dossiers/*`.
10. **`/dashboard/dossiers` redirect preserved from Story 2.2 code review** — still serves as the safe target for the intermediate "Dossiers" breadcrumb link on future `/dashboard/dossiers/:slug` routes (Story 2.6 / 3.2). Wizard steps hide their breadcrumbs entirely so the redirect is invisible from 2.3's flow, but essential for 2.6+ paths.
11. **Visual verification pending (recommended before merge):** manual tri-viewport walkthrough (mobile 375px, tablet 900px, desktop 1440px), axe audit on `/dashboard/dossiers/nouveau` in both clean and error states, localStorage DevTools round-trip check (type "  Biosensio  " → submit → verify `confluent_draft_name === "Biosensio"`). Programmatic signals are all green: typecheck + lint + build 6/6 successful, 0 errors.

### File List

**Created:**
- `apps/web/src/components/confluent/WizardInput.tsx` — bottom-border-only underline input primitive (2nd `components/confluent/` tenant)
- `apps/web/src/routes/dashboard/dossiers/nouveau/index.tsx` — naming-step form with `WizardInput`, submit-time validation, localStorage persistence, navigate to questionnaire
- `apps/web/src/routes/dashboard/dossiers/nouveau/questionnaire.tsx` — 7-line stub for the Story 2.4 destination

**Modified:**
- `apps/web/src/components/layout/Breadcrumbs.tsx` — added `useMatches` import, `RouteHandle` type, and the `hideBreadcrumb` handle check above the depth-based return null
- `apps/web/src/router.tsx` — added `QuestionnaireRoute` import + `handle: { hideBreadcrumb: true }` markers on both wizard routes + new `nouveau/questionnaire` child route

**Deleted:**
- `apps/web/src/routes/dashboard/dossiers/nouveau.tsx` — replaced by the `nouveau/` folder (naming-step form lives at `nouveau/index.tsx`)

### Change Log

- **2026-04-19** — Story 2.3 initial implementation: introduced `WizardInput` primitive (bottom-border-only input), added `handle.hideBreadcrumb` suppression mechanism in `Breadcrumbs` via `useMatches()`, restructured `nouveau.tsx` stub into a folder (naming form + questionnaire stub), wired the full 2.3 wizard flow end-to-end with submit-time validation, trim semantics, and `localStorage` persistence under `confluent_draft_name`. Typecheck/lint/build green; no new lint warnings; bundle delta +0.55 kB gzip JS, +0.07 kB gzip CSS.
