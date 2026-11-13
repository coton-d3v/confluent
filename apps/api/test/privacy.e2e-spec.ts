import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { ZodValidationPipe } from 'nestjs-zod'
import request from 'supertest'
import type { App } from 'supertest/types'
import {
  EXPORT_LIMITS,
  adminDeletionRequestSchema,
  myDeletionRequestSchema,
  myDeletionRequestStateSchema,
  personalDataExportSchema,
} from '@confluent/shared'
import { AppModule } from './../src/app.module'
import { GlobalExceptionFilter } from './../src/common/filters/global-exception.filter'
import { PrismaService } from './../src/prisma/prisma.service'
import {
  EMAIL_TRANSPORT,
  type SendAccountDeletedInput,
  type SendNotificationInput,
} from './../src/modules/auth/email/email-transport'
import { ConfluentOAuthProvider } from './../src/modules/oauth/oauth.provider'
import { hashToken } from './../src/modules/oauth/oauth.constants'
import { createFakePrisma } from '../src/testing/fake-prisma'

const id = (n: number) => `7d3c1b0e-0000-4000-8000-0000001010${n.toString().padStart(2, '0')}`
// Sophie owns Biosensio and shares it with Claire (financeur). Eve has nothing to do with it. Two
// administrators.
const SOPHIE = { id: id(1), email: 'sophie@biosensio.fr', role: 'entrepreneur' }
const CLAIRE = { id: id(2), email: 'claire@angels.fr', role: 'financeur' }
const EVE = { id: id(3), email: 'eve@fonds.fr', role: 'entrepreneur' }
const ADMIN = { id: id(8), email: 'admin@confluent.dev', role: 'admin' }
const OTHER_ADMIN = { id: id(9), email: 'admin2@confluent.dev', role: 'admin' }
const PEOPLE = [SOPHIE, CLAIRE, EVE, ADMIN, OTHER_ADMIN]
const VERSION = id(90)
const FORM = id(91)
const FIELD = id(92)
const COMPANY = id(93)
const DOSSIER = id(94)
const SHARE = id(95)
// What only Sophie may read: never in anyone else's export.
const SOPHIE_SECRET = 'QX-SOPHIE-ANSWER-4242'

const valid = <T>(schema: { safeParse: (v: unknown) => { error?: { issues: T[] } } }, v: unknown) =>
  expect(schema.safeParse(v).error?.issues ?? []).toEqual([])

// ROADMAP E10.10 over HTTP on the stateful fake Prisma: each person exports their own data only
// (owner, share recipient, administrator, stranger), within the hourly limit, journaled; a deletion
// request is made once, withdrawn, declined with a note the person reads (notified) or processed by
// another administrator — never while a share is open, never one's own —, after which the account's
// sessions and AI tokens are refused. Cascades, pseudonymization, locks and the purge:
// test/pg/privacy.pg-spec.ts.
describe('Personal data (e2e)', () => {
  let app: INestApplication<App>
  let fake: ReturnType<typeof createFakePrisma>
  let mailed: SendNotificationInput[]
  let farewells: SendAccountDeletedInput[]
  const tokens: Record<string, string> = {}

  beforeEach(async () => {
    fake = createFakePrisma()
    mailed = []
    farewells = []
    const p = fake.prisma
    for (const u of PEOPLE) {
      await p.user.create({
        data: {
          ...u,
          emailVerifiedAt: new Date(),
          firstName: u.email.split('@')[0],
          lastName: 'T',
        },
      })
    }
    await p.questionnaire.create({
      data: { id: FORM, slug: 'dossier', name: 'Profil', usage: 'dossier' },
    })
    await p.questionnaireVersion.create({
      data: { id: VERSION, questionnaireId: FORM, version: 1, status: 'published' },
    })
    await p.questionnaireField.create({
      data: { id: FIELD, versionId: VERSION, key: 'pitch', label: 'Votre pitch', type: 'text' },
    })
    await p.company.create({
      data: { id: COMPANY, ownerId: SOPHIE.id, name: 'Biosensio SAS', profileVersionId: VERSION },
    })
    await p.dossier.create({
      data: {
        id: DOSSIER,
        userId: SOPHIE.id,
        companyId: COMPANY,
        name: 'Biosensio',
        slug: 'biosensio',
        questionnaireVersionId: VERSION,
        publicationStatus: 'published',
        financingTypes: [],
      },
    })
    await p.dossierAnswer.create({
      data: { companyId: COMPANY, fieldId: FIELD, value: SOPHIE_SECRET },
    })
    await p.shareLink.create({
      data: {
        id: SHARE,
        dossierId: DOSSIER,
        recipientEmail: CLAIRE.email,
        token: 'share-token',
        status: 'active',
        accessLevel: 'complet',
      },
    })
    // An administrator's own entry about Sophie's request: its details stay out of their export.
    await p.auditLog.create({
      data: {
        actionType: 'admin_edited_field',
        actorId: ADMIN.id,
        dossierId: DOSSIER,
        metadata: { ownerEmail: SOPHIE.email, value: SOPHIE_SECRET, ip: '203.0.113.5' },
      },
    })

    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(p)
      .overrideProvider(EMAIL_TRANSPORT)
      .useValue({
        sendMagicLink: jest.fn(),
        sendShareInvite: jest.fn().mockResolvedValue(undefined),
        sendNotification: jest.fn((input: SendNotificationInput) => {
          mailed.push(input)
          return Promise.resolve()
        }),
        sendAccountDeleted: jest.fn((input: SendAccountDeletedInput) => {
          farewells.push(input)
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
  })

  afterEach(async () => {
    await app.close()
  })

  const http = () => request(app.getHttpServer())
  const as = (u: { id: string }) => {
    const auth = `Bearer ${tokens[u.id]}`
    return {
      get: (url: string) => http().get(url).set('Authorization', auth),
      post: (url: string, body?: object) => http().post(url).set('Authorization', auth).send(body),
      delete: (url: string) => http().delete(url).set('Authorization', auth),
    }
  }
  const exportOf = async (u: { id: string }) => {
    const res = await as(u).get('/v1/me/export').expect(200)
    expect(res.headers['content-disposition']).toMatch(
      /^attachment; filename="confluent-mes-donnees-\d{4}-\d{2}-\d{2}\.json"$/,
    )
    expect(res.headers['cache-control']).toBe('no-store')
    const body = JSON.parse(res.text) as unknown
    valid(personalDataExportSchema, body)
    return { body: body as Record<string, unknown>, text: res.text }
  }

  describe('export', () => {
    it('is refused without a session', async () => {
      await http().get('/v1/me/export').expect(401)
    })

    it('gives the owner their account, companies, requests, answers and the shares they gave', async () => {
      const { body } = await exportOf(SOPHIE)
      expect(body.account).toMatchObject({ id: SOPHIE.id, email: SOPHIE.email })
      const [company] = body.companies as Array<Record<string, unknown>>
      expect(company).toMatchObject({ name: 'Biosensio SAS' })
      expect(company.profileAnswers).toEqual([
        expect.objectContaining({ question: 'Votre pitch', value: SOPHIE_SECRET }),
      ])
      const [req] = company.requests as Array<Record<string, unknown>>
      expect(req).toMatchObject({ name: 'Biosensio', slug: 'biosensio' })
      expect(req.sharesGiven).toEqual([
        expect.objectContaining({ recipientEmail: CLAIRE.email, status: 'active' }),
      ])
      const audit = [...fake.table('auditLog').values()].filter(
        (e) => e.actionType === 'personal_data_exported',
      )
      expect(audit).toEqual([expect.objectContaining({ actorId: SOPHIE.id })])
    })

    it('gives a share’s recipient the share and the request’s name, never its content or owner', async () => {
      const { body, text } = await exportOf(CLAIRE)
      expect(body.sharesReceived).toEqual([
        expect.objectContaining({
          requestName: 'Biosensio',
          status: 'active',
          accessLevel: 'complet',
        }),
      ])
      expect(body.companies).toEqual([])
      expect(text).not.toContain(SOPHIE_SECRET)
      expect(text).not.toContain(SOPHIE.email)
      // Revoked, the share no longer names the request.
      fake.table('shareLink').get(SHARE)!.status = 'revoked'
      const after = await exportOf(CLAIRE)
      expect(after.body.sharesReceived).toEqual([
        expect.objectContaining({ requestName: null, status: 'revoked' }),
      ])
    })

    it('gives an administrator and a stranger nothing of another person', async () => {
      for (const u of [ADMIN, EVE]) {
        const { body, text } = await exportOf(u)
        expect(body.account).toMatchObject({ id: u.id, email: u.email })
        expect(text).not.toContain(SOPHIE_SECRET)
        expect(text).not.toContain(SOPHIE.email)
        expect(text).not.toContain(CLAIRE.email)
        expect(text).not.toContain('Biosensio')
        expect(text).not.toContain(DOSSIER)
      }
      // The administrator's own entry: the action, when, their own network details only.
      const { body } = await exportOf(ADMIN)
      expect(body.activity).toEqual(
        expect.arrayContaining([
          {
            action: 'admin_edited_field',
            at: expect.any(String),
            application: null,
            tool: null,
            ip: '203.0.113.5',
            userAgent: null,
          },
        ]),
      )
    })

    it(`is limited to ${EXPORT_LIMITS.perAccount} per hour and per account, with Retry-After`, async () => {
      for (let i = 0; i < EXPORT_LIMITS.perAccount; i++) await exportOf(EVE)
      const refused = await as(EVE).get('/v1/me/export').expect(429)
      expect(refused.body.error.code).toBe('TOO_MANY_REQUESTS')
      expect(refused.body.error.message).toMatch(/dans l’heure/)
      expect(Number(refused.headers['retry-after'])).toBeGreaterThan(0)
      expect(Number(refused.headers['retry-after'])).toBeLessThanOrEqual(3600)
      // Another account is not limited by Eve's exports.
      await exportOf(CLAIRE)
      const recorded = [...fake.table('auditLog').values()].filter(
        (e) => e.actionType === 'personal_data_exported' && e.actorId === EVE.id,
      )
      expect(recorded).toHaveLength(EXPORT_LIMITS.perAccount)
    })
  })

  describe('deletion requests', () => {
    const mine = async (u: { id: string }) => {
      const res = await as(u).get('/v1/me/deletion-request').expect(200)
      valid(myDeletionRequestStateSchema, res.body)
      return res.body.request as Record<string, unknown> | null
    }

    it('are refused without a session, and without the explicit confirmation', async () => {
      await http().get('/v1/me/deletion-request').expect(401)
      await http().post('/v1/me/deletion-request').send({ confirm: true }).expect(401)
      await as(EVE).post('/v1/me/deletion-request', {}).expect(400)
      await as(EVE).post('/v1/me/deletion-request', { confirm: 'yes' }).expect(400)
      expect(await mine(EVE)).toBeNull()
    })

    it('are made once, read back with what blocks them, and withdrawn while pending', async () => {
      const first = await as(SOPHIE).post('/v1/me/deletion-request', { confirm: true }).expect(200)
      valid(myDeletionRequestSchema, first.body)
      const again = await as(SOPHIE).post('/v1/me/deletion-request', { confirm: true }).expect(200)
      expect(again.body.id).toBe(first.body.id)
      expect(
        [...fake.table('accountDeletionRequest').values()].filter((r) => r.userId === SOPHIE.id),
      ).toHaveLength(1)
      const read = await mine(SOPHIE)
      expect(read).toMatchObject({ status: 'pending', impact: { companies: 1, requests: 1 } })
      expect((read!.impact as { blockers: unknown[] }).blockers).toEqual([
        { kind: 'open_share', subject: 'Biosensio', href: '/dashboard/dossiers/view/biosensio' },
      ])
      // Nobody else reads it.
      expect(await mine(CLAIRE)).toBeNull()
      await as(CLAIRE).delete('/v1/me/deletion-request').expect(404)

      const cancelled = await as(SOPHIE).delete('/v1/me/deletion-request').expect(200)
      expect(cancelled.body).toMatchObject({ status: 'cancelled', impact: null })
      await as(SOPHIE).delete('/v1/me/deletion-request').expect(404)
    })

    it('are listed and decided by administrators only', async () => {
      const { body } = await as(SOPHIE).post('/v1/me/deletion-request', { confirm: true })
      for (const u of [SOPHIE, CLAIRE]) {
        await as(u).get('/v1/admin/deletion-requests').expect(403)
        await as(u)
          .post(`/v1/admin/deletion-requests/${body.id}/complete`, { confirm: true })
          .expect(403)
        await as(u)
          .post(`/v1/admin/deletion-requests/${body.id}/decline`, { note: 'non' })
          .expect(403)
      }
      await http().get('/v1/admin/deletion-requests').expect(401)
      const list = await as(ADMIN).get('/v1/admin/deletion-requests').expect(200)
      for (const item of list.body) valid(adminDeletionRequestSchema, item)
      expect(list.body).toEqual([
        expect.objectContaining({
          id: body.id,
          status: 'pending',
          account: expect.objectContaining({ email: SOPHIE.email }),
        }),
      ])
      await as(ADMIN)
        .post(`/v1/admin/deletion-requests/not-a-uuid/complete`, { confirm: true })
        .expect(400)
      await as(ADMIN)
        .post(`/v1/admin/deletion-requests/${id(77)}/complete`, { confirm: true })
        .expect(404)
      await as(ADMIN).post(`/v1/admin/deletion-requests/${body.id}/complete`, {}).expect(400)
    })

    it('are never processed while a share is open: the administrator reads why', async () => {
      const { body } = await as(SOPHIE).post('/v1/me/deletion-request', { confirm: true })
      const blocked = await as(ADMIN)
        .post(`/v1/admin/deletion-requests/${body.id}/complete`, { confirm: true })
        .expect(409)
      expect(blocked.body.error.details).toEqual([
        { kind: 'open_share', subject: 'Biosensio', href: '/dashboard/dossiers/view/biosensio' },
      ])
      expect(fake.table('user').get(SOPHIE.id)).toBeDefined()
      expect((await mine(SOPHIE))!.status).toBe('pending')
    })

    it('declined, with a note the person reads, and a notification sent to them', async () => {
      const { body } = await as(SOPHIE).post('/v1/me/deletion-request', { confirm: true })
      await as(ADMIN)
        .post(`/v1/admin/deletion-requests/${body.id}/decline`, { note: '  ' })
        .expect(400)
      const declined = await as(ADMIN)
        .post(`/v1/admin/deletion-requests/${body.id}/decline`, {
          note: 'Révoquez d’abord le partage de Biosensio.',
        })
        .expect(200)
      valid(adminDeletionRequestSchema, declined.body)
      expect(declined.body).toMatchObject({ status: 'declined', impact: null })
      expect(await mine(SOPHIE)).toMatchObject({
        status: 'declined',
        declineNote: 'Révoquez d’abord le partage de Biosensio.',
      })
      const inbox = await as(SOPHIE).get('/v1/notifications').expect(200)
      expect(inbox.body.items).toEqual([
        expect.objectContaining({ kind: 'account_deletion_declined', href: '/compte' }),
      ])
      expect(mailed.map((m) => m.to)).toEqual([SOPHIE.email])
      expect(mailed[0].body).not.toContain('Révoquez')
      // Decided once.
      await as(OTHER_ADMIN)
        .post(`/v1/admin/deletion-requests/${body.id}/complete`, { confirm: true })
        .expect(409)
    })

    it('processed: the account is gone, its sessions and AI tokens refused, its address told', async () => {
      fake.table('shareLink').get(SHARE)!.status = 'revoked'
      await fake.prisma.oAuthClient.create({
        data: {
          id: 'client-claude',
          source: 'dcr',
          name: 'Claude',
          redirectUris: [],
          metadata: {},
        },
      })
      const grant = await fake.prisma.oAuthGrant.create({
        data: {
          userId: SOPHIE.id,
          clientId: 'client-claude',
          scopes: ['dossiers:read'],
          resource: 'http://localhost:3000/mcp',
          expiresAt: new Date(Date.now() + 86_400_000),
        },
      })
      await fake.prisma.oAuthToken.create({
        data: {
          grantId: grant.id,
          kind: 'access',
          tokenHash: hashToken('cfl_at_sophie'),
          scopes: ['dossiers:read'],
          expiresAt: new Date(Date.now() + 86_400_000),
        },
      })
      const provider = app.get(ConfluentOAuthProvider)
      await expect(provider.verifyAccessToken('cfl_at_sophie')).resolves.toBeDefined()

      const { body } = await as(SOPHIE).post('/v1/me/deletion-request', { confirm: true })
      const done = await as(ADMIN)
        .post(`/v1/admin/deletion-requests/${body.id}/complete`, { confirm: true })
        .expect(200)
      valid(adminDeletionRequestSchema, done.body)
      expect(done.body).toMatchObject({
        status: 'completed',
        account: null,
        confirmationEmail: 'sent',
        summary: expect.objectContaining({ companies: 1, requests: 1, connectedApplications: 1 }),
      })
      expect(done.body.subjectRef).toMatch(/^compte-supprime-[0-9a-f]{8}$/)
      expect(farewells).toEqual([
        { to: SOPHIE.email, privacyUrl: 'http://localhost:5173/confidentialite', locale: 'fr' },
      ])
      expect(fake.table('user').get(SOPHIE.id)).toBeUndefined()
      await as(SOPHIE).get('/v1/me/deletion-request').expect(401)
      await expect(provider.verifyAccessToken('cfl_at_sophie')).rejects.toThrow()
      const entry = [...fake.table('auditLog').values()].find(
        (e) => e.actionType === 'account_deleted',
      )
      expect(entry).toMatchObject({ actorId: ADMIN.id })
      expect(JSON.stringify(entry!.metadata)).not.toContain(SOPHIE.email)
      // Listed among the decisions by its pseudonym only.
      const decided = await as(ADMIN).get('/v1/admin/deletion-requests?status=decided').expect(200)
      expect(JSON.stringify(decided.body)).not.toContain(SOPHIE.email)
    })

    it('an administrator never processes their own request', async () => {
      const { body } = await as(ADMIN)
        .post('/v1/me/deletion-request', { confirm: true })
        .expect(200)
      const own = await as(ADMIN)
        .post(`/v1/admin/deletion-requests/${body.id}/complete`, { confirm: true })
        .expect(409)
      expect(own.body.error.message).toMatch(/Un autre administrateur/)
      await as(ADMIN)
        .post(`/v1/admin/deletion-requests/${body.id}/decline`, { note: 'non' })
        .expect(409)
      await as(OTHER_ADMIN)
        .post(`/v1/admin/deletion-requests/${body.id}/complete`, { confirm: true })
        .expect(200)
    })
  })
})
