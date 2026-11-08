import { readChoices, toChoices, toKey } from './questionnaire-structure'

describe('questionnaire structure helpers', () => {
  it('derives keys from labels: lowercase, no accents, snake_case, starting with a letter', () => {
    expect(toKey("Love money – subventions – prêts d'honneur")).toBe(
      'love_money_subventions_prets_d_honneur',
    )
    expect(toKey('2 à 5 ans')).toBe('f_2_a_5_ans')
    expect(toKey('—')).toBe('champ')
  })

  it('keeps explicit choice keys and derives the missing ones, unique within the field', () => {
    expect(
      toChoices([
        // Renamed label, key kept from the previous version: answers and classification unchanged.
        { key: 'fonds_propres_uniquement', label: 'Autofinancement' },
        { label: 'Seed' },
        { label: 'seed' },
        { label: 'Fonds propres uniquement' },
      ]),
    ).toEqual([
      { key: 'fonds_propres_uniquement', label: 'Autofinancement' },
      { key: 'seed', label: 'Seed' },
      { key: 'seed_2', label: 'seed' },
      { key: 'fonds_propres_uniquement_2', label: 'Fonds propres uniquement' },
    ])
  })

  it('reads stored choices defensively', () => {
    expect(readChoices([{ key: 'a', label: 'A' }, { key: 1 }, null, 'x'])).toEqual([
      { key: 'a', label: 'A' },
    ])
    expect(readChoices({})).toEqual([])
  })
})
