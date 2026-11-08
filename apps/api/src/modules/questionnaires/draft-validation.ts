import type { QuestionnaireField, QuestionnaireSection } from '@prisma/client'
import type { DraftProblem } from '@confluent/shared'
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
  }
  return problems
}
