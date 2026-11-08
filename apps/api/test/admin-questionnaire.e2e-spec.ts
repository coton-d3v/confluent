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
import { createFakePrisma } from '../src/testing/fake-prisma'

describe('POST /v1/admin/questionnaire/versions (e2e)', () => {
  let app: INestApplication<App>
  let fake: ReturnType<typeof createFakePrisma>
  let jwt: string

  beforeEach(async () => {
    fake = createFakePrisma()
    await fake.prisma.user.create({
      data: {
        id: 'admin-1',
        email: 'admin@confluent.dev',
        role: 'admin',
        emailVerifiedAt: new Date(),
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
      { sub: 'admin-1', email: 'admin@confluent.dev', role: 'admin' },
      { secret: process.env.JWT_SECRET },
    )
  })

  afterEach(async () => {
    await app.close()
  })

  const publish = (fields: unknown[]) =>
    request(app.getHttpServer())
      .post('/v1/admin/questionnaire/versions')
      .set('Authorization', `Bearer ${jwt}`)
      .send({ fields })

  const stageField = (choices: unknown[]) => ({
    section: 'Financement',
    key: 'stade_financement',
    label: 'Stade de financement',
    fieldType: 'select',
    orderIndex: 0,
    choices,
  })

  it('publishes list choices with their keys, explicit or derived from the label', async () => {
    const res = await publish([
      stageField([
        { key: 'fonds_propres_uniquement', label: 'Autofinancement' },
        { label: 'Seed' },
      ]),
    ]).expect(201)
    expect(res.body.status).toBe('published')
    const [field] = [...fake.table('questionnaireField').values()]
    expect(field.choices).toEqual([
      { key: 'fonds_propres_uniquement', label: 'Autofinancement' },
      { key: 'seed', label: 'Seed' },
    ])
    expect(field.required).toBe(false)
  })

  it('rejects duplicate choice keys and invalid keys, publishing nothing', async () => {
    await publish([
      stageField([
        { key: 'seed', label: 'Seed' },
        { key: 'seed', label: 'Seed 2' },
      ]),
    ]).expect(400)
    await publish([stageField([{ key: 'Pas Une Clé', label: 'X' }])]).expect(400)
    expect(fake.table('questionnaireVersion').size).toBe(0)
  })
})
