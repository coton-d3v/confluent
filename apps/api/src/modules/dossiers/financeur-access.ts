import { accessLevelSchema, grantsAccess, type AccessLevel } from '@confluent/shared'
import type { Dossier } from '@prisma/client'
import {
  readClassificationSources,
  type ClassificationColumn,
} from '../classification/classification-sources'

// Share access levels applied server-side to everything a financeur can read (decision 2026-11-08,
// story 12.1). Answers follow `questionnaire_fields.min_access_level`. A classification column
// stored on the dossier is derived from answers: it is shown only if this floor allows it AND every
// field it was computed from (recorded with it) is visible at the level (code review R31). Below
// `complet`, documents are not exposed at all.
const CLASSIFICATION_MIN_LEVEL: Record<ClassificationColumn, AccessLevel> = {
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
}

export const DOCUMENTS_MIN_LEVEL: AccessLevel = 'complet'

// What the projection needs to know about the dossier's version: the read level of each field (by
// key). The sources of each column are those recorded with its value (`classification_sources`).
export interface DerivedDataContext {
  fieldLevels: ReadonlyMap<string, string>
}

// `share_links.access_level` is free text in the database: an unexpected value grants the least
// access instead of leaking data.
export function grantedLevel(raw: string | null | undefined): AccessLevel {
  const parsed = accessLevelSchema.safeParse(raw)
  return parsed.success ? parsed.data : 'public'
}

// The single projection of a dossier's derived data for a share level (shares, lists, REST detail,
// MCP). Closed by default: a column without recorded sources, or with a source absent from the
// dossier's version, is hidden.
export function projectDossierForLevel<T extends Dossier>(
  dossier: T,
  level: AccessLevel,
  context: DerivedDataContext,
): T {
  const sources = readClassificationSources(dossier.classificationSources)
  // The provenance itself names fields, possibly hidden ones: it is never part of a projection.
  const projected = { ...dossier, classificationSources: null }
  for (const [column, floor] of Object.entries(CLASSIFICATION_MIN_LEVEL) as Array<
    [ClassificationColumn, AccessLevel]
  >) {
    const visible =
      grantsAccess(level, floor) &&
      sourcesVisible(sources?.[column] ?? [], level, context.fieldLevels)
    if (!visible) (projected as Record<string, unknown>)[column] = null
  }
  return projected
}

function sourcesVisible(
  keys: readonly string[],
  level: AccessLevel,
  fieldLevels: ReadonlyMap<string, string>,
): boolean {
  if (keys.length === 0) return false
  // A key unknown to the version requires the most permissive grant (`fieldVisibleAt`).
  return keys.every((key) =>
    fieldVisibleAt({ minAccessLevel: fieldLevels.get(key) ?? 'complet' }, level),
  )
}

// An unexpected `min_access_level` (the DB check constraint should prevent it) requires the most
// permissive grant, so the field stays hidden from partial shares.
export function fieldVisibleAt(field: { minAccessLevel: string }, level: AccessLevel): boolean {
  const required = accessLevelSchema.safeParse(field.minAccessLevel)
  return grantsAccess(level, required.success ? required.data : 'complet')
}
