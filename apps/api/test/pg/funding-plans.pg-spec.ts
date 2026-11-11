import { randomUUID } from 'node:crypto'
import { HttpException } from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import { FUNDING_PLAN_LIMITS } from '@confluent/shared'
import { AnswerSourcesService } from '../../src/modules/answers/answer-sources.service'
import { AuditService } from '../../src/modules/audit/audit.service'
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
import { QuestionnairesService } from '../../src/modules/questionnaires/questionnaires.service'
import { WorkspaceAccessService } from '../../src/modules/workspaces/workspace-access'
import { testDatabase } from './database'
import { eligibilitiesDown, fundingPlansDown, fundingPlansUp, supportPathsDown } from './sql-file'

const UP = fundingPlansUp()
// Without the acceptance: what an operator runs first.
const DOWN = fundingPlansDown().slice(1)
// E06.06's validations and E06.05's eligibilities use E06.03's unique index on candidatures: undone
// first.
const LATER_DOWN = [...supportPathsDown(), ...eligibilitiesDown()]
const ACCEPT_LOSS = "SET LOCAL confluent.accept_funding_plans_loss = 'on'"
// The acceptance lasts for the whole transaction: withdrawn before a revert that must be checked.
const REFUSE_LOSS = "SET LOCAL confluent.accept_funding_plans_loss = 'off'"

class RolledBack extends Error {}

type Tx = Prisma.TransactionClient
const run = async (tx: Tx, statements: string[]) => {
  for (const sql of statements) await tx.$executeRawUnsafe(sql)
}
const rows = (tx: Tx, sql: string) => tx.$queryRawUnsafe<Array<Record<string, unknown>>>(sql)

const failure = (result: PromiseSettledResult<unknown>) => {
  if (result.status === 'fulfilled') return 'fulfilled'
  const err = result.reason as HttpException
  return err instanceof HttpException ? (err.getResponse() as { code: string }).code : String(err)
}

// What the migration creates or changes, comparable: the new table's columns, constraints and
// indexes, the indexes of the two tables its foreign keys target, and every line.
const TABLES = `'funding_plan_lines', 'candidatures', 'funding_source_categories'`
async function fingerprint(tx: Tx): Promise<string> {
  const [row] = await rows(
    tx,
    `SELECT json_build_object(
       'columns', (SELECT json_agg(x ORDER BY x) FROM (
         SELECT table_name || '.' || column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, '') AS x
         FROM information_schema.columns
         WHERE table_schema = current_schema() AND table_name = 'funding_plan_lines') c),
       'constraints', (SELECT json_agg(x ORDER BY x) FROM (
         SELECT conrelid::regclass::text || '.' || conname || ':' || pg_get_constraintdef(oid) AS x
         FROM pg_constraint WHERE conrelid::regclass::text IN (${TABLES})) k),
       'indexes', (SELECT json_agg(indexdef ORDER BY indexdef) FROM pg_indexes
         WHERE schemaname = current_schema() AND tablename IN (${TABLES})),
       'lines', (SELECT json_agg(to_jsonb(l) ORDER BY id) FROM funding_plan_lines l)
     )::text AS f`,
  )
  return row.f as string
}

// ROADMAP E06.03 on PostgreSQL: the migration adds the plans without touching existing data,
// survives an interrupted deployment and can be undone (refusing, unless accepted, to lose a plan);
// the constraints keep states, amounts and details closed and a line inside its candidature's
// workspace; two parties writing at the same moment never overwrite each other nor pass the limit.
describe('financing plans (PostgreSQL)', () => {
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
  const candidatures = new CandidaturesService(
    prisma,
    dossiers,
    new WorkspaceAccessService(prisma),
    questionnaires,
    new AnswerSourcesService(prisma, {} as DocumentsService),
    audit,
  )
  const plans = new FundingPlansService(prisma, candidatures, audit)
  const tag = randomUUID().slice(0, 8)
  const workspaces: string[] = []
  const forms: string[] = []

  afterAll(async () => {
    const users = await prisma.user.findMany({
      where: { email: { endsWith: `-${tag}@pg-test.dev` } },
    })
    const ids = users.map((u) => u.id)
    await prisma.auditLog.deleteMany({ where: { actorId: { in: ids } } })
    // Their requests take the candidatures and the plans with them.
    await prisma.user.deleteMany({ where: { id: { in: ids } } })
    await prisma.questionnaireVersion.deleteMany({ where: { questionnaireId: { in: forms } } })
    await prisma.questionnaire.deleteMany({ where: { id: { in: forms } } })
    await prisma.workspace.deleteMany({ where: { id: { in: workspaces } } })
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

  const account = (name: string, role: 'entrepreneur' | 'financeur' = 'entrepreneur') =>
    prisma.user.create({
      data: {
        email: `${name}-${randomUUID().slice(0, 6)}-${tag}@pg-test.dev`,
        role,
        emailVerifiedAt: new Date(),
      },
    })

  // A workspace receiving candidatures (a published form without question) with D04's categories,
  // two of its conseillers, and a request of an entrepreneur sent to it.
  async function sentCandidature() {
    const ws = await prisma.workspace.create({
      data: { slug: `pg-${randomUUID().slice(0, 12)}`, name: 'Structure test' },
    })
    workspaces.push(ws.id)
    await createDefaultFundingSourceCategories(prisma, ws.id)
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
    const conseillers: FundingPlanParty[] = []
    for (const name of ['marie', 'jean']) {
      const u = await account(name, 'financeur')
      await prisma.workspaceMembership.create({
        data: { workspaceId: ws.id, userId: u.id, role: 'conseiller' },
      })
      conseillers.push({ side: 'workspace', actor: { id: u.id, role: u.role }, workspaceId: ws.id })
    }
    const sophie = await account('sophie')
    const dossier = await dossiers.create({
      owner: { id: sophie.id, role: sophie.role },
      name: 'Biosensio',
    })
    await prisma.dossier.update({
      where: { id: dossier.id },
      data: { submittedAt: new Date(), amountEur: 100_000 },
    })
    const created = await candidatures.create(dossier.id, sophie.id, ws.id)
    await candidatures.submit(created.id, sophie.id)
    const category = async (key: string) =>
      (await prisma.fundingSourceCategory.findFirst({ where: { workspaceId: ws.id, key } }))!
    const owner: FundingPlanParty = { side: 'owner', userId: sophie.id }
    return {
      workspaceId: ws.id,
      conseillers,
      owner,
      ownerId: sophie.id,
      dossierId: dossier.id,
      candidatureId: created.id,
      category,
    }
  }

  describe('migration', () => {
    it('adds empty plans to existing candidatures; undone (refusing to lose a plan unless accepted), then applied again', async () => {
      const { candidatureId, category, workspaceId } = await sentCandidature()
      // Read before the revert, which locks the categories' table.
      const bpi = await category('bpifrance')
      await rolledBack(async (tx) => {
        // As E06.02 leaves it.
        await run(tx, [...LATER_DOWN, ACCEPT_LOSS, ...DOWN, REFUSE_LOSS])
        expect(await rows(tx, `SELECT to_regclass('funding_plan_lines')::text AS t`)).toEqual([
          { t: null },
        ])
        const [before] = await rows(
          tx,
          `SELECT (SELECT count(*)::int FROM candidatures) AS candidatures,
                  (SELECT count(*)::int FROM funding_source_categories) AS categories`,
        )
        await run(tx, UP)
        // Nothing backfilled, nothing else changed.
        expect(await rows(tx, `SELECT count(*)::int AS n FROM funding_plan_lines`)).toEqual([
          { n: 0 },
        ])
        expect(
          (
            await rows(
              tx,
              `SELECT (SELECT count(*)::int FROM candidatures) AS candidatures,
                      (SELECT count(*)::int FROM funding_source_categories) AS categories`,
            )
          )[0],
        ).toEqual(before)
        const migrated = await fingerprint(tx)
        // No plan: undone without acceptance, applied again, the same database.
        await run(tx, DOWN)
        await run(tx, UP)
        expect(await fingerprint(tx)).toEqual(migrated)

        // A line: refused unless accepted.
        await tx.$executeRawUnsafe(
          `INSERT INTO funding_plan_lines (id, candidature_id, workspace_id, category_id, amount_eur, state, updated_by_side, updated_at)
           VALUES ('${randomUUID()}', '${candidatureId}', '${workspaceId}', '${bpi.id}', 1000, 'planned', 'owner', now())`,
        )
        await tx.$executeRawUnsafe('SAVEPOINT before_down')
        await expect(run(tx, DOWN)).rejects.toThrow(/would be lost/)
        await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT before_down')
        await run(tx, [ACCEPT_LOSS, ...DOWN, REFUSE_LOSS])
        expect(await rows(tx, `SELECT to_regclass('funding_plan_lines')::text AS t`)).toEqual([
          { t: null },
        ])
        expect(
          await rows(
            tx,
            `SELECT count(*)::int AS n FROM pg_indexes WHERE indexname IN ('candidatures_id_workspace_id_key', 'funding_source_categories_id_workspace_id_key')`,
          ),
        ).toEqual([{ n: 0 }])
      })
    })

    it('survives an interrupted deployment: any prefix of the migration, then all of it, gives the same database', async () => {
      await sentCandidature()
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
    it('keeps states, amounts, details, versions and sides closed', async () => {
      const { candidatureId, workspaceId, category } = await sentCandidature()
      const bpi = await category('bpifrance')
      const insert = (columns: Record<string, string>) => {
        const values = {
          id: `'${randomUUID()}'`,
          candidature_id: `'${candidatureId}'`,
          workspace_id: `'${workspaceId}'`,
          category_id: `'${bpi.id}'`,
          amount_eur: '1000',
          state: `'planned'`,
          updated_by_side: `'owner'`,
          updated_at: 'now()',
          ...columns,
        }
        return `INSERT INTO funding_plan_lines (${Object.keys(values).join(', ')}) VALUES (${Object.values(values).join(', ')})`
      }
      const refused = (sql: string) =>
        expect(prisma.$transaction((tx) => tx.$executeRawUnsafe(sql))).rejects.toThrow()
      for (const columns of [
        { state: `'promised'` } as Record<string, string>,
        { state: `'Obtenu'` },
        { amount_eur: '0' },
        { amount_eur: '-5' },
        { amount_eur: '1000000001' },
        { label: `''` },
        { label: `' BNP'` },
        { label: `'BNP '` },
        { label: `E'BNP\\nTours'` },
        { label: `'${'x'.repeat(121)}'` },
        { version: '0' },
        { updated_by_side: `'investor'` },
      ]) {
        await refused(insert(columns))
      }
      await prisma.$transaction((tx) =>
        tx.$executeRawUnsafe(insert({ label: `'${'x'.repeat(120)}'`, amount_eur: '1000000000' })),
      )
    })

    it('keeps a line inside its candidature’s workspace, with the candidature, and its category undeletable', async () => {
      const a = await sentCandidature()
      const b = await sentCandidature()
      const aBpi = await a.category('bpifrance')
      const bBpi = await b.category('bpifrance')
      const insert = (candidatureId: string, workspaceId: string, categoryId: string) =>
        prisma.$transaction((tx) =>
          tx.$executeRawUnsafe(
            `INSERT INTO funding_plan_lines (id, candidature_id, workspace_id, category_id, amount_eur, state, updated_by_side, updated_at)
             VALUES ('${randomUUID()}', '${candidatureId}', '${workspaceId}', '${categoryId}', 1000, 'planned', 'owner', now())`,
          ),
        )
      // Another workspace's category, under either workspace.
      await expect(insert(a.candidatureId, a.workspaceId, bBpi.id)).rejects.toThrow(/foreign key/)
      await expect(insert(a.candidatureId, b.workspaceId, bBpi.id)).rejects.toThrow(/foreign key/)
      await insert(a.candidatureId, a.workspaceId, aBpi.id)
      // The category in use cannot go; the user who wrote the line can.
      await expect(
        prisma.fundingSourceCategory.delete({ where: { id: aBpi.id } }),
      ).rejects.toThrow()
      const line = (await prisma.fundingPlanLine.findFirst({
        where: { candidatureId: a.candidatureId },
      }))!
      const writer = await account('ecrivain', 'financeur')
      await prisma.fundingPlanLine.update({
        where: { id: line.id },
        data: { updatedById: writer.id },
      })
      await prisma.user.delete({ where: { id: writer.id } })
      expect(
        (await prisma.fundingPlanLine.findUnique({ where: { id: line.id } }))!.updatedById,
      ).toBeNull()
      // The plan goes with its candidature (here, with the request).
      await prisma.dossier.delete({ where: { id: a.dossierId } })
      expect(
        await prisma.fundingPlanLine.count({ where: { candidatureId: a.candidatureId } }),
      ).toBe(0)
    })
  })

  describe('concurrency', () => {
    it('applies one of three changes made at the same moment from the same version, never one over another', async () => {
      for (let round = 0; round < 3; round++) {
        const { candidatureId, conseillers, owner, category } = await sentCandidature()
        const bpi = await category('bpifrance')
        const [line] = (
          await plans.addLine(owner, candidatureId, {
            categoryId: bpi.id,
            amountEur: 1000,
            state: 'requested',
          })
        ).lines
        const results = await Promise.allSettled([
          plans.updateLine(owner, candidatureId, line.id, { version: 1, amountEur: 2000 }),
          plans.updateLine(conseillers[0], candidatureId, line.id, {
            version: 1,
            state: 'obtained',
          }),
          plans.deleteLine(conseillers[1], candidatureId, line.id, 1),
        ])
        const outcomes = results.map(failure)
        expect(outcomes.filter((o) => o === 'fulfilled')).toHaveLength(1)
        expect(
          outcomes
            .filter((o) => o !== 'fulfilled')
            .every((o) => ['FUNDING_PLAN_LINE_CHANGED', 'FUNDING_PLAN_LINE_NOT_FOUND'].includes(o)),
        ).toBe(true)
        const after = await prisma.fundingPlanLine.findMany({ where: { candidatureId } })
        const winner = results.findIndex((r) => r.status === 'fulfilled')
        if (winner === 2) expect(after).toHaveLength(0)
        else expect(after.map((l) => l.version)).toEqual([2])
      }
    })

    it('never passes the limit of lines when both parties add at the same moment', async () => {
      for (let round = 0; round < 2; round++) {
        const { candidatureId, conseillers, owner, workspaceId, category } = await sentCandidature()
        const bpi = await category('bpifrance')
        await prisma.fundingPlanLine.createMany({
          data: Array.from({ length: FUNDING_PLAN_LIMITS.linesPerPlan - 1 }, (_, i) => ({
            candidatureId,
            workspaceId,
            categoryId: bpi.id,
            amountEur: i + 1,
            state: 'planned',
            updatedBySide: 'owner',
          })),
        })
        const line = { categoryId: bpi.id, amountEur: 5, state: 'obtained' as const }
        const results = await Promise.allSettled([
          plans.addLine(owner, candidatureId, line),
          plans.addLine(conseillers[0], candidatureId, line),
          plans.addLine(conseillers[1], candidatureId, line),
        ])
        expect(results.map(failure).sort()).toEqual([
          'FUNDING_PLAN_LIMIT',
          'FUNDING_PLAN_LIMIT',
          'fulfilled',
        ])
        expect(await prisma.fundingPlanLine.count({ where: { candidatureId } })).toBe(
          FUNDING_PLAN_LIMITS.linesPerPlan,
        )
      }
    })
  })
})
