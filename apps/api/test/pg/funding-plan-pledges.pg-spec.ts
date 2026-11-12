import { randomUUID } from 'node:crypto'
import { HttpException } from '@nestjs/common'
import type { ConfigService } from '@nestjs/config'
import type { Prisma } from '@prisma/client'
import type { AppConfig } from '../../src/config/config.schema'
import type { AnswerSourcesService } from '../../src/modules/answers/answer-sources.service'
import { AuditService } from '../../src/modules/audit/audit.service'
import type { AuthService } from '../../src/modules/auth/auth.service'
import type { EmailTransport } from '../../src/modules/auth/email/email-transport'
import { CandidaturesService } from '../../src/modules/candidatures/candidatures.service'
import type { ClassificationService } from '../../src/modules/classification/classification.service'
import { CompaniesService } from '../../src/modules/companies/companies.service'
import type { DocumentsService } from '../../src/modules/documents/documents.service'
import { DossiersService } from '../../src/modules/dossiers/dossiers.service'
import {
  FundingPlansService,
  type FundingPlanParty,
} from '../../src/modules/funding-plans/funding-plans.service'
import { createDefaultFundingSourceCategories } from '../../src/modules/funding-sources/funding-source-defaults'
import { OpportunitiesService } from '../../src/modules/opportunities/opportunities.service'
import { PledgesService } from '../../src/modules/opportunities/pledges.service'
import { PositionsService } from '../../src/modules/opportunities/positions.service'
import { QuestionnairesService } from '../../src/modules/questionnaires/questionnaires.service'
import { ReadingSessionsService } from '../../src/modules/reading-sessions/reading-sessions.service'
import { ShareLinksService } from '../../src/modules/share-links/share-links.service'
import { WorkspaceAccessService } from '../../src/modules/workspaces/workspace-access'
import { testDatabase } from './database'
import { fundingPlanPledgesDown, fundingPlanPledgesUp } from './sql-file'

const UP = fundingPlanPledgesUp()
// Without the acceptance: what an operator runs first.
const DOWN = fundingPlanPledgesDown().slice(1)
const ACCEPT_LOSS = "SET LOCAL confluent.accept_funding_plan_pledges_loss = 'on'"
// The acceptance lasts for the whole transaction: withdrawn before a revert that must be checked.
const REFUSE_LOSS = "SET LOCAL confluent.accept_funding_plan_pledges_loss = 'off'"

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

// What the migration creates, comparable: the new table's columns, constraints and indexes, the
// indexes of the three tables its foreign keys target, and its rows.
const TABLES = `'funding_plan_pledge_links', 'funding_plan_lines', 'candidatures', 'investor_pledges'`
async function fingerprint(tx: Tx): Promise<string> {
  const [row] = await rows(
    tx,
    `SELECT json_build_object(
       'columns', (SELECT json_agg(x ORDER BY x) FROM (
         SELECT column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, '') AS x
         FROM information_schema.columns
         WHERE table_schema = current_schema() AND table_name = 'funding_plan_pledge_links') c),
       'constraints', (SELECT json_agg(x ORDER BY x) FROM (
         SELECT conname || ':' || pg_get_constraintdef(oid) AS x
         FROM pg_constraint WHERE conrelid::regclass::text = 'funding_plan_pledge_links') k),
       'indexes', (SELECT json_agg(indexdef ORDER BY indexdef) FROM pg_indexes
         WHERE schemaname = current_schema() AND tablename IN (${TABLES})),
       'rows', (SELECT json_agg(to_jsonb(l) ORDER BY id) FROM funding_plan_pledge_links l)
     )::text AS f`,
  )
  return row.f as string
}

// ROADMAP E06.04 on PostgreSQL: the migration adds the confirmations of pledges in plans without
// touching anything else, survives an interrupted deployment and can be undone (refusing, unless
// accepted, to lose a confirmation); its foreign keys keep a confirmation inside its plan and on its
// request's pledges, and one line per pledge in a plan. Under the candidature's lock then the
// pledge's row lock, simultaneous confirmations leave one; a confirmation waits for a withdrawal or a
// change of the pledge under way and is refused after it; a withdrawal or a change racing a
// confirmation never leaves the plan counting a pledge and its line together. Each side reads, by
// real queries, its own pledges only.
describe('funding plan pledges (PostgreSQL)', () => {
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
  )
  const opportunities = new OpportunitiesService(prisma, dossiers, shareLinks, readings)
  const candidatures = new CandidaturesService(
    prisma,
    dossiers,
    new WorkspaceAccessService(prisma),
    questionnaires,
    {} as AnswerSourcesService,
    audit,
  )
  const positions = new PositionsService(prisma, opportunities, dossiers, candidatures, audit)
  const pledges = new PledgesService(prisma, opportunities, dossiers, audit)
  const plans = new FundingPlansService(prisma, candidatures, positions, audit)
  const tag = randomUUID().slice(0, 8)
  const workspaces: string[] = []
  let formId = ''
  let versionId = ''

  beforeAll(async () => {
    const form = await prisma.questionnaire.create({
      data: { slug: `plan-pledges-${tag}`, name: 'Profil' },
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
    // Their requests take their candidatures, plans, pledges and confirmations with them.
    await prisma.dossier.deleteMany({ where: { userId: { in: ids } } })
    await prisma.company.deleteMany({ where: { ownerId: { in: ids } } })
    await prisma.fundingSourceCategory.deleteMany({ where: { workspaceId: { in: workspaces } } })
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
        firstName: name,
      },
    })

  // A published request (objective 100 000 €) sent to a new workspace and listed in its pool; a
  // conseiller of that workspace; Claire, an investor of its pool who also has a direct share, who
  // pledged 40 000 € showing name and amount and showed the structure her position; Bob, reading
  // through a direct share only, who pledged 25 000 € showing nothing.
  async function world() {
    const owner = await user('owner', 'entrepreneur')
    const claire = await user('claire')
    const bob = await user('bob')
    const advisor = await user('advisor')
    const workspace = await prisma.workspace.create({
      data: { name: 'CCI', slug: `cci-${randomUUID().slice(0, 8)}-${tag}` },
    })
    workspaces.push(workspace.id)
    await createDefaultFundingSourceCategories(prisma, workspace.id)
    for (const [userId, role] of [
      [claire.id, 'investisseur'],
      [advisor.id, 'conseiller'],
    ] as const) {
      await prisma.workspaceMembership.create({
        data: { workspaceId: workspace.id, userId, role, organization: 'Angels' },
      })
    }
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
        amountEur: 100_000,
      },
    })
    const sentAt = new Date()
    const candidature = await prisma.candidature.create({
      data: {
        dossierId: dossier.id,
        workspaceId: workspace.id,
        formVersionId: versionId,
        createdAt: sentAt,
        submittedAt: sentAt,
      },
    })
    await prisma.poolPublication.create({
      data: {
        candidatureId: candidature.id,
        workspaceId: workspace.id,
        accessLevel: 'partiel',
        consentedAt: new Date(),
      },
    })
    for (const investor of [claire, bob]) {
      await prisma.shareLink.create({
        data: {
          dossierId: dossier.id,
          recipientEmail: investor.email,
          token: randomUUID(),
          status: 'active',
          accessLevel: 'public',
        },
      })
    }
    const claired = await pledges.set(claire, dossier.id, {
      intention: 'strong',
      amountEur: 40_000,
      showName: true,
      showAmount: true,
      version: null,
    })
    await pledges.set(bob, dossier.id, {
      intention: 'likely',
      amountEur: 25_000,
      showName: false,
      showAmount: false,
      version: null,
    })
    await positions.disclose(claire, dossier.id, workspace.id)
    const pledge = (await prisma.investorPledge.findFirst({
      where: { dossierId: dossier.id, investorId: claire.id },
    }))!
    const category = (await prisma.fundingSourceCategory.findFirst({
      where: { workspaceId: workspace.id, key: 'business_angels_love_money' },
    }))!
    const asOwner: FundingPlanParty = { side: 'owner', userId: owner.id }
    const asAdvisor: FundingPlanParty = {
      side: 'workspace',
      actor: { id: advisor.id, role: 'financeur' },
      workspaceId: workspace.id,
    }
    const confirm = (version = claired.version) =>
      plans.addLine(asOwner, candidature.id, {
        categoryId: category.id,
        amountEur: 40_000,
        state: 'obtained',
        pledge: { id: pledge.id, version },
      })
    return {
      owner,
      claire,
      bob,
      workspace,
      dossier,
      candidature,
      pledge,
      category,
      asOwner,
      asAdvisor,
      confirm,
      version: claired.version,
    }
  }

  describe('migration', () => {
    it('adds the confirmations and nothing else; undone (refusing to lose one unless accepted), then applied again', async () => {
      const w = await world()
      await rolledBack(async (tx) => {
        const migrated = await fingerprint(tx)
        const counts = `SELECT (SELECT count(*)::int FROM funding_plan_lines) AS lines,
                  (SELECT count(*)::int FROM investor_pledges) AS pledges,
                  (SELECT count(*)::int FROM candidatures) AS candidatures,
                  (SELECT count(*)::int FROM audit_log) AS journal`
        const [before] = await rows(tx, counts)
        // Without any confirmation: undone without acceptance, applied again (twice), the same.
        await run(tx, DOWN)
        expect(
          await rows(tx, `SELECT to_regclass('funding_plan_pledge_links')::text AS t`),
        ).toEqual([{ t: null }])
        expect((await rows(tx, counts))[0]).toEqual(before)
        await run(tx, UP)
        await run(tx, UP)
        expect(await fingerprint(tx)).toEqual(migrated)
        expect((await rows(tx, counts))[0]).toEqual(before)

        // A confirmation: refused unless accepted; accepted, the confirmation goes, its line and
        // the pledge stay.
        const lineId = randomUUID()
        await tx.$executeRawUnsafe(
          `INSERT INTO funding_plan_lines (id, candidature_id, workspace_id, category_id, amount_eur, state, updated_by_side, updated_at)
           VALUES ('${lineId}', '${w.candidature.id}', '${w.workspace.id}', '${w.category.id}', 40000, 'obtained', 'owner', now())`,
        )
        await tx.$executeRawUnsafe(
          `INSERT INTO funding_plan_pledge_links (id, line_id, candidature_id, dossier_id, pledge_id, pledge_version)
           VALUES ('${randomUUID()}', '${lineId}', '${w.candidature.id}', '${w.dossier.id}', '${w.pledge.id}', ${w.version})`,
        )
        const [linked] = await rows(tx, counts)
        await tx.$executeRawUnsafe('SAVEPOINT before_down')
        await expect(run(tx, DOWN)).rejects.toThrow(/would be lost/)
        await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT before_down')
        await run(tx, [ACCEPT_LOSS, ...DOWN, REFUSE_LOSS])
        expect(
          await rows(tx, `SELECT to_regclass('funding_plan_pledge_links')::text AS t`),
        ).toEqual([{ t: null }])
        expect((await rows(tx, counts))[0]).toEqual(linked)
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
    it('keeps a confirmation inside its plan and on its request’s pledges; gone with the pledge, the line kept', async () => {
      const w = await world()
      const other = await world()
      const line = (await w.confirm()).lines[0]
      const link = (await prisma.fundingPlanPledgeLink.findFirst({ where: { lineId: line.id } }))!
      const insert = (data: Partial<typeof link>) =>
        prisma.fundingPlanPledgeLink.create({
          data: {
            lineId: link.lineId,
            candidatureId: link.candidatureId,
            dossierId: link.dossierId,
            pledgeId: link.pledgeId,
            pledgeVersion: link.pledgeVersion,
            ...data,
          },
        })
      const spare = await prisma.fundingPlanLine.create({
        data: {
          candidatureId: w.candidature.id,
          workspaceId: w.workspace.id,
          categoryId: w.category.id,
          amountEur: 1,
          state: 'requested',
          updatedBySide: 'owner',
        },
      })
      // One line per pledge in a plan; one pledge per line.
      await expect(insert({ lineId: spare.id })).rejects.toThrow(/Unique constraint/)
      const bob = (await prisma.investorPledge.findFirst({
        where: { dossierId: w.dossier.id, investorId: w.bob.id },
      }))!
      await expect(insert({ pledgeId: bob.id })).rejects.toThrow(/Unique constraint/)
      // Another request's pledge, another plan's line: refused by the foreign keys.
      await expect(insert({ lineId: spare.id, pledgeId: other.pledge.id })).rejects.toThrow(
        /Foreign key constraint/,
      )
      const otherLine = (await other.confirm()).lines[0]
      await expect(insert({ lineId: otherLine.id, pledgeId: bob.id })).rejects.toThrow(
        /Foreign key constraint|Unique constraint/,
      )
      await expect(
        insert({ lineId: spare.id, pledgeId: bob.id, dossierId: other.dossier.id }),
      ).rejects.toThrow(/Foreign key constraint/)

      // The pledge withdrawn: its confirmation goes, the line stays.
      await pledges.withdraw(w.claire, w.dossier.id)
      expect(await prisma.fundingPlanPledgeLink.count({ where: { lineId: line.id } })).toBe(0)
      expect(await prisma.fundingPlanLine.count({ where: { id: line.id } })).toBe(1)
      // The line deleted: its confirmation goes.
      await plans.deleteLine(other.asOwner, other.candidature.id, otherLine.id, otherLine.version)
      expect(
        await prisma.fundingPlanPledgeLink.count({
          where: { candidatureId: other.candidature.id },
        }),
      ).toBe(0)
    })
  })

  describe('reads', () => {
    it('shows each side its own pledges by real queries, a confirmed one counted as its line only', async () => {
      const w = await world()
      expect((await plans.get(w.asOwner, w.candidature.id)).pledges).toMatchObject({
        count: 2,
        totalEur: 65_000,
      })
      // Bob reads by a direct share and showed the structure nothing: the structure sees Claire only.
      expect((await plans.get(w.asAdvisor, w.candidature.id)).pledges).toEqual({
        count: 1,
        totalEur: 40_000,
        confirmable: [],
      })
      const confirmed = await w.confirm()
      expect(confirmed.pledges).toMatchObject({ count: 1, totalEur: 25_000, confirmable: [] })
      expect(confirmed.totals).toMatchObject({ obtainedEur: 40_000, remainingEur: 60_000 })
      const advisor = await plans.get(w.asAdvisor, w.candidature.id)
      expect(advisor.pledges).toMatchObject({ count: 0, totalEur: 0 })
      expect(advisor.lines[0].pledge).toMatchObject({
        identity: { name: 'claire', organizations: ['Angels'] },
        version: null,
        current: true,
      })
      // Claire leaves the pool: the structure no longer reads her pledge, nor which one the line
      // confirms.
      await prisma.workspaceMembership.updateMany({
        where: { workspaceId: w.workspace.id, userId: w.claire.id },
        data: { deactivatedAt: new Date() },
      })
      const after = await plans.get(w.asAdvisor, w.candidature.id)
      expect(after.lines[0].pledge).toBeNull()
      expect(after.pledges).toEqual({ count: 0, totalEur: 0, confirmable: [] })
    })
  })

  describe('concurrency', () => {
    it('leaves one confirmation of simultaneous confirmations of one pledge', async () => {
      for (let round = 0; round < 4; round++) {
        const w = await world()
        const results = await Promise.allSettled([w.confirm(), w.confirm(), w.confirm()])
        expect(results.map(outcome).sort()).toEqual([
          'FUNDING_PLAN_PLEDGE_HELD',
          'FUNDING_PLAN_PLEDGE_HELD',
          'fulfilled',
        ])
        expect(
          await prisma.fundingPlanLine.count({ where: { candidatureId: w.candidature.id } }),
        ).toBe(1)
        expect(
          await prisma.fundingPlanPledgeLink.count({ where: { candidatureId: w.candidature.id } }),
        ).toBe(1)
      }
    })

    // The investor's write holds the request's lock and the pledge's row, as `PledgesService` does.
    async function underWay(
      w: Awaited<ReturnType<typeof world>>,
      write: (tx: Tx) => Promise<unknown>,
    ) {
      let locked!: () => void
      const holding = new Promise<void>((resolve) => (locked = resolve))
      let committedAt = 0
      const investor = prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT 1 FROM "dossiers" WHERE "id" = ${w.dossier.id} FOR UPDATE`
          await write(tx)
          locked()
          await sleep(400)
          committedAt = Date.now()
        },
        { timeout: 10_000 },
      )
      await holding
      const confirmed = w.confirm().then(
        () => ({ settledAt: Date.now(), result: 'fulfilled' }),
        (err: HttpException) => ({
          settledAt: Date.now(),
          result: (err.getResponse() as { code: string }).code,
        }),
      )
      await investor
      return { ...(await confirmed), committedAt }
    }

    it('decides a confirmation after a withdrawal under way: refused, nothing written', async () => {
      const w = await world()
      const { settledAt, committedAt, result } = await underWay(w, (tx) =>
        tx.investorPledge.delete({ where: { id: w.pledge.id } }),
      )
      expect(result).toBe('FUNDING_PLAN_PLEDGE_CHANGED')
      expect(settledAt).toBeGreaterThanOrEqual(committedAt)
      expect(
        await prisma.fundingPlanLine.count({ where: { candidatureId: w.candidature.id } }),
      ).toBe(0)
    })

    it('decides a confirmation after a change under way: refused from the revision read before', async () => {
      const w = await world()
      const { settledAt, committedAt, result } = await underWay(w, (tx) =>
        tx.investorPledge.update({
          where: { id: w.pledge.id },
          data: { amountEur: 50_000, version: w.version + 1_000_000 },
        }),
      )
      expect(result).toBe('FUNDING_PLAN_PLEDGE_CHANGED')
      expect(settledAt).toBeGreaterThanOrEqual(committedAt)
      expect(
        await prisma.fundingPlanPledgeLink.count({ where: { candidatureId: w.candidature.id } }),
      ).toBe(0)
    })

    it('never counts a pledge with its line when a withdrawal or a change races the confirmation', async () => {
      for (let round = 0; round < 4; round++) {
        const w = await world()
        const [confirmed, withdrawn] = await Promise.allSettled([
          w.confirm(),
          pledges.withdraw(w.claire, w.dossier.id),
        ])
        expect(withdrawn.status).toBe('fulfilled')
        expect(['fulfilled', 'FUNDING_PLAN_PLEDGE_CHANGED']).toContain(outcome(confirmed))
        const plan = await plans.get(w.asOwner, w.candidature.id)
        expect(plan.pledges).toMatchObject({ count: 1, totalEur: 25_000 })
        expect(plan.lines.every((l) => l.pledge === null)).toBe(true)
        expect(
          await prisma.fundingPlanPledgeLink.count({ where: { candidatureId: w.candidature.id } }),
        ).toBe(0)
      }
      for (let round = 0; round < 4; round++) {
        const w = await world()
        const [confirmed, changed] = await Promise.allSettled([
          w.confirm(),
          pledges.set(w.claire, w.dossier.id, {
            intention: 'strong',
            amountEur: 50_000,
            showName: true,
            showAmount: true,
            version: w.version,
          }),
        ])
        expect(changed.status).toBe('fulfilled')
        const plan = await plans.get(w.asOwner, w.candidature.id)
        // Either refused (read before the change), or confirmed before it: then stale. Both ways
        // the pledge is promised as it now is, and no line counts it at its current revision.
        expect(plan.pledges).toMatchObject({ count: 2, totalEur: 75_000 })
        if (outcome(confirmed) === 'fulfilled') {
          expect(plan.lines[0].pledge).toMatchObject({ amountEur: 50_000, current: false })
          const link = await prisma.fundingPlanPledgeLink.findFirst({
            where: { candidatureId: w.candidature.id },
          })
          expect(link?.pledgeVersion).toBe(w.version)
        } else {
          expect(outcome(confirmed)).toBe('FUNDING_PLAN_PLEDGE_CHANGED')
          expect(plan.lines).toEqual([])
        }
      }
    })
  })
})
