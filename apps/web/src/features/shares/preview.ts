import type { AccessLevel } from '@confluent/shared'

export const PREVIEW_LEVEL_PARAM = 'niveau'

// The address of the preview « Voir comme le destinataire » at a level, from the page of the
// request (E07.01).
export function previewHref(basePath: string, level: AccessLevel): string {
  return `${basePath}/apercu?${PREVIEW_LEVEL_PARAM}=${level}`
}
