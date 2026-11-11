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
    await p.questionnaireVersion.create({
      data: { id: 'v-1', questionnaireId: 'form-1', version: 1, status: 'published' },
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
        sectionId: 's-presentation',
        label: 'Nom',
        fieldType: 'text',
        required: true,
        constraints: { maxLength: 40 },
        orderIndex: 0,
      },
    })
    await p.questionnaireField.create({
      data: {
        id: F_STAGE,
        versionId: 'v-1',
        sectionId: 's-presentation',
        label: 'Stade',
        fieldType: 'select',
        choices: [
          { key: 'mvp', label: 'MVP' },
          { key: 'seed', label: 'Seed' },
        ],
        orderIndex: 1,
      },
    })
    await p.questionnaireField.create({
      data: {
        id: F_OTHER_VERSION,
        versionId: 'v-2',
        sectionId: 's-identite',
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
      { fieldId: F_STAGE, value: 'mvp' },
    ]).expect(200)
    expect(fake.table('dossierAnswer').size).toBe(2)
  })

  it('applies the field limits set in the form builder (shared rules)', async () => {
    const res = await put([{ fieldId: F_NAME, value: 'x'.repeat(41) }]).expect(400)
    expect(res.body.error.details).toEqual([
      expect.objectContaining({ fieldId: F_NAME, message: '40 caractères maximum.' }),
    ])
  })

  it('stores the choice key when a list answer is sent by its exact label', async () => {
    await put([{ fieldId: F_STAGE, value: 'Seed' }]).expect(200)
    expect([...fake.table('dossierAnswer').values()].map((a) => a.value)).toEqual(['seed'])
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

  it('submits only once every required question is answered; then a required answer cannot be cleared', async () => {
    const submit = () =>
      request(app.getHttpServer())
        .post('/v1/dossiers/d-1/submit')
        .set('Authorization', `Bearer ${jwt}`)
    const incomplete = await submit().expect(422)
    expect(incomplete.body.error.details).toEqual([expect.objectContaining({ fieldId: F_NAME })])

    await put([{ fieldId: F_NAME, value: 'Biosensio' }]).expect(200)
    const done = await submit().expect(200)
    expect(done.body.submittedAt).toBeTruthy()

    await put([{ fieldId: F_NAME, value: 'Biosensio SAS' }]).expect(200)
    const cleared = await put([{ fieldId: F_NAME, value: '' }]).expect(400)
    expect(cleared.body.error.details[0].message).toContain('pas effacée')
  })

  describe('provenance (E04.04)', () => {
    const sign = (sub: string, email: string, role: string) =>
      new JwtService().signAsync({ sub, email, role }, { secret: process.env.JWT_SECRET })
    const get = (token: string) =>
      request(app.getHttpServer())
        .get('/v1/dossiers/d-1/answers')
        .set('Authorization', `Bearer ${token}`)

    it('records a site answer as the owner’s own confirmed input, whatever the client declares', async () => {
      const res = await request(app.getHttpServer())
        .put('/v1/dossiers/d-1/answers')
        .set('Authorization', `Bearer ${jwt}`)
        .send({
          answers: [
            {
              fieldId: F_NAME,
              value: 'Biosensio',
              origin: 'ai',
              confirmedByUser: false,
              source: { documentId: 'doc-x', excerpt: 'Biosensio' },
            },
          ],
        })
        .expect(200)
      const site = {
        origin: 'human',
        confirmation: 'confirmed',
        channel: 'site',
        authorId: 'u-1',
        clientName: null,
        recordedAt: expect.any(String),
        source: null,
      }
      expect(res.body).toEqual([
        expect.objectContaining({ fieldId: F_NAME, value: 'Biosensio', provenance: site }),
      ])
      const listed = await get(jwt).expect(200)
      expect(listed.body).toEqual([expect.objectContaining({ fieldId: F_NAME, provenance: site })])
    })

    it('says an answer saved before provenance was recorded has none, and records an administrator’s edit as such', async () => {
      await fake.prisma.dossierAnswer.create({
        data: { dossierId: 'd-1', fieldId: F_STAGE, value: 'mvp' },
      })
      await fake.prisma.user.create({
        data: {
          id: 'u-admin',
          email: 'admin@confluent.dev',
          role: 'admin',
          emailVerifiedAt: new Date(),
        },
      })
      await request(app.getHttpServer())
        .patch('/v1/admin/dossiers/d-1/answers')
        .set('Authorization', `Bearer ${await sign('u-admin', 'admin@confluent.dev', 'admin')}`)
        .send({ answers: [{ fieldId: F_NAME, value: 'Biosensio SAS' }] })
        .expect(200)
      const listed = await get(jwt).expect(200)
      const byField = Object.fromEntries(
        (listed.body as Array<{ fieldId: string; provenance: unknown }>).map((a) => [
          a.fieldId,
          a.provenance,
        ]),
      )
      expect(byField[F_STAGE]).toBeNull()
      expect(byField[F_NAME]).toMatchObject({
        origin: 'human',
        confirmation: 'confirmed',
        channel: 'admin',
        authorId: 'u-admin',
      })
    })

    it('never shows the provenance to a financeur', async () => {
      await fake.prisma.questionnaireField.update({
        where: { id: F_NAME },
        data: { minAccessLevel: 'public' },
      })
      await put([{ fieldId: F_NAME, value: 'Biosensio' }]).expect(200)
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
          accessLevel: 'complet',
          token: 't-1',
        },
      })
      const res = await get(await sign('u-fin', 'bob@invest.fr', 'financeur')).expect(200)
      expect(res.body).toEqual([
        {
          id: expect.any(String),
          dossierId: 'd-1',
          fieldId: F_NAME,
          value: 'Biosensio',
          createdAt: expect.any(String),
          updatedAt: expect.any(String),
        },
      ])
    })
  })
})
