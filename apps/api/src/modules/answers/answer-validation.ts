import type { QuestionnaireField } from '@prisma/client'
import { readChoices } from '../questionnaires/questionnaire-structure'

export interface AnswerValidationError {
  fieldId: string
  label?: string
  message: string
}

const MAX_LENGTH = 10_000

// Checks one value against its field definition. Returns a human-readable reason, or null when valid.
// An empty string clears an answer and is always accepted (required-ness is checked at submission).
export function validateAnswerValue(field: QuestionnaireField, value: string): string | null {
  if (value.length > MAX_LENGTH) return `${MAX_LENGTH} caractères maximum.`
  if (value === '') return null
  switch (field.fieldType) {
    case 'email':
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? null : 'Adresse email invalide.'
    case 'number':
      return /^-?\d+([.,]\d+)?$/.test(value.trim()) ? null : 'Nombre attendu (ex. 1200 ou 3,5).'
    case 'date':
      return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value))
        ? null
        : 'Date attendue au format AAAA-MM-JJ.'
    case 'checkbox':
      return value === 'true' || value === 'false' ? null : 'Valeur attendue : "true" ou "false".'
    case 'select': {
      const choices = readChoices(field.choices)
      return choices.length === 0 || choices.some((c) => c.key === value)
        ? null
        : `Choix attendu parmi : ${choices.map((c) => `"${c.key}" (${c.label})`).join(', ')}.`
    }
    case 'file':
      return 'Ce champ attend un document : utilisez le dépôt de documents.'
    default:
      return null
  }
}

// Select answers store the choice key; a value equal to a choice's exact label is accepted and
// stored as its key (convenient for AI clients and imports). Other values are left untouched for
// validation to report.
export function normalizeAnswers<T extends { fieldId: string; value: string }>(
  fields: QuestionnaireField[],
  answers: readonly T[],
): T[] {
  const byId = new Map(fields.map((f) => [f.id, f]))
  return answers.map((answer) => {
    const field = byId.get(answer.fieldId)
    if (field?.fieldType !== 'select') return answer
    const choices = readChoices(field.choices)
    if (choices.some((c) => c.key === answer.value)) return answer
    const byLabel = choices.find((c) => c.label === answer.value)
    return byLabel ? { ...answer, value: byLabel.key } : answer
  })
}

// Validates a batch of answers for a dossier: every field must belong to the dossier's own
// questionnaire version (never another version's field) and every value must fit its field type.
export function validateAnswers(
  fields: QuestionnaireField[],
  answers: ReadonlyArray<{ fieldId: string; value: string }>,
): AnswerValidationError[] {
  const byId = new Map(fields.map((f) => [f.id, f]))
  const errors: AnswerValidationError[] = []
  for (const answer of answers) {
    const field = byId.get(answer.fieldId)
    if (!field) {
      errors.push({
        fieldId: answer.fieldId,
        message: 'Ce champ n’appartient pas au questionnaire de ce dossier.',
      })
      continue
    }
    const problem = validateAnswerValue(field, answer.value)
    if (problem) errors.push({ fieldId: field.id, label: field.label, message: problem })
  }
  return errors
}
