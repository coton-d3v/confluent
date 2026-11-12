import { Prisma, type Committee } from '@prisma/client'
import { COMMITTEE_SHARED_FIELDS, sharedCommitteeSchema } from '@confluent/shared'
import { COMMITTEE_COLUMN_AUDIENCE, sharedCommitteeOf, toView } from './committee-views'

// A committee row whose internal columns hold values found nowhere else.
const ROW: Committee = {
  id: '6f1c2a8e-0000-4000-8000-000000000001',
  workspaceId: '6f1c2a8e-0000-4000-8000-0000000000ws',
  name: 'Comité de juin',
  localStart: new Date('2099-06-10T14:00:00.000Z'),
  timeZone: 'Europe/Paris',
  startsAt: new Date('2099-06-10T12:00:00.000Z'),
  location: 'CCI Touraine, salle 2',
  meetingUrl: 'https://visio.example.org/j/123',
  status: 'planned',
  internalNotes: 'NOTE-INTERNE Biosensio : trésorerie fragile',
  sharedInfo: 'Accueil à 13 h 45, 10 minutes de pitch.',
  version: 987654,
  createdAt: new Date('2031-01-02T03:04:05.678Z'),
  updatedAt: new Date('2032-02-03T04:05:06.789Z'),
}

const scalarColumns = () =>
  Prisma.dmmf.datamodel.models
    .find((m) => m.name === 'Committee')!
    .fields.filter((f) => f.kind === 'scalar')
    .map((f) => f.name)
    .sort()

// ROADMAP E08.02: the only view of a committee for a reader outside the workspace's conseillers, and
// the classification of every column it is built from.
describe('committee views', () => {
  it('classifies every column of the committees, and only those (closed by default)', () => {
    // A column added to the model without being classified fails here (and does not compile).
    expect(Object.keys(COMMITTEE_COLUMN_AUDIENCE).sort()).toEqual(scalarColumns())
    expect(COMMITTEE_COLUMN_AUDIENCE.internalNotes).toBe('internal')
    expect(COMMITTEE_COLUMN_AUDIENCE.sharedInfo).toBe('shared')
  })

  it('shows the conseillers both texts, side by side', () => {
    expect(toView(ROW)).toMatchObject({
      internalNotes: 'NOTE-INTERNE Biosensio : trésorerie fragile',
      sharedInfo: 'Accueil à 13 h 45, 10 minutes de pitch.',
      date: '2099-06-10',
      time: '14:00',
    })
  })

  it('never lets an internal column reach the shared view, and carries every shared one', () => {
    const shared = sharedCommitteeOf(ROW)
    const json = JSON.stringify(shared)
    const columns = Object.entries(COMMITTEE_COLUMN_AUDIENCE) as Array<
      [keyof Committee, 'shared' | 'internal']
    >
    for (const [column, audience] of columns) {
      const value = ROW[column]
      const text = value instanceof Date ? value.toISOString() : String(value)
      if (column === 'localStart') {
        // Read as the date and time typed.
        expect([column, shared.date, shared.time]).toEqual([column, '2099-06-10', '14:00'])
        continue
      }
      expect([column, audience, json.includes(text)]).toEqual([
        column,
        audience,
        audience === 'shared',
      ])
    }
    expect(Object.keys(shared)).toEqual([...COMMITTEE_SHARED_FIELDS])
    expect(json).not.toContain('NOTE-INTERNE')
    // What a candidate's or an investor's client will receive, once serialised.
    const sent = JSON.parse(json) as unknown
    expect(sharedCommitteeSchema.parse(sent)).toEqual(sent)
  })

  it('shows a cancelled committee as cancelled, and an unknown status as cancelled', () => {
    expect(sharedCommitteeOf({ ...ROW, status: 'cancelled' }).status).toBe('cancelled')
    expect(sharedCommitteeOf({ ...ROW, status: 'archived' }).status).toBe('cancelled')
  })
})
