import { HttpException } from '@nestjs/common'
import { createFakePrisma } from '../../testing/fake-prisma'
import { SITE_ORIGIN } from '../audit/action-origin'
import { AuditService } from '../audit/audit.service'
import { AnswerSourcesService } from '../answers/answer-sources.service'
import type { ClassificationService } from '../classification/classification.service'
import { CompaniesService } from '../companies/companies.service'
import type { DocumentsService } from '../documents/documents.service'
import { DossiersService } from '../dossiers/dossiers.service'
import { FormDesignAccess, type FormDesigner } from '../questionnaires/form-design-access'
import { FormDraftsService } from '../questionnaires/form-drafts.service'
import { FormsService } from '../questionnaires/forms.service'
import { QuestionnairesService } from '../questionnaires/questionnaires.service'
import { WorkspaceAccessService } from '../workspaces/workspace-access'
import { CandidaturesService } from './candidatures.service'

// ROADMAP E05.09: a request presented to two workspaces reuses its company's profile as is, answers
// each workspace's complementary form apart, and no workspace ever reads the other's answers.
const ADMIN = { id: 'u-admin', email: 'admin@confluent.dev', role: 'admin' as const }
const SOPHIE = { id: 'u-sophie', email: 'sophie@biosensio.fr', role: 'entrepreneur' as const }
const LEA = { id: 'u-lea', email: 'lea@autre.fr', role: 'entrepreneur' as const }
// Manager of the CCI; Jean: conseiller of the CCI without the right to manage it; Claire:
// investisseur of the CCI; Paul: manager of the club deal.
const MARIE = { id: 'u-marie', email: 'marie@cci.fr', role: 'financeur' as const }
const JEAN = { id: 'u-jean', email: 'jean@cci.fr', role: 'financeur' as const }
const CLAIRE = { id: 'u-claire', email: 'claire@angels.fr', role: 'financeur' as const }
const PAUL = { id: 'u-paul', email: 'paul@club.fr', role: 'financeur' as const }
const FIN = { id: 'u-fin', email: 'fin@banque.fr', role: 'financeur' as const }
const CCI = 'ws-cci'
const CLUB = 'ws-club'

const inWs = (actor: { id: string; role: string }, workspaceId: string): FormDesigner => ({
  ...actor,
  workspaceId,
})

async function setup() {
  const fake = createFakePrisma()
  const p = fake.prisma
  for (const u of [ADMIN, SOPHIE, LEA, MARIE, JEAN, CLAIRE, PAUL, FIN]) {
    await p.user.create({ data: { ...u, emailVerifiedAt: new Date() } })
  }
  await p.workspace.create({
    data: {
      id: CCI,
      slug: 'cci',
      name: 'CCI Touraine',
      emailDomain: 'cci.fr',
      presentation: 'Accompagnement',
      programName: null,
      color: null,
    },
  })
  await p.workspace.create({
    data: { id: CLUB, slug: 'club', name: 'Club deal', programName: null, color: null },
  })
  const member = (workspaceId: string, userId: string, role: string, canManageWorkspace = false) =>
    p.workspaceMembership.create({ data: { workspaceId, userId, role, canManageWorkspace } })
  await member(CCI, MARIE.id, 'conseiller', true)
  await member(CCI, JEAN.id, 'conseiller')
  await member(CCI, CLAIRE.id, 'investisseur')
  await member(CLUB, PAUL.id, 'conseiller', true)

  const prisma = p as never
  const audit = new AuditService(prisma)
  const workspaces = new WorkspaceAccessService(prisma)
  const design = new FormDesignAccess(workspaces)
  const questionnaires = new QuestionnairesService(prisma)
  const forms = new FormsService(prisma, audit, design)
  const drafts = new FormDraftsService(prisma, forms, questionnaires, audit, design)
  const dossiers = new DossiersService(
    prisma,
    questionnaires,
    { evaluate: jest.fn().mockResolvedValue(null) } as unknown as ClassificationService,
    audit,
    new CompaniesService(prisma),
  )
  const candidatures = new CandidaturesService(
    prisma,
    dossiers,
    workspaces,
    questionnaires,
    new AnswerSourcesService(prisma, {} as DocumentsService),
    audit,
  )

  // A published complementary form, assigned to the workspace's candidatures: one required long
  // text, one optional list.
  async function complementaryForm(designer: FormDesigner, question: string) {
    const form = await forms.create(designer, `Formulaire ${question}`)
    const draft = await drafts.addSection(designer, form.id, { title: 'Candidature' })
    const sectionId = draft.sections[0].id
    await drafts.addField(designer, form.id, {
      sectionId,
      label: question,
      fieldType: 'textarea',
      required: true,
    })
    const published = await drafts.addField(designer, form.id, {
      sectionId,
      label: 'Stade',
      fieldType: 'select',
      required: false,
      choices: [
        { key: 'idee', label: 'Idée' },
        { key: 'revenus', label: 'Premiers revenus' },
      ],
    })
    await drafts.publishDraft(designer, form.id, undefined, SITE_ORIGIN)
    await forms.assignUsage(designer, form.id, 'candidature')
    const [main, stage] = published.fields
    return { formId: form.id, mainId: main.id, stageId: stage.id }
  }

  const dossier = await dossiers.create({ owner: SOPHIE, name: 'Biosensio' })
  const submitProfile = (id = dossier.id) =>
    p.dossier.update({ where: { id }, data: { submittedAt: new Date() } })
  const actions = () => [...fake.table('auditLog').values()].map((a) => a.actionType)
  return {
    fake,
    p,
    forms,
    drafts,
    dossiers,
    candidatures,
    complementaryForm,
    dossier,
    submitProfile,
    actions,
  }
}

type Setup = Awaited<ReturnType<typeof setup>>

async function failure(promise: Promise<unknown>): Promise<{ status: number; code: unknown }> {
  try {
    await promise
  } catch (err) {
    if (err instanceof HttpException) {
      const body = err.getResponse() as { code?: unknown }
      return { status: err.getStatus(), code: body.code }
    }
    throw err
  }
  throw new Error('expected a failure')
}

// Both workspaces receive candidatures; Sophie's request is presented to both, each answered.
async function twoCandidatures(s: Setup) {
  const cciForm = await s.complementaryForm(inWs(MARIE, CCI), 'Pourquoi la CCI ?')
  const clubForm = await s.complementaryForm(inWs(PAUL, CLUB), 'Pourquoi le club ?')
  const toCci = await s.candidatures.create(s.dossier.id, SOPHIE.id, CCI)
  const toClub = await s.candidatures.create(s.dossier.id, SOPHIE.id, CLUB)
  const site = { userId: SOPHIE.id, channel: 'site' as const }
  await s.candidatures.saveAnswers(
    toCci.id,
    SOPHIE.id,
    [{ fieldId: cciForm.mainId, value: 'Secret pour la CCI' }],
    site,
  )
  await s.candidatures.saveAnswers(
    toClub.id,
    SOPHIE.id,
    [{ fieldId: clubForm.mainId, value: 'Secret pour le club' }],
    site,
  )
  return { cciForm, clubForm, toCci, toClub, site }
}

describe('CandidaturesService (E05.09)', () => {
  it('lists the workspaces receiving candidatures by their public identity, to whoever may own companies', async () => {
    const s = await setup()
    expect(await s.candidatures.listOpenWorkspaces(SOPHIE)).toEqual([])
    // A published form not assigned to candidatures opens nothing.
    const unassigned = await s.forms.create(inWs(PAUL, CLUB), 'Brouillon')
    expect(unassigned.usage).toBeNull()
    await s.complementaryForm(inWs(MARIE, CCI), 'Pourquoi la CCI ?')
    expect(await s.candidatures.listOpenWorkspaces(SOPHIE)).toEqual([
      {
        id: CCI,
        name: 'CCI Touraine',
        programName: null,
        color: null,
        presentation: 'Accompagnement',
      },
    ])
    expect((await failure(s.candidatures.listOpenWorkspaces(FIN))).status).toBe(403)
  })

  it('opens one candidature per request and workspace, answering the form version published then', async () => {
    const s = await setup()
    expect((await failure(s.candidatures.create(s.dossier.id, SOPHIE.id, CCI))).status).toBe(404)
    const { formId } = await s.complementaryForm(inWs(MARIE, CCI), 'Pourquoi la CCI ?')
    expect((await failure(s.candidatures.create(s.dossier.id, SOPHIE.id, 'ws-x'))).status).toBe(404)
    // Another account's request: the same 404 as an unknown one.
    expect((await failure(s.candidatures.create(s.dossier.id, LEA.id, CCI))).status).toBe(404)

    const created = await s.candidatures.create(s.dossier.id, SOPHIE.id, CCI)
    expect(created).toMatchObject({
      dossierId: s.dossier.id,
      status: 'draft',
      submittedAt: null,
      workspace: { id: CCI, name: 'CCI Touraine' },
      dossier: { id: s.dossier.id, name: 'Biosensio', profileSubmitted: false },
      form: { name: 'Formulaire Pourquoi la CCI ?', version: { version: 1 } },
      answers: [],
    })
    expect(created.workspace).not.toHaveProperty('emailDomain')
    expect(await failure(s.candidatures.create(s.dossier.id, SOPHIE.id, CCI))).toEqual({
      status: 409,
      code: 'CANDIDATURE_EXISTS',
    })
    expect(s.actions()).toContain('candidature_created')

    // A new version of the form: the candidature keeps its own, a new one answers the new.
    await s.drafts.createDraft(inWs(MARIE, CCI), formId)
    await s.drafts.publishDraft(inWs(MARIE, CCI), formId, undefined, SITE_ORIGIN)
    const again = await s.candidatures.getForOwner(created.id, SOPHIE.id)
    expect(again.form.version.version).toBe(1)
    const other = await s.dossiers.createForCompany({
      owner: SOPHIE,
      companyId: s.dossier.companyId,
      name: 'Seconde demande',
    })
    const second = await s.candidatures.create(other.id, SOPHIE.id, CCI)
    expect(second.form.version.version).toBe(2)
  })

  it('presents nothing of a company a conseiller still prepares for its entrepreneur (409)', async () => {
    const s = await setup()
    await s.complementaryForm(inWs(MARIE, CCI), 'Pourquoi la CCI ?')
    const prepared = await s.dossiers.createPrepared(s.p as never, {
      holderId: MARIE.id,
      workspaceId: CCI,
      name: 'Préparée',
    })
    expect(await failure(s.candidatures.create(prepared.dossier.id, MARIE.id, CCI))).toEqual({
      status: 409,
      code: 'COMPANY_IN_PREPARATION',
    })
  })

  it('keeps each candidature’s answers to its own form: another workspace’s field or a profile field is refused, nothing written', async () => {
    const s = await setup()
    const { cciForm, clubForm, toCci, site } = await twoCandidatures(s)
    const profileField = [...s.fake.table('questionnaireField').values()].find(
      (f) => f.versionId === s.dossier.questionnaireVersionId,
    )!
    for (const fieldId of [clubForm.mainId, profileField.id]) {
      expect(
        (
          await failure(
            s.candidatures.saveAnswers(toCci.id, SOPHIE.id, [{ fieldId, value: 'x' }], site),
          )
        ).status,
      ).toBe(400)
    }
    // A choice given by its label is stored as its key; an unknown choice is refused.
    const [stage] = await s.candidatures.saveAnswers(
      toCci.id,
      SOPHIE.id,
      [{ fieldId: cciForm.stageId, value: 'Premiers revenus' }],
      site,
    )
    expect(stage).toMatchObject({
      value: 'revenus',
      provenance: {
        origin: 'human',
        confirmation: 'confirmed',
        channel: 'site',
        authorId: SOPHIE.id,
      },
    })
    expect(
      (
        await failure(
          s.candidatures.saveAnswers(
            toCci.id,
            SOPHIE.id,
            [{ fieldId: cciForm.stageId, value: 'inconnu' }],
            site,
          ),
        )
      ).status,
    ).toBe(400)
    // The profile is untouched: the candidature's answers live apart.
    expect(s.fake.table('dossierAnswer').size).toBe(0)
    const rows = [...s.fake.table('candidatureAnswer').values()]
    expect(rows.map((r) => [r.candidatureId === toCci.id, r.value]).sort()).toEqual([
      [false, 'Secret pour le club'],
      [true, 'Secret pour la CCI'],
      [true, 'revenus'],
    ])
    // Nobody else writes them.
    expect(
      (
        await failure(
          s.candidatures.saveAnswers(toCci.id, LEA.id, [{ fieldId: cciForm.mainId, value: 'x' }], {
            userId: LEA.id,
            channel: 'site',
          }),
        )
      ).status,
    ).toBe(404)
    expect((await failure(s.candidatures.getForOwner(toCci.id, MARIE.id))).status).toBe(404)
  })

  it('sends a candidature once the profile is submitted and the workspace’s required questions answered', async () => {
    const s = await setup()
    const { cciForm, toCci, site } = await twoCandidatures(s)
    const empty = await s.candidatures.create(
      (
        await s.dossiers.createForCompany({
          owner: SOPHIE,
          companyId: s.dossier.companyId,
          name: 'Autre',
        })
      ).id,
      SOPHIE.id,
      CCI,
    )
    expect(await failure(s.candidatures.submit(toCci.id, SOPHIE.id))).toEqual({
      status: 422,
      code: 'PROFILE_NOT_SUBMITTED',
    })
    await s.submitProfile()
    const sent = await s.candidatures.submit(toCci.id, SOPHIE.id)
    expect(sent).toMatchObject({ status: 'submitted', dossier: { profileSubmitted: true } })
    await s.candidatures.submit(toCci.id, SOPHIE.id)
    expect(s.actions().filter((a) => a === 'candidature_submitted')).toHaveLength(1)

    // Required answer missing on another request's candidature.
    await s.submitProfile(empty.dossierId)
    expect(await failure(s.candidatures.submit(empty.id, SOPHIE.id))).toEqual({
      status: 422,
      code: 'CANDIDATURE_INCOMPLETE',
    })
    // Once sent, a required answer is corrected, never cleared.
    expect(
      (
        await failure(
          s.candidatures.saveAnswers(
            toCci.id,
            SOPHIE.id,
            [{ fieldId: cciForm.mainId, value: ' ' }],
            site,
          ),
        )
      ).status,
    ).toBe(400)
    await s.candidatures.saveAnswers(
      toCci.id,
      SOPHIE.id,
      [{ fieldId: cciForm.mainId, value: 'Corrigé' }],
      site,
    )
  })

  it('shows a workspace its submitted candidatures only, to its conseillers; never another workspace’s answers', async () => {
    const s = await setup()
    const { toCci, toClub } = await twoCandidatures(s)
    // Drafts: nothing received yet.
    expect(await s.candidatures.listReceived(MARIE, CCI)).toEqual([])
    expect(await failure(s.candidatures.getReceived(MARIE, CCI, toCci.id))).toEqual({
      status: 404,
      code: 'CANDIDATURE_NOT_FOUND',
    })
    await s.submitProfile()
    await s.candidatures.submit(toCci.id, SOPHIE.id)

    for (const reader of [MARIE, JEAN, ADMIN]) {
      const received = await s.candidatures.listReceived(reader, CCI)
      expect(received.map((c) => c.id)).toEqual([toCci.id])
    }
    // An attachment question of the profile: documents never reach a workspace by a candidature.
    const section = [...s.fake.table('questionnaireSection').values()].find(
      (x) => x.versionId === s.dossier.questionnaireVersionId,
    )!
    await s.p.questionnaireField.create({
      data: {
        versionId: s.dossier.questionnaireVersionId,
        sectionId: section.id,
        key: 'kbis',
        label: 'Kbis',
        fieldType: 'file',
        orderIndex: 99,
      },
    })
    const view = await s.candidatures.getReceived(JEAN, CCI, toCci.id)
    expect(view).toMatchObject({
      applicant: { email: SOPHIE.email },
      company: { name: 'Biosensio' },
      dossier: { name: 'Biosensio' },
      form: { answers: [{ value: 'Secret pour la CCI' }] },
    })
    expect(JSON.stringify(view)).not.toContain('Secret pour le club')
    expect(view.profile.fields.some((f) => f.fieldType === 'file')).toBe(false)

    // The club received nothing (its candidature is a draft), and reads nothing of the CCI's.
    expect(await s.candidatures.listReceived(PAUL, CLUB)).toEqual([])
    expect((await failure(s.candidatures.getReceived(PAUL, CLUB, toCci.id))).status).toBe(404)
    expect((await failure(s.candidatures.getReceived(PAUL, CLUB, toClub.id))).status).toBe(404)
    // Outside the CCI: 404; its investisseur: 403; an entrepreneur or a share recipient: 404.
    expect((await failure(s.candidatures.listReceived(PAUL, CCI))).status).toBe(404)
    expect((await failure(s.candidatures.getReceived(PAUL, CCI, toCci.id))).status).toBe(404)
    expect(await failure(s.candidatures.listReceived(CLAIRE, CCI))).toEqual({
      status: 403,
      code: 'CANDIDATURES_FORBIDDEN',
    })
    expect((await failure(s.candidatures.getReceived(CLAIRE, CCI, toCci.id))).status).toBe(403)
    expect((await failure(s.candidatures.listReceived(SOPHIE, CCI))).status).toBe(404)
    expect((await failure(s.candidatures.listReceived(FIN, CCI))).status).toBe(404)
  })

  it('lists the owner’s candidatures of a request, and lets the owner withdraw one', async () => {
    const s = await setup()
    const { toCci, toClub } = await twoCandidatures(s)
    await s.submitProfile()
    await s.candidatures.submit(toCci.id, SOPHIE.id)
    const listed = await s.candidatures.listForDossier(s.dossier.id, SOPHIE.id)
    expect(listed.map((c) => [c.workspace.name, c.status]).sort()).toEqual([
      ['CCI Touraine', 'submitted'],
      ['Club deal', 'draft'],
    ])
    expect((await failure(s.candidatures.listForDossier(s.dossier.id, LEA.id))).status).toBe(404)
    expect((await failure(s.candidatures.withdraw(toCci.id, LEA.id))).status).toBe(404)

    await s.candidatures.withdraw(toCci.id, SOPHIE.id)
    expect(await s.candidatures.listReceived(MARIE, CCI)).toEqual([])
    expect((await failure(s.candidatures.getForOwner(toCci.id, SOPHIE.id))).status).toBe(404)
    expect((await s.candidatures.listForDossier(s.dossier.id, SOPHIE.id)).map((c) => c.id)).toEqual(
      [toClub.id],
    )
    expect(s.actions()).toContain('candidature_withdrawn')
  })

  it('applies the profile’s provenance and history rules: a proposal that gives way is kept', async () => {
    const s = await setup()
    const { cciForm, toCci } = await twoCandidatures(s)
    const mcp = { userId: SOPHIE.id, channel: 'mcp' as const, clientName: 'Claude' }
    await s.candidatures.saveAnswers(
      toCci.id,
      SOPHIE.id,
      [{ fieldId: cciForm.mainId, value: 'Proposé', origin: 'ai', confirmedByUser: true }],
      mcp,
    )
    // An unconfirmed proposal without a source is never stored.
    expect(
      (
        await failure(
          s.candidatures.saveAnswers(
            toCci.id,
            SOPHIE.id,
            [{ fieldId: cciForm.mainId, value: 'Deviné', origin: 'ai' }],
            mcp,
          ),
        )
      ).status,
    ).toBe(400)
    const [corrected] = await s.candidatures.saveAnswers(
      toCci.id,
      SOPHIE.id,
      [{ fieldId: cciForm.mainId, value: 'Corrigé à la main' }],
      { userId: SOPHIE.id, channel: 'site' },
    )
    expect(corrected.provenance).toMatchObject({ origin: 'human', channel: 'site' })
    // The person's value replaced by the proposal, then the proposal replaced by the correction.
    expect(corrected.history).toHaveLength(2)
    expect(corrected.history).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          value: 'Proposé',
          provenance: expect.objectContaining({
            origin: 'ai',
            channel: 'mcp',
            clientName: 'Claude',
          }),
        }),
        expect.objectContaining({
          value: 'Secret pour la CCI',
          provenance: expect.objectContaining({ origin: 'human', channel: 'site' }),
        }),
      ]),
    )
  })
})
