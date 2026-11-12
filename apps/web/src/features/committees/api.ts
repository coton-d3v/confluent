import type {
  CandidateCommittee,
  ChangeCommitteeApplicationInput,
  ChangeCommitteeStatusInput,
  ChangeWorkspaceCommitteeApplicationInput,
  Committee,
  CommitteeApplication,
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

// E08.03: the requests applied to, proposed for and retained at a committee, as its workspace's
// conseillers follow them; a change (attach, accept, refuse, withdraw) from the version read.
export const listCommitteeApplications = (workspaceId: string, committeeId: string) =>
  apiRequest<CommitteeApplication[]>(`${read(workspaceId)}/${id(committeeId)}/applications`)

export const changeCommitteeApplication = (
  workspaceId: string,
  committeeId: string,
  input: ChangeWorkspaceCommitteeApplicationInput,
) =>
  apiRequest<CommitteeApplication[]>(`${read(workspaceId)}/${id(committeeId)}/applications`, {
    method: 'POST',
    body: JSON.stringify(input),
  })

// The owner's side, from their candidature: the committees they may apply to or have an entry on
// (shared view only), and their application, confirmation or withdrawal.
export const listCandidateCommittees = (candidatureId: string) =>
  apiRequest<CandidateCommittee[]>(`/v1/candidatures/${id(candidatureId)}/committees`)

export const changeCandidateApplication = (
  candidatureId: string,
  committeeId: string,
  input: ChangeCommitteeApplicationInput,
) =>
  apiRequest<CandidateCommittee[]>(
    `/v1/candidatures/${id(candidatureId)}/committees/${id(committeeId)}/application`,
    { method: 'POST', body: JSON.stringify(input) },
  )
