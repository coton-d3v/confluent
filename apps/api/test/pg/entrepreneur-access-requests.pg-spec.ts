import { ENTREPRENEUR_ACCESS_REQUEST_LIMITS } from '@confluent/shared'
import { randomUUID } from 'node:crypto'
import { HttpException } from '@nestjs/common'
import type { ConfigService } from '@nestjs/config'
import { ThrottlerStorageService } from '@nestjs/throttler'
import type { Prisma } from '@prisma/client'
import type { AppConfig } from '../../src/config/config.schema'
import { AuditService } from '../../src/modules/audit/audit.service'
import type { EmailTransport } from '../../src/modules/auth/email/email-transport'
import { MemoryStorageAdapter } from '../../src/modules/documents/storage/memory-storage.adapter'
import { EntrepreneurAccessDecisionsService } from '../../src/modules/entrepreneur-access-requests/entrepreneur-access-decisions.service'
import { EntrepreneurAccessFormTokens } from '../../src/modules/entrepreneur-access-requests/entrepreneur-access-form-token'
import {
  EntrepreneurAccessRequestsService,
  type EntrepreneurAccessRequestInput,
} from '../../src/modules/entrepreneur-access-requests/entrepreneur-access-requests.service'
import { WorkspaceAccessService } from '../../src/modules/workspaces/workspace-access'
import { WorkspacesService } from '../../src/modules/workspaces/workspaces.service'
import { testDatabase } from './database'
import { entrepreneurAccessRequestsDown, entrepreneurAccessRequestsUp } from './sql-file'
import { quietNotifications } from '../../src/testing/notifications'

const UP = entrepreneurAccessRequestsUp()
// Without the acceptance: what an operator runs first.
const DOWN = entrepreneurAccessRequestsDown().slice(1)
const ACCEPT_LOSS = "SET LOCAL confluent.accept_entrepreneur_access_requests_loss = 'on'"
// The acceptance lasts for the whole transaction: withdrawn before a revert that must be checked.
const REFUSE_LOSS = "SET LOCAL confluent.accept_entrepreneur_access_requests_loss = 'off'"
const ACTIONS = [
  'entrepreneur_access_request_received',
  'entrepreneur_access_request_discarded',
  'entrepreneur_access_request_decided',
] as const

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

// What the migration creates, comparable: the table's columns, constraints and indexes, the
// journal's new actions and the rows.
async function fingerprint(tx: Tx): Promise<string> {
  const [row] = await rows(
    tx,
    `SELECT json_build_object(
       'columns', (SELECT json_agg(x ORDER BY x) FROM (
         SELECT column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, '') AS x
         FROM information_schema.columns
         WHERE table_schema = current_schema() AND table_name = 'entrepreneur_access_requests') c),
       'constraints', (SELECT json_agg(x ORDER BY x) FROM (
         SELECT conname || ':' || pg_get_constraintdef(oid) AS x
         FROM pg_constraint WHERE conrelid = 'entrepreneur_access_requests'::regclass) k),
       'indexes', (SELECT json_agg(indexdef ORDER BY indexdef) FROM pg_indexes
         WHERE schemaname = current_schema() AND tablename = 'entrepreneur_access_requests'),
       'actions', (SELECT json_agg(enumlabel ORDER BY enumsortorder) FROM pg_enum
         WHERE enumtypid = 'audit_action'::regtype AND enumlabel LIKE 'entrepreneur_access_%'),
       'requests', (SELECT json_agg(to_jsonb(r) ORDER BY id) FROM entrepreneur_access_requests r)
     )::text AS f`,
  )
  return row.f as string
}

// ROADMAP E09.05 on PostgreSQL: the migration adds the requests and nothing else, survives an
// interrupted deployment and can be undone (refusing, unless accepted, to lose a request, a decision
// or their journal); the constraints keep the values closed and tie each status to its decision;
// simultaneous submissions of one address make one request; the queue's cap holds under concurrency
// (R67); a page closed while a submission waits records nothing; two managers deciding at once decide
// once (one account, one journal entry, one email); a submission meanwhile is seen (`409`) or becomes
// a new request; a manager demoted while waiting decides nothing (R53).
describe('entrepreneur access requests (PostgreSQL)', () => {
  const prisma = testDatabase()
  const audit = new AuditService(prisma)
  const access = new WorkspaceAccessService(prisma)
  const workspacesService = new WorkspacesService(prisma, audit, new MemoryStorageAdapter(), access)
  const config = {
    get: (key: string) => (key === 'FRONTEND_URL' ? 'https://confluent.example' : 'p'.repeat(32)),
  } as unknown as ConfigService<AppConfig, true>
  const tokens = new EntrepreneurAccessFormTokens(config)
  const limits = new ThrottlerStorageService()
  const sent: string[] = []
  const transport = {
    sendEntrepreneurAccessAccepted: (input: { to: string }) => {
      sent.push(input.to)
      return Promise.resolve()
    },
  } as unknown as EmailTransport
  const requests = new EntrepreneurAccessRequestsService(
    prisma,
    access,
    audit,
    tokens,
    limits,
    quietNotifications(prisma),
  )
  const decisions = new EntrepreneurAccessDecisionsService(
    prisma,
    access,
    audit,
    requests,
    config,
    transport,
    quietNotifications(prisma),
  )
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
          actionType: { in: [...ACTIONS] },
          metadata: { path: ['workspaceId'], equals: workspaceId },
        },
      })
    }
    // Their forms first (a workspace's forms are kept from its deletion: RESTRICT).
    const forms = await prisma.questionnaire.findMany({
      where: { workspaceId: { in: workspaces } },
    })
    await prisma.questionnaireVersion.deleteMany({
      where: { questionnaireId: { in: forms.map((f) => f.id) } },
    })
    await prisma.questionnaire.deleteMany({ where: { workspaceId: { in: workspaces } } })
    // The workspaces take their requests and memberships with them.
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

  const address = (name: string) => `${name}-${randomUUID().slice(0, 6)}-${tag}@pg-test.dev`

  // A workspace whose page shows how to apply (published, every block, a candidature form), and two
  // managing conseillères.
  async function setting() {
    const slug = `pg-${randomUUID().slice(0, 12)}`
    const ws = await workspacesService.create(admin, { name: 'Structure test', slug })
    workspaces.push(ws.id)
    await prisma.workspace.update({ where: { id: ws.id }, data: { publicPagePublished: true } })
    const form = await prisma.questionnaire.create({
      data: {
        slug: `candidature-${randomUUID()}`,
        name: 'Candidature',
        usage: 'candidature',
        workspaceId: ws.id,
      },
    })
    await prisma.questionnaireVersion.create({
      data: { questionnaireId: form.id, version: 1, status: 'published', publishedAt: new Date() },
    })
    const managers = []
    for (const name of ['marie', 'anne']) {
      const user = await prisma.user.create({
        data: { email: address(name), role: 'financeur', emailVerifiedAt: new Date() },
      })
      await prisma.workspaceMembership.create({
        data: { workspaceId: ws.id, userId: user.id, role: 'conseiller', canManageWorkspace: true },
      })
      managers.push({ id: user.id, role: user.role })
    }
    return { workspaceId: ws.id, slug, managers, formId: form.id }
  }
  type Setting = Awaited<ReturnType<typeof setting>>

  const submission = (
    s: Setting,
    patch: Partial<EntrepreneurAccessRequestInput> = {},
  ): EntrepreneurAccessRequestInput => ({
    name: 'Léa Bernard',
    companyName: 'Hydrolia',
    email: `lea-${s.workspaceId.slice(0, 8)}-${tag}@pg-test.dev`,
    message: 'Bonjour.',
    formToken: tokens.issue(s.workspaceId, Date.now() - 5000),
    ...patch,
  })
  const send = (s: Setting, input: EntrepreneurAccessRequestInput) =>
    requests.submit(s.slug, input, { ip: `198.51.100.${++ip % 250}` })
  const asked = async (s: Setting, email: string) => {
    await send(s, submission(s, { email }))
    return prisma.entrepreneurAccessRequest.findFirstOrThrow({
      where: { workspaceId: s.workspaceId, email, status: 'pending' },
    })
  }

  const insert = (columns: Record<string, string>) => {
    const values = {
      id: `'${randomUUID()}'`,
      email: `'x-${randomUUID().slice(0, 8)}@example.org'`,
      name: `'X'`,
      company_name: `'Y'`,
      last_submitted_at: 'now()',
      updated_at: 'now()',
      ...columns,
    }
    return `INSERT INTO entrepreneur_access_requests (${Object.keys(values).join(', ')}) VALUES (${Object.values(values).join(', ')})`
  }

  describe('migration', () => {
    it('adds the requests and nothing else; undone (refusing to lose a request or its journal unless accepted), then applied again', async () => {
      const s = await setting()
      const waiting = await asked(s, address('lea'))
      await rolledBack(async (tx) => {
        const counts = `SELECT (SELECT count(*)::int FROM workspaces) AS workspaces,
                  (SELECT count(*)::int FROM workspace_memberships) AS memberships,
                  (SELECT count(*)::int FROM users) AS users,
                  (SELECT count(*)::int FROM audit_log) AS journal`
        // A pending request and its journal: refused unless accepted.
        await tx.$executeRawUnsafe('SAVEPOINT before_down')
        await expect(run(tx, DOWN)).rejects.toThrow(/would be lost/)
        await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT before_down')
        const migrated = await fingerprint(tx)
        expect(migrated).toContain(waiting.id)
        await run(tx, [ACCEPT_LOSS, ...DOWN, REFUSE_LOSS])
        expect(
          await rows(tx, `SELECT to_regclass('entrepreneur_access_requests')::text AS t`),
        ).toEqual([{ t: null }])
        expect(
          await rows(
            tx,
            `SELECT count(*)::int AS n FROM audit_log WHERE action_type::text LIKE 'entrepreneur_access_%'`,
          ),
        ).toEqual([{ n: 0 }])
        const [before] = await rows(tx, counts)
        // Without any request: undone without acceptance, applied again, the same.
        await run(tx, UP)
        expect((await rows(tx, counts))[0]).toEqual(before)
        const empty = await fingerprint(tx)
        expect(empty).toContain('entrepreneur_access_requests_decision_check')
        expect(empty).toContain('entrepreneur_access_requests_pending_email_key')
        await run(tx, DOWN)
        await run(tx, UP)
        expect(await fingerprint(tx)).toEqual(empty)

        // A decided request, or only the journal of one: refused unless accepted; accepted, they go,
        // nothing else (the accounts an acceptance created stay).
        for (const statement of [
          insert({ workspace_id: `'${s.workspaceId}'`, status: `'refused'`, decided_at: 'now()' }),
          `INSERT INTO audit_log (id, action_type, metadata)
           VALUES ('${randomUUID()}', 'entrepreneur_access_request_decided', '{}')`,
          `INSERT INTO audit_log (id, action_type, metadata)
           VALUES ('${randomUUID()}', 'entrepreneur_access_request_discarded', '{}')`,
        ]) {
          await tx.$executeRawUnsafe('SAVEPOINT noted')
          const [counted] = await rows(tx, counts)
          await tx.$executeRawUnsafe(statement)
          await tx.$executeRawUnsafe('SAVEPOINT before_down')
          await expect(run(tx, DOWN)).rejects.toThrow(/would be lost/)
          await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT before_down')
          await run(tx, [ACCEPT_LOSS, ...DOWN, REFUSE_LOSS])
          const [after] = await rows(tx, counts)
          expect({ ...after, journal: counted.journal }).toEqual(counted)
          await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT noted')
        }
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
    // On the constraints as the migration file writes them (applied again here), not as installed.
    it('keeps the values closed and bounded, one pending request per address, each status tied to its decision', async () => {
      const s = await setting()
      const [manager] = s.managers
      await rolledBack(async (tx) => {
        await run(tx, [ACCEPT_LOSS, ...DOWN, REFUSE_LOSS, ...UP])
        const ws = { workspace_id: `'${s.workspaceId}'` }
        const refused = async (sql: string, error: RegExp) => {
          await tx.$executeRawUnsafe('SAVEPOINT attempt')
          await expect(tx.$executeRawUnsafe(sql)).rejects.toThrow(error)
          await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT attempt')
        }
        const decided = { decided_at: 'now()', decided_by_id: `'${manager.id}'` }
        const accepted = {
          status: `'accepted'`,
          ...decided,
          admission: `'account_created'`,
          account_user_id: `'${manager.id}'`,
          invitation_email: `'to_send'`,
          invitation_email_at: 'now()',
        }
        const invalid: Array<Record<string, string>> = [
          { status: `'unknown'` },
          { email: `'Lea@Example.org'` },
          { email: `'lea example.org'` },
          { email: `'a@b@c'` },
          { email: `'${'a'.repeat(250)}@x.fr'` },
          { name: `''` },
          { name: `' Léa'` },
          { name: `'Léa  Bernard'` },
          { name: `E'Léa\\nBernard'` },
          { name: `'${'n'.repeat(121)}'` },
          { company_name: `''` },
          { company_name: `'Hydrolia '` },
          { company_name: `'${'c'.repeat(201)}'` },
          { company_name: `E'Hydro\\tlia'` },
          { message: `''` },
          { message: `'<b>gras</b>'` },
          { message: `E'a\\n\\n\\nb'` },
          { message: `'${'m'.repeat(2001)}'` },
          { submission_count: '0' },
          { version: '0' },
          // Decisions.
          { status: `'refused'` },
          { status: `'accepted'`, ...decided },
          { decided_at: 'now()' },
          { decided_by_id: `'${manager.id}'` },
          { admission: `'account_existing'` },
          { invitation_email: `'sent'`, invitation_email_at: 'now()' },
          { status: `'refused'`, ...decided, admission: `'account_created'` },
          { status: `'refused'`, ...decided, account_user_id: `'${manager.id}'` },
          { ...accepted, admission: `'membership_created'` },
          { ...accepted, invitation_email: `'bounced'` },
          { ...accepted, invitation_email_at: 'NULL' },
          { ...accepted, invitation_email: 'NULL', invitation_email_at: 'NULL' },
          { ...accepted, admission: 'NULL' },
        ]
        for (const columns of invalid) {
          await refused(
            insert({ ...ws, ...columns }),
            /entrepreneur_access_requests_(decision_)?check/,
          )
        }
        // At the limits, accepted; every decided shape, accepted.
        await tx.$executeRawUnsafe(
          insert({
            ...ws,
            email: `'${'a'.repeat(240)}@example.org'`,
            name: `'${'n'.repeat(120)}'`,
            company_name: `'${'c'.repeat(200)}'`,
            message: `E'${'m'.repeat(1000)}\\n\\n${'m'.repeat(998)}'`,
          }),
        )
        await tx.$executeRawUnsafe(insert({ ...ws, status: `'refused'`, ...decided }))
        for (const admission of ['account_created', 'account_existing']) {
          for (const email of ['to_send', 'sent', 'failed']) {
            await tx.$executeRawUnsafe(
              insert({
                ...ws,
                ...accepted,
                admission: `'${admission}'`,
                invitation_email: `'${email}'`,
              }),
            )
          }
        }
        // One pending request per address and workspace; decided ones leave room for a new one.
        await tx.$executeRawUnsafe(insert({ ...ws, email: `'once@example.org'` }))
        await refused(
          insert({ ...ws, email: `'once@example.org'` }),
          /Key \(workspace_id, email\)=\([^)]*, once@example\.org\) already exists/,
        )
        await tx.$executeRawUnsafe(
          insert({ ...ws, email: `'again@example.org'`, status: `'refused'`, ...decided }),
        )
        await tx.$executeRawUnsafe(insert({ ...ws, email: `'again@example.org'` }))
        // A deleted account leaves its decisions, without the author nor the account.
        const gone = randomUUID()
        await tx.$executeRawUnsafe(
          `INSERT INTO users (id, email, role, updated_at) VALUES ('${gone}', 'gone-${gone}@example.org', 'entrepreneur', now())`,
        )
        const kept = randomUUID()
        await tx.$executeRawUnsafe(
          insert({
            ...ws,
            id: `'${kept}'`,
            ...accepted,
            decided_by_id: `'${gone}'`,
            account_user_id: `'${gone}'`,
          }),
        )
        await tx.$executeRawUnsafe(`DELETE FROM users WHERE id = '${gone}'`)
        expect(
          await rows(
            tx,
            `SELECT status, decided_by_id, account_user_id FROM entrepreneur_access_requests WHERE id = '${kept}'`,
          ),
        ).toEqual([{ status: 'accepted', decided_by_id: null, account_user_id: null }])
      })
    })
  })

  describe('concurrency', () => {
    const decide = (
      actor: { id: string; role: string },
      s: Setting,
      request: { id: string; version: number },
      decision: 'accepted' | 'refused',
    ) => decisions.decide(actor, s.workspaceId, request.id, { decision, version: request.version })

    // A first transaction holds a row while the attempt waits for it, then changes things; returns
    // the attempt's outcome.
    async function whileWaiting(
      lock: string,
      attempt: () => Promise<unknown>,
      meanwhile: (tx: Tx) => Promise<unknown>,
    ): Promise<string> {
      let result!: Promise<string>
      await prisma.$transaction(
        async (tx) => {
          await tx.$queryRawUnsafe(lock)
          result = attempt().then(
            () => 'fulfilled',
            (err: unknown) => {
              if (err instanceof HttpException) {
                return (err.getResponse() as { code: string }).code
              }
              throw err
            },
          )
          await waitForBlockedQueries(1)
          await meanwhile(tx)
        },
        { timeout: 20_000 },
      )
      return result
    }

    async function waitForBlockedQueries(count: number) {
      for (let i = 0; i < 200; i++) {
        const [{ waiting }] = await prisma.$queryRaw<Array<{ waiting: bigint }>>`
          SELECT count(*) AS waiting FROM pg_locks WHERE NOT granted`
        if (waiting >= BigInt(count)) return
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      throw new Error('the attempt never waited for the lock')
    }

    it('makes one request of simultaneous first submissions of one address, each counted', async () => {
      const s = await setting()
      const results = await Promise.allSettled([0, 1, 2, 3, 4].map(() => send(s, submission(s))))
      expect(results.map(outcome)).toEqual(Array(5).fill('fulfilled'))
      const all = await prisma.entrepreneurAccessRequest.findMany({
        where: { workspaceId: s.workspaceId },
      })
      expect(all.map((r) => [r.status, r.submissionCount, r.version])).toEqual([['pending', 5, 5]])
      const journal = await prisma.auditLog.findMany({
        where: {
          actionType: 'entrepreneur_access_request_received',
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

    // R67: 999 pending, five new addresses admitted at the same moment (all waiting behind a manager's
    // workspace lock, then let go together): one gets in, the others are refused alike.
    it('never lets the queue past its cap when new addresses are admitted at the same moment', async () => {
      const s = await setting()
      const cap = ENTREPRENEUR_ACCESS_REQUEST_LIMITS.pendingPerWorkspace
      await prisma.entrepreneurAccessRequest.createMany({
        data: Array.from({ length: cap - 1 }, (_, i) => ({
          workspaceId: s.workspaceId,
          email: `filler${i}-${tag}@example.org`,
          name: 'P',
          companyName: 'P',
          lastSubmittedAt: new Date(),
        })),
      })
      let attempts!: Promise<PromiseSettledResult<unknown>[]>
      await prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT 1 FROM "workspaces" WHERE "id" = ${s.workspaceId} FOR UPDATE`
          attempts = Promise.allSettled(
            [0, 1, 2, 3, 4].map((i) =>
              send(s, submission(s, { email: `new${i}-${tag}@x.example` })),
            ),
          )
          await waitForBlockedQueries(5)
        },
        { timeout: 30_000 },
      )
      expect((await attempts).map(outcome).sort()).toEqual([
        'ENTREPRENEUR_ACCESS_QUEUE_FULL',
        'ENTREPRENEUR_ACCESS_QUEUE_FULL',
        'ENTREPRENEUR_ACCESS_QUEUE_FULL',
        'ENTREPRENEUR_ACCESS_QUEUE_FULL',
        'fulfilled',
      ])
      const waiting = await prisma.entrepreneurAccessRequest.findMany({
        where: { workspaceId: s.workspaceId, status: 'pending' },
      })
      expect(waiting).toHaveLength(cap)
      expect(waiting.filter((r) => r.email.startsWith('new'))).toHaveLength(1)
    })

    it('records nothing for a page unpublished, or its « apply » block hidden, while the submission waits', async () => {
      const s = await setting()
      const email = address('lea')
      for (const close of [
        { publicPagePublished: false },
        { publicPageBlocks: ['presentation', 'participate'] },
      ]) {
        expect(
          await whileWaiting(
            `SELECT 1 FROM "workspaces" WHERE "id" = '${s.workspaceId}' FOR UPDATE`,
            () => send(s, submission(s, { email })),
            (tx) => tx.workspace.update({ where: { id: s.workspaceId }, data: close }),
          ),
        ).toBe('ENTREPRENEUR_ACCESS_FORM_NOT_FOUND')
        expect(await prisma.entrepreneurAccessRequest.count({ where: { email } })).toBe(0)
        await prisma.workspace.update({
          where: { id: s.workspaceId },
          data: {
            publicPagePublished: true,
            publicPageBlocks: ['presentation', 'apply', 'participate'],
          },
        })
      }
    })

    it('decides once when two managers decide at once: one account, one journal entry, one email', async () => {
      const s = await setting()
      const email = address('lea')
      const request = await asked(s, email)
      const results = await Promise.allSettled([
        decide(s.managers[0], s, request, 'accepted'),
        decide(s.managers[1], s, request, 'accepted'),
        decide(s.managers[0], s, request, 'accepted'),
      ])
      expect(results.map(outcome)).toEqual(['fulfilled', 'fulfilled', 'fulfilled'])
      const accounts = await prisma.user.findMany({ where: { email } })
      expect(accounts.map((u) => [u.role, u.emailVerifiedAt])).toEqual([['entrepreneur', null]])
      expect(await prisma.workspaceMembership.count({ where: { userId: accounts[0].id } })).toBe(0)
      expect(
        await prisma.entrepreneurAccessRequest.findUniqueOrThrow({ where: { id: request.id } }),
      ).toMatchObject({
        status: 'accepted',
        version: request.version + 1,
        admission: 'account_created',
        accountUserId: accounts[0].id,
        invitationEmail: 'sent',
      })
      const journal = await prisma.auditLog.findMany({
        where: {
          actionType: 'entrepreneur_access_request_decided',
          metadata: { path: ['requestId'], equals: request.id },
        },
      })
      expect(journal).toHaveLength(1)
      expect(sent.filter((to) => to === email)).toHaveLength(1)

      // Accepting and refusing at once: one wins, the other is refused.
      const other = await asked(s, address('bob'))
      const both = await Promise.allSettled([
        decide(s.managers[0], s, other, 'accepted'),
        decide(s.managers[1], s, other, 'refused'),
      ])
      const { status } = await prisma.entrepreneurAccessRequest.findUniqueOrThrow({
        where: { id: other.id },
      })
      expect(both.map(outcome)).toEqual(
        status === 'accepted'
          ? ['fulfilled', 'ENTREPRENEUR_ACCESS_REQUEST_DECIDED']
          : ['ENTREPRENEUR_ACCESS_REQUEST_DECIDED', 'fulfilled'],
      )
      expect(await prisma.user.count({ where: { email: other.email } })).toBe(
        status === 'accepted' ? 1 : 0,
      )
    })

    it('makes one account of one new address accepted by two workspaces at once', async () => {
      const [a, b] = [await setting(), await setting()]
      const email = address('shared')
      const [ra, rb] = [await asked(a, email), await asked(b, email)]
      const results = await Promise.allSettled([
        decide(a.managers[0], a, ra, 'accepted'),
        decide(b.managers[0], b, rb, 'accepted'),
      ])
      expect(results.map(outcome)).toEqual(['fulfilled', 'fulfilled'])
      expect(await prisma.user.count({ where: { email } })).toBe(1)
      const admissions = (
        await prisma.entrepreneurAccessRequest.findMany({ where: { id: { in: [ra.id, rb.id] } } })
      )
        .map((r) => r.admission)
        .sort()
      expect(admissions).toEqual(['account_created', 'account_existing'])
    })

    it('sees a submission counted while it waited (409), or makes it a new pending request', async () => {
      const s = await setting()
      const email = address('lea')
      const request = await asked(s, email)
      expect(
        await whileWaiting(
          `SELECT 1 FROM "workspaces" WHERE "id" = '${s.workspaceId}' FOR KEY SHARE`,
          () => decide(s.managers[0], s, request, 'accepted'),
          (tx) =>
            tx.entrepreneurAccessRequest.update({
              where: { id: request.id },
              data: { submissionCount: { increment: 1 }, version: { increment: 1 } },
            }),
        ),
      ).toBe('ENTREPRENEUR_ACCESS_REQUEST_CHANGED')
      expect(await prisma.user.count({ where: { email } })).toBe(0)

      const current = await prisma.entrepreneurAccessRequest.findUniqueOrThrow({
        where: { id: request.id },
      })
      const [decided, submitted] = await Promise.allSettled([
        decide(s.managers[0], s, current, 'refused'),
        send(s, submission(s, { email })),
      ])
      expect(outcome(submitted)).toBe('fulfilled')
      const all = await prisma.entrepreneurAccessRequest.findMany({
        where: { workspaceId: s.workspaceId, email },
        orderBy: { createdAt: 'asc' },
      })
      if (outcome(decided) === 'fulfilled') {
        expect(all.map((r) => [r.status, r.submissionCount])).toEqual([
          ['refused', 2],
          ['pending', 1],
        ])
      } else {
        expect(outcome(decided)).toBe('ENTREPRENEUR_ACCESS_REQUEST_CHANGED')
        expect(all.map((r) => [r.status, r.submissionCount])).toEqual([['pending', 3]])
      }
    })

    it('decides nothing for a manager demoted while the decision waits', async () => {
      const s = await setting()
      const email = address('lea')
      const request = await asked(s, email)
      const [marie, anne] = s.managers
      expect(
        await whileWaiting(
          `SELECT 1 FROM "workspaces" WHERE "id" = '${s.workspaceId}' FOR UPDATE`,
          () => decide(marie, s, request, 'accepted'),
          (tx) =>
            tx.workspaceMembership.update({
              where: { workspaceId_userId: { workspaceId: s.workspaceId, userId: marie.id } },
              data: { canManageWorkspace: false },
            }),
        ),
      ).toBe('WORKSPACE_MANAGEMENT_FORBIDDEN')
      expect(await prisma.user.count({ where: { email } })).toBe(0)
      expect(
        await prisma.entrepreneurAccessRequest.findUniqueOrThrow({ where: { id: request.id } }),
      ).toMatchObject({ status: 'pending', version: request.version })
      await decide(anne, s, request, 'refused')
    })
  })
})
