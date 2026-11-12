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
import { PoolPublicationsService } from '../../src/modules/pool-publications/pool-publications.service'
import { QuestionnairesService } from '../../src/modules/questionnaires/questionnaires.service'
import { WorkspaceAccessService } from '../../src/modules/workspaces/workspace-access'
import { WorkspacesService } from '../../src/modules/workspaces/workspaces.service'
import { testDatabase } from './database'
import { poolPublicationsDown, poolPublicationsUp } from './sql-file'
import { quietNotifications } from '../../src/testing/notifications'

const UP = poolPublicationsUp()
// Without the acceptance: what an operator runs first.
const DOWN = poolPublicationsDown().slice(1)
const ACCEPT_LOSS = "SET LOCAL confluent.accept_pool_publications_loss = 'on'"
// The acceptance lasts for the whole transaction: withdrawn before a revert that must be checked.
const REFUSE_LOSS = "SET LOCAL confluent.accept_pool_publications_loss = 'off'"

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

// What the migration creates, comparable: the table's columns, constraints, indexes and rows.
async function fingerprint(tx: Tx): Promise<string> {
  const [row] = await rows(
    tx,
    `SELECT json_build_object(
       'columns', (SELECT json_agg(x ORDER BY x) FROM (
         SELECT column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, '') AS x
         FROM information_schema.columns
         WHERE table_schema = current_schema() AND table_name = 'pool_publications') c),
       'constraints', (SELECT json_agg(x ORDER BY x) FROM (
         SELECT conname || ':' || pg_get_constraintdef(oid) AS x
         FROM pg_constraint WHERE conrelid::regclass::text = 'pool_publications') k),
       'indexes', (SELECT json_agg(indexdef ORDER BY indexdef) FROM pg_indexes
         WHERE schemaname = current_schema() AND tablename = 'pool_publications'),
       'publications', (SELECT json_agg(to_jsonb(p) ORDER BY id) FROM pool_publications p)
     )::text AS f`,
  )
  return row.f as string
}

// ROADMAP E07.02 on PostgreSQL: the migration adds the pool publications without touching anything
// else, survives an interrupted deployment and can be undone (refusing, unless accepted, to lose a
// publication or its journal); the constraints keep a publication in its candidature's workspace,
// one per candidature, its level and withdrawal coherent. Under the request's lock, a publication
// never slips past an archiving, simultaneous changes of one publication each journal what they
// applied, and withdrawing from one workspace never touches another's.
describe('pool publications (PostgreSQL)', () => {
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
    quietNotifications(prisma),
  )
  const pool = new PoolPublicationsService(prisma, candidatures, dossiers, audit)
  const workspacesService = new WorkspacesService(prisma, audit, new MemoryStorageAdapter(), access)
  const tag = randomUUID().slice(0, 8)
  const workspaces: string[] = []
  const forms: string[] = []
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
    // Their requests take the candidatures and pool publications with them.
    await prisma.dossier.deleteMany({ where: { userId: { in: ids } } })
    await prisma.company.deleteMany({ where: { ownerId: { in: ids } } })
    await prisma.questionnaireVersion.deleteMany({ where: { questionnaireId: { in: forms } } })
    await prisma.questionnaire.deleteMany({ where: { id: { in: forms } } })
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

  const account = (name: string) =>
    prisma.user.create({
      data: {
        email: `${name}-${randomUUID().slice(0, 6)}-${tag}@pg-test.dev`,
        role: 'entrepreneur',
        emailVerifiedAt: new Date(),
      },
    })

  // A workspace created as the site creates it, receiving candidatures.
  async function openWorkspace(): Promise<string> {
    const ws = await workspacesService.create(admin, {
      name: 'Structure test',
      slug: `pg-${randomUUID().slice(0, 12)}`,
    })
    workspaces.push(ws.id)
    const form = await prisma.questionnaire.create({
      data: {
        slug: `pg-form-${randomUUID().slice(0, 12)}`,
        name: 'Formulaire',
        workspaceId: ws.id,
        usage: 'candidature',
      },
    })
    forms.push(form.id)
    await prisma.questionnaireVersion.create({
      data: { questionnaireId: form.id, version: 1, status: 'published', publishedAt: new Date() },
    })
    return ws.id
  }

  // An entrepreneur's request, published, sent to two workspaces.
  async function presented() {
    const [a, b] = [await openWorkspace(), await openWorkspace()]
    const sophie = await account('sophie')
    const dossier = await dossiers.create({
      owner: { id: sophie.id, role: sophie.role },
      name: 'Biosensio',
    })
    await prisma.dossier.update({
      where: { id: dossier.id },
      data: { submittedAt: new Date(), publicationStatus: 'published', publishedAt: new Date() },
    })
    const send = async (workspaceId: string) => {
      const created = await candidatures.create(dossier.id, sophie.id, workspaceId)
      await candidatures.submit(created.id, sophie.id)
      return created.id
    }
    return {
      sophie: sophie.id,
      dossierId: dossier.id,
      a: { workspaceId: a, candidatureId: await send(a) },
      b: { workspaceId: b, candidatureId: await send(b) },
    }
  }

  const consent = (accessLevel: 'public' | 'partiel' | 'complet') =>
    ({ accessLevel, consent: true }) as const

  describe('migration', () => {
    it('adds the pool publications and nothing else; undone (refusing to lose one or its journal unless accepted), then applied again', async () => {
      const { sophie, dossierId, a } = await presented()
      await rolledBack(async (tx) => {
        await run(tx, [ACCEPT_LOSS, ...DOWN, REFUSE_LOSS])
        expect(await rows(tx, `SELECT to_regclass('pool_publications')::text AS t`)).toEqual([
          { t: null },
        ])
        const counts = `SELECT (SELECT count(*)::int FROM dossiers) AS dossiers,
                  (SELECT count(*)::int FROM candidatures) AS candidatures,
                  (SELECT count(*)::int FROM share_links) AS shares,
                  (SELECT count(*)::int FROM candidature_status_changes) AS statuses,
                  (SELECT count(*)::int FROM audit_log) AS journal`
        const [before] = await rows(tx, counts)
        await run(tx, UP)
        expect((await rows(tx, counts))[0]).toEqual(before)
        expect(await rows(tx, 'SELECT count(*)::int AS n FROM pool_publications')).toEqual([
          { n: 0 },
        ])
        const migrated = await fingerprint(tx)

        // Without any publication: undone without acceptance, applied again, the same.
        await run(tx, DOWN)
        await run(tx, UP)
        expect(await fingerprint(tx)).toEqual(migrated)

        // A publication — even withdrawn — or a journal entry alone: refused unless accepted;
        // accepted, the publications and their journal go, nothing else.
        for (const trace of [
          `INSERT INTO pool_publications (id, candidature_id, workspace_id, access_level, consented_at, consented_by_id, updated_at)
           VALUES ('${randomUUID()}', '${a.candidatureId}', '${a.workspaceId}', 'partiel', now(), '${sophie}', now())`,
          `INSERT INTO pool_publications (id, candidature_id, workspace_id, access_level, consented_at, withdrawn_at, withdrawal_reason, updated_at)
           VALUES ('${randomUUID()}', '${a.candidatureId}', '${a.workspaceId}', 'public', now(), now(), 'archived', now())`,
          `INSERT INTO audit_log (id, dossier_id, action_type, actor_id, metadata)
           VALUES ('${randomUUID()}', '${dossierId}', 'pool_publication_withdrawn', '${sophie}', '{}')`,
        ]) {
          await tx.$executeRawUnsafe('SAVEPOINT traced')
          await tx.$executeRawUnsafe(trace)
          await tx.$executeRawUnsafe('SAVEPOINT before_down')
          await expect(run(tx, DOWN)).rejects.toThrow(/would be lost/)
          await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT before_down')
          await run(tx, [ACCEPT_LOSS, ...DOWN, REFUSE_LOSS])
          expect(await rows(tx, `SELECT to_regclass('pool_publications')::text AS t`)).toEqual([
            { t: null },
          ])
          expect(
            await rows(
              tx,
              `SELECT count(*)::int AS n FROM audit_log WHERE action_type::text LIKE 'pool_publication_%'`,
            ),
          ).toEqual([{ n: 0 }])
          expect((await rows(tx, counts))[0]).toEqual(before)
          await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT traced')
        }
      })
    })

    it('survives an interrupted deployment: any prefix of the migration, then all of it, gives the same database', async () => {
      await presented()
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
    it('keeps a publication in its candidature’s workspace, one per candidature, its level and withdrawal coherent', async () => {
      const { sophie, a, b } = await presented()
      const insert = (columns: Record<string, string>) => {
        const values = {
          id: `'${randomUUID()}'`,
          candidature_id: `'${a.candidatureId}'`,
          workspace_id: `'${a.workspaceId}'`,
          access_level: `'partiel'`,
          consented_at: 'now()',
          consented_by_id: `'${sophie}'`,
          updated_at: 'now()',
          ...columns,
        }
        return `INSERT INTO pool_publications (${Object.keys(values).join(', ')}) VALUES (${Object.values(values).join(', ')})`
      }
      const refused = (sql: string, error: RegExp) =>
        expect(prisma.$transaction((tx) => tx.$executeRawUnsafe(sql))).rejects.toThrow(error)
      for (const columns of [
        { access_level: `'tout'` } as Record<string, string>,
        { access_level: `'Public'` },
        { withdrawn_at: 'now()' },
        { withdrawal_reason: `'owner'` },
        { withdrawn_at: 'now()', withdrawal_reason: `'oubli'` },
        { withdrawn_by_id: `'${sophie}'` },
        {
          consented_at: 'now()',
          withdrawn_at: `now() - interval '1 day'`,
          withdrawal_reason: `'owner'`,
        },
      ]) {
        await refused(insert(columns), /check constraint/)
      }
      // Another workspace's pool with this candidature, or an unknown candidature: refused.
      await refused(insert({ workspace_id: `'${b.workspaceId}'` }), /foreign key/)
      await refused(insert({ candidature_id: `'${randomUUID()}'` }), /foreign key/)
      await prisma.$transaction((tx) =>
        tx.$executeRawUnsafe(
          insert({
            withdrawn_at: 'now()',
            withdrawal_reason: `'archived'`,
            withdrawn_by_id: `'${sophie}'`,
          }),
        ),
      )
      // One per candidature.
      await refused(insert({}), /already exists/)
    })

    it('goes with its request; outlives the account that consented', async () => {
      const { sophie, dossierId, a } = await presented()
      await pool.publish(a.candidatureId, sophie, consent('complet'))
      const row = await prisma.poolPublication.findUniqueOrThrow({
        where: { candidatureId: a.candidatureId },
      })
      // An account deleted leaves the publication without consenter.
      const temp = await account('temp')
      await prisma.poolPublication.update({
        where: { id: row.id },
        data: { consentedById: temp.id },
      })
      await prisma.user.delete({ where: { id: temp.id } })
      expect(
        await prisma.poolPublication.findUniqueOrThrow({ where: { id: row.id } }),
      ).toMatchObject({ consentedById: null, accessLevel: 'complet' })
      await prisma.dossier.delete({ where: { id: dossierId } })
      expect(await prisma.poolPublication.count({ where: { id: row.id } })).toBe(0)
    })
  })

  describe('concurrency', () => {
    it('never leaves a publication active on a request archived at the same moment', async () => {
      for (let round = 0; round < 4; round++) {
        const { sophie, dossierId, a, b } = await presented()
        await pool.publish(b.candidatureId, sophie, consent('public'))
        const results = await Promise.allSettled([
          pool.publish(a.candidatureId, sophie, consent('partiel')),
          dossiers.archive(dossierId, sophie),
        ])
        expect(results[1].status).toBe('fulfilled')
        // Either published then withdrawn by the archiving, or refused for an archived request.
        expect(['fulfilled', 'DOSSIER_ARCHIVED']).toContain(failure(results[0]))
        const active = await prisma.poolPublication.count({
          where: { candidature: { dossierId }, withdrawnAt: null },
        })
        expect(active).toBe(0)
        const withdrawals = await prisma.auditLog.count({
          where: { dossierId, actionType: 'pool_publication_withdrawn' },
        })
        expect(withdrawals).toBe(failure(results[0]) === 'fulfilled' ? 2 : 1)
      }
    })

    it('applies simultaneous changes of one publication one at a time, each journaled once', async () => {
      for (let round = 0; round < 3; round++) {
        const { sophie, dossierId, a } = await presented()
        const results = await Promise.allSettled([
          pool.publish(a.candidatureId, sophie, consent('public')),
          pool.publish(a.candidatureId, sophie, consent('complet')),
          pool.withdraw(a.candidatureId, sophie),
          pool.publish(a.candidatureId, sophie, consent('complet')),
        ])
        expect(results.map(failure)).toEqual(['fulfilled', 'fulfilled', 'fulfilled', 'fulfilled'])
        expect(
          await prisma.poolPublication.count({ where: { candidatureId: a.candidatureId } }),
        ).toBe(1)
        // The journal replays to the state in the table: each entry starts from the previous one.
        const entries = await prisma.auditLog.findMany({
          where: {
            dossierId,
            actionType: { in: ['pool_publication_published', 'pool_publication_withdrawn'] },
          },
          orderBy: { createdAt: 'asc' },
        })
        let level: string | null = null
        for (const e of entries) {
          const m = e.metadata as { from?: string | null; to?: string; accessLevel?: string }
          if (e.actionType === 'pool_publication_published') {
            expect(m.from).toBe(level)
            level = m.to!
          } else {
            expect(m.accessLevel).toBe(level)
            level = null
          }
        }
        const row = await prisma.poolPublication.findUniqueOrThrow({
          where: { candidatureId: a.candidatureId },
        })
        expect(row.withdrawnAt === null ? row.accessLevel : null).toBe(level)
      }
    })

    it('withdraws from one workspace while the other is published at the same moment, touching nothing else', async () => {
      const { sophie, dossierId, a, b } = await presented()
      await pool.publish(a.candidatureId, sophie, consent('partiel'))
      const before = {
        dossier: await prisma.dossier.findUniqueOrThrow({ where: { id: dossierId } }),
        candidatures: await prisma.candidature.findMany({
          where: { dossierId },
          orderBy: { id: 'asc' },
        }),
      }
      await Promise.all([
        pool.withdraw(a.candidatureId, sophie),
        pool.publish(b.candidatureId, sophie, consent('complet')),
      ])
      const [pa, pb] = await Promise.all(
        [a, b].map((c) =>
          prisma.poolPublication.findUniqueOrThrow({ where: { candidatureId: c.candidatureId } }),
        ),
      )
      expect(pa).toMatchObject({ withdrawalReason: 'owner', withdrawnById: sophie })
      expect(pb).toMatchObject({
        withdrawnAt: null,
        accessLevel: 'complet',
        workspaceId: b.workspaceId,
      })
      expect(await prisma.dossier.findUniqueOrThrow({ where: { id: dossierId } })).toEqual(
        before.dossier,
      )
      expect(
        await prisma.candidature.findMany({ where: { dossierId }, orderBy: { id: 'asc' } }),
      ).toEqual(before.candidatures)
    })
  })
})
