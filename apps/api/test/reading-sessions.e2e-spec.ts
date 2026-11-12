import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { ZodValidationPipe } from 'nestjs-zod'
import request from 'supertest'
import type { App } from 'supertest/types'
import {
  dossierAnalyticsSchema,
  financeurShareResponseSchema,
  opportunitySchema,
  readingHeartbeatResultSchema,
} from '@confluent/shared'
import { AppModule } from './../src/app.module'
import { GlobalExceptionFilter } from './../src/common/filters/global-exception.filter'
import { PrismaService } from './../src/prisma/prisma.service'
import { EMAIL_TRANSPORT } from './../src/modules/auth/email/email-transport'
import { createFakePrisma } from '../src/testing/fake-prisma'

const id = (n: number) => `7d3c1b0e-0000-4000-8000-0000000078${n.toString().padStart(2, '0')}`
// Sophie owns Biosensio. Claire: investisseur of the CCI, also sent a direct share; Ivy: investisseur
// of the CCI only; Bob: recipient of a direct share; Eve: anyone else.
const SOPHIE = { id: id(1), email: 'sophie@biosensio.fr', role: 'entrepreneur' }
const CLAIRE = { id: id(2), email: 'claire@angels.fr', role: 'financeur' }
const IVY = { id: id(3), email: 'ivy@angels.fr', role: 'financeur' }
const BOB = { id: id(4), email: 'bob@banque.fr', role: 'financeur' }
const EVE = { id: id(5), email: 'eve@fonds.fr', role: 'financeur' }
const ADMIN = { id: id(9), email: 'admin@confluent.dev', role: 'admin' }
const PEOPLE = [SOPHIE, CLAIRE, IVY, BOB, EVE, ADMIN]
const VERSION = id(90)
const CONFLUENT_FORM = id(91)
const SECTION = id(92)
const NAME_FIELD = id(93)

const MINUTE = 60_000

const valid = <T>(schema: { safeParse: (v: unknown) => { error?: { issues: T[] } } }, v: unknown) =>
  expect(schema.safeParse(v).error?.issues ?? []).toEqual([])

type Row = Record<string, unknown> & {
  id: string
  startedAt: Date
  lastSeenAt: Date
  activeMs: number | null
}

// ROADMAP E07.08 over HTTP on the stateful fake Prisma: what counts as a view (a reading session,
// resumed by reloads, redirections, double loads and a second page within 30 minutes of its last
// activity), what a heartbeat credits (never more than the time elapsed, only to the session's reader
// while they still read it through its share) and what the owner reads (the direct shares' sessions
// only — never a pool's reader, not even a count). Concurrency: test/pg/reading-sessions.pg-spec.ts.
describe('Reading sessions (e2e)', () => {
  let app: INestApplication<App>
  let fake: ReturnType<typeof createFakePrisma>
  const tokens: Record<string, string> = {}
  let cci: string

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
    await p.questionnaireSection.create({
      data: { id: SECTION, versionId: VERSION, key: 'identite', title: 'Identité', orderIndex: 0 },
    })
    await p.questionnaireField.create({
      data: {
        id: NAME_FIELD,
        key: 'nom',
        label: 'Nom',
        minAccessLevel: 'public',
        fieldType: 'text',
        orderIndex: 0,
        sectionId: SECTION,
        versionId: VERSION,
      },
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
    for (const u of [CLAIRE, IVY]) {
      await admin
        .post(`/v1/admin/workspaces/${cci}/members`, { email: u.email, role: 'investisseur' })
        .expect(201)
    }
    const form = await p.questionnaire.create({
      data: { slug: `form-${cci}`, name: 'Formulaire', workspaceId: cci, usage: 'candidature' },
    })
    await p.questionnaireVersion.create({
      data: { questionnaireId: form.id, version: 1, status: 'published' },
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
    delete: (url: string) => request(app.getHttpServer()).delete(url).set('Authorization', auth(u)),
  })
  const sophie = as(SOPHIE)

  const sessions = () => [...fake.table('readingSession').values()] as Row[]
  const journal = (action: string) =>
    [...fake.table('auditLog').values()].filter((e) => e.actionType === action)
  // The session's whole life `ms` earlier: what a wait of `ms` does to it.
  const age = (sessionId: string, ms: number) => {
    const row = fake.table('readingSession').get(sessionId) as Row
    row.startedAt = new Date(row.startedAt.getTime() - ms)
    row.lastSeenAt = new Date(row.lastSeenAt.getTime() - ms)
  }
  const activeMs = (sessionId: string) =>
    (fake.table('readingSession').get(sessionId) as Row).activeMs

  // Biosensio, published, sent to the CCI and listed in its pool, shared with Bob and Claire.
  async function biosensio() {
    const dossier = (await sophie.post('/v1/dossiers', { name: 'Biosensio' }).expect(201)).body
    const row = fake.table('dossier').get(dossier.id)!
    Object.assign(row, {
      submittedAt: new Date(),
      summary: 'Capteurs pour l’énergie.',
      objective: 'Industrialiser',
      amountEur: 300_000,
      financingTypes: ['equity'],
    })
    await fake.prisma.dossierAnswer.create({
      data: { companyId: row.companyId, fieldId: NAME_FIELD, value: 'NOM-Biosensio' },
    })
    await sophie.post(`/v1/dossiers/${dossier.id}/publish`).expect(200)
    const candidature = (
      await sophie.post(`/v1/dossiers/${dossier.id}/candidatures`, { workspaceId: cci }).expect(201)
    ).body
    await sophie.post(`/v1/candidatures/${candidature.id}/submit`).expect(200)
    await sophie
      .put(`/v1/candidatures/${candidature.id}/pool-publication`, {
        accessLevel: 'public',
        consent: true,
      })
      .expect(200)
    const share = async (email: string) =>
      (
        await sophie
          .post(`/v1/dossiers/${dossier.id}/shares`, {
            recipientEmail: email,
            accessLevel: 'public',
          })
          .expect(201)
      ).body as { id: string; token: string }
    return {
      id: dossier.id as string,
      toBob: await share(BOB.email),
      toClaire: await share(CLAIRE.email),
    }
  }

  const readShare = async (u: { id: string }, token: string) => {
    const body = (await as(u).get(`/v1/shares/${token}`).expect(200)).body
    valid(financeurShareResponseSchema, body)
    return body.share.reading as { id: string } | null
  }
  const readOpportunity = async (u: { id: string }, dossierId: string) => {
    const body = (await as(u).get(`/v1/opportunities/${dossierId}`).expect(200)).body
    valid(opportunitySchema, body)
    return body.opportunity.reading as { id: string } | null
  }
  const beat = (u: { id: string }, sessionId: string, body: object) =>
    as(u).post(`/v1/reading-sessions/${sessionId}/heartbeat`, body)
  type Recipient = { shareLinkId: string; viewCount: number }
  const analytics = async (dossierId: string) => {
    const body = (await sophie.get(`/v1/dossiers/${dossierId}/analytics`).expect(200)).body
    valid(dossierAnalyticsSchema, body)
    return body as Record<string, unknown> & { perRecipient: Recipient[] }
  }
  const of = (read: { perRecipient: Recipient[] }, shareLinkId: string) =>
    read.perRecipient.find((r) => r.shareLinkId === shareLinkId)

  it('counts a reload, a redirection, a double load and the other page within 30 minutes as one view, journaled once', async () => {
    const bio = await biosensio()
    // The link opened, reloaded, opened again, then the same request as an opportunity: one session.
    const first = await readShare(BOB, bio.toBob.token)
    expect(first).toEqual({ id: expect.any(String) })
    expect(await readShare(BOB, bio.toBob.token)).toEqual(first)
    // React's double effect, a second tab (simultaneous loads: test/pg/reading-sessions.pg-spec.ts).
    expect(await readShare(BOB, bio.toBob.token)).toEqual(first)
    expect(await readOpportunity(BOB, bio.id)).toEqual(first)
    expect(sessions()).toHaveLength(1)
    expect(sessions()[0]).toMatchObject({
      dossierId: bio.id,
      readerId: BOB.id,
      shareLinkId: bio.toBob.id,
      channel: 'share',
      activeMs: 0,
    })
    expect(journal('share_link_viewed')).toEqual([
      expect.objectContaining({
        actorId: BOB.id,
        shareLinkId: bio.toBob.id,
        metadata: expect.objectContaining({
          recipientEmail: BOB.email,
          readingSessionId: first!.id,
        }),
      }),
    ])
    expect(journal('opportunity_viewed')).toEqual([])
    expect((await analytics(bio.id)).totalViews).toBe(1)

    // 29 minutes after its last activity: still the same view; 31: a new one.
    age(first!.id, 29 * MINUTE)
    expect(await readShare(BOB, bio.toBob.token)).toEqual(first)
    age(first!.id, 2 * MINUTE)
    const second = await readOpportunity(BOB, bio.id)
    expect(second).not.toEqual(first)
    expect(sessions()).toHaveLength(2)
    expect(journal('opportunity_viewed')).toEqual([
      expect.objectContaining({
        actorId: BOB.id,
        shareLinkId: bio.toBob.id,
        metadata: expect.objectContaining({ readingSessionId: second!.id }),
      }),
    ])
    const read = await analytics(bio.id)
    expect(read.totalViews).toBe(2)
    expect(of(read, bio.toBob.id)).toMatchObject({
      viewCount: 2,
      measuredSessions: 2,
      activeSeconds: 0,
    })
  })

  it('keeps each reader’s views apart, and a new share’s apart from a revoked one’s', async () => {
    const bio = await biosensio()
    const bob = await readShare(BOB, bio.toBob.token)
    const claire = await readShare(CLAIRE, bio.toClaire.token)
    expect(claire).not.toEqual(bob)
    await sophie.delete(`/v1/dossiers/${bio.id}/shares/${bio.toBob.id}`).expect(200)
    const again = (
      await sophie
        .post(`/v1/dossiers/${bio.id}/shares`, { recipientEmail: BOB.email, accessLevel: 'public' })
        .expect(201)
    ).body
    const renewed = await readShare(BOB, again.token)
    expect(renewed).not.toEqual(bob)
    expect(
      sessions()
        .map((s) => s.shareLinkId)
        .sort(),
    ).toEqual([bio.toBob.id, bio.toClaire.id, again.id].sort())
  })

  it('credits a heartbeat at most the time elapsed since the session’s last activity', async () => {
    const bio = await biosensio()
    const { id: session } = (await readShare(BOB, bio.toBob.token))!
    // 20 s after the load: 15 s claimed, 15 s credited.
    age(session, 20_000)
    const res = await beat(BOB, session, { activeMs: 15_000 }).expect(200)
    valid(readingHeartbeatResultSchema, res.body)
    expect(res.body).toEqual({ open: true })
    expect(activeMs(session)).toBe(15_000)
    // At once again — a second tab, a retried request: nothing more than the time elapsed.
    await beat(BOB, session, { activeMs: 15_000 }).expect(200)
    expect(activeMs(session)!).toBeLessThan(15_100)
    // 10 s later, 30 s claimed: 10 s credited.
    age(session, 10_000)
    const before = activeMs(session)!
    await beat(BOB, session, { activeMs: 30_000 }).expect(200)
    expect(activeMs(session)! - before).toBeGreaterThanOrEqual(10_000)
    expect(activeMs(session)! - before).toBeLessThan(10_100)
    // Nothing claimed: nothing credited, the last activity unchanged.
    const lastSeen = (fake.table('readingSession').get(session) as Row).lastSeenAt
    age(session, 5_000)
    await beat(BOB, session, { activeMs: 0 }).expect(200)
    expect((fake.table('readingSession').get(session) as Row).lastSeenAt.getTime()).toBe(
      lastSeen.getTime() - 5_000,
    )
    // At most 3 hours per session.
    const row = fake.table('readingSession').get(session) as Row
    row.activeMs = 3 * 3_600_000 - 1_000
    age(session, 20_000)
    await beat(BOB, session, { activeMs: 15_000 }).expect(200)
    expect(activeMs(session)).toBe(3 * 3_600_000)

    const read = await analytics(bio.id)
    expect(read).toMatchObject({ totalViews: 1, totalActiveSeconds: 10_800 })
    expect(of(read, bio.toBob.id)).toMatchObject({
      shareLinkId: bio.toBob.id,
      viewCount: 1,
      activeSeconds: 10_800,
      sessions: [{ activeSeconds: 10_800, channel: 'share' }],
    })
  })

  it('refuses a malformed heartbeat, and answers the same 404 to anyone but the session’s reader', async () => {
    const bio = await biosensio()
    const { id: session } = (await readShare(BOB, bio.toBob.token))!
    for (const body of [
      {},
      { activeMs: -1 },
      { activeMs: 30_001 },
      { activeMs: 1.5 },
      { activeMs: '1000' },
      { activeMs: 1000, total: 99_000 },
    ]) {
      await beat(BOB, session, body).expect(400)
    }
    await beat(BOB, 'not-a-session', { activeMs: 1000 }).expect(400)
    age(session, 20_000)
    for (const u of [EVE, CLAIRE, SOPHIE, ADMIN]) {
      const res = await beat(u, session, { activeMs: 15_000 }).expect(404)
      expect(res.body.error.message).toBe('Consultation introuvable.')
    }
    const unknown = await beat(BOB, id(77), { activeMs: 15_000 }).expect(404)
    expect(unknown.body.error.message).toBe('Consultation introuvable.')
    await request(app.getHttpServer())
      .post(`/v1/reading-sessions/${session}/heartbeat`)
      .send({ activeMs: 1000 })
      .expect(401)
    expect(activeMs(session)).toBe(0)
  })

  it('closes a session after 30 minutes without activity, or once its share is revoked', async () => {
    const bio = await biosensio()
    const { id: session } = (await readShare(BOB, bio.toBob.token))!
    age(session, 31 * MINUTE)
    expect((await beat(BOB, session, { activeMs: 15_000 }).expect(200)).body).toEqual({
      open: false,
    })
    expect(activeMs(session)).toBe(0)

    const { id: claire } = (await readShare(CLAIRE, bio.toClaire.token))!
    await sophie.delete(`/v1/dossiers/${bio.id}/shares/${bio.toClaire.id}`).expect(200)
    age(claire, 20_000)
    expect((await beat(CLAIRE, claire, { activeMs: 15_000 }).expect(200)).body).toEqual({
      open: false,
    })
    expect(activeMs(claire)).toBe(0)
  })

  it('never times a session taken before E07.08, and resumes it as such', async () => {
    const bio = await biosensio()
    // Grouped from the journal by the migration: a view of Bob's share, without a duration.
    const ago = new Date(Date.now() - 5 * MINUTE)
    const legacy = (await fake.prisma.readingSession.create({
      data: {
        dossierId: bio.id,
        readerId: BOB.id,
        shareLinkId: bio.toBob.id,
        channel: 'share',
        startedAt: ago,
        lastSeenAt: ago,
        activeMs: null,
      },
    })) as Row
    expect(await readShare(BOB, bio.toBob.token)).toBeNull()
    expect(sessions()).toHaveLength(1)
    expect((await beat(BOB, legacy.id, { activeMs: 15_000 }).expect(200)).body).toEqual({
      open: false,
    })
    expect(activeMs(legacy.id)).toBeNull()
    expect(await analytics(bio.id)).toMatchObject({ totalViews: 1, totalActiveSeconds: null })
  })

  it('never times nor shows the owner a reading through pools alone, not even a count', async () => {
    const bio = await biosensio()
    // Ivy reads Biosensio through the CCI's pool only: a session, journaled, without a duration.
    expect(await readOpportunity(IVY, bio.id)).toBeNull()
    expect(await readOpportunity(IVY, bio.id)).toBeNull()
    expect(sessions()).toEqual([
      expect.objectContaining({ readerId: IVY.id, shareLinkId: null, activeMs: null }),
    ])
    expect(journal('opportunity_viewed')).toEqual([
      expect.objectContaining({ actorId: IVY.id, shareLinkId: null }),
    ])
    const pooled = sessions()[0].id
    age(pooled, 20_000)
    expect((await beat(IVY, pooled, { activeMs: 15_000 }).expect(200)).body).toEqual({
      open: false,
    })
    expect(activeMs(pooled)).toBeNull()
    // Claire reads it through the pool and her direct share: measured, as her share's view.
    const claire = await readOpportunity(CLAIRE, bio.id)
    expect(claire).toEqual({ id: expect.any(String) })

    const read = await analytics(bio.id)
    expect(read.totalViews).toBe(1)
    expect(read.perRecipient).toHaveLength(2)
    expect(of(read, bio.toClaire.id)?.viewCount).toBe(1)
    expect(of(read, bio.toBob.id)?.viewCount).toBe(0)
    expect(JSON.stringify(read)).not.toContain(IVY.id)
    expect(JSON.stringify(read)).not.toContain(IVY.email)
    // Nor in the owner's history (E07.03, E07.09): Claire's consultation only; the administrators'
    // raw journal keeps Ivy's reading.
    const owner = (await sophie.get(`/v1/dossiers/${bio.id}/history`).expect(200)).body
    expect(JSON.stringify(owner)).not.toContain(IVY.id)
    expect(JSON.stringify(owner)).not.toContain(IVY.email)
    expect(
      owner.items
        .filter((e: { kind: string }) => e.kind === 'consultation')
        .map((e: { recipientEmail: string }) => e.recipientEmail),
    ).toEqual([CLAIRE.email])
    const admin = (await as(ADMIN).get(`/v1/admin/dossiers/${bio.id}/audit-log`).expect(200)).body
    expect(admin.map((e: { actorId: string }) => e.actorId)).toContain(IVY.id)
  })

  it('opens the measures to the owner only', async () => {
    const bio = await biosensio()
    await readShare(BOB, bio.toBob.token)
    await readOpportunity(IVY, bio.id)
    for (const u of [BOB, CLAIRE, IVY, EVE]) {
      await as(u).get(`/v1/dossiers/${bio.id}/analytics`).expect(404)
    }
    await as(ADMIN).get(`/v1/dossiers/${bio.id}/analytics`).expect(404)
  })

  it('limits heartbeats to 60 a minute', async () => {
    const bio = await biosensio()
    const { id: session } = (await readShare(BOB, bio.toBob.token))!
    for (let i = 0; i < 60; i++) await beat(BOB, session, { activeMs: 0 }).expect(200)
    await beat(BOB, session, { activeMs: 0 }).expect(429)
  })
})
