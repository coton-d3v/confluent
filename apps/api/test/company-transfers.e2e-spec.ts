import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { ZodValidationPipe } from 'nestjs-zod'
import request from 'supertest'
import type { App } from 'supertest/types'
import {
  companySchema,
  companyTransferDecisionSchema,
  companyTransferOfferSchema,
  dossierSchema,
  preparedCompanyCreatedSchema,
  preparedCompanySchema,
} from '@confluent/shared'
import { AppModule } from './../src/app.module'
import { GlobalExceptionFilter } from './../src/common/filters/global-exception.filter'
import { PrismaService } from './../src/prisma/prisma.service'
import { EMAIL_TRANSPORT } from './../src/modules/auth/email/email-transport'
import { createFakePrisma } from '../src/testing/fake-prisma'

const user = (n: number, email: string, role: string) => ({
  id: `7d3c1b0e-0000-4000-8000-0000000008${n.toString().padStart(2, '0')}`,
  email,
  role,
})
// Marie: conseillère of the CCI, a financeur account as a workspace invitation leaves it.
const MARIE = user(1, 'marie@cci.fr', 'financeur')
const CLAIRE = user(2, 'claire@angels.fr', 'financeur')
const SOPHIE = user(3, 'sophie@biosensio.fr', 'entrepreneur')
const BOB = user(4, 'bob@banque.fr', 'financeur')
const ADMIN = user(5, 'admin@confluent.dev', 'admin')
const VERSION = '7d3c1b0e-0000-4000-8000-0000000008f1'

const valid = <T>(schema: { safeParse: (v: unknown) => { error?: { issues: T[] } } }, v: unknown) =>
  expect(schema.safeParse(v).error?.issues ?? []).toEqual([])

// ROADMAP E05.08 over HTTP on the stateful fake Prisma: a conseiller prepares a company for an
// entrepreneur, works on it without diffusing it, and the entrepreneur takes it over.
describe('Companies prepared for an entrepreneur (e2e)', () => {
  let app: INestApplication<App>
  let fake: ReturnType<typeof createFakePrisma>
  let email: { sendCompanyTransferInvite: jest.Mock }
  const tokens: Record<string, string> = {}
  let cci: string

  beforeEach(async () => {
    fake = createFakePrisma()
    const p = fake.prisma
    for (const u of [MARIE, CLAIRE, SOPHIE, BOB, ADMIN]) {
      await p.user.create({ data: { ...u, emailVerifiedAt: new Date() } })
    }
    await p.questionnaire.create({
      data: { id: 'form-1', slug: 'dossier', name: 'Dossier', usage: 'dossier' },
    })
    await p.questionnaireVersion.create({
      data: { id: VERSION, questionnaireId: 'form-1', version: 1, status: 'published' },
    })
    email = { sendCompanyTransferInvite: jest.fn().mockResolvedValue(undefined) }
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(p)
      .overrideProvider(EMAIL_TRANSPORT)
      .useValue({
        sendMagicLink: jest.fn(),
        sendShareInvite: jest.fn().mockResolvedValue(undefined),
        sendWorkspaceInvite: jest.fn().mockResolvedValue(undefined),
        ...email,
      })
      .compile()
    app = moduleFixture.createNestApplication()
    app.setGlobalPrefix('v1', { exclude: ['/'] })
    app.useGlobalPipes(new ZodValidationPipe())
    app.useGlobalFilters(new GlobalExceptionFilter())
    await app.init()
    for (const u of [MARIE, CLAIRE, SOPHIE, BOB, ADMIN]) {
      tokens[u.id] = await new JwtService().signAsync(
        { sub: u.id, email: u.email, role: u.role },
        { secret: process.env.JWT_SECRET },
      )
    }
    cci = (await as(ADMIN).post('/v1/admin/workspaces', { name: 'CCI Touraine' }).expect(201)).body
      .id
    for (const [who, role] of [
      [MARIE, 'conseiller'],
      [CLAIRE, 'investisseur'],
    ] as const) {
      await as(ADMIN)
        .post(`/v1/admin/workspaces/${cci}/members`, { email: who.email, role })
        .expect(201)
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
    patch: (url: string, body: object) =>
      request(app.getHttpServer()).patch(url).set('Authorization', auth(u)).send(body),
    delete: (url: string) => request(app.getHttpServer()).delete(url).set('Authorization', auth(u)),
    upload: (dossierId: string, filename: string) =>
      request(app.getHttpServer())
        .post(`/v1/dossiers/${dossierId}/documents`)
        .set('Authorization', auth(u))
        .attach('file', Buffer.from(`%PDF-1.4 ${filename}`), filename),
  })
  const prepared = () => `/v1/workspaces/${cci}/prepared-companies`

  it('prepares, works on, then hands over a company with all its requests and documents', async () => {
    const marie = as(MARIE)
    const created = await marie
      .post(prepared(), { companyName: 'Biosensio', ownerEmail: SOPHIE.email })
      .expect(201)
    valid(preparedCompanyCreatedSchema, created.body)
    expect(created.body).toMatchObject({
      preparation: { held: true, heldByMe: true, dossierCount: 1 },
      invitationEmailSent: true,
    })
    expect(email.sendCompanyTransferInvite).toHaveBeenCalledWith(
      expect.objectContaining({
        to: SOPHIE.email,
        companyName: 'Biosensio',
        existingAccount: true,
      }),
    )
    const companyId = created.body.preparation.company.id as string
    const dossierId = created.body.dossier.id as string

    // The conseiller works through the usual routes, whatever her global role.
    const mine = (await marie.get('/v1/dossiers').expect(200)).body
    expect(mine).toHaveLength(1)
    expect(mine[0]).toMatchObject({
      id: dossierId,
      company: { id: companyId, inPreparation: true },
    })
    valid(dossierSchema, mine[0])
    const detail = (await marie.get(`/v1/dossiers/${dossierId}`).expect(200)).body
    expect(detail.company).toEqual({ id: companyId, name: 'Biosensio', inPreparation: true })
    await marie.patch(`/v1/dossiers/${dossierId}`, { summary: 'Capteurs' }).expect(200)
    await marie.upload(dossierId, 'kbis.pdf').expect(201)
    const second = await marie
      .post(`/v1/companies/${companyId}/dossiers`, { name: 'Série A' })
      .expect(201)
    const company = (await marie.get(`/v1/companies/${companyId}`).expect(200)).body
    valid(companySchema, company)
    expect(company.preparation).toMatchObject({
      workspace: { id: cci, name: 'CCI Touraine' },
      invitation: { email: SOPHIE.email, status: 'pending' },
    })
    // …but diffuses nothing.
    for (const res of [
      await marie.post(`/v1/dossiers/${dossierId}/shares`, { recipientEmail: BOB.email }),
      await marie.post(`/v1/dossiers/${dossierId}/publish`),
    ]) {
      expect(res.status).toBe(409)
      expect(res.body.error.message).toMatch(/préparée pour un entrepreneur/)
    }
    expect(fake.table('shareLink').size).toBe(0)
    // The future owner sees nothing of it before accepting.
    await as(SOPHIE).get(`/v1/dossiers/${dossierId}`).expect(404)
    await as(SOPHIE).get(`/v1/companies/${companyId}`).expect(404)

    const offers = (await as(SOPHIE).get('/v1/company-transfers').expect(200)).body
    expect(offers).toHaveLength(1)
    valid(companyTransferOfferSchema, offers[0])
    expect(offers[0]).toMatchObject({ company: { name: 'Biosensio' }, dossierCount: 2 })
    expect((await as(BOB).get('/v1/company-transfers').expect(200)).body).toEqual([])
    await as(BOB).post(`/v1/company-transfers/${offers[0].id}/accept`).expect(404)

    const accepted = await as(SOPHIE)
      .post(`/v1/company-transfers/${offers[0].id}/accept`)
      .expect(200)
    valid(companyTransferDecisionSchema, accepted.body)
    expect(accepted.body).toEqual({ status: 'accepted', companyId })
    await as(SOPHIE).post(`/v1/company-transfers/${offers[0].id}/accept`).expect(200)

    // Everything followed: both requests, the library; the conseiller reaches nothing any more.
    const hers = (await as(SOPHIE).get('/v1/dossiers').expect(200)).body
    expect(hers.map((d: { id: string }) => d.id).sort()).toEqual([dossierId, second.body.id].sort())
    expect(hers[0].company.inPreparation).toBe(false)
    const docs = (await as(SOPHIE).get(`/v1/dossiers/${dossierId}/documents`).expect(200)).body
    expect(JSON.stringify(docs)).toContain('kbis.pdf')
    expect((await as(SOPHIE).get(`/v1/companies/${companyId}`).expect(200)).body).toMatchObject({
      preparation: null,
    })
    await as(SOPHIE)
      .post(`/v1/dossiers/${dossierId}/shares`, { recipientEmail: BOB.email })
      .expect(201)
    await marie.get(`/v1/dossiers/${dossierId}`).expect(404)
    await marie.get(`/v1/companies/${companyId}`).expect(404)
    await marie.patch(`/v1/dossiers/${dossierId}`, { summary: 'Encore' }).expect(404)
    expect((await marie.get('/v1/dossiers').expect(200)).body).toEqual([])
    const [listed] = (await marie.get(prepared()).expect(200)).body
    valid(preparedCompanySchema, listed)
    expect(listed).toMatchObject({ held: false, holder: null, invitation: { status: 'accepted' } })
  })

  it('keeps preparation to the workspace’s conseillers and validates what it receives', async () => {
    const body = { companyName: 'Biosensio', ownerEmail: SOPHIE.email }
    expect((await as(CLAIRE).post(prepared(), body)).status).toBe(403)
    expect((await as(CLAIRE).get(prepared())).status).toBe(403)
    expect((await as(ADMIN).post(prepared(), body)).status).toBe(403)
    expect((await as(SOPHIE).post(prepared(), body)).status).toBe(404)
    expect((await as(BOB).get(prepared())).status).toBe(404)
    const marie = as(MARIE)
    for (const bad of [
      { companyName: 'Biosensio' },
      { companyName: '', ownerEmail: SOPHIE.email },
      { companyName: 'Biosensio', ownerEmail: 'not-an-email' },
      { ...body, ownerId: SOPHIE.id },
    ]) {
      expect((await marie.post(prepared(), bad)).status).toBe(400)
    }
    expect((await marie.post(prepared(), { ...body, ownerEmail: MARIE.email })).status).toBe(400)
    expect(fake.table('company').size).toBe(0)
  })

  it('declines, invites again, withdraws: the company stays with the conseiller', async () => {
    const marie = as(MARIE)
    const created = await marie
      .post(prepared(), { companyName: 'Biosensio', ownerEmail: SOPHIE.email })
      .expect(201)
    const companyId = created.body.preparation.company.id as string
    const [offer] = (await as(SOPHIE).get('/v1/company-transfers').expect(200)).body
    expect(
      (await as(SOPHIE).post(`/v1/company-transfers/${offer.id}/decline`).expect(200)).body,
    ).toEqual({ status: 'declined', companyId: null })
    expect((await as(SOPHIE).post(`/v1/company-transfers/${offer.id}/accept`)).status).toBe(409)
    await marie.get(`/v1/companies/${companyId}`).expect(200)

    const again = await marie
      .post(`${prepared()}/${companyId}/invitation`, { email: 'associe@biosensio.fr' })
      .expect(201)
    expect(again.body.preparation.invitation).toMatchObject({
      email: 'associe@biosensio.fr',
      status: 'pending',
    })
    const withdrawn = await marie.delete(`${prepared()}/${companyId}/invitation`).expect(200)
    expect(withdrawn.body.invitation.status).toBe('cancelled')
    await marie.get(`/v1/companies/${companyId}`).expect(200)
  })
})
