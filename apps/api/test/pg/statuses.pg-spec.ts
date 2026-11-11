import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { HttpException } from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import { AnswerSourcesService } from '../../src/modules/answers/answer-sources.service'
import { AuditService } from '../../src/modules/audit/audit.service'
import { CandidaturesService } from '../../src/modules/candidatures/candidatures.service'
import type { ClassificationService } from '../../src/modules/classification/classification.service'
import { CompaniesService } from '../../src/modules/companies/companies.service'
import type { DocumentsService } from '../../src/modules/documents/documents.service'
import { DossiersService } from '../../src/modules/dossiers/dossiers.service'
import { QuestionnairesService } from '../../src/modules/questionnaires/questionnaires.service'
import { WorkspaceAccessService } from '../../src/modules/workspaces/workspace-access'
import { testDatabase } from './database'
import { CHECKS, MIGRATIONS, sqlStatements } from './sql-file'

const UP = sqlStatements(join(MIGRATIONS, '20261117000000_statuses/migration.sql'))
const DOWN = sqlStatements(join(CHECKS, '20261117000000_statuses.down.sql'))
const ACCEPT_LOSS = "SET LOCAL confluent.accept_statuses_loss = 'on'"
// The acceptance lasts for the whole transaction: withdrawn before a revert that must be checked.
const REFUSE_LOSS = "SET LOCAL confluent.accept_statuses_loss = 'off'"

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

// What the migration may change, comparable: columns, constraints and indexes of the tables it
// touches, the dossiers' publication and the candidatures' statuses.
const TABLES = `'dossiers', 'candidatures', 'candidature_status_changes'`
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
       'dossiers', (SELECT json_agg(json_build_array(id, publication_status, published_at,
         to_jsonb(dossiers) -> 'archived_at') ORDER BY id) FROM dossiers),
       'candidatures', (SELECT json_agg(json_build_array(id, to_jsonb(candidatures) -> 'financing_status',
         to_jsonb(candidatures) -> 'financing_status_changed_at') ORDER BY id) FROM candidatures)
     )::text AS f`,
  )
  return row.f as string
}

// ROADMAP E06.01 on PostgreSQL: the migration backfills every existing candidature explicitly,
// survives an interrupted deployment and can be undone (refusing, unless accepted, to lose an
// archiving or a status); the constraints keep both statuses closed; two changes of a status at the
// same moment never both apply.
describe('publication and financing statuses (PostgreSQL)', () => {
  const prisma = testDatabase()
  const audit = new AuditService(prisma)
  const questionnaires = new QuestionnairesService(prisma)
  const workspacesAccess = new WorkspaceAccessService(prisma)
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
    workspacesAccess,
    questionnaires,
    new AnswerSourcesService(prisma, {} as DocumentsService),
    audit,
  )
  const tag = randomUUID().slice(0, 8)
  const workspaces: string[] = []
  const forms: string[] = []

  afterAll(async () => {
    const users = await prisma.user.findMany({
      where: { email: { endsWith: `-${tag}@pg-test.dev` } },
    })
    const ids = users.map((u) => u.id)
    await prisma.auditLog.deleteMany({ where: { actorId: { in: ids } } })
    await prisma.user.deleteMany({ where: { id: { in: ids } } })
    await prisma.questionnaireField.deleteMany({
      where: { version: { questionnaireId: { in: forms } } },
    })
    await prisma.questionnaireSection.deleteMany({
      where: { version: { questionnaireId: { in: forms } } },
    })
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

  // A workspace receiving candidatures (a published form without question), two of its
  // conseillers, and a request of an entrepreneur sent to it.
  async function sentCandidature() {
    const ws = await prisma.workspace.create({
      data: { slug: `pg-${randomUUID().slice(0, 12)}`, name: 'Structure test' },
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
    const conseillers = []
    for (const name of ['marie', 'jean']) {
      const u = await account(name, 'financeur')
      await prisma.workspaceMembership.create({
        data: { workspaceId: ws.id, userId: u.id, role: 'conseiller' },
      })
      conseillers.push({ id: u.id, role: u.role })
    }
    const sophie = await account('sophie')
    const owner = { id: sophie.id, email: sophie.email, role: sophie.role }
    const dossier = await dossiers.create({ owner, name: 'Biosensio' })
    await prisma.dossier.update({ where: { id: dossier.id }, data: { submittedAt: new Date() } })
    const created = await candidatures.create(dossier.id, owner.id, ws.id)
    await candidatures.submit(created.id, owner.id)
    return { workspaceId: ws.id, conseillers, owner, dossier, candidatureId: created.id }
  }

  describe('migration', () => {
    it('backfills every candidature as in preparation, dated from its sending; undone (refusing a loss unless accepted), then applied again', async () => {
      const { candidatureId, dossier, workspaceId, conseillers, owner } = await sentCandidature()
      // Another request of the company, presented to the same workspace and still a draft.
      const second = await dossiers.createForCompany({
        owner,
        companyId: dossier.companyId,
        name: 'Deuxième demande',
      })
      await candidatures.create(second.id, owner.id, workspaceId)
      await rolledBack(async (tx) => {
        // As E05.10 leaves them: a sent candidature, a draft one, published and draft requests.
        await run(tx, [ACCEPT_LOSS, ...DOWN, REFUSE_LOSS])
        await tx.$executeRawUnsafe(
          `UPDATE candidatures SET submitted_at = created_at + interval '1 hour' WHERE id = '${candidatureId}'`,
        )
        await run(tx, UP)
        const [sent] = await rows(
          tx,
          `SELECT financing_status, financing_status_changed_at = submitted_at AS dated FROM candidatures WHERE id = '${candidatureId}'`,
        )
        expect(sent).toEqual({ financing_status: 'preparing', dated: true })
        expect(
          await rows(
            tx,
            `SELECT count(*)::int AS n FROM candidatures
             WHERE financing_status <> 'preparing' OR financing_status_changed_at <> coalesce(submitted_at, created_at)`,
          ),
        ).toEqual([{ n: 0 }])
        expect(
          await rows(
            tx,
            `SELECT count(*)::int AS n FROM dossiers WHERE archived_at IS NOT NULL OR publication_status NOT IN ('draft', 'published')`,
          ),
        ).toEqual([{ n: 0 }])
        expect(await rows(tx, `SELECT count(*)::int AS n FROM candidature_status_changes`)).toEqual(
          [{ n: 0 }],
        )
        const migrated = await fingerprint(tx)

        // Nothing decided yet: undone without acceptance, applied again, the same database.
        await run(tx, DOWN)
        await run(tx, UP)
        expect(await fingerprint(tx)).toEqual(migrated)

        // A status decided, or a request archived: refused unless accepted.
        for (const decided of [
          `UPDATE candidatures SET financing_status = 'funded' WHERE id = '${candidatureId}'`,
          `INSERT INTO candidature_status_changes (id, candidature_id, from_status, to_status, actor_side, actor_id)
           VALUES ('${randomUUID()}', '${candidatureId}', 'preparing', 'in_committee', 'workspace', '${conseillers[0].id}')`,
          `UPDATE dossiers SET publication_status = 'archived', archived_at = now() WHERE id = '${dossier.id}'`,
        ]) {
          await tx.$executeRawUnsafe('SAVEPOINT decided')
          await tx.$executeRawUnsafe(decided)
          await tx.$executeRawUnsafe('SAVEPOINT before_down')
          await expect(run(tx, DOWN)).rejects.toThrow(/would be lost/)
          await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT before_down')
          await run(tx, [ACCEPT_LOSS, ...DOWN, REFUSE_LOSS])
          // The archived request is a draft again; the candidature stays, without status.
          expect(
            await rows(tx, `SELECT publication_status FROM dossiers WHERE id = '${dossier.id}'`),
          ).toEqual([{ publication_status: 'draft' }])
          expect(
            await rows(
              tx,
              `SELECT count(*)::int AS n FROM candidatures WHERE id = '${candidatureId}'`,
            ),
          ).toEqual([{ n: 1 }])
          await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT decided')
        }
      })
    })

    it('survives an interrupted deployment: any prefix of the migration, then all of it, gives the same database', async () => {
      await sentCandidature()
      await rolledBack(async (tx) => {
        await run(tx, [ACCEPT_LOSS, ...DOWN])
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
    it('keeps both statuses closed, their dates exact, a draft in preparation, and the journal coherent', async () => {
      const { candidatureId, dossier, conseillers } = await sentCandidature()
      const refused = (sql: string) =>
        expect(prisma.$transaction((tx) => tx.$executeRawUnsafe(sql))).rejects.toThrow()
      const d = `WHERE id = '${dossier.id}'`
      await refused(`UPDATE dossiers SET publication_status = 'archived' ${d}`)
      await refused(`UPDATE dossiers SET archived_at = now() ${d}`)
      await refused(`UPDATE dossiers SET publication_status = 'archivee', archived_at = now() ${d}`)
      await refused(
        `UPDATE dossiers SET publication_status = 'published', published_at = now(), archived_at = now() ${d}`,
      )
      const c = `WHERE id = '${candidatureId}'`
      await refused(`UPDATE candidatures SET financing_status = 'financé' ${c}`)
      await refused(`UPDATE candidatures SET financing_status = NULL ${c}`)
      // A draft never leaves preparation.
      await refused(
        `UPDATE candidatures SET financing_status = 'in_committee', submitted_at = NULL ${c}`,
      )
      const change = (from: string, to: string, side: string) =>
        `INSERT INTO candidature_status_changes (id, candidature_id, from_status, to_status, actor_side, actor_id)
         VALUES ('${randomUUID()}', '${candidatureId}', '${from}', '${to}', '${side}', '${conseillers[0].id}')`
      await refused(change('preparing', 'preparing', 'workspace'))
      await refused(change('preparing', 'gagné', 'workspace'))
      await refused(change('preparing', 'funded', 'investisseur'))
    })
  })

  describe('concurrency', () => {
    it('applies one of two changes asked at the same moment from the same status, refusing the other', async () => {
      for (let round = 0; round < 3; round++) {
        const { workspaceId, conseillers, owner, candidatureId } = await sentCandidature()
        const results = await Promise.allSettled([
          candidatures.changeFinancingStatusForWorkspace(
            conseillers[0],
            workspaceId,
            candidatureId,
            {
              from: 'preparing',
              to: 'in_committee',
            },
          ),
          candidatures.changeFinancingStatusForWorkspace(
            conseillers[1],
            workspaceId,
            candidatureId,
            {
              from: 'preparing',
              to: 'refused',
            },
          ),
          candidatures.changeFinancingStatusAsOwner(candidatureId, owner.id, {
            from: 'preparing',
            to: 'abandoned',
          }),
        ])
        const outcomes = results.map(failure)
        expect(outcomes.filter((o) => o === 'fulfilled')).toHaveLength(1)
        expect(outcomes.filter((o) => o === 'FINANCING_STATUS_CHANGED')).toHaveLength(2)
        const changes = await prisma.candidatureStatusChange.findMany({ where: { candidatureId } })
        const row = await prisma.candidature.findUnique({ where: { id: candidatureId } })
        expect(changes).toHaveLength(1)
        expect(row!.financingStatus).toBe(changes[0].toStatus)
        expect(row!.financingStatusChangedAt).toEqual(changes[0].changedAt)
      }
    })

    it('archives a request once when asked twice at the same moment, and never publishes it meanwhile', async () => {
      const { owner, dossier } = await sentCandidature()
      await dossiers.update({
        userId: owner.id,
        id: dossier.id,
        changes: {
          summary: 'Résumé',
          objective: 'Objectif',
          amountEur: 100_000,
          financingTypes: ['grant'],
        },
      })
      await dossiers.publish(dossier.id, owner.id)
      const results = await Promise.allSettled([
        dossiers.archive(dossier.id, owner.id),
        dossiers.archive(dossier.id, owner.id),
        dossiers.publish(dossier.id, owner.id),
      ])
      expect(results.slice(0, 2).map(failure)).toEqual(['fulfilled', 'fulfilled'])
      const final = await prisma.dossier.findUnique({ where: { id: dossier.id } })
      expect(final).toMatchObject({ publicationStatus: 'archived', publishedAt: null })
      const archivings = await prisma.auditLog.findMany({
        where: { dossierId: dossier.id, actionType: 'dossier_archived' },
      })
      expect(archivings).toHaveLength(1)
    })
  })
})
