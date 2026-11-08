import type { Question } from '@/data/questionnaire'

// What an answer reads as: the label of the chosen choice for a list field, the value itself
// otherwise (and for a value matching no choice, e.g. an answer given before choices had keys).
export function answerLabel(question: Pick<Question, 'choices'>, value: string): string {
  return question.choices?.find((c) => c.key === value)?.label ?? value
}
