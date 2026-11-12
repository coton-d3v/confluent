import type { Question } from '@/data/questionnaire'

const NUMBER_FORMAT = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 6 })
// A plain decimal number that a JavaScript number holds exactly enough to be shown (15 digits).
const PLAIN_NUMBER = /^-?\d{1,15}([.,]\d{1,6})?$/

// What an answer reads as: « Oui »/« Non » for a checkbox, a French date, a number with French
// digit grouping (E10.07: 1 250 000), the label of the chosen choice for a list; the value itself
// otherwise (and for a value matching no choice, e.g. an answer given before choices had keys).
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
  if (question.fieldType === 'number' && PLAIN_NUMBER.test(value.trim())) {
    return NUMBER_FORMAT.format(Number(value.trim().replace(',', '.')))
  }
  return question.choices?.find((c) => c.key === value)?.label ?? value
}
