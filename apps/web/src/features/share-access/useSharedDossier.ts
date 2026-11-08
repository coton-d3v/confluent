import type { FinanceurShareResponse } from '@confluent/shared'
import { useAuthState } from '@/features/current-user/context'
import { useAsync } from '@/lib/useAsync'
import { getSharedDossier, isRecipientMismatch } from './api'

export type SharedDossierState =
  | { status: 'loading' }
  | { status: 'anonymous' }
  | { status: 'ok'; data: FinanceurShareResponse }
  | { status: 'mismatch'; email: string }
  | { status: 'denied' }

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
    return isRecipientMismatch(query.error) ? { status: 'mismatch', email: user.email } : { status: 'denied' }
  }
  return query.data ? { status: 'ok', data: query.data } : { status: 'loading' }
}
