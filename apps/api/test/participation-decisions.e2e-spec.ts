import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { ZodValidationPipe } from 'nestjs-zod'
import request from 'supertest'
import type { App } from 'supertest/types'
import {
  participationDecisionResultSchema,
  participationRequestSchema,
  myWorkspaceMembershipSchema,
} from '@confluent/shared'
import { AppModule } from './../src/app.module'
import { GlobalExceptionFilter } from './../src/common/filters/global-exception.filter'
import { PrismaService } from './../src/prisma/prisma.service'
import { EMAIL_TRANSPORT } from './../src/modules/auth/email/email-transport'
import { ParticipationFormTokens } from './../src/modules/participation-requests/participation-form-token'
import { createFakePrisma } from '../src/testing/fake-prisma'

// ROADMAP E08.05: the managers' decisions on participation requests over HTTP — who decides, what
// an acceptance creates (and only an acceptance), what a refusal does not, idempotency, conflicts.
const ACCOUNTS = {
  admin: { role: 'admin', email: 'admin@confluent.dev' },
  manager: { role: 'financeur', email: 'marie@cci-touraine.fr' },
  advisor: { role: 'financeur', email: 'luc@cci-touraine.fr' },
  investor: { role: 'financeur', email: 'claire@angels.fr' },
  clubManager: { role: 'financeur', email: 'paul@club-deal.fr' },
  // An account outside the CCI, which asks with its own address.
  outsider: { role: 'financeur', email: 'eve@fonds.fr' },
} as const
type Account = keyof typeof ACCOUNTS
// Real identifiers: the queue's contract reads the decider's as a UUID.
const uid = (account: string) =>
  `7d3c1b0e-0000-4000-8000-${(Object.keys(ACCOUNTS).indexOf(account) + 1).toString().padStart(12, '0')}`

const JUNE = {
  name: 'Comité de juin',
  date: '2099-06-10',
  time: '14:00',
  timeZone: 'Europe/Paris',
  location: 'LIEU-PRIVE CCI Touraine, salle 2',
  meetingUrl: 'https://visio.example.org/LIEN-PRIVE',
  internalNotes: 'NOTE-INTERNE ordre du jour',
  sharedInfo: 'INFO-DIFFUSEE accueil à 13 h 45',
  participationRequestsOpen: true,
}

interface Listed {
  id: string
  email: string
  version: number
  status: string
}

describe('participation decisions (e2e)', () => {
  let app: INestApplication<App>
  let fake: ReturnType<typeof createFakePrisma>
  let mail: { sendMagicLink: jest.Mock; sendParticipationAccepted: jest.Mock }
  const jwt: Record<string, string> = {}
  let cci: string
  let club: string
  let june: string
  let ip = 0

  const call = (method: 'get' | 'post', path: string, as: Account = 'admin') =>
    request(app.getHttpServer())[method](`/v1${path}`).set('Authorization', `Bearer ${jwt[as]}`)
  const queue = (workspaceId = cci) => `/admin/workspaces/${workspaceId}/participation-requests`
  const ask = (email: string, patch: Record<string, unknown> = {}) =>
    request(app.getHttpServer())
      .post('/v1/public/workspaces/cci-touraine/participation-requests')
      .set('X-Forwarded-For', `203.0.113.${++ip}`)
      .send({
        name: 'Claire Martin',
        organization: 'Angels Touraine',
        email,
        message: 'MESSAGE-PRIVE Je souhaite assister au comité.',
        committeeIds: [june],
        formToken: app.get(ParticipationFormTokens).issue(cci, Date.now() - 5000),
        ...patch,
      })
      .expect(202)
  const pending = async (email: string): Promise<Listed> =>
    ((await call('get', queue()).expect(200)).body as Listed[]).find((r) => r.email === email)!
  const decide = (
    r: { id: string; version: number },
    decision: string,
    as: Account = 'manager',
    workspaceId = cci,
  ) =>
    call('post', `${queue(workspaceId)}/${r.id}/decision`, as).send({
      decision,
      version: r.version,
    })
  const signIn = (email: string) =>
    request(app.getHttpServer()).post('/v1/auth/magic-link').send({ email }).expect(200)
  const asAccount = async (email: string) => {
    const user = [...fake.table('user').values()].find((u) => u.email === email)!
    const token = await new JwtService().signAsync(
      { sub: user.id, email, role: user.role },
      { secret: process.env.JWT_SECRET },
    )
    return (path: string) =>
      request(app.getHttpServer()).get(`/v1${path}`).set('Authorization', `Bearer ${token}`)
  }

  beforeEach(async () => {
    fake = createFakePrisma()
    for (const [account, { role, email }] of Object.entries(ACCOUNTS)) {
      await fake.prisma.user.create({
        data: { id: uid(account), email, role, emailVerifiedAt: new Date() },
      })
    }
    mail = {
      sendMagicLink: jest.fn().mockResolvedValue(undefined),
      sendParticipationAccepted: jest.fn().mockResolvedValue(undefined),
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
    for (const [account, { role, email }] of Object.entries(ACCOUNTS)) {
      jwt[account] = await new JwtService().signAsync(
        { sub: uid(account), email, role },
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
    await invite(cci, {
      email: ACCOUNTS.investor.email,
      role: 'investisseur',
      investorType: 'business_angel',
    })
    await invite(club, {
      email: ACCOUNTS.clubManager.email,
      role: 'conseiller',
      canManageWorkspace: true,
    })
    june = (
      await call('post', `/admin/workspaces/${cci}/committees`, 'manager').send(JUNE).expect(201)
    ).body.id
    fake.table('auditLog').clear()
  })

  afterEach(async () => {
    await app.close()
  })

  it('grants nothing before an acceptance; accepting creates the account and the investisseur membership, and nothing more', async () => {
    await ask('Nouvelle@Investisseurs.fr')
    const users = fake.table('user').size
    const memberships = fake.table('workspaceMembership').size
    // Pending: no account to sign in to, no email of any kind.
    await signIn('nouvelle@investisseurs.fr')
    expect(mail.sendMagicLink).not.toHaveBeenCalled()
    expect(fake.table('user').size).toBe(users)

    const waiting = await pending('nouvelle@investisseurs.fr')
    const res = await decide(waiting, 'accepted').expect(200)
    expect(participationDecisionResultSchema.parse(res.body)).toEqual(res.body)
    expect(res.body).toMatchObject({
      invitationEmailSent: true,
      request: {
        status: 'accepted',
        version: waiting.version + 1,
        decidedBy: { id: uid('manager'), email: ACCOUNTS.manager.email },
        admission: 'account_created',
        invitationEmail: 'sent',
      },
    })
    expect(fake.table('user').size).toBe(users + 1)
    expect(fake.table('workspaceMembership').size).toBe(memberships + 1)
    expect(mail.sendParticipationAccepted).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(mail.sendParticipationAccepted.mock.calls)).not.toMatch(
      /PRIVE|NOTE-INTERNE|INFO-DIFFUSEE/,
    )

    // Now an account — unverified until its first sign-in (the magic-link flow, E05.02) —, whose
    // membership is an investisseur's of the CCI only.
    expect(
      [...fake.table('user').values()].find((u) => u.email === 'nouvelle@investisseurs.fr'),
    ).toMatchObject({ role: 'financeur', emailVerifiedAt: null })
    // Unverified, it opens nothing yet; signed in once (as the magic link's verification does):
    await (await asAccount('nouvelle@investisseurs.fr'))('/workspaces/memberships').expect(401)
    await fake.prisma.user.update({
      where: { email: 'nouvelle@investisseurs.fr' },
      data: { emailVerifiedAt: new Date() },
    })
    const get = await asAccount('nouvelle@investisseurs.fr')
    const mine = (await get('/workspaces/memberships').expect(200)).body
    expect(mine.map((m: unknown) => myWorkspaceMembershipSchema.parse(m))).toEqual([
      expect.objectContaining({
        role: 'investisseur',
        organization: 'Angels Touraine',
        investorType: null,
        canManageWorkspace: false,
        workspace: expect.objectContaining({ id: cci }),
      }),
    ])
    await get(`/workspaces/${cci}`).expect(200)
    // No committee access widened: committees stay the conseillers' (E08.06 decides the rest).
    for (const path of [
      `/workspaces/${cci}/committees`,
      `/workspaces/${cci}/committees/${june}`,
      `/workspaces/${cci}/committees/${june}/applications`,
      queue(),
      `/admin/workspaces/${cci}/members`,
    ]) {
      expect([path, (await get(path)).status]).toEqual([path, 403])
    }
    await get(`/workspaces/${club}`).expect(404)

    // E10.03: the CCI's manager was told of the request in the site — never who sent it —, the
    // admitted account of its acceptance (in the site; the acceptance's own email above); nobody
    // else of either.
    const told = (kind: string) =>
      [...fake.table('notification').values()]
        .filter((n) => n.kind === kind)
        .map((n) => [n.recipientId, n.emailState])
    expect(told('participation_request_received')).toEqual([[uid('manager'), 'none']])
    const admitted = [...fake.table('user').values()].find(
      (u) => u.email === 'nouvelle@investisseurs.fr',
    )!
    expect(told('participation_accepted')).toEqual([[admitted.id, 'none']])
    const mineTold = (await get('/notifications').expect(200)).body.items
    expect(mineTold).toEqual([
      expect.objectContaining({
        kind: 'participation_accepted',
        title: 'Votre demande de participation à « CCI Touraine » est acceptée',
        href: `/workspaces/${cci}`,
      }),
    ])
    const managerTold = (
      await call('get', '/notifications', 'manager').expect(200)
    ).body.items.filter((i: { kind: string }) => i.kind === 'participation_request_received')
    expect(managerTold).toEqual([expect.objectContaining({ href: `/workspaces/${cci}/comites` })])
    expect(JSON.stringify(managerTold)).not.toMatch(
      /Claire|Martin|Angels|MESSAGE-PRIVE|investisseurs|@/,
    )
  })

  it('refuses without creating, sending or granting anything; the address may ask again', async () => {
    await ask(ACCOUNTS.outsider.email)
    const users = fake.table('user').size
    const memberships = fake.table('workspaceMembership').size
    const res = await decide(await pending(ACCOUNTS.outsider.email), 'refused').expect(200)
    expect(res.body).toMatchObject({
      invitationEmailSent: null,
      request: { status: 'refused', admission: null, invitationEmail: null },
    })
    expect(fake.table('user').size).toBe(users)
    expect(fake.table('workspaceMembership').size).toBe(memberships)
    expect(mail.sendParticipationAccepted).not.toHaveBeenCalled()
    for (const path of [`/workspaces/${cci}`, `/workspaces/${cci}/committees`, queue()]) {
      expect([path, (await call('get', path, 'outsider')).status]).toEqual([path, 404])
    }

    // Listed apart, with its author and date; a new submission is a new pending request.
    const decided = (await call('get', `${queue()}?status=decided`, 'manager').expect(200)).body
    expect(decided.map((r: unknown) => participationRequestSchema.parse(r))).toEqual([
      expect.objectContaining({
        email: ACCOUNTS.outsider.email,
        status: 'refused',
        decidedAt: expect.any(String),
        decidedBy: expect.objectContaining({ email: ACCOUNTS.manager.email }),
      }),
    ])
    await ask(ACCOUNTS.outsider.email)
    expect((await pending(ACCOUNTS.outsider.email)).id).not.toBe(res.body.request.id)
    expect(
      (await call('get', `${queue()}?committeeId=${june}`, 'manager').expect(200)).body,
    ).toHaveLength(1)
  })

  it('keeps an existing member’s membership as it is, and refuses to reactivate a deactivated one', async () => {
    // The conseiller (no management right) and the investor ask with their own addresses.
    await ask(ACCOUNTS.advisor.email, { organization: 'Autre organisation' })
    await ask(ACCOUNTS.investor.email)
    for (const email of [ACCOUNTS.advisor.email, ACCOUNTS.investor.email]) {
      const res = await decide(await pending(email), 'accepted').expect(200)
      expect(res.body.request.admission).toBe('already_member')
    }
    const members = (await call('get', `/admin/workspaces/${cci}/members`).expect(200))
      .body as Array<{
      id: string
      user: { email: string }
      role: string
      organization: string | null
      investorType: string | null
      canManageWorkspace: boolean
    }>
    const of = (email: string) => members.find((m) => m.user.email === email)!
    expect(of(ACCOUNTS.advisor.email)).toMatchObject({
      role: 'conseiller',
      organization: null,
      canManageWorkspace: false,
    })
    expect(of(ACCOUNTS.investor.email)).toMatchObject({
      role: 'investisseur',
      investorType: 'business_angel',
    })

    // Deactivated, then asking: the decision is refused, the membership stays deactivated.
    await call(
      'post',
      `/admin/workspaces/${cci}/members/${of(ACCOUNTS.investor.email).id}/deactivate`,
    ).expect(201)
    await ask(ACCOUNTS.investor.email)
    const again = await pending(ACCOUNTS.investor.email)
    const refused = await decide(again, 'accepted').expect(409)
    expect(refused.body.error.message).toMatch(/membre désactivé du workspace/)
    const after = (await call('get', `/admin/workspaces/${cci}/members`).expect(200))
      .body as Array<{
      user: { email: string }
      status: string
    }>
    expect(after.find((m) => m.user.email === ACCOUNTS.investor.email)?.status).toBe('deactivated')
    expect((await pending(ACCOUNTS.investor.email)).version).toBe(again.version)
  })

  it('decides once: the same decision again does nothing more, another or a stale version is refused', async () => {
    await ask('double@x.fr')
    const waiting = await pending('double@x.fr')
    await decide(waiting, 'accepted').expect(200)
    const twice = await decide(waiting, 'accepted', 'admin').expect(200)
    expect(twice.body).toMatchObject({
      invitationEmailSent: null,
      request: { status: 'accepted', version: waiting.version + 1 },
    })
    expect(mail.sendParticipationAccepted).toHaveBeenCalledTimes(1)
    expect(
      [...fake.table('workspaceMembership').values()].filter(
        (m) =>
          m.userId === [...fake.table('user').values()].find((u) => u.email === 'double@x.fr')?.id,
      ),
    ).toHaveLength(1)
    const other = await decide({ ...waiting, version: waiting.version + 1 }, 'refused').expect(409)
    expect(other.body.error).toMatchObject({
      message: expect.stringMatching(/déjà été acceptée/),
      details: { status: 'accepted' },
    })

    await ask('stale@x.fr')
    const read = await pending('stale@x.fr')
    await ask('stale@x.fr')
    expect((await decide(read, 'accepted').expect(409)).body.error.message).toMatch(
      /La demande a changé/,
    )
    const journal = [...fake.table('auditLog').values()].filter(
      (e) => e.actionType === 'participation_request_decided',
    )
    expect(journal).toHaveLength(1)
    expect(JSON.stringify(journal)).not.toMatch(/double@|Claire|MESSAGE-PRIVE|Angels/)
  })

  it('keeps the decision when the email fails, and says so', async () => {
    mail.sendParticipationAccepted.mockRejectedValueOnce(new Error('SMTP refused'))
    await ask('smtp@x.fr')
    const res = await decide(await pending('smtp@x.fr'), 'accepted').expect(200)
    expect(res.body).toMatchObject({
      invitationEmailSent: false,
      request: { status: 'accepted', invitationEmail: 'failed' },
    })
  })

  it('lets only the workspace’s managers and administrators decide, and validates the decision', async () => {
    await ask('rights@x.fr')
    const waiting = await pending('rights@x.fr')
    for (const [account, status] of [
      ['advisor', 403],
      ['investor', 403],
      ['outsider', 404],
      ['clubManager', 404],
    ] as const) {
      expect([account, (await decide(waiting, 'accepted', account)).status]).toEqual([
        account,
        status,
      ])
    }
    // Through another workspace it is not found; without a session, 401.
    expect(
      (await decide(waiting, 'refused', 'clubManager', club).expect(404)).body.error.message,
    ).toMatch(/Demande de participation introuvable/)
    await request(app.getHttpServer())
      .post(`/v1${queue()}/${waiting.id}/decision`)
      .send({ decision: 'accepted', version: 1 })
      .expect(401)
    for (const body of [
      { decision: 'maybe', version: 1 },
      { decision: 'accepted' },
      { decision: 'accepted', version: 0 },
      { decision: 'accepted', version: 1, role: 'conseiller' },
    ]) {
      await call('post', `${queue()}/${waiting.id}/decision`, 'manager').send(body).expect(400)
    }
    await call('post', `${queue()}/pas-un-uuid/decision`, 'manager')
      .send({ decision: 'accepted', version: 1 })
      .expect(400)
    await call('get', `${queue()}?status=everything`, 'manager').expect(400)
    await call('get', `${queue()}?status=decided`, 'advisor').expect(403)
    expect((await pending('rights@x.fr')).status).toBe('pending')
    expect([...fake.table('user').values()].some((u) => u.email === 'rights@x.fr')).toBe(false)

    const byAdmin = await decide(waiting, 'refused', 'admin').expect(200)
    expect(byAdmin.body.request.decidedBy.email).toBe(ACCOUNTS.admin.email)
  })
})
