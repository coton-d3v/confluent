import type { ActiveQuestionnaire, Dossier, UpdateDossierInput } from '@confluent/shared'
import { apiRequest } from '@/lib/api-client'

export interface DossierWithQuestionnaire extends Dossier {
  questionnaireVersion: ActiveQuestionnaire | null
}

export function listDossiers(): Promise<Dossier[]> {
  return apiRequest<Dossier[]>('/v1/dossiers')
}

export function getDossier(id: string): Promise<DossierWithQuestionnaire> {
  return apiRequest<DossierWithQuestionnaire>(
    `/v1/dossiers/${encodeURIComponent(id)}`,
  )
}

export function createDossier(input: { name: string }): Promise<Dossier> {
  return apiRequest<Dossier>('/v1/dossiers', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

// Title and presentation of a request (E05.07); an omitted part is left as it is, null clears it.
export function updateDossier(id: string, input: UpdateDossierInput): Promise<Dossier> {
  return apiRequest<Dossier>(`/v1/dossiers/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  })
}

export function deleteDossier(id: string): Promise<void> {
  return apiRequest<void>(`/v1/dossiers/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export function submitDossier(id: string): Promise<Dossier> {
  return apiRequest<Dossier>(`/v1/dossiers/${encodeURIComponent(id)}/submit`, {
    method: 'POST',
  })
}

// E05.07: the owner publishes the request (presentation complete, profile submitted), or takes it
// back to a draft. Neither opens nor closes a share.
export function publishDossier(id: string): Promise<Dossier> {
  return apiRequest<Dossier>(`/v1/dossiers/${encodeURIComponent(id)}/publish`, { method: 'POST' })
}

export function unpublishDossier(id: string): Promise<Dossier> {
  return apiRequest<Dossier>(`/v1/dossiers/${encodeURIComponent(id)}/unpublish`, {
    method: 'POST',
  })
}
