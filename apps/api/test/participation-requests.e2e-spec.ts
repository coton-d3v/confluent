import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { ZodValidationPipe } from 'nestjs-zod'
import request from 'supertest'
import type { App } from 'supertest/types'
import {
  PARTICIPATION_FORM_TIMING,
  PARTICIPATION_REQUEST_LIMITS,
  participationFormSchema,
  participationRequestSchema,
} from '@confluent/shared'
import { AppModule } from './../src/app.module'
import { GlobalExceptionFilter } from './../src/common/filters/global-exception.filter'
import { PrismaService } from './../src/prisma/prisma.service'
import { EMAIL_TRANSPORT } from './../src/modules/auth/email/email-transport'
import { ParticipationFormTokens } from './../src/modules/participation-requests/participation-form-token'
import { PARTICIPATION_RATE_LIMITS } from './../src/modules/participation-requests/participation-requests.service'
import { createFakePrisma } from '../src/testing/fake-prisma'

// ROADMAP E08.04: a workspace's public participation form over HTTP — offered sessions only, as
// little of them as needed, a pending request that grants nothing, the same answer whoever the
// address is, and the anti-abuse guards.
const ACCOUNTS = {
  admin: { role: 'admin', email: 'admin@confluent.dev' },
  manager: { role: 'financeur', email: 'marie@cci-touraine.fr' },
  advisor: { role: 'financeur', email: 'luc@cci-touraine.fr' },
  investor: { role: 'financeur', email: 'claire@angels.fr' },
  clubManager: { role: 'financeur', email: 'paul@club-deal.fr' },
  // An account outside the CCI, whose address someone uses on its form.
  outsider: { role: 'financeur', email: 'eve@fonds.fr' },
} as const
type Account = keyof typeof ACCOUNTS

const JUNE = {
  name: 'Comité de juin',
  date: '2099-06-10',
  time: '14:00',
  timeZone: 'Europe/Paris',
  location: 'LIEU-PRIVE CCI Touraine, salle 2',
  meetingUrl: 'https://visio.example.org/LIEN-PRIVE',
  internalNotes: 'NOTE-INTERNE ordre du jour',
  sharedInfo: 'INFO-DIFFUSEE accueil à 13 h 45',
}
const SECRETS = /PRIVE|NOTE-INTERNE|INFO-DIFFUSEE|"version"|"workspaceId"|"location"|"meetingUrl"/

describe('participation requests (e2e)', () => {
  let app: INestApplication<App>
  let fake: ReturnType<typeof createFakePrisma>
  let mail: { sendMagicLink: jest.Mock }
  const jwt: Record<string, string> = {}
  let cci: string
  let club: string
  let june: string
  let ip = 0

  const call = (method: 'get' | 'post' | 'put', path: string, as: Account = 'admin') =>
    request(app.getHttpServer())[method](`/v1${path}`).set('Authorization', `Bearer ${jwt[as]}`)
  const manage = (workspaceId: string) => `/admin/workspaces/${workspaceId}/committees`
  // Each public call from its own network address unless told (the route's per-minute limit).
  const visitor = (address = `203.0.113.${++ip}`) => ({
    form: (slug: string) =>
      request(app.getHttpServer())
        .get(`/v1/public/workspaces/${slug}/participation-form`)
        .set('X-Forwarded-For', address),
    send: (slug: string, body: Record<string, unknown>) =>
      request(app.getHttpServer())
        .post(`/v1/public/workspaces/${slug}/participation-requests`)
        .set('X-Forwarded-For', address)
        .send(body),
  })
  // A token as the form gives it, old enough to be sent.
  const ready = (workspaceId = cci) =>
    app.get(ParticipationFormTokens).issue(workspaceId, Date.now() - 5000)
  const submission = (patch: Record<string, unknown> = {}) => ({
    name: 'Claire Martin',
    organization: 'Angels Touraine',
    email: 'nouvelle@investisseurs.fr',
    message: 'MESSAGE-PRIVE Je souhaite assister au comité.',
    committeeIds: [june],
    formToken: ready(),
    ...patch,
  })
  const plan = async (
    workspaceId: string,
    patch: Record<string, unknown> = {},
    as: Account = 'manager',
  ) =>
    (
      await call('post', manage(workspaceId), as)
        .send({ ...JUNE, ...patch })
        .expect(201)
    ).body as {
      id: string
      version: number
    }

  beforeEach(async () => {
    fake = createFakePrisma()
    for (const [id, { role, email }] of Object.entries(ACCOUNTS)) {
      await fake.prisma.user.create({ data: { id, email, role, emailVerifiedAt: new Date() } })
    }
    mail = { sendMagicLink: jest.fn() }
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(fake.prisma)
      .overrideProvider(EMAIL_TRANSPORT)
      .useValue({
        ...mail,
        sendShareInvite: jest.fn(),
        sendWorkspaceInvite: jest.fn().mockResolvedValue(undefined),
      })
      .compile()
    app = moduleFixture.createNestApplication()
    // As in production (main.ts): the client's address is the one the proxy saw.
    ;(app.getHttpAdapter().getInstance() as { set: (k: string, v: unknown) => void }).set(
      'trust proxy',
      1,
    )
    app.setGlobalPrefix('v1', { exclude: ['/'] })
    app.useGlobalPipes(new ZodValidationPipe())
    app.useGlobalFilters(new GlobalExceptionFilter())
    await app.init()
    for (const [id, { role, email }] of Object.entries(ACCOUNTS)) {
      jwt[id] = await new JwtService().signAsync(
        { sub: id, email, role },
        { secret: process.env.JWT_SECRET },
      )
    }
    const invite = (workspaceId: string, body: Record<string, unknown>) =>
      call('post', `/admin/workspaces/${workspaceId}/members`).send(body).expect(201)
    cci = (await call('post', '/admin/workspaces').send({ name: 'CCI Touraine' }).expect(201)).body
      .id
    club = (await call('post', '/admin/workspaces').send({ name: 'Club deal' }).expect(201)).body.id
    await invite(cci, {
      email: ACCOUNTS.manager.email,
      role: 'conseiller',
      canManageWorkspace: true,
    })
    await invite(cci, { email: ACCOUNTS.advisor.email, role: 'conseiller' })
    await invite(cci, { email: ACCOUNTS.investor.email, role: 'investisseur' })
    await invite(club, {
      email: ACCOUNTS.clubManager.email,
      role: 'conseiller',
      canManageWorkspace: true,
    })
    june = (await plan(cci, { participationRequestsOpen: true })).id
    fake.table('auditLog').clear()
  })

  afterEach(async () => {
    await app.close()
  })

  it('lets a manager offer a committee; the public form shows only offered sessions, by name and time', async () => {
    // Closed by default; an advisor reads the choice, only a manager makes it.
    const closed = await plan(cci, { name: 'Comité fermé', date: '2099-05-10' })
    const read = await call('get', `/workspaces/${cci}/committees/${closed.id}`, 'advisor').expect(
      200,
    )
    expect(read.body.participationRequestsOpen).toBe(false)
    await call('put', `${manage(cci)}/${closed.id}`, 'advisor')
      .send({ ...JUNE, participationRequestsOpen: true, version: 1 })
      .expect(403)

    const form = await visitor().form('cci-touraine').expect(200)
    expect(participationFormSchema.parse(form.body)).toEqual(form.body)
    expect(form.body).toEqual({
      workspace: { name: 'CCI Touraine', programName: null },
      committees: [
        {
          id: june,
          name: 'Comité de juin',
          date: '2099-06-10',
          time: '14:00',
          timeZone: 'Europe/Paris',
          startsAt: '2099-06-10T12:00:00.000Z',
        },
      ],
      formToken: expect.stringMatching(/^\d{13}\.[A-Za-z0-9_-]{43}$/),
    })
    expect(JSON.stringify(form.body)).not.toMatch(SECRETS)

    // Opened, it appears; an edit by a client that does not send the field keeps it open.
    await call('put', `${manage(cci)}/${closed.id}`, 'manager')
      .send({
        ...JUNE,
        name: 'Comité ouvert',
        date: '2099-05-10',
        participationRequestsOpen: true,
        version: 1,
      })
      .expect(200)
    const renamed = await call('put', `${manage(cci)}/${closed.id}`, 'manager')
      .send({ ...JUNE, name: 'Comité de mai', date: '2099-05-10', version: 2 })
      .expect(200)
    expect(renamed.body).toMatchObject({ participationRequestsOpen: true, version: 3 })
    const both = await visitor().form('cci-touraine').expect(200)
    expect(both.body.committees.map((c: { name: string }) => c.name)).toEqual([
      'Comité de mai',
      'Comité de juin',
    ])

    // Cancelled, it is no longer offered.
    await call('post', `${manage(cci)}/${closed.id}/status`, 'manager')
      .send({ status: 'cancelled', version: 3 })
      .expect(200)
    expect((await visitor().form('cci-touraine').expect(200)).body.committees).toHaveLength(1)
  })

  it('answers alike for an unknown workspace and one offering no session (no enumeration)', async () => {
    // The club has a committee, not offered; a past or cancelled offered one is not offered either.
    await plan(club, {}, 'clubManager')
    const past = await plan(
      club,
      { date: '2020-01-15', participationRequestsOpen: true },
      'clubManager',
    )
    expect(past.version).toBe(1)
    const answers = []
    for (const slug of ['club-deal', 'inconnu', 'pas-un-workspace-123', 'Majuscules', 'a']) {
      const form = await visitor().form(slug)
      const sent = await visitor().send(slug, submission({ formToken: ready(club) }))
      answers.push([form.status, form.body, sent.status, sent.body])
    }
    expect(new Set(answers.map((a) => JSON.stringify(a))).size).toBe(1)
    expect(answers[0]).toEqual([
      404,
      { error: expect.objectContaining({ code: 'NOT_FOUND' }) },
      404,
      { error: expect.objectContaining({ code: 'NOT_FOUND' }) },
    ])
    expect(fake.table('participationRequest').size).toBe(0)
  })

  it('records a pending request with the same answer whoever the address is — and grants it nothing', async () => {
    const users = fake.table('user').size
    const memberships = fake.table('workspaceMembership').size
    const answers = []
    // A new address, an account outside the CCI, a member of it, the same new address again.
    for (const email of [
      'Nouvelle@Investisseurs.fr ',
      ACCOUNTS.outsider.email,
      ACCOUNTS.investor.email,
      'nouvelle@investisseurs.fr',
    ]) {
      const res = await visitor().send('cci-touraine', submission({ email })).expect(202)
      answers.push(res.body)
    }
    expect(answers).toEqual(Array(4).fill({ message: 'Demande reçue.' }))
    const requests = [...fake.table('participationRequest').values()]
    expect(requests.map((r) => [r.email, r.status, r.submissionCount])).toEqual([
      ['nouvelle@investisseurs.fr', 'pending', 2],
      [ACCOUNTS.outsider.email, 'pending', 1],
      [ACCOUNTS.investor.email, 'pending', 1],
    ])

    // Nothing else: no account, no membership, no email sent — not even a sign-in link for the new
    // address, which has no account to sign in to.
    expect(fake.table('user').size).toBe(users)
    expect(fake.table('workspaceMembership').size).toBe(memberships)
    expect(mail.sendMagicLink).not.toHaveBeenCalled()
    await request(app.getHttpServer())
      .post('/v1/auth/magic-link')
      .send({ email: 'nouvelle@investisseurs.fr' })
      .expect(200)
    expect(mail.sendMagicLink).not.toHaveBeenCalled()
    expect(fake.table('user').size).toBe(users)
    // The outside account still reads nothing of the CCI.
    for (const path of [
      `/workspaces/${cci}`,
      `/workspaces/${cci}/committees`,
      `/workspaces/${cci}/committees/${june}`,
      `/admin/workspaces/${cci}/participation-requests`,
    ]) {
      expect([path, (await call('get', path, 'outsider')).status]).toEqual([path, 404])
    }
    expect(
      JSON.stringify((await call('get', '/workspaces/memberships', 'outsider').expect(200)).body),
    ).not.toContain(cci)

    // Journaled without the name, address or message.
    const journal = [...fake.table('auditLog').values()]
    expect(
      journal.map((e) => [e.actionType, e.actorId, (e.metadata as { merged: boolean }).merged]),
    ).toEqual([
      ['participation_request_received', null, false],
      ['participation_request_received', null, false],
      ['participation_request_received', null, false],
      ['participation_request_received', null, true],
    ])
    expect(JSON.stringify(journal)).not.toMatch(/investisseurs|fonds|angels|Claire|MESSAGE-PRIVE/)
  })

  it('validates and bounds what is sent', async () => {
    const refused = async (body: Record<string, unknown>) => {
      const res = await visitor().send('cci-touraine', body).expect(400)
      return res.body.error.details as Array<{ path: string[] }>
    }
    expect((await refused(submission({ name: ' ' })))[0].path).toEqual(['name'])
    expect((await refused(submission({ email: 'pas-une-adresse' })))[0].path).toEqual(['email'])
    expect((await refused(submission({ committeeIds: [] })))[0].path).toEqual(['committeeIds'])
    expect((await refused(submission({ message: '<a href="x">lien</a>' })))[0].path).toEqual([
      'message',
    ])
    expect((await refused(submission({ message: 'x'.repeat(2001) })))[0].path).toEqual(['message'])
    await refused({ ...submission(), role: 'admin' })
    const { formToken: _, ...withoutToken } = submission()
    expect((await refused(withoutToken))[0].path).toEqual(['formToken'])
    // A body beyond the parser's limit, or unreadable, is refused before anything is read.
    await visitor()
      .send('cci-touraine', submission({ message: 'x'.repeat(200_000) }))
      .expect(413)
    await request(app.getHttpServer())
      .post('/v1/public/workspaces/cci-touraine/participation-requests')
      .set('X-Forwarded-For', '203.0.113.250')
      .set('Content-Type', 'application/json')
      .send('{"name": ')
      .expect(400)
    expect(fake.table('participationRequest').size).toBe(0)
  })

  it('refuses a form sent too soon, too late or for another workspace, and a session not offered', async () => {
    const now = Date.now()
    const tokens = app.get(ParticipationFormTokens)
    // The token the page gives, sent straight away.
    const page = visitor()
    const form = await page.form('cci-touraine').expect(200)
    const fast = await page
      .send('cci-touraine', submission({ formToken: form.body.formToken }))
      .expect(400)
    expect(fast.body.error.details).toEqual({ reason: 'form_too_fast' })
    for (const formToken of [
      tokens.issue(cci, now - PARTICIPATION_FORM_TIMING.maxAgeMs - 1000),
      tokens.issue(club, now - 5000),
      `${now - 5000}.${'A'.repeat(43)}`,
      'n-importe-quoi',
    ]) {
      const res = await visitor().send('cci-touraine', submission({ formToken })).expect(400)
      expect([formToken, res.body.error.details]).toEqual([formToken, { reason: 'form_expired' }])
    }

    // Not opened, cancelled, past, another workspace's, unknown: the same refusal.
    const notOpened = (await plan(cci, { name: 'Pas ouvert' })).id
    const cancelled = await plan(cci, { name: 'Annulé', participationRequestsOpen: true })
    await call('post', `${manage(cci)}/${cancelled.id}/status`, 'manager')
      .send({ status: 'cancelled', version: 1 })
      .expect(200)
    const past = (await plan(cci, { date: '2020-01-15', participationRequestsOpen: true })).id
    const theirs = (await plan(club, { participationRequestsOpen: true }, 'clubManager')).id
    const unknown = '7d3c1b0e-0000-4000-8000-00000000dead'
    const answers = new Set<string>()
    for (const id of [notOpened, cancelled.id, past, theirs, unknown]) {
      const res = await visitor()
        .send('cci-touraine', submission({ committeeIds: [june, id] }))
        .expect(409)
      expect(res.body.error.details).toEqual({ committeeIds: [id] })
      answers.add(res.body.error.message)
    }
    expect(answers.size).toBe(1)
    expect(fake.table('participationRequest').size).toBe(0)
  })

  it('sets aside a robot’s submission with the same answer, recording nothing', async () => {
    const res = await visitor()
      .send('cci-touraine', submission({ website: 'https://spam.example' }))
      .expect(202)
    expect(res.body).toEqual({ message: 'Demande reçue.' })
    expect(fake.table('participationRequest').size).toBe(0)
    expect([...fake.table('auditLog').values()].map((e) => [e.actionType, e.metadata])).toEqual([
      ['participation_request_discarded', { workspaceId: cci, reason: 'honeypot' }],
    ])
  })

  it('limits each network address per minute and per hour, and each email address per hour without telling', async () => {
    // Per minute, per network address (the route's guard).
    const same = visitor('198.51.100.7')
    for (let i = 0; i < 5; i++) {
      await same.send('cci-touraine', submission({ email: `m${i}@x.fr` })).expect(202)
    }
    await same.send('cci-touraine', submission({ email: 'm5@x.fr' })).expect(429)
    // Another network address is not affected.
    await visitor()
      .send('cci-touraine', submission({ email: 'm6@x.fr' }))
      .expect(202)

    // Per hour, per email address: beyond, the same answer, nothing more recorded.
    const address = 'repete@x.fr'
    for (let i = 0; i < PARTICIPATION_RATE_LIMITS.perHourPerAddress; i++) {
      await visitor()
        .send('cci-touraine', submission({ email: address }))
        .expect(202)
    }
    const over = await visitor()
      .send('cci-touraine', submission({ email: address }))
      .expect(202)
    expect(over.body).toEqual({ message: 'Demande reçue.' })
    const repeated = [...fake.table('participationRequest').values()].find(
      (r) => r.email === address,
    )
    expect(repeated?.submissionCount).toBe(PARTICIPATION_RATE_LIMITS.perHourPerAddress)

    // Per hour, per network address (spread over minutes in reality; the per-minute guard is not
    // what refuses here).
    const busy = '192.0.2.99'
    let refusal: request.Response | undefined
    for (let i = 0; i <= PARTICIPATION_RATE_LIMITS.perHourPerNetwork && !refusal; i++) {
      const res = await visitor(busy).send('cci-touraine', submission({ email: `h${i}@x.fr` }))
      if (res.status === 429) refusal = res
    }
    expect(refusal?.body.error.message).toBeDefined()
  })

  // Code review R66: a full queue answers alike — status and body — for a new address, one already
  // pending and one over its hourly quota; nothing tells who already asked.
  it('turns every address away alike once the queue is full, and changes nothing', async () => {
    await visitor()
      .send('cci-touraine', submission({ email: 'pending0@review.test' }))
      .expect(202)
    for (let i = 0; i < PARTICIPATION_RATE_LIMITS.perHourPerAddress; i++) {
      await visitor()
        .send('cci-touraine', submission({ email: 'quota@review.test' }))
        .expect(202)
    }
    const pendingNow = () =>
      [...fake.table('participationRequest').values()].filter(
        (r) => r.workspaceId === cci && r.status === 'pending',
      )
    for (let i = pendingNow().length; i < PARTICIPATION_REQUEST_LIMITS.pendingPerWorkspace; i++) {
      await fake.prisma.participationRequest.create({
        data: {
          workspaceId: cci,
          email: `filler${i}@x.fr`,
          name: 'P',
          lastSubmittedAt: new Date(),
        },
      })
    }
    const before = JSON.stringify([...fake.table('participationRequest').values()])
    const answers = []
    for (const email of ['unknown@review.test', 'pending0@review.test', 'quota@review.test']) {
      const res = await visitor().send('cci-touraine', submission({ email }))
      answers.push([res.status, res.body])
    }
    expect(answers[0][0]).toBe(503)
    expect(answers).toEqual(Array(3).fill(answers[0]))
    expect(JSON.stringify([...fake.table('participationRequest').values()])).toBe(before)
    expect(pendingNow()).toHaveLength(PARTICIPATION_REQUEST_LIMITS.pendingPerWorkspace)
  })

  it('lists the pending requests to the workspace’s managers and administrators only', async () => {
    await visitor().send('cci-touraine', submission()).expect(202)
    const list = await call(
      'get',
      `/admin/workspaces/${cci}/participation-requests`,
      'manager',
    ).expect(200)
    expect(list.body).toHaveLength(1)
    expect(participationRequestSchema.parse(list.body[0])).toEqual(list.body[0])
    expect(list.body[0]).toMatchObject({
      status: 'pending',
      name: 'Claire Martin',
      organization: 'Angels Touraine',
      email: 'nouvelle@investisseurs.fr',
      message: 'MESSAGE-PRIVE Je souhaite assister au comité.',
      committees: [{ id: june, name: 'Comité de juin', status: 'planned' }],
      submissionCount: 1,
    })
    await call('get', `/admin/workspaces/${cci}/participation-requests`, 'admin').expect(200)
    for (const [account, status] of [
      ['advisor', 403],
      ['investor', 403],
      ['clubManager', 404],
    ] as const) {
      expect([
        account,
        (await call('get', `/admin/workspaces/${cci}/participation-requests`, account)).status,
      ]).toEqual([account, status])
    }
    await request(app.getHttpServer())
      .get(`/v1/admin/workspaces/${cci}/participation-requests`)
      .expect(401)
    // Each workspace its own queue.
    expect(
      (
        await call('get', `/admin/workspaces/${club}/participation-requests`, 'clubManager').expect(
          200,
        )
      ).body,
    ).toEqual([])
  })
})
