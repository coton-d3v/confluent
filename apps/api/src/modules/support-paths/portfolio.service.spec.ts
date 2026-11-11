import { HttpException } from '@nestjs/common'
import { PORTFOLIO_PAGE_SIZE } from '@confluent/shared'
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
import { PortfolioService } from './portfolio.service'
import { SupportPathsService } from './support-paths.service'
import { createDefaultSupportSteps } from './support-step-defaults'

// ROADMAP E06.07: a workspace's portfolio — its sent candidatures with their phase, counted per phase
// and current step, filtered and paged —, read by its conseillers and Confluent's administrators
// only, over its own candidatures, steps and validations.
const ADMIN = { id: 'u-admin', email: 'admin@confluent.dev', role: 'admin' as const }
const SOPHIE = { id: 'u-sophie', email: 'sophie@biosensio.fr', role: 'entrepreneur' as const }
const MARC = { id: 'u-marc', email: 'marc@agrotech.fr', role: 'entrepreneur' as const }
const MARIE = { id: 'u-marie', email: 'marie@cci.fr', role: 'financeur' as const }
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
  for (const u of [ADMIN, SOPHIE, MARC, MARIE, CLAIRE, PAUL]) {
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
  )
  const paths = new SupportPathsService(prisma, candidatures, audit)
  const portfolio = new PortfolioService(prisma, candidatures)

  let clock = Date.parse('2026-11-01T08:00:00Z')
  // A request of `owner` presented to `workspaceId`, sent (unless `draft`), each later than the last.
  const present = async (
    owner: { id: string; role: 'entrepreneur' },
    name: string,
    workspaceId = CCI,
    { draft = false, financingStatus = 'preparing' } = {},
  ) => {
    const dossier = await dossiers.create({ owner, name })
    clock += 60_000
    return p.candidature.create({
      data: {
        dossierId: dossier.id,
        workspaceId,
        formVersionId: 'v',
        submittedAt: draft ? null : new Date(clock),
        financingStatus,
      },
    })
  }
  const step = async (workspaceId: string, key: string) =>
    (await p.supportStep.findFirst({ where: { workspaceId, key } }))!
  const validate = async (workspaceId: string, candidatureId: string, key: string) =>
    paths.setValidation(
      workspaceId === CCI ? MARIE : PAUL,
      workspaceId,
      candidatureId,
      (await step(workspaceId, key)).id,
      { validated: true, version: 0 },
    )
  return { p, portfolio, present, step, validate }
}

describe('PortfolioService', () => {
  let s: Awaited<ReturnType<typeof setup>>
  beforeEach(async () => {
    s = await setup()
  })

  // Four sent candidatures to the CCI — none validated, diagnostic only, all three steps, and the
  // pitch alone — plus a draft to the CCI and a club's candidature with every step validated.
  async function portfolioOfFour() {
    const fresh = await s.present(SOPHIE, 'Biosensio')
    const diagnosed = await s.present(MARC, 'Agrotech', CCI, { financingStatus: 'in_committee' })
    await s.validate(CCI, diagnosed.id, 'diagnostic')
    const ready = await s.present(SOPHIE, 'Biosensio II')
    for (const key of ['diagnostic', 'business_plan', 'pitch']) await s.validate(CCI, ready.id, key)
    const pitched = await s.present(MARC, 'Agrotech II')
    await s.validate(CCI, pitched.id, 'pitch')
    await s.present(SOPHIE, 'Brouillon', CCI, { draft: true })
    const club = await s.present(MARC, 'Agrotech club', CLUB)
    for (const key of ['diagnostic', 'business_plan', 'pitch']) await s.validate(CLUB, club.id, key)
    return { fresh, diagnosed, ready, pitched, club }
  }

  it('gives each sent candidature its phase and counts them per phase and current step — drafts and other workspaces aside', async () => {
    const c = await portfolioOfFour()
    const diagnostic = await s.step(CCI, 'diagnostic')
    const businessPlan = await s.step(CCI, 'business_plan')
    const pitch = await s.step(CCI, 'pitch')
    const view = await s.portfolio.get(MARIE, CCI)
    expect(view.counts).toEqual({
      total: 4,
      phases: { in_progress: 3, ready: 1, no_path: 0 },
      steps: [
        { stepId: diagnostic.id, label: 'Diagnostic', count: 2 },
        { stepId: businessPlan.id, label: 'Business plan', count: 1 },
        { stepId: pitch.id, label: 'Pitch', count: 0 },
      ],
    })
    expect(view).toMatchObject({ total: 4, page: 1, pageSize: PORTFOLIO_PAGE_SIZE })
    // The latest sent first, each with its company, request and phase.
    expect(view.items.map((i) => [i.id, i.dossier.name, i.progress])).toEqual([
      [
        c.pitched.id,
        'Agrotech II',
        {
          phase: 'in_progress',
          validatedSteps: 1,
          totalSteps: 3,
          currentStep: { id: diagnostic.id, label: 'Diagnostic' },
        },
      ],
      [
        c.ready.id,
        'Biosensio II',
        { phase: 'ready', validatedSteps: 3, totalSteps: 3, currentStep: null },
      ],
      [
        c.diagnosed.id,
        'Agrotech',
        {
          phase: 'in_progress',
          validatedSteps: 1,
          totalSteps: 3,
          currentStep: { id: businessPlan.id, label: 'Business plan' },
        },
      ],
      [
        c.fresh.id,
        'Biosensio',
        {
          phase: 'in_progress',
          validatedSteps: 0,
          totalSteps: 3,
          currentStep: { id: diagnostic.id, label: 'Diagnostic' },
        },
      ],
    ])
    expect(view.items[0]).toMatchObject({ company: { name: 'Agrotech II' }, eligibilities: [] })
    // The club sees its own candidature only, ready with its own steps.
    const club = await s.portfolio.get(PAUL, CLUB)
    expect(club.counts.total).toBe(1)
    expect(club.counts.phases).toEqual({ in_progress: 0, ready: 1, no_path: 0 })
    expect(club.items.map((i) => i.id)).toEqual([c.club.id])
  })

  it('filters by phase and current step, the counts staying those of every phase', async () => {
    const c = await portfolioOfFour()
    const diagnostic = await s.step(CCI, 'diagnostic')
    const ready = await s.portfolio.get(MARIE, CCI, { phase: 'ready' })
    expect(ready.items.map((i) => i.id)).toEqual([c.ready.id])
    expect(ready.total).toBe(1)
    expect(ready.counts.total).toBe(4)
    expect(ready.counts.phases).toEqual({ in_progress: 3, ready: 1, no_path: 0 })
    const atDiagnostic = await s.portfolio.get(MARIE, CCI, { step: diagnostic.id })
    expect(atDiagnostic.items.map((i) => i.id)).toEqual([c.pitched.id, c.fresh.id])
    // Phase and step together: a ready candidature has no current step.
    expect((await s.portfolio.get(MARIE, CCI, { phase: 'ready', step: diagnostic.id })).total).toBe(
      0,
    )
    // Another workspace's step matches nothing.
    const clubStep = await s.step(CLUB, 'diagnostic')
    expect((await s.portfolio.get(MARIE, CCI, { step: clubStep.id })).total).toBe(0)
  })

  it('combines the phase with the financing status, the counts following the status filter', async () => {
    const c = await portfolioOfFour()
    const view = await s.portfolio.get(MARIE, CCI, { financingStatus: 'in_committee' })
    expect(view.counts.total).toBe(1)
    expect(view.counts.phases).toEqual({ in_progress: 1, ready: 0, no_path: 0 })
    expect(view.items.map((i) => i.id)).toEqual([c.diagnosed.id])
    expect(
      (await s.portfolio.get(MARIE, CCI, { financingStatus: 'in_committee', phase: 'ready' }))
        .total,
    ).toBe(0)
  })

  it('follows the path as configured now: a deactivated step counts for nothing, a path without active step is « sans parcours »', async () => {
    const c = await portfolioOfFour()
    const pitch = await s.step(CCI, 'pitch')
    const businessPlan = await s.step(CCI, 'business_plan')
    const diagnostic = await s.step(CCI, 'diagnostic')
    // Without the business plan, the diagnosed one is now held at the pitch.
    await s.p.supportStep.update({ where: { id: businessPlan.id }, data: { active: false } })
    let view = await s.portfolio.get(MARIE, CCI)
    expect(view.counts.phases).toEqual({ in_progress: 3, ready: 1, no_path: 0 })
    expect(view.counts.steps.map((x) => [x.label, x.count])).toEqual([
      ['Diagnostic', 2],
      ['Pitch', 1],
    ])
    expect(view.items.find((i) => i.id === c.diagnosed.id)!.progress).toEqual({
      phase: 'in_progress',
      validatedSteps: 1,
      totalSteps: 2,
      currentStep: { id: pitch.id, label: 'Pitch' },
    })
    // Without the diagnostic either, the pitched one is ready.
    await s.p.supportStep.update({ where: { id: diagnostic.id }, data: { active: false } })
    view = await s.portfolio.get(MARIE, CCI)
    expect(view.counts.phases).toEqual({ in_progress: 2, ready: 2, no_path: 0 })
    // Without any active step, nobody is ready.
    await s.p.supportStep.update({ where: { id: pitch.id }, data: { active: false } })
    view = await s.portfolio.get(MARIE, CCI)
    expect(view.counts.phases).toEqual({ in_progress: 0, ready: 0, no_path: 4 })
    expect(view.counts.steps).toEqual([])
    expect(view.items.every((i) => i.progress.currentStep === null)).toBe(true)
  })

  it('pages the matching candidatures, the latest sent first', async () => {
    const sent = []
    for (let i = 0; i < PORTFOLIO_PAGE_SIZE + 2; i++) {
      sent.push(await s.present(i % 2 ? SOPHIE : MARC, `Demande ${i}`))
    }
    const latestFirst = sent.map((c) => c.id).reverse()
    const first = await s.portfolio.get(MARIE, CCI)
    expect(first.total).toBe(PORTFOLIO_PAGE_SIZE + 2)
    expect(first.items.map((i) => i.id)).toEqual(latestFirst.slice(0, PORTFOLIO_PAGE_SIZE))
    const second = await s.portfolio.get(MARIE, CCI, { page: 2 })
    expect(second).toMatchObject({ page: 2, total: PORTFOLIO_PAGE_SIZE + 2 })
    expect(second.items.map((i) => i.id)).toEqual(latestFirst.slice(PORTFOLIO_PAGE_SIZE))
    // Past the last page: no item, the same counts.
    const past = await s.portfolio.get(MARIE, CCI, { page: 3 })
    expect(past.items).toEqual([])
    expect(past.counts.total).toBe(PORTFOLIO_PAGE_SIZE + 2)
  })

  it('is read by the workspace’s conseillers and Confluent’s administrators only', async () => {
    await portfolioOfFour()
    expect((await s.portfolio.get(ADMIN, CCI)).counts.total).toBe(4)
    // An investisseur of the CCI: 403; a conseiller of the club and an entrepreneur: as if it did
    // not exist.
    expect(await failure(s.portfolio.get(CLAIRE, CCI))).toEqual({
      status: 403,
      code: 'CANDIDATURES_FORBIDDEN',
    })
    for (const outsider of [PAUL, SOPHIE]) {
      expect((await failure(s.portfolio.get(outsider, CCI))).status).toBe(404)
    }
  })

  it('answers an empty workspace with zero everywhere', async () => {
    const view = await s.portfolio.get(MARIE, CCI)
    expect(view).toMatchObject({
      counts: { total: 0, phases: { in_progress: 0, ready: 0, no_path: 0 } },
      total: 0,
      items: [],
    })
    expect(view.counts.steps.map((x) => x.count)).toEqual([0, 0, 0])
  })
})
