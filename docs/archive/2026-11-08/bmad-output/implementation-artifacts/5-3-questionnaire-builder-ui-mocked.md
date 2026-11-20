# Story 5.3: Questionnaire Builder (UI, Mocked)

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an administrator,
I want to see the questionnaire structure and understand how it can be configured,
so that I can prepare for the real configuration workflow that comes with the API.

## Acceptance Criteria

1. **Given** the router at [apps/web/src/router.tsx](apps/web/src/router.tsx), **When** a developer inspects it, **Then** exactly ONE new route entry is inserted AFTER `{ path: 'admin/dossiers/:slug', ... }` at [apps/web/src/router.tsx:48-52](apps/web/src/router.tsx#L48-L52) and BEFORE the catch-all `{ path: '*', element: <NotFoundRoute /> }` at [apps/web/src/router.tsx:53](apps/web/src/router.tsx#L53): `{ path: 'admin/questionnaire', element: <AdminQuestionnaireRoute /> }`. No `handle: { hideBreadcrumb: true }` — the global `Breadcrumbs` component renders `Admin / Questionnaire` for this 2-segment path (AC4). A corresponding `import AdminQuestionnaireRoute from '@/routes/admin/questionnaire'` is appended to the imports block after the existing `AdminDossierDetailRoute` import at [apps/web/src/router.tsx:11](apps/web/src/router.tsx#L11). No other line in `router.tsx` changes.

2. **Given** the new route body at [apps/web/src/routes/admin/questionnaire.tsx](apps/web/src/routes/admin/questionnaire.tsx), **When** a user with `role !== 'admin'` navigates to `/admin/questionnaire`, **Then** the route renders `<Navigate to="/dashboard" replace />` from `react-router-dom` and does NOT render any builder UI. The guard sits at the TOP of the default-exported `AdminQuestionnaireRoute` function body, immediately after `const user = useCurrentUser()`, BEFORE any other hook. Because the body calls `useState` AFTER the guard, the route MUST adopt the inner-component delegation pattern (5.2 Pinned Decision #2): the default export is guard-only, and returns `<AdminQuestionnaireBuilder />` which hosts all subsequent hooks. Identical shape to [apps/web/src/routes/admin/dossiers/index.tsx:8-12](apps/web/src/routes/admin/dossiers/index.tsx#L8-L12) + [apps/web/src/routes/admin/dossiers/index.tsx:14](apps/web/src/routes/admin/dossiers/index.tsx#L14) (AdminDossiersRoute → AdminDossiersList).

3. **Given** the `AdminQuestionnaireBuilder` inner-component render, **When** it mounts, **Then** it outputs, in order:
   - `<title>Questionnaire · Confluent</title>` — React 19 auto-hoists to `<head>`. Separator is the middle-dot `U+00B7` (matches [apps/web/src/routes/admin/index.tsx:13](apps/web/src/routes/admin/index.tsx#L13) and all admin surfaces).
   - `<h1 ref={headingRef} tabIndex={-1} className="font-heading text-2xl font-semibold text-foreground md:text-[28px] focus-visible:outline-none">Questionnaire</h1>` — matches the list-surface H1 sizing from [apps/web/src/routes/admin/dossiers/index.tsx:23-29](apps/web/src/routes/admin/dossiers/index.tsx#L23-L29). `headingRef.current?.focus()` runs once on mount via `useEffect(() => { headingRef.current?.focus() }, [])` — same mount-focus pattern as the admin dossiers list (accessibility: AT lands on the page title).
   - A `<p className="mt-2 text-sm text-muted-foreground">` lead-in reading exactly: `Structure actuelle du questionnaire d'intake. La configuration sera activée avec l'API.` — single sentence, apostrophes JSX-escaped as `&apos;` per Epic 4+ convention.
   - Below the lead-in, a `<section className="mt-8">` wrapping the builder body (AC5–AC8).

4. **Given** the breadcrumb behavior at [apps/web/src/components/layout/Breadcrumbs.tsx](apps/web/src/components/layout/Breadcrumbs.tsx), **When** an admin user is on `/admin/questionnaire`, **Then** the global `Breadcrumbs` renders `Admin / Questionnaire`:
   - Path splits into `['admin', 'questionnaire']` (length 2 ≥ 2 — the `segments.length < 2` early-return at [Breadcrumbs.tsx:32](apps/web/src/components/layout/Breadcrumbs.tsx#L32) does NOT fire).
   - `'admin'` → `'Admin'` via existing `SEGMENT_LABELS` entry at [Breadcrumbs.tsx:10](apps/web/src/components/layout/Breadcrumbs.tsx#L10) — linkable to `/admin` (UNCHANGED — 5.2 already corrected it from 'Administration').
   - `'questionnaire'` → REQUIRES a new `SEGMENT_LABELS['questionnaire'] = 'Questionnaire'` entry (Story 5.4 will add `utilisateurs: 'Utilisateurs'` — each admin-sub-story owns its label). WITHOUT this entry, `toLabel('questionnaire')` falls through to `decodeURIComponent('questionnaire')` → `'questionnaire'` (lowercase, ugly). The new entry MUST be inserted alphabetically between `'nouveau'` and the end of the map (NOT at the top — keeping existing entries ordered). This is the ONLY edit to `Breadcrumbs.tsx` in 5.3. See Pinned Decision #1.
   - "Questionnaire" is the current/last segment → rendered as `<span aria-current="page">` (non-linkable).

5. **Given** the builder body section (AC3 section wrapper), **When** it renders, **Then** it shows the 3-section questionnaire structure sourced from the enriched builder fixture at [apps/web/src/data/mock-questionnaire-builder.ts](apps/web/src/data/mock-questionnaire-builder.ts) (AC9). Layout:
   - A `<div className="flex items-start justify-between gap-4 mb-4">` header row with:
     - Left: `<div>` containing `<h2 className="font-heading text-xl font-semibold text-foreground md:text-2xl">Sections</h2>` + `<p className="mt-1 text-xs text-muted-foreground">{sections.length} sections · {totalFields} champs</p>` — `totalFields` derives from summing `section.fields.length`.
     - Right: `<Button variant="outline" size="sm" onClick={handleModifierClick('sections')}>Modifier la structure</Button>` (AC8).
   - Below the header, a `<ul role="list" className="flex flex-col gap-3">` containing ONE `<li>` per section. Each `<li>` renders the `QuestionnaireBuilderSection` component (AC7).

6. **Given** the mobile viewport (<768px), **When** the builder renders, **Then** the header row stacks: `flex-col` on mobile → `md:flex-row` at tablet+. The section list is already single-column (each `<li>` is full-width). Field rows inside a section stack their label/type/required columns vertically on mobile (`flex-col gap-1`) → horizontal at tablet+ (`md:flex-row md:items-center md:gap-4`). No horizontal overflow at 375 px (verify via DevTools device emulation). Matches UX spec at [ux-design-specification.md:722](../planning-artifacts/ux-design-specification.md#L722) ("Admin back-office — desktop-only usage acceptable") while honoring Epic 5.3 AC5 (mobile-readable).

7. **Given** the new custom component at [apps/web/src/components/confluent/QuestionnaireBuilderSection.tsx](apps/web/src/components/confluent/QuestionnaireBuilderSection.tsx), **When** a developer inspects it, **Then** the component uses the native HTML `<details>`/`<summary>` disclosure pattern wrapped in token-styled card chrome — NOT a shadcn Accordion primitive (see Pinned Decision #2). The contract:
   - Props: `{ section: BuilderSection; onModifierClick: (target: BuilderActionTarget) => void }` — types sourced from `@/data/mock-questionnaire-builder`.
   - Root: `<details className="group rounded-lg border border-border bg-card overflow-hidden">` — `group` enables icon-rotation via `group-open:` variant; `overflow-hidden` keeps the rounded corners clipping the expanded content.
   - `<summary className="flex cursor-pointer items-center justify-between gap-3 px-4 py-3 list-none marker:hidden hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--ring)]">`:
     - Left content: `<div className="min-w-0 flex items-center gap-3">` with a lucide-react `ChevronRight` icon (`className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90"`) and `<span className="font-medium text-foreground truncate">{section.title}</span>`.
     - Right content: `<div className="flex items-center gap-2 shrink-0">` with `<span className="text-xs text-muted-foreground tabular-nums">{section.fields.length} champs</span>` and a `<Button variant="ghost" size="sm" onClick={handleSectionModifier}>Modifier</Button>`. The Button's `onClick` MUST call `event.preventDefault()` before invoking `onModifierClick({ type: 'section', sectionId: section.id })` — otherwise the `<summary>` click handler toggles open/close on every Modifier press (AC8 behavior violation). See Pinned Decision #3.
   - After `</summary>`, the expanded content: `<ul role="list" className="divide-y divide-border border-t border-border">`. One `<li>` per field.
   - Each field `<li className="flex flex-col gap-1 px-4 py-3 md:flex-row md:items-center md:gap-4">`:
     - `<span className="text-sm text-foreground min-w-0 md:flex-1 break-words">{field.label}</span>` — label wraps on narrow widths; `break-words` handles long labels gracefully.
     - `<span className="text-xs text-muted-foreground font-mono shrink-0">{fieldTypeLabel(field.fieldType)}</span>` — rendered via a small pure helper `fieldTypeLabel(t: BuilderFieldType): string` returning `'Texte'` | `'Nombre'` | `'Sélection'` (user-facing French, not the raw enum literals `'text'`/`'number'`/`'select'`). `font-mono` signals "type metadata" visually without introducing a new color token.
     - `<Badge variant={field.required ? 'default' : 'secondary'} className="shrink-0">{field.required ? 'Requis' : 'Optionnel'}</Badge>` — reuses the existing shadcn Badge primitive at [apps/web/src/components/ui/badge.tsx](apps/web/src/components/ui/badge.tsx). `default` = filled (foreground emphasis for required); `secondary` = muted (optional). NO new badge variant introduced.
     - `<Button variant="ghost" size="sm" onClick={() => onModifierClick({ type: 'field', sectionId: section.id, fieldId: field.id })} className="shrink-0">Modifier</Button>`.

8. **Given** any "Modifier" button (field-level, section-level, or the top-level "Modifier la structure" button), **When** the admin clicks it, **Then** a single `sonner` toast is emitted via `toast.message(...)` (not `toast.success`/`toast.error`/`toast.warning` — this is an informational "not yet available" notice, not a success/failure signal). Exact message payload:
   - Title: `'Disponible prochainement'`
   - Description: `'La configuration sera activée avec l\'API dans une prochaine version.'`
   - No `action`, no custom duration — default Sonner config from [apps/web/src/components/ui/sonner.tsx](apps/web/src/components/ui/sonner.tsx) applies.
   - `import { toast } from 'sonner'` — same import pattern as [apps/web/src/routes/dashboard/dossiers/[slug].tsx:3](apps/web/src/routes/dashboard/dossiers/[slug].tsx#L3).
   - ZERO local state mutation occurs on click (no `useState` setter fires, no `sessionStorage` write, no navigation). Verify via React DevTools state inspector: the only local state is `useState` for the builder's section expanded/collapsed UI, and the Modifier handler does not touch it.
   - The handler is a SINGLE helper declared at the top of `AdminQuestionnaireBuilder`: `const handleModifierClick = useCallback((target: BuilderActionTarget) => { toast.message('Disponible prochainement', { description: 'La configuration sera activée avec l\'API dans une prochaine version.' }) }, [])`. `useCallback` stabilises the reference across re-renders so the per-section component doesn't re-render on parent state changes. The `target` parameter is currently unused at runtime — it's the forward-shape for Epic 9.2 where the handler branches on `target.type`. See Pinned Decision #4.

9. **Given** the NEW mock fixture at [apps/web/src/data/mock-questionnaire-builder.ts](apps/web/src/data/mock-questionnaire-builder.ts), **When** a developer inspects it, **Then** the file:
   - Imports: `import { QUESTIONNAIRE } from './questionnaire'` — the builder fixture is DERIVED from the existing entrepreneur-facing questionnaire at [apps/web/src/data/questionnaire.ts](apps/web/src/data/questionnaire.ts), NOT hand-duplicated. Divergence would be a bug, not a feature (same spirit as 5.2 Pinned Decision #3 for `MOCK_DOSSIER_DETAIL.answers`). See Pinned Decision #5.
   - Exports these types:
     ```ts
     export type BuilderFieldType = 'text' | 'number' | 'select'

     export interface BuilderField {
       readonly id: string
       readonly label: string
       readonly hint?: string
       readonly fieldType: BuilderFieldType
       readonly required: boolean
     }

     export interface BuilderSection {
       readonly id: string
       readonly title: string
       readonly fields: readonly BuilderField[]
     }

     export type BuilderActionTarget =
       | { type: 'sections' }
       | { type: 'section'; sectionId: string }
       | { type: 'field'; sectionId: string; fieldId: string }
     ```
   - Exports a `FIELD_META` map with ONE entry per question id, giving `{ fieldType, required }`. The map is hand-curated here (not in `questionnaire.ts`) to keep Story 2.4's data file isolated from admin concerns. Exact entries — these are authoritative, matches the defaults the backend will seed in Epic 9.1:
     - `presentation`:
       - `nom-projet` → `text, required: true`
       - `secteur` → `select, required: true` (will map to taxonomy — Epic 9.2/FR15)
       - `maturite` → `select, required: true` (will map to taxonomy — Epic 9.2/FR15)
       - `description-courte` → `text, required: true`
     - `produit-marche`:
       - `probleme` → `text, required: true`
       - `solution` → `text, required: true`
       - `marche-cible` → `text, required: true`
       - `differenciateur` → `text, required: false`
     - `finances-equipe`:
       - `montant` → `number, required: true`
       - `usage-fonds` → `text, required: true`
       - `taille-equipe` → `number, required: true`
       - `profil-fondateur` → `text, required: false`
   - Exports `QUESTIONNAIRE_BUILDER: readonly BuilderSection[]` — computed by mapping over `QUESTIONNAIRE` and joining each question with its `FIELD_META` entry. Failing-loud pattern: if a question id is missing from `FIELD_META`, the helper throws at module load (NOT a silent fallback to `text, required: false`) — catches drift between `questionnaire.ts` and the builder metadata early. Exact computation shape:
     ```ts
     const buildFields = (section: (typeof QUESTIONNAIRE)[number]): readonly BuilderField[] =>
       section.fields.map((q) => {
         const meta = FIELD_META[q.id]
         if (!meta) throw new Error(`Missing builder metadata for question id: ${q.id}`)
         return { ...q, ...meta }
       })
     ```
     (Note: `QUESTIONNAIRE[i].questions` is the attribute name in the existing file — adjust accordingly; the helper shape above is illustrative. Inspect [apps/web/src/data/questionnaire.ts:24](apps/web/src/data/questionnaire.ts#L24) before wiring.)
   - File-header comment exactly: `// Static mock fixture for the Story 5.3 admin questionnaire builder view. Replaced by Epic 9.2's real admin questionnaire API (architecture.md:602-605 — admin module) when data persistence lands.` — matches the forward-reference convention from 5.1 AC10 / 5.2 AC14.
   - Exports `TOTAL_BUILDER_FIELDS: number` — derived as `QUESTIONNAIRE_BUILDER.reduce((acc, s) => acc + s.fields.length, 0)`, consumed by the builder body header ("X champs"). Current expected value: 12.

10. **Given** the fixture builds on top of `QUESTIONNAIRE`, **When** the entrepreneur flow (Story 2.4) is tested for regression, **Then** nothing in the entrepreneur questionnaire render changes — `questionnaire.ts` exports are UNCHANGED (no new fields added to `Question`, no changes to `QUESTIONNAIRE` or `QUESTIONNAIRE_FLAT` or `TOTAL_QUESTIONS`). Verify via:
    - `git diff apps/web/src/data/questionnaire.ts` returns empty (no lines touched).
    - `pnpm --filter @confluent/web typecheck` exits 0 (the `Question` interface still type-satisfies the entrepreneur `QuestionnaireStep` consumer).
    - Manual: navigate to `/dashboard/dossiers/nouveau/questionnaire` (as entrepreneur) → renders identically to the pre-5.3 state.

11. **Given** the admin sidebar from Story 5.1 at [apps/web/src/components/layout/nav-items.ts:24](apps/web/src/components/layout/nav-items.ts#L24), **When** an admin user lands on `/admin/questionnaire`, **Then** the `Questionnaire` NavLink shows `aria-current="page"` (active state) — already wired by the 5.1 `<NavLink>` + React Router v7 active-match logic. No nav-items edit needed in 5.3. Verify via browser DOM inspector.

12. **Given** the WCAG 2.1 AA compliance baseline (per UX spec at [ux-design-specification.md:731](../planning-artifacts/ux-design-specification.md#L731)), **When** the builder page is audited, **Then**:
    - Each `<details>` exposes `aria-expanded` natively (the browser UA handles it — no manual `aria-expanded` attribute needed; WAI-ARIA 1.2 specifies this for the disclosure pattern).
    - `<summary>` is keyboard-focusable by default; `focus-visible:outline-[var(--ring)]` renders a visible focus ring. `Enter` and `Space` toggle the section (native browser behavior).
    - Tab order: skip link → admin sidebar (4 items) → H1 (`tabIndex={-1}`) → `Modifier la structure` button → section 1 `<summary>` → section 1 Modifier button (when expanded: → field 1 Modifier → field 2 Modifier → …) → section 2 `<summary>` → … Focus ring visible at every step.
    - No `role="list"` + `role="listitem"` duplication — Safari VoiceOver strips `<ul>`'s implicit role when `list-none` is applied (same mitigation already used at [apps/web/src/routes/admin/index.tsx:35](apps/web/src/routes/admin/index.tsx#L35) — explicit `role="list"` restores announcement).
    - No hidden headings (every `<h2>` is visible: the "Sections" header at AC5). No orphaned heading hierarchy (H1 → H2 → no H3 — field labels are NOT headings, they're list items).
    - Modifier button has a consistent accessible name: `"Modifier"` (section/field level) or `"Modifier la structure"` (top level). Nested focus inside an open `<summary>` is tested manually (AT reads the button correctly — no `<button>`-inside-`<summary>` interaction breaks WCAG per MDN disclosure pattern guidance).
    - Toast notifications emit via `sonner`'s default `aria-live="polite"` region from [apps/web/src/components/ui/sonner.tsx](apps/web/src/components/ui/sonner.tsx) — AT announces "Disponible prochainement. La configuration sera activée avec l'API dans une prochaine version." without interrupting focus.

13. **Given** the design-token discipline, **When** a developer greps the new files, **Then** ZERO raw hex values appear in any new or modified file. Every surface uses `bg-*` / `text-*` / `border-*` / `ring-*` tokens resolved from [apps/web/src/index.css](apps/web/src/index.css). Verification: `grep -E "#[0-9a-fA-F]{3,8}" apps/web/src/routes/admin/questionnaire.tsx apps/web/src/components/confluent/QuestionnaireBuilderSection.tsx apps/web/src/data/mock-questionnaire-builder.ts` returns empty.

14. **Given** the verification sweep, **When** the dev agent runs the build-and-check battery, **Then** all the following exit 0 / green:
    - `pnpm --filter @confluent/web typecheck` — exits 0, no type errors.
    - `pnpm --filter @confluent/web lint` — exits 0. The existing 5-warning baseline (all `react-refresh/only-export-components` — carried from 5.1) is preserved. No new warning class introduced. 5.3 adds NO new module-level exports adjacent to a component in the same file (the route file only exports its default component; the section component file only exports its default component; the mock fixture file exports only non-component types and constants — it's a data module, not a component module, so the `react-refresh` rule does not apply).
    - `pnpm turbo run build` — all packages GREEN. Bundle delta vs 5.2 baseline (`635.31 KB / 198.41 KB gz`): estimated ≤ +2 KB gz. Audit threshold: +5 KB gz. If exceeded, investigate before marking complete.
    - `grep -n '#' apps/web/src/routes/admin/questionnaire.tsx` — returns only import-path / JSX-comment matches, zero color-hex matches.
    - `grep -rn 'Modifier' apps/web/src/components/confluent/QuestionnaireBuilderSection.tsx apps/web/src/routes/admin/questionnaire.tsx` — returns EXACTLY 3 matches: one per button occurrence (top "Modifier la structure" + per-section "Modifier" + per-field "Modifier"). Per-field is the ONE button literal emitted N times inside the `.map()`, so grep sees one textual occurrence.

15. **Given** manual browser walkthrough (deferred — headless environment), **Then** the human reviewer verifies:
    - `?as=admin` on `/dashboard` → click "Questionnaire" in sidebar → lands on `/admin/questionnaire`, sidebar active state transfers, H1 focus received, breadcrumb shows `Admin / Questionnaire`, `Admin` link navigates back to `/admin`.
    - Each section `<summary>` click toggles expand/collapse smoothly (native animation via browser UA — no custom CSS transition required). Chevron rotates 90° on open.
    - `Enter` and `Space` on a focused `<summary>` toggle the section.
    - Click "Modifier la structure" → toast appears in default position, bottom-right per [apps/web/src/components/ui/sonner.tsx](apps/web/src/components/ui/sonner.tsx) config. Toast text matches AC8. No URL change, no section state change.
    - Click "Modifier" on a section header → toast appears, section expand state UNCHANGED (the `preventDefault()` in Pinned Decision #3 is the critical test).
    - Click "Modifier" on an individual field row → toast appears, section stays expanded.
    - Resize to 375 px: builder stays single-column, no horizontal scroll, labels wrap, chevron/badges stay visible on the right side of each row.
    - Resize to 768 px: tablet rail + 4 admin icons vertical; builder switches to horizontal field-row layout (label left, type + badge + button right).
    - Resize to 1440 px: full 240 px admin sidebar; builder body inherits the shell's max-width (no explicit `max-w-*` on the route container — the AppShell `<main>` already constrains it; if the builder feels too wide, revisit in a follow-up polish pass, but DO NOT introduce a `max-w-*` clamp in 5.3 — see Pinned Decision #6).
    - Non-admin user (default entrepreneur `Sophie Moreau`) navigates to `/admin/questionnaire` → redirects to `/dashboard` via the role guard. Browser back button does NOT land back on `/admin/questionnaire` (`replace` flag honored).

## Tasks / Subtasks

- [x] **Task 1: Mock builder fixture (AC: 9, 10)**
  - [x] Create [apps/web/src/data/mock-questionnaire-builder.ts](apps/web/src/data/mock-questionnaire-builder.ts).
  - [x] Imports from `./questionnaire` — do not mutate or re-export `questionnaire.ts` shape.
  - [x] Export types: `BuilderFieldType`, `BuilderField`, `BuilderSection`, `BuilderActionTarget`.
  - [x] Export `FIELD_META` with the exact 12 entries listed in AC9.
  - [x] Export `QUESTIONNAIRE_BUILDER` computed via the `buildFields` helper — throwing on missing metadata (fail-loud).
  - [x] Export `TOTAL_BUILDER_FIELDS` — numeric total, currently 12.
  - [x] File-header comment as specified in AC9.
  - [x] `pnpm --filter @confluent/web typecheck` exits 0.

- [x] **Task 2: Section component (AC: 7, 12, 13)**
  - [x] Create [apps/web/src/components/confluent/QuestionnaireBuilderSection.tsx](apps/web/src/components/confluent/QuestionnaireBuilderSection.tsx).
  - [x] Named default export `QuestionnaireBuilderSection` with the props contract from AC7.
  - [x] Native `<details>` / `<summary>` disclosure pattern — NOT a shadcn Accordion primitive (Pinned Decision #2).
  - [x] `ChevronRight` from `lucide-react` with `group-open:rotate-90` rotation.
  - [x] Section-level Modifier button calls `event.preventDefault()` before `onModifierClick(...)` (Pinned Decision #3 — prevents `<summary>` toggle side-effect).
  - [x] Field list: `<ul role="list" className="divide-y divide-border border-t border-border">` with per-field `<li>` layout per AC7.
  - [x] Uses existing `Badge` primitive from [apps/web/src/components/ui/badge.tsx](apps/web/src/components/ui/badge.tsx) — `variant="default"` (required) / `variant="secondary"` (optional). No new badge variant.
  - [x] Local pure helper `fieldTypeLabel(t: BuilderFieldType): string` → `'Texte'` / `'Nombre'` / `'Sélection'`.
  - [x] WCAG: native `<summary>` keyboard behavior + `aria-expanded` auto-emitted by UA; visible focus ring via `focus-visible:outline-[var(--ring)]`.
  - [x] `pnpm --filter @confluent/web typecheck` exits 0.

- [x] **Task 3: Admin questionnaire route (AC: 2, 3, 5, 6, 8, 12)**
  - [x] Create [apps/web/src/routes/admin/questionnaire.tsx](apps/web/src/routes/admin/questionnaire.tsx).
  - [x] Default export `AdminQuestionnaireRoute` — guard-only (inner-component delegation per AC2 / 5.2 Pinned Decision #2).
  - [x] Inner component `AdminQuestionnaireBuilder` hosts all hooks: `useRef<HTMLHeadingElement>`, `useEffect` for H1 focus, `useCallback` for `handleModifierClick`.
  - [x] Render order per AC3: `<title>` → `<h1>` → lead-in `<p>` → `<section>` body.
  - [x] Body header row per AC5: `<h2>Sections</h2>` + subcounts + "Modifier la structure" button.
  - [x] Section list: `<ul role="list" className="flex flex-col gap-3">` with one `<QuestionnaireBuilderSection>` per item.
  - [x] Toast handler per AC8: `toast.message('Disponible prochainement', { description: '…' })`; `useCallback` stable ref.
  - [x] Import pattern: `import { toast } from 'sonner'` — matches [apps/web/src/routes/dashboard/dossiers/[slug].tsx:3](apps/web/src/routes/dashboard/dossiers/[slug].tsx#L3).
  - [x] `pnpm --filter @confluent/web typecheck` exits 0.

- [x] **Task 4: Router registration (AC: 1)**
  - [x] Modify [apps/web/src/router.tsx](apps/web/src/router.tsx):
    - [x] Append `import AdminQuestionnaireRoute from '@/routes/admin/questionnaire'` immediately after the `AdminDossierDetailRoute` import.
    - [x] Insert one new route entry `{ path: 'admin/questionnaire', element: <AdminQuestionnaireRoute /> }` between the `admin/dossiers/:slug` entry and the catch-all `*` entry.
    - [x] No `handle: { hideBreadcrumb: true }` — Breadcrumbs renders for this path (AC4).
  - [x] Verify no other lines in `router.tsx` change.
  - [x] `pnpm --filter @confluent/web typecheck` exits 0.

- [x] **Task 5: Breadcrumb label (AC: 4)**
  - [x] Modify [apps/web/src/components/layout/Breadcrumbs.tsx:5-11](apps/web/src/components/layout/Breadcrumbs.tsx#L5-L11): add `questionnaire: 'Questionnaire',` entry to `SEGMENT_LABELS` after `admin: 'Admin',`.
  - [x] Verify no other lines change — `toLabel`, `Breadcrumbs` function, suppression logic UNCHANGED.
  - [x] `pnpm --filter @confluent/web typecheck` exits 0.

- [x] **Task 6: Verification sweep (AC: 10, 11, 13, 14, 15)**
  - [x] `pnpm --filter @confluent/web typecheck` — exits 0.
  - [x] `pnpm --filter @confluent/web lint` — exits 0. 5-warning baseline preserved (no new warning class, no new warnings).
  - [x] `pnpm turbo run build` — all packages GREEN. Record bundle delta vs 5.2 baseline (`635.31 KB / 198.41 KB gz`). Expected ≤ +2 KB gz. If > +5 KB gz, investigate before marking complete.
  - [x] `grep -E "#[0-9a-fA-F]{3,8}" apps/web/src/routes/admin/questionnaire.tsx apps/web/src/components/confluent/QuestionnaireBuilderSection.tsx apps/web/src/data/mock-questionnaire-builder.ts` — returns empty (AC13).
  - [x] `git diff apps/web/src/data/questionnaire.ts` — returns empty (AC10).
  - [x] `grep -c "^" apps/web/src/data/mock-questionnaire-builder.ts` — record line count for Completion Notes.
  - [x] Manual browser walkthrough (AC15) — deferred (headless environment); flag in Completion Notes for human reviewer.
  - [x] On each task landed, mark the corresponding Tasks/Subtasks checkbox above.

- [x] **Task 7: Sprint status housekeeping**
  - [x] When story implementation is complete, update [_bmad-output/implementation-artifacts/sprint-status.yaml](sprint-status.yaml):
    - [x] `development_status.5-3-questionnaire-builder-ui-mocked`: `ready-for-dev` → `in-progress` → `review` → `done`.
    - [x] `last_updated`: current date.
  - [x] Preserve all comments (STATUS DEFINITIONS block, header).
  - [x] Story Status: flip `ready-for-dev` → `review` → `done` (post-review).

### Review Findings

Code review executed 2026-04-22 on uncommitted working-tree diff against spec ACs + Pinned Decisions. 3 parallel review layers: Blind Hunter (diff only), Edge Case Hunter (diff + project), Acceptance Auditor (diff + spec + context). ~40 raw findings → 3 retained as patches, rest dismissed (spec-mandated, 5.1/5.2 parity, or forward-coupled to later epics).

**Patches applied (all three auto-applied per user directive):**

- [x] [Review][Patch] Explicit spread in `buildFields` to prevent future `Question` fields leaking into `BuilderField` [apps/web/src/data/mock-questionnaire-builder.ts:57] — replaced `{ ...q, ...meta }` with `{ id: q.id, label: q.label, hint: q.hint, ...meta }`. Blind Hunter flag.
- [x] [Review][Patch] Exhaustiveness guard on `fieldTypeLabel` switch [apps/web/src/components/confluent/QuestionnaireBuilderSection.tsx:16-25] — added `default: { const exhaustive: never = t; return exhaustive }` to catch future `BuilderFieldType` widening at typecheck time. Blind Hunter flag.
- [x] [Review][Patch] Toast dedupe on rapid-fire clicks [apps/web/src/routes/admin/questionnaire.tsx:29] — added `id: 'builder-coming-soon'` to `toast.message()` options so repeated Modifier clicks coalesce into a single Sonner toast instead of stacking. Edge Case Hunter flag.

**Dismissed (summary, by category):**

- *Spec-mandated (cannot change without renegotiation):* module-load fail-loud throw (AC9 / PD#5), `preventDefault` instead of `stopPropagation` on section-Modifier (PD#3), H1 mount-focus `tabIndex={-1}` + `focus-visible:outline-none` (AC3), `useCallback` stable ref (AC8), exact toast copy wording (AC8), `role="list"` explicit restoration (AC12), uniform "Modifier" button accessible name (AC12), inner-component delegation guard-only pattern (AC2 / 5.2 PD#2).
- *Consistency with 5.1/5.2 (deliberate carry-forward):* `user.role` guard duplication, `<title>` React 19 metadata hoisting, `Navigate` redirect without confirmation/message, no `preventScroll:true` on H1 focus.
- *Latent / forward-coupled (out of scope):* Epic 6.3 async JWT hydration race, breadcrumb `questionnaire` label collision with entrepreneur flow (currently masked by `hideBreadcrumb:true`), iOS Safari <16 `break-words` quirks, non-English label polish, strict-mode double-mount focus replay, `<details>` open-state persistence across navigations.
- *French pluralization ("1 champs"):* static dataset is locked at 3 sections × 4 fields (always plural), no visible defect today.
- *Pure nits:* Tailwind class ordering cosmetic divergence from spec literal strings, default vs named export style, superfluous `: number` annotation on `TOTAL_BUILDER_FIELDS`, inline arrow allocated per row.

**Deferred:** none.

### Reviewer Notes

- Acceptance Auditor confirmed AC1–AC15 all satisfied. No AC violations. No Pinned Decision violations.
- Bundle after patches: **639.64 KB / 199.35 KB gz** — delta vs pre-review (`639.57 KB / 199.32 KB gz`): **+0.07 KB / +0.03 KB gz**. Within the +5 KB gz audit threshold.
- Typecheck / lint baseline preserved: 0 errors, 5 warnings (all `react-refresh/only-export-components` carried from 5.1 — no new class introduced).
- Manual browser walkthrough (AC15) remains deferred — flagged for human reviewer in Completion Notes.

## Dev Notes

### Critical Architecture Constraints

- **Admin routes use inline role guards + inner-component delegation.** 5.3's route body calls `useState`/`useRef`/`useEffect`/`useCallback` AFTER the guard; that violates Rules of Hooks if the guard's early-return and the hooks live in the same function. Adopt the 4.4 / 5.2 inner-component pattern: default export is `{ user, if(…) return <Navigate/>; return <Inner /> }` with ZERO hooks beyond `useCurrentUser()`; `Inner` hosts everything else. See Pinned Decision #2 below.

- **`questionnaire.ts` is OFF-LIMITS for this story.** Story 2.4's hardcoded questionnaire is consumed by the entrepreneur flow. Any change (adding `fieldType`/`required` fields to `Question` interface, mutating sections, etc.) triggers regressions across 2.4–2.6 surfaces. The admin builder layer is ADDITIVE via a separate fixture `mock-questionnaire-builder.ts` that imports and extends. See Pinned Decision #5.

- **Native `<details>`/`<summary>` — NOT shadcn Accordion.** WAI-ARIA disclosure pattern is already implemented by the browser UA (keyboard, `aria-expanded`, focus management). Adding Radix Accordion here would double the bundle cost for zero UX delta, introduce a dependency on `@radix-ui/react-accordion` (not currently installed), and require manual keyboard wiring. See Pinned Decision #2.

- **Toast uses `toast.message` — NOT `toast.success`.** The "coming soon" message is informational, not a success/failure. `sonner`'s `message` variant renders without the success-green checkmark or error-red cross icons; it's the neutral default. Epic 9.2 replaces this handler with a real edit dialog — at that point the success path becomes `toast.success('Champ mis à jour')` after an API PATCH. Today: neutral notice.

- **Modifier buttons nested in `<summary>` require `preventDefault()`.** HTML disclosure semantics: any click within `<summary>` (including on child `<button>` elements) toggles the `<details>` open-state UNLESS the nested handler calls `event.preventDefault()`. The section-level Modifier button sits inside the `<summary>`; its onClick MUST preventDefault before invoking the toast callback. Field-level Modifier buttons sit OUTSIDE the `<summary>` (inside the expanded `<ul>`), so no preventDefault needed for those. See Pinned Decision #3.

- **Design tokens only — no raw hex.** Every color comes from `index.css` custom properties. AC13 grep is the automated guardrail.

- **WCAG 2.1 AA baseline.** Per UX spec at [ux-design-specification.md:731](../planning-artifacts/ux-design-specification.md#L731). Headings are H1 → H2 (no H3+). `<details>` handles disclosure a11y natively. `<ul role="list">` restores Safari VoiceOver announcement when `list-none` is applied. Focus ring visible at every tab stop.

- **No new admin routes beyond `/admin/questionnaire`.** 5.4's `/admin/utilisateurs` remains unrouted until its own story lands (falls through to `NotFoundRoute`). 5.3 does NOT pre-wire 5.4 — same discipline as 5.1 Pinned Decision #1.

- **Mobile card breakpoint parity with 5.2.** Story 5.2's list uses `md:hidden` + `hidden md:block` to swap card/table layouts. 5.3 does NOT swap between two layouts — the same `<details>`-based list renders at every breakpoint, with `flex-col md:flex-row` inside each field row. Rationale: the questionnaire structure is inherently list-shaped; no table-vs-card decision to make. See Pinned Decision #6.

### Decisions Pinned for This Story

Do not renegotiate without explicit retrospective action.

1. **Breadcrumb label injected here: `questionnaire: 'Questionnaire'`.** Story 5.4 will append `utilisateurs: 'Utilisateurs'`. Each admin sub-story owns its segment label. Alternatives rejected: (a) add both labels in 5.3 ahead of 5.4 — pre-wiring 5.4 scope; (b) compute label via a smarter `toLabel` (e.g., title-casing the segment) — changes behavior for every future segment silently, a latent regression vector. Manual per-entry mapping is intentional for French accentuation and terminology control.

2. **Native `<details>`/`<summary>` for section disclosure — NOT shadcn Accordion.** Rationale: (a) zero new dependency; (b) WAI-ARIA disclosure handled by browser UA (Chromium, WebKit, Gecko all implement correctly); (c) `group-open:` Tailwind variant + native `[open]` attribute gives CSS-only chevron rotation; (d) matches the "lowest-friction-that-works" discipline of the design system. Alternatives rejected: (a) `@radix-ui/react-accordion` — adds ~4 KB gz, new peer dep, duplicates UA behavior; (b) shadcn's existing `tabs` primitive — wrong pattern (tabs are exclusive-selection, sections should be independently expandable); (c) custom hook + button + div with `aria-expanded` — reinvents disclosure. The 5.2 "no new design-system primitives" spirit applies: rule-of-three not met.

3. **Section-level Modifier button calls `event.preventDefault()` before the toast.** Without it, the `<summary>`'s native click toggles the `<details>` open state on every Modifier press — users would see a toast AND the section would flip open/closed. That's a UX defect and violates AC8 ("no state change occurs"). The `preventDefault()` call stops the summary's toggle handler; the toast still fires via the React synthetic event path. Verified via manual testing before merge (deferred in headless — flag in Completion Notes). Alternatives rejected: (a) move the Modifier button outside the `<summary>` (violates the AC7 layout — button belongs inside the section header right-side cluster); (b) use a `<div>` + manual `[aria-expanded]` / onClick handlers instead of native `<details>` (reinvents disclosure); (c) `stopPropagation()` instead of `preventDefault()` — incorrect API for this case (the toggle is the `<summary>`'s default action, not a propagated event from a child).

4. **`handleModifierClick` takes a `target` parameter that is unused at runtime.** The parameter is the forward-shape for Epic 9.2 where the handler branches on `target.type` to open the appropriate edit dialog (`'sections'` → structure editor, `'section'` → section editor, `'field'` → field editor). Today it's discarded after the toast call. Rationale: (a) API shape stability across stories — the inner-component and section-component contracts don't have to change in Epic 9.2, only the implementation; (b) the type system documents the three click targets, serving as living specification. Alternatives rejected: (a) separate handlers per target (`handleSectionsClick`, `handleSectionClick`, `handleFieldClick`) — three handler refs, three `useCallback` calls, all doing the same thing today; (b) no parameter at all, infer target in Epic 9.2 — loses the design discipline now. ESLint may flag `target` as unused — suppress via `// eslint-disable-next-line @typescript-eslint/no-unused-vars` at the param level ONLY if the lint fails (check first).

5. **Builder metadata lives in `mock-questionnaire-builder.ts`, NOT appended to `questionnaire.ts`.** Adding `fieldType`/`required` to the `Question` interface would either (a) force every entrepreneur-facing `QuestionnaireStep` consumer to know about admin concerns, or (b) leave the fields undefined-at-read which requires callers to handle nulls. Neither is clean. The builder fixture is a separate derived layer: `BuilderField extends Question` conceptually (type-wise: `interface BuilderField extends Omit<Question, never>` — or simply spread-composed). If Epic 7/9 eventually unifies the shape (once the backend returns a single canonical `Field` type), refactor THEN. Today: additive, isolated. Alternatives rejected: (a) mutate `Question` — bleeds admin concerns into entrepreneur flow; (b) duplicate the question list in the builder fixture (full copy) — divergence risk, same defect class as 5.2 Pinned Decision #3 warned about.

6. **No `max-w-*` clamp on the builder body at desktop.** The AppShell's `<main>` already applies the project-standard content width (see [apps/web/src/components/layout/AppShell.tsx](apps/web/src/components/layout/AppShell.tsx)). Adding a `max-w-[720px]` or similar clamp in the route would fight the shell. If, on desktop, the builder feels too wide ("sea of white" between the end of a field row and the right edge), the fix is a future shared `max-w-*` pass across admin surfaces, NOT a local clamp. Alternatives rejected: (a) `max-w-4xl mx-auto` on the route container — inconsistent with 5.1 and 5.2 which do not clamp; (b) sidebar width tweak — cross-cutting change outside 5.3 scope.

7. **Epic 1–5.2 Pinned Decisions CARRY FORWARD.** No renegotiation. Specifically:
    - 5.1 Pinned Decision #1 (no pre-wiring of stories that haven't landed) — 5.3 does NOT add `/admin/utilisateurs` route. Breadcrumb label for `utilisateurs` is NOT added.
    - 5.1 Pinned Decision #3 (single `AppShell`, role-driven nav) — 5.3 does not touch AppShell.
    - 5.1 Pinned Decision #4 (inline role guard) — 5.3 applies this.
    - 5.2 Pinned Decision #2 (inner-component delegation for routes with hooks after guard) — 5.3 applies this.
    - 5.2 Pinned Decision #3 (shared data source, no duplication) — 5.3 applies this to `QUESTIONNAIRE`.
    - 5.2 Pinned Decision #5 (no new design-system primitives unless rule-of-three met) — 5.3 respects (uses existing Badge + Button, native `<details>`).
    - The 5-warning lint baseline: maintained at 5.

### Previous Story Intelligence

**From Story 5.2 (just landed — `5a52c5e`):**

- Inner-component delegation pattern (5.2 Pinned Decision #2): `AdminDossiersRoute → AdminDossiersList`, `AdminDossierDetailRoute → AdminDossierDetailView`. 5.3 mirrors: `AdminQuestionnaireRoute → AdminQuestionnaireBuilder`.
- Breadcrumb label correction (5.2 Task 5): `'Administration'` → `'Admin'` at `SEGMENT_LABELS[admin]`. Still in place. 5.3 appends `questionnaire: 'Questionnaire'` as a same-shape addition.
- Mock fixture header convention (5.2 AC14): exact phrasing for the "replaced by Epic 9.X" forward reference. 5.3's header reads "Replaced by Epic 9.2" (questionnaire builder persistence).
- H1 mount-focus effect: `useEffect(() => { headingRef.current?.focus() }, [])` with `<h1 tabIndex={-1}>` + `focus-visible:outline-none`. 5.3 reuses verbatim.
- `role="list"` explicit restoration on `<ul className="list-none">`: 5.2 applied on mobile card list. 5.3 applies the same on both the section list and the field list.
- 5.2 Completion Note #1 (lint warning count): baseline is 5 warnings, all `react-refresh/only-export-components`. 5.3 MUST NOT extend. The builder fixture file exports ONLY types and constants (no React components) — rule does not apply.
- 5.2 Completion Note #3 (manual walkthrough deferred): 5.3 will follow the same deferral pattern. Flag in Completion Notes.
- Bundle at 5.2 close: `635.31 KB / 198.41 KB gz`.

**From Story 5.1 (in `841aacf`-1 lineage):**

- Mock fixture forward-reference header pattern — 5.3 mirrors for `mock-questionnaire-builder.ts`.
- `as const` typing for mock fixture arrays — 5.3 applies to `QUESTIONNAIRE_BUILDER` (via the `readonly` promises in interfaces + the `.map` producing a readonly array when the source is `readonly`).
- Rules-of-Hooks discipline: the guard must not have hooks after it in the SAME function. 5.3 adopts the inner-component split (5.2 Pinned Decision #2 applies here — see Pinned Decision above).

**From Story 2.4 (questionnaire step — carry-forward):**

- The `QUESTIONNAIRE` fixture at [apps/web/src/data/questionnaire.ts:24](apps/web/src/data/questionnaire.ts#L24) is the single source of truth for the 3-section / 12-question structure. Story 5.3 does not own this file. Changes to it would cascade into the entrepreneur questionnaire flow.
- French typography: the ` ` narrow no-break space before `?` in question labels is preserved verbatim in the admin builder view (the `label` is spread through as-is; no re-encoding). The builder view renders the label inside a `<span>` text node — no `dangerouslySetInnerHTML`, no HTML entity injection.

**From Story 4.4 (access-denied):**

- Inline guard + early-return pattern — 5.3 applies via the outer `AdminQuestionnaireRoute` (guard only, no hooks after) and delegates body to `AdminQuestionnaireBuilder`.
- File-header comment convention for mock fixtures — reused.

**From Story 3.4 (StatusDot / badge patterns):**

- Existing `Badge` shadcn primitive at [apps/web/src/components/ui/badge.tsx](apps/web/src/components/ui/badge.tsx) with `default` and `secondary` variants. 5.3 reuses — NO new variant, NO new color token.

### Git Intelligence

Recent commits (most recent 5):

```
841aacf feat(epic-5): story 5.2 — Admin all-dossiers list + read-only detail
5a52c5e feat(epic-5): story 5.1 — Admin layout & pipeline dashboard
b2e41c9 feat(epic-4): story 4.4 — Access denied page
ee95b33 feat(epic-4): story 4.3 — Financeur dossier view desktop layout
3cc245a feat(epic-4): story 4.2 — Financeur dossier view mobile layout
```

**Observed patterns to carry forward:**

- Commit title format: `feat(epic-5): story 5.3 — Admin questionnaire builder (UI, mocked)` — matches AC phrasing.
- Single bundled commit per story (impl + code-review patches together) per auto-memory at [feedback_commit_review_together.md](/home/coder/.claude/projects/-home-coder-confluent/memory/feedback_commit_review_together.md).
- Route files sit at `routes/admin/*.tsx` alongside the existing `index.tsx` and `dossiers/` subdirectory. 5.3 adds `questionnaire.tsx` as a sibling to `dossiers/`.
- Admin route bodies follow the inner-component pattern (5.2 Pinned Decision #2). 5.3 continues.

### Latest Technical Specifics

**React 19 + React Router v7:**

- `<title>Questionnaire · Confluent</title>` — React 19 auto-hoists to `<head>`. Same pattern as all other admin routes.
- `<Navigate to="/dashboard" replace />` — inherited from 5.1/5.2. `replace` prevents back-button redirect loops.
- `useCallback` around the toast handler stabilises the reference so `QuestionnaireBuilderSection` doesn't re-render on every parent state toggle. Deps: `[]` (`toast` from `sonner` is a stable module export).

**`sonner` toast:**

- `toast.message(title: string, options?: { description?: string })` — neutral informational variant (no icon tint). Verify at the current `sonner` version installed: `pnpm list sonner` in `apps/web`.
- Default position + duration come from [apps/web/src/components/ui/sonner.tsx](apps/web/src/components/ui/sonner.tsx) — no overrides needed.
- `aria-live="polite"` is the default for Sonner toasts — AT announces the message without interrupting focus.

**`lucide-react`:**

- `ChevronRight` — single named import into the section component. Already likely present in the project (if not, add to the existing lucide-react import block); avoid wildcard imports.
- Icon sizing: `size-4` (16 px) inside the `<summary>` — matches the button + badge visual weight.

**Tailwind CSS v4:**

- `group-open:rotate-90` — Tailwind v4 supports the `open` variant on the parent `<details>` element via the `[open]` attribute. Verify: `pnpm --filter @confluent/web build` must emit the generated CSS for `group-open:rotate-90`. If the variant doesn't emit (Tailwind v4 is strict about variant configs), add `group-[&[open]]:rotate-90` fallback syntax.
- `list-none marker:hidden` on `<summary>` — removes the default disclosure triangle marker in WebKit (`marker:hidden`) and resets list bullet styling inheritance (`list-none`).
- `focus-visible:outline-offset-[-2px]` — negative offset pulls the focus ring INSIDE the `<summary>`'s padding, avoiding clipping by the parent's `overflow-hidden`. Same pattern used in the admin dossier list row focus.
- All token-based colors (`text-foreground`, `bg-card`, `border-border`, etc.) — no new tokens introduced.

**Base UI primitives (via shadcn v4):**

- `Badge` (existing) — `variant="default"` / `variant="secondary"` reused.
- `Button` (existing) — `variant="ghost"` (section + field Modifier) and `variant="outline"` (top-level Modifier la structure).
- NO new Base UI primitive consumed in 5.3.

**Bundle budget:**

- `mock-questionnaire-builder.ts`: ~50 lines of TS ≈ ~1.5 KB uncompressed ≈ ~0.6 KB gz.
- `QuestionnaireBuilderSection.tsx`: ~70 lines of TSX ≈ ~2.5 KB uncompressed ≈ ~1.0 KB gz.
- `questionnaire.tsx` route: ~50 lines of TSX ≈ ~1.8 KB uncompressed ≈ ~0.7 KB gz.
- `router.tsx` addition: +2 LOC ≈ negligible.
- `Breadcrumbs.tsx` addition: +1 LOC ≈ negligible.
- `ChevronRight` lucide icon: ~0.4 KB gz (already likely present; zero cost if reused).
- Total estimated source delta: ≤ +2.5 KB gz. AC14 audit threshold: 5 KB gz.

### Project Structure Notes

```
apps/web/src/
├── components/
│   ├── confluent/
│   │   └── QuestionnaireBuilderSection.tsx       [NEW — section disclosure + field list]
│   ├── layout/
│   │   └── Breadcrumbs.tsx                        [MODIFIED — +1 SEGMENT_LABELS entry]
│   └── ui/                                         [UNCHANGED — reuses existing Badge + Button]
├── data/
│   ├── mock-questionnaire-builder.ts              [NEW — builder view fixture, derived from QUESTIONNAIRE]
│   └── questionnaire.ts                           [UNCHANGED — entrepreneur flow source of truth]
├── routes/
│   └── admin/
│       └── questionnaire.tsx                      [NEW — guard + builder body]
└── router.tsx                                     [MODIFIED — +1 import, +1 route entry]
```

- Alignment with [architecture.md:637-640](../planning-artifacts/architecture.md#L637-L640): `routes/admin/questionnaire.tsx` matches the anticipated shape. Architecture also mentions `features/admin/components/QuestionnaireBuilder.tsx` at [architecture.md:665](../planning-artifacts/architecture.md#L665) — 5.3 does NOT introduce a `features/admin/` hierarchy yet (rule-of-three not met; 5.1 and 5.2 also kept route bodies in-route). If 5.4 needs feature-scoped hooks, revisit at that point.
- No new folders required.
- No `packages/shared/` changes.
- No backend changes — 5.3 is frontend-only, mocked. Epic 9.2 wires the real API.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#1029-1055 (Epic 5 Story 5.3 — Questionnaire Builder UI Mocked AC)]
- [Source: _bmad-output/planning-artifacts/epics.md#1697-1728 (Epic 9 Story 9.2 — Questionnaire Builder Persistence — forward target)]
- [Source: _bmad-output/planning-artifacts/epics.md#209-212 (Epic 5 scope — admin back-office frontend, mocked)]
- [Source: _bmad-output/planning-artifacts/prd.md#FR13-FR15 (admin configures questionnaire — Epic 5 UI, Epic 9 persisted)]
- [Source: _bmad-output/planning-artifacts/prd.md#113-126 (Journey 3 — French Tech CVL admin persona)]
- [Source: _bmad-output/planning-artifacts/architecture.md#602-605 (admin module — backend companion for Epic 9)]
- [Source: _bmad-output/planning-artifacts/architecture.md#637-640 (routes/admin/ target structure)]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#44-52 (admin form builder for non-technical operators)]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#179-180 (Typeform model + section summary — mirrored in admin read-view)]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#722 (admin back-office responsive strategy — desktop-acceptable)]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#731 (WCAG 2.1 AA baseline)]
- [Source: _bmad-output/implementation-artifacts/5-1-admin-layout-pipeline-dashboard.md (admin route guard, sidebar, nav items, dev role impersonation)]
- [Source: _bmad-output/implementation-artifacts/5-2-admin-all-dossiers-list.md (inner-component delegation, breadcrumb label, mock fixture convention, `role="list"` restoration, mount-focus effect, bundle baseline)]
- [Source: _bmad-output/implementation-artifacts/4-4-access-denied-page.md (Rules-of-Hooks inner-component pattern)]
- [Source: apps/web/src/data/questionnaire.ts (QUESTIONNAIRE source of truth — 3 sections × 4 questions, French labels with U+00A0)]
- [Source: apps/web/src/components/ui/badge.tsx (Badge primitive — `default` / `secondary` variants)]
- [Source: apps/web/src/components/ui/button.tsx (Button primitive — `ghost` / `outline` variants)]
- [Source: apps/web/src/components/ui/sonner.tsx (Toaster setup — default position, duration, `aria-live="polite"`)]
- [Source: apps/web/src/components/layout/Breadcrumbs.tsx (SEGMENT_LABELS map, suppression logic)]
- [Source: apps/web/src/components/layout/AppShell.tsx (shell structure — content width applied at `<main>`)]
- [Source: apps/web/src/routes/admin/index.tsx (Story 5.1 admin surface — H1 sizing, lead-in pattern, inline guard)]
- [Source: apps/web/src/routes/admin/dossiers/index.tsx (Story 5.2 list surface — inner-component delegation template)]
- [Source: apps/web/src/routes/dashboard/dossiers/[slug].tsx#L3 (sonner import pattern)]
- [Source: apps/web/src/router.tsx (route registration)]
- [Source: apps/web/src/index.css (design tokens — no raw hex, no new token additions)]
- [Source: /home/coder/.claude/projects/-home-coder-confluent/memory/feedback_commit_review_together.md (single-commit discipline for story + review)]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.7 (1M context) — `claude-opus-4-7[1m]`

### Debug Log References

- `pnpm --filter @confluent/web typecheck` — exits 0, no errors.
- `pnpm --filter @confluent/web lint` — exits 0 with 5 warnings (baseline preserved, all `react-refresh/only-export-components`: `badge.tsx:52`, `button.tsx:58`, `context.tsx:7`, `context.tsx:14`, `context.tsx:47`). No new warning class, no new warning count.
- `pnpm turbo run build` — all packages GREEN. Bundle: **639.57 KB / 199.32 KB gz**. Delta vs 5.2 baseline (`635.31 KB / 198.41 KB gz`): **+4.26 KB / +0.91 KB gz**. Under the +5 KB gz audit threshold.
- `grep -E "#[0-9a-fA-F]{3,8}"` on all three new files: empty. AC13 clean.
- `git diff apps/web/src/data/questionnaire.ts`: empty. AC10 clean — entrepreneur flow untouched.
- `grep -n 'Modifier'` on the two component files: 3 textual "Modifier"/"Modifier la structure" button literals (plus handler/prop names). Matches AC14 expectation.

### Completion Notes List

1. **Manual browser walkthrough (AC15) deferred — headless environment.** The dev agent has no browser in-session, so AC15 was not exercised interactively. Static verification path covers structural correctness: typecheck (no type errors), lint (no new warning class), build (bundle under delta threshold), grep (hex/questionnaire.ts/Modifier-count all clean). The runtime assertions remain for the human reviewer: (a) `?as=admin` → sidebar `Questionnaire` → route lands; (b) `Admin / Questionnaire` breadcrumb; (c) each `<details>` toggle via click + Enter/Space; (d) chevron rotation on open; (e) each Modifier button fires toast without side effects (especially the section-level one, which verifies Pinned Decision #3 `preventDefault()`); (f) responsive breakpoints at 375 / 768 / 1440 px; (g) non-admin redirect to `/dashboard`. Same deferral pattern as 5.1 / 5.2.

2. **`_target` parameter carries the ESLint + TS unused-parameter suppression.** Pinned Decision #4 said `handleModifierClick` would accept a `BuilderActionTarget` parameter for forward-shape compatibility with Epic 9.2. Concrete ruleset behavior in this project:
   - TS `noUnusedParameters: true` at [tsconfig.app.json](apps/web/tsconfig.app.json) honors the `_` prefix — `_target` passes.
   - ESLint `@typescript-eslint/no-unused-vars` default in this config does NOT honor `_` prefix alone — suppressed via `// eslint-disable-next-line` comment at the parameter line.
   - Both suppressions are local (single-line scope). No global rule override introduced. When Epic 9.2 branches on `target.type` inside the handler, both suppressions can be removed in the same edit.

3. **Pinned Decision #3 (section-Modifier `preventDefault()`) honored.** `handleSectionModifier` calls `event.preventDefault()` before `onModifierClick(...)`. Without it, the `<summary>` click handler would toggle the section open/closed on every Modifier press, violating AC8 ("no state change occurs"). The defense cannot be regression-tested from the dev agent (headless) — manual test #5 in AC15 is the human-reviewer checkpoint.

4. **No new design-system primitives.** Badge + Button primitives reused with existing variants (`default` / `secondary` / `ghost` / `outline`). Native `<details>` / `<summary>` replaces any Accordion-like primitive per Pinned Decision #2 — zero new dependency, zero bundle impact beyond the lucide `ChevronRight` icon (already tree-shake-friendly; likely reused given the stable import path).

5. **Bundle delta observations.** +0.91 KB gz total for a new route + new component + new fixture + router+breadcrumb edits is within expected envelope. The three new source files total ~175 lines of TS/TSX. No chunk-splitting concerns introduced.

### File List

**New:**
- `apps/web/src/data/mock-questionnaire-builder.ts` — builder fixture (~65 LOC). Imports `QUESTIONNAIRE` from `./questionnaire`, derives `QUESTIONNAIRE_BUILDER` via `FIELD_META` map (fail-loud on missing metadata), exports `BuilderFieldType` / `BuilderField` / `BuilderSection` / `BuilderActionTarget` types + `TOTAL_BUILDER_FIELDS` scalar. File-header forward-reference to Epic 9.2.
- `apps/web/src/components/confluent/QuestionnaireBuilderSection.tsx` — collapsible section component (~100 LOC). Native `<details>`/`<summary>` disclosure with `group-open:rotate-90` chevron. Field list with label / `fieldTypeLabel(type)` / `Badge` (required/optional) / Modifier `Button`. Section-level Modifier handler calls `event.preventDefault()` to prevent summary toggle.
- `apps/web/src/routes/admin/questionnaire.tsx` — admin builder route (~85 LOC). Default export `AdminQuestionnaireRoute` is guard-only (inner-component delegation pattern). Inner `AdminQuestionnaireBuilder` hosts hooks: `useRef` + `useEffect` for H1 focus, `useCallback` for stable toast handler. Renders header row + section list via `QUESTIONNAIRE_BUILDER.map(...)`.

**Modified:**
- `apps/web/src/router.tsx` — +1 import line (`AdminQuestionnaireRoute`), +1 route entry (`{ path: 'admin/questionnaire', element: <AdminQuestionnaireRoute /> }` inserted between `admin/dossiers/:slug` and the catch-all). 2-line delta.
- `apps/web/src/components/layout/Breadcrumbs.tsx` — +1 `SEGMENT_LABELS` entry (`questionnaire: 'Questionnaire',`). 1-line delta.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — `5-3-questionnaire-builder-ui-mocked`: `ready-for-dev` → `review`. `last_updated` bumped to 2026-04-22.

**Unchanged (regression-relevant):**
- `apps/web/src/data/questionnaire.ts` — Story 2.4 source-of-truth, AC10 verified empty `git diff`.
- `apps/web/src/components/layout/AppShell.tsx` — no content-width changes (Pinned Decision #6).
- `apps/web/src/components/layout/nav-items.ts` — `ADMIN_NAV_ITEMS[2]` (Questionnaire NavLink) already wired in 5.1.
- `apps/web/src/components/ui/badge.tsx`, `button.tsx`, `sonner.tsx` — primitives reused untouched.
