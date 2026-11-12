import { PARTICIPATION_REQUEST_LIMITS } from '@confluent/shared'
import { randomUUID } from 'node:crypto'
import { HttpException } from '@nestjs/common'
import type { ConfigService } from '@nestjs/config'
import { ThrottlerStorageService } from '@nestjs/throttler'
import type { Prisma } from '@prisma/client'
import type { AppConfig } from '../../src/config/config.schema'
import { AuditService } from '../../src/modules/audit/audit.service'
import { CommitteesService } from '../../src/modules/committees/committees.service'
import { MemoryStorageAdapter } from '../../src/modules/documents/storage/memory-storage.adapter'
import { ParticipationFormTokens } from '../../src/modules/participation-requests/participation-form-token'
import {
  ParticipationRequestsService,
  type ParticipationRequestInput,
} from '../../src/modules/participation-requests/participation-requests.service'
import { WorkspaceAccessService } from '../../src/modules/workspaces/workspace-access'
import { WorkspacesService } from '../../src/modules/workspaces/workspaces.service'
import { quietNotices, testDatabase } from './database'
import {
  committeeNoticesDown,
  participationDecisionsDown,
  participationRequestsDown,
  participationRequestsUp,
} from './sql-file'

const UP = participationRequestsUp()
// Without the acceptance: what an operator runs first.
const DOWN = participationRequestsDown().slice(1)
const ACCEPT_LOSS = "SET LOCAL confluent.accept_participation_requests_loss = 'on'"
// The acceptance lasts for the whole transaction: withdrawn before a revert that must be checked.
const REFUSE_LOSS = "SET LOCAL confluent.accept_participation_requests_loss = 'off'"
// E08.06's notices reference the requests and E08.05's decisions change them: undone first.
const LATER_DOWN = [...committeeNoticesDown(), ...participationDecisionsDown()]

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

const JUNE = {
  name: 'Comité de juin',
  date: '2099-06-10',
  time: '14:00',
  timeZone: 'Europe/Paris',
  participationRequestsOpen: true,
}

// What the migration creates, comparable: both tables' columns, constraints and indexes, the
// committees' new column, the journal's new actions and the rows.
async function fingerprint(tx: Tx): Promise<string> {
  const tables = `('participation_requests', 'participation_request_committees')`
  const [row] = await rows(
    tx,
    `SELECT json_build_object(
       'columns', (SELECT json_agg(x ORDER BY x) FROM (
         SELECT table_name || '.' || column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, '') AS x
         FROM information_schema.columns
         WHERE table_schema = current_schema() AND (table_name IN ${tables}
           OR (table_name = 'committees' AND column_name = 'participation_requests_open'))) c),
       'constraints', (SELECT json_agg(x ORDER BY x) FROM (
         SELECT conname || ':' || pg_get_constraintdef(oid) AS x
         FROM pg_constraint WHERE conrelid::regclass::text IN ${tables}) k),
       'indexes', (SELECT json_agg(indexdef ORDER BY indexdef) FROM pg_indexes
         WHERE schemaname = current_schema() AND tablename IN ${tables}),
       'actions', (SELECT json_agg(enumlabel ORDER BY enumsortorder) FROM pg_enum
         WHERE enumtypid = 'audit_action'::regtype AND enumlabel LIKE 'participation_request_%'),
       'requests', (SELECT json_agg(to_jsonb(r) ORDER BY id) FROM participation_requests r),
       'sessions', (SELECT json_agg(to_jsonb(s) ORDER BY request_id, committee_id) FROM participation_request_committees s),
       'offered', (SELECT json_agg(id ORDER BY id) FROM committees WHERE participation_requests_open)
     )::text AS f`,
  )
  return row.f as string
}

// ROADMAP E08.04 on PostgreSQL: the migration adds the requests and the committees' offer without
// touching anything else, survives an interrupted deployment and can be undone (refusing, unless
// accepted, to lose a request, its journal or a committee's offer); the constraints keep a request's
// values closed and bounded, one pending request per address and workspace, and its sessions inside
// its workspace; simultaneous first submissions of one address make one request; a session closed or
// cancelled while a submission waits for it is not requested.
describe('participation requests (PostgreSQL)', () => {
  const prisma = testDatabase()
  const audit = new AuditService(prisma)
  const access = new WorkspaceAccessService(prisma)
  const committees = new CommitteesService(prisma, access, audit, quietNotices(prisma))
  const workspacesService = new WorkspacesService(prisma, audit, new MemoryStorageAdapter(), access)
  const tokens = new ParticipationFormTokens({
    get: () => 'p'.repeat(32),
  } as unknown as ConfigService<AppConfig, true>)
  const limits = new ThrottlerStorageService()
  const requests = new ParticipationRequestsService(prisma, access, audit, tokens, limits)
  const tag = randomUUID().slice(0, 8)
  const workspaces: string[] = []
  const admin = { id: '', role: 'admin' }
  let ip = 0

  beforeAll(async () => {
    const u = await prisma.user.create({
      data: { email: `admin-${tag}@pg-test.dev`, role: 'admin', emailVerifiedAt: new Date() },
    })
    admin.id = u.id
  })

  afterAll(async () => {
    limits.onApplicationShutdown()
    const users = await prisma.user.findMany({
      where: { email: { endsWith: `-${tag}@pg-test.dev` } },
    })
    const ids = users.map((u) => u.id)
    await prisma.auditLog.deleteMany({ where: { actorId: { in: ids } } })
    for (const workspaceId of workspaces) {
      await prisma.auditLog.deleteMany({
        where: {
          actionType: { in: ['participation_request_received', 'participation_request_discarded'] },
          metadata: { path: ['workspaceId'], equals: workspaceId },
        },
      })
    }
    // The workspaces take their committees and requests with them.
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

  // A workspace, its managing conseillère and a committee offered on its public form.
  async function setting() {
    const slug = `pg-${randomUUID().slice(0, 12)}`
    const ws = await workspacesService.create(admin, { name: 'Structure test', slug })
    workspaces.push(ws.id)
    const marie = await prisma.user.create({
      data: {
        email: `marie-${randomUUID().slice(0, 6)}-${tag}@pg-test.dev`,
        role: 'financeur',
        emailVerifiedAt: new Date(),
      },
    })
    await prisma.workspaceMembership.create({
      data: { workspaceId: ws.id, userId: marie.id, role: 'conseiller', canManageWorkspace: true },
    })
    const manager = { id: marie.id, role: marie.role }
    const committee = await committees.create(manager, ws.id, JUNE)
    return { workspaceId: ws.id, slug, manager, committeeId: committee.id }
  }

  const submission = (
    s: { workspaceId: string; committeeId: string },
    patch: Partial<ParticipationRequestInput> = {},
  ): ParticipationRequestInput => ({
    name: 'Claire Martin',
    organization: 'Angels',
    email: `claire-${s.workspaceId.slice(0, 8)}-${tag}@angels.example`,
    message: 'Bonjour.',
    committeeIds: [s.committeeId],
    formToken: tokens.issue(s.workspaceId, Date.now() - 5000),
    ...patch,
  })
  const send = (slug: string, input: ParticipationRequestInput) =>
    requests.submit(slug, input, { ip: `198.51.100.${++ip % 250}` })

  const requestsOf = (workspaceId: string) =>
    prisma.participationRequest.findMany({ where: { workspaceId }, orderBy: { createdAt: 'asc' } })

  const insert = (columns: Record<string, string>) => {
    const values = {
      id: `'${randomUUID()}'`,
      email: `'x@example.org'`,
      name: `'X'`,
      last_submitted_at: 'now()',
      updated_at: 'now()',
      ...columns,
    }
    return `INSERT INTO participation_requests (${Object.keys(values).join(', ')}) VALUES (${Object.values(values).join(', ')})`
  }

  describe('migration', () => {
    it('adds the requests and the offer and nothing else; undone (refusing to lose a request, its journal or an offer unless accepted), then applied again', async () => {
      const s = await setting()
      await rolledBack(async (tx) => {
        await run(tx, [...LATER_DOWN, ACCEPT_LOSS, ...DOWN, REFUSE_LOSS])
        expect(await rows(tx, `SELECT to_regclass('participation_requests')::text AS t`)).toEqual([
          { t: null },
        ])
        const counts = `SELECT (SELECT count(*)::int FROM committees) AS committees,
                  (SELECT count(*)::int FROM workspaces) AS workspaces,
                  (SELECT count(*)::int FROM workspace_memberships) AS memberships,
                  (SELECT count(*)::int FROM users) AS users,
                  (SELECT count(*)::int FROM audit_log) AS journal`
        const [before] = await rows(tx, counts)
        await run(tx, UP)
        expect((await rows(tx, counts))[0]).toEqual(before)
        expect(
          await rows(
            tx,
            `SELECT (SELECT count(*)::int FROM participation_requests) AS requests,
                    (SELECT count(*)::int FROM committees WHERE participation_requests_open) AS offered`,
          ),
        ).toEqual([{ requests: 0, offered: 0 }])
        const migrated = await fingerprint(tx)
        // (E08.05's action stays once added: PostgreSQL cannot remove an enum value.)
        expect(migrated).toMatch(
          /"actions" : \["participation_request_received", "participation_request_discarded"(, "participation_request_decided")?\]/,
        )

        // Without any request nor offer: undone without acceptance, applied again, the same.
        await run(tx, DOWN)
        await run(tx, UP)
        expect(await fingerprint(tx)).toEqual(migrated)

        // A request, only the journal of one, or only a committee offered: refused unless accepted;
        // accepted, they go, nothing else.
        for (const statements of [
          [insert({ workspace_id: `'${s.workspaceId}'` })],
          [
            `INSERT INTO audit_log (id, action_type, metadata)
             VALUES ('${randomUUID()}', 'participation_request_discarded', '{}')`,
          ],
          [
            `UPDATE committees SET participation_requests_open = true WHERE id = '${s.committeeId}'`,
          ],
        ]) {
          await tx.$executeRawUnsafe('SAVEPOINT noted')
          await run(tx, statements)
          await tx.$executeRawUnsafe('SAVEPOINT before_down')
          await expect(run(tx, DOWN)).rejects.toThrow(/would be lost/)
          await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT before_down')
          await run(tx, [ACCEPT_LOSS, ...DOWN, REFUSE_LOSS])
          expect(
            await rows(
              tx,
              `SELECT to_regclass('participation_requests')::text AS t,
                      (SELECT count(*)::int FROM information_schema.columns
                       WHERE table_schema = current_schema() AND table_name = 'committees'
                         AND column_name = 'participation_requests_open') AS offer,
                      (SELECT count(*)::int FROM audit_log
                       WHERE action_type::text LIKE 'participation_request_%') AS journal`,
            ),
          ).toEqual([{ t: null, offer: 0, journal: 0 }])
          expect((await rows(tx, counts))[0]).toEqual(before)
          await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT noted')
        }
      })
    })

    it('survives an interrupted deployment: any prefix of the migration, then all of it, gives the same database', async () => {
      await setting()
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
    // On the constraints as the migration file writes them (applied again here), not as installed.
    it('keeps a request’s values closed and bounded, one pending request per address, its sessions in its workspace', async () => {
      const s = await setting()
      const other = await setting()
      await rolledBack(async (tx) => {
        await run(tx, [...LATER_DOWN, ACCEPT_LOSS, ...DOWN, REFUSE_LOSS, ...UP])
        const ws = { workspace_id: `'${s.workspaceId}'` }
        const refused = async (sql: string, error: RegExp) => {
          await tx.$executeRawUnsafe('SAVEPOINT attempt')
          await expect(tx.$executeRawUnsafe(sql)).rejects.toThrow(error)
          await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT attempt')
        }
        const check = /participation_requests_check/
        const invalid: Array<Record<string, string>> = [
          { status: `'accepted'` },
          { status: `'unknown'` },
          { email: `'Claire@Example.org'` },
          { email: `'claire example.org'` },
          { email: `'a@b@c'` },
          { email: `'${'a'.repeat(250)}@x.fr'` },
          { name: `''` },
          { name: `' Claire'` },
          { name: `'Claire  Martin'` },
          { name: `E'Claire\\nMartin'` },
          { name: `'${'n'.repeat(121)}'` },
          { organization: `''` },
          { organization: `'${'o'.repeat(121)}'` },
          { message: `''` },
          { message: `'<b>gras</b>'` },
          { message: `E'a\\n\\n\\nb'` },
          { message: `E'a\\u0007b'` },
          { message: `'${'m'.repeat(2001)}'` },
          { submission_count: '0' },
          { version: '0' },
        ]
        for (const columns of invalid) {
          await refused(insert({ ...ws, ...columns }), check)
        }
        // At the limits, accepted.
        await tx.$executeRawUnsafe(
          insert({
            ...ws,
            email: `'${'a'.repeat(240)}@example.org'`,
            name: `'${'n'.repeat(120)}'`,
            organization: `'${'o'.repeat(120)}'`,
            message: `E'${'m'.repeat(1000)}\\n\\n${'m'.repeat(998)}'`,
          }),
        )

        // One pending request per address and workspace; the same address elsewhere is another.
        const first = randomUUID()
        await tx.$executeRawUnsafe(insert({ ...ws, id: `'${first}'`, email: `'once@example.org'` }))
        await refused(
          insert({ ...ws, email: `'once@example.org'` }),
          /Key \(workspace_id, email\)=\([^)]*, once@example\.org\) already exists/,
        )
        await tx.$executeRawUnsafe(
          insert({ workspace_id: `'${other.workspaceId}'`, email: `'once@example.org'` }),
        )

        // Its sessions: committees of its own workspace, each once.
        const session = (committeeId: string, workspaceId = s.workspaceId) =>
          `INSERT INTO participation_request_committees (request_id, committee_id, workspace_id)
           VALUES ('${first}', '${committeeId}', '${workspaceId}')`
        await tx.$executeRawUnsafe(session(s.committeeId))
        await refused(session(s.committeeId), /Key \(request_id, committee_id\)=.* already exists/)
        await refused(
          session(other.committeeId),
          /participation_request_committees_committee_id_workspace_id_fkey/,
        )
        await refused(
          session(other.committeeId, other.workspaceId),
          /participation_request_committees_request_id_workspace_id_fkey/,
        )
      })
    })
  })

  describe('concurrency', () => {
    it('makes one request of simultaneous first submissions of one address, every session added', async () => {
      const s = await setting()
      const july = await committees.create(s.manager, s.workspaceId, {
        ...JUNE,
        date: '2099-07-10',
      })
      const results = await Promise.allSettled([
        send(s.slug, submission(s)),
        send(s.slug, submission(s, { committeeIds: [july.id] })),
        send(s.slug, submission(s, { committeeIds: [s.committeeId, july.id] })),
        send(s.slug, submission(s)),
        send(s.slug, submission(s, { committeeIds: [july.id] })),
      ])
      expect(results.map(outcome)).toEqual(Array(5).fill('fulfilled'))
      const [request, ...more] = await requestsOf(s.workspaceId)
      expect(more).toEqual([])
      // Each submission counted: none overwrote another's.
      expect(request).toMatchObject({ status: 'pending', submissionCount: 5, version: 5 })
      const sessions = await prisma.participationRequestCommittee.findMany({
        where: { requestId: request.id },
      })
      expect(sessions.map((l) => l.committeeId).sort()).toEqual([s.committeeId, july.id].sort())
      const journal = await prisma.auditLog.findMany({
        where: {
          actionType: 'participation_request_received',
          metadata: { path: ['workspaceId'], equals: s.workspaceId },
        },
      })
      expect(journal.map((e) => (e.metadata as { merged: boolean }).merged).sort()).toEqual([
        false,
        true,
        true,
        true,
        true,
      ])
    })

    // A first transaction holds a row (as an edit of the committee does) while the submission waits
    // for it, then changes it; returns the submission's outcome.
    async function whileWaiting(
      table: 'committees' | 'workspaces',
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
      throw new Error('the submission never waited for the lock')
    }

    it('records nothing for a session closed or cancelled while the submission waits for it', async () => {
      const s = await setting()
      const reopen = () =>
        prisma.committee.update({
          where: { id: s.committeeId },
          data: { status: 'planned', participationRequestsOpen: true, version: { increment: 1 } },
        })
      for (const change of [{ participationRequestsOpen: false }, { status: 'cancelled' }]) {
        expect(
          await whileWaiting(
            'committees',
            s.committeeId,
            () => send(s.slug, submission(s)),
            (tx) =>
              tx.committee.update({
                where: { id: s.committeeId },
                data: { ...change, version: { increment: 1 } },
              }),
          ),
        ).toBe('PARTICIPATION_COMMITTEES_CLOSED')
        await reopen()
      }
      expect(await requestsOf(s.workspaceId)).toEqual([])

      // A manager editing the committee holds the workspace, then the committee: the submission
      // waits for the workspace before holding the committee — never the other way round, which
      // would deadlock.
      expect(
        await whileWaiting(
          'workspaces',
          s.workspaceId,
          () => send(s.slug, submission(s)),
          (tx) =>
            tx.committee.update({
              where: { id: s.committeeId },
              data: { participationRequestsOpen: false, version: { increment: 1 } },
            }),
        ),
      ).toBe('PARTICIPATION_COMMITTEES_CLOSED')
      await reopen()
      expect(await requestsOf(s.workspaceId)).toEqual([])

      // Through the services, at the same moment: either the closing waits for the request, or the
      // request is refused.
      const current = await committees.get(s.manager, s.workspaceId, s.committeeId)
      const [closed, sent] = await Promise.allSettled([
        committees.update(s.manager, s.workspaceId, s.committeeId, {
          ...JUNE,
          participationRequestsOpen: false,
          version: current.version,
        }),
        send(s.slug, submission(s)),
      ])
      expect(outcome(closed)).toBe('fulfilled')
      expect([outcome(sent), (await requestsOf(s.workspaceId)).length]).toEqual(
        // Refused: under the lock, or — closed before it was read — as a workspace offering none.
        outcome(sent) === 'fulfilled'
          ? ['fulfilled', 1]
          : [expect.stringMatching(/^PARTICIPATION_(COMMITTEES_CLOSED|FORM_NOT_FOUND)$/), 0],
      )
    })

    // Code review R67: the cap holds under concurrency. 999 pending, five new addresses admitted at
    // the same moment (all waiting behind a manager's workspace lock, then let go together): one gets
    // in, the others are refused alike, nothing of theirs recorded.
    it('never lets the queue past its cap when new addresses are admitted at the same moment', async () => {
      const s = await setting()
      const cap = PARTICIPATION_REQUEST_LIMITS.pendingPerWorkspace
      await prisma.participationRequest.createMany({
        data: Array.from({ length: cap - 1 }, (_, i) => ({
          workspaceId: s.workspaceId,
          email: `filler${i}-${tag}@example.org`,
          name: 'P',
          lastSubmittedAt: new Date(),
        })),
      })
      let attempts!: Promise<PromiseSettledResult<unknown>[]>
      await prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT 1 FROM "workspaces" WHERE "id" = ${s.workspaceId} FOR UPDATE`
          attempts = Promise.allSettled(
            [0, 1, 2, 3, 4].map((i) =>
              send(s.slug, submission(s, { email: `new${i}-${tag}@angels.example` })),
            ),
          )
          for (let i = 0; i < 200; i++) {
            const [{ waiting }] = await prisma.$queryRaw<Array<{ waiting: bigint }>>`
              SELECT count(*) AS waiting FROM pg_locks WHERE NOT granted`
            if (waiting >= 5n) break
            await new Promise((resolve) => setTimeout(resolve, 50))
          }
        },
        { timeout: 30_000 },
      )
      const outcomes = (await attempts).map(outcome)
      expect(outcomes.sort()).toEqual([
        'PARTICIPATION_QUEUE_FULL',
        'PARTICIPATION_QUEUE_FULL',
        'PARTICIPATION_QUEUE_FULL',
        'PARTICIPATION_QUEUE_FULL',
        'fulfilled',
      ])
      const pending = await prisma.participationRequest.findMany({
        where: { workspaceId: s.workspaceId, status: 'pending' },
      })
      expect(pending).toHaveLength(cap)
      const admitted = pending.filter((r) => r.email.startsWith('new'))
      expect(admitted).toHaveLength(1)
      const links = await prisma.participationRequestCommittee.findMany({
        where: { workspaceId: s.workspaceId },
      })
      expect(links.map((l) => l.requestId)).toEqual([admitted[0].id])
      const received = (
        await prisma.auditLog.findMany({ where: { actionType: 'participation_request_received' } })
      ).filter((e) => (e.metadata as { workspaceId?: string }).workspaceId === s.workspaceId)
      expect(received.map((e) => (e.metadata as { requestId: string }).requestId)).toEqual([
        admitted[0].id,
      ])
    })
  })
})
