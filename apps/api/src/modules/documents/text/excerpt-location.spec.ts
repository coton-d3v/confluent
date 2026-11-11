import { locateExcerpt } from './excerpt-location'

describe('locateExcerpt', () => {
  const pages = [
    { label: 'Page 1', text: 'EXTRAIT KBIS\nDénomination : BIOSENSIO SAS' },
    { label: 'Page 2', text: 'Capital social : 10 000 EUR\nSiège : 12 rue de l’Étang, Tours' },
  ]

  it('finds a copied passage and gives its page, ignoring spacing, case, quotes and ligatures', () => {
    expect(locateExcerpt(pages, 'capital  social : 10 000 eur')).toEqual({
      found: true,
      location: 'Page 2',
    })
    expect(locateExcerpt(pages, "12 rue de l'Étang")).toEqual({ found: true, location: 'Page 2' })
    expect(locateExcerpt([{ label: 'Page 1', text: 'Proﬁt net' }], 'Profit net')).toEqual({
      found: true,
      location: 'Page 1',
    })
  })

  it('gives both pages for a passage running over a page break', () => {
    expect(locateExcerpt(pages, 'BIOSENSIO SAS Capital social')).toEqual({
      found: true,
      location: 'Page 1 à Page 2',
    })
  })

  it('has no location for a text without pages, sheets or slides', () => {
    expect(locateExcerpt([{ label: null, text: '2025;120 000' }], '120 000')).toEqual({
      found: true,
      location: null,
    })
  })

  it('does not find what the document does not say', () => {
    expect(locateExcerpt(pages, 'Capital social : 50 000 EUR')).toEqual({ found: false })
    expect(locateExcerpt(pages, '   ')).toEqual({ found: false })
    expect(locateExcerpt([], 'BIOSENSIO')).toEqual({ found: false })
  })
})
