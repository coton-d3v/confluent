import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { ZodValidationPipe } from 'nestjs-zod'
import request from 'supertest'
import type { App } from 'supertest/types'
import { GlobalExceptionFilter } from './../src/common/filters/global-exception.filter'
import { PrismaService } from './../src/prisma/prisma.service'
import { EMAIL_TRANSPORT } from './../src/modules/auth/email/email-transport'
import { MemoryStorageAdapter } from './../src/modules/documents/storage/memory-storage.adapter'
import { STORAGE_TOKEN } from './../src/modules/documents/storage/storage.adapter'
import { createFakePrisma } from '../src/testing/fake-prisma'

const id = (n: number) => `7d3c1b0e-0000-4000-8000-${n.toString().padStart(12, '0')}`
const SOPHIE = { id: id(1), email: 'sophie@biosensio.fr', role: 'entrepreneur' }
const BOB = { id: id(2), email: 'bob@invest.fr', role: 'financeur' }
const ADMIN = { id: id(3), email: 'admin@confluent.fr', role: 'admin' }

// The API as the production image runs it: NODE_ENV=production, an S3 driver (the bucket itself is
// replaced by memory below: nothing leaves the process).
const PRODUCTION_ENV: Record<string, string> = {
  NODE_ENV: 'production',
  STORAGE_DRIVER: 's3',
  SWAGGER_ENABLED: 'false',
}

// ROADMAP E10.06: nothing lets a request act as another account. In production configuration the
// identity is the signed access token's subject, its role read from the database: no header, query
// parameter or role claim changes it, and the « Voir comme le destinataire » preview is a projection
// that mints no session, link or token. The operator command that signs a token for an account is
// refused outside development and tests.
describe('Impersonation (e2e, production configuration)', () => {
  let app: INestApplication<App>
  let fake: ReturnType<typeof createFakePrisma>
  const saved: Record<string, string | undefined> = {}
  const sign = (user: { id: string; email: string }, role: string) =>
    new JwtService().signAsync(
      { sub: user.id, email: user.email, role },
      { secret: process.env.JWT_SECRET },
    )

  beforeAll(async () => {
    for (const [key, value] of Object.entries(PRODUCTION_ENV)) {
      saved[key] = process.env[key]
      process.env[key] = value
    }
    fake = createFakePrisma()
    for (const u of [SOPHIE, BOB, ADMIN]) {
      await fake.prisma.user.create({ data: { ...u, emailVerifiedAt: new Date() } })
    }
    // Imported once the environment is set: the configuration is validated at import.
    const { AppModule } = await import('./../src/app.module')
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(fake.prisma)
      .overrideProvider(EMAIL_TRANSPORT)
      .useValue({ sendMagicLink: jest.fn(), sendShareInvite: jest.fn() })
      .overrideProvider(STORAGE_TOKEN)
      .useValue(new MemoryStorageAdapter())
      .compile()
    app = moduleFixture.createNestApplication()
    app.setGlobalPrefix('v1', { exclude: ['/'] })
    app.useGlobalPipes(new ZodValidationPipe())
    app.useGlobalFilters(new GlobalExceptionFilter())
    await app.init()
  })

  afterAll(async () => {
    await app.close()
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  it('runs with the production configuration', () => {
    expect(app.get(PrismaService)).toBe(fake.prisma)
    expect(process.env.NODE_ENV).toBe('production')
  })

  it('ignores every header or query parameter naming another account', async () => {
    const sophie = await sign(SOPHIE, 'entrepreneur')
    await request(app.getHttpServer())
      .post('/v1/dossiers')
      .set('Authorization', `Bearer ${sophie}`)
      .send({ name: 'Biosensio QX' })
      .expect(201)
    const bob = await sign(BOB, 'financeur')
    const query = `as=admin&asUser=${SOPHIE.id}&userId=${SOPHIE.id}&impersonate=${SOPHIE.email}`
    const pretend = (req: request.Test) =>
      req
        .set('Authorization', `Bearer ${bob}`)
        .set('X-User-Id', SOPHIE.id)
        .set('X-User', SOPHIE.email)
        .set('X-Impersonate', SOPHIE.id)
        .set('X-Forwarded-User', ADMIN.email)
        .set('X-Dev-Role', 'admin')
        .set('Cookie', 'confluent_dev_role=admin')
    // Bob's own (empty) list, not Sophie's request.
    const own = await pretend(request(app.getHttpServer()).get(`/v1/dossiers?${query}`)).expect(200)
    expect(JSON.stringify(own.body)).not.toContain('QX')
    await pretend(request(app.getHttpServer()).get(`/v1/admin/dossiers?${query}`)).expect(403)
    await pretend(request(app.getHttpServer()).get(`/v1/admin/users?${query}`)).expect(403)
    // Without a token, the same headers are nobody.
    await request(app.getHttpServer())
      .get(`/v1/dossiers?${query}`)
      .set('X-User-Id', SOPHIE.id)
      .set('X-Forwarded-User', ADMIN.email)
      .expect(401)
  })

  it('reads the role from the database, not from the token', async () => {
    const claimsAdmin = await sign(SOPHIE, 'admin')
    await request(app.getHttpServer())
      .get('/v1/admin/dossiers')
      .set('Authorization', `Bearer ${claimsAdmin}`)
      .expect(403)
    // An unsigned token for the administrator is nobody.
    const unsigned = [
      Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url'),
      Buffer.from(
        JSON.stringify({ sub: ADMIN.id, email: ADMIN.email, role: 'admin', exp: 4102444800 }),
      ).toString('base64url'),
      '',
    ].join('.')
    await request(app.getHttpServer())
      .get('/v1/admin/dossiers')
      .set('Authorization', `Bearer ${unsigned}`)
      .expect(401)
  })

  it('previews a request as its recipient without minting a session, a link or a token', async () => {
    const sophie = await sign(SOPHIE, 'entrepreneur')
    const admin = await sign(ADMIN, 'admin')
    const dossier = (
      await request(app.getHttpServer())
        .post('/v1/dossiers')
        .set('Authorization', `Bearer ${sophie}`)
        .send({ name: 'Aperçu QX' })
        .expect(201)
    ).body as { id: string }
    const sizes = () =>
      ['refreshSession', 'magicLinkToken', 'shareLink', 'oAuthToken', 'oAuthGrant'].map(
        (table) => fake.table(table).size,
      )
    const before = sizes()
    for (const level of ['public', 'partiel', 'complet']) {
      for (const [token, url] of [
        [sophie, `/v1/dossiers/${dossier.id}/share-preview?level=${level}`],
        [admin, `/v1/admin/dossiers/${dossier.id}/share-preview?level=${level}`],
      ]) {
        const res = await request(app.getHttpServer())
          .get(url)
          .set('Authorization', `Bearer ${token}`)
          .expect(200)
        expect(res.headers['set-cookie']).toBeUndefined()
        expect(res.body).not.toHaveProperty('accessToken')
        expect(res.body).not.toHaveProperty('share')
      }
    }
    expect(sizes()).toEqual(before)
  })
})

// `pnpm api:token <email>` signs an access token for any account: acting as it.
describe('Operator command api:token (impersonation guard)', () => {
  const apiDir = resolve(__dirname, '..')
  const tsx = join(apiDir, 'node_modules', '.bin', 'tsx')
  const script = join(apiDir, 'scripts', 'issue-token.ts')
  // Run from an empty directory, nothing reachable. (An unset NODE_ENV is refused too, but cannot be
  // shown here: the Prisma client reads apps/api/.env on import where a developer has one.)
  let cwd: string
  beforeAll(() => {
    cwd = mkdtempSync(join(tmpdir(), 'qx-api-token-'))
  })
  afterAll(() => rmSync(cwd, { recursive: true, force: true }))

  const run = (env: Record<string, string>) => {
    const { NODE_ENV: _ignored, CONFLUENT_ALLOW_DESTRUCTIVE: _neither, ...inherited } = process.env
    return spawnSync(tsx, [script, ADMIN.email], {
      cwd,
      encoding: 'utf8',
      timeout: 60_000,
      env: {
        ...inherited,
        DATABASE_URL: 'postgresql://qx:qx@127.0.0.1:1/qx',
        JWT_SECRET: 'q'.repeat(32),
        ...env,
      },
    })
  }

  it.each([
    ['production', { NODE_ENV: 'production' }],
    ['production, even forced', { NODE_ENV: 'production', CONFLUENT_ALLOW_DESTRUCTIVE: 'yes' }],
    ['an unknown environment', { NODE_ENV: 'staging' }],
  ])('is refused in %s, before reading any account', (_label, env) => {
    const result = run(env)
    expect(result.status).toBe(4)
    expect(result.stdout).toBe('')
    expect(result.stderr).toMatch(/réservé au développement et aux tests/)
  })

  it('goes past the guard in development (then fails here on the unreachable database)', () => {
    const result = run({ NODE_ENV: 'development' })
    expect(result.status).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).not.toMatch(/réservé au développement/)
  })
})
