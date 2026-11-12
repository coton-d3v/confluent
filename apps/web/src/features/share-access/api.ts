import type { FinanceurShareResponse } from '@confluent/shared'
import { getAuthState, sessionGeneration } from '@/features/auth/auth-store'
import { markLinksReceived } from '@/features/documents/link-lifetime'
import { apiRequest, publicApiRequest, type ApiError } from '@/lib/api-client'

// Each reading of a share opens or resumes a consultation (E07.08: the API counts loads within 30
// minutes as one): identical requests in flight at the same time — React StrictMode mounts effects
// twice — still share one call (code review R04).
// Only within one session (code review R47): a read started for account A is never handed to B, nor
// to a later sign-in, which must each be checked by the API for themselves.
const inFlight = new Map<string, Promise<FinanceurShareResponse>>()

// Requires the recipient's session (E02.08): the API refuses another account.
export function getSharedDossier(token: string): Promise<FinanceurShareResponse> {
  const key = `${sessionGeneration()}:${getAuthState().user?.id ?? ''}:${token}`
  let request = inFlight.get(key)
  if (!request) {
    request = apiRequest<FinanceurShareResponse>(`/v1/shares/${encodeURIComponent(token)}`)
      .then(markLinksReceived)
      .finally(() => inFlight.delete(key))
    inFlight.set(key, request)
  }
  return request
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
