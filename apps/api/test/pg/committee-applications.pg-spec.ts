import { randomUUID } from 'node:crypto'
import { HttpException } from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import { AnswerSourcesService } from '../../src/modules/answers/answer-sources.service'
import { AuditService } from '../../src/modules/audit/audit.service'
import { CandidaturesService } from '../../src/modules/candidatures/candidatures.service'
import type { ClassificationService } from '../../src/modules/classification/classification.service'
import { CommitteeApplicationsService } from '../../src/modules/committees/committee-applications.service'
import { CommitteesService } from '../../src/modules/committees/committees.service'
import { CompaniesService } from '../../src/modules/companies/companies.service'
import type { DocumentsService } from '../../src/modules/documents/documents.service'
import { MemoryStorageAdapter } from '../../src/modules/documents/storage/memory-storage.adapter'
import { DossiersService } from '../../src/modules/dossiers/dossiers.service'
import { QuestionnairesService } from '../../src/modules/questionnaires/questionnaires.service'
import { WorkspaceAccessService } from '../../src/modules/workspaces/workspace-access'
import { WorkspacesService } from '../../src/modules/workspaces/workspaces.service'
import { testDatabase } from './database'
import { committeeApplicationsDown, committeeApplicationsUp } from './sql-file'

const UP = committeeApplicationsUp()
// Without the acceptance: what an operator runs first.
const DOWN = committeeApplicationsDown().slice(1)
const ACCEPT_LOSS = "SET LOCAL confluent.accept_committee_applications_loss = 'on'"
// The acceptance lasts for the whole transaction: withdrawn before a revert that must be checked.
const REFUSE_LOSS = "SET LOCAL confluent.accept_committee_applications_loss = 'off'"

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

const JUNE = { name: 'Comité de juin', date: '2099-06-10', time: '14:00', timeZone: 'Europe/Paris' }

// What the migration creates, comparable: the table's columns, constraints, indexes, the journal's
// new action and the rows.
async function fingerprint(tx: Tx): Promise<string> {
  const [row] = await rows(
    tx,
    `SELECT json_build_object(
       'columns', (SELECT json_agg(x ORDER BY x) FROM (
         SELECT column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, '') AS x
         FROM information_schema.columns
         WHERE table_schema = current_schema() AND table_name = 'committee_applications') c),
       'constraints', (SELECT json_agg(x ORDER BY x) FROM (
         SELECT conname || ':' || pg_get_constraintdef(oid) AS x
         FROM pg_constraint WHERE conrelid::regclass::text = 'committee_applications') k),
       'indexes', (SELECT json_agg(indexdef ORDER BY indexdef) FROM pg_indexes
         WHERE schemaname = current_schema() AND tablename = 'committee_applications'),
       'actions', (SELECT json_agg(enumlabel ORDER BY enumsortorder) FROM pg_enum
         WHERE enumtypid = 'audit_action'::regtype AND enumlabel = 'committee_application_changed'),
       'entries', (SELECT json_agg(to_jsonb(a) ORDER BY id) FROM committee_applications a)
     )::text AS f`,
  )
  return row.f as string
}

// ROADMAP E08.03 on PostgreSQL: the migration adds the entries without touching anything else,
// survives an interrupted deployment and can be undone (refusing, unless accepted, to lose an entry
// or its journal); the constraints keep an entry's values closed and its committee and candidature
// in the same workspace, once per pair; both sides acting at the same moment never create two
// entries nor both change one from the same version; a committee cancelled meanwhile and a
// conseiller deactivated while waiting write nothing.
describe('committee applications (PostgreSQL)', () => {
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
  const committees = new CommitteesService(prisma, access, audit)
  const applications = new CommitteeApplicationsService(prisma, candidatures, committees, audit)
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
    // Their requests take the candidatures and their entries with them; the workspaces their
    // committees.
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

  const account = (name: string, role: 'entrepreneur' | 'financeur' = 'entrepreneur') =>
    prisma.user.create({
      data: {
        email: `${name}-${randomUUID().slice(0, 6)}-${tag}@pg-test.dev`,
        role,
        emailVerifiedAt: new Date(),
      },
    })

  // A workspace receiving candidatures, its managing conseillère Marie and its conseiller Jean, a
  // planned committee, and a request of Sophie sent to it.
  async function setting() {
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
    const people: Array<{ id: string; role: string; membershipId: string }> = []
    for (const [name, manages] of [
      ['marie', true],
      ['jean', false],
    ] as const) {
      const u = await account(name, 'financeur')
      const m = await prisma.workspaceMembership.create({
        data: { workspaceId: ws.id, userId: u.id, role: 'conseiller', canManageWorkspace: manages },
      })
      people.push({ id: u.id, role: u.role, membershipId: m.id })
    }
    const [marie, jean] = people
    const committee = await committees.create(marie, ws.id, JUNE)
    const sophie = await account('sophie')
    const candidature = await sentRequest(sophie.id, ws.id)
    return {
      workspaceId: ws.id,
      marie,
      jean,
      committeeId: committee.id,
      sophie: { id: sophie.id, role: sophie.role },
      ...candidature,
    }
  }

  async function sentRequest(ownerId: string, workspaceId: string) {
    const dossier = await dossiers.create({
      owner: { id: ownerId, role: 'entrepreneur' },
      name: 'Bio',
    })
    await prisma.dossier.update({ where: { id: dossier.id }, data: { submittedAt: new Date() } })
    const created = await candidatures.create(dossier.id, ownerId, workspaceId)
    await candidatures.submit(created.id, ownerId)
    return { dossierId: dossier.id, candidatureId: created.id }
  }

  const insert = (columns: Record<string, string>) => {
    const values = {
      id: `'${randomUUID()}'`,
      status: `'applied'`,
      status_by: `'owner'`,
      status_changed_at: 'now()',
      updated_at: 'now()',
      ...columns,
    }
    return `INSERT INTO committee_applications (${Object.keys(values).join(', ')}) VALUES (${Object.values(values).join(', ')})`
  }

  describe('migration', () => {
    it('adds the entries and nothing else; undone (refusing to lose an entry or its journal unless accepted), then applied again', async () => {
      const s = await setting()
      await rolledBack(async (tx) => {
        await run(tx, [ACCEPT_LOSS, ...DOWN, REFUSE_LOSS])
        expect(await rows(tx, `SELECT to_regclass('committee_applications')::text AS t`)).toEqual([
          { t: null },
        ])
        const counts = `SELECT (SELECT count(*)::int FROM committees) AS committees,
                  (SELECT count(*)::int FROM candidatures) AS candidatures,
                  (SELECT count(*)::int FROM candidature_status_changes) AS statuses,
                  (SELECT count(*)::int FROM audit_log) AS journal`
        const [before] = await rows(tx, counts)
        await run(tx, UP)
        expect((await rows(tx, counts))[0]).toEqual(before)
        expect(await rows(tx, 'SELECT count(*)::int AS n FROM committee_applications')).toEqual([
          { n: 0 },
        ])
        const migrated = await fingerprint(tx)
        expect(migrated).toContain('"actions" : ["committee_application_changed"]')

        // Without any entry: undone without acceptance, applied again, the same.
        await run(tx, DOWN)
        await run(tx, UP)
        expect(await fingerprint(tx)).toEqual(migrated)

        // An entry — even withdrawn —, or only the journal of one: refused unless accepted;
        // accepted, the entries and their journal go, nothing else.
        for (const statements of [
          [
            insert({
              committee_id: `'${s.committeeId}'`,
              candidature_id: `'${s.candidatureId}'`,
              workspace_id: `'${s.workspaceId}'`,
              status: `'withdrawn'`,
            }),
          ],
          [
            `INSERT INTO audit_log (id, action_type, actor_id, metadata)
             VALUES ('${randomUUID()}', 'committee_application_changed', '${s.sophie.id}', '{}')`,
          ],
        ]) {
          await tx.$executeRawUnsafe('SAVEPOINT noted')
          await run(tx, statements)
          await tx.$executeRawUnsafe('SAVEPOINT before_down')
          await expect(run(tx, DOWN)).rejects.toThrow(/would be lost/)
          await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT before_down')
          await run(tx, [ACCEPT_LOSS, ...DOWN, REFUSE_LOSS])
          expect(await rows(tx, `SELECT to_regclass('committee_applications')::text AS t`)).toEqual(
            [{ t: null }],
          )
          expect(
            await rows(
              tx,
              `SELECT count(*)::int AS n FROM audit_log WHERE action_type::text = 'committee_application_changed'`,
            ),
          ).toEqual([{ n: 0 }])
          expect((await rows(tx, counts))[0]).toEqual(before)
          await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT noted')
        }
      })
    })

    it('survives an interrupted deployment: any prefix of the migration, then all of it, gives the same database', async () => {
      await setting()
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
    // On the constraints as the migration file writes them (applied again here), not as installed.
    it('keeps an entry’s values closed, who makes each status, and one entry per committee and candidature', async () => {
      const s = await setting()
      const other = await setting()
      const pair = {
        committee_id: `'${s.committeeId}'`,
        candidature_id: `'${s.candidatureId}'`,
        workspace_id: `'${s.workspaceId}'`,
      }
      await rolledBack(async (tx) => {
        await run(tx, [ACCEPT_LOSS, ...DOWN, REFUSE_LOSS, ...UP])
        const attempt = async (sql: string) => {
          await tx.$executeRawUnsafe('SAVEPOINT attempt')
          try {
            await tx.$executeRawUnsafe(sql)
            await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT attempt')
            return 'inserted'
          } catch (err) {
            await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT attempt')
            const message = String(err)
            if (/check constraint/.test(message)) return 'check'
            if (/23505|already exists/.test(message)) return 'unique'
            if (/foreign key|23503/.test(message)) return 'foreign key'
            throw err
          }
        }
        for (const columns of [
          { status: `'presented'` } as Record<string, string>,
          { status: `'Applied'` },
          { status_by: `'admin'` },
          // Only the entrepreneur applies; only the structure proposes or refuses.
          { status: `'applied'`, status_by: `'workspace'` },
          { status: `'proposed'`, status_by: `'owner'` },
          { status: `'refused'`, status_by: `'owner'` },
          { version: '0' },
        ]) {
          expect([columns, await attempt(insert({ ...pair, ...columns }))]).toEqual([
            columns,
            'check',
          ])
        }
        for (const columns of [
          {} as Record<string, string>,
          { status: `'proposed'`, status_by: `'workspace'` },
          { status: `'accepted'`, status_by: `'owner'` },
          { status: `'accepted'`, status_by: `'workspace'` },
          { status: `'refused'`, status_by: `'workspace'` },
          { status: `'withdrawn'`, status_by: `'owner'`, version: '7' },
          { status: `'withdrawn'`, status_by: `'workspace'` },
        ]) {
          expect([columns, await attempt(insert({ ...pair, ...columns }))]).toEqual([
            columns,
            'inserted',
          ])
        }
        // The committee of one workspace, the candidature of another: no key matches.
        for (const columns of [
          { ...pair, committee_id: `'${other.committeeId}'` },
          { ...pair, candidature_id: `'${other.candidatureId}'` },
          { ...pair, workspace_id: `'${other.workspaceId}'` },
        ]) {
          expect([columns, await attempt(insert(columns))]).toEqual([columns, 'foreign key'])
        }
        await tx.$executeRawUnsafe(insert(pair))
        expect(await attempt(insert({ ...pair, status: `'withdrawn'` }))).toBe('unique')
      })
    })

    it('goes with its request (its candidature), the committee staying', async () => {
      const s = await setting()
      await applications.changeAsOwner(s.sophie.id, s.candidatureId, s.committeeId, {
        to: 'applied',
        version: null,
      })
      expect(
        await prisma.committeeApplication.count({ where: { committeeId: s.committeeId } }),
      ).toBe(1)
      // The request deleted, its candidature and its entry go; the committee stays.
      await dossiers.delete(s.dossierId, s.sophie.id)
      expect(
        await prisma.committeeApplication.count({ where: { committeeId: s.committeeId } }),
      ).toBe(0)
      expect(await prisma.committee.count({ where: { id: s.committeeId } })).toBe(1)
    })
  })

  describe('concurrency', () => {
    const entriesOf = (committeeId: string) =>
      prisma.committeeApplication.findMany({ where: { committeeId } })
    const journalOf = async (committeeId: string) =>
      (
        await prisma.auditLog.findMany({
          where: { actionType: 'committee_application_changed' },
          orderBy: { createdAt: 'asc' },
        })
      ).filter((e) => (e.metadata as { committeeId?: string }).committeeId === committeeId)

    it('creates one entry when the entrepreneur applies twice at the same moment', async () => {
      const s = await setting()
      const results = await Promise.allSettled(
        [1, 2, 3].map(() =>
          applications.changeAsOwner(s.sophie.id, s.candidatureId, s.committeeId, {
            to: 'applied',
            version: null,
          }),
        ),
      )
      expect(results.map(outcome).sort()).toEqual([
        'COMMITTEE_APPLICATION_CHANGED',
        'COMMITTEE_APPLICATION_CHANGED',
        'fulfilled',
      ])
      const entries = await entriesOf(s.committeeId)
      expect(entries.map((e) => [e.status, e.version])).toEqual([['applied', 1]])
      expect(await journalOf(s.committeeId)).toHaveLength(1)
    })

    it('creates one entry when the entrepreneur applies while a conseiller attaches the request', async () => {
      const s = await setting()
      const results = await Promise.allSettled([
        applications.changeAsOwner(s.sophie.id, s.candidatureId, s.committeeId, {
          to: 'applied',
          version: null,
        }),
        applications.changeForWorkspace(s.jean, s.workspaceId, s.committeeId, {
          candidatureId: s.candidatureId,
          to: 'proposed',
          version: null,
        }),
      ])
      expect(results.map(outcome).sort()).toEqual(['COMMITTEE_APPLICATION_CHANGED', 'fulfilled'])
      const entries = await entriesOf(s.committeeId)
      expect(entries).toHaveLength(1)
      const winner =
        results[0].status === 'fulfilled' ? ['applied', 'owner'] : ['proposed', 'workspace']
      expect([entries[0].status, entries[0].statusBy, entries[0].version]).toEqual([...winner, 1])
      expect(await journalOf(s.committeeId)).toHaveLength(1)
    })

    it('applies one of an acceptance and a withdrawal made at the same moment from the same version', async () => {
      const s = await setting()
      await applications.changeAsOwner(s.sophie.id, s.candidatureId, s.committeeId, {
        to: 'applied',
        version: null,
      })
      const results = await Promise.allSettled([
        applications.changeForWorkspace(s.jean, s.workspaceId, s.committeeId, {
          candidatureId: s.candidatureId,
          to: 'accepted',
          version: 1,
        }),
        applications.changeAsOwner(s.sophie.id, s.candidatureId, s.committeeId, {
          to: 'withdrawn',
          version: 1,
        }),
        applications.changeForWorkspace(s.marie, s.workspaceId, s.committeeId, {
          candidatureId: s.candidatureId,
          to: 'refused',
          version: 1,
        }),
      ])
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
      expect(results.map(outcome).filter((o) => o !== 'fulfilled')).toEqual([
        'COMMITTEE_APPLICATION_CHANGED',
        'COMMITTEE_APPLICATION_CHANGED',
      ])
      const [entry] = await entriesOf(s.committeeId)
      expect(entry.version).toBe(2)
      expect(await journalOf(s.committeeId)).toHaveLength(2)
    })

    // Holds `table`'s row while `attempt` runs: once the attempt waits for it, `meanwhile` runs in the
    // holding transaction, which then commits.
    async function whileWaiting(
      table: 'committees' | 'candidatures',
      id: string,
      attempt: () => Promise<unknown>,
      meanwhile: (tx: Tx) => Promise<unknown>,
    ): Promise<string> {
      let result!: Promise<string>
      await prisma.$transaction(
        async (tx) => {
          await tx.$queryRawUnsafe(`SELECT 1 FROM "${table}" WHERE "id" = $1 FOR UPDATE`, id)
          result = attempt().then(
            () => 'fulfilled',
            (err: unknown) => {
              if (err instanceof HttpException) {
                return (err.getResponse() as { code: string }).code
              }
              throw err
            },
          )
          await waitForBlockedQuery()
          await meanwhile(tx)
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
      throw new Error('the attempt never waited for the lock')
    }

    it('writes nothing when the committee is cancelled while the change waits for it', async () => {
      const s = await setting()
      const cancel = (tx: Tx) =>
        tx.committee.update({
          where: { id: s.committeeId },
          data: { status: 'cancelled', version: { increment: 1 } },
        })
      const restore = () =>
        prisma.committee.update({
          where: { id: s.committeeId },
          data: { status: 'planned', version: { increment: 1 } },
        })
      // The structure attaching the request: refused, the committee being cancelled.
      expect(
        await whileWaiting(
          'committees',
          s.committeeId,
          () =>
            applications.changeForWorkspace(s.jean, s.workspaceId, s.committeeId, {
              candidatureId: s.candidatureId,
              to: 'proposed',
              version: null,
            }),
          cancel,
        ),
      ).toBe('COMMITTEE_CLOSED')
      // The entrepreneur applying: the cancelled committee is no longer one she sees.
      await restore()
      expect(
        await whileWaiting(
          'committees',
          s.committeeId,
          () =>
            applications.changeAsOwner(s.sophie.id, s.candidatureId, s.committeeId, {
              to: 'applied',
              version: null,
            }),
          cancel,
        ),
      ).toBe('COMMITTEE_NOT_FOUND')
      expect(await entriesOf(s.committeeId)).toEqual([])
      expect(await journalOf(s.committeeId)).toEqual([])

      // Through the services, at the same moment: either the cancellation waits for the entry, or the
      // entry is refused.
      await restore()
      const current = await committees.get(s.marie, s.workspaceId, s.committeeId)
      const [cancelled, apply] = await Promise.allSettled([
        committees.changeStatus(s.marie, s.workspaceId, s.committeeId, {
          status: 'cancelled',
          version: current.version,
        }),
        applications.changeAsOwner(s.sophie.id, s.candidatureId, s.committeeId, {
          to: 'applied',
          version: null,
        }),
      ])
      expect(outcome(cancelled)).toBe('fulfilled')
      // Fulfilled: it held the committee first, the cancellation waited for it.
      expect([outcome(apply), (await entriesOf(s.committeeId)).length]).toEqual(
        outcome(apply) === 'fulfilled' ? ['fulfilled', 1] : ['COMMITTEE_NOT_FOUND', 0],
      )
    })

    it('writes nothing for a conseiller deactivated, or an entrepreneur whose request changed hands, while waiting for the candidature (R53)', async () => {
      const s = await setting()
      expect(
        await whileWaiting(
          'candidatures',
          s.candidatureId,
          () =>
            applications.changeForWorkspace(s.jean, s.workspaceId, s.committeeId, {
              candidatureId: s.candidatureId,
              to: 'proposed',
              version: null,
            }),
          (tx) =>
            tx.workspaceMembership.update({
              where: { id: s.jean.membershipId },
              data: { deactivatedAt: new Date() },
            }),
        ),
      ).toBe('WORKSPACE_NOT_FOUND')
      const other = await account('marc')
      expect(
        await whileWaiting(
          'candidatures',
          s.candidatureId,
          () =>
            applications.changeAsOwner(s.sophie.id, s.candidatureId, s.committeeId, {
              to: 'applied',
              version: null,
            }),
          async (tx) => {
            const dossier = await tx.dossier.findUniqueOrThrow({ where: { id: s.dossierId } })
            await tx.company.update({
              where: { id: dossier.companyId },
              data: { ownerId: other.id },
            })
          },
        ),
      ).toBe('CANDIDATURE_NOT_FOUND')
      expect(await entriesOf(s.committeeId)).toEqual([])
    })

    // Code review R65: the right is read again once the committee is held too — a change that waited
    // for the committee (after its candidature's lock) writes nothing for a party who lost it meanwhile.
    it('writes nothing for a conseiller deactivated, or an entrepreneur whose request changed hands, while waiting for the committee (R65)', async () => {
      const s = await setting()
      expect(
        await whileWaiting(
          'committees',
          s.committeeId,
          () =>
            applications.changeForWorkspace(s.jean, s.workspaceId, s.committeeId, {
              candidatureId: s.candidatureId,
              to: 'proposed',
              version: null,
            }),
          (tx) =>
            tx.workspaceMembership.update({
              where: { id: s.jean.membershipId },
              data: { deactivatedAt: new Date() },
            }),
        ),
      ).toBe('WORKSPACE_NOT_FOUND')
      expect(await entriesOf(s.committeeId)).toEqual([])
      expect(await journalOf(s.committeeId)).toEqual([])
      const other = await account('marc')
      expect(
        await whileWaiting(
          'committees',
          s.committeeId,
          () =>
            applications.changeAsOwner(s.sophie.id, s.candidatureId, s.committeeId, {
              to: 'applied',
              version: null,
            }),
          async (tx) => {
            const dossier = await tx.dossier.findUniqueOrThrow({ where: { id: s.dossierId } })
            await tx.company.update({
              where: { id: dossier.companyId },
              data: { ownerId: other.id },
            })
          },
        ),
      ).toBe('CANDIDATURE_NOT_FOUND')
      expect(await entriesOf(s.committeeId)).toEqual([])
      expect(await journalOf(s.committeeId)).toEqual([])
    })

    it('never reuses a version: an entry is kept and changed, never deleted and created again', async () => {
      const s = await setting()
      let version: number | null = null
      for (const [side, to] of [
        ['owner', 'applied'],
        ['owner', 'withdrawn'],
        ['workspace', 'proposed'],
        ['workspace', 'withdrawn'],
        ['owner', 'applied'],
      ] as const) {
        const input = { to, version }
        if (side === 'owner') {
          await applications.changeAsOwner(s.sophie.id, s.candidatureId, s.committeeId, input)
        } else {
          await applications.changeForWorkspace(s.jean, s.workspaceId, s.committeeId, {
            ...input,
            candidatureId: s.candidatureId,
          })
        }
        version = (version ?? 0) + 1
      }
      const entries = await entriesOf(s.committeeId)
      expect(entries.map((e) => [e.status, e.version])).toEqual([['applied', 5]])
      expect(
        (await journalOf(s.committeeId)).map((e) => (e.metadata as { version: number }).version),
      ).toEqual([1, 2, 3, 4, 5])
    })
  })
})
