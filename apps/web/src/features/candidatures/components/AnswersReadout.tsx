import type { QuestionnaireField, QuestionnaireSection, ReceivedAnswer } from '@confluent/shared'
import { DossierField } from '@/components/confluent/DossierField'
import { answerLabel } from '@/features/questionnaire/answer-label'

// The answers of a form, section by section, read-only (E05.09).
export function AnswersReadout({
  sections,
  fields,
  answers,
}: {
  sections: QuestionnaireSection[]
  fields: QuestionnaireField[]
  answers: ReceivedAnswer[]
}) {
  const byField = new Map(answers.map((a) => [a.fieldId, a.value]))
  return (
    <div className="flex flex-col gap-6">
      {sections.map((section) => (
        <section key={section.id} className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground">{section.title}</h3>
          <dl className="mt-3 grid gap-4 sm:grid-cols-2">
            {fields
              .filter((f) => f.sectionId === section.id)
              .map((field) => {
                const value = byField.get(field.id) ?? ''
                return (
                  <DossierField
                    key={field.id}
                    label={field.label}
                    value={value ? answerLabel(field, value) : ''}
                  />
                )
              })}
          </dl>
        </section>
      ))}
    </div>
  )
}
