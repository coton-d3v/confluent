import type { FinanceurShareResponse } from '@confluent/shared'
import { apiRequest, publicApiRequest, type ApiError } from '@/lib/api-client'

// Requires the recipient's session (E02.08): the API refuses another account.
export function getSharedDossier(token: string): Promise<FinanceurShareResponse> {
  return apiRequest<FinanceurShareResponse>(`/v1/shares/${encodeURIComponent(token)}`)
}

// Sends a sign-in link if `email` is the recipient's address; same answer either way.
export function requestShareAccess(token: string, email: string): Promise<void> {
  return publicApiRequest<void>(`/v1/shares/${encodeURIComponent(token)}/access-request`, {
    method: 'POST',
    body: JSON.stringify({ email }),
  })
}

export function isRecipientMismatch(err: unknown): boolean {
  const details = (err as ApiError | undefined)?.details as { reason?: string } | undefined
  return (err as ApiError | undefined)?.status === 403 && details?.reason === 'recipient_mismatch'
}
