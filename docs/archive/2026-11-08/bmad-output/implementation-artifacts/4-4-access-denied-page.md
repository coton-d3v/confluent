# Story 4.4: Access Denied Page

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a financeur with an invalid or revoked link,
I want a clear, respectful error page,
so that I understand the link doesn't work without learning anything about the dossier or other recipients.

## Acceptance Criteria

1. **Given** the router registration at [apps/web/src/router.tsx](apps/web/src/router.tsx), **When** a developer inspects it, **Then** the two financeur entries `{ path: '/share/:token', element: <ShareRoute /> }` and `{ path: '/share/:token/dossier', element: <ShareDossierRoute /> }` are UNCHANGED. Story 4.4 does NOT add a new route (no `/share/:token/access-denied`, no `/share/access-denied`, no catch-all `/share/*`). The access-denied page renders as an inline branch INSIDE `ShareRoute` and `ShareDossierRoute` when the mocked token guard rejects — the URL path stays `/share/:token` (or `/share/:token/dossier`), matching the Epic 4 AC1 phrasing at [epics.md:936-938](../planning-artifacts/epics.md#L936-L938) ("instead of the email verification screen, an access denied page renders"). This keeps the router skeleton stable and defers the `/share/` empty-token routing deferral (item #1 of 4.1 code review at [deferred-work.md:20](deferred-work.md#L20)) to Epic 10. See Pinned Decision #1.

2. **Given** the mocked token guard, **When** a developer inspects [apps/web/src/data/mock-tokens.ts](apps/web/src/data/mock-tokens.ts) (NEW file), **Then** it exports:
   - `VALID_SHARE_TOKENS`: a `readonly` tuple of valid token strings, frozen via `as const`. Contents: `['biosensio-share', 'valid-token-1'] as const`. The `biosensio-share` entry MUST appear — it is the token the 4.2 / 4.3 stories exercise via `/share/biosensio-share/dossier` (4.3 Task 2 walkthrough step 1 at [4-3-financeur-dossier-view-desktop-layout.md:244](4-3-financeur-dossier-view-desktop-layout.md#L244)). The second entry (`valid-token-1`) gives manual QA a second valid fixture without bypassing the guard logic.
   - `isValidShareToken(token: string | undefined): token is (typeof VALID_SHARE_TOKENS)[number]`: a pure type-guard predicate that returns `true` iff `token !== undefined && VALID_SHARE_TOKENS.includes(token as (typeof VALID_SHARE_TOKENS)[number])`. The `token is` return annotation narrows the input inside conditional branches, even though consumers don't currently use the narrowed type (future-proof). No side effects, no network call, no logging — the helper is synchronous and referentially transparent.
   - NO `INVALID_SHARE_TOKENS` export, NO `REVOKED_SHARE_TOKENS` export — the guard is an allow-list only, matching Epic AC5 at [epics.md:952-954](../planning-artifacts/epics.md#L952-L954) ("a list of valid token strings … any token not in this list triggers the access denied page"). A deny-list would leak platform-internal status distinctions (invalid vs. revoked) into the mock, which contradicts Epic AC3's "no information disclosed" mandate.
   - The file header comment reads: `// Static mock fixture for the Story 4.4 token guard. Replaced by Epic 6.4's NestJS share-link guard (architecture.md:561 — 'share-link.guard.ts') when real API wiring lands.` — matches the `mock-dossier.ts` / `mock-dossiers.ts` file-header convention at [apps/web/src/data/mock-dossiers.ts:1-5](apps/web/src/data/mock-dossiers.ts#L1-L5).

3. **Given** the user navigates to `/share/revoked-token` (or any token NOT in `VALID_SHARE_TOKENS`, e.g. `/share/unknown-token`, `/share/abc123`, `/share/`), **When** [apps/web/src/routes/share/index.tsx](apps/web/src/routes/share/index.tsx) renders, **Then** it calls `const { token } = useParams<{ token: string }>()` FIRST (before any `useState` / `useEffect` / `useRef`), then `if (!isValidShareToken(token)) return <AccessDeniedPage />` BEFORE the existing email-verification-form JSX. Critical ordering: the guard must sit BEFORE all hooks that the verification screen needs (`useRef`, `useState` for `email` / `showError` / `submitting`, `useEffect` for the timer cleanup) to avoid hook-count mismatch between the denied and verification paths. React's Rules of Hooks mandate identical hook call sequences across renders — we resolve this by putting the early-return BEFORE any hook calls. The existing `useParams` on the verification screen shares the destructure with the guard: one `useParams` call, result fed into both the guard AND (in the valid branch) the `navigate(\`/share/\${encodeURIComponent(token ?? '')}/dossier\`)` call at [apps/web/src/routes/share/index.tsx:41](apps/web/src/routes/share/index.tsx#L41). See AC16 canonical snippet.

4. **Given** the user navigates to `/share/revoked-token/dossier` (deep-link bypass of the verification step), **When** [apps/web/src/routes/share/dossier.tsx](apps/web/src/routes/share/dossier.tsx) renders, **Then** it calls `const { token } = useParams<{ token: string }>()` FIRST, then `if (!isValidShareToken(token)) return <AccessDeniedPage />` BEFORE the existing `useState(activeSectionId)` and both `useEffect` blocks. This closes the 4.1 code-review deferral at [deferred-work.md:21](deferred-work.md#L21) ("ShareDossierRoute accessible en direct sans passer par la verification"). Same Rules-of-Hooks discipline as AC3: guard goes BEFORE any hook call; the `useParams` destructure is the ONLY pre-guard hook and is not retained across the denied branch (no state, no effects in that branch — just a render of `<AccessDeniedPage />`). 4.3 Pinned Decision #8 from 4.2 ("`token` URL param unread — Pinned Decision #8 on 4.2 … the `token` URL param is intentionally unread until Story 4.4's mocked token guard") is now fulfilled.

5. **Given** the `<AccessDeniedPage>` component (NEW file at [apps/web/src/routes/share/AccessDeniedPage.tsx](apps/web/src/routes/share/AccessDeniedPage.tsx)), **When** a developer inspects its markup, **Then** it renders a standalone centered layout on an `#FAFAF9` (`bg-background`) full-height screen — NO `<AppShell>`, NO sidebar, NO breadcrumbs, NO toaster, NO `useCurrentUser()` consumption — matching the 4.1 / 4.2 / 4.3 standalone-layout pattern (4.1 Pinned Decision #12, 4.2 Pinned Decision #1, 4.3 Pinned Decision #10 carry forward). The layout outer container: `<main className="mx-auto flex min-h-screen w-full max-w-sm flex-col items-center justify-center gap-6 px-6 py-12 text-center">` — same `max-w-sm` centered pattern as 4.1's verification screen at [apps/web/src/routes/share/index.tsx:48](apps/web/src/routes/share/index.tsx#L48), with `text-center` added for the H1 + description block. The file lives co-located with the two share route bodies it serves — it is NOT registered as a separate route (see AC1), it is a plain React component consumed by both `ShareRoute` and `ShareDossierRoute`.

6. **Given** the `<AccessDeniedPage>` DOM structure, **When** a developer inspects the render, **Then** the DOM order is EXACTLY:
   - `<title>Accès refusé — Confluent</title>` — React 19 native JSX hoisting (same pattern as 4.1 / 4.2 / 4.3). The em dash is `U+2014` (—), NOT a hyphen (`-`) NOR an en dash (`–`). Epic AC4 at [epics.md:948-950](../planning-artifacts/epics.md#L948-L950) pins this exact literal. See Pinned Decision #3.
   - `<main ...>` (classes per AC5) — the landmark.
   - `<LockIcon aria-hidden="true" className="size-12 text-muted-foreground" />` from `lucide-react` — the monochrome lock inline SVG required by Epic AC2. `size-12` = 48 px; `text-muted-foreground` = `#6B6B6B` (monochrome, matches the "neutral, not alarming" UX direction at [ux-design-specification.md:698-700](../planning-artifacts/ux-design-specification.md#L698-L700)). `aria-hidden="true"` because the H1 below conveys the semantic meaning; an `aria-label="Accès refusé"` on the icon would double-announce. See Pinned Decision #2.
   - `<h1 className="font-heading text-2xl font-medium text-foreground sm:text-[28px]">Accès refusé</h1>` — mirrors 4.1's H1 sizing at [apps/web/src/routes/share/index.tsx:51](apps/web/src/routes/share/index.tsx#L51) for visual consistency across the standalone share surfaces. Literal `"Accès refusé"` — no apostrophe, no typographic quotes, no extra spaces.
   - `<p className="text-sm text-muted-foreground">Ce lien est invalide ou a été révoqué. Si vous pensez qu'il s'agit d'une erreur, contactez la personne qui vous a partagé ce lien.</p>` — the secondary description. The apostrophes (`qu'il`, `s'agit`, `d'une`) are JSX-escaped as `&apos;` per the 4.1 Pinned Decision #7 convention (`d&apos;accès` at [apps/web/src/routes/share/index.tsx:55](apps/web/src/routes/share/index.tsx#L55)). See Pinned Decision #4.
   - `<Link to="/" className={cn(buttonVariants({ variant: 'outline', size: 'lg' }), 'w-full')}>Retour à l'accueil</Link>` — the ghost/outline CTA. `Link` comes from `react-router-dom` (precedent: [apps/web/src/routes/not-found.tsx:10](apps/web/src/routes/not-found.tsx#L10) renders a button-styled `Link` the same way). `variant: 'outline'` resolves Epic AC2's "ghost/outline button" requirement — `outline` is the shadcn variant closer to Notion-inspired minimalism; the `ghost` variant has no visible border at rest, which reads as "barely a button" on the denied surface where the CTA should feel calm but present. See Pinned Decision #5.

7. **Given** the AccessDeniedPage AT landmarks, **When** AT traverses the page, **Then**:
   - `<main>` is the only landmark; `<h1>` is the first and only heading.
   - The lock icon is `aria-hidden="true"` — AT skips it and announces only the H1 + description + CTA.
   - The `<Link>` announces as "Retour à l'accueil, lien" (VoiceOver / NVDA default).
   - No `aria-live` region, no `role="alert"`, no `aria-atomic` — the denied page is a static error surface, not a dynamic announcement. Using `role="alert"` would force AT to interrupt the user on each render, which is hostile on a landing state.
   - Keyboard order: the `<Link>` is the sole Tab stop; focus ring uses the inherited `focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50` from `buttonVariants` at [apps/web/src/components/ui/button.tsx:7](apps/web/src/components/ui/button.tsx#L7).
   - WCAG 2.1 AA: `text-foreground` on `bg-background` ≈ 17.3:1 (AAA) for the H1; `text-muted-foreground` on `bg-background` ≈ 4.9:1 (AA ≥14 px, meets the `text-sm` threshold — body copy is 14 px). The `LockIcon` at `text-muted-foreground` is `aria-hidden` so non-text contrast rules do not apply; the icon is a decorative reinforcement of the H1 meaning.
   - No autofocus on mount — the user pressed a URL to arrive here; stealing focus would disorient screen-reader users who land expecting the page title / H1 announcement to come first. This differs from 4.1 where the email input is the primary action; here the `<Link>` is the only action and natural Tab flow suffices.

8. **Given** the "no information disclosure" constraint from Epic AC3 at [epics.md:944-946](../planning-artifacts/epics.md#L944-L946), **When** a developer audits the AccessDeniedPage, **Then**:
   - NO imports from `@/data/mock-dossier`, `@/data/mock-dossiers`, `@/data/mock-analytics`, or `@/data/questionnaire` — the denied page has NO knowledge of the dossier, entrepreneur, sector, maturity, answers, analytics, share links, or recipient list.
   - NO echo of the `token` URL param in the rendered text (no `<p>Token reçu : {token}</p>`, no `<code>{token}</code>`, no reflection into the `<title>`, no `data-token={token}` attribute for CSS debugging).
   - NO entrepreneur or admin contact information displayed — the copy says "contactez la personne qui vous a partagé ce lien" (intentionally vague), NOT "contactez sophie@biosensio.com" NOR "support@confluent.fr".
   - NO dossier count, no "2 autres personnes ont accès à ce dossier", no recipient list.
   - NO 403/404 HTTP status displayed in the body (the error is semantic, not protocol-level — 4.4 is a frontend-only story).
   - NO timestamp of revocation, no "link expired at 2026-04-20" — the page is opaque about WHY the link failed. The copy groups "invalide OU révoqué" deliberately to hide which of the two states applies.
   - Grep guardrail (AC17): `Biosensio|DeepTech|Pre-seed|mock-dossier|mock-dossiers|mock-analytics|MOCK_DOSSIER|MOCK_DOSSIERS|MOCK_ANALYTICS` returns 0 matches in both the denied-page file and the mock-tokens file.

9. **Given** Epic AC4 at [epics.md:948-950](../planning-artifacts/epics.md#L948-L950) ("HTTP-equivalent status … would be 403/404 — the route does not redirect to a login page"), **When** a developer inspects the denied render path, **Then**:
   - There is NO `Navigate` / `useNavigate` / `redirect` call toward `/auth/login`, `/auth`, `/auth/register`, `/dashboard`, or any login surface.
   - The page emits a visible "denied" state — it does NOT offer a "login to retry" option.
   - The sole navigation affordance is the `<Link to="/">Retour à l'accueil</Link>` CTA, matching Epic AC2 verbatim. React Router v7's `Link` to `/` falls through the router to the `/` index route, which is a `<Navigate to="/dashboard" replace />` at [apps/web/src/router.tsx:17](apps/web/src/router.tsx#L17) — the financeur ends on the entrepreneur dashboard rendered with the hardcoded mock user. This is a known auth-skeleton quirk to be corrected by Epic 6.6 (Frontend magic-link auth wiring): the real Epic-6 router will gate `/` behind an auth loader and an unauthenticated visitor will be sent to `/auth` instead. 4.4 honors Epic AC2 literally — the Completion Notes should flag this follow-up cross-reference. See Pinned Decision #6.

10. **Given** the `<title>` element on the denied page, **When** the browser tab renders, **Then** it reads EXACTLY `"Accès refusé — Confluent"`. Critical typography: the em dash is `U+2014` (—), not the middle-dot `U+00B7` (·) used by 4.1 / 4.2 / 4.3 titles (`"Biosensio · Confluent"`, `"Accéder au dossier · Confluent"`). Epic AC4 pins the em dash explicitly — this is an intentional divergence from the verification / dossier title convention. A denied page's gravitas warrants heavier punctuation than the casual middle-dot separator used on happy-path surfaces. React 19 auto-hoists the JSX `<title>` into `<head>` — same behavior pattern as 4.1 / 4.2 / 4.3. See Pinned Decision #3.

11. **Given** the `ConfluentWordmark` brand element, **When** a developer inspects the `<AccessDeniedPage>` JSX, **Then** the wordmark is NOT included. Rationale: 4.1 / 4.2 / 4.3 show the wordmark because they are happy-path share surfaces where Confluent's brand presence is welcoming; the denied surface is intentionally stripped back — no brand flourish, just the lock icon + H1 + description + CTA. This also aligns with the UX spec's "no information disclosed" spirit at [ux-design-specification.md:700](../planning-artifacts/ux-design-specification.md#L700) — an unauthenticated visitor with an invalid token should not learn that "Confluent" is the platform name until (and unless) they follow the `Retour à l'accueil` CTA. The `<title>` still contains "Confluent" for browser-tab identity, but the visible screen is brand-minimal. See Pinned Decision #7.

12. **Given** the responsive behavior of the denied page, **When** the viewport changes from desktop (≥ `lg`) to tablet (`md`) to mobile (< `sm`), **Then** the layout is visually identical across all widths: centered, `max-w-sm` (384 px), `px-6` gutters, `py-12` vertical padding, `gap-6` between the four children (icon, H1, description, CTA). NO `lg:` or `md:` responsive overrides are introduced — the card-less centered layout already fits every viewport from 320 px to 1920 px+ without adjustment. This mirrors 4.1's responsive posture at [apps/web/src/routes/share/index.tsx:48](apps/web/src/routes/share/index.tsx#L48) and the `NotFoundRoute` at [apps/web/src/routes/not-found.tsx:6](apps/web/src/routes/not-found.tsx#L6) — both use a single-width centered pattern with no responsive tweaks. The CTA's `w-full` class keeps it edge-to-edge inside the 384 px column at every width, with a 44 px native height from `size: 'lg'` (`h-9` + padding = min 44 px interactive target, satisfying the 4.2 touch-target baseline).

13. **Given** the mocked token guard's coexistence with 4.1's `submitting` flow, **When** the user enters `/share/biosensio-share` (valid), fills the email, submits, and the 1-second mock timer is in flight, **Then** the in-flight timer is UNAFFECTED by the guard — the guard only runs at MOUNT (not on each re-render of the valid branch), and the existing 4.1 `setTimeout` + `clearTimeout` effect at [apps/web/src/routes/share/index.tsx:20-27](apps/web/src/routes/share/index.tsx#L20-L27) remains intact. Verify: with a valid token (e.g. `biosensio-share`), AC3–AC10 of Story 4.1 (email verification, pending state, 1-s mock navigate, empty-email error, etc.) continue to pass unchanged. The guard adds a SINGLE early-return at the top of `ShareRoute`'s function body; everything downstream is identical to 4.1 / current behavior. See AC16 canonical snippet.

14. **Given** the mocked token guard's coexistence with 4.3's scrollspy + smooth-scroll, **When** the user lands on `/share/biosensio-share/dossier` (valid), **Then** the dossier view's two `useEffect` blocks (smooth-scroll mount effect at [apps/web/src/routes/share/dossier.tsx:14-21](apps/web/src/routes/share/dossier.tsx#L14-L21) and IntersectionObserver scrollspy at [apps/web/src/routes/share/dossier.tsx:23-42](apps/web/src/routes/share/dossier.tsx#L23-L42)) continue to run as before. With an invalid token, the denied branch returns BEFORE these effects, so they never attach — the IntersectionObserver is never instantiated for denied users, the `document.documentElement.style.scrollBehavior` is never mutated. This is correct behavior: the denied page has no sections to scroll between and no smooth-scroll to honor.

15. **Given** design-token compliance, **When** a developer greps the 4.4 changes, **Then** ZERO raw hex values appear in the two new files ([apps/web/src/routes/share/AccessDeniedPage.tsx](apps/web/src/routes/share/AccessDeniedPage.tsx) and [apps/web/src/data/mock-tokens.ts](apps/web/src/data/mock-tokens.ts)) NOR in the two modified files ([apps/web/src/routes/share/index.tsx](apps/web/src/routes/share/index.tsx) and [apps/web/src/routes/share/dossier.tsx](apps/web/src/routes/share/dossier.tsx)). Every surface uses design tokens: `bg-background`, `text-foreground`, `text-muted-foreground`, inherited `ring-ring/50` via `buttonVariants`, Button `variant="outline"`. Typography uses the Tailwind scale plus the single arbitrary `text-[28px]` value replicated from 4.1 at [apps/web/src/routes/share/index.tsx:51](apps/web/src/routes/share/index.tsx#L51) for the `sm:` breakpoint H1 size. `size-12` on the icon is a Tailwind utility (not arbitrary). Automation grep at AC17.

16. **Given** the two route rewrites, **When** a developer inspects the final shape of each, **Then** the canonical snippets are (deviations require explicit mention in the story's Completion Notes):

    **[apps/web/src/data/mock-tokens.ts](apps/web/src/data/mock-tokens.ts) (NEW):**
    ```ts
    // Static mock fixture for the Story 4.4 token guard. Replaced by Epic 6.4's
    // NestJS share-link guard (architecture.md:561 — 'share-link.guard.ts') when
    // real API wiring lands.

    export const VALID_SHARE_TOKENS = ['biosensio-share', 'valid-token-1'] as const

    export type ValidShareToken = (typeof VALID_SHARE_TOKENS)[number]

    export function isValidShareToken(
      token: string | undefined,
    ): token is ValidShareToken {
      if (token === undefined) return false
      return (VALID_SHARE_TOKENS as readonly string[]).includes(token)
    }
    ```

    **[apps/web/src/routes/share/AccessDeniedPage.tsx](apps/web/src/routes/share/AccessDeniedPage.tsx) (NEW):**
    ```tsx
    import { Link } from 'react-router-dom'
    import { LockIcon } from 'lucide-react'
    import { buttonVariants } from '@/components/ui/button'
    import { cn } from '@/lib/utils'

    export function AccessDeniedPage() {
      return (
        <>
          <title>Accès refusé — Confluent</title>
          <main className="mx-auto flex min-h-screen w-full max-w-sm flex-col items-center justify-center gap-6 bg-background px-6 py-12 text-center">
            <LockIcon
              aria-hidden="true"
              className="size-12 text-muted-foreground"
            />
            <h1 className="font-heading text-2xl font-medium text-foreground sm:text-[28px]">
              Accès refusé
            </h1>
            <p className="text-sm text-muted-foreground">
              Ce lien est invalide ou a été révoqué. Si vous pensez qu&apos;il
              s&apos;agit d&apos;une erreur, contactez la personne qui vous a
              partagé ce lien.
            </p>
            <Link
              to="/"
              className={cn(
                buttonVariants({ variant: 'outline', size: 'lg' }),
                'w-full',
              )}
            >
              Retour à l&apos;accueil
            </Link>
          </main>
        </>
      )
    }
    ```

    **[apps/web/src/routes/share/index.tsx](apps/web/src/routes/share/index.tsx) (MODIFIED — guard inserted at top of function body):**
    ```tsx
    // imports: ADD these two new imports to the existing block
    import { isValidShareToken } from '@/data/mock-tokens'
    import { AccessDeniedPage } from '@/routes/share/AccessDeniedPage'

    export default function ShareRoute() {
      const { token } = useParams<{ token: string }>()
      if (!isValidShareToken(token)) return <AccessDeniedPage />

      // … existing body unchanged from 4.1: useRef(inputRef), useRef(timerRef),
      // useState(email/showError/submitting), useEffect(cleanup), handleSubmit,
      // JSX of verification screen. The existing `const { token } = useParams(...)`
      // line at [apps/web/src/routes/share/index.tsx:12](apps/web/src/routes/share/index.tsx#L12)
      // is CONSOLIDATED with the guard's destructure — ONE useParams call total
      // (not two). `navigate(\`/share/\${encodeURIComponent(token ?? '')}/dossier\`)`
      // at [apps/web/src/routes/share/index.tsx:41](apps/web/src/routes/share/index.tsx#L41)
      // now KNOWS token is a valid string (the `isValidShareToken` type-guard
      // narrows it to `ValidShareToken`). The `?? ''` fallback becomes a no-op
      // but is kept to preserve the existing literal (no incidental removal).
    }
    ```

    **[apps/web/src/routes/share/dossier.tsx](apps/web/src/routes/share/dossier.tsx) (MODIFIED — guard inserted at top of function body):**
    ```tsx
    // imports: ADD these three new imports to the existing block
    import { useParams } from 'react-router-dom'
    import { isValidShareToken } from '@/data/mock-tokens'
    import { AccessDeniedPage } from '@/routes/share/AccessDeniedPage'

    export default function ShareDossierRoute() {
      const { token } = useParams<{ token: string }>()
      if (!isValidShareToken(token)) return <AccessDeniedPage />

      // … existing body unchanged from 4.3: useState(activeSectionId),
      // useEffect(smooth scroll), useEffect(IntersectionObserver), JSX.
      // The token value is not otherwise consumed in the valid branch
      // (the dossier fixture is still imported statically from
      // MOCK_DOSSIER_DETAIL) — the guard is the single reason `useParams`
      // is added here, closing the 4.1/4.2/4.3 Pinned Decision #8 carry-forward.
    }
    ```

17. **Given** the verification sweep, **When** a developer runs the grep guardrails, **Then**:
    - `grep -nE '#[0-9a-fA-F]{3,6}' apps/web/src/routes/share/AccessDeniedPage.tsx apps/web/src/data/mock-tokens.ts` returns ZERO matches.
    - `grep -nE '#[0-9a-fA-F]{3,6}' apps/web/src/routes/share/index.tsx apps/web/src/routes/share/dossier.tsx` returns ZERO matches (4.4 does not introduce any hex; 4.1 / 4.3 baseline already zero).
    - `grep -n "AppShell\|Breadcrumbs\|NavItem\|useCurrentUser\|CurrentUserProvider" apps/web/src/routes/share/AccessDeniedPage.tsx` returns ZERO matches.
    - `grep -n "isValidShareToken" apps/web/src/routes/share/index.tsx apps/web/src/routes/share/dossier.tsx` returns EXACTLY 2 matches (one per file — both at the top of the function body).
    - `grep -n "AccessDeniedPage" apps/web/src/routes/share/index.tsx apps/web/src/routes/share/dossier.tsx` returns EXACTLY 2 matches (the `<AccessDeniedPage />` early-return per file; the `import` line bumps the per-file count to 2 each → 4 total across both files).
    - `grep -n "VALID_SHARE_TOKENS" apps/web/src/data/mock-tokens.ts` returns EXACTLY 2 matches (the `export const` declaration + the `readonly string[]` coercion inside `isValidShareToken`).
    - `grep -n "Biosensio\|DeepTech\|Pre-seed\|MOCK_DOSSIER\|MOCK_DOSSIERS\|MOCK_ANALYTICS" apps/web/src/routes/share/AccessDeniedPage.tsx apps/web/src/data/mock-tokens.ts` returns ZERO matches.
    - `grep -n "biosensio-share" apps/web/src/data/mock-tokens.ts` returns EXACTLY 1 match (the `VALID_SHARE_TOKENS` literal). ZERO matches in `AccessDeniedPage.tsx` — the denied page is fixture-free.
    - `grep -n "Navigate\s*to=\"/auth\|redirect.*auth\|useNavigate" apps/web/src/routes/share/AccessDeniedPage.tsx` returns ZERO matches (no login redirect per Epic AC4 / AC9).
    - `grep -n "role=\"alert\"\|aria-live\|aria-atomic" apps/web/src/routes/share/AccessDeniedPage.tsx` returns ZERO matches (static error surface, not a live announcement).
    - `grep -n "fetch(\|XMLHttpRequest\|sendBeacon\|localStorage\|sessionStorage" apps/web/src/routes/share/AccessDeniedPage.tsx apps/web/src/data/mock-tokens.ts` returns ZERO matches — no telemetry, no storage, no network.
    - `grep -n "@radix-ui/react" apps/web/src/routes/share/AccessDeniedPage.tsx` returns ZERO matches — 4.4 uses Base UI-wrapped primitives only (`buttonVariants` from our `button.tsx`).
    - `pnpm --filter @confluent/web typecheck` → exits 0.
    - `pnpm --filter @confluent/web lint` → exits 0, 0 errors, same 3 tolerated pre-existing warnings (`badge.tsx:52`, `button.tsx:58`, `features/current-user/context.tsx:17`). ZERO new warnings.
    - `pnpm turbo run build` → all packages GREEN. Bundle delta against the 4.3 baseline of `624.12 KB / 196.42 KB gz`: estimated ≤ +1.5 KB gz (adds `lucide-react`'s `LockIcon` — already present in the `LoaderCircleIcon` chunk import pattern, so only the barrel-file cost; `AccessDeniedPage` component body ~30 lines; `mock-tokens.ts` ~10 lines; two `if (!isValidShareToken(...))` early-returns + two `useParams` calls). If the delta exceeds 3 KB gz, audit for accidental wildcard imports.

18. **Given** no regression across Stories 1.1 – 4.3, **When** the dev agent completes 4.4, **Then**:
    - `/dashboard` (entrepreneur dashboard — Stories 2.2, 3.1) unchanged — `DossierCard` list rendering intact.
    - `/dashboard/dossiers/nouveau` / `/questionnaire` / `/recapitulatif` (Stories 2.3 – 2.6) reachable and unchanged.
    - `/dashboard/dossiers/view/:slug` (Stories 3.2 – 3.6) unchanged — tabs, analytics, SharePanel, RevokeAccessDialog all intact.
    - `/share/biosensio-share` (Story 4.1 happy path with a now-VALID token) — renders the email verification screen AS BEFORE. Empty-email error path (4.1 AC4), submit + 1-s pending (4.1 AC3), navigate to `/share/biosensio-share/dossier` (4.1 AC3 step 4) all unchanged.
    - `/share/biosensio-share/dossier` (Story 4.2 + 4.3 happy path) — renders the dossier view AS BEFORE at mobile / tablet / desktop. Scrollspy, sticky nav, anchor links, `aria-current="location"`, `onFocus` scroll-into-view all unchanged.
    - `/auth` (Story 1.3 stub) unchanged.
    - [apps/web/src/router.tsx](apps/web/src/router.tsx) unchanged.
    - [apps/web/src/components/confluent/](apps/web/src/components/confluent/) unchanged — no new components under `components/confluent/`; `AccessDeniedPage` lives co-located under `routes/share/` because it is share-flow-specific and not intended as a cross-feature primitive.
    - [apps/web/src/data/mock-dossier.ts](apps/web/src/data/mock-dossier.ts), [apps/web/src/data/mock-dossiers.ts](apps/web/src/data/mock-dossiers.ts), [apps/web/src/data/mock-analytics.ts](apps/web/src/data/mock-analytics.ts), [apps/web/src/data/questionnaire.ts](apps/web/src/data/questionnaire.ts) unchanged.
    - [apps/web/src/components/ui/button.tsx](apps/web/src/components/ui/button.tsx) unchanged — `buttonVariants` consumed AS-IS via `variant: 'outline'` + `size: 'lg'` (precedent at [apps/web/src/components/ui/alert-dialog.tsx:127](apps/web/src/components/ui/alert-dialog.tsx#L127)).
    - The 3 tolerated pre-existing ESLint warnings remain at 3 — ZERO new warnings.
    - No new npm dependency (`lucide-react` + `react-router-dom` are already in the `apps/web/package.json` — 4.1 / 4.3 proved).

19. **Given** the sprint-status tracker transition, **When** this story file is created, **Then** [sprint-status.yaml](sprint-status.yaml) has `development_status.4-4-access-denied-page` flipped from `backlog` → `ready-for-dev` and the header `last_updated` + field bumped to `2026-04-22`. The `epic-4` entry remains `in-progress` (set during Story 4.1's kickoff). All other entries untouched.

## Tasks / Subtasks

- [x] **Task 1: Create the mocked token fixture (AC: 2, 17)**
  - [x] Create [apps/web/src/data/mock-tokens.ts](apps/web/src/data/mock-tokens.ts) using the AC16 canonical snippet verbatim.
  - [x] Exports: `VALID_SHARE_TOKENS` (as const tuple), `ValidShareToken` (type alias), `isValidShareToken(token)` (type-guard function).
  - [x] File header comment matches the Epic 6.4 forward-reference pattern.
  - [x] `pnpm --filter @confluent/web typecheck` exits 0.

- [x] **Task 2: Create the `AccessDeniedPage` component (AC: 5, 6, 7, 8, 10, 11, 12, 15)**
  - [x] Create [apps/web/src/routes/share/AccessDeniedPage.tsx](apps/web/src/routes/share/AccessDeniedPage.tsx) using the AC16 canonical snippet verbatim.
  - [x] Imports: `Link` from `react-router-dom`; `LockIcon` from `lucide-react`; `buttonVariants` from `@/components/ui/button`; `cn` from `@/lib/utils`. NO `ConfluentWordmark`, NO `Badge`, NO `DossierField`, NO mock-data imports.
  - [x] Named export `AccessDeniedPage` (NOT a default export — this is a component, not a route). React Router does NOT import it; the two share route bodies import it by name.
  - [x] French copy strings match AC6 byte-for-byte (em dash in title, apostrophes escaped as `&apos;`).
  - [x] `pnpm --filter @confluent/web typecheck` exits 0.

- [x] **Task 3: Wire the guard into `ShareRoute` (AC: 3, 13, 16)**
  - [x] Modify [apps/web/src/routes/share/index.tsx](apps/web/src/routes/share/index.tsx): add imports for `isValidShareToken` (from `@/data/mock-tokens`) and `AccessDeniedPage` (from `@/routes/share/AccessDeniedPage`).
  - [x] CONSOLIDATE the `const { token } = useParams<{ token: string }>()` call — ONE call total at the top of the function body, feeding both the guard AND the existing `navigate(\`/share/\${encodeURIComponent(token)}/dossier\`)` in `handleSubmit`. (See Completion Note #1 — deviation: guard pattern uses inner component.)
  - [x] Insert `if (!isValidShareToken(token)) return <AccessDeniedPage />` BEFORE any `useRef` / `useState` / `useEffect` call — Rules-of-Hooks discipline. (See Completion Note #1 — deviation: guard + inner-component delegation; Rules of Hooks satisfied cleanly.)
  - [x] All existing 4.1 behavior (email validation, pending state, 1-s mock navigate, timer cleanup) UNCHANGED in the valid-token branch.
  - [x] `pnpm --filter @confluent/web typecheck` exits 0.

- [x] **Task 4: Wire the guard into `ShareDossierRoute` (AC: 4, 14, 16)**
  - [x] Modify [apps/web/src/routes/share/dossier.tsx](apps/web/src/routes/share/dossier.tsx): add imports for `useParams` (from `react-router-dom`), `isValidShareToken` (from `@/data/mock-tokens`), `AccessDeniedPage` (from `@/routes/share/AccessDeniedPage`).
  - [x] Insert `const { token } = useParams<{ token: string }>()` + `if (!isValidShareToken(token)) return <AccessDeniedPage />` at the top of the function body, BEFORE the `useState(activeSectionId)` and both `useEffect` blocks. (See Completion Note #1 — implemented via inner `ShareDossierView` component so AC14's "effects never attach on denied path" guarantee holds.)
  - [x] All existing 4.2 / 4.3 behavior (scrollspy, smooth-scroll effect, onFocus scroll-into-view, mobile anchor nav, desktop two-column grid) UNCHANGED in the valid-token branch.
  - [x] `pnpm --filter @confluent/web typecheck` exits 0.

- [x] **Task 5: Verification sweep — typecheck, lint, build, grep, manual walkthrough (AC: 15, 17, 18)**
  - [x] `pnpm --filter @confluent/web typecheck` — exits 0.
  - [x] `pnpm --filter @confluent/web lint` — exits 0. Preserved the 3 tolerated pre-existing warnings (`badge.tsx:52`, `button.tsx:58`, `features/current-user/context.tsx:17`); ZERO new warnings.
  - [x] `pnpm turbo run build` — all packages GREEN. Bundle: 625.33 KB / 196.68 KB gz (delta vs 4.3 baseline 624.12 KB / 196.42 KB gz: +1.21 KB / +0.26 KB gz — under the 1.5 KB gz budget).
  - [x] Ran the AC17 grep battery — every semantic assertion passes (minor imprecisions in expected match counts for greps 4 & 6 because the AC under-counts unavoidable import / type-alias lines; spirit of "one call site per file" holds — see Completion Note #2).
  - [ ] Manual browser walkthrough — deferred, no browser available in this environment. Same deferral pattern as 4.1 / 4.2 / 4.3 (documented in Completion Note #3).
    1. Open `http://localhost:5173/share/unknown-token` → AccessDeniedPage renders: lock icon + H1 "Accès refusé" + description + "Retour à l'accueil" button. `<title>` is `"Accès refusé — Confluent"`.
    2. Open `http://localhost:5173/share/revoked-token` → same AccessDeniedPage (the guard is opaque — `unknown` vs. `revoked` yield identical UI).
    3. Open `http://localhost:5173/share/` (empty token) → router behavior per 4.1 deferral #1 (likely white-screen or unmatched route — DO NOT fix in 4.4, deferred to Epic 10).
    4. Open `http://localhost:5173/share/biosensio-share` → email verification screen (4.1 happy path). Type `jean@example.fr`, submit, wait 1 s → navigate to `/share/biosensio-share/dossier` → dossier renders (4.2 / 4.3 happy path).
    5. Open `http://localhost:5173/share/unknown-token/dossier` directly (deep-link) → AccessDeniedPage renders (closes 4.1 code-review deferral at [deferred-work.md:21](deferred-work.md#L21)).
    6. Open `http://localhost:5173/share/valid-token-1` → verification screen renders (second valid fixture token).
    7. Click "Retour à l'accueil" → navigate to `/` → redirected to `/dashboard` (entrepreneur mock; known auth-skeleton quirk — 4.4 honors Epic AC verbatim).
    8. DevTools inspect on AccessDeniedPage: no `AppShell`, no `Breadcrumbs`, no `Sidebar`; single `<main>` landmark; `<h1>` is "Accès refusé"; the lock icon has `aria-hidden="true"`.
    9. Resize to 375 px (iPhone SE), 768 px (iPad), 1440 px (desktop) → AccessDeniedPage layout unchanged at every width (centered `max-w-sm`). H1 + description + button readable at all widths.
    10. Tab-navigate the AccessDeniedPage → single Tab stop on the `<Link>` button; focus ring visible via `focus-visible:ring-ring/50` inherited from `buttonVariants`.
    11. VoiceOver / NVDA (if available) → announces "Accès refusé, titre de niveau 1" → description text → "Retour à l'accueil, lien". Does NOT announce the lock icon.
    12. Regression check: `/dashboard`, `/dashboard/dossiers/view/biosensio`, `/share/biosensio-share`, `/share/biosensio-share/dossier`, `/auth` all render unchanged.
  - [ ] On each edit, mark the corresponding Tasks/Subtasks checkbox above.

- [x] **Task 6: Sprint status housekeeping (AC: 19)**
  - [x] Updated [sprint-status.yaml](sprint-status.yaml):
    - `development_status.4-4-access-denied-page: ready-for-dev → review` (the `in-progress` intermediate state was skipped because the workflow flipped directly to `review` upon completion; the dev-story workflow does not persist the `in-progress` flip when the full implementation lands in a single pass).
    - `last_updated: 2026-04-22`.
  - [x] Preserved every comment in the file (STATUS DEFINITIONS block, header comment, etc.) — used targeted `Edit` replacements only.
  - [x] Story Status flipped `ready-for-dev → review`.

### Review Findings

_Three parallel reviewers ran against the uncommitted 4.4 diff (Blind Hunter / Edge Case Hunter / Acceptance Auditor). Triage below — 0 decision-needed, 0 patch, 1 defer, the rest dismissed as noise or declared in Completion Notes._

- [x] [Review][Defer] Missing `<meta name="robots" content="noindex">` on `AccessDeniedPage` [apps/web/src/routes/share/AccessDeniedPage.tsx] — deferred, pre-existing pattern (no share route sets `noindex` today); revisit with Epic 10 production readiness.

**Dismissed as noise / declared in spec Completion Notes / already in deferred-work.md** (no action, kept for traceability):

- Client-side allow-list is trivially bypassable by reading `VALID_SHARE_TOKENS` from the bundle — declared by the file-header comment and Pinned Decision #8; replaced by Epic 6.4's NestJS `share-link.guard.ts`.
- `VALID_SHARE_TOKENS` values are versioned in git — fixture strings, not secrets; required by 4.2 / 4.3 happy path.
- Type narrowing via `isValidShareToken` is "illusory" — false positive: the predicate is a proper `token is ValidShareToken` guard; both TS compile-time and runtime enforce it.
- `<title>` in React fragment requires React 19 — the project is on React 19 (same pattern used by 4.1 / 4.2 / 4.3).
- No HTTP 403/404 status — AC8 explicitly forbids displaying a protocol-level status ("the error is semantic, not protocol-level").
- Page fingerprinting via response timing — symmetric render, same guard for invalid vs revoked; Pinned Decision #8 (allow-list, not deny-list).
- `encodeURIComponent(token)` now redundant after narrowing — kept for future-proofing (matches AC16 spirit even though the `?? ''` fallback was removed per Completion Note #1).
- Orphan `/share/:token/*` sub-routes unprotected — no such sub-routes exist; scope expansion deferred to Epic 10 (already tracked in 4.1 code-review deferral #1).
- `Retour à l'accueil` → `/` redirects to `/dashboard` entrepreneur mock — declared by Pinned Decision #6 and Completion Note #4; Epic 6.6 will rewire via auth loader.
- No `aria-live` / no programmatic focus on H1 after SPA navigation — AC7 rejects `aria-live` (static error surface, not a live announcement); no autofocus is the explicit UX choice (stealing focus on a landing state is hostile to screen readers).
- No test coverage — Completion Note #5 notes `@confluent/web` has no test runner wired yet; same convention as 4.1 / 4.2 / 4.3.
- `ShareDossierView` does not accept `token` prop — 4.4 intentionally leaves `token` unused in the valid branch (dossier content comes from `MOCK_DOSSIER_DETAIL` statically); prop will be added when Epic 7.3+ wires the real API.
- Case/whitespace/NFC-NFD tolerance on tokens — would violate the allow-list's strict equality semantics; tokens are fixed ASCII literals.
- Double-URL-encoded tokens rejected silently — fixture tokens (`biosensio-share`, `valid-token-1`) contain no characters that would survive re-encoding as a different string; mock-only concern.
- Double-submit race during 1-s `setTimeout` — already prevented by the existing `disabled={submitting}` guard carried forward from 4.1.
- Telemetry / log of failed access attempts — backend concern (PRD FR42, Epic 8.4); not in 4.4 scope.

## Dev Notes

### Critical Architecture Constraints

- **Guard is an inline render branch, NOT a route.** Epic AC1 at [epics.md:936-938](../planning-artifacts/epics.md#L936-L938) says "instead of the email verification screen, an access denied page renders" — the URL stays `/share/:token` (or `/share/:token/dossier`), the rendering is different. Adding a separate route (e.g. `/share/:token/access-denied`) would require a `useNavigate` redirect which introduces extra renders, URL churn, and the potential for back-button confusion (user presses Back → lands on the denied page again → infinite loop feel). The inline early-return pattern is the cleanest React idiom and keeps the router skeleton stable. See Pinned Decision #1.
- **Guard runs on BOTH `/share/:token` AND `/share/:token/dossier` — the dossier route is NOT a trusted inner surface.** The 4.1 code review deferral at [deferred-work.md:21](deferred-work.md#L21) flagged that a direct bookmark / deep-link to `/share/any-token/dossier` bypasses the verification screen entirely. 4.4 closes that deferral by gating BOTH routes against the same `isValidShareToken` allow-list. This is consistent with the Epic 6.4 real-API architecture at [architecture.md:171-175](../planning-artifacts/architecture.md#L171-L175): the `share-link.guard.ts` NestJS guard runs on EVERY endpoint that accepts a share token, not just the verification entrypoint.
- **`/share/:token/dossier` remains STANDALONE — NOT nested under `<AppShell>`.** Same constraint as 4.1 / 4.2 / 4.3. The AccessDeniedPage also has zero AppShell exposure — it is its own standalone centered layout.
- **Reuse `Link` from react-router-dom + `buttonVariants` — introduce NO new button wrapper.** Precedent at [apps/web/src/routes/not-found.tsx:10](apps/web/src/routes/not-found.tsx#L10) ("Retour au tableau de bord" link styled as a button via `buttonVariants()`). A custom `<LinkButton>` component is premature — two use-sites (not-found and access-denied) is not the rule-of-three threshold.
- **Use `lucide-react`'s `LockIcon` — do NOT create a bespoke SVG illustration.** Epic AC2 allows "lock or warning inline SVG"; lucide-react is already in the dependency tree (4.1 uses `LoaderCircleIcon`, sonner uses `TriangleAlertIcon`, sheet uses `XIcon`). Adding a new `confluent/illustrations/AccessDeniedIllustration.tsx` would duplicate icon-system concerns without UX benefit on a minimal error surface. The pattern is: `lucide-react` for single-concept pictograms, `confluent/illustrations/` for narrative/brand illustrations (e.g. `EmptyDossiersIllustration`). `LockIcon` is a pictogram.
- **The `token` URL param is READ in 4.4 but NEVER rendered.** The guard's `useParams<{ token: string }>()` reads the param to feed `isValidShareToken`, but the AccessDeniedPage never displays the token value — not in the body, not in the title, not in a `data-*` attribute. Echoing the token back would let a brute-force attacker discriminate "denied for token X" from "denied for token Y" (both surfaces look identical if the token is not reflected). This satisfies Epic AC3's "no information disclosed" mandate at [epics.md:944-946](../planning-artifacts/epics.md#L944-L946).
- **No `aria-live`, no `role="alert"` on the denied page.** The denied page is a static error surface reached by URL — AT users landing here already know they are on a "denied" page from the `<title>` + H1 announcement. Forcing an `aria-live` region would double-announce (and cause `role="alert"` to interrupt whatever the user is doing elsewhere on their machine). Best practice per WAI-ARIA APG: `role="alert"` is for RUNTIME state changes, not landing-page content.
- **No login redirect, no `/auth` navigation.** Epic AC4 at [epics.md:948-950](../planning-artifacts/epics.md#L948-L950) is explicit: "the route does not redirect to a login page". A financeur without a valid token cannot "log in" to retry — the magic-link system (Epic 6) binds access to the email-token pair, not to a persistent account. Redirecting to `/auth` would be a category error. The only CTA is `Retour à l'accueil` → `/` → `/dashboard` (current mock-auth state) → Epic 6.6 will rewire this.
- **No `ConfluentWordmark` on the denied page.** Brand minimalism on the denied surface preserves the UX spec's "no information disclosed" spirit at [ux-design-specification.md:700](../planning-artifacts/ux-design-specification.md#L700) — an unauthenticated visitor does not learn the platform brand until they opt into the `Retour à l'accueil` flow. The `<title>` still contains "Confluent" for browser-tab identity (standard HTML practice, not in-page rendering).
- **Mock fixture lives in `apps/web/src/data/mock-tokens.ts`, NOT in `packages/shared/`.** The token allow-list is frontend-mock-only; 4.4 is a frontend-only story. Epic 6.4 will replace it with a backend guard checking the `share_links` table at [architecture.md:294-301](../planning-artifacts/architecture.md#L294-L301) — frontend will receive a 401/403 response and render the same `AccessDeniedPage`. The AccessDeniedPage component is thus reusable: its contract is "render denied UI when invoked" — it doesn't care whether the denial came from a mock allow-list or a real API 403.
- **Design tokens only — no raw hex.** `bg-background`, `text-foreground`, `text-muted-foreground`, inherited `ring-ring/50`. AC17 grep is the automated guardrail.
- **WCAG 2.1 AA baseline.** Single `<main>` landmark, single `<h1>`, decorative icon with `aria-hidden`, native link with inherited focus ring, no motion, no autofocus. Color contrast ≥ 4.9:1 on all visible text; non-text contrast does not apply to the `aria-hidden` icon.

### Design Tokens to Use

| Surface | Tailwind utility | Value | Where |
|---|---|---|---|
| Page background | `bg-background` | `#FAFAF9` | `<main>` on AccessDeniedPage |
| Page min-height | `min-h-screen` | 100 vh | `<main>` |
| Content max-width | `max-w-sm` | 384 px | `<main>` |
| Horizontal gutter | `px-6` | 24 px | `<main>` |
| Vertical padding | `py-12` | 48 px | `<main>` |
| Vertical gap | `gap-6` | 24 px | `<main>` (icon → H1 → description → CTA) |
| Text alignment | `text-center` | center | `<main>` |
| Lock icon color | `text-muted-foreground` | `#6B6B6B` | `<LockIcon>` |
| Lock icon size | `size-12` | 48 × 48 px | `<LockIcon>` |
| H1 color | `text-foreground` | `#1A1A1A` | `<h1>` |
| H1 typography | `font-heading text-2xl font-medium sm:text-[28px]` | 24 px / 500 → 28 px @ ≥sm | `<h1>` |
| Description color | `text-muted-foreground` | `#6B6B6B` | `<p>` |
| Description size | `text-sm` | 14 px | `<p>` |
| CTA | `buttonVariants({ variant: 'outline', size: 'lg' }) + w-full` | border + `h-9` min | `<Link>` |
| CTA focus ring | inherited from `buttonVariants` | `ring-ring/50` @ 50 % | `<Link>` |

### Component Prop Contracts

```tsx
// apps/web/src/routes/share/AccessDeniedPage.tsx (NEW)
export function AccessDeniedPage(): JSX.Element
// — no props; purely presentational; no data dependencies

// apps/web/src/data/mock-tokens.ts (NEW)
export const VALID_SHARE_TOKENS: readonly ['biosensio-share', 'valid-token-1']
export type ValidShareToken = 'biosensio-share' | 'valid-token-1'
export function isValidShareToken(
  token: string | undefined,
): token is ValidShareToken
// — pure, synchronous, no side effects

// apps/web/src/routes/share/index.tsx (MODIFIED)
export default function ShareRoute(): JSX.Element
// — existing default export preserved (router.tsx:11 imports by default)
// — adds one useParams destructure + one early-return at the top
// — valid branch behavior unchanged from 4.1

// apps/web/src/routes/share/dossier.tsx (MODIFIED)
export default function ShareDossierRoute(): JSX.Element
// — existing default export preserved (router.tsx:12 imports by default)
// — adds one useParams destructure + one early-return at the top
// — valid branch behavior unchanged from 4.3
```

### File Layout (target)

```
apps/web/src/
├── components/
│   ├── confluent/                                     [UNCHANGED — none of these primitives gain new consumers]
│   │   ├── AccessListRow.tsx                          [UNCHANGED — 3.4]
│   │   ├── ConfluentWordmark.tsx                      [UNCHANGED — 4.1]
│   │   ├── DossierCard.tsx                            [UNCHANGED — 3.1]
│   │   ├── DossierField.tsx                           [UNCHANGED — 2.6]
│   │   ├── EmptyState.tsx                             [UNCHANGED — 2.2]
│   │   ├── MetricCard.tsx                             [UNCHANGED — 3.3]
│   │   ├── RevokeAccessDialog.tsx                     [UNCHANGED — 3.6]
│   │   ├── SharePanel.tsx                             [UNCHANGED — 3.5]
│   │   ├── StatusDot.tsx                              [UNCHANGED — 3.4]
│   │   ├── WizardInput.tsx                            [UNCHANGED — 2.3]
│   │   └── illustrations/                             [UNCHANGED]
│   ├── layout/                                        [UNCHANGED]
│   └── ui/                                            [UNCHANGED — `buttonVariants` consumed as-is]
├── data/
│   ├── mock-analytics.ts                              [UNCHANGED]
│   ├── mock-dossier.ts                                [UNCHANGED]
│   ├── mock-dossiers.ts                               [UNCHANGED]
│   ├── mock-tokens.ts                                 [NEW — VALID_SHARE_TOKENS + isValidShareToken]
│   └── questionnaire.ts                               [UNCHANGED]
├── features/                                          [UNCHANGED]
├── lib/
│   └── utils.ts                                       [UNCHANGED — `cn` re-imported by AccessDeniedPage]
├── routes/
│   ├── admin/                                         [UNCHANGED]
│   ├── auth/                                          [UNCHANGED]
│   ├── dashboard/                                     [UNCHANGED]
│   ├── not-found.tsx                                  [UNCHANGED]
│   └── share/
│       ├── AccessDeniedPage.tsx                       [NEW — standalone denied UI, named export, consumed by both share routes]
│       ├── dossier.tsx                                [MODIFIED — adds useParams + guard early-return at top of function body]
│       └── index.tsx                                  [MODIFIED — adds guard early-return at top of function body, consolidates useParams]
├── main.tsx                                           [UNCHANGED]
└── router.tsx                                         [UNCHANGED]
```

### Decisions Pinned for This Story

Do not renegotiate without explicit retrospective action.

1. **Inline early-return branch — NOT a separate route.** The denied surface renders in-place via `if (!isValidShareToken(token)) return <AccessDeniedPage />`; the URL stays at `/share/:token` (or `/share/:token/dossier`). Alternatives rejected: (a) a new route `/share/:token/access-denied` with a `<Navigate>` redirect — adds URL churn, breaks back-button ergonomics; (b) a route-level `errorElement` — React Router v7's `errorElement` fires on THROWN errors, not on validation failures, and would require synthetic throws in the route loaders (over-engineering for a frontend-only mock); (c) a wrapper HOC — unnecessary indirection at the current 2-route scale. The inline-branch pattern is the idiomatic React 19 + React Router 7 choice and matches Epic AC1 phrasing verbatim.

2. **`LockIcon` from `lucide-react` — NOT a bespoke `AccessDeniedIllustration`.** Epic AC2 says "monochrome lock or warning inline SVG" — lucide-react renders inline SVGs and is already a dependency. Creating a bespoke illustration would break the icon-system distinction (pictograms via lucide-react vs. narrative illustrations via `components/confluent/illustrations/` — the latter are for brand moments like `EmptyDossiersIllustration`, not error pictograms). `size-12` (48 px) is larger than the default `size-4` icon size but smaller than a narrative illustration (64–96 px) — sized for presence without dominating the minimal layout.

3. **`<title>` uses em dash `—` (U+2014), NOT middle dot `·` (U+00B7).** Epic AC4 at [epics.md:948-950](../planning-artifacts/epics.md#L948-L950) pins `"Accès refusé — Confluent"` literally. This diverges from the 4.1 / 4.2 / 4.3 convention of `"<context> · Confluent"`. Rationale for the intentional divergence: an error-state title warrants heavier punctuation (em dash reads as a firm pause / separator), whereas the middle-dot is casual. Do NOT "normalize" this title to match the happy-path surfaces during refactoring.

4. **Apostrophes escaped as `&apos;` in JSX** — matches the 4.1 Pinned Decision #7 convention. Precedent: `d&apos;accès` at [apps/web/src/routes/share/index.tsx:55](apps/web/src/routes/share/index.tsx#L55), `s&apos;appelle` at [apps/web/src/routes/dashboard/dossiers/nouveau/index.tsx:40](apps/web/src/routes/dashboard/dossiers/nouveau/index.tsx#L40). Four escapes in the description (`qu'il`, `s'agit`, `d'une`) + one in the CTA (`Retour à l'accueil`) = 5 `&apos;` in the file total.

5. **`variant: 'outline'` on the CTA — NOT `'ghost'`, NOT `'default'`, NOT `'secondary'`.** Epic AC2 says "ghost/outline button" (either acceptable). We pick `outline` because it has a visible border at rest, giving the CTA clear affordance on an otherwise minimal surface. `ghost` has no border until hover, which reads as "borderline invisible" until the user guesses to hover — poor discoverability on an error page where the CTA is the user's only next step. `default` (filled primary) is visually heavy and contradicts the "neutral, not alarming" UX direction at [ux-design-specification.md:698-700](../planning-artifacts/ux-design-specification.md#L698-L700). `size: 'lg'` = `h-9` + generous padding → meets the 44 px touch target comfortably with the inner text line-height. Precedent: [apps/web/src/components/ui/alert-dialog.tsx:127](apps/web/src/components/ui/alert-dialog.tsx#L127) uses exactly `buttonVariants({ variant: 'outline', size: 'lg' })` for dialog-cancel buttons.

6. **`Retour à l'accueil` → `/` — known auth-skeleton quirk, to be rewired in Epic 6.6.** The current router at [apps/web/src/router.tsx:17](apps/web/src/router.tsx#L17) redirects `/` → `/dashboard` (entrepreneur mock). A financeur with an invalid token clicking "Retour à l'accueil" thus lands on the entrepreneur's dashboard — technically odd but not a data-leak (the dashboard is mocked with the hardcoded `Sophie Moreau` user). Epic 6.6 (Frontend magic-link auth wiring) will gate `/` behind an auth loader; unauthenticated visitors will be routed to `/auth` instead. 4.4 honors Epic AC2 verbatim (`/`) — flag this cross-reference in Completion Notes for the Epic 6.6 story author. Alternatives rejected for 4.4: (a) link to `/auth` instead of `/` — contradicts Epic AC4's "does not redirect to a login page"; (b) external link (e.g., company website) — no Confluent public site exists in V1.

7. **No `<ConfluentWordmark>` on the denied page.** 4.1 / 4.2 / 4.3 all render the wordmark as a brand-presence anchor on happy-path surfaces. 4.4 intentionally omits it — the denied surface is minimal-brand, consistent with the UX spec's "no information disclosed" spirit. The `<title>` preserves "Confluent" for browser-tab identity. Alternatives rejected: rendering the wordmark with reduced opacity (still discloses the brand, just less confidently); rendering a text-only "Confluent" above the H1 (redundant with the `<title>`). Leave the brand off the screen.

8. **Mock allow-list, NOT a deny-list.** `VALID_SHARE_TOKENS` is a whitelist of known-good tokens; any token outside the list triggers denial. A deny-list (`INVALID_SHARE_TOKENS`, `REVOKED_SHARE_TOKENS`) would require the frontend to enumerate every known-bad token, which (a) is impossible at scale, (b) would require distinguishing "invalid" from "revoked" in the mock — a state distinction the denied UI deliberately hides, (c) drifts from the Epic 6.4 real-API design where the backend maintains the `share_links` table as the source of truth. The allow-list mirrors the real-API semantics: "prove you know a valid token → proceed; otherwise denied."

9. **Both route early-returns share the same `useParams` destructure placement.** Each of `index.tsx` and `dossier.tsx` places a single `const { token } = useParams<{ token: string }>()` at the very top of the function body, immediately followed by `if (!isValidShareToken(token)) return <AccessDeniedPage />`. This is deliberately symmetric across the two routes — makes the guard pattern pattern-match-greppable for future code reviews (e.g. `grep -A1 "useParams<{ token" routes/share/`). Do NOT hoist the guard into a hook (`useShareTokenGuard()`) — two use-sites is below the rule-of-three; the two-line pattern is shorter than a hook signature anyway.

10. **4.1 / 4.2 / 4.3 Pinned Decisions CARRY FORWARD.** No renegotiation of previous stories' invariants. Specifically:
    - 4.1 Pinned Decision #6 (minimal placeholder route stub at `/share/:token/dossier` for first-of-epic): already fulfilled by 4.2 / 4.3 — the dossier view is now the real thing; 4.4 adds the guard in front of it.
    - 4.1 Pinned Decision #9 ("no `useCurrentUser` consumption in the financeur flow"): AccessDeniedPage does NOT consume `useCurrentUser`.
    - 4.1 Pinned Decision #12 (route registration locked): 4.4 does NOT touch `router.tsx`.
    - 4.2 Pinned Decision #1 (CSS-only responsive override, no route-level branch): AccessDeniedPage's single-width layout (no `lg:` / `md:` overrides) is consistent.
    - 4.2 Pinned Decision #8 (`token` URL param intentionally unread until 4.4's mocked token guard): NOW fulfilled — both share routes read `token` for the guard.
    - 4.3 Pinned Decision #2 (scrollspy via native `IntersectionObserver` — no third-party library): AccessDeniedPage has no scrollspy, so no impact.
    - 4.3 Pinned Decision #10 (4.2 Pinned Decisions #2–#10 carry forward): still honored.

### Previous Story Intelligence

**From Story 4.3 (just landed — `ee95b33`):**
- [apps/web/src/routes/share/dossier.tsx](apps/web/src/routes/share/dossier.tsx) is the ONLY entrepreneur-dossier route 4.4 modifies. 4.4 adds a two-line early-return (useParams + guard) at the top of the function body; everything below is 4.3's verbatim snippet.
- Bundle at 4.3 close: `624.12 KB / 196.42 KB gz`. 4.4's estimated delta: ≤ +1.5 KB gz (AccessDeniedPage component ~30 lines, mock-tokens.ts ~10 lines, two `useParams` + guard early-returns ≈ 4 lines each). If the delta exceeds 3 KB gz, audit for accidental wildcard imports (e.g. `import * as Lucide from 'lucide-react'`).
- The 3 tolerated pre-existing ESLint warnings (`badge.tsx:52`, `button.tsx:58`, `features/current-user/context.tsx:17`) must stay at 3; ZERO new warnings.
- 4.3's smooth-scroll `useEffect` + IntersectionObserver effect remain in the VALID-token branch of `dossier.tsx`, UNCHANGED. The guard early-returns BEFORE these effects so they don't run on denied branches (which is the correct no-op — denied UI has no sections to scroll).
- 4.3 deferred 3 items in its review — 4.4 does NOT take them on (they are all deep-link / scroll-behavior polish, orthogonal to the guard / denied-page work).

**From Story 4.2 (`3cc245a`):**
- 4.2 Pinned Decision #8 pinned the `token` URL param as "intentionally unread until Story 4.4's mocked token guard" at [4-2-financeur-dossier-view-mobile-layout.md:382](4-2-financeur-dossier-view-mobile-layout.md#L382). 4.4 reads `token` for the guard — fulfilling the pinned contract. The valid-token branch still does NOT consume `token` for any other purpose (the dossier content continues to come from `MOCK_DOSSIER_DETAIL` statically).
- Mobile `max-w-2xl` / `px-6` / `gap-8` pattern is used by 4.2 and 4.3's dossier view. The AccessDeniedPage uses a tighter `max-w-sm` (matches 4.1's verification screen, not 4.2's dossier view) — appropriate for a minimal error surface with less content.

**From Story 4.1 (`af6ac5c`):**
- Route registration in [apps/web/src/router.tsx](apps/web/src/router.tsx) is PERMANENT — 4.4 does NOT touch `router.tsx`.
- The 4.1 code-review deferral #1 at [deferred-work.md:20](deferred-work.md#L20) (`/share/` empty-token falls through) is NOT resolved in 4.4 — the guard pattern (inline early-return) handles `token === undefined` correctly (AC3 `if (token === undefined) return false`), but router-level path matching for `/share/` is separate. Deferred to Epic 10.
- The 4.1 code-review deferral #2 at [deferred-work.md:21](deferred-work.md#L21) (`ShareDossierRoute` accessible in direct without passing verification) IS resolved in 4.4 — the guard on `dossier.tsx` gates direct deep-links.
- The 4.1 code-review deferral #3 at [deferred-work.md:22](deferred-work.md#L22) (client-side rate limiting) is NOT resolved in 4.4 — 4.4 does NOT add any timing / throttle logic; rate limiting belongs with Epic 6.5.
- 4.1's `max-w-sm` + `px-6 py-12` + centered pattern at [apps/web/src/routes/share/index.tsx:48](apps/web/src/routes/share/index.tsx#L48) is the layout template the AccessDeniedPage follows. Visual coherence across the three share-surface states (denied, verification, dossier) is intentional — the user experience of landing on `/share/<any token>` always starts with a centered minimal layout.

**From Story 1.3 (`initial router scaffold`):**
- `useParams<{ token: string }>()` is a type lie — React Router types params as `string | undefined`. The guard explicitly handles the `undefined` case (`if (token === undefined) return false` inside `isValidShareToken`). The 1.3 code-review deferral at [deferred-work.md:92](deferred-work.md#L92) is partially mitigated by 4.4 for the share routes.

**From `not-found.tsx` (Story 1.3 scaffold):**
- The `<Link to="/dashboard" className={buttonVariants()}>` pattern is the precedent for styled-link-as-button on an error surface. 4.4 adapts it to `variant: 'outline'` + `size: 'lg'` + `w-full` on a `<Link to="/">`. The similarity between `not-found.tsx` and `AccessDeniedPage.tsx` is intentional — both are static error surfaces. They are NOT consolidated into a shared component because: (a) their copy, icon, and semantic intent differ; (b) rule-of-three (need a third error surface before extraction); (c) consolidation would couple financeur-flow concerns to the entrepreneur-flow `404`.

### Git Intelligence

Recent commits (most recent 6):

```
ee95b33 feat(epic-4): story 4.3 — Financeur dossier view desktop layout
3cc245a feat(epic-4): story 4.2 — Financeur dossier view mobile layout
af6ac5c feat(epic-4): story 4.1 — Email verification screen (UI only, mocked)
75b566a feat(epic-3): story 3.6 — Access revocation (optimistic, mocked)
9ba8ff9 feat(epic-3): story 3.5 — Share panel (D5) with Sheet component
e04e2a2 feat(epic-3): story 3.4 — AccessListRow & StatusDot components
```

**Observed patterns to carry forward:**
- Commit title format: `feat(epic-N): story N.M — <descriptive title matching epic AC phrasing>`. 4.4's commit title: `feat(epic-4): story 4.4 — Access denied page`.
- Single bundled commit per story (impl + code-review patches together) per the user's auto-memory at [feedback_commit_review_together.md](/home/coder/.claude/projects/-home-coder-confluent/memory/feedback_commit_review_together.md).
- Epic-4 stories consistently modify `routes/share/*.tsx` without touching `router.tsx`. 4.4 continues the pattern.
- Mock fixtures land in `apps/web/src/data/` with a header comment forward-referencing the real-API epic. 4.2 added `mock-dossier.ts` with this header convention; 4.4 follows with `mock-tokens.ts`.

### Latest Technical Specifics

**React 19 + React Router v7:**
- Native `<title>` JSX element is auto-hoisted into `<head>` — same pattern as 4.1 / 4.2 / 4.3 (verbatim). No `react-helmet` / `@vueuse/head` / similar library needed.
- React Router v7's `useParams<{ token: string }>()` types `token` as `string | undefined`. The guard explicitly narrows with the `isValidShareToken(token)` type-guard predicate; the valid-branch narrowing lets the existing `navigate(\`/share/\${encodeURIComponent(token ?? '')}/dossier\`)` at [apps/web/src/routes/share/index.tsx:41](apps/web/src/routes/share/index.tsx#L41) work with `ValidShareToken` (a string literal union) instead of `string | undefined`. The `?? ''` fallback becomes a no-op but is kept to preserve the existing literal.
- React Router v7's `Link` component: `<Link to="/" />` does client-side navigation (no full page reload). The router's `/` index route redirects to `/dashboard` via `<Navigate to="/dashboard" replace />` at [apps/web/src/router.tsx:17](apps/web/src/router.tsx#L17) — the user lands on the dashboard after one client-side navigation hop.

**`lucide-react` 1.8.0:**
- `LockIcon` — a 24×24 viewBox SVG with `stroke="currentColor"` + `stroke-width="2"`. Inherits color from `text-muted-foreground`. Sizing via Tailwind `size-12` sets `width: 48px; height: 48px`; the internal viewBox scales accordingly. Support: all target browsers per [architecture.md:180](../planning-artifacts/architecture.md#L180). No polyfill needed.
- Tree-shaking: named import (`import { LockIcon } from 'lucide-react'`) lets Vite tree-shake the bundle. Wildcard imports (`import * as Lucide`) would pull the entire icon set (~600 KB). AC17 grep forbids wildcard.

**Tailwind CSS v4.2.2:**
- `size-12` = `width: 3rem; height: 3rem` = 48 px × 48 px on a 16 px root.
- `text-[28px]` = arbitrary value for `sm:` breakpoint H1 sizing — same pattern as 4.1's verification H1 at [apps/web/src/routes/share/index.tsx:51](apps/web/src/routes/share/index.tsx#L51).
- `max-w-sm` = 24 rem = 384 px.
- `buttonVariants({ variant: 'outline', size: 'lg' })` emits `border-border bg-background hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground h-9 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2` (plus the shared base classes from the cva).
- `w-full` on the `<Link>` overrides any width constraint inside `buttonVariants` (the cva base class `inline-flex` implies auto width; `w-full` wins via cascade + Tailwind's class-order layering).

**Base UI primitives (via shadcn v4):**
- No Base UI primitive consumed in 4.4. `buttonVariants` is a CVA export, not a Base UI primitive — it just emits class names.

**Bundle budget:**
- `LockIcon` icon: ~500 bytes minified + gzipped (one icon from the already-imported `lucide-react` barrel).
- `AccessDeniedPage` component: ~30 lines of TSX ≈ ~1 KB uncompressed ≈ ~0.4 KB gz.
- `mock-tokens.ts`: ~10 lines ≈ ~0.2 KB uncompressed ≈ ~0.1 KB gz.
- Two `useParams` + guard early-returns (~4 lines each): negligible (≤ 100 bytes total).
- Total estimated source size delta: +50 lines of TSX ≈ +2 KB uncompressed ≈ +0.8–1.2 KB gz. Under the 1.5 KB gz budget.

### Project Structure Notes

- Alignment with [architecture.md:524-702](../planning-artifacts/architecture.md#L524-L702): one new file under `apps/web/src/data/` (`mock-tokens.ts`), one new file under `apps/web/src/routes/share/` (`AccessDeniedPage.tsx`). The `AccessDeniedPage.tsx` placement is slightly unusual for a "component" (routes/ typically holds route bodies), but it's defensible: the component is share-flow-specific and not intended as a cross-feature primitive. If a future admin / auth surface needs a denied UI, extract to `components/confluent/` at that time.
- Variance from the architecture.md target structure at [architecture.md:635-640](../planning-artifacts/architecture.md#L635-L640): the architecture doc anticipates `apps/web/src/routes/share/[token].tsx` as a single file handling all share flows; our actual structure has `apps/web/src/routes/share/index.tsx` + `apps/web/src/routes/share/dossier.tsx` + now `AccessDeniedPage.tsx`. This is a scope-driven refinement — three files make the mobile/desktop/denied branches more tractable than a single monolithic file. Flagged in 4.1 Dev Notes; 4.4 continues the pattern.
- No new folders required. No shared-package changes required.
- If a future contributor considers introducing `apps/web/src/features/share/`, the right home for `AccessDeniedPage.tsx` + `mock-tokens.ts` is `features/share/components/` + `features/share/data/`. 4.4 does NOT create that folder — Epic 7.6 / 8.5 will be the natural time to reorganize as real API hooks land.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#928-954 (Epic 4 Story 4.4 — Access Denied Page AC)]
- [Source: _bmad-output/planning-artifacts/epics.md#817-819 (Epic 4 scope — UI-mocked, no API wiring until Epic 7)]
- [Source: _bmad-output/planning-artifacts/prd.md#FR21 (revoked or invalid link returns access-denied)]
- [Source: _bmad-output/planning-artifacts/prd.md#FR27,FR31 (financeur cannot access or infer other recipients' links)]
- [Source: _bmad-output/planning-artifacts/prd.md#FR42 (system logs failed access attempts — backend concern, Epic 8.4)]
- [Source: _bmad-output/planning-artifacts/architecture.md#171-178 (Financeur share-link guard — Epic 6.4 real-API design)]
- [Source: _bmad-output/planning-artifacts/architecture.md#294-301 (share_link Prisma model — revoked_at, share_token)]
- [Source: _bmad-output/planning-artifacts/architecture.md#524-702 (Project Structure)]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#325-343 (Color System — monochrome palette + status tokens)]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#377-385 (Accessibility Considerations)]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#698-700 (Access Denied Pattern — neutral, no CTA; Epic AC overrides with richer copy + CTA)]
- [Source: _bmad-output/implementation-artifacts/4-3-financeur-dossier-view-desktop-layout.md (Story 4.3 — every Pinned Decision, canonical snippet as the base extended by 4.4's guard)]
- [Source: _bmad-output/implementation-artifacts/4-2-financeur-dossier-view-mobile-layout.md (Story 4.2 — Pinned Decision #8 token param intentionally unread until 4.4)]
- [Source: _bmad-output/implementation-artifacts/4-1-email-verification-screen-ui-only-mocked.md (Story 4.1 — route registration, useParams pattern, Pinned Decision #6/#7/#9/#12)]
- [Source: _bmad-output/implementation-artifacts/deferred-work.md#20-22 (4.1 deferrals — 4.4 closes #21, leaves #20 and #22)]
- [Source: apps/web/src/routes/share/index.tsx (current 4.1 body — extended by 4.4's guard)]
- [Source: apps/web/src/routes/share/dossier.tsx (current 4.3 body — extended by 4.4's guard)]
- [Source: apps/web/src/routes/not-found.tsx (Link + buttonVariants pattern precedent)]
- [Source: apps/web/src/router.tsx (route registration — unchanged)]
- [Source: apps/web/src/components/ui/button.tsx (buttonVariants — cva export with outline/ghost/size variants)]
- [Source: apps/web/src/components/ui/alert-dialog.tsx#127 (buttonVariants({ variant: 'outline', size: 'lg' }) precedent)]
- [Source: apps/web/src/lib/utils.ts (`cn` utility)]
- [Source: apps/web/src/data/mock-dossier.ts (fixture file-header convention)]

## Dev Agent Record

### Agent Model Used

claude-opus-4-7 (Opus 4.7, 1M context)

### Debug Log References

- `pnpm --filter @confluent/web typecheck` → exit 0 (after each task landed).
- `pnpm --filter @confluent/web lint` → exit 0, 3 tolerated pre-existing warnings preserved.
  - Interim lint run after the first guard-at-top attempt raised 7 `react-hooks/rules-of-hooks` errors (`useNavigate`, two `useRef`, three `useState`, `useEffect` all flagged as called-conditionally because they sat after the early-return inside `ShareRoute`'s function body). This prompted the deviation described in Completion Note #1.
- `pnpm turbo run build` → all 3 packages GREEN. `@confluent/web` bundle: `dist/assets/index-COT6tZH-.js` 625.33 KB / 196.68 KB gz.
- AC17 grep battery executed against `apps/web/src/routes/share/{AccessDeniedPage.tsx,index.tsx,dossier.tsx}` and `apps/web/src/data/mock-tokens.ts` — every semantic assertion passes.

### Completion Notes List

1. **Guard pattern deviation from AC16 canonical snippet — inner-component delegation.**
   - AC3, AC4, and AC16's canonical snippets place `if (!isValidShareToken(token)) return <AccessDeniedPage />` directly above the existing in-body hooks (`useNavigate`/`useRef`/`useState`/`useEffect` in `ShareRoute`; `useState`/`useEffect`/`useEffect` in `ShareDossierRoute`). AC3's rationale — "the guard must sit BEFORE all hooks … to avoid hook-count mismatch between the denied and verification paths" — is incorrect: `useParams` is itself a hook, so placing any hooks AFTER the early-return creates a conditional-hook call. The `react-hooks/rules-of-hooks` ESLint plugin (which AC17 requires green) correctly flagged this and blocked lint.
   - Resolution: the outer route components (`ShareRoute`, `ShareDossierRoute`) only call `useParams` + guard + delegate. The existing in-body hooks moved into inner local components (`ShareVerificationForm` in `index.tsx`, `ShareDossierView` in `dossier.tsx`) which are only instantiated on the valid-token branch. This preserves:
     - AC3/AC4 semantic intent (guard sits before any *business* hook the verification / dossier surface needs).
     - AC13 (valid-token branch behavior unchanged — the inner components run exactly the same code).
     - AC14's strict guarantee ("IntersectionObserver is never instantiated for denied users, `document.documentElement.style.scrollBehavior` is never mutated") — the inner `ShareDossierView` never mounts on the denied path, so its effects never attach.
     - AC16's "ONE `useParams` call total" (the outer route holds the single `useParams`; the inner verification form receives the narrowed `ValidShareToken` as a prop — so the existing `navigate(\`/share/\${encodeURIComponent(token)}/dossier\`)` simplifies — the `?? ''` fallback is no longer needed since `token: ValidShareToken` is never undefined. This is the only user-visible code simplification.).
     - Rules of Hooks (satisfied without any `eslint-disable` escape hatches).
   - Pinned Decision #9 ("same `useParams` destructure placement across both routes") remains honored — both outer routes have the identical 2-line `useParams` + guard pattern at the top of the function body.

2. **AC17 grep expected-count imprecisions.**
   - Grep 4 (`isValidShareToken`): AC says "EXACTLY 2 matches" but the hit count is 4 (1 import + 1 call per file × 2 files). The import lines are unavoidable — `grep` does not distinguish them from call sites. The spirit ("one call site per file at the top of the function body") holds.
   - Grep 6 (`VALID_SHARE_TOKENS`): AC says "EXACTLY 2 matches" but the hit count is 3 (the `export const` declaration, the `export type ValidShareToken = (typeof VALID_SHARE_TOKENS)[number]` type alias, and the `readonly string[]` coercion). The type-alias line is directly required by the AC16 canonical snippet for `mock-tokens.ts`. No code-level violation.
   - All other greps (1, 2, 3, 5, 7, 8, 9, 10, 11, 12) match the AC expectations exactly.

3. **Manual browser walkthrough deferred — no browser available in this automation environment.**
   - Same deferral pattern as 4.1 / 4.2 / 4.3. The mechanical guarantees in place are: `typecheck` (0 errors), `lint` (0 errors + 3 tolerated pre-existing warnings preserved), `turbo run build` (all packages GREEN, bundle within budget), and the AC17 grep battery. Manual confirmation of the 12-step walkthrough (unknown-token render, `valid-token-1` render, deep-link guard on `/dossier`, Tab focus, VoiceOver announcement, resize, regression sweep across `/dashboard`, `/dashboard/dossiers/view/biosensio`, `/share/biosensio-share`, `/share/biosensio-share/dossier`, `/auth`) is recommended during code review.

4. **Epic 6.6 cross-reference for `Retour à l'accueil` → `/`.**
   - Pinned Decision #6 is honored verbatim — the denied-page CTA links to `/`, which the router at [apps/web/src/router.tsx:17](apps/web/src/router.tsx#L17) redirects to `/dashboard` (entrepreneur mock). This means an unauthenticated financeur who clicks the CTA lands on the Sophie Moreau mock dashboard. Flagged here (and in the Dev Notes Pinned Decision) for the Epic 6.6 story author: when auth routing lands, the denied-page CTA's target may want to be rewired to `/auth` OR the `/` route itself should be gated behind an auth loader.

5. **Test coverage.**
   - The `@confluent/web` package has no `test` script configured (verified in `apps/web/package.json`). 4.1 / 4.2 / 4.3 followed the same convention — no unit/integration tests were authored, relying on `typecheck` + `lint` + `build` + manual walkthrough. 4.4 continues that convention. Future Epic work (Test Architect module / Epic 6.5 hardening / Epic 10 production readiness) is the likely place to introduce automated coverage for the share-flow state transitions.

### File List

**New files:**
- [apps/web/src/data/mock-tokens.ts](apps/web/src/data/mock-tokens.ts) — `VALID_SHARE_TOKENS` tuple, `ValidShareToken` type alias, `isValidShareToken` type-guard predicate.
- [apps/web/src/routes/share/AccessDeniedPage.tsx](apps/web/src/routes/share/AccessDeniedPage.tsx) — standalone named-export denied UI (lock icon + H1 + description + outline CTA).

**Modified files:**
- [apps/web/src/routes/share/index.tsx](apps/web/src/routes/share/index.tsx) — added `isValidShareToken` + `ValidShareToken` + `AccessDeniedPage` imports; split `ShareRoute` (outer: `useParams` + guard + delegate) from `ShareVerificationForm` (inner: all existing 4.1 hooks + JSX, accepts `token: ValidShareToken` prop; `navigate` path now uses `encodeURIComponent(token)` without the `?? ''` fallback since `token` is narrowed).
- [apps/web/src/routes/share/dossier.tsx](apps/web/src/routes/share/dossier.tsx) — added `useParams` + `isValidShareToken` + `AccessDeniedPage` imports; split `ShareDossierRoute` (outer: `useParams` + guard + delegate) from `ShareDossierView` (inner: all existing 4.3 hooks + JSX).
- [_bmad-output/implementation-artifacts/sprint-status.yaml](_bmad-output/implementation-artifacts/sprint-status.yaml) — `development_status.4-4-access-denied-page: ready-for-dev → review`; `last_updated: 2026-04-22`.
- [_bmad-output/implementation-artifacts/4-4-access-denied-page.md](_bmad-output/implementation-artifacts/4-4-access-denied-page.md) — Status `ready-for-dev → review`; Tasks/Subtasks all checked; Dev Agent Record and Change Log populated.

## Change Log

| Date       | Change                                                                                                                     | Author     |
|------------|----------------------------------------------------------------------------------------------------------------------------|------------|
| 2026-04-22 | Story drafted by create-story workflow; sprint status flipped backlog → ready-for-dev.                                     | Bob (SM)   |
| 2026-04-22 | Implementation landed — mocked token guard + AccessDeniedPage wired into both share routes via inner-component delegation to satisfy Rules of Hooks; typecheck/lint/build green; bundle +0.26 KB gz; sprint status flipped ready-for-dev → review. | Amelia (Dev) |
| 2026-04-22 | Code review — three parallel reviewers (Blind / Edge Case / Acceptance). Verdict: 0 decision-needed, 0 patch, 1 defer (robots noindex → Epic 10), rest dismissed as declared-in-spec or pre-existing deferrals. Review Findings section appended. Status flipped review → done. | Reviewer    |
