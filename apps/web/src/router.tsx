import type { ComponentType } from 'react'
import { createBrowserRouter, Navigate, type RouteObject } from 'react-router-dom'
import { PageLoading, RootLayout } from '@/components/layout/PageLoading'
import { RouteError } from '@/routes/error'
// Eager, like the error screens that show it.
import NotFoundRoute from '@/routes/not-found'

// ROADMAP E10.08: each page, and the signed-in shell, is a chunk of its own, loaded when first opened:
// the public page and the sign-in page no longer download the whole application, nor anyone the
// administration's screens and form editors before opening them. While a chunk loads, the page left
// stays on screen with a loading indicator (RootLayout); the first load shows `PageLoading`. A chunk
// that cannot be loaded (a former version's, after a deployment) reaches the error screens, which
// reload once (E10.06) — they are never loaded on demand themselves.
const page = (load: () => Promise<{ default: ComponentType }>): Pick<RouteObject, 'lazy'> => ({
  lazy: async () => ({ Component: (await load()).default }),
})

// The pages inside the application's shell (signed in).
const appPages: RouteObject[] = [
  { index: true, element: <Navigate to="/dashboard" replace /> },
  { path: 'dashboard', ...page(() => import('@/routes/dashboard')) },
  { path: 'dashboard/tableau-de-bord', ...page(() => import('@/routes/dashboard/tableau-de-bord')) },
  { path: 'dashboard/applications', ...page(() => import('@/routes/dashboard/applications')) },
  { path: 'dashboard/dossiers', element: <Navigate to="/dashboard" replace /> },
  {
    path: 'dashboard/dossiers/nouveau',
    ...page(() => import('@/routes/dashboard/dossiers/nouveau')),
    handle: { hideBreadcrumb: true },
  },
  {
    path: 'dashboard/dossiers/nouveau/questionnaire',
    ...page(() => import('@/routes/dashboard/dossiers/nouveau/questionnaire')),
    handle: { hideBreadcrumb: true },
  },
  {
    path: 'dashboard/dossiers/nouveau/recapitulatif',
    ...page(() => import('@/routes/dashboard/dossiers/nouveau/recapitulatif')),
    handle: { hideBreadcrumb: true },
  },
  {
    path: 'dashboard/dossiers/view/:slug',
    ...page(() => import('@/routes/dashboard/dossiers/[slug]')),
    handle: { hideBreadcrumb: true },
  },
  {
    path: 'dashboard/dossiers/view/:slug/apercu',
    ...page(() => import('@/routes/dashboard/dossiers/[slug]/apercu')),
    handle: { hideBreadcrumb: true },
  },
  {
    path: 'dashboard/entreprises/:companyId',
    ...page(() => import('@/routes/dashboard/entreprises/[companyId]')),
    handle: { hideBreadcrumb: true },
  },
  {
    path: 'dashboard/propositions',
    ...page(() => import('@/routes/dashboard/propositions')),
    handle: { hideBreadcrumb: true },
  },
  {
    path: 'dashboard/candidatures/:candidatureId',
    ...page(() => import('@/routes/dashboard/candidatures/[candidatureId]')),
    handle: { hideBreadcrumb: true },
  },
  { path: 'admin', ...page(() => import('@/routes/admin')) },
  { path: 'admin/dossiers', ...page(() => import('@/routes/admin/dossiers')) },
  {
    path: 'admin/dossiers/:slug',
    ...page(() => import('@/routes/admin/dossiers/[slug]')),
    handle: { hideBreadcrumb: true },
  },
  {
    path: 'admin/dossiers/:slug/apercu',
    ...page(() => import('@/routes/admin/dossiers/[slug]/apercu')),
    handle: { hideBreadcrumb: true },
  },
  { path: 'admin/formulaires', ...page(() => import('@/routes/admin/formulaires')) },
  { path: 'admin/classification', ...page(() => import('@/routes/admin/classification')) },
  {
    path: 'admin/formulaires/:formId',
    ...page(() => import('@/routes/admin/formulaires/[formId]')),
    handle: { hideBreadcrumb: true },
  },
  // Former single-questionnaire page, replaced by the form builder.
  { path: 'admin/questionnaire', element: <Navigate to="/admin/formulaires" replace /> },
  { path: 'admin/utilisateurs', ...page(() => import('@/routes/admin/utilisateurs')) },
  // E10.10: the deletion requests to process.
  {
    path: 'admin/utilisateurs/suppressions',
    ...page(() => import('@/routes/admin/suppressions')),
  },
  { path: 'admin/workspaces', ...page(() => import('@/routes/admin/workspaces')) },
  { path: 'admin/workspaces/nouveau', ...page(() => import('@/routes/admin/workspaces/nouveau')) },
  {
    path: 'admin/workspaces/:workspaceId',
    ...page(() => import('@/routes/admin/workspaces/[workspaceId]')),
    handle: { hideBreadcrumb: true },
  },
  {
    path: 'admin/workspaces/:workspaceId/membres',
    ...page(() => import('@/routes/admin/workspaces/[workspaceId]/membres')),
    handle: { hideBreadcrumb: true },
  },
  {
    path: 'admin/workspaces/:workspaceId/formulaires',
    ...page(() => import('@/routes/admin/workspaces/[workspaceId]/formulaires')),
    handle: { hideBreadcrumb: true },
  },
  {
    path: 'admin/workspaces/:workspaceId/formulaires/:formId',
    ...page(() => import('@/routes/admin/workspaces/[workspaceId]/formulaires/[formId]')),
    handle: { hideBreadcrumb: true },
  },
  {
    path: 'admin/workspaces/:workspaceId/sources',
    ...page(() => import('@/routes/admin/workspaces/[workspaceId]/sources')),
    handle: { hideBreadcrumb: true },
  },
  {
    path: 'admin/workspaces/:workspaceId/dispositifs',
    ...page(() => import('@/routes/admin/workspaces/[workspaceId]/dispositifs')),
    handle: { hideBreadcrumb: true },
  },
  {
    path: 'admin/workspaces/:workspaceId/parcours',
    ...page(() => import('@/routes/admin/workspaces/[workspaceId]/parcours')),
    handle: { hideBreadcrumb: true },
  },
  {
    path: 'admin/workspaces/:workspaceId/page-publique',
    ...page(() => import('@/routes/admin/workspaces/[workspaceId]/page-publique')),
    handle: { hideBreadcrumb: true },
  },
  {
    path: 'admin/workspaces/:workspaceId/demandes',
    ...page(() => import('@/routes/admin/workspaces/[workspaceId]/demandes')),
    handle: { hideBreadcrumb: true },
  },
  { path: 'workspaces', ...page(() => import('@/routes/workspaces')) },
  {
    path: 'workspaces/:workspaceId',
    ...page(() => import('@/routes/workspaces/[workspaceId]')),
    handle: { hideBreadcrumb: true },
  },
  {
    path: 'workspaces/:workspaceId/candidatures/:candidatureId',
    ...page(() => import('@/routes/workspaces/[workspaceId]/candidatures/[candidatureId]')),
    handle: { hideBreadcrumb: true },
  },
  // E08.01: its committees.
  {
    path: 'workspaces/:workspaceId/comites',
    ...page(() => import('@/routes/workspaces/[workspaceId]/comites')),
    handle: { hideBreadcrumb: true },
  },
  {
    path: 'workspaces/:workspaceId/comites/nouveau',
    ...page(() => import('@/routes/workspaces/[workspaceId]/comites/nouveau')),
    handle: { hideBreadcrumb: true },
  },
  {
    path: 'workspaces/:workspaceId/comites/:committeeId',
    ...page(() => import('@/routes/workspaces/[workspaceId]/comites/[committeeId]')),
    handle: { hideBreadcrumb: true },
  },
  { path: 'opportunites', ...page(() => import('@/routes/opportunites')) },
  { path: 'positionnements', ...page(() => import('@/routes/positionnements')) },
  // E10.10: the signed-in person's data — export, deletion of their account.
  { path: 'compte', ...page(() => import('@/routes/compte')) },
  // E10.03: the signed-in person's notifications.
  { path: 'notifications', ...page(() => import('@/routes/notifications')) },
  {
    path: 'opportunites/:dossierId',
    ...page(() => import('@/routes/opportunites/[dossierId]')),
    handle: { hideBreadcrumb: true },
  },
]

// The pages on their own: share links, sign-in, legal pages, consent, workspaces' public pages.
const standalonePages: RouteObject[] = [
  { path: '/share/:token', ...page(() => import('@/routes/share')) },
  { path: '/share/:token/dossier', ...page(() => import('@/routes/share/dossier')) },
  { path: '/auth', ...page(() => import('@/routes/auth')) },
  { path: '/auth/verify', ...page(() => import('@/routes/auth/verify')) },
  { path: '/mentions-legales', ...page(() => import('@/routes/legal/mentions-legales')) },
  { path: '/confidentialite', ...page(() => import('@/routes/legal/confidentialite')) },
  { path: '/oauth/consent', ...page(() => import('@/routes/oauth/consent')) },
  // E08.04: a workspace's public participation form, signed in or not.
  // E09.01: a workspace's public page, once its managers published it.
  { path: '/w/:slug', ...page(() => import('@/routes/w/[slug]')) },
  { path: '/w/:slug/participer', ...page(() => import('@/routes/w/participer')) },
  { path: '/w/:slug/candidater', ...page(() => import('@/routes/w/candidater')) },
]

// ROADMAP E10.06: a page that fails to render shows an error screen — inside the shell for its pages
// (navigation kept), on its own for the others — and an unknown address, signed in or not, the 404
// page.
export const router = createBrowserRouter([
  {
    element: <RootLayout />,
    hydrateFallbackElement: <PageLoading />,
    errorElement: <RouteError fullPage />,
    children: [
      {
        path: '/',
        ...page(() => import('@/components/layout/AppShell').then((m) => ({ default: m.AppShell }))),
        children: [{ errorElement: <RouteError />, children: appPages }],
      },
      ...standalonePages,
      { path: '*', element: <NotFoundRoute /> },
    ],
  },
])
