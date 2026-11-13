import type {
  AdminDeletionRequest,
  MyDeletionRequest,
  MyDeletionRequestState,
  PersonalDataExport,
} from '@confluent/shared'
import { apiRequest } from '@/lib/api-client'

export type { AdminDeletionRequest, MyDeletionRequest, PersonalDataExport }

// ROADMAP E10.10: the signed-in person's data — the export, their deletion request — and the
// administrators' queue of deletion requests.

export function exportMyData(): Promise<PersonalDataExport> {
  return apiRequest<PersonalDataExport>('/v1/me/export')
}

export async function getMyDeletionRequest(): Promise<MyDeletionRequest | null> {
  return (await apiRequest<MyDeletionRequestState>('/v1/me/deletion-request')).request
}

export function requestAccountDeletion(): Promise<MyDeletionRequest> {
  return apiRequest<MyDeletionRequest>('/v1/me/deletion-request', {
    method: 'POST',
    body: JSON.stringify({ confirm: true }),
  })
}

export function cancelAccountDeletion(): Promise<MyDeletionRequest> {
  return apiRequest<MyDeletionRequest>('/v1/me/deletion-request', { method: 'DELETE' })
}

export function listDeletionRequests(status: 'pending' | 'decided'): Promise<AdminDeletionRequest[]> {
  return apiRequest<AdminDeletionRequest[]>(`/v1/admin/deletion-requests?status=${status}`)
}

export function completeDeletionRequest(id: string): Promise<AdminDeletionRequest> {
  return apiRequest<AdminDeletionRequest>(
    `/v1/admin/deletion-requests/${encodeURIComponent(id)}/complete`,
    { method: 'POST', body: JSON.stringify({ confirm: true }) },
  )
}

export function declineDeletionRequest(id: string, note: string): Promise<AdminDeletionRequest> {
  return apiRequest<AdminDeletionRequest>(
    `/v1/admin/deletion-requests/${encodeURIComponent(id)}/decline`,
    { method: 'POST', body: JSON.stringify({ note }) },
  )
}

// The export, saved by the browser as the file the server names (`confluent-mes-donnees-<date>.json`).
export function saveExport(data: PersonalDataExport): string {
  const filename = `confluent-mes-donnees-${data.exportedAt.slice(0, 10)}.json`
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
  )
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
  return filename
}
