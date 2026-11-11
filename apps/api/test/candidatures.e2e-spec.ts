import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { ZodValidationPipe } from 'nestjs-zod'
import request from 'supertest'
import type { App } from 'supertest/types'
import {
  candidatureSchema,
  candidatureSummarySchema,
  candidatureWorkspaceSchema,
  formDetailSchema,
  formSummarySchema,
  receivedCandidatureSchema,
  receivedCandidatureSummarySchema,
} from '@confluent/shared'
import { AppModule } from './../src/app.module'
import { GlobalExceptionFilter } from './../src/common/filters/global-exception.filter'
import { PrismaService } from './../src/prisma/prisma.service'
import { EMAIL_TRANSPORT } from './../src/modules/auth/email/email-transport'
import { createFakePrisma } from '../src/testing/fake-prisma'

const user = (n: number, email: string, role: string) => ({
  id: `7d3c1b0e-0000-4000-8000-0000000009${n.toString().padStart(2, '0')}`,
  email,
  role,
})
// Marie: manager of the CCI; Jean: conseiller of the CCI without the right to manage it; Claire:
// investisseur of the CCI; Paul: manager of the club deal (financeur accounts, as invitations leave
// them). Sophie and Marc: entrepreneurs. Bob: recipient of a share of Sophie's request.
const MARIE = user(1, 'marie@cci.fr', 'financeur')
const JEAN = user(2, 'jean@cci.fr', 'financeur')
const CLAIRE = user(3, 'claire@angels.fr', 'financeur')
const PAUL = user(4, 'paul@club.fr', 'financeur')
const SOPHIE = user(5, 'sophie@biosensio.fr', 'entrepreneur')
const MARC = user(6, 'marc@agrotech.fr', 'entrepreneur')
const BOB = user(7, 'bob@banque.fr', 'financeur')
const ADMIN = user(8, 'admin@confluent.dev', 'admin')
const PEOPLE = [MARIE, JEAN, CLAIRE, PAUL, SOPHIE, MARC, BOB, ADMIN]
const VERSION = '7d3c1b0e-0000-4000-8000-0000000009f1'
const CONFLUENT_FORM = '7d3c1b0e-0000-4000-8000-0000000009f2'

const valid = <T>(schema: { safeParse: (v: unknown) => { error?: { issues: T[] } } }, v: unknown) =>
  expect(schema.safeParse(v).error?.issues ?? []).toEqual([])

// ROADMAP E05.09 over HTTP on the stateful fake Prisma: each workspace designs its own
// complementary form; a request presented to two workspaces reuses its company's profile and
// answers each form apart; no workspace, share recipient or other account reads another's answers.
describe('Workspace forms and candidatures (e2e)', () => {
  let app: INestApplication<App>
  let fake: ReturnType<typeof createFakePrisma>
  const tokens: Record<string, string> = {}
  let cci: string
  let club: string

  beforeEach(async () => {
    fake = createFakePrisma()
    const p = fake.prisma
    for (const u of PEOPLE) await p.user.create({ data: { ...u, emailVerifiedAt: new Date() } })
    await p.questionnaire.create({
      data: { id: CONFLUENT_FORM, slug: 'dossier', name: 'Profil', usage: 'dossier' },
    })
    await p.questionnaireVersion.create({
      data: { id: VERSION, questionnaireId: CONFLUENT_FORM, version: 1, status: 'published' },
    })
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(p)
      .overrideProvider(EMAIL_TRANSPORT)
      .useValue({
        sendMagicLink: jest.fn(),
        sendShareInvite: jest.fn().mockResolvedValue(undefined),
        sendWorkspaceInvite: jest.fn().mockResolvedValue(undefined),
      })
      .compile()
    app = moduleFixture.createNestApplication()
    app.setGlobalPrefix('v1', { exclude: ['/'] })
    app.useGlobalPipes(new ZodValidationPipe())
    app.useGlobalFilters(new GlobalExceptionFilter())
    await app.init()
    for (const u of PEOPLE) {
      tokens[u.id] = await new JwtService().signAsync(
        { sub: u.id, email: u.email, role: u.role },
        { secret: process.env.JWT_SECRET },
      )
    }
    const admin = as(ADMIN)
    cci = (await admin.post('/v1/admin/workspaces', { name: 'CCI Touraine' }).expect(201)).body.id
    club = (await admin.post('/v1/admin/workspaces', { name: 'Club deal' }).expect(201)).body.id
    const invite = (workspaceId: string, body: object) =>
      admin.post(`/v1/admin/workspaces/${workspaceId}/members`, body).expect(201)
    await invite(cci, { email: MARIE.email, role: 'conseiller', canManageWorkspace: true })
    await invite(cci, { email: JEAN.email, role: 'conseiller' })
    await invite(cci, { email: CLAIRE.email, role: 'investisseur' })
    await invite(club, { email: PAUL.email, role: 'conseiller', canManageWorkspace: true })
  })

  afterEach(async () => {
    await app.close()
  })

  const auth = (u: { id: string }) => `Bearer ${tokens[u.id]}`
  const as = (u: { id: string }) => ({
    get: (url: string) => request(app.getHttpServer()).get(url).set('Authorization', auth(u)),
    post: (url: string, body?: object) =>
      request(app.getHttpServer()).post(url).set('Authorization', auth(u)).send(body),
    put: (url: string, body: object) =>
      request(app.getHttpServer()).put(url).set('Authorization', auth(u)).send(body),
    patch: (url: string, body: object) =>
      request(app.getHttpServer()).patch(url).set('Authorization', auth(u)).send(body),
    delete: (url: string) => request(app.getHttpServer()).delete(url).set('Authorization', auth(u)),
  })
  const formsOf = (workspaceId: string) => `/v1/admin/workspaces/${workspaceId}/forms`

  // A complementary form designed by `designer` in the workspace, published and assigned to its
  // candidatures: one required question.
  async function complementaryForm(
    designer: { id: string },
    workspaceId: string,
    question: string,
  ) {
    const d = as(designer)
    const form = (
      await d.post(formsOf(workspaceId), { name: `Formulaire ${question}` }).expect(201)
    ).body
    const base = `${formsOf(workspaceId)}/${form.id}`
    const section = (await d.post(`${base}/draft/sections`, { title: 'Candidature' }).expect(201))
      .body.sections[0]
    const draft = (
      await d
        .post(`${base}/draft/fields`, {
          sectionId: section.id,
          label: question,
          fieldType: 'textarea',
          required: true,
        })
        .expect(201)
    ).body
    await d.post(`${base}/draft/publish`).expect(200)
    const assigned = (await d.put(`${base}/usage`, { usage: 'candidature' }).expect(200)).body
    valid(formDetailSchema, assigned)
    return { formId: form.id as string, fieldId: draft.fields[0].id as string, slug: form.slug }
  }

  it('lets each workspace’s managers design its forms, apart from Confluent’s and other workspaces’', async () => {
    const cciForm = await complementaryForm(MARIE, cci, 'Pourquoi la CCI ?')
    expect(cciForm.slug).toBe('cci-touraine--formulaire-pourquoi-la-cci')
    const list = (await as(MARIE).get(formsOf(cci)).expect(200)).body
    expect(list).toHaveLength(1)
    valid(formSummarySchema, list[0])
    expect(list[0]).toMatchObject({ id: cciForm.formId, usage: 'candidature' })
    // An administrator designs them too.
    await as(ADMIN)
      .get(`${formsOf(cci)}/${cciForm.formId}`)
      .expect(200)

    // Its other members: 403; whoever is not in it: the 404 of an unknown workspace.
    await as(JEAN).get(formsOf(cci)).expect(403)
    await as(CLAIRE).post(formsOf(cci), { name: 'Intrus' }).expect(403)
    for (const outsider of [PAUL, SOPHIE, BOB]) {
      await as(outsider).get(formsOf(cci)).expect(404)
      await as(outsider)
        .get(`${formsOf(cci)}/${cciForm.formId}`)
        .expect(404)
    }

    // Owners never cross: Confluent's builder does not list nor reach a workspace's form, a
    // workspace reaches neither Confluent's nor another workspace's.
    const confluent = (await as(ADMIN).get('/v1/admin/forms').expect(200)).body
    expect(confluent.map((f: { id: string }) => f.id)).toEqual([CONFLUENT_FORM])
    await as(ADMIN).get(`/v1/admin/forms/${cciForm.formId}`).expect(404)
    await as(MARIE).get('/v1/admin/forms').expect(403)
    await as(MARIE)
      .get(`${formsOf(cci)}/${CONFLUENT_FORM}`)
      .expect(404)
    await as(PAUL)
      .get(`${formsOf(club)}/${cciForm.formId}`)
      .expect(404)
    await as(PAUL)
      .patch(`${formsOf(club)}/${cciForm.formId}`, { name: 'Volé' })
      .expect(404)
    await as(ADMIN)
      .put(`${formsOf(club)}/${cciForm.formId}/usage`, { usage: 'candidature' })
      .expect(404)

    // A workspace's form serves its candidatures only, and asks for no attachment.
    const base = `${formsOf(cci)}/${cciForm.formId}`
    await as(MARIE).put(`${base}/usage`, { usage: 'dossier' }).expect(400)
    await as(ADMIN)
      .put(`/v1/admin/forms/${CONFLUENT_FORM}/usage`, { usage: 'candidature' })
      .expect(400)
    await as(MARIE).post(`${base}/draft`).expect(201)
    const draft = (await as(MARIE).get(`${base}/draft`).expect(200)).body
    const refused = await as(MARIE)
      .post(`${base}/draft/fields`, {
        sectionId: draft.sections[0].id,
        label: 'Plaquette',
        fieldType: 'file',
        required: false,
      })
      .expect(400)
    expect(refused.body.error.code).toBe('BAD_REQUEST')
  })

  it('presents one request to two workspaces with the same profile; each reads its own submitted answers only', async () => {
    const cciForm = await complementaryForm(MARIE, cci, 'Pourquoi la CCI ?')
    const clubForm = await complementaryForm(PAUL, club, 'Pourquoi le club ?')
    const sophie = as(SOPHIE)

    const open = (await sophie.get('/v1/candidature-workspaces').expect(200)).body
    expect(open.map((w: { name: string }) => w.name)).toEqual(['CCI Touraine', 'Club deal'])
    open.forEach((w: unknown) => valid(candidatureWorkspaceSchema, w))
    expect(Object.keys(open[0]).sort()).toEqual([
      'color',
      'id',
      'name',
      'presentation',
      'programName',
    ])
    await as(BOB).get('/v1/candidature-workspaces').expect(403)

    const dossier = (await sophie.post('/v1/dossiers', { name: 'Biosensio' }).expect(201)).body
    const candidaturesOf = `/v1/dossiers/${dossier.id}/candidatures`
    const toCci = (await sophie.post(candidaturesOf, { workspaceId: cci }).expect(201)).body
    const toClub = (await sophie.post(candidaturesOf, { workspaceId: club }).expect(201)).body
    valid(candidatureSchema, toCci)
    expect(toCci).toMatchObject({ status: 'draft', form: { fields: [{ id: cciForm.fieldId }] } })
    await sophie.post(candidaturesOf, { workspaceId: cci }).expect(409)
    await as(MARC).post(candidaturesOf, { workspaceId: cci }).expect(404)
    await sophie.post(candidaturesOf, { workspaceId: 'pas-un-uuid' }).expect(400)

    const answer = (id: string, fieldId: string, value: string, who = SOPHIE) =>
      as(who).put(`/v1/candidatures/${id}/answers`, { answers: [{ fieldId, value }] })
    await answer(toCci.id, cciForm.fieldId, 'Secret pour la CCI').expect(200)
    await answer(toClub.id, clubForm.fieldId, 'Secret pour le club').expect(200)
    // Another workspace's question is not this candidature's; another account writes nothing.
    await answer(toCci.id, clubForm.fieldId, 'Fuite').expect(400)
    await answer(toCci.id, cciForm.fieldId, 'Intrus', MARC).expect(404)
    await as(MARC).get(`/v1/candidatures/${toCci.id}`).expect(404)

    // Sending needs the profile submitted.
    await sophie.post(`/v1/candidatures/${toCci.id}/submit`).expect(422)
    await sophie.post(`/v1/dossiers/${dossier.id}/submit`).expect(200)
    const sent = (await sophie.post(`/v1/candidatures/${toCci.id}/submit`).expect(200)).body
    valid(candidatureSchema, sent)
    expect(sent.status).toBe('submitted')

    const mine = (await sophie.get(candidaturesOf).expect(200)).body
    mine.forEach((c: unknown) => valid(candidatureSummarySchema, c))
    expect(mine.map((c: { status: string }) => c.status).sort()).toEqual(['draft', 'submitted'])

    // The CCI's conseillers read its submitted candidature — the club's answer never.
    for (const reader of [MARIE, JEAN, ADMIN]) {
      const received = (await as(reader).get(`/v1/workspaces/${cci}/candidatures`).expect(200)).body
      expect(received.map((c: { id: string }) => c.id)).toEqual([toCci.id])
      valid(receivedCandidatureSummarySchema, received[0])
    }
    const read = (await as(JEAN).get(`/v1/workspaces/${cci}/candidatures/${toCci.id}`).expect(200))
      .body
    valid(receivedCandidatureSchema, read)
    expect(read).toMatchObject({
      applicant: { email: SOPHIE.email },
      company: { name: 'Biosensio' },
      form: { answers: [{ fieldId: cciForm.fieldId, value: 'Secret pour la CCI' }] },
    })
    expect(JSON.stringify(read)).not.toContain('Secret pour le club')

    // The club: its candidature is still a draft — nothing received; the CCI's is not its own.
    expect((await as(PAUL).get(`/v1/workspaces/${club}/candidatures`).expect(200)).body).toEqual([])
    await as(PAUL).get(`/v1/workspaces/${club}/candidatures/${toClub.id}`).expect(404)
    await as(PAUL).get(`/v1/workspaces/${club}/candidatures/${toCci.id}`).expect(404)
    await as(PAUL).get(`/v1/workspaces/${cci}/candidatures`).expect(404)
    await as(PAUL).get(`/v1/workspaces/${cci}/candidatures/${toCci.id}`).expect(404)
    // An investisseur of the CCI reads no candidature by membership; an entrepreneur nothing.
    await as(CLAIRE).get(`/v1/workspaces/${cci}/candidatures`).expect(403)
    await as(CLAIRE).get(`/v1/workspaces/${cci}/candidatures/${toCci.id}`).expect(403)
    await as(MARC).get(`/v1/workspaces/${cci}/candidatures/${toCci.id}`).expect(404)

    // A share of the request, at the highest level, shows none of the candidatures' answers.
    const token = (
      await sophie
        .post(`/v1/dossiers/${dossier.id}/shares`, {
          recipientEmail: BOB.email,
          accessLevel: 'complet',
        })
        .expect(201)
    ).body.token as string
    const seen = [
      (await as(BOB).get(`/v1/shares/${token}`).expect(200)).body,
      (await as(BOB).get(`/v1/dossiers/${dossier.id}`).expect(200)).body,
      (await as(BOB).get(`/v1/dossiers/${dossier.id}/answers`).expect(200)).body,
      (await as(BOB).get('/v1/dossiers').expect(200)).body,
    ]
    for (const body of seen) expect(JSON.stringify(body)).not.toMatch(/Secret pour/)
    await as(BOB).get(candidaturesOf).expect(404)
    await as(BOB).get(`/v1/candidatures/${toCci.id}`).expect(404)
    // Nor does the profile the request presents.
    const profile = (await sophie.get(`/v1/dossiers/${dossier.id}/answers`).expect(200)).body
    expect(JSON.stringify(profile)).not.toMatch(/Secret pour/)

    // Withdrawn: the CCI no longer reads it.
    await as(MARC).delete(`/v1/candidatures/${toCci.id}`).expect(404)
    await sophie.delete(`/v1/candidatures/${toCci.id}`).expect(204)
    expect((await as(MARIE).get(`/v1/workspaces/${cci}/candidatures`).expect(200)).body).toEqual([])
    await as(MARIE).get(`/v1/workspaces/${cci}/candidatures/${toCci.id}`).expect(404)
  })
})
