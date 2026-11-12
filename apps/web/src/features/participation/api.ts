import type {
  CreateParticipationRequestInput,
  DecideParticipationRequestInput,
  ListParticipationRequestsQuery,
  ParticipationDecisionResult,
  ParticipationForm,
  ParticipationRequest,
} from '@confluent/shared'
import { apiRequest, publicApiRequest } from '@/lib/api-client'

// ROADMAP E08.04: a workspace's public participation form (no session: nothing of the signed-in
// account is sent) and, for its managers, the requests it feeds — pending or decided (E08.05).

const slugPath = (slug: string) => `/v1/public/workspaces/${encodeURIComponent(slug)}`

export const getParticipationForm = (slug: string) =>
  publicApiRequest<ParticipationForm>(`${slugPath(slug)}/participation-form`)

// The same answer whatever the address: the API never tells whether it already asked.
export const sendParticipationRequest = (slug: string, input: CreateParticipationRequestInput) =>
  publicApiRequest<{ message: string }>(`${slugPath(slug)}/participation-requests`, {
    method: 'POST',
    body: JSON.stringify(input),
  })

const queuePath = (workspaceId: string) =>
  `/v1/admin/workspaces/${encodeURIComponent(workspaceId)}/participation-requests`

export function listParticipationRequests(
  workspaceId: string,
  query: ListParticipationRequestsQuery = {},
) {
  const params = new URLSearchParams()
  if (query.status) params.set('status', query.status)
  if (query.committeeId) params.set('committeeId', query.committeeId)
  const search = params.toString()
  return apiRequest<ParticipationRequest[]>(`${queuePath(workspaceId)}${search ? `?${search}` : ''}`)
}

// Accepted (the address's account and membership created or kept, then an email) or refused, once.
export const decideParticipationRequest = (
  workspaceId: string,
  requestId: string,
  input: DecideParticipationRequestInput,
) =>
  apiRequest<ParticipationDecisionResult>(
    `${queuePath(workspaceId)}/${encodeURIComponent(requestId)}/decision`,
    { method: 'POST', body: JSON.stringify(input) },
  )

// The public address of a workspace's form, preselecting a session when given.
export function participationFormUrl(slug: string, committeeId?: string): string {
  const url = new URL(`/w/${encodeURIComponent(slug)}/participer`, window.location.origin)
  if (committeeId) url.searchParams.set('session', committeeId)
  return url.toString()
}
