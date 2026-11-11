import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { HttpException } from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import {
  DEFAULT_FUNDING_SOURCE_CATEGORIES,
  reorderFundingSourceCategoriesSchema,
} from '@confluent/shared'
import { AuditService } from '../../src/modules/audit/audit.service'
import { MemoryStorageAdapter } from '../../src/modules/documents/storage/memory-storage.adapter'
import { FundingSourceCategoriesService } from '../../src/modules/funding-sources/funding-source-categories.service'
import { WorkspaceAccessService } from '../../src/modules/workspaces/workspace-access'
import { WorkspacesService } from '../../src/modules/workspaces/workspaces.service'
import { testDatabase } from './database'
import { CHECKS, MIGRATIONS, sqlStatements } from './sql-file'

const UP = sqlStatements(join(MIGRATIONS, '20261118000000_funding_source_categories/migration.sql'))
const DOWN = sqlStatements(join(CHECKS, '20261118000000_funding_source_categories.down.sql'))
const ACCEPT_LOSS = "SET LOCAL confluent.accept_funding_sources_loss = 'on'"
// The acceptance lasts for the whole transaction: withdrawn before a revert that must be checked.
const REFUSE_LOSS = "SET LOCAL confluent.accept_funding_sources_loss = 'off'"

class RolledBack extends Error {}

type Tx = Prisma.TransactionClient
const run = async (tx: Tx, statements: string[]) => {
  for (const sql of statements) await tx.$executeRawUnsafe(sql)
}
const rows = (tx: Tx, sql: string) => tx.$queryRawUnsafe<Array<Record<string, unknown>>>(sql)

const failure = (result: PromiseSettledResult<unknown>) => {
  if (result.status === 'fulfilled') return 'fulfilled'
  const err = result.reason as HttpException
  return err instanceof HttpException ? (err.getResponse() as { code: string }).code : String(err)
}

// What the migration creates, comparable: the table's columns, constraints and indexes, and every
// category (ids included: derived from the workspace and the key, the same on every run).
const TABLE = `'funding_source_categories'`
async function fingerprint(tx: Tx): Promise<string> {
  const [row] = await rows(
    tx,
    `SELECT json_build_object(
       'columns', (SELECT json_agg(x ORDER BY x) FROM (
         SELECT column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, '') AS x
         FROM information_schema.columns
         WHERE table_schema = current_schema() AND table_name = ${TABLE}) c),
       'constraints', (SELECT json_agg(x ORDER BY x) FROM (
         SELECT conname || ':' || pg_get_constraintdef(oid) AS x
         FROM pg_constraint WHERE conrelid::regclass::text = ${TABLE}) k),
       'indexes', (SELECT json_agg(indexdef ORDER BY indexdef) FROM pg_indexes
         WHERE schemaname = current_schema() AND tablename = ${TABLE}),
       'categories', (SELECT json_agg(json_build_array(id, workspace_id, key, label, family, position, active)
         ORDER BY workspace_id, position) FROM funding_source_categories)
     )::text AS f`,
  )
  return row.f as string
}

// ROADMAP E06.02 on PostgreSQL: the migration gives every existing workspace D04's categories
// explicitly, survives an interrupted deployment and can be undone (refusing, unless accepted, to
// lose a configuration); the constraints keep keys, labels and families closed; two managers acting
// at the same moment never leave a workspace without an active category nor with a label twice.
describe('funding source categories (PostgreSQL)', () => {
  const prisma = testDatabase()
  const audit = new AuditService(prisma)
  const access = new WorkspaceAccessService(prisma)
  const categories = new FundingSourceCategoriesService(prisma, access, audit)
  const workspacesService = new WorkspacesService(prisma, audit, new MemoryStorageAdapter(), access)
  const tag = randomUUID().slice(0, 8)
  const workspaces: string[] = []
  const admin = { id: '', role: 'admin' }

  beforeAll(async () => {
    const u = await prisma.user.create({
      data: { email: `admin-${tag}@pg-test.dev`, role: 'admin', emailVerifiedAt: new Date() },
    })
    admin.id = u.id
  })

  afterAll(async () => {
    const users = await prisma.user.findMany({
      where: { email: { endsWith: `-${tag}@pg-test.dev` } },
    })
    const ids = users.map((u) => u.id)
    await prisma.auditLog.deleteMany({ where: { actorId: { in: ids } } })
    await prisma.workspace.deleteMany({ where: { id: { in: workspaces } } })
    await prisma.user.deleteMany({ where: { id: { in: ids } } })
    await prisma.$disconnect()
  })

  const rolledBack = (fn: (tx: Tx) => Promise<void>) =>
    expect(
      prisma.$transaction(
        async (tx) => {
          await fn(tx)
          throw new RolledBack()
        },
        { timeout: 180_000 },
      ),
    ).rejects.toThrow(RolledBack)

  // A workspace created as the site creates it (defaults included) and two of its managers.
  async function workspaceWithManagers() {
    const ws = await workspacesService.create(admin, {
      name: 'Structure test',
      slug: `pg-${randomUUID().slice(0, 12)}`,
    })
    workspaces.push(ws.id)
    const managers = []
    for (const name of ['marie', 'jean']) {
      const u = await prisma.user.create({
        data: {
          email: `${name}-${randomUUID().slice(0, 6)}-${tag}@pg-test.dev`,
          role: 'financeur',
          emailVerifiedAt: new Date(),
        },
      })
      await prisma.workspaceMembership.create({
        data: { workspaceId: ws.id, userId: u.id, role: 'conseiller', canManageWorkspace: true },
      })
      managers.push({ id: u.id, role: u.role })
    }
    return { workspaceId: ws.id, managers }
  }

  describe('migration', () => {
    it('backfills D04’s categories for every existing workspace; undone (refusing a configuration loss unless accepted), then applied again', async () => {
      const { workspaceId } = await workspaceWithManagers()
      const created = await prisma.fundingSourceCategory.findMany({
        where: { workspaceId },
        orderBy: { position: 'asc' },
      })
      // Created by the API: the defaults, in order.
      expect(created.map((c) => [c.key, c.label, c.family, c.position, c.active])).toEqual(
        DEFAULT_FUNDING_SOURCE_CATEGORIES.map((c, i) => [c.key, c.label, c.family, i, true]),
      )
      await rolledBack(async (tx) => {
        // As E06.01 leaves it: workspaces without categories.
        await run(tx, DOWN)
        expect(
          await rows(tx, `SELECT to_regclass('funding_source_categories')::text AS t`),
        ).toEqual([{ t: null }])
        await run(tx, UP)
        const [counts] = await rows(
          tx,
          `SELECT (SELECT count(*)::int FROM workspaces) AS workspaces,
                  (SELECT count(*)::int FROM funding_source_categories) AS categories,
                  (SELECT count(*)::int FROM funding_source_categories WHERE NOT active) AS odd`,
        )
        expect(counts).toEqual({
          workspaces: counts.workspaces,
          categories: (counts.workspaces as number) * DEFAULT_FUNDING_SOURCE_CATEGORIES.length,
          odd: 0,
        })
        const backfilled = await rows(
          tx,
          `SELECT key, label, family, position FROM funding_source_categories
           WHERE workspace_id = '${workspaceId}' ORDER BY position`,
        )
        expect(backfilled).toEqual(
          DEFAULT_FUNDING_SOURCE_CATEGORIES.map((c, position) => ({ ...c, position })),
        )
        // Backfilled ids are ids the contracts accept: the site reorders them like any other.
        const ids = await rows(
          tx,
          `SELECT id FROM funding_source_categories WHERE workspace_id = '${workspaceId}' ORDER BY position`,
        )
        expect(
          reorderFundingSourceCategoriesSchema.safeParse({ categoryIds: ids.map((r) => r.id) })
            .success,
        ).toBe(true)
        const migrated = await fingerprint(tx)

        // Nothing configured: undone without acceptance, applied again, the same database.
        await run(tx, DOWN)
        await run(tx, UP)
        expect(await fingerprint(tx)).toEqual(migrated)

        // A category renamed, deactivated, reordered or added: refused unless accepted.
        const w = `WHERE workspace_id = '${workspaceId}'`
        for (const configured of [
          `UPDATE funding_source_categories SET label = 'BPI' ${w} AND key = 'bpifrance'`,
          `UPDATE funding_source_categories SET active = false ${w} AND key = 'fonds_propres'`,
          `UPDATE funding_source_categories SET position = 9 ${w} AND key = 'bpifrance'`,
          `INSERT INTO funding_source_categories (id, workspace_id, key, label, family, position, updated_at)
           VALUES ('${randomUUID()}', '${workspaceId}', 'crowdfunding', 'Crowdfunding', 'autre', 6, now())`,
        ]) {
          await tx.$executeRawUnsafe('SAVEPOINT configured')
          await tx.$executeRawUnsafe(configured)
          await tx.$executeRawUnsafe('SAVEPOINT before_down')
          await expect(run(tx, DOWN)).rejects.toThrow(/would be lost/)
          await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT before_down')
          await run(tx, [ACCEPT_LOSS, ...DOWN, REFUSE_LOSS])
          expect(
            await rows(tx, `SELECT to_regclass('funding_source_categories')::text AS t`),
          ).toEqual([{ t: null }])
          await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT configured')
        }
      })
    })

    it('survives an interrupted deployment: any prefix of the migration, then all of it, gives the same database', async () => {
      await workspaceWithManagers()
      await rolledBack(async (tx) => {
        await run(tx, DOWN)
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
    it('keeps families closed, keys and labels well formed and unique in a workspace, and removes the categories with their workspace', async () => {
      const { workspaceId } = await workspaceWithManagers()
      const insert = (key: string, label: string, family = 'autre', position = 7) =>
        `INSERT INTO funding_source_categories (id, workspace_id, key, label, family, position, updated_at)
         VALUES ('${randomUUID()}', '${workspaceId}', '${key}', '${label}', '${family}', ${position}, now())`
      const refused = (sql: string) =>
        expect(prisma.$transaction((tx) => tx.$executeRawUnsafe(sql))).rejects.toThrow()
      await refused(insert('crowd', 'Crowd', 'crowdfunding'))
      await refused(insert('crowd', 'Crowd', 'business_angels'))
      for (const key of [
        'Crowd',
        'crowd-funding',
        '_crowd',
        'crowd__funding',
        'é',
        'x'.repeat(61),
      ]) {
        await refused(insert(key, 'Crowd'))
      }
      for (const label of ['', ' Crowd', 'Crowd ', 'Crowd\nfunding', 'x'.repeat(81)]) {
        await refused(insert('crowd', label))
      }
      await refused(insert('crowd', 'Crowd', 'autre', -1))
      // Unique key and label in the workspace.
      await refused(insert('bpifrance', 'Autre libellé'))
      await refused(insert('autre_cle', 'Bpifrance'))
      await prisma.$transaction((tx) => tx.$executeRawUnsafe(insert('crowd', 'Crowd')))
      // Another workspace may use the same key and label.
      const other = await workspaceWithManagers()
      await prisma.$transaction((tx) =>
        tx.$executeRawUnsafe(insert('crowd', 'Crowd').replace(workspaceId, other.workspaceId)),
      )
      await prisma.workspace.delete({ where: { id: workspaceId } })
      expect(await prisma.fundingSourceCategory.count({ where: { workspaceId } })).toBe(0)
      expect(
        await prisma.fundingSourceCategory.count({ where: { workspaceId: other.workspaceId } }),
      ).toBe(7)
    })
  })

  describe('concurrency', () => {
    it('never lets two managers deactivate the last two active categories at the same moment', async () => {
      for (let round = 0; round < 3; round++) {
        const { workspaceId, managers } = await workspaceWithManagers()
        const list = await categories.list(managers[0], workspaceId)
        for (const c of list.slice(2)) {
          await categories.update(managers[0], workspaceId, c.id, { active: false })
        }
        const results = await Promise.allSettled([
          categories.update(managers[0], workspaceId, list[0].id, { active: false }),
          categories.update(managers[1], workspaceId, list[1].id, { active: false }),
        ])
        expect(results.map(failure).sort()).toEqual(['FUNDING_SOURCE_LAST_ACTIVE', 'fulfilled'])
        expect(
          await prisma.fundingSourceCategory.count({ where: { workspaceId, active: true } }),
        ).toBe(1)
      }
    })

    it('creates a label once when two managers add it at the same moment, each at its own position', async () => {
      for (let round = 0; round < 3; round++) {
        const { workspaceId, managers } = await workspaceWithManagers()
        const results = await Promise.allSettled([
          categories.create(managers[0], workspaceId, { label: 'Crowdfunding', family: 'autre' }),
          categories.create(managers[1], workspaceId, { label: 'crowdfunding', family: 'autre' }),
          categories.create(managers[1], workspaceId, {
            label: 'Région',
            family: 'aides_publiques',
          }),
        ])
        expect(results.map(failure).sort()).toEqual([
          'FUNDING_SOURCE_LABEL_TAKEN',
          'fulfilled',
          'fulfilled',
        ])
        const rowsOf = await prisma.fundingSourceCategory.findMany({ where: { workspaceId } })
        expect(rowsOf).toHaveLength(8)
        expect(new Set(rowsOf.map((c) => c.position)).size).toBe(8)
      }
    })
  })
})
