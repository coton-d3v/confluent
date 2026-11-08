import {
  accessLevelSchema,
  grantsAccess,
  type AccessLevel,
  type ClassificationDimensionKey,
} from '@confluent/shared'
import type { Dossier } from '@prisma/client'

// Share access levels applied server-side to everything a financeur can read (decision 2026-11-08,
// story 12.1). Answers follow `questionnaire_fields.min_access_level`. A classification column
// stored on the dossier is derived from answers: it is shown only if this floor allows it AND every
// field it is computed from is visible at the level (code review R31). Below `complet`, documents
// are not exposed at all.
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

type ClassificationColumn = keyof typeof CLASSIFICATION_MIN_LEVEL

// Dimensions of the classification rules (E03.12) each column is computed from.
const COLUMN_DIMENSIONS: Record<ClassificationColumn, readonly ClassificationDimensionKey[]> = {
  sector: ['sector'],
  maturityStage: ['maturity_stage'],
  ancrageCvl: ['ancrage_cvl'],
  tagTechnologique: ['non_tech', 'deeptech_signal'],
  deeptechScore: ['non_tech', 'deeptech_signal'],
  axe1Projet: ['axe1_projet'],
  axe2Financier: ['axe2_financier'],
  axe3Origine: ['axe3_origine'],
  preCreation: ['pre_creation'],
}

// What the projection needs to know about the dossier's version: the read level of each field (by
// key) and the classification rules (which field keys feed which dimension).
export interface DerivedDataContext {
  fieldLevels: ReadonlyMap<string, string>
  rules: ReadonlyArray<{ dimension: string; fieldKey: string }>
}

// `share_links.access_level` is free text in the database: an unexpected value grants the least
// access instead of leaking data.
export function grantedLevel(raw: string | null | undefined): AccessLevel {
  const parsed = accessLevelSchema.safeParse(raw)
  return parsed.success ? parsed.data : 'public'
}

// The single projection of a dossier's derived data for a share level (shares, lists, REST detail,
// MCP). Closed by default: a column whose source fields are not in the dossier's version is hidden.
export function projectDossierForLevel<T extends Dossier>(
  dossier: T,
  level: AccessLevel,
  context: DerivedDataContext,
): T {
  const projected = { ...dossier }
  for (const [column, floor] of Object.entries(CLASSIFICATION_MIN_LEVEL)) {
    if (!derivedColumnVisible(column as ClassificationColumn, floor, level, context)) {
      ;(projected as Record<string, unknown>)[column] = null
    }
  }
  return projected
}

function derivedColumnVisible(
  column: ClassificationColumn,
  floor: AccessLevel,
  level: AccessLevel,
  { fieldLevels, rules }: DerivedDataContext,
): boolean {
  if (!grantsAccess(level, floor)) return false
  const dimensions: readonly string[] = COLUMN_DIMENSIONS[column]
  const sources = new Set(
    rules
      .filter((r) => dimensions.includes(r.dimension) && fieldLevels.has(r.fieldKey))
      .map((r) => r.fieldKey),
  )
  if (sources.size === 0) return false
  return [...sources].every((key) =>
    fieldVisibleAt({ minAccessLevel: fieldLevels.get(key)! }, level),
  )
}

// An unexpected `min_access_level` (the DB check constraint should prevent it) requires the most
// permissive grant, so the field stays hidden from partial shares.
export function fieldVisibleAt(field: { minAccessLevel: string }, level: AccessLevel): boolean {
  const required = accessLevelSchema.safeParse(field.minAccessLevel)
  return grantsAccess(level, required.success ? required.data : 'complet')
}
