import { HttpException } from '@nestjs/common'
import { FUNDING_PLAN_LIMITS } from '@confluent/shared'
import { createFakePrisma } from '../../testing/fake-prisma'
import { AnswerSourcesService } from '../answers/answer-sources.service'
import { AuditService } from '../audit/audit.service'
import { CandidaturesService } from '../candidatures/candidatures.service'
import type { ClassificationService } from '../classification/classification.service'
import { CompaniesService } from '../companies/companies.service'
import type { DocumentsService } from '../documents/documents.service'
import { DossiersService } from '../dossiers/dossiers.service'
import { createDefaultFundingSourceCategories } from '../funding-sources/funding-source-defaults'
import { QuestionnairesService } from '../questionnaires/questionnaires.service'
import type {
  AudiencePledge,
  PledgeAudience,
  PositionsService,
} from '../opportunities/positions.service'
import { WorkspaceAccessService } from '../workspaces/workspace-access'
import { FundingPlansService, planPledges, type FundingPlanParty } from './funding-plans.service'

// ROADMAP E06.03: who keeps a candidature's financing plan — its owner, and once sent the
// conseillers of its workspace —, nobody else; every write checked again under the candidature's
// lock; a line changed meanwhile never overwritten.
const ADMIN = { id: 'u-admin', email: 'admin@confluent.dev', role: 'admin' as const }
const SOPHIE = { id: 'u-sophie', email: 'sophie@biosensio.fr', role: 'entrepreneur' as const }
const LEA = { id: 'u-lea', email: 'lea@autre.fr', role: 'entrepreneur' as const }
const MARIE = { id: 'u-marie', email: 'marie@cci.fr', role: 'financeur' as const }
const JEAN = { id: 'u-jean', email: 'jean@cci.fr', role: 'financeur' as const }
const CLAIRE = { id: 'u-claire', email: 'claire@angels.fr', role: 'financeur' as const }
const PAUL = { id: 'u-paul', email: 'paul@club.fr', role: 'financeur' as const }
const CCI = 'ws-cci'
const CLUB = 'ws-club'

const owner = (u: { id: string }): FundingPlanParty => ({ side: 'owner', userId: u.id })
const inWs = (u: { id: string; role: string }, workspaceId = CCI): FundingPlanParty => ({
  side: 'workspace',
  actor: u,
  workspaceId,
})

async function failure(promise: Promise<unknown>): Promise<{ status: number; message: string }> {
  try {
    await promise
  } catch (err) {
    if (err instanceof HttpException) {
      const body = err.getResponse() as { code?: string; message?: string }
      return { status: err.getStatus(), message: body.code ?? body.message ?? '' }
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
    await createDefaultFundingSourceCategories(p as never, id)
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
  )
  // What each audience reads of the pledges is PositionsService's rule (tested with it, and over
  // HTTP in funding-plan-pledges.e2e-spec.ts); here, set by each test.
  const seen: { owner: AudiencePledge[]; workspace: Record<string, AudiencePledge[]> } = {
    owner: [],
    workspace: {},
  }
  const positions = {
    pledgesFor: jest.fn((audience: PledgeAudience) =>
      Promise.resolve(
        audience.side === 'owner' ? seen.owner : (seen.workspace[audience.workspaceId] ?? []),
      ),
    ),
  } as unknown as PositionsService
  const plans = new FundingPlansService(prisma, candidatures, positions, audit)

  const dossier = await dossiers.create({ owner: SOPHIE, name: 'Biosensio' })
  await p.dossier.update({ where: { id: dossier.id }, data: { amountEur: 100_000 } })
  // Candidatures made as the candidatures' service leaves them: a draft to the CCI, sent to the club.
  const toCci = await p.candidature.create({
    data: { dossierId: dossier.id, workspaceId: CCI, formVersionId: 'v', submittedAt: null },
  })
  const toClub = await p.candidature.create({
    data: { dossierId: dossier.id, workspaceId: CLUB, formVersionId: 'v', submittedAt: new Date() },
  })
  const send = () =>
    p.candidature.update({ where: { id: toCci.id }, data: { submittedAt: new Date() } })
  const category = async (workspaceId: string, key: string) =>
    (await p.fundingSourceCategory.findFirst({ where: { workspaceId, key } }))!
  const journal = () =>
    [...fake.table('auditLog').values()].filter((e) => e.actionType === 'funding_plan_updated')
  // A pledge on the request, as the fake stores it.
  const pledgeOn = async (
    investorId: string,
    amountEur: number,
    show = { showName: true, showAmount: true },
  ) =>
    (await p.investorPledge.create({
      data: {
        dossierId: dossier.id,
        investorId,
        intention: 'strong',
        amountEur,
        version: 7,
        ...show,
      },
    })) as unknown as AudiencePledge['pledge']
  return { fake, p, plans, dossier, toCci, toClub, send, category, journal, seen, pledgeOn }
}

describe('FundingPlansService', () => {
  let s: Awaited<ReturnType<typeof setup>>
  beforeEach(async () => {
    s = await setup()
  })

  const add = (party: FundingPlanParty, candidatureId: string, categoryId: string, amount = 1000) =>
    s.plans.addLine(party, candidatureId, { categoryId, amountEur: amount, state: 'planned' })

  it('lets the owner prepare the plan of a draft candidature, which the workspace reaches once sent', async () => {
    const bpi = await s.category(CCI, 'bpifrance')
    const plan = await add(owner(SOPHIE), s.toCci.id, bpi.id, 25_000)
    expect(plan.lines).toEqual([
      expect.objectContaining({ amountEur: 25_000, state: 'planned', updatedBy: 'owner' }),
    ])
    expect(plan.totals).toMatchObject({ objectiveEur: 100_000, plannedEur: 25_000 })
    expect(await failure(s.plans.get(inWs(MARIE), s.toCci.id))).toEqual({
      status: 404,
      message: 'CANDIDATURE_NOT_FOUND',
    })
    expect(await failure(add(inWs(MARIE), s.toCci.id, bpi.id))).toMatchObject({ status: 404 })
    await s.send()
    expect((await s.plans.get(inWs(MARIE), s.toCci.id)).lines).toHaveLength(1)
  })

  it('opens the workspace side to its active conseillers and administrators only', async () => {
    await s.send()
    const bpi = await s.category(CCI, 'bpifrance')
    // A conseiller without the right to manage, and an administrator who is not a member.
    await add(inWs(JEAN), s.toCci.id, bpi.id)
    await add(inWs(ADMIN), s.toCci.id, bpi.id)
    expect(await failure(add(inWs(CLAIRE), s.toCci.id, bpi.id))).toMatchObject({ status: 403 })
    expect(await failure(s.plans.get(inWs(CLAIRE), s.toCci.id))).toMatchObject({ status: 403 })
    // Another workspace's conseiller, through either workspace; the owner on the workspace side.
    for (const party of [inWs(PAUL), inWs(PAUL, CLUB), inWs(SOPHIE), inWs(LEA)]) {
      expect(await failure(s.plans.get(party, s.toCci.id))).toMatchObject({ status: 404 })
      expect(await failure(add(party, s.toCci.id, bpi.id))).toMatchObject({ status: 404 })
    }
    // Another account on the owner side.
    for (const who of [LEA, MARIE, ADMIN]) {
      expect(await failure(s.plans.get(owner(who), s.toCci.id))).toMatchObject({ status: 404 })
    }
    // A deactivated conseiller: refused at the next request.
    await s.p.workspaceMembership.updateMany({
      where: { userId: JEAN.id },
      data: { deactivatedAt: new Date() },
    })
    expect(await failure(s.plans.get(inWs(JEAN), s.toCci.id))).toMatchObject({ status: 404 })
    expect(s.fake.table('fundingPlanLine').size).toBe(2)
  })

  it('reads the access again under the candidature’s lock: a right lost meanwhile writes nothing', async () => {
    await s.send()
    const bpi = await s.category(CCI, 'bpifrance')
    // Jean is deactivated while his write waits for the lock.
    s.p.$queryRaw.mockImplementationOnce(async () => {
      await s.p.workspaceMembership.updateMany({
        where: { userId: JEAN.id },
        data: { deactivatedAt: new Date() },
      })
      return []
    })
    expect(await failure(add(inWs(JEAN), s.toCci.id, bpi.id))).toMatchObject({ status: 404 })
    // The request changes hands while Sophie's write waits for the lock.
    s.p.$queryRaw.mockImplementationOnce(async () => {
      await s.p.dossier.update({ where: { id: s.dossier.id }, data: { userId: LEA.id } })
      return []
    })
    expect(await failure(add(owner(SOPHIE), s.toCci.id, bpi.id))).toMatchObject({ status: 404 })
    expect(s.fake.table('fundingPlanLine').size).toBe(0)
    expect(s.journal()).toHaveLength(0)
  })

  it('refuses a change made from a stale version, and a line of another plan', async () => {
    await s.send()
    const bpi = await s.category(CCI, 'bpifrance')
    const [line] = (await add(owner(SOPHIE), s.toCci.id, bpi.id)).lines
    const updated = await s.plans.updateLine(inWs(MARIE), s.toCci.id, line.id, {
      version: 1,
      state: 'obtained',
    })
    expect(updated.lines[0]).toMatchObject({
      version: 2,
      state: 'obtained',
      updatedBy: 'workspace',
    })
    expect(
      await failure(
        s.plans.updateLine(owner(SOPHIE), s.toCci.id, line.id, { version: 1, amountEur: 5 }),
      ),
    ).toEqual({ status: 409, message: 'FUNDING_PLAN_LINE_CHANGED' })
    expect(await failure(s.plans.deleteLine(owner(SOPHIE), s.toCci.id, line.id, 1))).toMatchObject({
      status: 409,
    })
    // Through the club's candidature, the CCI's line does not exist.
    expect(
      await failure(
        s.plans.updateLine(owner(SOPHIE), s.toClub.id, line.id, { version: 2, amountEur: 5 }),
      ),
    ).toEqual({ status: 404, message: 'FUNDING_PLAN_LINE_NOT_FOUND' })
    expect(
      await failure(s.plans.deleteLine(inWs(PAUL, CLUB), s.toClub.id, line.id, 2)),
    ).toMatchObject({ status: 404 })
    expect((await s.plans.get(owner(SOPHIE), s.toCci.id)).lines[0]).toMatchObject({
      amountEur: 1000,
      version: 2,
    })
  })

  it('writes nothing and journals nothing when nothing changes', async () => {
    const bpi = await s.category(CCI, 'bpifrance')
    const [line] = (await add(owner(SOPHIE), s.toCci.id, bpi.id)).lines
    const same = await s.plans.updateLine(owner(SOPHIE), s.toCci.id, line.id, {
      version: 1,
      amountEur: 1000,
      state: 'planned',
      label: null,
      categoryId: bpi.id,
    })
    expect(same.lines[0].version).toBe(1)
    expect(s.journal().map((e) => (e.metadata as { change: string }).change)).toEqual(['created'])
  })

  it('takes active categories of the candidature’s workspace only; a line keeps a category deactivated afterwards', async () => {
    const clubBpi = await s.category(CLUB, 'bpifrance')
    expect(await failure(add(owner(SOPHIE), s.toCci.id, clubBpi.id))).toEqual({
      status: 400,
      message: 'FUNDING_PLAN_CATEGORY_UNKNOWN',
    })
    expect(await failure(add(owner(SOPHIE), s.toCci.id, 'unknown'))).toMatchObject({ status: 400 })
    const bpi = await s.category(CCI, 'bpifrance')
    const honor = await s.category(CCI, 'pret_honneur')
    const [line] = (await add(owner(SOPHIE), s.toCci.id, bpi.id)).lines
    await s.p.fundingSourceCategory.update({ where: { id: bpi.id }, data: { active: false } })
    expect(await failure(add(owner(SOPHIE), s.toCci.id, bpi.id))).toEqual({
      status: 409,
      message: 'FUNDING_PLAN_CATEGORY_INACTIVE',
    })
    const kept = await s.plans.updateLine(owner(SOPHIE), s.toCci.id, line.id, {
      version: 1,
      amountEur: 2000,
    })
    expect(kept.lines[0].category).toMatchObject({ key: 'bpifrance', active: false })
    expect(kept.categories.map((c) => c.key)).not.toContain('bpifrance')
    await s.plans.updateLine(owner(SOPHIE), s.toCci.id, line.id, {
      version: 2,
      categoryId: honor.id,
    })
    expect(
      await failure(
        s.plans.updateLine(owner(SOPHIE), s.toCci.id, line.id, { version: 3, categoryId: bpi.id }),
      ),
    ).toMatchObject({ status: 409 })
    expect(
      await failure(
        s.plans.updateLine(owner(SOPHIE), s.toCci.id, line.id, {
          version: 3,
          categoryId: clubBpi.id,
        }),
      ),
    ).toMatchObject({ status: 400 })
  })

  it('caps a plan at its number of lines', async () => {
    const bpi = await s.category(CCI, 'bpifrance')
    for (let i = 0; i < FUNDING_PLAN_LIMITS.linesPerPlan; i++) {
      await add(owner(SOPHIE), s.toCci.id, bpi.id, i + 1)
    }
    expect(await failure(add(owner(SOPHIE), s.toCci.id, bpi.id))).toEqual({
      status: 409,
      message: 'FUNDING_PLAN_LIMIT',
    })
    // Another candidature of the request has its own plan.
    await add(owner(SOPHIE), s.toClub.id, (await s.category(CLUB, 'bpifrance')).id)
  })

  it('orders lines as the workspace orders its categories, totals against the amount sought as it is now', async () => {
    const [bpi, honor, own] = await Promise.all(
      ['bpifrance', 'pret_honneur', 'fonds_propres'].map((k) => s.category(CCI, k)),
    )
    await s.plans.addLine(owner(SOPHIE), s.toCci.id, {
      categoryId: own.id,
      amountEur: 10_000,
      state: 'obtained',
    })
    await s.plans.addLine(owner(SOPHIE), s.toCci.id, {
      categoryId: bpi.id,
      amountEur: 30_000,
      state: 'requested',
      label: 'Bourse French Tech',
    })
    await s.plans.addLine(owner(SOPHIE), s.toCci.id, {
      categoryId: honor.id,
      amountEur: 20_000,
      state: 'refused',
    })
    await s.p.fundingSourceCategory.update({ where: { id: own.id }, data: { position: -1 } })
    await s.p.dossier.update({ where: { id: s.dossier.id }, data: { amountEur: 50_000 } })
    const plan = await s.plans.get(owner(SOPHIE), s.toCci.id)
    expect(plan.lines.map((l) => l.category.key)).toEqual([
      'fonds_propres',
      'bpifrance',
      'pret_honneur',
    ])
    expect(plan.totals).toMatchObject({
      objectiveEur: 50_000,
      obtainedEur: 10_000,
      requestedEur: 30_000,
      refusedEur: 20_000,
      remainingEur: 40_000,
      uncoveredEur: 10_000,
      obtainedPercent: 20,
    })
  })

  it('journals each change with its side, author, request and candidature', async () => {
    await s.send()
    const bpi = await s.category(CCI, 'bpifrance')
    const [line] = (await add(owner(SOPHIE), s.toCci.id, bpi.id)).lines
    await s.plans.updateLine(inWs(JEAN), s.toCci.id, line.id, { version: 1, amountEur: 1500 })
    await s.plans.deleteLine(inWs(MARIE), s.toCci.id, line.id, 2)
    expect(
      s.journal().map((e) => ({
        actorId: e.actorId,
        dossierId: e.dossierId,
        metadata: e.metadata,
      })),
    ).toEqual([
      {
        actorId: SOPHIE.id,
        dossierId: s.dossier.id,
        metadata: {
          candidatureId: s.toCci.id,
          workspaceId: CCI,
          side: 'owner',
          change: 'created',
          lineId: line.id,
          line: { category: 'bpifrance', label: null, amountEur: 1000, state: 'planned' },
        },
      },
      {
        actorId: JEAN.id,
        dossierId: s.dossier.id,
        metadata: {
          candidatureId: s.toCci.id,
          workspaceId: CCI,
          side: 'workspace',
          change: 'updated',
          lineId: line.id,
          changes: [{ field: 'amountEur', from: 1000, to: 1500 }],
        },
      },
      {
        actorId: MARIE.id,
        dossierId: s.dossier.id,
        metadata: {
          candidatureId: s.toCci.id,
          workspaceId: CCI,
          side: 'workspace',
          change: 'deleted',
          lineId: line.id,
          line: { category: 'bpifrance', label: null, amountEur: 1500, state: 'planned' },
        },
      },
    ])
  })
})

// ROADMAP E06.04: a pledge and the financing it became are never counted together; only the owner
// confirms, only a pledge they know one by one, at the revision they read; each side sees its own
// pledges only.
describe('FundingPlansService — pledges (E06.04)', () => {
  let s: Awaited<ReturnType<typeof setup>>
  beforeEach(async () => {
    s = await setup()
    await s.send()
  })
  const who = (name: string) => ({ name, organizations: [] })
  const read = (pledge: AudiencePledge['pledge'], name: string, individual = true) => ({
    pledge,
    identity: who(name),
    individual,
  })
  const confirm = (
    party: FundingPlanParty,
    pledge: { id: string; version: number },
    categoryId: string,
    state: 'obtained' | 'requested' | 'planned' = 'obtained',
  ) =>
    s.plans.addLine(party, s.toCci.id, {
      categoryId,
      amountEur: 40_000,
      state,
      pledge: { id: pledge.id, version: pledge.version },
    })

  it('counts a confirmed pledge as its line only, and the others apart from the totals', async () => {
    const claire = await s.pledgeOn(CLAIRE.id, 40_000)
    const paul = await s.pledgeOn(PAUL.id, 25_000, { showName: false, showAmount: false })
    s.seen.owner = [read(claire, 'Claire'), read(paul, 'Paul', false)]
    const ba = await s.category(CCI, 'business_angels_love_money')
    const before = await s.plans.get(owner(SOPHIE), s.toCci.id)
    expect(before.pledges).toEqual({
      count: 2,
      totalEur: 65_000,
      confirmable: [{ id: claire.id, identity: who('Claire'), amountEur: 40_000, version: 7 }],
    })
    const after = await confirm(owner(SOPHIE), claire, ba.id)
    expect(after.totals).toMatchObject({ obtainedEur: 40_000, remainingEur: 60_000 })
    expect(after.pledges).toEqual({ count: 1, totalEur: 25_000, confirmable: [] })
    expect(after.lines[0].pledge).toEqual({
      id: claire.id,
      identity: who('Claire'),
      amountEur: 40_000,
      version: 7,
      current: true,
    })
    expect(s.journal().map((e) => (e.metadata as { change: string }).change)).toEqual([
      'created',
      'pledge_confirmed',
    ])
  })

  it('lets the owner only confirm, a pledge showing name and amount, at the revision read', async () => {
    const claire = await s.pledgeOn(CLAIRE.id, 40_000)
    const hidden = await s.pledgeOn(PAUL.id, 25_000, { showName: true, showAmount: false })
    s.seen.owner = [read(claire, 'Claire'), read(hidden, 'Paul', false)]
    s.seen.workspace[CCI] = [read(claire, 'Claire')]
    const ba = await s.category(CCI, 'business_angels_love_money')
    expect(await failure(confirm(inWs(MARIE), claire, ba.id))).toEqual({
      status: 403,
      message: 'FUNDING_PLAN_PLEDGE_OWNER_ONLY',
    })
    const refused = { status: 409, message: 'FUNDING_PLAN_PLEDGE_CHANGED' }
    expect(await failure(confirm(owner(SOPHIE), hidden, ba.id))).toEqual(refused)
    expect(await failure(confirm(owner(SOPHIE), { ...claire, version: 8 }, ba.id))).toEqual(refused)
    const unknown = { id: '0d3c1b0e-0000-4000-8000-000000000000', version: 7 }
    expect(await failure(confirm(owner(SOPHIE), unknown, ba.id))).toEqual(refused)
    expect(await failure(confirm(owner(SOPHIE), claire, ba.id, 'planned'))).toEqual({
      status: 409,
      message: 'FUNDING_PLAN_PLEDGE_STATE',
    })
    expect((await s.plans.get(owner(SOPHIE), s.toCci.id)).lines).toEqual([])
    // An existing line only envisaged does not confirm a pledge either.
    const [planned] = (
      await s.plans.addLine(owner(SOPHIE), s.toCci.id, {
        categoryId: ba.id,
        amountEur: 1000,
        state: 'planned',
      })
    ).lines
    expect(
      await failure(
        s.plans.confirmPledge(owner(SOPHIE), s.toCci.id, planned.id, {
          version: planned.version,
          pledge: { id: claire.id, version: 7 },
        }),
      ),
    ).toEqual({ status: 409, message: 'FUNDING_PLAN_PLEDGE_STATE' })
    await s.plans.deleteLine(owner(SOPHIE), s.toCci.id, planned.id, planned.version)
    const [line] = (await confirm(owner(SOPHIE), claire, ba.id)).lines
    expect(
      await failure(
        s.plans.confirmPledge(inWs(MARIE), s.toCci.id, line.id, {
          version: line.version,
          pledge: { id: claire.id, version: 7 },
        }),
      ),
    ).toMatchObject({ status: 403 })
    expect(
      await failure(s.plans.releasePledge(inWs(MARIE), s.toCci.id, line.id, line.version)),
    ).toMatchObject({ status: 403 })
  })

  it('keeps one line per pledge; the same revision again changes nothing, a new one is confirmed again', async () => {
    const claire = await s.pledgeOn(CLAIRE.id, 40_000)
    s.seen.owner = [read(claire, 'Claire')]
    const ba = await s.category(CCI, 'business_angels_love_money')
    const [line] = (await confirm(owner(SOPHIE), claire, ba.id)).lines
    expect(await failure(confirm(owner(SOPHIE), claire, ba.id))).toEqual({
      status: 409,
      message: 'FUNDING_PLAN_PLEDGE_HELD',
    })
    const other = (
      await s.plans.addLine(owner(SOPHIE), s.toCci.id, {
        categoryId: ba.id,
        amountEur: 1000,
        state: 'requested',
      })
    ).lines.find((l) => l.id !== line.id)!
    expect(
      await failure(
        s.plans.confirmPledge(owner(SOPHIE), s.toCci.id, other.id, {
          version: other.version,
          pledge: { id: claire.id, version: 7 },
        }),
      ),
    ).toEqual({ status: 409, message: 'FUNDING_PLAN_PLEDGE_HELD' })
    const journaled = s.journal().length
    const same = await s.plans.confirmPledge(owner(SOPHIE), s.toCci.id, line.id, {
      version: line.version,
      pledge: { id: claire.id, version: 7 },
    })
    expect(same.lines.find((l) => l.id === line.id)?.version).toBe(line.version)
    expect(s.journal()).toHaveLength(journaled)

    // The investor changes the pledge: promised again, the line marked, until confirmed again.
    for (const row of [claire, s.fake.table('investorPledge').get(claire.id)!]) {
      Object.assign(row, { amountEur: 50_000, version: 12 })
    }
    const changed = await s.plans.get(owner(SOPHIE), s.toCci.id)
    expect(changed.pledges).toMatchObject({ count: 1, totalEur: 50_000, confirmable: [] })
    expect(changed.lines.find((l) => l.id === line.id)?.pledge).toMatchObject({
      amountEur: 50_000,
      version: 12,
      current: false,
    })
    expect(
      await failure(
        s.plans.confirmPledge(owner(SOPHIE), s.toCci.id, line.id, {
          version: line.version,
          pledge: { id: claire.id, version: 7 },
        }),
      ),
    ).toEqual({ status: 409, message: 'FUNDING_PLAN_PLEDGE_CHANGED' })
    const again = await s.plans.confirmPledge(owner(SOPHIE), s.toCci.id, line.id, {
      version: line.version,
      pledge: { id: claire.id, version: 12 },
    })
    expect(again.pledges).toMatchObject({ count: 0, totalEur: 0 })
    const relinked = again.lines.find((l) => l.id === line.id)!
    expect(relinked).toMatchObject({ version: line.version + 1, pledge: { current: true } })

    // Released: the line stays, the pledge is promised again.
    const released = await s.plans.releasePledge(
      owner(SOPHIE),
      s.toCci.id,
      line.id,
      relinked.version,
    )
    expect(released.lines.find((l) => l.id === line.id)).toMatchObject({
      version: relinked.version + 1,
      pledge: null,
    })
    expect(released.pledges).toMatchObject({ count: 1, totalEur: 50_000 })
    expect(released.pledges.confirmable.map((c) => c.id)).toEqual([claire.id])
    expect(s.journal().map((e) => (e.metadata as { change: string }).change)).toEqual([
      'created',
      'pledge_confirmed',
      'created',
      'pledge_confirmed',
      'pledge_released',
    ])
  })

  it('shows the structure its own pledges only: a confirmed pledge it does not read stays unnamed', async () => {
    const claire = await s.pledgeOn(CLAIRE.id, 40_000)
    const jean = await s.pledgeOn(JEAN.id, 30_000)
    s.seen.owner = [read(claire, 'Claire'), read(jean, 'Jean')]
    // Only Claire showed the CCI her position.
    s.seen.workspace[CCI] = [read(claire, 'Claire (Angels)')]
    const ba = await s.category(CCI, 'business_angels_love_money')
    await confirm(owner(SOPHIE), claire, ba.id)
    await confirm(owner(SOPHIE), jean, ba.id)
    const plan = await s.plans.get(inWs(MARIE), s.toCci.id)
    expect(plan.pledges).toEqual({ count: 0, totalEur: 0, confirmable: [] })
    expect(plan.lines.map((l) => l.pledge)).toEqual(
      expect.arrayContaining([
        null,
        {
          id: claire.id,
          identity: who('Claire (Angels)'),
          amountEur: 40_000,
          version: null,
          current: true,
        },
      ]),
    )
    // The other plan of the request confirms nothing: both pledges are promised there.
    expect((await s.plans.get(owner(SOPHIE), s.toClub.id)).pledges).toMatchObject({
      count: 2,
      totalEur: 70_000,
    })
  })
})

describe('planPledges (E06.04)', () => {
  const pledge = (id: string, amountEur: number, version: number) =>
    ({ id, amountEur, version }) as AudiencePledge['pledge']
  const a = {
    pledge: pledge('a', 10, 1),
    identity: { name: 'A', organizations: [] },
    individual: true,
  }
  const b = {
    pledge: pledge('b', 20, 2),
    identity: { name: 'B', organizations: [] },
    individual: false,
  }

  it('never counts a pledge with the line confirming its current revision; any other is promised', () => {
    const lines = [{ id: 'l1' }, { id: 'l2' }]
    const links = [
      { lineId: 'l1', pledgeId: 'a', pledgeVersion: 1 },
      // A stale revision: promised again.
      { lineId: 'l2', pledgeId: 'b', pledgeVersion: 1 },
      // A line gone, a pledge gone: ignored.
      { lineId: 'gone', pledgeId: 'a', pledgeVersion: 1 },
      { lineId: 'l2', pledgeId: 'withdrawn', pledgeVersion: 1 },
    ]
    const owner = planPledges({ side: 'owner' }, lines, links, [a, b])
    expect(owner.summary).toEqual({ count: 1, totalEur: 20, confirmable: [] })
    expect(owner.onLine.get('l1')).toMatchObject({ id: 'a', current: true, version: 1 })
    // `b` is not known one by one: its line does not name it.
    expect(owner.onLine.has('l2')).toBe(false)
    const structure = planPledges({ side: 'workspace', workspaceId: 'w' }, lines, links, [a])
    expect(structure.summary).toEqual({ count: 0, totalEur: 0, confirmable: [] })
    expect(structure.onLine.get('l1')).toMatchObject({ id: 'a', version: null })
  })

  it('offers the owner the pledges known one by one that no line holds, the largest first', () => {
    const c = { ...a, pledge: pledge('c', 30, 3), identity: { name: 'C', organizations: [] } }
    const view = planPledges({ side: 'owner' }, [], [], [a, b, c])
    expect(view.summary.confirmable.map((p) => p.id)).toEqual(['c', 'a'])
    expect(view.summary).toMatchObject({ count: 3, totalEur: 60 })
    // The structure never confirms: nothing offered, even a pledge it knows one by one.
    expect(planPledges({ side: 'workspace', workspaceId: 'w' }, [], [], [a, c]).summary).toEqual({
      count: 2,
      totalEur: 40,
      confirmable: [],
    })
  })
})
