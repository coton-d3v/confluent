import type { OwnerHistoryFilter, OwnerHistoryPage } from '@confluent/shared'
import { apiRequest } from '@/lib/api-client'

// ROADMAP E07.09: the history of a request, its owner's to read, one page at a time.
export function getDossierHistory(
  dossierId: string,
  filter: OwnerHistoryFilter,
  page: number,
): Promise<OwnerHistoryPage> {
  const query = new URLSearchParams({ filter, page: String(page) })
  return apiRequest<OwnerHistoryPage>(
    `/v1/dossiers/${encodeURIComponent(dossierId)}/history?${query.toString()}`,
  )
}
