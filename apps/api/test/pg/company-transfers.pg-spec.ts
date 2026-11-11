import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { HttpException } from '@nestjs/common'
import type { ConfigService } from '@nestjs/config'
import type { Prisma } from '@prisma/client'
import type { AppConfig } from '../../src/config/config.schema'
import { AuditService } from '../../src/modules/audit/audit.service'
import type { EmailTransport } from '../../src/modules/auth/email/email-transport'
import type { ClassificationService } from '../../src/modules/classification/classification.service'
import { CompaniesService } from '../../src/modules/companies/companies.service'
import { CompanyTransfersService } from '../../src/modules/company-transfers/company-transfers.service'
import { DocumentsService } from '../../src/modules/documents/documents.service'
import { MemoryStorageAdapter } from '../../src/modules/documents/storage/memory-storage.adapter'
import { lockProfile } from '../../src/modules/dossiers/dossier-profile'
import { DossiersService } from '../../src/modules/dossiers/dossiers.service'
import type { QuestionnairesService } from '../../src/modules/questionnaires/questionnaires.service'
import { WorkspaceAccessService } from '../../src/modules/workspaces/workspace-access'
import { documentOf, testDatabase } from './database'
import { CHECKS, MIGRATIONS, sqlStatements } from './sql-file'

const UP = sqlStatements(join(MIGRATIONS, '20261114000000_company_transfers/migration.sql'))
const DOWN = sqlStatements(join(CHECKS, '20261114000000_company_transfers.down.sql'))
const ACCEPT_HELD = "SET LOCAL confluent.accept_held_companies = 'on'"

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
// touches, and the companies' owners.
const TABLES = `'companies', 'company_transfers', 'dossiers'`
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
       'owners', (SELECT json_agg(json_build_array(id, owner_id) ORDER BY id) FROM companies),
       'dossiers', (SELECT json_agg(json_build_array(id, user_id, company_id) ORDER BY id) FROM dossiers)
     )::text AS f`,
  )
  return row.f as string
}

// ROADMAP E05.08 on PostgreSQL: the migration survives an interrupted deployment and can be undone
// (refusing, unless accepted, while a company is still prepared); the constraints keep invitations
// coherent; accepting moves the company with every request in one statement, once, even when
// answered twice at the same time or raced by a withdrawal; a write its former holder started is
// refused once the company has changed hands.
describe('company transfers (PostgreSQL)', () => {
  const prisma = testDatabase()
  const audit = new AuditService(prisma)
  const companies = new CompaniesService(prisma)
  let versionId: string
  const dossiers = new DossiersService(
    prisma,
    {
      ensureBootstrap: () => Promise.resolve({ id: versionId, version: 1 }),
      getVersion: () => Promise.resolve(null),
    } as unknown as QuestionnairesService,
    {} as ClassificationService,
    audit,
    companies,
  )
  const config = { get: () => 'http://localhost:5173' } as unknown as ConfigService<AppConfig, true>
  const email = { sendCompanyTransferInvite: () => Promise.resolve() } as unknown as EmailTransport
  const transfers = new CompanyTransfersService(
    prisma,
    audit,
    new WorkspaceAccessService(prisma),
    dossiers,
    config,
    email,
  )
  const documents = new DocumentsService(prisma, new MemoryStorageAdapter(), audit)
  const tag = randomUUID().slice(0, 8)
  const address = (name: string) => `${name}-${tag}@pg-test.dev`
  const workspaces: string[] = []
  let questionnaireId: string

  beforeAll(async () => {
    const form = await prisma.questionnaire.create({
      data: { name: `Transfers ${tag}`, slug: `transfers-${tag}` },
    })
    questionnaireId = form.id
    versionId = (
      await prisma.questionnaireVersion.create({
        data: {
          questionnaireId: form.id,
          version: 1,
          status: 'published',
          publishedAt: new Date(),
        },
      })
    ).id
  })

  afterAll(async () => {
    const users = await prisma.user.findMany({
      where: { email: { endsWith: `-${tag}@pg-test.dev` } },
    })
    const ids = users.map((u) => u.id)
    await prisma.auditLog.deleteMany({ where: { actorId: { in: ids } } })
    // Their companies and dossiers go with them (in one statement: the dossiers' foreign keys are
    // checked at its end), then the invitations; the workspaces last.
    await prisma.user.deleteMany({ where: { id: { in: ids } } })
    await prisma.workspace.deleteMany({ where: { id: { in: workspaces } } })
    await prisma.questionnaireVersion.deleteMany({ where: { questionnaireId } })
    await prisma.questionnaire.delete({ where: { id: questionnaireId } })
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

  const account = async (name: string, role: 'entrepreneur' | 'financeur' = 'entrepreneur') => {
    const row = await prisma.user.create({
      data: { email: address(name), role, emailVerifiedAt: new Date() },
    })
    return { id: row.id, email: row.email, role: row.role }
  }
  // A workspace with a conseillère, and a company she prepared for Sophie, with two requests.
  async function preparedCompany() {
    const ws = await prisma.workspace.create({
      data: { slug: `pg-${randomUUID().slice(0, 12)}`, name: 'CCI test' },
    })
    workspaces.push(ws.id)
    const marie = await account(`marie-${randomUUID().slice(0, 6)}`, 'financeur')
    const sophie = await account(`sophie-${randomUUID().slice(0, 6)}`)
    await prisma.workspaceMembership.create({
      data: { workspaceId: ws.id, userId: marie.id, role: 'conseiller' },
    })
    const { preparation, dossier } = await transfers.prepare(marie, ws.id, {
      companyName: 'Biosensio',
      ownerEmail: sophie.email,
    })
    const companyId = preparation.company.id
    const second = await dossiers.createForCompany({ owner: marie, companyId, name: 'Série A' })
    const transferId = preparation.invitation.id
    return { ws: ws.id, marie, sophie, companyId, dossierIds: [dossier.id, second.id], transferId }
  }

  describe('migration', () => {
    it('can be undone, refusing while a company is still prepared unless accepted, then applied again', async () => {
      const { companyId } = await preparedCompany()
      await rolledBack(async (tx) => {
        const before = await fingerprint(tx)
        await tx.$executeRawUnsafe('SAVEPOINT refused')
        const refusal = await run(tx, DOWN).then(
          () => null,
          (e: unknown) => e,
        )
        await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT refused')
        expect(String(refusal)).toMatch(/still prepared by a conseiller/)
        await run(tx, [ACCEPT_HELD, ...DOWN])
        expect(
          await rows(
            tx,
            `SELECT count(*)::int AS n FROM information_schema.tables WHERE table_name = 'company_transfers'`,
          ),
        ).toEqual([{ n: 0 }])
        // The held company stays with its conseiller, as an ordinary company.
        expect(
          await rows(tx, `SELECT count(*)::int AS n FROM companies WHERE id = '${companyId}'`),
        ).toEqual([{ n: 1 }])
        await run(tx, UP)
        // Same structure, owners and dossiers; only the preparation and its invitations are gone.
        expect(await fingerprint(tx)).toBe(before)
        expect(
          await rows(
            tx,
            `SELECT count(*)::int AS n FROM companies WHERE prepared_in_workspace_id IS NOT NULL`,
          ),
        ).toEqual([{ n: 0 }])
      })
    })

    it('survives an interrupted deployment: any prefix of the migration, then all of it, gives the same database', async () => {
      await rolledBack(async (tx) => {
        await run(tx, [ACCEPT_HELD, ...DOWN])
        await run(tx, UP)
        const expected = await fingerprint(tx)
        for (let n = 1; n < UP.length; n++) {
          await tx.$executeRawUnsafe('SAVEPOINT prefix')
          await run(tx, [ACCEPT_HELD, ...DOWN])
          await run(tx, UP.slice(0, n))
          await run(tx, UP)
          expect(await fingerprint(tx)).toBe(expected)
          await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT prefix')
        }
      })
    })
  })

  describe('constraints', () => {
    it('refuses in the database a second pending invitation and values the API never writes', async () => {
      const { companyId, ws, marie, sophie } = await preparedCompany()
      const base = {
        companyId,
        workspaceId: ws,
        fromUserId: marie.id,
        toUserId: sophie.id,
        toEmail: sophie.email,
        expiresAt: new Date(Date.now() + 86_400_000),
      }
      const refused = async (data: Partial<typeof base> & Record<string, unknown>) =>
        expect(
          prisma.companyTransfer.create({ data: { ...base, ...data } as never }),
        ).rejects.toThrow()
      await refused({}) // a second pending one
      await refused({ status: 'accepted' }) // decided without a date
      await refused({ status: 'pending', decidedAt: new Date() } as never)
      await refused({ status: 'maybe', decidedAt: new Date() } as never)
      await refused({ status: 'declined', decidedAt: new Date(), toEmail: 'Sophie@X.fr' } as never)
      await refused({ status: 'declined', decidedAt: new Date(), toEmail: 'no-at-sign' } as never)
      await refused({ status: 'declined', decidedAt: new Date(), toUserId: marie.id } as never)
      await refused({ status: 'declined', decidedAt: new Date(), expiresAt: new Date(0) } as never)
      // A decided one beside the pending one is fine.
      await prisma.companyTransfer.create({
        data: { ...base, status: 'declined', decidedAt: new Date() },
      })
    })
  })

  describe('accepting', () => {
    it('moves the company and every request in one statement; the dossiers follow by their foreign key', async () => {
      const { companyId, dossierIds, transferId, sophie, marie } = await preparedCompany()
      const own = await dossiers.create({ owner: sophie, name: 'Sa propre entreprise' })
      await transfers.decide(sophie, transferId, 'accepted')
      expect(await prisma.company.findUnique({ where: { id: companyId } })).toMatchObject({
        ownerId: sophie.id,
        preparedInWorkspaceId: null,
      })
      const moved = await prisma.dossier.findMany({ where: { id: { in: dossierIds } } })
      expect(moved.map((d) => d.userId)).toEqual([sophie.id, sophie.id])
      expect(await prisma.dossier.findUnique({ where: { id: own.id } })).toMatchObject({
        userId: sophie.id,
      })
      await expect(dossiers.getByIdForUser(dossierIds[0], marie.id)).rejects.toBeInstanceOf(
        HttpException,
      )
      // The database itself refuses a dossier whose owner is not its company's.
      await expect(
        prisma.dossier.update({ where: { id: dossierIds[0] }, data: { userId: marie.id } }),
      ).rejects.toThrow(/foreign key/i)
    })

    it('accepts once when answered twice at the same time, with one journal entry', async () => {
      const { companyId, transferId, sophie } = await preparedCompany()
      const results = await Promise.allSettled([
        transfers.decide(sophie, transferId, 'accepted'),
        transfers.decide(sophie, transferId, 'accepted'),
        transfers.decide(sophie, transferId, 'accepted'),
      ])
      expect(results.map(statusOf)).toEqual(['fulfilled', 'fulfilled', 'fulfilled'])
      expect(
        await prisma.auditLog.count({
          where: { actionType: 'company_transfer_accepted', actorId: sophie.id },
        }),
      ).toBe(1)
      expect(await prisma.company.findUnique({ where: { id: companyId } })).toMatchObject({
        ownerId: sophie.id,
      })
    })

    it('lets exactly one of an acceptance and a refusal, or of an acceptance and a withdrawal, win', async () => {
      const a = await preparedCompany()
      const raced = await Promise.allSettled([
        transfers.decide(a.sophie, a.transferId, 'accepted'),
        transfers.decide(a.sophie, a.transferId, 'declined'),
      ])
      expect(raced.map(statusOf).sort()).toEqual([409, 'fulfilled'])
      const decided = await prisma.companyTransfer.findUnique({ where: { id: a.transferId } })
      const owner = (await prisma.company.findUnique({ where: { id: a.companyId } }))!.ownerId
      expect(owner).toBe(decided!.status === 'accepted' ? a.sophie.id : a.marie.id)

      const b = await preparedCompany()
      const withdrawn = await Promise.allSettled([
        transfers.decide(b.sophie, b.transferId, 'accepted'),
        transfers.cancel(b.marie, b.ws, b.companyId),
      ])
      const after = await prisma.companyTransfer.findUnique({ where: { id: b.transferId } })
      const company = await prisma.company.findUnique({ where: { id: b.companyId } })
      if (after!.status === 'accepted') {
        // Accepted first: the conseiller no longer holds it.
        expect(withdrawn.map(statusOf)).toEqual(['fulfilled', 404])
        expect(company).toMatchObject({ ownerId: b.sophie.id, preparedInWorkspaceId: null })
      } else {
        expect(after!.status).toBe('cancelled')
        expect(withdrawn.map(statusOf)).toEqual([410, 'fulfilled'])
        expect(company).toMatchObject({ ownerId: b.marie.id, preparedInWorkspaceId: b.ws })
      }
    })

    it('refuses a write its former holder started once the company changed hands while it waited for the lock', async () => {
      const { companyId, dossierIds, sophie, marie } = await preparedCompany()
      // The holder's write, read as hers before the transfer (an upload sending its file…).
      const seen = await dossiers.getByIdForUser(dossierIds[0], marie.id)
      let release!: () => void
      const held = new Promise<void>((resolve) => (release = resolve))
      // The acceptance, holding the company's lock while it changes the owner.
      const accepting = prisma.$transaction(async (tx) => {
        await tx.$queryRawUnsafe(`SELECT 1 FROM "companies" WHERE "id" = '${companyId}' FOR UPDATE`)
        await tx.company.update({
          where: { id: companyId },
          data: { ownerId: sophie.id, preparedInWorkspaceId: null },
        })
        await held
      })
      await new Promise((r) => setTimeout(r, 100))
      const write = prisma.$transaction((tx) => lockProfile(tx, seen))
      await new Promise((r) => setTimeout(r, 200))
      release()
      await accepting
      await expect(write).rejects.toBeInstanceOf(HttpException)
      // The new owner's writes go on.
      const hers = await dossiers.getByIdForUser(dossierIds[0], sophie.id)
      await expect(prisma.$transaction((tx) => lockProfile(tx, hers))).resolves.toMatchObject({
        userId: sophie.id,
      })
    })

    // Code review R57: the library and the selection of the documents are written under the same
    // lock, and refused the same way.
    it('refuses a type change, a selection or a withdrawal its former holder sent while the acceptance went on', async () => {
      const { companyId, dossierIds, transferId, sophie, marie } = await preparedCompany()
      const seen = await dossiers.getByIdForUser(dossierIds[0], marie.id)
      const [a, b] = await Promise.all(
        ['bilan.pdf', 'kbis.pdf'].map((filename) =>
          documentOf(prisma, companyId, { filename, storageKey: `k/${randomUUID()}` }),
        ),
      )
      const selected = [a.libraryDocumentId, b.libraryDocumentId].sort()
      await prisma.dossierDocument.createMany({
        data: selected.map((libraryDocumentId) => ({
          dossierId: seen.id,
          companyId,
          libraryDocumentId,
        })),
      })
      let release!: () => void
      const held = new Promise<void>((resolve) => (release = resolve))
      // Another transaction holds the company and the rows the conseillère's writes change: the
      // acceptance waits first, her writes (already past their reads) wait behind it.
      const holding = prisma.$transaction(
        async (tx) => {
          await tx.$queryRawUnsafe(
            `SELECT 1 FROM "companies" WHERE "id" = '${companyId}' FOR UPDATE`,
          )
          await tx.$queryRawUnsafe(
            `SELECT 1 FROM "library_documents" WHERE "company_id" = '${companyId}' FOR UPDATE`,
          )
          await tx.$queryRawUnsafe(
            `SELECT 1 FROM "dossier_documents" WHERE "dossier_id" = '${seen.id}' FOR UPDATE`,
          )
          await held
        },
        { timeout: 20_000 },
      )
      const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))
      await pause(100)
      const accepting = transfers.decide(sophie, transferId, 'accepted')
      await pause(100)
      const writes = Promise.allSettled([
        documents.setType({
          dossier: seen,
          documentId: a.libraryDocumentId,
          type: 'business_plan',
          actorId: marie.id,
        }),
        documents.select({
          dossier: seen,
          documentId: a.libraryDocumentId,
          pinnedVersionId: a.id,
          actorId: marie.id,
        }),
        documents.unselect({ dossier: seen, documentId: b.libraryDocumentId, actorId: marie.id }),
      ])
      await pause(200)
      release()
      await holding
      await expect(accepting).resolves.toMatchObject({ status: 'accepted' })
      expect((await writes).map(statusOf)).toEqual([404, 404, 404])
      // Nothing written nor journaled for her.
      expect(
        (
          await prisma.libraryDocument.findMany({
            where: { companyId },
            orderBy: { id: 'asc' },
            select: { type: true },
          })
        ).map((d) => d.type),
      ).toEqual(['other', 'other'])
      expect(
        await prisma.dossierDocument.findMany({
          where: { dossierId: seen.id },
          orderBy: { libraryDocumentId: 'asc' },
          select: { libraryDocumentId: true, pinnedVersionId: true },
        }),
      ).toEqual(selected.map((libraryDocumentId) => ({ libraryDocumentId, pinnedVersionId: null })))
      expect(
        await prisma.auditLog.count({
          where: {
            actorId: marie.id,
            actionType: {
              in: [
                'document_type_changed',
                'dossier_document_selected',
                'dossier_document_unselected',
              ],
            },
          },
        }),
      ).toBe(0)
      // The new owner's go on.
      const hers = await dossiers.getByIdForUser(dossierIds[0], sophie.id)
      await documents.setType({
        dossier: hers,
        documentId: a.libraryDocumentId,
        type: 'business_plan',
        actorId: sophie.id,
      })
      await documents.unselect({
        dossier: hers,
        documentId: b.libraryDocumentId,
        actorId: sophie.id,
      })
      await expect(
        documents.select({
          dossier: hers,
          documentId: a.libraryDocumentId,
          pinnedVersionId: a.id,
          actorId: sophie.id,
        }),
      ).resolves.toEqual({ documentId: a.libraryDocumentId, pinnedVersionId: a.id })
    })

    it('leaves a declined company with its conseiller', async () => {
      const { companyId, transferId, sophie, marie } = await preparedCompany()
      await transfers.decide(sophie, transferId, 'declined')
      expect(await prisma.company.findUnique({ where: { id: companyId } })).toMatchObject({
        ownerId: marie.id,
      })
      expect(await prisma.companyTransfer.findUnique({ where: { id: transferId } })).toMatchObject({
        status: 'declined',
        decidedAt: expect.any(Date),
      })
    })
  })
})
