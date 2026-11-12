import { createHash, randomBytes } from 'node:crypto'
import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import cookieParser from 'cookie-parser'
import { ZodValidationPipe } from 'nestjs-zod'
import request from 'supertest'
import type { App } from 'supertest/types'
import { AppModule } from './../src/app.module'
import { GlobalExceptionFilter } from './../src/common/filters/global-exception.filter'
import { PrismaService } from './../src/prisma/prisma.service'
import { EMAIL_TRANSPORT } from './../src/modules/auth/email/email-transport'
import { mountOAuthServer } from './../src/modules/oauth/oauth.http'
import { ConfluentOAuthProvider } from './../src/modules/oauth/oauth.provider'
import { createFakePrisma } from '../src/testing/fake-prisma'

const REDIRECT = 'https://claude.ai/api/mcp/auth_callback'
const RESOURCE = 'http://localhost:3000/mcp'

function pkce() {
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge }
}

describe('OAuth 2.1 server for MCP clients (e2e)', () => {
  let app: INestApplication<App>
  let fake: ReturnType<typeof createFakePrisma>
  let userJwt: string

  beforeEach(async () => {
    fake = createFakePrisma()
    await fake.prisma.user.create({
      data: {
        id: 'u-1',
        email: 'sophie@biosensio.fr',
        role: 'entrepreneur',
        emailVerifiedAt: new Date(),
      },
    })
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(fake.prisma)
      .overrideProvider(EMAIL_TRANSPORT)
      .useValue({ sendMagicLink: jest.fn(), sendShareInvite: jest.fn() })
      .compile()
    app = moduleFixture.createNestApplication()
    app.use(cookieParser())
    mountOAuthServer(app)
    app.setGlobalPrefix('v1', { exclude: ['/'] })
    app.useGlobalPipes(new ZodValidationPipe())
    app.useGlobalFilters(new GlobalExceptionFilter())
    await app.init()
    userJwt = await new JwtService().signAsync(
      { sub: 'u-1', email: 'sophie@biosensio.fr', role: 'entrepreneur' },
      { secret: process.env.JWT_SECRET },
    )
  })

  afterEach(async () => {
    await app.close()
  })

  const http = () => request(app.getHttpServer())

  async function registerClient() {
    const res = await http()
      .post('/register')
      .send({
        client_name: 'Claude',
        redirect_uris: [REDIRECT],
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
      })
      .expect(201)
    return res.body.client_id as string
  }

  // Walks the whole browser part: /authorize → consent screen API → redirect back with a code.
  async function authorize(clientId: string, clientName = 'Claude') {
    const scope = 'dossiers:read dossiers:write'
    const { verifier, challenge } = pkce()
    const res = await http()
      .get('/authorize')
      .query({
        response_type: 'code',
        client_id: clientId,
        redirect_uri: REDIRECT,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        scope,
        state: 'st-123',
        resource: RESOURCE,
      })
      .expect(302)
    const consent = new URL(res.headers.location)
    expect(`${consent.origin}${consent.pathname}`).toBe('http://localhost:5173/oauth/consent')
    const requestId = consent.searchParams.get('request')!

    const shown = await http()
      .get(`/v1/oauth/requests/${requestId}`)
      .set('Authorization', `Bearer ${userJwt}`)
      .expect(200)
    expect(shown.body.client).toMatchObject({ name: clientName, redirectHost: 'claude.ai' })

    const decided = await http()
      .post(`/v1/oauth/requests/${requestId}/decision`)
      .set('Authorization', `Bearer ${userJwt}`)
      .send({ approve: true })
      .expect(200)
    const back = new URL(decided.body.redirectUrl)
    expect(`${back.origin}${back.pathname}`).toBe(REDIRECT)
    expect(back.searchParams.get('state')).toBe('st-123')
    expect(back.searchParams.get('iss')).toBe('http://localhost:3000/')
    return { code: back.searchParams.get('code')!, verifier, requestId }
  }

  const exchange = (clientId: string, code: string, verifier: string) =>
    http().post('/token').type('form').send({
      grant_type: 'authorization_code',
      client_id: clientId,
      code,
      code_verifier: verifier,
      redirect_uri: REDIRECT,
      resource: RESOURCE,
    })

  // Code review R17/R13: write implies read on the server, so the consent screen shows both; an
  // explicitly empty or unknown choice is refused without consuming the request.

  // Code review R15: RFC 9207 — every authorization response redirected to the client carries the
  // exact issuer, errors included, with the client's state.
  it('authorization error redirects carry iss and state', async () => {
    const clientId = await registerClient()
    const { challenge } = pkce()
    const base = {
      response_type: 'code',
      client_id: clientId,
      redirect_uri: REDIRECT,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      scope: 'dossiers:read',
      state: 'st-err',
      resource: RESOURCE,
    }
    for (const invalid of [
      { resource: 'https://autre.example/mcp' },
      { code_challenge_method: 'plain' },
      { scope: 'admin:all' },
    ]) {
      const res = await http()
        .get('/authorize')
        .query({ ...base, ...invalid })
        .expect(302)
      const back = new URL(res.headers.location)
      expect(`${back.origin}${back.pathname}`).toBe(REDIRECT)
      expect(back.searchParams.get('error')).toBeTruthy()
      expect(back.searchParams.get('state')).toBe('st-err')
      expect({ invalid, iss: back.searchParams.get('iss') }).toEqual({
        invalid,
        iss: 'http://localhost:3000/',
      })
    }
  })
  it('consent: write-only request shows read too; empty or unknown choices are refused, request kept', async () => {
    const clientId = await registerClient()
    const { challenge } = pkce()
    const start = await http()
      .get('/authorize')
      .query({
        response_type: 'code',
        client_id: clientId,
        redirect_uri: REDIRECT,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        scope: 'dossiers:write',
        resource: RESOURCE,
      })
      .expect(302)
    const requestId = new URL(start.headers.location).searchParams.get('request')!
    const shown = await http()
      .get(`/v1/oauth/requests/${requestId}`)
      .set('Authorization', `Bearer ${userJwt}`)
      .expect(200)
    expect(shown.body.scopes.map((s: { scope: string }) => s.scope)).toEqual([
      'dossiers:read',
      'dossiers:write',
    ])

    const decide = (scopes: string[]) =>
      http()
        .post(`/v1/oauth/requests/${requestId}/decision`)
        .set('Authorization', `Bearer ${userJwt}`)
        .send({ approve: true, scopes })
    await decide([]).expect(400)
    await decide(['admin:all']).expect(400)
    expect([...fake.table('oAuthGrant').values()]).toHaveLength(0)

    // Still pending: the user can correct the choice — here, read only.
    await decide(['dossiers:read']).expect(200)
    const grants = [...fake.table('oAuthGrant').values()]
    expect(grants.map((g) => g.scopes)).toEqual([['dossiers:read']])
  })
  // E04.06: designing forms is for administrators only. Clients usually ask for every scope the
  // server supports: an entrepreneur is never shown nor granted `forms:write`.
  it('consent: the form permissions are offered and granted to an administrator only', async () => {
    await fake.prisma.user.create({
      data: {
        id: 'admin-1',
        email: 'admin@confluent.dev',
        role: 'admin',
        emailVerifiedAt: new Date(),
      },
    })
    const adminJwt = await new JwtService().signAsync(
      { sub: 'admin-1', email: 'admin@confluent.dev', role: 'admin' },
      { secret: process.env.JWT_SECRET },
    )
    const clientId = await registerClient()
    const request = async () => {
      const start = await http()
        .get('/authorize')
        .query({
          response_type: 'code',
          client_id: clientId,
          redirect_uri: REDIRECT,
          code_challenge: pkce().challenge,
          code_challenge_method: 'S256',
          resource: RESOURCE,
        })
        .expect(302)
      return new URL(start.headers.location).searchParams.get('request')!
    }
    const shown = async (id: string, jwt: string) =>
      (
        await http()
          .get(`/v1/oauth/requests/${id}`)
          .set('Authorization', `Bearer ${jwt}`)
          .expect(200)
      ).body.scopes.map((s: { scope: string; label: string }) => s.scope)
    const decide = (id: string, jwt: string, scopes?: string[]) =>
      http()
        .post(`/v1/oauth/requests/${id}/decision`)
        .set('Authorization', `Bearer ${jwt}`)
        .send({ approve: true, scopes })
    const grantsOf = (userId: string) =>
      [...fake.table('oAuthGrant').values()].filter((g) => g.userId === userId).map((g) => g.scopes)

    const forEntrepreneur = await request()
    expect(await shown(forEntrepreneur, userJwt)).toEqual([
      'candidatures:decide',
      'dossiers:present',
      'dossiers:read',
      'dossiers:submit',
      'dossiers:write',
      'opportunities:read',
      'opportunities:write',
      'sharing:read',
      'sharing:write',
    ])
    await decide(forEntrepreneur, userJwt, ['dossiers:read', 'forms:write']).expect(400)
    await decide(forEntrepreneur, userJwt, ['dossiers:read', 'forms:publish']).expect(400)
    expect(grantsOf('u-1')).toEqual([])
    await decide(forEntrepreneur, userJwt, ['dossiers:read', 'dossiers:write']).expect(200)
    expect(grantsOf('u-1')).toEqual([['dossiers:read', 'dossiers:write']])

    const forAdmin = await request()
    expect(await shown(forAdmin, adminJwt)).toEqual([
      'candidatures:decide',
      'dossiers:present',
      'dossiers:read',
      'dossiers:submit',
      'dossiers:write',
      'forms:publish',
      'forms:write',
      'opportunities:read',
      'opportunities:write',
      'sharing:read',
      'sharing:write',
    ])
    await decide(forAdmin, adminJwt, ['dossiers:read', 'forms:write', 'forms:publish']).expect(200)
    expect(grantsOf('admin-1')).toEqual([['dossiers:read', 'forms:write', 'forms:publish']])
  })

  // ROADMAP E05.10: the person chooses which workspaces the application may reach, among their
  // active memberships, none beforehand; the choice is checked when decided and stored with the
  // authorization, which no refresh widens. Presenting financing requests is offered to whoever may
  // own companies; designing forms to whoever manages a workspace too.
  describe('consent per workspace (E05.10)', () => {
    let memberJwt: string
    let clientId: string

    beforeEach(async () => {
      const p = fake.prisma
      await p.user.create({
        data: {
          id: 'u-cons',
          email: 'claire@incubateur.fr',
          role: 'financeur',
          emailVerifiedAt: new Date(),
        },
      })
      for (const [id, slug, name] of [
        ['w-1', 'incubateur-nord', 'Incubateur Nord'],
        ['w-2', 'club-sud', 'Club Sud'],
        ['w-3', 'reseau-est', 'Réseau Est'],
        ['w-4', 'cci-ouest', 'CCI Ouest'],
      ]) {
        await p.workspace.create({ data: { id, slug, name } })
      }
      // Manager of w-1, investor in w-2, deactivated in w-3, nothing in w-4.
      await p.workspaceMembership.create({
        data: {
          workspaceId: 'w-1',
          userId: 'u-cons',
          role: 'conseiller',
          canManageWorkspace: true,
        },
      })
      await p.workspaceMembership.create({
        data: { workspaceId: 'w-2', userId: 'u-cons', role: 'investisseur' },
      })
      await p.workspaceMembership.create({
        data: {
          workspaceId: 'w-3',
          userId: 'u-cons',
          role: 'conseiller',
          deactivatedAt: new Date(),
        },
      })
      memberJwt = await new JwtService().signAsync(
        { sub: 'u-cons', email: 'claire@incubateur.fr', role: 'financeur' },
        { secret: process.env.JWT_SECRET },
      )
      clientId = await registerClient()
    })

    const start = async () => {
      const { verifier, challenge } = pkce()
      const res = await http()
        .get('/authorize')
        .query({
          response_type: 'code',
          client_id: clientId,
          redirect_uri: REDIRECT,
          code_challenge: challenge,
          code_challenge_method: 'S256',
          resource: RESOURCE,
        })
        .expect(302)
      return { requestId: new URL(res.headers.location).searchParams.get('request')!, verifier }
    }
    const decide = (id: string, jwt: string, body: Record<string, unknown>) =>
      http()
        .post(`/v1/oauth/requests/${id}/decision`)
        .set('Authorization', `Bearer ${jwt}`)
        .send({ approve: true, ...body })
    const grants = () => [...fake.table('oAuthGrant').values()]

    it('offers the active memberships only, none ticked; refuses any other; stores the choice', async () => {
      const { requestId } = await start()
      const shown = await http()
        .get(`/v1/oauth/requests/${requestId}`)
        .set('Authorization', `Bearer ${memberJwt}`)
        .expect(200)
      expect(shown.body.workspaces).toEqual([
        { id: 'w-2', slug: 'club-sud', name: 'Club Sud', programName: null, role: 'investisseur' },
        {
          id: 'w-1',
          slug: 'incubateur-nord',
          name: 'Incubateur Nord',
          programName: null,
          role: 'conseiller',
        },
      ])
      // A manager designs the forms of their workspace: offered; presenting and sharing requests
      // are not (a financeur owns no company); reading and taking positions on opportunities are.
      expect(shown.body.scopes.map((s: { scope: string }) => s.scope)).toEqual([
        'candidatures:decide',
        'candidatures:support',
        'dossiers:read',
        'dossiers:submit',
        'dossiers:write',
        'forms:publish',
        'forms:write',
        'opportunities:read',
        'opportunities:write',
      ])

      // A deactivated membership, a workspace one is not in, an unknown one: refused, nothing kept,
      // the request still pending.
      for (const workspaceIds of [['w-3'], ['w-4'], ['w-1', 'nope']]) {
        await decide(requestId, memberJwt, { scopes: ['dossiers:read'], workspaceIds }).expect(400)
      }
      await decide(requestId, memberJwt, { scopes: ['dossiers:read', 'dossiers:present'] }).expect(
        400,
      )
      expect(grants()).toHaveLength(0)

      await decide(requestId, memberJwt, {
        scopes: ['dossiers:read', 'forms:write'],
        workspaceIds: ['w-1', 'w-1'],
      }).expect(200)
      expect(grants().map((g) => [g.scopes, g.workspaceIds])).toEqual([
        [['dossiers:read', 'forms:write'], ['w-1']],
      ])
      const journal = [...fake.table('auditLog').values()].find(
        (e) => e.actionType === 'oauth_grant_created',
      )
      expect(journal?.metadata).toMatchObject({ workspaceIds: ['w-1'] })

      // « Applications connectées » says which workspaces the application reaches.
      const apps = await http()
        .get('/v1/oauth/applications')
        .set('Authorization', `Bearer ${memberJwt}`)
        .expect(200)
      expect(apps.body[0].workspaces).toEqual([{ id: 'w-1', name: 'Incubateur Nord' }])
    })

    it('no choice means no workspace; the tokens carry the grant’s choice, which a refresh never widens', async () => {
      const first = await start()
      await decide(first.requestId, memberJwt, { scopes: ['dossiers:read'] }).expect(200)
      expect(grants().map((g) => g.workspaceIds)).toEqual([[]])

      const second = await start()
      const decided = await decide(second.requestId, memberJwt, {
        scopes: ['dossiers:read'],
        workspaceIds: ['w-2'],
      }).expect(200)
      const code = new URL(decided.body.redirectUrl).searchParams.get('code')!
      const tokens = await exchange(clientId, code, second.verifier).expect(200)
      const provider = app.get(ConfluentOAuthProvider)
      expect((await provider.verifyAccessToken(tokens.body.access_token)).extra).toMatchObject({
        workspaceIds: ['w-2'],
      })
      const refreshed = await http()
        .post('/token')
        .type('form')
        .send({
          grant_type: 'refresh_token',
          client_id: clientId,
          refresh_token: tokens.body.refresh_token,
          scope: 'dossiers:read',
        })
        .expect(200)
      expect((await provider.verifyAccessToken(refreshed.body.access_token)).extra).toMatchObject({
        workspaceIds: ['w-2'],
      })
    })

    it('an entrepreneur without membership is offered dossiers:present and no workspace', async () => {
      const { requestId } = await start()
      const shown = await http()
        .get(`/v1/oauth/requests/${requestId}`)
        .set('Authorization', `Bearer ${userJwt}`)
        .expect(200)
      expect(shown.body.workspaces).toEqual([])
      expect(shown.body.scopes.map((s: { scope: string }) => s.scope)).toContain('dossiers:present')
      await decide(requestId, userJwt, { scopes: ['dossiers:read', 'dossiers:present'] }).expect(
        200,
      )
      expect(grants().map((g) => g.scopes)).toEqual([['dossiers:read', 'dossiers:present']])
    })
  })

  it('keeps Nest global body parsers active (mounting OAuth must not shadow them)', async () => {
    // Nest skips its global parsers if a layer *named* urlencodedParser/jsonParser already exists:
    // a Nest route must still read a form body after the OAuth routes are mounted.
    const res = await http().post('/v1/auth/magic-link').type('form').send({ email: 'x@y.fr' })
    expect(res.status).toBe(200)
  })

  it('publishes RFC 9728 / RFC 8414 discovery documents with the MCP-required fields', async () => {
    const prm = await http().get('/.well-known/oauth-protected-resource/mcp').expect(200)
    expect(prm.body).toMatchObject({
      resource: RESOURCE,
      authorization_servers: ['http://localhost:3000/'],
    })
    await http().get('/.well-known/oauth-protected-resource').expect(200)
    const as = await http().get('/.well-known/oauth-authorization-server').expect(200)
    expect(as.body).toMatchObject({
      issuer: 'http://localhost:3000/',
      code_challenge_methods_supported: ['S256'],
      client_id_metadata_document_supported: true,
      authorization_response_iss_parameter_supported: true,
      scopes_supported: [
        'dossiers:read',
        'dossiers:write',
        'dossiers:submit',
        'dossiers:present',
        'forms:write',
        'forms:publish',
        'candidatures:support',
        'candidatures:decide',
        'opportunities:read',
        'opportunities:write',
        'sharing:read',
        'sharing:write',
      ],
    })
  })

  it('full flow: register → authorize → consent → token → verify → refresh → revoke', async () => {
    const clientId = await registerClient()
    const { code, verifier } = await authorize(clientId)

    const tokens = await exchange(clientId, code, verifier).expect(200)
    expect(tokens.body).toMatchObject({
      token_type: 'Bearer',
      scope: 'dossiers:read dossiers:write',
    })
    const provider = app.get(ConfluentOAuthProvider)
    const info = await provider.verifyAccessToken(tokens.body.access_token)
    expect(info.extra).toMatchObject({ userId: 'u-1', clientName: 'Claude' })

    // The code is single use.
    const replay = await exchange(clientId, code, verifier).expect(400)
    expect(replay.body.error).toBe('invalid_grant')

    // Refresh rotates; the old refresh token is refused (within the retry window: no revocation).
    const refreshed = await http()
      .post('/token')
      .type('form')
      .send({
        grant_type: 'refresh_token',
        client_id: clientId,
        refresh_token: tokens.body.refresh_token,
      })
      .expect(200)
    await http()
      .post('/token')
      .type('form')
      .send({
        grant_type: 'refresh_token',
        client_id: clientId,
        refresh_token: tokens.body.refresh_token,
      })
      .expect(400)
    await expect(provider.verifyAccessToken(refreshed.body.access_token)).resolves.toBeDefined()

    // Revoking ends the whole connection.
    await http()
      .post('/revoke')
      .type('form')
      .send({ client_id: clientId, token: refreshed.body.refresh_token })
      .expect(200)
    await expect(provider.verifyAccessToken(refreshed.body.access_token)).rejects.toThrow()
  })

  // Code review R52: submitting and publishing are permissions of their own. A connection
  // authorized without them never obtains them by refreshing its tokens.
  it('a connection authorized before dossiers:submit cannot gain it by refreshing', async () => {
    const clientId = await registerClient()
    const { code, verifier } = await authorize(clientId)
    const tokens = await exchange(clientId, code, verifier).expect(200)
    expect(tokens.body.scope).toBe('dossiers:read dossiers:write')
    const refresh = (refreshToken: string, scope?: string) =>
      http()
        .post('/token')
        .type('form')
        .send({
          grant_type: 'refresh_token',
          client_id: clientId,
          refresh_token: refreshToken,
          ...(scope ? { scope } : {}),
        })
    const widened = await refresh(
      tokens.body.refresh_token,
      'dossiers:read dossiers:write dossiers:submit',
    ).expect(400)
    expect(widened.body.error).toBe('invalid_scope')
    const refreshed = await refresh(tokens.body.refresh_token).expect(200)
    expect(refreshed.body.scope).toBe('dossiers:read dossiers:write')
    const info = await app
      .get(ConfluentOAuthProvider)
      .verifyAccessToken(refreshed.body.access_token)
    expect(info.scopes).not.toContain('dossiers:submit')
  })

  // E07.10 (R52): opportunities, positions and the diffusion of requests are permissions of their
  // own. A connection authorized without them never obtains them by refreshing, alone or together.
  it('a connection authorized before the E07.10 permissions cannot gain them by refreshing', async () => {
    const clientId = await registerClient()
    const { code, verifier } = await authorize(clientId)
    const tokens = await exchange(clientId, code, verifier).expect(200)
    expect(tokens.body.scope).toBe('dossiers:read dossiers:write')
    const refresh = (refreshToken: string, scope?: string) =>
      http()
        .post('/token')
        .type('form')
        .send({
          grant_type: 'refresh_token',
          client_id: clientId,
          refresh_token: refreshToken,
          ...(scope ? { scope } : {}),
        })
    for (const extra of [
      'opportunities:read',
      'opportunities:write',
      'sharing:read',
      'sharing:write',
    ]) {
      const widened = await refresh(
        tokens.body.refresh_token,
        `dossiers:read dossiers:write ${extra}`,
      ).expect(400)
      expect([extra, widened.body.error]).toEqual([extra, 'invalid_scope'])
    }
    const refreshed = await refresh(tokens.body.refresh_token).expect(200)
    expect(refreshed.body.scope).toBe('dossiers:read dossiers:write')
    const info = await app
      .get(ConfluentOAuthProvider)
      .verifyAccessToken(refreshed.body.access_token)
    expect(info.scopes).toEqual(['dossiers:read', 'dossiers:write'])
  })

  it('a refresh token replayed after the retry window revokes the connection', async () => {
    const clientId = await registerClient()
    const { code, verifier } = await authorize(clientId)
    const tokens = (await exchange(clientId, code, verifier).expect(200)).body
    const next = (
      await http()
        .post('/token')
        .type('form')
        .send({
          grant_type: 'refresh_token',
          client_id: clientId,
          refresh_token: tokens.refresh_token,
        })
        .expect(200)
    ).body
    for (const t of fake.table('oAuthToken').values()) {
      if (t.usedAt) t.usedAt = new Date(Date.now() - 60_000)
    }
    await http()
      .post('/token')
      .type('form')
      .send({
        grant_type: 'refresh_token',
        client_id: clientId,
        refresh_token: tokens.refresh_token,
      })
      .expect(400)
    await expect(
      app.get(ConfluentOAuthProvider).verifyAccessToken(next.access_token),
    ).rejects.toThrow()
  })

  it('rejects a wrong PKCE verifier, a foreign resource and an unregistered redirect_uri', async () => {
    const clientId = await registerClient()
    const { code } = await authorize(clientId)
    const wrong = await exchange(clientId, code, pkce().verifier).expect(400)
    expect(wrong.body.error).toBe('invalid_grant')

    const { challenge } = pkce()
    const base = {
      response_type: 'code',
      client_id: clientId,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    }
    await http()
      .get('/authorize')
      .query({ ...base, redirect_uri: 'https://evil.example/cb' })
      .expect(400)
    const foreign = await http()
      .get('/authorize')
      .query({ ...base, redirect_uri: REDIRECT, resource: 'https://other.example/mcp' })
    expect(foreign.status).toBe(302)
    expect(new URL(foreign.headers.location).searchParams.get('error')).toBe('invalid_target')
  })

  it('refusing consent sends access_denied back, and narrowing scopes is honoured', async () => {
    const clientId = await registerClient()
    const { challenge, verifier } = pkce()
    const start = await http()
      .get('/authorize')
      .query({
        response_type: 'code',
        client_id: clientId,
        redirect_uri: REDIRECT,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        scope: 'dossiers:read dossiers:write',
      })
      .expect(302)
    const requestId = new URL(start.headers.location).searchParams.get('request')!
    const narrowed = await http()
      .post(`/v1/oauth/requests/${requestId}/decision`)
      .set('Authorization', `Bearer ${userJwt}`)
      .send({ approve: true, scopes: ['dossiers:read'] })
      .expect(200)
    const code = new URL(narrowed.body.redirectUrl).searchParams.get('code')!
    const tokens = await exchange(clientId, code, verifier).expect(200)
    expect(tokens.body.scope).toBe('dossiers:read')

    // A decided request cannot be decided again, and the consent API needs a logged-in user.
    await http()
      .post(`/v1/oauth/requests/${requestId}/decision`)
      .set('Authorization', `Bearer ${userJwt}`)
      .send({ approve: true })
      .expect(400)
    await http().get(`/v1/oauth/requests/${requestId}`).expect(401)

    const { requestId: second } = await (async () => {
      const r = await http()
        .get('/authorize')
        .query({
          response_type: 'code',
          client_id: clientId,
          redirect_uri: REDIRECT,
          code_challenge: challenge,
          code_challenge_method: 'S256',
          state: 's2',
        })
        .expect(302)
      return { requestId: new URL(r.headers.location).searchParams.get('request')! }
    })()
    const denied = await http()
      .post(`/v1/oauth/requests/${second}/decision`)
      .set('Authorization', `Bearer ${userJwt}`)
      .send({ approve: false })
      .expect(200)
    const back = new URL(denied.body.redirectUrl)
    expect(back.searchParams.get('error')).toBe('access_denied')
    expect(back.searchParams.get('state')).toBe('s2')
    expect(back.searchParams.get('code')).toBeNull()
  })

  it('refuses DCR with a non-HTTPS, non-loopback redirect_uri', async () => {
    const res = await http()
      .post('/register')
      .send({
        client_name: 'Evil',
        redirect_uris: ['http://evil.example/cb'],
        token_endpoint_auth_method: 'none',
      })
      .expect(400)
    expect(res.body.error).toBe('invalid_client_metadata')
  })

  it('accepts client_secret_basic for confidential clients', async () => {
    const reg = await http()
      .post('/register')
      .send({
        client_name: 'ChatGPT',
        redirect_uris: [REDIRECT],
        token_endpoint_auth_method: 'client_secret_basic',
      })
      .expect(201)
    const { client_id: clientId, client_secret: secret } = reg.body as {
      client_id: string
      client_secret: string
    }
    const { code, verifier } = await authorize(clientId, 'ChatGPT')
    await http()
      .post('/token')
      .auth(clientId, secret)
      .type('form')
      .send({
        grant_type: 'authorization_code',
        code,
        code_verifier: verifier,
        redirect_uri: REDIRECT,
      })
      .expect(200)
  })
})
