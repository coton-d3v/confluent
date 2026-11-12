import {
  CLASSIFICATION_COLUMN_LABELS,
  CLASSIFICATION_DIMENSIONS,
  classificationValueText,
  type QuestionnaireField,
  type ClassificationDimensionKey,
} from '@confluent/shared'

export const DIMENSION_KEYS = Object.keys(CLASSIFICATION_DIMENSIONS) as ClassificationDimensionKey[]

export const KIND_HELP = {
  label: 'Reprend la réponse du premier champ répondu, dans l’ordre ci-dessous.',
  choice: 'Chaque choix d’un champ donne une valeur.',
  marker: 'Chaque choix listé marque le dossier.',
} as const

// Dossier columns, as named in the reclassification preview (and in the owner's history, E07.09).
export const COLUMN_LABELS = CLASSIFICATION_COLUMN_LABELS

export function valueLabel(dimension: ClassificationDimensionKey, value: string): string {
  const values: readonly { value: string; label: string }[] = CLASSIFICATION_DIMENSIONS[dimension].values
  return values.find((v) => v.value === value)?.label ?? value
}

export const displayResultValue = classificationValueText

// Labels of the dossier form's fields and choices, by key. Versions are merged (published first):
// a field keeps its published label, and gains the choices only present in the draft.
export function formLabels(versionsFields: readonly QuestionnaireField[]) {
  const byKey = new Map<string, QuestionnaireField>()
  for (const field of versionsFields) {
    const known = byKey.get(field.key)
    if (!known) {
      byKey.set(field.key, { ...field, choices: [...field.choices] })
      continue
    }
    for (const choice of field.choices) {
      if (!known.choices.some((c) => c.key === choice.key)) known.choices.push(choice)
    }
  }
  const fields = [...byKey.values()]
  return {
    field: (key: string) => byKey.get(key)?.label ?? null,
    choice: (fieldKey: string, choiceKey: string) =>
      byKey.get(fieldKey)?.choices.find((c) => c.key === choiceKey)?.label ?? null,
    listFields: fields.filter((f) => f.fieldType === 'select' && f.choices.length > 0),
    allFields: fields,
  }
}
