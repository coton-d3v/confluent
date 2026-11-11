import type { AccessLevel } from '@confluent/shared'

export const PREVIEW_LEVEL_PARAM = 'niveau'
// E07.02: the preview opened from a candidature's pool panel, which it leads back to.
export const PREVIEW_CANDIDATURE_PARAM = 'candidature'

// The address of the preview « Voir comme le destinataire » at a level, from the page of the
// request (E07.01) or from a candidature's pool panel (E07.02: the workspace's investors will read
// the request as a recipient at the same level).
export function previewHref(
  basePath: string,
  level: AccessLevel,
  fromCandidature?: string,
): string {
  const from = fromCandidature
    ? `&${PREVIEW_CANDIDATURE_PARAM}=${encodeURIComponent(fromCandidature)}`
    : ''
  return `${basePath}/apercu?${PREVIEW_LEVEL_PARAM}=${level}${from}`
}
