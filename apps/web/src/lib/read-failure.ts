import type { ApiError } from './api-client'

// ROADMAP E10.06: why a reading failed, in words, for a LoadError with « Réessayer » — after `what`
// (« Vos dossiers n’ont pas pu être chargés. »). Never the server's internal message.
export function readFailure(err: unknown, what: string): string {
  const status = (err as Partial<ApiError> | undefined)?.status
  if (status === undefined) {
    return `${what} Le serveur ne répond pas : vérifiez votre connexion internet, puis réessayez.`
  }
  if (status === 401) return `${what} Votre session a expiré : reconnectez-vous.`
  if (status === 429 || status >= 500) {
    return `${what} Le serveur est momentanément indisponible : réessayez dans quelques instants.`
  }
  return `${what} (erreur ${status})`
}
