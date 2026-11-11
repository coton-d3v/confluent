import { randomUUID } from 'node:crypto'
import { ConflictException } from '@nestjs/common'
import { AnswerSourcesService } from '../../src/modules/answers/answer-sources.service'
import { AnswersService } from '../../src/modules/answers/answers.service'
import { ClassificationService } from '../../src/modules/classification/classification.service'
import type { DocumentsService } from '../../src/modules/documents/documents.service'
import { companyOf, testDatabase } from './database'

// E04.05: confirming a proposal and replacing it are serialized by the dossier's lock, and the
// history is kept by the database with the same rules as the answers (CHECK constraints, foreign
// keys) — what the in-memory fake cannot show.
describe('answer history and confirmation (PostgreSQL)', () => {
  const prisma = testDatabase()
  // No excerpt is cited here: the documents' storage is never read.
  const answers = new AnswersService(
    prisma,
    new ClassificationService(prisma),
    new AnswerSourcesService(prisma, {} as DocumentsService),
  )
  afterAll(() => prisma.$disconnect())

  async function dossierWithProposal() {
    const tag = randomUUID()
    const user = await prisma.user.create({
      data: { email: `e0405-${tag}@test.local`, role: 'entrepreneur' },
    })
    const form = await prisma.questionnaire.create({
      data: { name: `E04.05 ${tag}`, slug: `e0405-${tag}` },
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
        companyId: await companyOf(prisma, user.id, version.id),
        name: 'E04.05',
        slug: `e0405-${tag}`,
        questionnaireVersionId: version.id,
      },
    })
    const document = await prisma.document.create({
      data: {
        companyId: dossier.companyId,
        filename: 'kbis.pdf',
        mimetype: 'application/pdf',
        storageKey: `test/${tag}`,
        size: 10,
      },
    })
    const mcp = { userId: user.id, channel: 'mcp', clientName: 'Claude' } as const
    const [proposal] = await answers.saveForDossier(
      dossier,
      [
        {
          fieldId: field.id,
          value: '10 000 EUR',
          origin: 'ai',
          source: { documentId: document.id },
        },
      ],
      mcp,
    )
    return { user, field, dossier, document, proposal, mcp }
  }

  const revisionsOf = (answerId: string) =>
    prisma.dossierAnswerRevision.findMany({ where: { answerId }, orderBy: { replacedAt: 'asc' } })

  it('a confirmation waiting for a proposal being replaced sees the new value and confirms nothing', async () => {
    const { user, field, dossier, proposal, mcp } = await dossierWithProposal()
    const shown = { value: proposal.value, updatedAt: proposal.updatedAt }
    // The assistant replaces its proposal: it holds the profile (its company's row, as every write
    // of answers does) and commits 400 ms later.
    let replacing!: () => void
    const locked = new Promise<void>((resolve) => (replacing = resolve))
    const replacement = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT 1 FROM "companies" WHERE "id" = ${dossier.companyId} FOR UPDATE`
        replacing()
        await new Promise((r) => setTimeout(r, 400))
        await tx.dossierAnswer.update({
          where: { id: proposal.id },
          data: { value: '12 000 EUR', clientName: mcp.clientName },
        })
      },
      { timeout: 10_000 },
    )
    await locked
    const confirmation = answers.confirmProposal(dossier, field.id, shown, {
      userId: user.id,
      channel: 'site',
    })
    await replacement
    await expect(confirmation).rejects.toBeInstanceOf(ConflictException)
    expect(
      await prisma.dossierAnswer.findUniqueOrThrow({ where: { id: proposal.id } }),
    ).toMatchObject({ value: '12 000 EUR', confirmation: 'pending' })
    expect(await revisionsOf(proposal.id)).toEqual([])
  })

  it('keeps the confirmed and corrected states in order, by the database’s clock, until the company goes', async () => {
    const { user, field, dossier, document, proposal } = await dossierWithProposal()
    const site = { userId: user.id, channel: 'site' } as const
    const confirmed = await answers.confirmProposal(
      dossier,
      field.id,
      { value: proposal.value, updatedAt: proposal.updatedAt },
      site,
    )
    expect(confirmed).toMatchObject({
      origin: 'ai',
      confirmation: 'confirmed',
      channel: 'site',
      clientName: null,
      sourceDocumentId: document.id,
    })
    await answers.saveForDossier(dossier, [{ fieldId: field.id, value: '12 000 EUR' }], site)
    // The person's own later edit is not kept.
    await answers.saveForDossier(dossier, [{ fieldId: field.id, value: '12 500 EUR' }], site)

    const revisions = await revisionsOf(proposal.id)
    expect(revisions).toEqual([
      expect.objectContaining({
        value: '10 000 EUR',
        origin: 'ai',
        confirmation: 'pending',
        channel: 'mcp',
        clientName: 'Claude',
        sourceDocumentId: document.id,
        recordedAt: proposal.updatedAt,
      }),
      expect.objectContaining({
        value: '10 000 EUR',
        origin: 'ai',
        confirmation: 'confirmed',
        channel: 'site',
        recordedAt: confirmed.updatedAt,
      }),
    ])
    const [view] = await answers.listViews(dossier, 'history')
    expect(view.value).toBe('12 500 EUR')
    expect(view.history!.map((h) => h.provenance?.confirmation)).toEqual(['confirmed', 'pending'])

    const set = (data: Record<string, unknown>) =>
      prisma.dossierAnswerRevision.update({ where: { id: revisions[0].id }, data })
    await expect(set({ origin: 'robot' })).rejects.toThrow(/revisions_origin_check/)
    await expect(set({ origin: 'human' })).rejects.toThrow(/revisions_human_confirmed_check/)
    await expect(set({ channel: 'site' })).rejects.toThrow(/revisions_client_name_check/)
    await expect(set({ confirmation: null })).rejects.toThrow(/revisions_provenance_check/)

    // The document goes: the history keeps what was cited, without the link.
    await prisma.document.delete({ where: { id: document.id } })
    expect((await revisionsOf(proposal.id))[0]).toMatchObject({ sourceDocumentId: null })
    // The company goes with its last dossier (as DossiersService.delete does): its profile's
    // answers and their history with it (E05.05).
    await prisma.$transaction([
      prisma.dossier.delete({ where: { id: dossier.id } }),
      prisma.company.delete({ where: { id: dossier.companyId } }),
    ])
    expect(await revisionsOf(proposal.id)).toEqual([])
  })
})
