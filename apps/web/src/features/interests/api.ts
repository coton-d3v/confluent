import type { OpportunityInterest } from '@confluent/shared'
import { apiRequest } from '@/lib/api-client'

// ROADMAP E07.05: an investor's mark of interest on one of their opportunities. Neither call reads
// the opportunity again (a reading is journaled): the page keeps what they return.
const interestPath = (dossierId: string) =>
  `/v1/opportunities/${encodeURIComponent(dossierId)}/interest`

// Marks the interest, or changes whether the owner may see who marked it.
export function markInterest(dossierId: string, nameVisible: boolean): Promise<OpportunityInterest> {
  return apiRequest<OpportunityInterest>(interestPath(dossierId), {
    method: 'PUT',
    body: JSON.stringify({ nameVisible }),
  })
}

export function withdrawInterest(dossierId: string): Promise<void> {
  return apiRequest<void>(interestPath(dossierId), { method: 'DELETE' })
}
