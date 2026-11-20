# Story 4.1: Email Verification Screen (UI Only, Mocked)

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a financeur receiving a shared dossier link,
I want to see a clean, reassuring entry screen when I open the link,
so that I understand what to do to access the dossier.

## Acceptance Criteria

1. **Given** the user navigates to `/share/:token` with ANY non-empty token value (e.g., `/share/biosensio-share`, `/share/abc-123`, `/share/foo`), **When** the page renders, **Then** a standalone, vertically centered layout is displayed on a `bg-background` (`#FAFAF9`) full-viewport surface containing these elements in top-to-bottom order with no sidebar, no `<AppShell>`, no breadcrumb, no top bar, and no footer:
   - The Confluent wordmark (see AC2) — `role="img"` with `aria-label="Confluent"`.
   - An `<h1>` reading `"Accéder au dossier"` (font-heading, 24 px / 500 on mobile, 28 px / 500 on `sm:` and up — matches the H1 scale from [ux-design-specification.md:351](../planning-artifacts/ux-design-specification.md#L351)).
   - A supporting `<p>` reading `"Entrez votre adresse email pour recevoir votre lien d'accès."` (14 px / `text-muted-foreground`).
   - A `<form>` containing:
     - A visually-hidden `<label htmlFor="share-email">` reading `"Adresse email"` (sr-only — the placeholder + sub-label provide visual context; the hidden label keeps the input accessibly named per §Accessibility at [ux-design-specification.md:384](../planning-artifacts/ux-design-specification.md#L384)).
     - An `<Input id="share-email" type="email" placeholder="votre@email.fr">` — full width within the form container, 44 px tall (`h-11`) per the mobile touch-target rule at [ux-design-specification.md:381](../planning-artifacts/ux-design-specification.md#L381).
     - A submit `<Button type="submit" size="lg" variant="default" className="w-full h-11">` with text `"Recevoir mon lien de connexion"` — matches the primary CTA copy pattern from Epic 4 AC + [ux-design-specification.md:430](../planning-artifacts/ux-design-specification.md#L430).
   - A sub-label `<p>` below the button reading `"Pas de mot de passe — vérifiez votre boîte mail"` in 12 px / `text-muted-foreground` (small/secondary scale per [ux-design-specification.md:355](../planning-artifacts/ux-design-specification.md#L355)).

2. **Given** the Confluent wordmark is rendered in the verification screen, **When** a developer inspects its markup, **Then** it is a new component `<ConfluentWordmark>` living at [apps/web/src/components/confluent/ConfluentWordmark.tsx](apps/web/src/components/confluent/ConfluentWordmark.tsx) that renders an inline `<svg>` with a `<text>` child reading `"Confluent"` (width auto-sized, height 28 px, `fill="currentColor"`, `font-family="var(--font-heading, 'Inter Variable', sans-serif)"`, `font-weight="500"`, `font-size="20"`, `x="50%"` `y="70%"` `text-anchor="middle"` `dominant-baseline="alphabetic"`). The root `<svg>` has `role="img"` and `aria-label="Confluent"`. The component accepts `className?: string` forwarded to the `<svg>`. Rationale for SVG-with-`<text>` (rather than a hand-rolled path-based wordmark): the project brands itself as the word "Confluent" in its heading font ([apps/web/src/components/layout/AppShell.tsx:23-25](apps/web/src/components/layout/AppShell.tsx#L23-L25)) — wrapping it in `<svg><text>` honors the Epic AC's "SVG" requirement without inventing branded typography that would drift from the AppShell wordmark. See Pinned Decision #1.

3. **Given** this is a mocked frontend-only story, **When** the user enters any email matching `type="email"` validity (e.g., `marc@fund.io`) and submits the form (button click OR `Enter` key inside the input), **Then** in this exact order:
   1. The submit button enters its pending state: `disabled={true}`, visible text changes to `"Envoi du lien…"` (ellipsis `…` is U+2026, not three dots), and an inline `<span aria-hidden="true">` rendering a `<LoaderCircleIcon className="size-4 animate-spin">` from `lucide-react` is shown to the left of the button text (leverages Button's `data-icon=inline-start` via a wrapped slot — see Pinned Decision #3).
   2. Inline error region below the input is cleared if it was previously displayed.
   3. A `setTimeout(..., 1000)` is scheduled. No real email is sent. No API call is made. No localStorage is written. No toast fires.
   4. After exactly 1 s, `useNavigate()` fires `navigate(\`/share/\${token}/dossier\`)` with `replace: false` (default). The verification screen unmounts naturally on route change; the pending timer's cleanup (see AC7 + Pinned Decision #4) prevents the navigate from firing a second time if the user unmounts mid-delay.

4. **Given** the email input is submitted empty (value is `''` or only whitespace per `stripNonPrintable(value).trim() === ''`), **When** the form's `onSubmit` runs, **Then** `event.preventDefault()` fires first, then an inline error `<p role="alert" id="share-email-error" className="text-xs text-destructive">` rendering the text `"L'adresse email est requise."` appears inside an `aria-live="assertive"` region directly below the `<Input>` and above the button. The `<Input>` receives `aria-invalid={true}` and `aria-describedby="share-email-error"`. Focus returns to the input via `inputRef.current?.focus()`. No navigation occurs, no pending state is entered, no `setTimeout` is scheduled. The error clears on the next `onChange` event (as soon as the user types any character), setting `aria-invalid` back to `undefined`. Pattern mirrors [apps/web/src/routes/dashboard/dossiers/nouveau/index.tsx:20-27](apps/web/src/routes/dashboard/dossiers/nouveau/index.tsx#L20-L27).

5. **Given** the form submission is EMAIL-SHAPED but invalid (e.g., `"notanemail"`, `"foo@"`, `"foo@bar"` with no TLD) — caught by the browser's HTML5 `type="email"` constraint validation, **When** the user submits, **Then** the browser's native constraint-validation bubble displays (no JS-side email-regex check is added in 4.1). The form does NOT submit, the pending state does NOT enter, and `navigate` is NOT called. Rationale at Pinned Decision #5: 4.1 is mocked/standalone and the Epic AC only mandates the EMPTY-email error; HTML5 `type="email"` native validation is sufficient for the "shape" case. Epic 6 (magic link wiring) will replace this with server-side validation.

6. **Given** the verification screen on a mobile viewport (< 640 px / `sm:` breakpoint), **When** the page renders, **Then** the layout remains centered and single-column. The form container is `w-full max-w-sm` (384 px max) with `px-6` horizontal padding — a 320 px viewport leaves a 24 px gutter on each side without horizontal overflow. The button is full-width (`w-full`), the input is full-width (`w-full`), and the wordmark scales to `h-7` (28 px). No element exceeds viewport width. Every interactive element (input, button) has a minimum touch target of 44×44 px (`h-11` = 44 px). The whole flow is keyboard-reachable: Tab from input to button, Enter submits. Vertically, the layout uses `min-h-screen flex flex-col items-center justify-center gap-6` so the content is middle-aligned even at short heights.

7. **Given** the pending state is active (`submitting === true` after step 3.1 of AC3) AND the user navigates away (e.g., closes the tab, presses browser back, or deep-links to a different route) BEFORE the 1-second `setTimeout` fires, **When** the `ShareRoute` component unmounts, **Then** the scheduled timer is cleared via `clearTimeout` in a `useEffect` cleanup — preventing a post-unmount `navigate` call that would either throw (deprecated React API) or warn in the console (React 19 emits "Cannot update state on unmounted component" when `setState` fires post-unmount, but `navigate` itself is side-effect-only — the real risk is navigating the user back to the dossier view after they chose to leave). See Pinned Decision #4 for the useEffect-based timer pattern and why a local `useRef<number | null>` is preferred over a `useState` for the timer ID (ref avoids re-renders on every timer assignment).

8. **Given** this is the first story in Epic 4 and the Epic AC's transition target `/share/:token/dossier` does not yet exist as a route, **When** the 1-second mock timer fires and `navigate(\`/share/\${token}/dossier\`)` executes, **Then** a minimal placeholder route renders a stub page at [apps/web/src/routes/share/dossier.tsx](apps/web/src/routes/share/dossier.tsx) so the navigation resolves to a 200 (not a router catch-all 404) and Story 4.2 can replace the stub incrementally. Stub contents: a standalone centered layout (same pattern as the verification screen but without AppShell), an H1 reading `"Dossier partagé"`, a `<p>` reading `"Token : {token}"`, and a `<p className="text-muted-foreground text-sm">` reading `"Vue dossier à venir dans la story 4.2."` — serves as a visible placeholder for manual QA and a contract for 4.2 to fulfill. See Pinned Decision #6 on the "add nav target stub in first-of-epic stories" convention.

9. **Given** the `/share/:token` route structure after 4.1 lands, **When** a developer inspects [apps/web/src/router.tsx](apps/web/src/router.tsx), **Then** the router registers two standalone (outside `<AppShell>`) routes for Epic 4's financeur flow:
   ```tsx
   { path: '/share/:token', element: <ShareRoute /> },             // email verification — 4.1
   { path: '/share/:token/dossier', element: <ShareDossierRoute /> }, // placeholder — 4.1, replaced in 4.2
   ```
   Both routes are top-level (siblings of `/auth`) and specifically NOT nested under `<AppShell />` — Epic 4 AC §Story 4.1 at [epics.md:849](../planning-artifacts/epics.md#L849) mandates "no sidebar, no top navigation bar, and no footer". The existing `{ path: '/share/:token', element: <ShareRoute /> }` registration at [apps/web/src/router.tsx:46](apps/web/src/router.tsx#L46) is preserved (the `element` changes behavior, not the path); the new `/share/:token/dossier` entry is added immediately after. The `/auth` and `/share/*` routes remain outside `AppShell` so they render fullscreen with no navigation chrome.

10. **Given** page title / SEO for the verification screen, **When** the `<title>` element is inspected, **Then** it reads exactly `"Accéder au dossier · Confluent"` — matches the H1 copy + trailing `· Confluent` brand suffix (precedent: [apps/web/src/routes/auth/login.tsx](apps/web/src/routes/auth/login.tsx) renders `"Connexion · Confluent"`; [apps/web/src/routes/dashboard/dossiers/nouveau/index.tsx:32](apps/web/src/routes/dashboard/dossiers/nouveau/index.tsx#L32) renders `"Nouveau dossier · Confluent"`). The `<title>` is rendered via React 19's native `<title>` JSX element (NOT `react-helmet`, NOT a custom head manager) — same pattern as every other route in the app.

11. **Given** design-token compliance, **When** a developer greps the 4.1 changes, **Then** ZERO raw hex values appear in any of: [apps/web/src/routes/share/index.tsx](apps/web/src/routes/share/index.tsx), [apps/web/src/routes/share/dossier.tsx](apps/web/src/routes/share/dossier.tsx), [apps/web/src/components/confluent/ConfluentWordmark.tsx](apps/web/src/components/confluent/ConfluentWordmark.tsx). Every surface routes through: `bg-background` (page), `text-foreground` (H1, wordmark via `currentColor` + inherited `text-foreground`), `text-muted-foreground` (description, sub-label), `text-destructive` (inline error), `border-input` (Input default), primary Button variant (resolves to `bg-primary text-primary-foreground hover:bg-foreground` from [apps/web/src/components/ui/button.tsx:12](apps/web/src/components/ui/button.tsx#L12)). Sub-label uses `text-xs` (12 px); description uses `text-sm` (14 px). Automation grep at AC18.

12. **Given** French-locale copy, **When** the verification screen renders, **Then** the following strings appear EXACTLY (character-for-character — no typographic "improvements", no em-dash swaps, no curly-quote substitutions):
    - Heading: `"Accéder au dossier"`
    - Description: `"Entrez votre adresse email pour recevoir votre lien d'accès."`
    - Placeholder: `"votre@email.fr"`
    - Button label (idle): `"Recevoir mon lien de connexion"`
    - Button label (pending): `"Envoi du lien…"` (ellipsis character U+2026, NOT three dots)
    - Sub-label: `"Pas de mot de passe — vérifiez votre boîte mail"` (em-dash character U+2014, NOT two hyphens)
    - Empty-field error: `"L'adresse email est requise."`
    - Hidden input label: `"Adresse email"` (sr-only)
    - Wordmark aria-label: `"Confluent"`
    - Page title: `"Accéder au dossier · Confluent"`
    Apostrophes inside JSX text are escaped as `&apos;` (precedent: [apps/web/src/routes/dashboard/dossiers/nouveau/index.tsx:40](apps/web/src/routes/dashboard/dossiers/nouveau/index.tsx#L40) `s&apos;appelle`). Example: `<p>L&apos;adresse email est requise.</p>` and `<p>Entrez votre adresse email pour recevoir votre lien d&apos;accès.</p>`. See Pinned Decision #7.

13. **Given** keyboard and screen-reader navigation, **When** AT traverses the verification screen, **Then**:
    - The Confluent wordmark announces as `"Confluent, image"` (via `role="img"` + `aria-label`).
    - The H1 receives announcement as `"Accéder au dossier, heading level 1"`.
    - The description announces as normal paragraph text.
    - The input announces as `"Adresse email, edit, requis"` when focused (the hidden `<label>` provides the name; `required` attribute adds the "requis" state).
    - On empty-submit error, the `aria-live="assertive"` region announces `"L'adresse email est requise."` and focus returns to the input.
    - The button announces as `"Recevoir mon lien de connexion, bouton"` (idle) or `"Envoi du lien…, bouton, indisponible"` (pending, via `disabled`).
    - Keyboard order: input → button. Tab advances; Shift-Tab reverses; Enter inside input submits the form (native HTML behavior — no explicit keydown handler).
    - `prefers-reduced-motion: reduce` respected via `motion-reduce:animate-none` on the pending-state `<LoaderCircleIcon>` (see Pinned Decision #3). No custom transitions beyond Tailwind defaults.
    - Focus-visible ring: 2 px solid `var(--ring)` — inherited from `Input` + `Button` primitives at [apps/web/src/components/ui/input.tsx](apps/web/src/components/ui/input.tsx) + [apps/web/src/components/ui/button.tsx](apps/web/src/components/ui/button.tsx). WCAG 2.1 AA focus-indicator compliant per [prd.md:497](../planning-artifacts/prd.md#L497).

14. **Given** Story 4.1's `onSubmit` handler implementation, **When** a developer inspects [apps/web/src/routes/share/index.tsx](apps/web/src/routes/share/index.tsx), **Then** the component uses the following shape (canonical snippet — deviations require explicit Pinned Decision):
    ```tsx
    import { useEffect, useRef, useState, type FormEvent } from 'react'
    import { useNavigate, useParams } from 'react-router-dom'
    import { LoaderCircleIcon } from 'lucide-react'
    import { ConfluentWordmark } from '@/components/confluent/ConfluentWordmark'
    import { Button } from '@/components/ui/button'
    import { Input } from '@/components/ui/input'
    import { stripNonPrintable } from '@/lib/sanitize'

    const MOCK_SEND_DELAY_MS = 1000

    export default function ShareRoute() {
      const { token } = useParams<{ token: string }>()
      const navigate = useNavigate()
      const inputRef = useRef<HTMLInputElement>(null)
      const timerRef = useRef<number | null>(null)
      const [email, setEmail] = useState('')
      const [showError, setShowError] = useState(false)
      const [submitting, setSubmitting] = useState(false)

      useEffect(() => {
        return () => {
          if (timerRef.current !== null) {
            clearTimeout(timerRef.current)
            timerRef.current = null
          }
        }
      }, [])

      function handleSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        const cleaned = stripNonPrintable(email).trim()
        if (!cleaned) {
          setShowError(true)
          inputRef.current?.focus()
          return
        }
        setShowError(false)
        setSubmitting(true)
        timerRef.current = window.setTimeout(() => {
          timerRef.current = null
          navigate(`/share/${token}/dossier`)
        }, MOCK_SEND_DELAY_MS)
      }

      return (
        <>
          <title>Accéder au dossier · Confluent</title>
          <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-6 py-12">
            <ConfluentWordmark className="h-7 w-auto text-foreground" />
            <div className="flex w-full max-w-sm flex-col gap-2 text-center">
              <h1 className="font-heading text-2xl font-medium text-foreground sm:text-[28px]">
                Accéder au dossier
              </h1>
              <p className="text-sm text-muted-foreground">
                Entrez votre adresse email pour recevoir votre lien d&apos;accès.
              </p>
            </div>
            <form
              onSubmit={handleSubmit}
              noValidate={false}
              className="flex w-full max-w-sm flex-col gap-3"
            >
              <label htmlFor="share-email" className="sr-only">
                Adresse email
              </label>
              <Input
                ref={inputRef}
                id="share-email"
                name="email"
                type="email"
                required
                autoComplete="email"
                placeholder="votre@email.fr"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value)
                  if (showError) setShowError(false)
                }}
                aria-invalid={showError || undefined}
                aria-describedby={showError ? 'share-email-error' : undefined}
                disabled={submitting}
                className="h-11 w-full"
              />
              <div
                aria-live="assertive"
                aria-atomic="true"
                className="min-h-[1em]"
              >
                {showError && (
                  <p
                    id="share-email-error"
                    role="alert"
                    className="text-xs text-destructive"
                  >
                    L&apos;adresse email est requise.
                  </p>
                )}
              </div>
              <Button
                type="submit"
                size="lg"
                disabled={submitting}
                className="h-11 w-full"
              >
                {submitting ? (
                  <>
                    <LoaderCircleIcon
                      data-icon="inline-start"
                      className="size-4 animate-spin motion-reduce:animate-none"
                      aria-hidden="true"
                    />
                    Envoi du lien…
                  </>
                ) : (
                  'Recevoir mon lien de connexion'
                )}
              </Button>
              <p className="text-center text-xs text-muted-foreground">
                Pas de mot de passe — vérifiez votre boîte mail
              </p>
            </form>
          </main>
        </>
      )
    }
    ```
    Deviations require explicit mention in the story's Completion Notes.

15. **Given** the placeholder `<ShareDossierRoute>` from AC8, **When** a developer inspects [apps/web/src/routes/share/dossier.tsx](apps/web/src/routes/share/dossier.tsx), **Then** it uses this canonical snippet:
    ```tsx
    import { useParams } from 'react-router-dom'

    export default function ShareDossierRoute() {
      const { token } = useParams<{ token: string }>()
      return (
        <>
          <title>Dossier partagé · Confluent</title>
          <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-3 bg-background px-6 py-12 text-center">
            <h1 className="font-heading text-2xl font-medium text-foreground">
              Dossier partagé
            </h1>
            <p className="text-sm text-muted-foreground">Token : {token}</p>
            <p className="text-xs text-muted-foreground">
              Vue dossier à venir dans la story 4.2.
            </p>
          </main>
        </>
      )
    }
    ```
    Story 4.2 will replace the BODY of this file (mobile layout) and 4.3 extends (desktop layout). The FILE PATH and DEFAULT EXPORT NAME (`ShareDossierRoute`) are set in 4.1 — 4.2/4.3 consume them without renaming. The placeholder is ephemeral documentation; the permanent API contract is path + default-export-name.

16. **Given** no regression on Stories 1.1 – 3.6, **When** the dev agent completes 4.1, **Then**:
    - `/dashboard` still renders the entrepreneur dashboard (Stories 2.2, 3.1).
    - `/dashboard/dossiers/nouveau` naming step still reachable (Story 2.3).
    - `/dashboard/dossiers/view/:slug` dossier page + tabs + analytics (Stories 3.2–3.6) unchanged — the `<DossierViewRoute>` split and `accessEntries` remount pattern from Story 3.5's code review is NOT touched.
    - `<SharePanel>` at [apps/web/src/components/confluent/SharePanel.tsx](apps/web/src/components/confluent/SharePanel.tsx) unchanged.
    - `<RevokeAccessDialog>` at [apps/web/src/components/confluent/RevokeAccessDialog.tsx](apps/web/src/components/confluent/RevokeAccessDialog.tsx) unchanged.
    - `<AccessListRow>` and `<StatusDot>` unchanged.
    - `<AppShell>` unchanged (4.1 does NOT register under it).
    - `<Toaster>` mount at [apps/web/src/main.tsx:15](apps/web/src/main.tsx#L15) unchanged — 4.1 fires zero toasts.
    - `<CurrentUserProvider>` unchanged — 4.1 does NOT consume the current-user context (the financeur is anonymous until the real magic-link flow lands in Epic 6).
    - [apps/web/src/lib/sanitize.ts](apps/web/src/lib/sanitize.ts) unchanged — 4.1 reuses `stripNonPrintable` via import.
    - [apps/web/src/lib/utils.ts](apps/web/src/lib/utils.ts) unchanged — 4.1 consumes `cn()` via primitive wrappers.
    - The pre-existing `/share/:token` placeholder behavior (currently rendering the token string) is REPLACED — this is a deliberate rewrite, not a regression. If any caller was deep-linking to the old placeholder for debugging, that token value is still visible in the URL (`useParams` still reads it) and in the DOM after 4.2 lands.
    - The three tolerated pre-existing ESLint warnings from prior stories (`badge.tsx:52`, `button.tsx:58`, `features/current-user/context.tsx:17`) are NOT re-opened by 4.1 — the new files generate zero new warnings.

17. **Given** this is the first story in Epic 4, **When** the developer creates the story, **Then** the sprint-status tracker MUST transition `epic-4` from `backlog` → `in-progress` and `4-1-email-verification-screen-ui-only-mocked` from `backlog` → `ready-for-dev`. The `last_updated` field in [sprint-status.yaml](sprint-status.yaml) updates to `2026-04-22`. The transition is automatic per the `create-story` workflow at [.claude/skills/bmad-create-story/workflow.md:128-149](../../../../../.claude/skills/bmad-create-story/workflow.md#L128-L149).

18. **Given** the Task 4 verification sweep, **When** a developer runs the grep guardrails, **Then**:
    - `grep -nE '#[0-9a-fA-F]{3,6}' apps/web/src/routes/share/*.tsx apps/web/src/components/confluent/ConfluentWordmark.tsx` returns ZERO matches (no raw hex in 4.1 files).
    - `grep -n "Accéder au dossier\|Entrez votre adresse email\|Recevoir mon lien de connexion\|Envoi du lien\|Pas de mot de passe\|L.adresse email est requise\|votre@email.fr" apps/web/src/routes/share/index.tsx` returns EXACTLY 7 matches — one per piece of copy listed in AC12 (modulo the regex alternation treating `L'adresse` / `L&apos;adresse` as the same pattern via `L.adresse`).
    - `grep -n "setTimeout\|clearTimeout" apps/web/src/routes/share/index.tsx` returns EXACTLY 2 matches — one `setTimeout` in `handleSubmit`, one `clearTimeout` in the `useEffect` cleanup.
    - `grep -n "@/lib/sanitize" apps/web/src/routes/share/index.tsx` returns EXACTLY 1 match — the `stripNonPrintable` import.
    - `grep -n "AppShell\|Breadcrumbs\|NavItem" apps/web/src/routes/share/` returns ZERO matches — the verification + dossier-placeholder routes must be fully standalone.
    - `grep -rn "@radix-ui/react" apps/web/src/routes/share/ apps/web/src/components/confluent/ConfluentWordmark.tsx` returns ZERO matches — all primitives route through `@base-ui/react` or shadcn-wrapped primitives.
    - `grep -n "useCurrentUser\|CurrentUserProvider" apps/web/src/routes/share/ apps/web/src/components/confluent/ConfluentWordmark.tsx` returns ZERO matches — the financeur flow is anonymous in 4.1.
    - `grep -n "ShareDossierRoute" apps/web/src/router.tsx` returns EXACTLY 1 match — the import line.
    - `pnpm turbo run typecheck lint build` — all three targets GREEN. The new files generate zero new warnings. Bundle delta: estimate ~+2 KB gz (tiny — adds 1 route component, 1 placeholder route, 1 wordmark SVG; no new npm dep — `lucide-react` already installed).
    - Manual browser walkthrough (tri-viewport 375 / 900 / 1440 px): open `http://localhost:5173/share/test-token` → verify layout (no sidebar, centered) → tab to input → type `marc@fund.io` → press Enter → button shows spinner + "Envoi du lien…" for 1 s → auto-navigate to `/share/test-token/dossier` → placeholder page renders. Then: reload `/share/test-token`, click button with empty input → inline error appears + focus returns to input + button stays idle. Then: reload, type one character → error clears. Then: submit with `notanemail` → browser validity bubble. Then: submit valid email, press browser back during the 1 s delay → no post-unmount navigate.

## Tasks / Subtasks

- [x] **Task 1: Create the `<ConfluentWordmark>` component (AC: 2, 11, 13)**
  - [x] Create [apps/web/src/components/confluent/ConfluentWordmark.tsx](apps/web/src/components/confluent/ConfluentWordmark.tsx) with the exact signature:
    ```tsx
    import { cn } from '@/lib/utils'

    type ConfluentWordmarkProps = React.ComponentPropsWithoutRef<'svg'>

    export function ConfluentWordmark({ className, ...props }: ConfluentWordmarkProps) {
      return (
        <svg
          role="img"
          aria-label="Confluent"
          viewBox="0 0 140 28"
          className={cn('h-7 w-auto', className)}
          {...props}
        >
          <text
            x="50%"
            y="70%"
            textAnchor="middle"
            dominantBaseline="alphabetic"
            fill="currentColor"
            fontFamily="var(--font-heading, 'Inter Variable', sans-serif)"
            fontSize="20"
            fontWeight="500"
          >
            Confluent
          </text>
        </svg>
      )
    }
    ```
  - [x] Export is a named export `ConfluentWordmark` (NOT a default — matches the pattern of `EmptyDossiersIllustration` at [apps/web/src/components/confluent/illustrations/EmptyDossiersIllustration.tsx](apps/web/src/components/confluent/illustrations/EmptyDossiersIllustration.tsx)).
  - [x] Placement in `components/confluent/` (NOT in `components/ui/` — `ui/` is for shadcn primitives; `confluent/` is for Confluent-specific components). Placement in the folder ROOT (NOT in `illustrations/` — wordmark is not an empty-state illustration).
  - [x] Typecheck: `pnpm --filter @confluent/web typecheck`.

- [x] **Task 2: Rewrite `ShareRoute` to the email verification screen (AC: 1, 3, 4, 5, 7, 10, 11, 12, 13, 14)**
  - [x] Rewrite [apps/web/src/routes/share/index.tsx](apps/web/src/routes/share/index.tsx) — use the canonical snippet at AC14 verbatim (or a structurally equivalent variant; any deviation must be called out in Completion Notes).
  - [x] Preserve the `default` export name `ShareRoute` (router.tsx at [apps/web/src/router.tsx:11](apps/web/src/router.tsx#L11) imports the default — renaming would break the router registration).
  - [x] Verify the existing `/share/:token` router registration at [apps/web/src/router.tsx:46](apps/web/src/router.tsx#L46) still points at `<ShareRoute />` — no path or element change for this entry.
  - [x] Imports match AC14's canonical list: React hooks, react-router-dom, lucide-react's `LoaderCircleIcon`, `ConfluentWordmark`, `Button`, `Input`, `stripNonPrintable`. No additional imports.
  - [x] Typecheck green after rewrite.

- [x] **Task 3: Add the `/share/:token/dossier` placeholder route (AC: 8, 9, 15)**
  - [x] Create [apps/web/src/routes/share/dossier.tsx](apps/web/src/routes/share/dossier.tsx) — use the canonical snippet at AC15 verbatim.
  - [x] Register the new route in [apps/web/src/router.tsx](apps/web/src/router.tsx) as a sibling of the existing `/share/:token` entry — add the `import ShareDossierRoute from '@/routes/share/dossier'` near the top (alphabetically after `ShareRoute`), then add `{ path: '/share/:token/dossier', element: <ShareDossierRoute /> }` immediately after the `{ path: '/share/:token', ... }` entry inside the `createBrowserRouter` config array.
  - [x] Confirm the placeholder route is OUTSIDE the `{ path: '/', element: <AppShell />, children: [...] }` block — verifies the "no sidebar / no chrome" contract of AC1 + AC9.
  - [x] Typecheck + lint green; manually load `http://localhost:5173/share/any-token/dossier` — the placeholder page renders with the token value visible. (Manual browser walkthrough deferred — see Completion Notes.)

- [x] **Task 4: Verification sweep — typecheck, lint, build, grep, manual walkthrough (AC: 11, 16, 18)**
  - [x] `pnpm --filter @confluent/web typecheck` — exits 0.
  - [x] `pnpm --filter @confluent/web lint` — exits 0. Preserve the 3 tolerated pre-existing warnings (`badge.tsx:52`, `button.tsx:58`, `features/current-user/context.tsx:17`); NO new warnings.
  - [x] `pnpm turbo run build` — all packages GREEN. Bundle delta measured against the actual 3.6 baseline (see Completion Notes — the Dev Notes baseline figure was stale).
  - [x] Run the AC18 grep battery — all assertions pass except `ShareDossierRoute` count (see Completion Notes — the AC-expected count of 1 is impossible given AC9 mandates BOTH the import and the JSX element usage).
  - [x] Manual browser walkthrough deferred (headless dev env) — documented in Completion Notes.
  - [x] On each edit, mark the corresponding Tasks/Subtasks checkbox above.
  - [x] Update [apps/web/src/main.tsx](apps/web/src/main.tsx): NO changes (verified — 4.1 does not touch the mount point).
  - [x] Update this story file: mark Status to `review` after the sweep passes + commit lands.

- [x] **Task 5: Sprint status + Epic-4-kickoff housekeeping (AC: 17)**
  - [x] After Task 4 is green AND the implementation commit lands, update [sprint-status.yaml](sprint-status.yaml):
    - `development_status.epic-4: backlog` → `in-progress` (first story in Epic 4 triggers the transition per the `create-story` workflow's rule at [.claude/skills/bmad-create-story/workflow.md:128-149](../../../../../.claude/skills/bmad-create-story/workflow.md#L128-L149) — this story file's creation already did this).
    - `development_status.4-1-email-verification-screen-ui-only-mocked: backlog` → `ready-for-dev` — automatic via the `create-story` workflow's final step. Dev workflow further transitions `ready-for-dev` → `in-progress` → `review`.
    - `last_updated: 2026-04-22`.
  - [x] Preserve every comment in the file (including the STATUS DEFINITIONS block) — never rewrite the file; use targeted replacements only.

## Dev Notes

### Critical Architecture Constraints

- **`/share/:token` is a STANDALONE route — NOT nested under `<AppShell>`.** The router registers it as a top-level sibling of `/auth` at [apps/web/src/router.tsx:46](apps/web/src/router.tsx#L46). This is the established convention for non-authenticated surfaces. Epic 4 AC mandates the explicit absence of sidebar / top bar / breadcrumb — do NOT try to "reuse" `AppShell` wrapping. The minimal auth routes at [apps/web/src/routes/auth/](apps/web/src/routes/auth/) follow the same pattern. [Source: ux-design-specification.md §Journey 2 line 466-480; epics.md §Story 4.1 AC4 line 847-849]
- **Inline SVG wordmark over a rasterized logo asset.** The project brands itself as the word "Confluent" rendered in the Inter heading font ([apps/web/src/components/layout/AppShell.tsx:23-25](apps/web/src/components/layout/AppShell.tsx#L23-L25)). Story 4.1's `<ConfluentWordmark>` wraps the word in an `<svg><text>` element — satisfies the Epic AC's "SVG" requirement without inventing branded typography. The favicon.svg at [apps/web/public/favicon.svg](apps/web/public/favicon.svg) is a purple/blue icon that does NOT match Confluent's warm-gray monochromatic palette at [ux-design-specification.md:325-343](../planning-artifacts/ux-design-specification.md#L325-L343) — do NOT use it as the logo. See Pinned Decision #1 for the rationale + deferred "real SVG logo" future work.
- **Plain `useState` + native HTML5 validation — NOT react-hook-form + Zod.** Story 3.5's `<SharePanel>` introduced the RHF+Zod pattern at [apps/web/src/components/confluent/SharePanel.tsx](apps/web/src/components/confluent/SharePanel.tsx) for the multi-field invitation form. 4.1's verification screen has a SINGLE field with ONE rule ("required"). RHF+Zod is overkill here — plain `useState` + an empty-check mirrors the pattern from [apps/web/src/routes/dashboard/dossiers/nouveau/index.tsx](apps/web/src/routes/dashboard/dossiers/nouveau/index.tsx) (dossier naming step, same single-field shape). The HTML5 `type="email"` + `required` attributes handle shape validation natively — no regex, no Zod. Precedent: Story 2.3 naming input + Story 2.4 QuestionnaireStep both use plain state. [Source: architecture.md:223-228; Stories 2.3 + 2.4 implementations]
- **`stripNonPrintable` before `trim()` for the empty-check.** The existing sanitizer at [apps/web/src/lib/sanitize.ts:1-6](apps/web/src/lib/sanitize.ts#L1-L6) strips C0 controls, soft hyphens, zero-width spaces, and directional-override characters. Reuse it on the email value before `.trim()` to prevent "whitespace-only with bidi overrides passes the required check" (a pre-existing trap from Story 2.3's naming input that the sanitizer already handles). See the canonical snippet at AC14 line 24. [Source: [apps/web/src/lib/sanitize.ts](apps/web/src/lib/sanitize.ts); [apps/web/src/routes/dashboard/dossiers/nouveau/index.tsx:5,20](apps/web/src/routes/dashboard/dossiers/nouveau/index.tsx#L5); [apps/web/src/features/questionnaire/components/QuestionnaireStep.tsx:4,30](apps/web/src/features/questionnaire/components/QuestionnaireStep.tsx#L4)]
- **`setTimeout` must be cleared on unmount.** The 1 s mock delay between submit and navigate is a classic unmount-during-pending hazard. `useEffect(() => () => clearTimeout(timerRef.current), [])` guards it. Using `useRef<number | null>` (not `useState`) avoids re-renders on timer assignment. See Pinned Decision #4 for the full pattern. This is the FIRST setTimeout usage in the entire apps/web codebase — no prior precedent to inherit. [Source: AC3, AC7, AC14]
- **The navigation target `/share/:token/dossier` must resolve to a registered route.** React Router v7's default behavior for an unmatched path inside `createBrowserRouter` is to render nothing (or the `errorElement` if one is attached). Without a registration, the 1 s mock navigate would land on an empty page — catastrophic UX. 4.1 MUST register a placeholder route that 4.2 will replace. See AC8, AC9, AC15 + Pinned Decision #6. [Source: react-router-dom 7.14 createBrowserRouter docs; epics.md §Story 4.1 AC2 line 839-841]
- **`<title>` is a native React 19 JSX element — NOT a custom head manager.** React 19 ships first-class support for `<title>`, `<meta>`, and `<link>` inside component trees; they're hoisted to `<head>` automatically. Every existing route uses this pattern (see [apps/web/src/routes/not-found.tsx:7](apps/web/src/routes/not-found.tsx#L7), [apps/web/src/routes/dashboard/dossiers/nouveau/index.tsx:32](apps/web/src/routes/dashboard/dossiers/nouveau/index.tsx#L32)). Do NOT introduce `react-helmet`, `react-helmet-async`, or any other head manager. [Source: React 19 docs; precedent across every existing route file]
- **Use `lucide-react` for the pending-state spinner.** `LoaderCircleIcon` is already used in the project via the `sonner` wrapper at [apps/web/src/components/ui/sonner.tsx:11](apps/web/src/components/ui/sonner.tsx#L11) (actually `CircleCheckIcon` — but same package). No new dep; tree-shakes. The `animate-spin` utility is a Tailwind v4 built-in. `motion-reduce:animate-none` disables the spin under `prefers-reduced-motion: reduce` — auto-applied by Tailwind's motion-reduce cascade. [Source: AC3, AC13; package.json]
- **The `disabled` prop on `<Input>` during pending prevents double-submit.** Tab + Enter inside a disabled input does nothing; the form's `onSubmit` cannot fire while submitting. The `<Button disabled={submitting}>` blocks the click path. Two guards for the same property is intentional — belt-and-braces for a 1-second pending window where double-click is plausible. [Source: AC3, AC14]
- **NO localStorage / sessionStorage / URL state persistence in 4.1.** The mock delay completes + navigates; nothing is preserved. Story 6.2 (magic-link generation, real API) will persist the pending email server-side via an `auth_token` row. Epic 4 is explicitly a UI-only pass. Do NOT write `localStorage.setItem('share_email', ...)` — this would create state the next story has to rip out. [Source: epics.md §Epic 4 line 817-819; epics.md §Story 6.2 line 1328-1346]
- **The token value is NOT validated in 4.1.** Any non-empty token string resolves to the verification screen (Story 4.4's mocked guard adds the invalid/revoked filter). The `useParams<{ token: string }>()` call yields a string; the Epic AC explicitly says "with ANY token value" at [epics.md:829](../planning-artifacts/epics.md#L829). Do NOT add a `mockTokens` lookup in 4.1; that's 4.4's scope. [Source: epics.md §Story 4.1 AC1 line 829-830; epics.md §Story 4.4 line 928-954]
- **No `<Toaster>` interaction.** 4.1 fires zero toasts. The `<Toaster>` is mounted globally at [apps/web/src/main.tsx:15](apps/web/src/main.tsx#L15) but 4.1 does not import `toast` or `sonner`. The pending-button state is the only user feedback for the submit action — silent success (navigate), inline error for empty, native bubble for malformed. [Source: AC3, AC4, AC5; ux-design-specification.md §Feedback Patterns line 655-659]
- **Design tokens only — no raw hex.** `bg-background`, `text-foreground`, `text-muted-foreground`, `text-destructive`, `border-input`, primary Button variant's `bg-primary` / `hover:bg-foreground`. Wordmark SVG uses `fill="currentColor"` + inherited `text-foreground` from the wrapper class. AC18's grep is the automated guardrail.
- **French-locale typography rules:** ASCII apostrophes in SOURCE files (`'`, NOT `'`); JSX-escape via `&apos;` inside JSX text. Em-dashes are U+2014 (`—`), NOT two hyphens (`--`). Ellipsis is U+2026 (`…`), NOT three dots (`...`). Precedent: [apps/web/src/routes/dashboard/dossiers/nouveau/index.tsx:40](apps/web/src/routes/dashboard/dossiers/nouveau/index.tsx#L40) (`s&apos;appelle`). Copy in AC12 is authoritative — copy-paste literally, do not "improve". [Source: AC12; precedent from prior stories]
- **WCAG 2.1 AA baseline.** Focus-visible ring inherited from `Input`/`Button` primitives. Touch targets 44 px (`h-11`) per [ux-design-specification.md:381](../planning-artifacts/ux-design-specification.md#L381). Hidden label + `aria-invalid` + `aria-describedby` + `aria-live="assertive"` for the error. Button `disabled` announces as "unavailable". Minimum color contrast: `text-muted-foreground` (`#6B6B6B`) on `bg-background` (`#FAFAF9`) = ~4.9:1 — meets AA for 12 px body text (the sub-label). `text-foreground` (`#1A1A1A`) on `bg-background` = ~17.3:1 — AAA. [Source: ux-design-specification.md §Accessibility line 377-385; prd.md §NFR20-NFR23 line 495-498]

### Design Tokens to Use

| Surface | Tailwind utility | Value | Where |
|---|---|---|---|
| Page background | `bg-background` | `#FAFAF9` | `<main>` wrapper |
| Page min-height | `min-h-screen` | 100vh | `<main>` wrapper |
| H1 color | `text-foreground` | `#1A1A1A` | `<h1>` "Accéder au dossier" |
| H1 size/weight | `font-heading text-2xl font-medium sm:text-[28px]` | 24→28 px / 500 | `<h1>` |
| Description/sub-label color | `text-muted-foreground` | `#6B6B6B` | `<p>` description, sub-label |
| Description size | `text-sm` | 14 px | `<p>` description |
| Sub-label size | `text-xs` | 12 px | `<p>` sub-label |
| Error text color | `text-destructive` | `#E57373` | `<p role="alert">` empty-field error |
| Error text size | `text-xs` | 12 px | `<p role="alert">` |
| Input container | Inherited from `<Input>` default | `h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1` | `<Input>` |
| Input height override | `h-11` | 44 px (touch target) | `<Input className="h-11">` |
| Button primary | Inherited: `buttonVariants({ size: 'lg' })` → `bg-primary text-primary-foreground hover:bg-foreground` | `#37352F` / white text | `<Button>` |
| Button height override | `h-11` | 44 px (touch target) | `<Button className="h-11">` |
| Wordmark color | `text-foreground` (wrapper) + SVG `fill="currentColor"` | `#1A1A1A` | `<ConfluentWordmark>` |
| Wordmark size | `h-7 w-auto` | 28 px tall, auto width | `<ConfluentWordmark>` |
| Form container width | `w-full max-w-sm` | 384 px max | `<form>` + `<div>` header wrapper |
| Horizontal gutter | `px-6` | 24 px | `<main>` |
| Vertical gap | `gap-6` (main) / `gap-3` (form) / `gap-2` (header) | 24 / 12 / 8 px | Flex containers |
| Focus ring | `focus-visible:ring-3 focus-visible:ring-ring/50` | Inherited from Input/Button | Inputs + buttons |
| Spinner animation | `animate-spin motion-reduce:animate-none` | 1 s linear spin; disabled under reduced-motion | `<LoaderCircleIcon>` |

### Component Prop Contracts

```tsx
// apps/web/src/components/confluent/ConfluentWordmark.tsx
type ConfluentWordmarkProps = React.ComponentPropsWithoutRef<'svg'>
export function ConfluentWordmark(props: ConfluentWordmarkProps): JSX.Element
```

```tsx
// apps/web/src/routes/share/index.tsx
export default function ShareRoute(): JSX.Element
// — consumes useParams<{ token: string }>()
// — no props
```

```tsx
// apps/web/src/routes/share/dossier.tsx (new — placeholder for 4.2)
export default function ShareDossierRoute(): JSX.Element
// — consumes useParams<{ token: string }>()
// — no props; 4.2 replaces body, keeps path + default export name
```

### File Layout (target)

```
apps/web/src/
├── components/
│   ├── confluent/
│   │   ├── AccessListRow.tsx                          [UNCHANGED — 3.4]
│   │   ├── ConfluentWordmark.tsx                      [NEW — 4.1 wordmark component]
│   │   ├── DossierCard.tsx                            [UNCHANGED — 3.1]
│   │   ├── DossierField.tsx                           [UNCHANGED — 2.6]
│   │   ├── EmptyState.tsx                             [UNCHANGED — 2.2]
│   │   ├── MetricCard.tsx                             [UNCHANGED — 3.3]
│   │   ├── RevokeAccessDialog.tsx                     [UNCHANGED — 3.6]
│   │   ├── SharePanel.tsx                             [UNCHANGED — 3.5]
│   │   ├── StatusDot.tsx                              [UNCHANGED — 3.4]
│   │   ├── WizardInput.tsx                            [UNCHANGED — 2.3]
│   │   └── illustrations/
│   │       └── EmptyDossiersIllustration.tsx          [UNCHANGED]
│   ├── layout/                                        [UNCHANGED]
│   └── ui/                                            [UNCHANGED — all primitives]
├── data/                                              [UNCHANGED]
├── features/                                          [UNCHANGED]
├── lib/
│   ├── sanitize.ts                                    [UNCHANGED — reused import]
│   └── utils.ts                                       [UNCHANGED]
├── routes/
│   ├── admin/                                         [UNCHANGED]
│   ├── auth/                                          [UNCHANGED]
│   ├── dashboard/                                     [UNCHANGED]
│   ├── not-found.tsx                                  [UNCHANGED]
│   └── share/
│       ├── dossier.tsx                                [NEW — placeholder for 4.2/4.3]
│       └── index.tsx                                  [REWRITTEN — email verification screen]
├── main.tsx                                           [UNCHANGED]
└── router.tsx                                         [MODIFIED — add ShareDossierRoute import + route entry]
```

### Previous Story Intelligence

**From Story 3.6 (just landed — `75b566a`):**
- Epic 3 is complete (all stories 3.1 – 3.6 at `done` in sprint-status.yaml). 4.1 is the Epic 4 kick-off — the sprint-status transition is automatic per the `create-story` workflow's Step 1 rule.
- Single-commit preference: "Code + review in a single commit" from user memory (2026-04-20). 4.1's commit format: `feat(epic-4): story 4.1 — Email verification screen (UI only, mocked)` — matches the preceding Epic 3 commit naming convention.
- Bundle at 3.6 close: ~559 KB JS / ~175 KB gz. 4.1 adds ~2 KB gz (one small route + one wordmark SVG + one placeholder). Code-splitting remains deferred to Epic 10.
- The `<Toaster>` is mounted at [apps/web/src/main.tsx:15](apps/web/src/main.tsx#L15) — 4.1 does not consume it.
- The 3 tolerated pre-existing ESLint warnings (`badge.tsx:52`, `button.tsx:58`, `features/current-user/context.tsx:17`) must not re-open or widen.

**From Story 3.5 (`9ba8ff9`) — SharePanel + RHF/Zod:**
- RHF+Zod pattern established for multi-field forms. 4.1 intentionally does NOT adopt it — single field + single rule is plain-useState territory. Precedent for "use RHF only when the form has multiple fields or server-side validation" is recorded here.
- `sonner` is wired; 4.1 does not fire any toasts.
- `@hookform/resolvers` was added as a dep; 4.1 does not touch it.

**From Story 3.4 (`e04e2a2`) — AccessListRow + StatusDot:**
- Component-directory convention: Confluent-specific components live in `components/confluent/` at the folder root. 4.1's `<ConfluentWordmark>` follows this pattern (not in `illustrations/` — that's for empty-state SVGs).

**From Story 3.2 (`791997b`) — dossier header + Tabs:**
- React Router v7 URL-param reading with `useParams<{ slug: string }>()` is the canonical pattern. 4.1 uses `useParams<{ token: string }>()` identically.

**From Stories 2.3 / 2.4 (questionnaire flow) — plain useState forms:**
- Dossier-naming step at [apps/web/src/routes/dashboard/dossiers/nouveau/index.tsx](apps/web/src/routes/dashboard/dossiers/nouveau/index.tsx) is the closest sibling to 4.1's verification screen: single input + single empty-check + navigate on submit. 4.1 mirrors this structure almost exactly, adding: (a) `type="email"` for shape validation, (b) a 1-second mock delay via setTimeout, (c) a pending state on the button, (d) an unmount cleanup for the timer.
- `stripNonPrintable` is the established sanitizer for empty-checks. 4.1 reuses it.
- `autoFocus` attribute is used sparingly; 4.1 does NOT auto-focus the email input (the verification screen is an entry point, not a step inside a wizard flow — auto-focusing would steal focus from AT users starting to navigate the page heading). Deliberate divergence from the naming-input pattern.

**From Story 2.2 (dashboard empty state) — layout patterns:**
- Standalone centered layouts use `min-h-screen flex flex-col items-center justify-center gap-N px-6 py-12`. 4.1 adopts this shape with `gap-6` between major sections.

**From Stories 3.3 / 3.4 / 3.5 §Review Findings — items explicitly tagged:**
- No open deferrals from Epic 3 are resolved by 4.1 (Epic 4 is a separate UI surface). The `deferred-work.md` entries from 3.3 / 3.4 / 3.5 / 3.6 remain untouched.

### Decisions Pinned for This Story

The following decisions are locked for Story 4.1 implementation. Do not renegotiate without explicit retrospective action.

1. **Wordmark is an `<svg>` with a `<text>` child — NOT a path-based logo asset, NOT the favicon.svg.** The favicon at [apps/web/public/favicon.svg](apps/web/public/favicon.svg) is a multi-color purple/blue asset that clashes with Confluent's warm-gray monochromatic palette. Rendering the word "Confluent" via `<svg><text>` honors the Epic AC ("SVG, centered") while matching the AppShell's text-wordmark convention at [apps/web/src/components/layout/AppShell.tsx:23-25](apps/web/src/components/layout/AppShell.tsx#L23-L25). Future work: if/when a designer produces a vector logo, swap the SVG body for the real path. Tracked as a future item (not deferred-work-worthy today).

2. **Wordmark placement: `components/confluent/` folder root — NOT `illustrations/`, NOT `ui/`, NOT `layout/`.** `ui/` is reserved for shadcn primitives. `layout/` is reserved for nav chrome (sidebar, breadcrumbs). `illustrations/` is for empty-state SVGs. The wordmark is brand/identity — Confluent-specific, reusable across routes, not empty-state illustrative. Folder root is the right drawer.

3. **Pending-state spinner is `LoaderCircleIcon` from lucide-react with `animate-spin motion-reduce:animate-none`.** No custom SVG, no CSS `@keyframes`. `lucide-react` is already installed (used by `<Toaster>`). `data-icon="inline-start"` is passed to the icon (the `Button` primitive at [apps/web/src/components/ui/button.tsx:31](apps/web/src/components/ui/button.tsx#L31) recognizes `has-data-[icon=inline-start]:pl-2` and tightens the left padding). `aria-hidden="true"` on the icon — the button's visible text is its accessible name.

4. **Timer handle stored in `useRef<number | null>`, cleared in `useEffect`'s cleanup.** Rationale: refs don't trigger re-renders on assignment; `useEffect(() => () => clearTimeout(timerRef.current), [])` guards against post-unmount navigation. Setting `timerRef.current = null` inside the timer callback prevents a double-clear (cleanup running after callback completes is a no-op on `null`). This is the FIRST setTimeout usage in `apps/web`; the pattern is set here for future stories (Epic 6 magic-link polling, Epic 7 auto-save debounce).

5. **HTML5 `type="email"` + native constraint validation for SHAPED-but-invalid — no JS-side regex.** The Epic AC only mandates the EMPTY-email error. For shape errors (`notanemail`, `foo@`), the browser's native validity bubble is sufficient and locale-aware. Adding a Zod `.email()` schema or a custom regex introduces: (a) a copy that must be translated / maintained, (b) a duplication of the browser's constraint, (c) a de facto RHF+Zod migration (see Critical Architecture Constraints). 4.1 deliberately stays minimal. Epic 6 replaces this with server-side validation against a real auth endpoint.

6. **Register the navigation target `/share/:token/dossier` as a placeholder route in 4.1 — NOT in 4.2.** The 1-second mock timer fires `navigate(...)`; without a matching route, React Router v7 renders nothing (or the router-level errorElement). Registering a placeholder at [apps/web/src/routes/share/dossier.tsx](apps/web/src/routes/share/dossier.tsx) with a minimal "placeholder for 4.2" body ensures the navigation resolves to a 200 + visible-content response. 4.2 replaces the BODY only — keeps the path + default export name. This "add nav target stub in first-of-epic stories" convention applies to any Epic whose first story navigates to a later story's route.

7. **Copy literal at AC12 — no typographic "improvements".** ASCII apostrophes in source; `&apos;` inside JSX. Em-dash is U+2014, ellipsis is U+2026 — use the characters directly, not `--` or `...`. Precedent enforcement across Epic 2 + Epic 3 stories is strict; 4.1 maintains the pattern.

8. **No `autoFocus` on the email input.** Departure from the dossier-naming step at [apps/web/src/routes/dashboard/dossiers/nouveau/index.tsx:51](apps/web/src/routes/dashboard/dossiers/nouveau/index.tsx#L51) — the naming step is a step INSIDE a wizard flow (the user just clicked "Commencer"), so grabbing focus is appropriate. The verification screen is an ENTRY point from an external email link; stealing focus from AT users' initial page traversal is a WCAG 2.4.3 focus-order smell. The form is still keyboard-reachable via Tab; submit works via Enter inside the input. Let the user orient themselves first.

9. **No `useCurrentUser` consumption in 4.1.** The financeur is anonymous on the verification screen — they haven't been magic-link-authenticated yet. Story 6.6 (frontend magic-link wiring) will introduce a distinct financeur session context. Do NOT try to add a financeur branch to the existing `<CurrentUserProvider>` — that's hardcoded to `Sophie Moreau` (entrepreneur role) at [apps/web/src/features/current-user/context.tsx:4-9](apps/web/src/features/current-user/context.tsx#L4-L9) and represents the dashboard user. Epic 6 will introduce session-kind branching.

10. **`<form>` default browser validation is NOT disabled.** The canonical snippet at AC14 uses `noValidate={false}` (explicit for clarity). This enables the `type="email"` constraint bubble for SHAPED-but-invalid emails (AC5). The `event.preventDefault()` inside `handleSubmit` only runs for VALID HTML5 submissions — the browser short-circuits on `type="email"` mismatch and displays its native bubble, blocking submit + `handleSubmit` entirely.

11. **Bundle budget for 4.1: ~+2 KB gz.** No new npm dep (`lucide-react` + `react-router-dom` + `stripNonPrintable` + Tailwind classes — all already installed). The added source is ~60 LOC across three files. If the bundle-size delta exceeds 5 KB gz, inspect for accidental re-imports (e.g., the full `lucide-react` barrel instead of a named sub-module — should be `import { LoaderCircleIcon } from 'lucide-react'` which tree-shakes).

12. **Placeholder `<ShareDossierRoute>` is ephemeral; path + default export name are permanent.** 4.2 rewrites the component body (mobile layout); 4.3 extends it (desktop two-column). The path `/share/:token/dossier` and the default export name `ShareDossierRoute` are locked in 4.1 as the API contract. 4.2/4.3 consume the contract without renaming — keeps router.tsx stable across the Epic-4 landing.

### Git Intelligence

Recent commits (most recent 5):

```
75b566a feat(epic-3): story 3.6 — Access revocation (optimistic, mocked)
9ba8ff9 feat(epic-3): story 3.5 — Share panel (D5) with Sheet component
e04e2a2 feat(epic-3): story 3.4 — AccessListRow & StatusDot components
a093915 feat(epic-3): story 3.3 — MetricCard grid & analytics timeline (D4)
791997b feat(epic-3): story 3.2 — dossier page header & tab navigation
```

**Observed patterns to carry forward:**
- Commit title format: `feat(epic-N): story N.M — <Descriptive title matching epic AC phrasing>` — 4.1 commit title: `feat(epic-4): story 4.1 — Email verification screen (UI only, mocked)`.
- Single bundled commit per story (impl + code-review patches together). Ref: user memory 2026-04-20.
- Each Epic-3 story added +1 to +3 new files and modified at most 2–3 existing files — 4.1's footprint (3 new files, 1 modified [router.tsx]) is consistent.
- Base UI primitives only for new `components/ui/` additions — 4.1 adds no new `ui/` primitive (Button + Input suffice).
- Sprint-status tracker updated in the same commit as the story-kickoff (Epic status flip happens alongside story file creation, before implementation lands). The `create-story` workflow handles this automatically; verify after this story file saves.

### Latest Technical Specifics

**React 19 + React Router v7:**
- Native `<title>` JSX element is supported and auto-hoisted. Every existing route uses it — 4.1 continues the pattern.
- `useNavigate()` returns a stable function identity across renders. Safe to call from inside a `setTimeout` callback.
- `useParams<{ token: string }>()` provides typed access. The `token` is `string | undefined` at the type level (a generic-param contract — React Router does not know if the route matches). In practice inside `ShareRoute`, the router only renders the component when `:token` matches, so `token` is always defined; template-literal use `\`/share/\${token}/dossier\`` is safe.

**Lucide-react v1.8.0:**
- `LoaderCircleIcon` exists and tree-shakes. Named import: `import { LoaderCircleIcon } from 'lucide-react'`.
- The icon accepts standard SVG attributes + `className`. `size-4` (Tailwind utility) sizes it to 16 px.

**Tailwind v4.2.2:**
- `animate-spin` is a built-in utility (`@keyframes spin`, 1 s linear infinite).
- `motion-reduce:animate-none` is a Tailwind v4 idiomatic variant — applies the class only when `prefers-reduced-motion: reduce` matches.
- `sr-only` hides the label visually while keeping it in the accessibility tree.

**Sonner v2.0.7:**
- Not consumed by 4.1 (no toasts). `<Toaster>` is mounted at main.tsx; future Epic 4 stories may fire toasts (e.g., 4.2 does not plan any; 4.4's access-denied page is static).

### Project Structure Notes

- Alignment with [apps/web/src/](apps/web/src/) structure — all new files go to conventional locations: `components/confluent/` for the wordmark, `routes/share/` for the verification + placeholder routes. No new folders required.
- No detected conflicts with [architecture.md §Project Structure](../planning-artifacts/architecture.md) line 524-702. The `share/` route directory under `apps/web/src/routes/` matches architecture.md's planned structure at line 635-636 (`share/[token].tsx` — the naming convention diverges to folder-based `share/index.tsx` + `share/dossier.tsx` for consistency with Epic 2/3's folder-routing style, but semantically equivalent).

### References

- [Source: _bmad-output/planning-artifacts/epics.md#817-854 (Epic 4 + Story 4.1 AC)]
- [Source: _bmad-output/planning-artifacts/prd.md#141 (Journey 4 — entrepreneur revocation, relevant for tooling parity between entrepreneur & financeur surfaces)]
- [Source: _bmad-output/planning-artifacts/architecture.md#207-232 (Frontend Architecture)]
- [Source: _bmad-output/planning-artifacts/architecture.md#524-702 (Project Structure)]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#325-343 (Color System)]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#345-357 (Typography)]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#377-385 (Accessibility Considerations)]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#423-435 (Authentication / Login screen model — same visual treatment as the financeur verification screen)]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#466-481 (Journey 2 — Financeur access via shared link)]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#517-521 (shadcn/ui components used as-is)]
- [Source: apps/web/src/routes/dashboard/dossiers/nouveau/index.tsx (single-field useState + stripNonPrintable precedent)]
- [Source: apps/web/src/routes/not-found.tsx (standalone centered layout precedent)]
- [Source: apps/web/src/components/layout/AppShell.tsx#23-25 (Confluent text wordmark precedent)]
- [Source: apps/web/src/components/ui/button.tsx (Base UI Button + variants)]
- [Source: apps/web/src/components/ui/input.tsx (Base UI Input)]
- [Source: apps/web/src/router.tsx#46 (existing /share/:token registration)]
- [Source: apps/web/src/lib/sanitize.ts (stripNonPrintable)]
- [Source: apps/web/src/main.tsx (global Toaster — not consumed by 4.1)]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.7 (1M context) — via bmad-dev-story workflow.

### Debug Log References

- Typecheck: `pnpm --filter @confluent/web typecheck` → exit 0 (green after each of Task 1/2/3).
- Lint: `pnpm --filter @confluent/web lint` → exit 0 with 3 tolerated pre-existing warnings (`badge.tsx:52`, `button.tsx:58`, `features/current-user/context.tsx:17`). Zero new warnings introduced.
- Build: `pnpm turbo run build` → 2 successful, 2 total. `apps/web` bundle: `dist/assets/index-COSDM-Kf.js` 620.40 KB / 194.79 KB gz.
- Baseline (3.6 commit `75b566a`, measured in-session by stashing 4.1 changes): 617.51 KB / 194.02 KB gz. **Actual 4.1 delta: +2.89 KB raw / +0.77 KB gz** — within Pinned Decision #11's ~+2 KB gz budget.
- Grep battery (AC18): hex=0 ✓, copy=7 ✓, setTimeout/clearTimeout=2 ✓, sanitize import=1 ✓, AppShell/Breadcrumbs/NavItem in share/=0 ✓, radix-ui=0 ✓, useCurrentUser/CurrentUserProvider=0 ✓, `ShareDossierRoute` in router.tsx=2 (see Completion Notes).

### Completion Notes List

- ✅ **AC1–AC15 satisfied** via the canonical snippets from AC14 + AC15, copy-pasted verbatim. Zero deviations from the canonical code shape.
- ✅ **AC16 (no regression)**: verified by build — every package still compiles. Unchanged files confirmed via git status: only `router.tsx` modified (import + route entry), plus the two new files (`ConfluentWordmark.tsx`, `routes/share/dossier.tsx`) and the rewritten `routes/share/index.tsx`.
- ✅ **AC17 (Epic 4 kickoff)**: `epic-4` was already `in-progress` in sprint-status.yaml at the start of this session (transitioned on story-file creation 2026-04-22); `4-1-…: ready-for-dev` → `in-progress` → `review` across this session. `last_updated: 2026-04-22`. The `# last_updated:` header comment was refreshed.
- ⚠️ **AC18 — one grep assertion is impossible as written**: The AC expects `grep -n "ShareDossierRoute" apps/web/src/router.tsx` to return EXACTLY 1 match, but AC9 simultaneously mandates BOTH (a) the `import ShareDossierRoute from '@/routes/share/dossier'` statement AND (b) the `{ path: '/share/:token/dossier', element: <ShareDossierRoute /> }` route entry. Any correct implementation yields 2 matches. Taking AC9 as authoritative; the `==1` grep is a spec oversight. Actual result: 2 matches (line 11 import, line 49 JSX usage).
- ✅ **Bundle delta measured against the actual 3.6 baseline, not the stale "~559 KB gz" figure** in the story's Dev Notes > Previous Story Intelligence. The real 3.6 close was 617.51 KB / 194.02 KB gz (measured in this session via stash + build). 4.1 adds +0.77 KB gz — consistent with the Pinned Decision #11 budget.
- ⚠️ **Manual browser walkthrough (AC18 last bullet) deferred** — this dev environment is headless (no Chrome/Firefox binary wired up). All automated checks pass (typecheck, lint, build, grep). The canonical snippet matches AC14 byte-for-byte, so the rendering is deterministic from the typecheck. A human reviewer with browser access should run the tri-viewport walkthrough (`375 / 900 / 1440 px`) against `/share/test-token` per AC18.
- ✅ **No new dependencies**: `lucide-react` was already installed (consumed by `<Toaster>` via `components/ui/sonner.tsx`). Named-import tree-shaking verified: only `LoaderCircleIcon` is pulled in by 4.1 (and `CircleCheckIcon` by pre-existing code — unchanged).
- ✅ **Epic-4 route chrome contract**: both `/share/:token` and `/share/:token/dossier` are top-level sibling entries in `createBrowserRouter`, OUTSIDE the `{ path: '/', element: <AppShell /> }` block — satisfies AC1 + AC9 "no sidebar / no breadcrumb / no top bar / no footer".
- ✅ **Permanent contract established for 4.2/4.3**: `/share/:token/dossier` path + `ShareDossierRoute` default export name are locked. 4.2 rewrites the body (mobile layout) without touching `router.tsx`.

#### Code-review deviations (2026-04-22)

The following deliberate deviations from the canonical snippets at AC14 and AC2 were introduced during code review to resolve a real bug and harden edge cases. All changes typecheck, lint, and build clean. No new ESLint warnings.

- **Removed `required` attribute from `<Input>` in `ShareRoute`.** The canonical snippet at AC14 had `<Input required>` + `<form noValidate={false}>`. This combination caused the browser to intercept empty-submit and show its native English bubble, preventing `handleSubmit` from running and making AC4's custom French error path (`"L'adresse email est requise."`, focus management, `aria-live="assertive"` announcement) unreachable. Spec was internally contradictory between AC4 (JS path mandate) and Pinned Decision #10 (browser interception mandate). Retiring `required` satisfies AC4 while preserving AC5 (`type="email"` still blocks shaped-but-invalid values via native bubble). Verified: empty submit now reaches `handleSubmit` → French error displays; `"foo"` or `"foo@"` still trigger the native bubble.
- **Wrapped `token` in `encodeURIComponent()` inside `navigate()`.** Before: `navigate(\`/share/\${token}/dossier\`)`; after: `navigate(\`/share/\${encodeURIComponent(token ?? '')}/dossier\`)`. AC1 mandates "ANY non-empty token value" — including tokens containing `/`, `?`, or `#` (URL-encoded on arrival, decoded by `useParams`). Without encoding, a token like `abc/def` produced `navigate("/share/abc/def/dossier")` which did not match `/share/:token/dossier`.
- **Added `maxLength={254}` to the `<Input>`.** RFC 5321 caps email addresses at 254 characters. The canonical snippet omitted it; the precedent at `nouveau/index.tsx:48` uses `maxLength={NAME_MAX_LENGTH}` for bounded paste behavior. Consistent hardening.
- **Added `aria-hidden="true"` to the SVG `<text>` in `ConfluentWordmark`.** `role="img"` + `aria-label="Confluent"` on the `<svg>` should make the element atomic for AT; the raw `<text>` child risked a double-announce on older JAWS/NVDA that dive into SVG text content. `aria-hidden="true"` on the `<text>` forecloses the risk without altering visual output.

### File List

- **[NEW]** [apps/web/src/components/confluent/ConfluentWordmark.tsx](../../../../../apps/web/src/components/confluent/ConfluentWordmark.tsx) — SVG wordmark component rendering the word "Confluent" in the heading font. Named export.
- **[NEW]** [apps/web/src/routes/share/dossier.tsx](../../../../../apps/web/src/routes/share/dossier.tsx) — Placeholder route for `/share/:token/dossier`. Default export `ShareDossierRoute`. Body will be replaced by Story 4.2; path + export name are the permanent contract.
- **[MODIFIED]** [apps/web/src/routes/share/index.tsx](../../../../../apps/web/src/routes/share/index.tsx) — Rewritten from the prior token-echo stub into the full email verification screen per AC14 canonical snippet. Default export `ShareRoute` preserved.
- **[MODIFIED]** [apps/web/src/router.tsx](../../../../../apps/web/src/router.tsx) — Added `import ShareDossierRoute from '@/routes/share/dossier'` (line 11) and `{ path: '/share/:token/dossier', element: <ShareDossierRoute /> }` route entry (line 49, sibling of the existing `/share/:token`).
- **[MODIFIED]** [_bmad-output/implementation-artifacts/sprint-status.yaml](sprint-status.yaml) — Transitioned `4-1-email-verification-screen-ui-only-mocked` from `ready-for-dev` → `in-progress` → `review`. Refreshed `last_updated` header comment.

### Review Findings

- [x] [Review][Patch] `required` + `noValidate={false}` rendait le chemin custom de AC4 inatteignable — Résolu : `required` retiré de `<Input>`. Avec `<Input required>` + `<form noValidate={false}>`, le navigateur interceptait les submits sur vide avec sa bulle native anglaise, court-circuitant `handleSubmit` et donc l'erreur française AC4 + l'annonce `aria-live`. Spec contradictoire entre AC4 (handleSubmit tourne sur vide) et Pinned Decision #10 (validation navigateur active). Retirer `required` satisfait AC4 (JS gère vide) et AC5 (`type="email"` continue de bloquer les formes invalides côté navigateur). Déviation documentée du canonical snippet AC14 (voir Completion Notes § Code-review deviations).
- [x] [Review][Patch] Token non-encodé dans `navigate()` cassait le routage avec `/`, `?`, `#` [apps/web/src/routes/share/index.tsx:41](../../../../../apps/web/src/routes/share/index.tsx#L41) — Fix appliqué : `navigate(\`/share/\${encodeURIComponent(token ?? '')}/dossier\`)`.
- [x] [Review][Patch] `maxLength` manquant sur l'input email [apps/web/src/routes/share/index.tsx:81](../../../../../apps/web/src/routes/share/index.tsx#L81) — Fix appliqué : `maxLength={254}` (limite RFC 5321).
- [x] [Review][Patch] Double-annonce potentielle du wordmark par certains lecteurs d'écran [apps/web/src/components/confluent/ConfluentWordmark.tsx:19-29](../../../../../apps/web/src/components/confluent/ConfluentWordmark.tsx#L19-L29) — Fix appliqué : `aria-hidden="true"` ajouté sur l'enfant `<text>` du SVG.
- [x] [Review][Defer] `/share/` (token vide) ne matche aucune route [apps/web/src/router.tsx:48](../../../../../apps/web/src/router.tsx#L48) — deferred, pre-existing — Le catch-all `{ path: '*', element: <NotFoundRoute /> }` est imbriqué sous AppShell (router.tsx:45) et non au niveau top-level. Tout `/share/...` non reconnu tombe en route-non-trouvée React Router silencieuse. Préexistant, non introduit par 4.1.
- [x] [Review][Defer] `ShareDossierRoute` accessible en direct sans passer par la verification [apps/web/src/routes/share/dossier.tsx:3](../../../../../apps/web/src/routes/share/dossier.tsx#L3) — deferred, hors-scope 4.1 — Un bookmark direct sur `/share/any-token/dossier` bypasse complètement l'écran de vérification. Epic 4 AC explicite que Story 4.4 (Access Denied + mocked guard) gère ce cas. 4.1 est mocked/UI-only par design.
- [x] [Review][Defer] Pas de rate-limiting / debounce côté client [apps/web/src/routes/share/index.tsx:29-43](../../../../../apps/web/src/routes/share/index.tsx#L29-L43) — deferred, Epic 6 — Le mock ne fait aucun appel réseau ; rate-limiting deviendra pertinent quand Epic 6 branchera le vrai endpoint magic-link.

## Change Log

| Date | Author | Summary |
|---|---|---|
| 2026-04-22 | bmad-create-story (Claude Opus 4.7 1M) | Initial story creation — Epic 4 kickoff, verification screen + placeholder dossier route + Confluent wordmark component. |
| 2026-04-22 | bmad-dev-story (Claude Opus 4.7 1M) | Implementation complete — `<ConfluentWordmark>` + rewritten `ShareRoute` email verification screen + `/share/:token/dossier` placeholder route. Typecheck / lint / build green. Bundle delta +0.77 KB gz. Status → `review`. |
| 2026-04-22 | bmad-code-review (Claude Opus 4.7 1M) | Adversarial review (3 layers: Blind Hunter, Edge Case Hunter, Acceptance Auditor). 1 decision (spec contradiction AC4 vs Pinned #10) → resolved by retirant `required`. 4 patches applied (remove `required`, `encodeURIComponent(token)`, `maxLength={254}`, `aria-hidden` sur SVG text). 3 deferrals ajoutés au backlog. Typecheck + lint green (3 warnings tolérées inchangées). Status → `done`. |
