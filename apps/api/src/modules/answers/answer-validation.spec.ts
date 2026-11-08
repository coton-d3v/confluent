import type { QuestionnaireField } from '@prisma/client'
import { normalizeAnswers, validateAnswerValue, validateAnswers } from './answer-validation'

type Choice = { key: string; label: string }
const field = (fieldType: string, choices: Choice[] = [], id = 'f') =>
  ({ id, label: 'Champ', fieldType, choices }) as unknown as QuestionnaireField

const AB: Choice[] = [
  { key: 'a', label: 'Choix A' },
  { key: 'b', label: 'Choix B' },
]

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

  it('accepts only a choice key for a select, and any value when no choice is defined', () => {
    expect(validateAnswerValue(field('select', AB), 'a')).toBeNull()
    expect(validateAnswerValue(field('select', AB), 'Choix A')).toContain(
      '"a" (Choix A), "b" (Choix B)',
    )
    expect(validateAnswerValue(field('select', AB), 'c')).not.toBeNull()
    expect(validateAnswerValue(field('select'), 'c')).toBeNull()
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

describe('normalizeAnswers', () => {
  it('stores the key of a choice given by its exact label, and leaves other values untouched', () => {
    const fields = [field('select', AB, 'sel'), field('text', [], 'txt')]
    expect(
      normalizeAnswers(fields, [
        { fieldId: 'sel', value: 'Choix B' },
        { fieldId: 'txt', value: 'Choix B' },
        { fieldId: 'unknown', value: 'Choix B' },
      ]),
    ).toEqual([
      { fieldId: 'sel', value: 'b' },
      { fieldId: 'txt', value: 'Choix B' },
      { fieldId: 'unknown', value: 'Choix B' },
    ])
  })

  it('never reinterprets a value that already is a key, even if it equals another choice label', () => {
    const tricky = field('select', [
      { key: 'oui', label: 'non' },
      { key: 'non', label: 'oui' },
    ])
    expect(normalizeAnswers([tricky], [{ fieldId: 'f', value: 'oui' }])).toEqual([
      { fieldId: 'f', value: 'oui' },
    ])
  })
})
