import { useAsync } from '@/lib/useAsync'
import { listMyWorkspaceMemberships } from './api'

// Loaded once per signed-in account; an account without membership, or a failed load, gets [].
export function useMyWorkspaceMemberships(userId: string | null) {
  return useAsync(
    () => (userId ? listMyWorkspaceMemberships().catch(() => []) : Promise.resolve([])),
    [userId],
  )
}
