import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import request from 'supertest'
import type { App } from 'supertest/types'
import { AppModule } from './../src/app.module'
import { GlobalExceptionFilter } from './../src/common/filters/global-exception.filter'
import { PrismaService } from './../src/prisma/prisma.service'
import { EMAIL_TRANSPORT } from './../src/modules/auth/email/email-transport'
import { DocumentsService } from './../src/modules/documents/documents.service'
import { ZodValidationPipe } from 'nestjs-zod'
import {
  STORAGE_TOKEN,
  type StorageAdapter,
} from './../src/modules/documents/storage/storage.adapter'
import { createFakePrisma, seedDocument } from '../src/testing/fake-prisma'

describe('Document upload (e2e)', () => {
  let app: INestApplication<App>
  let fake: ReturnType<typeof createFakePrisma>
  let jwt: string

  beforeEach(async () => {
    fake = createFakePrisma()
    await fake.prisma.user.create({
      data: {
        id: 'u-1',
        email: 'sophie@biosensio.fr',
        role: 'entrepreneur',
        emailVerifiedAt: new Date(),
      },
    })
    // Every dossier belongs to a company of its owner (E05.04).
    await fake.prisma.company.create({
      data: { id: 'c-d-1', ownerId: 'u-1', name: 'Biosensio', profileVersionId: 'v-1' },
    })
    await fake.prisma.dossier.create({
      data: {
        id: 'd-1',
        userId: 'u-1',
        companyId: 'c-d-1',
        name: 'Biosensio',
        slug: 'biosensio',
        questionnaireVersionId: 'v-1',
      },
    })
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(fake.prisma)
      .overrideProvider(EMAIL_TRANSPORT)
      .useValue({ sendMagicLink: jest.fn(), sendShareInvite: jest.fn() })
      .compile()
    app = moduleFixture.createNestApplication()
    app.setGlobalPrefix('v1', { exclude: ['/'] })
    app.useGlobalPipes(new ZodValidationPipe())
    app.useGlobalFilters(new GlobalExceptionFilter())
    await app.init()
    jwt = await new JwtService().signAsync(
      { sub: 'u-1', email: 'sophie@biosensio.fr', role: 'entrepreneur' },
      { secret: process.env.JWT_SECRET },
    )
  })

  afterEach(async () => {
    await app.close()
  })

  it('rejects a file over 20 MB with 413 while streaming, and stores nothing', async () => {
    // The multipart limit must stop the upload before the service ever gets a (huge) buffer.
    const upload = jest.spyOn(DocumentsService.prototype, 'upload')
    const res = await request(app.getHttpServer())
      .post('/v1/dossiers/d-1/documents')
      .set('Authorization', `Bearer ${jwt}`)
      .attach('file', Buffer.alloc(21 * 1024 * 1024, 1), 'gros.pdf')
    expect(res.status).toBe(413)
    expect(upload).not.toHaveBeenCalled()
    expect(fake.table('document').size).toBe(0)
    upload.mockRestore()
  })

  it('accepts a small file and versions re-uploads of the same name', async () => {
    for (const expected of [1, 2]) {
      const res = await request(app.getHttpServer())
        .post('/v1/dossiers/d-1/documents')
        .set('Authorization', `Bearer ${jwt}`)
        .attach('file', Buffer.from('%PDF-1.4 test'), 'bp.pdf')
        .expect(201)
      expect(res.body).toMatchObject({ filename: 'bp.pdf', version: expected })
    }
  })

  it('refuses a file whose content is not an accepted format with 415, and stores nothing', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/dossiers/d-1/documents')
      .set('Authorization', `Bearer ${jwt}`)
      .attach('file', Buffer.from('MZ\x90\x00 program'), {
        filename: 'statuts.pdf',
        contentType: 'application/pdf',
      })
    expect(res.status).toBe(415)
    expect(res.body.error).toMatchObject({ code: 'UNSUPPORTED_MEDIA_TYPE' })
    expect(res.body.error.message).toMatch(/Format non accepté/)
    expect(fake.table('document').size).toBe(0)
  })

  it('lists each version with its availability and a download URL', async () => {
    await request(app.getHttpServer())
      .post('/v1/dossiers/d-1/documents')
      .set('Authorization', `Bearer ${jwt}`)
      .attach('file', Buffer.from('%PDF-1.4 test'), 'bp.pdf')
      .expect(201)
    const res = await request(app.getHttpServer())
      .get('/v1/dossiers/d-1/documents')
      .set('Authorization', `Bearer ${jwt}`)
      .expect(200)
    expect(res.body).toEqual([
      expect.objectContaining({
        filename: 'bp.pdf',
        current: expect.objectContaining({
          version: 1,
          availability: 'available',
          mimetype: 'application/pdf',
          url: expect.stringMatching(/^memory:\/\//),
        }),
      }),
    ])
  })

  describe('attachment fields (E03.11)', () => {
    const upload = (fieldId: string | null, filename = 'kbis.pdf') => {
      const req = request(app.getHttpServer())
        .post('/v1/dossiers/d-1/documents')
        .set('Authorization', `Bearer ${jwt}`)
      if (fieldId !== null) req.field('fieldId', fieldId)
      return req.attach('file', Buffer.from('%PDF-1.4 test'), filename)
    }

    beforeEach(async () => {
      const p = fake.prisma
      const field = (id: string, versionId: string, fieldType: string, minAccessLevel: string) =>
        p.questionnaireField.create({
          data: {
            id,
            versionId,
            sectionId: 's-1',
            key: id,
            label: id,
            fieldType,
            orderIndex: 0,
            minAccessLevel,
          },
        })
      await field('f-kbis', 'v-1', 'file', 'partiel')
      await field('f-name', 'v-1', 'text', 'public')
      await field('f-other-version', 'v-0', 'file', 'public')
    })

    it('attaches an upload to an attachment field of the dossier version', async () => {
      const res = await upload('f-kbis').expect(201)
      expect(res.body).toMatchObject({ filename: 'kbis.pdf', version: 1, fieldId: 'f-kbis' })
      const list = await request(app.getHttpServer())
        .get('/v1/dossiers/d-1/documents')
        .set('Authorization', `Bearer ${jwt}`)
        .expect(200)
      expect(list.body).toEqual([
        expect.objectContaining({
          filename: 'kbis.pdf',
          fieldId: 'f-kbis',
          current: expect.objectContaining({ fieldId: 'f-kbis' }),
        }),
      ])
    })

    // Code review R48: the same file name sent for two questions answers each of them.
    it('keeps a file of the same name under each question it was sent for, both as version 1', async () => {
      await fake.prisma.questionnaireField.create({
        data: {
          id: 'f-statuts',
          versionId: 'v-1',
          sectionId: 's-1',
          key: 'statuts',
          label: 'statuts',
          fieldType: 'file',
          orderIndex: 1,
          minAccessLevel: 'complet',
        },
      })
      const first = await upload('f-kbis', 'scan.pdf').expect(201)
      const second = await upload('f-statuts', 'scan.pdf').expect(201)
      expect([first.body.version, second.body.version]).toEqual([1, 1])
      const list = await request(app.getHttpServer())
        .get('/v1/dossiers/d-1/documents')
        .set('Authorization', `Bearer ${jwt}`)
        .expect(200)
      expect(
        list.body.map((g: { fieldId: string; filename: string }) => [g.fieldId, g.filename]),
      ).toEqual([
        ['f-kbis', 'scan.pdf'],
        ['f-statuts', 'scan.pdf'],
      ])
    })

    it.each([
      ['a field that is not an attachment', 'f-name'],
      ['an attachment field of another version', 'f-other-version'],
      ['an unknown field', 'f-nope'],
    ])('refuses %s with 400 and stores nothing', async (_case, fieldId) => {
      const res = await upload(fieldId)
      expect(res.status).toBe(400)
      expect(res.body.error.message).toMatch(/n’attend pas de document/)
      expect(fake.table('document').size).toBe(0)
    })

    it('lists to a financeur only the files their share level may read, instead of refusing', async () => {
      await upload('f-kbis').expect(201)
      await upload(null, 'annexe.pdf').expect(201)
      await fake.prisma.user.create({
        data: {
          id: 'u-fin',
          email: 'bob@invest.fr',
          role: 'financeur',
          emailVerifiedAt: new Date(),
        },
      })
      await fake.prisma.shareLink.create({
        data: {
          dossierId: 'd-1',
          recipientEmail: 'bob@invest.fr',
          status: 'active',
          accessLevel: 'partiel',
          token: 't',
        },
      })
      const financeurJwt = await new JwtService().signAsync(
        { sub: 'u-fin', email: 'bob@invest.fr', role: 'financeur' },
        { secret: process.env.JWT_SECRET },
      )
      const res = await request(app.getHttpServer())
        .get('/v1/dossiers/d-1/documents')
        .set('Authorization', `Bearer ${financeurJwt}`)
        .expect(200)
      expect(res.body.map((g: { filename: string }) => g.filename)).toEqual(['kbis.pdf'])
    })
  })

  // ROADMAP E05.06: the company's library — typed documents, successive versions, history, and an
  // earlier version brought back as a new version without erasing any.
  describe('library: types, versions and restoration (E05.06)', () => {
    const PDF = (text: string) => Buffer.from(`%PDF-1.4 ${text}`)
    const as = (token: string) => ({
      upload: (filename: string, content: Buffer, fields: Record<string, string> = {}) => {
        const req = request(app.getHttpServer())
          .post('/v1/dossiers/d-1/documents')
          .set('Authorization', `Bearer ${token}`)
        for (const [k, v] of Object.entries(fields)) req.field(k, v)
        return req.attach('file', content, filename)
      },
      list: () =>
        request(app.getHttpServer())
          .get('/v1/dossiers/d-1/documents')
          .set('Authorization', `Bearer ${token}`),
      setType: (documentId: string, body: unknown) =>
        request(app.getHttpServer())
          .patch(`/v1/dossiers/d-1/documents/${documentId}`)
          .set('Authorization', `Bearer ${token}`)
          .send(body as object),
      restore: (documentId: string, versionId: string) =>
        request(app.getHttpServer())
          .post(`/v1/dossiers/d-1/documents/${documentId}/versions/${versionId}/restore`)
          .set('Authorization', `Bearer ${token}`),
    })
    const owner = () => as(jwt)
    const storage = () => app.get<StorageAdapter>(STORAGE_TOKEN)
    const journal = (actionType: string) =>
      [...fake.table('auditLog').values()].filter((e) => e.actionType === actionType)

    // Other accounts: a financeur with a `complet` share of the dossier, another entrepreneur, an
    // administrator. None may change the library; the financeur reads it at their level.
    async function others() {
      const account = async (id: string, email: string, role: string) => {
        await fake.prisma.user.create({ data: { id, email, role, emailVerifiedAt: new Date() } })
        return new JwtService().signAsync(
          { sub: id, email, role },
          { secret: process.env.JWT_SECRET },
        )
      }
      await fake.prisma.shareLink.create({
        data: {
          dossierId: 'd-1',
          recipientEmail: 'bob@invest.fr',
          status: 'active',
          accessLevel: 'complet',
          token: 't-complet',
        },
      })
      return {
        financeur: as(await account('u-fin', 'bob@invest.fr', 'financeur')),
        stranger: as(await account('u-2', 'eve@other.fr', 'entrepreneur')),
        admin: as(await account('u-admin', 'admin@confluent.fr', 'admin')),
      }
    }

    it('files a deposit under its type, and a new version under the document it extends', async () => {
      const first = await owner().upload('bp.pdf', PDF('v1'), { type: 'business_plan' }).expect(201)
      expect(first.body).toMatchObject({
        filename: 'bp.pdf',
        version: 1,
        type: 'business_plan',
        restoredFromVersion: null,
        documentId: expect.any(String),
      })
      // A new version keeps its document's type, whatever type is sent with it.
      const second = await owner().upload('bp.pdf', PDF('v2'), { type: 'other' }).expect(201)
      expect(second.body).toMatchObject({
        documentId: first.body.documentId,
        version: 2,
        type: 'business_plan',
      })
      // Without a type, a new document is `other`.
      await owner().upload('annexe.pdf', PDF('a')).expect(201)
      const list = (await owner().list().expect(200)).body
      expect(
        list.map((g: { filename: string; type: string; versions: unknown[] }) => [
          g.filename,
          g.type,
          g.versions.length,
        ]),
      ).toEqual([
        ['annexe.pdf', 'other', 1],
        ['bp.pdf', 'business_plan', 2],
      ])
      expect(list[1]).toMatchObject({ id: first.body.documentId })
    })

    it('refuses an unknown type with 400 and stores nothing', async () => {
      const res = await owner().upload('bp.pdf', PDF('x'), { type: 'passport' })
      expect(res.status).toBe(400)
      expect(res.body.error.message).toBe('Type de document inconnu.')
      expect(fake.table('document').size).toBe(0)
      expect(fake.table('libraryDocument').size).toBe(0)
    })

    it('changes the type of a document for every version, and journals it', async () => {
      const { body } = await owner().upload('statuts.pdf', PDF('s')).expect(201)
      await owner().upload('statuts.pdf', PDF('s2')).expect(201)
      const res = await owner()
        .setType(body.documentId, { type: 'articles_of_association' })
        .expect(200)
      expect(res.body).toEqual({
        id: body.documentId,
        filename: 'statuts.pdf',
        fieldId: null,
        type: 'articles_of_association',
      })
      const [listed] = (await owner().list().expect(200)).body
      expect(listed).toMatchObject({ type: 'articles_of_association' })
      expect(journal('document_type_changed')).toEqual([
        expect.objectContaining({
          actorId: 'u-1',
          dossierId: 'd-1',
          metadata: expect.objectContaining({ from: 'other', to: 'articles_of_association' }),
        }),
      ])
      // Unchanged type: nothing journaled again.
      await owner().setType(body.documentId, { type: 'articles_of_association' }).expect(200)
      expect(journal('document_type_changed')).toHaveLength(1)
      await owner().setType(body.documentId, { type: 'passport' }).expect(400)
      await owner().setType(body.documentId, {}).expect(400)
      await owner().setType('unknown', { type: 'other' }).expect(404)
    })

    it('brings an earlier version back as a new version, keeping every version downloadable', async () => {
      const v1 = (await owner().upload('bp.pdf', PDF('first')).expect(201)).body
      const v2 = (await owner().upload('bp.pdf', PDF('second')).expect(201)).body

      const restored = await owner().restore(v1.documentId, v1.id).expect(201)
      expect(restored.body).toMatchObject({
        documentId: v1.documentId,
        filename: 'bp.pdf',
        version: 3,
        restoredFromVersion: 1,
        size: v1.size,
      })

      const [doc] = (await owner().list().expect(200)).body
      expect(
        doc.versions.map(
          (v: { version: number; restoredFromVersion: number | null; availability: string }) => [
            v.version,
            v.restoredFromVersion,
            v.availability,
          ],
        ),
      ).toEqual([
        [3, 1, 'available'],
        [2, null, 'available'],
        [1, null, 'available'],
      ])
      expect(doc.current.id).toBe(restored.body.id)
      // Same stored file, nothing overwritten: version 3 reads as version 1, version 2 is intact.
      const stored = fake.table('document')
      const keyOf = (id: string) => stored.get(id)!.storageKey as string
      expect(keyOf(restored.body.id)).toBe(keyOf(v1.id))
      expect((await storage().read(keyOf(v1.id))).toString()).toBe('%PDF-1.4 first')
      expect((await storage().read(keyOf(v2.id))).toString()).toBe('%PDF-1.4 second')
      expect(stored.size).toBe(3)
      expect(journal('document_version_restored')).toEqual([
        expect.objectContaining({
          actorId: 'u-1',
          dossierId: 'd-1',
          metadata: expect.objectContaining({
            restoredVersionId: v1.id,
            restoredVersion: 1,
            versionId: restored.body.id,
            version: 3,
          }),
        }),
      ])

      // The version in force (or the version it restored) is not brought back again: 409.
      for (const id of [restored.body.id, v1.id]) {
        const again = await owner().restore(v1.documentId, id)
        expect(again.status).toBe(409)
        expect(again.body.error.message).toMatch(/déjà la version en vigueur/)
      }
      // Version 2 can come back in turn.
      await owner()
        .restore(v1.documentId, v2.id)
        .expect(201)
        .expect((r) => expect(r.body).toMatchObject({ version: 4, restoredFromVersion: 2 }))
      expect(stored.size).toBe(4)
    })

    it('answers 404 for a version of another document or another company, and 410 for a lost file', async () => {
      const bp = (await owner().upload('bp.pdf', PDF('1')).expect(201)).body
      await owner().upload('bp.pdf', PDF('2')).expect(201)
      const other = (await owner().upload('annexe.pdf', PDF('a')).expect(201)).body
      await owner().restore(other.documentId, bp.id).expect(404)
      await owner().restore(bp.documentId, 'unknown').expect(404)
      const foreign = await seedDocument(fake.prisma, { companyId: 'c-other', filename: 'x.pdf' })
      await owner()
        .restore(foreign.libraryDocumentId as string, foreign.id)
        .expect(404)
      await owner()
        .setType(foreign.libraryDocumentId as string, { type: 'other' })
        .expect(404)

      // A version whose file is lost cannot come back: nothing created.
      await storage().delete(fake.table('document').get(bp.id)!.storageKey as string)
      const lost = await owner().restore(bp.documentId, bp.id)
      expect(lost.status).toBe(410)
      expect(lost.body.error.message).toMatch(/perdu/)
      const own = [...fake.table('document').values()].filter((d) => d.companyId === 'c-d-1')
      expect(own).toHaveLength(3)
    })

    it('lets only the owner change the library: a financeur, another entrepreneur and an admin get 404', async () => {
      const v1 = (await owner().upload('bp.pdf', PDF('1'), { type: 'business_plan' }).expect(201))
        .body
      await owner().upload('bp.pdf', PDF('2')).expect(201)
      const { financeur, stranger, admin } = await others()

      // The financeur reads the document at their level with its type — deposited through this
      // dossier, it is selected following its latest version, the only one shown (E05.07)…
      const [seen] = (await financeur.list().expect(200)).body
      expect(seen).toMatchObject({ type: 'business_plan', current: { version: 2 } })
      expect(seen.versions.map((v: { version: number }) => v.version)).toEqual([2])
      expect(seen).not.toHaveProperty('selection')
      // …but neither uploads, retypes nor restores; nobody else even sees the dossier.
      for (const account of [financeur, stranger, admin]) {
        await account.upload('bp.pdf', PDF('3')).expect(404)
        await account.setType(v1.documentId, { type: 'other' }).expect(404)
        await account.restore(v1.documentId, v1.id).expect(404)
      }
      await stranger.list().expect(404)
      expect(fake.table('document').size).toBe(2)
      expect(fake.table('libraryDocument').get(v1.documentId)).toMatchObject({
        type: 'business_plan',
      })
      expect(journal('document_type_changed')).toHaveLength(0)
      expect(journal('document_version_restored')).toHaveLength(0)
    })
  })

  it('keeps an accented file name as typed (browsers send it in UTF-8)', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/dossiers/d-1/documents')
      .set('Authorization', `Bearer ${jwt}`)
      .attach('file', Buffer.from('%PDF-1.4 test'), 'Prévisionnel été.pdf')
      .expect(201)
    expect(res.body.filename).toBe('Prévisionnel été.pdf')
  })

  // Sends the headers and a first slice of the body, then waits: the answer must come without the
  // rest of the body (the server neither waits for it nor reads it).
  function rawUpload(
    headers: Record<string, string | number>,
  ): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
      const server = app.getHttpServer() as unknown as http.Server
      const { port } = server.address() as AddressInfo
      const req = http.request({
        host: '127.0.0.1',
        port,
        method: 'POST',
        path: '/v1/dossiers/d-1/documents',
        headers: {
          Authorization: `Bearer ${jwt}`,
          'Content-Type': 'multipart/form-data; boundary=x',
          ...headers,
        },
      })
      const timeout = setTimeout(() => {
        req.destroy()
        reject(new Error('no answer before the end of the body'))
      }, 3000)
      req.on('response', (res) => {
        let body = ''
        res.on('data', (d: Buffer) => (body += d.toString()))
        res.on('end', () => {
          clearTimeout(timeout)
          req.destroy()
          resolve({ status: res.statusCode ?? 0, body })
        })
      })
      req.on('error', () => undefined)
      req.write(
        '--x\r\nContent-Disposition: form-data; name="file"; filename="big.pdf"\r\n\r\n%PDF-',
      )
    })
  }

  it('answers 413 from the announced size, without waiting for or reading the body', async () => {
    await app.listen(0)
    const res = await rawUpload({ 'Content-Length': 25 * 1024 * 1024 })
    expect(res.status).toBe(413)
    expect(JSON.parse(res.body).error.message).toMatch(/20 Mo/)
    expect(fake.table('document').size).toBe(0)
  })

  it('refuses an upload whose size is not announced (411)', async () => {
    await app.listen(0)
    const res = await rawUpload({ 'Transfer-Encoding': 'chunked' })
    expect(res.status).toBe(411)
  })
})
