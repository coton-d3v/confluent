import type { QuestionnaireField, QuestionnaireSection } from '@prisma/client'
import { validateDraft } from './draft-validation'

const section = (id: string, title = id) => ({ id, title }) as QuestionnaireSection
const field = (id: string, sectionId: string, fieldType = 'text', choices: unknown[] = []) =>
  ({ id, sectionId, label: id, fieldType, choices }) as unknown as QuestionnaireField

describe('validateDraft', () => {
  it('accepts a draft whose sections all have fields and whose lists have choices', () => {
    const choices = [{ key: 'a', label: 'A' }]
    expect(validateDraft([section('s1')], [field('f1', 's1', 'select', choices)])).toEqual([])
  })

  it('refuses a draft without any field, with a single problem', () => {
    expect(validateDraft([section('s1')], [])).toEqual([
      expect.objectContaining({ code: 'EMPTY_FORM' }),
    ])
  })

  it('points at empty sections and at lists without choices', () => {
    const problems = validateDraft(
      [section('s1'), section('s2', 'Finances')],
      [field('f1', 's1', 'select')],
    )
    expect(problems).toEqual([
      expect.objectContaining({
        code: 'EMPTY_SECTION',
        sectionId: 's2',
        message: expect.stringContaining('Finances'),
      }),
      expect.objectContaining({ code: 'SELECT_WITHOUT_CHOICES', fieldId: 'f1', sectionId: 's1' }),
    ])
  })
})

describe('validateDraft — stored limits (code review R38, R19)', () => {
  const limited = (id: string, fieldType: string, constraints: object) =>
    ({
      id,
      sectionId: 's1',
      label: id,
      fieldType,
      choices: [],
      constraints,
    }) as unknown as QuestionnaireField

  it('blocks publication of limits saved before they were checked and that no answer satisfies', () => {
    const problems = validateDraft(
      [section('s1')],
      [
        limited('Effectif', 'number', { min: 0.1, max: 0.9, integer: true }),
        limited('Création', 'date', { min: '2026-99-99' }),
        limited('Montant', 'number', { min: 0, integer: true }),
      ],
    )
    expect(problems).toEqual([
      expect.objectContaining({
        code: 'INVALID_CONSTRAINTS',
        fieldId: 'Effectif',
        message: expect.stringContaining('Aucun nombre entier'),
      }),
      expect.objectContaining({ code: 'INVALID_CONSTRAINTS', fieldId: 'Création' }),
    ])
  })
})
