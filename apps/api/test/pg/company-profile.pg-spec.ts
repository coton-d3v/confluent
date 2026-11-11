import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { UnprocessableEntityException } from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import { AnswerSourcesService } from '../../src/modules/answers/answer-sources.service'
import { AnswersService } from '../../src/modules/answers/answers.service'
import { InvalidAnswersException } from '../../src/modules/answers/invalid-answers.exception'
import { SITE_ORIGIN } from '../../src/modules/audit/action-origin'
import { AuditService } from '../../src/modules/audit/audit.service'
import { ClassificationService } from '../../src/modules/classification/classification.service'
import { CompaniesService } from '../../src/modules/companies/companies.service'
import { DocumentsService } from '../../src/modules/documents/documents.service'
import { MemoryStorageAdapter } from '../../src/modules/documents/storage/memory-storage.adapter'
import { DossiersService } from '../../src/modules/dossiers/dossiers.service'
import { QuestionnairesService } from '../../src/modules/questionnaires/questionnaires.service'
import { testDatabase } from './database'
import { CHECKS, MIGRATIONS, sqlStatements } from './sql-file'

const UP = sqlStatements(join(MIGRATIONS, '20261112100000_company_profile/migration.sql'))
const DOWN = sqlStatements(join(CHECKS, '20261112100000_company_profile.down.sql'))

class RolledBack extends Error {}

type Tx = Prisma.TransactionClient
const run = async (tx: Tx, statements: string[]) => {
  for (const sql of statements) await tx.$executeRawUnsafe(sql)
}
const rows = (tx: Tx, sql: string) => tx.$queryRawUnsafe<Array<Record<string, unknown>>>(sql)

// What the migration may change, in a comparable form: the columns, constraints and indexes of the
// tables it touches, and who owns each answer and document.
const TABLES = `'companies', 'dossiers', 'dossier_answers', 'documents', 'dossier_answer_revisions'`
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
         FROM pg_constraint
         WHERE conrelid::regclass::text IN (${TABLES})) k),
       'indexes', (SELECT json_agg(indexdef ORDER BY indexdef) FROM pg_indexes
         WHERE schemaname = current_schema() AND tablename IN (${TABLES})),
       'companies', (SELECT json_agg(json_build_object('id', id, 'v', profile_version_id) ORDER BY id) FROM companies),
       'answers', (SELECT json_agg(to_jsonb(a) ORDER BY id) FROM dossier_answers a),
       'documents', (SELECT json_agg(to_jsonb(d) ORDER BY id) FROM documents d)
     )::text AS f`,
  )
  return row.f as string
}

// The content of every row the move must keep as it was (all columns but the owner's).
async function content(tx: Tx) {
  return {
    answers: await rows(
      tx,
      `SELECT to_jsonb(a) - 'dossier_id' - 'company_id' AS r FROM dossier_answers a ORDER BY id`,
    ),
    revisions: await rows(
      tx,
      `SELECT to_jsonb(r) AS r FROM dossier_answer_revisions r ORDER BY id`,
    ),
    documents: await rows(
      tx,
      `SELECT to_jsonb(d) - 'dossier_id' - 'company_id' AS r FROM documents d ORDER BY id`,
    ),
    dossiers: await rows(tx, `SELECT to_jsonb(d) AS r FROM dossiers d ORDER BY id`),
    shares: await rows(tx, `SELECT to_jsonb(s) AS r FROM share_links s ORDER BY id`),
    journal: await rows(tx, `SELECT count(*)::int AS n FROM audit_log`),
  }
}

// ROADMAP E05.05: the profile (answers with their provenance and history, documents with every
// version, form version) moves from each dossier to its company. The move keeps every row and id,
// survives an interrupted deployment, can be undone, and the services then read one profile through
// every dossier of a company.
describe('company profile (PostgreSQL)', () => {
  const prisma = testDatabase()
  const classification = new ClassificationService(prisma)
  const documents = new DocumentsService(prisma, new MemoryStorageAdapter())
  const answers = new AnswersService(
    prisma,
    classification,
    new AnswerSourcesService(prisma, documents),
  )
  const dossiers = new DossiersService(
    prisma,
    new QuestionnairesService(prisma),
    classification,
    new AuditService(prisma),
    new CompaniesService(prisma),
  )
  const tag = randomUUID().slice(0, 8)

  afterAll(() => prisma.$disconnect())

  // Dossiers as E05.04 left them (the migration undone): each with its own company, its answers,
  // their history, documents in several versions and a share link.
  async function legacyDossiers(tx: Tx) {
    const owner = randomUUID()
    await tx.$executeRawUnsafe(
      `INSERT INTO users (id, email, role, updated_at)
       VALUES ('${owner}', 'profile-${tag}-${owner.slice(0, 4)}@pg-test.dev', 'entrepreneur', now())`,
    )
    const form = randomUUID()
    const version = randomUUID()
    const section = randomUUID()
    const name = randomUUID()
    const kbis = randomUUID()
    await tx.$executeRawUnsafe(
      `INSERT INTO questionnaires (id, slug, name, updated_at)
       VALUES ('${form}', 'profile-${tag}-${form.slice(0, 4)}', 'Profil', now())`,
    )
    await tx.$executeRawUnsafe(
      `INSERT INTO questionnaire_versions (id, questionnaire_id, version, status, updated_at)
       VALUES ('${version}', '${form}', 1, 'published', now())`,
    )
    await tx.$executeRawUnsafe(
      `INSERT INTO questionnaire_sections (id, version_id, key, title, order_index)
       VALUES ('${section}', '${version}', 'identite', 'Identité', 0)`,
    )
    await tx.$executeRawUnsafe(
      `INSERT INTO questionnaire_fields (id, version_id, section_id, key, label, field_type, order_index, required)
       VALUES ('${name}', '${version}', '${section}', 'nom', 'Nom', 'text', 0, true),
              ('${kbis}', '${version}', '${section}', 'kbis', 'Kbis', 'file', 1, true)`,
    )
    // A company without dossier, which the application never leaves.
    const orphan = randomUUID()
    await tx.$executeRawUnsafe(
      `INSERT INTO companies (id, owner_id, name, updated_at) VALUES ('${orphan}', '${owner}', 'Sans dossier', now())`,
    )
    const made: Array<{ dossier: string; company: string; orphan: string }> = []
    for (const [i, withContent] of [true, false].entries()) {
      const dossier = randomUUID()
      const company = randomUUID()
      await tx.$executeRawUnsafe(
        `INSERT INTO companies (id, owner_id, name, updated_at) VALUES ('${company}', '${owner}', 'Entreprise ${i}', now())`,
      )
      await tx.$executeRawUnsafe(
        `INSERT INTO dossiers (id, user_id, company_id, name, slug, questionnaire_version_id, submitted_at, updated_at)
         VALUES ('${dossier}', '${owner}', '${company}', 'Dossier ${i}', 'profile-${tag}-${dossier.slice(0, 8)}',
                 '${version}', ${i === 0 ? 'now()' : 'NULL'}, now())`,
      )
      made.push({ dossier, company, orphan })
      if (!withContent) continue
      const v1 = randomUUID()
      const v2 = randomUUID()
      await tx.$executeRawUnsafe(
        `INSERT INTO documents (id, dossier_id, filename, mimetype, storage_key, size, version, field_id, created_at)
         VALUES ('${v1}', '${dossier}', 'kbis.pdf', 'application/pdf', 'dossiers/${dossier}/a', 10, 1, '${kbis}', now() - interval '2 days'),
                ('${v2}', '${dossier}', 'kbis.pdf', 'application/pdf', 'dossiers/${dossier}/b', 11, 2, '${kbis}', now() - interval '1 day'),
                ('${randomUUID()}', '${dossier}', 'annexe.pdf', 'application/pdf', 'dossiers/${dossier}/c', 12, 1, NULL, now())`,
      )
      const answer = randomUUID()
      await tx.$executeRawUnsafe(
        `INSERT INTO dossier_answers (id, dossier_id, field_id, value, origin, confirmation, channel, author_id,
                                      client_name, source_document_id, source_location, source_excerpt, updated_at)
         VALUES ('${answer}', '${dossier}', '${name}', 'Biosensio SAS', 'ai', 'pending', 'mcp', '${owner}',
                 'Claude', '${v2}', 'Page 1', 'BIOSENSIO SAS', now())`,
      )
      await tx.$executeRawUnsafe(
        `INSERT INTO dossier_answer_revisions (id, answer_id, value, origin, confirmation, channel, author_id, recorded_at)
         VALUES ('${randomUUID()}', '${answer}', 'Biosensio', 'human', 'confirmed', 'site', '${owner}', now() - interval '3 days')`,
      )
      await tx.$executeRawUnsafe(
        `INSERT INTO share_links (id, dossier_id, recipient_email, token, status, access_level)
         VALUES ('${randomUUID()}', '${dossier}', 'fonds-${tag}@pg-test.dev', '${randomUUID()}', 'active', 'partiel')`,
      )
    }
    return made
  }

  // In a transaction that is always rolled back: the database stays as it was.
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

  it('moves each dossier’s answers, history and documents to its company, unchanged, and can be undone then applied again', async () => {
    // The version a new company gets (a published company-profile form).
    const current = await new QuestionnairesService(prisma).ensureBootstrap()
    await rolledBack(async (tx) => {
      await run(tx, DOWN)
      const legacy = await legacyDossiers(tx)
      const before = await content(tx)
      const owners = await rows(
        tx,
        `SELECT 'a' AS kind, id, dossier_id FROM dossier_answers
         UNION ALL SELECT 'd', id, dossier_id FROM documents ORDER BY id`,
      )

      await run(tx, UP)

      // Every row kept, same id, same content; dossiers, history, shares and journal untouched.
      expect(await content(tx)).toEqual(before)
      // Each answer and document now belongs to the company of the dossier it belonged to.
      const companyOf = new Map(
        (await rows(tx, `SELECT id, company_id FROM dossiers`)).map((d) => [d.id, d.company_id]),
      )
      const moved = await rows(
        tx,
        `SELECT 'a' AS kind, id, company_id FROM dossier_answers
         UNION ALL SELECT 'd', id, company_id FROM documents ORDER BY id`,
      )
      expect(moved).toEqual(
        owners.map((o) => ({ kind: o.kind, id: o.id, company_id: companyOf.get(o.dossier_id) })),
      )
      // The profile's version is the dossier's.
      for (const { company } of legacy) {
        const [c] = await rows(
          tx,
          `SELECT c.profile_version_id = d.questionnaire_version_id AS same
           FROM companies c JOIN dossiers d ON d.company_id = c.id WHERE c.id = '${company}'`,
        )
        expect(c.same).toBe(true)
      }
      // A company without dossier gets the version a new company gets.
      const [orphan] = await rows(
        tx,
        `SELECT profile_version_id FROM companies WHERE id = '${legacy[0].orphan}'`,
      )
      expect(orphan.profile_version_id).toBe(current.id)
      const migrated = await fingerprint(tx)

      // Undone: back to the dossiers, same rows.
      await run(tx, DOWN)
      expect(await content(tx)).toEqual(before)
      expect(
        await rows(
          tx,
          `SELECT 'a' AS kind, id, dossier_id FROM dossier_answers
           UNION ALL SELECT 'd', id, dossier_id FROM documents ORDER BY id`,
        ),
      ).toEqual(owners)

      // Applied again: the same database as the first time.
      await run(tx, UP)
      expect(await fingerprint(tx)).toEqual(migrated)
    })
  })

  // A deployment interrupted after any statement (manual run, lost connection with a non-atomic
  // runner) resumes by running the whole migration again: same schema, same data, no duplicate.
  it('resumes an interrupted deployment: any prefix of the migration, then the whole migration, gives the same database', async () => {
    await rolledBack(async (tx) => {
      await run(tx, DOWN)
      await legacyDossiers(tx)
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

  it('refuses to merge the profiles of a company with several dossiers, and to undo such a company', async () => {
    // Before the migration: a second dossier attached to an existing company.
    await rolledBack(async (tx) => {
      await run(tx, DOWN)
      const [{ dossier, company }] = await legacyDossiers(tx)
      const [d] = await rows(
        tx,
        `SELECT user_id, questionnaire_version_id FROM dossiers WHERE id = '${dossier}'`,
      )
      await tx.$executeRawUnsafe(
        `INSERT INTO dossiers (id, user_id, company_id, name, slug, questionnaire_version_id, updated_at)
         VALUES ('${randomUUID()}', '${d.user_id}', '${company}', 'Second', 'second-${tag}', '${d.questionnaire_version_id}', now())`,
      )
      await tx.$executeRawUnsafe('SAVEPOINT shared')
      await expect(run(tx, UP)).rejects.toThrow(/several dossiers/)
      await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT shared')
    })
    // After it (a state E05.07 will allow): the profile cannot go back to one dossier.
    await rolledBack(async (tx) => {
      await sharedProfile(tx)
      await tx.$executeRawUnsafe('SAVEPOINT shared')
      await expect(run(tx, DOWN)).rejects.toThrow(/several dossiers/)
      await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT shared')
    })
  })

  // Two dossiers of one company, as E05.07 will create them (written directly here: the API still
  // gives each new dossier its own company).
  async function sharedProfile(db: Tx) {
    const id = randomUUID().slice(0, 8)
    const user = await db.user.create({
      data: { email: `profil-${tag}-${id}@pg-test.dev`, role: 'entrepreneur' },
    })
    const form = await db.questionnaire.create({
      data: { name: `Profil ${id}`, slug: `profil-${id}` },
    })
    const version = await db.questionnaireVersion.create({
      data: { questionnaireId: form.id, version: 1, status: 'published', publishedAt: new Date() },
    })
    const section = await db.questionnaireSection.create({
      data: { versionId: version.id, key: 'identite', title: 'Identité', orderIndex: 0 },
    })
    const field = await db.questionnaireField.create({
      data: {
        versionId: version.id,
        sectionId: section.id,
        key: 'nom_du_projet',
        label: 'Nom du projet',
        fieldType: 'text',
        required: true,
        orderIndex: 0,
      },
    })
    const company = await db.company.create({
      data: { ownerId: user.id, name: 'Biosensio', profileVersionId: version.id },
    })
    const dossier = (name: string) =>
      db.dossier.create({
        data: {
          userId: user.id,
          companyId: company.id,
          name,
          slug: `${name.toLowerCase()}-${id}`,
          questionnaireVersionId: version.id,
        },
      })
    return {
      user,
      version,
      field,
      company,
      first: await dossier('Amorcage'),
      second: await dossier('Croissance'),
    }
  }

  it('reads and writes one profile through every dossier of a company, and keeps their version equal to its own', async () => {
    const { user, version, field, company, first, second } = await sharedProfile(prisma)
    try {
      // Written through one dossier, read through the other.
      await answers.saveForDossier(first, [{ fieldId: field.id, value: 'Alpha' }], {
        userId: user.id,
        channel: 'site',
      })
      expect((await answers.listViews(second, 'value')).map((a) => [a.dossierId, a.value])).toEqual(
        [[second.id, 'Alpha']],
      )
      const uploaded = await documents.upload({
        dossier: first,
        filename: 'bp.pdf',
        buffer: Buffer.from('%PDF-1.4 test'),
      })
      expect(uploaded.storageKey.startsWith(`companies/${company.id}/`)).toBe(true)
      expect((await documents.listForDossier(second, 'complet')).map((g) => g.filename)).toEqual([
        'bp.pdf',
      ])

      // A dossier's version is its company's: another one is refused; a new profile version reaches
      // every dossier of the company.
      const other = await prisma.questionnaireVersion.create({
        data: { questionnaireId: version.questionnaireId, version: 2, status: 'draft' },
      })
      await expect(
        prisma.dossier.update({
          where: { id: first.id },
          data: { questionnaireVersionId: other.id },
        }),
      ).rejects.toThrow(/foreign key/i)

      // Submitting the second dossier checks the profile; once submitted, the first one can no
      // longer clear a required answer of the shared profile.
      await dossiers.submit(second.id, user.id, SITE_ORIGIN)
      await expect(
        answers.saveForDossier(first, [{ fieldId: field.id, value: '' }], {
          userId: user.id,
          channel: 'site',
        }),
      ).rejects.toBeInstanceOf(InvalidAnswersException)

      // Deleting one dossier keeps the company's profile for the other; the last one takes it.
      await dossiers.delete(first.id, user.id)
      expect(await prisma.dossierAnswer.count({ where: { companyId: company.id } })).toBe(1)
      await dossiers.delete(second.id, user.id)
      expect(await prisma.company.findUnique({ where: { id: company.id } })).toBeNull()
      expect(await prisma.dossierAnswer.count({ where: { companyId: company.id } })).toBe(0)
      expect(await prisma.document.count({ where: { companyId: company.id } })).toBe(0)
    } finally {
      await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined)
    }
  })

  // The lock is the company's (R40 across dossiers): a submission through one dossier waits for a
  // save of the shared profile through another, and sees its result.
  it('serializes a save through one dossier with the submission of another dossier of the company', async () => {
    const { user, field, company, first, second } = await sharedProfile(prisma)
    try {
      await answers.saveForDossier(first, [{ fieldId: field.id, value: 'Alpha' }], {
        userId: user.id,
        channel: 'site',
      })
      let cleared!: () => void
      const clearing = new Promise<void>((resolve) => (cleared = resolve))
      const save = prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT 1 FROM "companies" WHERE "id" = ${company.id} FOR UPDATE`
          await tx.dossierAnswer.updateMany({
            where: { companyId: company.id, fieldId: field.id },
            data: { value: '' },
          })
          cleared()
          await new Promise((r) => setTimeout(r, 400))
        },
        { timeout: 10_000 },
      )
      await clearing
      const submission = dossiers.submit(second.id, user.id, SITE_ORIGIN)
      await save
      await expect(submission).rejects.toBeInstanceOf(UnprocessableEntityException)
      expect(
        (await prisma.dossier.findUniqueOrThrow({ where: { id: second.id } })).submittedAt,
      ).toBeNull()
    } finally {
      await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined)
    }
  })
})
