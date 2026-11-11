import { accessLevelSchema, grantsAccess, isPublished, type AccessLevel } from '@confluent/shared'
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

// E07.04: what the three levels are, said once for the API documentation of every route that
// chooses or applies one. A level always qualifies an identified reading — the signed-in recipient
// of a nominative link, an active investor of a pool —: `public` is its narrowest level, not a
// publication to anyone, and its projection keeps the request's real title and answers. The
// anonymous showcase card of a workspace (E09: pseudonym, no real name) is another projection, never
// this one.
export const ACCESS_LEVELS_DOC =
  'Niveaux : `public` < `partiel` < `complet`, toujours une lecture **nominative** par un compte ' +
  'identifié et connecté (destinataire du lien, investisseur actif du vivier). `public`, le plus ' +
  'restreint, montre le titre, la présentation une fois publiée, et les réponses, la ' +
  'classification et les pièces jointes que ce niveau permet de lire : ce n’est ni une ' +
  'publication ouverte à tous ni une fiche anonyme (la vitrine publique d’un workspace, E09, ' +
  'aura sa propre fiche sous pseudonyme).'

// How a reader reaches a dossier: its owner, or a recipient of one of its shares. A share recipient
// reads the documents the dossier selects (E05.07), the owner the company's whole library.
export type DossierRelation = 'owner' | 'share'

// E05.07: the presentation of a request, as a share recipient reads it — nothing while it is a draft
// (closed by default: any status but `published`). Its owner and administrators read it as stored.
// The title (`name`) stays: shares have always shown it.
export function presentationForShare<
  T extends {
    publicationStatus: string
    summary: string | null
    objective: string | null
    description: string | null
    amountEur: number | null
    financingTypes: string[]
  },
>(dossier: T): T {
  if (isPublished(dossier)) return dossier
  return {
    ...dossier,
    summary: null,
    objective: null,
    description: null,
    amountEur: null,
    financingTypes: [],
  }
}

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
