import { UnprocessableEntityException } from '@nestjs/common'
import { SITE_ORIGIN } from '../audit/action-origin'
import type { AuditService } from '../audit/audit.service'
import type { ClassificationService } from '../classification/classification.service'
import { createVersionStructure } from '../questionnaires/questionnaire-structure'
import { QuestionnairesService } from '../questionnaires/questionnaires.service'
import { createFakePrisma } from '../../testing/fake-prisma'
import { DossiersService } from './dossiers.service'
import { CompaniesService } from '../companies/companies.service'

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
  const audit = { record: jest.fn() }
  const svc = new DossiersService(
    p as never,
    new QuestionnairesService(p as never),
    { evaluate: classify } as unknown as ClassificationService,
    audit as unknown as AuditService,
    new CompaniesService(p as never),
  )
  const fieldId = (key: string) =>
    [...fake.table('questionnaireField').values()].find((f) => f.key === key)!.id
  const answer = (key: string, value: string) =>
    p.dossierAnswer.create({ data: { dossierId: 'd-1', fieldId: fieldId(key), value } })
  const attach = (key: string | null, filename = 'kbis.pdf') =>
    p.document.create({
      data: { dossierId: 'd-1', filename, fieldId: key ? fieldId(key) : null, version: 1 },
    })
  return { fake, svc, classify, answer, attach, audit, fieldId }
}

describe('DossiersService.submit', () => {
  it('refuses a dossier with an unanswered required question or a required attachment without document', async () => {
    const { svc, classify, answer, fake, audit } = await setup()
    await answer('nom', '   ')
    const attempt = svc.submit('d-1', 'u-1', SITE_ORIGIN)
    await expect(attempt).rejects.toBeInstanceOf(UnprocessableEntityException)
    await attempt.catch((err: UnprocessableEntityException) => {
      expect(err.getResponse()).toMatchObject({
        details: [
          expect.objectContaining({ label: 'Nom' }),
          expect.objectContaining({ label: 'Kbis' }),
        ],
      })
    })
    expect(classify).not.toHaveBeenCalled()
    expect(fake.table('dossier').get('d-1')?.submittedAt).toBeNull()
    // A refused submission is no submission: nothing in the journal.
    expect(audit.record).not.toHaveBeenCalled()
  })

  it('does not count a document that answers no field, or another field (E03.11)', async () => {
    const { svc, answer, attach } = await setup()
    await answer('nom', 'Biosensio')
    await attach(null, 'kbis.pdf')
    await attach('site', 'capture.png')
    await expect(svc.submit('d-1', 'u-1', SITE_ORIGIN)).rejects.toMatchObject({
      response: { details: [expect.objectContaining({ label: 'Kbis' })] },
    })
  })

  it('submits a complete dossier, and keeps the first submission date when submitted again', async () => {
    const { svc, classify, answer, attach } = await setup()
    await answer('nom', 'Biosensio')
    await attach('kbis')
    const first = await svc.submit('d-1', 'u-1', SITE_ORIGIN)
    expect(first.submittedAt).toBeInstanceOf(Date)
    expect(first).toMatchObject({
      sector: 'Biotech',
      classificationSources: { sector: ['secteur'] },
    })
    const firstDate = first.submittedAt!.getTime()
    await new Promise((r) => setTimeout(r, 5))
    const again = await svc.submit('d-1', 'u-1', SITE_ORIGIN)
    expect(again.submittedAt!.getTime()).toBe(firstDate)
    expect(classify).toHaveBeenCalledTimes(2)
  })

  it('journals each submission with its channel; through MCP, the application and the instruction it reports (E04.08)', async () => {
    const { svc, answer, attach, audit, fake, fieldId } = await setup()
    await answer('nom', 'Biosensio')
    await attach('kbis')
    // An AI proposal still to confirm does not block the submission (E04.05, D02): it is counted.
    await fake.prisma.dossierAnswer.update({
      where: { dossierId_fieldId: { dossierId: 'd-1', fieldId: fieldId('nom') } },
      data: { origin: 'ai', confirmation: 'pending' },
    })
    const viaMcp = {
      channel: 'mcp' as const,
      clientId: 'client-claude',
      clientName: 'Claude',
      grantId: 'grant-1',
      instruction: 'Oui, soumets mon dossier Biosensio.',
    }
    const first = await svc.submit('d-1', 'u-1', viaMcp)
    expect(audit.record).toHaveBeenCalledWith({
      actionType: 'dossier_submitted',
      actorId: 'u-1',
      dossierId: 'd-1',
      metadata: {
        channel: 'mcp',
        clientId: 'client-claude',
        clientName: 'Claude',
        grantId: 'grant-1',
        instruction: 'Oui, soumets mon dossier Biosensio.',
        firstSubmission: true,
        submittedAt: first.submittedAt!.toISOString(),
        questionnaireVersionId: first.questionnaireVersionId,
        pendingProposals: 1,
      },
    })
    await svc.submit('d-1', 'u-1', SITE_ORIGIN)
    expect(audit.record).toHaveBeenLastCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ channel: 'site', firstSubmission: false }),
      }),
    )
    expect(audit.record.mock.calls[1][0].metadata).not.toHaveProperty('instruction')
  })
})
