import { randomUUID } from 'node:crypto'
import { HttpException } from '@nestjs/common'
import { Prisma as PrismaNamespace, type Prisma } from '@prisma/client'
import { WORKSPACE_PAGE_LIMITS } from '@confluent/shared'
import { AuditService } from '../../src/modules/audit/audit.service'
import { MemoryStorageAdapter } from '../../src/modules/documents/storage/memory-storage.adapter'
import { WORKSPACE_COLUMN_AUDIENCE } from '../../src/modules/workspace-pages/workspace-page-views'
import { WorkspacePagesService } from '../../src/modules/workspace-pages/workspace-pages.service'
import { WorkspaceAccessService } from '../../src/modules/workspaces/workspace-access'
import { testDatabase } from './database'
import { CHECKS, MIGRATIONS, sqlStatements } from './sql-file'
import { join } from 'node:path'

const UP = sqlStatements(join(MIGRATIONS, '20261207000000_workspace_public_page/migration.sql'))
// Without the acceptance: what an operator runs first.
const DOWN = sqlStatements(join(CHECKS, '20261207000000_workspace_public_page.down.sql'))
const ACCEPT_LOSS = "SET LOCAL confluent.accept_workspace_public_page_loss = 'on'"
// The acceptance lasts for the whole transaction: withdrawn before a revert that must be checked.
const REFUSE_LOSS = "SET LOCAL confluent.accept_workspace_public_page_loss = 'off'"

class RolledBack extends Error {}

type Tx = Prisma.TransactionClient
const run = async (tx: Tx, statements: string[]) => {
  for (const sql of statements) await tx.$executeRawUnsafe(sql)
}
const rows = (tx: Tx, sql: string) => tx.$queryRawUnsafe<Array<Record<string, unknown>>>(sql)

const PAGE = {
  published: true,
  criteria: 'Entreprises innovantes.\n\nMoins de 5 ans.',
  contact: 'vitrine@cci-touraine.fr',
}

// What the migration changes, comparable: the workspaces' columns, constraints and rows.
async function fingerprint(tx: Tx): Promise<string> {
  const [row] = await rows(
    tx,
    `SELECT json_build_object(
       'columns', (SELECT json_agg(x ORDER BY x) FROM (
         SELECT column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, '') AS x
         FROM information_schema.columns
         WHERE table_schema = current_schema() AND table_name = 'workspaces') c),
       'constraints', (SELECT json_agg(x ORDER BY x) FROM (
         SELECT conname || ':' || pg_get_constraintdef(oid) AS x
         FROM pg_constraint WHERE conrelid::regclass::text = 'workspaces') k),
       'workspaces', (SELECT json_agg(to_jsonb(w) ORDER BY id) FROM workspaces w)
     )::text AS f`,
  )
  return row.f as string
}

// ROADMAP E09.01 on PostgreSQL: the migration adds the public page closed by default to every
// workspace, survives an interrupted deployment and can be undone (refusing, unless accepted, to lose
// a published page or its texts); its constraints keep the texts plain and bounded; every column of
// the table is classified public or internal; the managers' writes are serialised on the workspace,
// from the version read, and refused to a manager who lost the right while waiting (R53).
describe('workspace public page (PostgreSQL)', () => {
  const prisma = testDatabase()
  const audit = new AuditService(prisma)
  const access = new WorkspaceAccessService(prisma)
  const pages = new WorkspacePagesService(prisma, access, audit, new MemoryStorageAdapter())
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

  async function managedWorkspace(count = 1) {
    const ws = await prisma.workspace.create({
      data: { slug: `pg-${randomUUID().slice(0, 12)}`, name: 'Structure test' },
    })
    workspaces.push(ws.id)
    const managers = []
    for (let i = 0; i < count; i++) {
      const user = await prisma.user.create({
        data: { email: `m${i}-${randomUUID().slice(0, 8)}-${tag}@pg-test.dev`, role: 'financeur' },
      })
      users.push(user.id)
      const membership = await prisma.workspaceMembership.create({
        data: { workspaceId: ws.id, userId: user.id, role: 'conseiller', canManageWorkspace: true },
      })
      managers.push({ id: user.id, role: 'financeur', membershipId: membership.id })
    }
    return { workspace: ws, managers }
  }

  const status = (p: Promise<unknown>) =>
    p.then(
      () => 'fulfilled' as const,
      (err: unknown) => {
        if (err instanceof HttpException) return err.getStatus()
        throw err
      },
    )

  describe('migration', () => {
    it('adds the page unpublished and empty to every workspace; undone (refusing to lose a page unless accepted), then applied again', async () => {
      const { workspace, managers } = await managedWorkspace()
      const other = await managedWorkspace()
      await pages.update(managers[0], workspace.id, { ...PAGE, version: 1 })
      await rolledBack(async (tx) => {
        const kept = `SELECT id, slug, name, presentation, contact_email, logo_key FROM workspaces
                      WHERE id IN ('${workspace.id}', '${other.workspace.id}') ORDER BY id`
        const before = await rows(tx, kept)
        const counts = `SELECT (SELECT count(*)::int FROM workspaces) AS workspaces,
                  (SELECT count(*)::int FROM audit_log) AS journal`
        const [countsBefore] = await rows(tx, counts)

        // A published page with texts: refused unless accepted.
        await tx.$executeRawUnsafe('SAVEPOINT before_down')
        await expect(run(tx, DOWN)).rejects.toThrow(/would be lost/)
        await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT before_down')
        // Unpublished but with a contact (or criteria): still refused.
        await tx.$executeRawUnsafe(
          `UPDATE workspaces SET public_page_published = false, public_criteria = NULL
           WHERE id = '${workspace.id}'`,
        )
        await tx.$executeRawUnsafe('SAVEPOINT unpublished')
        await expect(run(tx, DOWN)).rejects.toThrow(/would be lost/)
        await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT unpublished')

        await run(tx, [ACCEPT_LOSS, ...DOWN, REFUSE_LOSS])
        expect(
          await rows(
            tx,
            `SELECT count(*)::int AS n FROM information_schema.columns
             WHERE table_schema = current_schema() AND table_name = 'workspaces'
               AND column_name LIKE 'public_%'`,
          ),
        ).toEqual([{ n: 0 }])
        // The workspaces, their other settings and the journal stay.
        expect(await rows(tx, kept)).toEqual(before)
        expect((await rows(tx, counts))[0]).toEqual(countsBefore)

        await run(tx, UP)
        const migrated = await fingerprint(tx)
        expect(await rows(tx, kept)).toEqual(before)
        expect(
          await rows(
            tx,
            `SELECT count(*)::int AS n FROM workspaces
             WHERE public_page_published OR public_criteria IS NOT NULL
                OR public_contact IS NOT NULL OR public_page_version <> 1`,
          ),
        ).toEqual([{ n: 0 }])
        // Every page closed and empty: undone without acceptance, applied again, the same.
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
    it('keeps the criteria and the contact plain, trimmed and bounded, and the version positive', async () => {
      const { workspace } = await managedWorkspace()
      // The constraints as this migration file writes them.
      await rolledBack(async (tx) => {
        await run(tx, [ACCEPT_LOSS, ...DOWN, REFUSE_LOSS, ...UP])
        const set = (column: string, value: string) =>
          tx.$executeRawUnsafe(
            `UPDATE workspaces SET ${column} = ${value} WHERE id = '${workspace.id}'`,
          )
        const refused: Array<[string, string]> = [
          ['public_page_version', '0'],
          ['public_page_published', 'NULL'],
          ['public_page_version', 'NULL'],
        ]
        for (const [column, max] of [
          ['public_criteria', WORKSPACE_PAGE_LIMITS.criteria],
          ['public_contact', WORKSPACE_PAGE_LIMITS.contact],
        ] as const) {
          for (const value of [
            `''`,
            `E'Texte\\n'`,
            `' Texte'`,
            `E'Un\\n\\n\\nDeux'`,
            `E'Un\\tDeux'`,
            `'Voir <a href="x">ceci</a>'`,
            `'${'x'.repeat(max + 1)}'`,
          ]) {
            refused.push([column, value])
          }
        }
        for (const [column, value] of refused) {
          await tx.$executeRawUnsafe('SAVEPOINT attempt')
          expect([
            column,
            value.slice(0, 40),
            await set(column, value).catch((e: Error) => e.message),
          ]).toEqual([column, value.slice(0, 40), expect.stringMatching(/constraint|23502/)])
          await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT attempt')
        }
        for (const [column, max] of [
          ['public_criteria', WORKSPACE_PAGE_LIMITS.criteria],
          ['public_contact', WORKSPACE_PAGE_LIMITS.contact],
        ] as const) {
          for (const value of [
            'NULL',
            `E'Écrivez-nous :\\n\\n02 47 00 00 00 — vitrine@cci.fr (< 48 h)'`,
            `'${'x'.repeat(max)}'`,
          ]) {
            expect(await set(column, value)).toBe(1)
          }
        }
        expect(await set('public_page_version', '2147483647')).toBe(1)
      })
    })
  })

  describe('audiences', () => {
    it('classifies every column of the table as public or internal', async () => {
      const model = PrismaNamespace.dmmf.datamodel.models.find((m) => m.name === 'Workspace')!
      const classified = Object.keys(WORKSPACE_COLUMN_AUDIENCE)
        .map((field) => {
          const column = model.fields.find((f) => f.name === field)!
          return column.dbName ?? column.name
        })
        .sort()
      const columns = await prisma.$queryRawUnsafe<Array<{ column_name: string }>>(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = current_schema() AND table_name = 'workspaces' ORDER BY column_name`,
      )
      expect(columns.map((c) => c.column_name)).toEqual(classified)
    })

    it('shows a stored page only once published, by the same projection as its preview', async () => {
      const { workspace, managers } = await managedWorkspace()
      await expect(pages.publicPage(workspace.slug)).rejects.toThrow(/Aucune page publique/)
      const saved = await pages.update(managers[0], workspace.id, { ...PAGE, version: 1 })
      const page = await pages.publicPage(workspace.slug)
      expect(JSON.parse(JSON.stringify(page))).toEqual(JSON.parse(JSON.stringify(saved.preview)))
      expect(page.workspace).toMatchObject({ criteria: PAGE.criteria, contact: PAGE.contact })
      expect(JSON.stringify(page)).not.toContain(workspace.id)
    })
  })

  describe('concurrency', () => {
    it('lets one of two managers writing from the same version through; the other gets 409, versions never reused', async () => {
      const { workspace, managers } = await managedWorkspace(2)
      const results = await Promise.all(
        managers.map((m, i) =>
          status(pages.update(m, workspace.id, { ...PAGE, contact: `Contact ${i}`, version: 1 })),
        ),
      )
      expect(results.sort()).toEqual([409, 'fulfilled'])
      const stored = await prisma.workspace.findUniqueOrThrow({ where: { id: workspace.id } })
      expect(stored.publicPageVersion).toBe(2)
      const entries = await prisma.auditLog.findMany({
        where: { actionType: 'workspace_updated', actorId: { in: managers.map((m) => m.id) } },
      })
      expect(
        entries.map((e) => (e.metadata as { publicPageVersion: number }).publicPageVersion),
      ).toEqual([2])
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
          result = status(attempt())
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
      const { workspace, managers } = await managedWorkspace(2)
      const [marie, luc] = managers
      expect(
        await revokedWhileWaiting(
          workspace.id,
          () => pages.update(marie, workspace.id, { ...PAGE, version: 1 }),
          (tx) =>
            tx.workspaceMembership.update({
              where: { id: marie.membershipId },
              data: { canManageWorkspace: false },
            }),
        ),
      ).toBe(403)
      expect(
        await revokedWhileWaiting(
          workspace.id,
          () => pages.update(luc, workspace.id, { ...PAGE, version: 1 }),
          (tx) =>
            tx.workspaceMembership.update({
              where: { id: luc.membershipId },
              data: { deactivatedAt: new Date() },
            }),
        ),
      ).toBe(404)
      const stored = await prisma.workspace.findUniqueOrThrow({ where: { id: workspace.id } })
      expect([stored.publicPagePublished, stored.publicContact, stored.publicPageVersion]).toEqual([
        false,
        null,
        1,
      ])
    })
  })
})
