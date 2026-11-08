import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
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
})
