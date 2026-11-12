import type {
  DossierPositions,
  MyPositions,
  PositionDisclosure,
  WorkspacePositions,
} from '@confluent/shared'
import { apiRequest } from '@/lib/api-client'

// ROADMAP E07.07: investors' positions (marks of interest and pledges) as each audience reads them.
// None of these calls reads an opportunity (a reading is journaled).

// « Mes positionnements »: the signed-in investor's own marks, pledges and consents.
export function getMyPositions(): Promise<MyPositions> {
  return apiRequest<MyPositions>('/v1/positions')
}

// The investor's explicit consent to show a structure their position on a request it brings them.
export function disclosePosition(
  dossierId: string,
  workspaceId: string,
): Promise<PositionDisclosure> {
  return apiRequest<PositionDisclosure>(
    `/v1/opportunities/${encodeURIComponent(dossierId)}/structures/${encodeURIComponent(workspaceId)}`,
    { method: 'PUT', body: JSON.stringify({ consent: true }) },
  )
}

// Withdraws a consent by its id, whether the investor still reads the request or not.
export function withdrawDisclosure(disclosureId: string): Promise<void> {
  return apiRequest<void>(`/v1/positions/disclosures/${encodeURIComponent(disclosureId)}`, {
    method: 'DELETE',
  })
}

// What the owner of a request reads of the investors' positions, in one view.
export function getDossierPositions(dossierId: string): Promise<DossierPositions> {
  return apiRequest<DossierPositions>(`/v1/dossiers/${encodeURIComponent(dossierId)}/positions`)
}

// What a structure's conseillers read: the positions its investors chose to show it.
export function getWorkspacePositions(workspaceId: string): Promise<WorkspacePositions> {
  return apiRequest<WorkspacePositions>(
    `/v1/workspaces/${encodeURIComponent(workspaceId)}/positions`,
  )
}
