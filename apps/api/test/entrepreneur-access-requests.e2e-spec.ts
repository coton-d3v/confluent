import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { ZodValidationPipe } from 'nestjs-zod'
import request from 'supertest'
import type { App } from 'supertest/types'
import {
  ENTREPRENEUR_ACCESS_FORM_TIMING,
  ENTREPRENEUR_ACCESS_REQUEST_LIMITS,
  entrepreneurAccessDecisionResultSchema,
  entrepreneurAccessFormSchema,
  entrepreneurAccessRequestSchema,
} from '@confluent/shared'
import { AppModule } from './../src/app.module'
import { GlobalExceptionFilter } from './../src/common/filters/global-exception.filter'
import { PrismaService } from './../src/prisma/prisma.service'
import { EMAIL_TRANSPORT } from './../src/modules/auth/email/email-transport'
import { EntrepreneurAccessFormTokens } from './../src/modules/entrepreneur-access-requests/entrepreneur-access-form-token'
import { ENTREPRENEUR_ACCESS_RATE_LIMITS } from './../src/modules/entrepreneur-access-requests/entrepreneur-access-requests.service'
import { ParticipationFormTokens } from './../src/modules/participation-requests/participation-form-token'
import { createFakePrisma } from '../src/testing/fake-prisma'

// ROADMAP E09.05: an entrepreneur without an account asks a workspace, from its public page, for
// access to its candidature path — offered only while the page shows how to apply, the same answer
// whoever the address is, nothing granted before a manager's acceptance, an existing account never
// changed, and the anti-abuse guards of E08.04.
const ACCOUNTS = {
  admin: { role: 'admin', email: 'admin@confluent.dev' },
  manager: { role: 'financeur', email: 'marie@cci-touraine.fr' },
  advisor: { role: 'financeur', email: 'luc@cci-touraine.fr' },
  investor: { role: 'financeur', email: 'claire@angels.fr' },
  clubManager: { role: 'financeur', email: 'paul@club-deal.fr' },
  // An entrepreneur already on Confluent, outside the CCI.
  sophie: { role: 'entrepreneur', email: 'sophie@biosensio.fr' },
  // An investor account outside the CCI.
  outsider: { role: 'financeur', email: 'eve@fonds.fr' },
} as const
type Account = keyof typeof ACCOUNTS

describe('entrepreneur access requests (e2e)', () => {
  let app: INestApplication<App>
  let fake: ReturnType<typeof createFakePrisma>
  let mail: { sendMagicLink: jest.Mock; sendEntrepreneurAccessAccepted: jest.Mock }
  const jwt: Record<string, string> = {}
  let cci: string
  let club: string
  let ip = 0

  const call = (method: 'get' | 'post' | 'put', path: string, as: Account = 'admin') =>
    request(app.getHttpServer())[method](`/v1${path}`).set('Authorization', `Bearer ${jwt[as]}`)
  const queue = (workspaceId = cci) =>
    `/admin/workspaces/${workspaceId}/entrepreneur-access-requests`
  // Each public call from its own network address unless told (the route's per-minute limit).
  const visitor = (address = `203.0.113.${++ip % 250}`) => ({
    form: (slug: string) =>
      request(app.getHttpServer())
        .get(`/v1/public/workspaces/${slug}/entrepreneur-access-form`)
        .set('X-Forwarded-For', address),
    send: (slug: string, body: Record<string, unknown>) =>
      request(app.getHttpServer())
        .post(`/v1/public/workspaces/${slug}/entrepreneur-access-requests`)
        .set('X-Forwarded-For', address)
        .send(body),
    magicLink: (email: string) =>
      request(app.getHttpServer())
        .post('/v1/auth/magic-link')
        .set('X-Forwarded-For', address)
        .send({ email }),
  })
  // A token as the form gives it, old enough to be sent.
  const ready = (workspaceId = cci) =>
    app.get(EntrepreneurAccessFormTokens).issue(workspaceId, Date.now() - 5000)
  const submission = (patch: Record<string, unknown> = {}) => ({
    name: 'Léa Bernard',
    companyName: 'Hydrolia',
    email: 'lea@hydrolia.fr',
    message: 'MESSAGE-PRIVE Nous cherchons à lever 300 000 €.',
    formToken: ready(),
    ...patch,
  })
  type Request = { id: string; email: string; version: number; status: string }
  const pending = async (as: Account = 'manager') =>
    (await call('get', queue(), as).expect(200)).body as Request[]
  const decide = (r: Request, decision: 'accepted' | 'refused', as: Account = 'manager') =>
    call('post', `${queue()}/${r.id}/decision`, as).send({ decision, version: r.version })
  const journal = (action: string) =>
    [...fake.table('auditLog').values()].filter((e) => e.actionType === action)

  // The CCI's page published (every block, `apply` included) and its candidature form published.
  async function openTheDoor(workspaceId = cci) {
    await call('put', `/admin/workspaces/${workspaceId}/public-page`)
      .send({ published: true, criteria: null, contact: null, version: 1 })
      .expect(200)
    const form = await fake.prisma.questionnaire.create({
      data: { workspaceId, usage: 'candidature', name: 'Candidature' },
    })
    await fake.prisma.questionnaireVersion.create({
      data: { questionnaireId: form.id, version: 1, status: 'published' },
    })
    return form.id
  }

  beforeEach(async () => {
    fake = createFakePrisma()
    for (const [id, { role, email }] of Object.entries(ACCOUNTS)) {
      await fake.prisma.user.create({ data: { id, email, role, emailVerifiedAt: new Date() } })
    }
    mail = {
      sendMagicLink: jest.fn().mockResolvedValue(undefined),
      sendEntrepreneurAccessAccepted: jest.fn().mockResolvedValue(undefined),
    }
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
    fake.table('auditLog').clear()
  })

  afterEach(async () => {
    await app.close()
  })

  it('offers the form only while the page shows how to apply, and answers alike otherwise (no enumeration)', async () => {
    const answers = async (slug: string) => {
      const form = await visitor().form(slug)
      const sent = await visitor().send(slug, submission({ formToken: ready() }))
      return JSON.stringify([form.status, form.body, sent.status, sent.body])
    }
    const closed = await answers('inconnu')
    expect(JSON.parse(closed)).toEqual([
      404,
      { error: expect.objectContaining({ code: 'NOT_FOUND' }) },
      404,
      { error: expect.objectContaining({ code: 'NOT_FOUND' }) },
    ])
    // The page unpublished; published without a candidature form; then everything but the block.
    expect(await answers('cci-touraine')).toBe(closed)
    await call('put', `/admin/workspaces/${cci}/public-page`)
      .send({ published: true, criteria: null, contact: null, version: 1 })
      .expect(200)
    expect(await answers('cci-touraine')).toBe(closed)
    const form = await fake.prisma.questionnaire.create({
      data: { workspaceId: cci, usage: 'candidature', name: 'Candidature' },
    })
    await fake.prisma.questionnaireVersion.create({
      data: { questionnaireId: form.id, version: 1, status: 'published' },
    })
    await call('put', `/admin/workspaces/${cci}/public-page`)
      .send({
        published: true,
        criteria: null,
        contact: null,
        blocks: ['presentation'],
        version: 2,
      })
      .expect(200)
    expect(await answers('cci-touraine')).toBe(closed)
    for (const slug of ['club-deal', 'Majuscules', 'a', 'pas-un-workspace-123']) {
      expect(await answers(slug)).toBe(closed)
    }
    expect(fake.table('entrepreneurAccessRequest').size).toBe(0)

    // The block shown: offered — by the workspace's name only, with its own token.
    await call('put', `/admin/workspaces/${cci}/public-page`)
      .send({ published: true, criteria: null, contact: null, blocks: ['apply'], version: 3 })
      .expect(200)
    const open = await visitor().form('cci-touraine').expect(200)
    expect(entrepreneurAccessFormSchema.parse(open.body)).toEqual(open.body)
    expect(open.body).toEqual({
      workspace: { name: 'CCI Touraine', programName: null },
      formToken: expect.stringMatching(/^\d{13}\.[A-Za-z0-9_-]{43}$/),
    })
    expect(open.headers['cache-control']).toBe('no-store')
    expect(JSON.stringify(open.body)).not.toContain(cci)
    // Unpublished, everything else kept: closed alike.
    await call('put', `/admin/workspaces/${cci}/public-page`)
      .send({ published: false, criteria: null, contact: null, version: 4 })
      .expect(200)
    expect(await answers('cci-touraine')).toBe(closed)
    await call('put', `/admin/workspaces/${cci}/public-page`)
      .send({ published: true, criteria: null, contact: null, version: 5 })
      .expect(200)
    await visitor().form('cci-touraine').expect(200)
    // Archived candidature form: closed again, the page's « apply » block with it.
    await fake.prisma.questionnaire.update({
      where: { id: form.id },
      data: { archivedAt: new Date() },
    })
    await visitor().form('cci-touraine').expect(404)
    const page = await visitor().form('cci-touraine')
    expect(page.headers['cache-control']).toBe('no-store')
  })

  it('records a pending request with the same answer whoever the address is — and grants it nothing', async () => {
    await openTheDoor()
    const users = fake.table('user').size
    const memberships = fake.table('workspaceMembership').size
    const answers = []
    // A new address (as typed), an entrepreneur's account, an investor's, a member's, the new again.
    for (const email of [
      'Lea@Hydrolia.fr ',
      ACCOUNTS.sophie.email,
      ACCOUNTS.outsider.email,
      ACCOUNTS.investor.email,
      'lea@hydrolia.fr',
    ]) {
      const res = await visitor().send('cci-touraine', submission({ email })).expect(202)
      expect(res.headers['cache-control']).toBe('no-store')
      answers.push(res.body)
    }
    expect(answers).toEqual(Array(5).fill({ message: 'Demande reçue.' }))
    expect(fake.table('user').size).toBe(users)
    expect(fake.table('workspaceMembership').size).toBe(memberships)
    expect(fake.table('company').size).toBe(0)
    expect(fake.table('candidature').size).toBe(0)
    expect(mail.sendEntrepreneurAccessAccepted).not.toHaveBeenCalled()

    const queued = (await call('get', queue()).expect(200)).body as Array<Record<string, unknown>>
    for (const r of queued) expect(entrepreneurAccessRequestSchema.parse(r)).toEqual(r)
    expect(queued.map((r) => [r.email, r.submissionCount, r.version])).toEqual([
      ['lea@hydrolia.fr', 2, 2],
      [ACCOUNTS.sophie.email, 1, 1],
      [ACCOUNTS.outsider.email, 1, 1],
      [ACCOUNTS.investor.email, 1, 1],
    ])
    expect(queued[0]).toMatchObject({
      status: 'pending',
      name: 'Léa Bernard',
      companyName: 'Hydrolia',
      message: 'MESSAGE-PRIVE Nous cherchons à lever 300 000 €.',
      decidedAt: null,
      decidedBy: null,
      admission: null,
      invitationEmail: null,
    })
    // Never through any other workspace's queue.
    expect((await call('get', queue(club), 'clubManager').expect(200)).body).toEqual([])

    // No general sign-up: the new address still has no account, so no sign-in link.
    await visitor().magicLink('lea@hydrolia.fr').expect(200)
    expect(mail.sendMagicLink).not.toHaveBeenCalled()
    expect(fake.table('magicLinkToken').size).toBe(0)

    // The journal names no one.
    const received = journal('entrepreneur_access_request_received')
    expect(received).toHaveLength(5)
    expect(received.map((e) => (e.metadata as { merged: boolean }).merged)).toEqual([
      false,
      false,
      false,
      false,
      true,
    ])
    const traces = JSON.stringify(received)
    for (const value of ['hydrolia', 'Léa', 'MESSAGE', ACCOUNTS.sophie.email]) {
      expect([value, traces.includes(value)]).toEqual([value, false])
    }
  })

  it('refuses a form sent too fast, too late, with another form’s or workspace’s token, and sets robots aside', async () => {
    await openTheDoor()
    const tokens = app.get(EntrepreneurAccessFormTokens)
    const now = Date.now()
    const fast = await visitor()
      .send('cci-touraine', submission({ formToken: tokens.issue(cci, now) }))
      .expect(400)
    expect(fast.body.error.details).toEqual({ reason: 'form_too_fast' })
    for (const formToken of [
      tokens.issue(cci, now - ENTREPRENEUR_ACCESS_FORM_TIMING.maxAgeMs - 1000),
      app.get(ParticipationFormTokens).issue(cci, now - 5000),
      tokens.issue(club, now - 5000),
      'nimporte-quoi',
    ]) {
      const res = await visitor().send('cci-touraine', submission({ formToken })).expect(400)
      expect([formToken, res.body.error.details]).toEqual([formToken, { reason: 'form_expired' }])
    }
    // Invalid fields: refused with their own message, nothing recorded.
    const invalid = await visitor()
      .send('cci-touraine', submission({ companyName: '  ', email: 'pas-une-adresse' }))
      .expect(400)
    expect(invalid.body.error.code).toBe('VALIDATION_ERROR')
    await visitor()
      .send('cci-touraine', submission({ message: '<script>alert(1)</script>' }))
      .expect(400)
    await visitor()
      .send(
        'cci-touraine',
        submission({ name: 'n'.repeat(ENTREPRENEUR_ACCESS_REQUEST_LIMITS.name + 1) }),
      )
      .expect(400)
    await visitor()
      .send('cci-touraine', submission({ role: 'admin' }))
      .expect(400)
    // The hidden field filled: the same answer, nothing recorded, a trace without the person.
    const robot = await visitor()
      .send('cci-touraine', submission({ website: 'https://spam.example' }))
      .expect(202)
    expect(robot.body).toEqual({ message: 'Demande reçue.' })
    expect(fake.table('entrepreneurAccessRequest').size).toBe(0)
    expect(journal('entrepreneur_access_request_discarded').map((e) => e.metadata)).toEqual([
      { workspaceId: cci, reason: 'honeypot' },
    ])
  })

  it('limits each network address and each email address, and turns everyone away alike once the queue is full', async () => {
    await openTheDoor()
    // Per minute and network address (the route): the sixth is refused.
    const same = visitor('198.51.100.7')
    for (let i = 0; i < 5; i++) {
      await same.send('cci-touraine', submission({ email: `m${i}@x.fr` })).expect(202)
    }
    await same.send('cci-touraine', submission({ email: 'm5@x.fr' })).expect(429)
    // Per hour and email address: beyond the quota, set aside with the same answer.
    const limit = ENTREPRENEUR_ACCESS_RATE_LIMITS.perHourPerAddress
    for (let i = 0; i < limit + 2; i++) {
      await visitor()
        .send('cci-touraine', submission({ email: 'quota@x.fr' }))
        .expect(202)
    }
    const quota = (await pending()).find((r) => r.email === 'quota@x.fr')!
    expect(fake.table('entrepreneurAccessRequest').get(quota.id)).toMatchObject({
      submissionCount: limit,
    })
    expect(
      journal('entrepreneur_access_request_discarded').map(
        (e) => (e.metadata as { reason: string }).reason,
      ),
    ).toEqual(['address_rate', 'address_rate'])

    // The queue full: every address refused alike — new, pending or over its quota.
    for (
      let i = fake.table('entrepreneurAccessRequest').size;
      i < ENTREPRENEUR_ACCESS_REQUEST_LIMITS.pendingPerWorkspace;
      i++
    ) {
      await fake.prisma.entrepreneurAccessRequest.create({
        data: {
          workspaceId: cci,
          email: `filler${i}@x.fr`,
          name: 'P',
          companyName: 'P',
          lastSubmittedAt: new Date(),
        },
      })
    }
    const answers = []
    for (const email of ['nouvelle@x.fr', 'm0@x.fr', 'quota@x.fr']) {
      const res = await visitor().send('cci-touraine', submission({ email }))
      answers.push(JSON.stringify([res.status, res.body]))
    }
    expect(new Set(answers).size).toBe(1)
    expect(JSON.parse(answers[0])[0]).toBe(503)
    expect(fake.table('entrepreneurAccessRequest').size).toBe(
      ENTREPRENEUR_ACCESS_REQUEST_LIMITS.pendingPerWorkspace,
    )
  })

  it('lets the workspace’s managers and administrators alone read and decide the queue', async () => {
    await openTheDoor()
    await visitor().send('cci-touraine', submission()).expect(202)
    const [r] = await pending()
    for (const [as, status] of [
      ['advisor', 403],
      ['investor', 403],
      ['clubManager', 404],
      ['sophie', 404],
      ['outsider', 404],
    ] as const) {
      expect([as, (await call('get', queue(), as)).status]).toEqual([as, status])
      expect([as, (await call('get', `${queue()}?status=decided`, as)).status]).toEqual([
        as,
        status,
      ])
      expect([as, (await decide(r, 'accepted', as)).status]).toEqual([as, status])
    }
    await request(app.getHttpServer()).get(`/v1${queue()}`).expect(401)
    expect(fake.table('entrepreneurAccessRequest').get(r.id)).toMatchObject({ status: 'pending' })
    expect((await call('get', queue(), 'admin').expect(200)).body).toHaveLength(1)
    // Unknown request, or another workspace's: 404.
    await call('post', `${queue(club)}/${r.id}/decision`, 'clubManager')
      .send({ decision: 'refused', version: 1 })
      .expect(404)
  })

  it('accepting creates an entrepreneur’s account — nothing else — and invites it by email after the decision', async () => {
    await openTheDoor()
    await visitor().send('cci-touraine', submission()).expect(202)
    const [r] = await pending()
    const before = {
      memberships: fake.table('workspaceMembership').size,
      companies: fake.table('company').size,
    }
    const res = await decide(r, 'accepted').expect(200)
    // (The test accounts' identifiers are not UUIDs: the decider is checked below.)
    const shape = { ...res.body, request: { ...res.body.request, decidedBy: null } }
    expect(entrepreneurAccessDecisionResultSchema.parse(shape)).toEqual(shape)
    expect(res.body).toMatchObject({
      invitationEmailSent: true,
      request: {
        status: 'accepted',
        version: 2,
        admission: 'account_created',
        invitationEmail: 'sent',
        decidedBy: { id: 'manager', email: ACCOUNTS.manager.email },
      },
    })
    const account = [...fake.table('user').values()].find((u) => u.email === 'lea@hydrolia.fr')!
    expect(account).toMatchObject({ role: 'entrepreneur', isActive: true, emailVerifiedAt: null })
    expect(fake.table('entrepreneurAccessRequest').get(r.id)).toMatchObject({
      accountUserId: account.id,
    })
    // No membership, company, request nor candidature created on the person's behalf.
    expect(fake.table('workspaceMembership').size).toBe(before.memberships)
    expect(fake.table('company').size).toBe(before.companies)
    expect(fake.table('candidature').size).toBe(0)
    expect(mail.sendEntrepreneurAccessAccepted).toHaveBeenCalledTimes(1)
    expect(mail.sendEntrepreneurAccessAccepted).toHaveBeenCalledWith({
      to: 'lea@hydrolia.fr',
      workspaceName: 'CCI Touraine',
      admission: 'account_created',
      signInUrl: expect.stringMatching(/\/auth$/),
      locale: 'fr',
    })
    // The journal: the decision and the account, never the person's words.
    const [entry] = journal('entrepreneur_access_request_decided')
    expect(entry).toMatchObject({
      actorId: 'manager',
      metadata: {
        workspaceId: cci,
        requestId: r.id,
        version: 2,
        decision: 'accepted',
        admission: 'account_created',
        accountUserId: account.id,
      },
    })
    expect(JSON.stringify(entry)).not.toMatch(/hydrolia|Léa|MESSAGE/i)

    // Repeated: done, nothing again; another decision: final.
    const again = await decide(r, 'accepted').expect(200)
    expect(again.body).toMatchObject({ invitationEmailSent: null, request: { version: 2 } })
    expect((await decide(r, 'refused').expect(409)).body.error.details).toEqual({
      status: 'accepted',
    })
    expect(mail.sendEntrepreneurAccessAccepted).toHaveBeenCalledTimes(1)
    expect(journal('entrepreneur_access_request_decided')).toHaveLength(1)
    const decided = (await call('get', `${queue()}?status=decided`).expect(200)).body
    expect(decided.map((d: Request) => d.id)).toEqual([r.id])
    expect(await pending()).toEqual([])

    // The account signs in with the usual magic link, and may present requests to the CCI.
    await visitor().magicLink('lea@hydrolia.fr').expect(200)
    expect(mail.sendMagicLink).toHaveBeenCalledTimes(1)
    expect([...fake.table('magicLinkToken').values()]).toEqual([
      expect.objectContaining({ userId: account.id }),
    ])
    // Consuming it verifies the address (AuthService.verifyMagicLink, covered by auth's tests).
    await fake.prisma.user.update({
      where: { id: account.id },
      data: { emailVerifiedAt: new Date() },
    })
    const lea = await new JwtService().signAsync(
      { sub: account.id, email: account.email, role: 'entrepreneur' },
      { secret: process.env.JWT_SECRET },
    )
    const open = await request(app.getHttpServer())
      .get('/v1/candidature-workspaces')
      .set('Authorization', `Bearer ${lea}`)
      .expect(200)
    expect(open.body.map((w: { name: string }) => w.name)).toEqual(['CCI Touraine'])
    // Still nothing in the workspace itself.
    await request(app.getHttpServer())
      .get(`/v1/workspaces/${cci}/candidatures`)
      .set('Authorization', `Bearer ${lea}`)
      .expect(404)
  })

  it('keeps an existing account as it is, and never changes one that cannot present requests', async () => {
    await openTheDoor()
    await fake.prisma.user.create({
      data: { id: 'off', email: 'off@x.fr', role: 'entrepreneur', isActive: false },
    })
    for (const email of [
      ACCOUNTS.sophie.email,
      ACCOUNTS.outsider.email,
      ACCOUNTS.investor.email,
      'off@x.fr',
    ]) {
      await visitor().send('cci-touraine', submission({ email })).expect(202)
    }
    const all = await pending()
    const of = (email: string) => all.find((r) => r.email === email)!
    const users = JSON.stringify([...fake.table('user').values()])

    const sophie = await decide(of(ACCOUNTS.sophie.email), 'accepted').expect(200)
    expect(sophie.body.request).toMatchObject({
      admission: 'account_existing',
      invitationEmail: 'sent',
    })
    expect(fake.table('user').get('sophie')).toMatchObject({ role: 'entrepreneur' })
    expect(mail.sendEntrepreneurAccessAccepted).toHaveBeenLastCalledWith(
      expect.objectContaining({ to: ACCOUNTS.sophie.email, admission: 'account_existing' }),
    )

    // An investor's account (a member of the CCI or not), a deactivated one: refused, unchanged.
    for (const email of [ACCOUNTS.outsider.email, ACCOUNTS.investor.email, 'off@x.fr']) {
      const res = await decide(of(email), 'accepted').expect(409)
      expect([email, res.body.error.code]).toEqual([email, 'CONFLICT'])
      expect(res.body.error.message).toMatch(/ne peut pas présenter de demande/)
      expect(fake.table('entrepreneurAccessRequest').get(of(email).id)).toMatchObject({
        status: 'pending',
        version: 1,
      })
    }
    expect(JSON.stringify([...fake.table('user').values()])).toBe(users)
    expect(journal('entrepreneur_access_request_decided')).toHaveLength(1)
    // The manager refuses them instead.
    await decide(of(ACCOUNTS.outsider.email), 'refused').expect(200)
  })

  it('refusing creates nothing and sends nothing; the person may ask again', async () => {
    await openTheDoor()
    await visitor().send('cci-touraine', submission()).expect(202)
    const [r] = await pending()
    const users = fake.table('user').size
    const res = await decide(r, 'refused').expect(200)
    expect(res.body).toMatchObject({
      invitationEmailSent: null,
      request: { status: 'refused', admission: null, invitationEmail: null },
    })
    expect(fake.table('user').size).toBe(users)
    expect(mail.sendEntrepreneurAccessAccepted).not.toHaveBeenCalled()
    await visitor().send('cci-touraine', submission()).expect(202)
    const [again] = await pending()
    expect(again.id).not.toBe(r.id)
  })

  it('refuses a decision on what the manager did not see, and an acceptance once candidatures closed', async () => {
    const formId = await openTheDoor()
    await visitor().send('cci-touraine', submission()).expect(202)
    const [seen] = await pending()
    // A new submission meanwhile: the version the manager read is gone.
    await visitor().send('cci-touraine', submission()).expect(202)
    const stale = await decide(seen, 'accepted').expect(409)
    expect(stale.body.error.message).toMatch(/a changé depuis son affichage/)
    const [current] = await pending()
    expect(current.version).toBe(2)
    // The candidature form archived: an acceptance would point to a closed door.
    await fake.prisma.questionnaire.update({
      where: { id: formId },
      data: { archivedAt: new Date() },
    })
    const closed = await decide(current, 'accepted').expect(409)
    expect(closed.body.error.message).toMatch(/ne reçoit plus de candidature/)
    expect([...fake.table('user').values()].some((u) => u.email === 'lea@hydrolia.fr')).toBe(false)
    await decide(current, 'refused').expect(200)
  })

  it('keeps the decision when the invitation email fails, and says so', async () => {
    await openTheDoor()
    mail.sendEntrepreneurAccessAccepted.mockRejectedValueOnce(new Error('smtp down'))
    await visitor().send('cci-touraine', submission()).expect(202)
    const [r] = await pending()
    const res = await decide(r, 'accepted').expect(200)
    expect(res.body).toMatchObject({
      invitationEmailSent: false,
      request: { status: 'accepted', invitationEmail: 'failed' },
    })
    expect(JSON.stringify(res.body)).not.toMatch(/smtp/)
  })
})
