import {
  ACCEPTED_DOCUMENT_EXTENSIONS,
  ACCEPTED_DOCUMENT_FORMATS_LABEL,
  MAX_DOCUMENT_BYTES,
} from '@confluent/shared'
import type { ApiError } from '@/lib/api-client'

export const ACCEPT_ATTRIBUTE = ACCEPTED_DOCUMENT_EXTENSIONS.map((ext) => `.${ext}`).join(',')

export const extensionOf = (name: string) => /\.([^.]+)$/.exec(name)?.[1]?.toLowerCase() ?? ''

// Immediate feedback before sending anything; the API still checks the actual content.
export function fileProblem(file: File): string | null {
  if (file.size > MAX_DOCUMENT_BYTES) {
    return `« ${file.name} » dépasse 20 Mo (${formatSize(file.size)}).`
  }
  if (file.size === 0) return `« ${file.name} » est vide.`
  if (!(ACCEPTED_DOCUMENT_EXTENSIONS as readonly string[]).includes(extensionOf(file.name))) {
    return `Format de « ${file.name} » non accepté. Formats acceptés : ${ACCEPTED_DOCUMENT_FORMATS_LABEL}.`
  }
  return null
}

export function uploadErrorMessage(err: unknown, filename: string): string {
  const e = err as Partial<ApiError> | undefined
  switch (e?.status) {
    case 413:
      return `« ${filename} » dépasse 20 Mo.`
    case 415:
    case 507:
    case 503:
      return e.message ?? 'Le fichier n’a pas été enregistré.'
    case 403:
    case 404:
      return 'Vous ne pouvez pas déposer de document dans ce dossier.'
    case undefined:
      return `« ${filename} » n’a pas pu être envoyé : vérifiez votre connexion puis réessayez.`
    default:
      return `« ${filename} » n’a pas été enregistré (erreur ${e?.status}). Réessayez.`
  }
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} Mo`
}
