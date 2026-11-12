import type {
  ChangeCommitteeStatusInput,
  Committee,
  CreateCommitteeInput,
  UpdateCommitteeInput,
} from '@confluent/shared'
import { apiRequest } from '@/lib/api-client'

// The committees of a workspace (ROADMAP E08.01): read by its conseillers, organised by its
// managers. The API checks the rights at each call.

const id = encodeURIComponent
const read = (workspaceId: string) => `/v1/workspaces/${id(workspaceId)}/committees`
const managed = (workspaceId: string) => `/v1/admin/workspaces/${id(workspaceId)}/committees`

export const listCommittees = (workspaceId: string) => apiRequest<Committee[]>(read(workspaceId))

export const getCommittee = (workspaceId: string, committeeId: string) =>
  apiRequest<Committee>(`${read(workspaceId)}/${id(committeeId)}`)

export const createCommittee = (workspaceId: string, input: CreateCommitteeInput) =>
  apiRequest<Committee>(managed(workspaceId), { method: 'POST', body: JSON.stringify(input) })

export const updateCommittee = (
  workspaceId: string,
  committeeId: string,
  input: UpdateCommitteeInput,
) =>
  apiRequest<Committee>(`${managed(workspaceId)}/${id(committeeId)}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  })

export const changeCommitteeStatus = (
  workspaceId: string,
  committeeId: string,
  input: ChangeCommitteeStatusInput,
) =>
  apiRequest<Committee>(`${managed(workspaceId)}/${id(committeeId)}/status`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
