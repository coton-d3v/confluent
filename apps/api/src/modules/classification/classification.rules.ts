import {
  CLASSIFICATION_DIMENSIONS,
  DEEPTECH_THRESHOLD,
  type ClassificationDimensionKey,
  type ClassificationResult,
} from '@confluent/shared'

// Applies the classification rules (ROADMAP E03.12) to a dossier's answers. Pure: the rules come
// from the database, the answers from the dossier; nothing here knows a form or a label.

export interface RuleRow {
  dimension: string
  fieldKey: string
  choiceKey: string
  value: string
  position: number
}

// An answer as the rules see it: the stored value (a choice key for a list) and what it displays.
export interface ClassifiedAnswer {
  value: string
  label: string
}

export const EMPTY_CLASSIFICATION: ClassificationResult = {
  sector: null,
  maturityStage: null,
  ancrageCvl: null,
  tagTechnologique: null,
  axe1Projet: null,
  axe2Financier: null,
  axe3Origine: null,
  deeptechScore: null,
  preCreation: null,
}

export type UnmappedReporter = (
  dimension: ClassificationDimensionKey,
  fieldKey: string,
  value: string,
) => void

export function classifyAnswers(
  answers: ReadonlyMap<string, ClassifiedAnswer>,
  rules: readonly RuleRow[],
  onUnmapped: UnmappedReporter = () => undefined,
): ClassificationResult {
  const rulesOf = (dimension: ClassificationDimensionKey) =>
    rules.filter((r) => r.dimension === dimension).sort((a, b) => a.position - b.position)

  // `label`: the label of the first answered field.
  const labelOf = (dimension: ClassificationDimensionKey): string | null => {
    for (const rule of rulesOf(dimension)) {
      const answer = answers.get(rule.fieldKey)
      if (answer) return answer.label
    }
    return null
  }

  // `choice`: the value mapped to the choice of the first answered field; an answered choice that
  // no rule covers is reported (e.g. a choice added in the form builder).
  const choiceOf = (dimension: ClassificationDimensionKey): string | null => {
    const dimensionRules = rulesOf(dimension)
    for (const fieldKey of new Set(dimensionRules.map((r) => r.fieldKey))) {
      const answer = answers.get(fieldKey)
      if (!answer) continue
      const rule = dimensionRules.find(
        (r) => r.fieldKey === fieldKey && r.choiceKey === answer.value,
      )
      if (rule) return rule.value
      onUnmapped(dimension, fieldKey, answer.value)
      return null
    }
    return null
  }

  // `marker`: rules whose choice is the answer given.
  const markers = (dimension: ClassificationDimensionKey) =>
    rulesOf(dimension).filter((r) => answers.get(r.fieldKey)?.value === r.choiceKey)

  // The technology tag needs an answer to a field of the `non_tech` rules.
  let tagTechnologique: string | null = null
  let deeptechScore: number | null = null
  if (rulesOf('non_tech').some((r) => answers.has(r.fieldKey))) {
    if (markers('non_tech').length > 0) {
      tagTechnologique = 'non_tech'
      deeptechScore = 0
    } else {
      deeptechScore = new Set(markers('deeptech_signal').map((r) => r.fieldKey)).size
      tagTechnologique = deeptechScore >= DEEPTECH_THRESHOLD ? 'deeptech' : 'tech'
    }
  }

  const toInt = (v: string | null) => (v === null ? null : Number(v))
  const preCreation = choiceOf('pre_creation')
  return {
    sector: labelOf('sector'),
    maturityStage: labelOf('maturity_stage'),
    ancrageCvl: choiceOf('ancrage_cvl'),
    tagTechnologique,
    axe1Projet: toInt(choiceOf('axe1_projet')),
    axe2Financier: toInt(choiceOf('axe2_financier')),
    axe3Origine: toInt(choiceOf('axe3_origine')),
    deeptechScore,
    preCreation: preCreation === null ? null : preCreation === 'true',
  }
}

// Columns whose value differs between two classifications.
export function classificationChanges(before: ClassificationResult, after: ClassificationResult) {
  return (Object.keys(after) as Array<keyof ClassificationResult>)
    .filter((column) => before[column] !== after[column])
    .map((column) => ({ column, from: before[column], to: after[column] }))
}

export const isKnownDimension = (d: string): d is ClassificationDimensionKey =>
  Object.hasOwn(CLASSIFICATION_DIMENSIONS, d)
