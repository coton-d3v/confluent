import type {
  CreateEntrepreneurAccessRequestInput,
  DecideEntrepreneurAccessRequestInput,
  EntrepreneurAccessDecisionResult,
  EntrepreneurAccessForm,
  EntrepreneurAccessRequest,
  ListEntrepreneurAccessRequestsQuery,
} from '@confluent/shared'
import { apiRequest, publicApiRequest } from '@/lib/api-client'

// ROADMAP E09.05: a workspace's public access request form for entrepreneurs (no session: nothing of
// the signed-in account is sent) and, for its managers, the requests it feeds.

const slugPath = (slug: string) => `/v1/public/workspaces/${encodeURIComponent(slug)}`

export const getEntrepreneurAccessForm = (slug: string) =>
  publicApiRequest<EntrepreneurAccessForm>(`${slugPath(slug)}/entrepreneur-access-form`)

// The same answer whatever the address: the API never tells whether it already asked or has an
// account.
export const sendEntrepreneurAccessRequest = (
  slug: string,
  input: CreateEntrepreneurAccessRequestInput,
) =>
  publicApiRequest<{ message: string }>(`${slugPath(slug)}/entrepreneur-access-requests`, {
    method: 'POST',
    body: JSON.stringify(input),
  })

const queuePath = (workspaceId: string) =>
  `/v1/admin/workspaces/${encodeURIComponent(workspaceId)}/entrepreneur-access-requests`

export const listEntrepreneurAccessRequests = (
  workspaceId: string,
  query: ListEntrepreneurAccessRequestsQuery = {},
) =>
  apiRequest<EntrepreneurAccessRequest[]>(
    `${queuePath(workspaceId)}${query.status ? `?status=${encodeURIComponent(query.status)}` : ''}`,
  )

// Accepted (the address's account created or kept, then an invitation email) or refused, once.
export const decideEntrepreneurAccessRequest = (
  workspaceId: string,
  requestId: string,
  input: DecideEntrepreneurAccessRequestInput,
) =>
  apiRequest<EntrepreneurAccessDecisionResult>(
    `${queuePath(workspaceId)}/${encodeURIComponent(requestId)}/decision`,
    { method: 'POST', body: JSON.stringify(input) },
  )

// The public address of a workspace's access request form.
export const entrepreneurAccessFormPath = (slug: string) =>
  `/w/${encodeURIComponent(slug)}/candidater`
