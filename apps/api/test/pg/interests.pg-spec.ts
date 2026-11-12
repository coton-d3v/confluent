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
import { InterestsService } from '../../src/modules/opportunities/interests.service'
import { OpportunitiesService } from '../../src/modules/opportunities/opportunities.service'
import { QuestionnairesService } from '../../src/modules/questionnaires/questionnaires.service'
import { ReadingSessionsService } from '../../src/modules/reading-sessions/reading-sessions.service'
import { ShareLinksService } from '../../src/modules/share-links/share-links.service'
import { testDatabase } from './database'
import { investorInterestsDown, investorInterestsUp } from './sql-file'
import { quietNotifications } from '../../src/testing/notifications'

const UP = investorInterestsUp()
// Without the acceptance: what an operator runs first.
const DOWN = investorInterestsDown().slice(1)
const ACCEPT_LOSS = "SET LOCAL confluent.accept_investor_interests_loss = 'on'"
// The acceptance lasts for the whole transaction: withdrawn before a revert that must be checked.
const REFUSE_LOSS = "SET LOCAL confluent.accept_investor_interests_loss = 'off'"

class RolledBack extends Error {}

type Tx = Prisma.TransactionClient
const run = async (tx: Tx, statements: string[]) => {
  for (const sql of statements) await tx.$executeRawUnsafe(sql)
}
const rows = (tx: Tx, sql: string) => tx.$queryRawUnsafe<Array<Record<string, unknown>>>(sql)
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const outcome = (result: PromiseSettledResult<unknown>) => {
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
         WHERE table_schema = current_schema() AND table_name = 'investor_interests') c),
       'constraints', (SELECT json_agg(x ORDER BY x) FROM (
         SELECT conname || ':' || pg_get_constraintdef(oid) AS x
         FROM pg_constraint WHERE conrelid::regclass::text = 'investor_interests') k),
       'indexes', (SELECT json_agg(indexdef ORDER BY indexdef) FROM pg_indexes
         WHERE schemaname = current_schema() AND tablename = 'investor_interests'),
       'values', (SELECT json_agg(e.enumlabel ORDER BY e.enumlabel) FROM pg_enum e
         JOIN pg_type t ON t.oid = e.enumtypid
         WHERE t.typname = 'audit_action' AND e.enumlabel LIKE 'investor_interest_%'),
       'marks', (SELECT json_agg(to_jsonb(i) ORDER BY id) FROM investor_interests i)
     )::text AS f`,
  )
  return row.f as string
}

// ROADMAP E07.05 on PostgreSQL: the migration adds the marks of interest without touching anything
// else, survives an interrupted deployment and can be undone (refusing, unless accepted, to lose a
// mark or its journal); one mark per investor and request, gone with either. Under the request's lock,
// simultaneous marks of one investor — a double click, two tabs — leave one mark and a journal that
// replays to it; a mark waits for a revocation or an archiving under way and is decided on its result.
describe('marks of interest (PostgreSQL)', () => {
  const prisma = testDatabase()
  const audit = new AuditService(prisma)
  const readings = new ReadingSessionsService(prisma, audit)
  const questionnaires = new QuestionnairesService(prisma)
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
    { get: () => 'http://localhost:5173' } as unknown as ConfigService<AppConfig, true>,
    dossiers,
    { listForDossier: () => Promise.resolve([]) } as unknown as DocumentsService,
    {} as AuthService,
    questionnaires,
    { sendShareInvite: () => Promise.resolve() } as unknown as EmailTransport,
    readings,
    quietNotifications(prisma),
  )
  const opportunities = new OpportunitiesService(prisma, dossiers, shareLinks, readings)
  const interests = new InterestsService(
    prisma,
    opportunities,
    dossiers,
    audit,
    quietNotifications(prisma),
  )
  const tag = randomUUID().slice(0, 8)
  let formId = ''
  let versionId = ''

  beforeAll(async () => {
    const form = await prisma.questionnaire.create({
      data: { slug: `interests-${tag}`, name: 'Profil' },
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
    // Their requests take their shares and marks with them.
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

  // A published request of a new owner, shared with a new investor — at an address in capitals, as
  // an owner may type it.
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
    const link = await prisma.shareLink.create({
      data: {
        dossierId: dossier.id,
        recipientEmail: investor.email.toUpperCase(),
        token: randomUUID(),
        status: 'active',
        accessLevel: 'public',
      },
    })
    return { owner, investor, dossier, link }
  }

  // The journal of one investor's marks on one request, replayed: each entry starts from the state
  // the previous one left; the result is the mark in the table.
  async function replays(dossierId: string, investorId: string) {
    const entries = await prisma.auditLog.findMany({
      where: {
        dossierId,
        actorId: investorId,
        actionType: { in: ['investor_interest_marked', 'investor_interest_withdrawn'] },
      },
      orderBy: { createdAt: 'asc' },
    })
    let state: boolean | null = null
    for (const e of entries) {
      const m = e.metadata as { change?: string; nameVisible: boolean }
      if (e.actionType === 'investor_interest_withdrawn') {
        expect(state).toBe(m.nameVisible)
        state = null
      } else if (m.change === 'marked') {
        expect(state).toBeNull()
        state = m.nameVisible
      } else {
        expect([m.change, state]).toEqual([
          m.nameVisible ? 'name_shown' : 'name_hidden',
          !m.nameVisible,
        ])
        state = m.nameVisible
      }
    }
    const marks = await prisma.investorInterest.findMany({ where: { dossierId, investorId } })
    expect(marks.map((mark) => mark.nameVisible)).toEqual(state === null ? [] : [state])
    return entries.length
  }

  describe('migration', () => {
    it('adds the marks and nothing else; undone (refusing to lose a mark or its journal unless accepted), then applied again', async () => {
      const { investor, dossier } = await sharedRequest()
      await rolledBack(async (tx) => {
        const migrated = await fingerprint(tx)
        const counts = `SELECT (SELECT count(*)::int FROM dossiers) AS dossiers,
                  (SELECT count(*)::int FROM users) AS users,
                  (SELECT count(*)::int FROM share_links) AS shares,
                  (SELECT count(*)::int FROM audit_log) AS journal`
        const [before] = await rows(tx, counts)
        // Without any mark: undone without acceptance, applied again (twice), the same.
        await run(tx, DOWN)
        expect(await rows(tx, `SELECT to_regclass('investor_interests')::text AS t`)).toEqual([
          { t: null },
        ])
        expect((await rows(tx, counts))[0]).toEqual(before)
        await run(tx, UP)
        await run(tx, UP)
        expect(await fingerprint(tx)).toEqual(migrated)
        expect((await rows(tx, counts))[0]).toEqual(before)

        // A mark or a journal entry alone: refused unless accepted; accepted, the marks and their
        // journal go, nothing else.
        for (const trace of [
          `INSERT INTO investor_interests (id, dossier_id, investor_id, updated_at)
           VALUES ('${randomUUID()}', '${dossier.id}', '${investor.id}', now())`,
          `INSERT INTO audit_log (id, dossier_id, action_type, actor_id, metadata)
           VALUES ('${randomUUID()}', '${dossier.id}', 'investor_interest_withdrawn', '${investor.id}', '{}')`,
        ]) {
          await tx.$executeRawUnsafe('SAVEPOINT traced')
          await tx.$executeRawUnsafe(trace)
          await tx.$executeRawUnsafe('SAVEPOINT before_down')
          await expect(run(tx, DOWN)).rejects.toThrow(/would be lost/)
          await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT before_down')
          await run(tx, [ACCEPT_LOSS, ...DOWN, REFUSE_LOSS])
          expect(await rows(tx, `SELECT to_regclass('investor_interests')::text AS t`)).toEqual([
            { t: null },
          ])
          expect((await rows(tx, counts))[0]).toEqual(before)
          await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT traced')
        }
      })
    })

    it('survives an interrupted deployment: any prefix of the migration, then all of it, gives the same database', async () => {
      await rolledBack(async (tx) => {
        const reference = await fingerprint(tx)
        await run(tx, DOWN)
        await tx.$executeRawUnsafe('SAVEPOINT legacy')
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
    it('keeps one mark per investor and request, gone with the request or the account', async () => {
      const { investor, dossier, owner } = await sharedRequest()
      await prisma.investorInterest.create({
        data: { dossierId: dossier.id, investorId: investor.id },
      })
      await expect(
        prisma.investorInterest.create({
          data: { dossierId: dossier.id, investorId: investor.id },
        }),
      ).rejects.toThrow(/Unique constraint/)
      const other = await user('other')
      await prisma.investorInterest.create({
        data: { dossierId: dossier.id, investorId: other.id },
      })
      await prisma.user.delete({ where: { id: other.id } })
      expect(await prisma.investorInterest.count({ where: { dossierId: dossier.id } })).toBe(1)
      await prisma.shareLink.deleteMany({ where: { dossierId: dossier.id } })
      await prisma.dossier.delete({ where: { id: dossier.id } })
      expect(await prisma.investorInterest.count({ where: { investorId: investor.id } })).toBe(0)
      expect(owner.id).toBeDefined()
    })
  })

  describe('concurrency', () => {
    it('leaves one mark of simultaneous marks of one investor, its journal replaying to it', async () => {
      for (let round = 0; round < 4; round++) {
        const { investor, dossier, owner } = await sharedRequest()
        // A double click: the same answer twice; then two tabs, each its own answer, and a withdrawal.
        const clicks = await Promise.allSettled([
          interests.mark(investor, dossier.id, { nameVisible: false }),
          interests.mark(investor, dossier.id, { nameVisible: false }),
        ])
        expect(clicks.map(outcome)).toEqual(['fulfilled', 'fulfilled'])
        expect(await replays(dossier.id, investor.id)).toBe(1)
        const tabs = await Promise.allSettled([
          interests.mark(investor, dossier.id, { nameVisible: true }),
          interests.mark(investor, dossier.id, { nameVisible: false }),
          interests.withdraw(investor, dossier.id),
          interests.mark(investor, dossier.id, { nameVisible: true }),
          interests.mark(investor, dossier.id, { nameVisible: true }),
        ])
        expect(tabs.map(outcome)).toEqual(Array(5).fill('fulfilled'))
        await replays(dossier.id, investor.id)
        const marks = await prisma.investorInterest.count({ where: { dossierId: dossier.id } })
        expect((await interests.forOwner(dossier.id, owner.id)).count).toBe(marks)
      }
    })

    it('decides a mark after a revocation under way: refused once the share is revoked', async () => {
      const { investor, dossier, owner, link } = await sharedRequest()
      let locked!: () => void
      const holding = new Promise<void>((resolve) => (locked = resolve))
      let committedAt = 0
      // The owner's revocation holds the request's lock, as `ShareLinksService.revokeAsOwner` does.
      const revocation = prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT 1 FROM "dossiers" WHERE "id" = ${dossier.id} FOR UPDATE`
          locked()
          await sleep(400)
          await tx.shareLink.update({
            where: { id: link.id },
            data: { status: 'revoked', revokedAt: new Date() },
          })
          committedAt = Date.now()
        },
        { timeout: 10_000 },
      )
      await holding
      const marked = interests.mark(investor, dossier.id, { nameVisible: true }).then(
        () => ({ settledAt: Date.now(), result: 'fulfilled' }),
        (err: HttpException) => ({
          settledAt: Date.now(),
          result: (err.getResponse() as { code: string }).code,
        }),
      )
      await revocation
      const { settledAt, result } = await marked
      expect(result).toBe('OPPORTUNITY_NOT_FOUND')
      expect(settledAt).toBeGreaterThanOrEqual(committedAt)
      expect(await prisma.investorInterest.count({ where: { dossierId: dossier.id } })).toBe(0)
      expect(await interests.forOwner(dossier.id, owner.id)).toEqual({ count: 0, named: [] })
    })

    it('never takes a new mark on a request archived at the same moment', async () => {
      for (let round = 0; round < 4; round++) {
        const { investor, dossier, owner } = await sharedRequest()
        const results = await Promise.allSettled([
          interests.mark(investor, dossier.id, { nameVisible: true }),
          dossiers.archive(dossier.id, owner.id),
        ])
        expect(results[1].status).toBe('fulfilled')
        const marks = await prisma.investorInterest.count({ where: { dossierId: dossier.id } })
        // Either marked before the archiving, or refused after it — never marked after it.
        expect([outcome(results[0]), marks]).toEqual(
          outcome(results[0]) === 'fulfilled' ? ['fulfilled', 1] : ['OPPORTUNITY_ARCHIVED', 0],
        )
        if (marks === 1) {
          const [mark, archive] = await Promise.all([
            prisma.auditLog.findFirstOrThrow({
              where: { dossierId: dossier.id, actionType: 'investor_interest_marked' },
            }),
            prisma.auditLog.findFirstOrThrow({
              where: { dossierId: dossier.id, actionType: 'dossier_archived' },
            }),
          ])
          expect(mark.createdAt.getTime()).toBeLessThanOrEqual(archive.createdAt.getTime())
        }
      }
    })
  })

  describe('reading', () => {
    it('counts the mark of a share stored in capitals, names it only when chosen, and only for the owner', async () => {
      const { investor, dossier, owner } = await sharedRequest()
      await prisma.user.update({
        where: { id: investor.id },
        data: { firstName: 'Claire', lastName: 'Martin' },
      })
      await interests.mark(investor, dossier.id, { nameVisible: false })
      expect(await interests.forOwner(dossier.id, owner.id)).toEqual({ count: 1, named: [] })
      const shown = await interests.mark(investor, dossier.id, { nameVisible: true })
      expect(await interests.forOwner(dossier.id, owner.id)).toEqual({
        count: 1,
        named: [{ name: 'Claire Martin', organizations: [], markedAt: shown.markedAt }],
      })
      await expect(interests.forOwner(dossier.id, investor.id)).rejects.toBeInstanceOf(
        HttpException,
      )
      const read = await opportunities.get(investor, dossier.id)
      expect(read.opportunity.interest).toEqual(shown)
    })
  })
})
