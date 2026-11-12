import { randomUUID } from 'node:crypto'
import { HttpException } from '@nestjs/common'
import type { ConfigService } from '@nestjs/config'
import type { Prisma } from '@prisma/client'
import type { AppConfig } from '../../src/config/config.schema'
import { AuditService } from '../../src/modules/audit/audit.service'
import type { AuthService } from '../../src/modules/auth/auth.service'
import type { EmailTransport } from '../../src/modules/auth/email/email-transport'
import type { ClassificationService } from '../../src/modules/classification/classification.service'
import { CompaniesService } from '../../src/modules/companies/companies.service'
import type { DocumentsService } from '../../src/modules/documents/documents.service'
import { DossiersService } from '../../src/modules/dossiers/dossiers.service'
import { QuestionnairesService } from '../../src/modules/questionnaires/questionnaires.service'
import { ReadingSessionsService } from '../../src/modules/reading-sessions/reading-sessions.service'
import { ShareLinksService } from '../../src/modules/share-links/share-links.service'
import { testDatabase } from './database'
import { shareLinksDown, shareLinksUp } from './sql-file'
import { quietNotifications } from '../../src/testing/notifications'

const UP = shareLinksUp()
// Without the acceptance: what an operator runs first.
const DOWN = shareLinksDown().slice(1)
const ACCEPT_LOSS = "SET LOCAL confluent.accept_share_level_journal_loss = 'on'"
const REFUSE_LOSS = "SET LOCAL confluent.accept_share_level_journal_loss = 'off'"

class RolledBack extends Error {}

type Tx = Prisma.TransactionClient
const run = async (tx: Tx, statements: string[]) => {
  for (const sql of statements) await tx.$executeRawUnsafe(sql)
}
const rows = (tx: Tx, sql: string) => tx.$queryRawUnsafe<Array<Record<string, unknown>>>(sql)

const outcome = (result: PromiseSettledResult<unknown>) => {
  if (result.status === 'fulfilled') return 'fulfilled'
  const err = result.reason as HttpException
  return err instanceof HttpException ? err.getStatus() : String(err)
}

// What the migration changes, comparable: the constraints of `share_links` and its rows.
async function fingerprint(tx: Tx): Promise<string> {
  const [row] = await rows(
    tx,
    `SELECT json_build_object(
       'constraints', (SELECT json_agg(x ORDER BY x) FROM (
         SELECT conname || ':' || pg_get_constraintdef(oid) AS x
         FROM pg_constraint WHERE conrelid::regclass::text = 'share_links') k),
       'links', (SELECT json_agg(to_jsonb(s) ORDER BY id) FROM share_links s)
     )::text AS f`,
  )
  return row.f as string
}

// ROADMAP E07.01 on PostgreSQL: the migration closes the levels of a share (backfill of an unknown
// level to `public`, which it was already read as), survives an interrupted deployment and can be
// undone (refusing, unless accepted, to lose the journal of level changes). Under the dossier's
// lock, simultaneous invitations of one recipient create one share and an invitation never slips
// past an archiving; simultaneous revocations journal one; a level change never overwrites a
// revocation.
describe('nominative shares (PostgreSQL)', () => {
  const prisma = testDatabase()
  const audit = new AuditService(prisma)
  const readings = new ReadingSessionsService(prisma, audit)
  const dossiers = new DossiersService(
    prisma,
    new QuestionnairesService(prisma),
    { evaluate: () => Promise.resolve(null) } as unknown as ClassificationService,
    audit,
    new CompaniesService(prisma),
  )
  const shares = new ShareLinksService(
    prisma,
    audit,
    { get: () => 'http://localhost:5173' } as unknown as ConfigService<AppConfig, true>,
    dossiers,
    {} as DocumentsService,
    {} as AuthService,
    new QuestionnairesService(prisma),
    { sendShareInvite: () => Promise.resolve() } as unknown as EmailTransport,
    readings,
    quietNotifications(prisma),
  )
  const tag = randomUUID().slice(0, 8)

  afterAll(async () => {
    const users = await prisma.user.findMany({
      where: { email: { endsWith: `-${tag}@pg-test.dev` } },
    })
    const ids = users.map((u) => u.id)
    const owned = await prisma.dossier.findMany({ where: { userId: { in: ids } } })
    await prisma.auditLog.deleteMany({
      where: { OR: [{ actorId: { in: ids } }, { dossierId: { in: owned.map((d) => d.id) } }] },
    })
    // Their requests take their shares with them.
    await prisma.dossier.deleteMany({ where: { userId: { in: ids } } })
    await prisma.company.deleteMany({ where: { ownerId: { in: ids } } })
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
        { timeout: 60_000 },
      ),
    ).rejects.toThrow(RolledBack)

  const email = (name: string) => `${name}-${randomUUID().slice(0, 6)}-${tag}@pg-test.dev`

  async function request() {
    const owner = await prisma.user.create({
      data: { email: email('sophie'), role: 'entrepreneur', emailVerifiedAt: new Date() },
    })
    const dossier = await dossiers.create({
      owner: { id: owner.id, role: owner.role },
      name: 'Biosensio',
    })
    return { owner: { id: owner.id, email: owner.email }, dossierId: dossier.id }
  }

  describe('migration', () => {
    it('closes the levels without changing what is read; undone (refusing to lose the journal unless accepted), then applied again', async () => {
      const { owner, dossierId } = await request()
      await rolledBack(async (tx) => {
        await run(tx, [ACCEPT_LOSS, ...DOWN, REFUSE_LOSS])
        // Before E07.01 a level was free text: an unknown one, read as `public`.
        await tx.$executeRawUnsafe(
          `INSERT INTO share_links (id, dossier_id, recipient_email, token, status, access_level)
           VALUES ('${randomUUID()}', '${dossierId}', 'a@pg-test.dev', '${randomUUID()}', 'active', 'total'),
                  ('${randomUUID()}', '${dossierId}', 'b@pg-test.dev', '${randomUUID()}', 'active', 'partiel')`,
        )
        const counts = `SELECT (SELECT count(*)::int FROM share_links) AS links,
                  (SELECT count(*)::int FROM audit_log) AS journal,
                  (SELECT count(*)::int FROM dossiers) AS dossiers`
        const [before] = await rows(tx, counts)
        await run(tx, UP)
        expect((await rows(tx, counts))[0]).toEqual(before)
        expect(
          await rows(
            tx,
            `SELECT recipient_email AS email, access_level AS level FROM share_links
             WHERE dossier_id = '${dossierId}' ORDER BY 1`,
          ),
        ).toEqual([
          { email: 'a@pg-test.dev', level: 'public' },
          { email: 'b@pg-test.dev', level: 'partiel' },
        ])
        await tx.$executeRawUnsafe('SAVEPOINT closed')
        await expect(
          tx.$executeRawUnsafe(
            `UPDATE share_links SET access_level = 'total' WHERE dossier_id = '${dossierId}'`,
          ),
        ).rejects.toThrow(/share_links_access_level_check/)
        await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT closed')
        const migrated = await fingerprint(tx)

        // Without any level change journaled: undone without acceptance, applied again, the same.
        await run(tx, DOWN)
        await run(tx, UP)
        expect(await fingerprint(tx)).toEqual(migrated)

        // A level change journaled: refused unless accepted; accepted, only those entries go.
        await tx.$executeRawUnsafe(
          `INSERT INTO audit_log (id, action_type, actor_id, dossier_id, metadata)
           VALUES ('${randomUUID()}', 'share_link_level_changed', '${owner.id}', '${dossierId}', '{}')`,
        )
        await tx.$executeRawUnsafe('SAVEPOINT before_down')
        await expect(run(tx, DOWN)).rejects.toThrow(/would be lost/)
        await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT before_down')
        await run(tx, [ACCEPT_LOSS, ...DOWN, REFUSE_LOSS])
        expect((await rows(tx, counts))[0]).toEqual(before)
        expect(
          await rows(
            tx,
            `SELECT count(*)::int AS n FROM pg_constraint WHERE conname = 'share_links_access_level_check'`,
          ),
        ).toEqual([{ n: 0 }])
      })
    })

    it('survives an interrupted deployment: any prefix of the migration, then all of it, gives the same database', async () => {
      const { dossierId } = await request()
      await rolledBack(async (tx) => {
        await run(tx, [ACCEPT_LOSS, ...DOWN, REFUSE_LOSS])
        await tx.$executeRawUnsafe(
          `INSERT INTO share_links (id, dossier_id, recipient_email, token, status, access_level)
           VALUES ('${randomUUID()}', '${dossierId}', 'c@pg-test.dev', '${randomUUID()}', 'active', 'Complet')`,
        )
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

  describe('concurrency', () => {
    it('invites one recipient once when the owner asks twice at the same moment', async () => {
      const { owner, dossierId } = await request()
      const recipient = email('bob')
      const results = await Promise.allSettled(
        ['public', 'complet', 'partiel'].map((accessLevel) =>
          shares.create({
            dossierId,
            user: owner,
            recipientEmail: recipient,
            accessLevel: accessLevel as 'public',
          }),
        ),
      )
      expect(results.map(outcome).sort()).toEqual([409, 409, 'fulfilled'].sort())
      expect(
        await prisma.shareLink.count({ where: { dossierId, recipientEmail: recipient } }),
      ).toBe(1)
      expect(await prisma.user.count({ where: { email: recipient } })).toBe(1)
    })

    it('never creates a share past an archiving that happens at the same moment', async () => {
      for (let i = 0; i < 3; i++) {
        const { owner, dossierId } = await request()
        const [invited, archived] = await Promise.allSettled([
          shares.create({
            dossierId,
            user: owner,
            recipientEmail: email('eve'),
            accessLevel: 'public',
          }),
          dossiers.archive(dossierId, owner.id),
        ])
        expect(archived.status).toBe('fulfilled')
        const links = await prisma.shareLink.findMany({ where: { dossierId } })
        const journaled = await prisma.auditLog.findMany({
          where: { dossierId, actionType: { in: ['share_link_created', 'dossier_archived'] } },
          orderBy: { createdAt: 'asc' },
        })
        if (invited.status === 'fulfilled') {
          // Invited first, then archived: the share stays, as every share does.
          expect(links).toHaveLength(1)
          expect(journaled.map((e) => e.actionType)).toEqual([
            'share_link_created',
            'dossier_archived',
          ])
        } else {
          expect(outcome(invited)).toBe(409)
          expect(links).toHaveLength(0)
        }
      }
    })

    it('journals one revocation when the owner and an administrator revoke at the same moment', async () => {
      const { owner, dossierId } = await request()
      const link = await shares.create({
        dossierId,
        user: owner,
        recipientEmail: email('bob'),
        accessLevel: 'partiel',
      })
      const admin = await prisma.user.create({
        data: { email: email('admin'), role: 'admin', emailVerifiedAt: new Date() },
      })
      const results = await Promise.all([
        shares.revokeAsOwner(dossierId, link.id, owner.id),
        shares.revokeAsAdmin(dossierId, link.id, admin.id),
        shares.revokeAsOwner(dossierId, link.id, owner.id),
      ])
      expect(results.map((r) => r.status)).toEqual(['revoked', 'revoked', 'revoked'])
      const journaled = await prisma.auditLog.findMany({
        where: {
          shareLinkId: link.id,
          actionType: { in: ['share_link_revoked', 'admin_revoked_share_link'] },
        },
      })
      expect(journaled).toHaveLength(1)
      const expected = journaled[0].actionType === 'admin_revoked_share_link' ? 'admin' : 'owner'
      expect(new Set(results.map((r) => r.revokedBy))).toEqual(new Set([expected]))
    })

    // The revocation's author is read back from the journal: a revocation that waited for another
    // one must read it, even when writing the journal entry takes time (here, 300 ms).
    it('tells who revoked to a revocation that waited for another one, however slow the journal', async () => {
      const { owner, dossierId } = await request()
      const link = await shares.create({
        dossierId,
        user: owner,
        recipientEmail: email('carol'),
        accessLevel: 'partiel',
      })
      const admin = await prisma.user.create({
        data: { email: email('admin2'), role: 'admin', emailVerifiedAt: new Date() },
      })
      const slow =
        <T extends unknown[]>(fn: (...a: T) => Promise<void>) =>
        async (...a: T) => {
          await new Promise((resolve) => setTimeout(resolve, 300))
          return fn(...a)
        }
      // Originals taken before spying: a spy's implementation must not call the spy itself.
      const record = audit.record.bind(audit)
      const recordIn = audit.recordIn.bind(audit)
      const spies = [
        jest.spyOn(audit, 'record').mockImplementation(slow(record)),
        jest.spyOn(audit, 'recordIn').mockImplementation(slow(recordIn)),
      ]
      try {
        const first = shares.revokeAsAdmin(dossierId, link.id, admin.id)
        await new Promise((resolve) => setTimeout(resolve, 100))
        const second = shares.revokeAsOwner(dossierId, link.id, owner.id)
        const results = await Promise.all([first, second])
        expect(results.map((r) => r.revokedBy)).toEqual(['admin', 'admin'])
      } finally {
        spies.forEach((s) => s.mockRestore())
      }
    })

    it('never changes the level of a share revoked at the same moment, nor journals it', async () => {
      for (let i = 0; i < 3; i++) {
        const { owner, dossierId } = await request()
        const link = await shares.create({
          dossierId,
          user: owner,
          recipientEmail: email('bob'),
          accessLevel: 'public',
        })
        const [changed] = await Promise.allSettled([
          shares.changeLevel({
            dossierId,
            linkId: link.id,
            userId: owner.id,
            accessLevel: 'complet',
          }),
          shares.revokeAsOwner(dossierId, link.id, owner.id),
        ])
        const row = await prisma.shareLink.findUniqueOrThrow({ where: { id: link.id } })
        expect(row.status).toBe('revoked')
        const journaled = await prisma.auditLog.findMany({
          where: { shareLinkId: link.id, actionType: 'share_link_level_changed' },
        })
        if (changed.status === 'fulfilled') {
          // Changed first, then revoked.
          expect(row.accessLevel).toBe('complet')
          expect(journaled).toHaveLength(1)
        } else {
          expect(outcome(changed)).toBe(409)
          expect(row.accessLevel).toBe('public')
          expect(journaled).toHaveLength(0)
        }
      }
    })
  })
})
