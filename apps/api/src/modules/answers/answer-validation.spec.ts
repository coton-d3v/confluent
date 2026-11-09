import type { QuestionnaireField } from '@prisma/client'
import { normalizeAnswers, validateAnswerValue, validateAnswers } from './answer-validation'

type Choice = { key: string; label: string }
const field = (fieldType: string, choices: Choice[] = [], id = 'f', constraints: object = {}) =>
  ({ id, label: 'Champ', fieldType, choices, constraints }) as unknown as QuestionnaireField
const limited = (fieldType: string, constraints: object) => field(fieldType, [], 'f', constraints)

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

  it.each([
    ['text', { maxLength: 5 }, 'court', null],
    ['text', { maxLength: 5 }, 'trop long', '5 caractères maximum.'],
    ['textarea', { minLength: 10 }, 'bref', '10 caractères minimum.'],
    ['number', { min: 0, max: 100 }, '42,5', null],
    ['number', { min: 0 }, '-1', 'Valeur minimale : 0.'],
    ['number', { max: 1000 }, '1500', 'Valeur maximale : 1\u202f000.'],
    ['number', { integer: true }, '3,5', 'Nombre entier attendu.'],
    ['date', { min: '2026-01-01' }, '2025-12-31', 'Date au plus tôt : 01/01/2026.'],
    ['date', { max: '2026-12-31' }, '2026-06-15', null],
  ])('applies %s limits %j to %p', (type, constraints, value, expected) => {
    expect(validateAnswerValue(limited(type, constraints), value)).toBe(expected)
  })

  // Code review R19: the format alone is not enough, the day must exist in the calendar.
  it.each([
    ['2026-02-31', false],
    ['2026-02-29', false],
    ['2026-13-01', false],
    ['2026-04-31', false],
    ['2024-02-29', true],
    ['2026-11-08', true],
  ])('date %s is accepted: %p', (value, valid) => {
    const result = validateAnswerValue(field('date'), value)
    if (valid) expect(result).toBeNull()
    else expect(result).toBe('Date attendue au format AAAA-MM-JJ.')
  })

  // Code review R39: no comparison on an infinite or silently rounded value.
  it.each([
    ['9'.repeat(400), { min: 0 }, 'Nombre trop long : 15 chiffres significatifs au plus.'],
    ['12345678901234567', {}, 'Nombre trop long : 15 chiffres significatifs au plus.'],
    ['-123456789012345', { min: -1e15 }, null],
    ['0,000000000000001', { min: 0 }, null],
    ['1500000,50000', { max: 2_000_000 }, null],
    ['3,5', { max: 3 }, 'Valeur maximale : 3.'],
  ])('number %p with limits %j → %p', (value, constraints, expected) => {
    expect(validateAnswerValue(limited('number', constraints), value)).toBe(expected)
  })

  it('ignores stored limits that do not fit the field type', () => {
    expect(validateAnswerValue(limited('email', { maxLength: 3 }), 'a@b.fr')).toBeNull()
    expect(validateAnswerValue(limited('number', { min: 'x' }), '5')).toBeNull()
  })

  it('always accepts an empty string (clearing an answer) and refuses file fields', () => {
    expect(validateAnswerValue(field('number'), '')).toBeNull()
    expect(validateAnswerValue(field('file'), 'x')).toContain('déposez le fichier')
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
