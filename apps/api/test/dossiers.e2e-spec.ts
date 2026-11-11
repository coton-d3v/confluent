import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { ZodValidationPipe } from 'nestjs-zod'
import request from 'supertest'
import type { App } from 'supertest/types'
import { companySchema, dossierSchema } from '@confluent/shared'
import { AppModule } from './../src/app.module'
import { GlobalExceptionFilter } from './../src/common/filters/global-exception.filter'
import { PrismaService } from './../src/prisma/prisma.service'
import { EMAIL_TRANSPORT } from './../src/modules/auth/email/email-transport'
import { createFakePrisma } from '../src/testing/fake-prisma'

const SOPHIE = {
  id: '7d3c1b0e-0000-4000-8000-000000000001',
  email: 'sophie@biosensio.fr',
  role: 'entrepreneur',
}
const MARC = {
  id: '7d3c1b0e-0000-4000-8000-000000000002',
  email: 'marc@agrotech.fr',
  role: 'entrepreneur',
}
const FINANCEUR = {
  id: '7d3c1b0e-0000-4000-8000-000000000003',
  email: 'fin@fonds.fr',
  role: 'financeur',
}
const ADMIN = {
  id: '7d3c1b0e-0000-4000-8000-000000000004',
  email: 'admin@confluent.fr',
  role: 'admin',
}
const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000'
const VERSION = '7d3c1b0e-0000-4000-8000-0000000000f1'
const FIELD = '7d3c1b0e-0000-4000-8000-0000000000f2'

// Dossiers and the company each one finances (ROADMAP E05.04), on the stateful fake Prisma.
describe('Dossiers and companies (e2e)', () => {
  let app: INestApplication<App>
  let fake: ReturnType<typeof createFakePrisma>
  const tokens: Record<string, string> = {}

  beforeEach(async () => {
    fake = createFakePrisma()
    const p = fake.prisma
    for (const u of [SOPHIE, MARC, FINANCEUR, ADMIN]) {
      await p.user.create({ data: { ...u, emailVerifiedAt: new Date() } })
    }
    await p.questionnaire.create({
      data: { id: 'form-1', slug: 'dossier', name: 'Dossier', usage: 'dossier' },
    })
    await p.questionnaireVersion.create({
      data: {
        id: VERSION,
        questionnaireId: 'form-1',
        version: 1,
        status: 'published',
      },
    })
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(p)
      .overrideProvider(EMAIL_TRANSPORT)
      .useValue({ sendMagicLink: jest.fn(), sendShareInvite: jest.fn() })
      .compile()
    app = moduleFixture.createNestApplication()
    app.setGlobalPrefix('v1', { exclude: ['/'] })
    app.useGlobalPipes(new ZodValidationPipe())
    app.useGlobalFilters(new GlobalExceptionFilter())
    await app.init()
    for (const u of [SOPHIE, MARC, FINANCEUR, ADMIN]) {
      tokens[u.id] = await new JwtService().signAsync(
        { sub: u.id, email: u.email, role: u.role },
        { secret: process.env.JWT_SECRET },
      )
    }
  })

  afterEach(async () => {
    await app.close()
  })

  const as = (user: { id: string }) => ({
    get: (url: string) =>
      request(app.getHttpServer()).get(url).set('Authorization', `Bearer ${tokens[user.id]}`),
    post: (url: string, body?: object) =>
      request(app.getHttpServer())
        .post(url)
        .set('Authorization', `Bearer ${tokens[user.id]}`)
        .send(body),
    patch: (url: string, body: object) =>
      request(app.getHttpServer())
        .patch(url)
        .set('Authorization', `Bearer ${tokens[user.id]}`)
        .send(body),
    put: (url: string, body: object) =>
      request(app.getHttpServer())
        .put(url)
        .set('Authorization', `Bearer ${tokens[user.id]}`)
        .send(body),
    delete: (url: string) =>
      request(app.getHttpServer()).delete(url).set('Authorization', `Bearer ${tokens[user.id]}`),
  })

  const create = async (user: { id: string }, name: string) =>
    (await as(user).post('/v1/dossiers', { name }).expect(201)).body

  it('requires a session for dossiers and companies', async () => {
    for (const url of ['/v1/dossiers', '/v1/companies', `/v1/companies/${UNKNOWN_ID}`]) {
      await request(app.getHttpServer()).get(url).expect(401)
    }
  })

  it('creates a dossier with its company, named after it and owned by the same account', async () => {
    const body = await create(SOPHIE, 'Biosensio')
    expect(body).toMatchObject({ name: 'Biosensio', slug: 'biosensio', userId: SOPHIE.id })
    expect(body.company).toEqual({ id: body.companyId, name: 'Biosensio' })
    expect(dossierSchema.safeParse(body).error?.issues ?? []).toEqual([])
    expect(fake.table('company').get(body.companyId)).toMatchObject({
      ownerId: SOPHIE.id,
      name: 'Biosensio',
    })
    // A second dossier of the same name: its own company and a unique slug.
    const again = await create(SOPHIE, 'Biosensio')
    expect(again.slug).toBe('biosensio-2')
    expect(again.companyId).not.toBe(body.companyId)
  })

  it('lets an administrator create a dossier, as before, and refuses a financeur', async () => {
    expect((await create(ADMIN, 'Test')).company.name).toBe('Test')
    const res = await as(FINANCEUR).post('/v1/dossiers', { name: 'Fonds' }).expect(403)
    expect(res.body.error).toMatchObject({
      code: 'FORBIDDEN',
      message: 'Seuls les porteurs de projet créent une entreprise et ses dossiers.',
    })
    expect([...fake.table('company').values()].map((c) => c.ownerId)).toEqual([ADMIN.id])
    expect(fake.table('dossier').size).toBe(1)
  })

  it('lists and reads only the caller’s dossiers, with their company', async () => {
    const own = await create(SOPHIE, 'Biosensio')
    const other = await create(MARC, 'Agrotech')

    const list = (await as(SOPHIE).get('/v1/dossiers').expect(200)).body
    expect(list.map((d: { id: string }) => d.id)).toEqual([own.id])
    expect(list[0].company).toEqual({ id: own.companyId, name: 'Biosensio' })

    const detail = (await as(SOPHIE).get(`/v1/dossiers/${own.id}`).expect(200)).body
    expect(detail.company).toEqual({ id: own.companyId, name: 'Biosensio' })
    await as(SOPHIE).get(`/v1/dossiers/${other.id}`).expect(404)
  })

  it('shows the owner their companies and their dossiers, never another account’s', async () => {
    const own = await create(SOPHIE, 'Biosensio')
    const other = await create(MARC, 'Agrotech')

    const companies = (await as(SOPHIE).get('/v1/companies').expect(200)).body
    expect(companies).toHaveLength(1)
    expect(companySchema.safeParse(companies[0]).success).toBe(true)
    expect(companies[0]).toMatchObject({
      id: own.companyId,
      name: 'Biosensio',
      dossiers: [{ id: own.id, slug: 'biosensio', name: 'Biosensio', submittedAt: null }],
    })
    expect(companies[0]).not.toHaveProperty('ownerId')
    const one = (await as(SOPHIE).get(`/v1/companies/${own.companyId}`).expect(200)).body
    expect(one).toEqual(companies[0])

    // Another account's company, an unknown one, a malformed identifier: the same answer.
    const foreign = await as(SOPHIE).get(`/v1/companies/${other.companyId}`).expect(404)
    const unknown = await as(SOPHIE).get(`/v1/companies/${UNKNOWN_ID}`).expect(404)
    const malformed = await as(SOPHIE).get('/v1/companies/pas-un-uuid').expect(404)
    expect(foreign.body).toEqual(unknown.body)
    expect(malformed.body).toEqual(unknown.body)
    expect(foreign.body.error).toMatchObject({
      code: 'NOT_FOUND',
      message: 'Entreprise introuvable.',
    })
    // Neither a financeur nor an administrator reads a company here.
    expect((await as(FINANCEUR).get('/v1/companies').expect(200)).body).toEqual([])
    await as(FINANCEUR).get(`/v1/companies/${own.companyId}`).expect(404)
    await as(ADMIN).get(`/v1/companies/${own.companyId}`).expect(404)
  })

  it('shows administrators the company of every dossier', async () => {
    const own = await create(SOPHIE, 'Biosensio')
    const list = (await as(ADMIN).get('/v1/admin/dossiers').expect(200)).body
    expect(list.items).toEqual([
      expect.objectContaining({ id: own.id, ownerEmail: SOPHIE.email, companyName: 'Biosensio' }),
    ])
    const detail = (await as(ADMIN).get(`/v1/admin/dossiers/${own.id}`).expect(200)).body
    expect(detail.company).toMatchObject({ id: own.companyId, name: 'Biosensio' })
    await as(SOPHIE).get('/v1/admin/dossiers').expect(403)
  })

  // ROADMAP E05.05: the profile (answers, documents, form version) is the company's; a dossier
  // presents it through the same routes and shapes as before.
  it('presents its company’s profile through each dossier, with the same routes and shapes', async () => {
    const p = fake.prisma
    await p.questionnaireSection.create({
      data: { id: 's-1', versionId: VERSION, key: 'identite', title: 'Identité', orderIndex: 0 },
    })
    await p.questionnaireField.create({
      data: {
        id: FIELD,
        versionId: VERSION,
        sectionId: 's-1',
        key: 'nom',
        label: 'Nom',
        fieldType: 'text',
        orderIndex: 0,
      },
    })
    const own = await create(SOPHIE, 'Biosensio')
    expect(fake.table('company').get(own.companyId)).toMatchObject({ profileVersionId: VERSION })
    expect(own.questionnaireVersionId).toBe(VERSION)

    await as(SOPHIE)
      .put(`/v1/dossiers/${own.id}/answers`, { answers: [{ fieldId: FIELD, value: 'Bio' }] })
      .expect(200)
    const [stored] = [...fake.table('dossierAnswer').values()]
    expect(stored).toMatchObject({ companyId: own.companyId, value: 'Bio' })
    expect(stored).not.toHaveProperty('dossierId')
    // A second financing dossier of the same company (E05.07) presents the same profile.
    const second = await p.dossier.create({
      data: {
        userId: SOPHIE.id,
        companyId: own.companyId,
        name: 'Croissance',
        slug: 'croissance',
        questionnaireVersionId: VERSION,
      },
    })
    for (const id of [own.id, second.id]) {
      const answers = (await as(SOPHIE).get(`/v1/dossiers/${id}/answers`).expect(200)).body
      expect(answers).toEqual([
        expect.objectContaining({ id: stored.id, dossierId: id, fieldId: FIELD, value: 'Bio' }),
      ])
    }
    await p.document.create({
      data: {
        companyId: own.companyId,
        filename: 'kbis.pdf',
        mimetype: 'application/pdf',
        storageKey: `dossiers/${own.id}/k`,
        size: 10,
        version: 1,
      },
    })
    const detail = (await as(ADMIN).get(`/v1/admin/dossiers/${second.id}`).expect(200)).body
    expect(detail.answers).toEqual([
      expect.objectContaining({ id: stored.id, dossierId: second.id, value: 'Bio' }),
    ])
    expect(detail.documents).toEqual([
      expect.objectContaining({ filename: 'kbis.pdf', dossierId: second.id }),
    ])
    // Another account reaches neither, whatever the dossier.
    await as(MARC).get(`/v1/dossiers/${second.id}/answers`).expect(404)
    await as(MARC).get(`/v1/dossiers/${second.id}/documents`).expect(404)
  })

  it('renames a dossier, leaving its company as it is', async () => {
    const own = await create(SOPHIE, 'Old')
    const res = await as(SOPHIE).patch(`/v1/dossiers/${own.id}`, { name: 'New Name' }).expect(200)
    expect(res.body.slug).toBe('new-name')
    expect(fake.table('company').get(own.companyId)!.name).toBe('Old')
    await as(MARC).patch(`/v1/dossiers/${own.id}`, { name: 'Pris' }).expect(404)
  })

  it('deletes a dossier with its company, only for its owner', async () => {
    const own = await create(SOPHIE, 'Biosensio')
    await as(MARC).delete(`/v1/dossiers/${own.id}`).expect(404)
    expect(fake.table('company').has(own.companyId)).toBe(true)

    await as(SOPHIE).delete(`/v1/dossiers/${own.id}`).expect(204)
    expect(fake.table('dossier').has(own.id)).toBe(false)
    expect(fake.table('company').has(own.companyId)).toBe(false)
    await as(SOPHIE).get(`/v1/companies/${own.companyId}`).expect(404)
    expect((await as(SOPHIE).get('/v1/companies').expect(200)).body).toEqual([])
  })
})
