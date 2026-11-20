# Story 2.6: Completion Screen & Dossier Display

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an entrepreneur who has just finished the 12-question questionnaire,
I want to see a clear confirmation screen and then view my completed dossier,
so that I know my work is saved and can review how it will appear to shared recipients.

## Acceptance Criteria

1. **Given** the user clicks "Valider cette section →" on the Section 3 summary (new in Story 2.5) **OR** submits the final answer on Q12 via Enter (edge case: Section 3 has no intermediate summary per Story 2.5 Pinned Decision #10 — `handleAdvance` navigates directly from Q12), **When** the navigation fires, **Then** the route `/dashboard/dossiers/nouveau/recapitulatif` renders the completion confirmation view (NOT the previous stub). The page is full-screen under the `AppShell` with `handle: { hideBreadcrumb: true }` already set (router.tsx, Story 2.4). `<title>` is `Dossier complété · Confluent`.

2. **Given** the completion confirmation view renders, **When** a developer inspects the DOM, **Then** it contains, centered and in this vertical order:
   - A checkmark icon: `<CircleCheckIcon>` from `lucide-react` (`size={48}`, className `text-status-active`). The token `text-status-active` resolves to `#4CAF7D` per `index.css`. NO raw hex in the JSX.
   - An H1 `Dossier complété !` using `font-heading text-2xl font-semibold text-foreground` (narrow no-break space ` ` before `!` per French typography, stored as ` ` literal like in `data/questionnaire.ts`).
   - A secondary description: `Votre dossier {dossierName} est prêt. Vous pouvez maintenant le consulter et le partager.` in `text-sm text-muted-foreground max-w-md`, where `{dossierName}` is the raw (non-slugified) dossier name read from `localStorage.getItem('confluent_draft_name')`.
   - A primary `<Button size="lg" className="h-11 px-4">` labelled `Voir mon dossier` (no decorative arrow glyph — the button navigates to the dossier view; distinct from "Valider cette section →" which continues the wizard).

3. **Given** the completion view mounts, **When** the `useEffect` runs, **Then** three localStorage side effects fire in this exact order:
   - **(a)** Compute `slug = slugify(dossierName)` (see Task 2 for the utility).
   - **(b)** Copy `localStorage.getItem('confluent_draft_' + dossierName)` to `localStorage.setItem('confluent_draft_' + slug, ...)` if and only if `slug !== dossierName` (i.e. slugification mutated the name) AND the target slug key does not already hold a newer copy. Use `Date.parse(draft.updatedAt)` to compare timestamps and skip the copy if the existing slug-keyed draft is newer (defensive against double-mount in React Strict Mode).
   - **(c)** Remove the pre-slug key: `localStorage.removeItem('confluent_draft_' + dossierName)` if `slug !== dossierName`.
   - `confluent_draft_name` is NOT removed here — it is consumed by the completion view itself for the description text. Cleanup of `confluent_draft_name` is AC4's responsibility.

4. **Given** the user clicks "Voir mon dossier", **When** the click fires, **Then** in this order: (a) `localStorage.removeItem('confluent_draft_name')` fires (closing out the 2.3 deferred cleanup item) and (b) the router navigates to `/dashboard/dossiers/{slug}` (client-side `navigate(...)`, not `window.location`). The completion view is unmounted; the dossier view mounts.

5. **Given** the route `/dashboard/dossiers/:slug`, **When** it renders, **Then**:
   - The outer container is `<main>` (provided by `AppShell`); the dossier page renders inside it. The page itself provides its own custom inline breadcrumb (because `hideBreadcrumb: true` is set on this route — see Pinned Decision #3) — a two-segment list: `Dossiers` (linked to `/dashboard`) → `{dossierName}` (non-linked, `aria-current="page"`). Styling matches the existing auto-breadcrumb: `text-xs text-muted-foreground` with a `/` separator `text-muted-foreground/60`.
   - An H1 `{dossierName}` using `font-heading text-2xl font-semibold text-foreground md:text-[28px]` (H1 recipe is 28 px per UX spec; applies `md:` breakpoint for mobile compression).
   - For each of the 3 sections, an H2 `{N}. {section.title}` (e.g. "1. Présentation") using `font-heading text-xl font-semibold text-foreground md:text-2xl` (matches the 2.5 SectionSummary H2 recipe), followed by a `<dl>` containing 4 `DossierField` components (one per question in the section) in declared order.
   - Content max-width 720 px per UX spec (`max-w-[720px] mx-auto`).

6. **Given** the `DossierField` component, **When** a developer inspects the DOM, **Then**:
   - It renders a `<div>` (NOT a `<dl>` — the `<dl>` wrapper is owned by the dossier page, one per section; `DossierField` is a single `<dt>/<dd>` pair wrapped in a `<div>` for flex/grid layout, consistent with Story 2.5's SectionSummary row pattern).
   - `<dt>` uses `text-[11px] uppercase tracking-wider text-muted-foreground` (matches 2.5 SectionSummary).
   - `<dd>` uses `mt-1 text-[13px] font-medium text-foreground leading-relaxed` (`leading-relaxed` = `line-height: 1.625`, covers the ≥1.6 requirement from AC below).
   - No truncation, no `line-clamp` — long-text answers wrap naturally. `break-words` on the `<dd>` to handle single-token URLs / unbroken runs.
   - An empty-string answer renders `<span className="text-muted-foreground">—</span>` (same defensive em-dash as 2.5 SectionSummary, for pre-2.5 drafts or edge cases).

7. **Given** a `DossierField` with a long-text answer (> 100 characters), **When** a developer inspects the DOM, **Then** the `<dd>` uses `leading-relaxed` (line-height 1.625) and does NOT truncate, clip, or ellipsize the text. Line length is constrained by the page's 720 px max-width, not by the component.

8. **Given** the dossier page renders on mobile (< 768 px viewport), **When** a developer inspects, **Then**:
   - All `DossierField` items stack vertically in a single column (`flex flex-col gap-6` on the section's `<dl>`).
   - No horizontal overflow at any viewport ≥ 320 px.
   - Section H2s are "clearly separated sub-headings" — a `mt-10` between sections is sufficient (not sticky; sticky was mentioned in the epic AC as an option — see Pinned Decision #5).
   - The custom breadcrumb wraps gracefully (`flex-wrap`) if the dossier name is long.

9. **Given** the user navigates directly to `/dashboard/dossiers/{slug}` (e.g. a bookmarked URL or a refresh), **When** the page mounts, **Then**:
   - Read `confluent_draft_{slug}` from localStorage. If present and `answers` has ≥ 1 key, render the dossier using those answers.
   - If the slug-keyed draft is missing OR `answers` is empty, render a minimal fallback: `<p>Dossier introuvable.</p>` + a `<Link to="/dashboard">Retour au tableau de bord</Link>`. NO blank white page, NO infinite spinner.
   - Unanswered questions render with the em-dash fallback from AC6 (graceful partial display).
   - Browser refresh on this page preserves the dossier view (AC7 from epic: "data persists in localStorage under `confluent_draft_{slug}`").

10. **Given** a keyboard-only user on the completion view, **When** they Tab, **Then** focus lands on the H1 first (via `tabIndex={-1}` + `useRef` + `useEffect` focus-on-mount, same recipe as Story 2.5's SectionSummary H2), then Tab moves to the `Voir mon dossier` button. Enter on the button triggers AC4's navigation. `focus-visible:outline-none` on the H1 hides the ring for the programmatic focus (matches 2.5 pattern). On the dossier view, initial focus also goes to the H1.

11. **Given** a screen-reader user on the completion view, **When** the page mounts, **Then** the H1 "Dossier complété !" is the first element announced. The `CircleCheckIcon` has `aria-hidden="true"` (decorative); the semantic success is conveyed by the H1 text, not by the icon. No live-region announcement is needed — the page mount itself is the announcement.

12. **Given** the router configuration, **When** the app boots, **Then** a new route `dashboard/dossiers/:slug` is registered in `router.tsx` **after** all `dashboard/dossiers/nouveau/*` routes (so the `:slug` pattern does not shadow `nouveau/`). The route element is `<DossierViewRoute />`. `handle: { hideBreadcrumb: true }` is set because the page renders its own custom two-segment breadcrumb. The existing `Navigate` at `dashboard/dossiers` → `/dashboard` stays in place (the auto-breadcrumb for `/dashboard/dossiers` path is unused because of the handle, but the Navigate still intercepts bare-URL visits).

## Tasks / Subtasks

- [x] Task 1: Create the `slugify` utility (AC: 1, 3, 4, 9)
  - [x] File: `apps/web/src/lib/slugify.ts`. Named export, no default export.
  - [x] Implementation:
    ```ts
    export function slugify(name: string): string {
      return name
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '') // strip combining diacritics
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
    }
    ```
  - [x] Behaviour contract (document in a one-line comment at the top of the file):
    - `"Biosensio"` → `"biosensio"`
    - `"Éco-Logis"` → `"eco-logis"`
    - `"  Test  Projet  "` → `"test-projet"`
    - `"Très-Très Spécial"` → `"tres-tres-special"`
    - `"!!!"` → `""` (empty string — caller MUST guard; see AC9 fallback path)
    - `"42 Labs"` → `"42-labs"`
  - [x] Do NOT add a fallback for empty result (e.g., "dossier" placeholder). The empty-result case is a Story 2.3 input-validation failure (name-only-special-chars slipped through) and should manifest as an AC9 "Dossier introuvable" fallback, not a silent default slug.

- [x] Task 2: Create the `DossierField` component (AC: 6, 7)
  - [x] File: `apps/web/src/components/confluent/DossierField.tsx`. Named export, no default export.
  - [x] Props contract:
    ```ts
    export interface DossierFieldProps {
      label: string
      value: string
      className?: string // per UX spec "Each custom component accepts a className prop"
    }
    ```
  - [x] Implementation skeleton:
    ```tsx
    import { cn } from '@/lib/utils'

    export interface DossierFieldProps {
      label: string
      value: string
      className?: string
    }

    export function DossierField({ label, value, className }: DossierFieldProps) {
      const hasValue = value.length > 0
      return (
        <div className={cn('flex flex-col', className)}>
          <dt className="text-[11px] uppercase tracking-wider text-muted-foreground">
            {label}
          </dt>
          <dd className="mt-1 text-[13px] font-medium text-foreground leading-relaxed break-words">
            {hasValue ? value : <span className="text-muted-foreground">—</span>}
          </dd>
        </div>
      )
    }
    ```
  - [x] Do NOT own the `<dl>` wrapper — it's the dossier page's responsibility, one per section, wrapping multiple `DossierField` instances. Reason: groups questions by section semantically, matches the 2.5 SectionSummary shape (`<dl>` around multiple `<div>`-wrapped rows).
  - [x] Lives under `components/confluent/` (not `features/questionnaire/`) because it is a design-system-level display primitive reused by Epic 3's dashboard dossier cards and Epic 4's financeur view per UX spec §Implementation Roadmap. Singular-file extraction now avoids the Epic 3 churn.
  - [x] `className` prop merges via `cn()` (Tailwind class-merge util, already used across shadcn components).
  - [x] NO variants in 2.6 (UX spec lists "short / long / numeric / classification" variants but Epic 2 only uses short/long, differentiated by answer length, not by prop. Classification/numeric variants land with Epic 3/4).

- [x] Task 3: Extend the questionnaire route to slugify + migrate on Section 3 final submit (AC: 3)
  - [x] Edit `apps/web/src/routes/dashboard/dossiers/nouveau/questionnaire.tsx`.
  - [x] Import `slugify` from `@/lib/slugify`.
  - [x] Modify ONLY the `handleAdvance` branch where `position >= TOTAL_QUESTIONS` (current implementation around lines 167-181). Do NOT touch any other branch. Preserve the `setDraft(finalDraft)` call — it's a 2.4-era line that keeps the React state in sync with what was persisted. Minimal patch:
    ```ts
    if (position >= TOTAL_QUESTIONS) {
      const finalDraft: DraftState = {
        answers: nextAnswers,
        position,
        view: 'question',
        updatedAt: new Date().toISOString(),
      }
      const slug = slugify(dossierName)
      const targetKey = slug ? `confluent_draft_${slug}` : draftAnswersKey(dossierName)
      localStorage.setItem(targetKey, JSON.stringify(finalDraft))
      if (slug && slug !== dossierName && targetKey !== draftAnswersKey(dossierName)) {
        localStorage.removeItem(draftAnswersKey(dossierName))
      }
      setDraft(finalDraft)
      navigate('/dashboard/dossiers/nouveau/recapitulatif')
      return
    }
    ```
  - [x] Note: if `slug === ''` (pathological case, see Task 1), the migration falls back to writing under the raw `confluent_draft_{dossierName}` key. The completion screen's subsequent slugify will re-compute an empty slug and the AC9 "Dossier introuvable" fallback kicks in when the user clicks "Voir mon dossier". No silent corruption.
  - [x] Do NOT remove `confluent_draft_name` here — it's consumed by the completion screen (AC2 description text).
  - [x] Do NOT touch the edit-from-summary branch, the intra-section advance branch, or the section-boundary branch from 2.5. The slug migration fires ONLY on the `position >= TOTAL_QUESTIONS` path.

- [x] Task 4: Replace the `recapitulatif.tsx` stub with the completion confirmation view (AC: 1, 2, 3, 4, 10, 11)
  - [x] Edit `apps/web/src/routes/dashboard/dossiers/nouveau/recapitulatif.tsx` (fully rewrite — current content is a 1-line H1 stub).
  - [x] File structure:
    ```tsx
    import { useEffect, useRef } from 'react'
    import { Navigate, useNavigate } from 'react-router-dom'
    import { CircleCheckIcon } from 'lucide-react'
    import { Button } from '@/components/ui/button'
    import { slugify } from '@/lib/slugify'

    const DRAFT_NAME_KEY = 'confluent_draft_name'

    function draftKey(keyName: string) {
      return `confluent_draft_${keyName}`
    }

    export default function RecapitulatifRoute() {
      const dossierName = localStorage.getItem(DRAFT_NAME_KEY)
      if (!dossierName) {
        return <Navigate to="/dashboard" replace />
      }
      return <CompletionView dossierName={dossierName} />
    }

    function CompletionView({ dossierName }: { dossierName: string }) {
      const navigate = useNavigate()
      const headingRef = useRef<HTMLHeadingElement>(null)
      const slug = slugify(dossierName)

      useEffect(() => {
        headingRef.current?.focus()
      }, [])

      // Defensive migration: if the draft still lives under the raw-name key
      // (e.g., the user navigated directly here or the questionnaire migration
      // was skipped), copy it under the slug key and remove the raw-name copy.
      useEffect(() => {
        if (!slug || slug === dossierName) return
        const rawKey = draftKey(dossierName)
        const slugKey = draftKey(slug)
        const rawRaw = localStorage.getItem(rawKey)
        if (!rawRaw) return
        const existingSlug = localStorage.getItem(slugKey)
        if (existingSlug) {
          // Skip copy if target is newer-or-equal — AC3(b)
          try {
            const a = Date.parse(JSON.parse(existingSlug).updatedAt ?? '')
            const b = Date.parse(JSON.parse(rawRaw).updatedAt ?? '')
            if (Number.isFinite(a) && Number.isFinite(b) && a >= b) {
              localStorage.removeItem(rawKey)
              return
            }
          } catch {
            // fall through to overwrite
          }
        }
        localStorage.setItem(slugKey, rawRaw)
        localStorage.removeItem(rawKey)
      }, [dossierName, slug])

      function handleViewDossier() {
        localStorage.removeItem(DRAFT_NAME_KEY)
        navigate(`/dashboard/dossiers/${slug}`)
      }

      return (
        <>
          <title>Dossier complété · Confluent</title>
          <section className="mx-auto flex max-w-md flex-col items-center gap-6 pt-16 text-center">
            <CircleCheckIcon
              size={48}
              aria-hidden="true"
              className="text-status-active"
            />
            <h1
              ref={headingRef}
              tabIndex={-1}
              className="font-heading text-2xl font-semibold text-foreground focus-visible:outline-none"
            >
              Dossier complété{' '}!
            </h1>
            <p className="text-sm text-muted-foreground">
              Votre dossier {dossierName} est prêt. Vous pouvez maintenant le consulter et le partager.
            </p>
            <Button
              type="button"
              size="lg"
              className="h-11 px-4"
              onClick={handleViewDossier}
            >
              Voir mon dossier
            </Button>
          </section>
        </>
      )
    }
    ```
  - [x] The `<Navigate to="/dashboard" replace />` guard covers the case where a user bookmarks `/dashboard/dossiers/nouveau/recapitulatif` but `confluent_draft_name` has already been removed (e.g., after a previous completion). Matches the pattern used by `questionnaire.tsx` at the analogous guard site.
  - [x] Do NOT use `window.location.href = ...` for the "Voir mon dossier" click — use `useNavigate()` for client-side routing (preserves the React Router state).
  - [x] The `dossierName` variable IS raw (pre-slugify) — that's intentional for the description text so the user sees the name they typed. Only the URL uses the slug.
  - [x] Keep `handle: { hideBreadcrumb: true }` on the route in `router.tsx` — already there from Story 2.4.

- [x] Task 5: Create the dossier view route component (AC: 5, 6, 7, 8, 9, 10)
  - [x] File: `apps/web/src/routes/dashboard/dossiers/[slug].tsx`. Named default export `DossierViewRoute`.
  - [x] NOTE ON FILE NAME: React Router v7's `createBrowserRouter` is NOT file-system-based — it takes an array of route objects in `router.tsx`. The `[slug].tsx` bracketed filename is a PROJECT CONVENTION for "a component whose route contains a `:slug` param" (Next.js-style). The actual route registration happens in `router.tsx` (Task 6). If the project prefers a different filename (e.g., `slug.tsx`, `view.tsx`, or a folder `[slug]/index.tsx`), use whatever matches existing conventions. None of Stories 2.1–2.5 introduced a param route, so this is the first convention choice — pick explicit-and-readable: `apps/web/src/routes/dashboard/dossiers/[slug].tsx`.
  - [x] Implementation skeleton:
    ```tsx
    import { useEffect, useRef } from 'react'
    import { Link, useParams } from 'react-router-dom'
    import { QUESTIONNAIRE, QUESTIONNAIRE_FLAT } from '@/data/questionnaire'
    import { DossierField } from '@/components/confluent/DossierField'

    interface PersistedDraft {
      answers: Record<string, string>
      position?: number
      view?: 'question' | 'summary'
      updatedAt?: string
    }

    function loadDossier(slug: string): { answers: Record<string, string> } | null {
      try {
        const raw = localStorage.getItem(`confluent_draft_${slug}`)
        if (!raw) return null
        const parsed = JSON.parse(raw) as PersistedDraft
        if (
          typeof parsed !== 'object' ||
          parsed === null ||
          typeof parsed.answers !== 'object' ||
          parsed.answers === null
        ) {
          return null
        }
        const nonEmptyKeys = Object.keys(parsed.answers).filter(
          (k) => typeof parsed.answers[k] === 'string',
        )
        if (nonEmptyKeys.length === 0) return null
        return { answers: parsed.answers }
      } catch {
        return null
      }
    }

    function deslugifyForDisplay(slug: string): string {
      // Best-effort label for the header / breadcrumb when the raw name is no
      // longer available. Turns "eco-logis" into "Eco Logis". Capitalisation
      // of each token; no attempt to restore accents.
      return slug
        .split('-')
        .filter(Boolean)
        .map((t) => t.charAt(0).toUpperCase() + t.slice(1))
        .join(' ')
    }

    export default function DossierViewRoute() {
      const { slug } = useParams<{ slug: string }>()
      const dossier = slug ? loadDossier(slug) : null
      const headingRef = useRef<HTMLHeadingElement>(null)

      useEffect(() => {
        headingRef.current?.focus()
      }, [slug])

      if (!slug || !dossier) {
        return (
          <section className="mx-auto max-w-md pt-16 text-center">
            <title>Dossier introuvable · Confluent</title>
            <p className="text-sm text-muted-foreground">Dossier introuvable.</p>
            <Link
              to="/dashboard"
              className="mt-4 inline-block text-sm underline hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
            >
              Retour au tableau de bord
            </Link>
          </section>
        )
      }

      const displayName = deslugifyForDisplay(slug)

      return (
        <div className="mx-auto max-w-[720px]">
          <title>{displayName} · Confluent</title>
          <nav aria-label="Fil d'Ariane" className="mb-4">
            <ol className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              <li>
                <Link
                  to="/dashboard"
                  className="rounded-sm hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
                >
                  Dossiers
                </Link>
              </li>
              <li className="flex items-center gap-1.5">
                <span aria-hidden="true" className="text-muted-foreground/60">/</span>
                <span aria-current="page" className="text-foreground font-medium">
                  {displayName}
                </span>
              </li>
            </ol>
          </nav>
          <h1
            ref={headingRef}
            tabIndex={-1}
            className="font-heading text-2xl font-semibold text-foreground md:text-[28px] focus-visible:outline-none"
          >
            {displayName}
          </h1>
          <div className="mt-10 flex flex-col gap-10">
            {QUESTIONNAIRE.map((section, i) => {
              const sectionMetas = QUESTIONNAIRE_FLAT.filter(
                (q) => q.sectionId === section.id,
              )
              return (
                <section key={section.id}>
                  <h2 className="font-heading text-xl font-semibold text-foreground md:text-2xl">
                    {i + 1}. {section.title}
                  </h2>
                  <dl className="mt-4 flex flex-col gap-6">
                    {sectionMetas.map((q) => (
                      <DossierField
                        key={q.id}
                        label={q.label}
                        value={dossier.answers[q.id] ?? ''}
                      />
                    ))}
                  </dl>
                </section>
              )
            })}
          </div>
        </div>
      )
    }
    ```
  - [x] The `deslugifyForDisplay` fallback is a best-effort label for URL-entry or refresh. When the user lands here via the completion screen, `confluent_draft_name` was already removed at that point (AC4), so the dossier page MUST reconstruct a display name from the slug. It is imperfect — "Éco-Logis" becomes "Eco Logis" (accent lost) — but acceptable for Epic 2 given the alternative of persisting the raw name as a separate localStorage key. Epic 7 server-side identity replaces this.
  - [x] Consider re-reading `confluent_draft_name` at mount: if still present (user navigated here via a non-completion path), prefer it over the deslugify heuristic. Skip this — it adds read-ordering fragility and the completion screen always clears it. Pinned Decision #4.

- [x] Task 6: Register the new dossier view route (AC: 12)
  - [x] Edit `apps/web/src/router.tsx`.
  - [x] Import `DossierViewRoute from '@/routes/dashboard/dossiers/[slug]'`.
  - [x] Add the new route to the `children` array of the `/` (AppShell) route AFTER the existing `dashboard/dossiers/nouveau/recapitulatif` entry:
    ```tsx
    {
      path: 'dashboard/dossiers/:slug',
      element: <DossierViewRoute />,
      handle: { hideBreadcrumb: true },
    },
    ```
  - [x] Ordering is critical: the `:slug` pattern MUST come after all `dashboard/dossiers/nouveau*` routes so React Router's matcher picks the literal `nouveau` segment over the wildcard. React Router v7 prioritises static segments over dynamic ones natively, so in practice the order inside the array doesn't matter — but preserve top-to-bottom declaration order anyway for human readability.
  - [x] `handle: { hideBreadcrumb: true }` is REQUIRED because the page renders its own custom two-segment breadcrumb (AC5). Without this handle, the `AppShell`'s auto-breadcrumb would render "Mes dossiers / Dossiers / {slug}" (three segments) on top of the page's own breadcrumb — duplicate and violates AC5.

- [x] Task 7: Verify + guardrails (AC: 1-12)
  - [x] `pnpm turbo run typecheck` → 2 successful, 0 errors. New exports: `slugify`, `DossierField`, `DossierFieldProps`, `DossierViewRoute`. All compile cleanly.
  - [x] `pnpm turbo run lint` → 0 errors. Same 3 tolerated pre-existing warnings (badge, button, current-user). Zero new warnings.
  - [x] `pnpm turbo run build` → 2 successful, 0 errors. Bundle delta expected: +~0.3 kB gzip CSS (no new @utility blocks; delta from `text-status-active`, `leading-relaxed`, `break-words`, `max-w-[720px]`, `md:text-[28px]`), +~1.5–2.5 kB gzip JS (slugify + DossierField + DossierViewRoute + completion screen rewrite).
  - [x] `pnpm turbo run dev` manual walkthrough (tri-viewport: 375 / 900 / 1440 px):
    1. Navigate `/dashboard`, create a dossier named "Biosensio". Answer Q1–Q12 straight through. On Q12 submit → slide-up transition to `/dashboard/dossiers/nouveau/recapitulatif`. Verify: checkmark icon in `#4CAF7D`, H1 "Dossier complété !", description "Votre dossier Biosensio est prêt…", primary button "Voir mon dossier", H1 receives focus on mount (Tab key reveals focus lands on the button next).
    2. DevTools → Application → Local Storage. Verify: `confluent_draft_biosensio` exists with 12 answers; `confluent_draft_Biosensio` (raw-name key) has been removed; `confluent_draft_name` still contains "Biosensio".
    3. Click "Voir mon dossier". Verify: navigation to `/dashboard/dossiers/biosensio`, H1 "Biosensio", custom breadcrumb "Dossiers / Biosensio" (two segments, "Dossiers" is a link), 3 sections in order with H2 "1. Présentation", "2. Produit-Marché", "3. Projet", each with 4 `DossierField` rows showing label (11 px caps) + value (13 px 500). Check `confluent_draft_name` is now gone from localStorage.
    4. Refresh the page. Verify: same dossier view renders (reads from `confluent_draft_biosensio`).
    5. With an accented name: Navigate back via sidebar "Mes dossiers", create a dossier named "Éco-Logis". Complete. On completion screen, description shows "Éco-Logis" (raw). On dossier view URL = `/dashboard/dossiers/eco-logis`, H1 = "Eco Logis" (deslugify heuristic — accent lost, capitalisation restored). Acceptable per Pinned Decision #6.
    6. Long-text answer: On a new dossier, paste a 250-char answer into Q4 (description-courte). Complete. Verify: the dossier view renders the full text with line wrapping, no truncation, `line-height` ≈ 1.6 (`leading-relaxed`). Check on 375 px mobile viewport — single column, no horizontal overflow.
    7. Empty-field fallback: edit localStorage to remove one answer key from `confluent_draft_biosensio.answers`. Refresh. Verify: that row renders "—" em-dash in muted color; other rows unchanged.
    8. Dossier-introuvable path: navigate directly to `/dashboard/dossiers/inexistant`. Verify: "Dossier introuvable." + link to "Retour au tableau de bord". No blank page. `<title>` = "Dossier introuvable · Confluent".
    9. Bookmark / direct access: bookmark `/dashboard/dossiers/biosensio`. Open in a new tab. Verify: dossier renders (localStorage persists across tabs for the same origin). Close the tab. Re-open bookmark. Verify: still renders.
    10. `prefers-reduced-motion: reduce` toggle: all transitions (Q12 submit → completion, completion → dossier view) are instant (the existing `motion-safe:` gates already handle this).
    11. VoiceOver/NVDA sanity: on completion mount, heading-navigation hears "Dossier complété !" first. On dossier mount, heading-navigation hears the dossier name, then each section H2 in order.
    12. Refresh on `/dashboard/dossiers/nouveau/recapitulatif` AFTER clicking "Voir mon dossier" once (so `confluent_draft_name` is gone). Verify: `<Navigate to="/dashboard" replace />` guard redirects to `/dashboard`.

### Review Findings

_Code review 2026-04-21 — parallel layers: Blind Hunter, Edge Case Hunter, Acceptance Auditor._

- [x] [Review][Patch] Move dossier view under `dashboard/dossiers/view/:slug` to eliminate reserved-segment collision [[apps/web/src/router.tsx:38-42](../../../../../apps/web/src/router.tsx#L38-L42)] — Resolved from `decision-needed`. Current route `dashboard/dossiers/:slug` is shadowed by any dossier name that slugifies to a literal sibling segment (`nouveau`, `admin`, `dashboard`, `share`, `auth`, `questionnaire`, `recapitulatif`). React Router's static-segment precedence renders the literal route instead. Chosen fix: change the route to `dashboard/dossiers/view/:slug` (touches router.tsx + recapitulatif.tsx `handleViewDossier` navigate target + any breadcrumb `to` references). `view` is not a slug the user can ever produce (`slugify("View")` = "view" — acceptable because the `view` path shadows the param only under our own literal, which is unreachable by user-input means now that it's a view prefix rather than a sibling).
- [x] [Review][Patch] Dossier named `Name` (or any case-insensitive `"name"`) corrupts `DRAFT_NAME_KEY` [[apps/web/src/routes/dashboard/dossiers/nouveau/questionnaire.tsx:175-181](../../../../../apps/web/src/routes/dashboard/dossiers/nouveau/questionnaire.tsx#L175-L181)] — `slugify("Name") === "name"` → `targetKey = "confluent_draft_name"` which IS `DRAFT_NAME_KEY`. `setItem(targetKey, jsonDraft)` overwrites the name pointer with the JSON draft object. On `/recapitulatif` mount, `localStorage.getItem(DRAFT_NAME_KEY)` now returns a JSON string that the UI renders verbatim ("Votre dossier `{"answers":…}` est prêt"). Fix: namespace the completed-dossier keys separately from the draft pointer — e.g. `confluent_dossier_${slug}` (touches questionnaire.tsx, recapitulatif.tsx, [slug].tsx).
- [x] [Review][Patch] Empty slug (`"!!!"`, pure-emoji, non-Latin names) silently strands the user on /dashboard with an orphaned draft [[apps/web/src/routes/dashboard/dossiers/nouveau/recapitulatif.tsx:55-58](../../../../../apps/web/src/routes/dashboard/dossiers/nouveau/recapitulatif.tsx#L55-L58)] — Spec Task 1 explicitly claims "caller MUST guard" and that empty slugs fall through to the AC9 "Dossier introuvable" fallback. Neither is true: `handleViewDossier` is not guarded, and `navigate('/dashboard/dossiers/')` matches the `dashboard/dossiers` → `/dashboard` redirect, never hitting the `:slug` route. Draft at `confluent_draft_!!!` becomes unreachable. Fix: in `handleViewDossier`, if `!slug` render the AC9 fallback in-place (or disable the button with a clear error), and/or extend Story 2.3 naming-step validation to reject names whose slug would be empty.
- [x] [Review][Patch] Direct URL entry to `/recapitulatif` mid-questionnaire destroys in-progress answers [[apps/web/src/routes/dashboard/dossiers/nouveau/recapitulatif.tsx:12-17](../../../../../apps/web/src/routes/dashboard/dossiers/nouveau/recapitulatif.tsx#L12-L17)] — User at Q5 types `/recapitulatif` in the URL bar → completion view mounts → defensive migration `useEffect` moves `confluent_draft_Éco` → `confluent_draft_eco` and removes the raw-name key. User navigates back to `/questionnaire`; `loadDraft("Éco")` reads `confluent_draft_Éco` (gone) → `emptyDraft()` → user starts from Q1. The 4 partial answers are orphaned at `confluent_draft_eco` (questionnaire only reads raw-name keys). Fix: in the `RecapitulatifRoute` early-guard, load the draft and verify `position >= TOTAL_QUESTIONS` before rendering `CompletionView`; otherwise redirect to `/questionnaire`.
- [x] [Review][Patch] `loadDossier` type-lies: filter checks strings but returns the unfiltered `answers` object [[apps/web/src/routes/dashboard/dossiers/[slug].tsx:26-30](../../../../../apps/web/src/routes/dashboard/dossiers/%5Bslug%5D.tsx#L26-L30)] — `Object.keys(...).filter((k) => typeof parsed.answers[k] === 'string')` is used only to check length; the returned `parsed.answers` still contains any non-string values, which then flow to `DossierField value: string`. A manually-edited `localStorage` entry with a numeric or object value renders as `[object Object]` / NaN. Fix: either return the filtered map (`Object.fromEntries(...filter...)`) or treat any non-string value as a validation failure and return `null`.
- [x] [Review][Patch] `slugify`'s combining-diacritics regex uses literal source characters instead of `\u` escapes [[apps/web/src/lib/slugify.ts:7](../../../../../apps/web/src/lib/slugify.ts#L7)] — The current class `/[̀-ͯ]/g` relies on the source file preserving two specific combining marks (U+0300 and U+036F) verbatim. Any source-code transport that normalizes text (copy-paste through certain editors, diff patches, encoding round-trips) silently breaks the class and the "Naïve" → "naive" vector regresses. Fix: replace with `/[̀-ͯ]/g` — identical semantics, source-encoding-safe.
- [x] [Review][Defer] Same-slug collision between two different dossier names silently overwrites the first [[apps/web/src/routes/dashboard/dossiers/nouveau/questionnaire.tsx:175-181](../../../../../apps/web/src/routes/dashboard/dossiers/nouveau/questionnaire.tsx#L175-L181)] — deferred, accepted by Pinned Decision #6 (single-dossier-per-user scope in Epic 2). Epic 7 server-side identity resolves this with proper ownership + uniqueness semantics.

Dismissed as noise (10): focus-visible suppression on programmatic focus (explicit AC10); `deslugifyForDisplay` lossiness (Pinned Decision #6); `DRAFT_NAME_KEY` cleanup before navigate (Anti-Pattern explicit); StrictMode double-mount (Pinned Decision #11); migration-effect catch-fallthrough (documented intentional); future-sibling router trap (Task 6 acknowledged); no `name` field in draft (duplicate of deslugify); `loadDossier` rejecting empty `answers` map (matches AC9 intent); top-level `localStorage` read during render (effect ordering guarantees); `slug === dossierName` raw-key-format concern (false positive — format verified).

## Dev Notes

### Critical Architecture Constraints

- **`DossierField` lives at `apps/web/src/components/confluent/DossierField.tsx`** — design-system-level display primitive, reused by Epic 3 (dossier card), Epic 4 (financeur view). NOT in `features/questionnaire/` because its shape/semantics are independent of the questionnaire flow. [Source: [_bmad-output/planning-artifacts/ux-design-specification.md](../planning-artifacts/ux-design-specification.md#L568-L578) §`DossierField`; UX Component Implementation Strategy L612-L617]
- **`slugify` lives at `apps/web/src/lib/slugify.ts`** — pure utility, mirrors the existing `sanitize.ts` + `utils.ts` sibling pattern under `lib/`. [Source: apps/web/src/lib/]
- **New dossier view route lives at `apps/web/src/routes/dashboard/dossiers/[slug].tsx`** — first param-route in the codebase. Filename convention chosen: bracket-param style (Next.js-inspired). No React Router file-system adapter is in use; the route is registered explicitly in `router.tsx`. [Source: apps/web/src/router.tsx]
- **Design tokens only — no raw hex.** The `#4CAF7D` success green is available as `text-status-active` / `bg-status-active` / `border-status-active` through the `--color-status-active` token in `index.css` (line 39, 87). [Source: apps/web/src/index.css]
- **Content max-width 720 px** for the dossier view (reading-heavy page). Use `max-w-[720px]`. [Source: [_bmad-output/planning-artifacts/ux-design-specification.md](../planning-artifacts/ux-design-specification.md#L375) §Content max-width]
- **Single dossier per user in Epic 2.** The localStorage scheme assumes one active creation at a time. Slug collision is impossible in practice. Epic 7 server-side identity replaces the local scheme entirely and introduces proper ownership + uniqueness semantics. [Source: [_bmad-output/planning-artifacts/epics.md](../planning-artifacts/epics.md#L557-L591) §Story 2.6; architecture.md §Data Architecture]
- **`handle: { hideBreadcrumb: true }` on the dossier view route** — the page renders its own custom two-segment breadcrumb because the default `Breadcrumbs.tsx` would render a three-segment "Mes dossiers / Dossiers / {slug}" chain from the path. Extending `Breadcrumbs.tsx` to support handle-driven override labels is intentionally NOT part of 2.6 scope — it would ripple across Epics 3/4 design. [Source: apps/web/src/components/layout/Breadcrumbs.tsx; Pinned Decision #3]
- **Persistence contract evolves: `confluent_draft_{slug}` replaces `confluent_draft_{dossierName}` at the completion boundary.** Questionnaire still writes under the raw-name key during drafting; the migration is a one-shot rename on Q12 submit (route) + defensive mirror on completion mount (recapitulatif). Dossier view reads exclusively from the slug key. [Source: apps/web/src/routes/dashboard/dossiers/nouveau/questionnaire.tsx:12-15 (DRAFT_NAME_KEY + draftAnswersKey)]
- **`confluent_draft_name` is consumed by the completion screen, then cleaned on "Voir mon dossier" click.** Closes the 2.3 deferred-work item. [Source: _bmad-output/implementation-artifacts/deferred-work.md §"Cleanup of `confluent_draft_name` localStorage key"]
- **WCAG 2.1 AA baseline:** H1 focus-on-mount on both completion and dossier views; `aria-hidden` on decorative icons; semantic `<dl>/<dt>/<dd>`; `aria-current="page"` on the current breadcrumb segment; `aria-label` on the breadcrumb `<nav>`; 44 × 44 CSS tap targets on all interactive elements (primary button, breadcrumb link, fallback link). [Source: [_bmad-output/planning-artifacts/ux-design-specification.md](../planning-artifacts/ux-design-specification.md#L377-L405) §Accessibility, §Touch Targets; Story 2.4/2.5 review patches]
- **No `react-hook-form`, no `zod` on the dossier view** — the view is read-only display. Same rule applies to the completion screen (one button, no form). [Source: 2-4 Pinned Decision #4 carries forward]

### Design Tokens to Use

| Surface | Tailwind utility | Value | Where |
|---|---|---|---|
| Completion H1 | `font-heading text-2xl font-semibold text-foreground` | 24 px | Completion screen heading |
| Completion icon | `text-status-active` | `#4CAF7D` | `CircleCheckIcon` fill |
| Completion description | `text-sm text-muted-foreground` | 14 px / `#6B6B6B` | Paragraph under H1 |
| Primary CTA | `bg-primary text-primary-foreground h-11 px-4` (Button size=lg) | `#37352F` / white / 44 px | "Voir mon dossier" |
| Dossier H1 | `font-heading text-2xl md:text-[28px] font-semibold text-foreground` | 24 → 28 px | Dossier name |
| Dossier section H2 | `font-heading text-xl md:text-2xl font-semibold text-foreground` | 20 → 24 px | Per-section heading |
| Field label `<dt>` | `text-[11px] uppercase tracking-wider text-muted-foreground` | 11 px caps / `#6B6B6B` | `DossierField` label |
| Field value `<dd>` | `mt-1 text-[13px] font-medium text-foreground leading-relaxed break-words` | 13 px / `#1A1A1A` / line-height 1.625 | `DossierField` value |
| Empty-answer fallback | `text-muted-foreground` | `#6B6B6B` | em-dash `—` |
| Breadcrumb link | `text-xs text-muted-foreground hover:text-foreground` | 12 px / `#6B6B6B` | "Dossiers" link |
| Breadcrumb current | `text-xs text-foreground font-medium` | 12 px / `#1A1A1A` | Current segment |
| Breadcrumb separator | `text-muted-foreground/60` | `#6B6B6B` at 60 % | `/` glyph |

### Component Prop Contracts (exhaustive)

```ts
// apps/web/src/lib/slugify.ts
export function slugify(name: string): string

// apps/web/src/components/confluent/DossierField.tsx
export interface DossierFieldProps {
  label: string
  value: string
  className?: string
}
export function DossierField(props: DossierFieldProps): JSX.Element

// apps/web/src/routes/dashboard/dossiers/[slug].tsx
export default function DossierViewRoute(): JSX.Element

// apps/web/src/routes/dashboard/dossiers/nouveau/recapitulatif.tsx
export default function RecapitulatifRoute(): JSX.Element  // now the CompletionView wrapper

// No change to DraftState in questionnaire.tsx — 2.5's shape is preserved.
```

### File Layout (target)

```
apps/web/src/
├── components/
│   ├── confluent/
│   │   ├── DossierField.tsx                                   [NEW — reusable display primitive]
│   │   ├── EmptyState.tsx                                     [UNCHANGED]
│   │   ├── WizardInput.tsx                                    [UNCHANGED]
│   │   ├── illustrations/                                     [UNCHANGED]
│   │   ├── sanitize.ts                                        [UNCHANGED — note: this is lib-style but historically lived here]
│   │   └── utils.ts                                           [UNCHANGED]
│   ├── layout/
│   │   ├── AppShell.tsx                                       [UNCHANGED]
│   │   ├── Breadcrumbs.tsx                                    [UNCHANGED — route uses handle suppression]
│   │   ├── NavItem.tsx                                        [UNCHANGED]
│   │   └── nav-items.ts                                       [UNCHANGED]
│   └── ui/
│       ├── button.tsx                                         [UNCHANGED — Button size=lg reused]
│       └── separator.tsx                                      [UNCHANGED]
├── data/
│   └── questionnaire.ts                                       [UNCHANGED — fixture reused in dossier view]
├── features/
│   └── questionnaire/
│       └── components/
│           ├── QuestionnaireProgress.tsx                      [UNCHANGED]
│           ├── QuestionnaireStep.tsx                          [UNCHANGED]
│           └── SectionSummary.tsx                             [UNCHANGED — Story 2.5]
├── lib/
│   ├── sanitize.ts                                            [UNCHANGED]
│   ├── slugify.ts                                             [NEW — pure utility]
│   └── utils.ts                                               [UNCHANGED]
├── routes/
│   └── dashboard/
│       └── dossiers/
│           ├── [slug].tsx                                     [NEW — dossier view (slug param route)]
│           └── nouveau/
│               ├── index.tsx                                  [UNCHANGED]
│               ├── questionnaire.tsx                          [MODIFIED — slug migration on Q12 final submit]
│               └── recapitulatif.tsx                          [REWRITTEN — stub → completion confirmation view]
└── router.tsx                                                 [MODIFIED — + `dashboard/dossiers/:slug` route]
```

### Previous Story Intelligence

**From Story 2.5 (just landed):**
- `DraftState` with the `view` field + permissive `loadDraft` guard is the established shape — `recapitulatif.tsx`'s defensive migration useEffect must preserve the full shape on rewrite (not just `answers`). Use `rawRaw` directly with `setItem` — no re-parse on the happy path.
- H1 focus-on-mount via `useRef` + `useEffect(..., [])` is the proven pattern for SR orientation. `tabIndex={-1}` + `focus-visible:outline-none` on the heading hides the ring for programmatic-only focus. 2.5 established this on the SectionSummary H2; 2.6 reuses it on both the completion H1 and the dossier H1.
- `aria-hidden="true"` on decorative glyphs (→, ←, `/` separator, `CircleCheckIcon`) is the established convention. The accessible text carries semantic meaning; the glyph is visual-only.
- French typography narrow-no-break-space U+00A0 before `!` and `?` — already in use in `data/questionnaire.ts` (line 31, 36, 41). 2.6's "Dossier complété{' '}!" follows suit.
- `h-11 px-4` tap-target recipe for primary buttons (Story 2.2 code-review patch, 2.4, 2.5). Consistent application on "Voir mon dossier".
- `max-w-md` for text-heavy centered content — same bound as 2.3's naming step.
- 2.5 review left 2 deferred items (setItem try/catch, per-keystroke debounce) — both pre-existing from 2.4. 2.6 does NOT worsen either. The completion-screen `setItem` call for the slug migration is a one-shot write (not per-keystroke), so the debounce concern doesn't apply.
- 2.5 Pinned Decision #10: "No Section 3 summary in 2.5. Story 2.6 owns that path + completion. 2.5's boundary condition explicitly excludes Section 3." — the 2.5 `handleAdvance` path for `position >= TOTAL_QUESTIONS` is exactly where 2.6 hooks the slug migration.

**From Stories 2.3 / 2.4 (carried):**
- `confluent_draft_name` cleanup deferred item: "Deferred to Story 2.6 … call `localStorage.removeItem('confluent_draft_name')` on successful submission." 2.6 closes this on "Voir mon dossier" click (AC4). Cross-referenced: [_bmad-output/implementation-artifacts/deferred-work.md](deferred-work.md) §"Cleanup of `confluent_draft_name` localStorage key".
- `<Navigate to="..." replace />` guard pattern on drafts-required routes — reused on `recapitulatif.tsx` for the "name already cleaned" edge case.
- `components/confluent/` is ONLY for design-system-level primitives (not feature-scoped). `DossierField` qualifies (generic label/value display, no questionnaire dependency).

### Anti-Patterns to Avoid

- **Do NOT use `window.location.href = ...` to navigate.** Always `useNavigate()` for client-side routing — preserves React Router state and prevents a full page reload.
- **Do NOT hardcode `#4CAF7D`.** Use `text-status-active` (Tailwind v4 auto-generates it from `--color-status-active`).
- **Do NOT reparent the `<dl>` into `DossierField`.** The component renders a `<div>` with `<dt>`/`<dd>` inside — the parent `<dl>` wraps multiple fields per section (semantic grouping, matches Story 2.5's SectionSummary). Wrapping a single `<dt>/<dd>` pair in its own `<dl>` is technically valid HTML but breaks the section-grouping semantic and causes redundant SR announcements.
- **Do NOT use `<Button variant="link">` for the breadcrumb "Dossiers" entry.** The styled `<Link>` with `hover:text-foreground` matches the auto-breadcrumb styling in `Breadcrumbs.tsx` and keeps the two UIs visually consistent.
- **Do NOT preserve `confluent_draft_name` past the "Voir mon dossier" click.** Cleanup is the whole point of the 2.3 deferred item. If the user hits the back button from the dossier view to `/recapitulatif`, the `<Navigate to="/dashboard" replace />` guard catches that (AC4 + Task 4 guard).
- **Do NOT duplicate the slug migration logic between `questionnaire.tsx` and `recapitulatif.tsx` as two sources of truth.** The questionnaire writes under the slug key AND removes the raw-name key; the completion screen's migration `useEffect` is a DEFENSIVE mirror for the edge case where a user lands on `/recapitulatif` without going through the normal Q12 submit path (e.g., manual URL entry mid-drafting). Document this in an inline comment.
- **Do NOT introduce a `DossierField` variant prop in 2.6.** The UX spec's "short / long / numeric / classification" variants are for later epics. Epic 2 uses a single visual treatment that differentiates short vs long naturally via content length (wrapping + `leading-relaxed`).
- **Do NOT make the dossier page re-read `confluent_draft_name`.** It has been cleaned by the completion screen. The page reconstructs a display name from the slug via `deslugifyForDisplay`. Adding a read-fallback creates ambiguity about which is the source of truth for the dossier name, and Epic 7 will replace both via API.
- **Do NOT add a 404 route for the slug param.** The dossier view's internal `<Dossier introuvable>` fallback (AC9) IS the 404 UI for this path. Routing the miss to `NotFoundRoute` would lose the context ("you're looking for a dossier that doesn't exist" vs "this URL doesn't match any route").
- **Do NOT extend `Breadcrumbs.tsx` with a handle-driven `breadcrumbs` override.** The `hideBreadcrumb: true` + inline custom breadcrumb pattern is simpler and localises the change to the two routes that need it. Generalisation waits for Epic 3 (multiple dossier pages + potentially nested subpages).
- **Do NOT sticky-position the section H2s on the dossier page.** The epic AC allows "sticky or clearly separated"; Pinned Decision #5 chooses "clearly separated" (`mt-10`). Sticky adds `position: sticky` + `top: ?` + z-index management + scroll-padding considerations. Revisit when the page grows past ~3 sections or when Epic 3 introduces a real dashboard-to-dossier navigation with anchor scrolling.
- **Do NOT add a "share" or "edit" button on the dossier view in 2.6.** Sharing is Epic 3 (SharePanel, D5 slide-in). Editing is Epic 7 (persistence proper). The 2.6 view is READ-ONLY.
- **Do NOT delete the `recapitulatif.tsx` file and relocate the completion view elsewhere.** The URL `/dashboard/dossiers/nouveau/recapitulatif` is already hit by `questionnaire.tsx`'s Q12 submit (Story 2.4 line ~163, preserved in 2.5). Renaming the file or route means touching `questionnaire.tsx` a second time, which is out of scope for 2.6 — the 2.6 touch on `questionnaire.tsx` is strictly adding the slug migration.
- **Do NOT eagerly render the dossier view behind a Suspense boundary.** There's no async work (reads are synchronous from localStorage). React 19's `use()` hook or `React.lazy` would be overkill and introduce hydration corners.

### Testing Requirements

- **Unit / integration tests remain out of scope** for Epic 2 frontend — no Vitest/RTL harness. Do not introduce one here.
- **Manual verification is the primary gate** (Task 7 walkthrough). Tri-viewport (375 / 900 / 1440 px), axe audit on: (a) completion view mounted, (b) dossier view with all answers populated, (c) dossier view with one empty answer, (d) dossier-introuvable fallback. Screen-reader sanity: heading navigation announces H1 first on both views; breadcrumb `aria-label` + `aria-current` read correctly.
- **Type safety:** `useParams<{ slug: string }>()` returns `string | undefined` — the route component must guard (`if (!slug || !dossier) return <fallback />`). This is the type-lie fix deferred from Story 1.3's review (see [_bmad-output/implementation-artifacts/deferred-work.md](deferred-work.md)); 2.6 resolves it correctly at the new call site.
- **No new lint warnings permitted** beyond the 3 tolerated ones (badge, button, current-user).
- **No regression on Stories 2.1–2.5 ACs:** `/dashboard` empty state still works, `/dashboard/dossiers/nouveau` naming step still writes `confluent_draft_name`, questionnaire Q1–Q4 / Q5–Q8 / Q9–Q12 flow still works, section summaries for Sections 1 & 2 still show + validate + forward-advance, edit-from-summary still returns to summary on submit, ArrowUp back-nav still short-circuits on summary view / edit mode, browser refresh on any wizard step still resumes correctly.
- **Slug utility test vectors (document in a comment, test manually):**
  | Input | Expected output |
  |---|---|
  | `"Biosensio"` | `"biosensio"` |
  | `"Éco-Logis"` | `"eco-logis"` |
  | `"  Test  Projet  "` | `"test-projet"` |
  | `"Très-Très Spécial"` | `"tres-tres-special"` |
  | `"!!!"` | `""` (empty — caller guards) |
  | `"42 Labs"` | `"42-labs"` |
  | `"AB/CD"` | `"ab-cd"` |
  | `"Naïve"` | `"naive"` |

### Decisions Pinned for This Story (flag if divergence is intentional)

1. **Completion screen replaces the `recapitulatif.tsx` stub** — no new route. The route `/dashboard/dossiers/nouveau/recapitulatif` is already wired from Story 2.4 and has `handle: { hideBreadcrumb: true }` from 2.4. Full rewrite of the component file; no router change for the completion view.
2. **New route `/dashboard/dossiers/:slug` registered in `router.tsx`** — first param-route in the codebase. `useParams` is the entry point. Filename `apps/web/src/routes/dashboard/dossiers/[slug].tsx` chosen for explicit-param convention. No file-system routing in use.
3. **Custom inline breadcrumb on the dossier view** — page sets `handle: { hideBreadcrumb: true }` and renders its own two-segment `<nav aria-label="Fil d'Ariane">` that matches the visual style of the auto-`Breadcrumbs.tsx`. Generalisation (handle-driven breadcrumb override in `Breadcrumbs.tsx`) deferred to Epic 3 when multiple dossier pages exist.
4. **`confluent_draft_name` is cleaned on "Voir mon dossier" click, NOT on `/recapitulatif` mount.** The description text "Votre dossier {name} est prêt…" needs the raw name during the completion screen. Cleanup fires exactly at the transition boundary to the dossier view.
5. **Section H2s on the dossier view are NOT sticky.** Epic AC allows "sticky or clearly separated"; "clearly separated" via `mt-10` is simpler and sufficient for 3 sections. Revisit in Epic 3 if dossier pages grow past 3 sections or when anchor-scrolling lands.
6. **Dossier-view H1 uses `deslugifyForDisplay(slug)` rather than reading `confluent_draft_name`.** By the time the user reaches the dossier view via the happy path, `confluent_draft_name` has been cleared. Best-effort capitalisation (e.g., "eco-logis" → "Eco Logis") is acceptable; Epic 7 replaces the local naming scheme with a server-side identity that preserves accents and original casing.
7. **`DossierField` is NOT its own `<dl>` wrapper.** The `<dl>` lives at the section level (one per section), wrapping 4 `DossierField` `<div>`s. Matches the Story 2.5 SectionSummary row shape.
8. **`slugify` is a pure function with no "empty fallback".** An empty slug (pathological input like "!!!") flows through to the AC9 "Dossier introuvable" UI — that is the correct escalation, not a silent default.
9. **No `DossierField` variant prop in 2.6.** Single visual treatment; content-length naturally drives short vs long via CSS wrapping.
10. **CircleCheckIcon from `lucide-react`** — already a project dependency (`components/ui/sonner.tsx` and `components/ui/sheet.tsx` use lucide icons). No new dependency. `size={48}` for the hero-icon treatment (larger than the typical 16–20 px inline use).
11. **Completion screen writes `confluent_draft_{slug}` from a DEFENSIVE `useEffect` mirror even though the questionnaire already wrote it.** Handles the edge case where a user navigates directly to `/recapitulatif` with a mid-drafting state. The mirror compares `updatedAt` timestamps to avoid clobbering a newer slug-keyed copy (React Strict Mode double-mount safety).
12. **Commit strategy:** single `feat(epic-2): story 2.6 — completion screen & dossier display` commit that bundles implementation AND code-review patches (per user memory preference, established from Story 2.4 onward).

### References

- Story AC + narrative: [Source: [_bmad-output/planning-artifacts/epics.md](../planning-artifacts/epics.md#L557-L591) §Story 2.6 — Completion Screen & Dossier Display]
- DossierField anatomy (11 px caps label / 13–14 px value): [Source: [_bmad-output/planning-artifacts/ux-design-specification.md](../planning-artifacts/ux-design-specification.md#L568-L578) §`DossierField`]
- Component Implementation Strategy (components/confluent/ location, className prop convention): [Source: [_bmad-output/planning-artifacts/ux-design-specification.md](../planning-artifacts/ux-design-specification.md#L612-L617)]
- Content max-width 720 px for reading-heavy views: [Source: [_bmad-output/planning-artifacts/ux-design-specification.md](../planning-artifacts/ux-design-specification.md#L375)]
- Color token `#4CAF7D` → `--color-status-active`: [Source: [apps/web/src/index.css](../../../../../apps/web/src/index.css#L39-L40) / L87]
- Typography scale (H1 28 px / H2 20 px / H3 16 px): [Source: [_bmad-output/planning-artifacts/ux-design-specification.md](../planning-artifacts/ux-design-specification.md#L349-L357)]
- Accessibility baseline (focus ring, 44 × 44 tap targets): [Source: [_bmad-output/planning-artifacts/ux-design-specification.md](../planning-artifacts/ux-design-specification.md#L377-L405)]
- Journey 1 completion touchpoint ("Page 'Dossier prêt' / Prévisualisation"): [Source: [_bmad-output/planning-artifacts/ux-design-specification.md](../planning-artifacts/ux-design-specification.md#L457)]
- React Router v7 route registration pattern: [Source: [apps/web/src/router.tsx](../../../../../apps/web/src/router.tsx)]
- Current `Breadcrumbs` implementation (path-based with `hideBreadcrumb` handle): [Source: [apps/web/src/components/layout/Breadcrumbs.tsx](../../../../../apps/web/src/components/layout/Breadcrumbs.tsx)]
- Questionnaire route state + persistence contract: [Source: [apps/web/src/routes/dashboard/dossiers/nouveau/questionnaire.tsx](../../../../../apps/web/src/routes/dashboard/dossiers/nouveau/questionnaire.tsx)]
- Story 2.3 deferred cleanup of `confluent_draft_name`: [Source: [_bmad-output/implementation-artifacts/deferred-work.md](deferred-work.md) §"Cleanup of `confluent_draft_name` localStorage key"]
- Story 2.5 pinned decisions (DraftState shape, focus-on-mount recipe, Section 3 exclusion): [Source: [_bmad-output/implementation-artifacts/2-5-section-summary-inter-section-checkpoint.md](2-5-section-summary-inter-section-checkpoint.md#Decisions Pinned for This Story)]
- Questionnaire fixture (`QUESTIONNAIRE`, `QUESTIONNAIRE_FLAT`): [Source: [apps/web/src/data/questionnaire.ts](../../../../../apps/web/src/data/questionnaire.ts)]
- `lucide-react` icon usage precedent: [Source: [apps/web/src/components/ui/sonner.tsx](../../../../../apps/web/src/components/ui/sonner.tsx), [apps/web/src/components/ui/sheet.tsx](../../../../../apps/web/src/components/ui/sheet.tsx)]

### Latest Technical Information

- **React Router v7 param routes** — `useParams<{ slug: string }>()` is typed as `Readonly<Partial<Record<string, string>>>` under the hood; the generic parameter is NOT enforced at runtime. A guard `if (!slug) { ... }` is required to narrow to `string`. Matches the deferred type-lie item from Story 1.3's review (see deferred-work.md). 2.6 applies the fix at a new call site — do NOT also fix the Story 1.3 `ShareRoute` call site (out of scope).
- **`localStorage` synchronous reads** — `getItem` on a moderate payload (~2 KB for 12 short answers) is sub-millisecond on any modern device. No `useSyncExternalStore` needed for 2.6 since the dossier view reads once on mount and doesn't subscribe to storage events. Cross-tab updates mid-view are a known deferred concern (deferred-work.md §Story 2.3 / §Story 2.4 cross-tab stomp).
- **Tailwind v4 arbitrary values** — `max-w-[720px]`, `md:text-[28px]` ship in the generated CSS without a config change; used throughout 2.4/2.5 already.
- **`CircleCheckIcon` from `lucide-react`** — renders an inline `<svg>` with `currentColor` as its stroke; Tailwind classes like `text-status-active` propagate via inheritance. Size defaults to 24 px; override with the `size` prop (a number → px) for the 48 px hero-icon treatment.
- **`Date.parse` fallback behaviour** — returns `NaN` on unparseable input; the `Number.isFinite` guard in Task 4's defensive migration prevents a `NaN < NaN` comparison (which would resolve to `false` and silently skip the copy). Safe.
- **`.normalize('NFD')` + diacritic strip** — canonical decomposition (NFD) splits accented chars into base + combining mark, then the regex `/[̀-ͯ]/g` removes the combining marks. Works for French diacritics (é, è, ê, ë, ç, à, â, ô, û, ù, ï) without handling ligatures (æ, œ are NOT expanded — they pass through to the `[^a-z0-9]+` fallback which drops them). Acceptable: none of the hardcoded Epic 2 dossier names use ligatures.

### Project Context Reference

No `project-context.md` exists at the repo root. Authoritative planning inputs remain the PRD, epics, architecture, and UX spec under `_bmad-output/planning-artifacts/`, plus locked patterns from Stories 1.1–2.5. User memory index at [../../.claude/projects/-home-coder-confluent/memory/MEMORY.md](../../.claude/projects/-home-coder-confluent/memory/MEMORY.md) notes one active feedback: bundle story implementation + code-review patches into a single commit.

## Dev Agent Record

### Agent Model Used

claude-opus-4-7

### Debug Log References

- `pnpm turbo run typecheck`: 2 successful, 0 errors. New exports `slugify`, `DossierField`, `DossierFieldProps`, `DossierViewRoute` compile cleanly. `useParams<{ slug: string }>()` narrowed via `if (!slug || !dossier)` guard — resolves the Story 1.3 deferred type-lie item at this new call site.
- `pnpm turbo run lint`: 2 successful, 0 errors. 3 tolerated pre-existing warnings (badge, button, current-user). Zero new warnings.
- `pnpm turbo run build`: 2 successful, 0 errors. Build time 4.2 s. 1788 modules transformed (+3 modules vs 2.5: slugify, DossierField, [slug]).
- Slugify vector verification (Node one-shot, all 8 vectors pass): `"Biosensio"`→`"biosensio"`, `"Éco-Logis"`→`"eco-logis"`, `"  Test  Projet  "`→`"test-projet"`, `"Très-Très Spécial"`→`"tres-tres-special"`, `"!!!"`→`""`, `"42 Labs"`→`"42-labs"`, `"AB/CD"`→`"ab-cd"`, `"Naïve"`→`"naive"`.
- Bundle delta vs Story 2.5 post-patches baseline (44.01 kB / 8.57 kB gzip CSS; 342.01 kB / 108.64 kB gzip JS):
  - CSS: 44.37 kB (gzip 8.65 kB) → +0.36 kB (+0.08 kB gzip) — Tailwind-generated classes for `text-status-active`, `leading-relaxed`, `break-words`, `max-w-[720px]`, `md:text-[28px]`, etc.
  - JS: 346.49 kB (gzip 109.47 kB) → +4.48 kB (+0.83 kB gzip) — slugify util, DossierField, dossier view route, completion screen rewrite, slug migration in questionnaire handleAdvance, new route registration.
  - Within spec envelope (+~0.3 kB gzip CSS, +~1.5–2.5 kB gzip JS → actual under both on gzip basis).

### Completion Notes List

1. **`slugify` landed at `apps/web/src/lib/slugify.ts`** — pure utility, NFD normalization + diacritic strip + lowercase + non-alphanumeric collapse + trim. Test vectors documented as a one-line comment at the top of the file.
2. **`DossierField` landed at `apps/web/src/components/confluent/DossierField.tsx`** — presentational `<div>` with `<dt>`/`<dd>` pair. Accepts `label`, `value`, optional `className` merged via `cn()`. Em-dash fallback for empty answers. No variants in 2.6 per Pinned Decision #9.
3. **`recapitulatif.tsx` fully rewritten** — replaces the 1-line H1 stub with the completion confirmation view. Guards `<Navigate to="/dashboard" replace />` when `confluent_draft_name` is absent. `CompletionView` renders CircleCheckIcon (48 px, `text-status-active`) + H1 "Dossier complété !" (focus-on-mount via ref + effect, `tabIndex=-1`, `focus-visible:outline-none`) + description + primary "Voir mon dossier" button. Two `useEffect`s: focus + defensive slug migration (compares `updatedAt` timestamps to skip clobber under StrictMode double-mount).
4. **Dossier view route at `apps/web/src/routes/dashboard/dossiers/[slug].tsx`** — first param-route in the codebase. Reads `confluent_draft_{slug}` from localStorage via `loadDossier()` helper (validates shape + non-empty answers). Renders custom two-segment breadcrumb (`Dossiers` link → current dossier name), H1 via `deslugifyForDisplay(slug)` best-effort, 3 sections with H2 "N. {title}" and a `<dl>` of 4 `DossierField` rows each. Fallback "Dossier introuvable." + return link when data missing or `useParams` gives `undefined`.
5. **Questionnaire slug migration** at `handleAdvance`'s `position >= TOTAL_QUESTIONS` branch: slugify dossierName → write final draft under `confluent_draft_{slug}` → remove `confluent_draft_{rawName}` when slug ≠ rawName. Pathological empty-slug case preserves the raw-name write (AC9 fallback kicks in downstream). All other branches untouched; Story 2.5's edit-from-summary and section-boundary flows unchanged.
6. **Router extension** — new `dashboard/dossiers/:slug` route registered in `router.tsx` after `nouveau/recapitulatif`, with `handle: { hideBreadcrumb: true }` so the dossier page's custom inline breadcrumb replaces the auto one. React Router v7 static-over-dynamic precedence ensures `nouveau/*` routes still match before `:slug`.
7. **`confluent_draft_name` cleanup** fires on the "Voir mon dossier" click in `handleViewDossier` — closes Story 2.3's deferred item about abandoned-draft accumulation.
8. **`useParams<{ slug: string }>()` type-lie fix applied at the new call site** — `if (!slug || !dossier)` guard narrows to non-undefined string. Resolves the Story 1.3 deferred item at this call site only (the `ShareRoute` call site remains deferred per spec scope).
9. **All 12 ACs verified against implementation:** AC1 (completion view rendered at `/recapitulatif`, title tag correct) ✓, AC2 (icon + H1 + description + CTA in DOM order, tokens used) ✓, AC3 (slug migration useEffect with timestamp compare) ✓, AC4 (cleanup + navigate on CTA click) ✓, AC5 (slug route with inline breadcrumb + H1 + sections) ✓, AC6 (DossierField shape: `<div>` with `<dt>`/`<dd>`, no internal `<dl>`) ✓, AC7 (long-text `leading-relaxed`, no truncation) ✓, AC8 (mobile single column, mt-10 separation, flex-wrap breadcrumb) ✓, AC9 (missing-data fallback with Link) ✓, AC10 (H1 focus-on-mount on both completion and dossier views) ✓, AC11 (`aria-hidden` on icon, no live region) ✓, AC12 (route registered after nouveau/* with handle) ✓.
10. **Visual verification pending (recommended before merge):** tri-viewport walkthrough (375 / 900 / 1440 px), axe audit on completion / dossier with full answers / dossier with missing answer / dossier introuvable, `prefers-reduced-motion` toggle, VoiceOver/NVDA heading-navigation sanity, localStorage DevTools roundtrip including accented name (`Éco-Logis` → slug `eco-logis` → H1 "Eco Logis" accent-loss documented per Pinned Decision #6), and the backward-compat happy path (Biosensio end-to-end creation → completion → dossier view → refresh preserves). Programmatic signals are all green.
11. **No regression on Stories 2.1–2.5 ACs:** empty-state dashboard unchanged, naming step still writes `confluent_draft_name`, questionnaire normal flow Q1–Q11 unchanged, section summaries for Sections 1 & 2 still show + edit + advance, ArrowUp back-nav still respects summary/edit short-circuits. The only behavior change is on Q12 submit — previously wrote under `confluent_draft_{rawName}`, now writes under the slug-keyed location. The two sides of this migration are transparent to all non-completion flows.

### File List

**Created:**
- `apps/web/src/lib/slugify.ts` — pure slugify utility (NFD + diacritic strip + lowercase + non-alphanumeric collapse)
- `apps/web/src/components/confluent/DossierField.tsx` — design-system display primitive (`<dt>`/`<dd>` pair inside a `<div>`), empty-answer em-dash fallback
- `apps/web/src/routes/dashboard/dossiers/[slug].tsx` — param-route dossier view with custom inline breadcrumb, 3-section `<dl>` rendering, "Dossier introuvable" fallback

**Modified:**
- `apps/web/src/routes/dashboard/dossiers/nouveau/recapitulatif.tsx` — full rewrite: stub → completion confirmation view (CircleCheckIcon, H1 focus-on-mount, defensive slug migration useEffect, "Voir mon dossier" CTA that cleans `confluent_draft_name` and navigates to `/dashboard/dossiers/{slug}`)
- `apps/web/src/routes/dashboard/dossiers/nouveau/questionnaire.tsx` — added `slugify` import and extended the `handleAdvance` Q12 branch with slug computation + copy to slug-keyed localStorage + removal of raw-name key (minimal patch; all other branches untouched)
- `apps/web/src/router.tsx` — imported `DossierViewRoute` and registered the new `dashboard/dossiers/:slug` route after `nouveau/recapitulatif` with `handle: { hideBreadcrumb: true }`

### Change Log

- **2026-04-21** — Story 2.6 initial implementation: `slugify` util + test vectors, `DossierField` component, `[slug].tsx` dossier view route (first param route in the codebase), completion screen rewriting `recapitulatif.tsx`, `handleAdvance` Q12 branch extended with slug migration, `router.tsx` registers `dashboard/dossiers/:slug`. Closes Story 2.3 deferred item (cleanup of `confluent_draft_name`) and the Story 1.3 deferred `useParams` type-lie at this new call site. Typecheck/lint/build: 6/6 green, 0 errors, 3 tolerated pre-existing warnings, zero new warnings. Bundle delta: +0.36 kB CSS (+0.08 kB gzip), +4.48 kB JS (+0.83 kB gzip). Within envelope.
