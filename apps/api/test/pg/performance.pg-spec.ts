import { randomUUID } from 'node:crypto'
import { MAX_COMPANY_DOCUMENTS_BYTES } from '@confluent/shared'
import { AuditService } from '../../src/modules/audit/audit.service'
import type { ClassificationService } from '../../src/modules/classification/classification.service'
import { CompaniesService } from '../../src/modules/companies/companies.service'
import { DocumentsService } from '../../src/modules/documents/documents.service'
import { MemoryStorageAdapter } from '../../src/modules/documents/storage/memory-storage.adapter'
import { DossiersService } from '../../src/modules/dossiers/dossiers.service'
import { presentationForShare } from '../../src/modules/dossiers/financeur-access'
import { QuestionnairesService } from '../../src/modules/questionnaires/questionnaires.service'
import { documentOf, testDatabase } from './database'
import { performanceIndexesDown, performanceIndexesUp } from './sql-file'

// ROADMAP E10.08 on PostgreSQL: what the measures of the synthetic volume fixed must not come back —
// a list of shared requests whose statements grow with its length, a read that scans the whole
// journal or every notification of an account — and the cumulative bound of a company's documents
// holds under concurrent deposits.
describe('performance and bounds (PostgreSQL)', () => {
  let statements: string[] = []
  const prisma = testDatabase({ onQuery: (sql) => statements.push(sql) })
  const audit = new AuditService(prisma)
  const dossiers = new DossiersService(
    prisma,
    new QuestionnairesService(prisma),
    { evaluate: () => Promise.resolve(null) } as unknown as ClassificationService,
    audit,
    new CompaniesService(prisma),
  )
  const storage = new MemoryStorageAdapter()
  const documents = new DocumentsService(prisma, storage, audit)
  const tag = randomUUID().slice(0, 8)
  const formIds: string[] = []

  afterAll(async () => {
    const users = await prisma.user.findMany({
      where: { email: { endsWith: `-${tag}@pg-test.dev` } },
    })
    const ids = users.map((u) => u.id)
    await prisma.notification.deleteMany({ where: { recipientId: { in: ids } } })
    await prisma.auditLog.deleteMany({ where: { dossier: { userId: { in: ids } } } })
    await prisma.dossier.deleteMany({ where: { userId: { in: ids } } })
    await prisma.company.deleteMany({ where: { ownerId: { in: ids } } })
    await prisma.questionnaireVersion.deleteMany({ where: { questionnaireId: { in: formIds } } })
    await prisma.questionnaire.deleteMany({ where: { id: { in: formIds } } })
    await prisma.user.deleteMany({ where: { id: { in: ids } } })
    await prisma.$disconnect()
  })

  const user = (name: string, role: 'entrepreneur' | 'financeur') =>
    prisma.user.create({
      data: { email: `${name}-${tag}@pg-test.dev`, role, emailVerifiedAt: new Date() },
    })

  // A form version whose three fields are read at the three levels.
  async function version(n: number) {
    const form = await prisma.questionnaire.create({
      data: { slug: `e1008-${n}-${tag}`, name: 'Profil' },
    })
    formIds.push(form.id)
    const v = await prisma.questionnaireVersion.create({
      data: { questionnaireId: form.id, version: 1, status: 'published' },
    })
    const section = await prisma.questionnaireSection.create({
      data: { versionId: v.id, key: 's', title: 'Section', orderIndex: 0 },
    })
    for (const [i, level] of (['public', 'partiel', 'complet'] as const).entries()) {
      await prisma.questionnaireField.create({
        data: {
          versionId: v.id,
          sectionId: section.id,
          key: `f_${level}`,
          label: level,
          fieldType: 'text',
          orderIndex: i,
          // The second version reads everything at `complet`: each dossier is projected with ITS
          // version's levels.
          minAccessLevel: n === 0 ? level : 'complet',
        },
      })
    }
    return v.id
  }

  async function sharedRequests(financeur: string, count: number, versions: string[]) {
    const owner = await user(`owner-${count}`, 'entrepreneur')
    for (let i = 0; i < count; i++) {
      const versionId = versions[i % versions.length]
      const company = await prisma.company.create({
        data: { ownerId: owner.id, name: `Entreprise ${i}`, profileVersionId: versionId },
      })
      const dossier = await prisma.dossier.create({
        data: {
          userId: owner.id,
          companyId: company.id,
          name: `Demande ${count}-${i}`,
          slug: `e1008-${count}-${i}-${tag}`,
          questionnaireVersionId: versionId,
          sector: 'Biotech',
          axe1Projet: 2,
          axe2Financier: 3,
          classificationSources: {
            sector: ['f_public'],
            axe1Projet: ['f_partiel'],
            axe2Financier: ['f_complet'],
          },
        },
      })
      await prisma.shareLink.create({
        data: {
          dossierId: dossier.id,
          recipientEmail: financeur,
          token: randomUUID(),
          status: 'active',
          accessLevel: (['public', 'partiel', 'complet'] as const)[i % 3],
        },
      })
    }
  }

  it('lists the requests shared with a financeur in a number of statements that does not grow with them', async () => {
    const versions = [await version(0), await version(1)]
    const few = await user('few', 'financeur')
    const many = await user('many', 'financeur')
    await sharedRequests(few.email, 2, versions)
    await sharedRequests(many.email, 12, versions)

    statements = []
    const fewList = await dossiers.listForUser(few)
    const fewCount = statements.length
    statements = []
    const manyList = await dossiers.listForUser(many)
    const manyCount = statements.length

    expect(fewList).toHaveLength(2)
    expect(manyList).toHaveLength(12)
    // Before E10.08: one more statement per shared request (the fields of its version).
    expect(manyCount).toBe(fewCount)

    // The same projection as one dossier at a time, each at its own share's level.
    for (const listed of manyList) {
      const access = await dossiers.resolveReadAccess(listed.id, many)
      const one = presentationForShare(
        await dossiers.projectForLevel(access.dossier, access.accessLevel),
      )
      expect(listed).toMatchObject({ ...one, ownerEmail: expect.any(String) })
    }
    // Levels and versions really differ in the list: public hides axe1Projet, partiel shows it
    // only with the first version, complet shows everything.
    const shown = new Set(manyList.map((d) => `${d.axe1Projet}-${d.axe2Financier}`))
    expect(shown).toEqual(new Set(['null-null', '2-null', '2-3']))
  })

  // The planner prefers a sequential scan on the small tables of a test database: with it disabled,
  // the plan shows whether an index can serve the query at all.
  async function plan(sql: string, ...params: string[]): Promise<string> {
    return prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL enable_seqscan = off')
      const rows = await tx.$queryRawUnsafe<Array<{ 'QUERY PLAN': string }>>(
        `EXPLAIN ${sql}`,
        ...params,
      )
      return rows.map((r) => r['QUERY PLAN']).join('\n')
    })
  }

  // Without its `ORDER BY` (sorting a handful of rows): with the whole suite's journal, the planner may
  // prefer walking the `created_at` index in order, which says nothing of the filter's index.
  it('reads who revoked the shares of a request by share, not over the whole journal', async () => {
    const shown = await plan(
      `SELECT share_link_id, action_type, created_at FROM audit_log
       WHERE share_link_id = ANY($1::text[]) AND action_type::text = ANY($2::text[])`,
      '{a,b}',
      '{share_link_revoked,admin_revoked_share_link}',
    )
    expect(shown).toContain('audit_log_share_link_id_idx')
  })

  it('counts unread notifications over the unread ones only', async () => {
    const shown = await plan(
      `SELECT count(*) FROM notifications WHERE recipient_id = $1 AND read_at IS NULL`,
      'someone',
    )
    expect(shown).toContain('notifications_unread_recipient_id_idx')
  })

  it('reverts the migration without loss, and applies it again (twice) to the same indexes', async () => {
    const indexes = (tx: { $queryRawUnsafe: typeof prisma.$queryRawUnsafe }) =>
      tx.$queryRawUnsafe<Array<{ indexdef: string }>>(
        `SELECT indexdef FROM pg_indexes WHERE schemaname = current_schema()
           AND tablename IN ('audit_log', 'notifications') ORDER BY indexdef`,
      )
    const undone = new Error('rolled back')
    await expect(
      prisma.$transaction(async (tx) => {
        const migrated = await indexes(tx)
        for (const sql of performanceIndexesDown()) await tx.$executeRawUnsafe(sql)
        const reverted = await indexes(tx)
        expect(reverted).toHaveLength(migrated.length - 2)
        expect(JSON.stringify(reverted)).not.toMatch(/share_link_id|read_at IS NULL/)
        for (const sql of [...performanceIndexesUp(), ...performanceIndexesUp()]) {
          await tx.$executeRawUnsafe(sql)
        }
        expect(await indexes(tx)).toEqual(migrated)
        throw undone
      }),
    ).rejects.toBe(undone)
  })

  it('keeps a company under its cumulative bound when two deposits race for the last room', async () => {
    const versionId = await version(2)
    const owner = await user('cap', 'entrepreneur')
    const company = await prisma.company.create({
      data: { ownerId: owner.id, name: 'Entreprise pleine', profileVersionId: versionId },
    })
    const dossier = await prisma.dossier.create({
      data: {
        userId: owner.id,
        companyId: company.id,
        name: 'Demande pleine',
        slug: `e1008-cap-${tag}`,
        questionnaireVersionId: versionId,
      },
    })
    const file = Buffer.from('%PDF-1.4 recette E10.08 ')
    // Already stored: all but room for one more file. A restored version counts nothing.
    const stored = await documentOf(prisma, company.id, {
      filename: 'gros.pdf',
      storageKey: `companies/${company.id}/gros`,
      size: MAX_COMPANY_DOCUMENTS_BYTES - file.length - 5,
    })
    await prisma.document.create({
      data: {
        libraryDocumentId: stored.libraryDocumentId,
        companyId: company.id,
        filename: 'gros.pdf',
        mimetype: 'application/pdf',
        storageKey: stored.storageKey,
        size: stored.size,
        version: 2,
        restoredFromId: stored.id,
      },
    })

    const ref = { id: dossier.id, companyId: company.id, userId: owner.id }
    const results = await Promise.allSettled(
      ['a.pdf', 'b.pdf'].map((filename) =>
        documents.upload({ dossier: ref, filename, buffer: file }),
      ),
    )
    const refused = results.filter((r) => r.status === 'rejected')
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(refused).toHaveLength(1)
    expect((refused[0] as PromiseRejectedResult).reason.getStatus()).toBe(507)
    expect((refused[0] as PromiseRejectedResult).reason.getResponse()).toMatchObject({
      code: 'COMPANY_DOCUMENTS_FULL',
    })
    // The refused file's object is not kept.
    const versions = await prisma.document.findMany({
      where: { companyId: company.id, restoredFromId: null },
    })
    expect(versions).toHaveLength(2)
    const kept = versions.find((v) => v.filename !== 'gros.pdf')!
    const objects = [...(storage as unknown as { store: Map<string, unknown> }).store.keys()]
    expect(objects.filter((k) => k.startsWith(`companies/${company.id}/`))).toEqual([
      kept.storageKey,
    ])
  })
})
