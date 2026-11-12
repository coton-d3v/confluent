import { randomUUID } from 'node:crypto'
import { HttpException } from '@nestjs/common'
import type { ConfigService } from '@nestjs/config'
import { ThrottlerStorageService } from '@nestjs/throttler'
import type { Prisma } from '@prisma/client'
import type { AppConfig } from '../../src/config/config.schema'
import { AnswerSourcesService } from '../../src/modules/answers/answer-sources.service'
import { AuditService } from '../../src/modules/audit/audit.service'
import type {
  EmailTransport,
  SendCommitteeChangedInput,
} from '../../src/modules/auth/email/email-transport'
import { CandidaturesService } from '../../src/modules/candidatures/candidatures.service'
import type { ClassificationService } from '../../src/modules/classification/classification.service'
import { CommitteeApplicationsService } from '../../src/modules/committees/committee-applications.service'
import { CommitteeNoticesService } from '../../src/modules/committees/committee-notices.service'
import { CommitteesService } from '../../src/modules/committees/committees.service'
import { CompaniesService } from '../../src/modules/companies/companies.service'
import type { DocumentsService } from '../../src/modules/documents/documents.service'
import { MemoryStorageAdapter } from '../../src/modules/documents/storage/memory-storage.adapter'
import { DossiersService } from '../../src/modules/dossiers/dossiers.service'
import { ParticipationDecisionsService } from '../../src/modules/participation-requests/participation-decisions.service'
import { ParticipationFormTokens } from '../../src/modules/participation-requests/participation-form-token'
import { ParticipationRequestsService } from '../../src/modules/participation-requests/participation-requests.service'
import { QuestionnairesService } from '../../src/modules/questionnaires/questionnaires.service'
import { WorkspaceAccessService } from '../../src/modules/workspaces/workspace-access'
import { WorkspaceMembersService } from '../../src/modules/workspaces/workspace-members.service'
import { WorkspacesService } from '../../src/modules/workspaces/workspaces.service'
import { testDatabase } from './database'
import { committeeNoticeKindOfNotification } from '@confluent/shared'
import { NotificationsService } from '../../src/modules/notifications/notifications.service'
import { quietNotifications } from '../../src/testing/notifications'
import { committeeNoticesDown, committeeNoticesUp, notificationsDown } from './sql-file'

const UP = committeeNoticesUp()
// E10.03 undone first (its notifications go back to `committee_notices`), then, without the
// acceptance, what an operator runs.
const LATER_DOWN = notificationsDown()
const DOWN = committeeNoticesDown().slice(LATER_DOWN.length + 1)
const ACCEPT_LOSS = "SET LOCAL confluent.accept_committee_notices_loss = 'on'"
// The acceptance lasts for the whole transaction: withdrawn before a revert that must be checked.
const REFUSE_LOSS = "SET LOCAL confluent.accept_committee_notices_loss = 'off'"

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
  location: 'LIEU-PRIVE',
  meetingUrl: 'https://visio.example.org/LIEN-PRIVE',
  internalNotes: 'NOTE-INTERNE',
  participationRequestsOpen: true,
}

// What the migration creates, comparable: the table's columns, constraints, indexes and rows.
async function fingerprint(tx: Tx): Promise<string> {
  const [row] = await rows(
    tx,
    `SELECT json_build_object(
       'columns', (SELECT json_agg(x ORDER BY x) FROM (
         SELECT column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, '') AS x
         FROM information_schema.columns
         WHERE table_schema = current_schema() AND table_name = 'committee_notices') c),
       'constraints', (SELECT json_agg(x ORDER BY x) FROM (
         SELECT conname || ':' || pg_get_constraintdef(oid) AS x
         FROM pg_constraint WHERE conrelid::regclass::text = 'committee_notices') k),
       'indexes', (SELECT json_agg(indexdef ORDER BY indexdef) FROM pg_indexes
         WHERE schemaname = current_schema() AND tablename = 'committee_notices'),
       'notices', (SELECT json_agg(to_jsonb(n) ORDER BY id) FROM committee_notices n)
     )::text AS f`,
  )
  return row.f as string
}

// ROADMAP E08.06 on PostgreSQL: the migration adds the notices and nothing else, survives an
// interrupted deployment and can be undone (refusing, unless accepted, to lose a notice); the
// constraints keep each notice's values closed and one per change and person; a change waiting for
// an entry being made on the committee tells its owner; a decision and a change of date at once are
// told consistently; two changes in a row tell each person the last one only, once; a manager
// demoted while waiting tells nobody.
describe('committee notices (PostgreSQL)', () => {
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
  const config = {
    get: (key: string) => (key === 'FRONTEND_URL' ? 'https://confluent.example' : 'p'.repeat(32)),
  } as unknown as ConfigService<AppConfig, true>
  const sent: SendCommitteeChangedInput[] = []
  const transport = {
    sendCommitteeChanged: (input: SendCommitteeChangedInput) => {
      sent.push(input)
      return Promise.resolve()
    },
    sendParticipationAccepted: () => Promise.resolve(),
  } as unknown as EmailTransport
  const notices = new CommitteeNoticesService(
    prisma,
    new NotificationsService(prisma, config, transport),
  )
  const committees = new CommitteesService(prisma, access, audit, notices)
  const applications = new CommitteeApplicationsService(
    prisma,
    candidatures,
    committees,
    audit,
    quietNotifications(prisma),
  )
  const workspacesService = new WorkspacesService(prisma, audit, new MemoryStorageAdapter(), access)
  const tokens = new ParticipationFormTokens(config)
  const limits = new ThrottlerStorageService()
  const requests = new ParticipationRequestsService(
    prisma,
    access,
    audit,
    tokens,
    limits,
    quietNotifications(prisma),
  )
  const members = new WorkspaceMembersService(
    prisma,
    audit,
    access,
    config,
    transport,
    quietNotifications(prisma),
  )
  const decisions = new ParticipationDecisionsService(
    prisma,
    access,
    audit,
    members,
    requests,
    config,
    transport,
    quietNotifications(prisma),
  )
  const tag = randomUUID().slice(0, 8)
  const workspaces: string[] = []
  const forms: string[] = []
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
          actionType: { in: ['participation_request_received', 'participation_request_decided'] },
          metadata: { path: ['workspaceId'], equals: workspaceId },
        },
      })
    }
    // Their requests take the candidatures, entries and notices with them; the workspaces their
    // committees, participation requests and memberships.
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

  const address = (name: string) => `${name}-${randomUUID().slice(0, 6)}-${tag}@pg-test.dev`
  const account = (name: string, role: 'entrepreneur' | 'financeur' = 'entrepreneur') =>
    prisma.user.create({ data: { email: address(name), role, emailVerifiedAt: new Date() } })

  // A workspace receiving candidatures, its managing conseillères Marie and Anne, a planned
  // committee open to participation requests, Sophie's request retained on it.
  async function setting() {
    const slug = `pg-${randomUUID().slice(0, 12)}`
    const ws = await workspacesService.create(admin, { name: 'Structure test', slug })
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
    const managers: Array<{ id: string; role: string; membershipId: string }> = []
    for (const name of ['marie', 'anne']) {
      const u = await account(name, 'financeur')
      const m = await prisma.workspaceMembership.create({
        data: { workspaceId: ws.id, userId: u.id, role: 'conseiller', canManageWorkspace: true },
      })
      managers.push({ id: u.id, role: u.role, membershipId: m.id })
    }
    const [marie] = managers
    const committee = await committees.create(marie, ws.id, JUNE)
    const sophie = await account('sophie')
    const sophieRequest = await sentRequest(sophie.id, ws.id)
    await applications.changeAsOwner(sophie.id, sophieRequest.candidatureId, committee.id, {
      to: 'applied',
      version: null,
    })
    await applications.changeForWorkspace(marie, ws.id, committee.id, {
      candidatureId: sophieRequest.candidatureId,
      to: 'accepted',
      version: 1,
    })
    return { workspaceId: ws.id, slug, managers, committeeId: committee.id, sophieId: sophie.id }
  }
  type Setting = Awaited<ReturnType<typeof setting>>

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

  // A pending participation request of a new address for the committee.
  async function asked(s: Setting, name: string) {
    const email = address(name)
    await requests.submit(
      s.slug,
      {
        name: 'Claire Martin',
        email,
        committeeIds: [s.committeeId],
        formToken: tokens.issue(s.workspaceId, Date.now() - 5000),
      },
      { ip: `198.51.100.${++ip % 250}` },
    )
    return prisma.participationRequest.findFirstOrThrow({
      where: { workspaceId: s.workspaceId, email, status: 'pending' },
    })
  }

  const current = (s: Setting) => committees.get(s.managers[0], s.workspaceId, s.committeeId)
  const reschedule = async (s: Setting, time: string, who = s.managers[0]) =>
    committees.update(who, s.workspaceId, s.committeeId, {
      ...JUNE,
      time,
      version: (await current(s)).version,
    })
  // E10.03: the notices are the notifications of the committee's changes.
  const noticesOf = async (committeeId: string) =>
    (
      await prisma.notification.findMany({
        where: { committeeId },
        orderBy: [{ committeeVersion: 'asc' }, { recipientId: 'asc' }],
      })
    ).map((n) => ({
      ...n,
      kind: committeeNoticeKindOfNotification(n.kind),
      state: n.emailState,
      committeeVersion: n.committeeVersion!,
    }))

  const insert = (columns: Record<string, string>) => {
    const values = {
      id: `'${randomUUID()}'`,
      committee_version: '1',
      kind: `'cancelled'`,
      state: `'to_send'`,
      state_at: 'now()',
      ...columns,
    }
    return `INSERT INTO committee_notices (${Object.keys(values).join(', ')}) VALUES (${Object.values(values).join(', ')})`
  }

  describe('migration', () => {
    it('adds the notices and nothing else; undone (refusing to lose a notice unless accepted), then applied again', async () => {
      const s = await setting()
      await reschedule(s, '15:00')
      expect(await noticesOf(s.committeeId)).toHaveLength(1)
      await rolledBack(async (tx) => {
        const counts = `SELECT (SELECT count(*)::int FROM committees) AS committees,
                  (SELECT count(*)::int FROM committee_applications) AS entries,
                  (SELECT count(*)::int FROM participation_requests) AS requests,
                  (SELECT count(*)::int FROM users) AS users,
                  (SELECT count(*)::int FROM audit_log) AS journal`
        const [before] = await rows(tx, counts)
        // A notice recorded (back from E10.03's notifications): refused unless accepted.
        await run(tx, LATER_DOWN)
        await tx.$executeRawUnsafe('SAVEPOINT before_down')
        await expect(run(tx, DOWN)).rejects.toThrow(/would be lost/)
        await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT before_down')
        await run(tx, [...LATER_DOWN, ACCEPT_LOSS, ...DOWN, REFUSE_LOSS])
        expect(await rows(tx, `SELECT to_regclass('committee_notices')::text AS t`)).toEqual([
          { t: null },
        ])
        expect((await rows(tx, counts))[0]).toEqual(before)
        await run(tx, UP)
        const migrated = await fingerprint(tx)
        expect(migrated).toContain('committee_notices_check')
        expect(migrated).toContain(
          'committee_notices_committee_id_committee_version_recipient__key',
        )
        expect((await rows(tx, counts))[0]).toEqual(before)
        // Without any notice: undone without acceptance, applied again, the same.
        await run(tx, DOWN)
        await run(tx, UP)
        expect(await fingerprint(tx)).toEqual(migrated)
      })
    })

    it('survives an interrupted deployment: any prefix of the migration, then all of it, gives the same database', async () => {
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
    it('keeps a notice’s values closed, one per change and person, inside its committee’s workspace', async () => {
      const s = await setting()
      const other = await setting()
      const entry = await prisma.committeeApplication.findFirstOrThrow({
        where: { committeeId: s.committeeId },
      })
      await rolledBack(async (tx) => {
        await run(tx, [...LATER_DOWN, ACCEPT_LOSS, ...DOWN, REFUSE_LOSS, ...UP])
        const ok = {
          workspace_id: `'${s.workspaceId}'`,
          committee_id: `'${s.committeeId}'`,
          recipient_id: `'${s.sophieId}'`,
          application_id: `'${entry.id}'`,
        }
        const refused = async (columns: Record<string, string>, error: RegExp) => {
          await tx.$executeRawUnsafe('SAVEPOINT attempt')
          await expect(tx.$executeRawUnsafe(insert(columns))).rejects.toThrow(error)
          await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT attempt')
        }
        await refused({ ...ok, kind: `'moved'` }, /committee_notices_check/)
        await refused({ ...ok, state: `'delivered'` }, /committee_notices_check/)
        await refused({ ...ok, committee_version: '0' }, /committee_notices_check/)
        await refused({ ...ok, application_id: 'NULL' }, /committee_notices_check/)
        // Another workspace's committee under this workspace: refused by the composite key.
        await refused(
          { ...ok, committee_id: `'${other.committeeId}'` },
          /committee_notices_committee_id_workspace_id_fkey/,
        )
        await tx.$executeRawUnsafe(insert(ok))
        await refused(ok, /committee_id, committee_version, recipient_id.*already exists/)
        // Every kind and state the rules name is accepted.
        let version = 10
        for (const kind of ['rescheduled', 'cancelled', 'restored']) {
          for (const state of ['to_send', 'sending', 'sent', 'failed', 'superseded']) {
            await tx.$executeRawUnsafe(
              insert({
                ...ok,
                kind: `'${kind}'`,
                state: `'${state}'`,
                committee_version: String(++version),
              }),
            )
          }
        }
        // Gone with the entry it comes from.
        await tx.$executeRawUnsafe(`DELETE FROM committee_applications WHERE id = '${entry.id}'`)
        expect(
          await rows(
            tx,
            `SELECT count(*)::int AS n FROM committee_notices WHERE committee_id = '${s.committeeId}'`,
          ),
        ).toEqual([{ n: 0 }])
      })
    })
  })

  describe('concurrency', () => {
    async function waitForBlockedQuery() {
      for (let i = 0; i < 100; i++) {
        const [{ waiting }] = await prisma.$queryRaw<Array<{ waiting: bigint }>>`
          SELECT count(*) AS waiting FROM pg_locks WHERE NOT granted`
        if (waiting > 0n) return
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      throw new Error('the attempt never waited for the lock')
    }

    it('tells the owner of an entry being made on the committee while the cancellation waits for it', async () => {
      const s = await setting()
      const marc = await account('marc')
      const marcRequest = await sentRequest(marc.id, s.workspaceId)
      const before = await current(s)
      let cancelled!: Promise<string>
      // An entry being made as E08.03 makes it: the committee held FOR SHARE, the entry written,
      // not yet committed — the cancellation starts meanwhile.
      await prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT 1 FROM "committees" WHERE "id" = ${s.committeeId} FOR SHARE`
          await tx.committeeApplication.create({
            data: {
              committeeId: s.committeeId,
              candidatureId: marcRequest.candidatureId,
              workspaceId: s.workspaceId,
              status: 'applied',
              statusBy: 'owner',
              statusActorId: marc.id,
              statusChangedAt: new Date(),
              version: 1,
            },
          })
          cancelled = committees
            .changeStatus(s.managers[0], s.workspaceId, s.committeeId, {
              status: 'cancelled',
              version: before.version,
            })
            .then(
              () => 'fulfilled',
              (err: unknown) => String(err),
            )
          await waitForBlockedQuery()
        },
        { timeout: 20_000 },
      )
      expect(await cancelled).toBe('fulfilled')
      expect(
        (await noticesOf(s.committeeId)).map((n) => [n.recipientId, n.kind, n.state]).sort(),
      ).toEqual(
        [
          [marc.id, 'cancelled', 'sent'],
          [s.sophieId, 'cancelled', 'sent'],
        ].sort(),
      )
    })

    it('tells an accepted participant of a new date exactly when the acceptance came first', async () => {
      const s = await setting()
      const [marie, anne] = s.managers
      for (let round = 0; round < 3; round++) {
        const request = await asked(s, `claire${round}`)
        const before = await current(s)
        let attempts!: Promise<PromiseSettledResult<unknown>[]>
        // Both wait for the workspace's row, then run one after the other, in either order.
        await prisma.$transaction(
          async (tx) => {
            await tx.$queryRaw`SELECT 1 FROM "workspaces" WHERE "id" = ${s.workspaceId} FOR UPDATE`
            attempts = Promise.allSettled([
              round % 2 === 0
                ? decisions.decide(anne, s.workspaceId, request.id, {
                    decision: 'accepted',
                    version: request.version,
                  })
                : Promise.resolve(),
              committees.update(marie, s.workspaceId, s.committeeId, {
                ...JUNE,
                time: `1${round}:30`,
                version: before.version,
              }),
              round % 2 === 1
                ? decisions.decide(anne, s.workspaceId, request.id, {
                    decision: 'accepted',
                    version: request.version,
                  })
                : Promise.resolve(),
            ])
            await waitForBlockedQuery()
          },
          { timeout: 20_000 },
        )
        expect((await attempts).map(outcome)).toEqual(['fulfilled', 'fulfilled', 'fulfilled'])
        const decided = await prisma.participationRequest.findUniqueOrThrow({
          where: { id: request.id },
        })
        const committee = await prisma.committee.findUniqueOrThrow({
          where: { id: s.committeeId },
        })
        const told = (await noticesOf(s.committeeId)).filter(
          (n) => n.committeeVersion === committee.version && n.recipientId === decided.memberUserId,
        )
        // Accepted before the new date was recorded: told of it; after: not (the acceptance email
        // gives the committee as it then was).
        expect(told.length).toBe(decided.decidedAt! < committee.updatedAt ? 1 : 0)
      }
    })

    it('tells each person the last of two changes in a row, once; the earlier unsent notices are superseded', async () => {
      const s = await setting()
      const participant = await asked(s, 'nadia')
      await decisions.decide(s.managers[0], s.workspaceId, participant.id, {
        decision: 'accepted',
        version: participant.version,
      })
      sent.length = 0
      // The first change's emails wait until the second change is recorded.
      const deliver = notices.deliver.bind(notices)
      let release!: () => void
      const held = new Promise<void>((resolve) => (release = resolve))
      const spy = jest.spyOn(notices, 'deliver').mockImplementationOnce(async (ids: string[]) => {
        await held
        return deliver(ids)
      })
      const first = reschedule(s, '15:00')
      for (let i = 0; i < 100 && (await noticesOf(s.committeeId)).length === 0; i++) {
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
      const after = await current(s)
      await committees.changeStatus(s.managers[1], s.workspaceId, s.committeeId, {
        status: 'cancelled',
        version: after.version,
      })
      release()
      await first
      spy.mockRestore()
      expect(sent.map((m) => m.kind)).toEqual(['cancelled', 'cancelled'])
      expect(
        (await noticesOf(s.committeeId)).map((n) => [
          n.committeeVersion - after.version,
          n.kind,
          n.state,
        ]),
      ).toEqual([
        [0, 'rescheduled', 'superseded'],
        [0, 'rescheduled', 'superseded'],
        [1, 'cancelled', 'sent'],
        [1, 'cancelled', 'sent'],
      ])
      // Delivered again, by two senders at once: nothing leaves twice.
      const ids = (await noticesOf(s.committeeId)).map((n) => n.id)
      await Promise.all([notices.deliver(ids), notices.deliver(ids)])
      expect(sent).toHaveLength(2)
    })

    it('applies one of two changes made at once from the same version, and tells its recipients once', async () => {
      const s = await setting()
      const before = await current(s)
      sent.length = 0
      const results = await Promise.allSettled([
        committees.update(s.managers[0], s.workspaceId, s.committeeId, {
          ...JUNE,
          time: '16:00',
          version: before.version,
        }),
        committees.changeStatus(s.managers[1], s.workspaceId, s.committeeId, {
          status: 'cancelled',
          version: before.version,
        }),
      ])
      expect(results.map(outcome).sort()).toEqual(['COMMITTEE_CHANGED', 'fulfilled'])
      const told = await noticesOf(s.committeeId)
      expect(told).toHaveLength(1)
      expect(told[0]).toMatchObject({
        recipientId: s.sophieId,
        committeeVersion: before.version + 1,
        state: 'sent',
      })
      expect(sent).toHaveLength(1)
      expect(sent[0].kind).toBe(told[0].kind)
    })

    it('tells nobody when the manager is demoted while the change waits for the workspace (R53)', async () => {
      const s = await setting()
      const before = await current(s)
      let attempt!: Promise<string>
      await prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT 1 FROM "workspaces" WHERE "id" = ${s.workspaceId} FOR UPDATE`
          attempt = committees
            .changeStatus(s.managers[0], s.workspaceId, s.committeeId, {
              status: 'cancelled',
              version: before.version,
            })
            .then(
              () => 'fulfilled',
              (err: unknown) =>
                err instanceof HttpException
                  ? (err.getResponse() as { code: string }).code
                  : String(err),
            )
          await waitForBlockedQuery()
          await tx.workspaceMembership.update({
            where: { id: s.managers[0].membershipId },
            data: { canManageWorkspace: false },
          })
        },
        { timeout: 20_000 },
      )
      expect(await attempt).not.toBe('fulfilled')
      expect(await noticesOf(s.committeeId)).toEqual([])
      expect((await current(s)).status).toBe('planned')
    })
  })
})
