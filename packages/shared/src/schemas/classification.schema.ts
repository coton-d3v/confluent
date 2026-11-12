import { z } from 'zod'
import { fieldKeySchema } from './questionnaire.schema.js'

// Classification taxonomy (ROADMAP E03.12). The dimensions are columns of a dossier, so they and
// their possible values are defined here, once, for the API, the site and MCP. Which answers give
// which value is data: the rules below, edited by administrators.

// How a dimension reads the answers:
// - `label`: copies the label of the first answered field among its rules (sector, stage);
// - `choice`: maps a choice key of a field to one of the dimension's values;
// - `marker`: a choice key marks the dossier (non-tech project, deeptech signal).
export type DimensionKind = 'label' | 'choice' | 'marker'

export interface ClassificationValue {
  value: string
  label: string
}

export interface ClassificationDimension {
  label: string
  kind: DimensionKind
  values: readonly ClassificationValue[]
}

const SCALE: ClassificationValue[] = [1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: `${n} / 5` }))

export const CLASSIFICATION_DIMENSIONS = {
  sector: { label: 'Secteur', kind: 'label', values: [] },
  maturity_stage: { label: 'Stade de maturité', kind: 'label', values: [] },
  ancrage_cvl: {
    label: 'Ancrage Centre-Val de Loire',
    kind: 'choice',
    values: [
      { value: 'ancré', label: 'Basé en Centre-Val de Loire' },
      { value: 'en_cours', label: 'S’installe en Centre-Val de Loire' },
      { value: 'découverte', label: 'Découvre l’écosystème Centre-Val de Loire' },
    ],
  },
  axe1_projet: { label: 'Axe 1 — maturité du projet', kind: 'choice', values: SCALE },
  axe2_financier: { label: 'Axe 2 — maturité financière', kind: 'choice', values: SCALE },
  axe3_origine: { label: 'Axe 3 — origine du projet', kind: 'choice', values: SCALE },
  pre_creation: {
    label: 'Pré-création',
    kind: 'choice',
    values: [
      { value: 'true', label: 'Structure pas encore créée' },
      { value: 'false', label: 'Structure créée' },
    ],
  },
  non_tech: { label: 'Projet non technologique', kind: 'marker', values: [] },
  deeptech_signal: { label: 'Signal deeptech', kind: 'marker', values: [] },
} as const satisfies Record<string, ClassificationDimension>

export type ClassificationDimensionKey = keyof typeof CLASSIFICATION_DIMENSIONS

export const classificationDimensionSchema = z.enum(
  Object.keys(CLASSIFICATION_DIMENSIONS) as [ClassificationDimensionKey, ...ClassificationDimensionKey[]],
)

// Technology tag, derived from the `non_tech` and `deeptech_signal` rules: deeptech from 2 signals.
export const TECH_TAG_LABELS: Record<string, string> = {
  deeptech: 'Deeptech',
  tech: 'Tech',
  non_tech: 'Non tech',
}
export const DEEPTECH_THRESHOLD = 2

export const classificationRuleSchema = z.object({
  id: z.string().uuid(),
  dimension: classificationDimensionSchema,
  fieldKey: fieldKeySchema,
  // '' for a `label` dimension (the whole field).
  choiceKey: z.string(),
  // One of the dimension's values for `choice`, '' otherwise.
  value: z.string(),
  // Order among the fields of a `label` dimension: the first answered one wins.
  position: z.number().int(),
})

export const createClassificationRuleSchema = z.object({
  dimension: classificationDimensionSchema,
  fieldKey: fieldKeySchema,
  choiceKey: z.union([z.literal(''), fieldKeySchema]).default(''),
  value: z.string().max(50).default(''),
  position: z.number().int().min(0).max(1000).default(0),
})

export const updateClassificationRuleSchema = z
  .object({ value: z.string().max(50), position: z.number().int().min(0).max(1000) })
  .partial()
  .refine((v) => v.value !== undefined || v.position !== undefined, {
    message: 'At least one property must be provided.',
  })

// Why a rule does not fit its dimension, in French; null when it does.
export function classificationRuleProblem(rule: {
  dimension: ClassificationDimensionKey
  choiceKey: string
  value: string
}): string | null {
  const dimension: ClassificationDimension = CLASSIFICATION_DIMENSIONS[rule.dimension]
  if (dimension.kind === 'label') {
    return rule.choiceKey === '' && rule.value === ''
      ? null
      : 'Cette dimension reprend la réponse d’un champ : ni choix ni valeur à préciser.'
  }
  if (rule.choiceKey === '') return 'Précisez le choix concerné.'
  if (dimension.kind === 'marker') {
    return rule.value === '' ? null : 'Cette dimension ne prend pas de valeur.'
  }
  return dimension.values.some((v) => v.value === rule.value)
    ? null
    : `Valeur attendue parmi : ${dimension.values.map((v) => v.label).join(', ')}.`
}

// A gap between the rules and a form version (E03.12: check the result when a form evolves).
export const coverageIssueSchema = z.object({
  kind: z.enum(['missing_field', 'missing_choice', 'unmapped_choice']),
  dimension: classificationDimensionSchema,
  fieldKey: z.string(),
  choiceKey: z.string(),
  message: z.string(),
})

export const classificationCoverageSchema = z.object({
  versions: z.array(
    z.object({
      versionId: z.string().uuid(),
      version: z.number().int(),
      status: z.string(),
      issues: z.array(coverageIssueSchema),
    }),
  ),
})

// Dossier columns written by the classification.
export const classificationResultSchema = z.object({
  sector: z.string().nullable(),
  maturityStage: z.string().nullable(),
  ancrageCvl: z.string().nullable(),
  tagTechnologique: z.string().nullable(),
  axe1Projet: z.number().int().nullable(),
  axe2Financier: z.number().int().nullable(),
  axe3Origine: z.number().int().nullable(),
  deeptechScore: z.number().int().nullable(),
  preCreation: z.boolean().nullable(),
})

export const reclassificationChangeSchema = z.object({
  dossierId: z.string().uuid(),
  name: z.string(),
  changes: z.array(
    z.object({
      column: z.string(),
      from: z.union([z.string(), z.number(), z.boolean(), z.null()]),
      to: z.union([z.string(), z.number(), z.boolean(), z.null()]),
    }),
  ),
})

export const reclassificationPreviewSchema = z.object({
  checked: z.number().int(),
  dossiers: z.array(reclassificationChangeSchema),
  // Identifies the rules the preview was computed with; applying requires the same (R44).
  rulesRevision: z.string(),
})

export const applyReclassificationSchema = z.object({ rulesRevision: z.string().min(1).max(64) })

// A dossier's classification columns as people read them — the reclassification preview, and what
// the owner reads of a reclassification in their request's history (E07.09).
export const CLASSIFICATION_COLUMN_LABELS: Record<keyof ClassificationResult, string> = {
  sector: CLASSIFICATION_DIMENSIONS.sector.label,
  maturityStage: CLASSIFICATION_DIMENSIONS.maturity_stage.label,
  ancrageCvl: CLASSIFICATION_DIMENSIONS.ancrage_cvl.label,
  tagTechnologique: 'Étiquette technologique',
  axe1Projet: CLASSIFICATION_DIMENSIONS.axe1_projet.label,
  axe2Financier: CLASSIFICATION_DIMENSIONS.axe2_financier.label,
  axe3Origine: CLASSIFICATION_DIMENSIONS.axe3_origine.label,
  deeptechScore: 'Score deeptech',
  preCreation: CLASSIFICATION_DIMENSIONS.pre_creation.label,
}

// The value of a classification column as people read it; « — » for none.
export function classificationValueText(column: string, value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (column === 'ancrageCvl') {
    const values: readonly ClassificationValue[] = CLASSIFICATION_DIMENSIONS.ancrage_cvl.values
    return values.find((v) => v.value === String(value))?.label ?? String(value)
  }
  if (column === 'tagTechnologique') return TECH_TAG_LABELS[String(value)] ?? String(value)
  if (column === 'preCreation') return value ? 'Oui' : 'Non'
  return String(value)
}

export type ClassificationRule = z.infer<typeof classificationRuleSchema>
export type CreateClassificationRuleInput = z.infer<typeof createClassificationRuleSchema>
export type UpdateClassificationRuleInput = z.infer<typeof updateClassificationRuleSchema>
export type CoverageIssue = z.infer<typeof coverageIssueSchema>
export type ClassificationCoverage = z.infer<typeof classificationCoverageSchema>
export type ClassificationResult = z.infer<typeof classificationResultSchema>
export type ReclassificationChange = z.infer<typeof reclassificationChangeSchema>
export type ReclassificationPreview = z.infer<typeof reclassificationPreviewSchema>
export type ApplyReclassificationInput = z.infer<typeof applyReclassificationSchema>
