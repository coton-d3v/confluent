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

// ROADMAP E05.03: several memberships, switching between workspaces, and the workspace access
// checked at each request — the site's choice of workspace is never an authorization.
const ACCOUNTS = {
  admin: { role: 'admin', email: 'admin@confluent.dev' },
  // Conseillère and manager of the CCI, investor in the club deal.
  marie: { role: 'financeur', email: 'marie@cci-touraine.fr' },
  // Manager of the club deal only.
  paul: { role: 'financeur', email: 'paul@club-deal.fr' },
  // Investor of the CCI, deactivated during the tests.
  claire: { role: 'financeur', email: 'claire@angels.fr' },
  // Without membership: unchanged journeys.
  sophie: { role: 'entrepreneur', email: 'sophie@biosensio.fr' },
  financeur: { role: 'financeur', email: 'jean@banque.fr' },
} as const
type Account = keyof typeof ACCOUNTS
type Method = 'get' | 'post' | 'put' | 'patch' | 'delete'

const UNKNOWN = '00000000-0000-4000-8000-000000000000'
const NOT_FOUND = {
  error: { code: 'NOT_FOUND', message: 'Workspace introuvable, ou vous n’en êtes pas membre.' },
}

describe('workspace isolation (e2e)', () => {
  let app: INestApplication<App>
  let fake: ReturnType<typeof createFakePrisma>
  const jwt: Record<string, string> = {}
  let cci: string
  let club: string
  let claireInCci: string
  let marieInCci: string

  beforeEach(async () => {
    fake = createFakePrisma()
    for (const [id, { role, email }] of Object.entries(ACCOUNTS)) {
      await fake.prisma.user.create({ data: { id, email, role, emailVerifiedAt: new Date() } })
    }
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(fake.prisma)
      .overrideProvider(EMAIL_TRANSPORT)
      .useValue({
        sendMagicLink: jest.fn(),
        sendShareInvite: jest.fn(),
        sendWorkspaceInvite: jest.fn().mockResolvedValue(undefined),
      })
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

    cci = await createWorkspace('CCI Touraine')
    club = await createWorkspace('Club deal')
    marieInCci = await invite(cci, {
      email: ACCOUNTS.marie.email,
      role: 'conseiller',
      canManageWorkspace: true,
    })
    claireInCci = await invite(cci, { email: ACCOUNTS.claire.email, role: 'investisseur' })
    await invite(club, { email: ACCOUNTS.paul.email, role: 'conseiller', canManageWorkspace: true })
    await invite(club, { email: ACCOUNTS.marie.email, role: 'investisseur' })
  })

  afterEach(async () => {
    await app.close()
  })

  const call = (method: Method, path: string, as: Account | null = 'admin') => {
    const req = request(app.getHttpServer())[method](`/v1${path}`)
    return as ? req.set('Authorization', `Bearer ${jwt[as]}`) : req
  }
  async function createWorkspace(name: string): Promise<string> {
    const res = await call('post', '/admin/workspaces').send({ name }).expect(201)
    return res.body.id as string
  }
  async function invite(workspaceId: string, body: Record<string, unknown>): Promise<string> {
    const res = await call('post', `/admin/workspaces/${workspaceId}/members`)
      .send(body)
      .expect(201)
    return res.body.member.id as string
  }

  // Every route of the API that names a workspace, as Express routes them (`/v1/…/:workspaceId…`):
  // a route added later is covered without changing this test.
  function workspaceRoutes(): Array<{ method: Method; path: string }> {
    const router = (
      app.getHttpAdapter().getInstance() as {
        router: { stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }> }
      }
    ).router
    return router.stack.flatMap(({ route }) =>
      route && route.path.includes(':workspaceId')
        ? Object.keys(route.methods)
            .filter((m): m is Method => ['get', 'post', 'put', 'patch', 'delete'].includes(m))
            .map((method) => ({ method, path: route.path.replace(/^\/v1/, '') }))
        : [],
    )
  }
  const pathFor = (path: string, workspaceId: string) =>
    path.replace(':workspaceId', workspaceId).replace(/:[A-Za-z]+/g, UNKNOWN)

  it('refuses every route naming a workspace to whoever is not in it, exactly as an unknown workspace', async () => {
    const routes = workspaceRoutes()
    // Settings, logo, members and entering the workspace: none may escape.
    expect(routes.length).toBeGreaterThanOrEqual(10)
    expect(routes).toEqual(
      expect.arrayContaining([
        { method: 'get', path: '/workspaces/:workspaceId' },
        { method: 'patch', path: '/admin/workspaces/:workspaceId' },
        { method: 'post', path: '/admin/workspaces/:workspaceId/logo' },
        { method: 'post', path: '/admin/workspaces/:workspaceId/members' },
        { method: 'post', path: '/admin/workspaces/:workspaceId/members/:membershipId/deactivate' },
        // E05.09: its forms and the candidatures it receives.
        { method: 'get', path: '/admin/workspaces/:workspaceId/forms' },
        { method: 'put', path: '/admin/workspaces/:workspaceId/forms/:formId/usage' },
        { method: 'post', path: '/admin/workspaces/:workspaceId/forms/:formId/draft/fields' },
        { method: 'get', path: '/workspaces/:workspaceId/candidatures/:candidatureId' },
        // E06.01: the financing status it gives a candidature.
        {
          method: 'post',
          path: '/workspaces/:workspaceId/candidatures/:candidatureId/financing-status',
        },
        // E06.02: the categories of sources of its financing plans.
        { method: 'get', path: '/workspaces/:workspaceId/funding-source-categories' },
        { method: 'post', path: '/admin/workspaces/:workspaceId/funding-source-categories' },
        { method: 'put', path: '/admin/workspaces/:workspaceId/funding-source-categories/order' },
        {
          method: 'patch',
          path: '/admin/workspaces/:workspaceId/funding-source-categories/:categoryId',
        },
        // E06.03: the financing plan of a candidature it receives.
        {
          method: 'get',
          path: '/workspaces/:workspaceId/candidatures/:candidatureId/funding-plan',
        },
        {
          method: 'post',
          path: '/workspaces/:workspaceId/candidatures/:candidatureId/funding-plan/lines',
        },
        {
          method: 'patch',
          path: '/workspaces/:workspaceId/candidatures/:candidatureId/funding-plan/lines/:lineId',
        },
        {
          method: 'delete',
          path: '/workspaces/:workspaceId/candidatures/:candidatureId/funding-plan/lines/:lineId',
        },
        // E06.05: its schemes, and the eligibilities of a candidature it receives.
        { method: 'get', path: '/workspaces/:workspaceId/eligibility-schemes' },
        { method: 'post', path: '/admin/workspaces/:workspaceId/eligibility-schemes' },
        { method: 'put', path: '/admin/workspaces/:workspaceId/eligibility-schemes/order' },
        { method: 'patch', path: '/admin/workspaces/:workspaceId/eligibility-schemes/:schemeId' },
        {
          method: 'get',
          path: '/workspaces/:workspaceId/candidatures/:candidatureId/eligibilities',
        },
        {
          method: 'post',
          path: '/workspaces/:workspaceId/candidatures/:candidatureId/eligibilities',
        },
        {
          method: 'patch',
          path: '/workspaces/:workspaceId/candidatures/:candidatureId/eligibilities/:eligibilityId',
        },
        {
          method: 'delete',
          path: '/workspaces/:workspaceId/candidatures/:candidatureId/eligibilities/:eligibilityId',
        },
        // E06.06: its support path, and the path of a candidature it receives.
        { method: 'get', path: '/workspaces/:workspaceId/support-steps' },
        { method: 'post', path: '/admin/workspaces/:workspaceId/support-steps' },
        { method: 'put', path: '/admin/workspaces/:workspaceId/support-steps/order' },
        { method: 'patch', path: '/admin/workspaces/:workspaceId/support-steps/:stepId' },
        {
          method: 'get',
          path: '/workspaces/:workspaceId/candidatures/:candidatureId/support-path',
        },
        {
          method: 'patch',
          path: '/workspaces/:workspaceId/candidatures/:candidatureId/support-path/steps/:stepId',
        },
      ]),
    )
    await call('post', `/admin/workspaces/${cci}/members/${claireInCci}/deactivate`).expect(201)
    // Without membership; manager of another workspace; deactivated member.
    for (const as of ['sophie', 'financeur', 'paul', 'claire'] as const) {
      for (const { method, path } of routes) {
        // An empty body: the access check comes before validation, nothing tells the cases apart.
        const inside = await call(method, pathFor(path, cci), as).send({})
        const unknown = await call(method, pathFor(path, UNKNOWN), as).send({})
        expect([as, method, path, inside.status, inside.body]).toEqual([
          as,
          method,
          path,
          404,
          NOT_FOUND,
        ])
        expect(unknown.body).toEqual(inside.body)
      }
    }
    expect(fake.table('workspace').get(cci)).toMatchObject({ name: 'CCI Touraine', logoKey: null })
    expect(fake.table('workspaceMembership').size).toBe(4)
  })

  it('lets a person with several memberships see them all and enter each, with its own rights', async () => {
    const mine = await call('get', '/workspaces/memberships', 'marie').expect(200)
    expect(
      mine.body.map((m: { workspace: { id: string }; role: string }) => [m.workspace.id, m.role]),
    ).toEqual([
      [cci, 'conseiller'],
      [club, 'investisseur'],
    ])

    const inCci = await call('get', `/workspaces/${cci}`, 'marie').expect(200)
    expect(inCci.body).toMatchObject({
      workspace: { id: cci, name: 'CCI Touraine' },
      membership: { id: marieInCci, role: 'conseiller', canManageWorkspace: true },
      canManageWorkspace: true,
    })
    expect(inCci.body.workspace).not.toHaveProperty('emailDomain')
    const inClub = await call('get', `/workspaces/${club}`, 'marie').expect(200)
    expect(inClub.body).toMatchObject({
      workspace: { id: club, name: 'Club deal' },
      membership: { role: 'investisseur', canManageWorkspace: false },
      canManageWorkspace: false,
    })
    // Switching workspace changes what is checked, request by request: she manages the CCI, not the
    // club where she is an investor (403: she knows it exists).
    await call('get', `/admin/workspaces/${cci}/members`, 'marie').expect(200)
    const club403 = await call('get', `/admin/workspaces/${club}/members`, 'marie').expect(403)
    expect(club403.body.error.message).toContain('gestionnaires')
    await call('patch', `/admin/workspaces/${club}`, 'marie').send({ name: 'Pirate' }).expect(403)
    // The club's manager is not let into the CCI.
    await call('get', `/workspaces/${cci}`, 'paul').expect(404)
    await call('get', `/admin/workspaces/${cci}/members`, 'paul').expect(404)
  })

  it('closes a workspace at the next request once the membership is deactivated, and only that one', async () => {
    await call('get', `/workspaces/${cci}`, 'marie').expect(200)
    const clubMembers = await call('get', `/admin/workspaces/${club}/members`, 'paul').expect(200)
    const marieInClub = clubMembers.body.find(
      (m: { user: { id: string } }) => m.user.id === 'marie',
    ).id
    await call(
      'post',
      `/admin/workspaces/${club}/members/${marieInClub}/deactivate`,
      'paul',
    ).expect(201)
    // Same token, next request.
    expect((await call('get', `/workspaces/${club}`, 'marie')).body).toEqual(NOT_FOUND)
    await call('get', `/workspaces/${cci}`, 'marie').expect(200)
    const mine = await call('get', '/workspaces/memberships', 'marie').expect(200)
    expect(mine.body.map((m: { workspace: { id: string } }) => m.workspace.id)).toEqual([cci])

    // Reactivated: the workspace opens again.
    await call(
      'post',
      `/admin/workspaces/${club}/members/${marieInClub}/reactivate`,
      'paul',
    ).expect(201)
    await call('get', `/workspaces/${club}`, 'marie').expect(200)
  })

  it('opens every workspace to a Confluent administrator, but not an unknown one', async () => {
    for (const id of [cci, club]) {
      const res = await call('get', `/workspaces/${id}`).expect(200)
      expect(res.body).toMatchObject({ membership: null, canManageWorkspace: true })
    }
    expect((await call('get', `/workspaces/${UNKNOWN}`)).body).toEqual(NOT_FOUND)
    await call('get', `/admin/workspaces/${UNKNOWN}/members`).expect(404)
    await call('get', '/workspaces/memberships').expect(200).expect([])
  })

  it('keeps the journeys of accounts without membership as they were', async () => {
    for (const as of ['sophie', 'financeur'] as const) {
      await call('get', '/workspaces/memberships', as).expect(200).expect([])
      await call('get', '/dossiers', as).expect(200)
    }
    await call('get', `/workspaces/${cci}`, null).expect(401)
    await call('get', '/workspaces/memberships', null).expect(401)
  })
})
