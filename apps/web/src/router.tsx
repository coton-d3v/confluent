import { createBrowserRouter, Navigate } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import DashboardRoute from '@/routes/dashboard'
import TableauDeBordRoute from '@/routes/dashboard/tableau-de-bord'
import ApplicationsRoute from '@/routes/dashboard/applications'
import DossierNewRoute from '@/routes/dashboard/dossiers/nouveau'
import QuestionnaireRoute from '@/routes/dashboard/dossiers/nouveau/questionnaire'
import RecapitulatifRoute from '@/routes/dashboard/dossiers/nouveau/recapitulatif'
import DossierViewRoute from '@/routes/dashboard/dossiers/[slug]'
import DossierPreviewRoute from '@/routes/dashboard/dossiers/[slug]/apercu'
import CompanyRoute from '@/routes/dashboard/entreprises/[companyId]'
import CompanyOffersRoute from '@/routes/dashboard/propositions'
import AdminRoute from '@/routes/admin'
import AdminDossiersRoute from '@/routes/admin/dossiers'
import AdminDossierDetailRoute from '@/routes/admin/dossiers/[slug]'
import AdminDossierPreviewRoute from '@/routes/admin/dossiers/[slug]/apercu'
import AdminFormsRoute from '@/routes/admin/formulaires'
import AdminClassificationRoute from '@/routes/admin/classification'
import AdminFormEditorRoute from '@/routes/admin/formulaires/[formId]'
import AdminUtilisateursRoute from '@/routes/admin/utilisateurs'
import AdminWorkspacesRoute from '@/routes/admin/workspaces'
import AdminWorkspaceNewRoute from '@/routes/admin/workspaces/nouveau'
import AdminWorkspaceRoute from '@/routes/admin/workspaces/[workspaceId]'
import AdminWorkspaceMembersRoute from '@/routes/admin/workspaces/[workspaceId]/membres'
import AdminWorkspaceFormsRoute from '@/routes/admin/workspaces/[workspaceId]/formulaires'
import AdminWorkspaceFormEditorRoute from '@/routes/admin/workspaces/[workspaceId]/formulaires/[formId]'
import AdminWorkspaceSourcesRoute from '@/routes/admin/workspaces/[workspaceId]/sources'
import AdminWorkspaceSchemesRoute from '@/routes/admin/workspaces/[workspaceId]/dispositifs'
import AdminWorkspaceSupportPathRoute from '@/routes/admin/workspaces/[workspaceId]/parcours'
import AdminWorkspacePublicPageRoute from '@/routes/admin/workspaces/[workspaceId]/page-publique'
import AdminWorkspaceRequestsRoute from '@/routes/admin/workspaces/[workspaceId]/demandes'
import MyWorkspacesRoute from '@/routes/workspaces'
import WorkspaceRoute from '@/routes/workspaces/[workspaceId]'
import ReceivedCandidatureRoute from '@/routes/workspaces/[workspaceId]/candidatures/[candidatureId]'
import WorkspaceCommitteesRoute from '@/routes/workspaces/[workspaceId]/comites'
import NewCommitteeRoute from '@/routes/workspaces/[workspaceId]/comites/nouveau'
import CommitteeRoute from '@/routes/workspaces/[workspaceId]/comites/[committeeId]'
import OpportunitiesRoute from '@/routes/opportunites'
import OpportunityRoute from '@/routes/opportunites/[dossierId]'
import PositionsRoute from '@/routes/positionnements'
import NotificationsRoute from '@/routes/notifications'
import CandidatureRoute from '@/routes/dashboard/candidatures/[candidatureId]'
import ShareRoute from '@/routes/share'
import ShareDossierRoute from '@/routes/share/dossier'
import AuthRoute from '@/routes/auth'
import AuthVerifyRoute from '@/routes/auth/verify'
import NotFoundRoute from '@/routes/not-found'
import MentionsLegalesRoute from '@/routes/legal/mentions-legales'
import ConfidentialiteRoute from '@/routes/legal/confidentialite'
import OAuthConsentRoute from '@/routes/oauth/consent'
import ParticipationRoute from '@/routes/w/participer'
import EntrepreneurAccessRoute from '@/routes/w/candidater'
import PublicWorkspaceRoute from '@/routes/w/[slug]'

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <Navigate to="/dashboard" replace /> },
      { path: 'dashboard', element: <DashboardRoute /> },
      { path: 'dashboard/tableau-de-bord', element: <TableauDeBordRoute /> },
      { path: 'dashboard/applications', element: <ApplicationsRoute /> },
      { path: 'dashboard/dossiers', element: <Navigate to="/dashboard" replace /> },
      {
        path: 'dashboard/dossiers/nouveau',
        element: <DossierNewRoute />,
        handle: { hideBreadcrumb: true },
      },
      {
        path: 'dashboard/dossiers/nouveau/questionnaire',
        element: <QuestionnaireRoute />,
        handle: { hideBreadcrumb: true },
      },
      {
        path: 'dashboard/dossiers/nouveau/recapitulatif',
        element: <RecapitulatifRoute />,
        handle: { hideBreadcrumb: true },
      },
      {
        path: 'dashboard/dossiers/view/:slug',
        element: <DossierViewRoute />,
        handle: { hideBreadcrumb: true },
      },
      {
        path: 'dashboard/dossiers/view/:slug/apercu',
        element: <DossierPreviewRoute />,
        handle: { hideBreadcrumb: true },
      },
      {
        path: 'dashboard/entreprises/:companyId',
        element: <CompanyRoute />,
        handle: { hideBreadcrumb: true },
      },
      {
        path: 'dashboard/propositions',
        element: <CompanyOffersRoute />,
        handle: { hideBreadcrumb: true },
      },
      {
        path: 'dashboard/candidatures/:candidatureId',
        element: <CandidatureRoute />,
        handle: { hideBreadcrumb: true },
      },
      { path: 'admin', element: <AdminRoute /> },
      { path: 'admin/dossiers', element: <AdminDossiersRoute /> },
      {
        path: 'admin/dossiers/:slug',
        element: <AdminDossierDetailRoute />,
        handle: { hideBreadcrumb: true },
      },
      {
        path: 'admin/dossiers/:slug/apercu',
        element: <AdminDossierPreviewRoute />,
        handle: { hideBreadcrumb: true },
      },
      { path: 'admin/formulaires', element: <AdminFormsRoute /> },
      { path: 'admin/classification', element: <AdminClassificationRoute /> },
      {
        path: 'admin/formulaires/:formId',
        element: <AdminFormEditorRoute />,
        handle: { hideBreadcrumb: true },
      },
      // Former single-questionnaire page, replaced by the form builder.
      { path: 'admin/questionnaire', element: <Navigate to="/admin/formulaires" replace /> },
      { path: 'admin/utilisateurs', element: <AdminUtilisateursRoute /> },
      { path: 'admin/workspaces', element: <AdminWorkspacesRoute /> },
      { path: 'admin/workspaces/nouveau', element: <AdminWorkspaceNewRoute /> },
      {
        path: 'admin/workspaces/:workspaceId',
        element: <AdminWorkspaceRoute />,
        handle: { hideBreadcrumb: true },
      },
      {
        path: 'admin/workspaces/:workspaceId/membres',
        element: <AdminWorkspaceMembersRoute />,
        handle: { hideBreadcrumb: true },
      },
      {
        path: 'admin/workspaces/:workspaceId/formulaires',
        element: <AdminWorkspaceFormsRoute />,
        handle: { hideBreadcrumb: true },
      },
      {
        path: 'admin/workspaces/:workspaceId/formulaires/:formId',
        element: <AdminWorkspaceFormEditorRoute />,
        handle: { hideBreadcrumb: true },
      },
      {
        path: 'admin/workspaces/:workspaceId/sources',
        element: <AdminWorkspaceSourcesRoute />,
        handle: { hideBreadcrumb: true },
      },
      {
        path: 'admin/workspaces/:workspaceId/dispositifs',
        element: <AdminWorkspaceSchemesRoute />,
        handle: { hideBreadcrumb: true },
      },
      {
        path: 'admin/workspaces/:workspaceId/parcours',
        element: <AdminWorkspaceSupportPathRoute />,
        handle: { hideBreadcrumb: true },
      },
      {
        path: 'admin/workspaces/:workspaceId/page-publique',
        element: <AdminWorkspacePublicPageRoute />,
        handle: { hideBreadcrumb: true },
      },
      {
        path: 'admin/workspaces/:workspaceId/demandes',
        element: <AdminWorkspaceRequestsRoute />,
        handle: { hideBreadcrumb: true },
      },
      { path: 'workspaces', element: <MyWorkspacesRoute /> },
      {
        path: 'workspaces/:workspaceId',
        element: <WorkspaceRoute />,
        handle: { hideBreadcrumb: true },
      },
      {
        path: 'workspaces/:workspaceId/candidatures/:candidatureId',
        element: <ReceivedCandidatureRoute />,
        handle: { hideBreadcrumb: true },
      },
      // E08.01: its committees.
      {
        path: 'workspaces/:workspaceId/comites',
        element: <WorkspaceCommitteesRoute />,
        handle: { hideBreadcrumb: true },
      },
      {
        path: 'workspaces/:workspaceId/comites/nouveau',
        element: <NewCommitteeRoute />,
        handle: { hideBreadcrumb: true },
      },
      {
        path: 'workspaces/:workspaceId/comites/:committeeId',
        element: <CommitteeRoute />,
        handle: { hideBreadcrumb: true },
      },
      { path: 'opportunites', element: <OpportunitiesRoute /> },
      { path: 'positionnements', element: <PositionsRoute /> },
      // E10.03: the signed-in person's notifications.
      { path: 'notifications', element: <NotificationsRoute /> },
      {
        path: 'opportunites/:dossierId',
        element: <OpportunityRoute />,
        handle: { hideBreadcrumb: true },
      },
      { path: '*', element: <NotFoundRoute /> },
    ],
  },
  { path: '/share/:token', element: <ShareRoute /> },
  { path: '/share/:token/dossier', element: <ShareDossierRoute /> },
  { path: '/auth', element: <AuthRoute /> },
  { path: '/auth/verify', element: <AuthVerifyRoute /> },
  { path: '/mentions-legales', element: <MentionsLegalesRoute /> },
  { path: '/confidentialite', element: <ConfidentialiteRoute /> },
  { path: '/oauth/consent', element: <OAuthConsentRoute /> },
  // E08.04: a workspace's public participation form, signed in or not.
  // E09.01: a workspace's public page, once its managers published it.
  { path: '/w/:slug', element: <PublicWorkspaceRoute /> },
  { path: '/w/:slug/participer', element: <ParticipationRoute /> },
  { path: '/w/:slug/candidater', element: <EntrepreneurAccessRoute /> },
])
