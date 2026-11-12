import type { ApiError } from '@/lib/api-client'

// What an administrator reads when a request failed (E10.05): `what` failed, then the API's own
// message when it gave one (a refusal, a limit, an unavailable service), or the connection to check.
export function adminFailure(err: unknown, what: string): string {
  const e = err as Partial<ApiError> | undefined
  if (e?.status === undefined) return `${what} Vérifiez votre connexion puis réessayez.`
  if (e.status === 401) return `${what} Votre session a expiré : reconnectez-vous.`
  if (e.status === 403) return `${what} Ce compte n’a plus les droits d’administration.`
  if (e.status >= 500 && e.status !== 503 && e.status !== 507) {
    return `${what} Le serveur a rencontré une erreur (${e.status}) ; réessayez.`
  }
  return e.message ? `${what} ${e.message}` : `${what} (erreur ${e.status}).`
}
