import { randomUUID } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { AuditService } from '../../src/modules/audit/audit.service'
import { ReadingSessionsService } from '../../src/modules/reading-sessions/reading-sessions.service'
import { companyOf, testDatabase } from './database'
import { readingSessionsDown, readingSessionsUp } from './sql-file'

const UP = readingSessionsUp()
// Without the acceptance: what an operator runs first.
const DOWN = readingSessionsDown().slice(1)
const ACCEPT_LOSS = "SET LOCAL confluent.accept_reading_sessions_loss = 'on'"
// The acceptance lasts for the whole transaction: withdrawn before a revert that must be checked.
const REFUSE_LOSS = "SET LOCAL confluent.accept_reading_sessions_loss = 'off'"

class RolledBack extends Error {}

type Tx = Prisma.TransactionClient
const run = async (tx: Tx, statements: string[]) => {
  for (const sql of statements) await tx.$executeRawUnsafe(sql)
}
const rows = (tx: Tx, sql: string) => tx.$queryRawUnsafe<Array<Record<string, unknown>>>(sql)

// What the migration creates, comparable: the table's columns, constraints, indexes and rows (their
// generated ids aside).
async function fingerprint(tx: Tx): Promise<string> {
  const [row] = await rows(
    tx,
    `SELECT json_build_object(
       'columns', (SELECT json_agg(x ORDER BY x) FROM (
         SELECT column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, '') AS x
         FROM information_schema.columns
         WHERE table_schema = current_schema() AND table_name = 'reading_sessions') c),
       'constraints', (SELECT json_agg(x ORDER BY x) FROM (
         SELECT conname || ':' || pg_get_constraintdef(oid) AS x
         FROM pg_constraint WHERE conrelid::regclass::text = 'reading_sessions') k),
       'indexes', (SELECT json_agg(indexdef ORDER BY indexdef) FROM pg_indexes
         WHERE schemaname = current_schema() AND tablename = 'reading_sessions'),
       'rows', (SELECT json_agg(to_jsonb(r) - 'id' ORDER BY share_link_id, started_at, reader_id)
         FROM reading_sessions r)
     )::text AS f`,
  )
  return row.f as string
}

// ROADMAP E07.08 on PostgreSQL: the migration groups the views counted so far into sessions by the
// rule of the application, survives an interrupted deployment and can be undone (refusing, unless
// accepted, to lose a measured time); its CHECKs hold. Simultaneous loads of one reader open one
// session, journaled once; simultaneous heartbeats never credit more than the time elapsed.
describe('reading sessions (PostgreSQL)', () => {
  const prisma = testDatabase()
  const audit = new AuditService(prisma)
  const sessions = new ReadingSessionsService(prisma, audit)
  const tag = randomUUID().slice(0, 8)
  let formId = ''
  let versionId = ''

  beforeAll(async () => {
    const form = await prisma.questionnaire.create({
      data: { slug: `readings-${tag}`, name: 'Profil' },
    })
    formId = form.id
    const version = await prisma.questionnaireVersion.create({
      data: { questionnaireId: form.id, version: 1, status: 'published' },
    })
    versionId = version.id
  })

  afterAll(async () => {
    const users = await prisma.user.findMany({
      where: { email: { endsWith: `-${tag}@pg-test.dev`, mode: 'insensitive' } },
    })
    const ids = users.map((u) => u.id)
    await prisma.auditLog.deleteMany({ where: { actorId: { in: ids } } })
    // Their requests take their shares and sessions with them.
    await prisma.dossier.deleteMany({ where: { userId: { in: ids } } })
    await prisma.company.deleteMany({ where: { ownerId: { in: ids } } })
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

  // A request of a new owner, shared with a new reader (the address stored in another case).
  async function sharedRequest() {
    const owner = await user('owner', 'entrepreneur')
    const reader = await user('reader')
    const dossier = await prisma.dossier.create({
      data: {
        userId: owner.id,
        companyId: await companyOf(prisma, owner.id, versionId),
        name: 'Biosensio',
        slug: `biosensio-${randomUUID().slice(0, 8)}`,
        questionnaireVersionId: versionId,
      },
    })
    const link = await prisma.shareLink.create({
      data: {
        dossierId: dossier.id,
        recipientEmail: reader.email.toUpperCase(),
        token: randomUUID(),
        status: 'active',
        accessLevel: 'public',
      },
    })
    return { owner, reader, dossier, link }
  }

  const opening = (r: Awaited<ReturnType<typeof sharedRequest>>) => ({
    reader: r.reader,
    dossierId: r.dossier.id,
    shareLinkId: r.link.id,
    channel: 'share' as const,
    journal: {},
  })

  describe('migration', () => {
    it('groups the views counted so far into sessions, by share, 30 minutes apart; replayed, the same', async () => {
      const shared = await sharedRequest()
      const other = await user('other')
      await rolledBack(async (tx) => {
        const migrated = await fingerprint(tx)
        // Without any measured time: undone without acceptance, applied again (twice), the same.
        await run(tx, DOWN)
        expect(await rows(tx, `SELECT to_regclass('reading_sessions')::text AS t`)).toEqual([
          { t: null },
        ])
        const t0 = Date.UTC(2026, 9, 1, 8, 0)
        const at = (minutes: number) => new Date(t0 + minutes * 60_000).toISOString()
        const entry = (
          action: string,
          minutes: number,
          opts: { link?: string | null; actor?: string | null } = {},
        ) =>
          `INSERT INTO audit_log (id, dossier_id, share_link_id, action_type, actor_id, metadata, created_at)
           VALUES ('${randomUUID()}', '${shared.dossier.id}',
                   ${opts.link === null ? 'NULL' : `'${opts.link ?? shared.link.id}'`},
                   '${action}', ${opts.actor ? `'${opts.actor}'` : 'NULL'}, '{}', '${at(minutes)}')`
        for (const sql of [
          // A first session: three loads within 30 minutes of one another, 50 minutes in all.
          entry('share_link_viewed', 0),
          entry('share_link_viewed', 25),
          entry('share_link_viewed', 50),
          // 31 minutes later: a second one, continued as an opportunity read through the share.
          entry('share_link_viewed', 81),
          entry('opportunity_viewed', 90, { actor: shared.reader.id }),
          // An opportunity read first: a third session, through its page; its author is the reader.
          entry('opportunity_viewed', 200, { actor: other.id }),
          entry('share_link_viewed', 201),
          // Never a view: a pool's reader without a share, and anything else journaled.
          entry('opportunity_viewed', 5, { link: null, actor: other.id }),
          entry('share_link_access_requested', 6),
        ]) {
          await tx.$executeRawUnsafe(sql)
        }
        await run(tx, UP)
        await run(tx, UP)
        const made = await rows(
          tx,
          `SELECT reader_id, channel, started_at, last_seen_at, active_ms FROM reading_sessions
           WHERE dossier_id = '${shared.dossier.id}' ORDER BY started_at`,
        )
        expect(made).toEqual([
          {
            reader_id: shared.reader.id,
            channel: 'share',
            started_at: new Date(at(0)),
            last_seen_at: new Date(at(50)),
            active_ms: null,
          },
          {
            reader_id: shared.reader.id,
            channel: 'share',
            started_at: new Date(at(81)),
            last_seen_at: new Date(at(90)),
            active_ms: null,
          },
          {
            reader_id: other.id,
            channel: 'opportunity',
            started_at: new Date(at(200)),
            last_seen_at: new Date(at(201)),
            active_ms: null,
          },
        ])
        // The journal is untouched; nothing else is made of it.
        expect(
          await rows(
            tx,
            `SELECT count(*)::int AS n FROM audit_log WHERE dossier_id = '${shared.dossier.id}'`,
          ),
        ).toEqual([{ n: 9 }])
        // Read by the owner as three views of the share, without a duration.
        const read = await tx.readingSession.findMany({
          where: { dossierId: shared.dossier.id, shareLinkId: { not: null } },
        })
        expect(read).toHaveLength(3)

        // The schema is the one deployed; only the backfilled rows differ.
        await tx.$executeRawUnsafe(
          `DELETE FROM reading_sessions WHERE dossier_id = '${shared.dossier.id}'`,
        )
        expect(await fingerprint(tx)).toEqual(migrated)
      })
    })

    it('is undone, refusing to lose a measured time unless accepted', async () => {
      const shared = await sharedRequest()
      await rolledBack(async (tx) => {
        const counts = `SELECT (SELECT count(*)::int FROM dossiers) AS dossiers,
                  (SELECT count(*)::int FROM share_links) AS shares,
                  (SELECT count(*)::int FROM users) AS users,
                  (SELECT count(*)::int FROM audit_log) AS journal`
        const [before] = await rows(tx, counts)
        const now = new Date().toISOString()
        // A session without measured time (or none at all): nothing lost.
        await tx.$executeRawUnsafe(
          `INSERT INTO reading_sessions (id, dossier_id, share_link_id, channel, started_at, last_seen_at, active_ms)
           VALUES ('${randomUUID()}', '${shared.dossier.id}', '${shared.link.id}', 'share', '${now}', '${now}', 0)`,
        )
        await tx.$executeRawUnsafe('SAVEPOINT unmeasured')
        await run(tx, DOWN)
        expect((await rows(tx, counts))[0]).toEqual(before)
        await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT unmeasured')
        // A measured time: refused unless accepted; accepted, the sessions go, nothing else.
        await tx.$executeRawUnsafe(
          `INSERT INTO reading_sessions (id, dossier_id, share_link_id, channel, started_at, last_seen_at, active_ms)
           VALUES ('${randomUUID()}', '${shared.dossier.id}', '${shared.link.id}', 'opportunity', '${now}', '${now}', 1500)`,
        )
        await tx.$executeRawUnsafe('SAVEPOINT before_down')
        await expect(run(tx, DOWN)).rejects.toThrow(/would be lost/)
        await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT before_down')
        await run(tx, [ACCEPT_LOSS, ...DOWN, REFUSE_LOSS])
        expect(await rows(tx, `SELECT to_regclass('reading_sessions')::text AS t`)).toEqual([
          { t: null },
        ])
        expect((await rows(tx, counts))[0]).toEqual(before)
      })
    })

    it('survives an interrupted deployment: any prefix of the migration, then all of it, gives the same database', async () => {
      const shared = await sharedRequest()
      await prisma.auditLog.create({
        data: {
          actionType: 'share_link_viewed',
          dossierId: shared.dossier.id,
          shareLinkId: shared.link.id,
        },
      })
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
    it('refuses an unknown page, a time out of bounds and a last activity before the start; gone with the share or the request, kept without the reader', async () => {
      const shared = await sharedRequest()
      const now = new Date()
      const base = {
        dossierId: shared.dossier.id,
        readerId: shared.reader.id,
        shareLinkId: shared.link.id,
        channel: 'share',
        startedAt: now,
        lastSeenAt: now,
        activeMs: 0,
      }
      for (const wrong of [
        { channel: 'mcp' },
        { activeMs: -1 },
        { activeMs: 3 * 3_600_000 + 1 },
        { lastSeenAt: new Date(now.getTime() - 1) },
      ]) {
        await expect(prisma.readingSession.create({ data: { ...base, ...wrong } })).rejects.toThrow(
          /check constraint/i,
        )
      }
      const kept = await prisma.readingSession.create({
        data: { ...base, activeMs: 3 * 3_600_000 },
      })
      await prisma.readingSession.create({ data: { ...base, shareLinkId: null, activeMs: null } })
      await prisma.user.delete({ where: { id: shared.reader.id } })
      expect(await prisma.readingSession.findUnique({ where: { id: kept.id } })).toMatchObject({
        readerId: null,
      })
      await prisma.shareLink.delete({ where: { id: shared.link.id } })
      expect(await prisma.readingSession.count({ where: { dossierId: shared.dossier.id } })).toBe(1)
      await prisma.dossier.delete({ where: { id: shared.dossier.id } })
      expect(await prisma.readingSession.count({ where: { dossierId: shared.dossier.id } })).toBe(0)
    })
  })

  describe('concurrency', () => {
    it('opens one session for simultaneous loads of one reader, journaled once', async () => {
      for (let round = 0; round < 4; round++) {
        const shared = await sharedRequest()
        const opened = await Promise.all(
          Array.from({ length: 6 }, () => sessions.open(opening(shared))),
        )
        expect(new Set(opened.map((o) => o?.id)).size).toBe(1)
        expect(opened[0]).not.toBeNull()
        expect(await prisma.readingSession.count({ where: { dossierId: shared.dossier.id } })).toBe(
          1,
        )
        expect(
          await prisma.auditLog.count({
            where: { dossierId: shared.dossier.id, actionType: 'share_link_viewed' },
          }),
        ).toBe(1)
      }
    })

    it('never credits simultaneous heartbeats more than the time elapsed', async () => {
      for (let round = 0; round < 4; round++) {
        const shared = await sharedRequest()
        const { id } = (await sessions.open(opening(shared)))!
        // Last activity 20 s ago; three tabs report 15 s each at the same moment.
        const ago = new Date(Date.now() - 20_000)
        await prisma.readingSession.update({
          where: { id },
          data: { startedAt: ago, lastSeenAt: ago },
        })
        const results = await Promise.all(
          Array.from({ length: 3 }, () => sessions.heartbeat(shared.reader, id, 15_000)),
        )
        expect(results).toEqual([{ open: true }, { open: true }, { open: true }])
        const { activeMs } = (await prisma.readingSession.findUnique({ where: { id } }))!
        expect(activeMs).toBeGreaterThanOrEqual(15_000)
        expect(activeMs).toBeLessThanOrEqual(20_500)
      }
    })

    it('reads the sessions through shares only, for the owner and the platform count', async () => {
      const shared = await sharedRequest()
      const since = new Date()
      await sessions.open(opening(shared))
      await sessions.open({ ...opening(shared), shareLinkId: null, channel: 'opportunity' })
      expect((await sessions.shareSessions(shared.dossier.id)).map((s) => s.shareLinkId)).toEqual([
        shared.link.id,
      ])
      expect(await prisma.readingSession.count({ where: { dossierId: shared.dossier.id } })).toBe(2)
      expect(await sessions.countShareViewsSince(since)).toBeGreaterThanOrEqual(1)
      expect(await sessions.countShareViewsSince(new Date(Date.now() + 60_000))).toBe(0)
    })
  })
})
