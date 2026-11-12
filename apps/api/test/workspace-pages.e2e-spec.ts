import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { ZodValidationPipe } from 'nestjs-zod'
import request from 'supertest'
import type { App } from 'supertest/types'
import {
  DEFAULT_PUBLIC_PAGE_BLOCKS,
  PUBLIC_PAGE_BLOCKS,
  PUBLIC_WORKSPACE_FIELDS,
  WORKSPACE_PAGE_LIMITS,
  publicWorkspacePageSchema,
  workspacePageSettingsSchema,
} from '@confluent/shared'
import { AppModule } from './../src/app.module'
import { GlobalExceptionFilter } from './../src/common/filters/global-exception.filter'
import { PrismaService } from './../src/prisma/prisma.service'
import { EMAIL_TRANSPORT } from './../src/modules/auth/email/email-transport'
import { WORKSPACE_PAGE_RATE_LIMITS } from './../src/modules/workspace-pages/workspace-pages.controller'
import { createFakePrisma } from '../src/testing/fake-prisma'

// ROADMAP E09.01: a workspace's public page over HTTP — closed by default, the same 404 for an
// unknown slug and an unpublished page, a closed list of fields, the next offered sessions by name
// and time only, the logo without any bucket address, a per-address limit; its settings written by
// the workspace's managers alone, from the version they read.
const ACCOUNTS = {
  admin: { role: 'admin', email: 'admin@confluent.dev' },
  manager: { role: 'financeur', email: 'marie@cci-touraine.fr' },
  advisor: { role: 'financeur', email: 'luc@cci-touraine.fr' },
  investor: { role: 'financeur', email: 'claire@angels.fr' },
  clubManager: { role: 'financeur', email: 'paul@club-deal.fr' },
  entrepreneur: { role: 'entrepreneur', email: 'eve@startup.fr' },
} as const
type Account = keyof typeof ACCOUNTS

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
)
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00])

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
const PAGE = {
  published: true,
  criteria: 'Entreprises innovantes de la région Centre-Val de Loire.\n\nMoins de 5 ans.',
  contact: 'Écrivez à vitrine@cci-touraine.fr ou appelez le 02 47 00 00 00.',
}

describe('workspace public page (e2e)', () => {
  let app: INestApplication<App>
  let fake: ReturnType<typeof createFakePrisma>
  const jwt: Record<string, string> = {}
  let cci: string
  let club: string
  let ip = 0

  const call = (method: 'get' | 'put' | 'post' | 'patch', path: string, as: Account | null) => {
    const req = request(app.getHttpServer())[method](`/v1${path}`)
    return as ? req.set('Authorization', `Bearer ${jwt[as]}`) : req
  }
  const settingsPath = (workspaceId: string) => `/admin/workspaces/${workspaceId}/public-page`
  const readSettings = (workspaceId = cci, as: Account = 'manager') =>
    call('get', settingsPath(workspaceId), as)
  const write = (body: Record<string, unknown>, workspaceId = cci, as: Account = 'manager') =>
    call('put', settingsPath(workspaceId), as).send(body)
  const publish = async (patch: Record<string, unknown> = {}, workspaceId = cci) => {
    const { version } = (await readSettings(workspaceId, 'admin').expect(200)).body
    return (await write({ ...PAGE, ...patch, version }, workspaceId, 'admin').expect(200)).body as {
      version: number
    }
  }
  // Each public call from its own network address unless told (the routes' per-minute limits).
  const visitor = (address = `203.0.113.${++ip}`) => ({
    page: (slug: string) =>
      request(app.getHttpServer())
        .get(`/v1/public/workspaces/${slug}`)
        .set('X-Forwarded-For', address),
    logo: (slug: string) =>
      request(app.getHttpServer())
        .get(`/v1/public/workspaces/${slug}/logo`)
        .set('X-Forwarded-For', address),
  })
  const plan = async (
    patch: Record<string, unknown> = {},
    workspaceId = cci,
    as: Account = 'manager',
  ) =>
    (
      await call('post', `/admin/workspaces/${workspaceId}/committees`, as)
        .send({ ...JUNE, ...patch })
        .expect(201)
    ).body as { id: string; version: number }
  const journal = () =>
    [...fake.table('auditLog').values()].filter((e) => e.actionType === 'workspace_updated')

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
      call('post', `/admin/workspaces/${workspaceId}/members`, 'admin').send(body).expect(201)
    cci = (
      await call('post', '/admin/workspaces', 'admin')
        .send({
          name: 'CCI Touraine',
          programName: 'MoneyPlace',
          color: '#1d4ed8',
          presentation: 'La CCI accompagne les entreprises innovantes.',
          contactEmail: 'membres-prive@cci-touraine.fr',
          emailDomain: 'cci-touraine.fr',
        })
        .expect(201)
    ).body.id
    club = (
      await call('post', '/admin/workspaces', 'admin').send({ name: 'Club deal' }).expect(201)
    ).body.id
    await invite(cci, {
      email: ACCOUNTS.manager.email,
      role: 'conseiller',
      canManageWorkspace: true,
    })
    await invite(cci, { email: ACCOUNTS.advisor.email, role: 'conseiller' })
    await invite(cci, {
      email: ACCOUNTS.investor.email,
      role: 'investisseur',
      organization: 'ORGANISATION-MEMBRE Angels',
    })
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

  it('answers the same 404 for an unknown slug, an invalid one and an unpublished page (closed by default)', async () => {
    const answers = []
    for (const slug of ['cci-touraine', 'inconnu', 'CCI-Touraine', '%20cci-touraine', 'a']) {
      const page = await visitor().page(slug)
      const logo = await visitor().logo(slug)
      answers.push([page.status, page.body], [logo.status, logo.body])
    }
    expect(new Set(answers.map((a) => JSON.stringify(a))).size).toBe(1)
    expect(answers[0]).toEqual([
      404,
      { error: { code: 'NOT_FOUND', message: 'Aucune page publique à cette adresse.' } },
    ])
    expect(JSON.stringify(answers[0])).not.toMatch(/CCI|cci-touraine/)
  })

  it('shows a published page with its closed list of fields, the offered sessions by name and time, and nothing internal', async () => {
    const june = await plan({ participationRequestsOpen: true })
    // Not offered: closed to requests, cancelled, or already started.
    await plan({ name: 'COMITE-FERME', date: '2099-05-10' })
    const cancelled = await plan({
      name: 'COMITE-ANNULE',
      date: '2099-07-10',
      participationRequestsOpen: true,
    })
    await call('post', `/admin/workspaces/${cci}/committees/${cancelled.id}/status`, 'manager')
      .send({ status: 'cancelled', version: 1 })
      .expect(200)
    await plan({ name: 'COMITE-AUTRE', participationRequestsOpen: true }, club, 'clubManager')
    await publish()

    const res = await visitor().page('cci-touraine').expect(200)
    expect(publicWorkspacePageSchema.parse(res.body)).toEqual(res.body)
    expect(res.body).toEqual({
      workspace: {
        slug: 'cci-touraine',
        name: 'CCI Touraine',
        programName: 'MoneyPlace',
        color: '#1d4ed8',
        presentation: 'La CCI accompagne les entreprises innovantes.',
        criteria: PAGE.criteria,
        contact: PAGE.contact,
        logoVersion: null,
      },
      // E09.04: by default every block, those with something to show, in E09.01's order.
      blocks: ['presentation', 'criteria', 'committees', 'participate', 'contact'],
      committees: [
        {
          id: june.id,
          name: 'Comité de juin',
          date: '2099-06-10',
          time: '14:00',
          timeZone: 'Europe/Paris',
          startsAt: '2099-06-10T12:00:00.000Z',
        },
      ],
      receivesCandidatures: false,
      receivesParticipationRequests: true,
      // E09.02: no owner consented to a card (test/showcase-cards.e2e-spec.ts).
      cards: [],
      // E09.06: closed to search engines until its managers allow it.
      indexable: false,
    })
    expect(Object.keys(res.body.workspace)).toEqual([...PUBLIC_WORKSPACE_FIELDS])
    const text = JSON.stringify(res.body)
    for (const secret of [
      cci,
      'membres-prive',
      '"cci-touraine.fr"',
      'PRIVE',
      'NOTE-INTERNE',
      'INFO-DIFFUSEE',
      'COMITE-',
      'ORGANISATION-MEMBRE',
      ...Object.values(ACCOUNTS).map((a) => a.email),
      '"version"',
      '"published"',
      '"location"',
      '"meetingUrl"',
      '"workspaceId"',
    ]) {
      expect([secret, text.includes(secret)]).toEqual([secret, false])
    }
  })

  it('lists at most the next ten offered sessions, soonest first', async () => {
    for (let day = 12; day >= 1; day--) {
      await plan({
        name: `Session ${day}`,
        date: `2099-06-${String(day).padStart(2, '0')}`,
        participationRequestsOpen: true,
      })
    }
    await publish()
    const res = await visitor().page('cci-touraine').expect(200)
    expect(res.body.committees.map((c: { name: string }) => c.name)).toEqual(
      Array.from({ length: WORKSPACE_PAGE_LIMITS.committees }, (_, i) => `Session ${i + 1}`),
    )
  })

  it('says whether the workspace receives candidatures (a published candidature form)', async () => {
    await publish()
    const form = await fake.prisma.questionnaire.create({
      data: { workspaceId: cci, usage: 'candidature', name: 'Candidature CCI' },
    })
    await fake.prisma.questionnaireVersion.create({
      data: { questionnaireId: form.id, version: 1, status: 'draft' },
    })
    expect((await visitor().page('cci-touraine').expect(200)).body.receivesCandidatures).toBe(false)
    await fake.prisma.questionnaireVersion.create({
      data: { questionnaireId: form.id, version: 2, status: 'published' },
    })
    expect((await visitor().page('cci-touraine').expect(200)).body.receivesCandidatures).toBe(true)
    // Archived, the form no longer opens candidatures.
    await fake.prisma.questionnaire.update({
      where: { id: form.id },
      data: { archivedAt: new Date() },
    })
    expect((await visitor().page('cci-touraine').expect(200)).body.receivesCandidatures).toBe(false)
  })

  it('serves the logo of a published page from the API, never a bucket address, and stops with the page', async () => {
    await publish()
    // No logo: the page's 404.
    expect((await visitor().logo('cci-touraine').expect(404)).body.error.message).toBe(
      'Aucune page publique à cette adresse.',
    )
    await call('post', `/admin/workspaces/${cci}/logo`, 'manager')
      .attach('file', PNG, 'logo.png')
      .expect(201)
    const page = await visitor().page('cci-touraine').expect(200)
    const first = page.body.workspace.logoVersion as string
    expect(first).toMatch(/^[0-9a-f]{16}$/)
    expect(JSON.stringify(page.body)).not.toMatch(/memory:|workspaces\/|logo\//)

    const logo = await visitor().logo('cci-touraine').buffer(true).expect(200)
    expect(Buffer.compare(logo.body as Buffer, PNG)).toBe(0)
    expect(logo.headers).toMatchObject({
      'content-type': 'image/png',
      'content-length': String(PNG.byteLength),
      'cross-origin-resource-policy': 'cross-origin',
      'x-content-type-options': 'nosniff',
      'cache-control': 'public, max-age=300',
      'content-security-policy': "default-src 'none'; sandbox",
    })

    // A new image, a new version; the type is recognised from the content.
    await call('post', `/admin/workspaces/${cci}/logo`, 'manager')
      .attach('file', JPEG, 'logo.png')
      .expect(201)
    const second = (await visitor().page('cci-touraine').expect(200)).body.workspace.logoVersion
    expect(second).toMatch(/^[0-9a-f]{16}$/)
    expect(second).not.toBe(first)
    expect((await visitor().logo('cci-touraine').expect(200)).headers['content-type']).toBe(
      'image/jpeg',
    )

    // Lost image: the page's 404, never a 500.
    const key = fake.table('workspace').get(cci)!.logoKey as string
    const storage = app.get<{ delete: (k: string) => Promise<void> }>(
      (await import('./../src/modules/documents/storage/storage.adapter')).STORAGE_TOKEN,
    )
    await storage.delete(key)
    await visitor().logo('cci-touraine').expect(404)

    // Unpublished: the page and its logo disappear alike.
    await call('post', `/admin/workspaces/${cci}/logo`, 'manager')
      .attach('file', PNG, 'logo.png')
      .expect(201)
    await visitor().logo('cci-touraine').expect(200)
    await publish({ published: false })
    const gone = [await visitor().page('cci-touraine'), await visitor().logo('cci-touraine')]
    const unknown = await visitor().page('inconnu')
    for (const res of gone) expect([res.status, res.body]).toEqual([404, unknown.body])
  })

  it('lets the managers read and write the page from the version they read, and journals the change without the texts', async () => {
    const initial = await readSettings().expect(200)
    expect(workspacePageSettingsSchema.parse(initial.body)).toEqual(initial.body)
    expect(initial.body).toMatchObject({
      published: false,
      criteria: null,
      contact: null,
      version: 1,
      // What the public would see once published.
      preview: { workspace: { name: 'CCI Touraine', criteria: null }, committees: [] },
    })

    const saved = await write({ ...PAGE, published: false, version: 1 }).expect(200)
    expect(saved.body).toMatchObject({
      published: false,
      criteria: PAGE.criteria,
      version: 2,
      preview: { workspace: { criteria: PAGE.criteria, contact: PAGE.contact } },
    })
    // Saved but not published: still the 404.
    await visitor().page('cci-touraine').expect(404)

    // A stale version is refused, nothing written.
    const stale = await write({ ...PAGE, version: 1 }).expect(409)
    expect(stale.body.error).toMatchObject({
      code: 'CONFLICT',
      message: expect.stringMatching(/modifiée entre-temps/),
      details: { currentVersion: 2 },
    })
    expect(fake.table('workspace').get(cci)).toMatchObject({
      publicPagePublished: false,
      publicPageVersion: 2,
    })

    const published = await write({ ...PAGE, version: 2 }).expect(200)
    expect(published.body).toMatchObject({ published: true, version: 3 })
    await visitor().page('cci-touraine').expect(200)

    // The same values write nothing: no new version, no journal entry.
    const same = await write({ ...PAGE, version: 3 }).expect(200)
    expect(same.body.version).toBe(3)

    // Blank clears; texts normalised like the site's.
    const cleared = await write({
      published: true,
      criteria: '   ',
      contact: '  Une ligne  \r\n\r\n\r\n  Deux  ',
      version: 3,
    }).expect(200)
    expect(cleared.body).toMatchObject({ criteria: null, contact: 'Une ligne\n\nDeux', version: 4 })

    const entries = journal()
    expect(entries.map((e) => e.metadata)).toEqual([
      {
        workspaceId: cci,
        changes: ['publicCriteria', 'publicContact'],
        publicPageVersion: 2,
      },
      {
        workspaceId: cci,
        changes: ['publicPagePublished'],
        publicPageVersion: 3,
        publicPagePublished: { from: false, to: true },
      },
      {
        workspaceId: cci,
        changes: ['publicCriteria', 'publicContact'],
        publicPageVersion: 4,
      },
    ])
    expect(entries.every((e) => e.actorId === 'manager')).toBe(true)
    expect(JSON.stringify(entries)).not.toMatch(/innovantes|vitrine@|Une ligne/)
  })

  it('refuses invalid settings, and the general settings cannot reach the page', async () => {
    for (const body of [
      { ...PAGE, criteria: 'Voir <a href="x">ici</a>', version: 1 },
      { ...PAGE, contact: '<script>alert(1)</script>', version: 1 },
      { ...PAGE, criteria: 'x'.repeat(WORKSPACE_PAGE_LIMITS.criteria + 1), version: 1 },
      { ...PAGE, contact: 'x'.repeat(WORKSPACE_PAGE_LIMITS.contact + 1), version: 1 },
      { ...PAGE },
      { ...PAGE, version: 0 },
      { ...PAGE, published: 'oui', version: 1 },
      { criteria: null, contact: null, version: 1 },
      { ...PAGE, version: 1, presentation: 'autre' },
      // E09.04: a closed catalogue, each block at most once.
      { ...PAGE, version: 1, blocks: ['presentation', 'texte-libre'] },
      { ...PAGE, version: 1, blocks: ['contact', 'contact'] },
      { ...PAGE, version: 1, blocks: [...PUBLIC_PAGE_BLOCKS, 'contact'] },
      { ...PAGE, version: 1, blocks: 'contact' },
      { ...PAGE, version: 1, blocks: null },
      { ...PAGE, version: 1, blocks: [{ type: 'contact', enabled: true }] },
      // E09.06: a boolean only.
      { ...PAGE, version: 1, indexable: 'oui' },
      { ...PAGE, version: 1, indexable: null },
      { ...PAGE, version: 1, indexable: 1 },
    ]) {
      const res = await write(body)
      expect([JSON.stringify(body).slice(0, 60), res.status]).toEqual([
        JSON.stringify(body).slice(0, 60),
        400,
      ])
    }
    for (const body of [
      { publicPagePublished: true },
      { publicCriteria: 'x' },
      { published: true },
      { publicPageBlocks: ['contact'] },
      { blocks: ['contact'] },
      { publicPageIndexable: true },
      { indexable: true },
    ]) {
      await call('patch', `/admin/workspaces/${cci}`, 'manager').send(body).expect(400)
    }
    expect(fake.table('workspace').get(cci)).toMatchObject({
      publicPagePublished: false,
      publicCriteria: null,
      publicContact: null,
      publicPageVersion: 1,
      publicPageBlocks: [...DEFAULT_PUBLIC_PAGE_BLOCKS],
      publicPageIndexable: false,
    })
    expect(journal()).toEqual([])
  })

  it('reserves the settings to the workspace’s managers: 403 for its other members, the same 404 outside it', async () => {
    const outside: Array<[Account | null, string, number]> = [
      ['advisor', cci, 403],
      ['investor', cci, 403],
      ['clubManager', cci, 404],
      ['entrepreneur', cci, 404],
      ['manager', club, 404],
      ['manager', '6f1c2a8e-0000-4000-8000-000000000000', 404],
      [null, cci, 401],
    ]
    const notFound = (await readSettings(club, 'manager')).body
    for (const [as, workspaceId, status] of outside) {
      const read = await call('get', settingsPath(workspaceId), as)
      const wrote = await call('put', settingsPath(workspaceId), as).send({
        ...PAGE,
        blocks: ['contact'],
        indexable: true,
        version: 1,
      })
      // An invalid body changes nothing to the answer of whoever is outside the workspace.
      const invalid = await call('put', settingsPath(workspaceId), as).send({ nope: true })
      expect([as, workspaceId, read.status, wrote.status]).toEqual([
        as,
        workspaceId,
        status,
        status,
      ])
      if (status === 404) {
        expect(read.body).toEqual(notFound)
        expect([invalid.status, invalid.body]).toEqual([404, notFound])
      }
    }
    await readSettings(cci, 'admin').expect(200)
    await readSettings(cci, 'manager').expect(200)
    // A manager deprived of the right, or deactivated, is refused at the next request.
    const membership = [...fake.table('workspaceMembership').values()].find(
      (m) => m.userId === 'manager' && m.workspaceId === cci,
    )!
    membership.canManageWorkspace = false
    await write({ ...PAGE, blocks: ['contact'], version: 1 }).expect(403)
    await write({ ...PAGE, indexable: true, version: 1 }).expect(403)
    membership.canManageWorkspace = true
    membership.deactivatedAt = new Date()
    await write({ ...PAGE, blocks: ['contact'], version: 1 }).expect(404)
    await write({ ...PAGE, indexable: true, version: 1 }).expect(404)
    expect(fake.table('workspace').get(cci)).toMatchObject({
      publicPageVersion: 1,
      publicPageBlocks: [...DEFAULT_PUBLIC_PAGE_BLOCKS],
      publicPageIndexable: false,
    })
    expect(journal()).toEqual([])
  })

  it('lets the managers choose the blocks shown and their order: the public reads them so, nothing of the others, journaled without the texts', async () => {
    const june = await plan({ participationRequestsOpen: true })
    const form = await fake.prisma.questionnaire.create({
      data: { workspaceId: cci, usage: 'candidature', name: 'Candidature CCI' },
    })
    await fake.prisma.questionnaireVersion.create({
      data: { questionnaireId: form.id, version: 1, status: 'published' },
    })
    const first = await publish()
    const all = (await visitor().page('cci-touraine').expect(200)).body
    expect(all.blocks).toEqual([
      'presentation',
      'criteria',
      'committees',
      'apply',
      'participate',
      'contact',
    ])
    fake.table('auditLog').clear()

    // Contact first, then the call to take part — without the sessions' list —, then criteria.
    const chosen = ['contact', 'participate', 'criteria']
    const saved = await write({ ...PAGE, blocks: chosen, version: first.version }).expect(200)
    expect(workspacePageSettingsSchema.parse(saved.body)).toEqual(saved.body)
    expect(saved.body).toMatchObject({ blocks: chosen, version: first.version + 1 })
    const page = await visitor().page('cci-touraine').expect(200)
    expect(publicWorkspacePageSchema.parse(page.body)).toEqual(page.body)
    expect(page.body).toEqual({
      workspace: {
        slug: 'cci-touraine',
        name: 'CCI Touraine',
        programName: 'MoneyPlace',
        color: '#1d4ed8',
        presentation: null,
        criteria: PAGE.criteria,
        contact: PAGE.contact,
        logoVersion: null,
      },
      blocks: chosen,
      committees: [],
      receivesCandidatures: false,
      receivesParticipationRequests: true,
      cards: [],
      indexable: false,
    })
    const text = JSON.stringify(page.body)
    for (const hidden of [june.id, 'Comité de juin', 'accompagne', '2099-06-10']) {
      expect([hidden, text.includes(hidden)]).toEqual([hidden, false])
    }
    // The preview is the public page, by the same projection; the content holds every block's.
    expect(saved.body.preview).toEqual(page.body)
    expect(saved.body.content).toMatchObject({
      workspace: { presentation: 'La CCI accompagne les entreprises innovantes.' },
      committees: [{ id: june.id }],
      receivesCandidatures: true,
    })

    // Not named: kept as they are. The same blocks: nothing written.
    const kept = await write({ ...PAGE, version: first.version + 1 }).expect(200)
    expect(kept.body).toMatchObject({ blocks: chosen, version: first.version + 1 })
    await write({ ...PAGE, blocks: chosen, version: first.version + 1 }).expect(200)

    // None shown: the header alone.
    const none = await write({ ...PAGE, blocks: [], version: first.version + 1 }).expect(200)
    expect(none.body.version).toBe(first.version + 2)
    const empty = (await visitor().page('cci-touraine').expect(200)).body
    expect(empty).toMatchObject({
      workspace: { name: 'CCI Touraine', presentation: null, criteria: null, contact: null },
      blocks: [],
      committees: [],
      receivesCandidatures: false,
      receivesParticipationRequests: false,
      cards: [],
    })

    // From a stale version: refused, nothing written.
    await write({ ...PAGE, blocks: chosen, version: first.version + 1 }).expect(409)
    expect(fake.table('workspace').get(cci)!.publicPageBlocks).toEqual([])

    const entries = journal()
    expect(entries.map((e) => e.metadata)).toEqual([
      {
        workspaceId: cci,
        changes: ['publicPageBlocks'],
        publicPageVersion: first.version + 1,
        publicPageBlocks: { from: [...DEFAULT_PUBLIC_PAGE_BLOCKS], to: chosen },
      },
      {
        workspaceId: cci,
        changes: ['publicPageBlocks'],
        publicPageVersion: first.version + 2,
        publicPageBlocks: { from: chosen, to: [] },
      },
    ])
    expect(JSON.stringify(entries)).not.toMatch(/innovantes|vitrine@|juin/)
  })

  // ROADMAP E09.06: indexing by search engines, closed until the managers allow it.
  it('keeps a page closed to search engines until its managers allow it; the public reads it only once published', async () => {
    const initial = (await readSettings().expect(200)).body
    expect(initial).toMatchObject({ indexable: false, preview: { indexable: false } })

    // Allowed before publication: stored, shown in the preview, the page still the same 404.
    const allowed = await write({
      ...PAGE,
      published: false,
      indexable: true,
      version: 1,
    }).expect(200)
    expect(workspacePageSettingsSchema.parse(allowed.body)).toEqual(allowed.body)
    expect(allowed.body).toMatchObject({
      published: false,
      indexable: true,
      version: 2,
      preview: { indexable: true },
    })
    const unknown = await visitor().page('inconnu').expect(404)
    const unpublished = await visitor().page('cci-touraine').expect(404)
    expect(unpublished.body).toEqual(unknown.body)

    // Published: the public reads it.
    await write({ ...PAGE, indexable: true, version: 2 }).expect(200)
    const page = await visitor().page('cci-touraine').expect(200)
    expect(publicWorkspacePageSchema.parse(page.body)).toEqual(page.body)
    expect(page.body.indexable).toBe(true)
    expect((await readSettings().expect(200)).body.preview).toEqual(page.body)

    // Left out: kept as it is. The same value: nothing written.
    const kept = await write({ ...PAGE, criteria: 'Autres critères.', version: 3 }).expect(200)
    expect(kept.body).toMatchObject({ indexable: true, version: 4 })
    await write({ ...PAGE, criteria: 'Autres critères.', indexable: true, version: 4 }).expect(200)
    expect(fake.table('workspace').get(cci)!.publicPageVersion).toBe(4)

    // Withdrawn: closed at the next read. From a stale version: refused, nothing written.
    await write({ ...PAGE, indexable: true, version: 3 }).expect(409)
    const closed = await write({
      ...PAGE,
      criteria: 'Autres critères.',
      indexable: false,
      version: 4,
    })
    expect(closed.status).toBe(200)
    expect((await visitor().page('cci-touraine').expect(200)).body.indexable).toBe(false)
    expect(fake.table('workspace').get(cci)).toMatchObject({
      publicPageIndexable: false,
      publicPageVersion: 5,
    })

    // Unpublished again with indexing allowed: nothing for the public.
    await write({ ...PAGE, published: false, indexable: true, version: 5 }).expect(200)
    expect((await visitor().page('cci-touraine').expect(404)).body).toEqual(unknown.body)

    expect(journal().map((e) => [e.actorId, e.metadata])).toEqual([
      [
        'manager',
        {
          workspaceId: cci,
          changes: ['publicCriteria', 'publicContact', 'publicPageIndexable'],
          publicPageVersion: 2,
          publicPageIndexable: { from: false, to: true },
        },
      ],
      [
        'manager',
        {
          workspaceId: cci,
          changes: ['publicPagePublished'],
          publicPageVersion: 3,
          publicPagePublished: { from: false, to: true },
        },
      ],
      ['manager', { workspaceId: cci, changes: ['publicCriteria'], publicPageVersion: 4 }],
      [
        'manager',
        {
          workspaceId: cci,
          changes: ['publicPageIndexable'],
          publicPageVersion: 5,
          publicPageIndexable: { from: true, to: false },
        },
      ],
      [
        'manager',
        {
          workspaceId: cci,
          changes: ['publicPagePublished', 'publicCriteria', 'publicPageIndexable'],
          publicPageVersion: 6,
          publicPagePublished: { from: true, to: false },
          publicPageIndexable: { from: false, to: true },
        },
      ],
    ])
  })

  it('marks every public answer `noindex, nofollow`, refusals included, whether the page is indexable or not', async () => {
    const robots = (res: request.Response) => [res.status, res.headers['x-robots-tag']]
    const read = async () => [
      await visitor().page('cci-touraine'),
      await visitor().page('inconnu'),
      await visitor().logo('cci-touraine'),
      await request(app.getHttpServer()).get(
        '/v1/public/workspaces/cci-touraine/participation-form',
      ),
    ]
    expect((await read()).map(robots)).toEqual([
      [404, 'noindex, nofollow'],
      [404, 'noindex, nofollow'],
      [404, 'noindex, nofollow'],
      [404, 'noindex, nofollow'],
    ])
    await publish({ indexable: true })
    const answers = await read()
    expect(answers.map(robots)).toEqual([
      [200, 'noindex, nofollow'],
      [404, 'noindex, nofollow'],
      [404, 'noindex, nofollow'],
      [404, 'noindex, nofollow'],
    ])
    // The page says it may be indexed: the site tells search engines (`publicPageRobots`), the JSON
    // itself is never a page to index.
    expect(answers[0].body.indexable).toBe(true)
    const busy = visitor('198.51.100.9')
    for (let i = 0; i < WORKSPACE_PAGE_RATE_LIMITS.page; i++) await busy.page('cci-touraine')
    expect(robots(await busy.page('cci-touraine'))).toEqual([429, 'noindex, nofollow'])
  })

  it('ignores at read a stored block no longer known, and a block stored twice', async () => {
    const { version } = await publish()
    fake.table('workspace').get(cci)!.publicPageBlocks = [
      'texte-libre',
      'contact',
      'criteria',
      'contact',
    ]
    const page = (await visitor().page('cci-touraine').expect(200)).body
    expect(publicWorkspacePageSchema.parse(page)).toEqual(page)
    expect(page.blocks).toEqual(['contact', 'criteria'])
    expect(JSON.stringify(page)).not.toContain('texte-libre')
    const settings = (await readSettings().expect(200)).body
    expect(settings.blocks).toEqual(['contact', 'criteria'])
    // The same blocks as read: nothing to write; others replace the stored list.
    await write({ ...PAGE, blocks: ['contact', 'criteria'], version }).expect(200)
    expect(fake.table('workspace').get(cci)!.publicPageVersion).toBe(version)
    await write({ ...PAGE, blocks: ['criteria'], version }).expect(200)
    expect(fake.table('workspace').get(cci)!.publicPageBlocks).toEqual(['criteria'])
  })

  it('limits the public routes per network address', async () => {
    await publish()
    const busy = visitor('198.51.100.7')
    for (let i = 0; i < WORKSPACE_PAGE_RATE_LIMITS.page; i++) {
      await busy.page('cci-touraine').expect(200)
    }
    const refused = await busy.page('cci-touraine').expect(429)
    expect(refused.body.error.message).toBeDefined()
    // Unknown slugs count alike: probing addresses is limited too.
    const prober = visitor('198.51.100.8')
    for (let i = 0; i < WORKSPACE_PAGE_RATE_LIMITS.page; i++) {
      await prober.page(`inconnu-${i}`).expect(404)
    }
    await prober.page('cci-touraine').expect(429)
    // Another address is not affected.
    await visitor().page('cci-touraine').expect(200)

    const pictures = visitor('198.51.100.9')
    for (let i = 0; i < WORKSPACE_PAGE_RATE_LIMITS.logo; i++) {
      await pictures.logo('cci-touraine').expect(404)
    }
    await pictures.logo('cci-touraine').expect(429)
  })
})
