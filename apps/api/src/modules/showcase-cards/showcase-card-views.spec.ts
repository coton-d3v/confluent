import {
  Prisma,
  type Committee,
  type Dossier,
  type FundingPlanLine,
  type ShowcaseCard,
} from '@prisma/client'
import { PUBLIC_CARD_FIELDS, publicCardSchema } from '@confluent/shared'
import {
  CARD_COLUMN_AUDIENCES,
  DOSSIER_COLUMN_AUDIENCE,
  FUNDING_PLAN_LINE_COLUMN_AUDIENCE,
  SHOWCASE_CARD_COLUMN_AUDIENCE,
  toPublicCard,
} from './showcase-card-views'

// Rows whose internal columns hold values found nowhere else.
const CARD: ShowcaseCard = {
  id: '6f1c2a8e-0000-4000-8000-0000000c0001',
  candidatureId: '6f1c2a8e-0000-4000-8000-0000000c0002',
  workspaceId: '6f1c2a8e-0000-4000-8000-0000000c0003',
  pseudonym: 'Projet Héron',
  region: 'centre-val-de-loire',
  consentedAt: new Date('2031-01-02T03:04:05.678Z'),
  consentedById: '6f1c2a8e-0000-4000-8000-0000000c0004',
  withdrawnAt: null,
  withdrawnById: null,
  withdrawalReason: null,
  hiddenAt: null,
  hiddenById: null,
  version: 987651,
  createdAt: new Date('2031-02-03T04:05:06.789Z'),
  updatedAt: new Date('2031-03-04T05:06:07.891Z'),
}

const DOSSIER: Dossier = {
  id: '6f1c2a8e-0000-4000-8000-0000000d0001',
  userId: '6f1c2a8e-0000-4000-8000-0000000d0002',
  companyId: '6f1c2a8e-0000-4000-8000-0000000d0003',
  name: 'TITRE-REEL Biosensio',
  slug: 'slug-reel-biosensio',
  questionnaireVersionId: '6f1c2a8e-0000-4000-8000-0000000d0004',
  sector: 'Eau et environnement',
  maturityStage: 'STADE-PRIVE',
  ancrageCvl: 'ancré',
  tagTechnologique: 'deeptech',
  axe1Projet: 3,
  axe2Financier: 4,
  axe3Origine: 2,
  deeptechScore: 987652,
  preCreation: false,
  classificationSources: { sector: ['secteur'] },
  submittedAt: new Date('2032-01-02T03:04:05.678Z'),
  summary: 'RESUME-PRIVE capteurs',
  objective: 'OBJECTIF-PRIVE industrialiser',
  description: 'DESCRIPTION-PRIVEE',
  amountEur: 300_000,
  financingTypes: ['equity'],
  publicationStatus: 'published',
  publishedAt: new Date('2032-02-03T04:05:06.789Z'),
  archivedAt: null,
  createdAt: new Date('2032-03-04T05:06:07.891Z'),
  updatedAt: new Date('2032-04-05T06:07:08.912Z'),
}

const line = (n: number, amountEur: number, state: string): FundingPlanLine => ({
  id: `6f1c2a8e-0000-4000-8000-0000000e000${n}`,
  candidatureId: CARD.candidatureId,
  workspaceId: CARD.workspaceId,
  categoryId: `6f1c2a8e-0000-4000-8000-0000000f000${n}`,
  label: `PRECISION-PRIVEE ${n}`,
  amountEur,
  state,
  version: 987660 + n,
  updatedBySide: 'owner',
  updatedById: CARD.consentedById,
  createdAt: new Date(`2033-01-0${n}T03:04:05.678Z`),
  updatedAt: new Date(`2033-02-0${n}T03:04:05.678Z`),
})
// Each amount found nowhere else; only their sums by state reach the card.
const LINES = [
  line(1, 123_457, 'obtained'),
  line(2, 34_568, 'obtained'),
  line(3, 45_679, 'requested'),
  line(4, 56_781, 'planned'),
  line(5, 67_892, 'refused'),
  line(6, 78_913, 'requested'),
]

const COMMITTEE: Committee = {
  id: '6f1c2a8e-0000-4000-8000-000000000001',
  workspaceId: CARD.workspaceId,
  name: 'Comité de juin',
  localStart: new Date('2099-06-10T14:00:00.000Z'),
  timeZone: 'Europe/Paris',
  startsAt: new Date('2099-06-10T12:00:00.000Z'),
  location: 'LIEU-PRIVE salle 2',
  meetingUrl: 'https://visio.example.org/LIEN-PRIVE',
  status: 'planned',
  internalNotes: 'NOTE-INTERNE trésorerie fragile',
  sharedInfo: 'INFO-DIFFUSEE accueil',
  participationRequestsOpen: false,
  version: 987670,
  createdAt: new Date('2034-01-02T03:04:05.678Z'),
  updatedAt: new Date('2034-02-03T04:05:06.789Z'),
}

const scalarColumns = (model: string) =>
  Prisma.dmmf.datamodel.models
    .find((m) => m.name === model)!
    .fields.filter((f) => f.kind === 'scalar')
    .map((f) => f.name)
    .sort()

const text = (value: unknown): string =>
  value instanceof Date ? value.toISOString() : (JSON.stringify(value) ?? '').replace(/^"|"$/g, '')

// ROADMAP E09.02: what the public reads of a request's card, and the classification of every column
// it is built from.
describe('public card view', () => {
  const card = toPublicCard({ card: CARD, dossier: DOSSIER, lines: LINES, committee: COMMITTEE })
  const json = JSON.stringify(card)

  it('classifies every column of the tables a card is built from, and only those (closed by default)', () => {
    // A column added to one of these models without being classified fails here (and does not
    // compile).
    for (const [model, audience] of Object.entries(CARD_COLUMN_AUDIENCES)) {
      expect([model, Object.keys(audience).sort()]).toEqual([model, scalarColumns(model)])
    }
    const named = Object.entries(CARD_COLUMN_AUDIENCES).flatMap(([model, audience]) =>
      Object.entries(audience)
        .filter(([, a]) => a !== 'internal')
        .map(([column, a]) => `${model}.${column}:${a}`),
    )
    expect(named.sort()).toEqual([
      'Dossier.amountEur:public',
      'Dossier.sector:public',
      'FundingPlanLine.amountEur:aggregate',
      'FundingPlanLine.state:aggregate',
      'ShowcaseCard.pseudonym:public',
      'ShowcaseCard.region:public',
    ])
  })

  it('never lets an internal column reach the card, and carries every public one', () => {
    const rows: Array<[string, Record<string, unknown>, Record<string, string>]> = [
      ['ShowcaseCard', CARD, SHOWCASE_CARD_COLUMN_AUDIENCE],
      ['Dossier', DOSSIER, DOSSIER_COLUMN_AUDIENCE],
      ...LINES.map(
        (l) =>
          ['FundingPlanLine', l, FUNDING_PLAN_LINE_COLUMN_AUDIENCE] as [
            string,
            Record<string, unknown>,
            Record<string, string>,
          ],
      ),
    ]
    for (const [model, row, audiences] of rows) {
      for (const [column, audience] of Object.entries(audiences)) {
        const value = row[column]
        if (value === null || audience === 'aggregate') continue
        // Short values (a score, a boolean) could appear by chance: the distinctive ones are checked.
        if (audience === 'internal' && text(value).length < 4) continue
        expect([model, column, audience, json.includes(text(value))]).toEqual([
          model,
          column,
          audience,
          audience === 'public',
        ])
      }
    }
    // The plan's amounts one by one never; their sums by state only.
    for (const l of LINES) {
      expect([l.amountEur, json.includes(String(l.amountEur))]).toEqual([l.amountEur, false])
    }
    expect(card.fundingPlan).toEqual({
      obtainedEur: 123_457 + 34_568,
      requestedEur: 45_679 + 78_913,
      remainingEur: 300_000 - 123_457 - 34_568,
    })
    // The session by name and when only.
    for (const secret of ['LIEU-PRIVE', 'LIEN-PRIVE', 'NOTE-INTERNE', 'INFO-DIFFUSEE', '987670']) {
      expect([secret, json.includes(secret)]).toEqual([secret, false])
    }
    expect(Object.keys(card)).toEqual([...PUBLIC_CARD_FIELDS])
    const sent = JSON.parse(json) as unknown
    expect(publicCardSchema.parse(sent)).toEqual(sent)
    expect(card.committee).toEqual({
      state: 'scheduled',
      session: {
        id: COMMITTEE.id,
        name: 'Comité de juin',
        date: '2099-06-10',
        time: '14:00',
        timeZone: 'Europe/Paris',
        startsAt: '2099-06-10T12:00:00.000Z',
      },
    })
  })

  it('reads « en attente de comité » without a session, no remaining without an amount, no unknown region', () => {
    const bare = toPublicCard({
      card: { ...CARD, region: 'touraine' },
      dossier: { ...DOSSIER, amountEur: null, sector: null },
      lines: [],
      committee: null,
    })
    expect(bare).toEqual({
      pseudonym: 'Projet Héron',
      sector: null,
      region: null,
      amountEur: null,
      fundingPlan: { obtainedEur: 0, requestedEur: 0, remainingEur: null },
      committee: { state: 'awaiting' },
    })
    expect(publicCardSchema.parse(bare)).toEqual(bare)
  })
})
