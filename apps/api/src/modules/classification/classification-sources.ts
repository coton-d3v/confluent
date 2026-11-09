import { createHash } from 'node:crypto'
import type { ClassificationDimensionKey, ClassificationResult } from '@confluent/shared'

export type ClassificationColumn = keyof ClassificationResult

// Dimensions of the classification rules (E03.12) each stored column is computed from.
export const COLUMN_DIMENSIONS: Record<
  ClassificationColumn,
  readonly ClassificationDimensionKey[]
> = {
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

// For each column, the field keys of the dossier's version that the rules read (code review R31).
// Stored with the values: what a share may see is judged on how a value was computed, not on the
// rules as they are later. A column without any source is absent.
export type ClassificationSources = Partial<Record<ClassificationColumn, string[]>>

export function classificationSources(
  rules: ReadonlyArray<{ dimension: string; fieldKey: string }>,
  versionFieldKeys: ReadonlySet<string>,
): ClassificationSources {
  const sources: ClassificationSources = {}
  for (const [column, dimensions] of Object.entries(COLUMN_DIMENSIONS) as Array<
    [ClassificationColumn, readonly string[]]
  >) {
    const keys = [
      ...new Set(
        rules
          .filter((r) => dimensions.includes(r.dimension) && versionFieldKeys.has(r.fieldKey))
          .map((r) => r.fieldKey),
      ),
    ].sort()
    if (keys.length > 0) sources[column] = keys
  }
  return sources
}

// Stored provenance, read defensively: anything unexpected counts as unknown (null), which hides
// the derived data from shares.
export function readClassificationSources(value: unknown): ClassificationSources | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const sources: ClassificationSources = {}
  for (const column of Object.keys(COLUMN_DIMENSIONS) as ClassificationColumn[]) {
    const keys = (value as Record<string, unknown>)[column]
    if (keys === undefined) continue
    if (!Array.isArray(keys) || !keys.every((k) => typeof k === 'string')) return null
    sources[column] = keys
  }
  return sources
}

// Identifies a set of rules (code review R44): a reclassification applies the rules its preview
// was computed with, or nothing.
export function rulesRevision(
  rules: ReadonlyArray<{
    dimension: string
    fieldKey: string
    choiceKey: string
    value: string
    position: number
  }>,
): string {
  const canonical = rules
    .map((r) => [r.dimension, r.fieldKey, r.choiceKey, r.value, r.position])
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex').slice(0, 16)
}
