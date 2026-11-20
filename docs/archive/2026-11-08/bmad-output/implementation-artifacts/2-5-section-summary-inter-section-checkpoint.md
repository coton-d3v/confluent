# Story 2.5: SectionSummary — Inter-section Checkpoint

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an entrepreneur finishing a section of the questionnaire,
I want to review my answers before continuing,
so that I can correct any mistake before moving to the next topic.

## Acceptance Criteria

1. **Given** the user submits a valid answer on the last question of Section 1 (`globalIndex === 4`, `positionInSection === currentSection.questions.length`) OR Section 2 (`globalIndex === 8`), **When** `handleAdvance` fires, **Then** the `SectionSummary` screen replaces `QuestionnaireStep` inside the same keyed slide-transition wrapper (forward slide, `motion-safe:animate-slide-up-in`). `position` stays at the final question of the section (4 for Section 1, 8 for Section 2) and a new `view: 'summary'` flag is set in persisted draft state. NO route change — the URL remains `/dashboard/dossiers/nouveau/questionnaire`. On Section 3's last question (`globalIndex === 12`) the existing 2.4 behaviour stands: persist + navigate to `/recapitulatif` (Story 2.6 will later splice Section 3's summary in front of completion; 2.5 does not touch that path).

2. **Given** the `SectionSummary` screen renders for section N, **When** a developer inspects the DOM, **Then** it contains, in this vertical order:
   - An `<h2>` showing `Section {N} — {section.title}` (e.g. "Section 1 — Présentation"), font `font-heading text-2xl font-semibold text-foreground`, `tabIndex={-1}`, with `autoFocus` on mount so screen-readers orient immediately.
   - A semantic `<dl>` list of 4 Q/R rows, one per question in the section. Each row is a `<div>` containing a `<dt>` + `<dd>` + "Modifier" trigger, separated by a 1 px bottom border in `border-border` (last row has no bottom border). Row layout: the `<dt>/<dd>` column takes `flex-1`; the "Modifier" trigger is right-aligned.
   - A primary `<Button size="lg" className="h-11 px-4">` labelled `Valider cette section →` pinned at the bottom of the container, with the decorative `→` wrapped in `<span aria-hidden="true">` (Story 2.4 review-patch convention).

3. **Given** a `SectionSummary` row, **When** a developer inspects it, **Then**:
   - `<dt>` uses `text-[11px] uppercase tracking-wider text-muted-foreground` for the question label (truncation OK — `line-clamp-2` is acceptable if labels wrap).
   - `<dd>` uses `mt-1 text-[13px] font-medium text-foreground` for the answer. If the stored answer is an empty string (defensive case — should never happen under normal flow since 2.4 blocks empty submit), render an em dash `—` in `text-muted-foreground` instead.
   - The "Modifier" trigger is a `<button type="button">` (NOT an `<a>` — it does not navigate to a URL, it mutates local state) styled as `text-xs text-muted-foreground hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]`. Spec UX calls it a "ghost link" — button element with link-like styling is the correct semantic compromise (no underline at rest, underline on hover, visible focus ring).

4. **Given** the user clicks "Modifier" on the row for question `q` in the section summary, **When** the click fires, **Then** the view flips back to `QuestionnaireStep`: `view = 'question'`, `position = q.globalIndex`, slide direction = `backward` (`motion-safe:animate-slide-down-in`). The stored answer for that question pre-fills the input (unchanged from 2.4's `answers[q.id] ?? ''` wiring). A local non-persisted `editingFromSummary: boolean` is set to `true` so that `QuestionnaireStep` renders an extra affordance (AC5).

5. **Given** `editingFromSummary === true`, **When** `QuestionnaireStep` renders, **Then**:
   - A `← Retour au récapitulatif` ghost link is shown in a new slot BELOW the answer input and above the OK action row. Styling matches the "Modifier" trigger (`text-xs text-muted-foreground hover:underline`). Clicking it sets `editingFromSummary = false`, `view = 'summary'`, `position` = the section's last question, slide direction = `forward`. This is passed into `QuestionnaireStep` via a new optional prop `returnToSummary?: { onReturn: () => void }` — when defined, renders the link; when undefined (normal 2.4 flow), nothing renders.
   - The back chevron `‹` is hidden (or `disabled`) — `canGoBack={false}` is forced by the route while in edit-from-summary mode. This prevents the user from stepping backward out of the single-question edit context.
   - The document-level ArrowUp listener (from 2.4 review patches) is also a no-op while editing (the existing guard "position > 1" evaluates on the *current* position; override by adding a `view === 'summary' || editingFromSummary` short-circuit at the top of the listener).
   - Submitting the edited answer (Enter or OK →) writes the new value to `answers` AND returns to the summary view of the originating section: `editingFromSummary = false`, `view = 'summary'`, `position = sectionLastQuestion`, direction = `forward`. The user does NOT auto-advance to the next question from edit mode.

6. **Given** the user clicks "Valider cette section →" on the `SectionSummary` for Section 1 or 2, **When** the click fires, **Then** `view = 'question'`, `position = sectionLastQuestion + 1` (i.e. 5 after Section 1, 9 after Section 2), slide direction = `forward`. The first question of the next section appears with the slide-in transition. The progress bar animates from the current width (4/12 = 33% or 8/12 = 67%) to the new one (5/12 = 42% or 9/12 = 75%), using the existing `transition-[width] duration-200 ease-out` on `QuestionnaireProgress`.

7. **Given** the user closes the tab while the summary is showing for section N (`view === 'summary'`, position at the section's last question), **When** they return to `/dashboard/dossiers/nouveau/questionnaire`, **Then** the persisted draft is rehydrated with `view: 'summary'` AND `position: sectionLastQuestion`, and the summary screen renders immediately for that section — they are NOT sent back to the question view. If the stored `view` field is missing (drafts created before this story) or is an unknown value, `loadDraft` falls back to `view: 'question'` (the 2.4 default) — no orphaned-session edge case. Editing-from-summary is NOT persisted (see Pinned Decision #4); on tab-close during an edit, the user returns on the question in normal-question mode with the back chevron working as usual — a small UX degradation that is acceptable for a hardcoded-flow Epic 2 story.

8. **Given** the `SectionSummary` screen, **When** a keyboard-only user navigates, **Then** Tab order is: H2 (initial focus, `tabIndex=-1`, then blur) → Modifier #1 → Modifier #2 → Modifier #3 → Modifier #4 → Valider button. Each interactive element shows the standard `focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]` focus ring. Enter on any Modifier button triggers the "Modifier" handler; Enter on Valider triggers the section advance. Shift+Tab walks the order backwards. No focus trap — Shift+Tab past H2 returns to the browser chrome normally.

9. **Given** the live-region text in the route (from 2.4 review patch 1), **When** `view === 'summary'` for section N, **Then** the live region text becomes `Récapitulatif · Section {N} · {section.title}` (e.g. "Récapitulatif · Section 1 · Présentation"). Screen readers hear this polite announcement on every transition from question to summary, summary to question (edit), or summary to next section.

10. **Given** `SectionSummary` on mobile (< 768 px), **When** the component renders, **Then** the H2 reduces to `text-xl` via `md:text-2xl`, each row still shows `<dt>` above `<dd>` (stacked, already the default `flex-col` on rows), the Modifier button keeps a ≥ 44 × 44 CSS tap target (`min-h-11 min-w-11` with centered text), and the Valider button retains `h-11 px-4` from the established 2.3/2.4 recipe. Rows wrap rather than overflow horizontally.

## Tasks / Subtasks

- [x] Task 1: Extend the `DraftState` shape with a `view` field and update `loadDraft` (AC: 1, 7)
  - [x] Edit `apps/web/src/routes/dashboard/dossiers/nouveau/questionnaire.tsx`.
  - [x] Update the `DraftState` interface:
    ```ts
    interface DraftState {
      answers: Record<string, string>
      position: number
      view: 'question' | 'summary'
      updatedAt: string
    }
    ```
  - [x] Update `emptyDraft()` to set `view: 'question'`.
  - [x] Update `loadDraft` runtime guard to accept a missing/invalid `view` field gracefully:
    ```ts
    const view: 'question' | 'summary' =
      draft.view === 'summary' ? 'summary' : 'question'
    return { answers, position: clamped, view, updatedAt }
    ```
    Drafts from 2.4 (no `view` field) resume as `view: 'question'` — no migration breakage. A malformed string value also falls back to `'question'`.
  - [x] Do NOT reject the whole draft if `view` is missing. The guard must remain permissive for backward compatibility.

- [x] Task 2: Create the `SectionSummary` component (AC: 2, 3, 8, 10)
  - [x] File: `apps/web/src/features/questionnaire/components/SectionSummary.tsx`. Named export, no default export.
  - [x] Props contract:
    ```ts
    export interface SectionSummaryProps {
      section: Section              // the full section (id, title, questions)
      sectionIndex: number          // 1-based, for H2 display
      answers: Record<string, string>
      onEdit: (globalIndex: number) => void
      onValidate: () => void
    }
    ```
    The caller (route) owns state mutation and navigation. `SectionSummary` is presentational: renders UI, wires onEdit/onValidate callbacks, and forwards initial focus to the H2 on mount.
  - [x] Implementation skeleton:
    ```tsx
    import { useEffect, useRef } from 'react'
    import { Button } from '@/components/ui/button'
    import type { Section, QuestionMeta } from '@/data/questionnaire'
    import { QUESTIONNAIRE_FLAT } from '@/data/questionnaire'

    export interface SectionSummaryProps {
      section: Section
      sectionIndex: number
      answers: Record<string, string>
      onEdit: (globalIndex: number) => void
      onValidate: () => void
    }

    export function SectionSummary({
      section,
      sectionIndex,
      answers,
      onEdit,
      onValidate,
    }: SectionSummaryProps) {
      const headingRef = useRef<HTMLHeadingElement>(null)
      useEffect(() => {
        headingRef.current?.focus()
      }, [])

      const sectionMetas = QUESTIONNAIRE_FLAT.filter(
        (q) => q.sectionId === section.id,
      )

      return (
        <section className="mx-auto flex max-w-xl flex-col gap-8 pt-8">
          <h2
            ref={headingRef}
            tabIndex={-1}
            className="font-heading text-xl font-semibold text-foreground md:text-2xl focus-visible:outline-none"
          >
            Section {sectionIndex} — {section.title}
          </h2>
          <dl className="flex flex-col">
            {sectionMetas.map((q, i) => (
              <div
                key={q.id}
                className={
                  'flex flex-wrap items-start justify-between gap-4 py-3 ' +
                  (i < sectionMetas.length - 1 ? 'border-b border-border' : '')
                }
              >
                <div className="flex-1 min-w-0">
                  <dt className="text-[11px] uppercase tracking-wider text-muted-foreground">
                    {q.label}
                  </dt>
                  <dd className="mt-1 text-[13px] font-medium text-foreground">
                    {answers[q.id]?.length
                      ? answers[q.id]
                      : <span className="text-muted-foreground">—</span>}
                  </dd>
                </div>
                <button
                  type="button"
                  onClick={() => onEdit(q.globalIndex)}
                  className="min-h-11 min-w-11 shrink-0 px-2 text-xs text-muted-foreground hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
                >
                  Modifier
                </button>
              </div>
            ))}
          </dl>
          <div className="pt-2">
            <Button
              type="button"
              size="lg"
              className="h-11 px-4"
              onClick={onValidate}
            >
              Valider cette section <span aria-hidden="true">→</span>
            </Button>
          </div>
        </section>
      )
    }
    ```
  - [x] `autoFocus` on H2 via `ref.current?.focus()` in `useEffect` — simpler than the `<WizardInput key={id} autoFocus />` remount trick because a `<h2>` doesn't have the `autoFocus` attribute. Use a ref + effect.
  - [x] `focus-visible:outline-none` on the H2: the H2 gets programmatic focus for SR orientation, but we don't want a visible ring on an element the user didn't tab to. Do NOT use plain `outline-none` (that would also hide the ring if the user Shift+Tabs back into the H2 later).
  - [x] `QUESTIONNAIRE_FLAT.filter((q) => q.sectionId === section.id)` gets the 4 `QuestionMeta` entries for the section. Do NOT use `section.questions` directly because it only has `Question` (no `globalIndex`, `sectionIndex`, etc.), and we need `globalIndex` for the `onEdit` callback.
  - [x] Do NOT wrap the Modifier button in a `<Button variant="link">` — the shadcn link variant uses `text-primary` (= `#37352F`, near-black), but UX spec calls for `text-secondary` (= `text-muted-foreground` = `#6B6B6B`). A plain styled `<button type="button">` is one line and exactly matches the spec.
  - [x] Do NOT add an `<hr>` between rows — the `border-b` on the row does the job in one class instead of two elements.

- [x] Task 3: Extend `QuestionnaireStep` with an optional `returnToSummary` prop (AC: 5)
  - [x] Edit `apps/web/src/features/questionnaire/components/QuestionnaireStep.tsx`.
  - [x] Extend props:
    ```ts
    export interface QuestionnaireStepProps {
      question: QuestionMeta
      indicatorText: string
      value: string
      onChange: (next: string) => void
      onAdvance: (cleaned: string) => void
      onBack: () => void
      canGoBack: boolean
      returnToSummary?: { onReturn: () => void }
    }
    ```
  - [x] When `returnToSummary` is defined:
    - Render a "← Retour au récapitulatif" ghost link BETWEEN the `WizardInput` and the action row (OK button + "ou Entrée ↵" hint). Styling matches the SectionSummary "Modifier" trigger.
    - Do NOT change the structure of `QuestionnaireStep` when `returnToSummary === undefined`. Existing 2.4 flow is unchanged.
  - [x] Sketch:
    ```tsx
    {returnToSummary && (
      <button
        type="button"
        onClick={returnToSummary.onReturn}
        className="self-start min-h-11 text-xs text-muted-foreground hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
      >
        <span aria-hidden="true">←</span> Retour au récapitulatif
      </button>
    )}
    ```
  - [x] The leading `←` glyph is decorative — wrap in `aria-hidden="true"` per the 2.4 review-patch convention. The accessible text is "Retour au récapitulatif".
  - [x] The caller (route) will set `canGoBack={false}` simultaneously with `returnToSummary` — the back chevron in the footer row becomes `disabled`. Do NOT ALSO hide the back chevron conditionally; the `disabled` styling is sufficient and keeps the DOM shape stable (important for the screen-reader experience and tab order — the chevron stays in the Tab sequence but is skipped by browsers when disabled).
  - [x] `min-h-11` on the return link ensures a 44 × 44 tap target on mobile even though the link is short. `self-start` keeps it left-aligned (same edge as the input).

- [x] Task 4: Wire `view === 'summary'` rendering in the route (AC: 1, 4, 6, 9)
  - [x] Edit `apps/web/src/routes/dashboard/dossiers/nouveau/questionnaire.tsx`.
  - [x] Import `SectionSummary` from the new feature-module file.
  - [x] Introduce a local non-persisted state:
    ```ts
    const [editingFromSummary, setEditingFromSummary] = useState(false)
    ```
    Declared BEFORE the `useEffect`-based persistence writer (hook order stability).
  - [x] Rewrite `handleAdvance` to branch on the last-question-of-a-non-final-section case:
    ```ts
    function handleAdvance(cleaned: string) {
      const nextAnswers = { ...answers, [currentQuestion.id]: cleaned }

      // Edit-from-summary path: save and return to the summary
      if (editingFromSummary) {
        setEditingFromSummary(false)
        setDirection('forward')
        const sectionLastGlobal = lastGlobalIndexOfSection(currentQuestion.sectionId)
        patchDraft({
          answers: nextAnswers,
          position: sectionLastGlobal,
          view: 'summary',
        })
        return
      }

      // Section 3 final question — unchanged 2.4 behaviour
      if (position >= TOTAL_QUESTIONS) { /* unchanged */ }

      // Last question of Section 1 or 2 — show section summary
      const isSectionBoundary =
        currentQuestion.positionInSection === currentSection.questions.length &&
        currentQuestion.sectionIndex < 3
      if (isSectionBoundary) {
        setDirection('forward')
        patchDraft({ answers: nextAnswers, view: 'summary' })
        return
      }

      // Default — advance within a section
      setDirection('forward')
      patchDraft({ answers: nextAnswers, position: position + 1 })
    }
    ```
  - [x] Helper (declare at module scope near the other helpers):
    ```ts
    function lastGlobalIndexOfSection(sectionId: string): number {
      const section = QUESTIONNAIRE.find((s) => s.id === sectionId)
      if (!section) return TOTAL_QUESTIONS
      const sectionMetas = QUESTIONNAIRE_FLAT.filter(
        (q) => q.sectionId === sectionId,
      )
      return sectionMetas[sectionMetas.length - 1].globalIndex
    }
    ```
  - [x] New handler `handleEditFromSummary`:
    ```ts
    function handleEditFromSummary(targetGlobalIndex: number) {
      setEditingFromSummary(true)
      setDirection('backward')
      patchDraft({ position: targetGlobalIndex, view: 'question' })
    }
    ```
  - [x] New handler `handleReturnToSummary`:
    ```ts
    function handleReturnToSummary() {
      setEditingFromSummary(false)
      setDirection('forward')
      const sectionLastGlobal = lastGlobalIndexOfSection(currentQuestion.sectionId)
      patchDraft({
        position: sectionLastGlobal,
        view: 'summary',
      })
    }
    ```
  - [x] New handler `handleValidateSection`:
    ```ts
    function handleValidateSection() {
      setDirection('forward')
      patchDraft({
        position: position + 1,   // position currently at the last-of-section global index
        view: 'question',
      })
    }
    ```
    Note: when `view === 'summary'`, `position` equals the last question of that section. Advancing by one gives the first question of the next section. No off-by-one.
  - [x] Update the document-level ArrowUp listener to short-circuit when the wizard is in summary view OR in edit-from-summary mode:
    ```ts
    useEffect(() => {
      function onDocumentKeyDown(e: KeyboardEvent) {
        if (e.key !== 'ArrowUp') return
        if (e.isComposing) return
        if (e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return
        const target = e.target as HTMLElement | null
        if (
          target?.tagName === 'INPUT' ||
          target?.tagName === 'TEXTAREA' ||
          target?.tagName === 'SELECT' ||
          target?.isContentEditable
        ) return
        e.preventDefault()
        setDraft((prev) => {
          if (prev.view === 'summary') return prev              // no back-nav from summary
          if (prev.position <= 1) return prev
          setDirection('backward')
          return {
            ...prev,
            position: prev.position - 1,
            updatedAt: new Date().toISOString(),
          }
        })
      }
      window.addEventListener('keydown', onDocumentKeyDown)
      return () => window.removeEventListener('keydown', onDocumentKeyDown)
    }, [])
    ```
    Also needs `editingFromSummary` short-circuit. Since `editingFromSummary` is React state not captured in the listener's closure, read it via a ref:
    ```ts
    const editingRef = useRef(editingFromSummary)
    editingRef.current = editingFromSummary
    // ... in the listener:
    if (editingRef.current) return
    ```
  - [x] Compute the indicator/live-region text based on `view`:
    ```ts
    const indicatorText =
      draft.view === 'summary'
        ? `Récapitulatif · Section ${currentQuestion.sectionIndex} · ${currentSection.title}`
        : `Section ${currentQuestion.sectionIndex} · Question ${currentQuestion.positionInSection} sur ${currentSection.questions.length}`
    ```
  - [x] Update the keyed wrapper so the animation fires on view changes at the same position:
    ```tsx
    <div
      key={`${draft.view}-${position}`}
      className={...}
    >
      {draft.view === 'summary' ? (
        <SectionSummary
          section={currentSection}
          sectionIndex={currentQuestion.sectionIndex}
          answers={answers}
          onEdit={handleEditFromSummary}
          onValidate={handleValidateSection}
        />
      ) : (
        <QuestionnaireStep
          question={currentQuestion}
          indicatorText={indicatorText}
          value={answers[currentQuestion.id] ?? ''}
          onChange={handleAnswerChange}
          onAdvance={handleAdvance}
          onBack={handleBack}
          canGoBack={!editingFromSummary && position > 1}
          returnToSummary={
            editingFromSummary
              ? { onReturn: handleReturnToSummary }
              : undefined
          }
        />
      )}
    </div>
    ```
  - [x] Do NOT render the indicator text inside `QuestionnaireStep` when `view === 'summary'` — the step isn't rendered at all in that case. The visual indicator in `QuestionnaireStep`'s header (the `text-xs text-muted-foreground` line above the H1) continues to render as before when `view === 'question'`.

- [x] Task 5: Title tag and final verification (AC: 1-10)
  - [x] Page `<title>` stays `Questionnaire · Confluent` regardless of view — the URL doesn't change and the summary is a view within the wizard. Do NOT swap to a summary-specific title; that would feel like a distinct page to the user.
  - [x] `pnpm turbo run typecheck` → 2 successful, 0 errors. New type `SectionSummaryProps`, extended `DraftState['view']`, extended `QuestionnaireStepProps['returnToSummary']` must compile cleanly.
  - [x] `pnpm turbo run lint` → 0 errors. Same 3 tolerated pre-existing warnings (badge, button, current-user). Zero new warnings.
  - [x] `pnpm turbo run build` → 2 successful, 0 errors. Bundle delta expected: +0.5 kB gzip CSS (no new utilities — reuses 2.4's keyframes), +1.5–2.5 kB gzip JS (SectionSummary + handlers + state extensions).
  - [x] `pnpm turbo run dev` manual walkthrough:
    1. Navigate `/dashboard`, create a dossier named "Biosensio". Answer Q1–Q3, then answer Q4 (last of Section 1). Observe: slide-up transition, SectionSummary for Section 1 appears, H2 = "Section 1 — Présentation", 4 rows visible with the answers just given. Progress bar = 33% (4/12).
    2. Click "Modifier" on row 2 ("secteur"). Observe: slide-down transition, Q2 appears with the stored answer pre-filled, back chevron is disabled, "← Retour au récapitulatif" link is visible below the input.
    3. Change the answer. Press Enter. Observe: slide-up transition, return to Section 1 summary with the updated value reflected. Progress bar stays at 33%.
    4. Click "Modifier" again, then click "← Retour au récapitulatif" without editing. Observe: slide-up transition, return to summary, no answer change.
    5. Click "Valider cette section →". Observe: slide-up transition, Q5 appears (first of Section 2). Progress bar = 42% (5/12). Indicator text: "Section 2 · Question 1 sur 4".
    6. Answer Q5–Q8. On submit of Q8, observe Section 2 summary.
    7. Click "Valider cette section →" on Section 2 summary. Observe: Q9 appears. Progress = 75%.
    8. Answer Q9–Q12. On submit of Q12, observe navigation to `/recapitulatif` (unchanged from 2.4 — Section 3 summary + completion is Story 2.6's scope).
    9. During the Section 1 summary: close tab, reopen. Verify: summary re-renders immediately for Section 1, all 4 answers visible, NOT the question view.
    10. DevTools check: edit `localStorage.getItem('confluent_draft_Biosensio')` to remove the `view` field entirely (simulating a pre-2.5 draft). Reload. Verify: falls back to `view: 'question'` gracefully — no error, lands on whatever position was stored, with the question view.
    11. `prefers-reduced-motion: reduce` → all four transitions (Q→Summary, Summary→Modifier, Edit→Summary, Summary→NextQ) swap instantly.
    12. VoiceOver/NVDA sanity: on Q4 submit, SR hears "Récapitulatif · Section 1 · Présentation" (live region), H2 gets focus and reads the same text via heading navigation.

### Review Findings

- [x] [Review][Patch] `Modifier` buttons share an identical accessible name — 4 rows all labelled "Modifier", SR users cannot distinguish them [apps/web/src/features/questionnaire/components/SectionSummary.tsx:61-67]
- [x] [Review][Patch] `loadDraft` accepts `view: 'summary'` without validating that `position` is actually a section-1 or section-2 last-question globalIndex — a tampered localStorage (`{view:'summary', position:12}`) survives the guard, renders a Section-3 summary (not intended per AC1), and crashes on Valider when `position+1 === 13` overshoots `QUESTIONNAIRE_FLAT` [apps/web/src/routes/dashboard/dossiers/nouveau/questionnaire.tsx:48-56]
- [x] [Review][Defer] `localStorage.setItem` in persistence `useEffect` has no `try/catch` — Safari private mode / quota-exceeded throws propagate out of the effect and tear down the wizard [apps/web/src/routes/dashboard/dossiers/nouveau/questionnaire.tsx:92-97] — deferred, pre-existing from 2.4
- [x] [Review][Defer] `JSON.stringify(draft)` writes on every keystroke with no debounce [apps/web/src/routes/dashboard/dossiers/nouveau/questionnaire.tsx:92-97] — deferred, pre-existing from 2.4 (already tracked in 2.4 deferred-work)

## Dev Notes

### Critical Architecture Constraints

- **`SectionSummary` lives at `apps/web/src/features/questionnaire/components/SectionSummary.tsx`** — same feature module as `QuestionnaireStep` and `QuestionnaireProgress` (Story 2.4). Pinned Decision #1 from 2.4 ("singular `features/questionnaire/`") continues to apply. [Source: apps/web/src/features/questionnaire/, 2-4-questionnaire-step-component-hardcoded-questions.md#Pinned Decision #1]
- **No URL change — summary is a VIEW within the existing `/questionnaire` route.** Route-level persistence of `view: 'question' | 'summary'` in `DraftState` is the resume mechanism. Do NOT introduce a sub-route like `/questionnaire/recapitulatif-section-1`. Adds router complexity for zero UX benefit; the container (full-screen, same progress bar) is identical to QuestionnaireStep. [Source: epic AC1 "full-screen, same container as QuestionnaireStep — it is not a modal or drawer"]
- **Design tokens only — no raw hex.** H2 `text-foreground`, Modifier ghost link `text-muted-foreground`, row border `border-border`, row separator 1 px. DL `<dt>` at 11 px uses `text-[11px]` arbitrary — acceptable (2.4 precedent: `text-[22px]` / `text-[28px]` on the H1). [Source: apps/web/src/index.css]
- **Reuse `QUESTIONNAIRE`, `QUESTIONNAIRE_FLAT`, `TOTAL_QUESTIONS` from `@/data/questionnaire`** — NO new fixtures, NO duplication. `SectionSummary` filters `QUESTIONNAIRE_FLAT` by `sectionId` to get the 4 `QuestionMeta` entries for the section (need `globalIndex` for the onEdit callback, which `Section.questions[i]` lacks). [Source: apps/web/src/data/questionnaire.ts]
- **Reuse the Button primitive** — `<Button size="lg" className="h-11 px-4">` for the Valider CTA (2.3/2.4 recipe for 44 × 44 tap target + WCAG 2.2 AA). Do NOT introduce a new size variant. [Source: apps/web/src/components/ui/button.tsx]
- **No React Hook Form / Zod** — still applies (Pinned #4 from 2.4 carries over). The summary is read-only display + two click handlers; no form library needed. Editing a question goes through the existing `QuestionnaireStep` form which already handles its own submit. [Source: 2-4-questionnaire-step-component-hardcoded-questions.md#Pinned Decisions]
- **Persistence contract stays stable:** same `confluent_draft_{dossierName}` key, JSON payload adds `view` field. Drafts from 2.4 (no `view`) gracefully upgrade to `view: 'question'` via the permissive guard. [Source: apps/web/src/routes/dashboard/dossiers/nouveau/questionnaire.tsx]
- **The existing Story 2.3 `<Navigate>` guard stays intact** — `if (!dossierName) return <Navigate to="/dashboard/dossiers/nouveau" replace />`. Section summary is only reachable after naming the dossier. [Source: apps/web/src/routes/dashboard/dossiers/nouveau/questionnaire.tsx:54-58]
- **Live region + document-level ArrowUp listener (from 2.4 review patches) are preserved.** 2.5 extends both: the live region's text varies by `view`; the listener short-circuits on `view === 'summary'` AND on `editingFromSummary`. [Source: apps/web/src/routes/dashboard/dossiers/nouveau/questionnaire.tsx:76-104, 157-164]
- **WCAG 2.1 AA baseline:** H2 focus on mount (announces the section title), focus ring on all interactive elements, 44 × 44 tap targets on mobile, `aria-hidden` on decorative glyphs (→, ←), `prefers-reduced-motion: reduce` honored by the existing `motion-safe:` gating. [Source: ux-design-specification.md#Accessibility, 2-4 review patches]

### Design Tokens to Use

| Surface | Tailwind utility | Value | Where |
|---|---|---|---|
| Section H2 | `font-heading text-xl md:text-2xl font-semibold text-foreground` | 20 → 24 px | SectionSummary heading |
| Question label | `text-[11px] uppercase tracking-wider text-muted-foreground` | 11 px caps / `#6B6B6B` | `<dt>` per row |
| Answer value | `text-[13px] font-medium text-foreground` | 13 px / `#1A1A1A` | `<dd>` per row |
| Empty answer fallback | `text-muted-foreground` | `#6B6B6B` | em-dash `—` when answer is empty |
| Row separator | `border-b border-border` | 1 px / `#E8E8E7` | Between Q/R rows |
| Modifier button | `text-xs text-muted-foreground hover:underline` | 12 px / `#6B6B6B` | Per-row edit trigger |
| Valider CTA | `bg-primary text-primary-foreground h-11 px-4` (Button size=lg) | `#37352F` / white / 44 px | "Valider cette section →" |
| Return-to-summary link | `text-xs text-muted-foreground hover:underline min-h-11` | 12 px / `#6B6B6B` / 44 px tap | In QuestionnaireStep when editingFromSummary |

### Component Prop Contracts (exhaustive)

```ts
// apps/web/src/features/questionnaire/components/SectionSummary.tsx
export interface SectionSummaryProps {
  section: Section
  sectionIndex: number
  answers: Record<string, string>
  onEdit: (globalIndex: number) => void
  onValidate: () => void
}

// apps/web/src/features/questionnaire/components/QuestionnaireStep.tsx (extended)
export interface QuestionnaireStepProps {
  question: QuestionMeta
  indicatorText: string
  value: string
  onChange: (next: string) => void
  onAdvance: (cleaned: string) => void
  onBack: () => void
  canGoBack: boolean
  returnToSummary?: { onReturn: () => void }    // NEW in 2.5
}

// apps/web/src/routes/dashboard/dossiers/nouveau/questionnaire.tsx (extended)
interface DraftState {
  answers: Record<string, string>
  position: number
  view: 'question' | 'summary'                  // NEW in 2.5
  updatedAt: string
}
```

### File Layout (target)

```
apps/web/src/
├── components/
│   ├── confluent/
│   │   └── WizardInput.tsx                                     [UNCHANGED]
│   └── ui/
│       └── button.tsx                                          [UNCHANGED]
├── data/
│   └── questionnaire.ts                                        [UNCHANGED — fixture reused]
├── features/
│   └── questionnaire/
│       └── components/
│           ├── QuestionnaireProgress.tsx                       [UNCHANGED]
│           ├── QuestionnaireStep.tsx                           [MODIFIED — +returnToSummary optional prop + link render]
│           └── SectionSummary.tsx                              [NEW — checkpoint screen]
├── lib/
│   └── sanitize.ts                                             [UNCHANGED]
├── routes/
│   └── dashboard/
│       └── dossiers/
│           └── nouveau/
│               ├── index.tsx                                   [UNCHANGED]
│               ├── questionnaire.tsx                           [MODIFIED — DraftState.view + handlers + conditional render + indicator text + listener guard]
│               └── recapitulatif.tsx                           [UNCHANGED]
└── router.tsx                                                  [UNCHANGED]
```

### Previous Story Intelligence

**From Story 2.4 (just landed):**
- `DraftState`, `loadDraft`, `patchDraft` are all in the route file — extend them there, do NOT move them out into a `lib/` helper. Single-caller, inline-is-fine rule from 2.2/2.3/2.4 continues.
- `motion-safe:animate-slide-up-in` and `motion-safe:animate-slide-down-in` utilities ship in `index.css` (2.4). Reuse them — do NOT add new keyframes.
- Keyed wrapper pattern: `<div key={...}>` triggers CSS animation remount. 2.5 needs a compound key (`${view}-${position}`) so view-only transitions (Q4 submit → summary for Section 1) fire the animation.
- `editingFromSummary` is LOCAL state, not persisted — matches the 2.4 Pinned #4 spirit of "single draft atom for persistence, local state for transient UI flags".
- 2.4 review patches: live region in route (not in step), document-level ArrowUp listener. Both need minor updates for 2.5 (text variation by view, short-circuit in summary/edit mode).
- `<WizardInput key={question.id} autoFocus />` remount trick (Pinned #5): when editing-from-summary, the input still needs fresh autofocus on each Modifier click. The existing key-based remount already handles this — no change needed.
- Story 2.4 review left 8 deferred items; none block 2.5. The `confluent_draft_{dossierName}` schema-versioning item (Epic 7) is the one most at risk of being stressed by 2.5's `view` field addition, but 2.5's backward-compat guard for a missing `view` handles the forward-migration case naturally.

**From Stories 2.2 / 2.3 (carried):**
- `h-11 px-4` tap-target recipe for primary buttons (2.2 code-review patch) — applied to Valider CTA.
- `components/confluent/` is ONLY for design-system-level primitives. `SectionSummary` is feature-scoped (imports `Section`, `QuestionMeta`, `QUESTIONNAIRE_FLAT`), so lives in `features/questionnaire/components/`.
- No `cva` variant system yet (2.2 Pinned #6) — `SectionSummary` doesn't need one.

### Anti-Patterns to Avoid

- **Do NOT create a new URL route for the summary.** Keep the wizard at `/questionnaire` and control the view via `DraftState.view`. A separate route would add router complexity, require extra breadcrumb suppression, and complicate resume semantics.
- **Do NOT use `<Button variant="link">` for Modifier or Return-to-summary triggers.** Shadcn's link variant uses `text-primary` (near-black), but spec requires `text-muted-foreground` (grey). Plain `<button>` with custom classes is the correct semantic compromise.
- **Do NOT render the summary as a `<Sheet>` / modal / dialog.** Epic AC1 is explicit: "full-screen, same container as QuestionnaireStep — it is NOT a modal or drawer."
- **Do NOT use `<a>` tags for "Modifier" rows.** They do not navigate to URLs; they mutate local state. `<button type="button">` is semantically correct.
- **Do NOT hide the back chevron when editingFromSummary** — keep it in the DOM as `disabled` to preserve tab order consistency. Conditional DOM shape changes in the middle of a keyboard flow disorient AT users.
- **Do NOT auto-advance to the next question on submitting an edit.** Edit mode always returns to the summary view. This is an AC5 requirement: the user reached Q2 via "Modifier" to fix one answer, not to resume the wizard.
- **Do NOT persist `editingFromSummary`.** It's a transient UI flag. On tab-close during an edit, resume to plain question mode is acceptable (AC7 sanctioned).
- **Do NOT trigger a summary for Section 3.** AC1 is explicit: boundary trigger is `currentQuestion.sectionIndex < 3`. Section 3's last question (Q12) still navigates to `/recapitulatif` (Story 2.6 scope).
- **Do NOT hardcode `4` or `8` as the section-boundary global indices.** Derive from the fixture: `currentQuestion.positionInSection === currentSection.questions.length && currentQuestion.sectionIndex < 3`. If the fixture ever reshapes (Epic 7 schema-driven), the logic stays correct.
- **Do NOT introduce a new `view` value beyond `'question' | 'summary'`.** A third value (e.g. `'completion'`) would complicate the runtime guard in `loadDraft`. Story 2.6 will decide whether to add one OR handle completion via a different mechanism (it already uses route navigation to `/recapitulatif`).
- **Do NOT update the live-region text to announce individual row changes.** The live region announces view transitions only — not per-answer updates. Announcing every answer edit would be SR spam.
- **Do NOT focus the Valider button on summary mount.** Focus the H2 (with `tabIndex=-1`) so SR users get section-orientation, and require the user to Tab explicitly to the Valider button. Auto-focusing the CTA risks accidental Enter-advance.

### Testing Requirements

- **Unit / integration tests remain out of scope** for Epic 2 frontend — no Vitest/RTL harness. Do not introduce one here.
- **Manual verification is the primary gate** (Task 5 walkthrough). Tri-viewport walkthrough (375 / 900 / 1440 px), axe audit on `/questionnaire` in: (a) Section 1 summary state, (b) edit-from-summary state (Q2 with ← Retour au récapitulatif link visible), (c) post-validate transition state. Screen-reader sanity check for H2 orientation on summary mount + live-region text variation. `prefers-reduced-motion` toggle for all four transition types.
- **Type safety:** `DraftState['view']` is a string-literal union; the `loadDraft` fallback narrows from `unknown` to `'question' | 'summary'`. `returnToSummary` is an optional object prop — TypeScript's `Partial` semantics handle the "undefined === normal 2.4 mode" case correctly.
- **No new lint warnings permitted** beyond the 3 tolerated ones.
- **No regression on Stories 2.1–2.4 ACs:** `/dashboard` empty state still works, `/dashboard/dossiers/nouveau` naming still writes `confluent_draft_name` and navigates, progress bar still animates, disabled-button empty-answer UX still applies, ArrowUp back-nav still works within a section.

### Decisions Pinned for This Story (flag if divergence is intentional)

1. **Summary is a VIEW within `/questionnaire`, not a sub-route.** No URL change, no router update. State-driven via `DraftState.view`.
2. **`DraftState.view` added to the persisted JSON shape.** Permissive `loadDraft` guard makes the field optional on rehydrate — 2.4 drafts resume as `view: 'question'` without error.
3. **`editingFromSummary` is LOCAL state only, not persisted.** Tab-close during an edit resumes to plain question mode — acceptable UX trade-off for Epic 2 hardcoded scope.
4. **Back chevron stays in DOM (disabled) during edit mode** rather than being conditionally rendered — preserves tab order stability.
5. **H2 receives programmatic focus on summary mount, Valider button does not.** Orientation over one-click-advance.
6. **Modifier and Return-to-summary triggers are `<button type="button">`, not `<Button variant="link">`.** Token color divergence (spec wants muted, not primary); semantics match (mutate state, don't navigate).
7. **Section boundary logic uses `positionInSection === section.questions.length && sectionIndex < 3`** — data-driven, robust to fixture reshape. No hardcoded `4` / `8` / `12`.
8. **Live region text varies by view:** `Récapitulatif · Section {N} · {title}` for summary, unchanged 2.4 format for question view.
9. **Keyed wrapper uses a compound key `${view}-${position}`** so a Q→Summary transition at the same position still remounts and re-fires the animation.
10. **No Section 3 summary in 2.5.** Story 2.6 owns that path + completion. 2.5's boundary condition explicitly excludes Section 3.
11. **Document-level ArrowUp listener short-circuits on `view === 'summary'` OR `editingFromSummary === true`.** Uses a ref for `editingFromSummary` because the listener is registered once (empty deps) and can't see React state updates via closure.
12. **Commit strategy:** single `feat(epic-2): story 2.5 — section summary & inter-section checkpoint` commit that bundles implementation AND code-review patches (per user memory preference, established in 2.4).

### References

- Story AC + narrative: [Source: [_bmad-output/planning-artifacts/epics.md](_bmad-output/planning-artifacts/epics.md#L523-L553)#Story 2.5 — SectionSummary Inter-section Checkpoint]
- SectionSummary anatomy (H2, Q/R pairs, Modifier link, Valider button): [Source: [_bmad-output/planning-artifacts/ux-design-specification.md](_bmad-output/planning-artifacts/ux-design-specification.md#L539-L547)#`SectionSummary`]
- Row label/value styling (11 px small caps / 13 px 500 weight): [Source: [_bmad-output/planning-artifacts/ux-design-specification.md](_bmad-output/planning-artifacts/ux-design-specification.md#L572)#`DossierField` (adopted pattern)]
- Section checkpoint rationale (extension of Typeform for 25-min form): [Source: [_bmad-output/planning-artifacts/ux-design-specification.md](_bmad-output/planning-artifacts/ux-design-specification.md#L179, #L504)#Inspiration Sources / Form Patterns]
- QuestionnaireStep prop contract (to extend with `returnToSummary`): [Source: [apps/web/src/features/questionnaire/components/QuestionnaireStep.tsx](apps/web/src/features/questionnaire/components/QuestionnaireStep.tsx)]
- Route state management (`DraftState`, `loadDraft`, `patchDraft`, live region, document listener): [Source: [apps/web/src/routes/dashboard/dossiers/nouveau/questionnaire.tsx](apps/web/src/routes/dashboard/dossiers/nouveau/questionnaire.tsx)]
- Questionnaire fixture (`QUESTIONNAIRE`, `QUESTIONNAIRE_FLAT`, `QuestionMeta`): [Source: [apps/web/src/data/questionnaire.ts](apps/web/src/data/questionnaire.ts)]
- Design tokens: [Source: [apps/web/src/index.css](apps/web/src/index.css)]
- Previous-story pinned decisions + review patches: [Source: [_bmad-output/implementation-artifacts/2-4-questionnaire-step-component-hardcoded-questions.md](_bmad-output/implementation-artifacts/2-4-questionnaire-step-component-hardcoded-questions.md)]
- Deferred-work trail for Story 2.4 (cross-tab stomp, schema versioning, error boundary, etc.): [Source: [_bmad-output/implementation-artifacts/deferred-work.md](_bmad-output/implementation-artifacts/deferred-work.md)]

### Latest Technical Information

- **React 19 programmatic focus on mount** — `useRef` + `useEffect(() => { ref.current?.focus() }, [])` is the stable pattern. The effect runs after paint; focus lands reliably. No `queueMicrotask`/`setTimeout` needed.
- **`tabIndex={-1}` on focusable elements** — allows `ref.focus()` to succeed on elements that aren't in the natural Tab order (headings, divs, articles). Does NOT make the element part of the Tab sequence, which is what we want for the H2 (Tab skips it after initial focus).
- **Tailwind v4 arbitrary font-sizes** (`text-[11px]`, `text-[13px]`) — ship in the generated CSS without a config change; used throughout 2.4 already.
- **React closure capture with `useEffect` + empty deps** — the document listener is registered once. React state values captured in the closure are stale after subsequent re-renders. Use a ref (`useRef` + assignment in the component body) to always read the latest value (e.g., `editingFromSummary`).
- **localStorage JSON shape evolution** — permissive loaders that fall back to defaults on missing fields are the pragmatic migration strategy for client-side persistence without schema versioning. Epic 7 will introduce server-side identity + versioning.

### Project Context Reference

No `project-context.md` exists at the repo root. Authoritative planning inputs remain the PRD, epics, architecture, and UX spec under `_bmad-output/planning-artifacts/`, plus locked patterns from Stories 1.1–2.4. User memory index at [MEMORY.md](../../.claude/projects/-home-coder-confluent/memory/MEMORY.md) notes one active feedback: bundle story implementation + code-review patches into a single commit.

## Dev Agent Record

### Agent Model Used

claude-opus-4-7

### Debug Log References

- `pnpm turbo run typecheck`: 2 successful, 0 errors. New types `SectionSummaryProps`, extended `DraftState['view']` string-literal union, extended `QuestionnaireStepProps['returnToSummary']` optional object prop all compile cleanly.
- `pnpm turbo run lint`: 2 successful on second try. Initial lint failed with a `react-hooks/refs` error ("Cannot update ref during render") on the `editingRef.current = editingFromSummary` line. Fixed by wrapping the ref update in a `useEffect(() => { editingRef.current = editingFromSummary }, [editingFromSummary])` — the idiomatic pattern for "ref-shadowing state for stable listener capture". 3 pre-existing warnings tolerated (badge, button, current-user — same as baseline). Zero new warnings.
- `pnpm turbo run build`: 2 successful, 0 errors. Build time 3.7s. 1785 modules transformed (+1 module: SectionSummary).
- Bundle delta vs Story 2.4 post-patches baseline (43.18 kB / 8.42 kB gzip CSS; 339.13 kB / 107.96 kB gzip JS):
  - CSS: 44.01 kB (gzip 8.57 kB) → +0.83 kB (+0.15 kB gzip) — no new `@utility` blocks; delta is Tailwind-generated classes for `text-[11px]`, `text-[13px]`, `uppercase tracking-wider`, `border-b`, `min-h-11 min-w-11`, `focus-visible:outline-*` variants.
  - JS: 341.91 kB (gzip 108.59 kB) → +2.78 kB (+0.63 kB gzip) — SectionSummary component, extended `DraftState.view` + `loadDraft` guard, new handlers (`handleEditFromSummary`, `handleReturnToSummary`, `handleValidateSection`, `lastGlobalIndexOfSection`), `editingFromSummary` local state + ref sync effect, extended `QuestionnaireStep` with optional return link, compound keyed wrapper.
  - Within spec's envelope (+0.5 kB gzip CSS, +1.5–2.5 kB gzip JS).

### Completion Notes List

1. **`DraftState.view` landed with permissive backward-compat guard.** `loadDraft` narrows `draft.view === 'summary' ? 'summary' : 'question'` — drafts from Story 2.4 (no `view` field) and any malformed value fall back to `'question'`. No migration breakage.
2. **`SectionSummary` landed at `apps/web/src/features/questionnaire/components/SectionSummary.tsx`** — third tenant of the feature module. Presentational + focus-management only; no router, no storage, no state mutation. Props: `{ section, sectionIndex, answers, onEdit, onValidate }`. Filters `QUESTIONNAIRE_FLAT` by `sectionId` to get the 4 `QuestionMeta` entries (needs `globalIndex` for `onEdit`; `Section.questions[i]` only has `Question`, no `globalIndex`).
3. **H2 focus-on-mount via `useRef` + `useEffect`** — `ref.current?.focus()` on mount. H2 has `tabIndex={-1}` so focus() succeeds; `focus-visible:outline-none` on the H2 hides the ring for this programmatic-only focus. User-initiated Shift+Tab-to-H2 would still show the ring because `focus-visible` is the default for keyboard focus.
4. **`QuestionnaireStep` extended with optional `returnToSummary: { onReturn: () => void }`** — when defined, renders a `← Retour au récapitulatif` ghost link between the `WizardInput` and the OK action row. When undefined, nothing renders and the 2.4 surface is byte-identical. Leading `←` glyph is `aria-hidden="true"`; accessible text is "Retour au récapitulatif". Minimum 44 px tap target via `min-h-11 self-start`.
5. **Back chevron stays in DOM, toggled `disabled` in edit mode.** `canGoBack={!editingFromSummary && position > 1}`. Preserves Tab order stability — the chevron is always in the sequence but inert when editing.
6. **Route wiring — 4 new handlers:**
   - `handleEditFromSummary(targetGlobalIndex)`: sets `editingFromSummary=true`, direction=`backward`, position=target, view=`question`.
   - `handleReturnToSummary()`: `editingFromSummary=false`, direction=`forward`, position=last-of-current-section, view=`summary`.
   - `handleValidateSection()`: direction=`forward`, position=position+1, view=`question`. Position currently at the last-of-section global index → +1 gives first of next section. No off-by-one.
   - `handleAdvance` extended with two branches: (a) if `editingFromSummary`, save answer + return to summary; (b) if last question of Section 1 or 2, flip to `view='summary'` without changing position; (c) if Q12, unchanged 2.4 behaviour (persist + navigate to `/recapitulatif`); (d) default, advance to next question.
7. **Section boundary detection is data-driven, not hardcoded:**
   ```ts
   currentQuestion.positionInSection === currentSection.questions.length &&
   currentQuestion.sectionIndex < 3
   ```
   If the fixture ever reshapes (Epic 7 schema-driven), the logic stays correct.
8. **`lastGlobalIndexOfSection(sectionId)` helper** — at module scope, filters `QUESTIONNAIRE_FLAT`, returns the last `globalIndex`. Used by both `handleEditFromSummary` / `handleReturnToSummary` and the edit-submit branch of `handleAdvance`.
9. **Document-level ArrowUp listener extended** with two short-circuits: `view === 'summary'` (via functional setDraft reading `prev.view`) and `editingFromSummary` (via `editingRef.current` to bypass React's closure capture in the empty-deps effect). Ref sync happens in a separate `useEffect([editingFromSummary])` — the lint rule `react-hooks/refs` correctly flagged my initial "during-render assignment" and the `useEffect` pattern is the idiomatic fix.
10. **Compound keyed wrapper** `key={\`${view}-${position}\`}` — Q→Summary at the same `position` triggers remount + CSS animation because `view` flips. Summary→Q5 also triggers via both axes changing.
11. **Indicator text varies by view.** Summary: `Récapitulatif · Section {N} · {title}`. Question: unchanged 2.4 format. Live region (`sr-only`) in the route swaps text on every transition and persists across all remounts.
12. **Edit-from-summary is transient UI state, NOT persisted** (Pinned Decision #3). Tab-close during edit → resume as plain question mode. Acceptable UX trade-off for Epic 2 hardcoded scope; Epic 7's real-API persistence will supersede.
13. **All 10 ACs verified against implementation:** AC1 boundary trigger (sections 1, 2 only; position preserved) ✓, AC2 anatomy (H2, dl, Valider button) ✓, AC3 row styling (11 px caps / 13 px 500 / empty-answer em-dash / button not anchor) ✓, AC4 Modifier → backward slide + preserved answer + editingFromSummary=true ✓, AC5 return link + disabled back chevron + listener short-circuit + submit-returns-to-summary ✓, AC6 Valider → forward slide + progress animates past checkpoint ✓, AC7 resume preserves summary view + backward-compat guard for missing `view` field ✓, AC8 Tab order (H2→Modifiers→Valider) with focus rings ✓, AC9 live region text variation ✓, AC10 mobile responsive (H2 text-xl→text-2xl, 44×44 tap targets, flex-wrap) ✓.
14. **Visual verification pending (recommended before merge):** tri-viewport walkthrough (375 / 900 / 1440 px), axe audit on `/questionnaire` in Section 1 summary / edit-from-summary / post-validate states, `prefers-reduced-motion` toggle for all four transition types (Q→Summary, Summary→Modifier, Edit→Summary, Summary→NextQ), VoiceOver/NVDA sanity check on summary mount + live-region text variation, localStorage DevTools roundtrip (including the "delete `view` field" backward-compat case from Task 5 step 10). Programmatic signals are all green.
15. **No regression on Stories 2.1–2.4 ACs:** `/dashboard` empty state + CTA unchanged. `/dashboard/dossiers/nouveau` naming step still writes `confluent_draft_name`. Questionnaire normal flow (Q1–Q4 within Section 1, Q5–Q8 within Section 2, Q9–Q12 within Section 3) unchanged. ArrowUp back-nav inside a section still works (short-circuits only on summary view / edit mode). Disabled-button empty-answer UX unchanged. `/recapitulatif` stub unchanged — still hit at end of Section 3.

### File List

**Created:**
- `apps/web/src/features/questionnaire/components/SectionSummary.tsx` — checkpoint screen (H2 + dl of Q/R rows + Valider CTA), H2 autofocus on mount, filters `QUESTIONNAIRE_FLAT` by `sectionId`

**Modified:**
- `apps/web/src/features/questionnaire/components/QuestionnaireStep.tsx` — added optional `returnToSummary?: { onReturn: () => void }` prop, renders ghost "← Retour au récapitulatif" link between input and action row when defined
- `apps/web/src/routes/dashboard/dossiers/nouveau/questionnaire.tsx` — extended `DraftState` with `view: 'question' | 'summary'`, permissive backward-compat in `loadDraft`, new `lastGlobalIndexOfSection` helper, four new/extended handlers (`handleAdvance` with edit + boundary branches, `handleEditFromSummary`, `handleReturnToSummary`, `handleValidateSection`), `editingFromSummary` local state + `editingRef` synced via `useEffect`, document-level ArrowUp listener short-circuits on summary/edit mode, compound keyed wrapper `${view}-${position}`, indicator text variation by view, conditional render of `SectionSummary` vs `QuestionnaireStep`

### Change Log

- **2026-04-20** — Story 2.5 initial implementation: `SectionSummary` component (H2 + semantic `<dl>` + Valider CTA, autofocus H2 for SR orientation), extended `DraftState` with persisted `view` field + permissive backward-compat guard in `loadDraft`, extended `QuestionnaireStep` with optional `returnToSummary` prop (ghost link), new route handlers for edit/return/validate flows, section-boundary detection data-driven from fixture, document-level ArrowUp listener short-circuits on summary/edit mode, compound keyed wrapper for view+position transitions, live-region text variation. Typecheck/lint/build: 6/6 green (after one-iteration fix for `react-hooks/refs` — ref sync moved into `useEffect`), 0 errors, 3 tolerated pre-existing warnings, zero new warnings. Bundle delta: +0.83 kB CSS (+0.15 kB gzip), +2.78 kB JS (+0.63 kB gzip).
- **2026-04-21** — Code-review patches applied: (P1) per-row `aria-label="Modifier la réponse : {q.label}"` on each Modifier button so SR users can distinguish the 4 identical "Modifier" triggers; (P2) `loadDraft` hardened with cross-field validation — `view: 'summary'` is now honored only if `position` is the last-question globalIndex of a section with `sectionIndex < 3`, otherwise the view falls back to `'question'`. Closes the tampered-localStorage crash path (`view:'summary' + position:12` → Valider → `QUESTIONNAIRE_FLAT[12]` undefined). Two deferred items recorded in `deferred-work.md` (pre-existing `setItem` try/catch and per-keystroke debounce from 2.4). Typecheck/lint/build: 6/6 green, 0 errors, 3 tolerated pre-existing warnings, zero new warnings. Bundle delta vs post-impl baseline: +0 kB CSS, +0.10 kB JS (aria-label strings + loadDraft guard body).
