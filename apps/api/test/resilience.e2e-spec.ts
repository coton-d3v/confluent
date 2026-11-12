import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { ZodValidationPipe } from 'nestjs-zod'
import request from 'supertest'
import type { App } from 'supertest/types'
import { financeurShareResponseSchema, sharePreviewSchema } from '@confluent/shared'
import { AppModule } from './../src/app.module'
import { GlobalExceptionFilter } from './../src/common/filters/global-exception.filter'
import { PrismaService } from './../src/prisma/prisma.service'
import { EMAIL_TRANSPORT } from './../src/modules/auth/email/email-transport'
import {
  STORAGE_TOKEN,
  type StorageAdapter,
} from './../src/modules/documents/storage/storage.adapter'
import { createFakePrisma, selectWholeLibrary } from '../src/testing/fake-prisma'

const id = (n: number) => `7d3c1b0e-0000-4000-8000-${n.toString().padStart(12, '0')}`
const SOPHIE = { id: id(1), email: 'sophie@biosensio.fr', role: 'entrepreneur' }
const BOB = { id: id(2), email: 'bob@invest.fr', role: 'financeur' }
const ADMIN = { id: id(3), email: 'admin@confluent.fr', role: 'admin' }
const VERSION = id(100)

// What an unreachable bucket says: internals (host, key) a reader must never see.
const UNREACHABLE = 'connect ECONNREFUSED QX-internal-host:9000 QX-secret-key'

// ROADMAP E10.06, over HTTP on the stateful fake Prisma: a request stays readable — by its owner,
// a share recipient, the « Voir comme le destinataire » preview and an administrator — when one of
// its files is lost or the document storage cannot be reached; such a document is listed as such,
// without a link, and nothing answers a 500. An unexpected failure answers a generic message, never
// its cause.
describe('Resilience: unavailable documents and unexpected failures (e2e)', () => {
  let app: INestApplication<App>
  let fake: ReturnType<typeof createFakePrisma>
  let storage: StorageAdapter
  const tokens: Record<string, string> = {}

  beforeEach(async () => {
    fake = createFakePrisma()
    const p = fake.prisma
    for (const u of [SOPHIE, BOB, ADMIN]) {
      await p.user.create({ data: { ...u, emailVerifiedAt: new Date() } })
    }
    await p.questionnaire.create({
      data: { id: 'form-1', slug: 'dossier', name: 'Dossier', usage: 'dossier' },
    })
    await p.questionnaireVersion.create({
      data: { id: VERSION, questionnaireId: 'form-1', version: 1, status: 'published' },
    })
    await p.questionnaireSection.create({
      data: { id: id(200), key: 'identite', title: 'Identité', orderIndex: 0, versionId: VERSION },
    })
    await p.questionnaireField.create({
      data: {
        id: id(300),
        sectionId: id(200),
        key: 'nom',
        label: 'Nom',
        minAccessLevel: 'public',
        fieldType: 'text',
        orderIndex: 0,
        versionId: VERSION,
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
    storage = app.get<StorageAdapter>(STORAGE_TOKEN)
    for (const u of [SOPHIE, BOB, ADMIN]) {
      tokens[u.id] = await new JwtService().signAsync(
        { sub: u.id, email: u.email, role: u.role },
        { secret: process.env.JWT_SECRET },
      )
    }
  })

  afterEach(async () => {
    jest.restoreAllMocks()
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
    upload: (dossierId: string, filename: string) =>
      request(app.getHttpServer())
        .post(`/v1/dossiers/${dossierId}/documents`)
        .set('Authorization', `Bearer ${tokens[user.id]}`)
        .attach('file', Buffer.from(`%PDF-1.4 ${filename}`), filename),
  })
  const sophie = as(SOPHIE)

  // Biosensio with two documents its request presents, shared with Bob at the complete level.
  async function biosensio() {
    const dossier = (await sophie.post('/v1/dossiers', { name: 'Biosensio QX' }).expect(201)).body
    await sophie.upload(dossier.id, 'kbis.pdf').expect(201)
    await sophie.upload(dossier.id, 'annexe.pdf').expect(201)
    await selectWholeLibrary(fake.prisma, dossier)
    const link = (
      await sophie
        .post(`/v1/dossiers/${dossier.id}/shares`, {
          recipientEmail: BOB.email,
          accessLevel: 'complet',
        })
        .expect(201)
    ).body as { token: string }
    return { dossierId: dossier.id as string, token: link.token }
  }

  type Listed = { filename: string; current: { availability: string; url: string | null } }
  const byName = (documents: Listed[]) =>
    Object.fromEntries(
      documents.map((d) => [
        d.filename,
        { availability: d.current.availability, url: d.current.url },
      ]),
    )

  // Every page that lists the request's documents, each answering 200 with the request readable.
  async function everyView(dossierId: string, token: string) {
    const dossier = (await sophie.get(`/v1/dossiers/${dossierId}`).expect(200)).body
    expect(dossier).toMatchObject({ id: dossierId, name: 'Biosensio QX' })
    const owner = (await sophie.get(`/v1/dossiers/${dossierId}/documents`).expect(200)).body
    const recipient = (await as(BOB).get(`/v1/shares/${token}`).expect(200)).body
    expect(financeurShareResponseSchema.safeParse(recipient).error?.issues ?? []).toEqual([])
    const preview = (
      await sophie.get(`/v1/dossiers/${dossierId}/share-preview?level=complet`).expect(200)
    ).body
    expect(sharePreviewSchema.safeParse(preview).error?.issues ?? []).toEqual([])
    const admin = (await as(ADMIN).get(`/v1/admin/dossiers/${dossierId}/documents`).expect(200))
      .body
    return {
      owner: byName(owner),
      recipient: byName(recipient.documents),
      preview: byName(preview.documents),
      admin: byName(admin),
      recipientDossier: recipient.dossier as { name: string },
    }
  }

  it('lists a lost file as such, without a link, and keeps every other document and the request readable', async () => {
    const { dossierId, token } = await biosensio()
    const kbis = [...fake.table('document').values()].find((d) => d.filename === 'kbis.pdf')!
    await storage.delete(kbis.storageKey as string)

    const views = await everyView(dossierId, token)
    expect(views.recipientDossier.name).toBe('Biosensio QX')
    const lost = { availability: 'missing', url: null }
    const present = { availability: 'available', url: expect.stringMatching(/^memory:\/\//) }
    expect(views.owner).toEqual({ 'kbis.pdf': lost, 'annexe.pdf': present })
    expect(views.recipient).toEqual({ 'kbis.pdf': lost, 'annexe.pdf': present })
    expect(views.admin).toEqual({ 'kbis.pdf': lost, 'annexe.pdf': present })
    // A preview delivers no file, but says which one the recipient cannot download.
    expect(views.preview).toEqual({
      'kbis.pdf': lost,
      'annexe.pdf': { availability: 'available', url: null },
    })

    // Its owner uploads it again: a new version, available everywhere.
    await sophie.upload(dossierId, 'kbis.pdf').expect(201)
    const again = await everyView(dossierId, token)
    expect(again.owner['kbis.pdf']).toEqual(present)
    expect(again.recipient['kbis.pdf']).toEqual(present)
  })

  it('keeps the request readable while the storage cannot be reached, and says why an upload failed', async () => {
    const { dossierId, token } = await biosensio()
    const down = () => Promise.reject(new Error(UNREACHABLE))
    jest.spyOn(storage, 'getSignedUrl').mockImplementation(down)
    jest.spyOn(storage, 'read').mockImplementation(down)
    jest.spyOn(storage, 'exists').mockImplementation(down)
    jest.spyOn(storage, 'upload').mockImplementation(down)

    const views = await everyView(dossierId, token)
    const unreachable = { availability: 'unavailable', url: null }
    for (const view of [views.owner, views.recipient, views.preview, views.admin]) {
      expect(view).toEqual({ 'kbis.pdf': unreachable, 'annexe.pdf': unreachable })
    }

    const upload = await sophie.upload(dossierId, 'statuts.pdf')
    expect(upload.status).toBe(503)
    expect(upload.body.error.code).toBe('SERVICE_UNAVAILABLE')
    expect(upload.body.error.message).toMatch(/momentanément indisponible/)
    expect(JSON.stringify(upload.body)).not.toContain('QX')
    expect([...fake.table('document').values()].map((d) => d.filename).sort()).toEqual([
      'annexe.pdf',
      'kbis.pdf',
    ])
  })

  it('answers an unexpected failure with a generic French message, never its cause', async () => {
    const { dossierId } = await biosensio()
    jest
      .spyOn(fake.prisma.dossier, 'findUnique')
      .mockRejectedValue(new Error('relation "QX_internal_table" does not exist at QX-db-host'))
    const res = await sophie.get(`/v1/dossiers/${dossierId}`)
    expect(res.status).toBe(500)
    expect(res.body).toEqual({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Une erreur inattendue est survenue. Réessayez dans quelques instants.',
      },
    })
    expect(JSON.stringify(res.body)).not.toContain('QX')
  })
})
