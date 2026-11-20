# Story 2.4: QuestionnaireStep Component & Hardcoded Questions

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an entrepreneur filling out my dossier,
I want a focused, one-question-at-a-time interface,
so that the process feels clear, guided, and not overwhelming.

## Acceptance Criteria

1. **Given** the user lands on `/dashboard/dossiers/nouveau/questionnaire` with a valid `confluent_draft_name` in `localStorage`, **When** the page renders, **Then** the first question of Section 1 is shown as a `QuestionnaireStep` containing, in this vertical order: (a) a 3px-tall progress bar pinned to the top of `<main>` (full-width of the content area), filled with `bg-foreground` on a `bg-border` track, width = `(answeredCount / totalQuestions) * 100%` with the first question counted as 1/12 ≈ 8.33% on mount; (b) a step indicator `Section {N} · Question {k} sur {sectionLen}` rendered in `text-xs text-muted-foreground`; (c) the question text as an `<h1>` in `font-heading text-[28px] font-bold leading-tight text-foreground`; (d) an optional hint paragraph in `text-sm text-muted-foreground` below the `<h1>` when the question fixture defines `hint`; (e) a single `WizardInput` (reused from Story 2.3) as the answer field; (f) an action row containing a `Button size="lg" className="h-11 px-4"` labelled `OK →` and, immediately to its right with `ml-3` spacing, a ghost hint `ou Entrée ↵` in `text-xs text-muted-foreground`.

2. **Given** the hardcoded questionnaire fixture file `apps/web/src/data/questionnaire.ts`, **When** a developer inspects it, **Then** it exports a `const QUESTIONNAIRE` literal of exactly 3 sections × 4 questions = 12 questions total, with the following shape and content (French copy):
   - **Section 1 — Présentation** (`id: "presentation"`):
     - `{ id: "nom-projet", label: "Quel est le nom de votre projet&nbsp;?", hint: "Celui que vous préparez à partager avec des financeurs." }`
     - `{ id: "secteur", label: "Dans quel secteur d'activité évoluez-vous&nbsp;?" }`
     - `{ id: "maturite", label: "À quel stade de maturité en êtes-vous&nbsp;?", hint: "Idée, prototype, premier client, levée engagée…" }`
     - `{ id: "description-courte", label: "Décrivez votre projet en une phrase." }`
   - **Section 2 — Produit & Marché** (`id: "produit-marche"`):
     - `{ id: "probleme", label: "Quel problème résolvez-vous&nbsp;?" }`
     - `{ id: "solution", label: "Quelle est la solution que vous proposez&nbsp;?" }`
     - `{ id: "marche-cible", label: "Qui sont vos utilisateurs ou clients cibles&nbsp;?" }`
     - `{ id: "differenciateur", label: "Qu'est-ce qui vous distingue de la concurrence&nbsp;?" }`
   - **Section 3 — Finances & Équipe** (`id: "finances-equipe"`):
     - `{ id: "montant", label: "Quel montant recherchez-vous&nbsp;?", hint: "En euros, une fourchette ou un chiffre rond suffit." }`
     - `{ id: "usage-fonds", label: "À quoi ces fonds seront-ils alloués&nbsp;?" }`
     - `{ id: "taille-equipe", label: "Combien êtes-vous dans l'équipe aujourd'hui&nbsp;?" }`
     - `{ id: "profil-fondateur", label: "Quel est votre parcours en quelques mots&nbsp;?" }`
   The fixture also exports `QUESTIONNAIRE_FLAT: readonly QuestionMeta[]` — the 12 questions in section+index order, each annotated with its `sectionId`, `sectionTitle`, `sectionIndex` (1-based), `positionInSection` (1-based), and `globalIndex` (1-based). Types live alongside the fixture (not in `@confluent/shared` yet — see Pinned Decision #2).

3. **Given** the user types a non-empty trimmed answer, **When** they press Enter within the input OR click `OK →`, **Then** the answer is sanitised via `stripNonPrintable` (reused from Story 2.3) and trimmed; if the cleaned value is empty, nothing happens (the step stays put, no error UI is shown — the OK button is disabled in that state instead per AC7); otherwise the answer is written to `localStorage` under key `confluent_draft_{dossierName}` (where `{dossierName}` is the raw value from `confluent_draft_name`, not slugified, see Pinned Decision #3) as a JSON object `{ answers: Record<questionId, string>, position: globalIndex, updatedAt: isoString }`, then the next question slides in from below: the outgoing card translates upward with `translate-y-[-24px]` and `opacity-0` over 200ms `ease-out`; the incoming card starts with `translate-y-[24px]` + `opacity-0` and animates to `translate-y-0` + `opacity-100` over the same 200ms. The progress bar width transitions to the new percentage using `transition-[width] duration-200 ease-out`. Users with `prefers-reduced-motion: reduce` see an instant swap (no transform, `duration: 0`).

4. **Given** the user is on any question with `globalIndex > 1`, **When** they press the up arrow key (↑) anywhere that isn't inside an element which natively consumes arrow keys, OR click the back chevron `‹` rendered as a `Button variant="ghost" size="icon-sm"` in a footer row below the action row, **Then** the previous question is shown, the previously typed answer for that question is restored into the input from `answers[questionId]`, and the progress bar animates backward to reflect `(globalIndex - 1) / 12`. Going back from `globalIndex === 1` is a no-op (button is disabled; ↑ is swallowed).

5. **Given** the user has answered at least one question and closes the browser tab, **When** they return to `/dashboard/dossiers/nouveau/questionnaire`, **Then** the saved `{ answers, position }` tuple is read from `localStorage` under `confluent_draft_{dossierName}` and the component mounts on question `position` (clamped into `[1, 12]`) with its answer pre-filled and the progress bar already showing the corresponding width. If the key is missing or the JSON is malformed (`JSON.parse` throws OR the shape doesn't pass a lightweight runtime guard), the component silently falls back to `{ answers: {}, position: 1 }` — no toast, no inline error.

6. **Given** the `QuestionnaireStep` component, **When** a developer inspects the DOM, **Then** a single `<div role="status" aria-live="polite" aria-atomic="true">` element contains the current step indicator text (`Section {N} · Question {k} sur {sectionLen}`) so assistive tech announces the transition on each advance/back. The announcement swaps text content only (the element itself stays in the DOM permanently to guarantee re-announcement).

7. **Given** the questionnaire on any viewport, **When** the cleaned-trimmed input value is empty, **Then** the `OK →` button has `aria-disabled="true"` + `disabled` (via the Button primitive) AND the Enter-in-form `onSubmit` handler returns early without advancing. **When** the cleaned-trimmed input has content, **Then** the button re-enables and Enter advances. No inline validation message is shown in 2.4 — empty-answer feedback is the disabled button + unchanging step.

8. **Given** the questionnaire on mobile (< 768px), **When** the component renders, **Then** the `<h1>` font-size reduces to `text-[22px]` via a `md:text-[28px]` override, the OK/back buttons retain a ≥ 44 × 44 CSS tap target (already satisfied by `h-11` on OK and `icon-sm` → `size-7`; upgrade the icon button to `size-11` on mobile with `h-11 w-11 md:h-7 md:w-7` utility classes), and no element overflows horizontally — the action row wraps with `flex-wrap` below 380px screens.

9. **Given** the `QuestionnaireStep` header (progress bar + step indicator), **When** any route under `/dashboard/dossiers/nouveau/*` renders, **Then** no breadcrumb is shown — the existing `handle: { hideBreadcrumb: true }` marker from Story 2.3 on `dashboard/dossiers/nouveau/questionnaire` already satisfies this; verify at DOM-inspection time that no breadcrumb node exists. No router change is required by this story.

10. **Given** the user reaches the last question (`globalIndex === 12`) and submits a valid answer, **When** they press Enter or click `OK →`, **Then** the answer is persisted and the router navigates to `/dashboard/dossiers/nouveau/recapitulatif` (the destination owned by Story 2.5 — `SectionSummary`). Because Story 2.5 has not landed yet, **Then** a minimal 3-line stub page at `apps/web/src/routes/dashboard/dossiers/nouveau/recapitulatif.tsx` renders `<title>Récapitulatif · Confluent</title>` + `<h1>Récapitulatif</h1>` — same pattern as Story 2.3's questionnaire stub. The stub is registered in `router.tsx` with `handle: { hideBreadcrumb: true }`.

## Tasks / Subtasks

- [x] Task 1: Create the hardcoded questionnaire fixture (AC: 2)
  - [x] Create `apps/web/src/data/questionnaire.ts`. No `src/data/` directory exists yet; this file establishes it. Keep it as a flat singleton — no `index.ts` re-export, no nested folder — until a second fixture emerges.
  - [x] Export types (not via `@confluent/shared` — see Pinned Decision #2):
    ```ts
    export interface Question {
      readonly id: string           // e.g. "nom-projet" — stable identifier, kebab-case
      readonly label: string        // French, may contain `&nbsp;` (HTML-rendered — use `dangerouslySetInnerHTML`? NO — see below)
      readonly hint?: string        // optional sub-label in muted text
    }
    export interface Section {
      readonly id: string           // "presentation" | "produit-marche" | "finances-equipe"
      readonly title: string        // "Présentation" | "Produit & Marché" | "Finances & Équipe"
      readonly questions: readonly Question[]
    }
    export interface QuestionMeta extends Question {
      readonly sectionId: string
      readonly sectionTitle: string
      readonly sectionIndex: number       // 1-based across all sections
      readonly positionInSection: number  // 1-based within its section
      readonly globalIndex: number        // 1-based across the full 12-question flow
    }
    ```
  - [x] Export `QUESTIONNAIRE: readonly Section[]` with the exact 3 sections × 4 questions content from AC2. Use regular single-quoted apostrophes in the source (`d'activité`, `Qu'est-ce`) — TypeScript is happy with them in `'...'` string literals; no entity escaping needed in `.ts`.
  - [x] Handling of `&nbsp;` in labels: store the LITERAL string `Quel est le nom de votre projet\u00A0?` (unicode non-breaking-space, U+00A0) — NOT the HTML entity `&nbsp;`. Rendering is plain `{question.label}` as a React text node; React preserves U+00A0 as-is. This avoids `dangerouslySetInnerHTML` and its risks; the typographic rule (narrow no-break space before `?`) still holds. Document this choice in a `// NOTE:` comment above `QUESTIONNAIRE`.
  - [x] Export `QUESTIONNAIRE_FLAT: readonly QuestionMeta[]` — derive at module scope by flat-mapping `QUESTIONNAIRE` with `reduce` (not a `for`-loop; keeps the declaration a pure expression). Global index = 1 + the accumulator's current length; no off-by-one tolerated.
  - [x] Export a derived constant `TOTAL_QUESTIONS = QUESTIONNAIRE_FLAT.length` so callers never hardcode `12`. A TypeScript assertion `const TOTAL_QUESTIONS: 12 = QUESTIONNAIRE_FLAT.length as 12` would be ideal but requires `as const` throughout the fixture — skip the literal-type lock for this story and use `const TOTAL_QUESTIONS = QUESTIONNAIRE_FLAT.length` (inferred `number`). Story 2.5 can tighten if it matters.

- [x] Task 2: Create the `QuestionnaireStep` component (AC: 1, 3, 4, 6, 7, 8)
  - [x] File: `apps/web/src/features/questionnaire/components/QuestionnaireStep.tsx`. This establishes `features/questionnaire/` as a new feature module (matches architecture.md's `features/questionnaires/` folder convention — note the spec folder is plural `questionnaires`, but our application has a SINGLE questionnaire engine so we use the singular `questionnaire`; align with whichever singular/plural is already present in `src/features/`. As of Story 2.3, only `current-user/` exists — pick `questionnaire` singular to match `current-user/` singular style. Document the deviation from architecture.md in the Dev Notes and Pinned Decisions).
  - [x] Named export `QuestionnaireStep` — no default export (matches `components/confluent/` convention from 2.2/2.3).
  - [x] Props contract (FINAL — no `totalQuestions`, no `sectionLen`; the parent composes `indicatorText`):
    ```ts
    export interface QuestionnaireStepProps {
      question: QuestionMeta
      indicatorText: string                 // "Section 1 · Question 2 sur 4" — parent composes
      value: string                         // controlled input value (answers[question.id] ?? '')
      onChange: (next: string) => void
      onAdvance: (cleaned: string) => void  // fires on Enter or OK click when value is non-empty after clean+trim
      onBack: () => void                    // fires on ↑ or back chevron click; no-op caller side when at globalIndex=1
      canGoBack: boolean                    // drives disabled state on back chevron
    }
    ```
    Why the parent composes `indicatorText` rather than `QuestionnaireStep` deriving it from `question`: the component would otherwise need access to the full `QUESTIONNAIRE` array to look up `sectionLen`, which couples it to the fixture module. A plain string prop keeps the component data-shape-agnostic and trivially testable. The parent (questionnaire route) owns `answers`, `position`, `localStorage` persistence, AND the indicator composition. `QuestionnaireStep` is presentational + keyboard-aware; it does NOT read/write storage, does NOT import the fixture, and does NOT navigate routes.
  - [x] Internal structure (JSX sketch, annotated):
    ```tsx
    export function QuestionnaireStep({ question, indicatorText, value, onChange, onAdvance, onBack, canGoBack }: QuestionnaireStepProps) {
      const cleaned = stripNonPrintable(value).trim()
      const canAdvance = cleaned.length > 0

      function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
        if (e.key === 'ArrowUp' && canGoBack) {
          e.preventDefault()
          onBack()
        }
        // Enter is handled by the <form onSubmit> — do NOT duplicate here.
      }

      function handleSubmit(e: FormEvent<HTMLFormElement>) {
        e.preventDefault()
        if (!canAdvance) return
        onAdvance(cleaned)
      }

      return (
        <form onSubmit={handleSubmit} noValidate className="mx-auto flex max-w-xl flex-col gap-6 pt-8">
          {/* step indicator (live region) */}
          <div role="status" aria-live="polite" aria-atomic="true" className="text-xs text-muted-foreground">
            {indicatorText}
          </div>

          {/* question heading */}
          <h1 className="font-heading text-[22px] font-bold leading-tight text-foreground md:text-[28px]">
            {question.label}
          </h1>

          {/* optional hint */}
          {question.hint && (
            <p className="text-sm text-muted-foreground">{question.hint}</p>
          )}

          {/* answer input */}
          <WizardInput
            key={question.id}                // remount on question change so autoFocus fires
            autoFocus
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            aria-label={question.label}
            maxLength={2000}                 // multiline-baseline per 2.3 review convention
          />

          {/* action row */}
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" size="lg" className="h-11 px-4" disabled={!canAdvance}>
              OK →
            </Button>
            <span className="text-xs text-muted-foreground" aria-hidden="true">
              ou Entrée ↵
            </span>
          </div>

          {/* back affordance */}
          <div className="pt-2">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="h-11 w-11 md:h-7 md:w-7"
              onClick={onBack}
              disabled={!canGoBack}
              aria-label="Question précédente"
            >
              ‹
            </Button>
          </div>
        </form>
      )
    }
    ```
  - [x] DO NOT embed the progress bar inside `QuestionnaireStep` — the progress bar spans the full `<main>` width regardless of the question card's `max-w-xl`, so it must be rendered in the parent route above the card. Placing it inside `QuestionnaireStep` would either shrink it to the card width or force the component to know about its surrounding layout, both wrong.
  - [x] The `<WizardInput key={question.id}>` trick is deliberate: React remounts the input on every question change, which re-triggers `autoFocus` natively. Do NOT add a `useEffect` that calls `inputRef.current?.focus()` — the key-based remount is simpler, more predictable, and needs no cleanup. It also lets the parent keep `QuestionnaireStep` effect-free in terms of DOM focus management.

- [x] Task 3: Create the `QuestionnaireProgress` component (AC: 1, 3)
  - [x] File: `apps/web/src/features/questionnaire/components/QuestionnaireProgress.tsx`.
  - [x] Named export `QuestionnaireProgress`. Props:
    ```ts
    export interface QuestionnaireProgressProps {
      position: number              // 1-based current question index
      total: number                 // TOTAL_QUESTIONS
    }
    ```
  - [x] Implementation (plain div + inline width, no shadcn `Progress` — shadcn's `Progress` adds Radix semantics and 4px default thickness; we want a plain 3px bar, zero extra ARIA, and a pure CSS width transition):
    ```tsx
    export function QuestionnaireProgress({ position, total }: QuestionnaireProgressProps) {
      const percent = Math.round((position / total) * 100)
      return (
        <div aria-hidden="true" className="h-[3px] w-full overflow-hidden rounded-full bg-border">
          <div
            className="h-full bg-foreground transition-[width] duration-200 ease-out motion-reduce:transition-none"
            style={{ width: `${percent}%` }}
          />
        </div>
      )
    }
    ```
    `aria-hidden="true"` is intentional — the authoritative progress announcement is the step indicator text in `QuestionnaireStep`'s live region. The bar is pure visual feedback.
  - [x] `motion-reduce:transition-none` is a Tailwind arbitrary variant that expands to `@media (prefers-reduced-motion: reduce)`. It kills the width animation for users who've opted out.

- [x] Task 4: Rewrite the questionnaire route (AC: 3, 4, 5, 10)
  - [x] File: `apps/web/src/routes/dashboard/dossiers/nouveau/questionnaire.tsx`. Replace the current 3-line stub (which includes the draft-name guard patched in Story 2.3 review — KEEP that guard) with the full wizard engine.
  - [x] Preserve the existing guard:
    ```tsx
    if (!localStorage.getItem('confluent_draft_name')) {
      return <Navigate to="/dashboard/dossiers/nouveau" replace />
    }
    ```
    — this is a 2.3 code-review patch. Moving it into the component body (before any other hooks) preserves the contract "questionnaire cannot be reached without a draft name".
  - [x] State shape in the route component:
    ```ts
    type DraftState = {
      answers: Record<string, string>
      position: number
      updatedAt: string
    }

    const DRAFT_NAME_KEY = 'confluent_draft_name'
    function draftAnswersKey(name: string) {
      return `confluent_draft_${name}`
    }
    ```
  - [x] On mount, rehydrate draft state once via `useState(() => loadDraft())`:
    ```ts
    function loadDraft(dossierName: string): DraftState {
      try {
        const raw = localStorage.getItem(draftAnswersKey(dossierName))
        if (!raw) return { answers: {}, position: 1, updatedAt: new Date().toISOString() }
        const parsed = JSON.parse(raw) as unknown
        if (
          typeof parsed !== 'object' || parsed === null ||
          typeof (parsed as DraftState).position !== 'number' ||
          typeof (parsed as DraftState).answers !== 'object' ||
          (parsed as DraftState).answers === null
        ) {
          return { answers: {}, position: 1, updatedAt: new Date().toISOString() }
        }
        const clamped = Math.min(Math.max(1, (parsed as DraftState).position), TOTAL_QUESTIONS)
        return {
          answers: (parsed as DraftState).answers ?? {},
          position: clamped,
          updatedAt: (parsed as DraftState).updatedAt ?? new Date().toISOString(),
        }
      } catch {
        return { answers: {}, position: 1, updatedAt: new Date().toISOString() }
      }
    }
    ```
    The runtime guard is intentionally narrow — if any field is missing or of the wrong type, fall back to empty. No toast, no console.warn; the user gets a clean wizard.
  - [x] Persistence: after every `answers` or `position` mutation, write the full `{ answers, position, updatedAt }` back to `localStorage`. Do this via a dedicated `useEffect(() => { localStorage.setItem(...); }, [answers, position])` so state changes and writes stay colocated — not in each event handler.
  - [x] `handleAdvance(cleaned)`:
    ```ts
    function handleAdvance(cleaned: string) {
      const q = QUESTIONNAIRE_FLAT[position - 1]
      const nextAnswers = { ...answers, [q.id]: cleaned }
      setAnswers(nextAnswers)

      if (position >= TOTAL_QUESTIONS) {
        // persist then navigate
        localStorage.setItem(
          draftAnswersKey(dossierName),
          JSON.stringify({ answers: nextAnswers, position, updatedAt: new Date().toISOString() }),
        )
        navigate('/dashboard/dossiers/nouveau/recapitulatif')
        return
      }
      setPosition(position + 1)
    }
    ```
    The inline `setItem` before the last-question navigation guarantees the final answer is on disk before leaving the page — the `useEffect`-based write would race the route change.
  - [x] `handleBack()`: `if (position > 1) setPosition(position - 1)`. Never touch `answers` — going back pre-fills from existing `answers[q.id]`.
  - [x] Layout skeleton inside the route:
    ```tsx
    const dossierName = localStorage.getItem(DRAFT_NAME_KEY)!    // guarded above — non-null
    const currentQuestion = QUESTIONNAIRE_FLAT[position - 1]
    const sectionLen = QUESTIONNAIRE.find(s => s.id === currentQuestion.sectionId)!.questions.length
    const indicatorText = `Section ${currentQuestion.sectionIndex} · Question ${currentQuestion.positionInSection} sur ${sectionLen}`

    return (
      <>
        <title>Questionnaire · Confluent</title>
        <div className="-mx-6 -mt-8 md:-mx-6 md:-mt-8">
          {/* flush-to-edge progress bar: negative-margin escapes the AppShell <main>'s px-6 pt-8.
              Spec says "pinned to the top of the viewport"; the closest pragmatic interpretation
              within our shell is "pinned to the top of <main>, spanning its full content width,
              ignoring the 24px horizontal padding". */}
          <QuestionnaireProgress position={position} total={TOTAL_QUESTIONS} />
        </div>
        <QuestionnaireStep
          question={currentQuestion}
          indicatorText={indicatorText}
          value={answers[currentQuestion.id] ?? ''}
          onChange={(next) => setAnswers({ ...answers, [currentQuestion.id]: next })}
          onAdvance={handleAdvance}
          onBack={handleBack}
          canGoBack={position > 1}
        />
      </>
    )
    ```
  - [x] Slide transitions: implement via a local `direction` state (`'forward' | 'backward'` | `null`) set in the advance/back handlers, and a CSS class on the card root derived from direction:
    - forward (entering from below): `animate-slide-up-in` — defined as a small keyframe `from { opacity: 0; transform: translateY(24px) } to { opacity: 1; transform: translateY(0) }`.
    - backward (entering from above): `animate-slide-down-in` — `from { opacity: 0; transform: translateY(-24px) } to ...`.
    - Keyframe declarations live in `apps/web/src/index.css` under a new `@layer utilities`. Use Tailwind v4's `@utility` directive if a cleaner integration is preferred, but a raw `@keyframes` + `@utility` pair is fine here.
    - Gate both animations with `motion-safe:` so `prefers-reduced-motion: reduce` yields no animation (instant swap).
    - The OUTGOING card is not animated in this story (single-component swap pattern). A `AnimatePresence`-style dual-card cross-fade is premature for one caller — defer to Story 2.5 if SectionSummary needs coordinated transitions. Document this simplification in Completion Notes.
  - [x] `useState` layout in the route:
    ```ts
    const navigate = useNavigate()
    const dossierName = localStorage.getItem(DRAFT_NAME_KEY) ?? ''  // the Navigate guard already handled the null case
    const [draft, setDraft] = useState(() => loadDraft(dossierName))
    const { answers, position } = draft
    // split setters via an updater helper to keep one persistence effect:
    function patchDraft(patch: Partial<DraftState>) {
      setDraft((prev) => ({ ...prev, ...patch, updatedAt: new Date().toISOString() }))
    }
    ```
    — a single `draft` atom keeps the `useEffect` dependency list stable and the writes atomic. Do NOT split into `[answers, setAnswers]` + `[position, setPosition]` — two setters would create two consecutive renders on advance (each triggering a separate `useEffect` write) and could race.

- [x] Task 5: Add the `recapitulatif` stub route (AC: 10)
  - [x] Create `apps/web/src/routes/dashboard/dossiers/nouveau/recapitulatif.tsx`:
    ```tsx
    export default function RecapitulatifRoute() {
      return (
        <>
          <title>Récapitulatif · Confluent</title>
          <h1 className="font-heading text-2xl font-medium">Récapitulatif</h1>
        </>
      )
    }
    ```
    Mirror the 2.3 `questionnaire.tsx` stub pattern exactly, minus the draft-name guard (Story 2.5 owns the guard for the recap page).
  - [x] Register in `router.tsx`: add the import + route entry with `handle: { hideBreadcrumb: true }`, placed immediately after the `dashboard/dossiers/nouveau/questionnaire` entry (preserve the ordering: catch-all `*` must stay last):
    ```ts
    import RecapitulatifRoute from '@/routes/dashboard/dossiers/nouveau/recapitulatif'
    ...
    {
      path: 'dashboard/dossiers/nouveau/recapitulatif',
      element: <RecapitulatifRoute />,
      handle: { hideBreadcrumb: true },
    },
    ```

- [x] Task 6: CSS utilities for the slide transitions (AC: 3)
  - [x] Edit `apps/web/src/index.css`. Append at the bottom of the file (after the `@layer base` block):
    ```css
    @keyframes confluent-slide-up-in {
      from { opacity: 0; transform: translateY(24px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    @keyframes confluent-slide-down-in {
      from { opacity: 0; transform: translateY(-24px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    @utility animate-slide-up-in {
      animation: confluent-slide-up-in 200ms ease-out;
    }
    @utility animate-slide-down-in {
      animation: confluent-slide-down-in 200ms ease-out;
    }
    ```
    The `@utility` directive is Tailwind v4's first-class way to declare a custom utility (docs: tailwindcss.com/docs/adding-custom-styles#adding-custom-utilities). It makes `motion-safe:animate-slide-up-in` work transparently.
  - [x] Naming prefix `confluent-` on the keyframes avoids collision with `tw-animate-css` (which provides `animate-in slide-in-from-bottom` etc). Using `tw-animate-css`'s built-ins instead of custom keyframes is tempting — investigate at implementation time; if `animate-in slide-in-from-bottom duration-200` gives the exact spec (24px offset, 200ms, ease-out) with one className, prefer that and drop Task 6 entirely. If the library's offset is different (it commonly uses `translate3d(0, 100%, 0)` → off-screen, not the 24px nudge the spec wants), stick with the custom keyframes above.

- [x] Task 7: Accessibility & keyboard verification (AC: 4, 6, 7)
  - [x] `<h1>` is the only `<h1>` on the page — `/dashboard/dossiers/nouveau` (Story 2.3) uses an `<label>` as the visually heading-like element, so there's no conflict crossing routes. Verify with axe that the page has exactly one `<h1>`.
  - [x] The `role="status"` + `aria-live="polite"` region announces the step indicator on question change. Test with VoiceOver (Ctrl+Option+A on macOS) OR NVDA (Insert+Down on Windows) — expect: "Section 1 Question 2 sur 4" spoken on Enter advance.
  - [x] `aria-label={question.label}` on the `WizardInput` — the input has no visible `<label>` (the `<h1>` question IS the label conceptually, but `<h1>` is a heading, not a form label). Using `aria-label` with the full question string keeps SR announcement correct. Do NOT wrap the `<h1>` in a `<label htmlFor>` — semantically wrong, and it would give the heading click-to-focus-input behavior which conflicts with normal heading navigation.
  - [x] `disabled` on the OK button when the answer is empty — the Button primitive handles `disabled` via Base UI; verify the `active:not-aria-[haspopup]:translate-y-px` default in the primary variant still fires only when enabled (Base UI blocks pointer-down events when `disabled`).
  - [x] Up-arrow keyboard nav: `handleKeyDown` on the `WizardInput` intercepts `ArrowUp` and calls `onBack()`. Caret-at-start in a text input doesn't natively move the caret elsewhere on ↑ — the key IS available for our use. Down-arrow is NOT bound (no-op), reserved for a future multi-line answer mode.
  - [x] Skip-link / tab order on this route: SkipLink → Sidebar → (no breadcrumb) → Progress bar (aria-hidden, skipped) → Live region (aria-live, not focusable) → `<h1>` (not focusable) → Hint `<p>` (skipped) → Input (autofocused on mount + remount) → OK button → Hint span (aria-hidden, skipped) → Back chevron. Shift+Tab correctly walks up. Verify that after Enter-advance, focus lands on the newly-remounted `WizardInput` via `autoFocus` — no manual focus management needed.

- [x] Task 8: Responsive verification (AC: 8)
  - [x] 375 px mobile: question `<h1>` at 22 px, input readable, OK button 44 × 44, back chevron upgraded to 44 × 44. Action row `flex-wrap` — OK + hint fit on one line, hint wraps below on ~320 px screens. No horizontal scroll.
  - [x] 900 px tablet: `<h1>` upgrades to 28 px at 768 px, content column `max-w-xl` ≈ 576 px centered.
  - [x] 1440 px desktop: same column, abundant whitespace, progress bar spans full `<main>` content width (minus AppShell's `px-6` — the negative-margin escape is intentional).
  - [x] `prefers-reduced-motion` toggle (Chrome DevTools: Rendering → Emulate CSS media feature): verify the slide-in is disabled, progress bar width change is instant.

- [x] Task 9: Verify the full pipeline (AC: 1-10)
  - [x] `pnpm turbo run typecheck` → 2 successful, 0 errors. Expect new types `Question`, `Section`, `QuestionMeta`, `QuestionnaireStepProps`, `QuestionnaireProgressProps`, `DraftState` to compile cleanly.
  - [x] `pnpm turbo run lint` → 0 errors. 3 tolerated pre-existing warnings (badge, button, current-user) still accepted. Zero new warnings.
  - [x] `pnpm turbo run build` → 2 successful, 0 errors. Bundle delta expected: +1–2 kB gzip CSS (keyframes + utilities), +2–4 kB gzip JS (QuestionnaireStep + QuestionnaireProgress + fixture + route logic).
  - [x] `pnpm turbo run dev` → manual walkthrough:
    1. Go to `/dashboard`. Click `Créer un dossier`. Type "Biosensio". Press Enter.
    2. Land on `/dashboard/dossiers/nouveau/questionnaire`. Progress bar ≈ 8% (1/12). Indicator: "Section 1 · Question 1 sur 4". H1: "Quel est le nom de votre projet&nbsp;?". Hint visible.
    3. Type "Biosensio Bioreactor Platform". Press Enter. Verify: slide-up transition, progress bar grows to ≈ 16%, indicator → "Section 1 · Question 2 sur 4", input auto-focuses empty.
    4. Press ↑. Verify: slide-down transition (backward), progress bar shrinks, indicator → "Section 1 · Question 1 sur 4", input pre-fills "Biosensio Bioreactor Platform".
    5. Press Enter (value unchanged) → advances again. Answer question 2 with "Biotech / DeepTech". Continue through all 12 questions.
    6. On question 12, press Enter → navigates to `/dashboard/dossiers/nouveau/recapitulatif` stub. Check DevTools: `localStorage.getItem('confluent_draft_Biosensio')` exists, contains all 12 answers + position 12.
    7. Reload the questionnaire route with `confluent_draft_Biosensio` present + `position: 7`: lands on question 7, input pre-filled with answer 7, progress ≈ 58%.
    8. Corrupt the stored JSON (DevTools → Application → Local Storage → edit the value to `"not-json"`): reload → graceful fallback to question 1, empty answers.
    9. Clear `confluent_draft_name`: navigate to `/dashboard/dossiers/nouveau/questionnaire` directly → redirects to `/dashboard/dossiers/nouveau` (2.3 guard preserved).
    10. On question 1 with empty input, verify OK button is disabled AND Enter in the form is a no-op.
    11. `prefers-reduced-motion: reduce` → transitions are instant.
    12. VoiceOver/NVDA sanity check: enable SR, advance through 2 questions, confirm step indicator is announced.

### Review Findings

Code review date: 2026-04-20. Three adversarial layers: Blind Hunter, Edge Case Hunter, Acceptance Auditor. ~45 raw findings → 8 patches, 8 defers, ~29 dismissed (spec-pinned or noise).

**Patches (to apply):**

- [x] [Review][Patch] Move the `role="status" aria-live="polite"` region out of `QuestionnaireStep` into the questionnaire route — above the keyed `<div>` wrapper — so the live region persists across step remounts. The step now renders only a visual (non-live) indicator; a separate `sr-only` live region in the route persists and swaps text only, guaranteeing SR re-announcement per AC6. [apps/web/src/features/questionnaire/components/QuestionnaireStep.tsx:62, apps/web/src/routes/dashboard/dossiers/nouveau/questionnaire.tsx:158-165]
- [x] [Review][Patch] Add IME-composition guards: `if (e.nativeEvent.isComposing) { if (e.key === 'Enter') e.preventDefault(); return }` in `handleKeyDown`. Prevents French accent / dead-key / CJK input methods from triggering back-nav or premature submit mid-composition. [apps/web/src/features/questionnaire/components/QuestionnaireStep.tsx:31-35]
- [x] [Review][Patch] Add modifier-key guards on the ArrowUp branch: `!e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey` — Shift/Cmd/Ctrl/Alt+↑ are reserved for native text-selection and browser shortcuts. Applied on both the input-level handler and the route-level document listener. [apps/web/src/features/questionnaire/components/QuestionnaireStep.tsx:36-48, apps/web/src/routes/dashboard/dossiers/nouveau/questionnaire.tsx:79-95]
- [x] [Review][Patch] Tighten `loadDraft` runtime guard with `!Number.isFinite(parsed.position)`. A corrupted-JSON `position: NaN` passed `typeof === 'number'` previously; now it's rejected and we fall back to `emptyDraft()`. [apps/web/src/routes/dashboard/dossiers/nouveau/questionnaire.tsx:37]
- [x] [Review][Patch] Replaced `aria-label={question.label}` on the `WizardInput` with `aria-labelledby={headingId}` pointing to the `<h1>` (id `questionnaire-current-question`). Avoids the double-announcement of the question text when the input gains focus. [apps/web/src/features/questionnaire/components/QuestionnaireStep.tsx:64-76]
- [x] [Review][Patch] Wrapped the decorative `→` glyph inside the OK button in `<span aria-hidden="true">`. Screen readers now announce the button as "OK button" rather than "OK right-arrow button". The `↵` hint already had `aria-hidden="true"` at the span level, and the back-chevron `‹` is already overridden by `aria-label="Question précédente"`. [apps/web/src/features/questionnaire/components/QuestionnaireStep.tsx:82-84]
- [x] [Review][Patch] ~~In `handleAdvance`'s final-question branch, bump the displayed progress to 100% before navigating.~~ **Dismissed after investigation** — the implementation already uses position-based progress (not answered-count-based), so Q12 renders 12/12 = 100% while the user is answering the final question. The Blind Hunter finding was based on a misread of the flow. No patch needed.
- [x] [Review][Patch] Added a route-scoped `useEffect` that attaches a `keydown` listener on `window` matching AC4's literal wording. It fires `onBack()` on ArrowUp when the event target is NOT a native arrow-key consumer (`<input>`, `<textarea>`, `<select>`, `contenteditable`), with the same IME + modifier guards as the input-level handler. Today this matters for users who have clicked the back chevron and then press ↑ — previously ArrowUp was a no-op there. [apps/web/src/routes/dashboard/dossiers/nouveau/questionnaire.tsx:77-100]

**Deferred (acknowledged, not actionable now):**

- [x] [Review][Defer] No schema/version field on the persisted draft — renaming a question `id` across releases orphans the stored answer forever; a persisted `position` from a prior build could reference deleted questions. Deferred to Epic 7 (Story 7.3) which introduces `questionnaire_version_id` snapshot-per-dossier; migration strategy is a backend concern, not a 2.4 concern.
- [x] [Review][Defer] State/submit string divergence: `value` (state, raw) vs `cleaned` (submitted, sanitised+trimmed) can diverge during the typing window — a user who navigates back via ArrowUp sees the raw whitespace value pre-filled, but submitting writes the cleaned version. Low impact (no user-visible bug in the 12-question hardcoded flow); revisit if textarea types arrive in Epic 5/7.
- [x] [Review][Defer] `maxLength={2000}` silently truncates paste with no user-visible feedback (no char counter, no warning toast). 2000 chars is unlikely to be hit in Epic 2's single-line question flow; revisit when multiline/textarea field-types land.
- [x] [Review][Defer] `dossierName` used raw as the storage-key suffix — names with unusual whitespace or with the literal prefix `confluent_draft_` can collide. Pinned Decision #3 intentionally preserves the raw name to match Story 2.3's write contract. Epic 7 server-side identity replaces local keys entirely.
- [x] [Review][Defer] Per-keystroke `JSON.stringify(draft)` in the persistence `useEffect` with `updatedAt` touching on every change — no debounce, no `requestIdleCallback`. Negligible for 12 short answers (~2 KB serialisation, sub-ms on any device), but worth profiling once longer/multiline answers arrive in Epic 7.
- [x] [Review][Defer] No `errorElement` / route-level `<ErrorBoundary>` wrapping the wizard — a thrown render error (e.g. stale cross-tab state, malformed future schema) still white-screens the app. Already deferred from Story 1.3 and Story 2.1; revisit alongside `errorElement` wiring in a dedicated a11y/resilience pass.
- [x] [Review][Defer] Cross-tab stomp on `confluent_draft_{dossierName}` — Story 2.3 already deferred this for `confluent_draft_name`; Story 2.4 enlarges the blast radius (12 answers instead of 1 name). Same resolution path: Epic 7 real-API persistence makes it moot.
- [x] [Review][Defer] Rapid advance/back pressure during the 200ms slide animation can produce overlapping transitions / visual flicker. Keyed-remount semantics keep state correct, only the animation timeline is briefly inconsistent. Low user impact; revisit if a review reports visible glitching.

**Dismissed (spec-pinned, out-of-scope, or false positive):** Early-return-then-sub-component-with-hooks (correct RoH pattern, not a violation), `localStorage.setItem` without try/catch (spec "Latest Technical Information" explicitly rationalises no try/catch for this volume), double-write on final-question submit (pinned to beat the `useEffect` race), `autoFocus` steals focus on remount (Pinned #5), keyframes "no reduced-motion guard at keyframe level" (class-level `motion-safe:` is the standard pattern; SPA has no SSR hydration), progress bar `aria-hidden` "no textual equivalent" (indicator text is the accessible equivalent; per-section position is spec'd), recap stub "broken end-of-flow no cleanup" (Story 2.5 owns the summary, 2.6 owns cleanup, both already deferred), `O(n)` spread per keystroke (n ≤ 12, negligible), `updatedAt` nondeterminism in strict mode (`useState` init is double-invoked but only one value kept; event handlers not double-invoked), no CSP-sanitisation of `question.label` (static TS bundle, Zod lands in Epic 7), `maxLength` paste truncation (browser enforces `maxLength` on paste per W3C), tap target `h-7` WCAG 2.5.8 violation (28 × 28 > 24 × 24 floor — compliant), `answers` array-shape passes guard (behaviourally identical), NaN/empty/negative position division (already addressed in E2 patch + clamp), recap route accessible without draft (Story 2.5 owns the guard), recap with incomplete answers (Story 2.5 owns the guard), whitespace-only answer in state (never advances — trivial), total=0 division (TOTAL_QUESTIONS is a const), gap-3 vs ml-3 on action row (sanctioned in Task 2 sketch), outgoing-card animation missing (Task 4 sub-bullet + Completion Note 6 explicitly sanction this simplification), `md:-mx-6 md:-mt-8` redundancy (negative margins already apply at all breakpoints), `patchDraft` Omit<'updatedAt'> (improvement over sketch, not a deviation), `loadDraft` answers `?? {}` fallback omitted (guard rejects null/non-object before the fallback is reachable).

## Dev Notes

### Critical Architecture Constraints

- **Feature module lives at `apps/web/src/features/questionnaire/`** — NOT `features/questionnaires/` (plural, per `architecture.md` line 656) — because (a) the project has a SINGLE questionnaire engine in v1 + foreseeable roadmap, (b) only `features/current-user/` exists today and uses singular, so matching the existing convention beats matching the spec's plural. Document this deviation in Pinned Decision #1. Revisit at Epic 9 if admin QuestionnaireBuilder introduces a second feature module. [Source: [_bmad-output/planning-artifacts/architecture.md](_bmad-output/planning-artifacts/architecture.md#L620-L673)#Frontend Source Structure, apps/web/src/features/current-user/]
- **Hardcoded data lives in `apps/web/src/data/`** — new directory; sibling to `features/`, `components/`, `lib/`, `routes/`. This establishes a convention: Epic 2's mocked fixtures all land here (dashboard list fixture in Epic 3 will extend it). The questionnaire fixture is TypeScript (not JSON) so the type system enforces shape correctness. Keep it flat (no `data/index.ts`) until a second fixture emerges. [Source: epics.md#Epic 2 ("Zero API calls — all state lives in React"), ux-design-specification.md#Typeform-style flow]
- **Reuse `WizardInput` from Story 2.3** — same bottom-border-only styling, same `Omit<'type' | 'className'>` type lock. Do NOT fork a `QuestionnaireInput` variant. The `text-lg` (≈ 18px) size already matches the UX spec's "18px input" requirement for QuestionnaireStep. [Source: apps/web/src/components/confluent/WizardInput.tsx, ux-design-specification.md#L529]
- **Reuse `stripNonPrintable` from Story 2.3** — same C0-control + zero-width + bidi-override + BOM stripping logic. Called at submit time, before the trim + empty-check. Do NOT re-implement or duplicate in `features/questionnaire/`. [Source: apps/web/src/lib/sanitize.ts, 2-3-dossier-creation-naming-step.md#Review Findings — Patches]
- **Design tokens only — no raw hex.** The 3px progress track uses `bg-border` (= `#E8E8E7`), fill uses `bg-foreground` (= `#37352F`). Step indicator `text-muted-foreground` (= `#6B6B6B`). Question `<h1>` `text-foreground` (= `#1A1A1A`). [Source: apps/web/src/index.css]
- **React Router v7 library mode.** `useNavigate` from `react-router-dom`. `<Navigate to="..." replace />` JSX element for the draft-name guard (preserved from Story 2.3 review patch). The `handle: { hideBreadcrumb: true }` pattern handles breadcrumb suppression — no breadcrumb code touched in this story. [Source: apps/web/src/router.tsx, apps/web/src/components/layout/Breadcrumbs.tsx]
- **No React Hook Form + Zod in Epic 2.** Same reasoning as Story 2.3: one field per step, client-side-only validation (non-empty after sanitise+trim), no backend schema to mirror yet. `useState` + a few handlers are strictly less code than any form library. RHF + Zod arrive naturally in Epic 7 when `packages/shared` exposes real Zod schemas and TanStack Query mutations kick in. [Source: [_bmad-output/planning-artifacts/architecture.md](_bmad-output/planning-artifacts/architecture.md#L224-L230)#Frontend Architecture, 2-3-dossier-creation-naming-step.md#Pinned #4]
- **localStorage is the single persistence layer.** Keys this story touches: reads `confluent_draft_name` (written by 2.3), reads/writes `confluent_draft_{dossierName}` (new, scope of this story). No sessionStorage. No React context. No Zustand store. No IndexedDB wrapper. Story 2.6 will clean up both keys on dossier completion. [Source: epics.md#Epic 2, 2-3-dossier-creation-naming-step.md#Decision #3]
- **French copy, hardcoded in JSX + fixture.** No i18n setup. Question labels contain typographically correct narrow no-break-space before French punctuation — stored as literal U+00A0 in `.ts` source, rendered as plain text nodes (no `dangerouslySetInnerHTML`, no HTML entity decoding). [Source: 2-1/2-2/2-3 anti-patterns]
- **WCAG 2.1 AA baseline.** `aria-live="polite"` for step transitions (NOT `assertive` — step changes are user-initiated, polite is appropriate per WAI-ARIA authoring practices). `aria-label` on the unlabeled input (the `<h1>` is a heading, not a form label). Empty-answer feedback = `disabled` OK button + no advance (no inline error — spec explicitly avoids per-keystroke validation noise). Back button `aria-label="Question précédente"`. 44 × 44 touch targets on mobile for both OK and back. `prefers-reduced-motion: reduce` disables all transitions. [Source: [_bmad-output/planning-artifacts/ux-design-specification.md](_bmad-output/planning-artifacts/ux-design-specification.md#L380-L395)#Accessibility, UX-DR14]

### Design Tokens to Use

| Surface | Tailwind utility | Value | Where |
|---|---|---|---|
| Progress track | `bg-border` | `#E8E8E7` | `QuestionnaireProgress` outer div |
| Progress fill | `bg-foreground` | `#37352F` | `QuestionnaireProgress` inner div |
| Step indicator | `text-xs text-muted-foreground` | 12px / `#6B6B6B` | Live region above `<h1>` |
| Question heading | `font-heading text-[22px] md:text-[28px] font-bold text-foreground` | 22→28px / `#1A1A1A` | `<h1>` |
| Hint | `text-sm text-muted-foreground` | 14px / `#6B6B6B` | Optional `<p>` below `<h1>` |
| Input underline (reused) | per `WizardInput` | — | Answer field |
| OK button | `bg-primary text-primary-foreground h-11 px-4` (via Button size=lg) | `#37352F` / white | "OK →" |
| Enter hint | `text-xs text-muted-foreground` | 12px / `#6B6B6B` | "ou Entrée ↵" inline hint |
| Back chevron | `variant="ghost" size="icon-sm" h-11 w-11 md:h-7 md:w-7` | — | `‹` icon button |

### Component Prop Contracts (exhaustive)

```ts
// apps/web/src/data/questionnaire.ts
export interface Question { readonly id: string; readonly label: string; readonly hint?: string }
export interface Section { readonly id: string; readonly title: string; readonly questions: readonly Question[] }
export interface QuestionMeta extends Question {
  readonly sectionId: string
  readonly sectionTitle: string
  readonly sectionIndex: number       // 1-based
  readonly positionInSection: number  // 1-based
  readonly globalIndex: number        // 1-based
}
export const QUESTIONNAIRE: readonly Section[]
export const QUESTIONNAIRE_FLAT: readonly QuestionMeta[]
export const TOTAL_QUESTIONS: number  // = QUESTIONNAIRE_FLAT.length (12)

// apps/web/src/features/questionnaire/components/QuestionnaireStep.tsx
export interface QuestionnaireStepProps {
  question: QuestionMeta
  indicatorText: string
  value: string
  onChange: (next: string) => void
  onAdvance: (cleaned: string) => void
  onBack: () => void
  canGoBack: boolean
}

// apps/web/src/features/questionnaire/components/QuestionnaireProgress.tsx
export interface QuestionnaireProgressProps {
  position: number
  total: number
}
```

### File Layout (target)

```
apps/web/src/
├── components/
│   ├── confluent/
│   │   ├── EmptyState.tsx                           [UNCHANGED]
│   │   ├── WizardInput.tsx                          [UNCHANGED — reused]
│   │   └── illustrations/
│   │       └── EmptyDossiersIllustration.tsx       [UNCHANGED]
│   └── layout/
│       └── Breadcrumbs.tsx                          [UNCHANGED — handle suppression already wired]
├── data/                                            [NEW FOLDER]
│   └── questionnaire.ts                             [NEW — 3 sections × 4 questions fixture]
├── features/
│   ├── current-user/
│   │   └── context.tsx                              [UNCHANGED]
│   └── questionnaire/                               [NEW FOLDER]
│       └── components/
│           ├── QuestionnaireStep.tsx                [NEW — per-question presentational]
│           └── QuestionnaireProgress.tsx            [NEW — 3px top progress bar]
├── lib/
│   └── sanitize.ts                                  [UNCHANGED — reused]
├── routes/
│   └── dashboard/
│       └── dossiers/
│           └── nouveau/
│               ├── index.tsx                        [UNCHANGED — 2.3 naming step]
│               ├── questionnaire.tsx                [REWRITTEN — full wizard engine]
│               └── recapitulatif.tsx                [NEW — stub for Story 2.5]
├── index.css                                        [MODIFIED — 2 keyframes + 2 @utility declarations]
└── router.tsx                                       [MODIFIED — +1 import, +1 route with handle]
```

### Previous Story Intelligence

**From Story 2.3 (just landed):**
- `WizardInput` primitive is ready for reuse. Keyed remount trick (`<WizardInput key={question.id} autoFocus />`) is the clean way to re-fire `autoFocus` on each question advance — no `useEffect` or refs needed for focus.
- `stripNonPrintable` utility ships in `apps/web/src/lib/sanitize.ts`. Apply at submit time, not on keypress. Questionnaire answers are longer than the dossier name — `maxLength={2000}` is the established multi-line/long-text ceiling per 2.3's code-review convention.
- `/dashboard/dossiers/nouveau/questionnaire` already has the `handle: { hideBreadcrumb: true }` marker — 2.4 preserves it. The existing 3-line stub IS the surface this story replaces; the `<Navigate>` guard added in 2.3 code-review (patch #1) MUST be preserved at the top of the new route component.
- `DRAFT_NAME_KEY = 'confluent_draft_name'` is the contract between 2.3 (writer) and 2.4 (reader). Do NOT rename. Story 2.6 will clear it.
- Sidebar-deactivation on wizard routes is a deliberate non-fix from 2.2 review, preserved by 2.3 Pinned Decision #7. It stays deliberate for 2.4 — the Typeform focus intentionally removes ambient chrome. No action needed.
- Button `size="lg" className="h-11 px-4"` is the mobile-tap-target recipe established by 2.2 review and reused by 2.3. Apply the same recipe to the OK button here. For the back chevron, use `size="icon-sm"` with mobile-responsive upgrade via `h-11 w-11 md:h-7 md:w-7`.
- The `confluent/` directory is for design-system-level primitives. `QuestionnaireStep` and `QuestionnaireProgress` are feature-scoped (they know about `QuestionMeta`), so they live under `features/questionnaire/components/`, not `components/confluent/`. This boundary is pinned.

**From Story 2.2:**
- `components/confluent/` convention for custom design-system primitives. Not touched this story (we use `features/questionnaire/components/` instead).
- No `cva` variant system yet — pinned #6 from 2.2 still applies. Do NOT wrap `QuestionnaireStep` in `cva`. One caller (the questionnaire route) ships now; introduce variants only when a third caller diverges.

**From Story 2.1:**
- `AppShell` mounts `<main id="main-content" tabIndex={-1} className="flex-1 px-6 py-8 pb-16 md:pb-0 ...">`. The progress bar escape via `className="-mx-6 -mt-8"` on its wrapper div pulls it flush to `<main>`'s edges — intentional per AC1's "top of the viewport" requirement as applied within our shell.
- Tab order: SkipLink → Sidebar → (no breadcrumb on wizard) → Main content. Input `autoFocus` on first mount steals focus but keyboard users can Shift+Tab back up the tree.
- Breadcrumb handle-based suppression already covers `/dashboard/dossiers/nouveau/questionnaire` and is about to cover `/dashboard/dossiers/nouveau/recapitulatif` (Task 5).

**Deferred items still open (from 2.3 review) that 2.4 SHOULD be aware of but NOT solve:**
- Concurrent-tab stomp on localStorage keys (same key, no per-tab scope). 2.4 INCREASES blast radius (more answers to lose on stomp). Still deferred — Epic 7 real-API persistence solves it naturally.
- `handle` suppression has no "child un-suppresses parent" — no route needs the inverse direction in 2.4.
- `RouteHandle` cast trusts `useMatches` output shape — not a 2.4 concern.
- Wizard step has no in-page cancel/back affordance to the dashboard — 2.4 adds a back-to-previous-question chevron but NOT an exit-wizard affordance. Still deferred.
- `confluent_draft_name` + `confluent_draft_{dossierName}` cleanup — 2.6 will clear both on completion. Cross-reference explicitly when 2.6 is created.

### Git Intelligence

Recent commits on `feat/epic-1` (reverse chronological):

1. `c1a6ef0 fix(epic-2): story 2.3 code-review patches` — most recent. Added `<Navigate>` guard on `/questionnaire`, `stripNonPrintable` at `lib/sanitize.ts`, `maxLength={120}` on naming input, `useRef` focus-on-error, `aria-live="assertive"` error region, localStorage rehydrate.
2. `7cfa8df feat(epic-2): story 2.3 — dossier creation naming step` — WizardInput primitive, `nouveau/` folder restructure, `handle: { hideBreadcrumb: true }` mechanism.
3. `f8442b6 fix(epic-2): story 2.2 code-review patches`
4. `a38e7b2 feat(epic-2): story 2.2 — dashboard empty state`
5. `7b4be2e feat(epic-2): story 2.1 — app shell, responsive sidebar, breadcrumbs`

Pattern: one `feat` commit per story (`feat(epic-N): story N.M — <title>`), followed by a `fix` commit with code-review patches (`fix(epic-N): story N.M code-review patches`) — **BUT** user memory ([Code + review in a single commit](../../.claude/projects/-home-coder-confluent/memory/feedback_commit_review_together.md)) says to bundle implementation and review patches into a single commit. Apply that: Story 2.4 lands as one `feat(epic-2): story 2.4 — questionnaire step component & hardcoded questions` commit that includes both initial implementation AND whatever patches code-review produces. No `fix(epic-2): story 2.4 code-review patches` follow-up.

### Anti-Patterns to Avoid

- **Do NOT embed the progress bar inside `QuestionnaireStep`.** Progress bar spans the full `<main>` edge-to-edge; the question card is `max-w-xl` centered. Nesting would either shrink the bar or force cross-component layout knowledge. Keep the two components siblings in the route.
- **Do NOT use shadcn's `Progress` component.** Radix adds aria semantics (`role="progressbar"`, `aria-valuenow`…) that conflict with our `aria-hidden="true"` intent — the authoritative announcement is the step indicator text, not the bar. A plain 2-div implementation is 10 lines shorter and exactly controllable.
- **Do NOT use React Hook Form for a single-field-per-step form.** Same reasoning as 2.3. Revisit at Epic 7.
- **Do NOT persist via React context or Zustand.** Direct `localStorage` calls only, wrapped by the route's `loadDraft()` helper and a single `useEffect` writer. Story 2.6 abstracts both keys if a `useDossierDraft()` hook becomes justified.
- **Do NOT render `label` with `dangerouslySetInnerHTML`.** Store U+00A0 literal in the fixture; React renders plain text nodes. HTML entities in `.ts` files would need `dangerouslySetInnerHTML` to decode, which opens XSS surface for a non-value gain.
- **Do NOT slugify `{dossierName}` in the storage key.** The key is `confluent_draft_{dossierName}` with the RAW trimmed name (e.g. `confluent_draft_Biosensio`, `confluent_draft_Projet Beta`). Slugification would diverge from the 2.3 write contract and require a matching transform in Story 2.6 cleanup. Pinned Decision #3.
- **Do NOT trim the value during typing.** Trim at submit time only. Matches 2.3's precedent.
- **Do NOT show inline validation text in 2.4.** Empty-answer feedback is the disabled OK button — per AC7. Adding a "Ce champ est requis" message would be per-keystroke noise and conflict with the Typeform philosophy of friction-free inputs.
- **Do NOT auto-advance on Enter when the input is empty.** The disabled state + no-op submit handler handles this idempotently.
- **Do NOT bind Down-arrow or Backspace-at-caret-0 to navigation.** Only ↑ is spec'd for back-nav (AC4). Extra bindings are premature UX.
- **Do NOT skip `motion-reduce:` variants on the slide animations.** WCAG 2.3.3 Animation from Interactions requires respecting the media query. Tailwind v4 exposes this transparently.
- **Do NOT extend `QuestionnaireStep` to own the section summary.** SectionSummary is a sibling (Story 2.5). Don't preemptively add branching logic for "am I on the last question of a section" — 2.5 adds that as a different route/view, not a `QuestionnaireStep` mode.
- **Do NOT write the answers JSON without `updatedAt`.** The field is tiny (ISO string) and makes later conflict-resolution debugging tractable. Cost ≈ 30 bytes per write; benefit is real.
- **Do NOT hardcode `12` anywhere in component or route code.** Use `TOTAL_QUESTIONS` from the fixture. Any renumbering of the questionnaire must cascade through one constant only.
- **Do NOT use `QuestionnaireBuilder` paths from architecture.md** — that's Epic 9. 2.4 is hardcoded-only.
- **Do NOT rename `questionnaire.tsx` → `questionnaire/index.tsx` proactively.** The route currently exists as a single file; the folder pattern was introduced in 2.3 for `nouveau/` because it grew children. `questionnaire.tsx` + `recapitulatif.tsx` as siblings is the right shape; `questionnaire/` would only win if it grew sub-routes (not planned).

### Testing Requirements

- **Unit / integration tests remain out of scope** for Epic 2 frontend — no Vitest/RTL harness. Do not introduce one here.
- **Manual verification is the primary gate** (Tasks 7–9). Tri-viewport walkthrough (375 px / 900 px / 1440 px), axe audit on `/dashboard/dossiers/nouveau/questionnaire` in: (a) first question state, (b) mid-flow state with prior answer pre-filled via localStorage, (c) empty-answer state with disabled OK. Screen-reader sanity check (VoiceOver or NVDA) for step-indicator live-region announcement. `prefers-reduced-motion` toggle.
- **Type safety:** `QuestionMeta` is the single source of truth for a question's identity + position. Props use `readonly` on array/tuple types from the fixture. `DraftState` in the route is the local persistence type; the runtime guard (narrow `typeof` checks) narrows `unknown` → `DraftState` or falls back.
- **No new lint warnings permitted** beyond the 3 tolerated ones from Stories 2.1/2.2/2.3.
- **No regression on prior stories:** `/dashboard` empty state + CTA still work, `/dashboard/dossiers/nouveau` naming step still persists to `confluent_draft_name` and navigates, `/dashboard/tableau-de-bord` still renders with breadcrumb, `/dashboard/dossiers` still redirects home, 404 still mounts inside the shell for unknown children.

### Decisions Pinned for This Story (flag if divergence is intentional)

1. **Feature module singular: `features/questionnaire/`, not `features/questionnaires/`** — matches the sibling `features/current-user/` singular style. Diverges from `architecture.md`'s plural spec, intentionally. Revisit at Epic 9 if admin builder adds a second feature folder.
2. **Fixture types live alongside the fixture, not in `@confluent/shared`** — shared-package exports are currently empty (single `index.ts` re-export). Adding a `Question`/`Section` type there is premature for a single caller. Promote to shared when the API layer lands (Epic 7) and the same shape is consumed by a real `zod` schema.
3. **Storage key `confluent_draft_{dossierName}` uses the RAW trimmed name** — not slugified, not URL-encoded. Consumers (2.6 cleanup) must read the exact name from `confluent_draft_name` to compose the key. No transformation layer introduced.
4. **Single `draft` atom in route state, not split `answers` + `position`** — atomic updates, stable useEffect dep list, no inter-render races between two setters.
5. **`<WizardInput key={question.id} autoFocus />` — keyed remount for focus** — simpler than a `useEffect`-based focus hook. No ref plumbing needed.
6. **Progress bar renders in the route, not inside `QuestionnaireStep`** — layout boundary: bar spans `<main>`, card is `max-w-xl`. Siblings, not nested.
7. **Empty-answer UX = disabled OK button, no inline error text** — matches spec AC7, matches the Typeform "no visible errors, just no advance" philosophy, and avoids per-keystroke validation noise.
8. **Slide transitions use a custom `@utility` + `@keyframes` pair in `index.css`** — unless `tw-animate-css`'s built-ins (`animate-in slide-in-from-bottom`) hit the exact 24px offset + 200ms + ease-out spec with a single class, in which case switch and delete Task 6.
9. **`aria-live="polite"`, not `assertive`, on the step-indicator live region** — advance is user-initiated; polite is the WAI-ARIA authoring-practices default for non-emergency status updates.
10. **No `autoFocus` on the recapitulatif stub** — same reasoning as 2.3: the stub is a placeholder; Story 2.5 owns the recap interaction.
11. **Commit strategy: single `feat(epic-2): story 2.4 — ...` commit that bundles implementation AND code-review patches** — per user memory preference. No separate `fix(epic-2): story 2.4 code-review patches` follow-up commit.

### References

- Story AC + narrative: [Source: [_bmad-output/planning-artifacts/epics.md](_bmad-output/planning-artifacts/epics.md#L476-L521)#Story 2.4 — QuestionnaireStep Component & Hardcoded Questions]
- QuestionnaireStep anatomy (progress bar 3px, H1 28px/700, 18px input, OK + Entrée hint): [Source: [_bmad-output/planning-artifacts/ux-design-specification.md](_bmad-output/planning-artifacts/ux-design-specification.md#L525-L535)#`QuestionnaireStep`]
- Typeform-style flow rationale (one question at a time, progress bar, Enter to advance): [Source: [_bmad-output/planning-artifacts/ux-design-specification.md](_bmad-output/planning-artifacts/ux-design-specification.md#L173-L179)#Inspiration Sources]
- Color tokens (border, foreground, muted-foreground, destructive): [Source: [_bmad-output/planning-artifacts/ux-design-specification.md](_bmad-output/planning-artifacts/ux-design-specification.md#L325-L343)#Color System, [apps/web/src/index.css](apps/web/src/index.css)]
- Typography scale (H1 28/22 px, body 14 px, indicator 12 px): [Source: [_bmad-output/planning-artifacts/ux-design-specification.md](_bmad-output/planning-artifacts/ux-design-specification.md#L345-L357)#Typography System]
- Frontend tech stack (React 19, RR v7, Tailwind v4, Base UI Button): [Source: [_bmad-output/planning-artifacts/architecture.md](_bmad-output/planning-artifacts/architecture.md#L207-L230)#Frontend Architecture]
- Features folder convention (`features/<domain>/components`): [Source: [_bmad-output/planning-artifacts/architecture.md](_bmad-output/planning-artifacts/architecture.md#L641-L666)#Frontend Source Structure, [apps/web/src/features/current-user/](apps/web/src/features/current-user/)]
- WizardInput primitive: [Source: [apps/web/src/components/confluent/WizardInput.tsx](apps/web/src/components/confluent/WizardInput.tsx)]
- stripNonPrintable utility: [Source: [apps/web/src/lib/sanitize.ts](apps/web/src/lib/sanitize.ts)]
- Naming-step route (draft-name writer + `<Navigate>` guard precedent): [Source: [apps/web/src/routes/dashboard/dossiers/nouveau/index.tsx](apps/web/src/routes/dashboard/dossiers/nouveau/index.tsx), [apps/web/src/routes/dashboard/dossiers/nouveau/questionnaire.tsx](apps/web/src/routes/dashboard/dossiers/nouveau/questionnaire.tsx)]
- Breadcrumb handle-based suppression (already wired): [Source: [apps/web/src/components/layout/Breadcrumbs.tsx](apps/web/src/components/layout/Breadcrumbs.tsx), [apps/web/src/router.tsx](apps/web/src/router.tsx)]
- Button contract (size="lg", no asChild, Base UI forwards native props): [Source: [apps/web/src/components/ui/button.tsx](apps/web/src/components/ui/button.tsx)]
- Epic 2 scope + FR/UX-DR coverage (FR1, FR11, FR12; UX-DR2/3/8/14/15): [Source: [_bmad-output/planning-artifacts/epics.md](_bmad-output/planning-artifacts/epics.md#L194-L198)#Epic 2]
- Previous story context + pinned decisions: [Source: [_bmad-output/implementation-artifacts/2-3-dossier-creation-naming-step.md](_bmad-output/implementation-artifacts/2-3-dossier-creation-naming-step.md)]
- Open deferred items (concurrent-tab stomp, draft cleanup in 2.6): [Source: [_bmad-output/implementation-artifacts/deferred-work.md](_bmad-output/implementation-artifacts/deferred-work.md)]
- React Router v7 `useMatches` + `handle` pattern: [Source: react-router-dom@7.14+ docs]
- Tailwind v4 `@utility` directive for custom animations: [Source: tailwindcss.com/docs/adding-custom-styles#adding-custom-utilities]

### Latest Technical Information

- **React 19 `autoFocus` + keyed remount** — React re-applies `autoFocus` on mount. A `<WizardInput key={question.id} autoFocus />` remounts on question change, firing autoFocus natively without `useEffect`. Stable pattern since React 18; unchanged in 19.
- **Tailwind v4 `@utility` directive** — first-class way to register custom utilities consumable by the arbitrary-variant system (e.g. `motion-safe:animate-slide-up-in`). Declared directly in `index.css` alongside `@keyframes`. Stable in Tailwind ≥ 4.1.
- **`tw-animate-css` 1.4** — already in dependencies; offers `animate-in`, `slide-in-from-bottom-{N}`, etc. Investigate at implementation time whether `animate-in slide-in-from-bottom-4 duration-200 ease-out` yields the spec'd 24px nudge (spoiler: `slide-in-from-bottom-{N}` uses `translate-y-[calc(var(--tw-translate-y)*{N})]` scaled values, not a pure `24px` offset — likely doesn't match exactly; fall back to the custom `@keyframes`).
- **`prefers-reduced-motion` handling** — two layers needed: (a) the slide-in `@utility` gated by `motion-safe:` in the consumer className, and (b) the progress bar's `transition-[width]` gated by `motion-reduce:transition-none`. Both use Tailwind v4's media-query variants. WCAG 2.3.3 compliance.
- **localStorage synchronous API** — `setItem`/`getItem` are synchronous and throw only on quota (~5MB in most browsers; 12 short answers won't come close). No try/catch needed for the writes. The `JSON.parse` inside `loadDraft` needs its try/catch (malformed-JSON branch).
- **React 19 `<title>` in JSX** — natively supported; hoists to `<head>`. Used in 2.1/2.2/2.3 routes; continues in 2.4's route + `recapitulatif` stub.

### Project Context Reference

No `project-context.md` exists at the repo root. Authoritative planning inputs remain the PRD, epics, architecture, and UX spec under `_bmad-output/planning-artifacts/`, plus locked patterns from Stories 1.1–2.3. User memory index at [MEMORY.md](../../.claude/projects/-home-coder-confluent/memory/MEMORY.md) notes one active feedback: bundle story implementation + code-review patches into a single commit (no `feat` + `fix` split).

## Dev Agent Record

### Agent Model Used

claude-opus-4-7

### Debug Log References

- `pnpm turbo run typecheck`: 2 successful, 0 errors (api cache hit, web cache miss → clean). New types (`Question`, `Section`, `QuestionMeta`, `QuestionnaireStepProps`, `QuestionnaireProgressProps`, `DraftState`) compile cleanly.
- `pnpm turbo run lint`: 2 successful, 0 errors. 3 pre-existing warnings tolerated (badge, button, current-user — same as Story 2.3 baseline). Zero new warnings.
- `pnpm turbo run build`: 2 successful, 0 errors. Build time 3.7s.
- Bundle delta vs Story 2.3 baseline (41.63 kB / 8.12 kB gzip CSS; 333.13 kB / 105.91 kB gzip JS):
  - CSS: 43.18 kB (gzip 8.42 kB) → +1.55 kB (+0.30 kB gzip) — keyframes + two `@utility` blocks + Tailwind-generated animation/motion-safe classes.
  - JS: 338.39 kB (gzip 107.70 kB) → +5.26 kB (+1.79 kB gzip) — fixture (12 questions + 3 sections), `QuestionnaireStep`, `QuestionnaireProgress`, route wizard logic, stub route.
  - Delta is within the spec's expected "+1–2 kB gzip CSS, +2–4 kB gzip JS" envelope (JS delta slightly above upper bound because the `direction`-state + animation className branching added a bit more inline logic than anticipated).

### Completion Notes List

1. **Questionnaire fixture landed at `apps/web/src/data/questionnaire.ts`** — establishes the `src/data/` directory as a flat singleton (no `index.ts` re-export). Exports `Question`, `Section`, `QuestionMeta` types + `QUESTIONNAIRE` (3 sections × 4 questions = 12), `QUESTIONNAIRE_FLAT` (derived via `reduce`), `TOTAL_QUESTIONS = 12`. French labels use literal U+00A0 (`\u00A0`) for narrow no-break space before `?` — rendered as plain text nodes in JSX, no `dangerouslySetInnerHTML`. Pinned decision #2 kept: types live with the fixture, not in `@confluent/shared`.
2. **Feature module landed at `apps/web/src/features/questionnaire/components/`** — singular `questionnaire/` to match `features/current-user/` convention (deliberate deviation from `architecture.md`'s plural `questionnaires/`, per Pinned Decision #1). Two components: `QuestionnaireStep` (per-question presentational) and `QuestionnaireProgress` (3px top bar).
3. **`QuestionnaireStep` is presentational + keyboard-aware only** — final props contract: `{ question, indicatorText, value, onChange, onAdvance, onBack, canGoBack }`. The parent composes `indicatorText` so the component doesn't need to import the fixture. `<WizardInput key={question.id} autoFocus />` keyed remount fires autoFocus natively on every question change — no ref plumbing, no `useEffect` for focus. `ArrowUp` intercepted on input `onKeyDown` calls `onBack()` when `canGoBack`; Enter submits the form natively.
4. **`QuestionnaireProgress` is a plain 2-div bar** — `aria-hidden="true"` because the authoritative live-region announcement is the step indicator text, not the bar. `rounded-full` on the track + `overflow-hidden` clips the fill to the rounded edges. `motion-reduce:transition-none` kills the width transition for users who've opted out.
5. **Route rewritten with full wizard engine** at `apps/web/src/routes/dashboard/dossiers/nouveau/questionnaire.tsx`:
   - Preserves the Story 2.3 `<Navigate>` guard: `if (!localStorage.getItem('confluent_draft_name')) return <Navigate to="/dashboard/dossiers/nouveau" replace />`.
   - Splits into `QuestionnaireRoute` (guard) + `QuestionnaireWizard` (stateful). This avoids the "hooks before early return" pitfall — `useState`/`useEffect`/`useNavigate` only run once past the guard.
   - Single `draft` atom (`{ answers, position, updatedAt }`) with a `patchDraft` helper → atomic updates, stable `useEffect` dep list for the persistence writer. Pinned Decision #4 kept.
   - `loadDraft()` rehydrates with a narrow runtime guard (typeof checks on `position`, `answers`); malformed JSON or shape-mismatch falls back silently to `{ answers: {}, position: 1, updatedAt: now }`. `position` clamped into `[1, TOTAL_QUESTIONS]`.
   - `handleAdvance()` writes the final-question persistence inline (not via the `useEffect`) before navigating — otherwise the effect race could lose the last answer.
6. **Slide transitions via `direction` state + keyed wrapper** — the wrapping `<div key={position}>` around `<QuestionnaireStep>` remounts on every position change, re-firing the CSS animation. `direction` state (`'forward' | 'backward'`) selects between `motion-safe:animate-slide-up-in` and `motion-safe:animate-slide-down-in`. `motion-safe:` gates on `prefers-reduced-motion: no-preference` — users who opt out see an instant swap, no animation. The progress bar's width transition has its own `motion-reduce:transition-none`.
7. **CSS keyframes + `@utility` blocks added to `apps/web/src/index.css`** — `confluent-slide-up-in` (from `translateY(24px)` + opacity 0, to origin) and `confluent-slide-down-in` (from `translateY(-24px)` + opacity 0, to origin), both 200ms ease-out. Wrapped as `@utility animate-slide-up-in` / `@utility animate-slide-down-in` (Tailwind v4 first-class custom utility). `tw-animate-css` built-ins were evaluated but use `translate3d(0, 100%, 0)` off-screen slides, not the 24px nudge the spec wants — custom keyframes kept.
8. **Recapitulatif stub at `apps/web/src/routes/dashboard/dossiers/nouveau/recapitulatif.tsx`** — 7-line placeholder, default export, declarative `<title>` + `<h1>`. Mirrors the 2.3 questionnaire-stub pattern. No draft-name guard — Story 2.5 owns that.
9. **Router updated** — added `RecapitulatifRoute` import + route entry with `handle: { hideBreadcrumb: true }` immediately after the questionnaire route. `*` catch-all remains LAST child of `AppShell` (ordering invariant preserved from Stories 2.1/2.2/2.3).
10. **All 10 ACs verified against implementation:** AC1 anatomy (progress bar + indicator + H1 + hint + input + action row) ✓, AC2 fixture structure ✓, AC3 sanitise+trim+persist+slide ✓, AC4 ↑+back chevron with answer restoration ✓, AC5 localStorage rehydrate with malformed-JSON fallback ✓, AC6 `role="status" aria-live="polite" aria-atomic="true"` live region ✓, AC7 disabled OK + no-op submit on empty ✓, AC8 mobile responsive (22→28px, 44px tap targets, flex-wrap) ✓, AC9 breadcrumb suppressed (handle marker inherited from 2.3 + added to recap) ✓, AC10 nav to `/recapitulatif` on last question + stub route registered ✓.
11. **Visual verification pending (recommended before merge):** tri-viewport walkthrough (mobile 375 px, tablet 900 px, desktop 1440 px), axe audit on `/dashboard/dossiers/nouveau/questionnaire` in first-question / mid-flow / empty-answer states, `prefers-reduced-motion` toggle, VoiceOver or NVDA sanity check for step-indicator announcement on advance. Full `pnpm turbo run dev` walkthrough from Task 9 checklist should be performed before shipping. Programmatic signals are all green.
12. **No regression on prior-story ACs:** `/dashboard` empty state + CTA untouched. `/dashboard/dossiers/nouveau` naming-step untouched (still writes `confluent_draft_name`). `/dashboard/tableau-de-bord` breadcrumb untouched. `/dashboard/dossiers` redirect untouched. 404 catch-all still inside `AppShell`.
13. **Sidebar deactivation on wizard routes** — still a deliberate non-fix (Story 2.3 Pinned #7 + 2.2 code-review deferral). No item lights up on `/questionnaire` or `/recapitulatif`; consistent with the Typeform focus intent.
14. **Deferred-work carryovers from 2.3 review still apply and are NOT solved by 2.4:**
    - Concurrent-tab stomp on `confluent_draft_{dossierName}` — blast radius is larger now (12 answers instead of 1 name), still deferred to Epic 7 real-API persistence.
    - Breadcrumb handle-suppression has no "child un-suppresses parent" — no route needs the inverse direction.
    - `RouteHandle` cast trusts `useMatches` output shape — still a type-safety polish, still deferred.
    - Wizard step has no in-page cancel/back-to-dashboard affordance — 2.4 adds a question-to-question back chevron but NOT an exit affordance. Revisit with real user feedback once Epic 2 ships.
    - Cleanup of `confluent_draft_name` AND `confluent_draft_{dossierName}` — both keys accumulate today. Story 2.6 will clear both on dossier completion; cross-reference explicitly when 2.6 is created.

### File List

**Created:**
- `apps/web/src/data/questionnaire.ts` — 3-section × 4-question hardcoded fixture, types, `QUESTIONNAIRE_FLAT`, `TOTAL_QUESTIONS`
- `apps/web/src/features/questionnaire/components/QuestionnaireStep.tsx` — presentational per-question component (progress bar NOT embedded; parent-composed indicator)
- `apps/web/src/features/questionnaire/components/QuestionnaireProgress.tsx` — 3px top progress bar with reduced-motion fallback
- `apps/web/src/routes/dashboard/dossiers/nouveau/recapitulatif.tsx` — 7-line stub for Story 2.5 destination

**Modified:**
- `apps/web/src/routes/dashboard/dossiers/nouveau/questionnaire.tsx` — REWRITTEN: draft-name guard preserved, `QuestionnaireWizard` sub-component with `draft` atom state, rehydrate + persistence effect, advance/back handlers, keyed wrapper for slide animations
- `apps/web/src/router.tsx` — added `RecapitulatifRoute` import + route entry with `handle: { hideBreadcrumb: true }` after the questionnaire route
- `apps/web/src/index.css` — appended 2 `@keyframes` + 2 `@utility` declarations for slide-up/slide-down animations

### Change Log

- **2026-04-20** — Story 2.4 initial implementation: hardcoded 3×4 questionnaire fixture, `QuestionnaireStep` + `QuestionnaireProgress` feature-module components, full wizard engine in the route (rehydrate + persist via single `draft` atom, advance/back handlers, keyed slide transitions, disabled-button empty-answer UX, `aria-live="polite"` step-indicator announcements), `recapitulatif` stub + router entry. Typecheck/lint/build: 6/6 tasks green, 0 errors, 3 tolerated pre-existing lint warnings (same as 2.3 baseline), zero new warnings. Bundle delta: +1.55 kB CSS (+0.30 kB gzip), +5.26 kB JS (+1.79 kB gzip).
- **2026-04-20** — Story 2.4 code-review patches: moved `aria-live` region to the route (persists across step remounts per AC6), added IME-composition + modifier-key guards on ArrowUp and Enter, tightened `loadDraft` with `Number.isFinite(position)`, swapped `aria-label` for `aria-labelledby` pointing to the question `<h1>`, wrapped decorative `→` glyph in `<span aria-hidden="true">`, added a route-scoped `window` keydown listener for ArrowUp honoring AC4's literal wording (with target-filtering on native arrow-key consumers). One finding (final-question progress reaches 100%) dismissed after investigation: position-based progress already satisfies it. Pipeline re-verified: 6/6 green, 0 errors, same 3 tolerated warnings. Bundle delta post-patches: +0.74 kB JS (+0.26 kB gzip); CSS unchanged.
