import { randomUUID } from 'node:crypto'
import { HttpException } from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import { AuditService } from '../../src/modules/audit/audit.service'
import {
  CommitteesService,
  type CommitteeInput,
} from '../../src/modules/committees/committees.service'
import { WorkspaceAccessService } from '../../src/modules/workspaces/workspace-access'
import { quietNotices, testDatabase } from './database'
import {
  committeeApplicationsDown,
  committeeNoticesDown,
  committeesDown,
  committeesUp,
  participationDecisionsDown,
  participationRequestsDown,
} from './sql-file'

const UP = committeesUp()
// Without the acceptance: what an operator runs first.
const DOWN = committeesDown().slice(1)
const ACCEPT_LOSS = "SET LOCAL confluent.accept_committees_loss = 'on'"
// The acceptance lasts for the whole transaction: withdrawn before a revert that must be checked.
const REFUSE_LOSS = "SET LOCAL confluent.accept_committees_loss = 'off'"
// E08.06's notices, E08.05's decisions and E08.04's participation requests, then E08.03's entries
// reference the committees: undone first.
const LATER_DOWN = [
  ...committeeNoticesDown(),
  ...participationDecisionsDown(),
  ...participationRequestsDown(),
  ...committeeApplicationsDown(),
]

class RolledBack extends Error {}

type Tx = Prisma.TransactionClient
const run = async (tx: Tx, statements: string[]) => {
  for (const sql of statements) await tx.$executeRawUnsafe(sql)
}
const rows = (tx: Tx, sql: string) => tx.$queryRawUnsafe<Array<Record<string, unknown>>>(sql)

const outcome = (result: PromiseSettledResult<unknown>) => {
  if (result.status === 'fulfilled') return 'fulfilled'
  const err = result.reason as HttpException
  return err instanceof HttpException ? (err.getResponse() as { code: string }).code : String(err)
}

const JUNE: CommitteeInput = {
  name: 'Comité de juin',
  date: '2099-06-10',
  time: '14:00',
  timeZone: 'Europe/Paris',
}

// What the migration creates, comparable: the table's columns, constraints, indexes and rows.
async function fingerprint(tx: Tx): Promise<string> {
  const [row] = await rows(
    tx,
    `SELECT json_build_object(
       'columns', (SELECT json_agg(x ORDER BY x) FROM (
         SELECT column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, '') AS x
         FROM information_schema.columns
         WHERE table_schema = current_schema() AND table_name = 'committees') c),
       'constraints', (SELECT json_agg(x ORDER BY x) FROM (
         SELECT conname || ':' || pg_get_constraintdef(oid) AS x
         FROM pg_constraint WHERE conrelid::regclass::text = 'committees') k),
       'indexes', (SELECT json_agg(indexdef ORDER BY indexdef) FROM pg_indexes
         WHERE schemaname = current_schema() AND tablename = 'committees'),
       'actions', (SELECT json_agg(enumlabel ORDER BY enumsortorder) FROM pg_enum
         WHERE enumtypid = 'audit_action'::regtype
         AND enumlabel IN ('committee_created', 'committee_updated', 'committee_status_changed')),
       'committees', (SELECT json_agg(to_jsonb(c) ORDER BY id) FROM committees c)
     )::text AS f`,
  )
  return row.f as string
}

// ROADMAP E08.01 on PostgreSQL: the migration adds the committees without touching anything else,
// survives an interrupted deployment and can be undone (refusing, unless accepted, to lose a
// committee or its journal); the constraints keep a committee's values closed and inside its
// workspace; managers acting at the same moment never both change a committee from the same version,
// the cap holds against simultaneous creations, and a manager deprived of the right while waiting
// for the workspace lock writes nothing (code review R53).
describe('committees (PostgreSQL)', () => {
  const prisma = testDatabase()
  const audit = new AuditService(prisma)
  const access = new WorkspaceAccessService(prisma)
  const committees = new CommitteesService(prisma, access, audit, quietNotices(prisma))
  const tag = randomUUID().slice(0, 8)
  const workspaces: string[] = []
  const users: string[] = []

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { actorId: { in: users } } })
    // Their committees go with them.
    await prisma.workspace.deleteMany({ where: { id: { in: workspaces } } })
    await prisma.user.deleteMany({ where: { id: { in: users } } })
    await prisma.$disconnect()
  })

  const rolledBack = (fn: (tx: Tx) => Promise<void>) =>
    expect(
      prisma.$transaction(
        async (tx) => {
          await fn(tx)
          throw new RolledBack()
        },
        { timeout: 120_000 },
      ),
    ).rejects.toThrow(RolledBack)

  // A workspace with managing conseillers.
  async function managedWorkspace(managers = 1) {
    const ws = await prisma.workspace.create({
      data: { slug: `pg-${randomUUID().slice(0, 12)}`, name: 'Structure test' },
    })
    workspaces.push(ws.id)
    const actors: Array<{ id: string; role: string; membershipId: string }> = []
    for (let i = 0; i < managers; i++) {
      const user = await prisma.user.create({
        data: { email: `m-${randomUUID().slice(0, 8)}-${tag}@pg-test.dev`, role: 'financeur' },
      })
      users.push(user.id)
      const membership = await prisma.workspaceMembership.create({
        data: { workspaceId: ws.id, userId: user.id, role: 'conseiller', canManageWorkspace: true },
      })
      actors.push({ id: user.id, role: 'financeur', membershipId: membership.id })
    }
    return { workspaceId: ws.id, managers: actors }
  }

  const insert = (workspaceId: string, columns: Record<string, string> = {}) => {
    const values = {
      id: `'${randomUUID()}'`,
      workspace_id: `'${workspaceId}'`,
      name: `'Comité'`,
      local_start: `'2099-06-10 14:00'`,
      time_zone: `'Europe/Paris'`,
      starts_at: `'2099-06-10 12:00'`,
      updated_at: 'now()',
      ...columns,
    }
    return `INSERT INTO committees (${Object.keys(values).join(', ')}) VALUES (${Object.values(values).join(', ')})`
  }

  describe('migration', () => {
    it('adds the committees and nothing else; undone (refusing to lose a committee or its journal unless accepted), then applied again', async () => {
      const { workspaceId, managers } = await managedWorkspace()
      await rolledBack(async (tx) => {
        await run(tx, [...LATER_DOWN, ACCEPT_LOSS, ...DOWN, REFUSE_LOSS])
        expect(await rows(tx, `SELECT to_regclass('committees')::text AS t`)).toEqual([{ t: null }])
        const counts = `SELECT (SELECT count(*)::int FROM workspaces) AS workspaces,
                  (SELECT count(*)::int FROM workspace_memberships) AS memberships,
                  (SELECT count(*)::int FROM candidatures) AS candidatures,
                  (SELECT count(*)::int FROM audit_log) AS journal`
        const [before] = await rows(tx, counts)
        await run(tx, UP)
        expect((await rows(tx, counts))[0]).toEqual(before)
        expect(await rows(tx, 'SELECT count(*)::int AS n FROM committees')).toEqual([{ n: 0 }])
        const migrated = await fingerprint(tx)
        expect(migrated).toContain(
          '"actions" : ["committee_created", "committee_updated", "committee_status_changed"]',
        )

        // Without any committee: undone without acceptance, applied again, the same.
        await run(tx, DOWN)
        await run(tx, UP)
        expect(await fingerprint(tx)).toEqual(migrated)

        // A committee — even cancelled —, or only the journal of one: refused unless accepted;
        // accepted, the committees and their journal go, nothing else.
        for (const statements of [
          [insert(workspaceId, { status: `'cancelled'` })],
          [
            `INSERT INTO audit_log (id, action_type, actor_id, metadata)
             VALUES ('${randomUUID()}', 'committee_status_changed', '${managers[0].id}', '{}')`,
          ],
        ]) {
          await tx.$executeRawUnsafe('SAVEPOINT noted')
          await run(tx, statements)
          await tx.$executeRawUnsafe('SAVEPOINT before_down')
          await expect(run(tx, DOWN)).rejects.toThrow(/would be lost/)
          await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT before_down')
          await run(tx, [ACCEPT_LOSS, ...DOWN, REFUSE_LOSS])
          expect(await rows(tx, `SELECT to_regclass('committees')::text AS t`)).toEqual([
            { t: null },
          ])
          expect(
            await rows(
              tx,
              `SELECT count(*)::int AS n FROM audit_log WHERE action_type::text LIKE 'committee_%'`,
            ),
          ).toEqual([{ n: 0 }])
          expect((await rows(tx, counts))[0]).toEqual(before)
          await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT noted')
        }
      })
    })

    it('survives an interrupted deployment: any prefix of the migration, then all of it, gives the same database', async () => {
      await managedWorkspace()
      await rolledBack(async (tx) => {
        await run(tx, [...LATER_DOWN, ACCEPT_LOSS, ...DOWN, REFUSE_LOSS])
        await tx.$executeRawUnsafe('SAVEPOINT legacy')
        await run(tx, UP)
        const reference = await fingerprint(tx)
        for (let done = 0; done <= UP.length; done++) {
          await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT legacy')
          await run(tx, UP.slice(0, done))
          await run(tx, UP)
          expect({ done, result: await fingerprint(tx) }).toEqual({ done, result: reference })
        }
      })
    })
  })

  describe('constraints', () => {
    it('keeps a committee’s values closed, its texts plain and bounded, its schedule coherent', async () => {
      const { workspaceId } = await managedWorkspace()
      const refused = (sql: string) =>
        expect(prisma.$transaction((tx) => tx.$executeRawUnsafe(sql))).rejects.toThrow(
          /check constraint/,
        )
      for (const columns of [
        { name: `''` } as Record<string, string>,
        { name: `' Comité'` },
        { name: `'Comité  de juin'` },
        { name: `E'Comité\\nde juin'` },
        { name: `'${'x'.repeat(121)}'` },
        { local_start: `'2099-06-10 14:00:30'`, starts_at: `'2099-06-10 12:00:30'` },
        { local_start: `'1999-12-31 14:00'`, starts_at: `'1999-12-31 13:00'` },
        { local_start: `'2100-01-01 14:00'`, starts_at: `'2100-01-01 13:00'` },
        { time_zone: `'+01:00'` },
        { time_zone: `'CET'` },
        { time_zone: `'europe/paris'` },
        { time_zone: `'Europe/${'P'.repeat(64)}'` },
        // Further from the wall clock than any zone's offset (UTC+14 … UTC−12).
        { starts_at: `'2099-06-09 23:59'` },
        { starts_at: `'2099-06-11 02:01'` },
        { location: `''` },
        { location: `'Salle 2 '` },
        { location: `E'Salle\\t2'` },
        { location: `'${'x'.repeat(301)}'` },
        { meeting_url: `'http://visio.example.org'` },
        { meeting_url: `'https://visio.example.org/a b'` },
        { meeting_url: `'javascript:alert(1)'` },
        { meeting_url: `'https://visio.example.org/${'a'.repeat(480)}'` },
        { status: `'deleted'` },
        { status: `'Planned'` },
        { internal_notes: `''` },
        { internal_notes: `E'Note\\n'` },
        { internal_notes: `E'Un\\n\\n\\nDeux'` },
        { internal_notes: `'Voir <b>ceci</b>'` },
        { internal_notes: `'${'x'.repeat(5001)}'` },
        { version: '0' },
      ]) {
        await refused(insert(workspaceId, columns))
      }
      for (const columns of [
        {} as Record<string, string>,
        { status: `'held'`, version: '3' },
        { status: `'cancelled'` },
        { time_zone: `'UTC'`, starts_at: `'2099-06-10 14:00'` },
        { time_zone: `'Pacific/Kiritimati'`, starts_at: `'2099-06-10 00:00'` },
        { time_zone: `'Etc/GMT+12'`, starts_at: `'2099-06-11 02:00'` },
        { time_zone: `'America/Argentina/Ushuaia'`, starts_at: `'2099-06-10 17:00'` },
        {
          location: `'CCI Touraine, salle 2'`,
          meeting_url: `'https://visio.example.org/j/123?pwd=abc'`,
          internal_notes: `E'Ordre du jour :\\n\\n1. Pitchs (< 10 min)\\n2. Délibération'`,
        },
      ]) {
        await prisma.$transaction((tx) => tx.$executeRawUnsafe(insert(workspaceId, columns)))
      }
    })

    it('keeps a committee in an existing workspace, goes with it, and gives (id, workspace) as a key', async () => {
      const { workspaceId, managers } = await managedWorkspace()
      await expect(
        prisma.$transaction((tx) => tx.$executeRawUnsafe(insert(randomUUID()))),
      ).rejects.toThrow(/foreign key/)
      const created = await committees.create(managers[0], workspaceId, JUNE)
      expect(
        await prisma.$queryRawUnsafe(
          `SELECT indexdef FROM pg_indexes WHERE indexname = 'committees_id_workspace_id_key'`,
        ),
      ).toEqual([
        {
          indexdef: expect.stringContaining('UNIQUE INDEX committees_id_workspace_id_key'),
        },
      ])
      await prisma.workspace.delete({ where: { id: workspaceId } })
      expect(await prisma.committee.findUnique({ where: { id: created.id } })).toBeNull()
    })

    it('stores the wall clock as typed and the instant it designates, whatever the session’s time zone', async () => {
      const { workspaceId, managers } = await managedWorkspace()
      const created = await committees.create(managers[0], workspaceId, {
        ...JUNE,
        date: '2099-12-10',
        time: '09:30',
        timeZone: 'America/New_York',
      })
      const [row] = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
        `SELECT local_start::text AS local, starts_at::text AS instant, time_zone
         FROM committees WHERE id = '${created.id}'`,
      )
      expect(row).toEqual({
        local: '2099-12-10 09:30:00',
        instant: '2099-12-10 14:30:00',
        time_zone: 'America/New_York',
      })
      expect(await committees.get(managers[0], workspaceId, created.id)).toMatchObject({
        date: '2099-12-10',
        time: '09:30',
        startsAt: new Date('2099-12-10T14:30:00.000Z'),
      })
    })
  })

  describe('concurrency', () => {
    it('applies one of three changes made at the same moment from the same version', async () => {
      const { workspaceId, managers } = await managedWorkspace(3)
      const created = await committees.create(managers[0], workspaceId, JUNE)
      const results = await Promise.allSettled([
        committees.update(managers[0], workspaceId, created.id, { ...JUNE, name: 'A', version: 1 }),
        committees.update(managers[1], workspaceId, created.id, { ...JUNE, name: 'B', version: 1 }),
        committees.changeStatus(managers[2], workspaceId, created.id, {
          status: 'cancelled',
          version: 1,
        }),
      ])
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
      expect(results.map(outcome).filter((o) => o !== 'fulfilled')).toEqual([
        'COMMITTEE_CHANGED',
        'COMMITTEE_CHANGED',
      ])
      const row = await prisma.committee.findUniqueOrThrow({ where: { id: created.id } })
      expect(row.version).toBe(2)
      const entries = await prisma.auditLog.findMany({
        where: { actionType: { in: ['committee_updated', 'committee_status_changed'] } },
      })
      // One journal entry, the change applied — written in the same transaction.
      expect(
        entries.filter((e) => (e.metadata as { committeeId?: string }).committeeId === created.id),
      ).toHaveLength(1)
    })

    it('never lets simultaneous creations pass the cap of a workspace', async () => {
      const { workspaceId, managers } = await managedWorkspace(3)
      await prisma.$executeRawUnsafe(
        `INSERT INTO committees (id, workspace_id, name, local_start, time_zone, starts_at, updated_at)
         SELECT gen_random_uuid()::text, '${workspaceId}', 'Comité ' || n, '2099-06-10 14:00',
                'Europe/Paris', '2099-06-10 12:00', now()
         FROM generate_series(1, 499) AS n`,
      )
      const results = await Promise.allSettled(
        managers.map((m, i) =>
          committees.create(m, workspaceId, { ...JUNE, name: `Dernier ${i}` }),
        ),
      )
      expect(results.map(outcome).sort()).toEqual([
        'COMMITTEE_LIMIT',
        'COMMITTEE_LIMIT',
        'fulfilled',
      ])
      expect(await prisma.committee.count({ where: { workspaceId } })).toBe(500)
    })

    // Holds the workspace row while `attempt` runs: once the attempt waits for the lock (its first
    // check passed), `revoke` runs in the holding transaction, which then commits.
    async function revokedWhileWaiting(
      workspaceId: string,
      attempt: () => Promise<unknown>,
      revoke: (tx: Tx) => Promise<unknown>,
    ): Promise<number | 'fulfilled'> {
      let result!: Promise<number | 'fulfilled'>
      await prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT 1 FROM "workspaces" WHERE "id" = ${workspaceId} FOR UPDATE`
          result = attempt().then(
            () => 'fulfilled' as const,
            (err: unknown) => {
              if (err instanceof HttpException) return err.getStatus()
              throw err
            },
          )
          await waitForBlockedQuery()
          await revoke(tx)
        },
        { timeout: 20_000 },
      )
      return result
    }

    async function waitForBlockedQuery() {
      for (let i = 0; i < 100; i++) {
        const [{ waiting }] = await prisma.$queryRaw<Array<{ waiting: bigint }>>`
          SELECT count(*) AS waiting FROM pg_locks WHERE NOT granted`
        if (waiting > 0n) return
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      throw new Error('the attempt never waited for the workspace lock')
    }

    it('writes nothing for a manager deactivated or deprived of the right while waiting for the workspace (R53)', async () => {
      const { workspaceId, managers } = await managedWorkspace(2)
      const [marie, luc] = managers
      const created = await committees.create(marie, workspaceId, JUNE)

      expect(
        await revokedWhileWaiting(
          workspaceId,
          () => committees.create(luc, workspaceId, { ...JUNE, name: 'Pendant la révocation' }),
          (tx) =>
            tx.workspaceMembership.update({
              where: { id: luc.membershipId },
              data: { deactivatedAt: new Date() },
            }),
        ),
      ).toBe(404)
      expect(
        await revokedWhileWaiting(
          workspaceId,
          () =>
            committees.update(marie, workspaceId, created.id, { ...JUNE, name: 'X', version: 1 }),
          (tx) =>
            tx.workspaceMembership.update({
              where: { id: marie.membershipId },
              data: { canManageWorkspace: false },
            }),
        ),
      ).toBe(403)
      await prisma.workspaceMembership.update({
        where: { id: marie.membershipId },
        data: { canManageWorkspace: true },
      })
      expect(
        await revokedWhileWaiting(
          workspaceId,
          () =>
            committees.changeStatus(marie, workspaceId, created.id, {
              status: 'cancelled',
              version: 1,
            }),
          (tx) =>
            tx.workspaceMembership.update({
              where: { id: marie.membershipId },
              data: { deactivatedAt: new Date() },
            }),
        ),
      ).toBe(404)

      const all = await prisma.committee.findMany({ where: { workspaceId } })
      expect(all.map((c) => [c.name, c.status, c.version])).toEqual([
        ['Comité de juin', 'planned', 1],
      ])
    })
  })
})
