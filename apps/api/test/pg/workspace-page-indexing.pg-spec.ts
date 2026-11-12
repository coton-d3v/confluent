import { randomUUID } from 'node:crypto'
import { HttpException } from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import { AnswerSourcesService } from '../../src/modules/answers/answer-sources.service'
import { AuditService } from '../../src/modules/audit/audit.service'
import { CandidaturesService } from '../../src/modules/candidatures/candidatures.service'
import type { ClassificationService } from '../../src/modules/classification/classification.service'
import { CompaniesService } from '../../src/modules/companies/companies.service'
import type { DocumentsService } from '../../src/modules/documents/documents.service'
import { MemoryStorageAdapter } from '../../src/modules/documents/storage/memory-storage.adapter'
import { DossiersService } from '../../src/modules/dossiers/dossiers.service'
import { QuestionnairesService } from '../../src/modules/questionnaires/questionnaires.service'
import { ShowcaseCardsService } from '../../src/modules/showcase-cards/showcase-cards.service'
import { WorkspacePagesService } from '../../src/modules/workspace-pages/workspace-pages.service'
import { WorkspaceAccessService } from '../../src/modules/workspaces/workspace-access'
import { testDatabase } from './database'
import { workspacePageIndexingDown, workspacePageIndexingUp } from './sql-file'

const UP = workspacePageIndexingUp()
// Without the acceptance: what an operator runs first.
const DOWN = workspacePageIndexingDown().slice(1)
const ACCEPT_LOSS = "SET LOCAL confluent.accept_workspace_page_indexing_loss = 'on'"
// The acceptance lasts for the whole transaction: withdrawn before a revert that must be checked.
const REFUSE_LOSS = "SET LOCAL confluent.accept_workspace_page_indexing_loss = 'off'"

class RolledBack extends Error {}

type Tx = Prisma.TransactionClient
const run = async (tx: Tx, statements: string[]) => {
  for (const sql of statements) await tx.$executeRawUnsafe(sql)
}
const rows = (tx: Tx, sql: string) => tx.$queryRawUnsafe<Array<Record<string, unknown>>>(sql)

const PAGE = { published: true, criteria: 'Entreprises innovantes.', contact: 'vitrine@cci.fr' }

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

// ROADMAP E09.06 on PostgreSQL: the migration closes every page to search engines, survives an
// interrupted deployment and can be undone (refusing, unless accepted, to lose a page its managers
// opened to indexing); the public reads whether a published page is indexable by the same projection
// as the preview, never for an unpublished page; the managers' choices are serialised on the
// workspace, from the version read, and refused to a manager who lost the right while waiting (R53).
describe('workspace public page indexing (PostgreSQL)', () => {
  const prisma = testDatabase()
  const audit = new AuditService(prisma)
  const access = new WorkspaceAccessService(prisma)
  const questionnaires = new QuestionnairesService(prisma)
  const dossiers = new DossiersService(
    prisma,
    questionnaires,
    { evaluate: () => Promise.resolve(null) } as unknown as ClassificationService,
    audit,
    new CompaniesService(prisma),
  )
  const candidatures = new CandidaturesService(
    prisma,
    dossiers,
    access,
    questionnaires,
    new AnswerSourcesService(prisma, {} as DocumentsService),
    audit,
  )
  const pages = new WorkspacePagesService(
    prisma,
    access,
    audit,
    new MemoryStorageAdapter(),
    new ShowcaseCardsService(prisma, candidatures, dossiers, audit, access),
  )
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
      data: {
        slug: `pg-${randomUUID().slice(0, 12)}`,
        name: 'Structure test',
        presentation: 'Présentation de la structure.',
      },
    })
    workspaces.push(ws.id)
    const managers = []
    for (let i = 0; i < count; i++) {
      const user = await prisma.user.create({
        data: { email: `b${i}-${randomUUID().slice(0, 8)}-${tag}@pg-test.dev`, role: 'financeur' },
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

  const stored = async (workspaceId: string) =>
    prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } })

  describe('migration', () => {
    it('closes every page to search engines; undone (refusing to lose an opening unless accepted), then applied again', async () => {
      const { workspace, managers } = await managedWorkspace()
      const other = await managedWorkspace()
      expect((await stored(workspace.id)).publicPageIndexable).toBe(false)
      await pages.update(managers[0], workspace.id, { ...PAGE, indexable: true, version: 1 })
      await rolledBack(async (tx) => {
        const kept = `SELECT id, slug, name, presentation, public_page_published, public_criteria,
                      public_contact, public_page_version, public_page_blocks FROM workspaces
                      WHERE id IN ('${workspace.id}', '${other.workspace.id}') ORDER BY id`
        const before = await rows(tx, kept)
        const counts = `SELECT (SELECT count(*)::int FROM workspaces) AS workspaces,
                  (SELECT count(*)::int FROM audit_log) AS journal`
        const [countsBefore] = await rows(tx, counts)

        // A page opened to indexing, published or not: refused unless accepted.
        for (const published of [true, false]) {
          await tx.$executeRawUnsafe(
            `UPDATE workspaces SET public_page_published = ${published} WHERE id = '${workspace.id}'`,
          )
          await tx.$executeRawUnsafe('SAVEPOINT before_down')
          await expect(run(tx, DOWN)).rejects.toThrow(/would be lost/)
          await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT before_down')
        }
        await tx.$executeRawUnsafe(
          `UPDATE workspaces SET public_page_published = true WHERE id = '${workspace.id}'`,
        )

        await run(tx, [ACCEPT_LOSS, ...DOWN, REFUSE_LOSS])
        expect(
          await rows(
            tx,
            `SELECT count(*)::int AS n FROM information_schema.columns
             WHERE table_schema = current_schema() AND table_name = 'workspaces'
               AND column_name = 'public_page_indexable'`,
          ),
        ).toEqual([{ n: 0 }])
        // The workspaces, their page's other settings and the journal stay.
        expect(await rows(tx, kept)).toEqual(before)
        expect((await rows(tx, counts))[0]).toEqual(countsBefore)

        // Applied again: every page closed.
        await run(tx, UP)
        const migrated = await fingerprint(tx)
        expect(await rows(tx, kept)).toEqual(before)
        expect(
          await rows(tx, `SELECT count(*)::int AS n FROM workspaces WHERE public_page_indexable`),
        ).toEqual([{ n: 0 }])
        // Every page closed: undone without acceptance, applied again, the same.
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

    it('never leaves a page without an answer: not null', async () => {
      const { workspace } = await managedWorkspace()
      await rolledBack(async (tx) => {
        await tx.$executeRawUnsafe('SAVEPOINT attempt')
        await expect(
          tx.$executeRawUnsafe(
            `UPDATE workspaces SET public_page_indexable = NULL WHERE id = '${workspace.id}'`,
          ),
        ).rejects.toThrow(/null|23502/)
        await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT attempt')
      })
    })
  })

  describe('reading', () => {
    it('tells the public a page is indexable only once published, by the same projection as the preview', async () => {
      const { workspace, managers } = await managedWorkspace()
      const allowed = await pages.update(managers[0], workspace.id, {
        ...PAGE,
        published: false,
        indexable: true,
        version: 1,
      })
      expect(allowed).toMatchObject({ indexable: true, preview: { indexable: true } })
      expect(await status(pages.publicPage(workspace.slug))).toBe(404)
      const saved = await pages.update(managers[0], workspace.id, {
        ...PAGE,
        version: allowed.version,
      })
      const page = await pages.publicPage(workspace.slug)
      expect(JSON.parse(JSON.stringify(page))).toEqual(JSON.parse(JSON.stringify(saved.preview)))
      expect(page.indexable).toBe(true)
      const closed = await pages.update(managers[0], workspace.id, {
        ...PAGE,
        indexable: false,
        version: saved.version,
      })
      expect((await pages.publicPage(workspace.slug)).indexable).toBe(false)
      expect(closed.version).toBe(saved.version + 1)
    })
  })

  describe('concurrency', () => {
    it('lets one of two managers changing the indexing from the same version through; the other gets 409, versions never reused', async () => {
      const { workspace, managers } = await managedWorkspace(2)
      const published = await pages.update(managers[0], workspace.id, { ...PAGE, version: 1 })
      const choices = [true, false]
      const results = await Promise.all(
        managers.map((m, i) =>
          status(
            pages.update(m, workspace.id, {
              ...PAGE,
              criteria: i === 0 ? 'Critères A.' : 'Critères B.',
              indexable: choices[i],
              version: published.version,
            }),
          ),
        ),
      )
      expect([...results].sort()).toEqual([409, 'fulfilled'])
      const winner = results.indexOf('fulfilled')
      const row = await stored(workspace.id)
      expect([row.publicPageIndexable, row.publicPageVersion]).toEqual([
        choices[winner],
        published.version + 1,
      ])
      // One entry for the version written, by the winner; none for the refused write.
      const entries = await prisma.auditLog.findMany({
        where: { actionType: 'workspace_updated', actorId: { in: managers.map((m) => m.id) } },
      })
      const written = entries.filter(
        (e) => (e.metadata as { publicPageVersion: number }).publicPageVersion > published.version,
      )
      expect(written.map((e) => [e.actorId, e.metadata])).toEqual([
        [
          managers[winner].id,
          {
            workspaceId: workspace.id,
            changes: ['publicCriteria', ...(choices[winner] ? ['publicPageIndexable'] : [])],
            publicPageVersion: published.version + 1,
            ...(choices[winner] ? { publicPageIndexable: { from: false, to: true } } : {}),
          },
        ],
      ])
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

    it('opens nothing for a manager deprived of the right while waiting for the workspace (R53)', async () => {
      const { workspace, managers } = await managedWorkspace()
      const [marie] = managers
      expect(
        await revokedWhileWaiting(
          workspace.id,
          () => pages.update(marie, workspace.id, { ...PAGE, indexable: true, version: 1 }),
          (tx) =>
            tx.workspaceMembership.update({
              where: { id: marie.membershipId },
              data: { canManageWorkspace: false },
            }),
        ),
      ).toBe(403)
      const row = await stored(workspace.id)
      expect([row.publicPageIndexable, row.publicPagePublished, row.publicPageVersion]).toEqual([
        false,
        false,
        1,
      ])
    })
  })
})
