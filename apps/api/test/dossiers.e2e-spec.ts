import { Test, TestingModule } from '@nestjs/testing'
import { INestApplication } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import request from 'supertest'
import type { App } from 'supertest/types'
import cookieParser from 'cookie-parser'
import { AppModule } from './../src/app.module'
import { PrismaService } from './../src/prisma/prisma.service'
import { EMAIL_TRANSPORT } from './../src/modules/auth/email/email-transport'
import { AuditService } from './../src/modules/audit/audit.service'
import { ZodValidationPipe } from 'nestjs-zod'
import { GlobalExceptionFilter } from './../src/common/filters/global-exception.filter'

describe('DossiersController (e2e)', () => {
  let app: INestApplication<App>
  let jwt: JwtService
  let token: string
  let dossierFindUnique: jest.Mock
  let dossierFindMany: jest.Mock
  let dossierCreate: jest.Mock
  let dossierUpdate: jest.Mock
  let dossierDelete: jest.Mock

  beforeAll(() => {
    process.env.JWT_SECRET = 'a'.repeat(32)
    process.env.JWT_REFRESH_SECRET = 'b'.repeat(32)
  })

  beforeEach(async () => {
    dossierFindUnique = jest.fn()
    dossierFindMany = jest.fn().mockResolvedValue([])
    dossierCreate = jest.fn()
    dossierUpdate = jest.fn()
    dossierDelete = jest.fn().mockResolvedValue({})

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue({
        onModuleInit: async () => {},
        onModuleDestroy: async () => {},
        user: {
          findUnique: jest
            .fn()
            .mockResolvedValue({ id: 'user-1', email: 'sophie@biosensio.fr', isActive: true }),
        },
        magicLinkToken: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
        shareLink: { findUnique: jest.fn() },
        dossier: {
          findUnique: dossierFindUnique,
          findMany: dossierFindMany,
          create: dossierCreate,
          update: dossierUpdate,
          delete: dossierDelete,
        },
        questionnaire: {
          findUnique: jest.fn().mockResolvedValue({ id: 'form-1', usage: 'dossier' }),
        },
        questionnaireVersion: {
          findFirst: jest.fn().mockResolvedValue({ id: 'qv-1', version: 1 }),
          create: jest.fn(),
        },
        auditLog: { create: jest.fn() },
      })
      .overrideProvider(EMAIL_TRANSPORT)
      .useValue({ sendMagicLink: jest.fn(), sendShareInvite: jest.fn() })
      .overrideProvider(AuditService)
      .useValue({ record: jest.fn() })
      .compile()

    app = moduleFixture.createNestApplication()
    app.use(cookieParser())
    app.setGlobalPrefix('v1', { exclude: ['/'] })
    app.useGlobalPipes(new ZodValidationPipe())
    app.useGlobalFilters(new GlobalExceptionFilter())
    await app.init()

    jwt = app.get(JwtService)
    token = await jwt.signAsync(
      { sub: 'user-1', email: 'sophie@biosensio.fr', role: 'entrepreneur' },
      { secret: process.env.JWT_SECRET, expiresIn: 60 },
    )
  })

  afterEach(async () => {
    await app.close()
  })

  it('GET /v1/dossiers — 401 without JWT', async () => {
    await request(app.getHttpServer()).get('/v1/dossiers').expect(401)
  })

  it('POST /v1/dossiers — creates + 201', async () => {
    dossierFindMany.mockResolvedValue([])
    dossierCreate.mockImplementation(async (args: { data: Record<string, unknown> }) =>
      Promise.resolve({
        id: 'd-1',
        createdAt: new Date(),
        updatedAt: new Date(),
        ...args.data,
      }),
    )
    const res = await request(app.getHttpServer())
      .post('/v1/dossiers')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Biosensio' })
      .expect(201)
    expect(res.body.name).toBe('Biosensio')
    expect(res.body.slug).toBe('biosensio')
  })

  it('GET /v1/dossiers — returns caller-scoped list', async () => {
    dossierFindMany.mockResolvedValue([{ id: 'd-1', userId: 'user-1', name: 'X', slug: 'x' }])
    const res = await request(app.getHttpServer())
      .get('/v1/dossiers')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
    expect(dossierFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-1' } }),
    )
    expect(res.body).toHaveLength(1)
  })

  it('GET /v1/dossiers/:id — 404 when dossier belongs to another user', async () => {
    dossierFindUnique.mockResolvedValue({ id: 'd-x', userId: 'other-user' })
    await request(app.getHttpServer())
      .get('/v1/dossiers/d-x')
      .set('Authorization', `Bearer ${token}`)
      .expect(404)
  })

  it('PATCH /v1/dossiers/:id — updates name + slug', async () => {
    dossierFindUnique.mockResolvedValue({ id: 'd-1', userId: 'user-1', name: 'Old', slug: 'old' })
    dossierFindMany.mockResolvedValue([])
    dossierUpdate.mockResolvedValue({ id: 'd-1', userId: 'user-1', name: 'New Name', slug: 'new-name' })
    const res = await request(app.getHttpServer())
      .patch('/v1/dossiers/d-1')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'New Name' })
      .expect(200)
    expect(res.body.slug).toBe('new-name')
  })

  it('DELETE /v1/dossiers/:id — 204', async () => {
    dossierFindUnique.mockResolvedValue({ id: 'd-1', userId: 'user-1' })
    await request(app.getHttpServer())
      .delete('/v1/dossiers/d-1')
      .set('Authorization', `Bearer ${token}`)
      .expect(204)
    expect(dossierDelete).toHaveBeenCalledWith({ where: { id: 'd-1' } })
  })
})
