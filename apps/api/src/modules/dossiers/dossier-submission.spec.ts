import { UnprocessableEntityException } from '@nestjs/common'
import type { ClassificationService } from '../classification/classification.service'
import { createVersionStructure } from '../questionnaires/questionnaire-structure'
import { QuestionnairesService } from '../questionnaires/questionnaires.service'
import { createFakePrisma } from '../../testing/fake-prisma'
import { DossiersService } from './dossiers.service'

async function setup() {
  const fake = createFakePrisma()
  const p = fake.prisma
  const version = await p.questionnaireVersion.create({
    data: { questionnaireId: 'form-1', version: 1, status: 'published' },
  })
  await createVersionStructure(p as never, version.id, [
    {
      section: 'Projet',
      key: 'nom',
      label: 'Nom',
      fieldType: 'text',
      required: true,
      orderIndex: 0,
    },
    {
      section: 'Projet',
      key: 'site',
      label: 'Site web',
      fieldType: 'text',
      required: false,
      orderIndex: 1,
    },
    {
      section: 'Projet',
      key: 'kbis',
      label: 'Kbis',
      fieldType: 'file',
      required: true,
      orderIndex: 2,
    },
  ])
  await p.dossier.create({
    data: {
      id: 'd-1',
      userId: 'u-1',
      name: 'Biosensio',
      slug: 'biosensio',
      questionnaireVersionId: version.id,
      submittedAt: null,
    },
  })
  // Computed inside the submission's transaction and written with the submission date (R40).
  const classify = jest
    .fn()
    .mockResolvedValue({ result: { sector: 'Biotech' }, sources: { sector: ['secteur'] } })
  const svc = new DossiersService(p as never, new QuestionnairesService(p as never), {
    evaluate: classify,
  } as unknown as ClassificationService)
  const fieldId = (key: string) =>
    [...fake.table('questionnaireField').values()].find((f) => f.key === key)!.id
  const answer = (key: string, value: string) =>
    p.dossierAnswer.create({ data: { dossierId: 'd-1', fieldId: fieldId(key), value } })
  return { fake, svc, classify, answer }
}

describe('DossiersService.submit', () => {
  it('refuses a dossier with an unanswered required question, listing it; attachments are not counted', async () => {
    const { svc, classify, answer, fake } = await setup()
    await answer('nom', '   ')
    const attempt = svc.submit('d-1', 'u-1')
    await expect(attempt).rejects.toBeInstanceOf(UnprocessableEntityException)
    await attempt.catch((err: UnprocessableEntityException) => {
      expect(err.getResponse()).toMatchObject({
        details: [expect.objectContaining({ label: 'Nom' })],
      })
    })
    expect(classify).not.toHaveBeenCalled()
    expect(fake.table('dossier').get('d-1')?.submittedAt).toBeNull()
  })

  it('submits a complete dossier, and keeps the first submission date when submitted again', async () => {
    const { svc, classify, answer } = await setup()
    await answer('nom', 'Biosensio')
    const first = await svc.submit('d-1', 'u-1')
    expect(first.submittedAt).toBeInstanceOf(Date)
    expect(first).toMatchObject({
      sector: 'Biotech',
      classificationSources: { sector: ['secteur'] },
    })
    const firstDate = first.submittedAt!.getTime()
    await new Promise((r) => setTimeout(r, 5))
    const again = await svc.submit('d-1', 'u-1')
    expect(again.submittedAt!.getTime()).toBe(firstDate)
    expect(classify).toHaveBeenCalledTimes(2)
  })
})
