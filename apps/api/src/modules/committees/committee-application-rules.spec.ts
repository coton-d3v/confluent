import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  COMMITTEE_APPLICATION_STATUSES,
  COMMITTEE_APPLICATION_TRANSITIONS,
  COMMITTEE_SHARED_FIELDS,
  ENGAGING_COMMITTEE_APPLICATION_STATUSES,
  FINANCING_STATUSES,
  candidateCommitteeOf,
  candidateCommitteeSchema,
  changeCommitteeApplicationSchema,
  changeWorkspaceCommitteeApplicationSchema,
  committeeApplicationSideOf,
  committeeApplicationStatusOf,
  committeeApplicationTransition,
  committeeApplicationTransitionsFor,
  committeeOpenToCandidates,
  financingOpenToCommittees,
  type Committee,
  type CommitteeApplicationStatus,
} from '@confluent/shared'

const COMMITTEE: Committee = {
  id: '6a1f0e3c-0000-4000-8000-000000000001',
  workspaceId: '6a1f0e3c-0000-4000-8000-000000000002',
  name: 'Comité de juin',
  date: '2099-06-10',
  time: '14:00',
  timeZone: 'Europe/Paris',
  startsAt: '2099-06-10T12:00:00.000Z',
  location: 'Salle 2',
  meetingUrl: 'https://visio.example.org/j/1',
  status: 'planned',
  internalNotes: 'NOTE-INTERNE',
  sharedInfo: 'Pitch de 10 minutes.',
  version: 3,
  createdAt: '2099-01-01T00:00:00.000Z',
  updatedAt: '2099-01-01T00:00:00.000Z',
}

const migration = readFileSync(
  join(__dirname, '../../../prisma/migrations/20261203000000_committee_applications/migration.sql'),
  'utf8',
)

// ROADMAP E08.03: the rules of a request's entries on committees, shared by the site and the API.
describe('committee application rules (E08.03)', () => {
  it('lets each side make its own transitions only, from no entry or the current status', () => {
    const table = Object.fromEntries(
      [null, ...COMMITTEE_APPLICATION_STATUSES].map((from) => [
        String(from),
        {
          owner: committeeApplicationTransitionsFor(from, 'owner'),
          workspace: committeeApplicationTransitionsFor(from, 'workspace'),
        },
      ]),
    )
    expect(table).toEqual({
      null: { owner: ['applied'], workspace: ['proposed'] },
      applied: { owner: ['withdrawn'], workspace: ['accepted', 'refused'] },
      proposed: { owner: ['accepted', 'withdrawn'], workspace: ['withdrawn'] },
      accepted: { owner: ['withdrawn'], workspace: ['withdrawn'] },
      // The structure's refusal: only the structure proposes the request again.
      refused: { owner: [], workspace: ['proposed'] },
      withdrawn: { owner: ['applied'], workspace: ['proposed'] },
    })
    expect(committeeApplicationTransition('applied', 'accepted', 'owner')).toBe('forbidden')
    expect(committeeApplicationTransition('proposed', 'accepted', 'workspace')).toBe('forbidden')
    expect(committeeApplicationTransition('accepted', 'accepted', 'workspace')).toBe('impossible')
    expect(committeeApplicationTransition(null, 'accepted', 'workspace')).toBe('impossible')
    expect(committeeApplicationTransition(null, 'withdrawn', 'owner')).toBe('impossible')
  })

  it('retains a request only once both sides agreed', () => {
    for (const t of COMMITTEE_APPLICATION_TRANSITIONS.filter((t) => t.to === 'accepted')) {
      // The other side asked: the entrepreneur applied, or the structure proposed.
      expect([t.from, t.by]).toEqual(
        t.from === 'applied' ? ['applied', ['workspace']] : ['proposed', ['owner']],
      )
    }
  })

  it('reads an unknown status or side the most closed way', () => {
    expect(committeeApplicationStatusOf('presented')).toBe('refused')
    expect(committeeApplicationStatusOf(null)).toBe('refused')
    expect(committeeApplicationStatusOf('toString')).toBe('refused')
    expect(committeeApplicationSideOf('owner')).toBe('owner')
    expect(committeeApplicationSideOf('admin')).toBe('workspace')
  })

  it('gives the entrepreneur the shared view of a committee only, the link once retained', () => {
    const statuses: Array<CommitteeApplicationStatus | 'unknown' | null> = [
      ...COMMITTEE_APPLICATION_STATUSES,
      'unknown',
      null,
    ]
    for (const status of statuses) {
      const view = candidateCommitteeOf(COMMITTEE, status ? { status } : null)
      expect(Object.keys(view).sort()).toEqual([...COMMITTEE_SHARED_FIELDS].sort())
      expect(JSON.stringify(view)).not.toContain('NOTE-INTERNE')
      expect([status, view.meetingUrl]).toEqual([
        status,
        status === 'accepted' ? COMMITTEE.meetingUrl : null,
      ])
      expect(
        candidateCommitteeSchema.safeParse({ committee: view, application: null }).success,
      ).toBe(true)
    }
    // The internal notes cannot slip through the schema either.
    expect(
      candidateCommitteeSchema.safeParse({
        committee: { ...candidateCommitteeOf(COMMITTEE, null), internalNotes: 'x' },
        application: null,
      }).success,
    ).toBe(false)
  })

  it('opens a committee to the entrepreneur while planned and not started', () => {
    const now = Date.parse('2099-06-10T11:59:00.000Z')
    expect(committeeOpenToCandidates(COMMITTEE, now)).toBe(true)
    expect(committeeOpenToCandidates(COMMITTEE, Date.parse(COMMITTEE.startsAt))).toBe(false)
    expect(committeeOpenToCandidates({ ...COMMITTEE, status: 'cancelled' }, now)).toBe(false)
    expect(committeeOpenToCandidates({ ...COMMITTEE, status: 'held' }, now)).toBe(false)
    expect(committeeOpenToCandidates({ ...COMMITTEE, status: 'deleted' }, now)).toBe(false)
  })

  it('brings a request to a committee only while its financing status is open', () => {
    expect(FINANCING_STATUSES.filter(financingOpenToCommittees)).toEqual([
      'preparing',
      'in_committee',
    ])
    expect(ENGAGING_COMMITTEE_APPLICATION_STATUSES).toEqual(['applied', 'proposed', 'accepted'])
  })

  it('takes a change from the version read, explicitly none for a first one', () => {
    const ok = (schema: typeof changeCommitteeApplicationSchema, v: unknown) =>
      schema.safeParse(v).success
    expect(ok(changeCommitteeApplicationSchema, { to: 'applied', version: null })).toBe(true)
    expect(ok(changeCommitteeApplicationSchema, { to: 'withdrawn', version: 4 })).toBe(true)
    for (const body of [
      { to: 'applied' },
      { to: 'applied', version: 0 },
      { to: 'applied', version: 1.5 },
      { to: 'presented', version: null },
      { to: 'applied', version: null, candidatureId: COMMITTEE.id },
    ]) {
      expect([body, ok(changeCommitteeApplicationSchema, body)]).toEqual([body, false])
    }
    expect(
      changeWorkspaceCommitteeApplicationSchema.safeParse({
        candidatureId: COMMITTEE.id,
        to: 'proposed',
        version: null,
      }).success,
    ).toBe(true)
    expect(
      changeWorkspaceCommitteeApplicationSchema.safeParse({ to: 'proposed', version: null })
        .success,
    ).toBe(false)
  })

  it('keeps the database’s CHECK equal to the shared lists and to who makes each status', () => {
    const quoted = (sql: string) => [...sql.matchAll(/'([a-z_]+)'/g)].map((m) => m[1])
    const statuses = /"status" IN \(([^)]*)\)/.exec(migration)![1]
    expect(quoted(statuses)).toEqual([...COMMITTEE_APPLICATION_STATUSES])
    // The statuses only one side reaches, as the CHECK writes them.
    const only = (side: 'owner' | 'workspace') =>
      COMMITTEE_APPLICATION_STATUSES.filter((to) =>
        COMMITTEE_APPLICATION_TRANSITIONS.filter((t) => t.to === to).every(
          (t) => t.by.length === 1 && t.by[0] === side,
        ),
      ).filter((to) => to !== 'accepted')
    expect(only('owner')).toEqual(['applied'])
    expect(only('workspace')).toEqual(['proposed', 'refused'])
    expect(migration).toContain(`("status" <> 'applied' OR "status_by" = 'owner')`)
    expect(migration).toContain(
      `("status" NOT IN ('proposed', 'refused') OR "status_by" = 'workspace')`,
    )
  })
})
