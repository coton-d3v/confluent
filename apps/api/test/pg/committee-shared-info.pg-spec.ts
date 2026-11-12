import { randomUUID } from 'node:crypto'
import { Prisma as PrismaNamespace, type Prisma } from '@prisma/client'
import { COMMITTEE_LIMITS } from '@confluent/shared'
import { AuditService } from '../../src/modules/audit/audit.service'
import {
  COMMITTEE_COLUMN_AUDIENCE,
  sharedCommitteeOf,
} from '../../src/modules/committees/committee-views'
import {
  CommitteesService,
  type CommitteeInput,
} from '../../src/modules/committees/committees.service'
import { WorkspaceAccessService } from '../../src/modules/workspaces/workspace-access'
import { quietNotices, testDatabase } from './database'
import { committeeSharedInfoDown, committeeSharedInfoUp } from './sql-file'

const UP = committeeSharedInfoUp()
// Without the acceptance: what an operator runs first.
const DOWN = committeeSharedInfoDown().slice(1)
const ACCEPT_LOSS = "SET LOCAL confluent.accept_committee_shared_info_loss = 'on'"
// The acceptance lasts for the whole transaction: withdrawn before a revert that must be checked.
const REFUSE_LOSS = "SET LOCAL confluent.accept_committee_shared_info_loss = 'off'"

class RolledBack extends Error {}

type Tx = Prisma.TransactionClient
const run = async (tx: Tx, statements: string[]) => {
  for (const sql of statements) await tx.$executeRawUnsafe(sql)
}
const rows = (tx: Tx, sql: string) => tx.$queryRawUnsafe<Array<Record<string, unknown>>>(sql)

const JUNE: CommitteeInput = {
  name: 'Comité de juin',
  date: '2099-06-10',
  time: '14:00',
  timeZone: 'Europe/Paris',
  internalNotes: 'NOTE-INTERNE jury incomplet',
  sharedInfo: 'Accueil à 13 h 45.',
}

// What the migration changes, comparable: the committees' columns, constraints and rows.
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
       'committees', (SELECT json_agg(to_jsonb(c) ORDER BY id) FROM committees c)
     )::text AS f`,
  )
  return row.f as string
}

// ROADMAP E08.02 on PostgreSQL: the migration adds the shared information beside the internal notes
// without touching them, survives an interrupted deployment and can be undone (refusing, unless
// accepted, to lose shared information); its constraint keeps it plain and bounded; every column of
// the table is classified internal or shared, and what a committee's candidates and investors would
// read of a stored committee never holds its internal notes.
describe('committee shared information (PostgreSQL)', () => {
  const prisma = testDatabase()
  const audit = new AuditService(prisma)
  const access = new WorkspaceAccessService(prisma)
  const committees = new CommitteesService(prisma, access, audit, quietNotices(prisma))
  const tag = randomUUID().slice(0, 8)
  const workspaces: string[] = []
  const users: string[] = []

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { actorId: { in: users } } })
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

  async function managedWorkspace() {
    const ws = await prisma.workspace.create({
      data: { slug: `pg-${randomUUID().slice(0, 12)}`, name: 'Structure test' },
    })
    workspaces.push(ws.id)
    const user = await prisma.user.create({
      data: { email: `m-${randomUUID().slice(0, 8)}-${tag}@pg-test.dev`, role: 'financeur' },
    })
    users.push(user.id)
    await prisma.workspaceMembership.create({
      data: { workspaceId: ws.id, userId: user.id, role: 'conseiller', canManageWorkspace: true },
    })
    return { workspaceId: ws.id, manager: { id: user.id, role: 'financeur' } }
  }

  describe('migration', () => {
    it('adds the shared information and nothing else; undone (refusing to lose it unless accepted), then applied again', async () => {
      const { workspaceId, manager } = await managedWorkspace()
      const bare = await committees.create(manager, workspaceId, { ...JUNE, sharedInfo: null })
      const shared = await committees.create(manager, workspaceId, { ...JUNE, name: 'Partagé' })
      await rolledBack(async (tx) => {
        const kept = `SELECT id, internal_notes, version FROM committees
                      WHERE id IN ('${bare.id}', '${shared.id}') ORDER BY id`
        const before = await rows(tx, kept)
        const counts = `SELECT (SELECT count(*)::int FROM committees) AS committees,
                  (SELECT count(*)::int FROM audit_log) AS journal`
        const [countsBefore] = await rows(tx, counts)

        // Shared information exists: refused unless accepted.
        await tx.$executeRawUnsafe('SAVEPOINT before_down')
        await expect(run(tx, DOWN)).rejects.toThrow(/would be lost/)
        await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT before_down')
        await run(tx, [ACCEPT_LOSS, ...DOWN, REFUSE_LOSS])
        expect(
          await rows(
            tx,
            `SELECT count(*)::int AS n FROM information_schema.columns
             WHERE table_schema = current_schema() AND table_name = 'committees' AND column_name = 'shared_info'`,
          ),
        ).toEqual([{ n: 0 }])
        // The internal notes, the committees and their journal stay.
        expect(await rows(tx, kept)).toEqual(before)
        expect((await rows(tx, counts))[0]).toEqual(countsBefore)

        await run(tx, UP)
        const migrated = await fingerprint(tx)
        expect(await rows(tx, kept)).toEqual(before)
        expect(
          await rows(tx, `SELECT count(*)::int AS n FROM committees WHERE shared_info IS NOT NULL`),
        ).toEqual([{ n: 0 }])
        // Without any shared information: undone without acceptance, applied again, the same.
        await run(tx, DOWN)
        await run(tx, UP)
        expect(await fingerprint(tx)).toEqual(migrated)
      })
    })

    it('survives an interrupted deployment: any prefix of the migration, then all of it, gives the same database', async () => {
      await rolledBack(async (tx) => {
        await run(tx, [ACCEPT_LOSS, ...DOWN, REFUSE_LOSS])
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
    it('keeps the shared information plain, trimmed and bounded', async () => {
      const { workspaceId, manager } = await managedWorkspace()
      const { id } = await committees.create(manager, workspaceId, { ...JUNE, sharedInfo: null })
      // The constraint as this migration file writes it.
      await rolledBack(async (tx) => {
        await run(tx, [ACCEPT_LOSS, ...DOWN, REFUSE_LOSS, ...UP])
        const set = (value: string) =>
          tx.$executeRawUnsafe(`UPDATE committees SET shared_info = ${value} WHERE id = '${id}'`)
        for (const value of [
          `''`,
          `E'Accueil\\n'`,
          `' Accueil'`,
          `E'Un\\n\\n\\nDeux'`,
          `E'Un\\tDeux'`,
          `'Voir <a href="x">ceci</a>'`,
          `'${'x'.repeat(COMMITTEE_LIMITS.sharedInfo + 1)}'`,
        ]) {
          await tx.$executeRawUnsafe('SAVEPOINT attempt')
          expect([value, await set(value).catch((e: Error) => e.message)]).toEqual([
            value,
            expect.stringMatching(/check constraint/),
          ])
          await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT attempt')
        }
        for (const value of [
          'NULL',
          `E'Accueil à 13 h 45 :\\n\\n1. Pitchs (< 10 min)\\n2. Questions'`,
          `'${'x'.repeat(COMMITTEE_LIMITS.sharedInfo)}'`,
        ]) {
          expect(await set(value)).toBe(1)
        }
      })
    })
  })

  describe('audiences', () => {
    it('classifies every column of the table as internal or shared', async () => {
      const model = PrismaNamespace.dmmf.datamodel.models.find((m) => m.name === 'Committee')!
      const classified = Object.keys(COMMITTEE_COLUMN_AUDIENCE)
        .map((field) => {
          const column = model.fields.find((f) => f.name === field)!
          return column.dbName ?? column.name
        })
        .sort()
      const columns = await prisma.$queryRawUnsafe<Array<{ column_name: string }>>(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = current_schema() AND table_name = 'committees' ORDER BY column_name`,
      )
      expect(columns.map((c) => c.column_name)).toEqual(classified)
    })

    it('reads a stored committee for its candidates and investors without its internal notes', async () => {
      const { workspaceId, manager } = await managedWorkspace()
      const { id } = await committees.create(manager, workspaceId, JUNE)
      const shared = sharedCommitteeOf(await prisma.committee.findUniqueOrThrow({ where: { id } }))
      expect(shared).toMatchObject({ id, sharedInfo: 'Accueil à 13 h 45.', status: 'planned' })
      expect(JSON.stringify(shared)).not.toContain('NOTE-INTERNE')
      expect(shared).not.toHaveProperty('internalNotes')
    })
  })
})
