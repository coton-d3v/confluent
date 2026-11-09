import type { FinanceurShareResponse } from '@confluent/shared'
import { useAuthState } from '@/features/current-user/context'
import { isTemporaryFailure, type ApiError } from '@/lib/api-client'
import { useAsync } from '@/lib/useAsync'
import { getSharedDossier, isRecipientMismatch } from './api'

export type SharedDossierState =
  | { status: 'loading' }
  | { status: 'anonymous' }
  | { status: 'ok'; data: FinanceurShareResponse }
  | { status: 'mismatch'; email: string }
  | { status: 'denied' }
  // Not a refusal (network, overload, server failure): worth trying again (code review R03).
  | { status: 'unavailable'; retry: () => void; retryAfter?: number }

// Resolves a share link for the current session: the content is only delivered to the recipient's
// account, so an anonymous visitor first has to prove who they are.
export function useSharedDossier(token: string): SharedDossierState {
  const { user, loading } = useAuthState()
  const query = useAsync<FinanceurShareResponse | null>(
    () => (user ? getSharedDossier(token) : Promise.resolve(null)),
    [token, user?.id],
  )
  if (loading) return { status: 'loading' }
  if (!user) return { status: 'anonymous' }
  if (query.isLoading) return { status: 'loading' }
  if (query.error) {
    if (isRecipientMismatch(query.error)) return { status: 'mismatch', email: user.email }
    if (isTemporaryFailure(query.error)) {
      return {
        status: 'unavailable',
        retry: query.refetch,
        retryAfter: (query.error as ApiError).retryAfter,
      }
    }
    return { status: 'denied' }
  }
  return query.data ? { status: 'ok', data: query.data } : { status: 'loading' }
}
