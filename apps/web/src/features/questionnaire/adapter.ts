import type { ActiveQuestionnaire, QuestionnaireField } from '@confluent/shared'
import type { QuestionMeta, Section } from '@/data/questionnaire'

export interface DynamicQuestionnaire {
  sections: Section[]
  flat: QuestionMeta[]
  totalQuestions: number
  fieldsById: Record<string, QuestionnaireField>
}

export function buildDynamicQuestionnaire(qz: Pick<ActiveQuestionnaire, 'fields'>): DynamicQuestionnaire {
  const sectionOrder: string[] = []
  const grouped = new Map<string, QuestionnaireField[]>()
  for (const f of qz.fields) {
    if (!grouped.has(f.section)) {
      grouped.set(f.section, [])
      sectionOrder.push(f.section)
    }
    grouped.get(f.section)!.push(f)
  }
  for (const arr of grouped.values()) {
    arr.sort((a, b) => a.orderIndex - b.orderIndex)
  }
  const sections: Section[] = sectionOrder.map((title) => ({
    id: title,
    title,
    questions: grouped.get(title)!.map((f) => ({
      id: f.id,
      label: f.label,
      options: f.options && f.options.length > 0 ? f.options : undefined,
    })),
  }))
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
