import type { QuestionnaireField } from '@prisma/client'

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
    case 'select':
      return field.options.length === 0 || field.options.includes(value)
        ? null
        : `Choix attendu parmi : ${field.options.map((o) => `"${o}"`).join(', ')}.`
    case 'file':
      return 'Ce champ attend un document : utilisez le dépôt de documents.'
    default:
      return null
  }
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
