import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { ZodValidationPipe } from 'nestjs-zod'
import request from 'supertest'
import type { App } from 'supertest/types'
import { fundingPlanSchema } from '@confluent/shared'
import { AppModule } from './../src/app.module'
import { GlobalExceptionFilter } from './../src/common/filters/global-exception.filter'
import { PrismaService } from './../src/prisma/prisma.service'
import { EMAIL_TRANSPORT } from './../src/modules/auth/email/email-transport'
import { createFakePrisma } from '../src/testing/fake-prisma'

const user = (n: number, email: string, role: string) => ({
  id: `7d3c1b0e-0000-4000-8000-0000000011${n.toString().padStart(2, '0')}`,
  email,
  role,
})
// Marie: manager of the CCI; Jean: conseiller of the CCI without the right to manage it; Claire:
// investisseur of the CCI; Paul: manager of the club deal. Sophie and Marc: entrepreneurs. Bob:
// recipient of a share of Sophie's request.
const MARIE = user(1, 'marie@cci.fr', 'financeur')
const JEAN = user(2, 'jean@cci.fr', 'financeur')
const CLAIRE = user(3, 'claire@angels.fr', 'financeur')
const PAUL = user(4, 'paul@club.fr', 'financeur')
const SOPHIE = user(5, 'sophie@biosensio.fr', 'entrepreneur')
const MARC = user(6, 'marc@agrotech.fr', 'entrepreneur')
const BOB = user(7, 'bob@banque.fr', 'financeur')
const ADMIN = user(8, 'admin@confluent.dev', 'admin')
const PEOPLE = [MARIE, JEAN, CLAIRE, PAUL, SOPHIE, MARC, BOB, ADMIN]
const VERSION = '7d3c1b0e-0000-4000-8000-0000000011f1'
const CONFLUENT_FORM = '7d3c1b0e-0000-4000-8000-0000000011f2'

const valid = (v: unknown) => expect(fundingPlanSchema.safeParse(v).error?.issues ?? []).toEqual([])

// ROADMAP E06.03 over HTTP on the stateful fake Prisma: a request's financing plan in each workspace
// it is presented to, kept by its owner and that workspace's conseillers, with the totals computed
// against the request's amount sought; no other workspace, investor or share recipient reads it.
describe('Financing plans (e2e)', () => {
  let app: INestApplication<App>
  let fake: ReturnType<typeof createFakePrisma>
  const tokens: Record<string, string> = {}
  let cci: string
  let club: string

  beforeEach(async () => {
    fake = createFakePrisma()
    const p = fake.prisma
    for (const u of PEOPLE) await p.user.create({ data: { ...u, emailVerifiedAt: new Date() } })
    await p.questionnaire.create({
      data: { id: CONFLUENT_FORM, slug: 'dossier', name: 'Profil', usage: 'dossier' },
    })
    await p.questionnaireVersion.create({
      data: { id: VERSION, questionnaireId: CONFLUENT_FORM, version: 1, status: 'published' },
    })
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(p)
      .overrideProvider(EMAIL_TRANSPORT)
      .useValue({
        sendMagicLink: jest.fn(),
        sendShareInvite: jest.fn().mockResolvedValue(undefined),
        sendWorkspaceInvite: jest.fn().mockResolvedValue(undefined),
      })
      .compile()
    app = moduleFixture.createNestApplication()
    app.setGlobalPrefix('v1', { exclude: ['/'] })
    app.useGlobalPipes(new ZodValidationPipe())
    app.useGlobalFilters(new GlobalExceptionFilter())
    await app.init()
    for (const u of PEOPLE) {
      tokens[u.id] = await new JwtService().signAsync(
        { sub: u.id, email: u.email, role: u.role },
        { secret: process.env.JWT_SECRET },
      )
    }
    const admin = as(ADMIN)
    cci = (await admin.post('/v1/admin/workspaces', { name: 'CCI Touraine' }).expect(201)).body.id
    club = (await admin.post('/v1/admin/workspaces', { name: 'Club deal' }).expect(201)).body.id
    const invite = (workspaceId: string, body: object) =>
      admin.post(`/v1/admin/workspaces/${workspaceId}/members`, body).expect(201)
    await invite(cci, { email: MARIE.email, role: 'conseiller', canManageWorkspace: true })
    await invite(cci, { email: JEAN.email, role: 'conseiller' })
    await invite(cci, { email: CLAIRE.email, role: 'investisseur' })
    await invite(club, { email: PAUL.email, role: 'conseiller', canManageWorkspace: true })
  })

  afterEach(async () => {
    await app.close()
  })

  const auth = (u: { id: string }) => `Bearer ${tokens[u.id]}`
  const as = (u: { id: string }) => ({
    get: (url: string) => request(app.getHttpServer()).get(url).set('Authorization', auth(u)),
    post: (url: string, body?: object) =>
      request(app.getHttpServer()).post(url).set('Authorization', auth(u)).send(body),
    put: (url: string, body: object) =>
      request(app.getHttpServer()).put(url).set('Authorization', auth(u)).send(body),
    patch: (url: string, body: object) =>
      request(app.getHttpServer()).patch(url).set('Authorization', auth(u)).send(body),
    delete: (url: string) => request(app.getHttpServer()).delete(url).set('Authorization', auth(u)),
  })

  // A published complementary form, one optional question, assigned to the workspace's candidatures.
  async function openToCandidatures(designer: { id: string }, workspaceId: string) {
    const d = as(designer)
    const forms = `/v1/admin/workspaces/${workspaceId}/forms`
    const form = (await d.post(forms, { name: 'Candidature' }).expect(201)).body
    const section = (
      await d.post(`${forms}/${form.id}/draft/sections`, { title: 'Candidature' }).expect(201)
    ).body.sections[0]
    await d
      .post(`${forms}/${form.id}/draft/fields`, {
        sectionId: section.id,
        label: 'Commentaire',
        fieldType: 'textarea',
        required: false,
      })
      .expect(201)
    await d.post(`${forms}/${form.id}/draft/publish`).expect(200)
    await d.put(`${forms}/${form.id}/usage`, { usage: 'candidature' }).expect(200)
  }

  // Sophie's request (200 000 € sought) presented to both workspaces; the CCI's candidature sent.
  async function presented() {
    await openToCandidatures(MARIE, cci)
    await openToCandidatures(PAUL, club)
    const sophie = as(SOPHIE)
    const dossier = (await sophie.post('/v1/dossiers', { name: 'Biosensio' }).expect(201)).body
    await sophie.patch(`/v1/dossiers/${dossier.id}`, { amountEur: 200_000 }).expect(200)
    const candidaturesOf = `/v1/dossiers/${dossier.id}/candidatures`
    const toCci = (await sophie.post(candidaturesOf, { workspaceId: cci }).expect(201)).body
    const toClub = (await sophie.post(candidaturesOf, { workspaceId: club }).expect(201)).body
    return { dossier, toCci: toCci.id as string, toClub: toClub.id as string }
  }

  const ownPlan = (candidatureId: string) => `/v1/candidatures/${candidatureId}/funding-plan`
  const wsPlan = (workspaceId: string, candidatureId: string) =>
    `/v1/workspaces/${workspaceId}/candidatures/${candidatureId}/funding-plan`
  const idOf = (plan: { categories: Array<{ id: string; key: string }> }, key: string) =>
    plan.categories.find((c) => c.key === key)!.id

  it('lets the owner and the workspace’s conseillers keep the plan, with totals against the amount sought', async () => {
    const { dossier, toCci } = await presented()
    const sophie = as(SOPHIE)

    // The owner prepares the plan of a draft candidature; the CCI sees nothing yet.
    const empty = (await sophie.get(ownPlan(toCci)).expect(200)).body
    valid(empty)
    expect(empty).toMatchObject({
      candidatureId: toCci,
      workspaceId: cci,
      lines: [],
      totals: {
        objectiveEur: 200_000,
        obtainedEur: 0,
        remainingEur: 200_000,
        uncoveredEur: 200_000,
        obtainedPercent: 0,
      },
    })
    expect(empty.categories.map((c: { key: string }) => c.key)).toEqual([
      'bpifrance',
      'pret_honneur',
      'pret_bancaire',
      'business_angels_love_money',
      'fonds_investissement',
      'fonds_propres',
    ])
    const bpi = idOf(empty, 'bpifrance')
    const bank = idOf(empty, 'pret_bancaire')
    const ba = idOf(empty, 'business_angels_love_money')
    await sophie
      .post(`${ownPlan(toCci)}/lines`, { categoryId: bpi, amountEur: 50_000, state: 'obtained' })
      .expect(201)
    const withBank = (
      await sophie
        .post(`${ownPlan(toCci)}/lines`, {
          categoryId: bank,
          amountEur: 80_000,
          state: 'requested',
          label: '  BNP   Tours ',
        })
        .expect(201)
    ).body
    valid(withBank)
    expect(withBank.lines.map((l: { label: string | null }) => l.label)).toEqual([
      null,
      'BNP Tours',
    ])
    await as(MARIE).get(wsPlan(cci, toCci)).expect(404)
    await as(MARIE)
      .post(`${wsPlan(cci, toCci)}/lines`, { categoryId: ba, amountEur: 1, state: 'planned' })
      .expect(404)

    // Sent: Jean (conseiller without the right to manage) adds a line, Marie records the loan.
    await sophie.post(`/v1/dossiers/${dossier.id}/submit`).expect(200)
    await sophie.post(`/v1/candidatures/${toCci}/submit`).expect(200)
    const read = (await as(JEAN).get(wsPlan(cci, toCci)).expect(200)).body
    valid(read)
    expect(read.lines).toHaveLength(2)
    await as(JEAN)
      .post(`${wsPlan(cci, toCci)}/lines`, { categoryId: ba, amountEur: 30_000, state: 'planned' })
      .expect(201)
    const loan = withBank.lines[1]
    const granted = (
      await as(MARIE)
        .patch(`${wsPlan(cci, toCci)}/lines/${loan.id}`, {
          version: loan.version,
          state: 'obtained',
        })
        .expect(200)
    ).body
    expect(granted.lines.find((l: { id: string }) => l.id === loan.id)).toMatchObject({
      state: 'obtained',
      version: 2,
      updatedBy: 'workspace',
    })
    expect(granted.totals).toEqual({
      objectiveEur: 200_000,
      obtainedEur: 130_000,
      requestedEur: 0,
      plannedEur: 30_000,
      refusedEur: 0,
      remainingEur: 70_000,
      uncoveredEur: 40_000,
      beyondObjectiveEur: 0,
      obtainedPercent: 65,
    })

    // The owner edits from a stale screen: refused, not written over Marie's change.
    const stale = await sophie
      .patch(`${ownPlan(toCci)}/lines/${loan.id}`, { version: 1, amountEur: 90_000 })
      .expect(409)
    expect(stale.body.error).toMatchObject({
      message: expect.stringMatching(/modifiée entre-temps/),
      details: { currentVersion: 2 },
    })
    // The owner reads the same plan: which side wrote each line, never who.
    const mine = (await sophie.get(ownPlan(toCci)).expect(200)).body
    expect(mine.lines.map((l: { updatedBy: string }) => l.updatedBy)).toEqual([
      'owner',
      'workspace',
      'workspace',
    ])
    expect(JSON.stringify(mine)).not.toMatch(/marie@|jean@|7d3c1b0e-0000-4000-8000-00000000110[12]/)

    // Nothing sent unchanged writes nothing; a line is deleted from the version seen.
    const same = (
      await sophie
        .patch(`${ownPlan(toCci)}/lines/${loan.id}`, { version: 2, amountEur: 80_000 })
        .expect(200)
    ).body
    expect(same.lines[1].version).toBe(2)
    const planned = mine.lines[2]
    await sophie.delete(`${ownPlan(toCci)}/lines/${planned.id}?version=7`).expect(409)
    await sophie.delete(`${ownPlan(toCci)}/lines/${planned.id}`).expect(400)
    const afterDelete = (
      await sophie.delete(`${ownPlan(toCci)}/lines/${planned.id}?version=1`).expect(200)
    ).body
    expect(afterDelete.lines).toHaveLength(2)
    await sophie.delete(`${ownPlan(toCci)}/lines/${planned.id}?version=1`).expect(404)

    // Over the objective: obtained beyond it is told apart; the administrator acts as the workspace.
    const over = (
      await as(ADMIN)
        .post(`${wsPlan(cci, toCci)}/lines`, {
          categoryId: idOf(mine, 'fonds_propres'),
          amountEur: 100_000,
          state: 'obtained',
        })
        .expect(201)
    ).body
    expect(over.totals).toMatchObject({
      obtainedEur: 230_000,
      remainingEur: 0,
      uncoveredEur: 0,
      beyondObjectiveEur: 30_000,
      obtainedPercent: 115,
    })

    // Without an amount sought, no objective: the totals say so instead of inventing one.
    await sophie.patch(`/v1/dossiers/${dossier.id}`, { amountEur: null }).expect(200)
    expect((await sophie.get(ownPlan(toCci)).expect(200)).body.totals).toMatchObject({
      objectiveEur: null,
      obtainedEur: 230_000,
      remainingEur: null,
      uncoveredEur: null,
      beyondObjectiveEur: 0,
      obtainedPercent: null,
    })

    // Each change is journaled with its side and author.
    const journal = [...fake.table('auditLog').values()].filter(
      (e) => e.actionType === 'funding_plan_updated',
    )
    expect(
      journal.map((e) => [
        (e.metadata as { change: string }).change,
        (e.metadata as { side: string }).side,
        e.actorId,
      ]),
    ).toEqual([
      ['created', 'owner', SOPHIE.id],
      ['created', 'owner', SOPHIE.id],
      ['created', 'workspace', JEAN.id],
      ['updated', 'workspace', MARIE.id],
      ['deleted', 'owner', SOPHIE.id],
      ['created', 'workspace', ADMIN.id],
    ])
    expect(journal.every((e) => e.dossierId === dossier.id)).toBe(true)
  })

  it('refuses malformed lines and categories that are not the workspace’s or no longer offered', async () => {
    const { toCci, toClub } = await presented()
    const sophie = as(SOPHIE)
    const plan = (await sophie.get(ownPlan(toCci)).expect(200)).body
    const bpi = idOf(plan, 'bpifrance')
    const lines = `${ownPlan(toCci)}/lines`
    for (const body of [
      { categoryId: bpi, amountEur: 0, state: 'planned' },
      { categoryId: bpi, amountEur: 10.5, state: 'planned' },
      { categoryId: bpi, amountEur: 1_000_000_001, state: 'planned' },
      { categoryId: bpi, amountEur: '1000', state: 'planned' },
      { categoryId: bpi, amountEur: 1000, state: 'promised' },
      { categoryId: bpi, amountEur: 1000 },
      { categoryId: 'bpifrance', amountEur: 1000, state: 'planned' },
      { categoryId: bpi, amountEur: 1000, state: 'planned', label: 'x'.repeat(121) },
      { categoryId: bpi, amountEur: 1000, state: 'planned', workspaceId: club },
    ]) {
      await sophie.post(lines, body).expect(400)
    }
    // A category of another workspace: the same 400 as an unknown one.
    const clubPlan = (await sophie.get(ownPlan(toClub)).expect(200)).body
    const foreign = await sophie
      .post(lines, { categoryId: idOf(clubPlan, 'bpifrance'), amountEur: 1000, state: 'planned' })
      .expect(400)
    expect(foreign.body.error.message).toBe(
      'Choisissez une des sources proposées par la structure.',
    )
    await sophie
      .post(lines, {
        categoryId: '7d3c1b0e-0000-4000-8000-0000000011ff',
        amountEur: 1000,
        state: 'planned',
      })
      .expect(400)

    // A line on a category the CCI then deactivates stays, readable; no new line takes it.
    const created = (
      await sophie.post(lines, { categoryId: bpi, amountEur: 1000, state: 'planned' }).expect(201)
    ).body
    const line = created.lines[0]
    await as(MARIE)
      .patch(`/v1/admin/workspaces/${cci}/funding-source-categories/${bpi}`, { active: false })
      .expect(200)
    const after = (await sophie.get(ownPlan(toCci)).expect(200)).body
    expect(after.lines[0].category).toMatchObject({ id: bpi, active: false, label: 'Bpifrance' })
    expect(after.categories.map((c: { key: string }) => c.key)).not.toContain('bpifrance')
    const inactive = await sophie
      .post(lines, { categoryId: bpi, amountEur: 1000, state: 'planned' })
      .expect(409)
    expect(inactive.body.error.message).toMatch(/n’est plus proposée/)
    // Still editable on it; moved elsewhere, it cannot come back.
    await sophie.patch(`${lines}/${line.id}`, { version: 1, amountEur: 2000 }).expect(200)
    await sophie
      .patch(`${lines}/${line.id}`, { version: 2, categoryId: idOf(after, 'pret_honneur') })
      .expect(200)
    await sophie.patch(`${lines}/${line.id}`, { version: 3, categoryId: bpi }).expect(409)
    // Updates: something must change, version required, nothing else accepted.
    for (const body of [
      { version: 3 },
      { amountEur: 5 },
      { version: 0, amountEur: 5 },
      { version: 3, amountEur: 5, updatedBy: 'workspace' },
    ]) {
      await sophie.patch(`${lines}/${line.id}`, body).expect(400)
    }
    // A detail cleared with null.
    const labelled = (
      await sophie.patch(`${lines}/${line.id}`, { version: 3, label: 'Région' }).expect(200)
    ).body
    expect(labelled.lines[0].label).toBe('Région')
    const cleared = (
      await sophie.patch(`${lines}/${line.id}`, { version: 4, label: null }).expect(200)
    ).body
    expect(cleared.lines[0]).toMatchObject({ label: null, version: 5 })
  })

  it('keeps each workspace’s plan to its parties: no other workspace, investor, account or share recipient', async () => {
    const { dossier, toCci, toClub } = await presented()
    const sophie = as(SOPHIE)
    await sophie.post(`/v1/dossiers/${dossier.id}/submit`).expect(200)
    await sophie.post(`/v1/candidatures/${toCci}/submit`).expect(200)
    await sophie.post(`/v1/candidatures/${toClub}/submit`).expect(200)
    const cciPlan = (await sophie.get(ownPlan(toCci)).expect(200)).body
    const added = (
      await sophie
        .post(`${ownPlan(toCci)}/lines`, {
          categoryId: idOf(cciPlan, 'pret_honneur'),
          amountEur: 42_424,
          state: 'obtained',
          label: 'Initiative Touraine',
        })
        .expect(201)
    ).body
    const lineId = added.lines[0].id
    const body = { categoryId: idOf(cciPlan, 'bpifrance'), amountEur: 1, state: 'planned' }

    // The club keeps its own plan, empty, and never reaches the CCI's.
    const clubPlan = (await as(PAUL).get(wsPlan(club, toClub)).expect(200)).body
    expect(clubPlan).toMatchObject({ lines: [], totals: { obtainedEur: 0 } })
    await as(PAUL).get(wsPlan(club, toCci)).expect(404)
    await as(PAUL).get(wsPlan(cci, toCci)).expect(404)
    await as(PAUL)
      .post(`${wsPlan(club, toCci)}/lines`, body)
      .expect(404)
    await as(PAUL)
      .patch(`${wsPlan(club, toCci)}/lines/${lineId}`, { version: 1, amountEur: 1 })
      .expect(404)
    // A line of the CCI's plan is unknown through the club's candidature, even to the owner.
    await sophie
      .patch(`${ownPlan(toClub)}/lines/${lineId}`, { version: 1, amountEur: 1 })
      .expect(404)
    await sophie.delete(`${ownPlan(toClub)}/lines/${lineId}?version=1`).expect(404)

    // An investisseur of the CCI: 403; another entrepreneur, the owner on the workspace side, a
    // share recipient: 404.
    await as(CLAIRE).get(wsPlan(cci, toCci)).expect(403)
    await as(CLAIRE)
      .post(`${wsPlan(cci, toCci)}/lines`, body)
      .expect(403)
    for (const outsider of [MARC, SOPHIE, BOB]) {
      await as(outsider).get(wsPlan(cci, toCci)).expect(404)
    }
    for (const outsider of [MARC, BOB, MARIE, PAUL]) {
      await as(outsider).get(ownPlan(toCci)).expect(404)
      await as(outsider)
        .post(`${ownPlan(toCci)}/lines`, body)
        .expect(404)
    }
    const token = (
      await sophie
        .post(`/v1/dossiers/${dossier.id}/shares`, {
          recipientEmail: BOB.email,
          accessLevel: 'complet',
        })
        .expect(201)
    ).body.token as string
    for (const read of [
      (await as(BOB).get(`/v1/shares/${token}`).expect(200)).body,
      (await as(BOB).get(`/v1/dossiers/${dossier.id}`).expect(200)).body,
      (await as(BOB).get('/v1/dossiers').expect(200)).body,
      (await as(PAUL).get(`/v1/workspaces/${club}/candidatures/${toClub}`).expect(200)).body,
      (await as(PAUL).get(`/v1/workspaces/${club}/candidatures`).expect(200)).body,
    ]) {
      expect(JSON.stringify(read)).not.toMatch(
        /[:"]42424\b|Initiative Touraine|fundingPlan|planLines/,
      )
    }
    // Nothing was written by the refused calls.
    expect(fake.table('fundingPlanLine').size).toBe(1)
  })
})
