import type {
  PublicWorkspacePage,
  UpdateWorkspacePageInput,
  WorkspacePageSettings,
} from '@confluent/shared'
import { API_BASE_URL, apiRequest, publicApiRequest } from '@/lib/api-client'

// ROADMAP E09.01: a workspace's public page (no session: nothing of the signed-in account is sent)
// and, for its managers, its settings with a preview of what the public sees.

const slugPath = (slug: string) => `/v1/public/workspaces/${encodeURIComponent(slug)}`

// Read again at each visit, never from the browser's cache (E09.03: a card withdrawn, paused or
// hidden is gone at the next read; the API also answers `no-store`).
export const getPublicWorkspacePage = (slug: string) =>
  publicApiRequest<PublicWorkspacePage>(slugPath(slug), { cache: 'no-store' })

// The logo of a published page, served by the API (never a bucket address); the version changes with
// the image, so that no browser keeps an old one.
export const publicLogoUrl = (slug: string, version: string) =>
  `${API_BASE_URL}${slugPath(slug)}/logo?v=${encodeURIComponent(version)}`

const settingsPath = (workspaceId: string) =>
  `/v1/admin/workspaces/${encodeURIComponent(workspaceId)}/public-page`

export const getWorkspacePage = (workspaceId: string) =>
  apiRequest<WorkspacePageSettings>(settingsPath(workspaceId))

// Every setting again, from the version read (409 when the page changed meanwhile).
export const updateWorkspacePage = (workspaceId: string, input: UpdateWorkspacePageInput) =>
  apiRequest<WorkspacePageSettings>(settingsPath(workspaceId), {
    method: 'PUT',
    body: JSON.stringify(input),
  })
