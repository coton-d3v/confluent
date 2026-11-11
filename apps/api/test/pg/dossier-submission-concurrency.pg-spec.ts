import { randomUUID } from 'node:crypto'
import { UnprocessableEntityException } from '@nestjs/common'
import { AnswerSourcesService } from '../../src/modules/answers/answer-sources.service'
import { AnswersService } from '../../src/modules/answers/answers.service'
import { InvalidAnswersException } from '../../src/modules/answers/invalid-answers.exception'
import { SITE_ORIGIN } from '../../src/modules/audit/action-origin'
import { AuditService } from '../../src/modules/audit/audit.service'
import { ClassificationService } from '../../src/modules/classification/classification.service'
import type { DocumentsService } from '../../src/modules/documents/documents.service'
import { DossiersService } from '../../src/modules/dossiers/dossiers.service'
import { QuestionnairesService } from '../../src/modules/questionnaires/questionnaires.service'
import { testDatabase } from './database'

// Code review R40: saving answers and submitting the same dossier are serialized. A save working
// from a dossier read before a submission must not clear a required answer of the now submitted
// dossier; a submission must not pass while a save clearing that answer is in progress.
describe('dossier answers and submission under concurrency (PostgreSQL)', () => {
  const prisma = testDatabase()
  const classification = new ClassificationService(prisma)
  const answers = new AnswersService(
    prisma,
    classification,
    new AnswerSourcesService(prisma, {} as DocumentsService),
  )
  const dossiers = new DossiersService(
    prisma,
    new QuestionnairesService(prisma),
    classification,
    new AuditService(prisma),
  )

  afterAll(() => prisma.$disconnect())

  async function draftDossier() {
    const tag = randomUUID()
    const user = await prisma.user.create({
      data: { email: `r40-${tag}@test.local`, role: 'entrepreneur' },
    })
    const form = await prisma.questionnaire.create({
      data: { name: `R40 ${tag}`, slug: `r40-${tag}` },
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
        key: 'nom_du_projet',
        label: 'Nom du projet',
        fieldType: 'text',
        required: true,
        orderIndex: 0,
      },
    })
    const dossier = await prisma.dossier.create({
      data: {
        userId: user.id,
        name: 'R40',
        slug: `r40-${tag}`,
        questionnaireVersionId: version.id,
      },
    })
    await answers.saveForDossier(dossier, [{ fieldId: field.id, value: 'Alpha' }], {
      userId: user.id,
      channel: 'site',
    })
    return { user, field, dossier }
  }

  const state = async (dossierId: string, fieldId: string) => {
    const [d, a] = await Promise.all([
      prisma.dossier.findUniqueOrThrow({ where: { id: dossierId } }),
      prisma.dossierAnswer.findFirst({ where: { dossierId, fieldId } }),
    ])
    return { submitted: d.submittedAt !== null, answer: a?.value }
  }

  it('submission first: a save from the earlier read cannot clear the required answer', async () => {
    const { user, field, dossier } = await draftDossier()
    const readBeforeSubmission = await prisma.dossier.findUniqueOrThrow({
      where: { id: dossier.id },
    })
    await dossiers.submit(dossier.id, user.id, SITE_ORIGIN)

    await expect(
      answers.saveForDossier(readBeforeSubmission, [{ fieldId: field.id, value: '' }], {
        userId: user.id,
        channel: 'site',
      }),
    ).rejects.toBeInstanceOf(InvalidAnswersException)
    expect(await state(dossier.id, field.id)).toEqual({ submitted: true, answer: 'Alpha' })
    // E04.08: the submission is journaled (the audit action exists in the migrated database).
    const journal = await prisma.auditLog.findMany({
      where: { dossierId: dossier.id, actionType: 'dossier_submitted' },
    })
    expect(journal.map((e) => e.metadata)).toEqual([
      expect.objectContaining({ channel: 'site', firstSubmission: true }),
    ])
  })

  it('clearing first: a submission waiting for the save sees the cleared answer and is refused', async () => {
    const { user, field, dossier } = await draftDossier()
    // A save in progress: it holds the dossier, clears the answer, and commits 400 ms later.
    let cleared!: () => void
    const clearing = new Promise<void>((resolve) => (cleared = resolve))
    const save = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT 1 FROM "dossiers" WHERE "id" = ${dossier.id} FOR UPDATE`
        await tx.dossierAnswer.updateMany({
          where: { dossierId: dossier.id, fieldId: field.id },
          data: { value: '' },
        })
        cleared()
        await new Promise((r) => setTimeout(r, 400))
      },
      { timeout: 10_000 },
    )
    await clearing
    const submission = dossiers.submit(dossier.id, user.id, SITE_ORIGIN)
    await save
    await expect(submission).rejects.toBeInstanceOf(UnprocessableEntityException)
    expect(await state(dossier.id, field.id)).toEqual({ submitted: false, answer: '' })
  })
})
