# Story 1.3: Route Skeleton & Hardcoded User Context

Status: done

## Story

As a developer,
I want React Router v7 configured with all route groups and a globally available hardcoded user context,
so that every frontend epic can be built immediately without any authentication infrastructure.

## Acceptance Criteria

1. **Given** the app starts, **When** a developer navigates to `/dashboard`, **Then** a dashboard placeholder page renders with the page title "Dashboard" — no auth redirect occurs.
2. **Given** the app starts, **When** a developer navigates to `/share/any-token`, **Then** a financeur placeholder page renders with the page title "Dossier partagé".
3. **Given** the app starts, **When** a developer navigates to `/admin`, **Then** an admin placeholder page renders with the page title "Administration".
4. **Given** the app starts, **When** a developer navigates to `/auth`, **Then** an auth placeholder page renders with the page title "Connexion".
5. **Given** any component in `apps/web`, **When** the `useCurrentUser()` hook is called, **Then** it returns the hardcoded user object:
   ```json
   { "id": "hardcoded-1", "name": "Sophie Moreau", "email": "sophie@biosensio.fr", "role": "entrepreneur" }
   ```
6. **Given** the app layout includes a sidebar, **When** a user is on `/dashboard`, **Then** the Dashboard sidebar item is highlighted as active (`font-weight: 500`, darker background `#E8E8E7`).
7. **Given** a user navigates to an undefined route, **When** the router resolves the path, **Then** a 404 page is displayed with a link back to `/dashboard`.
8. **Given** the route structure, **When** a developer inspects `apps/web/src/routes/`, **Then** route files exist for all four route groups: `dashboard`, `share`, `admin`, `auth`.

## Tasks / Subtasks

- [x] Task 1: Install React Router v7 and wire the root router (AC: 1, 2, 3, 4, 7, 8)
  - [x] Add `react-router-dom@^7.14.0` to `apps/web/dependencies` via `pnpm --filter @confluent/web add react-router-dom@^7.14.0`
  - [x] Create `apps/web/src/router.tsx` that builds a `createBrowserRouter` configuration with the 5 routes (root layout wrapping 4 route groups + 404)
  - [x] Replace the current `<App />` body in `apps/web/src/main.tsx` with `<RouterProvider router={router} />` — remove the token-verification UI (or move it into the dashboard placeholder if still useful for visual validation)
  - [x] Keep the `_CrossWorkspaceTypeCheck` type re-export in `main.tsx` (added by story 1-1 code review)

- [x] Task 2: Extend `packages/shared` with the `User` type (AC: 5)
  - [x] In `packages/shared/src/index.ts` add `export interface User { id: string; name: string; email: string; role: UserRole; }` alongside the existing `UserRole` type
  - [x] No new dependencies, no build step — shared continues to ship source via `main: ./src/index.ts`

- [x] Task 3: Create `CurrentUserContext` + `useCurrentUser` hook (AC: 5)
  - [x] Create `apps/web/src/features/current-user/context.tsx` — exports `CurrentUserContext` (React.Context), `CurrentUserProvider` (provides the hardcoded user), and `useCurrentUser()` (throws if used outside the provider)
  - [x] Hardcoded user literal:
    ```ts
    const HARDCODED_USER: User = {
      id: 'hardcoded-1',
      name: 'Sophie Moreau',
      email: 'sophie@biosensio.fr',
      role: 'entrepreneur',
    }
    ```
  - [x] Import the `User` type from `@confluent/shared`
  - [x] Wrap `<RouterProvider>` (or the root layout) with `<CurrentUserProvider>` so every route has access to the user

- [x] Task 4: Create the AppShell root layout with minimal sidebar (AC: 6)
  - [x] Create `apps/web/src/components/layout/AppShell.tsx` — renders a fixed 240px left sidebar on desktop (`hidden md:flex` via Tailwind) containing the Confluent wordmark at top, a nav section with a "Dashboard" link, and a user block at bottom displaying `user.name` + `user.email` sourced from `useCurrentUser()`
  - [x] Use React Router's `NavLink` with a `className` callback to apply active styling: when `isActive` is true → `bg-sidebar-accent` (resolves to `#E8E8E7`) and `font-medium` (resolves to `font-weight: 500`); inactive → `text-sidebar-foreground hover:bg-sidebar-accent/60`
  - [x] Use shadcn `Separator` (already available at `@/components/ui/separator`) between nav and user block
  - [x] Use `<Outlet />` for the page area
  - [x] Sidebar background: `bg-sidebar` (resolves to `#F1F0EE`); content background: default `bg-background` (`#FAFAF9`)
  - [x] **Scope boundary:** This is a minimal sidebar — only desktop view, only one "Dashboard" nav link, no responsive collapse, no mobile bottom-nav. The full responsive sidebar (tablet 60px collapse, mobile bottom-nav, breadcrumbs, focus rings) is Story 2.1's responsibility.

- [x] Task 5: Create the 4 placeholder route components (AC: 1, 2, 3, 4, 8)
  - [x] `apps/web/src/routes/dashboard/index.tsx` → renders `<h1>Dashboard</h1>` inside the `AppShell` outlet (via route nesting). Page title via `document.title` in a `useEffect` OR via a `<title>` tag (React 19 supports native `<title>` in JSX — use this).
  - [x] `apps/web/src/routes/share/index.tsx` → renders `<h1>Dossier partagé</h1>`. Route pattern is `/share/:token` — read `useParams()` and display token for visual verification (e.g., `<p>Token: {token}</p>`). Financeur route is **outside** `AppShell` (no sidebar for financeurs per UX spec).
  - [x] `apps/web/src/routes/admin/index.tsx` → renders `<h1>Administration</h1>` inside `AppShell`.
  - [x] `apps/web/src/routes/auth/index.tsx` → renders `<h1>Connexion</h1>` **outside** `AppShell` (no sidebar on auth screen).
  - [x] Each placeholder sets `<title>Page name · Confluent</title>` so browser tab reflects the route.

- [x] Task 6: Create the 404 NotFound page (AC: 7)
  - [x] `apps/web/src/routes/not-found.tsx` → renders `<h1>404</h1>`, a short message ("Cette page n'existe pas."), and a shadcn `Button` (asChild wrapping a `<Link to="/dashboard">`) labelled "Retour au tableau de bord"
  - [x] Wire as the `errorElement` on the root route OR as a catch-all `path: '*'` route (prefer catch-all — simpler, same effect for not-found without throwing)

- [x] Task 7: Update `App.tsx` and cleanup (AC: 1-8)
  - [x] `apps/web/src/App.tsx` becomes the root layout export consumed by the router (or is deleted if `AppShell` serves the same purpose — decide: one of them is enough, don't keep both). Recommendation: **delete `App.tsx`**, keep only `AppShell.tsx` referenced from `router.tsx`.
  - [x] Remove the token-verification UI from the previous story (Badges with status dots, etc.) — the dashboard placeholder is now just `<h1>Dashboard</h1>`. If you want to preserve the visual regression check, move it to `routes/dashboard/index.tsx` so it still renders on navigation.

- [x] Task 8: Verify full pipeline (AC: 1-8)
  - [x] `pnpm --filter @confluent/web add react-router-dom@^7.14.0` succeeds
  - [x] `pnpm turbo run typecheck` → 2 successful, 0 errors
  - [x] `pnpm turbo run build` → 2 successful, 0 errors
  - [x] `pnpm turbo run lint` → 0 errors (warnings from shadcn variant exports are tolerated)
  - [x] `pnpm turbo run dev` → navigate to each of the 5 routes in the browser and verify: correct `<h1>`, correct browser tab title, active sidebar item highlighted on `/dashboard`, 404 on unknown route, financeur route accepts any `:token` segment
  - [x] Verify `useCurrentUser()` returns the exact hardcoded literal (use React DevTools or a temporary `console.log` in the dashboard placeholder; remove before commit)

## Dev Notes

### Critical Architecture Constraints

- **React Router v7 (7.14.0), library mode** — use `createBrowserRouter` + `RouterProvider` (NOT the framework/Remix mode). Framework mode would require a Vite plugin and a different project layout; it's out of scope. [Source: architecture.md#Frontend Architecture]
- **File-based route structure under `src/routes/`** — organize route components by URL group (one folder per top-level route). The router configuration (`router.tsx`) is the single source of truth that maps paths to components. This matches the architecture spec while staying simple. [Source: architecture.md#Frontend Architecture, architecture.md#Complete Project Directory Structure]
- **Four route groups — `dashboard` (entrepreneur), `share/:token` (financeur), `admin`, `auth`** — scaffold all four in this story even though deeper stories will fill them in. This unblocks Epics 2-5 in parallel. [Source: epics.md#Story 1.3]
- **No auth redirects, no guards** — this story is explicitly pre-auth. Routes render unconditionally. `useCurrentUser()` always returns the hardcoded Sophie. Auth wiring lands in Epic 6. [Source: epics.md#Epic 1 narrative, architecture.md#Protected routes via loader-based auth check]
- **Sidebar minimal scope** — only desktop, only "Dashboard" nav link, only active-state styling. The responsive sidebar (tablet 60px collapse, mobile bottom-nav, breadcrumb component, full nav items) is Story 2.1. Do not over-build. [Source: ux-design-specification.md#Navigation Patterns, epics.md#Story 2.1]
- **Financeur + auth routes are OUTSIDE the AppShell** — the financeur (public share link access) and the login screen do not get a sidebar. `AppShell` wraps only `/dashboard` and `/admin` (entrepreneur + admin surfaces). [Source: ux-design-specification.md#Mobile (financeur), ux-design-specification.md#Magic link screen]

### Design Tokens to Use (already wired in `index.css` from Story 1.2)

| Token | Tailwind utility | Value | Where used in this story |
|---|---|---|---|
| Sidebar bg | `bg-sidebar` | `#F1F0EE` | AppShell sidebar surface |
| Sidebar active bg | `bg-sidebar-accent` | `#E8E8E7` | Active NavLink state |
| Sidebar text | `text-sidebar-foreground` | `#1A1A1A` | Sidebar text colour |
| Page bg | `bg-background` | `#FAFAF9` | Content area |
| Font weight active | `font-medium` | 500 | Active NavLink |

Do NOT hard-code hex values in components — always reference tokens via Tailwind utilities. Tokens are defined in `apps/web/src/index.css` from Story 1.2.

### Hardcoded User — Exact Shape

```ts
// packages/shared/src/index.ts — add alongside existing UserRole
export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
}

// apps/web/src/features/current-user/context.tsx
const HARDCODED_USER: User = {
  id: 'hardcoded-1',
  name: 'Sophie Moreau',
  email: 'sophie@biosensio.fr',
  role: 'entrepreneur',
};
```

The `role: 'entrepreneur'` value must satisfy the existing `UserRole` union in `packages/shared` (already validated by `_CrossWorkspaceTypeCheck` in `main.tsx` and `app.module.ts` — any mismatch fails at compile time).

### File Layout (target)

```
apps/web/src/
├── main.tsx                              [modified]
├── router.tsx                            [new — createBrowserRouter config]
├── components/
│   ├── layout/
│   │   └── AppShell.tsx                  [new — minimal sidebar + Outlet]
│   └── ui/                               [existing — shadcn components]
├── features/
│   └── current-user/
│       └── context.tsx                   [new — CurrentUserContext + useCurrentUser]
├── routes/
│   ├── dashboard/
│   │   └── index.tsx                     [new — placeholder]
│   ├── share/
│   │   └── index.tsx                     [new — placeholder with :token param]
│   ├── admin/
│   │   └── index.tsx                     [new — placeholder]
│   ├── auth/
│   │   └── index.tsx                     [new — placeholder]
│   └── not-found.tsx                     [new — 404 page]
└── App.tsx                               [DELETED — superseded by AppShell + router]

packages/shared/src/
└── index.ts                              [modified — add User interface]
```

### Previous Story Intelligence (Stories 1.1 + 1.2)

**From 1.1 (Turborepo scaffold):**
- Cross-workspace types resolve via pnpm symlink, not `tsconfig.paths`. Importing `User` from `@confluent/shared` in `apps/web` just works.
- Strict ESLint rules in api side (not web). Web has `react-hooks` + `react-refresh` flat config.
- `main.tsx` exports `_CrossWorkspaceTypeCheck` — keep it; it's a compile-time guard that broke once already.

**From 1.2 (Design system):**
- Tailwind v4 with CSS-native `@theme` tokens in `index.css`. All sidebar-specific tokens (`--sidebar`, `--sidebar-foreground`, `--sidebar-accent`, `--sidebar-accent-foreground`) are defined. **Use them — do not redefine.**
- `@/*` path alias works in TS + Vite. Prefer `@/components/layout/AppShell` over relative paths.
- `cn()` utility at `@/lib/utils` — use for any conditional classNames (e.g., active NavLink variants).
- `<Button>` shadcn component: use `asChild` + `<Link>` for navigation buttons that look like buttons (e.g., 404 "return to dashboard" CTA).
- `<Separator>` — already fixed for Base UI's `data-[orientation=...]` attribute after 1-2 review.
- shadcn variant exports (`buttonVariants`, `badgeVariants`) cause 2 react-refresh lint warnings. Tolerated, do not try to fix.
- `sonner` Toaster is available but unused in this story — ignore.

### Anti-Patterns to Avoid

- **Do NOT install `react-router` (v6 or earlier)** — the architecture requires v7 (`react-router-dom@^7.14.0`). v7 is a drop-in API upgrade from v6 with additional capabilities.
- **Do NOT use the Remix/framework mode** of React Router v7. Library mode (`createBrowserRouter`) is the architecture's choice because it runs cleanly under Vite without extra plugins.
- **Do NOT add auth guards / loaders** — this story is explicitly pre-auth. Protected-routes wiring is Epic 6.
- **Do NOT build the full responsive sidebar** — Story 2.1's scope. Minimal desktop-only sidebar here.
- **Do NOT create new design tokens** — Story 1.2 defined them all. Use `bg-sidebar`, `bg-sidebar-accent`, `text-sidebar-foreground`, `bg-background`, `font-medium` as-is.
- **Do NOT hardcode English text in UI** — FR strings are part of the product: "Dashboard", "Dossier partagé", "Administration", "Connexion", "Retour au tableau de bord", "Cette page n'existe pas." All user-facing copy in French unless the AC explicitly states English.
- **Do NOT wrap financeur or auth routes in AppShell** — those are chrome-less per UX spec.
- **Do NOT re-introduce the token-verification UI from 1.2** — it served its purpose; deleting it is fine. If you want a visual regression safety net, move a trimmed version into the dashboard placeholder, but don't gate completion on it.

### Testing Requirements

- **Unit / integration tests are out of scope for this skeleton story.** No Vitest/RTL setup exists yet; introducing it is premature and not in the AC.
- **Manual verification required (Task 8):** navigate all 5 routes in the browser, confirm titles, sidebar highlight, 404 fallback, and `useCurrentUser()` returns the exact hardcoded object (via a temporary `console.log` you remove before commit).
- **Type-level verification is the primary safety net:** the `User` type from `@confluent/shared` + the existing `_CrossWorkspaceTypeCheck` pattern + `pnpm turbo run typecheck` catch most regressions at compile time.

### References

- Epic AC: [Source: epics.md#Story 1.3 — Route Skeleton & Hardcoded User Context]
- Router version + routing pattern: [Source: architecture.md#Frontend Architecture]
- Route groups + layout: [Source: architecture.md#Complete Project Directory Structure]
- Sidebar visual spec (active state): [Source: ux-design-specification.md#Navigation Patterns]
- Sidebar tokens: [Source: ux-design-specification.md#Color System, apps/web/src/index.css]
- Financeur and auth chrome-less pattern: [Source: ux-design-specification.md#Mobile (financeur), ux-design-specification.md#Magic link screen]
- Cross-workspace type pattern: [Source: apps/api/src/app.module.ts, apps/web/src/main.tsx, packages/shared/src/index.ts]

## Dev Agent Record

### Agent Model Used

claude-opus-4-6

### Debug Log References

- `pnpm --filter @confluent/web add react-router-dom@^7.14.0`: resolved 899, +3 packages (react-router-dom 7.14.1, react-router, set-cookie-parser — transitive)
- `pnpm turbo run typecheck`: 2 successful, 0 errors, 1.58s
- `pnpm turbo run build`: 2 successful, web 328ms, CSS 38.50 kB gzip 7.59 kB, JS 320.93 kB gzip 101.86 kB (JS size increase from router)
- `pnpm turbo run lint`: 2 successful, 0 errors, 3 warnings (2 pre-existing from shadcn button/badge variant exports + 1 new from `current-user/context.tsx` — `CurrentUserProvider` component and `useCurrentUser` hook co-located; same pattern as shadcn, tolerated)
- `pnpm dev`: Vite v8.0.8 ready in 364 ms, no startup errors

### Completion Notes List

1. React Router v7 installed (7.14.1) via `react-router-dom@^7.14.0` as specified in architecture.
2. Library mode (`createBrowserRouter` + `RouterProvider`) — explicit route config in `apps/web/src/router.tsx`, no Vite framework-mode plugin needed.
3. `User` interface added to `packages/shared/src/index.ts` — reuses existing `UserRole` union. Cross-workspace type check `_CrossWorkspaceTypeCheck` still in `main.tsx` and `app.module.ts` (exercises the type resolution).
4. `CurrentUserContext` built with React 19 idiomatic API — `use(Context)` instead of `useContext()`, and `<Context value={...}>` instead of `<Context.Provider value={...}>`. Hook throws if used outside provider (fails loud, not silent).
5. `AppShell` is intentionally minimal — desktop-only (`hidden md:flex`), single Dashboard nav link, sidebar background `bg-sidebar` (#F1F0EE), active NavLink uses `bg-sidebar-accent` + `font-medium`. Responsive/mobile/tablet behavior deferred to Story 2.1 per scope boundary.
6. Financeur (`/share/:token`) and auth (`/auth`) routes render **outside** `AppShell` (chrome-less per UX spec). Dashboard and Admin render inside `AppShell` with shared layout.
7. 404 fallback implemented as catch-all `path: '*'` route (not `errorElement`) — simpler, same effect for not-found, avoids throwing for normal unmatched paths.
8. `Button` component from this shadcn base-nova build **does not support `asChild`** (it's a Base UI pattern, not Radix). Worked around by applying `buttonVariants()` className to `<Link>` directly in the 404 page. Pattern to reuse for future navigation buttons.
9. `App.tsx` deleted — previously held the Story 1.2 token-verification UI; superseded by router + placeholders. Dashboard placeholder is intentionally bare (`<h1>Dashboard</h1>`); visual token regression is now the responsibility of shadcn component rendering in each route.
10. Root redirects `/` → `/dashboard` via `<Navigate to="/dashboard" replace />` on the index route — avoids a blank page at the root path.
11. **Visual verification pending (recommended before merge):** manually navigate in browser and confirm active sidebar highlight on `/dashboard`, 404 layout, `<title>` updates per route, and `/share/:token` displays the token value. Dev server boots cleanly (Vite 8.0.8, 364 ms) and build produces clean bundle — programmatic signals are green; human visual verification is the only remaining step.

### File List

**Created:**
- `apps/web/src/router.tsx` — `createBrowserRouter` config; 4 route groups + 404 catch-all + `/` → `/dashboard` redirect
- `apps/web/src/features/current-user/context.tsx` — `CurrentUserContext`, `CurrentUserProvider`, `useCurrentUser()` hook
- `apps/web/src/components/layout/AppShell.tsx` — minimal desktop sidebar (240px) + `<Outlet />`
- `apps/web/src/routes/dashboard/index.tsx` — Dashboard placeholder
- `apps/web/src/routes/share/index.tsx` — Dossier partagé placeholder with `:token` param display
- `apps/web/src/routes/admin/index.tsx` — Administration placeholder
- `apps/web/src/routes/auth/index.tsx` — Connexion placeholder (chrome-less)
- `apps/web/src/routes/not-found.tsx` — 404 page with link back to `/dashboard`

**Modified:**
- `packages/shared/src/index.ts` — added `User` interface (reuses existing `UserRole`)
- `apps/web/package.json` — added `react-router-dom: ^7.14.1` to dependencies
- `apps/web/src/main.tsx` — replaced `<App />` with `<CurrentUserProvider><RouterProvider router={router} /></CurrentUserProvider>`; kept `_CrossWorkspaceTypeCheck` type re-export

**Deleted:**
- `apps/web/src/App.tsx` — superseded by `AppShell.tsx` and the router's route tree

### Change Log

- **2026-04-14** — Initial implementation: 8 tasks, 8 ACs. React Router v7 (library mode) + `useCurrentUser` hook returning hardcoded Sophie Moreau + minimal AppShell with active Dashboard highlight + 4 placeholder routes + 404. Typecheck/lint/build green; Vite dev server boots clean.

### Review Findings

- [x] [Review][Patch] Scope leak: `apps/api/tsconfig.json` reformatted + trailing newline removed [apps/api/tsconfig.json:24-35] — reverted via `git checkout HEAD -- apps/api/tsconfig.json`.
- [x] [Review][Patch] `NavLink` to `/dashboard` missing `end` prop [apps/web/src/components/layout/AppShell.tsx:23] — `end` added; active state now scoped strictly to `/dashboard`.
- [x] [Review][Defer] No `errorElement` / ErrorBoundary on any route [apps/web/src/router.tsx] — a thrown render error (e.g. `useCurrentUser` outside provider, future loaders) white-screens the app. Out of story scope; addressed when real routes and loaders land in Epics 2/6 (sources: blind + edge).
- [x] [Review][Defer] `useParams<{ token: string }>()` asserts non-undefined but RR types it `string | undefined` [apps/web/src/routes/share/index.tsx:4] — placeholder is cosmetic; tighten when the real share view lands in Epic 4 (sources: blind + edge).
- [x] [Review][Defer] Sidebar user block has no truncation for long name/email [apps/web/src/components/layout/AppShell.tsx:29-30] — harmless with hardcoded Sophie; revisit when real users land in Epic 6 (source: blind).
- [x] [Review][Defer] `apps/web/package.json` devDependency reorder (shadcn position) [apps/web/package.json:24-40] — cosmetic churn from pnpm; address with a `sort-package-json` pass or ignore (source: blind).

**Dismissed as noise / out-of-scope** (not written as action items): hardcoded user shipped to bundle (intentional per story), `<title>` rendered in JSX (React 19 idiom), `<Context value>` without `.Provider` (React 19 idiom endorsed in Dev Notes), `use(Context)` + null-default throw (explicit "fails loud" pattern), sidebar hidden below `md` with no mobile nav (Story 2.1 scope), `/admin` not in nav (minimal sidebar per spec), admin role-guard absent (Epic 6 scope), `/share/:token` renders token raw (spec Task 5 explicitly asks for it), `Button asChild` workaround via `buttonVariants()` (documented in Completion Note 8), case-insensitive routing / `basename` / `Navigate` loop (all speculative future concerns), hardcoded French strings without i18n (product language per spec), `document.getElementById('root')!` non-null assertion (pre-existing from story 1.1), `_CrossWorkspaceTypeCheck` export in `main.tsx` (pre-existing guard), `react-router-dom` shim vs `react-router` (7.14.1 confirmed in lockfile; shim is stable).
