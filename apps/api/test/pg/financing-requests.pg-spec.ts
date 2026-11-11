import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { Prisma } from '@prisma/client'
import { AuditService } from '../../src/modules/audit/audit.service'
import { CompaniesService } from '../../src/modules/companies/companies.service'
import type { ClassificationService } from '../../src/modules/classification/classification.service'
import { DossiersService } from '../../src/modules/dossiers/dossiers.service'
import type { QuestionnairesService } from '../../src/modules/questionnaires/questionnaires.service'
import { companyOf, testDatabase } from './database'
import { CHECKS, MIGRATIONS, sqlStatements } from './sql-file'

const UP = sqlStatements(join(MIGRATIONS, '20261113000000_financing_requests/migration.sql'))
const DOWN = sqlStatements(join(CHECKS, '20261113000000_financing_requests.down.sql'))
const ACCEPT_WIDER = "SET LOCAL confluent.accept_wider_shares = 'on'"
// The acceptance lasts for the whole transaction: withdrawn before a revert that must be checked.
const REFUSE_WIDER = "SET LOCAL confluent.accept_wider_shares = 'off'"

class RolledBack extends Error {}

type Tx = Prisma.TransactionClient
const run = async (tx: Tx, statements: string[]) => {
  for (const sql of statements) await tx.$executeRawUnsafe(sql)
}
const rows = (tx: Tx, sql: string) => tx.$queryRawUnsafe<Array<Record<string, unknown>>>(sql)

// What the migration may change, comparable: columns, constraints and indexes of the tables it
// touches, the new columns of the dossiers and the selections.
const TABLES = `'dossiers', 'dossier_documents', 'documents', 'library_documents'`
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
       'dossiers', (SELECT json_agg(json_build_array(id, summary, objective, description, amount_eur,
         financing_types, publication_status, published_at) ORDER BY id) FROM dossiers),
       'selection', (SELECT json_agg(to_jsonb(s) ORDER BY id) FROM dossier_documents s)
     )::text AS f`,
  )
  return row.f as string
}

// ROADMAP E05.07 on PostgreSQL: the migration keeps every document a share showed, survives an
// interrupted deployment and can be undone (refusing, unless accepted, to widen a narrowed share);
// the constraints keep each selection inside its company and document; publication and edits of
// the presentation never leave a published request incomplete.
describe('financing requests (PostgreSQL)', () => {
  const prisma = testDatabase()
  const audit = new AuditService(prisma)
  const companies = new CompaniesService(prisma)
  const dossiers = new DossiersService(
    prisma,
    { getVersion: () => Promise.resolve(null) } as unknown as QuestionnairesService,
    {} as ClassificationService,
    audit,
    companies,
  )
  const tag = randomUUID().slice(0, 8)
  const users: string[] = []

  afterAll(async () => {
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
        { timeout: 180_000 },
      ),
    ).rejects.toThrow(RolledBack)

  // A company with one dossier (the state E05.06 left), two library documents (one with two
  // versions) and an active share of the dossier — written with plain SQL, the migration undone.
  async function legacyCompany(tx: Tx) {
    const user = randomUUID()
    await tx.$executeRawUnsafe(
      `INSERT INTO users (id, email, role, updated_at)
       VALUES ('${user}', 'legacy-${tag}-${user.slice(0, 6)}@pg-test.dev', 'entrepreneur', now())`,
    )
    const form = await tx.questionnaire.create({
      data: { name: `Legacy ${tag}`, slug: `legacy-${randomUUID()}` },
    })
    const { id: version } = await tx.questionnaireVersion.create({
      data: { questionnaireId: form.id, version: 1, status: 'published', publishedAt: new Date() },
    })
    const company = randomUUID()
    const dossier = randomUUID()
    await tx.$executeRawUnsafe(
      `INSERT INTO companies (id, owner_id, name, profile_version_id, updated_at)
       VALUES ('${company}', '${user}', 'Legacy', '${version}', now())`,
    )
    await tx.$executeRawUnsafe(
      `INSERT INTO dossiers (id, user_id, company_id, name, slug, questionnaire_version_id, updated_at)
       VALUES ('${dossier}', '${user}', '${company}', 'Legacy', 'legacy-${dossier}', '${version}', now())`,
    )
    const docs = [randomUUID(), randomUUID()]
    for (const [i, id] of docs.entries()) {
      await tx.$executeRawUnsafe(
        `INSERT INTO library_documents (id, company_id, filename, updated_at)
         VALUES ('${id}', '${company}', 'doc-${i}.pdf', now())`,
      )
    }
    const versions = [randomUUID(), randomUUID(), randomUUID()]
    for (const [i, [doc, n]] of [
      [docs[0], 1],
      [docs[0], 2],
      [docs[1], 1],
    ].entries()) {
      const docIndex = doc === docs[0] ? 0 : 1
      await tx.$executeRawUnsafe(
        `INSERT INTO documents (id, library_document_id, company_id, filename, mimetype, storage_key, size, version)
         VALUES ('${versions[i]}', '${doc}', '${company}', 'doc-${docIndex}.pdf', 'application/pdf', 'k/${versions[i]}', 1, ${n})`,
      )
    }
    await tx.$executeRawUnsafe(
      `INSERT INTO share_links (id, dossier_id, recipient_email, token, status, access_level)
       VALUES ('${randomUUID()}', '${dossier}', 'bob-${tag}@pg-test.dev', '${randomUUID()}', 'active', 'complet')`,
    )
    return { company, dossier, docs, versions, version, user }
  }

  it('gives every existing dossier its whole library, followed, as a draft; can be undone then applied again', async () => {
    await rolledBack(async (tx) => {
      await run(tx, [ACCEPT_WIDER, ...DOWN])
      const { dossier, docs } = await legacyCompany(tx)
      await run(tx, UP)
      expect(
        await rows(
          tx,
          `SELECT library_document_id AS doc, pinned_version_id AS pinned FROM dossier_documents
           WHERE dossier_id = '${dossier}' ORDER BY library_document_id`,
        ),
      ).toEqual([...docs].sort().map((doc) => ({ doc, pinned: null })))
      expect(
        await rows(
          tx,
          `SELECT summary, objective, description, amount_eur, financing_types, publication_status, published_at
           FROM dossiers WHERE id = '${dossier}'`,
        ),
      ).toEqual([
        {
          summary: null,
          objective: null,
          description: null,
          amount_eur: null,
          financing_types: [],
          publication_status: 'draft',
          published_at: null,
        },
      ])
      const migrated = await fingerprint(tx)
      // Undone (accepted: the shared document with two versions would show both again, see
      // below), then applied again: the same database, the selections' ids included.
      await run(tx, [ACCEPT_WIDER, ...DOWN])
      expect(
        await rows(
          tx,
          `SELECT count(*)::int AS n FROM information_schema.tables WHERE table_name = 'dossier_documents' AND table_schema = current_schema()`,
        ),
      ).toEqual([{ n: 0 }])
      await run(tx, UP)
      expect(await fingerprint(tx)).toEqual(migrated)
    })
  })

  it('resumes an interrupted deployment: any prefix of the migration, then the whole migration, gives the same database', async () => {
    await rolledBack(async (tx) => {
      await run(tx, [ACCEPT_WIDER, ...DOWN])
      await legacyCompany(tx)
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

  it('refuses to undo the migration while a shared dossier shows less than its whole library, unless accepted', async () => {
    await rolledBack(async (tx) => {
      await run(tx, [ACCEPT_WIDER, ...DOWN])
      const { dossier, docs, versions } = await legacyCompany(tx)
      await run(tx, UP)
      await tx.$executeRawUnsafe('SAVEPOINT migrated')
      for (const narrow of [
        `DELETE FROM dossier_documents WHERE dossier_id = '${dossier}' AND library_document_id = '${docs[1]}'`,
        `UPDATE dossier_documents SET pinned_version_id = '${versions[0]}' WHERE library_document_id = '${docs[0]}'`,
        // R56: everything selected and followed, but the first document has two versions — the
        // share shows only the latest, E05.06 would show its history too.
        `SELECT 1`,
      ]) {
        await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT migrated')
        await tx.$executeRawUnsafe(narrow)
        await tx.$executeRawUnsafe('SAVEPOINT narrowed')
        await expect(run(tx, [REFUSE_WIDER, ...DOWN])).rejects.toThrow(/whole library/)
        await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT narrowed')
        await run(tx, [ACCEPT_WIDER, ...DOWN])
        await run(tx, UP)
      }
      // Everything selected and followed, one version per document: going back widens nothing.
      await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT migrated')
      await tx.$executeRawUnsafe(`DELETE FROM documents WHERE id = '${versions[0]}'`)
      await run(tx, [REFUSE_WIDER, ...DOWN])
    })
  })

  it('keeps each selection inside its company and document, and closed values in the dossiers', async () => {
    await rolledBack(async (tx) => {
      const { dossier, company, docs, versions } = await legacyCompany(tx)
      // legacyCompany wrote the dossier after the migration: no selection backfilled for it.
      const other = await legacyCompany(tx)
      await tx.$executeRawUnsafe('SAVEPOINT base')
      const refused = async (sql: string, pattern: RegExp) => {
        await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT base')
        await expect(tx.$executeRawUnsafe(sql)).rejects.toThrow(pattern)
      }
      const select = (doc: string, pinned: string | null, companyId = company) =>
        `INSERT INTO dossier_documents (id, dossier_id, company_id, library_document_id, pinned_version_id, updated_at)
         VALUES ('${randomUUID()}', '${dossier}', '${companyId}', '${doc}', ${pinned ? `'${pinned}'` : 'NULL'}, now())`
      // Another company's document, under either company; a version of another document.
      await refused(
        select(other.docs[0], null),
        /dossier_documents_library_document_id_company_id_fkey/,
      )
      await refused(
        select(other.docs[0], null, other.company),
        /dossier_documents_(dossier_id|library_document_id)_company_id_fkey/,
      )
      await refused(
        select(docs[1], versions[0]),
        /dossier_documents_pinned_version_id_library_document_id_fkey/,
      )
      await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT base')
      await tx.$executeRawUnsafe(select(docs[0], versions[0]))
      // One selection per (dossier, document).
      await expect(tx.$executeRawUnsafe(select(docs[0], null))).rejects.toThrow(
        /23505|already exists/,
      )
      for (const [set, constraint] of [
        [`financing_types = ARRAY['equity', 'loterie']`, 'financing_types'],
        [`financing_types = NULL`, 'financing_types'],
        [`amount_eur = 0`, 'amount_eur'],
        [`amount_eur = 1000000001`, 'amount_eur'],
        [`summary = '   '`, 'summary'],
        [`description = repeat('x', 5001)`, 'description'],
        [`publication_status = 'published'`, 'publication_status'],
        [`published_at = now()`, 'publication_status'],
        [`publication_status = 'archived', published_at = NULL`, 'publication_status'],
      ] as const) {
        await refused(
          `UPDATE dossiers SET ${set} WHERE id = '${dossier}'`,
          new RegExp(`dossiers_${constraint}_check`),
        )
      }
      // Deleting the dossier removes its selections, not the documents.
      await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT base')
      await tx.$executeRawUnsafe(select(docs[0], null))
      await tx.$executeRawUnsafe(`DELETE FROM share_links WHERE dossier_id = '${dossier}'`)
      await tx.$executeRawUnsafe(`DELETE FROM dossiers WHERE id = '${dossier}'`)
      expect(
        await rows(
          tx,
          `SELECT count(*)::int AS n FROM dossier_documents WHERE dossier_id = '${dossier}'`,
        ),
      ).toEqual([{ n: 0 }])
      expect(
        await rows(
          tx,
          `SELECT count(*)::int AS n FROM library_documents WHERE company_id = '${company}'`,
        ),
      ).toEqual([{ n: 2 }])
    })
  })

  it('never leaves a published request incomplete when publication and an edit race', async () => {
    const owner = await prisma.user.create({
      data: { email: `race-${tag}@pg-test.dev`, role: 'entrepreneur' },
    })
    users.push(owner.id)
    const form = await prisma.questionnaire.create({
      data: { name: `Course ${tag}`, slug: `race-${randomUUID()}` },
    })
    const { id: version } = await prisma.questionnaireVersion.create({
      data: { questionnaireId: form.id, version: 1, status: 'published', publishedAt: new Date() },
    })
    const companyId = await companyOf(prisma, owner.id, version)
    for (let round = 0; round < 8; round++) {
      const d = await dossiers.createForCompany({
        owner: { id: owner.id, role: 'entrepreneur' },
        companyId,
        name: `Course ${round}`,
      })
      await dossiers.update({
        userId: owner.id,
        id: d.id,
        changes: {
          summary: 'Résumé',
          objective: 'Objectif',
          amountEur: 100_000,
          financingTypes: ['equity'],
        },
      })
      await prisma.dossier.update({ where: { id: d.id }, data: { submittedAt: new Date() } })
      await Promise.allSettled([
        dossiers.publish(d.id, owner.id),
        dossiers.update({ userId: owner.id, id: d.id, changes: { amountEur: null } }),
      ])
      const final = await prisma.dossier.findUniqueOrThrow({ where: { id: d.id } })
      // Either published with its amount, or a draft whose amount may have been cleared.
      expect(final.publicationStatus === 'published' && final.amountEur === null).toBe(false)
    }
  })
})
