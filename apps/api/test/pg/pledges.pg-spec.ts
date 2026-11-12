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
import { OpportunitiesService } from '../../src/modules/opportunities/opportunities.service'
import { PledgesService } from '../../src/modules/opportunities/pledges.service'
import { QuestionnairesService } from '../../src/modules/questionnaires/questionnaires.service'
import { ShareLinksService } from '../../src/modules/share-links/share-links.service'
import { testDatabase } from './database'
import { investorPledgesDown, investorPledgesUp } from './sql-file'

const UP = investorPledgesUp()
// Without the acceptance: what an operator runs first.
const DOWN = investorPledgesDown().slice(1)
const ACCEPT_LOSS = "SET LOCAL confluent.accept_investor_pledges_loss = 'on'"
// The acceptance lasts for the whole transaction: withdrawn before a revert that must be checked.
const REFUSE_LOSS = "SET LOCAL confluent.accept_investor_pledges_loss = 'off'"

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
         WHERE table_schema = current_schema() AND table_name = 'investor_pledges') c),
       'constraints', (SELECT json_agg(x ORDER BY x) FROM (
         SELECT conname || ':' || pg_get_constraintdef(oid) AS x
         FROM pg_constraint WHERE conrelid::regclass::text = 'investor_pledges') k),
       'indexes', (SELECT json_agg(indexdef ORDER BY indexdef) FROM pg_indexes
         WHERE schemaname = current_schema() AND tablename = 'investor_pledges'),
       'values', (SELECT json_agg(e.enumlabel ORDER BY e.enumlabel) FROM pg_enum e
         JOIN pg_type t ON t.oid = e.enumtypid
         WHERE t.typname = 'audit_action' AND e.enumlabel LIKE 'investor_pledge_%'),
       'pledges', (SELECT json_agg(to_jsonb(p) ORDER BY id) FROM investor_pledges p)
     )::text AS f`,
  )
  return row.f as string
}

// ROADMAP E07.06 on PostgreSQL: the migration adds the pledges without touching anything else,
// survives an interrupted deployment and can be undone (refusing, unless accepted, to lose a pledge or
// its journal); its CHECK keeps the contract's closed list and limits; one pledge per investor and
// request, gone with either. Under the request's lock, simultaneous writes of one investor — a double
// click, two tabs — leave one pledge, never overwritten from a stale version, and a journal that
// replays to it; a pledge or a withdrawal waits for a revocation or an archiving under way and is
// decided on its result; the owner's total always equals the pledges counted.
describe('pledges (PostgreSQL)', () => {
  const prisma = testDatabase()
  const audit = new AuditService(prisma)
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
  )
  const opportunities = new OpportunitiesService(prisma, dossiers, shareLinks, audit)
  const pledges = new PledgesService(prisma, opportunities, dossiers, audit)
  const tag = randomUUID().slice(0, 8)
  let formId = ''
  let versionId = ''

  beforeAll(async () => {
    const form = await prisma.questionnaire.create({
      data: { slug: `pledges-${tag}`, name: 'Profil' },
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
    // Their requests take their shares and pledges with them.
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

  const BASE = {
    intention: 'likely' as const,
    amountEur: 25_000,
    showName: false,
    showAmount: false,
  }
  const pledgeOf = (version: number | null, more: object = {}) => ({ ...BASE, version, ...more })

  // The journal of one investor's pledges on one request, replayed: each entry starts from the state
  // the previous one left, each write at a revision above every earlier one — never reused, not even
  // after a withdrawal (code review R63); the result is the pledge in the table.
  async function replays(dossierId: string, investorId: string) {
    const entries = await prisma.auditLog.findMany({
      where: {
        dossierId,
        actorId: investorId,
        actionType: { in: ['investor_pledge_set', 'investor_pledge_withdrawn'] },
      },
      orderBy: { createdAt: 'asc' },
    })
    type Entry = { change?: string; amountEur: number; version: number; showName: boolean }
    let state: Entry | null = null
    let last = 0
    for (const e of entries) {
      const m = e.metadata as Entry
      if (e.actionType === 'investor_pledge_withdrawn') {
        expect([m.version, m.amountEur]).toEqual([state?.version, state?.amountEur])
        state = null
      } else {
        expect(state === null).toBe(m.change === 'pledged')
        expect(m.version).toBeGreaterThan(last)
        last = m.version
        state = m
      }
    }
    const rows = await prisma.investorPledge.findMany({ where: { dossierId, investorId } })
    expect(rows.map((p) => [p.version, p.amountEur])).toEqual(
      state === null ? [] : [[state.version, state.amountEur]],
    )
    return entries.length
  }

  const sameTotal = async (dossierId: string, ownerId: string) => {
    const all = await prisma.investorPledge.findMany({ where: { dossierId } })
    const view = await pledges.forOwner(dossierId, ownerId)
    expect([view.count, view.totalEur]).toEqual([
      all.length,
      all.reduce((sum, p) => sum + p.amountEur, 0),
    ])
  }

  describe('migration', () => {
    it('adds the pledges and nothing else; undone (refusing to lose a pledge or its journal unless accepted), then applied again', async () => {
      const { investor, dossier } = await sharedRequest()
      await rolledBack(async (tx) => {
        const migrated = await fingerprint(tx)
        const counts = `SELECT (SELECT count(*)::int FROM dossiers) AS dossiers,
                  (SELECT count(*)::int FROM users) AS users,
                  (SELECT count(*)::int FROM share_links) AS shares,
                  (SELECT count(*)::int FROM investor_interests) AS interests,
                  (SELECT count(*)::int FROM audit_log) AS journal`
        const [before] = await rows(tx, counts)
        // Without any pledge: undone without acceptance, applied again (twice), the same.
        await run(tx, DOWN)
        expect(await rows(tx, `SELECT to_regclass('investor_pledges')::text AS t`)).toEqual([
          { t: null },
        ])
        expect((await rows(tx, counts))[0]).toEqual(before)
        await run(tx, UP)
        await run(tx, UP)
        expect(await fingerprint(tx)).toEqual(migrated)
        expect((await rows(tx, counts))[0]).toEqual(before)

        // A pledge or a journal entry alone: refused unless accepted; accepted, the pledges and
        // their journal go, nothing else.
        for (const trace of [
          `INSERT INTO investor_pledges (id, dossier_id, investor_id, intention, amount_eur, show_name, show_amount, updated_at)
           VALUES ('${randomUUID()}', '${dossier.id}', '${investor.id}', 'likely', 1000, false, false, now())`,
          `INSERT INTO audit_log (id, dossier_id, action_type, actor_id, metadata)
           VALUES ('${randomUUID()}', '${dossier.id}', 'investor_pledge_withdrawn', '${investor.id}', '{}')`,
        ]) {
          await tx.$executeRawUnsafe('SAVEPOINT traced')
          await tx.$executeRawUnsafe(trace)
          await tx.$executeRawUnsafe('SAVEPOINT before_down')
          await expect(run(tx, DOWN)).rejects.toThrow(/would be lost/)
          await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT before_down')
          await run(tx, [ACCEPT_LOSS, ...DOWN, REFUSE_LOSS])
          expect(await rows(tx, `SELECT to_regclass('investor_pledges')::text AS t`)).toEqual([
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
    it('keeps the contract’s closed list and limits in the database', async () => {
      const { investor, dossier } = await sharedRequest()
      const insert = (columns: Record<string, unknown>) => {
        const row = {
          intention: 'likely',
          amount_eur: 1000,
          comment: null,
          show_name: false,
          show_amount: false,
          version: 1,
          ...columns,
        }
        return prisma.$executeRawUnsafe(
          `INSERT INTO investor_pledges (id, dossier_id, investor_id, intention, amount_eur, comment, show_name, show_amount, version, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())`,
          randomUUID(),
          dossier.id,
          investor.id,
          row.intention,
          row.amount_eur,
          row.comment,
          row.show_name,
          row.show_amount,
          row.version,
        )
      }
      for (const wrong of [
        { intention: 'firm' },
        { intention: 'Likely' },
        { amount_eur: 0 },
        { amount_eur: 1_000_000_001 },
        { comment: '' },
        { comment: ' padded' },
        { comment: 'x'.repeat(1001) },
        { comment: 'a\n\n\nb' },
        { comment: 'a\tb' },
        { comment: 'voir <b>ici</b>' },
        { version: 0 },
        { show_name: null },
        { show_amount: null },
      ]) {
        await expect(insert(wrong)).rejects.toThrow(/investor_pledges_check|23502/)
      }
      for (const right of [
        { intention: 'exploring', amount_eur: 1 },
        { intention: 'strong', amount_eur: 1_000_000_000, comment: 'x'.repeat(1000) },
      ]) {
        await insert(right)
        await prisma.investorPledge.deleteMany({ where: { dossierId: dossier.id } })
      }
      await insert({ intention: 'likely', comment: 'Ligne 1\n\nLigne 2' })
      expect(await prisma.investorPledge.count({ where: { dossierId: dossier.id } })).toBe(1)
    })

    it('keeps one pledge per investor and request, gone with the request or the account', async () => {
      const { investor, dossier, owner } = await sharedRequest()
      const data = { ...BASE, dossierId: dossier.id }
      await prisma.investorPledge.create({ data: { ...data, investorId: investor.id } })
      await expect(
        prisma.investorPledge.create({ data: { ...data, investorId: investor.id } }),
      ).rejects.toThrow(/Unique constraint/)
      const other = await user('other')
      await prisma.investorPledge.create({ data: { ...data, investorId: other.id } })
      await prisma.user.delete({ where: { id: other.id } })
      expect(await prisma.investorPledge.count({ where: { dossierId: dossier.id } })).toBe(1)
      await prisma.shareLink.deleteMany({ where: { dossierId: dossier.id } })
      await prisma.dossier.delete({ where: { id: dossier.id } })
      expect(await prisma.investorPledge.count({ where: { investorId: investor.id } })).toBe(0)
      expect(owner.id).toBeDefined()
    })
  })

  describe('concurrency', () => {
    it('leaves one pledge of simultaneous writes of one investor, never overwritten from a stale version', async () => {
      for (let round = 0; round < 4; round++) {
        const { investor, dossier, owner } = await sharedRequest()
        // A double click on a first pledge: one pledge, one entry.
        const clicks = await Promise.allSettled([
          pledges.set(investor, dossier.id, pledgeOf(null)),
          pledges.set(investor, dossier.id, pledgeOf(null)),
        ])
        expect(clicks.map(outcome)).toEqual(['fulfilled', 'fulfilled'])
        expect(await replays(dossier.id, investor.id)).toBe(1)
        const read = (clicks[0] as PromiseFulfilledResult<{ version: number }>).value.version
        // Two tabs on the version read, each its own amount: exactly one wins.
        const tabs = await Promise.allSettled([
          pledges.set(investor, dossier.id, pledgeOf(read, { amountEur: 30_000 })),
          pledges.set(investor, dossier.id, pledgeOf(read, { amountEur: 40_000 })),
          pledges.set(
            investor,
            dossier.id,
            pledgeOf(read, { amountEur: 50_000, showAmount: true }),
          ),
        ])
        expect(tabs.map(outcome).sort()).toEqual(['PLEDGE_CHANGED', 'PLEDGE_CHANGED', 'fulfilled'])
        const winner = tabs.find((t) => t.status === 'fulfilled') as PromiseFulfilledResult<{
          amountEur: number
          version: number
        }>
        const stored = await prisma.investorPledge.findMany({ where: { dossierId: dossier.id } })
        expect(stored.map((p) => [p.amountEur, p.version])).toEqual([
          [winner.value.amountEur, winner.value.version],
        ])
        // A change and a withdrawal at once: either order, the journal replays to the table.
        const mixed = await Promise.allSettled([
          pledges.set(investor, dossier.id, pledgeOf(winner.value.version, { amountEur: 60_000 })),
          pledges.withdraw(investor, dossier.id),
        ])
        expect(mixed[1].status).toBe('fulfilled')
        expect(['fulfilled', 'PLEDGE_CHANGED']).toContain(outcome(mixed[0]))
        await replays(dossier.id, investor.id)
        await sameTotal(dossier.id, owner.id)
      }
    })

    // Code review R63, on PostgreSQL: the revision comes from one sequence and is never reused.
    it('never takes a change written from a withdrawn pledge’s revision over the pledge made again', async () => {
      const { investor, dossier, owner } = await sharedRequest()
      const open = { showName: true, showAmount: true }
      const old = await pledges.set(
        investor,
        dossier.id,
        pledgeOf(null, { ...open, amountEur: 25_000 }),
      )
      await pledges.withdraw(investor, dossier.id)
      const again = await pledges.set(investor, dossier.id, pledgeOf(null, { amountEur: 90_000 }))
      const [stale] = await Promise.allSettled([
        pledges.set(investor, dossier.id, pledgeOf(old.version, { ...open, amountEur: 35_000 })),
      ])
      expect(outcome(stale)).toBe('PLEDGE_CHANGED')
      const stored = await prisma.investorPledge.findMany({ where: { dossierId: dossier.id } })
      expect(stored.map((p) => [p.amountEur, p.showName, p.showAmount, p.version])).toEqual([
        [90_000, false, false, again.version],
      ])
      await replays(dossier.id, investor.id)
      await sameTotal(dossier.id, owner.id)
    })

    it('decides a pledge after a revocation under way: refused once the share is revoked', async () => {
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
      const pledged = pledges.set(investor, dossier.id, pledgeOf(null, { showName: true })).then(
        () => ({ settledAt: Date.now(), result: 'fulfilled' }),
        (err: HttpException) => ({
          settledAt: Date.now(),
          result: (err.getResponse() as { code: string }).code,
        }),
      )
      await revocation
      const { settledAt, result } = await pledged
      expect(result).toBe('OPPORTUNITY_NOT_FOUND')
      expect(settledAt).toBeGreaterThanOrEqual(committedAt)
      expect(await prisma.investorPledge.count({ where: { dossierId: dossier.id } })).toBe(0)
      expect(await pledges.forOwner(dossier.id, owner.id)).toEqual({
        count: 0,
        totalEur: 0,
        shown: [],
      })
    })

    it('never takes a new pledge, a change or a withdrawal on a request archived at the same moment', async () => {
      for (let round = 0; round < 4; round++) {
        const { investor, dossier, owner } = await sharedRequest()
        const other = await user('other')
        await prisma.shareLink.create({
          data: {
            dossierId: dossier.id,
            recipientEmail: other.email,
            token: randomUUID(),
            status: 'active',
            accessLevel: 'public',
          },
        })
        await pledges.set(other, dossier.id, pledgeOf(null, { amountEur: 5_000 }))
        const results = await Promise.allSettled([
          pledges.set(investor, dossier.id, pledgeOf(null, { amountEur: 7_000 })),
          pledges.withdraw(other, dossier.id),
          dossiers.archive(dossier.id, owner.id),
        ])
        expect(results[2].status).toBe('fulfilled')
        const archived = await prisma.auditLog.findFirstOrThrow({
          where: { dossierId: dossier.id, actionType: 'dossier_archived' },
        })
        // Each write either happened before the archiving, or was refused after it.
        for (const [result, investorId, kept] of [
          [results[0], investor.id, 1],
          [results[1], other.id, 0],
        ] as const) {
          const rows = await prisma.investorPledge.count({
            where: { dossierId: dossier.id, investorId },
          })
          if (outcome(result) === 'fulfilled') {
            expect(rows).toBe(kept)
            const entry = await prisma.auditLog.findFirstOrThrow({
              where: { dossierId: dossier.id, actorId: investorId },
              orderBy: { createdAt: 'desc' },
            })
            expect(entry.createdAt.getTime()).toBeLessThanOrEqual(archived.createdAt.getTime())
          } else {
            expect([outcome(result), rows]).toEqual(['PLEDGE_CLOSED', 1 - kept])
          }
        }
        await sameTotal(dossier.id, owner.id)
      }
    })
  })

  describe('reading', () => {
    it('counts the pledge of a share stored in capitals, shows only what was chosen, and only to the owner', async () => {
      const { investor, dossier, owner } = await sharedRequest()
      await prisma.user.update({
        where: { id: investor.id },
        data: { firstName: 'Claire', lastName: 'Martin' },
      })
      const first = await pledges.set(investor, dossier.id, pledgeOf(null))
      expect(await pledges.forOwner(dossier.id, owner.id)).toEqual({
        count: 1,
        totalEur: 25_000,
        shown: [],
      })
      const shown = await pledges.set(
        investor,
        dossier.id,
        pledgeOf(first.version, { showName: true, comment: 'Ticket si BPI suit.' }),
      )
      expect(await pledges.forOwner(dossier.id, owner.id)).toEqual({
        count: 1,
        totalEur: 25_000,
        shown: [{ identity: { name: 'Claire Martin', organizations: [] }, amountEur: null }],
      })
      await expect(pledges.forOwner(dossier.id, investor.id)).rejects.toBeInstanceOf(HttpException)
      const read = await opportunities.get(investor, dossier.id)
      expect(read.opportunity.pledge).toEqual(shown)
    })
  })
})
