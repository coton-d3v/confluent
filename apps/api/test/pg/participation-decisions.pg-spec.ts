import { randomUUID } from 'node:crypto'
import { HttpException } from '@nestjs/common'
import type { ConfigService } from '@nestjs/config'
import { ThrottlerStorageService } from '@nestjs/throttler'
import type { Prisma } from '@prisma/client'
import type { AppConfig } from '../../src/config/config.schema'
import { AuditService } from '../../src/modules/audit/audit.service'
import type { EmailTransport } from '../../src/modules/auth/email/email-transport'
import { CommitteesService } from '../../src/modules/committees/committees.service'
import { MemoryStorageAdapter } from '../../src/modules/documents/storage/memory-storage.adapter'
import { ParticipationDecisionsService } from '../../src/modules/participation-requests/participation-decisions.service'
import { ParticipationFormTokens } from '../../src/modules/participation-requests/participation-form-token'
import { ParticipationRequestsService } from '../../src/modules/participation-requests/participation-requests.service'
import { WorkspaceAccessService } from '../../src/modules/workspaces/workspace-access'
import { WorkspaceMembersService } from '../../src/modules/workspaces/workspace-members.service'
import { WorkspacesService } from '../../src/modules/workspaces/workspaces.service'
import { quietNotices, testDatabase } from './database'
import {
  committeeNoticesDown,
  participationDecisionsDown,
  participationDecisionsUp,
  participationRequestsDown,
  participationRequestsUp,
} from './sql-file'

const UP = participationDecisionsUp()
// Without the acceptance: what an operator runs first.
const DOWN = participationDecisionsDown().slice(1)
// E08.06's notices reference the requests: undone first.
const LATER_DOWN = committeeNoticesDown()
const ACCEPT_LOSS = "SET LOCAL confluent.accept_participation_decisions_loss = 'on'"
// The acceptance lasts for the whole transaction: withdrawn before a revert that must be checked.
const REFUSE_LOSS = "SET LOCAL confluent.accept_participation_decisions_loss = 'off'"

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

const NEW_COLUMNS = `('decided_at', 'decided_by_id', 'admission', 'member_user_id', 'invitation_email', 'invitation_email_at')`

// What the migration changes, comparable: the requests' new columns, their constraints and indexes,
// the journal's new action and the rows.
async function fingerprint(tx: Tx): Promise<string> {
  const [row] = await rows(
    tx,
    `SELECT json_build_object(
       'columns', (SELECT json_agg(x ORDER BY x) FROM (
         SELECT column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, '') AS x
         FROM information_schema.columns
         WHERE table_schema = current_schema() AND table_name = 'participation_requests'
           AND column_name IN ${NEW_COLUMNS}) c),
       'constraints', (SELECT json_agg(x ORDER BY x) FROM (
         SELECT conname || ':' || pg_get_constraintdef(oid) AS x
         FROM pg_constraint WHERE conrelid = 'participation_requests'::regclass) k),
       'indexes', (SELECT json_agg(indexdef ORDER BY indexdef) FROM pg_indexes
         WHERE schemaname = current_schema() AND tablename = 'participation_requests'),
       'actions', (SELECT json_agg(enumlabel ORDER BY enumsortorder) FROM pg_enum
         WHERE enumtypid = 'audit_action'::regtype AND enumlabel LIKE 'participation_request_%'),
       'requests', (SELECT json_agg(to_jsonb(r) ORDER BY id) FROM participation_requests r)
     )::text AS f`,
  )
  return row.f as string
}

const statusCheck = async (tx: Tx) =>
  (
    await rows(
      tx,
      `SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint
       WHERE conname = 'participation_requests_check'`,
    )
  )[0]?.d

// ROADMAP E08.05 on PostgreSQL: the migration adds the decision to the requests without touching
// anything else, survives an interrupted deployment and can be undone (refusing, unless accepted, to
// lose a decision or its journal; E08.04's constraint restored as it wrote it); the constraints tie
// each status to its decision; two managers deciding at once decide once (one account, one
// membership, one journal entry); a submission adding sessions meanwhile is either seen by the
// decision (`409`) or becomes a new pending request; a manager demoted while waiting decides nothing.
describe('participation decisions (PostgreSQL)', () => {
  const prisma = testDatabase()
  const audit = new AuditService(prisma)
  const access = new WorkspaceAccessService(prisma)
  const committees = new CommitteesService(prisma, access, audit, quietNotices(prisma))
  const workspacesService = new WorkspacesService(prisma, audit, new MemoryStorageAdapter(), access)
  const config = {
    get: (key: string) => (key === 'FRONTEND_URL' ? 'https://confluent.example' : 'p'.repeat(32)),
  } as unknown as ConfigService<AppConfig, true>
  const tokens = new ParticipationFormTokens(config)
  const limits = new ThrottlerStorageService()
  const sent: string[] = []
  const transport = {
    sendParticipationAccepted: (input: { to: string }) => {
      sent.push(input.to)
      return Promise.resolve()
    },
  } as unknown as EmailTransport
  const requests = new ParticipationRequestsService(prisma, access, audit, tokens, limits)
  const members = new WorkspaceMembersService(prisma, audit, access, config, transport)
  const decisions = new ParticipationDecisionsService(
    prisma,
    access,
    audit,
    members,
    requests,
    config,
    transport,
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
          actionType: {
            in: [
              'participation_request_received',
              'participation_request_discarded',
              'participation_request_decided',
            ],
          },
          metadata: { path: ['workspaceId'], equals: workspaceId },
        },
      })
    }
    // The workspaces take their committees, requests and memberships with them.
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

  // A workspace, two managing conseillères and a committee offered on its public form.
  async function setting() {
    const slug = `pg-${randomUUID().slice(0, 12)}`
    const ws = await workspacesService.create(admin, { name: 'Structure test', slug })
    workspaces.push(ws.id)
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
    const committee = await committees.create(managers[0], ws.id, JUNE)
    return { workspaceId: ws.id, slug, managers, committeeId: committee.id }
  }

  type Setting = Awaited<ReturnType<typeof setting>>
  // A pending request of `email`, as the managers read it.
  async function asked(s: Setting, email: string) {
    await requests.submit(
      s.slug,
      {
        name: 'Claire Martin',
        organization: 'Angels',
        email,
        message: 'Bonjour.',
        committeeIds: [s.committeeId],
        formToken: tokens.issue(s.workspaceId, Date.now() - 5000),
      },
      { ip: `198.51.100.${++ip % 250}` },
    )
    return prisma.participationRequest.findFirstOrThrow({
      where: { workspaceId: s.workspaceId, email, status: 'pending' },
    })
  }

  const insert = (columns: Record<string, string>) => {
    const values = {
      id: `'${randomUUID()}'`,
      email: `'x-${randomUUID().slice(0, 8)}@example.org'`,
      name: `'X'`,
      last_submitted_at: 'now()',
      updated_at: 'now()',
      ...columns,
    }
    return `INSERT INTO participation_requests (${Object.keys(values).join(', ')}) VALUES (${Object.values(values).join(', ')})`
  }

  describe('migration', () => {
    it('adds the decision and nothing else; undone (refusing to lose a decision or its journal unless accepted), then applied again', async () => {
      const s = await setting()
      const waiting = await asked(s, address('claire'))
      await rolledBack(async (tx) => {
        const counts = `SELECT (SELECT count(*)::int FROM participation_requests) AS requests,
                  (SELECT count(*)::int FROM participation_request_committees) AS sessions,
                  (SELECT count(*)::int FROM workspace_memberships) AS memberships,
                  (SELECT count(*)::int FROM users) AS users,
                  (SELECT count(*)::int FROM audit_log) AS journal`
        await run(tx, [...LATER_DOWN, ACCEPT_LOSS, ...DOWN, REFUSE_LOSS])
        const e0804 = await statusCheck(tx)
        expect(e0804).toContain(`(status = 'pending'::text)`)
        const [before] = await rows(tx, counts)
        await run(tx, UP)
        expect((await rows(tx, counts))[0]).toEqual(before)
        const migrated = await fingerprint(tx)
        expect(migrated).toContain('"participation_request_decided"')
        expect(migrated).toContain('participation_requests_decision_check')
        // The pending request is read as undecided.
        expect(
          await rows(
            tx,
            `SELECT status, decided_at, admission, invitation_email FROM participation_requests
             WHERE id = '${waiting.id}'`,
          ),
        ).toEqual([
          { status: 'pending', decided_at: null, admission: null, invitation_email: null },
        ])

        // Without any decision: undone without acceptance, applied again, the same; E08.04's
        // constraint restored as its own migration writes it.
        await run(tx, DOWN)
        expect(await statusCheck(tx)).toEqual(e0804)
        await tx.$executeRawUnsafe('SAVEPOINT e0804')
        await run(tx, [...participationRequestsDown(), ...participationRequestsUp()])
        expect(await statusCheck(tx)).toEqual(e0804)
        await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT e0804')
        await run(tx, UP)
        expect(await fingerprint(tx)).toEqual(migrated)

        // A decided request, or only the journal of a decision: refused unless accepted; accepted,
        // they go — the pending request stays —, nothing else.
        for (const statements of [
          [
            insert({
              workspace_id: `'${s.workspaceId}'`,
              status: `'refused'`,
              decided_at: 'now()',
            }),
          ],
          [
            `INSERT INTO audit_log (id, action_type, metadata)
             VALUES ('${randomUUID()}', 'participation_request_decided', '{}')`,
          ],
        ]) {
          await tx.$executeRawUnsafe('SAVEPOINT noted')
          const [counted] = await rows(tx, counts)
          await run(tx, statements)
          await tx.$executeRawUnsafe('SAVEPOINT before_down')
          await expect(run(tx, DOWN)).rejects.toThrow(/would be lost/)
          await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT before_down')
          await run(tx, [...LATER_DOWN, ACCEPT_LOSS, ...DOWN, REFUSE_LOSS])
          expect(
            await rows(
              tx,
              `SELECT (SELECT count(*)::int FROM information_schema.columns
                       WHERE table_schema = current_schema() AND table_name = 'participation_requests'
                         AND column_name IN ${NEW_COLUMNS}) AS columns,
                      (SELECT count(*)::int FROM participation_requests WHERE id = '${waiting.id}') AS pending,
                      (SELECT count(*)::int FROM audit_log
                       WHERE action_type::text = 'participation_request_decided') AS journal`,
            ),
          ).toEqual([{ columns: 0, pending: 1, journal: 0 }])
          expect((await rows(tx, counts))[0]).toEqual(counted)
          await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT noted')
        }
      })
    })

    it('survives an interrupted deployment: any prefix of the migration, then all of it, gives the same database', async () => {
      const s = await setting()
      await asked(s, address('claire'))
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
    it('ties each status to its decision', async () => {
      const s = await setting()
      const [manager] = s.managers
      await rolledBack(async (tx) => {
        await run(tx, [...LATER_DOWN, ACCEPT_LOSS, ...DOWN, REFUSE_LOSS, ...UP])
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
          member_user_id: `'${manager.id}'`,
          invitation_email: `'to_send'`,
          invitation_email_at: 'now()',
        }
        const check = /participation_requests_(decision_)?check/
        const invalid: Array<Record<string, string>> = [
          { status: `'unknown'` },
          { status: `'refused'` },
          { status: `'accepted'`, ...decided },
          { decided_at: 'now()' },
          { decided_by_id: `'${manager.id}'` },
          { admission: `'already_member'` },
          { invitation_email: `'sent'`, invitation_email_at: 'now()' },
          { status: `'refused'`, ...decided, admission: `'account_created'` },
          { status: `'refused'`, ...decided, member_user_id: `'${manager.id}'` },
          {
            status: `'refused'`,
            ...decided,
            invitation_email: `'failed'`,
            invitation_email_at: 'now()',
          },
          { ...accepted, admission: `'reactivated'` },
          { ...accepted, invitation_email: `'bounced'` },
          { ...accepted, invitation_email: 'NULL', invitation_email_at: 'NULL' },
          { ...accepted, invitation_email_at: 'NULL' },
          { ...accepted, admission: 'NULL' },
        ]
        for (const columns of invalid) {
          await refused(insert({ ...ws, ...columns }), check)
        }
        // Valid: refused; accepted in each admission and email state; their accounts gone (NULL).
        await tx.$executeRawUnsafe(insert({ ...ws, status: `'refused'`, ...decided }))
        await tx.$executeRawUnsafe(
          insert({ ...ws, status: `'refused'`, decided_at: 'now()', decided_by_id: 'NULL' }),
        )
        for (const admission of ['account_created', 'membership_created', 'already_member']) {
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
        await tx.$executeRawUnsafe(
          insert({ ...ws, ...accepted, decided_by_id: 'NULL', member_user_id: 'NULL' }),
        )
        // Decided requests leave room for a new pending one of the same address.
        await tx.$executeRawUnsafe(
          insert({ ...ws, email: `'again@example.org'`, status: `'refused'`, ...decided }),
        )
        await tx.$executeRawUnsafe(insert({ ...ws, email: `'again@example.org'` }))
        // A deleted account leaves its decisions, without the author.
        const gone = randomUUID()
        await tx.$executeRawUnsafe(
          `INSERT INTO users (id, email, role, updated_at) VALUES ('${gone}', 'gone-${gone}@example.org', 'financeur', now())`,
        )
        const decidedByGone = randomUUID()
        await tx.$executeRawUnsafe(
          insert({
            ...ws,
            id: `'${decidedByGone}'`,
            ...accepted,
            decided_by_id: `'${gone}'`,
            member_user_id: `'${gone}'`,
          }),
        )
        await tx.$executeRawUnsafe(`DELETE FROM users WHERE id = '${gone}'`)
        expect(
          await rows(
            tx,
            `SELECT status, decided_by_id, member_user_id FROM participation_requests WHERE id = '${decidedByGone}'`,
          ),
        ).toEqual([{ status: 'accepted', decided_by_id: null, member_user_id: null }])
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

    it('decides once when two managers decide at once: one account, one membership, one journal entry, one email', async () => {
      const s = await setting()
      const email = address('claire')
      const request = await asked(s, email)
      const results = await Promise.allSettled([
        decide(s.managers[0], s, request, 'accepted'),
        decide(s.managers[1], s, request, 'accepted'),
        decide(s.managers[0], s, request, 'accepted'),
      ])
      expect(results.map(outcome)).toEqual(['fulfilled', 'fulfilled', 'fulfilled'])
      const accounts = await prisma.user.findMany({ where: { email } })
      expect(accounts).toHaveLength(1)
      expect(
        await prisma.workspaceMembership.count({
          where: { workspaceId: s.workspaceId, userId: accounts[0].id },
        }),
      ).toBe(1)
      expect(
        await prisma.participationRequest.findUniqueOrThrow({ where: { id: request.id } }),
      ).toMatchObject({ status: 'accepted', version: request.version + 1, invitationEmail: 'sent' })
      const journal = await prisma.auditLog.findMany({
        where: {
          actionType: 'participation_request_decided',
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
      const status = (
        await prisma.participationRequest.findUniqueOrThrow({ where: { id: other.id } })
      ).status
      expect(both.map(outcome)).toEqual(
        status === 'accepted'
          ? ['fulfilled', 'PARTICIPATION_REQUEST_DECIDED']
          : ['PARTICIPATION_REQUEST_DECIDED', 'fulfilled'],
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
      const [account] = await prisma.user.findMany({ where: { email } })
      expect(await prisma.workspaceMembership.count({ where: { userId: account.id } })).toBe(2)
      const admissions = (
        await prisma.participationRequest.findMany({ where: { id: { in: [ra.id, rb.id] } } })
      )
        .map((r) => r.admission)
        .sort()
      expect(admissions).toEqual(['account_created', 'membership_created'])
    })

    // A first transaction holds a row while the decision waits for it, then changes things; returns
    // the decision's outcome.
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
      throw new Error('the decision never waited for the lock')
    }

    it('sees a submission that added sessions while it waited (409), or makes it a new pending request', async () => {
      const s = await setting()
      const july = await committees.create(s.managers[0], s.workspaceId, {
        ...JUNE,
        date: '2099-07-10',
      })
      const email = address('claire')
      const request = await asked(s, email)
      // A submission holds the workspace (as E08.04's does, FOR KEY SHARE) and adds a session while
      // the decision waits: the decision reads the new version, refuses, and created nothing.
      expect(
        await whileWaiting(
          `SELECT 1 FROM "workspaces" WHERE "id" = '${s.workspaceId}' FOR KEY SHARE`,
          () => decide(s.managers[0], s, request, 'accepted'),
          async (tx) => {
            await tx.participationRequestCommittee.create({
              data: { requestId: request.id, committeeId: july.id, workspaceId: s.workspaceId },
            })
            await tx.participationRequest.update({
              where: { id: request.id },
              data: { submissionCount: { increment: 1 }, version: { increment: 1 } },
            })
          },
        ),
      ).toBe('PARTICIPATION_REQUEST_CHANGED')
      expect(await prisma.user.count({ where: { email } })).toBe(0)

      // Through the services, at the same moment: either the submission merged first (the decision
      // is refused, the request still pending), or the decision came first (the submission is a new
      // pending request). Never a submission lost, never a decision on what the manager did not see.
      const current = await prisma.participationRequest.findUniqueOrThrow({
        where: { id: request.id },
      })
      const [decided, submitted] = await Promise.allSettled([
        decide(s.managers[0], s, current, 'refused'),
        requests.submit(
          s.slug,
          {
            name: 'Claire Martin',
            email,
            committeeIds: [s.committeeId],
            formToken: tokens.issue(s.workspaceId, Date.now() - 5000),
          },
          { ip: `198.51.100.${++ip % 250}` },
        ),
      ])
      expect(outcome(submitted)).toBe('fulfilled')
      const all = await prisma.participationRequest.findMany({
        where: { workspaceId: s.workspaceId, email },
        orderBy: { createdAt: 'asc' },
      })
      if (outcome(decided) === 'fulfilled') {
        expect(all.map((r) => [r.status, r.submissionCount])).toEqual([
          ['refused', 2],
          ['pending', 1],
        ])
      } else {
        expect(outcome(decided)).toBe('PARTICIPATION_REQUEST_CHANGED')
        expect(all.map((r) => [r.status, r.submissionCount])).toEqual([['pending', 3]])
      }
    })

    it('decides nothing for a manager demoted while the decision waits', async () => {
      const s = await setting()
      const email = address('claire')
      const request = await asked(s, email)
      const [marie, anne] = s.managers
      // Anne, holding the workspace as a membership write does, withdraws Marie's right.
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
        await prisma.participationRequest.findUniqueOrThrow({ where: { id: request.id } }),
      ).toMatchObject({ status: 'pending', version: request.version })
      // Anne still decides.
      await decide(anne, s, request, 'refused')
    })
  })
})
