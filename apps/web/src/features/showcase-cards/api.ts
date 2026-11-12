import type {
  OwnerShowcaseCard,
  ReceivedShowcaseCard,
  SetShowcaseCardInput,
} from '@confluent/shared'
import { apiRequest } from '@/lib/api-client'

// ROADMAP E09.02: a request's anonymous card on the public page of a workspace it is presented to —
// its owner's consent (pseudonym, region) and withdrawal; what the workspace's conseillers read of
// it. The API decides at each call.

const id = encodeURIComponent
const ownPath = (candidatureId: string) => `/v1/candidatures/${id(candidatureId)}/showcase-card`

export const getShowcaseCard = (candidatureId: string) =>
  apiRequest<OwnerShowcaseCard>(ownPath(candidatureId))

// From the version read (`null` before any consent): 409 when the card changed meanwhile.
export const setShowcaseCard = (candidatureId: string, input: SetShowcaseCardInput) =>
  apiRequest<OwnerShowcaseCard>(ownPath(candidatureId), {
    method: 'PUT',
    body: JSON.stringify(input),
  })

export const withdrawShowcaseCard = (candidatureId: string) =>
  apiRequest<OwnerShowcaseCard>(ownPath(candidatureId), { method: 'DELETE' })

export const getReceivedShowcaseCard = (workspaceId: string, candidatureId: string) =>
  apiRequest<ReceivedShowcaseCard>(
    `/v1/workspaces/${id(workspaceId)}/candidatures/${id(candidatureId)}/showcase-card`,
  )
