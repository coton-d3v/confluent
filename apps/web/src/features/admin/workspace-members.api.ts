import type {
  InviteWorkspaceMemberInput,
  UpdateWorkspaceMemberInput,
  WorkspaceMember,
  WorkspaceMemberInvitation,
} from '@confluent/shared'
import { apiRequest } from '@/lib/api-client'

// Members of a workspace (ROADMAP E05.02), for its administrators and managers.

const members = (workspaceId: string) =>
  `/v1/admin/workspaces/${encodeURIComponent(workspaceId)}/members`
const member = (workspaceId: string, membershipId: string) =>
  `${members(workspaceId)}/${encodeURIComponent(membershipId)}`

export const listWorkspaceMembers = (workspaceId: string) =>
  apiRequest<WorkspaceMember[]>(members(workspaceId))

export const inviteWorkspaceMember = (workspaceId: string, input: InviteWorkspaceMemberInput) =>
  apiRequest<WorkspaceMemberInvitation>(members(workspaceId), {
    method: 'POST',
    body: JSON.stringify(input),
  })

export const updateWorkspaceMember = (
  workspaceId: string,
  membershipId: string,
  input: UpdateWorkspaceMemberInput,
) =>
  apiRequest<WorkspaceMember>(member(workspaceId, membershipId), {
    method: 'PATCH',
    body: JSON.stringify(input),
  })

export const deactivateWorkspaceMember = (workspaceId: string, membershipId: string) =>
  apiRequest<WorkspaceMember>(`${member(workspaceId, membershipId)}/deactivate`, {
    method: 'POST',
  })

export const reactivateWorkspaceMember = (workspaceId: string, membershipId: string) =>
  apiRequest<WorkspaceMember>(`${member(workspaceId, membershipId)}/reactivate`, {
    method: 'POST',
  })
