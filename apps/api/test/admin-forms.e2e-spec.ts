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

describe('/v1/admin/forms (e2e)', () => {
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

  const call = (method: 'get' | 'post' | 'patch' | 'put' | 'delete', path: string, jwt = admin) =>
    request(app.getHttpServer())
      [method](`/v1/admin/forms${path}`)
      .set('Authorization', `Bearer ${jwt}`)

  it('builds, publishes and revises a form; the published version is never modified', async () => {
    const created = await call('post', '').send({ name: 'Candidature incubateur' }).expect(201)
    const formId = created.body.id as string
    expect(created.body).toMatchObject({ slug: 'candidature-incubateur', usage: null })

    let draft = await call('post', `/${formId}/draft/sections`)
      .send({ title: 'Projet' })
      .expect(201)
    const sectionId = draft.body.sections[0].id as string
    draft = await call('post', `/${formId}/draft/fields`)
      .send({
        sectionId,
        label: 'Stade',
        fieldType: 'select',
        required: true,
        choices: [{ label: 'Idée' }, { label: 'MVP' }],
      })
      .expect(201)
    expect(draft.body.fields[0]).toMatchObject({
      key: 'stade',
      minAccessLevel: 'complet',
      choices: [
        { key: 'idee', label: 'Idée' },
        { key: 'mvp', label: 'MVP' },
      ],
    })
    expect(draft.body.problems).toEqual([])

    const v1 = await call('post', `/${formId}/draft/publish`).expect(200)
    expect(v1.body.version).toMatchObject({ version: 1, status: 'published' })

    // No draft any more: structure edits are refused.
    await call('post', `/${formId}/draft/sections`).send({ title: 'Équipe' }).expect(404)

    draft = await call('post', `/${formId}/draft`).expect(201)
    await call('post', `/${formId}/draft`).expect(409)
    const fieldId = draft.body.fields[0].id as string
    await call('patch', `/${formId}/draft/fields/${fieldId}`)
      .send({
        choices: [
          { key: 'idee', label: 'Idée en cours' },
          { key: 'mvp', label: 'MVP' },
        ],
      })
      .expect(200)
    await call('post', `/${formId}/draft/publish`).expect(200)

    const original = await call('get', `/${formId}/versions/${v1.body.version.id}`).expect(200)
    expect(original.body.version.status).toBe('archived')
    expect(original.body.fields[0].choices[0]).toEqual({ key: 'idee', label: 'Idée' })

    const detail = await call('get', `/${formId}`).expect(200)
    expect(detail.body.versions.map((v: { status: string }) => v.status)).toEqual([
      'published',
      'archived',
    ])
  })

  it('stores limits that fit the field type and refuses the others', async () => {
    const created = await call('post', '').send({ name: 'Limites' }).expect(201)
    const formId = created.body.id as string
    const draft = await call('post', `/${formId}/draft/sections`)
      .send({ title: 'Projet' })
      .expect(201)
    const sectionId = draft.body.sections[0].id as string
    const ok = await call('post', `/${formId}/draft/fields`)
      .send({ sectionId, label: 'Pitch', fieldType: 'textarea', constraints: { maxLength: 500 } })
      .expect(201)
    expect(ok.body.fields[0].constraints).toEqual({ maxLength: 500 })
    const bad = await call('post', `/${formId}/draft/fields`)
      .send({ sectionId, label: 'Effectif', fieldType: 'number', constraints: { maxLength: 3 } })
      .expect(400)
    expect(bad.body.error.message).toBe('Ces limites ne correspondent pas au type du champ.')
    await call('post', `/${formId}/draft/fields`)
      .send({ sectionId, label: 'Effectif', fieldType: 'number', constraints: { inconnu: 1 } })
      .expect(400)
  })

  it('refuses to publish an incomplete draft, with the problems in error.details', async () => {
    const created = await call('post', '').send({ name: 'Vide' }).expect(201)
    const res = await call('post', `/${created.body.id}/draft/publish`).expect(422)
    expect(res.body.error.details).toEqual([expect.objectContaining({ code: 'EMPTY_FORM' })])
  })

  it('validates input and identifiers, and is reserved to administrators', async () => {
    await call('get', '', entrepreneur).expect(403)
    await call('get', '/pas-un-uuid').expect(400)
    await call('post', '').send({ name: '   ' }).expect(400)
    const created = await call('post', '').send({ name: 'Formulaire' }).expect(201)
    const draft = await call('post', `/${created.body.id}/draft/sections`)
      .send({ title: 'Section', key: 'Pas Une Clé' })
      .expect(400)
    expect(draft.body.error.code).toBe('VALIDATION_ERROR')
  })
})
