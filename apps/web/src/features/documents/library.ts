import type { DocumentGroup, DocumentVersion } from '@confluent/shared'
import type { ApiError } from '@/lib/api-client'

// The version whose file this version holds: itself, or the deposit a chain of restorations brought
// back (E05.06). Two versions with the same original hold the same file.
function originalOf(group: DocumentGroup, version: DocumentVersion): number {
  const byNumber = new Map(group.versions.map((v) => [v.version, v]))
  let current = version
  const seen = new Set<number>()
  while (current.restoredFromVersion && !seen.has(current.version)) {
    seen.add(current.version)
    const source = byNumber.get(current.restoredFromVersion)
    if (!source) return current.restoredFromVersion
    current = source
  }
  return current.version
}

// Whether bringing this version back would change nothing: it holds the file in force.
export function holdsCurrentFile(group: DocumentGroup, version: DocumentVersion): boolean {
  return originalOf(group, version) === originalOf(group, group.current)
}

export function restoreErrorMessage(err: unknown): string {
  const e = err as Partial<ApiError> | undefined
  switch (e?.status) {
    case 409:
    case 410:
    case 503:
      return e.message ?? 'La version n’a pas été restaurée.'
    case 403:
    case 404:
      return 'Ce document n’existe plus ou vous ne pouvez pas le modifier.'
    case undefined:
      return 'La restauration n’a pas pu être envoyée : vérifiez votre connexion puis réessayez.'
    default:
      return `La version n’a pas été restaurée (erreur ${e?.status}). Réessayez.`
  }
}

export function typeChangeErrorMessage(err: unknown): string {
  const e = err as Partial<ApiError> | undefined
  if (e?.status === undefined) {
    return 'Le type n’a pas pu être enregistré : vérifiez votre connexion puis réessayez.'
  }
  if (e.status === 403 || e.status === 404) {
    return 'Ce document n’existe plus ou vous ne pouvez pas le modifier.'
  }
  return e.message ?? 'Le type n’a pas été enregistré.'
}
