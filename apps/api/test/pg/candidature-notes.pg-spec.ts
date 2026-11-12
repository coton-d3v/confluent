import { randomUUID } from 'node:crypto'
import { HttpException } from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import { interventionJournalSchema } from '@confluent/shared'
import { AnswerSourcesService } from '../../src/modules/answers/answer-sources.service'
import { AuditService } from '../../src/modules/audit/audit.service'
import { CandidaturesService } from '../../src/modules/candidatures/candidatures.service'
import type { ClassificationService } from '../../src/modules/classification/classification.service'
import { CompaniesService } from '../../src/modules/companies/companies.service'
import type { DocumentsService } from '../../src/modules/documents/documents.service'
import { MemoryStorageAdapter } from '../../src/modules/documents/storage/memory-storage.adapter'
import { DossiersService } from '../../src/modules/dossiers/dossiers.service'
import { EligibilitiesService } from '../../src/modules/eligibilities/eligibilities.service'
import { FundingPlansService } from '../../src/modules/funding-plans/funding-plans.service'
import { CandidatureNotesService } from '../../src/modules/interventions/candidature-notes.service'
import { InterventionJournalService } from '../../src/modules/interventions/intervention-journal.service'
import { QuestionnairesService } from '../../src/modules/questionnaires/questionnaires.service'
import { SupportPathsService } from '../../src/modules/support-paths/support-paths.service'
import { WorkspaceAccessService } from '../../src/modules/workspaces/workspace-access'
import { WorkspacesService } from '../../src/modules/workspaces/workspaces.service'
import { NO_PLEDGES } from '../../src/testing/no-pledges'
import { testDatabase } from './database'
import { candidatureNotesDown, candidatureNotesUp } from './sql-file'
import { quietNotifications } from '../../src/testing/notifications'

const UP = candidatureNotesUp()
// Without the acceptance: what an operator runs first.
const DOWN = candidatureNotesDown().slice(1)
const ACCEPT_LOSS = "SET LOCAL confluent.accept_candidature_notes_loss = 'on'"
// The acceptance lasts for the whole transaction: withdrawn before a revert that must be checked.
const REFUSE_LOSS = "SET LOCAL confluent.accept_candidature_notes_loss = 'off'"

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

// What the migration creates, comparable: the table's columns, constraints, indexes and rows.
async function fingerprint(tx: Tx): Promise<string> {
  const [row] = await rows(
    tx,
    `SELECT json_build_object(
       'columns', (SELECT json_agg(x ORDER BY x) FROM (
         SELECT column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, '') AS x
         FROM information_schema.columns
         WHERE table_schema = current_schema() AND table_name = 'candidature_notes') c),
       'constraints', (SELECT json_agg(x ORDER BY x) FROM (
         SELECT conname || ':' || pg_get_constraintdef(oid) AS x
         FROM pg_constraint WHERE conrelid::regclass::text = 'candidature_notes') k),
       'indexes', (SELECT json_agg(indexdef ORDER BY indexdef) FROM pg_indexes
         WHERE schemaname = current_schema() AND tablename = 'candidature_notes'),
       'notes', (SELECT json_agg(to_jsonb(n) ORDER BY id) FROM candidature_notes n)
     )::text AS f`,
  )
  return row.f as string
}

// ROADMAP E06.08 on PostgreSQL: the migration adds the notes without touching anything else,
// survives an interrupted deployment and can be undone (refusing, unless accepted, to lose a note);
// the constraints keep a note plain, its text exactly while it is not deleted, and inside its
// candidature's workspace; authors acting at the same moment never both change a note from the same
// version, and the cap holds against simultaneous writes. The journal reads the real histories.
describe('candidature notes (PostgreSQL)', () => {
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
    quietNotifications(prisma),
  )
  const journal = new InterventionJournalService(prisma, candidatures)
  const notes = new CandidatureNotesService(prisma, candidatures, journal, audit)
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
    // Their requests take the candidatures, notes, lines, eligibilities and validations with them.
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

  // A workspace created as the site creates it, receiving candidatures, three of its conseillers,
  // and a request of an entrepreneur sent to it.
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
        data: { workspaceId: ws.id, userId: u.id, role: 'conseiller' },
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
    return {
      workspaceId: ws.id,
      conseillers,
      sophie: { id: sophie.id, role: sophie.role },
      dossierId: dossier.id,
      candidatureId: created.id,
    }
  }

  describe('migration', () => {
    it('adds the notes and nothing else; undone (refusing to lose a note unless accepted), then applied again', async () => {
      const { candidatureId, workspaceId, conseillers } = await sentCandidature()
      await rolledBack(async (tx) => {
        await run(tx, [ACCEPT_LOSS, ...DOWN, REFUSE_LOSS])
        expect(await rows(tx, `SELECT to_regclass('candidature_notes')::text AS t`)).toEqual([
          { t: null },
        ])
        const counts = `SELECT (SELECT count(*)::int FROM candidatures) AS candidatures,
                  (SELECT count(*)::int FROM candidature_status_changes) AS statuses,
                  (SELECT count(*)::int FROM candidature_step_validations) AS validations,
                  (SELECT count(*)::int FROM funding_plan_lines) AS lines,
                  (SELECT count(*)::int FROM candidature_eligibilities) AS eligibilities,
                  (SELECT count(*)::int FROM audit_log) AS journal`
        const [before] = await rows(tx, counts)
        await run(tx, UP)
        expect((await rows(tx, counts))[0]).toEqual(before)
        expect(await rows(tx, 'SELECT count(*)::int AS n FROM candidature_notes')).toEqual([
          { n: 0 },
        ])
        const migrated = await fingerprint(tx)

        // Without any note: undone without acceptance, applied again, the same.
        await run(tx, DOWN)
        await run(tx, UP)
        expect(await fingerprint(tx)).toEqual(migrated)

        // A note — even deleted (its trace) —: refused unless accepted; accepted, the notes and
        // their journal entries go, nothing else.
        for (const note of [
          `INSERT INTO candidature_notes (id, candidature_id, workspace_id, body, author_id, updated_at)
           VALUES ('${randomUUID()}', '${candidatureId}', '${workspaceId}', 'Note', '${conseillers[0].id}', now())`,
          `INSERT INTO candidature_notes (id, candidature_id, workspace_id, body, deleted_at, version, updated_at)
           VALUES ('${randomUUID()}', '${candidatureId}', '${workspaceId}', NULL, now(), 2, now())`,
        ]) {
          await tx.$executeRawUnsafe('SAVEPOINT noted')
          await tx.$executeRawUnsafe(note)
          await tx.$executeRawUnsafe(
            `INSERT INTO audit_log (id, action_type, actor_id, metadata)
             VALUES ('${randomUUID()}', 'candidature_note_updated', '${conseillers[0].id}', '{}')`,
          )
          await tx.$executeRawUnsafe('SAVEPOINT before_down')
          await expect(run(tx, DOWN)).rejects.toThrow(/would be lost/)
          await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT before_down')
          await run(tx, [ACCEPT_LOSS, ...DOWN, REFUSE_LOSS])
          expect(await rows(tx, `SELECT to_regclass('candidature_notes')::text AS t`)).toEqual([
            { t: null },
          ])
          expect(
            await rows(
              tx,
              `SELECT count(*)::int AS n FROM audit_log WHERE action_type = 'candidature_note_updated'`,
            ),
          ).toEqual([{ n: 0 }])
          expect((await rows(tx, counts))[0]).toEqual(before)
          await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT noted')
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
    it('keeps a note plain, its text exactly while it is not deleted, its dates and version coherent', async () => {
      const { candidatureId, workspaceId, conseillers } = await sentCandidature()
      const insert = (columns: Record<string, string>) => {
        const values = {
          id: `'${randomUUID()}'`,
          candidature_id: `'${candidatureId}'`,
          workspace_id: `'${workspaceId}'`,
          body: `'Note'`,
          author_id: `'${conseillers[0].id}'`,
          updated_at: 'now()',
          ...columns,
        }
        return `INSERT INTO candidature_notes (${Object.keys(values).join(', ')}) VALUES (${Object.values(values).join(', ')})`
      }
      const refused = (sql: string) =>
        expect(prisma.$transaction((tx) => tx.$executeRawUnsafe(sql))).rejects.toThrow(
          /check constraint/,
        )
      for (const columns of [
        { body: `''` } as Record<string, string>,
        { body: `' Note'` },
        { body: `E'Note\\n'` },
        { body: `E'Un\\tdeux'` },
        { body: `E'Un\\n\\n\\nDeux'` },
        { body: `'Voir <b>ceci</b>'` },
        { body: `'<!-- x -->'` },
        { body: `'${'x'.repeat(4001)}'` },
        { body: 'NULL' },
        { deleted_at: 'now()' },
        { version: '0' },
        { created_at: 'now()', edited_at: `now() - interval '1 day'` },
        { body: 'NULL', created_at: 'now()', deleted_at: `now() - interval '1 day'` },
      ]) {
        await refused(insert(columns))
      }
      for (const columns of [
        { body: `E'Moins de 10 salariés (< 10).\\n\\n${'x'.repeat(3970)}'` } as Record<
          string,
          string
        >,
        { body: 'NULL', deleted_at: 'now()', version: '2' },
        { edited_at: 'now()', version: '2' },
        { author_id: 'NULL' },
      ]) {
        await prisma.$transaction((tx) => tx.$executeRawUnsafe(insert(columns)))
      }
    })

    it('keeps a note inside its candidature’s workspace, goes with its candidature, outlives its author’s account', async () => {
      const a = await sentCandidature()
      const b = await sentCandidature()
      const insert = (candidatureId: string, workspaceId: string) =>
        prisma.$transaction((tx) =>
          tx.$executeRawUnsafe(
            `INSERT INTO candidature_notes (id, candidature_id, workspace_id, body, updated_at)
             VALUES ('${randomUUID()}', '${candidatureId}', '${workspaceId}', 'Note', now())`,
          ),
        )
      // A candidature named with another workspace: refused.
      await expect(insert(a.candidatureId, b.workspaceId)).rejects.toThrow(/foreign key/)
      const author = await account('autrice', 'financeur')
      await prisma.workspaceMembership.create({
        data: { workspaceId: a.workspaceId, userId: author.id, role: 'conseiller' },
      })
      await notes.create(author, a.workspaceId, a.candidatureId, { body: 'Note de l’autrice.' })
      await prisma.workspaceMembership.deleteMany({ where: { userId: author.id } })
      await prisma.auditLog.deleteMany({ where: { actorId: author.id } })
      await prisma.user.delete({ where: { id: author.id } })
      const [row] = await prisma.candidatureNote.findMany({
        where: { candidatureId: a.candidatureId },
      })
      expect(row).toMatchObject({ authorId: null, body: 'Note de l’autrice.' })
      const view = await journal.get(a.conseillers[0], a.workspaceId, a.candidatureId)
      expect(view.entries).toEqual([
        expect.objectContaining({
          kind: 'note',
          actor: null,
          note: expect.objectContaining({ mine: false }),
        }),
      ])
      // Not hers to change any more, nobody else's either.
      await expect(
        notes.edit(a.conseillers[0], a.workspaceId, a.candidatureId, row.id, {
          body: 'x',
          version: 1,
        }),
      ).rejects.toThrow(HttpException)
      await prisma.dossier.delete({ where: { id: a.dossierId } })
      expect(await prisma.candidatureNote.count({ where: { id: row.id } })).toBe(0)
    })
  })

  describe('concurrency', () => {
    it('applies one of three changes its author makes at the same moment from the same version', async () => {
      for (let round = 0; round < 3; round++) {
        const { workspaceId, candidatureId, conseillers } = await sentCandidature()
        const [marie] = conseillers
        await notes.create(marie, workspaceId, candidatureId, { body: 'Première version.' })
        const [note] = await prisma.candidatureNote.findMany({ where: { candidatureId } })
        const results = await Promise.allSettled([
          notes.edit(marie, workspaceId, candidatureId, note.id, {
            body: 'Version A.',
            version: 1,
          }),
          notes.edit(marie, workspaceId, candidatureId, note.id, {
            body: 'Version B.',
            version: 1,
          }),
          notes.remove(marie, workspaceId, candidatureId, note.id, 1),
        ])
        const outcome = results.map(failure)
        expect(outcome.filter((r) => r === 'fulfilled')).toHaveLength(1)
        // Behind an edit, the version changed; behind the deletion, the note is gone.
        expect(
          outcome
            .filter((r) => r !== 'fulfilled')
            .every((r) => r === 'CANDIDATURE_NOTE_CHANGED' || r === 'CANDIDATURE_NOTE_DELETED'),
        ).toBe(true)
        const after = await prisma.candidatureNote.findUniqueOrThrow({ where: { id: note.id } })
        expect(after.version).toBe(2)
        expect(
          await prisma.auditLog.count({
            where: { actionType: 'candidature_note_updated', actorId: marie.id },
          }),
        ).toBe(2)
        const winner = outcome.indexOf('fulfilled')
        expect(after.body).toBe(['Version A.', 'Version B.', null][winner])
      }
    })

    it('never lets simultaneous notes pass the cap', async () => {
      const { workspaceId, candidatureId, conseillers } = await sentCandidature()
      await prisma.$executeRawUnsafe(
        `INSERT INTO candidature_notes (id, candidature_id, workspace_id, body, author_id, updated_at)
         SELECT md5(random()::text || g)::uuid::text, '${candidatureId}', '${workspaceId}', 'n' || g, '${conseillers[0].id}', now()
         FROM generate_series(1, 499) g`,
      )
      const results = await Promise.allSettled(
        conseillers.map((c, i) =>
          notes.create(c, workspaceId, candidatureId, { body: `Note ${i}` }),
        ),
      )
      expect(results.map(failure).sort()).toEqual([
        'CANDIDATURE_NOTE_LIMIT',
        'CANDIDATURE_NOTE_LIMIT',
        'fulfilled',
      ])
      expect(await prisma.candidatureNote.count({ where: { candidatureId } })).toBe(500)
    })
  })

  describe('journal of interventions', () => {
    it('reads the structure’s interventions from the real histories and journal, and none of the entrepreneur’s', async () => {
      const { workspaceId, candidatureId, conseillers, sophie } = await sentCandidature()
      const [marie, jean] = conseillers
      const plans = new FundingPlansService(prisma, candidatures, NO_PLEDGES, audit)
      const eligibilities = new EligibilitiesService(prisma, candidatures, audit)
      const paths = new SupportPathsService(prisma, candidatures, audit)
      const ws = { side: 'workspace' as const, actor: marie, workspaceId }
      const category = await prisma.fundingSourceCategory.findFirstOrThrow({
        where: { workspaceId, key: 'bpifrance' },
      })
      const scheme = await prisma.eligibilityScheme.findFirstOrThrow({
        where: { workspaceId, key: 'jeir' },
      })
      const step = await prisma.supportStep.findFirstOrThrow({
        where: { workspaceId, key: 'diagnostic' },
      })
      await plans.addLine({ side: 'owner', userId: sophie.id }, candidatureId, {
        categoryId: category.id,
        amountEur: 5_000,
        state: 'planned',
      })
      await candidatures.changeFinancingStatusForWorkspace(jean, workspaceId, candidatureId, {
        from: 'preparing',
        to: 'in_committee',
      })
      await paths.setValidation(jean, workspaceId, candidatureId, step.id, {
        validated: true,
        version: 0,
      })
      await plans.addLine(ws, candidatureId, {
        categoryId: category.id,
        amountEur: 80_000,
        state: 'requested',
      })
      await eligibilities.declare(ws, candidatureId, {
        schemeId: scheme.id,
        note: 'Statut obtenu.',
      })
      await notes.create(marie, workspaceId, candidatureId, { body: 'À suivre.' })

      const view = await journal.get(jean, workspaceId, candidatureId)
      expect(interventionJournalSchema.safeParse(view).error?.issues ?? []).toEqual([])
      expect(view.entries.map((e) => e.kind).sort()).toEqual(
        ['eligibility', 'financing_status', 'funding_plan', 'note', 'support_step'].sort(),
      )
      expect(view.entries.find((e) => e.kind === 'funding_plan')).toMatchObject({
        change: 'created',
        category: 'Bpifrance',
        line: { amountEur: 80_000, state: 'requested' },
      })
      // The latest first.
      const dates = view.entries.map((e) => e.at)
      expect([...dates].sort().reverse()).toEqual(dates)
    })
  })
})
