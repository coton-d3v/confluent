import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  COMMITTEE_NOTICE_KINDS,
  COMMITTEE_NOTICE_STATES,
  COMMITTEE_STATUSES,
  NOTIFIED_COMMITTEE_APPLICATION_STATUSES,
  committeeNoticeKind,
  committeeNoticeStateOf,
  committeeProgressSchema,
  participantCommitteeOf,
} from '@confluent/shared'

const COMMITTEE = {
  id: '2b0c7b8e-6b1f-4f7e-9a51-6f0d2f1c0a11',
  workspaceId: '0f0c7b8e-6b1f-4f7e-9a51-6f0d2f1c0a11',
  name: 'Comité de juin',
  date: '2099-06-10',
  time: '14:00',
  timeZone: 'Europe/Paris',
  startsAt: '2099-06-10T12:00:00.000Z',
  location: 'LIEU CCI, salle 2',
  meetingUrl: 'https://visio.example.org/LIEN',
  status: 'planned' as const,
  internalNotes: 'NOTE-INTERNE',
  sharedInfo: 'INFO-DIFFUSEE',
  participationRequestsOpen: true,
  version: 3,
  createdAt: '2099-01-01T00:00:00.000Z',
  updatedAt: '2099-01-02T00:00:00.000Z',
}

const MIGRATION = readFileSync(
  join(__dirname, '../../../prisma/migrations/20261206000000_committee_notices/migration.sql'),
  'utf8',
)
const quoted = (list: readonly string[]) => list.map((s) => `'${s}'`).join(', ')

// ROADMAP E08.06: which changes are notified, what a participant reads, and the closed lists the
// database keeps.
describe('committee follow-up rules', () => {
  it('notifies a new schedule, a cancellation and a restoration — nothing else', () => {
    expect(committeeNoticeKind({ fields: ['schedule'] })).toBe('rescheduled')
    expect(committeeNoticeKind({ fields: ['name', 'schedule', 'location'] })).toBe('rescheduled')
    for (const fields of [
      [],
      ['name'],
      ['location'],
      ['meetingUrl'],
      ['sharedInfo'],
      ['internalNotes'],
      ['participationRequestsOpen'],
    ]) {
      expect([fields, committeeNoticeKind({ fields })]).toEqual([fields, null])
    }
    const kinds = COMMITTEE_STATUSES.flatMap((from) =>
      COMMITTEE_STATUSES.map((to) => [from, to, committeeNoticeKind({ from, to })]),
    ).filter(([, , kind]) => kind !== null)
    expect(kinds).toEqual([
      ['planned', 'cancelled', 'cancelled'],
      ['cancelled', 'planned', 'restored'],
    ])
  })

  it('tells the owners of the requests a committee brings, not those refused or withdrawn', () => {
    expect([...NOTIFIED_COMMITTEE_APPLICATION_STATUSES]).toEqual([
      'applied',
      'proposed',
      'accepted',
    ])
  })

  it('reads an unknown notice state as not sent (closed by default)', () => {
    expect(committeeNoticeStateOf('sent')).toBe('sent')
    expect(committeeNoticeStateOf('delivered')).toBe('failed')
    expect(committeeNoticeStateOf('')).toBe('failed')
  })

  it('shows a participant the shared view, link included — never the internal notes nor the workspace’s own fields', () => {
    const view = participantCommitteeOf(COMMITTEE)
    expect(Object.keys(view).sort()).toEqual(
      [
        'id',
        'name',
        'date',
        'time',
        'timeZone',
        'startsAt',
        'location',
        'meetingUrl',
        'status',
        'sharedInfo',
      ].sort(),
    )
    expect(view.meetingUrl).toBe(COMMITTEE.meetingUrl)
    const json = JSON.stringify(view)
    for (const secret of ['NOTE-INTERNE', '"version"', COMMITTEE.workspaceId, 'participation']) {
      expect([secret, json.includes(secret)]).toEqual([secret, false])
    }
  })

  it('counts progress for every entry status, nothing else', () => {
    const progress = {
      committeeId: COMMITTEE.id,
      applications: { applied: 1, proposed: 0, accepted: 2, refused: 0, withdrawn: 1 },
      participants: { accepted: 3, pending: 1 },
    }
    expect(committeeProgressSchema.parse(progress)).toEqual(progress)
    expect(() =>
      committeeProgressSchema.parse({
        ...progress,
        participants: { accepted: 1, pending: 0, names: [] },
      }),
    ).toThrow()
  })

  it('keeps the kinds and states equal to the CHECK constraint of the migration', () => {
    expect(MIGRATION).toContain(`"kind" IN (${quoted(COMMITTEE_NOTICE_KINDS)})`)
    expect(MIGRATION).toContain(`"state" IN (${quoted(COMMITTEE_NOTICE_STATES)})`)
  })
})
