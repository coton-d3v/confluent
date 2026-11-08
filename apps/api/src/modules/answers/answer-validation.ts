import type { QuestionnaireField } from '@prisma/client'
import { isAnswered, validateAnswerValue as validateSharedRules } from '@confluent/shared'
import { readChoices } from '../questionnaires/questionnaire-structure'

export interface AnswerValidationError {
  fieldId: string
  label?: string
  message: string
}

// Rules shared with the site (`@confluent/shared`), applied to a stored field definition.
export function validateAnswerValue(field: QuestionnaireField, value: string): string | null {
  return validateSharedRules(
    {
      fieldType: field.fieldType,
      choices: readChoices(field.choices),
      constraints: field.constraints,
    },
    value,
  )
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

// Once a dossier is submitted, its answers can still be corrected, but a required answer cannot be
// cleared: the submitted dossier stays complete (E03.10).
export function submittedDossierErrors(
  fields: QuestionnaireField[],
  answers: ReadonlyArray<{ fieldId: string; value: string }>,
): AnswerValidationError[] {
  const byId = new Map(fields.map((f) => [f.id, f]))
  return answers.flatMap((answer) => {
    const field = byId.get(answer.fieldId)
    if (!field || !field.required || field.fieldType === 'file' || isAnswered(answer.value))
      return []
    return [
      {
        fieldId: field.id,
        label: field.label,
        message:
          'Réponse obligatoire : le dossier est soumis, elle peut être corrigée mais pas effacée.',
      },
    ]
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
