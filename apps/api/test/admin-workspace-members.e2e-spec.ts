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

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAAABJRU5ErkJggg==',
  'base64',
)

// ROADMAP E05.02: global role and workspace memberships. Accounts: a Confluent administrator,
// a future manager and advisor of the CCI (global role financeur, as an invitation creates them),
// an investor, an entrepreneur.
const ACCOUNTS = {
  admin: { role: 'admin', email: 'admin@confluent.dev' },
  manager: { role: 'financeur', email: 'marie@cci-touraine.fr' },
  advisor: { role: 'financeur', email: 'luc@cci-touraine.fr' },
  investor: { role: 'financeur', email: 'claire@angels.fr' },
  entrepreneur: { role: 'entrepreneur', email: 'sophie@biosensio.fr' },
} as const
type Account = keyof typeof ACCOUNTS

describe('workspace members (e2e)', () => {
  let app: INestApplication<App>
  let fake: ReturnType<typeof createFakePrisma>
  let sendWorkspaceInvite: jest.Mock
  const jwt: Record<string, string> = {}

  beforeEach(async () => {
    fake = createFakePrisma()
    sendWorkspaceInvite = jest.fn().mockResolvedValue(undefined)
    for (const [id, { role, email }] of Object.entries(ACCOUNTS)) {
      await fake.prisma.user.create({ data: { id, email, role, emailVerifiedAt: new Date() } })
    }
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(fake.prisma)
      .overrideProvider(EMAIL_TRANSPORT)
      .useValue({ sendMagicLink: jest.fn(), sendShareInvite: jest.fn(), sendWorkspaceInvite })
      .compile()
    app = moduleFixture.createNestApplication()
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
  })

  afterEach(async () => {
    await app.close()
  })

  const call = (
    method: 'get' | 'post' | 'patch' | 'delete',
    path: string,
    as: Account | null = 'admin',
  ) => {
    const req = request(app.getHttpServer())[method](`/v1${path}`)
    return as ? req.set('Authorization', `Bearer ${jwt[as]}`) : req
  }
  const members = (workspaceId: string) => `/admin/workspaces/${workspaceId}/members`
  const createWorkspace = (body: Record<string, unknown> = { name: 'CCI Touraine' }) =>
    call('post', '/admin/workspaces')
      .send(body)
      .expect(201)
      .then((res) => res.body.id as string)
  const invite = (workspaceId: string, body: Record<string, unknown>, as: Account = 'admin') =>
    call('post', members(workspaceId), as).send(body)
  // The CCI with its manager, invited by the administrator.
  const cciWithManager = async (settings?: Record<string, unknown>) => {
    const id = await createWorkspace({ name: 'CCI Touraine', ...settings })
    const res = await invite(id, {
      email: ACCOUNTS.manager.email,
      role: 'conseiller',
      canManageWorkspace: true,
    }).expect(201)
    return { id, managerMembershipId: res.body.member.id as string }
  }
  const audits = (action: string) =>
    [...fake.table('auditLog').values()].filter((row) => row.actionType === action)

  it('lets the administrator invite a manager, who then sets up the workspace and its members', async () => {
    const { id } = await cciWithManager()
    expect(sendWorkspaceInvite).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'marie@cci-touraine.fr',
        workspaceName: 'CCI Touraine',
        roleLabel: 'conseiller, gestionnaire du workspace',
      }),
    )

    // The manager finds the workspace among theirs…
    const mine = await call('get', '/workspaces/memberships', 'manager').expect(200)
    expect(mine.body).toEqual([
      expect.objectContaining({
        role: 'conseiller',
        canManageWorkspace: true,
        workspace: expect.objectContaining({ id, name: 'CCI Touraine' }),
      }),
    ])
    // …sets it up (logo included: the guard reads the same rule)…
    await call('get', `/admin/workspaces/${id}`, 'manager').expect(200)
    await call('patch', `/admin/workspaces/${id}`, 'manager')
      .send({ programName: 'MoneyPlace' })
      .expect(200)
    await call('post', `/admin/workspaces/${id}/logo`, 'manager')
      .attach('file', PNG, 'logo.png')
      .expect(201)
    // …and invites an investor of any address, with organization and type.
    const res = await invite(
      id,
      {
        email: ' Claire@Angels.FR ',
        role: 'investisseur',
        organization: ' Angels Touraine ',
        investorType: 'business_angel',
      },
      'manager',
    ).expect(201)
    expect(res.body).toMatchObject({
      invitationEmailSent: true,
      member: {
        role: 'investisseur',
        organization: 'Angels Touraine',
        investorType: 'business_angel',
        canManageWorkspace: false,
        status: 'active',
        user: { id: 'investor', email: 'claire@angels.fr' },
        invitedBy: { id: 'manager', email: 'marie@cci-touraine.fr' },
      },
    })
    // Global roles untouched by memberships.
    expect(fake.table('user').get('manager')?.role).toBe('financeur')
    expect(fake.table('user').get('investor')?.role).toBe('financeur')

    const list = await call('get', members(id), 'manager').expect(200)
    expect(list.body.map((m: { user: { email: string } }) => m.user.email)).toEqual([
      'claire@angels.fr',
      'marie@cci-touraine.fr',
    ])
    expect(audits('workspace_member_invited')).toHaveLength(2)
  })

  it('creates the account of an unknown address, which then awaits its first sign-in', async () => {
    const { id } = await cciWithManager()
    const res = await invite(
      id,
      { email: 'nouveau@cci-touraine.fr', role: 'conseiller' },
      'manager',
    )
    expect(res.status).toBe(201)
    expect(res.body.member).toMatchObject({ awaitingFirstSignIn: true, canManageWorkspace: false })
    const account = [...fake.table('user').values()].find(
      (u) => u.email === 'nouveau@cci-touraine.fr',
    )
    expect(account).toMatchObject({ role: 'financeur', emailVerifiedAt: null, isActive: true })
  })

  it('refuses the workspace and its members to a member without the right, an investor, an entrepreneur and another workspace’s manager', async () => {
    const { id, managerMembershipId } = await cciWithManager()
    await invite(id, { email: ACCOUNTS.advisor.email, role: 'conseiller' }).expect(201)
    await invite(id, { email: ACCOUNTS.investor.email, role: 'investisseur' }).expect(201)
    const club = await createWorkspace({ name: 'Club deal' })
    await invite(club, {
      email: ACCOUNTS.entrepreneur.email,
      role: 'conseiller',
      canManageWorkspace: true,
    }).expect(201)

    for (const as of ['advisor', 'investor', 'entrepreneur'] as const) {
      const refusals = [
        () => call('get', `/admin/workspaces/${id}`, as),
        () => call('patch', `/admin/workspaces/${id}`, as).send({ name: 'Pirate' }),
        () => call('post', `/admin/workspaces/${id}/logo`, as).attach('file', PNG, 'logo.png'),
        () => call('delete', `/admin/workspaces/${id}/logo`, as),
        () => call('get', members(id), as),
        () => invite(id, { email: 'x@cci-touraine.fr', role: 'conseiller' }, as),
        () =>
          call('patch', `${members(id)}/${managerMembershipId}`, as).send({ organization: 'X' }),
        () => call('post', `${members(id)}/${managerMembershipId}/deactivate`, as),
        () => call('post', `${members(id)}/${managerMembershipId}/reactivate`, as),
        // Creating and listing all workspaces stay for administrators, managers included.
        () => call('get', '/admin/workspaces', as),
        () => call('post', '/admin/workspaces', as).send({ name: 'Pirate' }),
      ]
      for (const send of refusals) {
        const res = await send()
        expect(res.status).toBe(403)
      }
    }
    await call('get', '/admin/workspaces', 'manager').expect(403)
    await call('get', `/admin/workspaces/${club}`, 'manager').expect(403)
    // An unknown workspace is not revealed to a non-manager.
    await call('get', members('00000000-0000-4000-8000-000000000000'), 'manager').expect(403)
    await call('get', members('00000000-0000-4000-8000-000000000000')).expect(404)

    expect(fake.table('workspace').get(id)).toMatchObject({ name: 'CCI Touraine', logoKey: null })
    expect(fake.table('workspaceMembership').size).toBe(4)
    expect(audits('workspace_member_updated')).toHaveLength(0)
    expect(audits('workspace_member_deactivated')).toHaveLength(0)
  })

  it('keeps the email domain to administrators and applies it to the conseillers invited', async () => {
    const { id } = await cciWithManager({ emailDomain: 'cci-touraine.fr' })
    const lift = await call('patch', `/admin/workspaces/${id}`, 'manager')
      .send({ emailDomain: null })
      .expect(403)
    expect(lift.body.error.message).toContain('domaine email autorisé')

    const outside = await invite(id, { email: 'luc@gmail.com', role: 'conseiller' }, 'manager')
    expect(outside.status).toBe(400)
    expect(outside.body.error.message).toContain('@cci-touraine.fr')
    expect(outside.body.error.details).toEqual([
      { path: ['email'], message: 'Adresse @cci-touraine.fr attendue pour un conseiller.' },
    ])
    await invite(id, { email: 'claire@angels.fr', role: 'investisseur' }, 'manager').expect(201)
    await invite(id, { email: 'luc@cci-touraine.fr', role: 'conseiller' }, 'manager').expect(201)
  })

  it('validates an invitation and explains the error in French', async () => {
    const { id } = await cciWithManager()
    const res = await invite(id, {
      email: 'pas-une-adresse',
      role: 'gestionnaire',
      organization: 'x'.repeat(121),
    }).expect(400)
    const messages = (res.body.error.details as Array<{ message: string }>).map((d) => d.message)
    expect(messages).toEqual(
      expect.arrayContaining([
        'L’adresse email n’est pas valide.',
        'Choisissez le rôle : conseiller ou investisseur.',
        'L’organisation compte au plus 120 caractères.',
      ]),
    )
    const managerInvestor = await invite(id, {
      email: 'claire@angels.fr',
      role: 'investisseur',
      canManageWorkspace: true,
    }).expect(400)
    expect(managerInvestor.body.error.details[0].message).toBe(
      'Seul un conseiller peut gérer le workspace.',
    )
    const typedAdvisor = await invite(id, {
      email: 'luc@cci-touraine.fr',
      role: 'conseiller',
      investorType: 'banque',
    }).expect(400)
    expect(typedAdvisor.body.error.details[0].message).toBe(
      'Le type d’investisseur ne concerne que les investisseurs.',
    )
    // An identifier chosen by the client is refused, not ignored.
    await invite(id, { email: 'luc@cci-touraine.fr', role: 'conseiller', userId: 'admin' }).expect(
      400,
    )
    await invite(id, { email: 'marie@cci-touraine.fr', role: 'investisseur' }).expect(409)
  })

  it('edits organization, investor type and management right, journaling each change', async () => {
    const { id } = await cciWithManager()
    const investor = await invite(id, { email: ACCOUNTS.investor.email, role: 'investisseur' })
    const path = `${members(id)}/${investor.body.member.id}`
    const edited = await call('patch', path, 'manager')
      .send({ organization: 'Crédit Touraine', investorType: 'banque' })
      .expect(200)
    expect(edited.body).toMatchObject({ organization: 'Crédit Touraine', investorType: 'banque' })
    await call('patch', path, 'manager').send({ canManageWorkspace: true }).expect(400)
    await call('patch', path, 'manager').send({}).expect(400)
    const promoted = await call('patch', path, 'manager')
      .send({ role: 'conseiller', canManageWorkspace: true })
      .expect(200)
    expect(promoted.body).toMatchObject({
      role: 'conseiller',
      investorType: null,
      canManageWorkspace: true,
    })
    // The new manager now manages the workspace.
    await call('get', members(id), 'investor').expect(200)
    expect(audits('workspace_member_updated')).toHaveLength(2)
  })

  it('deactivates a member without deleting the account, with immediate effect, and reactivates it', async () => {
    const { id } = await cciWithManager()
    const advisor = await invite(id, {
      email: ACCOUNTS.advisor.email,
      role: 'conseiller',
      canManageWorkspace: true,
    })
    const path = `${members(id)}/${advisor.body.member.id}`
    await call('get', members(id), 'advisor').expect(200)

    const off = await call('post', `${path}/deactivate`, 'manager').expect(201)
    expect(off.body).toMatchObject({ status: 'deactivated', canManageWorkspace: true })
    expect(off.body.deactivatedAt).toEqual(expect.any(String))
    // Same token, next request: refused. The account still signs in and keeps its other rights.
    await call('get', members(id), 'advisor').expect(403)
    await call('get', '/workspaces/memberships', 'advisor').expect(200).expect([])
    expect(fake.table('user').get('advisor')?.isActive).toBe(true)
    // Listed after the active members, history kept.
    const list = await call('get', members(id), 'manager').expect(200)
    expect(list.body.map((m: { status: string }) => m.status)).toEqual(['active', 'deactivated'])
    await call('post', `${path}/deactivate`, 'manager').expect(201)
    expect(audits('workspace_member_deactivated')).toHaveLength(1)

    await call('post', `${path}/reactivate`, 'manager').expect(201)
    await call('get', members(id), 'advisor').expect(200)
    expect(audits('workspace_member_reactivated')).toHaveLength(1)
  })

  it('never lets a manager remove the last management right of the workspace', async () => {
    const { id, managerMembershipId } = await cciWithManager()
    const own = `${members(id)}/${managerMembershipId}`
    const res = await call('patch', own, 'manager').send({ canManageWorkspace: false }).expect(409)
    expect(res.body.error.message).toContain('dernier gestionnaire')
    await call('post', `${own}/deactivate`, 'manager').expect(409)
    await call('get', members(id), 'manager').expect(200)
    // An administrator may: the workspace is managed by administrators, as at its creation.
    await call('post', `${own}/deactivate`).expect(201)
    await call('get', members(id), 'manager').expect(403)
  })

  it('lists no workspace for an account without membership, and requires a session', async () => {
    await cciWithManager()
    await call('get', '/workspaces/memberships', 'entrepreneur').expect(200).expect([])
    await call('get', '/workspaces/memberships', null).expect(401)
    await call('get', members('00000000-0000-4000-8000-000000000000'), null).expect(401)
  })
})
