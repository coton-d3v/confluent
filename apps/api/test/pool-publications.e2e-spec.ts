import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { ZodValidationPipe } from 'nestjs-zod'
import request from 'supertest'
import type { App } from 'supertest/types'
import {
  candidatureSchema,
  candidatureSummarySchema,
  financeurShareResponseSchema,
  portfolioSchema,
  receivedCandidatureListItemSchema,
  receivedCandidatureSchema,
  shareAccessSchema,
} from '@confluent/shared'
import { AppModule } from './../src/app.module'
import { GlobalExceptionFilter } from './../src/common/filters/global-exception.filter'
import { PrismaService } from './../src/prisma/prisma.service'
import { EMAIL_TRANSPORT } from './../src/modules/auth/email/email-transport'
import { createFakePrisma } from '../src/testing/fake-prisma'

const id = (n: number) => `7d3c1b0e-0000-4000-8000-0000000007${n.toString().padStart(2, '0')}`
// Sophie owns Biosensio; Marc is another entrepreneur. Marie: conseillère of the CCI; Claire:
// investisseur of the CCI; Paul: conseiller of the club deal; Bob: recipient of a share.
const SOPHIE = { id: id(1), email: 'sophie@biosensio.fr', role: 'entrepreneur' }
const MARC = { id: id(2), email: 'marc@agrotech.fr', role: 'entrepreneur' }
const MARIE = { id: id(3), email: 'marie@cci.fr', role: 'financeur' }
const CLAIRE = { id: id(4), email: 'claire@angels.fr', role: 'financeur' }
const PAUL = { id: id(5), email: 'paul@club.fr', role: 'financeur' }
const BOB = { id: id(6), email: 'bob@banque.fr', role: 'financeur' }
const ADMIN = { id: id(7), email: 'admin@confluent.dev', role: 'admin' }
const PEOPLE = [SOPHIE, MARC, MARIE, CLAIRE, PAUL, BOB, ADMIN]
const VERSION = id(90)
const CONFLUENT_FORM = id(91)

const valid = <T>(schema: { safeParse: (v: unknown) => { error?: { issues: T[] } } }, v: unknown) =>
  expect(schema.safeParse(v).error?.issues ?? []).toEqual([])

// ROADMAP E07.02 over HTTP on the stateful fake Prisma: the owner publishes a request in the pool of
// a workspace it is presented to, by an explicit consent at a chosen level, and withdraws it from
// that workspace only; the workspace's conseillers see where it stands; nobody else — another
// workspace, its investors, a share recipient, another account — learns anything of it.
describe('Pool publications (e2e)', () => {
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
    await invite(cci, { email: CLAIRE.email, role: 'investisseur' })
    await invite(club, { email: PAUL.email, role: 'conseiller', canManageWorkspace: true })
    // Each workspace receives candidatures: a published complementary form without question.
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
    delete: (url: string) => request(app.getHttpServer()).delete(url).set('Authorization', auth(u)),
  })
  const sophie = as(SOPHIE)
  const poolOf = (candidatureId: string) => `/v1/candidatures/${candidatureId}/pool-publication`
  const journal = () =>
    [...fake.table('auditLog').values()].filter((e) =>
      String(e.actionType).startsWith('pool_publication_'),
    )

  // Biosensio, published, sent to both workspaces, shared with Bob at the partial level.
  async function biosensio() {
    const dossier = (await sophie.post('/v1/dossiers', { name: 'Biosensio' }).expect(201)).body
    Object.assign(fake.table('dossier').get(dossier.id)!, {
      submittedAt: new Date(),
      summary: 'Capteurs pour la qualité de l’eau.',
      objective: 'Industrialiser',
      amountEur: 300_000,
      financingTypes: ['equity'],
    })
    await sophie.post(`/v1/dossiers/${dossier.id}/publish`).expect(200)
    const send = async (workspaceId: string) => {
      const created = (
        await sophie.post(`/v1/dossiers/${dossier.id}/candidatures`, { workspaceId }).expect(201)
      ).body
      await sophie.post(`/v1/candidatures/${created.id}/submit`).expect(200)
      return created.id as string
    }
    const share = (
      await sophie
        .post(`/v1/dossiers/${dossier.id}/shares`, {
          recipientEmail: BOB.email,
          accessLevel: 'partiel',
        })
        .expect(201)
    ).body
    return {
      dossierId: dossier.id as string,
      inCci: await send(cci),
      inClub: await send(club),
      token: share.token as string,
    }
  }

  it('publishes by an explicit consent at a chosen level, and shows it to the owner per workspace', async () => {
    const { dossierId, inCci, inClub } = await biosensio()
    for (const body of [
      {},
      { accessLevel: 'partiel' },
      { accessLevel: 'partiel', consent: false },
      { accessLevel: 'tout', consent: true },
      { consent: true },
      { accessLevel: 'partiel', consent: true, workspaceId: club },
    ]) {
      await sophie.put(poolOf(inCci), body).expect(400)
    }
    expect(fake.table('poolPublication').size).toBe(0)
    await sophie.put('/v1/candidatures/not-a-uuid/pool-publication', {}).expect(400)
    await request(app.getHttpServer())
      .put(poolOf(inCci))
      .send({ accessLevel: 'public', consent: true })
      .expect(401)

    const published = (
      await sophie.put(poolOf(inCci), { accessLevel: 'partiel', consent: true }).expect(200)
    ).body
    valid(candidatureSchema, published)
    expect(published.poolPublication).toMatchObject({
      accessLevel: 'partiel',
      state: 'listed',
      pausedBecause: null,
      withdrawnAt: null,
      withdrawnBecause: null,
    })
    const list = (await sophie.get(`/v1/dossiers/${dossierId}/candidatures`).expect(200)).body
    for (const item of list) valid(candidatureSummarySchema, item)
    const byId = new Map(list.map((c: { id: string }) => [c.id, c]))
    expect(byId.get(inCci)).toMatchObject({ poolPublication: { state: 'listed' } })
    expect(byId.get(inClub)).toMatchObject({ poolPublication: null })
    expect(journal()).toEqual([
      expect.objectContaining({
        actionType: 'pool_publication_published',
        actorId: SOPHIE.id,
        dossierId,
        metadata: expect.objectContaining({ workspaceId: cci, to: 'partiel', from: null }),
      }),
    ])
  })

  it('refuses every other account with the 404 of an unknown candidature, and changes nothing', async () => {
    const { inCci } = await biosensio()
    for (const someone of [MARC, MARIE, CLAIRE, PAUL, BOB, ADMIN]) {
      await as(someone).put(poolOf(inCci), { accessLevel: 'public', consent: true }).expect(404)
      await as(someone).delete(poolOf(inCci)).expect(404)
    }
    await sophie
      .put(poolOf('00000000-0000-4000-8000-000000000000'), {
        accessLevel: 'public',
        consent: true,
      })
      .expect(404)
    expect(fake.table('poolPublication').size).toBe(0)
    expect(journal()).toEqual([])
  })

  it('lets the workspace’s conseillers see where it stands — in their list, portfolio and candidature — and nobody else', async () => {
    const { inCci, inClub, token, dossierId } = await biosensio()
    await sophie.put(poolOf(inCci), { accessLevel: 'complet', consent: true }).expect(200)

    const marie = as(MARIE)
    const received = (await marie.get(`/v1/workspaces/${cci}/candidatures/${inCci}`).expect(200))
      .body
    valid(receivedCandidatureSchema, received)
    expect(received.poolPublication).toMatchObject({ state: 'listed', accessLevel: 'complet' })
    const [item] = (await marie.get(`/v1/workspaces/${cci}/candidatures`).expect(200)).body
    valid(receivedCandidatureListItemSchema, item)
    expect(item.poolPublication).toMatchObject({ state: 'listed' })
    const portfolio = (await marie.get(`/v1/workspaces/${cci}/portfolio`).expect(200)).body
    valid(portfolioSchema, portfolio)
    expect(portfolio.items[0].poolPublication).toMatchObject({ state: 'listed' })

    // The club deal reads its own candidature, never published in its pool, and not the CCI's.
    const own = (await as(PAUL).get(`/v1/workspaces/${club}/candidatures/${inClub}`).expect(200))
      .body
    expect(own.poolPublication).toBeNull()
    await as(PAUL).get(`/v1/workspaces/${club}/candidatures/${inCci}`).expect(404)
    await as(PAUL).get(`/v1/workspaces/${cci}/candidatures/${inCci}`).expect(404)
    // The CCI's investor: still nothing before E07.03.
    await as(CLAIRE).get(`/v1/workspaces/${cci}/candidatures`).expect(403)
    await as(CLAIRE).get(`/v1/workspaces/${cci}/candidatures/${inCci}`).expect(403)
    await as(CLAIRE).get(`/v1/workspaces/${cci}/portfolio`).expect(403)
    // The share recipient reads what their link gives, nothing of the pool.
    const shared = (await as(BOB).get(`/v1/shares/${token}`).expect(200)).body
    valid(financeurShareResponseSchema, shared)
    expect(JSON.stringify(shared)).not.toMatch(/pool|vivier/i)
    const asRecipient = (await as(BOB).get(`/v1/dossiers/${dossierId}`).expect(200)).body
    expect(JSON.stringify(asRecipient)).not.toMatch(/pool|vivier/i)
  })

  it('withdraws from that workspace only: the other pool, the shares, the candidature and the request’s publication stay', async () => {
    const { dossierId, inCci, inClub, token } = await biosensio()
    await sophie.put(poolOf(inCci), { accessLevel: 'partiel', consent: true }).expect(200)
    await sophie.put(poolOf(inClub), { accessLevel: 'public', consent: true }).expect(200)
    const shares = (await sophie.get(`/v1/dossiers/${dossierId}/shares`).expect(200)).body
    for (const s of shares) valid(shareAccessSchema, s)

    const withdrawn = (await sophie.delete(poolOf(inCci)).expect(200)).body
    valid(candidatureSchema, withdrawn)
    expect(withdrawn).toMatchObject({
      status: 'submitted',
      financingStatus: 'preparing',
      poolPublication: { state: 'withdrawn', withdrawnBecause: 'owner', accessLevel: 'partiel' },
    })
    const club = (await sophie.get(`/v1/candidatures/${inClub}`).expect(200)).body
    expect(club.poolPublication).toMatchObject({ state: 'listed', accessLevel: 'public' })
    expect((await sophie.get(`/v1/dossiers/${dossierId}/shares`).expect(200)).body).toEqual(shares)
    await as(BOB).get(`/v1/shares/${token}`).expect(200)
    expect((await sophie.get(`/v1/dossiers/${dossierId}`).expect(200)).body.publicationStatus).toBe(
      'published',
    )
    // The conseillers of the CCI see it withdrawn.
    const received = (
      await as(MARIE).get(`/v1/workspaces/${cci}/candidatures/${inCci}`).expect(200)
    ).body
    expect(received.poolPublication).toMatchObject({
      state: 'withdrawn',
      withdrawnBecause: 'owner',
    })

    // Again: nothing changes; published again: a new consent.
    await sophie.delete(poolOf(inCci)).expect(200)
    expect(journal().map((e) => e.actionType)).toEqual([
      'pool_publication_published',
      'pool_publication_published',
      'pool_publication_withdrawn',
    ])
    const again = (
      await sophie.put(poolOf(inCci), { accessLevel: 'public', consent: true }).expect(200)
    ).body
    expect(again.poolPublication).toMatchObject({ state: 'listed', withdrawnAt: null })
  })

  it('needs a published request and an open follow-up; pauses with the request’s unpublication; the archiving withdraws everywhere', async () => {
    const { dossierId, inCci, inClub } = await biosensio()
    await sophie.post(`/v1/dossiers/${dossierId}/unpublish`).expect(200)
    const refused = await sophie
      .put(poolOf(inCci), { accessLevel: 'public', consent: true })
      .expect(409)
    expect(refused.body.error).toEqual({
      code: 'CONFLICT',
      message: 'Publiez d’abord la demande (onglet « Demande »).',
    })
    await sophie.post(`/v1/dossiers/${dossierId}/publish`).expect(200)
    await sophie.put(poolOf(inCci), { accessLevel: 'partiel', consent: true }).expect(200)
    await sophie.put(poolOf(inClub), { accessLevel: 'partiel', consent: true }).expect(200)

    // The structure refuses: paused there, still listed in the other pool.
    await as(MARIE)
      .post(`/v1/workspaces/${cci}/candidatures/${inCci}/financing-status`, {
        from: 'preparing',
        to: 'refused',
      })
      .expect(200)
    expect(
      (await sophie.get(`/v1/candidatures/${inCci}`).expect(200)).body.poolPublication,
    ).toMatchObject({ state: 'paused', pausedBecause: 'financing_closed' })
    expect(
      (await sophie.get(`/v1/candidatures/${inClub}`).expect(200)).body.poolPublication,
    ).toMatchObject({ state: 'listed' })
    const closed = await sophie
      .put(poolOf(inCci), { accessLevel: 'complet', consent: true })
      .expect(409)
    expect(closed.body.error.message).toMatch(/^Le suivi de cette demande est clos/)

    await sophie.post(`/v1/dossiers/${dossierId}/unpublish`).expect(200)
    expect(
      (await sophie.get(`/v1/candidatures/${inClub}`).expect(200)).body.poolPublication,
    ).toMatchObject({ state: 'paused', pausedBecause: 'request_not_published' })
    await sophie.post(`/v1/dossiers/${dossierId}/publish`).expect(200)
    expect(
      (await sophie.get(`/v1/candidatures/${inClub}`).expect(200)).body.poolPublication,
    ).toMatchObject({ state: 'listed' })

    await sophie.post(`/v1/dossiers/${dossierId}/archive`).expect(200)
    for (const c of [inCci, inClub]) {
      expect(
        (await sophie.get(`/v1/candidatures/${c}`).expect(200)).body.poolPublication,
      ).toMatchObject({ state: 'withdrawn', withdrawnBecause: 'archived' })
    }
    const archived = await sophie
      .put(poolOf(inClub), { accessLevel: 'public', consent: true })
      .expect(409)
    expect(archived.body.error.message).toMatch(/^Cette demande est archivée/)
    await sophie.post(`/v1/dossiers/${dossierId}/unarchive`).expect(200)
    expect(
      (await sophie.get(`/v1/candidatures/${inClub}`).expect(200)).body.poolPublication,
    ).toMatchObject({ state: 'withdrawn' })
  })
})
