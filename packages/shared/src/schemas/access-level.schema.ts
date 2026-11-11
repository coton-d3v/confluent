import { z } from 'zod'

export const accessLevelSchema = z.enum(['public', 'partiel', 'complet'])

// Ordered from least to most permissive: a share granting `complet` also grants `partiel` and `public`.
const ACCESS_LEVEL_RANK = { public: 0, partiel: 1, complet: 2 } as const

export function grantsAccess(granted: AccessLevel, required: AccessLevel): boolean {
  return ACCESS_LEVEL_RANK[granted] >= ACCESS_LEVEL_RANK[required]
}

export function highestAccessLevel(levels: ReadonlyArray<AccessLevel>): AccessLevel | null {
  return levels.reduce<AccessLevel | null>(
    (best, l) => (best === null || ACCESS_LEVEL_RANK[l] > ACCESS_LEVEL_RANK[best] ? l : best),
    null,
  )
}

export type AccessLevel = z.infer<typeof accessLevelSchema>

// E07.01: the three levels of a nominative share, as the owner chooses them and the recipient reads
// them (the site, the preview « Voir comme le destinataire »). Every level is an identified reading
// (a link's recipient, a pool's investor): `public` is the narrowest one, not a publication to
// anyone nor the anonymous showcase card of a workspace (E07.04, E09).
export const ACCESS_LEVEL_LABELS: Record<AccessLevel, string> = {
  public: 'Public',
  partiel: 'Partiel',
  complet: 'Complet',
}

export const ACCESS_LEVELS = accessLevelSchema.options
