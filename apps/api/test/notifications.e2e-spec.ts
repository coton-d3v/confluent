import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { ZodValidationPipe } from 'nestjs-zod'
import request from 'supertest'
import type { App } from 'supertest/types'
import {
  markAllNotificationsReadResultSchema,
  notificationPageSchema,
  notificationSchema,
  notificationUnreadSchema,
} from '@confluent/shared'
import { AppModule } from './../src/app.module'
import { GlobalExceptionFilter } from './../src/common/filters/global-exception.filter'
import { PrismaService } from './../src/prisma/prisma.service'
import {
  EMAIL_TRANSPORT,
  type SendNotificationInput,
} from './../src/modules/auth/email/email-transport'
import { createFakePrisma } from '../src/testing/fake-prisma'

const id = (n: number) => `7d3c1b0e-0000-4000-8000-0000000103${n.toString().padStart(2, '0')}`
// Sophie owns Biosensio. Claire: investisseur of the CCI (Angels Touraine); Bob: investisseur of the
// CCI; Marie: managing conseillère of the CCI; Jean: conseiller of the CCI; Eve: an account without
// any share nor membership.
const SOPHIE = { id: id(1), email: 'sophie@biosensio.fr', role: 'entrepreneur' }
const CLAIRE = { id: id(2), email: 'claire@angels.fr', role: 'financeur' }
const BOB = { id: id(3), email: 'bob@banque.fr', role: 'financeur' }
const MARIE = { id: id(4), email: 'marie@cci.fr', role: 'financeur' }
const JEAN = { id: id(5), email: 'jean@cci.fr', role: 'financeur' }
const EVE = { id: id(6), email: 'eve@fonds.fr', role: 'financeur' }
const ADMIN = { id: id(9), email: 'admin@confluent.dev', role: 'admin' }
const PEOPLE = [SOPHIE, CLAIRE, BOB, MARIE, JEAN, EVE, ADMIN]
const VERSION = id(90)
const CONFLUENT_FORM = id(91)
// What the investors' identity and amounts look like: never in what the owner is told (D05).
const INVESTOR_TRACES = ['Claire', 'Martin', 'QX4242', 'Angels', '@', '25000', '25 000', '25 000']

const valid = <T>(schema: { safeParse: (v: unknown) => { error?: { issues: T[] } } }, v: unknown) =>
  expect(schema.safeParse(v).error?.issues ?? []).toEqual([])

type Item = {
  id: string
  kind: string
  title: string
  body: string | null
  href: string | null
  readAt: string | null
}

// ROADMAP E10.03 over HTTP on the stateful fake Prisma: each event tells the right person once —
// never its author, never anyone else —, in words built from what that person may read; emails for
// the kinds that have one, after the event, their failure recorded without undoing it; each person
// lists, counts and marks only their own notifications. Concurrency, the unique key and the
// migration: test/pg/notifications.pg-spec.ts. Committees' changes: committee-follow-up.e2e-spec.ts.
describe('Notifications (e2e)', () => {
  let app: INestApplication<App>
  let fake: ReturnType<typeof createFakePrisma>
  let mailed: SendNotificationInput[]
  let failMail: boolean
  const tokens: Record<string, string> = {}
  let cci: string

  beforeEach(async () => {
    fake = createFakePrisma()
    mailed = []
    failMail = false
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
        sendNotification: jest.fn((input: SendNotificationInput) => {
          if (failMail) return Promise.reject(new Error('SMTP down'))
          mailed.push(input)
          return Promise.resolve()
        }),
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
    const invite = (body: object) =>
      admin.post(`/v1/admin/workspaces/${cci}/members`, body).expect(201)
    await invite({ email: MARIE.email, role: 'conseiller', canManageWorkspace: true })
    await invite({ email: JEAN.email, role: 'conseiller' })
    await invite({ email: CLAIRE.email, role: 'investisseur', organization: 'Angels QX4242' })
    await invite({ email: BOB.email, role: 'investisseur' })
    const form = await p.questionnaire.create({
      data: { slug: `form-${cci}`, name: 'Formulaire', workspaceId: cci, usage: 'candidature' },
    })
    await p.questionnaireVersion.create({
      data: { questionnaireId: form.id, version: 1, status: 'published' },
    })
    Object.assign([...fake.table('user').values()].find((u) => u.id === CLAIRE.id)!, {
      firstName: 'Claire',
      lastName: 'Martin',
    })
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

  // What a person reads of their notifications (every page), checked against the contract.
  async function inbox(u: { id: string }, kind?: string): Promise<Item[]> {
    const items: Item[] = []
    let cursor: string | null = null
    do {
      const res = await as(u)
        .get(`/v1/notifications?limit=50${cursor ? `&cursor=${cursor}` : ''}`)
        .expect(200)
      valid(notificationPageSchema, res.body)
      items.push(...(res.body.items as Item[]))
      cursor = res.body.nextCursor as string | null
    } while (cursor)
    return kind ? items.filter((i) => i.kind === kind) : items
  }
  const rows = (kind?: string) =>
    [...fake.table('notification').values()].filter((n) => !kind || n.kind === kind)

  // Biosensio: presented to the CCI, in its pool (partial), shared with nobody yet.
  async function biosensio() {
    const dossier = (await as(SOPHIE).post('/v1/dossiers', { name: 'Biosensio' }).expect(201)).body
    Object.assign(fake.table('dossier').get(dossier.id)!, {
      submittedAt: new Date(),
      summary: 'Capteurs pour l’énergie.',
      objective: 'Industrialiser',
      amountEur: 300_000,
      financingTypes: ['equity'],
    })
    await as(SOPHIE).post(`/v1/dossiers/${dossier.id}/publish`).expect(200)
    const candidature = (
      await as(SOPHIE)
        .post(`/v1/dossiers/${dossier.id}/candidatures`, { workspaceId: cci })
        .expect(201)
    ).body
    await as(SOPHIE).post(`/v1/candidatures/${candidature.id}/submit`).expect(200)
    await as(SOPHIE)
      .put(`/v1/candidatures/${candidature.id}/pool-publication`, {
        accessLevel: 'partiel',
        consent: true,
      })
      .expect(200)
    return {
      id: dossier.id as string,
      slug: dossier.slug as string,
      candidatureId: candidature.id as string,
    }
  }

  const expectNoTrace = (items: unknown, traces = INVESTOR_TRACES) => {
    const raw = JSON.stringify(items)
    for (const trace of traces) expect([trace, raw.includes(trace)]).toEqual([trace, false])
  }

  it('tells a share’s recipient of the invitation, a new level and the revocation — once each, never the owner', async () => {
    const bio = await biosensio()
    const shares = `/v1/dossiers/${bio.id}/shares`
    const link = (
      await as(SOPHIE)
        .post(shares, { recipientEmail: EVE.email, accessLevel: 'public' })
        .expect(201)
    ).body
    const invited = await inbox(EVE)
    expect(invited).toEqual([
      expect.objectContaining({
        kind: 'share_invited',
        title: 'Une demande vous est partagée : « Biosensio »',
        href: `/opportunites/${bio.id}`,
        readAt: null,
      }),
    ])
    // In the site only: the invitation's own email carries the link.
    expect(mailed).toEqual([])

    await as(SOPHIE).patch(`${shares}/${link.id}`, { accessLevel: 'partiel' }).expect(200)
    // The same level again changes nothing, tells nothing.
    await as(SOPHIE).patch(`${shares}/${link.id}`, { accessLevel: 'partiel' }).expect(200)
    await as(SOPHIE).patch(`${shares}/${link.id}`, { accessLevel: 'public' }).expect(200)
    expect((await inbox(EVE, 'share_level_changed')).map((i) => i.body)).toEqual([
      'Niveau d’accès : Public.',
      'Niveau d’accès : Partiel.',
    ])
    await as(SOPHIE).delete(`${shares}/${link.id}`).expect(200)
    await as(SOPHIE).delete(`${shares}/${link.id}`).expect(200)
    expect(await inbox(EVE, 'share_revoked')).toEqual([
      expect.objectContaining({
        title: 'Votre accès à « Biosensio » a été retiré',
        href: null,
      }),
    ])
    expect(mailed.map((m) => [m.to, m.title])).toEqual([
      [EVE.email, 'Votre accès à « Biosensio » a changé'],
      [EVE.email, 'Votre accès à « Biosensio » a changé'],
      [EVE.email, 'Votre accès à « Biosensio » a été retiré'],
    ])
    expect(mailed[0].actionUrl).toMatch(new RegExp(`/opportunites/${bio.id}$`))
    expect(rows('share_revoked').map((n) => n.emailState)).toEqual(['sent'])
    // Nobody else is told anything about it.
    expect((await inbox(SOPHIE)).map((i) => i.kind)).not.toContain('share_invited')
    for (const other of [CLAIRE, BOB, MARIE]) {
      expect((await inbox(other)).filter((i) => i.kind.startsWith('share_'))).toEqual([])
    }
  })

  it('tells the owner of a new or changed pledge once per revision, never who nor how much; hiding more or a double click tells nothing', async () => {
    const bio = await biosensio()
    const url = `/v1/opportunities/${bio.id}/pledge`
    const base = { intention: 'likely', amountEur: 25_000, showName: true, showAmount: true }
    const first = (
      await as(CLAIRE)
        .put(url, { ...base, version: null })
        .expect(200)
    ).body
    // A double click: the same pledge from the version it now has.
    await as(CLAIRE)
      .put(url, { ...base, version: first.version })
      .expect(200)
    const changed = (
      await as(CLAIRE)
        .put(url, { ...base, amountEur: 30_000, version: first.version })
        .expect(200)
    ).body
    // Only hiding the name: nothing to tell.
    await as(CLAIRE)
      .put(url, { ...base, amountEur: 30_000, showName: false, version: changed.version })
      .expect(200)
    const told = await inbox(SOPHIE, 'pledge_received')
    expect(told.map((i) => i.title)).toEqual([
      'Promesse modifiée pour « Biosensio »',
      'Nouvelle promesse pour « Biosensio »',
    ])
    expect(told[0].href).toBe(`/dashboard/dossiers/view/${bio.slug}`)
    expectNoTrace(told, [...INVESTOR_TRACES, '30000', '30 000', 'likely'])
    expectNoTrace(
      mailed.filter((m) => m.to === SOPHIE.email),
      [...INVESTOR_TRACES.filter((t) => t !== '@'), '30000', 'likely'],
    )
    expect(mailed.filter((m) => m.to === SOPHIE.email)).toHaveLength(2)
    // The payload kept only the kind's fields.
    for (const row of rows('pledge_received')) {
      expect(Object.keys(row.payload as object).sort()).toEqual([
        'change',
        'dossierId',
        'dossierName',
        'dossierSlug',
      ])
    }
    // The investor and the others are told nothing of it.
    for (const other of [CLAIRE, BOB, MARIE, JEAN, EVE]) {
      expect(await inbox(other, 'pledge_received')).toEqual([])
    }
  })

  it('tells the owner of an investor’s first mark of interest once, in the site only, whatever they toggle', async () => {
    const bio = await biosensio()
    const url = `/v1/opportunities/${bio.id}/interest`
    await as(CLAIRE).put(url, { nameVisible: true }).expect(200)
    await as(CLAIRE).put(url, { nameVisible: false }).expect(200)
    await as(CLAIRE).delete(url).expect(204)
    await as(CLAIRE).put(url, { nameVisible: true }).expect(200)
    await as(BOB).put(url, { nameVisible: false }).expect(200)
    const told = await inbox(SOPHIE, 'interest_received')
    expect(told).toHaveLength(2)
    expect(told[0].title).toBe('Nouvelle marque d’intérêt pour « Biosensio »')
    expectNoTrace(told, [...INVESTOR_TRACES, 'Bob', 'Durand'])
    expect(rows('interest_received').every((n) => n.emailState === 'none')).toBe(true)
    expect(mailed).toEqual([])
  })

  it('tells the owner of the structure’s changes to their candidature and its committee entry, never of their own', async () => {
    const bio = await biosensio()
    const mine = `/v1/candidatures/${bio.candidatureId}`
    // The owner's own change of status: nothing.
    await as(SOPHIE)
      .post(`${mine}/financing-status`, { from: 'preparing', to: 'abandoned' })
      .expect(200)
    await as(SOPHIE)
      .post(`${mine}/financing-status`, { from: 'abandoned', to: 'preparing' })
      .expect(200)
    expect(await inbox(SOPHIE, 'candidature_status_changed')).toEqual([])
    // The structure's: told, with the workspace, never the conseiller.
    await as(JEAN)
      .post(`/v1/workspaces/${cci}/candidatures/${bio.candidatureId}/financing-status`, {
        from: 'preparing',
        to: 'in_committee',
      })
      .expect(200)
    expect(await inbox(SOPHIE, 'candidature_status_changed')).toEqual([
      expect.objectContaining({
        title: '« Biosensio » : en comité',
        body: 'Statut de financement changé par « CCI Touraine ».',
        href: `/dashboard/candidatures/${bio.candidatureId}`,
      }),
    ])
    expectNoTrace(await inbox(SOPHIE), ['Jean', JEAN.email, JEAN.id])

    const june = (
      await as(MARIE)
        .post(`/v1/admin/workspaces/${cci}/committees`, {
          name: 'Comité de juin',
          date: '2099-06-10',
          time: '14:00',
          timeZone: 'Europe/Paris',
          location: 'LIEU-PRIVE',
          internalNotes: 'NOTE-INTERNE',
        })
        .expect(201)
    ).body
    await as(SOPHIE)
      .post(`${mine}/committees/${june.id}/application`, { to: 'applied', version: null })
      .expect(200)
    expect(await inbox(SOPHIE, 'committee_application_changed')).toEqual([])
    await as(JEAN)
      .post(`/v1/workspaces/${cci}/committees/${june.id}/applications`, {
        candidatureId: bio.candidatureId,
        to: 'accepted',
        version: 1,
      })
      .expect(200)
    const entry = await inbox(SOPHIE, 'committee_application_changed')
    expect(entry).toEqual([
      expect.objectContaining({
        title: '« Biosensio » est retenue pour le comité « Comité de juin »',
        body: 'CCI Touraine — Retenue.',
      }),
    ])
    expectNoTrace(entry, ['PRIVE', 'NOTE-INTERNE', 'Jean'])
    expect(mailed.filter((m) => m.to === SOPHIE.email).map((m) => m.title)).toEqual([
      '« Biosensio » : en comité',
      '« Biosensio » est retenue pour le comité « Comité de juin »',
    ])
    // The structure's members are told nothing of it.
    for (const other of [MARIE, JEAN, CLAIRE]) {
      expect((await inbox(other)).filter((i) => i.kind !== 'workspace_invited')).toEqual([])
    }
  })

  it('tells nobody of their own change made as the structure (an administrator owning the request)', async () => {
    const dossier = (await as(ADMIN).post('/v1/dossiers', { name: 'Propre' }).expect(201)).body
    fake.table('dossier').get(dossier.id)!.submittedAt = new Date()
    const candidature = (
      await as(ADMIN)
        .post(`/v1/dossiers/${dossier.id}/candidatures`, { workspaceId: cci })
        .expect(201)
    ).body
    await as(ADMIN).post(`/v1/candidatures/${candidature.id}/submit`).expect(200)
    await as(ADMIN)
      .post(`/v1/workspaces/${cci}/candidatures/${candidature.id}/financing-status`, {
        from: 'preparing',
        to: 'in_committee',
      })
      .expect(200)
    expect(rows('candidature_status_changed')).toEqual([])
  })

  it('tells each person added to a workspace, in the site only', async () => {
    const told = await inbox(CLAIRE, 'workspace_invited')
    expect(told).toEqual([
      expect.objectContaining({
        title: 'Vous êtes membre de « CCI Touraine »',
        body: 'Votre rôle : investisseur.',
        href: `/workspaces/${cci}`,
      }),
    ])
    expect(await inbox(EVE)).toEqual([])
    expect(mailed).toEqual([])
  })

  it('records a failed email without undoing the event, and still lists it in the site', async () => {
    const bio = await biosensio()
    failMail = true
    await as(CLAIRE)
      .put(`/v1/opportunities/${bio.id}/pledge`, {
        intention: 'likely',
        amountEur: 25_000,
        showName: false,
        showAmount: false,
        version: null,
      })
      .expect(200)
    expect(rows('pledge_received').map((n) => n.emailState)).toEqual(['failed'])
    expect(await inbox(SOPHIE, 'pledge_received')).toHaveLength(1)
  })

  describe('reading them', () => {
    // Twenty-three notifications for Sophie, one a second apart, the latest last; one for Eve; one
    // of a kind this version does not know.
    async function filled() {
      const base = Date.parse('2099-01-01T00:00:00.000Z')
      for (let i = 0; i < 23; i++) {
        await fake.prisma.notification.create({
          data: {
            id: id(10 + i),
            recipientId: SOPHIE.id,
            kind: 'interest_received',
            dedupKey: `k${i}`,
            subjectKey: 's',
            payload: { dossierId: id(99), dossierName: `Demande ${i}`, dossierSlug: `d-${i}` },
            emailState: 'none',
            emailStateAt: new Date(base + i * 1000),
            createdAt: new Date(base + i * 1000),
          },
        })
      }
      await fake.prisma.notification.create({
        data: {
          id: id(60),
          recipientId: EVE.id,
          kind: 'share_revoked',
          dedupKey: 'eve',
          subjectKey: 'eve',
          payload: { dossierName: 'EVE-SECRET' },
          emailState: 'none',
          emailStateAt: new Date(base),
          createdAt: new Date(base),
        },
      })
      await fake.prisma.notification.create({
        data: {
          id: id(61),
          recipientId: SOPHIE.id,
          kind: 'from_the_future',
          dedupKey: 'future',
          subjectKey: 'future',
          payload: {},
          emailState: 'none',
          emailStateAt: new Date(base + 99_000),
          createdAt: new Date(base + 99_000),
        },
      })
    }

    it('lists only one’s own, the latest first, a page at a time, with the unread count', async () => {
      await filled()
      const first = (await as(SOPHIE).get('/v1/notifications').expect(200)).body
      valid(notificationPageSchema, first)
      expect(first.items).toHaveLength(20)
      expect(first.items[0].title).toBe('Nouvelle marque d’intérêt pour « Demande 22 »')
      expect(first.unreadCount).toBe(23)
      const second = (
        await as(SOPHIE).get(`/v1/notifications?cursor=${first.nextCursor}`).expect(200)
      ).body
      expect(second.items.map((i: Item) => i.title)).toEqual([
        'Nouvelle marque d’intérêt pour « Demande 2 »',
        'Nouvelle marque d’intérêt pour « Demande 1 »',
        'Nouvelle marque d’intérêt pour « Demande 0 »',
      ])
      expect(second.nextCursor).toBeNull()
      expectNoTrace(first, ['EVE-SECRET', 'future'])
      const eve = (await as(EVE).get('/v1/notifications').expect(200)).body
      expect(eve.items.map((i: Item) => i.id)).toEqual([id(60)])
      for (const item of eve.items) valid(notificationSchema, item)
      const count = (await as(SOPHIE).get('/v1/notifications/unread-count').expect(200)).body
      valid(notificationUnreadSchema, count)
      expect(count).toEqual({ unreadCount: 23 })
      // A cursor or a size this version does not write: refused.
      await as(SOPHIE).get('/v1/notifications?cursor=bm9wZQ').expect(400)
      await as(SOPHIE).get('/v1/notifications?cursor=..%2F').expect(400)
      await as(SOPHIE).get('/v1/notifications?limit=51').expect(400)
      await request(app.getHttpServer()).get('/v1/notifications').expect(401)
    })

    it('marks one read — someone else’s answered like an unknown one —, then all of those read so far', async () => {
      await filled()
      const read = (
        await as(SOPHIE)
          .post(`/v1/notifications/${id(22)}/read`)
          .expect(200)
      ).body
      valid(notificationSchema, read)
      expect(read.readAt).not.toBeNull()
      // Again: its first reading stays.
      const again = (
        await as(SOPHIE)
          .post(`/v1/notifications/${id(22)}/read`)
          .expect(200)
      ).body
      expect(again.readAt).toBe(read.readAt)
      const foreign = await as(SOPHIE)
        .post(`/v1/notifications/${id(60)}/read`)
        .expect(404)
      const unknown = await as(SOPHIE)
        .post(`/v1/notifications/${id(98)}/read`)
        .expect(404)
      expect(foreign.body).toEqual(unknown.body)
      expect(fake.table('notification').get(id(60))!.readAt).toBeNull()
      await as(SOPHIE).post('/v1/notifications/not-a-uuid/read').expect(400)

      // Up to the tenth (included): the later ones stay unread.
      const all = (
        await as(SOPHIE)
          .post('/v1/notifications/read-all', { until: '2099-01-01T00:00:09.000Z' })
          .expect(200)
      ).body
      valid(markAllNotificationsReadResultSchema, all)
      expect(all).toEqual({ updated: 10, unreadCount: 12 })
      await as(SOPHIE).post('/v1/notifications/read-all', { until: 'hier' }).expect(400)
      await as(SOPHIE).post('/v1/notifications/read-all', {}).expect(400)
      expect(fake.table('notification').get(id(60))!.readAt).toBeNull()
      expect((await as(EVE).get('/v1/notifications/unread-count').expect(200)).body).toEqual({
        unreadCount: 1,
      })
    })
  })
})
