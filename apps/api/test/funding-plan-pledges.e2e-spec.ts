import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { ZodValidationPipe } from 'nestjs-zod'
import request from 'supertest'
import type { App } from 'supertest/types'
import { dossierPositionsSchema, fundingPlanSchema } from '@confluent/shared'
import { AppModule } from './../src/app.module'
import { GlobalExceptionFilter } from './../src/common/filters/global-exception.filter'
import { PrismaService } from './../src/prisma/prisma.service'
import { EMAIL_TRANSPORT } from './../src/modules/auth/email/email-transport'
import { createFakePrisma } from '../src/testing/fake-prisma'

const id = (n: number) => `7d3c1b0e-0000-4000-8000-0000000077${n.toString().padStart(2, '0')}`
// Sophie owns Biosensio, Marc owns Agrotech. Claire: investisseur of the CCI; Bob: investisseur of
// the club deal; Zoé: investisseur of the CCI, deactivated; Marie: conseillère of the CCI; Paul:
// conseiller of the club deal; Eve: an account without any share nor membership.
const SOPHIE = { id: id(1), email: 'sophie@biosensio.fr', role: 'entrepreneur' }
const MARC = { id: id(2), email: 'marc@agrotech.fr', role: 'entrepreneur' }
const CLAIRE = { id: id(3), email: 'claire@angels.fr', role: 'financeur' }
const BOB = { id: id(4), email: 'bob@banque.fr', role: 'financeur' }
const ZOE = { id: id(5), email: 'zoe@angels.fr', role: 'financeur' }
const MARIE = { id: id(6), email: 'marie@cci.fr', role: 'financeur' }
const PAUL = { id: id(7), email: 'paul@club.fr', role: 'financeur' }
const EVE = { id: id(8), email: 'eve@fonds.fr', role: 'financeur' }
const ADMIN = { id: id(9), email: 'admin@confluent.dev', role: 'admin' }
const PEOPLE = [SOPHIE, MARC, CLAIRE, BOB, ZOE, MARIE, PAUL, EVE, ADMIN]
const VERSION = id(90)
const CONFLUENT_FORM = id(91)
const SECTION = id(92)
// The profile's questions, one per level; the sector is computed from the partial one.
const NAME_FIELD = id(93)
const SECTOR_FIELD = id(94)
const FINANCE_FIELD = id(95)

const valid = <T>(schema: { safeParse: (v: unknown) => { error?: { issues: T[] } } }, v: unknown) =>
  expect(schema.safeParse(v).error?.issues ?? []).toEqual([])

// ROADMAP E06.04 over HTTP on the stateful fake Prisma: a candidature's plan shows each side the
// pledges it may read — the owner those of the investors who read the request, the structure only
// those shown to it —, apart from the totals; the owner confirms a pledge they know one by one into a
// line, after which the plan counts that line and not the pledge, until the investor changes it; the
// structure's routes cannot confirm, and nothing else changes for the other views.
describe('Funding plan pledges (e2e)', () => {
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
    await p.questionnaireSection.create({
      data: { id: SECTION, versionId: VERSION, key: 'identite', title: 'Identité', orderIndex: 0 },
    })
    for (const [i, f] of [
      { id: NAME_FIELD, key: 'nom', label: 'Nom', minAccessLevel: 'public' },
      { id: SECTOR_FIELD, key: 'secteur_activite', label: 'Secteur', minAccessLevel: 'partiel' },
      { id: FINANCE_FIELD, key: 'chiffre', label: 'Chiffre', minAccessLevel: 'complet' },
    ].entries()) {
      await p.questionnaireField.create({
        data: { ...f, fieldType: 'text', orderIndex: i, sectionId: SECTION, versionId: VERSION },
      })
    }
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
    const invite = async (workspaceId: string, body: object) =>
      (await admin.post(`/v1/admin/workspaces/${workspaceId}/members`, body).expect(201)).body
    await invite(cci, { email: MARIE.email, role: 'conseiller', canManageWorkspace: true })
    await invite(cci, {
      email: CLAIRE.email,
      role: 'investisseur',
      organization: 'Angels Touraine',
    })
    await invite(club, { email: PAUL.email, role: 'conseiller', canManageWorkspace: true })
    await invite(club, { email: BOB.email, role: 'investisseur' })
    // Claire reads the club deal's pool too, without showing it her position.
    await invite(club, { email: CLAIRE.email, role: 'investisseur' })
    for (const workspaceId of [cci, club]) {
      const form = await p.questionnaire.create({
        data: {
          slug: `form-${workspaceId}`,
          name: 'Formulaire',
          workspaceId,
          usage: 'candidature',
        },
      })
      await p.questionnaireVersion.create({
        data: { questionnaireId: form.id, version: 1, status: 'published' },
      })
    }
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
  const sophie = as(SOPHIE)
  const marc = as(MARC)

  // A request of `owner`, its profile answered at each level and classified from the partial
  // question, presented (published or not) and sent to the given workspaces.
  async function request_(
    owner: typeof sophie,
    name: string,
    opts: { publish?: boolean; workspaces?: string[]; amountEur?: number; types?: string[] } = {},
  ) {
    const dossier = (await owner.post('/v1/dossiers', { name }).expect(201)).body
    const row = fake.table('dossier').get(dossier.id)!
    Object.assign(row, {
      submittedAt: new Date(),
      summary: `Résumé de ${name} : capteurs pour l’énergie.`,
      objective: 'Industrialiser',
      amountEur: opts.amountEur ?? 300_000,
      financingTypes: opts.types ?? ['equity'],
      sector: `Secteur de ${name}`,
      classificationSources: { sector: ['secteur_activite'] },
    })
    for (const [fieldId, value] of [
      [NAME_FIELD, `NOM-${name}`],
      [SECTOR_FIELD, `SECTEUR-${name}`],
      [FINANCE_FIELD, `CHIFFRE-SECRET-${name}`],
    ]) {
      await fake.prisma.dossierAnswer.create({
        data: { companyId: row.companyId, fieldId, value },
      })
    }
    if (opts.publish !== false) await owner.post(`/v1/dossiers/${dossier.id}/publish`).expect(200)
    const candidatures: Record<string, string> = {}
    for (const workspaceId of opts.workspaces ?? []) {
      const created = (
        await owner.post(`/v1/dossiers/${dossier.id}/candidatures`, { workspaceId }).expect(201)
      ).body
      await owner.post(`/v1/candidatures/${created.id}/submit`).expect(200)
      candidatures[workspaceId] = created.id
    }
    return { id: dossier.id as string, candidatures }
  }
  const share = async (owner: typeof sophie, dossierId: string, email: string, level: string) =>
    (
      await owner
        .post(`/v1/dossiers/${dossierId}/shares`, { recipientEmail: email, accessLevel: level })
        .expect(201)
    ).body as { id: string; token: string }
  const toPool = (owner: typeof sophie, candidatureId: string, accessLevel: string) =>
    owner
      .put(`/v1/candidatures/${candidatureId}/pool-publication`, { accessLevel, consent: true })
      .expect(200)

  // Biosensio: in the CCI's pool (partial) and the club deal's (complete), shared with Claire
  // (public): Bob reads it through the club deal's pool only. Agrotech: a draft shared with Claire
  // (public).

  // Biosensio (objective 100 000 €): in the CCI's pool and the club deal's, shared with Claire. Claire
  // (CCI investor, Angels Touraine) pledges 40 000 € showing name and amount, and shows her position
  // to the CCI; Bob (club deal investor) pledges 25 000 € showing nothing, to nobody.
  async function world() {
    const bio = await request_(sophie, 'Biosensio', { workspaces: [cci, club], amountEur: 100_000 })
    await toPool(sophie, bio.candidatures[cci], 'partiel')
    await toPool(sophie, bio.candidatures[club], 'complet')
    await share(sophie, bio.id, CLAIRE.email, 'public')
    const row = [...fake.table('user').values()].find((u) => u.email === CLAIRE.email)!
    Object.assign(row, { firstName: 'Claire', lastName: 'Martin' })
    const claire = await pledge(CLAIRE, bio.id, {
      amountEur: 40_000,
      showName: true,
      showAmount: true,
    })
    await pledge(BOB, bio.id, { amountEur: 25_000 })
    await as(CLAIRE)
      .put(`/v1/opportunities/${bio.id}/structures/${cci}`, { consent: true })
      .expect(200)
    const ba = [...fake.table('fundingSourceCategory').values()].find(
      (c) => c.workspaceId === cci && c.key === 'business_angels_love_money',
    )!
    return { bio, claire, ba: ba.id as string }
  }
  const BASE = { intention: 'likely', amountEur: 25_000, showName: false, showAmount: false }
  const pledge = async (u: { id: string }, dossierId: string, body: object = {}) =>
    (
      await as(u)
        .put(`/v1/opportunities/${dossierId}/pledge`, { ...BASE, version: null, ...body })
        .expect(200)
    ).body as { amountEur: number; version: number }
  const CHANGED = 'Cette promesse a changé, a été retirée ou ne vous est plus montrée'
  const ownerPlan = (candidatureId: string) => `/v1/candidatures/${candidatureId}/funding-plan`
  const structurePlan = (workspaceId: string, candidatureId: string) =>
    `/v1/workspaces/${workspaceId}/candidatures/${candidatureId}/funding-plan`
  type Plan = {
    lines: Array<{
      id: string
      version: number
      amountEur: number
      pledge: {
        id: string
        identity: { name: string | null; organizations: string[] }
        amountEur: number
        version: number | null
        current: boolean
      } | null
    }>
    totals: { obtainedEur: number; remainingEur: number | null }
    pledges: {
      count: number
      totalEur: number
      confirmable: Array<{ id: string; amountEur: number; version: number | null }>
    }
  }
  const read = async (u: { id: string }, url: string) => {
    const body = (await as(u).get(url).expect(200)).body
    valid(fundingPlanSchema, body)
    return body as Plan
  }

  it('shows each side its own pledges apart, and counts a confirmed one as its line only', async () => {
    const { bio, claire, ba } = await world()
    const toCci = bio.candidatures[cci]
    const owner0 = await read(SOPHIE, ownerPlan(toCci))
    expect(owner0.pledges).toEqual({
      count: 2,
      totalEur: 65_000,
      confirmable: [
        {
          id: expect.any(String),
          identity: { name: 'Claire Martin', organizations: ['Angels Touraine'] },
          amountEur: 40_000,
          version: claire.version,
        },
      ],
    })
    // The CCI reads Claire's pledge only (her consent); the club deal reads none — Bob gave no
    // consent, Claire gave hers to the CCI only.
    expect((await read(MARIE, structurePlan(cci, toCci))).pledges).toEqual({
      count: 1,
      totalEur: 40_000,
      confirmable: [],
    })
    expect((await read(PAUL, structurePlan(club, bio.candidatures[club]))).pledges).toEqual({
      count: 0,
      totalEur: 0,
      confirmable: [],
    })

    const pledgeId = owner0.pledges.confirmable[0].id
    const confirmed = (
      await sophie
        .post(`${ownerPlan(toCci)}/lines`, {
          categoryId: ba,
          amountEur: 40_000,
          state: 'obtained',
          pledge: { id: pledgeId, version: claire.version },
        })
        .expect(201)
    ).body as Plan
    valid(fundingPlanSchema, confirmed)
    expect(confirmed.totals).toMatchObject({ obtainedEur: 40_000, remainingEur: 60_000 })
    expect(confirmed.pledges).toEqual({ count: 1, totalEur: 25_000, confirmable: [] })
    expect(confirmed.lines[0].pledge).toMatchObject({ id: pledgeId, current: true })

    // The structure sees the line confirm the pledge Claire shows it, never its revision.
    const byCci = await read(MARIE, structurePlan(cci, toCci))
    expect(byCci.pledges).toEqual({ count: 0, totalEur: 0, confirmable: [] })
    expect(byCci.lines[0].pledge).toEqual({
      id: pledgeId,
      identity: { name: 'Claire Martin', organizations: ['Angels Touraine'] },
      amountEur: 40_000,
      version: null,
      current: true,
    })
    // The club deal's plan is another plan: nothing confirmed there.
    expect((await read(SOPHIE, ownerPlan(bio.candidatures[club]))).pledges.count).toBe(2)
    // The owner's positions are unchanged: the pledges are still the investors'.
    const positions = (await sophie.get(`/v1/dossiers/${bio.id}/positions`).expect(200)).body
    valid(dossierPositionsSchema, positions)
    expect(positions.pledges).toEqual({ count: 2, totalEur: 65_000 })
  })

  it('counts a pledge changed after its confirmation as promised again, until confirmed again', async () => {
    const { bio, claire, ba } = await world()
    const toCci = bio.candidatures[cci]
    const pledgeId = (await read(SOPHIE, ownerPlan(toCci))).pledges.confirmable[0].id
    const [line] = (
      await sophie
        .post(`${ownerPlan(toCci)}/lines`, {
          categoryId: ba,
          amountEur: 40_000,
          state: 'requested',
          pledge: { id: pledgeId, version: claire.version },
        })
        .expect(201)
    ).body.lines as Plan['lines']

    const changed = await pledge(CLAIRE, bio.id, {
      amountEur: 50_000,
      showName: true,
      showAmount: true,
      version: claire.version,
    })
    const stale = await read(SOPHIE, ownerPlan(toCci))
    expect(stale.pledges).toMatchObject({ count: 2, totalEur: 75_000, confirmable: [] })
    expect(stale.lines[0].pledge).toMatchObject({ amountEur: 50_000, current: false })
    // From the revision confirmed before: refused; from the new one: confirmed again.
    await sophie
      .put(`${ownerPlan(toCci)}/lines/${line.id}/pledge`, {
        version: line.version,
        pledge: { id: pledgeId, version: claire.version },
      })
      .expect(409)
      .expect((res) => expect(res.body.error.message).toContain(CHANGED))
    const again = (
      await sophie
        .put(`${ownerPlan(toCci)}/lines/${line.id}/pledge`, {
          version: line.version,
          pledge: { id: pledgeId, version: changed.version },
        })
        .expect(200)
    ).body as Plan
    expect(again.pledges).toMatchObject({ count: 1, totalEur: 25_000 })
    expect(again.lines[0]).toMatchObject({ version: line.version + 1, pledge: { current: true } })

    // Claire hides her amount from the owner: the owner no longer knows that pledge one by one —
    // the line stops naming it and it is promised again, as in the owner's own total.
    await pledge(CLAIRE, bio.id, {
      amountEur: 50_000,
      showName: true,
      showAmount: false,
      version: changed.version,
    })
    const hidden = await read(SOPHIE, ownerPlan(toCci))
    expect(hidden.lines[0].pledge).toBeNull()
    expect(hidden.pledges).toEqual({ count: 2, totalEur: 75_000, confirmable: [] })
    // The CCI still reads it (her consent covers the amount): the line names it, changed.
    expect((await read(MARIE, structurePlan(cci, toCci))).lines[0].pledge).toMatchObject({
      amountEur: 50_000,
      current: false,
    })

    // Released by the owner: the line stays, with no pledge.
    const released = (
      await sophie
        .delete(`${ownerPlan(toCci)}/lines/${line.id}/pledge?version=${again.lines[0].version}`)
        .expect(200)
    ).body as Plan
    expect(released.lines).toEqual([expect.objectContaining({ id: line.id, pledge: null })])
  })

  it('keeps confirming to the owner’s routes, from a pledge they know, on a line in progress or obtained', async () => {
    const { bio, claire, ba } = await world()
    const toCci = bio.candidatures[cci]
    const owner0 = await read(SOPHIE, ownerPlan(toCci))
    const pledgeId = owner0.pledges.confirmable[0].id
    const line = { categoryId: ba, amountEur: 40_000, state: 'obtained' }
    const ref = { id: pledgeId, version: claire.version }
    // The structure's contract has no pledge.
    await as(MARIE)
      .post(`${structurePlan(cci, toCci)}/lines`, { ...line, pledge: ref })
      .expect(400)
    await as(MARIE)
      .put(`${structurePlan(cci, toCci)}/lines/x/pledge`, {})
      .expect(404)
    // Bob's pledge shows neither name nor amount: the owner cannot confirm it — the same answer as
    // for an unknown pledge.
    const bob = [...fake.table('investorPledge').values()].find((p) => p.investorId === BOB.id)!
    for (const id of [bob.id as string, '7d3c1b0e-0000-4000-8000-000000009999']) {
      await sophie
        .post(`${ownerPlan(toCci)}/lines`, { ...line, pledge: { id, version: bob.version } })
        .expect(409)
        .expect((res) => expect(res.body.error.message).toContain(CHANGED))
    }
    await sophie
      .post(`${ownerPlan(toCci)}/lines`, { ...line, state: 'planned', pledge: ref })
      .expect(400)
    // Another account's candidature: the candidatures' 404.
    await marc.post(`${ownerPlan(toCci)}/lines`, { ...line, pledge: ref }).expect(404)
    // Two lines for one pledge: the second refused.
    await sophie.post(`${ownerPlan(toCci)}/lines`, { ...line, pledge: ref }).expect(201)
    await sophie
      .post(`${ownerPlan(toCci)}/lines`, { ...line, pledge: ref })
      .expect(409)
      .expect((res) => expect(res.body.error.message).toContain('déjà confirmée'))
    expect((await read(SOPHIE, ownerPlan(toCci))).lines).toHaveLength(1)
    // The pledge withdrawn: the line stays, confirming nothing.
    await as(CLAIRE).delete(`/v1/opportunities/${bio.id}/pledge`).expect(204)
    const after = await read(SOPHIE, ownerPlan(toCci))
    expect(after.lines).toEqual([expect.objectContaining({ amountEur: 40_000, pledge: null })])
    expect(after.pledges).toEqual({ count: 1, totalEur: 25_000, confirmable: [] })
  })
})
