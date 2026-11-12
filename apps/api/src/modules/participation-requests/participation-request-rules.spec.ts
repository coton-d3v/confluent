import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  COMMITTEE_PUBLIC_FIELDS,
  COMMITTEE_SHARED_FIELDS,
  PARTICIPATION_REQUEST_LIMITS,
  PARTICIPATION_REQUEST_STATUSES,
  committeeOpenToParticipationRequests,
  createParticipationRequestSchema,
  publicCommitteeSchema,
  toPublicCommittee,
  type Committee,
} from '@confluent/shared'

const COMMITTEE: Committee = {
  id: '6f1c2a8e-0000-4000-8000-000000000001',
  workspaceId: '6f1c2a8e-0000-4000-8000-000000000002',
  name: 'Comité de juin',
  date: '2099-06-10',
  time: '14:00',
  timeZone: 'Europe/Paris',
  startsAt: '2099-06-10T12:00:00.000Z',
  location: 'LIEU-PRIVE CCI Touraine, salle 2',
  meetingUrl: 'https://visio.example.org/LIEN-PRIVE',
  status: 'planned',
  internalNotes: 'NOTE-INTERNE trésorerie fragile',
  sharedInfo: 'INFO-DIFFUSEE accueil à 13 h 45',
  participationRequestsOpen: true,
  version: 7,
  createdAt: '2027-01-02T03:04:05.000Z',
  updatedAt: '2027-02-03T04:05:06.000Z',
}

const VALID = {
  name: '  Claire   Martin ',
  organization: ' Angels  Touraine ',
  email: '  Claire.Martin@Example.ORG ',
  message: 'Bonjour,\r\n\r\n\r\nJe souhaite assister au comité.  ',
  committeeIds: [COMMITTEE.id, COMMITTEE.id],
  formToken: 'token',
}

const MIGRATION = readFileSync(
  join(__dirname, '../../../prisma/migrations/20261204000000_participation_requests/migration.sql'),
  'utf8',
)

// ROADMAP E08.04: what the public reads of a committee, which committees it is offered, and what a
// submission may hold — the same rules for the site, the API and the database.
describe('participation request rules', () => {
  it('shows the public a committee’s name and when only — never the place, link, shared information or internal notes', () => {
    const view = toPublicCommittee(COMMITTEE)
    expect(view).toEqual({
      id: COMMITTEE.id,
      name: 'Comité de juin',
      date: '2099-06-10',
      time: '14:00',
      timeZone: 'Europe/Paris',
      startsAt: '2099-06-10T12:00:00.000Z',
    })
    const json = JSON.stringify(view)
    for (const secret of [
      'LIEU-PRIVE',
      'LIEN-PRIVE',
      'INFO-DIFFUSEE',
      'NOTE-INTERNE',
      '"version"',
    ]) {
      expect([secret, json.includes(secret)]).toEqual([secret, false])
    }
    // A subset of the shared view, checked strictly as the site receives it.
    for (const field of COMMITTEE_PUBLIC_FIELDS) expect(COMMITTEE_SHARED_FIELDS).toContain(field)
    expect(publicCommitteeSchema.parse(JSON.parse(json))).toEqual(view)
    expect(() => publicCommitteeSchema.parse({ ...view, meetingUrl: null })).toThrow()
  })

  it('offers a committee only when opened, planned and not started (closed by default)', () => {
    const now = Date.parse('2099-06-10T11:59:00.000Z')
    expect(committeeOpenToParticipationRequests(COMMITTEE, now)).toBe(true)
    expect(
      committeeOpenToParticipationRequests({ ...COMMITTEE, participationRequestsOpen: false }, now),
    ).toBe(false)
    for (const status of ['cancelled', 'held', 'archived']) {
      expect([status, committeeOpenToParticipationRequests({ ...COMMITTEE, status }, now)]).toEqual(
        [status, false],
      )
    }
    expect(committeeOpenToParticipationRequests(COMMITTEE, Date.parse(COMMITTEE.startsAt))).toBe(
      false,
    )
  })

  it('normalises a submission: one-line name and organisation, lower-case address, plain paragraphs, each session once', () => {
    expect(createParticipationRequestSchema.parse(VALID)).toEqual({
      name: 'Claire Martin',
      organization: 'Angels Touraine',
      email: 'claire.martin@example.org',
      message: 'Bonjour,\n\nJe souhaite assister au comité.',
      committeeIds: [COMMITTEE.id],
      formToken: 'token',
    })
    expect(
      createParticipationRequestSchema.parse({ ...VALID, organization: ' ', message: '' }),
    ).toMatchObject({ organization: null, message: null })
  })

  it('refuses what is missing, too long, marked up or unknown', () => {
    const refused = (patch: Record<string, unknown>) =>
      createParticipationRequestSchema.safeParse({ ...VALID, ...patch }).success
    expect(refused({ name: '   ' })).toBe(false)
    expect(refused({ name: 'x'.repeat(PARTICIPATION_REQUEST_LIMITS.name + 1) })).toBe(false)
    expect(refused({ email: 'pas-une-adresse' })).toBe(false)
    expect(refused({ email: 'é@exemple.fr' })).toBe(false)
    expect(refused({ email: `${'a'.repeat(250)}@x.fr` })).toBe(false)
    expect(refused({ message: '<script>alert(1)</script>' })).toBe(false)
    expect(refused({ message: 'x'.repeat(PARTICIPATION_REQUEST_LIMITS.message + 1) })).toBe(false)
    expect(refused({ committeeIds: [] })).toBe(false)
    expect(refused({ committeeIds: ['pas-un-uuid'] })).toBe(false)
    expect(
      refused({
        committeeIds: Array.from(
          { length: PARTICIPATION_REQUEST_LIMITS.committees + 1 },
          (_, i) => `6f1c2a8e-0000-4000-8000-${String(i).padStart(12, '0')}`,
        ),
      }),
    ).toBe(false)
    expect(refused({ formToken: 'x'.repeat(PARTICIPATION_REQUEST_LIMITS.formToken + 1) })).toBe(
      false,
    )
    expect(refused({ role: 'admin' })).toBe(false)
    // The hidden field is accepted (any value), so that filling it is not told apart.
    expect(refused({ website: 'https://spam.example' })).toBe(true)
  })

  it('keeps the database’s CHECK equal to the shared limits and closed status list', () => {
    expect(MIGRATION).toContain(
      `"status" IN (${PARTICIPATION_REQUEST_STATUSES.map((s) => `'${s}'`).join(', ')})`,
    )
    expect(MIGRATION).toContain(
      `char_length("email") BETWEEN 3 AND ${PARTICIPATION_REQUEST_LIMITS.email}`,
    )
    expect(MIGRATION).toContain(
      `char_length("name") BETWEEN 1 AND ${PARTICIPATION_REQUEST_LIMITS.name}`,
    )
    expect(MIGRATION).toContain(
      `char_length("organization") BETWEEN 1 AND ${PARTICIPATION_REQUEST_LIMITS.organization}`,
    )
    expect(MIGRATION).toContain(
      `char_length("message") BETWEEN 1 AND ${PARTICIPATION_REQUEST_LIMITS.message}`,
    )
  })
})
