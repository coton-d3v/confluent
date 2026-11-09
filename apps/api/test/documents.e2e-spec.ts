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
import { createFakePrisma } from '../src/testing/fake-prisma'

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
    await fake.prisma.dossier.create({
      data: {
        id: 'd-1',
        userId: 'u-1',
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
