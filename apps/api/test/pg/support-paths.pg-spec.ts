import { randomUUID } from 'node:crypto'
import { HttpException } from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import { DEFAULT_SUPPORT_STEPS, reorderSupportStepsSchema } from '@confluent/shared'
import { AnswerSourcesService } from '../../src/modules/answers/answer-sources.service'
import { AuditService } from '../../src/modules/audit/audit.service'
import { CandidaturesService } from '../../src/modules/candidatures/candidatures.service'
import type { ClassificationService } from '../../src/modules/classification/classification.service'
import { CompaniesService } from '../../src/modules/companies/companies.service'
import type { DocumentsService } from '../../src/modules/documents/documents.service'
import { MemoryStorageAdapter } from '../../src/modules/documents/storage/memory-storage.adapter'
import { DossiersService } from '../../src/modules/dossiers/dossiers.service'
import { QuestionnairesService } from '../../src/modules/questionnaires/questionnaires.service'
import { PortfolioService } from '../../src/modules/support-paths/portfolio.service'
import { SupportPathsService } from '../../src/modules/support-paths/support-paths.service'
import { SupportStepsService } from '../../src/modules/support-paths/support-steps.service'
import { WorkspaceAccessService } from '../../src/modules/workspaces/workspace-access'
import { WorkspacesService } from '../../src/modules/workspaces/workspaces.service'
import { testDatabase } from './database'
import { supportPathsDown, supportPathsUp } from './sql-file'

const UP = supportPathsUp()
// Without the acceptance: what an operator runs first.
const DOWN = supportPathsDown().slice(1)
const ACCEPT_LOSS = "SET LOCAL confluent.accept_support_paths_loss = 'on'"
// The acceptance lasts for the whole transaction: withdrawn before a revert that must be checked.
const REFUSE_LOSS = "SET LOCAL confluent.accept_support_paths_loss = 'off'"

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

// What the migration creates, comparable: the three tables' columns, constraints and indexes, every
// step (ids included: derived from the workspace and the key, the same on every run), every
// validation and change.
const TABLES = `'support_steps', 'candidature_step_validations', 'candidature_step_validation_changes'`
async function fingerprint(tx: Tx): Promise<string> {
  const [row] = await rows(
    tx,
    `SELECT json_build_object(
       'columns', (SELECT json_agg(x ORDER BY x) FROM (
         SELECT table_name || '.' || column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, '') AS x
         FROM information_schema.columns
         WHERE table_schema = current_schema() AND table_name IN (${TABLES})) c),
       'constraints', (SELECT json_agg(x ORDER BY x) FROM (
         SELECT conrelid::regclass::text || '.' || conname || ':' || pg_get_constraintdef(oid) AS x
         FROM pg_constraint WHERE conrelid::regclass::text IN (${TABLES})) k),
       'indexes', (SELECT json_agg(indexdef ORDER BY indexdef) FROM pg_indexes
         WHERE schemaname = current_schema() AND tablename IN (${TABLES})),
       'steps', (SELECT json_agg(json_build_array(id, workspace_id, key, label, explanation, position, active)
         ORDER BY workspace_id, position) FROM support_steps),
       'validations', (SELECT json_agg(to_jsonb(v) ORDER BY id) FROM candidature_step_validations v),
       'changes', (SELECT json_agg(to_jsonb(c) ORDER BY id) FROM candidature_step_validation_changes c)
     )::text AS f`,
  )
  return row.f as string
}

// ROADMAP E06.06 on PostgreSQL: the migration gives every existing workspace the default path
// explicitly, survives an interrupted deployment and can be undone (refusing, unless accepted, to
// lose a validation or a configuration); the constraints keep explanations plain, changes closed and
// a validation inside its candidature's workspace; conseillers acting at the same moment never both
// change a step from the same version, and managers never take the same label twice. E06.07: the
// portfolio computes each candidature's phase from its own workspace's rows only.
describe('support paths (PostgreSQL)', () => {
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
  )
  const paths = new SupportPathsService(prisma, candidatures, audit)
  const portfolio = new PortfolioService(prisma, candidatures)
  const steps = new SupportStepsService(prisma, access, audit)
  const workspacesService = new WorkspacesService(prisma, audit, new MemoryStorageAdapter(), access)
  const tag = randomUUID().slice(0, 8)
  const workspaces: string[] = []
  const forms: string[] = []
  const admin = { id: '', role: 'admin' }

  beforeAll(async () => {
    const u = await prisma.user.create({
      data: { email: `admin-${tag}@pg-test.dev`, role: 'admin', emailVerifiedAt: new Date() },
    })
    admin.id = u.id
  })

  afterAll(async () => {
    const users = await prisma.user.findMany({
      where: { email: { endsWith: `-${tag}@pg-test.dev` } },
    })
    const ids = users.map((u) => u.id)
    await prisma.auditLog.deleteMany({ where: { actorId: { in: ids } } })
    // Their requests take the candidatures, validations and changes with them.
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

  const account = (name: string, role: 'entrepreneur' | 'financeur' = 'entrepreneur') =>
    prisma.user.create({
      data: {
        email: `${name}-${randomUUID().slice(0, 6)}-${tag}@pg-test.dev`,
        role,
        emailVerifiedAt: new Date(),
      },
    })

  // A workspace created as the site creates it (default path included), receiving candidatures,
  // three of its conseillers (managers), and a request of an entrepreneur sent to it.
  async function sentCandidature() {
    const ws = await workspacesService.create(admin, {
      name: 'Structure test',
      slug: `pg-${randomUUID().slice(0, 12)}`,
    })
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
    const conseillers: Array<{ id: string; role: string }> = []
    for (const name of ['marie', 'jean', 'luc']) {
      const u = await account(name, 'financeur')
      await prisma.workspaceMembership.create({
        data: { workspaceId: ws.id, userId: u.id, role: 'conseiller', canManageWorkspace: true },
      })
      conseillers.push({ id: u.id, role: u.role })
    }
    const sophie = await account('sophie')
    const dossier = await dossiers.create({
      owner: { id: sophie.id, role: sophie.role },
      name: 'Biosensio',
    })
    await prisma.dossier.update({ where: { id: dossier.id }, data: { submittedAt: new Date() } })
    const created = await candidatures.create(dossier.id, sophie.id, ws.id)
    await candidatures.submit(created.id, sophie.id)
    const step = async (key: string) =>
      (await prisma.supportStep.findFirst({ where: { workspaceId: ws.id, key } }))!
    return {
      workspaceId: ws.id,
      conseillers,
      dossierId: dossier.id,
      candidatureId: created.id,
      step,
    }
  }

  describe('migration', () => {
    it('backfills the default path for every existing workspace; undone (refusing to lose a validation or a configuration unless accepted), then applied again', async () => {
      const { workspaceId, candidatureId, step } = await sentCandidature()
      const created = await prisma.supportStep.findMany({
        where: { workspaceId },
        orderBy: { position: 'asc' },
      })
      // Created by the API with the workspace: the defaults, in order.
      expect(created.map((s) => [s.key, s.label, s.explanation, s.position, s.active])).toEqual(
        DEFAULT_SUPPORT_STEPS.map((s, i) => [s.key, s.label, s.explanation, i, true]),
      )
      const pitch = await step('pitch')
      await rolledBack(async (tx) => {
        // As E06.05 leaves it: workspaces without a path.
        await run(tx, [ACCEPT_LOSS, ...DOWN, REFUSE_LOSS])
        expect(await rows(tx, `SELECT to_regclass('support_steps')::text AS t`)).toEqual([
          { t: null },
        ])
        const [before] = await rows(
          tx,
          `SELECT (SELECT count(*)::int FROM workspaces) AS workspaces,
                  (SELECT count(*)::int FROM candidatures) AS candidatures,
                  (SELECT count(*)::int FROM eligibility_schemes) AS schemes,
                  (SELECT count(*)::int FROM funding_source_categories) AS categories`,
        )
        await run(tx, UP)
        const [after] = await rows(
          tx,
          `SELECT (SELECT count(*)::int FROM workspaces) AS workspaces,
                  (SELECT count(*)::int FROM candidatures) AS candidatures,
                  (SELECT count(*)::int FROM eligibility_schemes) AS schemes,
                  (SELECT count(*)::int FROM funding_source_categories) AS categories,
                  (SELECT count(*)::int FROM support_steps) AS steps,
                  (SELECT count(*)::int FROM support_steps WHERE NOT active) AS inactive,
                  (SELECT count(*)::int FROM candidature_step_validations) AS validations,
                  (SELECT count(*)::int FROM candidature_step_validation_changes) AS changes`,
        )
        expect(after).toEqual({
          ...before,
          steps: (before.workspaces as number) * DEFAULT_SUPPORT_STEPS.length,
          inactive: 0,
          validations: 0,
          changes: 0,
        })
        const backfilled = await rows(
          tx,
          `SELECT key, label, explanation, position FROM support_steps
           WHERE workspace_id = '${workspaceId}' ORDER BY position`,
        )
        expect(backfilled).toEqual(DEFAULT_SUPPORT_STEPS.map((s, position) => ({ ...s, position })))
        // Backfilled ids are ids the contracts accept: the site reorders them like any other.
        const ids = await rows(
          tx,
          `SELECT id FROM support_steps WHERE workspace_id = '${workspaceId}' ORDER BY position`,
        )
        expect(reorderSupportStepsSchema.safeParse({ stepIds: ids.map((r) => r.id) }).success).toBe(
          true,
        )
        const migrated = await fingerprint(tx)

        // Nothing validated nor configured: undone without acceptance, applied again, the same.
        await run(tx, DOWN)
        await run(tx, UP)
        expect(await fingerprint(tx)).toEqual(migrated)
        // The constraints the migration creates refuse markup in an explanation.
        await tx.$executeRawUnsafe('SAVEPOINT markup')
        await expect(
          tx.$executeRawUnsafe(
            `UPDATE support_steps SET explanation = 'Voir <b>ceci</b>' WHERE workspace_id = '${workspaceId}'`,
          ),
        ).rejects.toThrow(/check constraint/)
        await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT markup')

        // A validation (even withdrawn: its history), or a step renamed, explained, deactivated,
        // reordered or added: refused unless accepted.
        const w = `WHERE workspace_id = '${workspaceId}'`
        const backfilledPitch = (
          await rows(tx, `SELECT id FROM support_steps ${w} AND key = 'pitch'`)
        )[0].id as string
        expect(backfilledPitch).not.toBe(pitch.id)
        for (const changed of [
          `INSERT INTO candidature_step_validations (id, candidature_id, workspace_id, step_id, updated_at)
           VALUES ('${randomUUID()}', '${candidatureId}', '${workspaceId}', '${backfilledPitch}', now())`,
          `UPDATE support_steps SET label = 'Pitch final' ${w} AND key = 'pitch'`,
          `UPDATE support_steps SET explanation = NULL ${w} AND key = 'pitch'`,
          `UPDATE support_steps SET active = false ${w} AND key = 'diagnostic'`,
          `UPDATE support_steps SET position = 9 ${w} AND key = 'diagnostic'`,
          `INSERT INTO support_steps (id, workspace_id, key, label, position, updated_at)
           VALUES ('${randomUUID()}', '${workspaceId}', 'comite', 'Comité', 3, now())`,
        ]) {
          await tx.$executeRawUnsafe('SAVEPOINT changed')
          await tx.$executeRawUnsafe(changed)
          await tx.$executeRawUnsafe('SAVEPOINT before_down')
          await expect(run(tx, DOWN)).rejects.toThrow(/would be lost/)
          await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT before_down')
          await run(tx, [ACCEPT_LOSS, ...DOWN, REFUSE_LOSS])
          expect(
            await rows(
              tx,
              `SELECT to_regclass('support_steps')::text AS s,
                      to_regclass('candidature_step_validations')::text AS v,
                      to_regclass('candidature_step_validation_changes')::text AS c`,
            ),
          ).toEqual([{ s: null, v: null, c: null }])
          await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT changed')
        }
      })
    })

    it('survives an interrupted deployment: any prefix of the migration, then all of it, gives the same database', async () => {
      await sentCandidature()
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
    it('keeps steps’ keys, labels and explanations, validations’ validators and changes closed', async () => {
      const { candidatureId, workspaceId, step, conseillers } = await sentCandidature()
      const pitch = await step('pitch')
      const refused = (sql: string) =>
        expect(prisma.$transaction((tx) => tx.$executeRawUnsafe(sql))).rejects.toThrow()
      const insertStep = (columns: Record<string, string>) => {
        const values = {
          id: `'${randomUUID()}'`,
          workspace_id: `'${workspaceId}'`,
          key: `'comite'`,
          label: `'Comité'`,
          position: '3',
          updated_at: 'now()',
          ...columns,
        }
        return `INSERT INTO support_steps (${Object.keys(values).join(', ')}) VALUES (${Object.values(values).join(', ')})`
      }
      for (const columns of [
        { key: `'Comite'` } as Record<string, string>,
        { key: `'comite-2'` },
        { key: `'_comite'` },
        { key: `'${'x'.repeat(61)}'` },
        { label: `''` },
        { label: `' Comité'` },
        { label: `E'Com\\nité'` },
        { label: `'${'x'.repeat(81)}'` },
        { explanation: `''` },
        { explanation: `'Texte '` },
        { explanation: `E'\\nTexte'` },
        { explanation: `E'Un\\tdeux'` },
        { explanation: `E'Un\\n\\n\\nDeux'` },
        { explanation: `'Voir <a href="x">ici</a>'` },
        { explanation: `'${'x'.repeat(1001)}'` },
        { position: '-1' },
        { key: `'pitch'` },
        { label: `'Pitch'` },
      ]) {
        await refused(insertStep(columns))
      }
      await prisma.$transaction((tx) =>
        tx.$executeRawUnsafe(
          insertStep({ explanation: `E'Moins de 10 salariés (< 10).\\n\\n${'x'.repeat(970)}'` }),
        ),
      )

      const insert = (columns: Record<string, string>) => {
        const values = {
          id: `'${randomUUID()}'`,
          candidature_id: `'${candidatureId}'`,
          workspace_id: `'${workspaceId}'`,
          step_id: `'${pitch.id}'`,
          updated_at: 'now()',
          ...columns,
        }
        return `INSERT INTO candidature_step_validations (${Object.keys(values).join(', ')}) VALUES (${Object.values(values).join(', ')})`
      }
      for (const columns of [
        { validated_by_id: `'${conseillers[0].id}'` } as Record<string, string>,
        { version: '0' },
      ]) {
        await refused(insert(columns))
      }
      const id = randomUUID()
      await prisma.$transaction((tx) =>
        tx.$executeRawUnsafe(
          insert({
            id: `'${id}'`,
            validated_at: 'now()',
            validated_by_id: `'${conseillers[0].id}'`,
          }),
        ),
      )
      // Once per candidature and step.
      await refused(insert({}))
      const change = (value: string) =>
        `INSERT INTO candidature_step_validation_changes (id, validation_id, change)
         VALUES ('${randomUUID()}', '${id}', '${value}')`
      for (const value of ['approved', 'Validated', '']) await refused(change(value))
      await prisma.$transaction((tx) => tx.$executeRawUnsafe(change('validated')))
      await prisma.$transaction((tx) => tx.$executeRawUnsafe(change('reopened')))
    })

    it('keeps a validation inside its candidature’s workspace, with the candidature, and its step undeletable', async () => {
      const a = await sentCandidature()
      const b = await sentCandidature()
      const aPitch = await a.step('pitch')
      const bPitch = await b.step('pitch')
      const insert = (candidatureId: string, workspaceId: string, stepId: string) =>
        prisma.$transaction((tx) =>
          tx.$executeRawUnsafe(
            `INSERT INTO candidature_step_validations (id, candidature_id, workspace_id, step_id, updated_at)
             VALUES ('${randomUUID()}', '${candidatureId}', '${workspaceId}', '${stepId}', now())`,
          ),
        )
      // Another workspace's step, under either workspace.
      await expect(insert(a.candidatureId, a.workspaceId, bPitch.id)).rejects.toThrow(/foreign key/)
      await expect(insert(a.candidatureId, b.workspaceId, bPitch.id)).rejects.toThrow(/foreign key/)
      // Validated through the service: the step in use cannot go; the validator can, the date and
      // the history stay.
      const validator = await account('validatrice', 'financeur')
      await prisma.workspaceMembership.create({
        data: { workspaceId: a.workspaceId, userId: validator.id, role: 'conseiller' },
      })
      await paths.setValidation(validator, a.workspaceId, a.candidatureId, aPitch.id, {
        validated: true,
        version: 0,
      })
      await expect(prisma.supportStep.delete({ where: { id: aPitch.id } })).rejects.toThrow()
      await prisma.workspaceMembership.deleteMany({ where: { userId: validator.id } })
      await prisma.auditLog.deleteMany({ where: { actorId: validator.id } })
      await prisma.user.delete({ where: { id: validator.id } })
      const row = (await prisma.candidatureStepValidation.findFirst({
        where: { candidatureId: a.candidatureId },
      }))!
      expect(row).toMatchObject({ validatedById: null, validatedAt: expect.any(Date), version: 1 })
      expect(
        await prisma.candidatureStepValidationChange.findMany({ where: { validationId: row.id } }),
      ).toEqual([expect.objectContaining({ change: 'validated', actorId: null })])
      // The validation and its history go with the candidature (here, with the request).
      await prisma.dossier.delete({ where: { id: a.dossierId } })
      expect(
        await prisma.candidatureStepValidation.count({ where: { candidatureId: a.candidatureId } }),
      ).toBe(0)
      expect(
        await prisma.candidatureStepValidationChange.count({ where: { validationId: row.id } }),
      ).toBe(0)
    })
  })

  describe('concurrency', () => {
    it('applies one of three validations made at the same moment from the same version', async () => {
      for (let round = 0; round < 3; round++) {
        const { workspaceId, candidatureId, conseillers, step } = await sentCandidature()
        const pitch = await step('pitch')
        const results = await Promise.allSettled(
          conseillers.map((c) =>
            paths.setValidation(c, workspaceId, candidatureId, pitch.id, {
              validated: true,
              version: 0,
            }),
          ),
        )
        expect(results.map(failure).sort()).toEqual([
          'SUPPORT_STEP_CHANGED',
          'SUPPORT_STEP_CHANGED',
          'fulfilled',
        ])
        const after = await prisma.candidatureStepValidation.findMany({ where: { candidatureId } })
        expect(after.map((v) => v.version)).toEqual([1])
        expect(
          await prisma.candidatureStepValidationChange.count({
            where: { validationId: after[0].id },
          }),
        ).toBe(1)
      }
    })

    it('applies one of three changes made at the same moment from the same validated version, never one over another', async () => {
      for (let round = 0; round < 3; round++) {
        const { workspaceId, candidatureId, conseillers, step } = await sentCandidature()
        const bp = await step('business_plan')
        const set = (c: { id: string; role: string }, validated: boolean, version: number) =>
          paths.setValidation(c, workspaceId, candidatureId, bp.id, { validated, version })
        await set(conseillers[0], true, 0)
        const results = await Promise.allSettled([
          set(conseillers[0], false, 1),
          set(conseillers[1], false, 1),
          set(conseillers[2], false, 1),
        ])
        expect(results.map(failure).sort()).toEqual([
          'SUPPORT_STEP_CHANGED',
          'SUPPORT_STEP_CHANGED',
          'fulfilled',
        ])
        const [after] = await prisma.candidatureStepValidation.findMany({
          where: { candidatureId },
        })
        expect(after).toMatchObject({ version: 2, validatedAt: null, validatedById: null })
        expect(
          (
            await prisma.candidatureStepValidationChange.findMany({
              where: { validationId: after.id },
              orderBy: { changedAt: 'asc' },
            })
          ).map((c) => c.change),
        ).toEqual(['validated', 'reopened'])
      }
    })

    it('never takes the same label twice when two managers add steps at the same moment', async () => {
      for (let round = 0; round < 2; round++) {
        const { workspaceId, conseillers } = await sentCandidature()
        const results = await Promise.allSettled([
          steps.create(conseillers[0], workspaceId, { label: 'Comité' }),
          steps.create(conseillers[1], workspaceId, { label: 'comité' }),
          steps.create(conseillers[1], workspaceId, { label: 'Revue juridique' }),
        ])
        expect(results.map(failure).sort()).toEqual([
          'SUPPORT_STEP_LABEL_TAKEN',
          'fulfilled',
          'fulfilled',
        ])
        const list = await prisma.supportStep.findMany({ where: { workspaceId } })
        expect(new Set(list.map((s) => s.position)).size).toBe(list.length)
        expect(list).toHaveLength(DEFAULT_SUPPORT_STEPS.length + 2)
      }
    })
  })

  describe('portfolio (E06.07)', () => {
    it('computes the phases from the active steps and the standing validations of the workspace’s own candidatures', async () => {
      const a = await sentCandidature()
      const b = await sentCandidature()
      const [marie] = a.conseillers
      const set = (stepId: string, validated: boolean, version: number) =>
        paths.setValidation(marie, a.workspaceId, a.candidatureId, stepId, { validated, version })
      const diagnostic = await a.step('diagnostic')
      const pitch = await a.step('pitch')
      // A validation withdrawn leaves its row behind (validatedAt null): it no longer counts.
      await set(diagnostic.id, true, 0)
      await set(diagnostic.id, false, 1)
      await set(pitch.id, true, 0)
      // The other workspace's candidature, every step validated, stays out of this portfolio.
      for (const key of ['diagnostic', 'business_plan', 'pitch']) {
        const step = await b.step(key)
        await paths.setValidation(b.conseillers[0], b.workspaceId, b.candidatureId, step.id, {
          validated: true,
          version: 0,
        })
      }
      let view = await portfolio.get(marie, a.workspaceId)
      expect(view.counts.total).toBe(1)
      expect(view.counts.phases).toEqual({ in_progress: 1, ready: 0, no_path: 0 })
      expect(view.items.map((i) => [i.id, i.progress])).toEqual([
        [
          a.candidatureId,
          {
            phase: 'in_progress',
            validatedSteps: 1,
            totalSteps: 3,
            currentStep: { id: diagnostic.id, label: 'Diagnostic' },
          },
        ],
      ])
      // Revalidated, and the business plan deactivated: ready.
      await set(diagnostic.id, true, 2)
      await prisma.supportStep.update({
        where: { id: (await a.step('business_plan')).id },
        data: { active: false },
      })
      view = await portfolio.get(marie, a.workspaceId, { phase: 'ready' })
      expect(
        view.items.map((i) => [i.id, i.progress.validatedSteps, i.progress.totalSteps]),
      ).toEqual([[a.candidatureId, 2, 2]])
      const other = await portfolio.get(b.conseillers[0], b.workspaceId)
      expect(other.items.map((i) => [i.id, i.progress.phase])).toEqual([[b.candidatureId, 'ready']])
      // Neither workspace's conseiller reads the other's portfolio.
      await expect(portfolio.get(marie, b.workspaceId)).rejects.toThrow(HttpException)
    })
  })
})
