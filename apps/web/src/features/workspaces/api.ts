import type { CurrentWorkspace, MyWorkspaceMembership } from '@confluent/shared'
import { apiRequest } from '@/lib/api-client'

// The signed-in person's active workspace memberships (ROADMAP E05.02): the workspaces they can
// switch between (E05.03).
export const listMyWorkspaceMemberships = () =>
  apiRequest<MyWorkspaceMembership[]>('/v1/workspaces/memberships')

// Entering a workspace (E05.03): the API checks the membership at each call, whatever the site
// remembers (`404` alike for an unknown workspace and one the account is no longer in).
export const enterWorkspace = (workspaceId: string) =>
  apiRequest<CurrentWorkspace>(`/v1/workspaces/${encodeURIComponent(workspaceId)}`)
