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
import { InterestsService } from '../../src/modules/opportunities/interests.service'
import { OpportunitiesService } from '../../src/modules/opportunities/opportunities.service'
import { PledgesService } from '../../src/modules/opportunities/pledges.service'
import { PositionsService } from '../../src/modules/opportunities/positions.service'
import { QuestionnairesService } from '../../src/modules/questionnaires/questionnaires.service'
import { ReadingSessionsService } from '../../src/modules/reading-sessions/reading-sessions.service'
import { ShareLinksService } from '../../src/modules/share-links/share-links.service'
import { WorkspaceAccessService } from '../../src/modules/workspaces/workspace-access'
import { testDatabase } from './database'
import { positionDisclosuresDown, positionDisclosuresUp } from './sql-file'

const UP = positionDisclosuresUp()
// Without the acceptance: what an operator runs first.
const DOWN = positionDisclosuresDown().slice(1)
const ACCEPT_LOSS = "SET LOCAL confluent.accept_position_disclosures_loss = 'on'"
// The acceptance lasts for the whole transaction: withdrawn before a revert that must be checked.
const REFUSE_LOSS = "SET LOCAL confluent.accept_position_disclosures_loss = 'off'"

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
         WHERE table_schema = current_schema() AND table_name = 'investor_position_disclosures') c),
       'constraints', (SELECT json_agg(x ORDER BY x) FROM (
         SELECT conname || ':' || pg_get_constraintdef(oid) AS x
         FROM pg_constraint WHERE conrelid::regclass::text = 'investor_position_disclosures') k),
       'indexes', (SELECT json_agg(indexdef ORDER BY indexdef) FROM pg_indexes
         WHERE schemaname = current_schema() AND tablename = 'investor_position_disclosures'),
       'values', (SELECT json_agg(e.enumlabel ORDER BY e.enumlabel) FROM pg_enum e
         JOIN pg_type t ON t.oid = e.enumtypid
         WHERE t.typname = 'audit_action' AND e.enumlabel LIKE 'investor_position_%'),
       'rows', (SELECT json_agg(to_jsonb(d) ORDER BY id) FROM investor_position_disclosures d)
     )::text AS f`,
  )
  return row.f as string
}

// ROADMAP E07.07 on PostgreSQL: the migration adds the consents to show a structure one's position
// without touching anything else, survives an interrupted deployment and can be undone (refusing,
// unless accepted, to lose a consent or its journal); one consent per investor, request and
// workspace, gone with any of them. Under the request's lock, simultaneous consents of one investor
// leave one, journaled once; a consent waits for a withdrawal from the pool under way and is refused
// after it. A structure reads, by real queries, the positions of the investors who consented and read
// the request through its pool now — nobody else's.
describe('positions (PostgreSQL)', () => {
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
  const interests = new InterestsService(prisma, opportunities, dossiers, audit)
  const pledges = new PledgesService(prisma, opportunities, dossiers, audit)
  const tag = randomUUID().slice(0, 8)
  const workspaces: string[] = []
  let formId = ''
  let versionId = ''

  beforeAll(async () => {
    const form = await prisma.questionnaire.create({
      data: { slug: `positions-${tag}`, name: 'Profil' },
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
    // Their requests take their candidatures, publications, positions and consents with them.
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

  const user = (name: string, role: 'entrepreneur' | 'financeur' | 'admin' = 'financeur') =>
    prisma.user.create({
      data: {
        email: `${name}-${randomUUID().slice(0, 6)}-${tag}@pg-test.dev`,
        role,
        emailVerifiedAt: new Date(),
      },
    })

  // A published request of a new owner, sent to a new workspace and listed in its pool, with an
  // investor of that pool (organization « Angels ») and a conseiller of the workspace.
  async function pooledRequest() {
    const owner = await user('owner', 'entrepreneur')
    const investor = await user('investor')
    const advisor = await user('advisor')
    const workspace = await prisma.workspace.create({
      data: { name: 'CCI', slug: `cci-${randomUUID().slice(0, 8)}-${tag}` },
    })
    workspaces.push(workspace.id)
    await prisma.workspaceMembership.create({
      data: {
        workspaceId: workspace.id,
        userId: investor.id,
        role: 'investisseur',
        organization: 'Angels',
      },
    })
    await prisma.workspaceMembership.create({
      data: { workspaceId: workspace.id, userId: advisor.id, role: 'conseiller' },
    })
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
    const publication = await prisma.poolPublication.create({
      data: {
        candidatureId: candidature.id,
        workspaceId: workspace.id,
        accessLevel: 'partiel',
        consentedAt: new Date(),
      },
    })
    return { owner, investor, advisor, workspace, dossier, publication }
  }

  const PLEDGE = {
    intention: 'likely' as const,
    amountEur: 25_000,
    showName: false,
    showAmount: false,
    version: null,
  }

  describe('migration', () => {
    it('adds the consents and nothing else; undone (refusing to lose a consent or its journal unless accepted), then applied again', async () => {
      const { investor, dossier, workspace } = await pooledRequest()
      await rolledBack(async (tx) => {
        const migrated = await fingerprint(tx)
        const counts = `SELECT (SELECT count(*)::int FROM dossiers) AS dossiers,
                  (SELECT count(*)::int FROM users) AS users,
                  (SELECT count(*)::int FROM workspaces) AS workspaces,
                  (SELECT count(*)::int FROM investor_interests) AS interests,
                  (SELECT count(*)::int FROM investor_pledges) AS pledges,
                  (SELECT count(*)::int FROM audit_log) AS journal`
        const [before] = await rows(tx, counts)
        // Without any consent: undone without acceptance, applied again (twice), the same.
        await run(tx, DOWN)
        expect(
          await rows(tx, `SELECT to_regclass('investor_position_disclosures')::text AS t`),
        ).toEqual([{ t: null }])
        expect((await rows(tx, counts))[0]).toEqual(before)
        await run(tx, UP)
        await run(tx, UP)
        expect(await fingerprint(tx)).toEqual(migrated)
        expect((await rows(tx, counts))[0]).toEqual(before)

        // A consent or a journal entry alone: refused unless accepted; accepted, the consents and
        // their journal go, nothing else.
        for (const trace of [
          `INSERT INTO investor_position_disclosures (id, dossier_id, investor_id, workspace_id)
           VALUES ('${randomUUID()}', '${dossier.id}', '${investor.id}', '${workspace.id}')`,
          `INSERT INTO audit_log (id, dossier_id, action_type, actor_id, metadata)
           VALUES ('${randomUUID()}', '${dossier.id}', 'investor_position_disclosure_withdrawn', '${investor.id}', '{}')`,
        ]) {
          await tx.$executeRawUnsafe('SAVEPOINT traced')
          await tx.$executeRawUnsafe(trace)
          await tx.$executeRawUnsafe('SAVEPOINT before_down')
          await expect(run(tx, DOWN)).rejects.toThrow(/would be lost/)
          await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT before_down')
          await run(tx, [ACCEPT_LOSS, ...DOWN, REFUSE_LOSS])
          expect(
            await rows(tx, `SELECT to_regclass('investor_position_disclosures')::text AS t`),
          ).toEqual([{ t: null }])
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
    it('keeps one consent per investor, request and workspace, gone with any of them', async () => {
      const { investor, dossier, workspace } = await pooledRequest()
      const data = { dossierId: dossier.id, investorId: investor.id, workspaceId: workspace.id }
      await prisma.investorPositionDisclosure.create({ data })
      await expect(prisma.investorPositionDisclosure.create({ data })).rejects.toThrow(
        /Unique constraint/,
      )
      const other = await user('other')
      await prisma.investorPositionDisclosure.create({ data: { ...data, investorId: other.id } })
      await prisma.user.delete({ where: { id: other.id } })
      expect(
        await prisma.investorPositionDisclosure.count({ where: { dossierId: dossier.id } }),
      ).toBe(1)

      // A workspace without candidature, so that it can be deleted.
      const bare = await prisma.workspace.create({
        data: { name: 'Bare', slug: `bare-${randomUUID().slice(0, 8)}-${tag}` },
      })
      await prisma.investorPositionDisclosure.create({ data: { ...data, workspaceId: bare.id } })
      await prisma.workspace.delete({ where: { id: bare.id } })
      expect(
        await prisma.investorPositionDisclosure.count({ where: { investorId: investor.id } }),
      ).toBe(1)
      await prisma.dossier.delete({ where: { id: dossier.id } })
      expect(
        await prisma.investorPositionDisclosure.count({ where: { investorId: investor.id } }),
      ).toBe(0)
    })
  })

  describe('concurrency', () => {
    it('leaves one consent of simultaneous consents of one investor, journaled once, and one withdrawal', async () => {
      for (let round = 0; round < 4; round++) {
        const { investor, dossier, workspace } = await pooledRequest()
        const results = await Promise.allSettled([
          positions.disclose(investor, dossier.id, workspace.id),
          positions.disclose(investor, dossier.id, workspace.id),
          positions.disclose(investor, dossier.id, workspace.id),
        ])
        expect(results.map(outcome)).toEqual(['fulfilled', 'fulfilled', 'fulfilled'])
        const ids = results.map((r) => (r as PromiseFulfilledResult<{ id: string }>).value.id)
        expect(new Set(ids).size).toBe(1)
        const entries = () =>
          prisma.auditLog.findMany({
            where: { dossierId: dossier.id, actorId: investor.id },
            orderBy: { createdAt: 'asc' },
          })
        expect((await entries()).map((e) => e.actionType)).toEqual(['investor_position_disclosed'])

        const withdrawals = await Promise.allSettled([
          positions.withdrawDisclosure(investor, ids[0]),
          positions.withdrawDisclosure(investor, ids[0]),
        ])
        expect(withdrawals.map(outcome)).toEqual(['fulfilled', 'fulfilled'])
        expect((await entries()).map((e) => e.actionType)).toEqual([
          'investor_position_disclosed',
          'investor_position_disclosure_withdrawn',
        ])
        expect(
          await prisma.investorPositionDisclosure.count({ where: { dossierId: dossier.id } }),
        ).toBe(0)
      }
    })

    it('decides a consent after a withdrawal from the pool under way: refused once withdrawn', async () => {
      const { investor, dossier, workspace, publication } = await pooledRequest()
      let locked!: () => void
      const holding = new Promise<void>((resolve) => (locked = resolve))
      let committedAt = 0
      // The owner's withdrawal holds the request's lock, as `PoolPublicationsService` does.
      const withdrawal = prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT 1 FROM "dossiers" WHERE "id" = ${dossier.id} FOR UPDATE`
          locked()
          await sleep(400)
          await tx.poolPublication.update({
            where: { id: publication.id },
            data: { withdrawnAt: new Date(), withdrawalReason: 'owner' },
          })
          committedAt = Date.now()
        },
        { timeout: 10_000 },
      )
      await holding
      const consent = positions.disclose(investor, dossier.id, workspace.id).then(
        () => ({ settledAt: Date.now(), result: 'fulfilled' }),
        (err: HttpException) => ({
          settledAt: Date.now(),
          result: (err.getResponse() as { code: string }).code,
        }),
      )
      await withdrawal
      const { settledAt, result } = await consent
      expect(result).toBe('OPPORTUNITY_NOT_FOUND')
      expect(settledAt).toBeGreaterThanOrEqual(committedAt)
      expect(
        await prisma.investorPositionDisclosure.count({ where: { dossierId: dossier.id } }),
      ).toBe(0)
    })
  })

  describe('reading', () => {
    it('shows a structure the positions of the investors who consented and read the request through its pool now, nobody else’s', async () => {
      const { investor, advisor, workspace, dossier, owner } = await pooledRequest()
      await prisma.user.update({
        where: { id: investor.id },
        data: { firstName: 'Claire', lastName: 'Martin' },
      })
      // Another investor of the pool, who consents too but whose membership is then deactivated; a
      // third who never consents.
      const [gone, silent] = [await user('gone'), await user('silent')]
      for (const u of [gone, silent]) {
        await prisma.workspaceMembership.create({
          data: { workspaceId: workspace.id, userId: u.id, role: 'investisseur' },
        })
      }
      await interests.mark(investor, dossier.id, { nameVisible: false })
      await pledges.set(investor, dossier.id, { ...PLEDGE, comment: 'Pour moi seule.' })
      await pledges.set(gone, dossier.id, { ...PLEDGE, amountEur: 7_000 })
      await pledges.set(silent, dossier.id, { ...PLEDGE, amountEur: 9_000 })
      await positions.disclose(investor, dossier.id, workspace.id)
      await positions.disclose(gone, dossier.id, workspace.id)
      await prisma.workspaceMembership.updateMany({
        where: { workspaceId: workspace.id, userId: gone.id },
        data: { deactivatedAt: new Date() },
      })

      const view = await positions.forWorkspace(advisor, workspace.id)
      expect(view.items).toHaveLength(1)
      expect(
        view.items[0].investors.map((i) => [i.identity, i.interest !== null, i.pledge]),
      ).toEqual([
        [
          { name: 'Claire Martin', organizations: ['Angels'] },
          true,
          { intention: 'likely', amountEur: 25_000, updatedAt: expect.any(Date) },
        ],
      ])
      expect(view.items[0].pledgedEur).toBe(25_000)
      expect(JSON.stringify(view)).not.toMatch(/Pour moi|7000|9000/)
      // An investor of the workspace is no conseiller.
      await expect(positions.forWorkspace(investor, workspace.id)).rejects.toBeInstanceOf(
        HttpException,
      )
      // The owner counts the pledges of who reads the request — the silent investor's included.
      expect((await positions.forOwner(dossier.id, owner.id)).pledges).toEqual({
        count: 2,
        totalEur: 34_000,
      })
      // Each investor reads their own.
      const mine = await positions.mine(investor)
      expect(mine.items.map((i) => [i.readable, i.pledge?.comment, i.disclosures.length])).toEqual([
        [true, 'Pour moi seule.', 1],
      ])
      expect((await positions.mine(silent)).items.map((i) => i.pledge?.amountEur)).toEqual([9_000])
    })
  })
})
