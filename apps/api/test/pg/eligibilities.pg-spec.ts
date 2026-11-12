import { randomUUID } from 'node:crypto'
import { HttpException } from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import { DEFAULT_ELIGIBILITY_SCHEMES, reorderEligibilitySchemesSchema } from '@confluent/shared'
import { AnswerSourcesService } from '../../src/modules/answers/answer-sources.service'
import { AuditService } from '../../src/modules/audit/audit.service'
import {
  CandidaturesService,
  type CandidatureParty,
} from '../../src/modules/candidatures/candidatures.service'
import type { ClassificationService } from '../../src/modules/classification/classification.service'
import { CompaniesService } from '../../src/modules/companies/companies.service'
import type { DocumentsService } from '../../src/modules/documents/documents.service'
import { MemoryStorageAdapter } from '../../src/modules/documents/storage/memory-storage.adapter'
import { DossiersService } from '../../src/modules/dossiers/dossiers.service'
import { EligibilitiesService } from '../../src/modules/eligibilities/eligibilities.service'
import { EligibilitySchemesService } from '../../src/modules/eligibilities/eligibility-schemes.service'
import { QuestionnairesService } from '../../src/modules/questionnaires/questionnaires.service'
import { WorkspaceAccessService } from '../../src/modules/workspaces/workspace-access'
import { WorkspacesService } from '../../src/modules/workspaces/workspaces.service'
import { testDatabase } from './database'
import { eligibilitiesDown, eligibilitiesUp } from './sql-file'
import { quietNotifications } from '../../src/testing/notifications'

const UP = eligibilitiesUp()
// Without the acceptance: what an operator runs first.
const DOWN = eligibilitiesDown().slice(1)
const ACCEPT_LOSS = "SET LOCAL confluent.accept_eligibilities_loss = 'on'"
// The acceptance lasts for the whole transaction: withdrawn before a revert that must be checked.
const REFUSE_LOSS = "SET LOCAL confluent.accept_eligibilities_loss = 'off'"

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

// What the migration creates, comparable: the two tables' columns, constraints and indexes, every
// scheme (ids included: derived from the workspace and the key, the same on every run) and every
// eligibility.
const TABLES = `'eligibility_schemes', 'candidature_eligibilities'`
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
       'schemes', (SELECT json_agg(json_build_array(id, workspace_id, key, label, description, position, active)
         ORDER BY workspace_id, position) FROM eligibility_schemes),
       'eligibilities', (SELECT json_agg(to_jsonb(e) ORDER BY id) FROM candidature_eligibilities e)
     )::text AS f`,
  )
  return row.f as string
}

// ROADMAP E06.05 on PostgreSQL: the migration gives every existing workspace the default schemes
// explicitly, survives an interrupted deployment and can be undone (refusing, unless accepted, to
// lose an eligibility or a configuration); the constraints keep notes, sides and verifications
// closed and an eligibility inside its candidature's workspace; parties acting at the same moment
// never declare a scheme twice nor overwrite each other; the received candidatures are filtered by
// scheme on the real database.
describe('eligibility schemes and eligibilities (PostgreSQL)', () => {
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
  const eligibilities = new EligibilitiesService(prisma, candidatures, audit)
  const schemes = new EligibilitySchemesService(prisma, access, audit)
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
    // Their requests take the candidatures and the eligibilities with them.
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

  // A workspace created as the site creates it (default schemes included), receiving candidatures,
  // two of its conseillers (managers), and a request of an entrepreneur sent to it.
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
    for (const name of ['marie', 'jean']) {
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
    const scheme = async (key: string) =>
      (await prisma.eligibilityScheme.findFirst({ where: { workspaceId: ws.id, key } }))!
    const inWs = (u: { id: string; role: string }): CandidatureParty => ({
      side: 'workspace',
      actor: u,
      workspaceId: ws.id,
    })
    return {
      workspaceId: ws.id,
      conseillers,
      inWs,
      owner: { side: 'owner', userId: sophie.id } as CandidatureParty,
      ownerId: sophie.id,
      dossierId: dossier.id,
      candidatureId: created.id,
      scheme,
    }
  }

  describe('migration', () => {
    it('backfills the default schemes for every existing workspace; undone (refusing to lose an eligibility or a configuration unless accepted), then applied again', async () => {
      const { workspaceId, candidatureId, scheme } = await sentCandidature()
      const created = await prisma.eligibilityScheme.findMany({
        where: { workspaceId },
        orderBy: { position: 'asc' },
      })
      // Created by the API with the workspace: the defaults, in order.
      expect(created.map((s) => [s.key, s.label, s.description, s.position, s.active])).toEqual(
        DEFAULT_ELIGIBILITY_SCHEMES.map((s, i) => [s.key, s.label, s.description, i, true]),
      )
      const jei = await scheme('jei')
      await rolledBack(async (tx) => {
        // As E06.03 leaves it: workspaces without schemes.
        await run(tx, [ACCEPT_LOSS, ...DOWN, REFUSE_LOSS])
        expect(await rows(tx, `SELECT to_regclass('eligibility_schemes')::text AS t`)).toEqual([
          { t: null },
        ])
        const [before] = await rows(
          tx,
          `SELECT (SELECT count(*)::int FROM workspaces) AS workspaces,
                  (SELECT count(*)::int FROM candidatures) AS candidatures,
                  (SELECT count(*)::int FROM funding_source_categories) AS categories`,
        )
        await run(tx, UP)
        const [after] = await rows(
          tx,
          `SELECT (SELECT count(*)::int FROM workspaces) AS workspaces,
                  (SELECT count(*)::int FROM candidatures) AS candidatures,
                  (SELECT count(*)::int FROM funding_source_categories) AS categories,
                  (SELECT count(*)::int FROM eligibility_schemes) AS schemes,
                  (SELECT count(*)::int FROM eligibility_schemes WHERE NOT active) AS inactive,
                  (SELECT count(*)::int FROM candidature_eligibilities) AS eligibilities`,
        )
        expect(after).toEqual({
          ...before,
          schemes: (before.workspaces as number) * DEFAULT_ELIGIBILITY_SCHEMES.length,
          inactive: 0,
          eligibilities: 0,
        })
        const backfilled = await rows(
          tx,
          `SELECT key, label, description, position FROM eligibility_schemes
           WHERE workspace_id = '${workspaceId}' ORDER BY position`,
        )
        expect(backfilled).toEqual(
          DEFAULT_ELIGIBILITY_SCHEMES.map((s, position) => ({ ...s, position })),
        )
        // Backfilled ids are ids the contracts accept: the site reorders them like any other.
        const ids = await rows(
          tx,
          `SELECT id FROM eligibility_schemes WHERE workspace_id = '${workspaceId}' ORDER BY position`,
        )
        expect(
          reorderEligibilitySchemesSchema.safeParse({ schemeIds: ids.map((r) => r.id) }).success,
        ).toBe(true)
        const migrated = await fingerprint(tx)

        // Nothing declared nor configured: undone without acceptance, applied again, the same.
        await run(tx, DOWN)
        await run(tx, UP)
        expect(await fingerprint(tx)).toEqual(migrated)

        // An eligibility, or a scheme renamed, described, deactivated, reordered or added: refused
        // unless accepted.
        const w = `WHERE workspace_id = '${workspaceId}'`
        const backfilledJei = (
          await rows(tx, `SELECT id FROM eligibility_schemes ${w} AND key = 'jei'`)
        )[0].id as string
        expect(backfilledJei).not.toBe(jei.id)
        for (const changed of [
          `INSERT INTO candidature_eligibilities (id, candidature_id, workspace_id, scheme_id, declared_by_side, updated_by_side, updated_at)
           VALUES ('${randomUUID()}', '${candidatureId}', '${workspaceId}', '${backfilledJei}', 'owner', 'owner', now())`,
          `UPDATE eligibility_schemes SET label = 'J.E.I.' ${w} AND key = 'jei'`,
          `UPDATE eligibility_schemes SET description = NULL ${w} AND key = 'jei'`,
          `UPDATE eligibility_schemes SET active = false ${w} AND key = 'cii'`,
          `UPDATE eligibility_schemes SET position = 9 ${w} AND key = 'jeir'`,
          `INSERT INTO eligibility_schemes (id, workspace_id, key, label, position, updated_at)
           VALUES ('${randomUUID()}', '${workspaceId}', 'jeu', 'JEU', 5, now())`,
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
              `SELECT to_regclass('eligibility_schemes')::text AS s, to_regclass('candidature_eligibilities')::text AS e`,
            ),
          ).toEqual([{ s: null, e: null }])
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
    it('keeps schemes’ keys, labels and descriptions, and eligibilities’ notes, sides and verifications closed', async () => {
      const { candidatureId, workspaceId, scheme, conseillers } = await sentCandidature()
      const jei = await scheme('jei')
      const refused = (sql: string) =>
        expect(prisma.$transaction((tx) => tx.$executeRawUnsafe(sql))).rejects.toThrow()
      const insertScheme = (columns: Record<string, string>) => {
        const values = {
          id: `'${randomUUID()}'`,
          workspace_id: `'${workspaceId}'`,
          key: `'jeu'`,
          label: `'JEU'`,
          position: '5',
          updated_at: 'now()',
          ...columns,
        }
        return `INSERT INTO eligibility_schemes (${Object.keys(values).join(', ')}) VALUES (${Object.values(values).join(', ')})`
      }
      for (const columns of [
        { key: `'Jeu'` } as Record<string, string>,
        { key: `'jeu-2'` },
        { key: `'_jeu'` },
        { key: `'${'x'.repeat(61)}'` },
        { label: `''` },
        { label: `' JEU'` },
        { label: `E'JE\\nU'` },
        { label: `'${'x'.repeat(81)}'` },
        { description: `''` },
        { description: `'Texte '` },
        { description: `'${'x'.repeat(301)}'` },
        { position: '-1' },
        { key: `'jei'` },
        { label: `'JEI'` },
      ]) {
        await refused(insertScheme(columns))
      }
      await prisma.$transaction((tx) =>
        tx.$executeRawUnsafe(insertScheme({ description: `'${'x'.repeat(300)}'` })),
      )

      const insert = (columns: Record<string, string>) => {
        const values = {
          id: `'${randomUUID()}'`,
          candidature_id: `'${candidatureId}'`,
          workspace_id: `'${workspaceId}'`,
          scheme_id: `'${jei.id}'`,
          declared_by_side: `'owner'`,
          updated_by_side: `'owner'`,
          updated_at: 'now()',
          ...columns,
        }
        return `INSERT INTO candidature_eligibilities (${Object.keys(values).join(', ')}) VALUES (${Object.values(values).join(', ')})`
      }
      for (const columns of [
        { declared_by_side: `'investor'` } as Record<string, string>,
        { updated_by_side: `'admin'` },
        { note: `''` },
        { note: `' Rescrit'` },
        { note: `E'Rescrit\\n2025'` },
        { note: `'${'x'.repeat(201)}'` },
        { verified_by_id: `'${conseillers[0].id}'` },
        { version: '0' },
      ]) {
        await refused(insert(columns))
      }
      await prisma.$transaction((tx) =>
        tx.$executeRawUnsafe(
          insert({
            note: `'${'x'.repeat(200)}'`,
            verified_at: 'now()',
            verified_by_id: `'${conseillers[0].id}'`,
          }),
        ),
      )
      // Once per candidature and scheme.
      await refused(insert({}))
    })

    it('keeps an eligibility inside its candidature’s workspace, with the candidature, and its scheme undeletable', async () => {
      const a = await sentCandidature()
      const b = await sentCandidature()
      const aJei = await a.scheme('jei')
      const bJei = await b.scheme('jei')
      const insert = (candidatureId: string, workspaceId: string, schemeId: string) =>
        prisma.$transaction((tx) =>
          tx.$executeRawUnsafe(
            `INSERT INTO candidature_eligibilities (id, candidature_id, workspace_id, scheme_id, declared_by_side, updated_by_side, updated_at)
             VALUES ('${randomUUID()}', '${candidatureId}', '${workspaceId}', '${schemeId}', 'owner', 'owner', now())`,
          ),
        )
      // Another workspace's scheme, under either workspace.
      await expect(insert(a.candidatureId, a.workspaceId, bJei.id)).rejects.toThrow(/foreign key/)
      await expect(insert(a.candidatureId, b.workspaceId, bJei.id)).rejects.toThrow(/foreign key/)
      await insert(a.candidatureId, a.workspaceId, aJei.id)
      // The scheme in use cannot go; the users who verified and wrote it can, the date stays.
      await expect(prisma.eligibilityScheme.delete({ where: { id: aJei.id } })).rejects.toThrow()
      const row = (await prisma.candidatureEligibility.findFirst({
        where: { candidatureId: a.candidatureId },
      }))!
      const verifier = await account('verificatrice', 'financeur')
      await prisma.candidatureEligibility.update({
        where: { id: row.id },
        data: { verifiedAt: new Date(), verifiedById: verifier.id, updatedById: verifier.id },
      })
      await prisma.user.delete({ where: { id: verifier.id } })
      expect(
        await prisma.candidatureEligibility.findUnique({ where: { id: row.id } }),
      ).toMatchObject({ verifiedById: null, updatedById: null, verifiedAt: expect.any(Date) })
      // The eligibility goes with its candidature (here, with the request).
      await prisma.dossier.delete({ where: { id: a.dossierId } })
      expect(
        await prisma.candidatureEligibility.count({ where: { candidatureId: a.candidatureId } }),
      ).toBe(0)
    })
  })

  describe('concurrency', () => {
    it('declares a scheme once when both parties declare it at the same moment', async () => {
      for (let round = 0; round < 3; round++) {
        const { candidatureId, conseillers, inWs, owner, scheme } = await sentCandidature()
        const jei = await scheme('jei')
        const results = await Promise.allSettled([
          eligibilities.declare(owner, candidatureId, { schemeId: jei.id }),
          eligibilities.declare(inWs(conseillers[0]), candidatureId, { schemeId: jei.id }),
          eligibilities.declare(inWs(conseillers[1]), candidatureId, {
            schemeId: jei.id,
            verified: true,
          }),
        ])
        expect(results.map(failure).sort()).toEqual([
          'ELIGIBILITY_EXISTS',
          'ELIGIBILITY_EXISTS',
          'fulfilled',
        ])
        expect(await prisma.candidatureEligibility.count({ where: { candidatureId } })).toBe(1)
      }
    })

    it('applies one of three changes made at the same moment from the same version, never one over another', async () => {
      for (let round = 0; round < 3; round++) {
        const { candidatureId, conseillers, inWs, owner, scheme } = await sentCandidature()
        const jei = await scheme('jei')
        const [e] = (await eligibilities.declare(owner, candidatureId, { schemeId: jei.id }))
          .eligibilities
        const results = await Promise.allSettled([
          eligibilities.update(owner, candidatureId, e.id, { version: 1, note: 'Rescrit' }),
          eligibilities.update(inWs(conseillers[0]), candidatureId, e.id, {
            version: 1,
            verified: true,
          }),
          eligibilities.remove(inWs(conseillers[1]), candidatureId, e.id, 1),
        ])
        const outcomes = results.map(failure)
        expect(outcomes.filter((o) => o === 'fulfilled')).toHaveLength(1)
        expect(
          outcomes
            .filter((o) => o !== 'fulfilled')
            .every((o) => ['ELIGIBILITY_CHANGED', 'ELIGIBILITY_NOT_FOUND'].includes(o)),
        ).toBe(true)
        const after = await prisma.candidatureEligibility.findMany({ where: { candidatureId } })
        const winner = results.findIndex((r) => r.status === 'fulfilled')
        if (winner === 2) expect(after).toHaveLength(0)
        else expect(after.map((x) => x.version)).toEqual([2])
      }
    })

    it('never takes the same label twice when two managers add schemes at the same moment', async () => {
      for (let round = 0; round < 2; round++) {
        const { workspaceId, conseillers } = await sentCandidature()
        const results = await Promise.allSettled([
          schemes.create(conseillers[0], workspaceId, { label: 'JEU' }),
          schemes.create(conseillers[1], workspaceId, { label: 'jeu' }),
          schemes.create(conseillers[1], workspaceId, { label: 'Label GreenTech' }),
        ])
        expect(results.map(failure).sort()).toEqual([
          'ELIGIBILITY_SCHEME_LABEL_TAKEN',
          'fulfilled',
          'fulfilled',
        ])
        const list = await prisma.eligibilityScheme.findMany({ where: { workspaceId } })
        expect(new Set(list.map((s) => s.position)).size).toBe(list.length)
        expect(list).toHaveLength(DEFAULT_ELIGIBILITY_SCHEMES.length + 2)
      }
    })
  })

  describe('filters', () => {
    it('filters the received candidatures by scheme and verification on the real database', async () => {
      const { workspaceId, candidatureId, conseillers, inWs, owner, scheme } =
        await sentCandidature()
      const jeir = await scheme('jeir')
      const cir = await scheme('cir')
      await eligibilities.declare(owner, candidatureId, { schemeId: cir.id })
      await eligibilities.declare(inWs(conseillers[0]), candidatureId, {
        schemeId: jeir.id,
        verified: true,
      })
      const list = (filter = {}) =>
        candidatures
          .listReceived(conseillers[0], workspaceId, filter)
          .then((r) => r.map((c) => c.id))
      expect(await list({ scheme: jeir.id })).toEqual([candidatureId])
      expect(await list({ scheme: cir.id, verified: true })).toEqual([])
      expect(await list({ verified: true })).toEqual([candidatureId])
      expect(await list({ scheme: (await scheme('jei')).id })).toEqual([])
      expect(await list({ scheme: randomUUID() })).toEqual([])
      const [item] = await candidatures.listReceived(conseillers[0], workspaceId)
      expect(item.eligibilities.map((e) => [e.label, e.verified])).toEqual([
        ['JEIR', true],
        ['CIR', false],
      ])
    })
  })
})
