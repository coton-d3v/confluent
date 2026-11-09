import type { Dossier } from '@prisma/client'
import { DEFAULT_CLASSIFICATION_RULES } from '../../testing/classification-rules.fixture'
import { classificationSources } from '../classification/classification-sources'
import { projectDossierForLevel, type DerivedDataContext } from './financeur-access'

// Code review R31: classification columns stored on the dossier must not reveal a field that the
// share level hides.
const dossier = {
  id: 'd-1',
  sector: 'biotech',
  maturityStage: 'MVP',
  ancrageCvl: 'ancré',
  tagTechnologique: 'deeptech',
  axe1Projet: 3,
  axe2Financier: 4,
  axe3Origine: 3,
  deeptechScore: 3,
  preCreation: false,
} as unknown as Dossier

const COLUMNS = Object.keys(dossier).filter((k) => k !== 'id') as Array<keyof Dossier>
// Which columns read which dimensions (mirrors financeur-access).
const DIMENSIONS_OF: Record<string, string[]> = {
  sector: ['sector'],
  maturityStage: ['maturity_stage'],
  ancrageCvl: ['ancrage_cvl'],
  tagTechnologique: ['non_tech', 'deeptech_signal'],
  deeptechScore: ['non_tech', 'deeptech_signal'],
  axe1Projet: ['axe1_projet'],
  axe2Financier: ['axe2_financier'],
  axe3Origine: ['axe3_origine'],
  preCreation: ['pre_creation'],
}
const SOURCE_KEYS = [...new Set(DEFAULT_CLASSIFICATION_RULES.map((r) => r.fieldKey))]

// The levels of the version's fields; the dossier carries the sources recorded when it was
// classified, here with the default rules and a version holding every source field (unless given).
const context = (levels: Record<string, string>): DerivedDataContext => ({
  fieldLevels: new Map(Object.entries(levels)),
})
const recorded = (keys: Iterable<string> = SOURCE_KEYS) => ({
  ...dossier,
  classificationSources: classificationSources(DEFAULT_CLASSIFICATION_RULES, new Set(keys)),
})
const allAt = (level: string) => Object.fromEntries(SOURCE_KEYS.map((k) => [k, level]))

describe('derived data of a dossier by share level (R31)', () => {
  it.each(SOURCE_KEYS)('a restricted « %s » field hides every column derived from it', (key) => {
    const projected = projectDossierForLevel(
      recorded(),
      'partiel',
      context({ ...allAt('public'), [key]: 'complet' }),
    )
    for (const column of COLUMNS) {
      const derivesFromKey = DEFAULT_CLASSIFICATION_RULES.some(
        (r) => r.fieldKey === key && DIMENSIONS_OF[column].includes(r.dimension),
      )
      if (derivesFromKey)
        expect({ column, value: projected[column] }).toEqual({ column, value: null })
    }
  })

  it('keeps the fixed floors on top of the sources (financial axis only for a full share)', () => {
    const projected = projectDossierForLevel(recorded(), 'partiel', context(allAt('public')))
    expect(projected).toMatchObject({ sector: 'biotech', axe1Projet: 3, axe2Financier: null })
  })

  it('hides a column whose sources are absent from the dossier version (closed by default)', () => {
    const projected = projectDossierForLevel(
      recorded(['secteur_activite']),
      'public',
      context({ secteur_activite: 'public' }),
    )
    expect(projected).toMatchObject({ sector: 'biotech', ancrageCvl: null, tagTechnologique: null })
  })

  it('shows every value to a full share, never the provenance itself', () => {
    const full = recorded()
    expect(projectDossierForLevel(full, 'complet', context(allAt('complet')))).toEqual({
      ...full,
      classificationSources: null,
    })
  })

  // Recontrôle R31: the value was computed from a confidential field; the rules are later changed
  // to read a public one, without reclassifying. The stored value must stay hidden.
  it('judges a stored value on the fields it was computed from, not on the current rules', () => {
    const classified = {
      ...dossier,
      classificationSources: { sector: ['secteur_prive'] },
    } as unknown as Dossier
    const levels = context({ secteur_prive: 'complet', secteur_public: 'public' })
    expect(projectDossierForLevel(classified, 'public', levels).sector).toBeNull()
    expect(projectDossierForLevel(classified, 'complet', levels).sector).toBe('biotech')
  })

  it('hides every derived column when no provenance was recorded, or an unreadable one', () => {
    for (const classificationSources of [null, 'x', { sector: 'secteur' }]) {
      const projected = projectDossierForLevel(
        { ...dossier, classificationSources } as unknown as Dossier,
        'complet',
        context(allAt('public')),
      )
      for (const column of COLUMNS) expect(projected[column]).toBeNull()
    }
  })
})
