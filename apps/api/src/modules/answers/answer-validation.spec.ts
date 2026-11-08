import type { QuestionnaireField } from '@prisma/client'
import { validateAnswerValue, validateAnswers } from './answer-validation'

const field = (fieldType: string, options: string[] = []) =>
  ({ id: 'f', label: 'Champ', fieldType, options }) as unknown as QuestionnaireField

describe('validateAnswerValue', () => {
  it.each([
    ['email', 'a@b.fr', null],
    ['email', 'pas-un-email', 'Adresse email invalide.'],
    ['number', '1200', null],
    ['number', '3,5', null],
    ['number', 'douze', 'Nombre attendu (ex. 1200 ou 3,5).'],
    ['date', '2026-11-08', null],
    ['date', '08/11/2026', 'Date attendue au format AAAA-MM-JJ.'],
    ['checkbox', 'true', null],
    ['checkbox', 'oui', 'Valeur attendue : "true" ou "false".'],
    ['text', 'libre', null],
  ])('%s %p → %p', (type, value, expected) => {
    expect(validateAnswerValue(field(type), value)).toBe(expected)
  })

  it('accepts only listed options for a select, and any value when no option is defined', () => {
    expect(validateAnswerValue(field('select', ['A', 'B']), 'A')).toBeNull()
    expect(validateAnswerValue(field('select', ['A', 'B']), 'C')).toContain('"A", "B"')
    expect(validateAnswerValue(field('select'), 'C')).toBeNull()
  })

  it('always accepts an empty string (clearing an answer) and refuses file fields', () => {
    expect(validateAnswerValue(field('number'), '')).toBeNull()
    expect(validateAnswerValue(field('file'), 'x')).toContain('dépôt de documents')
  })

  it('caps the length', () => {
    expect(validateAnswerValue(field('text'), 'x'.repeat(10_001))).toContain('maximum')
  })
})

describe('validateAnswers', () => {
  it('rejects fields that do not belong to the dossier version', () => {
    const errors = validateAnswers(
      [field('text')],
      [
        { fieldId: 'f', value: 'ok' },
        { fieldId: 'other-version-field', value: 'x' },
      ],
    )
    expect(errors).toEqual([
      expect.objectContaining({
        fieldId: 'other-version-field',
        message: expect.stringContaining('n’appartient pas'),
      }),
    ])
  })
})
