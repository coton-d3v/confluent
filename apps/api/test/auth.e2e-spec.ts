import { Test, TestingModule } from '@nestjs/testing'
import { INestApplication } from '@nestjs/common'
import request from 'supertest'
import type { App } from 'supertest/types'
import cookieParser from 'cookie-parser'
import { AppModule } from './../src/app.module'
import { PrismaService } from './../src/prisma/prisma.service'
import { EMAIL_TRANSPORT } from './../src/modules/auth/email/email-transport'
import { ZodValidationPipe } from 'nestjs-zod'
import { GlobalExceptionFilter } from './../src/common/filters/global-exception.filter'
import { REFRESH_COOKIE_NAME } from './../src/modules/auth/auth.constants'

describe('AuthController (e2e)', () => {
  let app: INestApplication<App>
  let sendMagicLink: jest.Mock
  let findUnique: jest.Mock
  let userUpdate: jest.Mock
  let tokenFindUnique: jest.Mock
  let tokenUpdate: jest.Mock
  let tokenUpdateMany: jest.Mock
  let sessions: Map<string, Record<string, unknown>>
  let tokenCreate: jest.Mock
  let auditCreate: jest.Mock

  beforeEach(async () => {
    sendMagicLink = jest.fn().mockResolvedValue(undefined)
    findUnique = jest.fn()
    userUpdate = jest.fn().mockResolvedValue({})
    tokenFindUnique = jest.fn()
    tokenUpdate = jest.fn().mockResolvedValue({})
    tokenUpdateMany = jest.fn().mockResolvedValue({ count: 1 })
    sessions = new Map()
    let sessionSeq = 0
    tokenCreate = jest.fn().mockResolvedValue({})
    auditCreate = jest.fn().mockResolvedValue({})
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(
        withTransactions({
          onModuleInit: async () => {},
          onModuleDestroy: async () => {},
          user: { findUnique, update: userUpdate },
          magicLinkToken: {
            create: tokenCreate,
            findUnique: tokenFindUnique,
            update: tokenUpdate,
            updateMany: tokenUpdateMany,
          },
          // Stateful refresh_sessions so rotation/logout can be exercised end to end over HTTP.
          refreshSession: {
            create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
              const row = { id: `rs-${++sessionSeq}`, revokedAt: null, replacedById: null, ...data }
              sessions.set(row.id, row)
              return row
            }),
            findUnique: jest.fn(async ({ where }: { where: { id: string } }) =>
              sessions.has(where.id) ? { ...sessions.get(where.id) } : null,
            ),
            update: jest.fn(async ({ where, data }: { where: { id: string }; data: object }) =>
              Object.assign(sessions.get(where.id)!, data),
            ),
            updateMany: jest.fn(
              async ({ where, data }: { where: Record<string, unknown>; data: object }) => {
                let count = 0
                for (const row of sessions.values()) {
                  if (Object.entries(where).every(([k, v]) => row[k] === v)) {
                    Object.assign(row, data)
                    count++
                  }
                }
                return { count }
              },
            ),
          },
          auditLog: { create: auditCreate },
        }),
      )
      .overrideProvider(EMAIL_TRANSPORT)
      .useValue({ sendMagicLink, sendShareInvite: jest.fn() })
      .compile()

    app = moduleFixture.createNestApplication()
    app.use(cookieParser())
    app.setGlobalPrefix('v1', { exclude: ['/'] })
    app.useGlobalPipes(new ZodValidationPipe())
    app.useGlobalFilters(new GlobalExceptionFilter())
    await app.init()
  })

  afterEach(async () => {
    await app.close()
  })

  it('POST /v1/auth/magic-link — known user: 200 + email dispatched', async () => {
    findUnique.mockResolvedValue({ id: 'u1', email: 'sophie@biosensio.fr' })
    const res = await request(app.getHttpServer())
      .post('/v1/auth/magic-link')
      .send({ email: 'sophie@biosensio.fr' })
      .expect(200)
    expect(res.body).toEqual({ message: 'Magic link sent.' })
    expect(sendMagicLink).toHaveBeenCalledTimes(1)
  })

  it('POST /v1/auth/magic-link — unknown user: 200 + no email', async () => {
    findUnique.mockResolvedValue(null)
    const res = await request(app.getHttpServer())
      .post('/v1/auth/magic-link')
      .send({ email: 'unknown@example.com' })
      .expect(200)
    expect(res.body).toEqual({ message: 'Magic link sent.' })
    expect(sendMagicLink).not.toHaveBeenCalled()
  })

  it('POST /v1/auth/magic-link — invalid email body: 400 VALIDATION_ERROR', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/auth/magic-link')
      .send({ email: 'not-an-email' })
      .expect(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('GET /v1/auth/verify — valid token: 200 + access token + refresh cookie', async () => {
    tokenFindUnique.mockResolvedValue({
      id: 'mlt-1',
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: null,
      user: {
        id: 'u1',
        email: 'sophie@biosensio.fr',
        role: 'entrepreneur',
        isActive: true,
        emailVerifiedAt: new Date(),
      },
    })
    const res = await request(app.getHttpServer())
      .get('/v1/auth/verify')
      .query({ token: '123e4567-e89b-42d3-a456-556642440000' })
      .expect(200)
    expect(res.body.accessToken).toBeDefined()
    expect(res.body.user).toEqual({
      id: 'u1',
      email: 'sophie@biosensio.fr',
      role: 'entrepreneur',
    })
    const setCookie = res.headers['set-cookie'] as unknown as string[] | undefined
    expect(setCookie?.some((c) => c.startsWith(`${REFRESH_COOKIE_NAME}=`))).toBe(true)
  })

  it('GET /v1/auth/verify — expired token: 401 INVALID_TOKEN', async () => {
    // The conditional update (consumedAt null AND expiresAt > now) matches nothing.
    tokenUpdateMany.mockResolvedValue({ count: 0 })
    tokenFindUnique.mockResolvedValue({
      id: 'mlt-2',
      expiresAt: new Date(Date.now() - 60_000),
      consumedAt: null,
      user: {
        id: 'u1',
        email: 'sophie@biosensio.fr',
        role: 'entrepreneur',
        emailVerifiedAt: new Date(),
      },
    })
    const res = await request(app.getHttpServer())
      .get('/v1/auth/verify')
      .query({ token: '123e4567-e89b-42d3-a456-556642440001' })
      .expect(401)
    expect(res.body.error.code).toBe('UNAUTHORIZED')
  })

  it('GET /v1/auth/verify — non-uuid token: 400 VALIDATION_ERROR', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/auth/verify')
      .query({ token: 'not-a-uuid' })
      .expect(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('verify → refresh rotates the cookie → logout → the refresh cookie is dead', async () => {
    const user = {
      id: 'u1',
      email: 'sophie@biosensio.fr',
      role: 'entrepreneur',
      isActive: true,
      emailVerifiedAt: new Date(),
    }
    findUnique.mockResolvedValue(user)
    tokenFindUnique.mockResolvedValue({
      id: 'mlt-3',
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: null,
      user,
    })
    const cookieOf = (res: request.Response) =>
      ((res.headers['set-cookie'] as unknown as string[]) ?? [])
        .find((c) => c.startsWith(`${REFRESH_COOKIE_NAME}=`))!
        .split(';')[0]

    const login = await request(app.getHttpServer())
      .get('/v1/auth/verify')
      .query({ token: '123e4567-e89b-42d3-a456-556642440002' })
      .expect(200)
    const firstCookie = cookieOf(login)

    const refreshed = await request(app.getHttpServer())
      .post('/v1/auth/refresh')
      .set('Cookie', firstCookie)
      .expect(200)
    const secondCookie = cookieOf(refreshed)
    expect(secondCookie).not.toBe(firstCookie)

    await request(app.getHttpServer())
      .post('/v1/auth/logout')
      .set('Cookie', secondCookie)
      .expect(200)
    await request(app.getHttpServer())
      .post('/v1/auth/refresh')
      .set('Cookie', secondCookie)
      .expect(401)
    expect([...sessions.values()].every((s) => s.revokedAt !== null)).toBe(true)
  })

  it('POST /v1/auth/logout — clears the refresh cookie', async () => {
    const res = await request(app.getHttpServer()).post('/v1/auth/logout').expect(200)
    expect(res.body).toEqual({ message: 'Logged out.' })
    const setCookie = res.headers['set-cookie'] as unknown as string[] | undefined
    expect(setCookie?.some((c) => c.startsWith(`${REFRESH_COOKIE_NAME}=`))).toBe(true)
  })

  it('GET / — health is public and still reachable without auth', async () => {
    const res = await request(app.getHttpServer()).get('/').expect(200)
    expect(res.body).toEqual({ status: 'ok', service: 'confluent-api', version: 'dev' })
  })
})

// Locks and transactions of the session service have no effect in memory (see test/pg for real
// concurrency): the transaction callback runs on the same mock.
function withTransactions<T extends object>(prisma: T) {
  const client = Object.assign(prisma, {
    $queryRaw: jest.fn(() => Promise.resolve([])),
    $transaction: jest.fn((fn: (tx: unknown) => unknown): unknown => fn(client)),
  })
  return client
}
