import { randomUUID } from 'node:crypto'
import { HttpException } from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import { AnswerSourcesService } from '../../src/modules/answers/answer-sources.service'
import { AuditService } from '../../src/modules/audit/audit.service'
import { CandidaturesService } from '../../src/modules/candidatures/candidatures.service'
import type { ClassificationService } from '../../src/modules/classification/classification.service'
import { CompaniesService } from '../../src/modules/companies/companies.service'
import type { DocumentsService } from '../../src/modules/documents/documents.service'
import { MemoryStorageAdapter } from '../../src/modules/documents/storage/memory-storage.adapter'
import { DossiersService } from '../../src/modules/dossiers/dossiers.service'
import { QuestionnairesService } from '../../src/modules/questionnaires/questionnaires.service'
import {
  ShowcaseCardsService,
  type ShowcaseCardInput,
} from '../../src/modules/showcase-cards/showcase-cards.service'
import { WorkspaceAccessService } from '../../src/modules/workspaces/workspace-access'
import {
  WorkspacesService,
  lockWorkspaceRow,
} from '../../src/modules/workspaces/workspaces.service'
import { testDatabase } from './database'
import { showcaseCardModerationDown, showcaseCardModerationUp } from './sql-file'
import { quietNotifications } from '../../src/testing/notifications'

const UP = showcaseCardModerationUp()
// Without the acceptance: what an operator runs first.
const DOWN = showcaseCardModerationDown().slice(1)
const ACCEPT_LOSS = "SET LOCAL confluent.accept_showcase_card_moderation_loss = 'on'"
const REFUSE_LOSS = "SET LOCAL confluent.accept_showcase_card_moderation_loss = 'off'"

class RolledBack extends Error {}

type Tx = Prisma.TransactionClient
const run = async (tx: Tx, statements: string[]) => {
  for (const sql of statements) await tx.$executeRawUnsafe(sql)
}
const rows = (tx: Tx, sql: string) => tx.$queryRawUnsafe<Array<Record<string, unknown>>>(sql)
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const outcome = (result: PromiseSettledResult<unknown>) => {
  if (result.status === 'fulfilled') return 'fulfilled'
  const err = result.reason as unknown
  return err instanceof HttpException ? err.getStatus() : String(err)
}

// The cards' columns, constraints, indexes and rows, comparable.
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

// ROADMAP E09.03 on PostgreSQL: the migration adds the managers' hiding to the cards without touching
// anything else, survives an interrupted deployment and can be undone (refusing, unless accepted, to
// show a hidden card again or lose the journal of a moderation). A manager hiding a card at the same
// moment as its owner withdraws or changes it, as the request is archived or as another manager hides
// it: each applies in turn (versions never reused, the journal replaying to the table); a manager
// deprived of the right while waiting changes nothing (R53).
describe('showcase card moderation (PostgreSQL)', () => {
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
    await prisma.dossier.deleteMany({ where: { userId: { in: ids } } })
    await prisma.company.deleteMany({ where: { ownerId: { in: ids } } })
    await prisma.questionnaireVersion.deleteMany({ where: { questionnaireId: { in: forms } } })
    await prisma.questionnaire.deleteMany({ where: { id: { in: forms } } })
    await prisma.workspaceMembership.deleteMany({ where: { workspaceId: { in: workspaces } } })
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

  const account = (name: string, role = 'entrepreneur') =>
    prisma.user.create({
      data: {
        email: `${name}-${randomUUID().slice(0, 6)}-${tag}@pg-test.dev`,
        role: role as 'entrepreneur',
        emailVerifiedAt: new Date(),
      },
    })

  // A workspace receiving candidatures, its page published, with two managers; a request of
  // Sophie's sent to it, its card consented.
  async function consented() {
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
    const managers = []
    for (const name of ['marie', 'paul']) {
      const u = await account(name, 'financeur')
      await prisma.workspaceMembership.create({
        data: { workspaceId: ws.id, userId: u.id, role: 'conseiller', canManageWorkspace: true },
      })
      managers.push({ id: u.id, role: 'financeur' })
    }
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
    const created = await candidatures.create(dossier.id, sophie.id, ws.id)
    await candidatures.submit(created.id, sophie.id)
    await cards.publish(created.id, sophie.id, consent('Projet Héron', null))
    return {
      workspace: ws,
      managers,
      sophie: sophie.id,
      dossierId: dossier.id,
      candidatureId: created.id,
    }
  }

  const consent = (pseudonym: string, version: number | null): ShowcaseCardInput => ({
    pseudonym,
    region: null,
    consent: true,
    version,
  })
  const shown = async (workspaceId: string) => {
    const ws = await prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } })
    return (await cards.publicCards(ws, Date.now())).map((c) => c.pseudonym)
  }
  // The card's journal, oldest first: each entry one version above the previous one, the last the
  // table's.
  const expectJournalReplays = async (dossierId: string, candidatureId: string) => {
    const entries = await prisma.auditLog.findMany({
      where: {
        dossierId,
        actionType: {
          in: [
            'showcase_card_published',
            'showcase_card_withdrawn',
            'showcase_card_hidden',
            'showcase_card_unhidden',
          ],
        },
      },
      orderBy: { createdAt: 'asc' },
    })
    const row = await prisma.showcaseCard.findUniqueOrThrow({ where: { candidatureId } })
    expect(entries.map((e) => (e.metadata as { version: number }).version)).toEqual(
      entries.map((_, i) => i + 1),
    )
    expect(row.version).toBe(entries.length)
    return { entries, row }
  }

  describe('migration', () => {
    it('adds the hiding and nothing else; undone (refusing to show a hidden card again or lose a moderation unless accepted), then applied again', async () => {
      const { candidatureId, dossierId, managers } = await consented()
      await rolledBack(async (tx) => {
        await run(tx, [ACCEPT_LOSS, ...DOWN, REFUSE_LOSS])
        expect(
          await rows(
            tx,
            `SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema()
             AND table_name = 'showcase_cards' AND column_name LIKE 'hidden%'`,
          ),
        ).toEqual([])
        const counts = `SELECT (SELECT count(*)::int FROM dossiers) AS dossiers,
                  (SELECT count(*)::int FROM candidatures) AS candidatures,
                  (SELECT count(*)::int FROM showcase_cards) AS cards,
                  (SELECT count(*)::int FROM workspaces) AS workspaces,
                  (SELECT count(*)::int FROM audit_log) AS journal`
        const [before] = await rows(tx, counts)
        const cardsBefore = await rows(
          tx,
          'SELECT id, pseudonym, version, withdrawn_at FROM showcase_cards ORDER BY id',
        )
        await run(tx, UP)
        expect((await rows(tx, counts))[0]).toEqual(before)
        // Every card as it was, none hidden.
        expect(
          await rows(
            tx,
            'SELECT id, pseudonym, version, withdrawn_at FROM showcase_cards ORDER BY id',
          ),
        ).toEqual(cardsBefore)
        expect(
          await rows(
            tx,
            'SELECT count(*)::int AS n FROM showcase_cards WHERE hidden_at IS NOT NULL',
          ),
        ).toEqual([{ n: 0 }])
        const migrated = await fingerprint(tx)

        // Without any card hidden: undone without acceptance, applied again, the same.
        await run(tx, DOWN)
        await run(tx, UP)
        expect(await fingerprint(tx)).toEqual(migrated)

        // A card hidden, or a journal entry alone: refused unless accepted; accepted, the hiding and
        // its journal go, nothing else.
        for (const trace of [
          `UPDATE showcase_cards SET hidden_at = now(), hidden_by_id = '${managers[0].id}' WHERE candidature_id = '${candidatureId}'`,
          `INSERT INTO audit_log (id, dossier_id, action_type, actor_id, metadata)
           VALUES ('${randomUUID()}', '${dossierId}', 'showcase_card_unhidden', '${managers[0].id}', '{}')`,
        ]) {
          await tx.$executeRawUnsafe('SAVEPOINT traced')
          await tx.$executeRawUnsafe(trace)
          await tx.$executeRawUnsafe('SAVEPOINT before_down')
          await expect(run(tx, DOWN)).rejects.toThrow(/shown again|trace would be lost/)
          await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT before_down')
          await run(tx, [ACCEPT_LOSS, ...DOWN, REFUSE_LOSS])
          expect(
            await rows(
              tx,
              `SELECT count(*)::int AS n FROM audit_log WHERE action_type::text IN ('showcase_card_hidden', 'showcase_card_unhidden')`,
            ),
          ).toEqual([{ n: 0 }])
          expect((await rows(tx, counts))[0]).toEqual(before)
          await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT traced')
        }
      })
    })

    it('survives an interrupted deployment: any prefix of the migration, then all of it, gives the same database', async () => {
      await consented()
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

    it('keeps who hid a card only while it is hidden; the hiding outlives the account that made it', async () => {
      const { candidatureId, managers, workspace } = await consented()
      await rolledBack(async (tx) => {
        await tx.$executeRawUnsafe('SAVEPOINT attempt')
        await expect(
          tx.$executeRawUnsafe(
            `UPDATE showcase_cards SET hidden_by_id = '${managers[0].id}' WHERE candidature_id = '${candidatureId}'`,
          ),
        ).rejects.toThrow(/showcase_cards_hidden_check/)
        await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT attempt')
      })
      await cards.setHidden(managers[0], workspace.id, candidatureId, true)
      const temp = await account('temp', 'financeur')
      await prisma.showcaseCard.update({ where: { candidatureId }, data: { hiddenById: temp.id } })
      await prisma.user.delete({ where: { id: temp.id } })
      expect(
        await prisma.showcaseCard.findUniqueOrThrow({ where: { candidatureId } }),
      ).toMatchObject({ hiddenById: null, hiddenAt: expect.any(Date) })
      expect(await shown(workspace.id)).toEqual([])
    })
  })

  describe('concurrency', () => {
    it('applies a hiding and the owner’s withdrawal or change at the same moment one after the other: versions never reused, the journal replays to the table', async () => {
      for (let round = 0; round < 4; round++) {
        const { candidatureId, dossierId, managers, sophie, workspace } = await consented()
        const owner =
          round % 2 === 0
            ? cards.withdraw(candidatureId, sophie)
            : cards.publish(candidatureId, sophie, consent('Héron bleu', 1))
        const results = await Promise.allSettled([
          cards.setHidden(managers[0], workspace.id, candidatureId, true),
          owner,
        ])
        // The withdrawal always applies; the change applies first or meets the hiding's new
        // version (409); the hiding applies, or finds the card already withdrawn (404).
        if (round % 2 === 0) expect(outcome(results[1])).toBe('fulfilled')
        else expect(['fulfilled', 409]).toContain(outcome(results[1]))
        expect(['fulfilled', 404]).toContain(outcome(results[0]))
        const { row } = await expectJournalReplays(dossierId, candidatureId)
        expect(row.hiddenAt !== null).toBe(outcome(results[0]) === 'fulfilled')
        expect(await shown(workspace.id)).toEqual([])
      }
    })

    it('lets two managers hide at the same moment: one hiding, one version', async () => {
      const { candidatureId, dossierId, managers, workspace } = await consented()
      const results = await Promise.allSettled([
        cards.setHidden(managers[0], workspace.id, candidatureId, true),
        cards.setHidden(managers[1], workspace.id, candidatureId, true),
      ])
      expect(results.map(outcome)).toEqual(['fulfilled', 'fulfilled'])
      const { entries, row } = await expectJournalReplays(dossierId, candidatureId)
      expect(entries.map((e) => e.actionType)).toEqual([
        'showcase_card_published',
        'showcase_card_hidden',
      ])
      expect(row.hiddenById).toBe(entries[1].actorId)
    })

    it('never leaves a hiding on a request archived at the same moment out of order', async () => {
      for (let round = 0; round < 4; round++) {
        const { candidatureId, dossierId, managers, sophie, workspace } = await consented()
        const results = await Promise.allSettled([
          cards.setHidden(managers[0], workspace.id, candidatureId, true),
          dossiers.archive(dossierId, sophie),
        ])
        expect(outcome(results[1])).toBe('fulfilled')
        expect(['fulfilled', 404]).toContain(outcome(results[0]))
        const { row } = await expectJournalReplays(dossierId, candidatureId)
        expect(row.withdrawalReason).toBe('archived')
        expect(await shown(workspace.id)).toEqual([])
      }
    })

    it('changes nothing for a manager deprived of the right while the hiding waited (R53)', async () => {
      const { candidatureId, dossierId, managers, workspace } = await consented()
      const before = await prisma.showcaseCard.findUniqueOrThrow({ where: { candidatureId } })
      let hiding: Promise<unknown> | null = null
      // Another manager holds the workspace (as a change of members does), takes the right away,
      // and commits only once the hiding has started waiting.
      await prisma.$transaction(
        async (tx) => {
          await lockWorkspaceRow(tx, workspace.id)
          await tx.workspaceMembership.update({
            where: { workspaceId_userId: { workspaceId: workspace.id, userId: managers[0].id } },
            data: { canManageWorkspace: false },
          })
          hiding = cards.setHidden(managers[0], workspace.id, candidatureId, true).then(
            () => 'fulfilled',
            (err: unknown) => (err instanceof HttpException ? err.getStatus() : String(err)),
          )
          await sleep(400)
        },
        { timeout: 20_000 },
      )
      expect(await hiding).toBe(403)
      expect(await prisma.showcaseCard.findUniqueOrThrow({ where: { candidatureId } })).toEqual(
        before,
      )
      expect(
        await prisma.auditLog.count({ where: { dossierId, actionType: 'showcase_card_hidden' } }),
      ).toBe(0)
      expect(await shown(workspace.id)).toEqual(['Projet Héron'])
    })
  })
})
