import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { Prisma } from '@prisma/client'
import { AuditService } from '../../src/modules/audit/audit.service'
import { DocumentsService } from '../../src/modules/documents/documents.service'
import { MemoryStorageAdapter } from '../../src/modules/documents/storage/memory-storage.adapter'
import { companyOf, testDatabase } from './database'
import { CHECKS, MIGRATIONS, financingRequestsDown, sqlStatements } from './sql-file'

const UP = sqlStatements(join(MIGRATIONS, '20261112200000_document_library/migration.sql'))
const DOWN = sqlStatements(join(CHECKS, '20261112200000_document_library.down.sql'))
// E05.07 builds on the library: undone first, before the library is.
const LATER_DOWN = financingRequestsDown()

class RolledBack extends Error {}

type Tx = Prisma.TransactionClient
const run = async (tx: Tx, statements: string[]) => {
  for (const sql of statements) await tx.$executeRawUnsafe(sql)
}
const rows = (tx: Tx, sql: string) => tx.$queryRawUnsafe<Array<Record<string, unknown>>>(sql)

// What the migration may change, comparable: the columns, constraints and indexes of the two tables,
// and their rows.
const TABLES = `'documents', 'library_documents'`
async function fingerprint(tx: Tx): Promise<string> {
  const [row] = await rows(
    tx,
    `SELECT json_build_object(
       'columns', (SELECT json_agg(x ORDER BY x) FROM (
         SELECT table_name || '.' || column_name || ':' || data_type || ':' || is_nullable AS x
         FROM information_schema.columns
         WHERE table_schema = current_schema() AND table_name IN (${TABLES})) c),
       'constraints', (SELECT json_agg(x ORDER BY x) FROM (
         SELECT conrelid::regclass::text || '.' || conname || ':' || pg_get_constraintdef(oid) AS x
         FROM pg_constraint WHERE conrelid::regclass::text IN (${TABLES})) k),
       'indexes', (SELECT json_agg(indexdef ORDER BY indexdef) FROM pg_indexes
         WHERE schemaname = current_schema() AND tablename IN (${TABLES})),
       'documents', (SELECT json_agg(to_jsonb(d) ORDER BY id) FROM documents d),
       'library', (SELECT json_agg(to_jsonb(l) ORDER BY id) FROM library_documents l)
     )::text AS f`,
  )
  return row.f as string
}

// ROADMAP E05.06: the company's library. The migration files every existing version under one
// document per (company, field, name), survives an interrupted deployment and can be undone; the
// services then add and bring back versions under the profile's lock, never erasing one.
describe('document library (PostgreSQL)', () => {
  const prisma = testDatabase()
  const storage = new MemoryStorageAdapter()
  const documents = new DocumentsService(prisma, storage, new AuditService(prisma))
  const tag = randomUUID().slice(0, 8)
  const users: string[] = []

  afterAll(async () => {
    // Deleting an account removes its companies, their library and their dossiers.
    await prisma.user.deleteMany({ where: { id: { in: users } } })
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

  // A company's documents as E05.05 left them (the migration undone): versions identified by
  // company, field and name — two of them sharing a number, which the old index could not prevent
  // for a file without field — and an answer citing one of them.
  async function legacyVersions(tx: Tx) {
    const user = await tx.user.create({
      data: {
        email: `legacy-${tag}-${randomUUID().slice(0, 6)}@pg-test.dev`,
        role: 'entrepreneur',
      },
    })
    const form = await tx.questionnaire.create({
      data: { name: `Legacy ${tag}`, slug: `legacy-${randomUUID()}` },
    })
    const version = await tx.questionnaireVersion.create({
      data: { questionnaireId: form.id, version: 1, status: 'published', publishedAt: new Date() },
    })
    const section = await tx.questionnaireSection.create({
      data: { versionId: version.id, key: 'pieces', title: 'Pièces', orderIndex: 0 },
    })
    const { id: field } = await tx.questionnaireField.create({
      data: {
        versionId: version.id,
        sectionId: section.id,
        key: 'kbis',
        label: 'Kbis',
        fieldType: 'file',
        orderIndex: 0,
      },
    })
    // Plain SQL: the later migrations (E05.08's column of companies among them) are undone.
    const company = randomUUID()
    await tx.$executeRawUnsafe(
      `INSERT INTO companies (id, owner_id, name, profile_version_id, updated_at)
       VALUES ('${company}', '${user.id}', 'Legacy', '${version.id}', now())`,
    )
    const ids = Array.from({ length: 5 }, () => randomUUID())
    await tx.$executeRawUnsafe(
      `INSERT INTO documents (id, company_id, field_id, filename, mimetype, storage_key, size, version, created_at)
       VALUES ('${ids[0]}', '${company}', '${field}', 'kbis-${tag}.pdf', 'application/pdf', 'legacy/${ids[0]}', 10, 1, now() - interval '3 days'),
              ('${ids[1]}', '${company}', '${field}', 'kbis-${tag}.pdf', 'application/pdf', 'legacy/${ids[1]}', 11, 2, now() - interval '2 days'),
              ('${ids[2]}', '${company}', NULL, 'kbis-${tag}.pdf', 'application/pdf', 'legacy/${ids[2]}', 12, 1, now() - interval '3 days'),
              ('${ids[3]}', '${company}', NULL, 'annexe-${tag}.pdf', 'application/pdf', 'legacy/${ids[3]}', 13, 1, now() - interval '2 days'),
              ('${ids[4]}', '${company}', NULL, 'annexe-${tag}.pdf', 'application/pdf', 'legacy/${ids[4]}', 14, 1, now() - interval '1 day')`,
    )
    return { company, field, ids }
  }

  it('files every existing version under its document, unchanged, renumbers shared numbers, and can be undone then applied again', async () => {
    await rolledBack(async (tx) => {
      await run(tx, LATER_DOWN)
      await run(tx, DOWN)
      const { company, field, ids } = await legacyVersions(tx)
      const list = `('${ids.join("','")}')`
      const before = await rows(
        tx,
        `SELECT id, company_id, filename, mimetype, storage_key, size, created_at
         FROM documents WHERE id IN ${list} ORDER BY id`,
      )

      await run(tx, UP)

      // Same rows, same content (number apart), each attached to its document.
      expect(
        await rows(
          tx,
          `SELECT id, company_id, filename, mimetype, storage_key, size, created_at
           FROM documents WHERE id IN ${list} ORDER BY id`,
        ),
      ).toEqual(before)
      const filed = await rows(
        tx,
        `SELECT d.id, d.version, l.field_id, l.filename, l.type, d.restored_from_id
         FROM documents d JOIN library_documents l ON l.id = d.library_document_id
         WHERE d.id IN ${list}`,
      )
      const byId = new Map(filed.map((r) => [r.id, r]))
      expect(ids.map((id) => [byId.get(id)?.field_id ?? null, byId.get(id)?.version])).toEqual([
        [field, 1],
        [field, 2],
        [null, 1],
        // Two versions numbered 1 of the same document: renumbered in their order.
        [null, 1],
        [null, 2],
      ])
      expect(new Set(filed.map((r) => r.type))).toEqual(new Set(['other']))
      expect(filed.every((r) => r.restored_from_id === null)).toBe(true)
      const [{ n }] = await rows(
        tx,
        `SELECT count(*)::int AS n FROM library_documents WHERE company_id = '${company}'
         AND filename IN ('kbis-${tag}.pdf', 'annexe-${tag}.pdf')`,
      )
      expect(n).toBe(3)
      const migrated = await fingerprint(tx)

      // Undone: each version gets its field back, same rows.
      await run(tx, DOWN)
      const back = await rows(
        tx,
        `SELECT id, field_id, version FROM documents WHERE id IN ${list} ORDER BY id`,
      )
      expect(back.map((r) => r.field_id)).toEqual(
        [...ids].sort().map((id) => (id === ids[0] || id === ids[1] ? field : null)),
      )

      // Applied again: the same database, documents' ids included.
      await run(tx, UP)
      expect(await fingerprint(tx)).toEqual(migrated)
    })
  })

  it('resumes an interrupted deployment: any prefix of the migration, then the whole migration, gives the same database', async () => {
    await rolledBack(async (tx) => {
      await run(tx, LATER_DOWN)
      await run(tx, DOWN)
      await legacyVersions(tx)
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

  async function dossier() {
    const user = await prisma.user.create({
      data: {
        email: `library-${tag}-${randomUUID().slice(0, 6)}@pg-test.dev`,
        role: 'entrepreneur',
      },
    })
    users.push(user.id)
    const form = await prisma.questionnaire.create({
      data: { name: `Bibliothèque ${tag}`, slug: `library-${randomUUID()}` },
    })
    const version = await prisma.questionnaireVersion.create({
      data: { questionnaireId: form.id, version: 1, status: 'published', publishedAt: new Date() },
    })
    return prisma.dossier.create({
      data: {
        userId: user.id,
        companyId: await companyOf(prisma, user.id, version.id),
        name: 'Bibliothèque',
        slug: `library-${randomUUID()}`,
        questionnaireVersionId: version.id,
      },
    })
  }

  const PDF = (text: string) => Buffer.from(`%PDF-1.4 ${text}`)

  it('numbers restorations and deposits made at the same time apart, and erases no version', async () => {
    const d = await dossier()
    const v1 = await documents.upload({ dossier: d, filename: 'bp.pdf', buffer: PDF('1') })
    const v2 = await documents.upload({ dossier: d, filename: 'bp.pdf', buffer: PDF('2') })
    await documents.upload({ dossier: d, filename: 'bp.pdf', buffer: PDF('3') })
    const restore = (versionId: string) =>
      documents.restoreVersion({
        dossier: d,
        documentId: v1.libraryDocumentId,
        versionId,
        actorId: d.userId,
      })

    const results = await Promise.allSettled([
      restore(v1.id),
      restore(v2.id),
      documents.upload({ dossier: d, filename: 'bp.pdf', buffer: PDF('4') }),
      documents.upload({ dossier: d, filename: 'bp.pdf', buffer: PDF('5') }),
    ])

    // Each request either adds its own version or, for a restoration that comes after another of
    // the same file, is refused as already in force — never two versions with the same number.
    const created = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []))
    expect(created.length).toBeGreaterThanOrEqual(3)
    const all = await prisma.document.findMany({
      where: { libraryDocumentId: v1.libraryDocumentId },
      orderBy: { version: 'asc' },
    })
    expect(all.map((v) => v.version)).toEqual(
      Array.from({ length: 3 + created.length }, (_, i) => i + 1),
    )
    // The first versions are still there with their own file.
    expect((await storage.read(all[0].storageKey)).toString()).toBe('%PDF-1.4 1')
    expect((await storage.read(all[1].storageKey)).toString()).toBe('%PDF-1.4 2')
    const restorations = all.filter((v) => v.restoredFromId)
    for (const r of restorations) {
      const source = all.find((v) => v.id === r.restoredFromId)!
      expect(r.storageKey).toBe(source.storageKey)
    }
    expect(restorations.length).toBe(
      results.slice(0, 2).filter((r) => r.status === 'fulfilled').length,
    )
  })

  it('refuses a second restoration of the same version sent at the same time (409), keeping one', async () => {
    const d = await dossier()
    const v1 = await documents.upload({ dossier: d, filename: 'bp.pdf', buffer: PDF('1') })
    await documents.upload({ dossier: d, filename: 'bp.pdf', buffer: PDF('2') })
    const results = await Promise.allSettled(
      Array.from({ length: 4 }, () =>
        documents.restoreVersion({
          dossier: d,
          documentId: v1.libraryDocumentId,
          versionId: v1.id,
          actorId: d.userId,
        }),
      ),
    )
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    for (const r of results.filter((r) => r.status === 'rejected')) {
      expect((r as PromiseRejectedResult).reason).toMatchObject({ status: 409 })
    }
    expect(
      await prisma.document.count({ where: { libraryDocumentId: v1.libraryDocumentId } }),
    ).toBe(3)
    expect(
      await prisma.auditLog.count({
        where: { dossierId: d.id, actionType: 'document_version_restored' },
      }),
    ).toBe(1)
  })

  it('holds a version to its document’s company and name, and a type to the closed list', async () => {
    const d = await dossier()
    const v1 = await documents.upload({ dossier: d, filename: 'bp.pdf', buffer: PDF('1') })
    await expect(
      prisma.document.create({
        data: {
          libraryDocumentId: v1.libraryDocumentId,
          companyId: d.companyId,
          filename: 'other-name.pdf',
          mimetype: 'application/pdf',
          storageKey: 'x',
          size: 1,
          version: 2,
        },
      }),
    ).rejects.toThrow(/Foreign key constraint/)
    await expect(
      prisma.libraryDocument.update({
        where: { id: v1.libraryDocumentId },
        data: { type: 'passport' },
      }),
    ).rejects.toThrow(/library_documents_type_check/)
    await expect(
      prisma.document.create({
        data: {
          libraryDocumentId: v1.libraryDocumentId,
          companyId: d.companyId,
          filename: 'bp.pdf',
          mimetype: 'application/pdf',
          storageKey: 'x',
          size: 1,
          version: 1,
        },
      }),
    ).rejects.toThrow(/Unique constraint/)
  })
})
