import { Logger } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { ClassificationService } from './classification.service'
import { PrismaService } from '../../prisma/prisma.service'

function buildPrisma(dossier: unknown) {
  const update = jest
    .fn()
    .mockImplementation(async (args: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: 'd-1', ...args.data }),
    )
  return {
    prisma: {
      dossier: {
        findUnique: jest.fn().mockResolvedValue(dossier),
        update,
      },
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

type Field = { id: string; key: string | null; label: string }

function dossierWith(fields: Field[], answers: Record<string, string>) {
  return {
    id: 'd-1',
    questionnaireVersion: { fields },
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
  { id: 'f-secteur', key: 'secteur', label: 'Secteur principal' },
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
  { id: 'f-stade', key: 'stade_projet', label: 'Stade du projet' },
  { id: 'f-other', key: null, label: 'Nom du projet' },
]

describe('ClassificationService.classify', () => {
  it('classifies a full V2 deeptech dossier and persists the result', async () => {
    const { prisma, update } = buildPrisma(
      dossierWith(V2_FIELDS, {
        'f-ancrage': 'Mon projet est basé en CVL',
        'f-secteur': 'biotech',
        'f-structure': 'En cours de création',
        'f-financement': 'Seed – investisseurs professionnels',
        'f-origine': "Spin-off d'un laboratoire / recherche publique",
        'f-techno': 'Oui, clairement',
        'f-brevets': 'Oui déposés',
        'f-verrou': 'Non',
        'f-rd': 'En cours',
        'f-stade': 'TRL 4-6 Développement',
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
    expect(update).toHaveBeenCalledWith({ where: { id: 'd-1' }, data: expected })
  })

  it('keeps classifying when labels are renamed (lookup by key, not label)', async () => {
    const renamed = V2_FIELDS.map((f) => ({ ...f, label: `${f.label} (renommé)` }))
    const { prisma } = buildPrisma(
      dossierWith(renamed, {
        'f-secteur': 'SaaS',
        'f-financement': 'Fonds propres uniquement',
        'f-techno': "Non – c'est avant tout un modèle ou un service",
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

  it('logs a warning when an answer matches no known option', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const { prisma } = buildPrisma(
      dossierWith(V2_FIELDS, { 'f-financement': 'Option renommée par un admin' }),
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
    expect(update).toHaveBeenCalledWith({ where: { id: 'd-1' }, data: EMPTY })
  })

  it('returns nulls if the dossier does not exist (and does not update)', async () => {
    const { prisma, update } = buildPrisma(null)
    const svc = await instantiate(prisma)
    expect(await svc.classify('nope')).toEqual(EMPTY)
    expect(update).not.toHaveBeenCalled()
  })
})
