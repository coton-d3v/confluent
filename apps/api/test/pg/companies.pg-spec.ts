import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { HttpException } from '@nestjs/common'
import { AuditService } from '../../src/modules/audit/audit.service'
import { ClassificationService } from '../../src/modules/classification/classification.service'
import { CompaniesService } from '../../src/modules/companies/companies.service'
import { DossiersService } from '../../src/modules/dossiers/dossiers.service'
import { QuestionnairesService } from '../../src/modules/questionnaires/questionnaires.service'
import { testDatabase } from './database'
import { CHECKS, MIGRATIONS, financingRequestsDown, sqlStatements } from './sql-file'

const MIGRATION = join(MIGRATIONS, '20261112000000_companies/migration.sql')
const DOWN = join(CHECKS, '20261112000000_companies.down.sql')
// The next migrations (E05.05, E05.06, then E05.07) build on companies: undone first, latest first.
const LIBRARY_DOWN = join(CHECKS, '20261112200000_document_library.down.sql')
const NEXT_DOWN = join(CHECKS, '20261112100000_company_profile.down.sql')

class RolledBack extends Error {}

// ROADMAP E05.04: the company owns its dossiers. The backfill gives each existing dossier its own
// company without touching its content, the change can be undone and applied again, and the
// database itself keeps a dossier's owner equal to its company's.
describe('companies (PostgreSQL)', () => {
  const prisma = testDatabase()
  const companies = new CompaniesService(prisma)
  const dossiers = new DossiersService(
    prisma,
    new QuestionnairesService(prisma),
    new ClassificationService(prisma),
    new AuditService(prisma),
    companies,
  )
  const tag = randomUUID().slice(0, 8)
  const users: string[] = []

  const account = async (name: string, role: 'entrepreneur' | 'financeur' | 'admin') => {
    const row = await prisma.user.create({ data: { email: `${name}-${tag}@pg-test.dev`, role } })
    users.push(row.id)
    return { id: row.id, email: row.email, role: row.role }
  }

  afterAll(async () => {
    // Deleting an account removes its companies and dossiers in the same statement.
    await prisma.user.deleteMany({ where: { id: { in: users } } })
    await prisma.$disconnect()
  })

  it('gives each existing dossier its own company, leaves its content as it was, and can be undone then applied again', async () => {
    const existing = await dossiers.create({
      owner: await account('existant', 'entrepreneur'),
      name: 'Existant',
    })
    await expect(
      prisma.$transaction(
        async (tx) => {
          const run = async (path: string) => {
            for (const sql of sqlStatements(path)) await tx.$executeRawUnsafe(sql)
          }
          // The database as it was before the migration, with dossiers as they were written then.
          for (const sql of financingRequestsDown()) await tx.$executeRawUnsafe(sql)
          await run(LIBRARY_DOWN)
          await run(NEXT_DOWN)
          await run(DOWN)
          const owner = randomUUID()
          const other = randomUUID()
          await tx.$executeRawUnsafe(
            `INSERT INTO users (id, email, role, updated_at) VALUES
               ('${owner}', 'backfill-${tag}@pg-test.dev', 'entrepreneur', now()),
               ('${other}', 'backfill-admin-${tag}@pg-test.dev', 'admin', now())`,
          )
          const form = randomUUID()
          const version = randomUUID()
          await tx.$executeRawUnsafe(
            `INSERT INTO questionnaires (id, slug, name, updated_at)
             VALUES ('${form}', 'backfill-${tag}', 'Backfill', now())`,
          )
          await tx.$executeRawUnsafe(
            `INSERT INTO questionnaire_versions (id, questionnaire_id, version, status, updated_at)
             VALUES ('${version}', '${form}', 1, 'published', now())`,
          )
          const legacy = [
            { id: randomUUID(), user: owner, name: 'Biosensio', expected: 'Biosensio' },
            // The same owner and the same name: still two companies.
            { id: randomUUID(), user: owner, name: 'Biosensio', expected: 'Biosensio' },
            { id: randomUUID(), user: other, name: '  Test  ', expected: 'Test' },
            { id: randomUUID(), user: owner, name: '   ', expected: 'Entreprise sans nom' },
            { id: randomUUID(), user: owner, name: 'x'.repeat(250), expected: 'x'.repeat(200) },
          ]
          for (const [i, d] of legacy.entries()) {
            await tx.$executeRawUnsafe(
              `INSERT INTO dossiers (id, user_id, name, slug, questionnaire_version_id, submitted_at, created_at, updated_at)
               VALUES ($1, $2, $3, $4, $5, CASE WHEN $6::boolean THEN now() END, now() - make_interval(days => $7::int), now())`,
              d.id,
              d.user,
              d.name,
              `backfill-${tag}-${i}`,
              version,
              i === 0,
              i,
            )
          }
          const snapshot = () =>
            tx.$queryRawUnsafe<Array<Record<string, unknown>>>(
              `SELECT id, user_id, name, slug, questionnaire_version_id, submitted_at, created_at
               FROM dossiers ORDER BY id`,
            )
          const before = await snapshot()

          await run(MIGRATION)

          // Every dossier, those of other tests included, now belongs to a company of its owner.
          expect(await snapshot()).toEqual(before)
          const rows = await tx.$queryRawUnsafe<
            Array<{
              id: string
              company_id: string
              owner_id: string
              user_id: string
              name: string
              same_date: boolean
            }>
          >(
            `SELECT d.id, d.company_id, c.owner_id, d.user_id, c.name, c.created_at = d.created_at AS same_date
             FROM dossiers d JOIN companies c ON c.id = d.company_id`,
          )
          expect(rows).toHaveLength(before.length)
          expect(new Set(rows.map((r) => r.company_id)).size).toBe(before.length)
          const [{ count }] = await tx.$queryRawUnsafe<Array<{ count: bigint }>>(
            'SELECT count(*) AS count FROM companies',
          )
          expect(Number(count)).toBe(before.length)
          for (const d of legacy) {
            const row = rows.find((r) => r.id === d.id)!
            expect(row).toMatchObject({ owner_id: d.user, user_id: d.user, name: d.expected })
            expect(row.same_date).toBe(true)
          }
          throw new RolledBack()
        },
        { timeout: 60_000 },
      ),
    ).rejects.toThrow(RolledBack)
    // Rolled back: the database is as it was, companies included.
    expect(await prisma.dossier.findUnique({ where: { id: existing.id } })).toMatchObject({
      companyId: existing.companyId,
    })
    expect(await prisma.company.findUnique({ where: { id: existing.companyId } })).not.toBeNull()
  })

  it('keeps a dossier’s owner equal to its company’s, and lets a change of owner reach the dossiers', async () => {
    const sophie = await account('sophie', 'entrepreneur')
    const marc = await account('marc', 'entrepreneur')
    const dossier = await dossiers.create({ owner: sophie, name: 'Biosensio' })
    const marcs = await prisma.company.create({
      data: {
        ownerId: marc.id,
        name: 'Agrotech',
        profileVersionId: dossier.questionnaireVersionId,
      },
    })

    // Attached to another account's company, or given another owner on its own: refused.
    await expect(
      prisma.dossier.create({
        data: {
          userId: sophie.id,
          companyId: marcs.id,
          name: 'Détourné',
          slug: `detourne-${tag}`,
          questionnaireVersionId: dossier.questionnaireVersionId,
        },
      }),
    ).rejects.toThrow(/foreign key/i)
    await expect(
      prisma.dossier.update({ where: { id: dossier.id }, data: { userId: marc.id } }),
    ).rejects.toThrow(/foreign key/i)
    await expect(
      prisma.dossier.update({ where: { id: dossier.id }, data: { companyId: marcs.id } }),
    ).rejects.toThrow(/foreign key/i)

    // The path a transfer of ownership (E05.08) will take: the company's owner, cascading.
    await prisma.company.update({ where: { id: dossier.companyId }, data: { ownerId: marc.id } })
    expect((await prisma.dossier.findUniqueOrThrow({ where: { id: dossier.id } })).userId).toBe(
      marc.id,
    )

    // A company keeps its dossiers.
    await expect(prisma.company.delete({ where: { id: dossier.companyId } })).rejects.toThrow()
  })

  it('refuses a company name the API would never write', async () => {
    const sophie = await account('noms', 'entrepreneur')
    const { id: profileVersionId } = await new QuestionnairesService(prisma).ensureBootstrap()
    for (const name of ['', '   ', ' Biosensio', 'Biosensio ', 'x'.repeat(201)]) {
      await expect(
        prisma.company.create({ data: { ownerId: sophie.id, name, profileVersionId } }),
      ).rejects.toThrow(/check constraint/i)
    }
    await prisma.company.create({
      data: { ownerId: sophie.id, name: 'é'.repeat(200), profileVersionId },
    })
  })

  it('creates a dossier and its company together, removes the company with its last dossier, and refuses a financeur', async () => {
    const sophie = await account('cycle', 'entrepreneur')
    const created = await dossiers.create({ owner: sophie, name: 'Hydrogène Vert' })
    expect(await prisma.company.findUnique({ where: { id: created.companyId } })).toMatchObject({
      ownerId: sophie.id,
      name: 'Hydrogène Vert',
    })
    expect((await companies.listForOwner(sophie)).map((c) => c.dossiers.map((d) => d.id))).toEqual([
      [created.id],
    ])

    await dossiers.delete(created.id, sophie.id)
    expect(await prisma.dossier.findUnique({ where: { id: created.id } })).toBeNull()
    expect(await prisma.company.findUnique({ where: { id: created.companyId } })).toBeNull()

    const financeur = await account('fonds', 'financeur')
    const refused = await dossiers.create({ owner: financeur, name: 'Fonds' }).catch((e) => e)
    expect(refused).toBeInstanceOf(HttpException)
    expect((refused as HttpException).getStatus()).toBe(403)
    expect(await prisma.company.count({ where: { ownerId: financeur.id } })).toBe(0)
    expect(await prisma.dossier.count({ where: { userId: financeur.id } })).toBe(0)
  })

  it('removes the account’s companies and dossiers when the account is deleted', async () => {
    const gone = await account('parti', 'entrepreneur')
    const created = await dossiers.create({ owner: gone, name: 'Éphémère' })
    await prisma.user.delete({ where: { id: gone.id } })
    expect(await prisma.dossier.findUnique({ where: { id: created.id } })).toBeNull()
    expect(await prisma.company.findUnique({ where: { id: created.companyId } })).toBeNull()
  })
})
