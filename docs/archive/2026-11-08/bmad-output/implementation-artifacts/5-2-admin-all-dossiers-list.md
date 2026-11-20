# Story 5.2: Admin — All Dossiers List

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an administrator,
I want to browse all dossiers on the platform and open any one of them in a read-only mode,
so that I can monitor activity and review a dossier without touching the entrepreneur's data.

## Acceptance Criteria

1. **Given** the router at [apps/web/src/router.tsx](apps/web/src/router.tsx), **When** a developer inspects the updated file, **Then** TWO new children are appended to the `AppShell` children array, immediately after the existing `{ path: 'admin', element: <AdminRoute /> }` entry at [apps/web/src/router.tsx:44](apps/web/src/router.tsx#L44) and BEFORE the `{ path: '*', element: <NotFoundRoute /> }` catch-all at [apps/web/src/router.tsx:45](apps/web/src/router.tsx#L45):
   - `{ path: 'admin/dossiers', element: <AdminDossiersRoute /> }` — list surface.
   - `{ path: 'admin/dossiers/:slug', element: <AdminDossierDetailRoute />, handle: { hideBreadcrumb: true } }` — read-only detail surface with its own inline 3-segment breadcrumb (same delegation as the entrepreneur view at [apps/web/src/routes/dashboard/dossiers/[slug].tsx:195-214](apps/web/src/routes/dashboard/dossiers/[slug].tsx#L195-L214)). See Pinned Decision #1 for ordering. The existing `{ path: 'admin/questionnaire', ... }` and `{ path: 'admin/utilisateurs', ... }` lines are NOT added by 5.2 — those belong to 5.3 / 5.4 and continue to fall through to `NotFoundRoute` (forward-reference carried over from Story 5.1's Pinned Decision #1).

2. **Given** the default-export route modules at [apps/web/src/routes/admin/dossiers/index.tsx](apps/web/src/routes/admin/dossiers/index.tsx) and [apps/web/src/routes/admin/dossiers/[slug].tsx](apps/web/src/routes/admin/dossiers/[slug].tsx) (NEW files), **When** a developer inspects the router imports, **Then** BOTH imports use the `@/` alias and default-import the named components:
   - `import AdminDossiersRoute from '@/routes/admin/dossiers'`
   - `import AdminDossierDetailRoute from '@/routes/admin/dossiers/[slug]'`
   Imports are appended after the existing `import AdminRoute from '@/routes/admin'` at [apps/web/src/router.tsx:9](apps/web/src/router.tsx#L9), alphabetical-ish by the admin grouping (keep admin imports contiguous). The `[slug]` bracket path segment is the project-established convention (see [apps/web/src/routes/dashboard/dossiers/[slug].tsx](apps/web/src/routes/dashboard/dossiers/[slug].tsx)) — do NOT rename the file to `slug.tsx` or `$slug.tsx`.

3. **Given** both new admin routes, **When** a user with `user.role !== 'admin'` navigates to either path, **Then** each route function body begins with the inline role-guard early-return pattern established in Story 5.1 at [apps/web/src/routes/admin/index.tsx:6-8](apps/web/src/routes/admin/index.tsx#L6-L8):
   ```tsx
   const user = useCurrentUser()
   if (user.role !== 'admin') return <Navigate to="/dashboard" replace />
   ```
   The `replace` prop is REQUIRED (prevents the browser back button from returning to the blocked admin URL, same rationale as 5.1 Pinned Decision #4). The list route (`AdminDossiersRoute`) has NO hooks after the guard in its default-export body and can keep the guard inline. The detail route (`AdminDossierDetailRoute`) has hooks AFTER the guard (`useParams`, `useRef`, `useEffect`) and MUST use the inner-component delegation pattern from Story 4.4 at [_bmad-output/implementation-artifacts/4-4-access-denied-page.md:546-554](4-4-access-denied-page.md#L546-L554) — the default export does only the `useCurrentUser + if/return` check, then `return <AdminDossierDetailView />`, and all subsequent hooks live inside `AdminDossierDetailView`. See Pinned Decision #2.

4. **Given** the new mock fixture at [apps/web/src/data/mock-admin-dossiers.ts](apps/web/src/data/mock-admin-dossiers.ts) (NEW file), **When** a developer inspects it, **Then** it exports:
   - `interface MockAdminDossier extends MockDossier { readonly entrepreneurEmail: string; readonly answers?: Readonly<Record<string, string>> }` — extends the existing `MockDossier` at [apps/web/src/data/mock-dossiers.ts:7-14](apps/web/src/data/mock-dossiers.ts#L7-L14) (the 6 readonly fields are inherited: `slug`, `name`, `sector`, `maturity`, `activeShareLinksCount`, `createdAt`). The admin-only extensions are `entrepreneurEmail` (always present — REQUIRED by Epic AC1) and `answers` (optional — only populated for the `biosensio` entry in 5.2; see AC10 fallback behavior).
   - `export const MOCK_ADMIN_DOSSIERS: readonly MockAdminDossier[]` typed `as const` — EXACTLY 5 entries (Epic AC minimum), varied sectors AND varied maturity stages per Epic AC4 at [epics.md:1019-1021](../planning-artifacts/epics.md#L1019-L1021). The canonical fixture content appears in AC14.
   - File-header comment: `// Static mock fixture for the Story 5.2 admin dossiers list + read view.`  
     `// Replaced by Epic 9.1's real admin dossier access endpoint (architecture.md:769-771 —` `// DossiersService.adminUpdate + admin module) when data persistence lands.` — same forward-reference convention as [apps/web/src/data/mock-admin-pipeline.ts](apps/web/src/data/mock-admin-pipeline.ts) (Story 5.1) and [apps/web/src/data/mock-tokens.ts](apps/web/src/data/mock-tokens.ts) (Story 4.4).
   - The `biosensio` entry's `answers` MUST be `MOCK_DOSSIER_DETAIL.answers` (imported from [apps/web/src/data/mock-dossier.ts](apps/web/src/data/mock-dossier.ts)) — NOT a separate hand-maintained duplicate. Biosensio is the canonical dossier across entrepreneur + financeur + admin surfaces; divergence between the three views on the same slug would be a bug, not a feature. See Pinned Decision #3.

5. **Given** the admin dossiers list body at [apps/web/src/routes/admin/dossiers/index.tsx](apps/web/src/routes/admin/dossiers/index.tsx), **When** an admin user navigates to `/admin/dossiers`, **Then** the route renders:
   - `<title>Dossiers · Confluent</title>` — React 19 auto-hoisted to `<head>`; middle-dot `U+00B7` separator matching 5.1 title convention.
   - `<h1 ref={headingRef} tabIndex={-1} className="font-heading text-2xl font-semibold text-foreground md:text-[28px] focus-visible:outline-none">Dossiers</h1>` — with mount-time `headingRef.current?.focus()` inside a `useEffect(() => {...}, [])` (single-dependency-free effect), matching the entrepreneur dashboard pattern at [apps/web/src/routes/dashboard/index.tsx:14-16](apps/web/src/routes/dashboard/index.tsx#L14-L16) — this is a list/index surface where mount-focus is the established convention (unlike 5.1's `/admin` which deliberately omitted autofocus per 5.1 Completion Note §Pinned Decision rationale for a non-list destination).
   - `<p className="mt-2 text-sm text-muted-foreground">Tous les dossiers présents sur la plateforme.</p>` — single-sentence lead-in. Apostrophes JSX-escaped as `&apos;` wherever they appear (none in this literal; the pattern is project-wide).
   - Below the lead-in, TWO mutually-exclusive viewports: a mobile card list (`md:hidden`) and a desktop table (`hidden md:block`). Both iterate the same `MOCK_ADMIN_DOSSIERS` fixture in array order (fixture order IS render order — same convention as [mock-dossiers.ts](apps/web/src/data/mock-dossiers.ts)).
   - Breadcrumb: NO inline breadcrumb — the global `Breadcrumbs` component at [apps/web/src/components/layout/Breadcrumbs.tsx](apps/web/src/components/layout/Breadcrumbs.tsx) renders the 2-segment trail `Admin / Dossiers` automatically (see AC7).

6. **Given** the desktop table layout (AC5 `md:block` branch), **When** the viewport is ≥ 768 px, **Then** a semantic `<table>` is rendered inside a card-chrome wrapper, with the SIX columns mandated by Epic AC1 at [epics.md:1007-1009](../planning-artifacts/epics.md#L1007-L1009) in EXACTLY this order:
   1. `Dossier` — dossier name (clickable, navigates to detail).
   2. `Entrepreneur` — `entrepreneurEmail`.
   3. `Secteur` — `sector`.
   4. `Stade` — `maturity`.
   5. `Créé` — `formatRelativeDate(createdAt)` from [apps/web/src/lib/relative-date.ts](apps/web/src/lib/relative-date.ts) (reuses the existing Story 3.1 helper — no new date formatter introduced; avoids the ICU-drift class of concern deferred from Story 3.6 at [deferred-work.md:31](deferred-work.md#L31)).
   6. `Accès actifs` — `activeShareLinksCount` (number rendered as-is via `.toString()`; cell has `tabular-nums` for column-aligned digits).
   The wrapper is `<div className="mt-8 hidden overflow-hidden rounded-lg border border-border bg-card md:block">` — same card chrome as the sector list in 5.1 AC9 and the access list at [apps/web/src/routes/dashboard/dossiers/[slug].tsx:304](apps/web/src/routes/dashboard/dossiers/[slug].tsx#L304). Table styling: `<table className="w-full text-sm">`; header row `<tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">`; each `<th scope="col" className="px-4 py-3 font-medium">{label}</th>` (the `scope="col"` is WCAG 1.3.1 required for screen-reader column association). `<tbody className="divide-y divide-border">`. No `cva` abstraction for variants — inline literals match the rule-of-three threshold (this is the first admin table; 5.3/5.4 may add more and THEN consider extraction).

7. **Given** the global `Breadcrumbs` at [apps/web/src/components/layout/Breadcrumbs.tsx](apps/web/src/components/layout/Breadcrumbs.tsx), **When** the admin user is on `/admin/dossiers`, **Then** the existing `segments.length < 2` early-return at [apps/web/src/components/layout/Breadcrumbs.tsx:32](apps/web/src/components/layout/Breadcrumbs.tsx#L32) passes (2 segments), and the breadcrumb renders `Admin / Dossiers` (NOT `Administration / Dossiers`). This requires ONE line change at [apps/web/src/components/layout/Breadcrumbs.tsx:10](apps/web/src/components/layout/Breadcrumbs.tsx#L10):
   - From: `admin: 'Administration',`
   - To:   `admin: 'Admin',`
   Epic AC3 at [epics.md:1015-1017](../planning-artifacts/epics.md#L1015-L1017) pins the literal breadcrumb as `Admin / Dossiers / Biosensio`. Story 5.1's AC11 prose also wrote "Admin" but 5.1 retained the pre-existing `'Administration'` label (harmless because 5.1 never exercised a 2+-segment admin path). 5.2 is the first story to surface this segment; the label correction is the minimal fix. See Pinned Decision #4. Impact on non-admin routes: ZERO — the `admin` key is only consumed when `/admin/*` is the active path. Impact on `/admin` (5.1): still returns null (1 segment) — label change invisible. Impact on `/admin/dossiers/:slug`: detail route opts-in to `handle: { hideBreadcrumb: true }` so the global Breadcrumbs returns null anyway; detail renders its own inline breadcrumb (AC9).

8. **Given** the mobile card list layout (AC5 `md:hidden` branch), **When** the viewport is < 768 px, **Then** a `<ul role="list" aria-label="Liste des dossiers de la plateforme" className="mt-8 flex flex-col gap-3 md:hidden">` is rendered, with one `<li>` per dossier containing a stretched `<Link>` card. Per Epic AC5 at [epics.md:1023-1025](../planning-artifacts/epics.md#L1023-L1025), each card shows THREE fields (NOT six): **name** (heading), **entrepreneurEmail**, **sector**. `maturity`, `createdAt`, and `activeShareLinksCount` are INTENTIONALLY omitted on mobile — the card is a quick-scan surface, not a monitoring table. Card markup:
   ```tsx
   <li key={d.slug} className="flex">
     <Link
       to={`/admin/dossiers/${d.slug}`}
       className="group flex min-h-11 flex-1 flex-col gap-2 rounded-lg border border-border bg-card p-4 text-left transition-colors hover:border-foreground/20 focus-visible:border-foreground/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
     >
       <h2 className="min-w-0 break-words text-base font-medium text-foreground">{d.name}</h2>
       <p className="text-xs text-muted-foreground">{d.entrepreneurEmail}</p>
       <p className="text-xs text-muted-foreground">{d.sector}</p>
     </Link>
   </li>
   ```
   The `<h2>` element is CORRECT per WCAG heading-hierarchy (page H1 is "Dossiers"; each card is a section within the list, so H2 per card is idiomatic and lets AT users navigate cards via heading-jump). The explicit `role="list"` on `<ul>` defends against Safari's default-role erasure (same defensive pattern as 5.1 AC15 bullet 5). DO NOT introduce a new `AdminDossierCard` component — inline the JSX (rule-of-three not met: this is the only consumer today; 5.3/5.4 surface different entity types). See Pinned Decision #5.

9. **Given** the admin dossier detail body at [apps/web/src/routes/admin/dossiers/[slug].tsx](apps/web/src/routes/admin/dossiers/[slug].tsx), **When** an admin user navigates to `/admin/dossiers/:slug` for a slug present in `MOCK_ADMIN_DOSSIERS`, **Then**:
   - `<title>{dossier.name} · Confluent</title>` — slug-resolved name; apostrophes auto-escaped via JSX text.
   - An inline 3-segment breadcrumb inside `<nav aria-label="Fil d'Ariane" className="mb-4">` matching the entrepreneur view at [apps/web/src/routes/dashboard/dossiers/[slug].tsx:195-214](apps/web/src/routes/dashboard/dossiers/[slug].tsx#L195-L214) but with different targets:
     - Segment 1: `<Link to="/admin">Admin</Link>` (clickable)
     - Segment 2: `<Link to="/admin/dossiers">Dossiers</Link>` (clickable)
     - Segment 3: `<span aria-current="page">{dossier.name}</span>` (current, non-link)
     Separator: `<span aria-hidden="true" className="text-muted-foreground/60">/</span>` between segments. Typography: `text-xs text-muted-foreground` + `font-medium text-foreground` on the current. Full markup pinned in AC14.
   - `<h1 ref={headingRef} tabIndex={-1} className="font-heading text-2xl font-semibold text-foreground md:text-[28px] focus-visible:outline-none">{dossier.name}</h1>` with a mount-focus effect keyed by `slug` (matches the entrepreneur detail at [apps/web/src/routes/dashboard/dossiers/[slug].tsx:106-108](apps/web/src/routes/dashboard/dossiers/[slug].tsx#L106-L108) — `useEffect(() => { headingRef.current?.focus() }, [slug])`).
   - The wrapper is `<div className="mx-auto max-w-[720px]">` — SAME max-width as the entrepreneur detail and the financeur share view at [apps/web/src/routes/share/dossier.tsx:53](apps/web/src/routes/share/dossier.tsx#L53) (reading-heavy 720 px content width per UX spec at [ux-design-specification.md:375](../planning-artifacts/ux-design-specification.md#L375)).

10. **Given** the admin-role info banner mandated by Epic AC3 at [epics.md:1015-1017](../planning-artifacts/epics.md#L1015-L1017), **When** the detail view renders, **Then** immediately BELOW the H1 and ABOVE the dossier content, an attention banner reads:
    - Exact French copy: `Vous consultez ce dossier en tant qu'administrateur.` — apostrophe JSX-escaped as `&apos;` (same convention as 5.1 AC7 lead-in).
    - Markup: `<div role="note" className="mt-4 flex items-start gap-3 rounded-md border border-border bg-muted/50 px-4 py-3 text-sm text-muted-foreground"><Info aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-foreground" /><p>Vous consultez ce dossier en tant qu&apos;administrateur.</p></div>` — `role="note"` marks it as an ancillary annotation (WAI-ARIA 1.2 — more appropriate than `role="status"` or `role="alert"`, neither of which fits a static, non-urgent, mount-time message).
    - Icon: `Info` from `lucide-react` — single named import (no wildcards); imported at the top of `[slug].tsx` alongside `Link`, `Navigate`, `useParams`.
    - Design tokens only: `bg-muted/50`, `border-border`, `text-muted-foreground`, `text-foreground` on the icon. ZERO raw hex values (AC15 grep guardrail).
    - The banner appears on EVERY admin detail render — regardless of whether the dossier has `answers` populated (AC11 fallback). This is the distinguishing marker per Epic AC3 "distinguishing it from the entrepreneur's own view"; omitting it on the empty-content branch would create a consistency gap. See Pinned Decision #6.

11. **Given** the dossier content below the info banner, **When** the detail view renders, **Then**:
    - If `dossier.answers` is defined: render the 3-section questionnaire exactly like the entrepreneur detail's Content tab at [apps/web/src/routes/dashboard/dossiers/[slug].tsx:246-271](apps/web/src/routes/dashboard/dossiers/[slug].tsx#L246-L271) — `QUESTIONNAIRE.map((section, i) => { const sectionMetas = QUESTIONNAIRE_FLAT.filter(q => q.sectionId === section.id); return <section>{i + 1}. {section.title} <dl>...<DossierField /></dl></section> })`. Both `QUESTIONNAIRE` and `QUESTIONNAIRE_FLAT` imported from `@/data/questionnaire`. Imports reused AS-IS — NO new questionnaire fixture. Spacing: `mt-8 flex flex-col gap-10` on the sections wrapper (same 40 px inter-section rhythm). Per-section `<h2 className="font-heading text-xl font-semibold text-foreground md:text-2xl">{i + 1}. {section.title}</h2>` + `<dl className="mt-4 flex flex-col gap-6">` + `<DossierField key={q.id} label={q.label} value={dossier.answers?.[q.id] ?? ''} />`.
    - If `dossier.answers` is undefined: render `<p className="mt-8 text-sm text-muted-foreground">Ce dossier n&apos;a pas encore de contenu renseigné.</p>` — EXACT byte-for-byte reuse of the entrepreneur fallback copy at [apps/web/src/routes/dashboard/dossiers/[slug].tsx:273-275](apps/web/src/routes/dashboard/dossiers/[slug].tsx#L273-L275). Consistency with entrepreneur copy is deliberate: both surfaces are reader views of the same entity, and the empty-state message is role-agnostic.
    - NO `Tabs` component — the admin read view has no analytics/content tab split (those are entrepreneur-specific). This is a single-panel read surface, matching Epic AC2 prose "read-only mode using the same `DossierField` components".

12. **Given** the admin detail route with a slug NOT present in `MOCK_ADMIN_DOSSIERS` (e.g. `/admin/dossiers/unknown-slug`), **When** the route renders, **Then** it displays an inline "introuvable" fallback BEFORE reaching the breadcrumb / H1 / banner — EXACT structural and copy parity with the entrepreneur fallback at [apps/web/src/routes/dashboard/dossiers/[slug].tsx:206-219](apps/web/src/routes/dashboard/dossiers/[slug].tsx#L206-L219):
    ```tsx
    if (!dossier) {
      return (
        <section className="mx-auto max-w-md pt-16 text-center">
          <title>Dossier introuvable · Confluent</title>
          <p className="text-sm text-muted-foreground">Dossier introuvable.</p>
          <Link
            to="/admin/dossiers"
            className="mt-4 inline-block text-sm underline hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
          >
            Retour à la liste
          </Link>
        </section>
      )
    }
    ```
    Differences from entrepreneur fallback: (a) the back link targets `/admin/dossiers` (admin list) instead of `/dashboard`; (b) the back-link label reads `Retour à la liste` (context-appropriate — "tableau de bord" is entrepreneur nomenclature). The `<title>` is BYTE-IDENTICAL to the entrepreneur fallback (`Dossier introuvable · Confluent`) — the title copy is role-agnostic.

13. **Given** the Rules-of-Hooks discipline mandated by Pinned Decision #2, **When** a developer inspects the final shape of `AdminDossierDetailRoute`, **Then** the default export is structurally identical to Story 4.4's inner-component delegation at [apps/web/src/routes/share/dossier.tsx:13-17](apps/web/src/routes/share/dossier.tsx#L13-L17):
    ```tsx
    export default function AdminDossierDetailRoute() {
      const user = useCurrentUser()           // hook #1
      if (user.role !== 'admin')              // early-return gate
        return <Navigate to="/dashboard" replace />
      return <AdminDossierDetailView />       // no hooks follow here
    }

    function AdminDossierDetailView() {
      const { slug } = useParams<…>()         // hook #2 — in the inner component
      const headingRef = useRef<…>(null)      // hook #3
      useEffect(…, [slug])                    // hook #4
      // …render
    }
    ```
    `AdminDossiersRoute` (list) has NO hooks after the guard in its default-export body (it calls `useEffect` for mount-focus, but that can equally sit inside an inner `AdminDossiersList` component — and MUST for consistency since 5.2 introduces TWO admin routes with the same guard pattern, and the pair should look identical). See Pinned Decision #2 for the shape rule.

14. **Given** the canonical snippets for the five primary edits, **When** a developer inspects the final shape of each, **Then** (deviations require explicit mention in Completion Notes):

    **[apps/web/src/data/mock-admin-dossiers.ts](apps/web/src/data/mock-admin-dossiers.ts) (NEW):**
    ```ts
    // Static mock fixture for the Story 5.2 admin dossiers list + read view.
    // Replaced by Epic 9.1's real admin dossier access endpoint (architecture.md:769-771 —
    // DossiersService.adminUpdate + admin module) when data persistence lands.

    import type { MockDossier } from './mock-dossiers'
    import { MOCK_DOSSIER_DETAIL } from './mock-dossier'

    export interface MockAdminDossier extends MockDossier {
      readonly entrepreneurEmail: string
      readonly answers?: Readonly<Record<string, string>>
    }

    export const MOCK_ADMIN_DOSSIERS: readonly MockAdminDossier[] = [
      {
        slug: 'biosensio',
        name: 'Biosensio',
        sector: 'DeepTech',
        maturity: 'Pre-seed',
        activeShareLinksCount: 2,
        createdAt: '2026-04-18T09:00:00.000Z',
        entrepreneurEmail: 'sophie@biosensio.fr',
        answers: MOCK_DOSSIER_DETAIL.answers,
      },
      {
        slug: 'agrotrack',
        name: 'Agrotrack',
        sector: 'AgriTech',
        maturity: 'Amorçage',
        activeShareLinksCount: 0,
        createdAt: '2026-04-10T14:30:00.000Z',
        entrepreneurEmail: 'lucas@agrotrack.fr',
      },
      {
        slug: 'neuroflow',
        name: 'NeuroFlow',
        sector: 'Fintech',
        maturity: 'Série A',
        activeShareLinksCount: 5,
        createdAt: '2026-03-02T11:00:00.000Z',
        entrepreneurEmail: 'anna@neuroflow.io',
      },
      {
        slug: 'heliosfarm',
        name: 'HeliosFarm',
        sector: 'AgriTech',
        maturity: 'Idée',
        activeShareLinksCount: 0,
        createdAt: '2026-04-15T08:00:00.000Z',
        entrepreneurEmail: 'marc@heliosfarm.fr',
      },
      {
        slug: 'quillo',
        name: 'Quillo',
        sector: 'Autre',
        maturity: 'Pre-seed',
        activeShareLinksCount: 1,
        createdAt: '2026-02-14T16:45:00.000Z',
        entrepreneurEmail: 'lea@quillo.eu',
      },
    ] as const
    ```

    **[apps/web/src/routes/admin/dossiers/index.tsx](apps/web/src/routes/admin/dossiers/index.tsx) (NEW):**
    ```tsx
    import { useEffect, useRef } from 'react'
    import { Link, Navigate } from 'react-router-dom'
    import { useCurrentUser } from '@/features/current-user/context'
    import { MOCK_ADMIN_DOSSIERS } from '@/data/mock-admin-dossiers'
    import { formatRelativeDate } from '@/lib/relative-date'
    import { cn } from '@/lib/utils'

    export default function AdminDossiersRoute() {
      const user = useCurrentUser()
      if (user.role !== 'admin') return <Navigate to="/dashboard" replace />
      return <AdminDossiersList />
    }

    function AdminDossiersList() {
      const headingRef = useRef<HTMLHeadingElement>(null)
      useEffect(() => {
        headingRef.current?.focus()
      }, [])

      return (
        <>
          <title>Dossiers · Confluent</title>
          <h1
            ref={headingRef}
            tabIndex={-1}
            className="font-heading text-2xl font-semibold text-foreground md:text-[28px] focus-visible:outline-none"
          >
            Dossiers
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Tous les dossiers présents sur la plateforme.
          </p>

          <ul
            role="list"
            aria-label="Liste des dossiers de la plateforme"
            className="mt-8 flex flex-col gap-3 md:hidden"
          >
            {MOCK_ADMIN_DOSSIERS.map((d) => (
              <li key={d.slug} className="flex">
                <Link
                  to={`/admin/dossiers/${d.slug}`}
                  className="group flex min-h-11 flex-1 flex-col gap-2 rounded-lg border border-border bg-card p-4 text-left transition-colors hover:border-foreground/20 focus-visible:border-foreground/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
                >
                  <h2 className="min-w-0 break-words text-base font-medium text-foreground">
                    {d.name}
                  </h2>
                  <p className="text-xs text-muted-foreground">{d.entrepreneurEmail}</p>
                  <p className="text-xs text-muted-foreground">{d.sector}</p>
                </Link>
              </li>
            ))}
          </ul>

          <div className="mt-8 hidden overflow-hidden rounded-lg border border-border bg-card md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                  <th scope="col" className="px-4 py-3 font-medium">Dossier</th>
                  <th scope="col" className="px-4 py-3 font-medium">Entrepreneur</th>
                  <th scope="col" className="px-4 py-3 font-medium">Secteur</th>
                  <th scope="col" className="px-4 py-3 font-medium">Stade</th>
                  <th scope="col" className="px-4 py-3 font-medium">Créé</th>
                  <th scope="col" className="px-4 py-3 font-medium">Accès actifs</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {MOCK_ADMIN_DOSSIERS.map((d) => (
                  <tr
                    key={d.slug}
                    className="relative transition-colors hover:bg-muted/50 focus-within:bg-muted/50"
                  >
                    <td className="px-4 py-3">
                      <Link
                        to={`/admin/dossiers/${d.slug}`}
                        className={cn(
                          'rounded-sm font-medium text-foreground',
                          'after:absolute after:inset-0 after:content-[""]',
                          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]',
                        )}
                      >
                        {d.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{d.entrepreneurEmail}</td>
                    <td className="px-4 py-3 text-muted-foreground">{d.sector}</td>
                    <td className="px-4 py-3 text-muted-foreground">{d.maturity}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {formatRelativeDate(d.createdAt)}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-muted-foreground">
                      {d.activeShareLinksCount}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )
    }
    ```

    **[apps/web/src/routes/admin/dossiers/[slug].tsx](apps/web/src/routes/admin/dossiers/[slug].tsx) (NEW):**
    ```tsx
    import { useEffect, useRef } from 'react'
    import { Info } from 'lucide-react'
    import { Link, Navigate, useParams } from 'react-router-dom'
    import { DossierField } from '@/components/confluent/DossierField'
    import { QUESTIONNAIRE, QUESTIONNAIRE_FLAT } from '@/data/questionnaire'
    import { MOCK_ADMIN_DOSSIERS } from '@/data/mock-admin-dossiers'
    import { useCurrentUser } from '@/features/current-user/context'

    export default function AdminDossierDetailRoute() {
      const user = useCurrentUser()
      if (user.role !== 'admin') return <Navigate to="/dashboard" replace />
      return <AdminDossierDetailView />
    }

    function AdminDossierDetailView() {
      const { slug } = useParams<{ slug: string }>()
      const headingRef = useRef<HTMLHeadingElement>(null)
      const dossier = slug
        ? MOCK_ADMIN_DOSSIERS.find((d) => d.slug === slug)
        : undefined

      useEffect(() => {
        headingRef.current?.focus()
      }, [slug])

      if (!dossier) {
        return (
          <section className="mx-auto max-w-md pt-16 text-center">
            <title>Dossier introuvable · Confluent</title>
            <p className="text-sm text-muted-foreground">Dossier introuvable.</p>
            <Link
              to="/admin/dossiers"
              className="mt-4 inline-block text-sm underline hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
            >
              Retour à la liste
            </Link>
          </section>
        )
      }

      return (
        <div className="mx-auto max-w-[720px]">
          <title>{dossier.name} · Confluent</title>

          <nav aria-label="Fil d'Ariane" className="mb-4">
            <ol className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              <li>
                <Link
                  to="/admin"
                  className="rounded-sm hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
                >
                  Admin
                </Link>
              </li>
              <li className="flex items-center gap-1.5">
                <span aria-hidden="true" className="text-muted-foreground/60">
                  /
                </span>
                <Link
                  to="/admin/dossiers"
                  className="rounded-sm hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
                >
                  Dossiers
                </Link>
              </li>
              <li className="flex items-center gap-1.5">
                <span aria-hidden="true" className="text-muted-foreground/60">
                  /
                </span>
                <span aria-current="page" className="font-medium text-foreground">
                  {dossier.name}
                </span>
              </li>
            </ol>
          </nav>

          <h1
            ref={headingRef}
            tabIndex={-1}
            className="font-heading text-2xl font-semibold text-foreground md:text-[28px] focus-visible:outline-none"
          >
            {dossier.name}
          </h1>

          <div
            role="note"
            className="mt-4 flex items-start gap-3 rounded-md border border-border bg-muted/50 px-4 py-3 text-sm text-muted-foreground"
          >
            <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-foreground" />
            <p>Vous consultez ce dossier en tant qu&apos;administrateur.</p>
          </div>

          {dossier.answers ? (
            <div className="mt-8 flex flex-col gap-10">
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
                          value={dossier.answers?.[q.id] ?? ''}
                        />
                      ))}
                    </dl>
                  </section>
                )
              })}
            </div>
          ) : (
            <p className="mt-8 text-sm text-muted-foreground">
              Ce dossier n&apos;a pas encore de contenu renseigné.
            </p>
          )}
        </div>
      )
    }
    ```

    **[apps/web/src/router.tsx](apps/web/src/router.tsx) (MODIFIED — +2 imports, +2 route entries):**
    ```tsx
    // Imports section (append to existing admin import):
    import AdminRoute from '@/routes/admin'
    import AdminDossiersRoute from '@/routes/admin/dossiers'
    import AdminDossierDetailRoute from '@/routes/admin/dossiers/[slug]'

    // Router children section (new entries appear immediately after the existing
    // { path: 'admin', element: <AdminRoute /> } line and BEFORE the catch-all):
    { path: 'admin', element: <AdminRoute /> },
    { path: 'admin/dossiers', element: <AdminDossiersRoute /> },
    {
      path: 'admin/dossiers/:slug',
      element: <AdminDossierDetailRoute />,
      handle: { hideBreadcrumb: true },
    },
    { path: '*', element: <NotFoundRoute /> },
    ```

    **[apps/web/src/components/layout/Breadcrumbs.tsx](apps/web/src/components/layout/Breadcrumbs.tsx) (MODIFIED — single line):**
    ```ts
    const SEGMENT_LABELS: Record<string, string> = {
      dashboard: 'Mes dossiers',
      'tableau-de-bord': 'Tableau de bord',
      dossiers: 'Dossiers',
      nouveau: 'Nouveau',
      admin: 'Admin',  // was 'Administration' — Epic 5.2 AC3 pins 'Admin'
    }
    ```

15. **Given** the verification sweep, **When** a developer runs the grep guardrails, **Then**:
    - `grep -nE '#[0-9a-fA-F]{3,6}' apps/web/src/data/mock-admin-dossiers.ts apps/web/src/routes/admin/dossiers/index.tsx apps/web/src/routes/admin/dossiers/\[slug\].tsx apps/web/src/router.tsx apps/web/src/components/layout/Breadcrumbs.tsx` → ZERO matches.
    - `grep -n "admin/dossiers" apps/web/src/router.tsx` → EXACTLY 2 matches (the two new route `path:` values). The string `admin/dossiers` does NOT appear anywhere else in `router.tsx`.
    - `grep -n "Navigate to=\"/dashboard\" replace" apps/web/src/routes/admin/dossiers/index.tsx apps/web/src/routes/admin/dossiers/\[slug\].tsx` → EXACTLY 2 matches (1 per file — the inline role guard).
    - `grep -n "tant qu&apos;administrateur" apps/web/src/routes/admin/dossiers/\[slug\].tsx` → EXACTLY 1 match (the info banner copy).
    - `grep -n "role=\"note\"" apps/web/src/routes/admin/dossiers/\[slug\].tsx` → EXACTLY 1 match (the info banner).
    - `grep -n "MOCK_ADMIN_DOSSIERS" apps/web/src/data/mock-admin-dossiers.ts apps/web/src/routes/admin/dossiers/index.tsx apps/web/src/routes/admin/dossiers/\[slug\].tsx` → EXACTLY 3 matches (1 export + 2 imports/reads).
    - `grep -n "'Administration'" apps/web/src/components/layout/Breadcrumbs.tsx` → ZERO matches (the string was replaced by `'Admin'`).
    - `grep -n "'Admin'" apps/web/src/components/layout/Breadcrumbs.tsx` → EXACTLY 1 match (the `admin` key's new value).
    - `grep -n "import\s*\*\s*as" apps/web/src/data/mock-admin-dossiers.ts apps/web/src/routes/admin/dossiers/index.tsx apps/web/src/routes/admin/dossiers/\[slug\].tsx` → ZERO matches (no wildcard imports from lucide-react or elsewhere — tree-shaking protected).
    - `pnpm --filter @confluent/web typecheck` → exits 0.
    - `pnpm --filter @confluent/web lint` → exits 0. Expected warning count: 5 (the baseline from Story 5.1's Completion Note #1 — same class: `react-refresh/only-export-components` in `badge.tsx:52`, `button.tsx:58`, and 3 sites in `context.tsx` for the provider+non-component exports). If a NEW warning class appears OR the count exceeds 5, investigate before marking complete.
    - `pnpm turbo run build` → all packages GREEN. Expected bundle delta against the 5.1 baseline of `628.26 KB / 197.46 KB gz`: ≤ +3 KB gz. Sources of growth: `mock-admin-dossiers.ts` (~60 LOC, ~0.4 KB gz); `admin/dossiers/index.tsx` (~90 LOC, ~1.2 KB gz); `admin/dossiers/[slug].tsx` (~110 LOC, ~1.5 KB gz); one new lucide-react icon (`Info`, ~0.4 KB gz); router 2-entry + 2-import addition (~0.1 KB gz); Breadcrumbs one-line label change (negligible). If the delta exceeds 5 KB gz, audit for accidental barrel imports or dead-code inclusion.

16. **Given** no regression across Stories 1.1 – 5.1, **When** the dev agent completes 5.2, **Then** with the default hardcoded user (entrepreneur, `sessionStorage.getItem('confluent_dev_role')` returns null or `'entrepreneur'`):
    - `/dashboard` (Stories 2.2, 3.1) unchanged — DossierCard list and empty state intact.
    - `/dashboard/dossiers/nouveau` → `questionnaire` → `recapitulatif` (Stories 2.3–2.6) wizard flow unchanged.
    - `/dashboard/dossiers/view/:slug` (Stories 3.2–3.6) unchanged — tabs, analytics, SharePanel, RevokeAccessDialog intact. Global Breadcrumbs return null (`handle: { hideBreadcrumb: true }` — unchanged).
    - `/share/:token` and `/share/:token/dossier` (Stories 4.1–4.4) unchanged. `/share/<invalid>` still renders `AccessDeniedPage`.
    - `/auth` (Story 1.3 stub) unchanged.
    - `/admin` (Story 5.1) unchanged — same Pipeline dashboard, same role guard, entrepreneur redirect still works. Breadcrumbs still return null on `/admin` (1 segment — the `admin` label change from 'Administration' → 'Admin' is invisible at depth 1).
    - **`/admin/dossiers` with default entrepreneur user**: redirects to `/dashboard` (replace) — same guard pattern as 5.1 AC6.
    - **`/admin/dossiers/:slug` with default entrepreneur user**: redirects to `/dashboard` (replace) — same guard pattern.
    - Entrepreneur sidebar still shows 2 items ("Mes dossiers" and "Tableau de bord"); admin nav items NOT visible to entrepreneurs (role-gated selection in AppShell).
    - `apps/web/src/routes/admin/index.tsx` (Story 5.1) UNCHANGED.
    - `apps/web/src/components/layout/AppShell.tsx` UNCHANGED (no shell changes in 5.2 — all prop-threading landed in 5.1).
    - `apps/web/src/components/layout/nav-items.ts` UNCHANGED — the 5.1 stub entry for `{ to: '/admin/dossiers', label: 'Dossiers', icon: FolderOpen }` is the SAME entry 5.2 activates; no nav-item edits required.
    - `apps/web/src/features/current-user/context.tsx` UNCHANGED.
    - `apps/web/src/components/confluent/*` UNCHANGED (no new primitive added; `DossierField` consumed as-is).
    - `apps/web/src/components/ui/*` UNCHANGED (no new shadcn primitive consumed).
    - `apps/web/src/data/mock-dossiers.ts`, `mock-dossier.ts`, `mock-analytics.ts`, `mock-tokens.ts`, `mock-admin-pipeline.ts`, `questionnaire.ts` UNCHANGED.
    - 5.1's 5-warning lint baseline preserved — no new warning class.
    - No new npm dependency (`lucide-react` + `react-router-dom` already in [apps/web/package.json](apps/web/package.json); `Info` icon is a named import alongside the 4 already imported in 5.1).

17. **Given** the admin-mode manual walkthrough (admin user via `?as=admin` once), **When** the dev agent or reviewer navigates, **Then**:
    - Open `http://localhost:5173/admin/dossiers?as=admin` → URL strips to `http://localhost:5173/admin/dossiers`; sessionStorage `confluent_dev_role=admin`; admin sidebar shows 4 items with "Dossiers" highlighted (`aria-current="page"` via `NavLink` default). Breadcrumb reads "Admin / Dossiers". H1 reads "Dossiers". Lead-in reads "Tous les dossiers présents sur la plateforme." At ≥ 768 px: table with 5 rows (Biosensio / Agrotrack / NeuroFlow / HeliosFarm / Quillo) and 6 columns (Dossier, Entrepreneur, Secteur, Stade, Créé, Accès actifs). Column header "Accès actifs" right-aligned digits via `tabular-nums`. `<title>` is "Dossiers · Confluent".
    - Click any row's dossier name link (or anywhere on the row — stretched-link overlay) → navigates to `/admin/dossiers/<slug>`.
    - On `/admin/dossiers/biosensio`: `<title>` reads "Biosensio · Confluent"; inline breadcrumb reads "Admin / Dossiers / Biosensio" with the first two as clickable links; H1 "Biosensio" (focused on mount); info banner with `Info` icon reads "Vous consultez ce dossier en tant qu'administrateur."; below, the 3-section questionnaire with all 12 DossierField entries populated from `MOCK_DOSSIER_DETAIL.answers`.
    - On `/admin/dossiers/agrotrack` (no `answers`): same title / breadcrumb / H1 / banner — but content area shows "Ce dossier n'a pas encore de contenu renseigné." (single muted sentence, no sections).
    - On `/admin/dossiers/unknown-slug-abc123`: inline "introuvable" fallback renders (title "Dossier introuvable · Confluent", muted sentence, "Retour à la liste" link back to `/admin/dossiers`). The admin shell (4-item sidebar) is still rendered.
    - Resize to 375 px (iPhone SE): list page switches to card layout — 5 cards, each showing name / entrepreneurEmail / sector only. Each card has `min-h-11` touch height. Detail page breadcrumb wraps if needed; info banner icon+text stacks cleanly within the `flex items-start` layout. Bottom nav shows 4 admin icons at ~25 % width each (same as 5.1).
    - Resize to 768 px (iPad): list page switches to table; TabletRail shows 4 admin icons vertically. Detail page max-width 720 px content.
    - Resize to 1440 px: full 240 px admin sidebar with labeled links; list table uses full content width; detail still capped at 720 px.
    - Tab-navigate the list page: skip link → sidebar entries (4) → first row link → second row link → …fifth row link. Focus ring visible on every `<Link>`. `focus-within:bg-muted/50` highlights the focused row.
    - Tab-navigate the detail page: skip link → sidebar entries (4) → breadcrumb "Admin" link → breadcrumb "Dossiers" link → (current segment is not focusable) → no other links beyond the answers (DossierField is a `<dt>/<dd>` pair — non-interactive). Focus ring visible.
    - VoiceOver / NVDA (if available): list page announces `<table>` with 6 columns × 5 rows + "Liste des dossiers de la plateforme" (aria-label). Each row announces in reading order. On mobile, announces the `<h2>` per card (5 heading jumps). Detail page announces "Fil d'Ariane, liste de 3 éléments" → H1 → `role="note"` ancillary note with its text → 3 H2 sections with DossierField dt/dd pairs inside `<dl>`.
    - Verify the new tab behavior: open a fresh tab → navigate to `/admin/dossiers` → redirects to `/dashboard` (per-tab sessionStorage isolation, inherited from 5.1 Pinned Decision #8).

## Tasks / Subtasks

- [x] **Task 1: Mock admin dossiers fixture (AC: 4, 14)**
  - [x] Create [apps/web/src/data/mock-admin-dossiers.ts](apps/web/src/data/mock-admin-dossiers.ts) using the AC14 canonical snippet verbatim.
  - [x] Exports: `MockAdminDossier` (interface extending `MockDossier`), `MOCK_ADMIN_DOSSIERS` (typed `as const`).
  - [x] File header references Epic 9.1 real-API replacement.
  - [x] Biosensio's `answers` is imported from `MOCK_DOSSIER_DETAIL.answers` (NOT duplicated) per AC4.
  - [x] Exactly 5 entries; sectors: DeepTech, AgriTech, Fintech, AgriTech, Autre (4 distinct); maturities: Pre-seed, Amorçage, Série A, Idée, Pre-seed (4 distinct).
  - [x] `pnpm --filter @confluent/web typecheck` exits 0.

- [x] **Task 2: Admin dossiers list route (AC: 3, 5, 6, 8, 13, 14)**
  - [x] Create [apps/web/src/routes/admin/dossiers/index.tsx](apps/web/src/routes/admin/dossiers/index.tsx) using the AC14 canonical snippet verbatim.
  - [x] Default export `AdminDossiersRoute` (NOT named) — router default-imports at AC2.
  - [x] Inner component `AdminDossiersList` hosts all hooks (AC13 consistency with detail route).
  - [x] Role guard: `if (user.role !== 'admin') return <Navigate to="/dashboard" replace />` — matches 5.1 AC6 shape.
  - [x] Mobile card list (`md:hidden`) shows EXACTLY 3 fields per card (name / entrepreneurEmail / sector — AC8 Epic AC5 pin).
  - [x] Desktop table (`hidden md:block`) has EXACTLY 6 columns in the Epic AC1 order (AC6).
  - [x] Table row uses stretched-link overlay (`after:absolute after:inset-0`) for full-row click target.
  - [x] `formatRelativeDate(createdAt)` in the "Créé" column — reuses the existing helper.
  - [x] `pnpm --filter @confluent/web typecheck` exits 0.

- [x] **Task 3: Admin dossier detail route (AC: 3, 9, 10, 11, 12, 13, 14)**
  - [x] Create [apps/web/src/routes/admin/dossiers/[slug].tsx](apps/web/src/routes/admin/dossiers/[slug].tsx) using the AC14 canonical snippet verbatim.
  - [x] Default export `AdminDossierDetailRoute` uses the 4.4 inner-component delegation pattern (AC13).
  - [x] Inline 3-segment breadcrumb (Admin → Dossiers → current) mirrors entrepreneur inline pattern at [apps/web/src/routes/dashboard/dossiers/[slug].tsx:195-214](apps/web/src/routes/dashboard/dossiers/[slug].tsx#L195-L214).
  - [x] Info banner with `Info` icon + `role="note"` + exact French copy (AC10).
  - [x] Content branches on `dossier.answers`: populated → 3-section questionnaire + DossierField list; undefined → single "pas encore de contenu" muted paragraph (AC11).
  - [x] Unknown-slug fallback renders "Dossier introuvable" + "Retour à la liste" link (AC12).
  - [x] H1 mount-focus effect keyed by `[slug]` (matches entrepreneur detail at [apps/web/src/routes/dashboard/dossiers/[slug].tsx:106-108](apps/web/src/routes/dashboard/dossiers/[slug].tsx#L106-L108)).
  - [x] `pnpm --filter @confluent/web typecheck` exits 0.

- [x] **Task 4: Router registration (AC: 1, 2)**
  - [x] Modify [apps/web/src/router.tsx](apps/web/src/router.tsx):
    - [x] Add TWO new imports (`AdminDossiersRoute`, `AdminDossierDetailRoute`) after the existing `AdminRoute` import at line 9.
    - [x] Add TWO new route entries after the existing `{ path: 'admin', ... }` entry at line 44, BEFORE the catch-all at line 45.
    - [x] Detail route carries `handle: { hideBreadcrumb: true }` so the global Breadcrumbs suppresses on the 3-segment path (detail renders its own inline trail).
  - [x] Verify no other lines in `router.tsx` change.
  - [x] `pnpm --filter @confluent/web typecheck` exits 0.

- [x] **Task 5: Breadcrumbs label correction (AC: 7, 14)**
  - [x] Modify [apps/web/src/components/layout/Breadcrumbs.tsx:10](apps/web/src/components/layout/Breadcrumbs.tsx#L10): change `admin: 'Administration'` to `admin: 'Admin'` — single-line edit.
  - [x] Verify no other lines change — the `segments.length < 2` early-return at line 32, the `hideBreadcrumb` handle suppression, and all other segment labels are UNCHANGED.
  - [x] `pnpm --filter @confluent/web typecheck` exits 0.

- [x] **Task 6: Verification sweep — typecheck, lint, build, grep, manual walkthrough (AC: 15, 16, 17)**
  - [x] `pnpm --filter @confluent/web typecheck` — exits 0.
  - [x] `pnpm --filter @confluent/web lint` — exits 0. 5-warning baseline preserved (no new warning class).
  - [x] `pnpm turbo run build` — all packages GREEN. Bundle: `635.31 KB / 198.41 KB gz`. Delta vs 5.1 baseline (`628.26 KB / 197.46 KB gz`): **+7.05 KB / +0.95 KB gz**. Gz delta well under the +3 KB target.
  - [x] Run the AC15 grep battery — every assertion passes except two count-imprecisions. _See Completion Note #1._
  - [ ] Manual browser walkthrough (AC17) — **Deferred** (headless environment). _See Completion Note #2._
  - [x] On each task landed, mark the corresponding Tasks/Subtasks checkbox above.

- [x] **Task 7: Sprint status housekeeping (AC: none — workflow housekeeping)**
  - [x] When story implementation is complete, update [sprint-status.yaml](sprint-status.yaml):
    - [x] `development_status.5-2-admin-all-dossiers-list`: `ready-for-dev` → `in-progress` → `review` (post-code-review will be `done`).
    - [x] `last_updated`: current date.
  - [x] Preserve every comment in the file (STATUS DEFINITIONS block, header).
  - [x] Story Status: flipped `ready-for-dev` → `review`.

### Review Findings

_Code review 2026-04-22 — 3 review layers (Blind Hunter, Edge Case Hunter, Acceptance Auditor). **Auditor: 0 AC violations.** 0 decision-needed, 0 patches, 5 deferred (pre-existing or outside-of-spec), 25 dismissed as spec-mandated or mock-only noise._

- [x] [Review][Defer] Role switch mid-session leaves `user` state stale [[apps/web/src/features/current-user/context.tsx](../../../../../apps/web/src/features/current-user/context.tsx)] — deferred, pre-existing (Epic 6.3 JWT/real-auth replaces the dev-role mechanism).
- [x] [Review][Defer] Desktop table stretched-link focus ring sits on the name text, not the full row hit-area [[apps/web/src/routes/admin/dossiers/index.tsx](../../../../../apps/web/src/routes/admin/dossiers/index.tsx)] — deferred, pre-existing pattern reused from the entrepreneur dashboard table; dedicated a11y-polish pass.
- [x] [Review][Defer] Admin desktop `<table>` has no accessible name (no `<caption>` / `aria-label`) [[apps/web/src/routes/admin/dossiers/index.tsx](../../../../../apps/web/src/routes/admin/dossiers/index.tsx)] — deferred, minor a11y polish; mobile `<ul>` already carries `aria-label="Liste des dossiers de la plateforme"`.
- [x] [Review][Defer] `dossier.answers` truthy-check treats empty object `{}` as populated (would render empty questionnaire instead of fallback copy) [[apps/web/src/routes/admin/dossiers/[slug].tsx](../../../../../apps/web/src/routes/admin/dossiers/%5Bslug%5D.tsx)] — deferred, latent; current fixture never exercises the empty-object case (biosensio populated, others undefined).
- [x] [Review][Defer] Unknown-slug fallback has no heading, so the mount-focus effect no-ops and AT focus stays wherever it was [[apps/web/src/routes/admin/dossiers/[slug].tsx](../../../../../apps/web/src/routes/admin/dossiers/%5Bslug%5D.tsx)] — deferred, pre-existing parity pattern with entrepreneur detail fallback; dedicated a11y-polish pass.

## Dev Notes

### Critical Architecture Constraints

- **Two new admin routes only — NOT four.** Epic 5 has four planned admin routes (`/admin`, `/admin/dossiers`, `/admin/questionnaire`, `/admin/utilisateurs`); 5.2 activates ONLY the `/admin/dossiers` + `/admin/dossiers/:slug` pair. The other two continue to fall through to `NotFoundRoute` (the `/admin/questionnaire` and `/admin/utilisateurs` stubs in the admin sidebar at [apps/web/src/components/layout/nav-items.ts:21-22](apps/web/src/components/layout/nav-items.ts#L21-L22) remain forward-references per 5.1 Pinned Decision #1). See Pinned Decision #1 below.
- **Inline role guard on each new admin route, NOT a wrapper.** Story 5.1 Pinned Decision #4 deferred the `<RequireRole>` wrapper question to "5.2's spec author". Decision: STAY INLINE. Rationale: (a) each inline guard is 2 lines — no meaningful duplication reduction; (b) extracting a wrapper would require touching Story 5.1's `admin/index.tsx` to adopt the new pattern, generating churn on already-reviewed code; (c) Epic 6.3 will replace the entire dev-role impersonation mechanism with JWT + real guard infrastructure, making the abstraction a short-lived decoration. See Pinned Decision #2 for the Rules-of-Hooks shape that each admin route MUST follow.
- **Detail route uses the 4.4 inner-component delegation pattern.** Because the detail's body calls hooks AFTER the role guard (`useParams`, `useRef`, `useEffect`), the default export MUST NOT contain those hooks alongside the early-return — that would violate the Rules of Hooks conditionally. The pattern: default export does `useCurrentUser + if/return`, then `return <AdminDossierDetailView />`. All subsequent hooks live inside `AdminDossierDetailView`. This is the exact pattern from Story 4.4's `ShareDossierRoute → ShareDossierView` at [apps/web/src/routes/share/dossier.tsx:13-17](apps/web/src/routes/share/dossier.tsx#L13-L17). See Pinned Decision #2.
- **List route is symmetric with the detail route.** Even though the list body's only hooks are `useRef + useEffect` (arguably fine at the top level), the list route ALSO uses the inner-component pattern (`AdminDossiersRoute → AdminDossiersList`) for symmetry. Two admin routes with the same guard should look identical to minimize cognitive load on future maintainers and 5.3/5.4 authors who will copy this shape. See Pinned Decision #2.
- **Biosensio is the canonical cross-role dossier; DO NOT duplicate its answers.** Entrepreneur `/dashboard/dossiers/view/biosensio`, financeur `/share/:valid-token/dossier`, and admin `/admin/dossiers/biosensio` all render content sourced (directly or indirectly) from `MOCK_DOSSIER_DETAIL.answers` at [apps/web/src/data/mock-dossier.ts:7-35](apps/web/src/data/mock-dossier.ts#L7-L35). The admin fixture IMPORTS `MOCK_DOSSIER_DETAIL.answers` for the biosensio entry — no hand-maintained duplicate. Divergence would be a bug, not a feature. See Pinned Decision #3.
- **Breadcrumb label is 'Admin', not 'Administration'.** Story 5.1 retained the pre-existing `SEGMENT_LABELS['admin'] = 'Administration'` (which was introduced at some earlier sprint as a reasonable French label). 5.2 exercises the first 2+-segment admin path, surfacing the conflict with Epic 5.2 AC3's literal "Admin / Dossiers / Biosensio". Resolution: update the map value to 'Admin'. Zero regression — depth 1 `/admin` still returns null (suppression), and no non-admin path uses the `admin` key. See Pinned Decision #4.
- **No new design-system primitives in 5.2.** `DossierField`, `MetricCard` (not used here), breadcrumb markup, card chrome, table wrapper — all use existing patterns. `Info` icon (lucide-react) is the only new imported token. No shadcn/ui primitive added (no `Alert`, no `Table`, no `Card` component). Rationale: rule-of-three — 5.2 has ONE admin table and ONE admin info banner. Promotion to shared primitives would be premature. See Pinned Decision #5.
- **Info banner uses `role="note"` — not `role="status"` or `role="alert"`.** ARIA live-region roles (`status`, `alert`) are for runtime-injected content that needs screen-reader interruption (e.g., toast success/error). The admin banner is static, mount-time, non-urgent annotation — WAI-ARIA 1.2 `note` is the semantic match. See Pinned Decision #6.
- **Mobile card shows 3 fields only (per Epic AC5), NOT 6.** Epic AC5 at [epics.md:1023-1025](../planning-artifacts/epics.md#L1023-L1025) explicitly limits the mobile card to name / entrepreneur / sector. `maturity`, `createdAt`, `activeShareLinksCount` are intentionally dropped on mobile — these are monitoring fields the admin reads on a desktop table. Same spirit as UX spec at [ux-design-specification.md:722](../planning-artifacts/ux-design-specification.md#L722): "Admin back-office — not optimized — desktop-only usage acceptable".
- **Use `formatRelativeDate` for the 'Créé' column — NOT `toLocaleDateString`.** The `formatRelativeDate` helper at [apps/web/src/lib/relative-date.ts](apps/web/src/lib/relative-date.ts) is the project's single-source date renderer (used by DossierCard in Story 3.1). Reusing it avoids the ICU-drift class of concern deferred from Story 3.6 at [deferred-work.md:31](deferred-work.md#L31) where `toLocaleDateString('fr-FR', { month: 'short' })` emits different glyphs across Node/Chromium/WebKit ICU builds.
- **Design tokens only — no raw hex.** Every color comes from `index.css` custom properties. AC15 grep is the automated guardrail.
- **WCAG 2.1 AA baseline.** Per UX spec at [ux-design-specification.md:731](../planning-artifacts/ux-design-specification.md#L731). Table uses `<th scope="col">` for column-header association; mobile cards use `<h2>` per card for heading navigation; info banner uses `role="note"`; breadcrumb uses `<nav aria-label="Fil d'Ariane">`.

### Design Tokens to Use

| Surface | Tailwind utility | Value | Where |
|---|---|---|---|
| Page background | `bg-background` (via AppShell `<main>`) | `#FAFAF9` | inherited |
| Card / table wrapper bg | `bg-card` | `#FFFFFF` | mobile card + desktop table wrapper |
| Card / table border | `border-border` / `divide-border` | `#E8E8E7` | card frame + table header separator + tbody row separators |
| Heading text | `text-foreground` | `#1A1A1A` | H1 / H2 / linked cell name / breadcrumb current |
| Muted text | `text-muted-foreground` | `#6B6B6B` | lead-in `<p>`, table `<td>`, card body, breadcrumb ancestors |
| Info banner bg | `bg-muted/50` | `#F4F4F3` @ 50 % | admin read-mode note |
| Info banner icon | `text-foreground` | `#1A1A1A` | `Info` icon color |
| Row hover | `hover:bg-muted/50` | `#F4F4F3` @ 50 % | desktop table `<tr>` |
| Row focus-within | `focus-within:bg-muted/50` | `#F4F4F3` @ 50 % | desktop table `<tr>` during keyboard focus |
| Focus ring | `focus-visible:outline-[var(--ring)]` | `#1A1A1A @ 40 %` (token) | all interactive elements |
| H1 typography | `font-heading text-2xl font-semibold md:text-[28px]` | 24 → 28 px @ ≥md | H1 on list + detail |
| H2 typography | `font-heading text-xl font-semibold md:text-2xl` | 20 → 24 px @ ≥md | questionnaire section on detail |
| Table header | `text-[11px] uppercase tracking-wider text-muted-foreground font-medium` | 11 px | `<th>` |
| Monospace numerics | `tabular-nums` | — | `Accès actifs` column + relative-date cell |
| Mobile card wrapper | `rounded-lg border border-border bg-card p-4` | 8-px radius | `<li> > <Link>` |

### Component Prop Contracts

```tsx
// apps/web/src/data/mock-admin-dossiers.ts (NEW)
export interface MockAdminDossier extends MockDossier {
  readonly entrepreneurEmail: string
  readonly answers?: Readonly<Record<string, string>>
}
export const MOCK_ADMIN_DOSSIERS: readonly MockAdminDossier[]

// apps/web/src/routes/admin/dossiers/index.tsx (NEW)
export default function AdminDossiersRoute(): JSX.Element
// — no props; delegates to inner AdminDossiersList after role guard
function AdminDossiersList(): JSX.Element
// — no props; renders mobile card list + desktop table from MOCK_ADMIN_DOSSIERS

// apps/web/src/routes/admin/dossiers/[slug].tsx (NEW)
export default function AdminDossierDetailRoute(): JSX.Element
// — no props; delegates to inner AdminDossierDetailView after role guard
function AdminDossierDetailView(): JSX.Element
// — no props; consumes useParams<{ slug }>() + MOCK_ADMIN_DOSSIERS + QUESTIONNAIRE + DossierField

// apps/web/src/router.tsx (MODIFIED — +2 route entries + 2 imports)

// apps/web/src/components/layout/Breadcrumbs.tsx (MODIFIED — 1 line in SEGMENT_LABELS)
```

### File Layout (target)

```
apps/web/src/
├── components/
│   ├── confluent/                                     [UNCHANGED]
│   ├── layout/
│   │   ├── AppShell.tsx                               [UNCHANGED]
│   │   ├── Breadcrumbs.tsx                            [MODIFIED — 'admin' label]
│   │   ├── NavItem.tsx                                [UNCHANGED]
│   │   └── nav-items.ts                               [UNCHANGED]
│   └── ui/                                            [UNCHANGED]
├── data/
│   ├── mock-admin-dossiers.ts                         [NEW — list + read-view fixture]
│   ├── mock-admin-pipeline.ts                         [UNCHANGED]
│   ├── mock-analytics.ts                              [UNCHANGED]
│   ├── mock-dossier.ts                                [UNCHANGED — answers imported by fixture above]
│   ├── mock-dossiers.ts                               [UNCHANGED — MockDossier interface extended by admin]
│   ├── mock-tokens.ts                                 [UNCHANGED]
│   └── questionnaire.ts                               [UNCHANGED — consumed by detail view]
├── features/
│   └── current-user/
│       └── context.tsx                                [UNCHANGED]
├── routes/
│   ├── admin/
│   │   ├── dossiers/
│   │   │   ├── [slug].tsx                             [NEW — read-only detail view]
│   │   │   └── index.tsx                              [NEW — list view]
│   │   └── index.tsx                                  [UNCHANGED — Story 5.1 pipeline]
│   ├── auth/                                          [UNCHANGED]
│   ├── dashboard/                                     [UNCHANGED]
│   ├── not-found.tsx                                  [UNCHANGED]
│   └── share/                                         [UNCHANGED]
├── main.tsx                                           [UNCHANGED]
└── router.tsx                                         [MODIFIED — 2 route entries]
```

### Decisions Pinned for This Story

Do not renegotiate without explicit retrospective action.

1. **Two new admin routes only — `/admin/dossiers` + `/admin/dossiers/:slug`.** `/admin/questionnaire` (5.3) and `/admin/utilisateurs` (5.4) continue to fall through to `NotFoundRoute`. The 5.1 Pinned Decision #1 forward-reference contract is preserved: 5.3/5.4 authors only need to add their route entries to router.tsx without touching any other shell surface. Alternatives rejected: (a) add placeholder "bientôt disponible" routes for 5.3/5.4 now — pure scope creep; (b) collapse `/admin/dossiers` and `/admin/dossiers/:slug` into a single route with local state — loses deep-linkability (AC2 explicitly requires a URL per dossier).

2. **Role guard is inline on BOTH new admin routes; detail uses the 4.4 inner-component delegation pattern.** Story 5.1 Pinned Decision #4 deferred the `<RequireRole>` wrapper question. 5.2 answer: INLINE (rationale in Critical Architecture Constraints above). The detail route's body calls `useParams + useRef + useEffect` AFTER the guard, so the default export does `useCurrentUser + if/return + <InnerView />`, and all subsequent hooks live in the inner component — the 4.4 pattern at [apps/web/src/routes/share/dossier.tsx:13-17](apps/web/src/routes/share/dossier.tsx#L13-L17). The list route applies the SAME shape even though its body hooks are benign (`useRef + useEffect` at the top level would technically be fine) — two admin routes with identical shape is the cheaper cognitive-load design, and 5.3 / 5.4 can clone the same shape. Alternatives rejected: (a) `<RequireRole>` wrapper — touches Story 5.1 and generates churn; (b) inline guard only on list, delegation pattern only on detail — asymmetric; (c) React Router v7 `loader: ({ ... }) => redirect('/dashboard')` — requires wiring `CurrentUserProvider` into loader context, premature for a mock-role system.

3. **Biosensio's admin answers come from `MOCK_DOSSIER_DETAIL.answers` — no duplication.** Biosensio is the canonical cross-role dossier (entrepreneur + financeur + admin). Hand-duplicating answers across fixtures would produce drift when a test vector changes. The admin fixture IMPORTS `MOCK_DOSSIER_DETAIL.answers`; the other 4 admin dossiers have no `answers` key and fall through to the "pas encore de contenu renseigné" path. Alternatives rejected: (a) give every admin dossier hand-written answers — 60 new strings to maintain; (b) reuse biosensio's answers for all 5 admin dossiers — unrealistic (different sectors, different maturities, identical pitch text would look contrived); (c) generate fake answers via a mock-data library like Faker — new dev dependency for one consumer.

4. **Update `SEGMENT_LABELS['admin']` from 'Administration' to 'Admin'.** Epic 5.2 AC3 literal pin. Zero regression (depth-1 `/admin` suppresses; no other path uses the key). Alternatives rejected: (a) keep 'Administration' and override the first breadcrumb segment inline in `admin/dossiers/index.tsx` — widens the inline-breadcrumb override pattern to a non-`hideBreadcrumb` route, complexity shift; (b) add a per-route `handle: { breadcrumbLabel: 'Admin' }` override — introduces a new handle contract that Breadcrumbs.tsx would need to consume, larger surface change for one label.

5. **No new confluent/ primitive, no new shadcn/ui primitive.** The admin table is inline JSX; the mobile card list is inline JSX; the info banner is inline JSX. Rule-of-three not met: this is the only admin table and the only info banner today. 5.3/5.4 may introduce OR reuse these patterns; the `cva` extraction / shared-component promotion decision defers to the spec author of the third consumer. Alternatives rejected: (a) shadcn `Table` primitive — currently not in `components/ui/`; adding it for a single consumer is scope creep; (b) new `AdminTable.tsx` / `AdminDossierCard.tsx` components — premature before a second consumer exists; (c) shadcn `Alert` primitive — same scope-creep concern; the 5-line inline banner does not justify a new dependency.

6. **Info banner uses `role="note"` — semantically correct for static annotation.** WAI-ARIA 1.2 defines `note` as "parenthetic or ancillary remarks" — exact fit for the admin-mode marker. `role="status"` and `role="alert"` are live-region semantics for runtime-injected content; misusing them causes screen readers to interrupt unrelated announcements on mount. Alternatives rejected: (a) `role="status"` — screen readers treat as polite live-region; wrong for mount-time static; (b) `role="alert"` — assertive live-region; far too aggressive; (c) no `role` (plain `<div>`) — loses the parenthetic semantic; passes WAI validators but AT users don't get the contextual cue that this is ancillary vs primary content.

7. **Full-row clickability via stretched-link overlay, NOT `<tr onClick>`.** The `<Link>` in the first cell gets `after:absolute after:inset-0 after:content-[""]` — the `::after` pseudo-element overlays the entire row, making the whole row a hit target while the `<Link>` retains semantic-anchor properties (keyboard navigation, screen-reader announcement, `aria-current` compatibility). `<tr>` is `relative` to scope the overlay. Alternatives rejected: (a) `<tr onClick>` + `navigate()` — breaks keyboard-only users (no focus target), requires adding `tabIndex + role="link" + onKeyDown` ad-hoc, fighting the platform; (b) nest the `<Link>` around `<tr>` content — invalid HTML (anchor cannot contain `<tr>` as a child); (c) add a "Voir" action button in a 7th column — scope drift (Epic AC1 pins 6 columns).

8. **No `NavLink` `end` tightening on `/admin/dossiers` sidebar entry.** The existing admin nav entry at [apps/web/src/components/layout/nav-items.ts:20](apps/web/src/components/layout/nav-items.ts#L20) (`{ to: '/admin/dossiers', label: 'Dossiers', icon: FolderOpen }` — NO `end: true`) correctly highlights on both `/admin/dossiers` AND `/admin/dossiers/:slug`. Same-class concern as 5.1 Pinned Decision "don't tighten `end` on admin Pipeline": the Dossiers admin section includes its detail views. Carry-forward from 5.1 Previous-Story-Intelligence at [5-1-admin-layout-pipeline-dashboard.md:550-552](5-1-admin-layout-pipeline-dashboard.md#L550-L552).

9. **Unknown-slug fallback renders INSIDE the admin shell (not a 404 to root).** The detail route's `if (!dossier) return <Dossier introuvable />` keeps the admin sidebar + breadcrumb visible — the admin is still logically "in" the admin section, they just typed a bad slug. Alternatives rejected: (a) `<Navigate to="/admin/dossiers" />` — silently swallows the bad URL, confusing; (b) `<Navigate to="/not-found" />` — loses admin shell context.

10. **Carry-forward of 5.1 Pinned Decisions.** Every 5.1 pin (single AppShell with role-driven nav, `?as=admin` URL param, `sessionStorage` per-tab isolation, `replace` navigation on role-denied redirect, Rules-of-Hooks discipline) applies verbatim to 5.2. No renegotiation.

### Previous Story Intelligence

**From Story 5.1 (just landed — `5a52c5e`):**

- **Role-guard pattern**: Story 5.1 established `const user = useCurrentUser(); if (user.role !== 'admin') return <Navigate to="/dashboard" replace />` as the inline admin gate. 5.2 clones this verbatim at the top of both new routes. `replace` (not push) per 5.1 Pinned Decision #4.
- **Inner-component delegation**: 5.1 did NOT need it (no hooks after the guard in `/admin`). 5.2's detail route DOES need it (hooks after the guard). Pattern copied from 4.4's `ShareDossierRoute → ShareDossierView` at [apps/web/src/routes/share/dossier.tsx:13-17](apps/web/src/routes/share/dossier.tsx#L13-L17).
- **Admin nav stub entries**: `ADMIN_NAV_ITEMS` at [apps/web/src/components/layout/nav-items.ts:17-22](apps/web/src/components/layout/nav-items.ts#L17-L22) already contains `{ to: '/admin/dossiers', label: 'Dossiers', icon: FolderOpen }`. 5.2 activates this without touching nav-items.ts. Same forward-reference contract for 5.3 / 5.4.
- **Dev-role impersonation**: `?as=admin` → `sessionStorage.confluent_dev_role=admin` → `MOCK_ADMIN_USER` exposed via `useCurrentUser`. Unchanged in 5.2.
- **Breadcrumb label gap**: 5.1 retained `SEGMENT_LABELS['admin'] = 'Administration'` because 5.1's single admin path is depth 1 (breadcrumb suppresses). 5.2 is the first depth-2+ admin path and surfaces the gap with Epic 5.2 AC3's literal "Admin". One-line fix.
- **Lint warning baseline**: 5 warnings, all `react-refresh/only-export-components` (3 in `context.tsx`, 1 each in `badge.tsx`/`button.tsx`). 5.2 should NOT introduce new warning classes — no provider+non-component-export patterns in the new files.
- **Bundle baseline**: `628.26 KB / 197.46 KB gz` (5.1 close). 5.2's estimated delta: ≤ +3 KB gz (two routes, one fixture, one new icon, one line each in router + Breadcrumbs).

**From Story 4.4 (`b2e41c9`):**

- **Inner-component delegation pattern**: `export default function ShareDossierRoute() { const { token } = useParams(); if (!isValidShareToken(token)) return <AccessDeniedPage />; return <ShareDossierView /> }` at [apps/web/src/routes/share/dossier.tsx:13-17](apps/web/src/routes/share/dossier.tsx#L13-L17). Admin detail follows the exact shape — substitute `useParams` guard for `useCurrentUser` guard.
- **Mock fixture file-header convention**: `// Static mock fixture for the Story X.Y [purpose]. Replaced by Epic N.M's [real thing] (architecture.md:LINE — '[adapter name]') when real API wiring lands.` 5.2's `mock-admin-dossiers.ts` header follows verbatim (Epic 9.1 reference).
- **Headless-env deferral pattern for AC manual walkthrough**: documented in 4.4 Completion Note #3 and 5.1 Completion Note #3. 5.2 will likely defer AC17 manual walkthrough in the same way.

**From Story 3.2 (dossier detail view precedent):**

- **H1 mount-focus pattern with `[slug]` dependency**: `useEffect(() => { headingRef.current?.focus() }, [slug])` at [apps/web/src/routes/dashboard/dossiers/[slug].tsx:106-108](apps/web/src/routes/dashboard/dossiers/[slug].tsx#L106-L108). When the admin navigates between `/admin/dossiers/biosensio` and `/admin/dossiers/neuroflow`, the effect re-runs on slug change and the H1 re-focuses. Without `[slug]`, only first-mount would focus. Known carry-forward deferral at [deferred-work.md:63](deferred-work.md#L63) re: `preventScroll: true` — NOT resolved by 5.2 (applies project-wide, belongs with a11y polish pass).
- **Inline breadcrumb when `handle: { hideBreadcrumb: true }`**: Exact pattern reused for the admin detail (3 segments instead of 2, targets `/admin` + `/admin/dossiers` instead of `/dashboard`).

**From Story 3.1 (DossierCard + `formatRelativeDate` precedent):**

- **`formatRelativeDate`** is the canonical date renderer. Reused for the admin table "Créé" column — no new date formatter introduced.
- **Mobile card markup shape** (name / sector / badge): 5.2 adapts this to show name / entrepreneurEmail / sector per Epic AC5. The admin card does NOT show a maturity badge (dropped per AC5 field-count rule).

**From Story 2.2 (sidebar `end` semantics):**

- **`end: true` on `/admin` (Pipeline)** means it de-highlights on `/admin/dossiers` — INTENDED (those are different sections). 5.2 verifies this by manual walkthrough (AC17): navigating to `/admin/dossiers` should un-highlight "Pipeline" and highlight "Dossiers" in the admin sidebar.
- **NO `end` flag on `/admin/dossiers` admin nav entry**: intentionally highlights on both list AND detail (`/admin/dossiers/:slug`). Same spirit as entrepreneur's `/dashboard/tableau-de-bord` no-end carry-forward (both are parent sections whose detail views are conceptually nested).

### Git Intelligence

Recent commits (most recent 6):

```
5a52c5e feat(epic-5): story 5.1 — Admin layout & pipeline dashboard
b2e41c9 feat(epic-4): story 4.4 — Access denied page
ee95b33 feat(epic-4): story 4.3 — Financeur dossier view desktop layout
3cc245a feat(epic-4): story 4.2 — Financeur dossier view mobile layout
af6ac5c feat(epic-4): story 4.1 — Email verification screen (UI only, mocked)
75b566a feat(epic-3): story 3.6 — Access revocation (optimistic, mocked)
```

**Observed patterns to carry forward:**

- Commit title format: `feat(epic-N): story N.M — <descriptive title matching epic AC phrasing>`. 5.2's commit title: `feat(epic-5): story 5.2 — Admin all dossiers list`.
- Single bundled commit per story (impl + code-review patches together) per auto-memory at [feedback_commit_review_together.md](/home/coder/.claude/projects/-home-coder-confluent/memory/feedback_commit_review_together.md).
- Story 5.1 added one new route folder (`routes/admin/index.tsx` already existed; 5.1 expanded it). 5.2 adds a new sub-folder `routes/admin/dossiers/` with two files — same-ish granularity.
- Mock fixtures land in `apps/web/src/data/` with a forward-reference header comment. 5.2 continues the convention with `mock-admin-dossiers.ts`.
- `router.tsx` was untouched in 5.1 but is modified in 5.2. This is the first commit in Epic 5 to touch `router.tsx` — follow the existing ordering (admin imports grouped, route entries in AppShell children array preserve the 5.1 ordering: admin first, catch-all last).

### Latest Technical Specifics

**React 19 + React Router v7:**

- `useParams<{ slug: string }>()` types `slug` as `string | undefined`. The detail route's `find()` call handles `undefined` via `slug ? MOCK_ADMIN_DOSSIERS.find(...) : undefined`. Story 1.3's `useParams<{ token: string }>()` type-lie deferral at [deferred-work.md:96](deferred-work.md#L96) applies here too — the type narrowing is only as strong as the router path config (`:slug` is always present at runtime, but `useParams` still returns `string | undefined`). NOT a 5.2 blocker; consistent handling.
- `<Navigate to="/dashboard" replace />` declarative redirect — identical to 5.1 usage.
- `<title>{name} · Confluent</title>` — React 19 auto-hoists JSX `<title>` to `<head>`. Order-of-render wins on collision, so the detail route's `<title>` overrides anything rendered by a descendant component.
- `NavLink`'s `aria-current="page"` emits by default on the active route — the admin sidebar "Dossiers" entry will automatically announce "Dossiers, lien, page courante" when the user is on `/admin/dossiers` or `/admin/dossiers/:slug` (no `end` flag).

**`lucide-react` 1.8.0:**

- `Info` icon is a stable named export at 1.8.0. Tree-shake via named import; no wildcards.
- 24×24 viewBox, `stroke="currentColor"`, inherits color from the parent `text-foreground` class on the banner.
- `size-4` (16 px) matches the banner's small-text scale.
- Bundle cost: ~400 bytes gz.

**Tailwind CSS v4.2.2:**

- `bg-muted/50` — Tailwind v4 syntax for `var(--muted)` at 50 % alpha. Native utility; no custom CSS.
- `after:absolute after:inset-0 after:content-[""]` — pseudo-element overlay for the stretched-link pattern. Requires the parent `<tr>` to be `relative` (set explicitly on each row).
- `focus-within:bg-muted/50` — row-level highlight when keyboard focus lands anywhere inside the row (specifically the link in the first cell). Pairs with `hover:bg-muted/50` for pointer users.
- `tabular-nums` — column-aligned digits on the "Accès actifs" + "Créé" columns.
- `divide-y divide-border` — native utility for row separators.
- `md:hidden` + `hidden md:block` — mutually-exclusive viewport switch at the `md` breakpoint (768 px).

**Base UI primitives (via shadcn v4):**

- NONE consumed in 5.2. The admin list + detail are built with plain HTML elements (`<table>`, `<ul>`, `<div>`, `<Link>`) and existing `DossierField` component.

**Bundle budget:**

- `mock-admin-dossiers.ts`: ~60 lines TS ≈ ~1.5 KB uncompressed ≈ ~0.4 KB gz (biosensio's `answers` imports from existing `MOCK_DOSSIER_DETAIL`; no duplication).
- `admin/dossiers/index.tsx`: ~90 lines TSX ≈ ~3 KB uncompressed ≈ ~1.2 KB gz.
- `admin/dossiers/[slug].tsx`: ~110 lines TSX ≈ ~4 KB uncompressed ≈ ~1.5 KB gz.
- `Info` lucide icon: ~400 bytes gz.
- `router.tsx` +2 imports + 2 route entries: ~0.1 KB gz.
- `Breadcrumbs.tsx` +1 string character: negligible.
- Total estimated source delta: ≤ +3 KB gz vs 5.1 baseline. AC15 audit threshold: 5 KB gz.

### Project Structure Notes

- Alignment with [architecture.md:637-640](../planning-artifacts/architecture.md#L637-L640): the architecture target anticipates `apps/web/src/routes/admin/{index.tsx, questionnaire.tsx, users.tsx}`. 5.2 lands the `dossiers/` sub-folder with `index.tsx` + `[slug].tsx` — this matches the architecture target's directory shape (admin's sub-routes living under `admin/`), extending the pattern with a sub-folder for the dossier-list + dossier-detail pair (same convention as entrepreneur's `dashboard/dossiers/`).
- Variance from [architecture.md:665](../planning-artifacts/architecture.md#L665): architecture anticipates `features/admin/components/QuestionnaireBuilder.tsx` — out of scope for 5.2 (lands in 5.3). No `features/admin/` folder is introduced by 5.2.
- Alignment with [architecture.md:741](../planning-artifacts/architecture.md#L741): FR32-FR35 frontend lives in `routes/admin/`. 5.2's dossiers list surfaces FR35 (admin read dossier) — at [prd.md:175](../planning-artifacts/prd.md#L175) the FR35 assignment is "Epic 5 — Admin read dossier / Epic 9 — real access".
- `packages/shared/src/index.ts` already declares `UserRole = 'entrepreneur' | 'financeur' | 'admin'` — no shared-package edit.
- `MockDossier` interface is in `apps/web/src/data/mock-dossiers.ts` and is co-located with the fixture that consumes it. `MockAdminDossier extends MockDossier` inherits all 6 fields and adds 2 admin-specific ones. The deferred "`AccessEntry` domain type colocated with mock fixture" from [deferred-work.md:41](deferred-work.md#L41) has the same class of concern — both will likely migrate to `packages/shared/src/types/` in Epic 7. Not a 5.2 blocker.
- No new folders required by 5.2 other than `routes/admin/dossiers/`. No shared-package changes required.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#999-1025 (Epic 5 Story 5.2 — Admin All Dossiers List AC)]
- [Source: _bmad-output/planning-artifacts/epics.md#209-212 (Epic 5 scope — admin back-office frontend, mocked)]
- [Source: _bmad-output/planning-artifacts/prd.md#FR35 (admin read dossier — Epic 5 UI, Epic 9 real access)]
- [Source: _bmad-output/planning-artifacts/prd.md#113-125 (Journey 3 — French Tech CVL admin persona)]
- [Source: _bmad-output/planning-artifacts/architecture.md#637-640 (routes/admin/ target structure)]
- [Source: _bmad-output/planning-artifacts/architecture.md#710-717 (Admin route boundaries — JwtAuthGuard + AdminGuard)]
- [Source: _bmad-output/planning-artifacts/architecture.md#769-771 (PATCH /v1/dossiers/:id admin JWT — Epic 9.1 real-API replacement)]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#214 (empty-state anxiety — admin views need guidance)]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#375 (720 px content max-width for reading-heavy views)]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#686 (breadcrumb admin sub-view format — `Admin / Questionnaire / Section 3`)]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#722 (admin back-office responsive strategy — desktop-acceptable, horizontally scrollable tables → mobile card list per Epic AC5 override)]
- [Source: _bmad-output/implementation-artifacts/5-1-admin-layout-pipeline-dashboard.md (Story 5.1 — role guard pattern, ADMIN_NAV_ITEMS, inline guard Pinned Decisions, dev-role impersonation)]
- [Source: _bmad-output/implementation-artifacts/4-4-access-denied-page.md#546-554 (Story 4.4 — inner-component delegation pattern for hooks after guard)]
- [Source: _bmad-output/implementation-artifacts/deferred-work.md#31 (3.6 ICU-drift deferral — avoided in 5.2 via formatRelativeDate reuse)]
- [Source: _bmad-output/implementation-artifacts/deferred-work.md#63 (3.2 preventScroll deferral — carried forward passively)]
- [Source: _bmad-output/implementation-artifacts/deferred-work.md#96 (1.3 useParams type-lie deferral — carried forward passively)]
- [Source: _bmad-output/implementation-artifacts/deferred-work.md#41 (3.5 domain-type colocation — not widened by 5.2; tracks Epic 7 migration)]
- [Source: apps/web/src/components/confluent/DossierField.tsx (DossierField props — label + value + optional className)]
- [Source: apps/web/src/components/layout/Breadcrumbs.tsx (SEGMENT_LABELS map + < 2-segment suppression + hideBreadcrumb handle)]
- [Source: apps/web/src/components/layout/nav-items.ts (ADMIN_NAV_ITEMS — Dossiers entry already configured in 5.1)]
- [Source: apps/web/src/data/mock-dossier.ts (MOCK_DOSSIER_DETAIL.answers — imported for biosensio admin answers)]
- [Source: apps/web/src/data/mock-dossiers.ts (MockDossier interface — extended by MockAdminDossier)]
- [Source: apps/web/src/data/questionnaire.ts (QUESTIONNAIRE + QUESTIONNAIRE_FLAT — consumed by detail view)]
- [Source: apps/web/src/features/current-user/context.tsx (useCurrentUser — role guard dependency)]
- [Source: apps/web/src/lib/relative-date.ts (formatRelativeDate — consumed by admin table "Créé" column)]
- [Source: apps/web/src/routes/admin/index.tsx (Story 5.1 role-guard pattern precedent)]
- [Source: apps/web/src/routes/dashboard/dossiers/[slug].tsx#L195-L214 (inline 2-segment breadcrumb pattern — extended to 3 segments in admin)]
- [Source: apps/web/src/routes/dashboard/dossiers/[slug].tsx#L106-L108 (H1 mount-focus with [slug] dependency)]
- [Source: apps/web/src/routes/dashboard/dossiers/[slug].tsx#L206-L219 (unknown-slug "introuvable" fallback pattern)]
- [Source: apps/web/src/routes/dashboard/dossiers/[slug].tsx#L246-L271 (3-section QUESTIONNAIRE.map + DossierField render pattern)]
- [Source: apps/web/src/routes/share/dossier.tsx#L13-L17 (Story 4.4 inner-component delegation pattern)]
- [Source: apps/web/src/router.tsx (route registration — modified in 5.2)]
- [Source: apps/web/src/index.css#L53-L84 (design tokens — sidebar + color + ring)]
- [Source: packages/shared/src/index.ts (UserRole + User type definitions)]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.7 (1M context) — `claude-opus-4-7[1m]`

### Debug Log References

- `pnpm --filter @confluent/web typecheck` — exits 0.
- `pnpm --filter @confluent/web lint` — exits 0 with 5 warnings (all `react-refresh/only-export-components` — identical to the 5.1 close baseline: `badge.tsx:52`, `button.tsx:58`, `context.tsx:7`, `context.tsx:14`, `context.tsx:47`). Zero new warning classes.
- `pnpm turbo run build` — all packages GREEN. Bundle: `635.31 KB / 198.41 KB gz`. Delta vs 5.1 baseline (`628.26 KB / 197.46 KB gz`): **+7.05 KB / +0.95 KB gz**. Gz delta well under the +3 KB gz target. Uncompressed delta is slightly higher than the ~3 KB estimate but the gzipped figure is the operative one; the extra uncompressed bytes compress efficiently. No new `>500 kB` chunk warning beyond the carry-forward one from Story 3.5.
- AC15 grep battery — raw hex / wildcard imports / `Administration` label / info-banner copy / `role="note"` / admin imports + route count: ALL clean. Two AC-prose undercount imprecisions (see Completion Note #1).
- Arithmetic invariants on `MOCK_ADMIN_DOSSIERS`: 5 entries; 4 distinct sectors (DeepTech, AgriTech ×2, Fintech, Autre); 4 distinct maturities (Pre-seed ×2, Amorçage, Série A, Idée) — Epic AC4 "varied sectors and stages" satisfied.

### Completion Notes List

1. **AC15 grep count undershoots on two bullets — same class as 5.1 Completion Note #2.** Two AC15 assertions stated exact counts that AC-prose underestimated relative to mechanically-derivable totals:
   - AC15 bullet `grep -n "admin/dossiers" apps/web/src/router.tsx → EXACTLY 2 matches`. Actual: 4 matches. AC-prose accounted for the 2 `path:` values but overlooked the 2 same-path imports (`@/routes/admin/dossiers` + `@/routes/admin/dossiers/[slug]`). Implementation is correct (AC14's canonical router snippet adds BOTH imports and BOTH routes, which is exactly 4 occurrences of the substring `admin/dossiers`); the AC count bullet was drafted without visualizing the import-side occurrences.
   - AC15 bullet `grep -n "MOCK_ADMIN_DOSSIERS" ... → EXACTLY 3 matches (1 export + 2 imports/reads)`. Actual: 6 matches. AC-prose counted 1 file-level export + 2 route file imports = 3, but the route files additionally reference `MOCK_ADMIN_DOSSIERS.map(...)` twice in list.tsx (mobile + desktop branches) and `MOCK_ADMIN_DOSSIERS.find(...)` once in [slug].tsx, bringing the total to 1 + (1 import + 2 `.map`) + (1 import + 1 `.find`) = 6. Again, implementation matches AC14 canonical snippets verbatim; the AC count bullet missed the body-level references. Retrospective action: when tightening future AC grep guardrails, count ALL occurrences of the symbol (imports + exports + reads), not just the "definition + import" pair.
2. **Manual browser walkthrough (AC17) deferred — headless environment.** The dev agent has no browser in-session, so AC17 was not exercised interactively. Static verification covers structural correctness (typecheck, lint, build, grep). Runtime-only assertions remain for the human reviewer: `?as=admin` URL stripping + sessionStorage persistence; table ↔ card layout swap at 768 px; focus-within row highlight; stretched-link full-row click target; inline 3-segment breadcrumb rendering on detail routes; `role="note"` banner presence on BOTH populated (`biosensio`) and empty-content (`agrotrack`) dossiers; "introuvable" fallback for an unknown slug; admin sidebar active state on `/admin/dossiers` and `/admin/dossiers/:slug`; regression sweep on `/dashboard` + `/share/:token` + `/admin` (Pipeline). Same deferral pattern as Stories 4.1–5.1.
3. **Epic 5.2 AC3 Breadcrumb-label correction applied.** Story 5.1 retained the pre-existing `SEGMENT_LABELS['admin'] = 'Administration'` (depth-1 `/admin` suppresses, so the label was invisible). 5.2 is the first story exercising a depth-2+ admin path; per Epic AC3 pin (`Admin / Dossiers / Biosensio`), the single-line map value was updated from `'Administration'` to `'Admin'`. Zero regression verified: no non-admin route consumes the `admin` key; `/admin` still returns null via the `segments.length < 2` early-return. Same-class cosmetic retrospective as 5.1 AC3↔AC16 prose mismatch noted in 5.1 Review Findings.
4. **Pinned Decision #2 honored — list + detail share the inner-component delegation pattern.** Both routes have the shape `export default function AdminXRoute() { const user = useCurrentUser(); if (...) return <Navigate />; return <InnerView /> }`. The detail route strictly NEEDS the split because of its post-guard hooks (`useParams + useRef + useEffect`); the list route adopts the same symmetry even though its hooks (`useRef + useEffect`) would be fine at the top level. Rationale: 5.3 / 5.4 authors can clone either route shape interchangeably.
5. **No router.tsx ordering regression.** New routes were appended AFTER `{ path: 'admin', ... }` (line 44) and BEFORE `{ path: '*', element: <NotFoundRoute /> }` (which moved from line 45 to line 50 — catch-all remains last in the children array). Router child ordering preserved per 5.1 Pinned Decision #10. `/admin/questionnaire` and `/admin/utilisateurs` continue to fall through to `NotFoundRoute` (forward-reference carry-forward for 5.3 / 5.4).

### File List

**Modified:**

- `apps/web/src/router.tsx` — MODIFIED. +2 default-imports (`AdminDossiersRoute`, `AdminDossierDetailRoute`) after the existing `AdminRoute` import; +2 route entries (`{ path: 'admin/dossiers' }` + `{ path: 'admin/dossiers/:slug', handle: { hideBreadcrumb: true } }`) inserted after the existing `{ path: 'admin' }` entry and before the catch-all. 5 lines added, 0 lines modified.
- `apps/web/src/components/layout/Breadcrumbs.tsx` — MODIFIED. 1-line change at [apps/web/src/components/layout/Breadcrumbs.tsx:10](apps/web/src/components/layout/Breadcrumbs.tsx#L10): `admin: 'Administration'` → `admin: 'Admin'` per Epic 5.2 AC3. No other changes.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — `5-2-admin-all-dossiers-list`: `backlog` → `ready-for-dev` → `in-progress` → `review`; `last_updated` refreshed.

**Created:**

- `apps/web/src/data/mock-admin-dossiers.ts` — NEW. `MockAdminDossier extends MockDossier` interface (+ `entrepreneurEmail: string` + optional `answers`) and `MOCK_ADMIN_DOSSIERS` const (5 entries, typed `as const`). Biosensio's `answers` imports `MOCK_DOSSIER_DETAIL.answers` from [apps/web/src/data/mock-dossier.ts](apps/web/src/data/mock-dossier.ts) (no duplication).
- `apps/web/src/routes/admin/dossiers/index.tsx` — NEW. Admin dossiers list route. Inner-component delegation (`AdminDossiersRoute → AdminDossiersList`). Inline role guard. Mobile card list (`md:hidden`, 3 fields/card) + desktop table (`hidden md:block`, 6 columns, stretched-link rows).
- `apps/web/src/routes/admin/dossiers/[slug].tsx` — NEW. Admin dossier read-only detail route. Inner-component delegation (`AdminDossierDetailRoute → AdminDossierDetailView`). Inline 3-segment breadcrumb (`Admin / Dossiers / <Name>`). `role="note"` info banner with `Info` icon and exact Epic AC3 French copy. 3-section questionnaire renderer (via `DossierField` + `QUESTIONNAIRE_FLAT`) with empty-state fallback. Unknown-slug "introuvable" fallback with back link.

**Unchanged (verified, regression gates preserved):**

- `apps/web/src/routes/admin/index.tsx` (Story 5.1 Pipeline dashboard)
- `apps/web/src/components/layout/AppShell.tsx`
- `apps/web/src/components/layout/nav-items.ts` (the `/admin/dossiers` nav entry added in 5.1 activates without edits in 5.2)
- `apps/web/src/components/layout/NavItem.tsx`
- `apps/web/src/features/current-user/context.tsx`
- `apps/web/src/components/confluent/*` (DossierField consumed as-is)
- `apps/web/src/components/ui/*`
- `apps/web/src/data/mock-dossier.ts` (MOCK_DOSSIER_DETAIL.answers imported by admin fixture)
- `apps/web/src/data/mock-dossiers.ts` (MockDossier interface extended by admin fixture)
- `apps/web/src/data/mock-admin-pipeline.ts`, `mock-analytics.ts`, `mock-tokens.ts`, `questionnaire.ts`
- `packages/shared/src/index.ts`

## Change Log

| Date       | Change                                                                                                                     | Author     |
|------------|----------------------------------------------------------------------------------------------------------------------------|------------|
| 2026-04-22 | Story drafted by create-story workflow; sprint status flipped backlog → ready-for-dev.                                      | Bob (SM)   |
| 2026-04-22 | Story implemented (dev-story workflow): mock admin dossiers fixture, admin dossiers list route, admin dossier read-only detail route, router registration for `/admin/dossiers` + `/admin/dossiers/:slug`, Breadcrumbs `'Administration'` → `'Admin'` label correction. Sprint status flipped ready-for-dev → in-progress → review. Tasks 1–7 complete. Bundle delta: +7.05 KB / +0.95 KB gz vs 5.1 baseline. | Claude Opus 4.7 |
