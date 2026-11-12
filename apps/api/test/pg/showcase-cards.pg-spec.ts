import { randomUUID } from 'node:crypto'
import { HttpException } from '@nestjs/common'
import { Prisma as PrismaNamespace, type Prisma } from '@prisma/client'
import { AnswerSourcesService } from '../../src/modules/answers/answer-sources.service'
import { AuditService } from '../../src/modules/audit/audit.service'
import { CandidaturesService } from '../../src/modules/candidatures/candidatures.service'
import type { ClassificationService } from '../../src/modules/classification/classification.service'
import { CompaniesService } from '../../src/modules/companies/companies.service'
import type { DocumentsService } from '../../src/modules/documents/documents.service'
import { MemoryStorageAdapter } from '../../src/modules/documents/storage/memory-storage.adapter'
import { DossiersService } from '../../src/modules/dossiers/dossiers.service'
import { QuestionnairesService } from '../../src/modules/questionnaires/questionnaires.service'
import { CARD_COLUMN_AUDIENCES } from '../../src/modules/showcase-cards/showcase-card-views'
import {
  ShowcaseCardsService,
  type ShowcaseCardInput,
} from '../../src/modules/showcase-cards/showcase-cards.service'
import { WorkspaceAccessService } from '../../src/modules/workspaces/workspace-access'
import { WorkspacesService } from '../../src/modules/workspaces/workspaces.service'
import { testDatabase } from './database'
import { showcaseCardsDown, showcaseCardsUp } from './sql-file'
import { quietNotifications } from '../../src/testing/notifications'

const UP = showcaseCardsUp()
// Without the acceptance: what an operator runs first.
const DOWN = showcaseCardsDown().slice(1)
const ACCEPT_LOSS = "SET LOCAL confluent.accept_showcase_cards_loss = 'on'"
// The acceptance lasts for the whole transaction: withdrawn before a revert that must be checked.
const REFUSE_LOSS = "SET LOCAL confluent.accept_showcase_cards_loss = 'off'"

class RolledBack extends Error {}

type Tx = Prisma.TransactionClient
const run = async (tx: Tx, statements: string[]) => {
  for (const sql of statements) await tx.$executeRawUnsafe(sql)
}
const rows = (tx: Tx, sql: string) => tx.$queryRawUnsafe<Array<Record<string, unknown>>>(sql)

const outcome = (result: PromiseSettledResult<unknown>) => {
  if (result.status === 'fulfilled') return 'fulfilled'
  const err = result.reason as unknown
  return err instanceof HttpException ? err.getStatus() : String(err)
}

// What the migration creates, comparable: the table's columns, constraints, indexes and rows.
async function fingerprint(tx: Tx): Promise<string> {
  const [row] = await rows(
    tx,
    `SELECT json_build_object(
       'columns', (SELECT json_agg(x ORDER BY x) FROM (
         SELECT column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, '') AS x
         FROM information_schema.columns
         WHERE table_schema = current_schema() AND table_name = 'showcase_cards') c),
       'constraints', (SELECT json_agg(x ORDER BY x) FROM (
         SELECT conname || ':' || pg_get_constraintdef(oid) AS x
         FROM pg_constraint WHERE conrelid::regclass::text = 'showcase_cards') k),
       'indexes', (SELECT json_agg(indexdef ORDER BY indexdef) FROM pg_indexes
         WHERE schemaname = current_schema() AND tablename = 'showcase_cards'),
       'cards', (SELECT json_agg(to_jsonb(s) ORDER BY id) FROM showcase_cards s)
     )::text AS f`,
  )
  return row.f as string
}

// ROADMAP E09.02 on PostgreSQL: the migration adds the cards without touching anything else, survives
// an interrupted deployment and can be undone (refusing, unless accepted, to lose a consent or its
// journal); the constraints keep a card in its candidature's workspace, one per candidature, its
// pseudonym plain and bounded, its region known and its withdrawal coherent. Under the request's
// lock, simultaneous consents from one version let one through, a withdrawal and a consent at the
// same moment each apply in turn (versions never reused, the journal replaying to the table), a
// consent never slips past an archiving, and a withdrawn card is gone from the next public read.
describe('showcase cards (PostgreSQL)', () => {
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
  const cards = new ShowcaseCardsService(
    prisma,
    candidatures,
    dossiers,
    audit,
    access,
    quietNotifications(prisma),
  )
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
    // Their requests take the candidatures and cards with them.
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

  const account = (name: string) =>
    prisma.user.create({
      data: {
        email: `${name}-${randomUUID().slice(0, 6)}-${tag}@pg-test.dev`,
        role: 'entrepreneur',
        emailVerifiedAt: new Date(),
      },
    })

  // A workspace created as the site creates it, receiving candidatures, its page published.
  async function openWorkspace(): Promise<{ id: string; slug: string }> {
    const ws = await workspacesService.create(admin, {
      name: 'Structure test',
      slug: `pg-${randomUUID().slice(0, 12)}`,
    })
    workspaces.push(ws.id)
    await prisma.workspace.update({ where: { id: ws.id }, data: { publicPagePublished: true } })
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
    return { id: ws.id, slug: ws.slug }
  }

  // An entrepreneur's request, published, sent to two workspaces.
  async function presented() {
    const [a, b] = [await openWorkspace(), await openWorkspace()]
    const sophie = await account('sophie')
    const dossier = await dossiers.create({
      owner: { id: sophie.id, role: sophie.role },
      name: 'Biosensio',
    })
    await prisma.dossier.update({
      where: { id: dossier.id },
      data: {
        submittedAt: new Date(),
        publicationStatus: 'published',
        publishedAt: new Date(),
        amountEur: 300_000,
      },
    })
    const send = async (workspaceId: string) => {
      const created = await candidatures.create(dossier.id, sophie.id, workspaceId)
      await candidatures.submit(created.id, sophie.id)
      return created.id
    }
    return {
      sophie: sophie.id,
      dossierId: dossier.id,
      a: { workspace: a, candidatureId: await send(a.id) },
      b: { workspace: b, candidatureId: await send(b.id) },
    }
  }

  const consent = (pseudonym: string, version: number | null): ShowcaseCardInput => ({
    pseudonym,
    region: 'bretagne',
    consent: true,
    version,
  })
  const shown = async (workspaceId: string) => {
    const ws = await prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } })
    return (await cards.publicCards(ws, Date.now())).map((c) => c.pseudonym)
  }

  describe('migration', () => {
    it('adds the cards and nothing else; undone (refusing to lose one or its journal unless accepted), then applied again', async () => {
      const { sophie, dossierId, a } = await presented()
      await rolledBack(async (tx) => {
        await run(tx, [ACCEPT_LOSS, ...DOWN, REFUSE_LOSS])
        expect(await rows(tx, `SELECT to_regclass('showcase_cards')::text AS t`)).toEqual([
          { t: null },
        ])
        const counts = `SELECT (SELECT count(*)::int FROM dossiers) AS dossiers,
                  (SELECT count(*)::int FROM candidatures) AS candidatures,
                  (SELECT count(*)::int FROM pool_publications) AS pool,
                  (SELECT count(*)::int FROM share_links) AS shares,
                  (SELECT count(*)::int FROM workspaces) AS workspaces,
                  (SELECT count(*)::int FROM audit_log) AS journal`
        const [before] = await rows(tx, counts)
        await run(tx, UP)
        expect((await rows(tx, counts))[0]).toEqual(before)
        expect(await rows(tx, 'SELECT count(*)::int AS n FROM showcase_cards')).toEqual([{ n: 0 }])
        const migrated = await fingerprint(tx)

        // Without any card: undone without acceptance, applied again, the same.
        await run(tx, DOWN)
        await run(tx, UP)
        expect(await fingerprint(tx)).toEqual(migrated)

        // A card — even withdrawn — or a journal entry alone: refused unless accepted; accepted, the
        // cards and their journal go, nothing else.
        for (const trace of [
          `INSERT INTO showcase_cards (id, candidature_id, workspace_id, pseudonym, consented_at, consented_by_id, updated_at)
           VALUES ('${randomUUID()}', '${a.candidatureId}', '${a.workspace.id}', 'Projet Héron', now(), '${sophie}', now())`,
          `INSERT INTO showcase_cards (id, candidature_id, workspace_id, pseudonym, consented_at, withdrawn_at, withdrawal_reason, updated_at)
           VALUES ('${randomUUID()}', '${a.candidatureId}', '${a.workspace.id}', 'Projet Héron', now(), now(), 'archived', now())`,
          `INSERT INTO audit_log (id, dossier_id, action_type, actor_id, metadata)
           VALUES ('${randomUUID()}', '${dossierId}', 'showcase_card_withdrawn', '${sophie}', '{}')`,
        ]) {
          await tx.$executeRawUnsafe('SAVEPOINT traced')
          await tx.$executeRawUnsafe(trace)
          await tx.$executeRawUnsafe('SAVEPOINT before_down')
          await expect(run(tx, DOWN)).rejects.toThrow(/would be lost/)
          await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT before_down')
          await run(tx, [ACCEPT_LOSS, ...DOWN, REFUSE_LOSS])
          expect(await rows(tx, `SELECT to_regclass('showcase_cards')::text AS t`)).toEqual([
            { t: null },
          ])
          expect(
            await rows(
              tx,
              `SELECT count(*)::int AS n FROM audit_log WHERE action_type::text LIKE 'showcase_card_%'`,
            ),
          ).toEqual([{ n: 0 }])
          expect((await rows(tx, counts))[0]).toEqual(before)
          await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT traced')
        }
      })
    })

    it('survives an interrupted deployment: any prefix of the migration, then all of it, gives the same database', async () => {
      await presented()
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
    it('keeps a card in its candidature’s workspace, one per candidature, its pseudonym plain and bounded, its region known, its withdrawal and version coherent', async () => {
      const { sophie, a, b } = await presented()
      // The constraints as this migration file writes them.
      await rolledBack(async (tx) => {
        await run(tx, [ACCEPT_LOSS, ...DOWN, REFUSE_LOSS, ...UP])
        const insert = (columns: Record<string, string>) => {
          const values = {
            id: `'${randomUUID()}'`,
            candidature_id: `'${a.candidatureId}'`,
            workspace_id: `'${a.workspace.id}'`,
            pseudonym: `'Projet Héron'`,
            region: 'NULL',
            consented_at: 'now()',
            consented_by_id: `'${sophie}'`,
            updated_at: 'now()',
            ...columns,
          }
          return `INSERT INTO showcase_cards (${Object.keys(values).join(', ')}) VALUES (${Object.values(values).join(', ')})`
        }
        const attempt = async (sql: string) => {
          await tx.$executeRawUnsafe('SAVEPOINT attempt')
          const result = await tx.$executeRawUnsafe(sql).then(
            () => 'inserted',
            (e: Error) => e.message,
          )
          await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT attempt')
          return result
        }
        for (const columns of [
          { pseudonym: 'NULL' },
          { pseudonym: `''` },
          { pseudonym: `'H'` },
          { pseudonym: `'${'x'.repeat(61)}'` },
          { pseudonym: `' Héron'` },
          { pseudonym: `'Héron '` },
          { pseudonym: `'Projet  Héron'` },
          { pseudonym: `E'Projet\\nHéron'` },
          { pseudonym: `E'Projet\\tHéron'` },
          { pseudonym: `'<b>Héron</b>'` },
          { pseudonym: `'sophie@biosensio.fr'` },
          { pseudonym: `'https://biosensio.fr'` },
          { pseudonym: `'WWW.biosensio.fr'` },
          { region: `'Bretagne'` },
          { region: `'touraine'` },
          { region: `''` },
          { withdrawn_at: 'now()' },
          { withdrawal_reason: `'owner'` },
          { withdrawn_at: 'now()', withdrawal_reason: `'oubli'` },
          { withdrawn_by_id: `'${sophie}'` },
          { withdrawn_at: `now() - interval '1 day'`, withdrawal_reason: `'owner'` },
          { version: '0' },
        ] as Array<Record<string, string>>) {
          expect([columns, await attempt(insert(columns))]).toEqual([
            columns,
            expect.stringMatching(/check constraint|23502|null value/),
          ])
        }
        // Another workspace's page with this candidature, or an unknown candidature: refused.
        expect(await attempt(insert({ workspace_id: `'${b.workspace.id}'` }))).toMatch(
          /foreign key/,
        )
        expect(await attempt(insert({ candidature_id: `'${randomUUID()}'` }))).toMatch(
          /foreign key/,
        )
        for (const columns of [
          { pseudonym: `'Hé'` },
          { pseudonym: `'${'é'.repeat(60)}'` },
          { pseudonym: `'🦩🦩'` },
          { pseudonym: `'Projet n° 42 — eau (< 1 M€)'` },
          { region: `'provence-alpes-cote-d-azur'` },
          {
            withdrawn_at: 'now()',
            withdrawal_reason: `'archived'`,
            withdrawn_by_id: `'${sophie}'`,
            version: '2147483647',
          },
        ] as Array<Record<string, string>>) {
          expect([columns, await attempt(insert(columns))]).toEqual([columns, 'inserted'])
        }
        await tx.$executeRawUnsafe(insert({}))
        // One per candidature.
        expect(await attempt(insert({}))).toMatch(/already exists|unique/i)
      })
    })

    it('goes with its request; outlives the account that consented', async () => {
      const { sophie, dossierId, a } = await presented()
      await cards.publish(a.candidatureId, sophie, consent('Projet Héron', null))
      const row = await prisma.showcaseCard.findUniqueOrThrow({
        where: { candidatureId: a.candidatureId },
      })
      const temp = await account('temp')
      await prisma.showcaseCard.update({ where: { id: row.id }, data: { consentedById: temp.id } })
      await prisma.user.delete({ where: { id: temp.id } })
      expect(await prisma.showcaseCard.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({
        consentedById: null,
        pseudonym: 'Projet Héron',
      })
      await prisma.dossier.delete({ where: { id: dossierId } })
      expect(await prisma.showcaseCard.count({ where: { id: row.id } })).toBe(0)
    })
  })

  describe('audiences', () => {
    it('classifies every column of the tables a card is built from', async () => {
      for (const [model, audience] of Object.entries(CARD_COLUMN_AUDIENCES)) {
        const fields = PrismaNamespace.dmmf.datamodel.models.find((m) => m.name === model)!
        const classified = Object.keys(audience)
          .map((field) => {
            const column = fields.fields.find((f) => f.name === field)!
            return column.dbName ?? column.name
          })
          .sort()
        const columns = await prisma.$queryRawUnsafe<Array<{ column_name: string }>>(
          `SELECT column_name FROM information_schema.columns
           WHERE table_schema = current_schema() AND table_name = '${fields.dbName ?? model}'
           ORDER BY column_name`,
        )
        expect([model, columns.map((c) => c.column_name)]).toEqual([model, classified])
      }
    })
  })

  describe('concurrency', () => {
    it('lets one of two consents from the same version through; the other gets 409, versions never reused', async () => {
      for (let round = 0; round < 3; round++) {
        const { sophie, dossierId, a } = await presented()
        const results = await Promise.allSettled([
          cards.publish(a.candidatureId, sophie, consent('Projet Héron', null)),
          cards.publish(a.candidatureId, sophie, consent('Projet Aigrette', null)),
        ])
        expect(results.map(outcome).sort()).toEqual([409, 'fulfilled'])
        const row = await prisma.showcaseCard.findUniqueOrThrow({
          where: { candidatureId: a.candidatureId },
        })
        expect(row.version).toBe(1)
        const entries = await prisma.auditLog.findMany({
          where: { dossierId, actionType: 'showcase_card_published' },
        })
        expect(entries.map((e) => (e.metadata as { pseudonym: string }).pseudonym)).toEqual([
          row.pseudonym,
        ])
        expect(await shown(a.workspace.id)).toEqual([row.pseudonym])
      }
    })

    it('applies a withdrawal and a consent at the same moment one after the other: the journal replays to the table, and the public reads what was committed', async () => {
      for (let round = 0; round < 4; round++) {
        const { sophie, dossierId, a } = await presented()
        await cards.publish(a.candidatureId, sophie, consent('Projet Héron', null))
        const results = await Promise.allSettled([
          cards.withdraw(a.candidatureId, sophie),
          cards.publish(a.candidatureId, sophie, consent('Héron bleu', 1)),
        ])
        expect(outcome(results[0])).toBe('fulfilled')
        // Either renamed then withdrawn, or withdrawn first: the rename, made from version 1, is
        // refused (409) rather than shown again without a new reading.
        expect(['fulfilled', 409]).toContain(outcome(results[1]))
        const row = await prisma.showcaseCard.findUniqueOrThrow({
          where: { candidatureId: a.candidatureId },
        })
        expect(row.withdrawnAt).not.toBeNull()
        expect(await shown(a.workspace.id)).toEqual([])
        const entries = await prisma.auditLog.findMany({
          where: {
            dossierId,
            actionType: { in: ['showcase_card_published', 'showcase_card_withdrawn'] },
          },
          orderBy: { createdAt: 'asc' },
        })
        // Each entry carries a version one above the previous one, the last the table's.
        expect(entries.map((e) => (e.metadata as { version: number }).version)).toEqual(
          entries.map((_, i) => i + 1),
        )
        expect(entries.at(-1)!.actionType).toBe('showcase_card_withdrawn')
        expect(row.version).toBe(entries.length)
      }
    })

    it('never leaves a card active on a request archived at the same moment', async () => {
      for (let round = 0; round < 4; round++) {
        const { sophie, dossierId, a, b } = await presented()
        await cards.publish(b.candidatureId, sophie, consent('Projet Héron', null))
        const results = await Promise.allSettled([
          cards.publish(a.candidatureId, sophie, consent('Projet Aigrette', null)),
          dossiers.archive(dossierId, sophie),
        ])
        expect(outcome(results[1])).toBe('fulfilled')
        // Either consented then withdrawn by the archiving, or refused for an archived request.
        expect(['fulfilled', 409]).toContain(outcome(results[0]))
        expect(
          await prisma.showcaseCard.count({
            where: { candidature: { dossierId }, withdrawnAt: null },
          }),
        ).toBe(0)
        expect(await shown(a.workspace.id)).toEqual([])
        expect(await shown(b.workspace.id)).toEqual([])
        const withdrawals = await prisma.auditLog.count({
          where: { dossierId, actionType: 'showcase_card_withdrawn' },
        })
        expect(withdrawals).toBe(outcome(results[0]) === 'fulfilled' ? 2 : 1)
      }
    })

    it('withdraws from one workspace while consenting in the other at the same moment, touching nothing else', async () => {
      const { sophie, dossierId, a, b } = await presented()
      await cards.publish(a.candidatureId, sophie, consent('Projet Héron', null))
      const before = {
        dossier: await prisma.dossier.findUniqueOrThrow({ where: { id: dossierId } }),
        candidatures: await prisma.candidature.findMany({
          where: { dossierId },
          orderBy: { id: 'asc' },
        }),
      }
      await Promise.all([
        cards.withdraw(a.candidatureId, sophie),
        cards.publish(b.candidatureId, sophie, consent('Projet Aigrette', null)),
      ])
      expect(await shown(a.workspace.id)).toEqual([])
      expect(await shown(b.workspace.id)).toEqual(['Projet Aigrette'])
      expect(await prisma.dossier.findUniqueOrThrow({ where: { id: dossierId } })).toEqual(
        before.dossier,
      )
      expect(
        await prisma.candidature.findMany({ where: { dossierId }, orderBy: { id: 'asc' } }),
      ).toEqual(before.candidatures)
    })
  })
})
