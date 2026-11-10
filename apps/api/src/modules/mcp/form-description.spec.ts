import type { QuestionnaireField, QuestionnaireSection } from '@prisma/client'
import {
  describeCompletion,
  describeField,
  isFieldAnswered,
  pendingQuestions,
} from './form-description'

const field = (data: Partial<QuestionnaireField> & Pick<QuestionnaireField, 'id' | 'fieldType'>) =>
  ({
    versionId: 'v-1',
    sectionId: 's-1',
    key: data.id,
    label: data.id,
    helpText: null,
    choices: [],
    required: false,
    orderIndex: 0,
    constraints: {},
    minAccessLevel: 'complet',
    ...data,
  }) as QuestionnaireField

const section = (id: string, title: string) =>
  ({ id, versionId: 'v-1', key: id, title, orderIndex: 0 }) as QuestionnaireSection

describe('describeField', () => {
  it.each([
    ['text', 'Texte sur une ligne.'],
    ['number', 'Nombre'],
    ['date', 'AAAA-MM-JJ'],
    ['checkbox', '"true"'],
    ['select', 'Clé d’un des choix'],
    ['file', 'Document déposé'],
  ] as const)('gives the expected format of a %s field', (fieldType, expected) => {
    expect(
      describeField(field({ id: 'f', fieldType }), { withReadLevel: false }).valueFormat,
    ).toContain(expected)
  })

  it('gives limits in words and as values; text answers are always bounded', () => {
    const text = describeField(
      field({ id: 'f', fieldType: 'text', constraints: { maxLength: 80 } }),
      {
        withReadLevel: false,
      },
    )
    expect(text).toMatchObject({ limits: '80 caractères maximum.', constraints: { maxLength: 80 } })
    const longText = describeField(field({ id: 'f', fieldType: 'textarea' }), {
      withReadLevel: false,
    })
    expect(longText.constraints).toEqual({ maxLength: 10_000 })
    const number = describeField(field({ id: 'f', fieldType: 'number', constraints: { min: 0 } }), {
      withReadLevel: false,
    })
    expect(number.constraints).toEqual({ min: 0 })
    expect(
      describeField(field({ id: 'f', fieldType: 'file' }), { withReadLevel: false }),
    ).not.toHaveProperty('constraints')
  })

  it('says who may read the answer only when asked, the most restrictive level for an unknown one', () => {
    const odd = field({ id: 'f', fieldType: 'text', minAccessLevel: 'inconnu' })
    expect(describeField(odd, { withReadLevel: false })).not.toHaveProperty('readLevel')
    expect(describeField(odd, { withReadLevel: true })).toMatchObject({
      readLevel: 'complet',
      readableBy: 'les partages complets uniquement',
    })
  })
})

describe('describeCompletion', () => {
  const sections = [section('s-1', 'Projet'), section('s-2', 'Pièces')]
  const fields = [
    field({ id: 'nom', fieldType: 'text', required: true }),
    field({ id: 'site', fieldType: 'text' }),
    field({ id: 'kbis', fieldType: 'file', required: true, sectionId: 's-2' }),
  ]

  it('counts required and optional answers, an attachment by its document', () => {
    const answers = new Map([
      ['nom', 'Biosensio'],
      ['site', '   '],
    ])
    const done = describeCompletion(sections, fields, answers, new Set(), null)
    expect(done).toMatchObject({
      state: 'incomplet',
      requiredTotal: 2,
      requiredAnswered: 1,
      fieldsTotal: 3,
      fieldsAnswered: 1,
      sections: [
        { title: 'Projet', requiredTotal: 1, requiredAnswered: 1 },
        { title: 'Pièces', requiredTotal: 1, requiredAnswered: 0 },
      ],
    })
    expect(describeCompletion(sections, fields, answers, new Set(['kbis']), null).state).toBe(
      'pret_a_soumettre',
    )
  })

  it('reports a submitted dossier as such', () => {
    const at = new Date('2026-11-09')
    expect(describeCompletion(sections, fields, new Map(), new Set(), at)).toMatchObject({
      state: 'soumis',
      submittedAt: at,
    })
  })

  it('never counts a written value as an attachment', () => {
    expect(isFieldAnswered(fields[2], new Map([['kbis', 'kbis.pdf']]), new Set())).toBe(false)
  })
})

describe('pendingQuestions', () => {
  // Sections are listed out of order on purpose: the form's order is the sections' order.
  const sections = [section('s-1', 'Projet'), section('s-2', 'Pièces')]
  const fields = [
    field({ id: 'kbis', fieldType: 'file', required: true, sectionId: 's-2' }),
    field({ id: 'nom', fieldType: 'text', required: true }),
    field({ id: 'site', fieldType: 'text' }),
    field({ id: 'effectif', fieldType: 'number', sectionId: 's-2' }),
  ]
  const ids = (r: ReturnType<typeof pendingQuestions>) => r?.questions.map((q) => q.field.id)

  it('lists the unanswered questions section by section, an attachment by its document', () => {
    const answers = new Map([
      ['nom', 'Biosensio'],
      ['effectif', ' '],
    ])
    expect(ids(pendingQuestions(sections, fields, answers, new Set()))).toEqual([
      'site',
      'kbis',
      'effectif',
    ])
    expect(ids(pendingQuestions(sections, fields, answers, new Set(['kbis'])))).toEqual([
      'site',
      'effectif',
    ])
  })

  it('continues after a skipped question and counts the unanswered ones left behind', () => {
    const result = pendingQuestions(sections, fields, new Map(), new Set(), 'site')
    expect(ids(result)).toEqual(['kbis', 'effectif'])
    expect(result?.unansweredBefore).toBe(2)
    expect(pendingQuestions(sections, fields, new Map(), new Set(), 'inconnu')).toBeNull()
  })
})
