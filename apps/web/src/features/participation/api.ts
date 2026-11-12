import type {
  CreateParticipationRequestInput,
  ParticipationForm,
  ParticipationRequest,
} from '@confluent/shared'
import { apiRequest, publicApiRequest } from '@/lib/api-client'

// ROADMAP E08.04: a workspace's public participation form (no session: nothing of the signed-in
// account is sent) and, for its managers, the pending requests it feeds.

const slugPath = (slug: string) => `/v1/public/workspaces/${encodeURIComponent(slug)}`

export const getParticipationForm = (slug: string) =>
  publicApiRequest<ParticipationForm>(`${slugPath(slug)}/participation-form`)

// The same answer whatever the address: the API never tells whether it already asked.
export const sendParticipationRequest = (slug: string, input: CreateParticipationRequestInput) =>
  publicApiRequest<{ message: string }>(`${slugPath(slug)}/participation-requests`, {
    method: 'POST',
    body: JSON.stringify(input),
  })

export const listParticipationRequests = (workspaceId: string) =>
  apiRequest<ParticipationRequest[]>(
    `/v1/admin/workspaces/${encodeURIComponent(workspaceId)}/participation-requests`,
  )

// The public address of a workspace's form, preselecting a session when given.
export function participationFormUrl(slug: string, committeeId?: string): string {
  const url = new URL(`/w/${encodeURIComponent(slug)}/participer`, window.location.origin)
  if (committeeId) url.searchParams.set('session', committeeId)
  return url.toString()
}
