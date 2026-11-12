import { randomUUID } from 'node:crypto'
import type { ConfigService } from '@nestjs/config'
import type { Prisma } from '@prisma/client'
import type { AppConfig } from '../../src/config/config.schema'
import { AuditService } from '../../src/modules/audit/audit.service'
import type { AuthService } from '../../src/modules/auth/auth.service'
import type {
  EmailTransport,
  SendNotificationInput,
} from '../../src/modules/auth/email/email-transport'
import type { ClassificationService } from '../../src/modules/classification/classification.service'
import { CompaniesService } from '../../src/modules/companies/companies.service'
import type { DocumentsService } from '../../src/modules/documents/documents.service'
import { DossiersService } from '../../src/modules/dossiers/dossiers.service'
import {
  NotificationsService,
  type NotificationDraft,
} from '../../src/modules/notifications/notifications.service'
import { OpportunitiesService } from '../../src/modules/opportunities/opportunities.service'
import { PledgesService } from '../../src/modules/opportunities/pledges.service'
import { QuestionnairesService } from '../../src/modules/questionnaires/questionnaires.service'
import { ReadingSessionsService } from '../../src/modules/reading-sessions/reading-sessions.service'
import { ShareLinksService } from '../../src/modules/share-links/share-links.service'
import { quietNotifications } from '../../src/testing/notifications'
import { testDatabase } from './database'
import { notificationsDown, notificationsUp, performanceIndexesUp } from './sql-file'

const UP = notificationsUp()
// Without the acceptance: what an operator runs first.
const DOWN = notificationsDown().slice(1)
const ACCEPT_LOSS = "SET LOCAL confluent.accept_notifications_loss = 'on'"
// The acceptance lasts for the whole transaction: withdrawn before a revert that must be checked.
const REFUSE_LOSS = "SET LOCAL confluent.accept_notifications_loss = 'off'"

class RolledBack extends Error {}

type Tx = Prisma.TransactionClient
const run = async (tx: Tx, statements: string[]) => {
  for (const sql of statements) await tx.$executeRawUnsafe(sql)
}
const rows = (tx: Tx, sql: string) => tx.$queryRawUnsafe<Array<Record<string, unknown>>>(sql)

// What a table holds, comparable: its columns, constraints, indexes and rows.
async function fingerprint(tx: Tx, table: string): Promise<string> {
  const [row] = await rows(
    tx,
    `SELECT json_build_object(
       'columns', (SELECT json_agg(x ORDER BY x) FROM (
         SELECT column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, '') AS x
         FROM information_schema.columns
         WHERE table_schema = current_schema() AND table_name = '${table}') c),
       'constraints', (SELECT json_agg(x ORDER BY x) FROM (
         SELECT conname || ':' || pg_get_constraintdef(oid) AS x
         FROM pg_constraint WHERE conrelid::regclass::text = '${table}') k),
       'indexes', (SELECT json_agg(indexdef ORDER BY indexdef) FROM pg_indexes
         WHERE schemaname = current_schema() AND tablename = '${table}'),
       'rows', (SELECT json_agg(to_jsonb(n) ORDER BY id) FROM "${table}" n)
     )::text AS f`,
  )
  return row.f as string
}

// ROADMAP E10.03 on PostgreSQL: the migration turns E08.06's notices into notifications, row for
// row, survives an interrupted deployment and can be undone (refusing, unless accepted, to lose a
// notification); its CHECK keeps the closed lists and a committee's change whole; one notification per
// event and person, even recorded twice at once, its email sent once; a double click on a pledge
// tells its owner once.
describe('notifications (PostgreSQL)', () => {
  const prisma = testDatabase()
  const audit = new AuditService(prisma)
  const readings = new ReadingSessionsService(prisma, audit)
  const questionnaires = new QuestionnairesService(prisma)
  const config = { get: () => 'http://localhost:5173' } as unknown as ConfigService<AppConfig, true>
  const mailed: SendNotificationInput[] = []
  const notifications = new NotificationsService(prisma, config, {
    sendNotification: async (input: SendNotificationInput) => {
      // Slow enough for two senders to overlap.
      await new Promise((resolve) => setTimeout(resolve, 30))
      mailed.push(input)
    },
  } as unknown as EmailTransport)
  const dossiers = new DossiersService(
    prisma,
    questionnaires,
    { evaluate: () => Promise.resolve(null) } as unknown as ClassificationService,
    audit,
    new CompaniesService(prisma),
  )
  const shareLinks = new ShareLinksService(
    prisma,
    audit,
    config,
    dossiers,
    { listForDossier: () => Promise.resolve([]) } as unknown as DocumentsService,
    {} as AuthService,
    questionnaires,
    { sendShareInvite: () => Promise.resolve() } as unknown as EmailTransport,
    readings,
    quietNotifications(prisma),
  )
  const opportunities = new OpportunitiesService(prisma, dossiers, shareLinks, readings)
  const pledges = new PledgesService(prisma, opportunities, dossiers, audit, notifications)
  const tag = randomUUID().slice(0, 8)
  const workspaces: string[] = []
  let formId = ''
  let versionId = ''

  beforeAll(async () => {
    const form = await prisma.questionnaire.create({
      data: { slug: `notifications-${tag}`, name: 'Profil' },
    })
    formId = form.id
    versionId = (
      await prisma.questionnaireVersion.create({
        data: { questionnaireId: form.id, version: 1, status: 'published' },
      })
    ).id
  })

  afterAll(async () => {
    const users = await prisma.user.findMany({
      where: { email: { endsWith: `-${tag}@pg-test.dev`, mode: 'insensitive' } },
    })
    const ids = users.map((u) => u.id)
    await prisma.auditLog.deleteMany({ where: { actorId: { in: ids } } })
    // Their requests take their shares, pledges and notifications with them.
    await prisma.dossier.deleteMany({ where: { userId: { in: ids } } })
    await prisma.company.deleteMany({ where: { ownerId: { in: ids } } })
    await prisma.workspace.deleteMany({ where: { id: { in: workspaces } } })
    await prisma.questionnaireVersion.deleteMany({ where: { questionnaireId: formId } })
    await prisma.questionnaire.deleteMany({ where: { id: formId } })
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
        { timeout: 120_000 },
      ),
    ).rejects.toThrow(RolledBack)

  const user = (name: string, role: 'entrepreneur' | 'financeur' = 'financeur') =>
    prisma.user.create({
      data: {
        email: `${name}-${randomUUID().slice(0, 6)}-${tag}@pg-test.dev`,
        role,
        emailVerifiedAt: new Date(),
      },
    })

  // A published request of a new owner, shared with a new investor.
  async function sharedRequest() {
    const owner = await user('owner', 'entrepreneur')
    const investor = await user('investor')
    const company = await prisma.company.create({
      data: { ownerId: owner.id, name: 'Biosensio', profileVersionId: versionId },
    })
    const dossier = await prisma.dossier.create({
      data: {
        userId: owner.id,
        companyId: company.id,
        name: 'Biosensio',
        slug: `biosensio-${randomUUID().slice(0, 8)}`,
        questionnaireVersionId: versionId,
        publicationStatus: 'published',
        publishedAt: new Date(),
        submittedAt: new Date(),
      },
    })
    await prisma.shareLink.create({
      data: {
        dossierId: dossier.id,
        recipientEmail: investor.email,
        token: randomUUID(),
        status: 'active',
        accessLevel: 'public',
      },
    })
    return { owner, investor, dossier }
  }

  // A workspace, its committee and a participation request for it — what an E08.06 notice needs.
  async function committeeSetting(tx: Tx) {
    const workspace = await tx.workspace.create({
      data: { name: 'Structure test', slug: `pg-${randomUUID().slice(0, 12)}` },
    })
    workspaces.push(workspace.id)
    const committee = await tx.committee.create({
      data: {
        workspaceId: workspace.id,
        name: 'Comité de juin',
        localStart: new Date('2099-06-10T14:00:00.000Z'),
        timeZone: 'Europe/Paris',
        startsAt: new Date('2099-06-10T12:00:00.000Z'),
        version: 2,
      },
    })
    const request = await tx.participationRequest.create({
      data: {
        workspaceId: workspace.id,
        email: `claire-${tag}@pg-test.dev`,
        name: 'Claire',
        lastSubmittedAt: new Date(),
      },
    })
    return { workspace, committee, request }
  }

  const pledgeDraft = (recipientId: string, dossierId: string, key: string): NotificationDraft => ({
    recipientId,
    kind: 'pledge_received',
    key,
    subject: `pledge:${key}`,
    dossierId,
    payload: { dossierId, dossierName: 'Biosensio', dossierSlug: 'biosensio', change: 'new' },
  })

  describe('migration', () => {
    it('turns each E08.06 notice into a notification of the same id, recipient, committee, version, reasons and email state', async () => {
      const recipient = await user('participant')
      await rolledBack(async (tx) => {
        await run(tx, [ACCEPT_LOSS, ...DOWN, REFUSE_LOSS])
        const { workspace, committee, request } = await committeeSetting(tx)
        const id = randomUUID()
        await tx.$executeRawUnsafe(
          `INSERT INTO committee_notices (id, workspace_id, committee_id, committee_version, kind,
             recipient_id, participation_request_id, state, state_at, created_at)
           VALUES ('${id}', '${workspace.id}', '${committee.id}', 2, 'rescheduled',
             '${recipient.id}', '${request.id}', 'failed', '2026-11-01T10:00:00Z', '2026-11-01T09:00:00Z')`,
        )
        const notices = await fingerprint(tx, 'committee_notices')
        await run(tx, UP)
        expect(await rows(tx, `SELECT to_regclass('committee_notices')::text AS t`)).toEqual([
          { t: null },
        ])
        const [n] = await rows(tx, `SELECT * FROM notifications WHERE id = '${id}'`)
        expect(n).toMatchObject({
          recipient_id: recipient.id,
          kind: 'committee_rescheduled',
          dedup_key: `committee_changed:${committee.id}:2`,
          subject_key: `committee:${committee.id}`,
          workspace_id: workspace.id,
          committee_id: committee.id,
          committee_version: 2,
          application_id: null,
          participation_request_id: request.id,
          read_at: null,
          email_state: 'failed',
          email_state_at: new Date('2026-11-01T10:00:00Z'),
          created_at: new Date('2026-11-01T09:00:00Z'),
          payload: {
            workspaceId: workspace.id,
            workspaceName: 'Structure test',
            committeeName: 'Comité de juin',
            date: '2099-06-10',
            time: '14:00',
            timeZone: 'Europe/Paris',
            previous: null,
            audience: 'participant',
            candidatureId: null,
          },
        })
        // Readable as written: its text, and the managers' list (E08.06) unchanged.
        // Undone: the notice back, row for row (nothing else to lose: no refusal).
        await run(tx, DOWN)
        expect(await fingerprint(tx, 'committee_notices')).toEqual(notices)
        await run(tx, UP)
        await run(tx, UP)
        expect(
          await rows(tx, `SELECT count(*)::int AS n FROM notifications WHERE id = '${id}'`),
        ).toEqual([{ n: 1 }])
      })
    })

    it('refuses to undo while a notification would be lost — another kind, or one read — unless accepted', async () => {
      const { owner, dossier } = await sharedRequest()
      await prisma.$transaction((tx) =>
        notifications.recordIn(tx, [pledgeDraft(owner.id, dossier.id, `refuse-${tag}`)]),
      )
      await rolledBack(async (tx) => {
        const counts = `SELECT (SELECT count(*)::int FROM dossiers) AS dossiers,
                  (SELECT count(*)::int FROM users) AS users,
                  (SELECT count(*)::int FROM committees) AS committees,
                  (SELECT count(*)::int FROM audit_log) AS journal`
        const [before] = await rows(tx, counts)
        const migrated = await fingerprint(tx, 'notifications')
        await tx.$executeRawUnsafe('SAVEPOINT before_down')
        await expect(run(tx, DOWN)).rejects.toThrow(/notifications would be lost/)
        await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT before_down')
        await run(tx, [ACCEPT_LOSS, ...DOWN, REFUSE_LOSS])
        expect(await rows(tx, `SELECT to_regclass('notifications')::text AS t`)).toEqual([
          { t: null },
        ])
        expect((await rows(tx, counts))[0]).toEqual(before)
        // Applied again with the later migration that indexes the table (E10.08), as a deployment
        // replays the chain.
        await run(tx, [...UP, ...performanceIndexesUp()])
        const reapplied = await fingerprint(tx, 'notifications')
        expect(JSON.parse(reapplied).constraints).toEqual(JSON.parse(migrated).constraints)
        expect(JSON.parse(reapplied).indexes).toEqual(JSON.parse(migrated).indexes)
        expect(JSON.parse(reapplied).columns).toEqual(JSON.parse(migrated).columns)
        // A committee's notification read: its reading would be lost too.
        const { workspace, committee, request } = await committeeSetting(tx)
        await tx.$executeRawUnsafe(
          `INSERT INTO notifications (id, recipient_id, kind, dedup_key, subject_key, workspace_id,
             committee_id, committee_version, participation_request_id, payload, read_at,
             email_state, email_state_at)
           VALUES ('${randomUUID()}', '${owner.id}', 'committee_cancelled', 'c', 's',
             '${workspace.id}', '${committee.id}', 2, '${request.id}', '{}', now(), 'sent', now())`,
        )
        await tx.$executeRawUnsafe('SAVEPOINT read_one')
        await expect(run(tx, DOWN)).rejects.toThrow(/notifications would be lost/)
        await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT read_one')
      })
    })

    it('survives an interrupted deployment: any prefix of the migration, then all of it, gives the same database', async () => {
      await rolledBack(async (tx) => {
        await run(tx, [ACCEPT_LOSS, ...DOWN, REFUSE_LOSS])
        await tx.$executeRawUnsafe('SAVEPOINT legacy')
        await run(tx, UP)
        const reference = await fingerprint(tx, 'notifications')
        for (let done = 0; done <= UP.length; done++) {
          await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT legacy')
          await run(tx, UP.slice(0, done))
          await run(tx, UP)
          expect({ done, result: await fingerprint(tx, 'notifications') }).toEqual({
            done,
            result: reference,
          })
        }
      })
    })
  })

  describe('constraints', () => {
    // On the constraints as the migration file writes them (applied again here), not as installed.
    it('keeps the kinds and email states closed, a committee’s change whole, one notification per event and person', async () => {
      const someone = await user('someone')
      await rolledBack(async (tx) => {
        await run(tx, [ACCEPT_LOSS, ...DOWN, REFUSE_LOSS, ...UP])
        const { workspace, committee, request } = await committeeSetting(tx)
        const insert = (columns: Record<string, string>) => {
          const values = {
            id: `'${randomUUID()}'`,
            recipient_id: `'${someone.id}'`,
            kind: `'interest_received'`,
            dedup_key: `'k'`,
            subject_key: `'s'`,
            payload: `'{}'`,
            email_state: `'none'`,
            email_state_at: 'now()',
            ...columns,
          }
          return `INSERT INTO notifications (${Object.keys(values).join(', ')}) VALUES (${Object.values(values).join(', ')})`
        }
        const refused = async (columns: Record<string, string>, error: RegExp) => {
          await tx.$executeRawUnsafe('SAVEPOINT attempt')
          await expect(tx.$executeRawUnsafe(insert(columns))).rejects.toThrow(error)
          await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT attempt')
        }
        const change = {
          kind: `'committee_cancelled'`,
          workspace_id: `'${workspace.id}'`,
          committee_id: `'${committee.id}'`,
          committee_version: '2',
          participation_request_id: `'${request.id}'`,
          email_state: `'to_send'`,
        }
        await refused({ kind: `'gossip'` }, /notifications_check/)
        await refused({ email_state: `'delivered'` }, /notifications_check/)
        await refused({ payload: `'[]'` }, /notifications_check/)
        await refused({ dedup_key: `''` }, /notifications_check/)
        await refused({ dedup_key: `'${'k'.repeat(301)}'` }, /notifications_check/)
        // A committee's change: its committee, version, workspace, a reason and an email.
        await refused({ ...change, committee_version: 'NULL' }, /notifications_check/)
        await refused({ ...change, committee_version: '0' }, /notifications_check/)
        await refused({ ...change, participation_request_id: 'NULL' }, /notifications_check/)
        await refused({ ...change, email_state: `'none'` }, /notifications_check/)
        // Another kind naming a committee: refused.
        await refused(
          { ...change, kind: `'pledge_received'`, email_state: `'to_send'` },
          /notifications_check/,
        )
        await refused(
          { ...change, workspace_id: `'${randomUUID()}'` },
          /notifications_committee_id_workspace_id_fkey|notifications_workspace_id_fkey/,
        )
        await tx.$executeRawUnsafe(insert({ ...change, dedup_key: `'change'` }))
        await tx.$executeRawUnsafe(insert({}))
        await refused({}, /recipient_id, dedup_key.*already exists/)
        // Every kind and email state the rules name is accepted.
        let n = 0
        for (const kind of [
          'share_invited',
          'share_level_changed',
          'share_revoked',
          'workspace_invited',
          'company_transfer_proposed',
          'company_transfer_answered',
          'interest_received',
          'pledge_received',
          'candidature_status_changed',
          'committee_application_changed',
          'showcase_card_hidden',
          'participation_accepted',
          'entrepreneur_access_accepted',
          'participation_request_received',
          'entrepreneur_access_request_received',
        ]) {
          for (const state of ['none', 'to_send', 'sending', 'sent', 'failed', 'superseded']) {
            await tx.$executeRawUnsafe(
              insert({ kind: `'${kind}'`, email_state: `'${state}'`, dedup_key: `'k${++n}'` }),
            )
          }
        }
        // Gone with the committee, and with the request it comes from.
        await tx.$executeRawUnsafe(`DELETE FROM participation_requests WHERE id = '${request.id}'`)
        expect(
          await rows(
            tx,
            `SELECT count(*)::int AS n FROM notifications WHERE committee_id = '${committee.id}'`,
          ),
        ).toEqual([{ n: 0 }])
      })
    })
  })

  describe('concurrency', () => {
    it('records the same event recorded twice at once once, and sends its email once', async () => {
      const { owner, dossier } = await sharedRequest()
      mailed.length = 0
      const key = `same-${randomUUID()}`
      // The first holds its row uncommitted while the second tries the same key.
      let release!: () => void
      const held = new Promise<void>((resolve) => (release = resolve))
      const first = prisma.$transaction(
        async (tx) => {
          const ids = await notifications.recordIn(tx, [pledgeDraft(owner.id, dossier.id, key)])
          await held
          return ids
        },
        { timeout: 20_000 },
      )
      await new Promise((resolve) => setTimeout(resolve, 200))
      const second = prisma.$transaction(
        (tx) => notifications.recordIn(tx, [pledgeDraft(owner.id, dossier.id, key)]),
        { timeout: 20_000 },
      )
      await new Promise((resolve) => setTimeout(resolve, 300))
      release()
      const [a, b] = await Promise.all([first, second])
      expect([a.length, b.length]).toEqual([1, 0])
      await Promise.all([notifications.deliver([...a, ...b]), notifications.deliver(a)])
      const told = await prisma.notification.findMany({
        where: { recipientId: owner.id, dedupKey: key },
      })
      expect(told.map((n) => n.emailState)).toEqual(['sent'])
      expect(mailed).toHaveLength(1)
    })

    it('tells the owner of a pledge sent twice at once (a double click) once', async () => {
      const { owner, investor, dossier } = await sharedRequest()
      mailed.length = 0
      const body = {
        intention: 'likely' as const,
        amountEur: 25_000,
        showName: false,
        showAmount: false,
        version: null,
      }
      const results = await Promise.allSettled([
        pledges.set({ id: investor.id, email: investor.email }, dossier.id, body),
        pledges.set({ id: investor.id, email: investor.email }, dossier.id, body),
      ])
      expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled'])
      const told = await prisma.notification.findMany({
        where: { recipientId: owner.id, kind: 'pledge_received' },
      })
      expect(told.map((n) => n.emailState)).toEqual(['sent'])
      expect(mailed.filter((m) => m.to === owner.email)).toHaveLength(1)
      // The investor is told nothing.
      expect(await prisma.notification.count({ where: { recipientId: investor.id } })).toBe(0)
    })
  })
})
