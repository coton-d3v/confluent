import { randomUUID } from 'node:crypto'
import { HttpException } from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import { DEFAULT_PUBLIC_PAGE_BLOCKS, type PublicPageBlock } from '@confluent/shared'
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
import { workspacePageBlocksDown, workspacePageBlocksUp } from './sql-file'

const UP = workspacePageBlocksUp()
// Without the acceptance: what an operator runs first.
const DOWN = workspacePageBlocksDown().slice(1)
const ACCEPT_LOSS = "SET LOCAL confluent.accept_workspace_page_blocks_loss = 'on'"
// The acceptance lasts for the whole transaction: withdrawn before a revert that must be checked.
const REFUSE_LOSS = "SET LOCAL confluent.accept_workspace_page_blocks_loss = 'off'"

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

// ROADMAP E09.04 on PostgreSQL: the migration gives every workspace E09.01's page (every block, in
// its order), survives an interrupted deployment and can be undone (refusing, unless accepted, to
// lose a choice of blocks, which the earlier application would show again); its constraint keeps the
// blocks to the closed catalogue, each at most once; the public reads the blocks stored, in their
// order, by the same projection as the preview; the managers' choices are serialised on the
// workspace, from the version read, and refused to a manager who lost the right while waiting (R53).
describe('workspace public page blocks (PostgreSQL)', () => {
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
    it('gives every workspace E09.01’s page; undone (refusing to lose a choice of blocks unless accepted), then applied again', async () => {
      const { workspace, managers } = await managedWorkspace()
      const other = await managedWorkspace()
      expect((await stored(workspace.id)).publicPageBlocks).toEqual([...DEFAULT_PUBLIC_PAGE_BLOCKS])
      await pages.update(managers[0], workspace.id, { ...PAGE, blocks: ['contact'], version: 1 })
      await rolledBack(async (tx) => {
        const kept = `SELECT id, slug, name, presentation, public_page_published, public_criteria,
                      public_contact, public_page_version FROM workspaces
                      WHERE id IN ('${workspace.id}', '${other.workspace.id}') ORDER BY id`
        const before = await rows(tx, kept)
        const counts = `SELECT (SELECT count(*)::int FROM workspaces) AS workspaces,
                  (SELECT count(*)::int FROM audit_log) AS journal`
        const [countsBefore] = await rows(tx, counts)

        // A choice of blocks: refused unless accepted — fewer blocks, more, or another order.
        for (const blocks of [`'{contact}'`, `'{}'`, `'{contact,criteria,presentation}'`]) {
          await tx.$executeRawUnsafe(
            `UPDATE workspaces SET public_page_blocks = ${blocks} WHERE id = '${workspace.id}'`,
          )
          await tx.$executeRawUnsafe('SAVEPOINT before_down')
          await expect(run(tx, DOWN)).rejects.toThrow(/would be lost/)
          await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT before_down')
        }

        await run(tx, [ACCEPT_LOSS, ...DOWN, REFUSE_LOSS])
        expect(
          await rows(
            tx,
            `SELECT count(*)::int AS n FROM information_schema.columns
             WHERE table_schema = current_schema() AND table_name = 'workspaces'
               AND column_name = 'public_page_blocks'`,
          ),
        ).toEqual([{ n: 0 }])
        // The workspaces, their page's other settings and the journal stay.
        expect(await rows(tx, kept)).toEqual(before)
        expect((await rows(tx, counts))[0]).toEqual(countsBefore)

        // Applied again: every page is E09.01's.
        await run(tx, UP)
        const migrated = await fingerprint(tx)
        expect(await rows(tx, kept)).toEqual(before)
        expect(
          await rows(
            tx,
            `SELECT count(*)::int AS n FROM workspaces
             WHERE public_page_blocks IS DISTINCT FROM
                   '{presentation,criteria,committees,cards,apply,participate,contact}'::text[]`,
          ),
        ).toEqual([{ n: 0 }])
        // Every page E09.01's: undone without acceptance, applied again, the same.
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
    it('keeps the blocks to the closed catalogue, each at most once, never null', async () => {
      const { workspace } = await managedWorkspace()
      // The constraint as this migration file writes it.
      await rolledBack(async (tx) => {
        await run(tx, [ACCEPT_LOSS, ...DOWN, REFUSE_LOSS, ...UP])
        const set = (value: string) =>
          tx.$executeRawUnsafe(
            `UPDATE workspaces SET public_page_blocks = ${value} WHERE id = '${workspace.id}'`,
          )
        for (const value of [
          'NULL',
          `'{texte-libre}'`,
          `'{Contact}'`,
          `'{contact,cards,contact}'`,
          `ARRAY['contact', NULL]`,
          `'{{contact,cards}}'`,
          `'{presentation,criteria,committees,cards,apply,participate,contact,presentation}'`,
        ]) {
          await tx.$executeRawUnsafe('SAVEPOINT attempt')
          expect([value, await set(value).catch((e: Error) => e.message)]).toEqual([
            value,
            expect.stringMatching(/constraint|multidimensional|23514/),
          ])
          await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT attempt')
        }
        for (const value of [
          `'{}'`,
          `'{contact}'`,
          `'{contact,participate,apply,cards,committees,criteria,presentation}'`,
        ]) {
          expect([value, await set(value)]).toEqual([value, 1])
        }
      })
    })
  })

  describe('reading', () => {
    it('shows the stored blocks in their order, by the same projection as the preview', async () => {
      const { workspace, managers } = await managedWorkspace()
      const blocks: PublicPageBlock[] = ['contact', 'criteria', 'committees']
      const saved = await pages.update(managers[0], workspace.id, { ...PAGE, blocks, version: 1 })
      expect((await stored(workspace.id)).publicPageBlocks).toEqual(blocks)
      const page = await pages.publicPage(workspace.slug)
      expect(JSON.parse(JSON.stringify(page))).toEqual(JSON.parse(JSON.stringify(saved.preview)))
      // No session offered: the committees block has nothing to show; no presentation block.
      expect(page.blocks).toEqual(['contact', 'criteria'])
      expect(page.workspace.presentation).toBeNull()
      expect(saved.content.workspace.presentation).toBe('Présentation de la structure.')
    })
  })

  describe('concurrency', () => {
    it('lets one of two managers ordering the blocks from the same version through; the other gets 409, versions never reused', async () => {
      const { workspace, managers } = await managedWorkspace(2)
      const choices: PublicPageBlock[][] = [
        ['contact', 'presentation'],
        ['cards', 'criteria', 'contact'],
      ]
      const results = await Promise.all(
        managers.map((m, i) =>
          status(pages.update(m, workspace.id, { ...PAGE, blocks: choices[i], version: 1 })),
        ),
      )
      expect([...results].sort()).toEqual([409, 'fulfilled'])
      const winner = results.indexOf('fulfilled')
      const row = await stored(workspace.id)
      expect([row.publicPageBlocks, row.publicPageVersion]).toEqual([choices[winner], 2])
      const entries = await prisma.auditLog.findMany({
        where: { actionType: 'workspace_updated', actorId: { in: managers.map((m) => m.id) } },
      })
      expect(entries.map((e) => [e.actorId, e.metadata])).toEqual([
        [
          managers[winner].id,
          {
            workspaceId: workspace.id,
            changes: ['publicPagePublished', 'publicCriteria', 'publicContact', 'publicPageBlocks'],
            publicPageVersion: 2,
            publicPagePublished: { from: false, to: true },
            publicPageBlocks: { from: [...DEFAULT_PUBLIC_PAGE_BLOCKS], to: choices[winner] },
          },
        ],
      ])

      // The loser reads again and orders from the new version; the next stale write is refused.
      const fresh = await pages.settings(managers[1 - winner], workspace.id)
      expect(fresh).toMatchObject({ blocks: choices[winner], version: 2 })
      await pages.update(managers[1 - winner], workspace.id, {
        ...PAGE,
        blocks: choices[1 - winner],
        version: fresh.version,
      })
      expect(
        await status(
          pages.update(managers[winner], workspace.id, { ...PAGE, blocks: [], version: 2 }),
        ),
      ).toBe(409)
      const last = await stored(workspace.id)
      expect([last.publicPageBlocks, last.publicPageVersion]).toEqual([choices[1 - winner], 3])
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

    it('orders nothing for a manager deprived of the right while waiting for the workspace (R53)', async () => {
      const { workspace, managers } = await managedWorkspace()
      const [marie] = managers
      expect(
        await revokedWhileWaiting(
          workspace.id,
          () => pages.update(marie, workspace.id, { ...PAGE, blocks: ['contact'], version: 1 }),
          (tx) =>
            tx.workspaceMembership.update({
              where: { id: marie.membershipId },
              data: { canManageWorkspace: false },
            }),
        ),
      ).toBe(403)
      const row = await stored(workspace.id)
      expect([row.publicPageBlocks, row.publicPageVersion]).toEqual([
        [...DEFAULT_PUBLIC_PAGE_BLOCKS],
        1,
      ])
    })
  })
})
