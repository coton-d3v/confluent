import type { QuestionnaireField, QuestionnaireSection } from '@prisma/client'
import {
  constraintsProblem,
  fieldConstraintsSchema,
  type DraftProblem,
  type FieldType,
} from '@confluent/shared'
import { readChoices } from './questionnaire-structure'

// What prevents a draft from being published (E03.03, E03.13). Empty list = publishable.
export function validateDraft(
  sections: readonly QuestionnaireSection[],
  fields: readonly QuestionnaireField[],
): DraftProblem[] {
  if (fields.length === 0) {
    return [{ code: 'EMPTY_FORM', message: 'Le formulaire ne contient aucun champ.' }]
  }
  const problems: DraftProblem[] = []
  for (const section of sections) {
    if (!fields.some((f) => f.sectionId === section.id)) {
      problems.push({
        code: 'EMPTY_SECTION',
        message: `La section « ${section.title} » ne contient aucun champ.`,
        sectionId: section.id,
      })
    }
  }
  for (const field of fields) {
    if (field.fieldType === 'select' && readChoices(field.choices).length === 0) {
      problems.push({
        code: 'SELECT_WITHOUT_CHOICES',
        message: `Le champ « ${field.label} » est une liste sans aucun choix.`,
        sectionId: field.sectionId,
        fieldId: field.id,
      })
    }
    const constraintsIssue = storedConstraintsProblem(field)
    if (constraintsIssue) {
      problems.push({
        code: 'INVALID_CONSTRAINTS',
        message: `Les limites du champ « ${field.label} » sont impossibles : ${constraintsIssue}`,
        sectionId: field.sectionId,
        fieldId: field.id,
      })
    }
  }
  return problems
}

// Limits saved before a rule was tightened (code review R38, R19) are checked again before
// publication: a published field must accept at least one answer.
function storedConstraintsProblem(field: QuestionnaireField): string | null {
  const raw = field.constraints
  if (raw === null || raw === undefined) return null
  const parsed = fieldConstraintsSchema.safeParse(raw)
  if (!parsed.success) return parsed.error.issues[0]?.message ?? 'limites illisibles.'
  return constraintsProblem(field.fieldType as FieldType, parsed.data)
}
