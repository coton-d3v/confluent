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

// ROADMAP E06.02: the categories of sources of a workspace's financing plans — D04's six by default
// (decision still to be confirmed), configured by its managers, read by its conseillers.
const ACCOUNTS = {
  admin: { role: 'admin', email: 'admin@confluent.dev' },
  manager: { role: 'financeur', email: 'marie@cci-touraine.fr' },
  advisor: { role: 'financeur', email: 'luc@cci-touraine.fr' },
  investor: { role: 'financeur', email: 'claire@angels.fr' },
  clubManager: { role: 'financeur', email: 'paul@club-deal.fr' },
  entrepreneur: { role: 'entrepreneur', email: 'sophie@biosensio.fr' },
} as const
type Account = keyof typeof ACCOUNTS

describe('funding source categories (e2e)', () => {
  let app: INestApplication<App>
  let fake: ReturnType<typeof createFakePrisma>
  const jwt: Record<string, string> = {}
  let cci: string
  let club: string

  const call = (method: 'get' | 'post' | 'put' | 'patch', path: string, as: Account = 'admin') =>
    request(app.getHttpServer())[method](`/v1${path}`).set('Authorization', `Bearer ${jwt[as]}`)
  const read = (workspaceId: string) => `/workspaces/${workspaceId}/funding-source-categories`
  const manage = (workspaceId: string) =>
    `/admin/workspaces/${workspaceId}/funding-source-categories`

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
      investorType: 'fonds_investissement',
    })
    await invite(club, {
      email: ACCOUNTS.clubManager.email,
      role: 'conseiller',
      canManageWorkspace: true,
    })
  })

  afterEach(async () => {
    await app.close()
  })

  it('gives a new workspace D04’s categories, which its manager configures and its conseillers read', async () => {
    const initial = await call('get', read(cci), 'advisor').expect(200)
    expect(initial.body.map((c: { label: string }) => c.label)).toEqual([
      'Bpifrance',
      'Prêt d’honneur',
      'Prêt bancaire',
      'Business angels / love money',
      'Fonds d’investissement',
      'Fonds propres',
    ])
    expect(initial.body[3]).toEqual({
      id: expect.any(String),
      key: 'business_angels_love_money',
      label: 'Business angels / love money',
      family: 'business_angels_love_money',
      position: 3,
      active: true,
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    })
    const [bpi, , , ba] = initial.body as Array<{ id: string }>

    // Add, rename, deactivate, reorder.
    const added = await call('post', manage(cci), 'manager')
      .send({ label: '  Crowdfunding ', family: 'autre' })
      .expect(201)
    expect(added.body).toMatchObject({ key: 'crowdfunding', label: 'Crowdfunding', position: 6 })
    const renamed = await call('patch', `${manage(cci)}/${ba.id}`, 'manager')
      .send({ label: 'Business angels' })
      .expect(200)
    expect(renamed.body).toMatchObject({
      key: 'business_angels_love_money',
      label: 'Business angels',
    })
    await call('patch', `${manage(cci)}/${bpi.id}`, 'manager')
      .send({ active: false })
      .expect(200)
    const order = [added.body.id, ...initial.body.map((c: { id: string }) => c.id)]
    const reordered = await call('put', `${manage(cci)}/order`, 'manager')
      .send({ categoryIds: order })
      .expect(200)
    expect(reordered.body.map((c: { id: string }) => c.id)).toEqual(order)

    // The conseiller reads the configured list; the club keeps its own.
    const after = await call('get', read(cci), 'advisor').expect(200)
    expect(after.body.map((c: { label: string; active: boolean }) => [c.label, c.active])).toEqual([
      ['Crowdfunding', true],
      ['Bpifrance', false],
      ['Prêt d’honneur', true],
      ['Prêt bancaire', true],
      ['Business angels', true],
      ['Fonds d’investissement', true],
      ['Fonds propres', true],
    ])
    const clubList = await call('get', read(club), 'clubManager').expect(200)
    expect(clubList.body).toHaveLength(6)
    expect(clubList.body[0]).toMatchObject({ label: 'Bpifrance', active: true })

    const journal = [...fake.table('auditLog').values()].filter(
      (row) => row.actionType === 'funding_source_categories_updated',
    )
    expect(journal.map((row) => (row.metadata as { change: string }).change)).toEqual([
      'created',
      'updated',
      'updated',
      'reordered',
    ])
    expect(journal.every((row) => row.actorId === 'manager')).toBe(true)
  })

  it('validates bodies and answers conflicts in French', async () => {
    const list = (await call('get', read(cci), 'manager').expect(200)).body as Array<{ id: string }>
    for (const body of [
      {},
      { label: '', family: 'autre' },
      { label: 'Crowdfunding', family: 'crowdfunding' },
      { label: 'Crowdfunding', family: 'autre', key: 'crowd' },
    ]) {
      await call('post', manage(cci), 'manager').send(body).expect(400)
    }
    for (const body of [{}, { family: 'autre' }, { key: 'x' }, { active: 'non' }]) {
      await call('patch', `${manage(cci)}/${list[0].id}`, 'manager')
        .send(body)
        .expect(400)
    }
    await call('patch', `${manage(cci)}/not-a-uuid`, 'manager')
      .send({ active: false })
      .expect(400)
    await call('put', `${manage(cci)}/order`, 'manager')
      .send({ categoryIds: [list[0].id, list[0].id] })
      .expect(400)

    const taken = await call('post', manage(cci), 'manager')
      .send({ label: 'prêt BANCAIRE', family: 'pret_bancaire' })
      .expect(409)
    expect(taken.body.error).toEqual({
      code: 'CONFLICT',
      message: 'Une source s’appelle déjà « Prêt bancaire » dans ce workspace.',
      details: [{ path: ['label'], message: 'Ce libellé est déjà utilisé.' }],
    })
    const stale = await call('put', `${manage(cci)}/order`, 'manager')
      .send({ categoryIds: list.slice(1).map((c) => c.id) })
      .expect(409)
    expect(stale.body.error.message).toBe(
      'La liste des sources a changé entre-temps : rechargez-la avant de modifier son ordre.',
    )
    for (const c of list.slice(1)) {
      await call('patch', `${manage(cci)}/${c.id}`, 'manager')
        .send({ active: false })
        .expect(200)
    }
    const last = await call('patch', `${manage(cci)}/${list[0].id}`, 'manager')
      .send({ active: false })
      .expect(409)
    expect(last.body.error.message).toContain('dernière source active')
  })

  it('keeps configuration to managers and reading to conseillers, and never crosses workspaces', async () => {
    const list = (await call('get', read(cci)).expect(200)).body as Array<{ id: string }>
    const writes = (workspaceId: string, categoryId: string) =>
      [
        ['post', manage(workspaceId), { label: 'Pirate', family: 'autre' }],
        ['patch', `${manage(workspaceId)}/${categoryId}`, { label: 'Pirate' }],
        ['put', `${manage(workspaceId)}/order`, { categoryIds: list.map((c) => c.id).reverse() }],
      ] as const
    // A conseiller without the right and an investor: 403.
    for (const as of ['advisor', 'investor'] as const) {
      for (const [method, path, body] of writes(cci, list[0].id)) {
        const res = await call(method, path, as).send(body).expect(403)
        expect(res.body.error.message).toContain('gestionnaires')
      }
    }
    const investor = await call('get', read(cci), 'investor').expect(403)
    expect(investor.body.error).toEqual({
      code: 'FORBIDDEN',
      message: 'Les sources du plan de financement d’un workspace sont lues par ses conseillers.',
    })
    // Outside the workspace: 404, reading or writing.
    for (const as of ['clubManager', 'entrepreneur'] as const) {
      await call('get', read(cci), as).expect(404)
      for (const [method, path, body] of writes(cci, list[0].id)) {
        await call(method, path, as).send(body).expect(404)
      }
    }
    // The club's manager, through the club, cannot touch the CCI's categories.
    const foreign = await call('patch', `${manage(club)}/${list[0].id}`, 'clubManager')
      .send({ label: 'Pirate' })
      .expect(404)
    expect(foreign.body.error.message).toBe('Source de financement introuvable dans ce workspace.')
    await call('put', `${manage(club)}/order`, 'clubManager')
      .send({ categoryIds: list.map((c) => c.id) })
      .expect(409)
    // The administrator configures any workspace.
    await call('post', manage(club))
      .send({ label: 'Région', family: 'aides_publiques' })
      .expect(201)
    expect(
      (await call('get', read(cci)).expect(200)).body.map((c: { label: string }) => c.label),
    ).not.toContain('Pirate')
  })
})
