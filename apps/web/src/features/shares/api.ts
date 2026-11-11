import type {
  AccessLevel,
  ShareAccess,
  ShareLink,
  SharePreview,
} from '@confluent/shared'
import { apiRequest } from '@/lib/api-client'

const sharesPath = (dossierId: string) => `/v1/dossiers/${encodeURIComponent(dossierId)}/shares`

// The list of accesses of a request, each revoked one with who revoked it (E07.01).
export function listShares(dossierId: string): Promise<ShareAccess[]> {
  return apiRequest<ShareAccess[]>(sharesPath(dossierId))
}

// The owner chooses the level of each invitation (E07.01): none is assumed.
export function createShare(
  dossierId: string,
  recipientEmail: string,
  accessLevel: AccessLevel,
): Promise<ShareLink & { shareUrl: string }> {
  return apiRequest<ShareLink & { shareUrl: string }>(sharesPath(dossierId), {
    method: 'POST',
    body: JSON.stringify({ recipientEmail, accessLevel }),
  })
}

// The recipient keeps the same link and reads the new level at their next request.
export function changeShareLevel(
  dossierId: string,
  linkId: string,
  accessLevel: AccessLevel,
): Promise<ShareAccess> {
  return apiRequest<ShareAccess>(`${sharesPath(dossierId)}/${encodeURIComponent(linkId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ accessLevel }),
  })
}

export function revokeShare(dossierId: string, linkId: string): Promise<ShareAccess> {
  return apiRequest<ShareAccess>(`${sharesPath(dossierId)}/${encodeURIComponent(linkId)}`, {
    method: 'DELETE',
  })
}

// « Voir comme le destinataire » (E07.01): what a recipient at `level` reads, without any link nor
// any view recorded.
export function getSharePreview(dossierId: string, level: AccessLevel): Promise<SharePreview> {
  return apiRequest<SharePreview>(
    `/v1/dossiers/${encodeURIComponent(dossierId)}/share-preview?level=${encodeURIComponent(level)}`,
  )
}
