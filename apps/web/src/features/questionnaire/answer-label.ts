import type { Question } from '@/data/questionnaire'

// What an answer reads as: « Oui »/« Non » for a checkbox, a French date, the label of the chosen
// choice for a list; the value itself otherwise (and for a value matching no choice, e.g. an
// answer given before choices had keys).
export function answerLabel(
  question: Pick<Question, 'choices' | 'fieldType'>,
  value: string,
): string {
  if (question.fieldType === 'checkbox') {
    return value === 'true' ? 'Oui' : value === 'false' ? 'Non' : value
  }
  if (question.fieldType === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value.split('-').reverse().join('/')
  }
  return question.choices?.find((c) => c.key === value)?.label ?? value
}
