import type { ActiveQuestionnaire, QuestionnaireField } from '@confluent/shared'
import type { QuestionMeta, Section } from '@/data/questionnaire'

export interface DynamicQuestionnaire {
  sections: Section[]
  flat: QuestionMeta[]
  totalQuestions: number
  fieldsById: Record<string, QuestionnaireField>
}

// Builds the wizard/reading model from a version's ordered sections and fields. Sections without
// any field (e.g. all hidden by a share's access level) are left out.
export function buildDynamicQuestionnaire(
  qz: Pick<ActiveQuestionnaire, 'sections' | 'fields'>,
): DynamicQuestionnaire {
  const sections: Section[] = [...qz.sections]
    .sort((a, b) => a.orderIndex - b.orderIndex)
    .map((section) => ({
      id: section.id,
      title: section.title,
      questions: qz.fields
        .filter((f) => f.sectionId === section.id)
        .sort((a, b) => a.orderIndex - b.orderIndex)
        .map((f) => ({
          id: f.id,
          label: f.label,
          hint: f.helpText ?? undefined,
          fieldType: f.fieldType,
          required: f.required,
          constraints: f.constraints,
          choices: f.fieldType === 'select' && f.choices.length > 0 ? f.choices : undefined,
        })),
    }))
    .filter((section) => section.questions.length > 0)
  const flat: QuestionMeta[] = []
  let global = 0
  sections.forEach((section, sIdx) => {
    section.questions.forEach((q, qIdx) => {
      global += 1
      flat.push({
        ...q,
        sectionId: section.id,
        sectionTitle: section.title,
        sectionIndex: sIdx + 1,
        positionInSection: qIdx + 1,
        globalIndex: global,
      })
    })
  })
  const fieldsById: Record<string, QuestionnaireField> = {}
  for (const f of qz.fields) fieldsById[f.id] = f
  return { sections, flat, totalQuestions: flat.length, fieldsById }
}
