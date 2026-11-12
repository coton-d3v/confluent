import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { ZodValidationPipe } from 'nestjs-zod'
import request from 'supertest'
import type { App } from 'supertest/types'
import {
  PORTFOLIO_PAGE_SIZE,
  candidatureSupportPathSchema,
  portfolioSchema,
  receivedSupportPathSchema,
  supportStepSchema,
} from '@confluent/shared'
import { AppModule } from './../src/app.module'
import { GlobalExceptionFilter } from './../src/common/filters/global-exception.filter'
import { PrismaService } from './../src/prisma/prisma.service'
import { EMAIL_TRANSPORT } from './../src/modules/auth/email/email-transport'
import { createFakePrisma } from '../src/testing/fake-prisma'

const user = (n: number, email: string, role: string, firstName?: string) => ({
  id: `7d3c1b0e-0000-4000-8000-0000000013${n.toString().padStart(2, '0')}`,
  email,
  role,
  ...(firstName ? { firstName, lastName: 'Conseil' } : {}),
})
// Marie: manager of the CCI; Jean: conseiller of the CCI without the right to manage it; Claire:
// investisseur of the CCI; Paul: manager of the club deal. Sophie and Marc: entrepreneurs. Bob:
// recipient of a share of Sophie's request.
const MARIE = user(1, 'marie@cci.fr', 'financeur', 'Marie')
const JEAN = user(2, 'jean@cci.fr', 'financeur', 'Jean')
const CLAIRE = user(3, 'claire@angels.fr', 'financeur')
const PAUL = user(4, 'paul@club.fr', 'financeur')
const SOPHIE = user(5, 'sophie@biosensio.fr', 'entrepreneur')
const MARC = user(6, 'marc@agrotech.fr', 'entrepreneur')
const BOB = user(7, 'bob@banque.fr', 'financeur')
const ADMIN = user(8, 'admin@confluent.dev', 'admin')
const PEOPLE = [MARIE, JEAN, CLAIRE, PAUL, SOPHIE, MARC, BOB, ADMIN]
const VERSION = '7d3c1b0e-0000-4000-8000-0000000013f1'
const CONFLUENT_FORM = '7d3c1b0e-0000-4000-8000-0000000013f2'

const valid =
  (schema: { safeParse: (v: unknown) => { error?: { issues: unknown[] } } }) => (v: unknown) =>
    expect(schema.safeParse(v).error?.issues ?? []).toEqual([])

// ROADMAP E06.06 over HTTP on the stateful fake Prisma: each workspace's support path, configured by
// its managers and read by its conseillers; a candidature's path, read by its owner (never who
// validated) and, once sent, by the workspace's conseillers, who alone validate and reopen its steps
// — dated, with the validator, from the version read, kept in the history. Nobody else reads it.
describe('Support paths (e2e)', () => {
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

  // A published complementary form without question, assigned to the workspace's candidatures.
  async function openToCandidatures(designer: { id: string }, workspaceId: string) {
    const d = as(designer)
    const forms = `/v1/admin/workspaces/${workspaceId}/forms`
    const form = (await d.post(forms, { name: 'Candidature' }).expect(201)).body
    const section = (
      await d.post(`${forms}/${form.id}/draft/sections`, { title: 'Candidature' }).expect(201)
    ).body.sections[0]
    await d
      .post(`${forms}/${form.id}/draft/fields`, {
        sectionId: section.id,
        label: 'Commentaire',
        fieldType: 'textarea',
        required: false,
      })
      .expect(201)
    await d.post(`${forms}/${form.id}/draft/publish`).expect(200)
    await d.put(`${forms}/${form.id}/usage`, { usage: 'candidature' }).expect(200)
  }

  // A request of `owner` presented to both workspaces (drafts).
  async function present(owner: { id: string }, name: string) {
    const o = as(owner)
    const dossier = (await o.post('/v1/dossiers', { name }).expect(201)).body
    const candidaturesOf = `/v1/dossiers/${dossier.id}/candidatures`
    const toCci = (await o.post(candidaturesOf, { workspaceId: cci }).expect(201)).body
    const toClub = (await o.post(candidaturesOf, { workspaceId: club }).expect(201)).body
    const send = async (...ids: string[]) => {
      await o.post(`/v1/dossiers/${dossier.id}/submit`).expect(200)
      for (const id of ids) await o.post(`/v1/candidatures/${id}/submit`).expect(200)
    }
    return { dossier, toCci: toCci.id as string, toClub: toClub.id as string, send }
  }

  const stepsOf = (workspaceId: string) => `/v1/workspaces/${workspaceId}/support-steps`
  const managed = (workspaceId: string) => `/v1/admin/workspaces/${workspaceId}/support-steps`
  const own = (candidatureId: string) => `/v1/candidatures/${candidatureId}/support-path`
  const received = (workspaceId: string, candidatureId: string) =>
    `/v1/workspaces/${workspaceId}/candidatures/${candidatureId}/support-path`
  const stepId = async (workspaceId: string, key: string) =>
    (await as(ADMIN).get(stepsOf(workspaceId)).expect(200)).body.find(
      (s: { key: string }) => s.key === key,
    ).id as string
  const journal = (action: string) =>
    [...fake.table('auditLog').values()].filter((e) => e.actionType === action)

  it('gives each workspace the default path, read by its conseillers and configured by its managers', async () => {
    const list = (await as(JEAN).get(stepsOf(cci)).expect(200)).body
    list.forEach(valid(supportStepSchema))
    expect(list.map((s: { key: string; label: string }) => [s.key, s.label])).toEqual([
      ['diagnostic', 'Diagnostic'],
      ['business_plan', 'Business plan'],
      ['pitch', 'Pitch'],
    ])
    await as(CLAIRE).get(stepsOf(cci)).expect(403)
    for (const outsider of [SOPHIE, PAUL, BOB]) await as(outsider).get(stepsOf(cci)).expect(404)

    // Jean reads, does not configure; the club's manager does not reach the CCI.
    await as(JEAN).post(managed(cci), { label: 'Comité' }).expect(403)
    await as(PAUL).post(managed(cci), { label: 'Comité' }).expect(404)
    const marie = as(MARIE)
    const added = (
      await marie
        .post(managed(cci), {
          label: '  Passage en  comité ',
          explanation:
            'Le projet est présenté au comité.\r\n\r\n\r\nVotre conseiller vous y prépare. ',
        })
        .expect(201)
    ).body
    valid(supportStepSchema)(added)
    expect(added).toMatchObject({
      key: 'passage_en_comite',
      label: 'Passage en comité',
      explanation: 'Le projet est présenté au comité.\n\nVotre conseiller vous y prépare.',
      position: 3,
      active: true,
    })
    const taken = await marie.post(managed(cci), { label: 'pitch' }).expect(409)
    expect(taken.body.error.message).toBe('Une étape s’appelle déjà « Pitch » dans ce parcours.')
    const markup = await marie
      .post(managed(cci), { label: 'X', explanation: 'Lire <a href="x">ceci</a>' })
      .expect(400)
    expect(JSON.stringify(markup.body)).toContain('balises HTML')
    for (const body of [
      { label: '' },
      { label: 'x'.repeat(81) },
      { label: 'X', explanation: 'x'.repeat(1001) },
      { label: 'X', key: 'x' },
    ]) {
      await marie.post(managed(cci), body).expect(400)
    }
    // Renamed and explained again; the key never changes; deactivated, it stays listed.
    const renamed = (
      await marie
        .patch(`${managed(cci)}/${added.id}`, { label: 'Comité', explanation: null, active: false })
        .expect(200)
    ).body
    expect(renamed).toMatchObject({
      key: 'passage_en_comite',
      label: 'Comité',
      explanation: null,
      active: false,
    })
    const ids = list.map((s: { id: string }) => s.id)
    await marie.put(`${managed(cci)}/order`, { stepIds: ids }).expect(409)
    const reordered = (
      await marie.put(`${managed(cci)}/order`, { stepIds: [added.id, ...ids] }).expect(200)
    ).body
    expect(reordered.map((s: { key: string }) => s.key)).toEqual([
      'passage_en_comite',
      'diagnostic',
      'business_plan',
      'pitch',
    ])
    // The club keeps its own path.
    expect(
      (await as(PAUL).get(stepsOf(club)).expect(200)).body.map((s: { key: string }) => s.key),
    ).toEqual(['diagnostic', 'business_plan', 'pitch'])
    expect(
      journal('support_steps_updated').map((e) => (e.metadata as { change: string }).change),
    ).toEqual(['created', 'updated', 'reordered'])
  })

  it('shows the owner the path from the draft; the conseillers validate and reopen steps, dated, from the version read', async () => {
    await openToCandidatures(MARIE, cci)
    await openToCandidatures(PAUL, club)
    const { dossier, toCci, toClub, send } = await present(SOPHIE, 'Biosensio')
    const sophie = as(SOPHIE)
    const draft = (await sophie.get(own(toCci)).expect(200)).body
    valid(candidatureSupportPathSchema)(draft)
    expect(
      draft.steps.map((s: { key: string; validatedAt: null; version: number }) => [
        s.key,
        s.validatedAt,
        s.version,
      ]),
    ).toEqual([
      ['diagnostic', null, 0],
      ['business_plan', null, 0],
      ['pitch', null, 0],
    ])
    expect(draft.steps[0].explanation).toContain('conseiller')
    // The structure reaches no draft.
    await as(JEAN).get(received(cci, toCci)).expect(404)
    const diagnostic = await stepId(cci, 'diagnostic')
    await as(JEAN)
      .patch(`${received(cci, toCci)}/steps/${diagnostic}`, { validated: true, version: 0 })
      .expect(404)
    await send(toCci, toClub)

    // Jean, conseiller without the right to manage, validates the diagnostic.
    const jean = as(JEAN)
    const step = (id: string) => `${received(cci, toCci)}/steps/${id}`
    const validated = (
      await jean.patch(step(diagnostic), { validated: true, version: 0 }).expect(200)
    ).body
    valid(receivedSupportPathSchema)(validated)
    expect(validated.steps[0]).toMatchObject({
      key: 'diagnostic',
      validatedAt: expect.any(String),
      version: 1,
      validatedBy: { email: JEAN.email, firstName: 'Jean', lastName: 'Conseil' },
    })
    // Marie's screen still shows it never validated: refused, nothing overwritten.
    const stale = await as(MARIE)
      .patch(step(diagnostic), { validated: false, version: 0 })
      .expect(409)
    expect(stale.body.error).toEqual({
      code: 'CONFLICT',
      message:
        'Cette étape a été modifiée entre-temps : rechargez la page avant de la modifier à nouveau.',
      details: { currentVersion: 1 },
    })
    // Reopened from the current version, then validated again by Marie.
    await as(MARIE).patch(step(diagnostic), { validated: false, version: 1 }).expect(200)
    const again = (
      await as(MARIE).patch(step(diagnostic), { validated: true, version: 2 }).expect(200)
    ).body
    expect(
      again.history.map((h: { change: string; actor: { email: string } }) => [
        h.change,
        h.actor.email,
      ]),
    ).toEqual([
      ['validated', MARIE.email],
      ['reopened', MARIE.email],
      ['validated', JEAN.email],
    ])
    for (const body of [
      { validated: true },
      { validated: true, version: -1 },
      { validated: true, version: 3, validatedById: JEAN.id },
    ]) {
      await jean.patch(step(diagnostic), body).expect(400)
    }
    // A step of the club is unknown here.
    await jean.patch(step(await stepId(club, 'pitch')), { validated: true, version: 0 }).expect(404)

    // The owner sees when, never who; no history, no validator.
    const mine = (await sophie.get(own(toCci)).expect(200)).body
    valid(candidatureSupportPathSchema)(mine)
    expect(mine.steps[0]).toMatchObject({ key: 'diagnostic', validatedAt: expect.any(String) })
    expect(mine).not.toHaveProperty('history')
    expect(mine.steps[0]).not.toHaveProperty('validatedBy')
    for (const who of [MARIE, JEAN]) {
      expect(JSON.stringify(mine)).not.toContain(who.id)
      expect(JSON.stringify(mine)).not.toContain(who.email)
      expect(JSON.stringify(mine)).not.toContain(`"${who.firstName}"`)
    }
    // The owner never validates: there is no such route on the owner's side.
    await sophie
      .patch(`${own(toCci)}/steps/${diagnostic}`, { validated: true, version: 3 })
      .expect(404)

    // The manager deactivates the validated diagnostic: shown, flagged, frozen.
    await as(MARIE)
      .patch(`${managed(cci)}/${diagnostic}`, { active: false })
      .expect(200)
    const frozen = await jean.patch(step(diagnostic), { validated: false, version: 3 }).expect(409)
    expect(frozen.body.error.message).toBe(
      'L’étape « Diagnostic » ne fait plus partie du parcours de la structure.',
    )
    expect(
      (await sophie.get(own(toCci)).expect(200)).body.steps.map(
        (s: { key: string; active: boolean }) => [s.key, s.active],
      ),
    ).toEqual([
      ['diagnostic', false],
      ['business_plan', true],
      ['pitch', true],
    ])
    expect(
      journal('candidature_support_step_updated').map((e) => [
        e.actorId,
        e.dossierId,
        (e.metadata as { change: string }).change,
      ]),
    ).toEqual([
      [JEAN.id, dossier.id, 'validated'],
      [MARIE.id, dossier.id, 'reopened'],
      [MARIE.id, dossier.id, 'validated'],
    ])
  })

  it('keeps each workspace’s path to its parties: no other workspace, investor, account or share recipient', async () => {
    await openToCandidatures(MARIE, cci)
    await openToCandidatures(PAUL, club)
    await as(MARIE)
      .post(managed(cci), { label: 'Revue juridique', explanation: 'Statuts relus — QX4242.' })
      .expect(201)
    const { dossier, toCci, toClub, send } = await present(SOPHIE, 'Biosensio')
    await send(toCci, toClub)
    const pitch = await stepId(cci, 'pitch')
    await as(JEAN)
      .patch(`${received(cci, toCci)}/steps/${pitch}`, { validated: true, version: 0 })
      .expect(200)
    const body = { validated: true, version: 0 }

    // The club reads its own path, nothing validated, and never the CCI's.
    const clubPath = (await as(PAUL).get(received(club, toClub)).expect(200)).body
    expect(clubPath.steps.every((s: { validatedAt: null }) => s.validatedAt === null)).toBe(true)
    expect(JSON.stringify(clubPath)).not.toMatch(/QX4242|Revue juridique/)
    for (const path of [received(club, toCci), received(cci, toCci)]) {
      await as(PAUL).get(path).expect(404)
      await as(PAUL).patch(`${path}/steps/${pitch}`, body).expect(404)
    }
    // A CCI step through the club's candidature: unknown.
    await as(PAUL)
      .patch(`${received(club, toClub)}/steps/${pitch}`, body)
      .expect(404)

    // An investisseur of the CCI: 403; another entrepreneur, the owner on the workspace side, a
    // share recipient: 404.
    await as(CLAIRE).get(received(cci, toCci)).expect(403)
    await as(CLAIRE)
      .patch(`${received(cci, toCci)}/steps/${pitch}`, body)
      .expect(403)
    for (const outsider of [MARC, SOPHIE, BOB]) {
      await as(outsider).get(received(cci, toCci)).expect(404)
      await as(outsider)
        .patch(`${received(cci, toCci)}/steps/${pitch}`, body)
        .expect(404)
    }
    for (const outsider of [MARC, BOB, MARIE, PAUL, CLAIRE]) {
      await as(outsider).get(own(toCci)).expect(404)
    }
    const token = (
      await as(SOPHIE)
        .post(`/v1/dossiers/${dossier.id}/shares`, {
          recipientEmail: BOB.email,
          accessLevel: 'complet',
        })
        .expect(201)
    ).body.token as string
    for (const read of [
      (await as(BOB).get(`/v1/shares/${token}`).expect(200)).body,
      (await as(BOB).get(`/v1/dossiers/${dossier.id}`).expect(200)).body,
      (await as(BOB).get('/v1/dossiers').expect(200)).body,
      (await as(PAUL).get(`/v1/workspaces/${club}/candidatures/${toClub}`).expect(200)).body,
      (await as(PAUL).get(`/v1/workspaces/${club}/candidatures`).expect(200)).body,
    ]) {
      expect(JSON.stringify(read)).not.toMatch(/QX4242|Revue juridique|Diagnostic|validatedAt/)
    }
    // Nothing was written by the refused calls.
    expect(fake.table('candidatureStepValidation').size).toBe(1)
    expect(fake.table('candidatureStepValidationChange').size).toBe(1)
  })

  // ── E06.07: the phase and the portfolio ──────────────────────────────────────────────────────

  const portfolio = (workspaceId: string, query = '') =>
    `/v1/workspaces/${workspaceId}/portfolio${query ? `?${query}` : ''}`

  it('states the phase to the owner and the conseillers, and gives the conseillers their portfolio by phase', async () => {
    await openToCandidatures(MARIE, cci)
    await openToCandidatures(PAUL, club)
    const bio = await present(SOPHIE, 'Biosensio')
    const agro = await present(MARC, 'Agrotech')
    // The owner sees the phase of a draft: in preparation, at the first step.
    const draft = (await as(SOPHIE).get(own(bio.toCci)).expect(200)).body
    valid(candidatureSupportPathSchema)(draft)
    expect(draft.progress).toMatchObject({
      phase: 'in_progress',
      validatedSteps: 0,
      totalSteps: 3,
      currentStep: { label: 'Diagnostic' },
    })
    await bio.send(bio.toCci, bio.toClub)
    await agro.send(agro.toCci)
    const jean = as(JEAN)
    for (const key of ['diagnostic', 'business_plan', 'pitch']) {
      const path = (
        await jean
          .patch(`${received(cci, bio.toCci)}/steps/${await stepId(cci, key)}`, {
            validated: true,
            version: 0,
          })
          .expect(200)
      ).body
      valid(receivedSupportPathSchema)(path)
    }
    expect((await as(SOPHIE).get(own(bio.toCci)).expect(200)).body.progress).toEqual({
      phase: 'ready',
      validatedSteps: 3,
      totalSteps: 3,
      currentStep: null,
    })
    // The club's path of the same request is its own: nothing validated there.
    expect((await as(SOPHIE).get(own(bio.toClub)).expect(200)).body.progress.phase).toBe(
      'in_progress',
    )

    const all = (await jean.get(portfolio(cci)).expect(200)).body
    valid(portfolioSchema)(all)
    expect(all.counts).toMatchObject({
      total: 2,
      phases: { in_progress: 1, ready: 1, no_path: 0 },
    })
    expect(
      all.counts.steps.map((x: { label: string; count: number }) => [x.label, x.count]),
    ).toEqual([
      ['Diagnostic', 1],
      ['Business plan', 0],
      ['Pitch', 0],
    ])
    expect(all).toMatchObject({ total: 2, page: 1, pageSize: PORTFOLIO_PAGE_SIZE })
    expect(
      all.items.map((i: { id: string; progress: { phase: string } }) => [i.id, i.progress.phase]),
    ).toEqual([
      [agro.toCci, 'in_progress'],
      [bio.toCci, 'ready'],
    ])
    const ready = (await as(MARIE).get(portfolio(cci, 'phase=ready')).expect(200)).body
    expect(ready.items.map((i: { id: string }) => i.id)).toEqual([bio.toCci])
    expect(ready.counts.total).toBe(2)
    const diagnostic = await stepId(cci, 'diagnostic')
    expect(
      (await jean.get(portfolio(cci, `step=${diagnostic}`)).expect(200)).body.items.map(
        (i: { id: string }) => i.id,
      ),
    ).toEqual([agro.toCci])
    expect(
      (await jean.get(portfolio(cci, 'financingStatus=in_committee')).expect(200)).body.counts
        .total,
    ).toBe(0)
    expect((await jean.get(portfolio(cci, 'page=2')).expect(200)).body).toMatchObject({
      page: 2,
      total: 2,
      items: [],
    })
    for (const query of ['phase=prete', 'step=diagnostic', 'page=0', 'page=x', 'sort=name']) {
      await jean.get(portfolio(cci, query)).expect(400)
    }
    // The administrator reads it too.
    expect((await as(ADMIN).get(portfolio(cci)).expect(200)).body.counts.total).toBe(2)
  })

  it('keeps the portfolio to the workspace’s conseillers, over its own candidatures only', async () => {
    await openToCandidatures(MARIE, cci)
    await openToCandidatures(PAUL, club)
    await as(MARIE).post(managed(cci), { label: 'Revue juridique QX4242' }).expect(201)
    const bio = await present(SOPHIE, 'Biosensio QX4343')
    await bio.send(bio.toClub)
    const agro = await present(MARC, 'Agrotech')
    await agro.send(agro.toCci)
    // Sophie's request was sent to the club only: its draft to the CCI stays out of the CCI's.
    const cciView = (await as(JEAN).get(portfolio(cci)).expect(200)).body
    expect(cciView.items.map((i: { id: string }) => i.id)).toEqual([agro.toCci])
    expect(JSON.stringify(cciView)).not.toContain('QX4343')
    // The club sees its own candidature, its own steps, nothing of the CCI.
    const clubView = (await as(PAUL).get(portfolio(club)).expect(200)).body
    expect(clubView.items.map((i: { id: string }) => i.id)).toEqual([bio.toClub])
    expect(JSON.stringify(clubView)).not.toMatch(/QX4242|Agrotech/)
    // An investisseur of the CCI: 403; the club's manager, the entrepreneurs, a stranger: 404;
    // nobody signed in: 401.
    await as(CLAIRE).get(portfolio(cci)).expect(403)
    for (const outsider of [PAUL, SOPHIE, MARC, BOB]) {
      await as(outsider).get(portfolio(cci)).expect(404)
    }
    await request(app.getHttpServer()).get(portfolio(cci)).expect(401)
    // An unknown workspace answers like a workspace one is not in.
    await as(JEAN).get(portfolio('7d3c1b0e-0000-4000-8000-0000000013ff')).expect(404)
  })
})
