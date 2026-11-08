import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { ZodValidationPipe } from 'nestjs-zod'
import request from 'supertest'
import type { App } from 'supertest/types'
import { AppModule } from './../src/app.module'
import { GlobalExceptionFilter } from './../src/common/filters/global-exception.filter'
import { PrismaService } from './../src/prisma/prisma.service'
import { EMAIL_TRANSPORT } from './../src/modules/auth/email/email-transport'
import { DEFAULT_CLASSIFICATION_RULES } from '../src/testing/classification-rules.fixture'
import { createFakePrisma } from '../src/testing/fake-prisma'

describe('/v1/admin/classification (e2e)', () => {
  let app: INestApplication<App>
  let fake: ReturnType<typeof createFakePrisma>
  let admin: string
  let entrepreneur: string

  beforeEach(async () => {
    fake = createFakePrisma()
    for (const [id, role] of [
      ['admin-1', 'admin'],
      ['u-1', 'entrepreneur'],
    ]) {
      await fake.prisma.user.create({
        data: { id, email: `${id}@confluent.dev`, role, emailVerifiedAt: new Date() },
      })
    }
    await fake.prisma.classificationRule.createMany({ data: DEFAULT_CLASSIFICATION_RULES })
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
    const sign = (sub: string, role: string) =>
      new JwtService().signAsync(
        { sub, email: `${sub}@confluent.dev`, role },
        { secret: process.env.JWT_SECRET },
      )
    admin = await sign('admin-1', 'admin')
    entrepreneur = await sign('u-1', 'entrepreneur')
  })

  afterEach(async () => {
    await app.close()
  })

  const call = (method: 'get' | 'post' | 'patch' | 'delete', path: string, jwt = admin) =>
    request(app.getHttpServer())
      [method](`/v1/admin/classification${path}`)
      .set('Authorization', `Bearer ${jwt}`)

  it('lists, validates, creates, updates and deletes rules', async () => {
    const list = await call('get', '/rules').expect(200)
    expect(list.body).toHaveLength(DEFAULT_CLASSIFICATION_RULES.length)

    const invalid = await call('post', '/rules')
      .send({
        dimension: 'ancrage_cvl',
        fieldKey: 'ancrage_cvl',
        choiceKey: 'autre',
        value: 'inconnu',
      })
      .expect(400)
    expect(invalid.body.error.message).toContain('Valeur attendue parmi')
    await call('post', '/rules').send({ dimension: 'inconnue', fieldKey: 'x' }).expect(400)

    const created = await call('post', '/rules')
      .send({
        dimension: 'ancrage_cvl',
        fieldKey: 'ancrage_cvl',
        choiceKey: 'autre',
        value: 'découverte',
      })
      .expect(201)
    await call('post', '/rules')
      .send({
        dimension: 'ancrage_cvl',
        fieldKey: 'ancrage_cvl',
        choiceKey: 'autre',
        value: 'ancré',
      })
      .expect(409)
    const updated = await call('patch', `/rules/${created.body.id}`)
      .send({ value: 'en_cours' })
      .expect(200)
    expect(updated.body.value).toBe('en_cours')
    await call('delete', `/rules/${created.body.id}`).expect(204)
    await call('delete', `/rules/${created.body.id}`).expect(404)
  })

  it('serves coverage and an empty reclassification preview, to administrators only', async () => {
    await call('get', '/coverage').expect(200)
    const preview = await call('get', '/reclassification').expect(200)
    expect(preview.body).toEqual({ checked: 0, dossiers: [] })
    await call('post', '/reclassification').expect(200)
    await call('get', '/rules', entrepreneur).expect(403)
  })
})
