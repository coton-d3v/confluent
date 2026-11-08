import { accessLevelSchema, grantsAccess, type AccessLevel } from '@confluent/shared'
import type { Dossier } from '@prisma/client'

// Share access levels applied server-side to everything a financeur can read (decision 2026-11-08,
// story 12.1). Answers follow `questionnaire_fields.min_access_level`; the classification columns
// stored on the dossier follow this table. Below `complet`, documents are not exposed at all.
const CLASSIFICATION_MIN_LEVEL = {
  sector: 'public',
  maturityStage: 'public',
  ancrageCvl: 'public',
  tagTechnologique: 'public',
  axe1Projet: 'partiel',
  axe3Origine: 'partiel',
  deeptechScore: 'partiel',
  preCreation: 'partiel',
  // Derived from "Stade de financement actuel": financial data, hidden below `complet`.
  axe2Financier: 'complet',
} as const satisfies Record<string, AccessLevel>

export const DOCUMENTS_MIN_LEVEL: AccessLevel = 'complet'

// `share_links.access_level` is free text in the database: an unexpected value grants the least
// access instead of leaking data.
export function grantedLevel(raw: string | null | undefined): AccessLevel {
  const parsed = accessLevelSchema.safeParse(raw)
  return parsed.success ? parsed.data : 'public'
}

export function projectDossierForLevel<T extends Dossier>(dossier: T, level: AccessLevel): T {
  const projected = { ...dossier }
  for (const [column, required] of Object.entries(CLASSIFICATION_MIN_LEVEL)) {
    if (!grantsAccess(level, required)) {
      ;(projected as Record<string, unknown>)[column] = null
    }
  }
  return projected
}

// An unexpected `min_access_level` (the DB check constraint should prevent it) requires the most
// permissive grant, so the field stays hidden from partial shares.
export function fieldVisibleAt(field: { minAccessLevel: string }, level: AccessLevel): boolean {
  const required = accessLevelSchema.safeParse(field.minAccessLevel)
  return grantsAccess(level, required.success ? required.data : 'complet')
}
