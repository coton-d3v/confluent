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
import {
  CHECKS,
  MIGRATIONS,
  candidatureNotesDown,
  committeeApplicationsDown,
  eligibilitiesDown,
  fundingPlanPledgesDown,
  fundingPlanPledgesUp,
  fundingPlansDown,
  fundingPlansUp,
  poolPublicationsDown,
  sqlStatements,
  statusesDown,
  statusesUp,
  supportPathsDown,
} from './sql-file'

const UP = sqlStatements(join(MIGRATIONS, '20261115000000_workspace_forms/migration.sql'))
const DOWN = sqlStatements(join(CHECKS, '20261115000000_workspace_forms.down.sql'))
const ACCEPT_LOSS = "SET LOCAL confluent.accept_workspace_forms_loss = 'on'"
// E06.01 builds on the candidatures: undone first, applied again last.
const LATER_DOWN = [
  // E08.03's entries reference the candidatures through E06.03's unique index.
  ...committeeApplicationsDown(),
  ...fundingPlanPledgesDown(),
  ...poolPublicationsDown(),
  ...candidatureNotesDown(),
  ...supportPathsDown(),
  ...eligibilitiesDown(),
  ...fundingPlansDown(),
  ...statusesDown(),
]
const LATER_UP = [...statusesUp(), ...fundingPlansUp(), ...fundingPlanPledgesUp()]

class RolledBack extends Error {}

type Tx = Prisma.TransactionClient
const run = async (tx: Tx, statements: string[]) => {
  for (const sql of statements) await tx.$executeRawUnsafe(sql)
}
const rows = (tx: Tx, sql: string) => tx.$queryRawUnsafe<Array<Record<string, unknown>>>(sql)

const statusOf = (result: PromiseSettledResult<unknown>) =>
  result.status === 'rejected' && result.reason instanceof HttpException
    ? result.reason.getStatus()
    : result.status

// What the migration may change, comparable: columns, constraints and indexes of the tables it
// touches, and Confluent's own forms (which it keeps).
const TABLES = `'questionnaires', 'candidatures', 'candidature_answers', 'candidature_answer_revisions'`
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
       'forms', (SELECT json_agg(json_build_array(id, slug, usage) ORDER BY id) FROM questionnaires
         WHERE to_jsonb(questionnaires) ->> 'workspace_id' IS NULL)
     )::text AS f`,
  )
  return row.f as string
}

// ROADMAP E05.09 on PostgreSQL: the migration survives an interrupted deployment and can be undone
// (refusing, unless accepted, while a workspace form or a candidature exists); the database keeps a
// usage to its owner and to one form, and a request to one candidature per workspace; a
// candidature is created once when asked twice at the same time, and a submission racing a save
// never leaves a sent candidature without its required answers.
describe('workspace forms and candidatures (PostgreSQL)', () => {
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
    // Their companies, dossiers and candidatures go with them; then the forms and the workspaces.
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
        { timeout: 120_000 },
      ),
    ).rejects.toThrow(RolledBack)

  const workspace = async () => {
    const ws = await prisma.workspace.create({
      data: { slug: `pg-${randomUUID().slice(0, 12)}`, name: 'Structure test' },
    })
    workspaces.push(ws.id)
    return ws.id
  }

  // A published complementary form of the workspace, assigned to its candidatures, with one
  // required question.
  async function openWorkspace() {
    const workspaceId = await workspace()
    const form = await prisma.questionnaire.create({
      data: {
        slug: `pg-form-${randomUUID().slice(0, 12)}`,
        name: 'Formulaire complémentaire',
        workspaceId,
        usage: 'candidature',
      },
    })
    forms.push(form.id)
    const version = await prisma.questionnaireVersion.create({
      data: { questionnaireId: form.id, version: 1, status: 'published', publishedAt: new Date() },
    })
    const section = await prisma.questionnaireSection.create({
      data: { versionId: version.id, key: 'candidature', title: 'Candidature', orderIndex: 0 },
    })
    const field = await prisma.questionnaireField.create({
      data: {
        versionId: version.id,
        sectionId: section.id,
        key: 'pourquoi',
        label: 'Pourquoi nous ?',
        fieldType: 'textarea',
        required: true,
        orderIndex: 0,
      },
    })
    return { workspaceId, formId: form.id, fieldId: field.id }
  }

  // An entrepreneur's request, its profile submitted.
  async function request() {
    const sophie = await prisma.user.create({
      data: {
        email: `sophie-${randomUUID().slice(0, 6)}-${tag}@pg-test.dev`,
        role: 'entrepreneur',
        emailVerifiedAt: new Date(),
      },
    })
    const owner = { id: sophie.id, email: sophie.email, role: sophie.role }
    const dossier = await dossiers.create({ owner, name: 'Biosensio' })
    await prisma.dossier.update({ where: { id: dossier.id }, data: { submittedAt: new Date() } })
    return { owner, dossier }
  }

  describe('migration', () => {
    it('can be undone, refusing while workspace forms or candidatures exist unless accepted, then applied again', async () => {
      const { workspaceId, fieldId } = await openWorkspace()
      const { owner, dossier } = await request()
      const candidature = await candidatures.create(dossier.id, owner.id, workspaceId)
      await candidatures.saveAnswers(candidature.id, owner.id, [{ fieldId, value: 'Privé' }], {
        userId: owner.id,
        channel: 'site',
      })
      await rolledBack(async (tx) => {
        const before = await fingerprint(tx)
        await run(tx, LATER_DOWN)
        await tx.$executeRawUnsafe('SAVEPOINT refused')
        const refusal = await run(tx, DOWN).then(
          () => null,
          (e: unknown) => e,
        )
        await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT refused')
        expect(String(refusal)).toMatch(/workspace forms or candidatures exist/)
        await run(tx, [ACCEPT_LOSS, ...DOWN])
        expect(
          await rows(
            tx,
            `SELECT count(*)::int AS n FROM information_schema.tables WHERE table_name IN ('candidatures', 'candidature_answers', 'candidature_answer_revisions')`,
          ),
        ).toEqual([{ n: 0 }])
        expect(
          await rows(
            tx,
            `SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name = 'questionnaires' AND column_name = 'workspace_id'`,
          ),
        ).toEqual([{ n: 0 }])
        // The request and its profile stay.
        expect(
          await rows(tx, `SELECT count(*)::int AS n FROM dossiers WHERE id = '${dossier.id}'`),
        ).toEqual([{ n: 1 }])
        await run(tx, UP)
        await run(tx, LATER_UP)
        expect(await fingerprint(tx)).toBe(before)
      })
    })

    it('survives an interrupted deployment: any prefix of the migration, then all of it, gives the same database', async () => {
      await rolledBack(async (tx) => {
        await run(tx, [...LATER_DOWN, ACCEPT_LOSS, ...DOWN])
        await run(tx, UP)
        const expected = await fingerprint(tx)
        for (let n = 1; n < UP.length; n++) {
          await tx.$executeRawUnsafe('SAVEPOINT prefix')
          await run(tx, [ACCEPT_LOSS, ...DOWN])
          await run(tx, UP.slice(0, n))
          await run(tx, UP)
          expect(await fingerprint(tx)).toBe(expected)
          await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT prefix')
        }
      })
    })
  })

  describe('constraints', () => {
    it('keeps a usage to its owner and to one form — per workspace for candidatures', async () => {
      const a = await openWorkspace()
      const b = await openWorkspace()
      const form = (data: Record<string, unknown>) =>
        prisma.questionnaire.create({
          data: { slug: `pg-c-${randomUUID().slice(0, 12)}`, name: 'Test', ...data } as never,
        })
      const refused = async (data: Record<string, unknown>) =>
        expect(
          prisma.$transaction(async (tx) => {
            await tx.questionnaire.create({
              data: { slug: `pg-r-${randomUUID().slice(0, 12)}`, name: 'Test', ...data } as never,
            })
          }),
        ).rejects.toThrow()
      // A workspace's form never serves the company profile; Confluent's never a workspace's
      // candidatures; one complementary form per workspace; one profile form for Confluent.
      await refused({ workspaceId: a.workspaceId, usage: 'dossier' })
      await refused({ usage: 'candidature' })
      await refused({ workspaceId: a.workspaceId, usage: 'candidature' })
      await refused({ usage: 'dossier' })
      await refused({ workspaceId: a.workspaceId, usage: 'autre' })
      // Two workspaces each have theirs (created above); unassigned forms are free.
      const free = await form({ workspaceId: b.workspaceId, usage: null })
      forms.push(free.id)
    })

    it('presents a request once per workspace, and keeps provenance values closed', async () => {
      const { workspaceId, fieldId } = await openWorkspace()
      const { owner, dossier } = await request()
      const candidature = await candidatures.create(dossier.id, owner.id, workspaceId)
      await expect(
        prisma.candidature.create({
          data: { dossierId: dossier.id, workspaceId, formVersionId: candidature.form.version.id },
        }),
      ).rejects.toThrow(/Unique constraint/)
      const answer = (data: Record<string, unknown>) =>
        prisma.candidatureAnswer.create({
          data: { candidatureId: candidature.id, fieldId, value: 'x', ...data } as never,
        })
      await expect(answer({})).rejects.toThrow() // without provenance
      await expect(
        answer({ origin: 'human', confirmation: 'pending', channel: 'site' }),
      ).rejects.toThrow()
      await expect(
        answer({
          origin: 'human',
          confirmation: 'confirmed',
          channel: 'site',
          clientName: 'Claude',
        }),
      ).rejects.toThrow()
      await answer({ origin: 'human', confirmation: 'confirmed', channel: 'site' })
    })
  })

  describe('concurrency', () => {
    it('creates one candidature when the same request is presented twice at the same time', async () => {
      const { workspaceId } = await openWorkspace()
      const { owner, dossier } = await request()
      const results = await Promise.allSettled([
        candidatures.create(dossier.id, owner.id, workspaceId),
        candidatures.create(dossier.id, owner.id, workspaceId),
        candidatures.create(dossier.id, owner.id, workspaceId),
      ])
      expect(results.map(statusOf).sort()).toEqual([409, 409, 'fulfilled'])
      expect(await prisma.candidature.count({ where: { dossierId: dossier.id } })).toBe(1)
    })

    it('never sends a candidature without its required answer when a save clears it at the same time', async () => {
      const site = (userId: string) => ({ userId, channel: 'site' as const })
      for (let i = 0; i < 5; i++) {
        const { workspaceId, fieldId } = await openWorkspace()
        const { owner, dossier } = await request()
        const candidature = await candidatures.create(dossier.id, owner.id, workspaceId)
        await candidatures.saveAnswers(
          candidature.id,
          owner.id,
          [{ fieldId, value: 'Oui' }],
          site(owner.id),
        )
        const [cleared, submitted] = await Promise.allSettled([
          candidatures.saveAnswers(
            candidature.id,
            owner.id,
            [{ fieldId, value: '' }],
            site(owner.id),
          ),
          candidatures.submit(candidature.id, owner.id),
        ])
        const row = await prisma.candidature.findUnique({ where: { id: candidature.id } })
        const stored = await prisma.candidatureAnswer.findFirst({
          where: { candidatureId: candidature.id, fieldId },
        })
        if (row!.submittedAt) {
          // Sent first: the clearing save was refused, the answer kept.
          expect([statusOf(submitted), statusOf(cleared)]).toEqual(['fulfilled', 400])
          expect(stored!.value).toBe('Oui')
        } else {
          // Cleared first: nothing sent.
          expect([statusOf(cleared), statusOf(submitted)]).toEqual(['fulfilled', 422])
          expect(stored!.value).toBe('')
        }
      }
    })
  })
})
