import type { Opportunities, OpportunitiesQuery, Opportunity } from '@confluent/shared'
import { getAuthState, sessionGeneration } from '@/features/auth/auth-store'
import { apiRequest } from '@/lib/api-client'

// ROADMAP E07.03: the signed-in investor's opportunities, filtered and paged by the API.
export function listOpportunities(query: OpportunitiesQuery = {}): Promise<Opportunities> {
  const search = new URLSearchParams(
    Object.entries(query).flatMap(([key, value]) =>
      value === undefined || value === '' ? [] : [[key, String(value)]],
    ),
  ).toString()
  return apiRequest<Opportunities>(`/v1/opportunities${search ? `?${search}` : ''}`)
}

// Each reading of an opportunity is journaled once (`opportunity_viewed`): identical requests in
// flight at the same time — React StrictMode mounts effects twice — share one call, within one
// session only (as for a share, code review R04/R47).
const inFlight = new Map<string, Promise<Opportunity>>()

export function getOpportunity(dossierId: string): Promise<Opportunity> {
  const key = `${sessionGeneration()}:${getAuthState().user?.id ?? ''}:${dossierId}`
  let request = inFlight.get(key)
  if (!request) {
    request = apiRequest<Opportunity>(`/v1/opportunities/${encodeURIComponent(dossierId)}`).finally(
      () => inFlight.delete(key),
    )
    inFlight.set(key, request)
  }
  return request
}
