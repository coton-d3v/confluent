import { randomUUID } from 'node:crypto'
import { AuditService } from '../../src/modules/audit/audit.service'
import { DocumentsService } from '../../src/modules/documents/documents.service'
import { MemoryStorageAdapter } from '../../src/modules/documents/storage/memory-storage.adapter'
import { companyOf, testDatabase } from './database'

// Code review R48: a document is versioned per question it answers. Version numbers are assigned
// under the profile's lock (its company's row, E05.05): the unique index (company, field, name,
// version) cannot protect a file without a question (NULL field ids are distinct in PostgreSQL).
describe('document versions under concurrency (PostgreSQL)', () => {
  const prisma = testDatabase()
  const documents = new DocumentsService(
    prisma,
    new MemoryStorageAdapter(),
    new AuditService(prisma),
  )
  const PDF = Buffer.from('%PDF-1.4 test')

  afterAll(() => prisma.$disconnect())

  async function dossierWithTwoAttachments() {
    const tag = randomUUID()
    const user = await prisma.user.create({
      data: { email: `r48-${tag}@test.local`, role: 'entrepreneur' },
    })
    const form = await prisma.questionnaire.create({
      data: { name: `R48 ${tag}`, slug: `r48-${tag}` },
    })
    const version = await prisma.questionnaireVersion.create({
      data: { questionnaireId: form.id, version: 1, status: 'published', publishedAt: new Date() },
    })
    const section = await prisma.questionnaireSection.create({
      data: { versionId: version.id, key: 'pieces', title: 'Pièces', orderIndex: 0 },
    })
    const field = (key: string, orderIndex: number) =>
      prisma.questionnaireField.create({
        data: {
          versionId: version.id,
          sectionId: section.id,
          key,
          label: key,
          fieldType: 'file',
          orderIndex,
        },
      })
    const [kbis, statuts] = await Promise.all([field('kbis', 0), field('statuts', 1)])
    const dossier = await prisma.dossier.create({
      data: {
        userId: user.id,
        companyId: await companyOf(prisma, user.id, version.id),
        name: 'R48',
        slug: `r48-${tag}`,
        questionnaireVersionId: version.id,
      },
    })
    return { dossier, kbis: kbis.id, statuts: statuts.id }
  }

  it('gives distinct versions to simultaneous uploads of the same name without question', async () => {
    const { dossier } = await dossierWithTwoAttachments()
    const docs = await Promise.all(
      Array.from({ length: 6 }, () =>
        documents.upload({ dossier, filename: 'bp.pdf', buffer: PDF }),
      ),
    )
    expect(docs.map((d) => d.version).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('versions the same name separately for each question, also when sent at the same time', async () => {
    const { dossier, kbis, statuts } = await dossierWithTwoAttachments()
    const docs = await Promise.all([
      documents.upload({ dossier, filename: 'scan.pdf', buffer: PDF, fieldId: kbis }),
      documents.upload({ dossier, filename: 'scan.pdf', buffer: PDF, fieldId: statuts }),
      documents.upload({ dossier, filename: 'scan.pdf', buffer: PDF, fieldId: kbis }),
    ])
    const byField = (fieldId: string) =>
      docs
        .filter((d) => d.fieldId === fieldId)
        .map((d) => d.version)
        .sort()
    expect(byField(kbis)).toEqual([1, 2])
    expect(byField(statuts)).toEqual([1])
    const listed = await documents.listForDossier(dossier, 'complet')
    expect(listed.map((g) => [g.fieldId, g.versions.length]).sort()).toEqual(
      [
        [kbis, 2],
        [statuts, 1],
      ].sort(),
    )
  })
})
