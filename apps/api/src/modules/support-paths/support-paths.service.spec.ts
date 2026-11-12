import { HttpException } from '@nestjs/common'
import { createFakePrisma } from '../../testing/fake-prisma'
import { AnswerSourcesService } from '../answers/answer-sources.service'
import { AuditService } from '../audit/audit.service'
import { CandidaturesService } from '../candidatures/candidatures.service'
import type { ClassificationService } from '../classification/classification.service'
import { CompaniesService } from '../companies/companies.service'
import type { DocumentsService } from '../documents/documents.service'
import { DossiersService } from '../dossiers/dossiers.service'
import { QuestionnairesService } from '../questionnaires/questionnaires.service'
import { WorkspaceAccessService } from '../workspaces/workspace-access'
import { SupportPathsService } from './support-paths.service'
import { createDefaultSupportSteps } from './support-step-defaults'
import { quietNotifications } from '../../testing/notifications'

// ROADMAP E06.06: who reads a candidature's support path — its owner (never who validated), and
// once sent the conseillers of its workspace, who alone validate and reopen —, nobody else; every
// write checked again under the candidature's lock; a step changed meanwhile never overwritten; a
// deactivated step frozen; each change dated, kept and journaled.
const ADMIN = { id: 'u-admin', email: 'admin@confluent.dev', role: 'admin' as const }
const SOPHIE = { id: 'u-sophie', email: 'sophie@biosensio.fr', role: 'entrepreneur' as const }
const LEA = { id: 'u-lea', email: 'lea@autre.fr', role: 'entrepreneur' as const }
const MARIE = {
  id: 'u-marie',
  email: 'marie@cci.fr',
  role: 'financeur' as const,
  firstName: 'Marie',
  lastName: 'Durand',
}
const JEAN = { id: 'u-jean', email: 'jean@cci.fr', role: 'financeur' as const }
const CLAIRE = { id: 'u-claire', email: 'claire@angels.fr', role: 'financeur' as const }
const PAUL = { id: 'u-paul', email: 'paul@club.fr', role: 'financeur' as const }
const CCI = 'ws-cci'
const CLUB = 'ws-club'

async function failure(promise: Promise<unknown>): Promise<{ status: number; code: string }> {
  try {
    await promise
  } catch (err) {
    if (err instanceof HttpException) {
      const body = err.getResponse() as { code?: string; message?: string }
      return { status: err.getStatus(), code: body.code ?? body.message ?? '' }
    }
    throw err
  }
  throw new Error('expected a refusal')
}

async function setup() {
  const fake = createFakePrisma()
  const p = fake.prisma
  for (const u of [ADMIN, SOPHIE, LEA, MARIE, JEAN, CLAIRE, PAUL]) {
    await p.user.create({ data: { ...u, emailVerifiedAt: new Date() } })
  }
  for (const [id, name] of [
    [CCI, 'CCI Touraine'],
    [CLUB, 'Club deal'],
  ]) {
    await p.workspace.create({ data: { id, slug: id, name } })
    await createDefaultSupportSteps(p as never, id)
  }
  const member = (workspaceId: string, userId: string, role: string) =>
    p.workspaceMembership.create({
      data: { workspaceId, userId, role, canManageWorkspace: false, deactivatedAt: null },
    })
  await member(CCI, MARIE.id, 'conseiller')
  await member(CCI, JEAN.id, 'conseiller')
  await member(CCI, CLAIRE.id, 'investisseur')
  await member(CLUB, PAUL.id, 'conseiller')

  const prisma = p as never
  const audit = new AuditService(prisma)
  const questionnaires = new QuestionnairesService(prisma)
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
    new WorkspaceAccessService(prisma),
    questionnaires,
    new AnswerSourcesService(prisma, {} as DocumentsService),
    audit,
    quietNotifications(prisma),
  )
  const paths = new SupportPathsService(prisma, candidatures, audit)

  const dossier = await dossiers.create({ owner: SOPHIE, name: 'Biosensio' })
  // Candidatures made as the candidatures' service leaves them: a draft to the CCI, sent to the club.
  const toCci = await p.candidature.create({
    data: { dossierId: dossier.id, workspaceId: CCI, formVersionId: 'v', submittedAt: null },
  })
  const toClub = await p.candidature.create({
    data: { dossierId: dossier.id, workspaceId: CLUB, formVersionId: 'v', submittedAt: new Date() },
  })
  const send = () =>
    p.candidature.update({ where: { id: toCci.id }, data: { submittedAt: new Date() } })
  const step = async (workspaceId: string, key: string) =>
    (await p.supportStep.findFirst({ where: { workspaceId, key } }))!
  const journal = () =>
    [...fake.table('auditLog').values()].filter(
      (e) => e.actionType === 'candidature_support_step_updated',
    )
  const validate = (
    actor: { id: string; role: string },
    stepId: string,
    version: number,
    validated = true,
    workspaceId = CCI,
    candidatureId = toCci.id,
  ) => paths.setValidation(actor, workspaceId, candidatureId, stepId, { validated, version })
  return { fake, p, paths, dossier, toCci, toClub, send, step, journal, validate }
}

describe('SupportPathsService', () => {
  let s: Awaited<ReturnType<typeof setup>>
  beforeEach(async () => {
    s = await setup()
  })

  it('shows the owner the path of a draft — steps, explanations, nothing validated —, which the workspace reaches once sent', async () => {
    const view = await s.paths.getForOwner(SOPHIE.id, s.toCci.id)
    expect(view).toMatchObject({ candidatureId: s.toCci.id, workspaceId: CCI })
    expect(view.steps.map((x) => [x.key, x.active, x.validatedAt, x.version])).toEqual([
      ['diagnostic', true, null, 0],
      ['business_plan', true, null, 0],
      ['pitch', true, null, 0],
    ])
    expect(view.steps.every((x) => x.explanation)).toBe(true)
    // The structure neither reads nor validates a draft.
    const diagnostic = await s.step(CCI, 'diagnostic')
    expect(await failure(s.paths.getReceived(MARIE, CCI, s.toCci.id))).toEqual({
      status: 404,
      code: 'CANDIDATURE_NOT_FOUND',
    })
    expect(await failure(s.validate(MARIE, diagnostic.id, 0))).toEqual({
      status: 404,
      code: 'CANDIDATURE_NOT_FOUND',
    })
    await s.send()
    expect((await s.paths.getReceived(MARIE, CCI, s.toCci.id)).steps).toHaveLength(3)
  })

  it('lets a conseiller validate a step, dated, with its validator — whom the owner never learns', async () => {
    await s.send()
    const diagnostic = await s.step(CCI, 'diagnostic')
    const view = await s.validate(MARIE, diagnostic.id, 0)
    expect(view.steps[0]).toMatchObject({
      key: 'diagnostic',
      validatedAt: expect.any(Date),
      version: 1,
      validatedBy: { email: MARIE.email, firstName: 'Marie', lastName: 'Durand' },
    })
    expect(view.steps[1]).toMatchObject({ validatedAt: null, validatedBy: null, version: 0 })
    expect(view.history).toEqual([
      {
        stepId: diagnostic.id,
        stepLabel: 'Diagnostic',
        change: 'validated',
        changedAt: view.steps[0].validatedAt,
        actor: { email: MARIE.email, firstName: 'Marie', lastName: 'Durand' },
      },
    ])
    const mine = await s.paths.getForOwner(SOPHIE.id, s.toCci.id)
    expect(mine.steps[0]).toEqual({
      id: diagnostic.id,
      key: 'diagnostic',
      label: 'Diagnostic',
      explanation: diagnostic.explanation,
      active: true,
      validatedAt: view.steps[0].validatedAt,
      version: 1,
    })
    expect(mine).not.toHaveProperty('history')
    expect(JSON.stringify(mine)).not.toMatch(/u-marie|marie@|Marie|Durand/)
    // An administrator validates as the structure, too.
    const pitch = await s.step(CCI, 'pitch')
    expect((await s.validate(ADMIN, pitch.id, 0)).steps[2].validatedBy).toMatchObject({
      email: ADMIN.email,
    })
  })

  it('reopens a validated step and validates it again, each change kept in the history and journaled', async () => {
    await s.send()
    const bp = await s.step(CCI, 'business_plan')
    await s.validate(MARIE, bp.id, 0)
    const reopened = await s.validate(JEAN, bp.id, 1, false)
    expect(reopened.steps[1]).toMatchObject({ validatedAt: null, validatedBy: null, version: 2 })
    const again = await s.validate(JEAN, bp.id, 2)
    expect(again.steps[1]).toMatchObject({
      validatedAt: expect.any(Date),
      validatedBy: { email: JEAN.email },
      version: 3,
    })
    expect(again.history.map((h) => [h.stepLabel, h.change, h.actor?.email])).toEqual([
      ['Business plan', 'validated', JEAN.email],
      ['Business plan', 'reopened', JEAN.email],
      ['Business plan', 'validated', MARIE.email],
    ])
    expect(
      s.journal().map((e) => [e.actorId, e.dossierId, (e.metadata as { change: string }).change]),
    ).toEqual([
      [MARIE.id, s.dossier.id, 'validated'],
      [JEAN.id, s.dossier.id, 'reopened'],
      [JEAN.id, s.dossier.id, 'validated'],
    ])
    expect(s.journal()[0].metadata).toMatchObject({
      candidatureId: s.toCci.id,
      workspaceId: CCI,
      stepId: bp.id,
      step: 'business_plan',
      version: 1,
    })
  })

  it('refuses a change made from a stale version, never overwriting; the same state again writes nothing', async () => {
    await s.send()
    const pitch = await s.step(CCI, 'pitch')
    await s.validate(MARIE, pitch.id, 0)
    // Jean's screen still shows the step never validated: his validation, and his reopening from an
    // older version, are refused.
    expect(await failure(s.validate(JEAN, pitch.id, 0))).toEqual({
      status: 409,
      code: 'SUPPORT_STEP_CHANGED',
    })
    await s.validate(MARIE, pitch.id, 1, false)
    expect(await failure(s.validate(JEAN, pitch.id, 1, false))).toEqual({
      status: 409,
      code: 'SUPPORT_STEP_CHANGED',
    })
    expect(await failure(s.validate(JEAN, pitch.id, 5))).toMatchObject({ status: 409 })
    // The current version, the current state: nothing written, nothing journaled.
    const same = await s.validate(JEAN, pitch.id, 2, false)
    expect(same.steps[2]).toMatchObject({ version: 2, validatedAt: null })
    const diagnostic = await s.step(CCI, 'diagnostic')
    await s.validate(JEAN, diagnostic.id, 0, false)
    expect(s.fake.table('candidatureStepValidation').size).toBe(1)
    expect(s.fake.table('candidatureStepValidationChange').size).toBe(2)
    expect(s.journal()).toHaveLength(2)
  })

  it('validates the candidature’s own workspace’s steps only; a deactivated step keeps its validation, frozen', async () => {
    await s.send()
    const clubPitch = await s.step(CLUB, 'pitch')
    expect(await failure(s.validate(MARIE, clubPitch.id, 0))).toEqual({
      status: 404,
      code: 'SUPPORT_STEP_NOT_FOUND',
    })
    expect(await failure(s.validate(MARIE, 'unknown', 0))).toMatchObject({ status: 404 })
    const diagnostic = await s.step(CCI, 'diagnostic')
    const bp = await s.step(CCI, 'business_plan')
    await s.validate(MARIE, diagnostic.id, 0)
    // The structure stops using both steps: the validated one stays visible, flagged, the other
    // leaves the path; neither changes any more.
    await s.p.supportStep.update({ where: { id: diagnostic.id }, data: { active: false } })
    await s.p.supportStep.update({ where: { id: bp.id }, data: { active: false } })
    const view = await s.paths.getReceived(MARIE, CCI, s.toCci.id)
    expect(view.steps.map((x) => [x.key, x.active, x.validatedAt !== null])).toEqual([
      ['diagnostic', false, true],
      ['pitch', true, false],
    ])
    expect(
      (await s.paths.getForOwner(SOPHIE.id, s.toCci.id)).steps.map((x) => [x.key, x.active]),
    ).toEqual([
      ['diagnostic', false],
      ['pitch', true],
    ])
    for (const [id, version, validated] of [
      [diagnostic.id, 1, false],
      [bp.id, 0, true],
    ] as const) {
      expect(await failure(s.validate(MARIE, id, version, validated))).toEqual({
        status: 409,
        code: 'SUPPORT_STEP_INACTIVE',
      })
    }
    // Reactivated, the step comes back with its validation; reordered, validations follow it.
    await s.p.supportStep.update({ where: { id: diagnostic.id }, data: { active: true } })
    await s.p.supportStep.update({ where: { id: diagnostic.id }, data: { position: 9 } })
    const back = await s.paths.getReceived(MARIE, CCI, s.toCci.id)
    expect(back.steps.map((x) => [x.key, x.validatedAt !== null, x.version])).toEqual([
      ['pitch', false, 0],
      ['diagnostic', true, 1],
    ])
  })

  it('is the owner’s and the workspace’s conseillers’ alone: investor 403, every other party 404', async () => {
    await s.send()
    const diagnostic = await s.step(CCI, 'diagnostic')
    expect(await failure(s.paths.getReceived(CLAIRE, CCI, s.toCci.id))).toMatchObject({
      status: 403,
    })
    expect(await failure(s.validate(CLAIRE, diagnostic.id, 0))).toMatchObject({ status: 403 })
    // The club's conseiller, through either workspace; entrepreneurs as if they were the workspace.
    for (const [actor, workspaceId] of [
      [PAUL, CCI],
      [PAUL, CLUB],
      [SOPHIE, CCI],
      [LEA, CCI],
    ] as const) {
      expect(await failure(s.paths.getReceived(actor, workspaceId, s.toCci.id))).toMatchObject({
        status: 404,
      })
      expect(await failure(s.validate(actor, diagnostic.id, 0, true, workspaceId))).toMatchObject({
        status: 404,
      })
    }
    // The owner's route for anyone else.
    for (const who of [LEA, MARIE, ADMIN]) {
      expect(await failure(s.paths.getForOwner(who.id, s.toCci.id))).toMatchObject({
        status: 404,
      })
    }
    // A deactivated conseiller.
    await s.p.workspaceMembership.updateMany({
      where: { userId: JEAN.id },
      data: { deactivatedAt: new Date() },
    })
    expect(await failure(s.validate(JEAN, diagnostic.id, 0))).toMatchObject({ status: 404 })
    expect(s.fake.table('candidatureStepValidation').size).toBe(0)
    // The club reads its own candidature's path, on its own steps.
    const club = await s.paths.getReceived(PAUL, CLUB, s.toClub.id)
    const clubDiagnostic = await s.step(CLUB, 'diagnostic')
    expect(club.steps[0].id).toBe(clubDiagnostic.id)
  })

  it('reads the access again under the candidature’s lock: a right lost meanwhile writes nothing', async () => {
    await s.send()
    const diagnostic = await s.step(CCI, 'diagnostic')
    s.p.$queryRaw.mockImplementationOnce(async () => {
      await s.p.workspaceMembership.updateMany({
        where: { userId: JEAN.id },
        data: { deactivatedAt: new Date() },
      })
      return []
    })
    expect(await failure(s.validate(JEAN, diagnostic.id, 0))).toMatchObject({ status: 404 })
    expect(s.fake.table('candidatureStepValidation').size).toBe(0)
    expect(s.fake.table('candidatureStepValidationChange').size).toBe(0)
    expect(s.journal()).toHaveLength(0)
  })

  it('states the candidature’s phase to both sides, from the active steps and their validations (E06.07)', async () => {
    const diagnostic = await s.step(CCI, 'diagnostic')
    const businessPlan = await s.step(CCI, 'business_plan')
    const pitch = await s.step(CCI, 'pitch')
    // A draft is in preparation from the start, at the first step.
    expect((await s.paths.getForOwner(SOPHIE.id, s.toCci.id)).progress).toEqual({
      phase: 'in_progress',
      validatedSteps: 0,
      totalSteps: 3,
      currentStep: { id: diagnostic.id, label: 'Diagnostic' },
    })
    await s.send()
    await s.validate(MARIE, diagnostic.id, 0)
    const atBusinessPlan = {
      phase: 'in_progress',
      validatedSteps: 1,
      totalSteps: 3,
      currentStep: { id: businessPlan.id, label: 'Business plan' },
    }
    expect((await s.paths.getReceived(JEAN, CCI, s.toCci.id)).progress).toEqual(atBusinessPlan)
    expect((await s.paths.getForOwner(SOPHIE.id, s.toCci.id)).progress).toEqual(atBusinessPlan)
    await s.validate(MARIE, businessPlan.id, 0)
    const ready = await s.validate(MARIE, pitch.id, 0)
    expect(ready.progress).toEqual({
      phase: 'ready',
      validatedSteps: 3,
      totalSteps: 3,
      currentStep: null,
    })
    // Reopened, the pitch is current again; once it is deactivated, the candidature is ready
    // without it.
    expect((await s.validate(MARIE, pitch.id, 1, false)).progress.currentStep).toEqual({
      id: pitch.id,
      label: 'Pitch',
    })
    await s.p.supportStep.update({ where: { id: pitch.id }, data: { active: false } })
    expect((await s.paths.getForOwner(SOPHIE.id, s.toCci.id)).progress).toEqual({
      phase: 'ready',
      validatedSteps: 2,
      totalSteps: 2,
      currentStep: null,
    })
    // The club's own path, with nothing validated, is unaffected.
    expect((await s.paths.getReceived(PAUL, CLUB, s.toClub.id)).progress.validatedSteps).toBe(0)
  })
})
