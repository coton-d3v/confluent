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

const F_NAME = '0f6f1b3e-1111-4111-8111-111111111111'
const F_STAGE = '0f6f1b3e-2222-4222-8222-222222222222'
const F_OTHER_VERSION = '0f6f1b3e-3333-4333-8333-333333333333'

describe('PUT /v1/dossiers/:id/answers (e2e)', () => {
  let app: INestApplication<App>
  let fake: ReturnType<typeof createFakePrisma>
  let jwt: string

  beforeEach(async () => {
    fake = createFakePrisma()
    const p = fake.prisma
    await p.user.create({
      data: {
        id: 'u-1',
        email: 'sophie@biosensio.fr',
        role: 'entrepreneur',
        emailVerifiedAt: new Date(),
      },
    })
    await p.dossier.create({
      data: {
        id: 'd-1',
        userId: 'u-1',
        name: 'Biosensio',
        slug: 'biosensio',
        questionnaireVersionId: 'v-1',
      },
    })
    await p.questionnaireField.create({
      data: {
        id: F_NAME,
        versionId: 'v-1',
        section: 'Présentation',
        label: 'Nom',
        fieldType: 'text',
        orderIndex: 0,
      },
    })
    await p.questionnaireField.create({
      data: {
        id: F_STAGE,
        versionId: 'v-1',
        section: 'Présentation',
        label: 'Stade',
        fieldType: 'select',
        options: ['MVP', 'Seed'],
        orderIndex: 1,
      },
    })
    await p.questionnaireField.create({
      data: {
        id: F_OTHER_VERSION,
        versionId: 'v-2',
        section: 'Identité',
        label: 'Nouveau',
        fieldType: 'text',
        orderIndex: 0,
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
    jwt = await new JwtService().signAsync(
      { sub: 'u-1', email: 'sophie@biosensio.fr', role: 'entrepreneur' },
      { secret: process.env.JWT_SECRET },
    )
  })

  afterEach(async () => {
    await app.close()
  })

  const put = (answers: Array<{ fieldId: string; value: string }>) =>
    request(app.getHttpServer())
      .put('/v1/dossiers/d-1/answers')
      .set('Authorization', `Bearer ${jwt}`)
      .send({ answers })

  it('saves answers that belong to the dossier version and fit their type', async () => {
    await put([
      { fieldId: F_NAME, value: 'Biosensio' },
      { fieldId: F_STAGE, value: 'Seed' },
    ]).expect(200)
    expect(fake.table('dossierAnswer').size).toBe(2)
  })

  it('rejects the whole batch with field-level details, writing nothing', async () => {
    const res = await put([
      { fieldId: F_NAME, value: 'ok' },
      { fieldId: F_STAGE, value: 'Série Z' },
      { fieldId: F_OTHER_VERSION, value: 'champ de la V2' },
    ]).expect(400)
    expect(res.body.error.code).toBe('BAD_REQUEST')
    expect(res.body.error.details.map((d: { fieldId: string }) => d.fieldId)).toEqual([
      F_STAGE,
      F_OTHER_VERSION,
    ])
    expect(fake.table('dossierAnswer').size).toBe(0)
  })
})
