import { randomUUID } from 'node:crypto'
import { AnswerSourcesService } from '../../src/modules/answers/answer-sources.service'
import { AnswersService } from '../../src/modules/answers/answers.service'
import { ClassificationService } from '../../src/modules/classification/classification.service'
import type { DocumentsService } from '../../src/modules/documents/documents.service'
import { testDatabase } from './database'

// E04.04: the provenance is written with the value, in the dossier's locked transaction, and the
// database itself refuses an inconsistent one (the fake cannot show CHECK constraints or foreign
// keys).
describe('answer provenance (PostgreSQL)', () => {
  const prisma = testDatabase()
  // No excerpt is cited here: the documents' storage is never read.
  const answers = new AnswersService(
    prisma,
    new ClassificationService(prisma),
    new AnswerSourcesService(prisma, {} as DocumentsService),
  )
  afterAll(() => prisma.$disconnect())

  async function dossierWithDocument() {
    const tag = randomUUID()
    const user = await prisma.user.create({
      data: { email: `e0404-${tag}@test.local`, role: 'entrepreneur' },
    })
    const form = await prisma.questionnaire.create({
      data: { name: `E04.04 ${tag}`, slug: `e0404-${tag}` },
    })
    const version = await prisma.questionnaireVersion.create({
      data: { questionnaireId: form.id, version: 1, status: 'published', publishedAt: new Date() },
    })
    const section = await prisma.questionnaireSection.create({
      data: { versionId: version.id, key: 'projet', title: 'Projet', orderIndex: 0 },
    })
    const field = await prisma.questionnaireField.create({
      data: {
        versionId: version.id,
        sectionId: section.id,
        key: 'capital',
        label: 'Capital social',
        fieldType: 'text',
        orderIndex: 0,
      },
    })
    const dossier = await prisma.dossier.create({
      data: {
        userId: user.id,
        name: 'E04.04',
        slug: `e0404-${tag}`,
        questionnaireVersionId: version.id,
      },
    })
    const document = await prisma.document.create({
      data: {
        dossierId: dossier.id,
        filename: 'kbis.pdf',
        mimetype: 'application/pdf',
        storageKey: `test/${tag}`,
        size: 10,
      },
    })
    return { user, field, dossier, document }
  }

  it('stores the provenance with the value, replaced by the next write', async () => {
    const { user, field, dossier, document } = await dossierWithDocument()
    await answers.saveForDossier(
      dossier,
      [
        {
          fieldId: field.id,
          value: '10 000 EUR',
          origin: 'ai',
          source: { documentId: document.id },
        },
      ],
      { userId: user.id, channel: 'mcp', clientName: 'Claude' },
    )
    const proposed = await prisma.dossierAnswer.findFirstOrThrow({
      where: { dossierId: dossier.id },
    })
    expect(proposed).toMatchObject({
      value: '10 000 EUR',
      origin: 'ai',
      confirmation: 'pending',
      channel: 'mcp',
      authorId: user.id,
      clientName: 'Claude',
      sourceDocumentId: document.id,
    })

    await answers.saveForDossier(dossier, [{ fieldId: field.id, value: '12 000 EUR' }], {
      userId: user.id,
      channel: 'site',
    })
    const corrected = await prisma.dossierAnswer.findFirstOrThrow({
      where: { dossierId: dossier.id },
    })
    expect(corrected).toMatchObject({
      value: '12 000 EUR',
      origin: 'human',
      confirmation: 'confirmed',
      channel: 'site',
      clientName: null,
      sourceDocumentId: null,
      sourceExcerpt: null,
    })
    expect(corrected.updatedAt.getTime()).toBeGreaterThanOrEqual(proposed.updatedAt.getTime())
  })

  it('refuses an inconsistent provenance, and keeps the quotation when its document goes', async () => {
    const { user, field, dossier, document } = await dossierWithDocument()
    const row = await prisma.dossierAnswer.create({
      data: {
        dossierId: dossier.id,
        fieldId: field.id,
        value: '10 000 EUR',
        origin: 'ai',
        confirmation: 'pending',
        channel: 'mcp',
        authorId: user.id,
        clientName: 'Claude',
        sourceDocumentId: document.id,
        sourceLocation: 'Page 2',
        sourceExcerpt: 'Capital social : 10 000 EUR',
      },
    })
    const set = (data: Record<string, unknown>) =>
      prisma.dossierAnswer.update({ where: { id: row.id }, data })
    await expect(set({ origin: 'human' })).rejects.toThrow(/human_confirmed_check/)
    await expect(set({ origin: 'robot' })).rejects.toThrow(/origin_check/)
    await expect(set({ channel: 'site' })).rejects.toThrow(/client_name_check/)
    await expect(set({ channel: null })).rejects.toThrow(/provenance_check/)

    // The document goes: the answer keeps its quotation, without the link.
    await prisma.document.delete({ where: { id: document.id } })
    expect(await prisma.dossierAnswer.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({
      sourceDocumentId: null,
      sourceLocation: 'Page 2',
      sourceExcerpt: 'Capital social : 10 000 EUR',
    })

    // The author's account goes (here an administrator's): the answer stays, its author unknown.
    const admin = await prisma.user.create({
      data: { email: `e0404-admin-${randomUUID()}@test.local`, role: 'admin' },
    })
    await answers.saveForDossier(dossier, [{ fieldId: field.id, value: '12 000 EUR' }], {
      userId: admin.id,
      channel: 'admin',
    })
    await prisma.user.delete({ where: { id: admin.id } })
    expect(await prisma.dossierAnswer.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({
      value: '12 000 EUR',
      channel: 'admin',
      authorId: null,
    })
  })
})
