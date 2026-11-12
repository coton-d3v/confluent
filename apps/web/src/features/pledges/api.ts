import type { DossierPledges, OpportunityPledge, PledgeInput } from '@confluent/shared'
import { apiRequest } from '@/lib/api-client'

// ROADMAP E07.06: an investor's pledge on one of their opportunities. Neither call reads the
// opportunity again (a reading is journaled): the page keeps what they return.
const pledgePath = (dossierId: string) =>
  `/v1/opportunities/${encodeURIComponent(dossierId)}/pledge`

// Makes or changes the pledge, from the version read (`null` for a first one).
export function setPledge(dossierId: string, input: PledgeInput): Promise<OpportunityPledge> {
  return apiRequest<OpportunityPledge>(pledgePath(dossierId), {
    method: 'PUT',
    body: JSON.stringify(input),
  })
}

export function withdrawPledge(dossierId: string): Promise<void> {
  return apiRequest<void>(pledgePath(dossierId), { method: 'DELETE' })
}

// What the owner of a request reads of its pledges: count, total and what each investor shows.
export function getDossierPledges(dossierId: string): Promise<DossierPledges> {
  return apiRequest<DossierPledges>(`/v1/dossiers/${encodeURIComponent(dossierId)}/pledges`)
}
