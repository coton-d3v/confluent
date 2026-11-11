import { Logger } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { ClassificationService } from './classification.service'
import { PrismaService } from '../../prisma/prisma.service'
import { DEFAULT_CLASSIFICATION_RULES } from '../../testing/classification-rules.fixture'

// `profile`: the company profile the dossier presents (E05.05), null when the dossier is unknown.
function buildPrisma(profile: unknown) {
  const update = jest
    .fn()
    .mockImplementation(async (args: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: 'd-1', ...args.data }),
    )
  return {
    prisma: {
      dossier: {
        findUnique: jest.fn().mockResolvedValue(profile && { id: 'd-1', companyId: 'c-1' }),
        update,
      },
      company: { findUnique: jest.fn().mockResolvedValue(profile) },
      // The rules seeded by the migration: the expectations below are those of the former
      // hard-coded rules, so the migration changes no classification.
      classificationRule: { findMany: jest.fn().mockResolvedValue(DEFAULT_CLASSIFICATION_RULES) },
    },
    update,
  }
}

async function instantiate(prisma: unknown) {
  const moduleRef = await Test.createTestingModule({
    providers: [ClassificationService, { provide: PrismaService, useValue: prisma }],
  }).compile()
  return moduleRef.get(ClassificationService)
}

type Field = {
  id: string
  key: string | null
  label: string
  choices?: { key: string; label: string }[]
}

function dossierWith(fields: Field[], answers: Record<string, string>) {
  return {
    id: 'c-1',
    profileVersion: { fields },
    answers: Object.entries(answers).map(([fieldId, value]) => ({ fieldId, value })),
  }
}

const EMPTY = {
  sector: null,
  maturityStage: null,
  ancrageCvl: null,
  tagTechnologique: null,
  axe1Projet: null,
  axe2Financier: null,
  axe3Origine: null,
  deeptechScore: null,
  preCreation: null,
}

const V2_FIELDS: Field[] = [
  { id: 'f-ancrage', key: 'ancrage_cvl', label: 'Votre lien avec la région Centre Val de Loire' },
  {
    id: 'f-secteur',
    key: 'secteur',
    label: 'Secteur principal',
    choices: [
      { key: 'biotech', label: 'biotech' },
      { key: 'saas', label: 'SaaS' },
    ],
  },
  {
    id: 'f-structure',
    key: 'structure_juridique',
    label: 'Avez-vous une structure juridique créée ?',
  },
  { id: 'f-financement', key: 'stade_financement', label: 'Stade de financement actuel' },
  { id: 'f-origine', key: 'origine_projet', label: 'Origine du projet' },
  { id: 'f-techno', key: 'techno_difficile', label: 'Technologie difficile à reproduire ?' },
  { id: 'f-brevets', key: 'brevets', label: 'Avez-vous des brevets ?' },
  { id: 'f-verrou', key: 'verrou_scientifique', label: 'Verrou scientifique ?' },
  { id: 'f-rd', key: 'rd_public', label: 'Financement R&D public ?' },
  {
    id: 'f-stade',
    key: 'stade_projet',
    label: 'Stade du projet',
    choices: [{ key: 'trl_4_6_developpement', label: 'TRL 4-6 Développement' }],
  },
  { id: 'f-other', key: null, label: 'Nom du projet' },
]

describe('ClassificationService.classify', () => {
  it('classifies a full V2 deeptech dossier and persists the result', async () => {
    const { prisma, update } = buildPrisma(
      dossierWith(V2_FIELDS, {
        'f-ancrage': 'mon_projet_est_base_en_cvl',
        'f-secteur': 'biotech',
        'f-structure': 'en_cours_de_creation',
        'f-financement': 'seed_investisseurs_professionnels',
        'f-origine': 'spin_off_d_un_laboratoire_recherche_publique',
        'f-techno': 'oui_clairement',
        'f-brevets': 'oui_deposes',
        'f-verrou': 'non',
        'f-rd': 'en_cours',
        'f-stade': 'trl_4_6_developpement',
        'f-other': 'Acme',
      }),
    )
    const svc = await instantiate(prisma)
    const expected = {
      sector: 'biotech',
      maturityStage: 'TRL 4-6 Développement',
      ancrageCvl: 'ancré',
      tagTechnologique: 'deeptech',
      axe1Projet: 3,
      axe2Financier: 4,
      axe3Origine: 3,
      deeptechScore: 3,
      preCreation: true,
    }
    expect(await svc.classify('d-1')).toEqual(expected)
    // Stored with the field keys each column was computed from (code review R31).
    expect(update).toHaveBeenCalledWith({
      where: { id: 'd-1' },
      data: {
        ...expected,
        classificationSources: expect.objectContaining({
          sector: expect.arrayContaining([expect.any(String)]),
          axe2Financier: ['stade_financement'],
        }),
      },
    })
  })

  it('keeps classifying when field and choice labels are renamed (lookup by key, not label)', async () => {
    const renamed = V2_FIELDS.map((f) => ({
      ...f,
      label: `${f.label} (renommé)`,
      choices: f.choices?.map((c) => ({
        ...c,
        label: c.key === 'saas' ? 'SaaS' : `${c.label} (renommé)`,
      })),
    }))
    const { prisma } = buildPrisma(
      dossierWith(renamed, {
        'f-secteur': 'saas',
        'f-financement': 'fonds_propres_uniquement',
        'f-techno': 'non_c_est_avant_tout_un_modele_ou_un_service',
      }),
    )
    const svc = await instantiate(prisma)
    expect(await svc.classify('d-1')).toMatchObject({
      sector: 'SaaS',
      axe2Financier: 2,
      tagTechnologique: 'non_tech',
      deeptechScore: 0,
    })
  })

  it('ignores fields without key, even when their label matches a former classification label', async () => {
    const { prisma } = buildPrisma(
      dossierWith([{ id: 'f-secteur', key: null, label: 'Secteur principal' }], {
        'f-secteur': 'biotech',
      }),
    )
    const svc = await instantiate(prisma)
    expect(await svc.classify('d-1')).toEqual(EMPTY)
  })

  it('falls back on V1 keys for sector and maturity', async () => {
    const { prisma } = buildPrisma(
      dossierWith(
        [
          { id: 'f-sector', key: 'secteur_activite', label: "Secteur d'activité" },
          { id: 'f-maturity', key: 'stade_maturite', label: 'Stade de maturité' },
        ],
        { 'f-sector': 'Biotech', 'f-maturity': 'Seed' },
      ),
    )
    const svc = await instantiate(prisma)
    expect(await svc.classify('d-1')).toEqual({
      ...EMPTY,
      sector: 'Biotech',
      maturityStage: 'Seed',
    })
  })

  it('ignores a former option label: only choice keys are classified', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const { prisma } = buildPrisma(
      dossierWith(V2_FIELDS, { 'f-financement': 'Fonds propres uniquement' }),
    )
    const svc = await instantiate(prisma)
    expect(await svc.classify('d-1')).toMatchObject({ axe2Financier: null })
    warn.mockRestore()
  })

  it('treats an empty answer as missing', async () => {
    const { prisma } = buildPrisma(dossierWith(V2_FIELDS, { 'f-structure': '', 'f-techno': '' }))
    const svc = await instantiate(prisma)
    expect(await svc.classify('d-1')).toEqual(EMPTY)
  })

  it('logs a warning when an answer matches no known choice', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const { prisma } = buildPrisma(
      dossierWith(V2_FIELDS, { 'f-financement': 'choix_ajoute_par_un_admin' }),
    )
    const svc = await instantiate(prisma)
    expect(await svc.classify('d-1')).toMatchObject({ axe2Financier: null })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('stade_financement'))
    warn.mockRestore()
  })

  it('writes nulls when answers are missing', async () => {
    const { prisma, update } = buildPrisma(dossierWith(V2_FIELDS, {}))
    const svc = await instantiate(prisma)
    expect(await svc.classify('d-1')).toEqual(EMPTY)
    expect(update).toHaveBeenCalledWith({
      where: { id: 'd-1' },
      data: { ...EMPTY, classificationSources: expect.any(Object) },
    })
  })

  it('returns nulls if the dossier does not exist (and does not update)', async () => {
    const { prisma, update } = buildPrisma(null)
    const svc = await instantiate(prisma)
    expect(await svc.classify('nope')).toEqual(EMPTY)
    expect(update).not.toHaveBeenCalled()
  })
})
