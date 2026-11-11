import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { ZodValidationPipe } from 'nestjs-zod'
import request from 'supertest'
import type { App } from 'supertest/types'
import {
  companySchema,
  documentGroupSchema,
  dossierSchema,
  financeurShareResponseSchema,
} from '@confluent/shared'
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
const BOB = {
  id: '7d3c1b0e-0000-4000-8000-000000000003',
  email: 'bob@invest.fr',
  role: 'financeur',
}
const ADMIN = {
  id: '7d3c1b0e-0000-4000-8000-000000000004',
  email: 'admin@confluent.fr',
  role: 'admin',
}
const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000'
const VERSION = '7d3c1b0e-0000-4000-8000-0000000000f1'

const PRESENTATION = {
  summary: 'Capteurs de qualité de l’eau',
  objective: 'Industrialiser la production',
  description: 'Première ligne.\nSeconde ligne.',
  amountEur: 750000,
  financingTypes: ['grant', 'equity'],
}

// ROADMAP E05.07, over HTTP on the stateful fake Prisma: several financing requests per company,
// their presentation and publication, and the documents each one selects — the only ones its
// shares show.
describe('Financing requests (e2e)', () => {
  let app: INestApplication<App>
  let fake: ReturnType<typeof createFakePrisma>
  const tokens: Record<string, string> = {}

  beforeEach(async () => {
    fake = createFakePrisma()
    const p = fake.prisma
    for (const u of [SOPHIE, MARC, BOB, ADMIN]) {
      await p.user.create({ data: { ...u, emailVerifiedAt: new Date() } })
    }
    await p.questionnaire.create({
      data: { id: 'form-1', slug: 'dossier', name: 'Dossier', usage: 'dossier' },
    })
    await p.questionnaireVersion.create({
      data: { id: VERSION, questionnaireId: 'form-1', version: 1, status: 'published' },
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
    for (const u of [SOPHIE, MARC, BOB, ADMIN]) {
      tokens[u.id] = await new JwtService().signAsync(
        { sub: u.id, email: u.email, role: u.role },
        { secret: process.env.JWT_SECRET },
      )
    }
  })

  afterEach(async () => {
    await app.close()
  })

  const auth = (user: { id: string }) => `Bearer ${tokens[user.id]}`
  const as = (user: { id: string }) => ({
    get: (url: string) => request(app.getHttpServer()).get(url).set('Authorization', auth(user)),
    post: (url: string, body?: object) =>
      request(app.getHttpServer()).post(url).set('Authorization', auth(user)).send(body),
    patch: (url: string, body: object) =>
      request(app.getHttpServer()).patch(url).set('Authorization', auth(user)).send(body),
    put: (url: string, body: object) =>
      request(app.getHttpServer()).put(url).set('Authorization', auth(user)).send(body),
    delete: (url: string) =>
      request(app.getHttpServer()).delete(url).set('Authorization', auth(user)),
    upload: (dossierId: string, filename: string, text: string) =>
      request(app.getHttpServer())
        .post(`/v1/dossiers/${dossierId}/documents`)
        .set('Authorization', auth(user))
        .attach('file', Buffer.from(`%PDF-1.4 ${text}`), filename),
  })
  const sophie = as(SOPHIE)

  // Two requests of Biosensio: the first creates the company, the second reuses it.
  async function twoRequests() {
    const first = (await sophie.post('/v1/dossiers', { name: 'Biosensio' }).expect(201)).body
    const second = (
      await sophie
        .post(`/v1/companies/${first.companyId}/dossiers`, { name: 'Croissance 2027' })
        .expect(201)
    ).body
    return { first, second, companyId: first.companyId as string }
  }

  const shareWith = async (dossierId: string, accessLevel: string) =>
    (
      await sophie
        .post(`/v1/dossiers/${dossierId}/shares`, { recipientEmail: BOB.email, accessLevel })
        .expect(201)
    ).body.token as string
  const shared = async (token: string) => {
    const body = (await as(BOB).get(`/v1/shares/${token}`).expect(200)).body
    expect(financeurShareResponseSchema.safeParse(body).error?.issues ?? []).toEqual([])
    return body
  }
  const files = (groups: Array<{ filename: string; versions: Array<{ version: number }> }>) =>
    Object.fromEntries(groups.map((g) => [g.filename, g.versions.map((v) => v.version)]))

  it('creates another request of an existing company, without a second company, for its owner only', async () => {
    const { first, second, companyId } = await twoRequests()
    expect(dossierSchema.safeParse(second).error?.issues ?? []).toEqual([])
    expect(second).toMatchObject({
      companyId,
      name: 'Croissance 2027',
      slug: 'croissance-2027',
      questionnaireVersionId: first.questionnaireVersionId,
      publicationStatus: 'draft',
      financingTypes: [],
      company: { id: companyId, name: 'Biosensio' },
    })
    expect(fake.table('company').size).toBe(1)

    const company = (await sophie.get(`/v1/companies/${companyId}`).expect(200)).body
    expect(companySchema.safeParse(company).error?.issues ?? []).toEqual([])
    expect(company.dossiers.map((d: { id: string }) => d.id).sort()).toEqual(
      [first.id, second.id].sort(),
    )

    // Another account's company answers like an unknown one; a financeur cannot own one.
    const foreign = await as(MARC)
      .post(`/v1/companies/${companyId}/dossiers`, { name: 'Vol' })
      .expect(404)
    const unknown = await as(MARC)
      .post(`/v1/companies/${UNKNOWN_ID}/dossiers`, { name: 'Vol' })
      .expect(404)
    expect(foreign.body).toEqual(unknown.body)
    await as(BOB).post(`/v1/companies/${companyId}/dossiers`, { name: 'Vol' }).expect(403)
    await as(ADMIN).post(`/v1/companies/${companyId}/dossiers`, { name: 'Vol' }).expect(404)
    await sophie.post(`/v1/companies/${companyId}/dossiers`, { name: ' ' }).expect(400)
    await sophie
      .post(`/v1/companies/${companyId}/dossiers`, { name: 'X', companyId: UNKNOWN_ID })
      .expect(400)
    expect(fake.table('dossier').size).toBe(2)
  })

  it('edits the presentation as plain bounded text and refuses what does not fit', async () => {
    const { first } = await twoRequests()
    const res = await sophie.patch(`/v1/dossiers/${first.id}`, PRESENTATION).expect(200)
    expect(res.body).toMatchObject({ ...PRESENTATION, financingTypes: ['equity', 'grant'] })
    // Blank clears.
    const cleared = await sophie.patch(`/v1/dossiers/${first.id}`, { summary: '  ' }).expect(200)
    expect(cleared.body.summary).toBeNull()
    for (const body of [
      { summary: '<b>gras</b>' },
      { summary: 'x'.repeat(301) },
      { amountEur: 1000.5 },
      { amountEur: 0 },
      { amountEur: 1_000_000_001 },
      { financingTypes: ['equity', 'equity'] },
      { financingTypes: ['loterie'] },
      { publicationStatus: 'published' },
      {},
    ]) {
      const refused = await sophie.patch(`/v1/dossiers/${first.id}`, body)
      expect({ body, status: refused.status }).toEqual({ body, status: 400 })
    }
    await as(MARC).patch(`/v1/dossiers/${first.id}`, PRESENTATION).expect(404)
    await as(BOB).patch(`/v1/dossiers/${first.id}`, PRESENTATION).expect(404)
    expect(fake.table('dossier').get(first.id)).toMatchObject({ summary: null, amountEur: 750000 })
  })

  it('publishes a complete, submitted request; its shares then show its presentation, and stay open once unpublished', async () => {
    const { first } = await twoRequests()
    const token = await shareWith(first.id, 'public')
    await sophie.patch(`/v1/dossiers/${first.id}`, PRESENTATION).expect(200)

    // A draft: the recipient reads the dossier, not its presentation.
    const draft = await shared(token)
    expect(draft.dossier).toMatchObject({
      name: 'Biosensio',
      publicationStatus: 'draft',
      summary: null,
      objective: null,
      description: null,
      amountEur: null,
      financingTypes: [],
    })
    const listed = (await as(BOB).get('/v1/dossiers').expect(200)).body
    expect(listed[0]).toMatchObject({ summary: null, amountEur: null })
    expect((await as(BOB).get(`/v1/dossiers/${first.id}`).expect(200)).body).toMatchObject({
      summary: null,
    })

    // Not submitted yet: refused, with what is missing.
    const refused = await sophie.post(`/v1/dossiers/${first.id}/publish`).expect(422)
    expect(refused.body.error.details).toEqual([
      expect.objectContaining({ item: 'submitted', label: expect.stringContaining('soumis') }),
    ])
    fake.table('dossier').get(first.id)!.submittedAt = new Date()
    await as(MARC).post(`/v1/dossiers/${first.id}/publish`).expect(404)
    await as(BOB).post(`/v1/dossiers/${first.id}/publish`).expect(404)
    const published = (await sophie.post(`/v1/dossiers/${first.id}/publish`).expect(200)).body
    expect(published).toMatchObject({ publicationStatus: 'published' })
    expect(published.publishedAt).toEqual(expect.any(String))

    expect((await shared(token)).dossier).toMatchObject({
      ...PRESENTATION,
      financingTypes: ['equity', 'grant'],
      publicationStatus: 'published',
    })
    // A published request keeps what publication requires.
    const clearing = await sophie.patch(`/v1/dossiers/${first.id}`, { amountEur: null }).expect(422)
    expect(clearing.body.error.details).toEqual([expect.objectContaining({ item: 'amountEur' })])

    await sophie.post(`/v1/dossiers/${first.id}/unpublish`).expect(200)
    expect((await shared(token)).dossier).toMatchObject({
      publicationStatus: 'draft',
      summary: null,
    })
    const journal = [...fake.table('auditLog').values()].map((e) => e.actionType)
    expect(journal.filter((a) => String(a).startsWith('dossier_'))).toEqual([
      'dossier_published',
      'dossier_unpublished',
    ])
  })

  it('shows each request’s share only the documents it selects, at the selected version', async () => {
    const { first, second } = await twoRequests()
    // Deposited through the first request: selected by it, following their latest version.
    const bp1 = (await sophie.upload(first.id, 'bp.pdf', 'bp 1').expect(201)).body
    await sophie.upload(first.id, 'bp.pdf', 'bp 2').expect(201)
    const deck = (await sophie.upload(first.id, 'deck.pdf', 'deck').expect(201)).body
    const tokenA = await shareWith(first.id, 'complet')
    const tokenB = await shareWith(second.id, 'complet')

    expect(files((await shared(tokenA)).documents)).toEqual({ 'bp.pdf': [2], 'deck.pdf': [1] })
    // The second request selects nothing yet: its share shows no document.
    expect((await shared(tokenB)).documents).toEqual([])

    // It pins the first version of the business plan.
    const selected = await sophie
      .put(`/v1/dossiers/${second.id}/documents/${bp1.documentId}/selection`, {
        pinnedVersionId: bp1.id,
      })
      .expect(200)
    expect(selected.body).toEqual({ documentId: bp1.documentId, pinnedVersionId: bp1.id })
    expect(files((await shared(tokenB)).documents)).toEqual({ 'bp.pdf': [1] })
    // A third version changes neither the pinned nor the followed selection's choice of version.
    await sophie.upload(second.id, 'bp.pdf', 'bp 3').expect(201)
    expect(files((await shared(tokenB)).documents)).toEqual({ 'bp.pdf': [1] })
    expect(files((await shared(tokenA)).documents)).toEqual({ 'bp.pdf': [3], 'deck.pdf': [1] })
    // The same rule through the REST listing a financeur may call.
    const viaRest = (await as(BOB).get(`/v1/dossiers/${second.id}/documents`).expect(200)).body
    expect(files(viaRest)).toEqual({ 'bp.pdf': [1] })
    expect(viaRest[0]).not.toHaveProperty('selection')

    // The first request no longer presents the deck.
    await sophie
      .delete(`/v1/dossiers/${first.id}/documents/${deck.documentId}/selection`)
      .expect(204)
    expect(files((await shared(tokenA)).documents)).toEqual({ 'bp.pdf': [3] })

    // The owner reads the whole library, with this request's selection of each document.
    const owned = (await sophie.get(`/v1/dossiers/${second.id}/documents`).expect(200)).body
    for (const group of owned) {
      expect(documentGroupSchema.safeParse(group).error?.issues ?? []).toEqual([])
    }
    expect(files(owned)).toEqual({ 'bp.pdf': [3, 2, 1], 'deck.pdf': [1] })
    expect(
      owned.map((g: { filename: string; selection: unknown }) => [g.filename, g.selection]),
    ).toEqual([
      ['bp.pdf', { pinnedVersionId: bp1.id }],
      ['deck.pdf', null],
    ])
  })

  it('lets only the owner select documents, and only those of the request’s company', async () => {
    const { first, second } = await twoRequests()
    const bp = (await sophie.upload(first.id, 'bp.pdf', 'bp').expect(201)).body
    const other = (await as(MARC).post('/v1/dossiers', { name: 'Agrotech' }).expect(201)).body
    const foreign = (await as(MARC).upload(other.id, 'x.pdf', 'x').expect(201)).body
    const url = `/v1/dossiers/${second.id}/documents/${bp.documentId}/selection`
    for (const account of [as(MARC), as(BOB), as(ADMIN)]) {
      await account.put(url, { pinnedVersionId: null }).expect(404)
      await account.delete(url).expect(404)
    }
    await shareWith(second.id, 'complet')
    await as(BOB).put(url, { pinnedVersionId: null }).expect(404)
    // A document of another company, a version of another document, a malformed body.
    await sophie
      .put(`/v1/dossiers/${second.id}/documents/${foreign.documentId}/selection`, {
        pinnedVersionId: null,
      })
      .expect(404)
    await sophie.put(url, { pinnedVersionId: foreign.id }).expect(404)
    await sophie.put(url, {}).expect(400)
    await sophie.put(url, { pinnedVersionId: null, extra: true }).expect(400)
    expect(
      [...fake.table('dossierDocument').values()].filter((r) => r.dossierId === second.id),
    ).toEqual([])
  })

  it('shows administrators every request with its presentation and publication', async () => {
    const { first, second } = await twoRequests()
    await sophie.patch(`/v1/dossiers/${second.id}`, PRESENTATION).expect(200)
    const list = (await as(ADMIN).get('/v1/admin/dossiers').expect(200)).body
    expect(list.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: first.id, publicationStatus: 'draft' }),
        expect.objectContaining({ id: second.id, companyName: 'Biosensio' }),
      ]),
    )
    const detail = (await as(ADMIN).get(`/v1/admin/dossiers/${second.id}`).expect(200)).body
    expect(detail).toMatchObject({ summary: PRESENTATION.summary, amountEur: 750000 })
    expect(detail.documentSelection).toEqual([])
  })
})
