import type { AddressInfo } from 'node:net'
import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { AppModule } from './../src/app.module'
import { PrismaService } from './../src/prisma/prisma.service'
import { EMAIL_TRANSPORT } from './../src/modules/auth/email/email-transport'
import { mountOAuthServer } from './../src/modules/oauth/oauth.http'
import { mountMcpEndpoint } from './../src/modules/mcp/mcp.http'
import { hashToken } from './../src/modules/oauth/oauth.constants'
import { createFakePrisma } from '../src/testing/fake-prisma'
import { DEFAULT_CLASSIFICATION_RULES } from '../src/testing/classification-rules.fixture'

const FUTURE = new Date(Date.now() + 3600_000)

describe('MCP endpoint /mcp (e2e, official MCP client)', () => {
  let app: INestApplication
  let fake: ReturnType<typeof createFakePrisma>
  let base: string

  // Seeds a connected application for `userId` and returns a usable access token.
  async function connect(userId: string, scopes: string[]): Promise<string> {
    const token = `cfl_at_test_${userId}_${scopes.join('_')}`
    const grant = await fake.prisma.oAuthGrant.create({
      data: {
        userId,
        clientId: 'client-claude',
        scopes,
        resource: 'http://localhost:3000/mcp',
        expiresAt: FUTURE,
      },
    })
    await fake.prisma.oAuthToken.create({
      data: {
        grantId: grant.id,
        kind: 'access',
        tokenHash: hashToken(token),
        scopes,
        expiresAt: FUTURE,
      },
    })
    return token
  }

  async function client(token: string) {
    const c = new Client({ name: 'test-client', version: '1.0.0' })
    await c.connect(
      new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      }),
    )
    return c
  }

  const json = (res: Record<string, unknown>) =>
    JSON.parse((res.content as Array<{ text: string }>)[0].text) as Record<string, unknown>

  beforeEach(async () => {
    fake = createFakePrisma()
    const p = fake.prisma
    for (const u of [
      { id: 'u-1', email: 'sophie@biosensio.fr', role: 'entrepreneur' },
      { id: 'u-2', email: 'autre@exemple.fr', role: 'entrepreneur' },
    ]) {
      await p.user.create({ data: { ...u, emailVerifiedAt: new Date() } })
    }
    await p.oAuthClient.create({
      data: { id: 'client-claude', source: 'dcr', name: 'Claude', redirectUris: [], metadata: {} },
    })
    await p.questionnaireVersion.create({ data: { id: 'v-2', version: 2, status: 'published' } })
    await p.questionnaireVersion.create({ data: { id: 'v-1', version: 1, status: 'archived' } })
    for (const [id, versionId, title, orderIndex] of [
      ['s-identite', 'v-2', 'Identité du projet', 0],
      ['s-financier', 'v-2', 'Stade financier', 1],
      ['s-presentation', 'v-1', 'Présentation', 0],
    ] as const) {
      await p.questionnaireSection.create({ data: { id, versionId, key: id, title, orderIndex } })
    }
    const field = (id: string, data: Record<string, unknown>) =>
      p.questionnaireField.create({ data: { id, versionId: 'v-2', ...data } })
    await field('f-name', {
      sectionId: 's-identite',
      key: 'nom_du_projet',
      label: 'Nom du projet',
      fieldType: 'text',
      constraints: { maxLength: 80 },
      required: true,
      orderIndex: 0,
    })
    await field('f-stage', {
      sectionId: 's-financier',
      key: 'stade_financement',
      label: 'Stade de financement actuel',
      fieldType: 'select',
      choices: [
        { key: 'fonds_propres_uniquement', label: 'Fonds propres uniquement' },
        { key: 'seed_investisseurs_professionnels', label: 'Seed – investisseurs professionnels' },
      ],
      required: true,
      orderIndex: 0,
    })
    await p.questionnaireField.create({
      data: {
        id: 'f-old',
        versionId: 'v-1',
        sectionId: 's-presentation',
        key: 'ancien',
        label: 'Ancien',
        fieldType: 'text',
        orderIndex: 0,
      },
    })
    await p.dossier.create({
      data: {
        id: '11111111-1111-4111-8111-111111111111',
        userId: 'u-1',
        name: 'Biosensio',
        slug: 'biosensio',
        questionnaireVersionId: 'v-2',
      },
    })
    await p.dossier.create({
      data: {
        id: '22222222-2222-4222-8222-222222222222',
        userId: 'u-2',
        name: 'Autre',
        slug: 'autre',
        questionnaireVersionId: 'v-2',
      },
    })

    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(fake.prisma)
      .overrideProvider(EMAIL_TRANSPORT)
      .useValue({ sendMagicLink: jest.fn(), sendShareInvite: jest.fn() })
      .compile()
    app = moduleFixture.createNestApplication()
    mountOAuthServer(app)
    mountMcpEndpoint(app)
    app.setGlobalPrefix('v1', { exclude: ['/'] })
    await app.listen(0)
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`
  })

  afterEach(async () => {
    await app.close()
  })

  it('keeps JSON bodies working on the REST API (mounting /mcp must not shadow Nest parsers)', async () => {
    const res = await fetch(`${base}/v1/auth/magic-link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'x@y.fr' }),
    })
    expect(res.status).toBe(200)
  })

  it('rejects unauthenticated calls with 401 + resource_metadata, GET with 405, foreign Origin with 403', async () => {
    const res = await fetch(`${base}/mcp`, { method: 'POST', body: '{}' })
    expect(res.status).toBe(401)
    expect(res.headers.get('www-authenticate')).toContain(
      'resource_metadata="http://localhost:3000/.well-known/oauth-protected-resource/mcp"',
    )
    expect((await fetch(`${base}/mcp`)).status).toBe(405)
    const token = await connect('u-1', ['dossiers:read'])
    const evil = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, Origin: 'https://evil.example' },
      body: '{}',
    })
    expect(evil.status).toBe(403)
  })

  it('lists tools, identifies the caller, and lists only the caller’s dossiers', async () => {
    const c = await client(await connect('u-1', ['dossiers:write']))
    const tools = await c.listTools()
    expect(tools.tools.map((t) => t.name).sort()).toEqual([
      'get_dossier',
      'list_dossiers',
      'update_answers',
      'whoami',
    ])
    const me = json(await c.callTool({ name: 'whoami', arguments: {} }))
    expect(me).toMatchObject({ email: 'sophie@biosensio.fr', application: 'Claude' })
    expect(me.grantedScopes).toEqual(expect.arrayContaining(['dossiers:read', 'dossiers:write']))
    const list = json(await c.callTool({ name: 'list_dossiers', arguments: {} }))
    expect((list.dossiers as Array<{ slug: string }>).map((d) => d.slug)).toEqual(['biosensio'])
    await c.close()
  })

  it('reads a dossier by slug, writes valid answers, and the answer is then visible', async () => {
    const c = await client(await connect('u-1', ['dossiers:read', 'dossiers:write']))
    const before = json(
      await c.callTool({ name: 'get_dossier', arguments: { dossier: 'biosensio' } }),
    )
    expect(before.missingRequired).toHaveLength(2)
    expect(before.canEdit).toBe(true)

    const saved = await c.callTool({
      name: 'update_answers',
      arguments: {
        dossier: 'biosensio',
        answers: [
          { fieldId: 'f-name', value: 'Biosensio' },
          { fieldId: 'f-stage', value: 'Seed – investisseurs professionnels' },
        ],
      },
    })
    expect(saved.isError).toBeFalsy()
    expect(json(saved)).toMatchObject({ saved: 2, missingRequired: [] })

    const after = json(
      await c.callTool({ name: 'get_dossier', arguments: { dossier: 'biosensio' } }),
    )
    type Described = {
      fieldId: string
      answer: string
      answerLabel?: string
      choices?: unknown[]
      limits?: string
    }
    const fields = (after.sections as Array<{ fields: Described[] }>).flatMap((s) => s.fields)
    expect(fields.find((f) => f.fieldId === 'f-name')).toMatchObject({
      answer: 'Biosensio',
      limits: '80 caractères maximum.',
    })
    // Sent by its label, the list answer is stored as the choice key and described with both.
    expect(fields.find((f) => f.fieldId === 'f-stage')).toMatchObject({
      answer: 'seed_investisseurs_professionnels',
      answerLabel: 'Seed – investisseurs professionnels',
      choices: expect.arrayContaining([
        { key: 'fonds_propres_uniquement', label: 'Fonds propres uniquement' },
      ]),
    })
    expect([...fake.table('dossierAnswer').values()]).toHaveLength(2)
    await c.close()
  })

  it('refuses invalid values and fields of another questionnaire version, saving nothing', async () => {
    const c = await client(await connect('u-1', ['dossiers:write']))
    const bad = await c.callTool({
      name: 'update_answers',
      arguments: {
        dossier: 'biosensio',
        answers: [
          { fieldId: 'f-name', value: 'ok' },
          { fieldId: 'f-stage', value: 'Série Z' },
          { fieldId: 'f-old', value: 'champ V1' },
        ],
      },
    })
    expect(bad.isError).toBe(true)
    const text = (bad.content as Array<{ text: string }>)[0].text
    expect(text).toContain('Choix attendu parmi')
    expect(text).toContain('n’appartient pas au questionnaire de ce dossier')
    expect(fake.table('dossierAnswer').size).toBe(0)
    await c.close()
  })

  // Code review R18: on a submitted dossier, an answer changed through MCP updates the derived
  // classification at once, and the tool answers with the dossier as it is after the write.
  it('reclassifies a submitted dossier after an MCP change, and describes it after the write', async () => {
    const p = fake.prisma
    for (const rule of DEFAULT_CLASSIFICATION_RULES)
      await p.classificationRule.create({ data: rule })
    await p.questionnaireField.create({
      data: {
        id: 'f-sector',
        versionId: 'v-2',
        sectionId: 's-identite',
        key: 'secteur',
        label: 'Secteur',
        fieldType: 'text',
        required: false,
        orderIndex: 1,
        minAccessLevel: 'public',
      },
    })
    const id = '11111111-1111-4111-8111-111111111111'
    for (const [fieldId, value] of [
      ['f-name', 'Biosensio'],
      ['f-stage', 'fonds_propres_uniquement'],
      ['f-sector', 'Biotech'],
    ]) {
      await p.dossierAnswer.create({ data: { dossierId: id, fieldId, value } })
    }
    await p.dossier.update({ where: { id }, data: { submittedAt: new Date(), sector: 'Biotech' } })

    const c = await client(await connect('u-1', ['dossiers:write']))
    const res = await c.callTool({
      name: 'update_answers',
      arguments: { dossier: 'biosensio', answers: [{ fieldId: 'f-sector', value: 'SaaS' }] },
    })
    expect(res.isError).toBeFalsy()
    expect(fake.table('dossier').get(id)).toMatchObject({ sector: 'SaaS', axe2Financier: 2 })
    const read = json(
      await c.callTool({ name: 'get_dossier', arguments: { dossier: 'biosensio' } }),
    )
    expect((read.dossier as { classification: { sector: string } }).classification.sector).toBe(
      'SaaS',
    )
    await c.close()
  })

  it('never exposes another user’s dossier', async () => {
    const c = await client(await connect('u-1', ['dossiers:write']))
    const res = await c.callTool({ name: 'get_dossier', arguments: { dossier: 'autre' } })
    expect(res.isError).toBe(true)
    expect((res.content as Array<{ text: string }>)[0].text).toContain('introuvable')
    const write = await c.callTool({
      name: 'update_answers',
      arguments: {
        dossier: '22222222-2222-4222-8222-222222222222',
        answers: [{ fieldId: 'f-name', value: 'x' }],
      },
    })
    expect(write.isError).toBe(true)
    expect(fake.table('dossierAnswer').size).toBe(0)
    await c.close()
  })

  it('a read-only connection gets 403 insufficient_scope on a write tool', async () => {
    const token = await connect('u-1', ['dossiers:read'])
    const res = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'MCP-Protocol-Version': '2025-11-25',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'update_answers', arguments: { dossier: 'biosensio', answers: [] } },
      }),
    })
    expect(res.status).toBe(403)
    const header = res.headers.get('www-authenticate') ?? ''
    expect(header).toContain('error="insufficient_scope"')
    expect(header).toContain('scope="dossiers:write"')
    expect(fake.table('dossierAnswer').size).toBe(0)
  })

  it('journals every tool call with user, client, tool, target and result', async () => {
    const c = await client(await connect('u-1', ['dossiers:write']))
    await c.callTool({ name: 'get_dossier', arguments: { dossier: 'biosensio' } })
    await c.callTool({ name: 'get_dossier', arguments: { dossier: 'autre' } })
    const logs = [...fake.table('auditLog').values()].filter(
      (l) => l.actionType === 'mcp_tool_called',
    )
    expect(logs.map((l) => (l.metadata as { result: string }).result)).toEqual(['ok', 'error'])
    // Someone else's dossier: the call is journaled without attaching it to that dossier.
    expect(logs[1].dossierId).toBeNull()
    expect(logs[0]).toMatchObject({
      actorId: 'u-1',
      dossierId: '11111111-1111-4111-8111-111111111111',
      metadata: expect.objectContaining({
        tool: 'get_dossier',
        target: 'biosensio',
        clientName: 'Claude',
      }),
    })
    await c.close()
  })

  // Code review R20: a failed call on a dossier the caller may access is in that dossier's journal.
  it('journals a failed write on an accessible dossier with that dossier', async () => {
    const c = await client(await connect('u-1', ['dossiers:write']))
    await c.callTool({
      name: 'update_answers',
      arguments: { dossier: 'biosensio', answers: [{ fieldId: 'f-stage', value: 'Série Z' }] },
    })
    await c.callTool({
      name: 'update_answers',
      arguments: { dossier: 'autre', answers: [{ fieldId: 'f-stage', value: 'Série Z' }] },
    })
    const logs = [...fake.table('auditLog').values()].filter(
      (l) => l.actionType === 'mcp_tool_called',
    )
    expect(logs.map((l) => [l.dossierId, (l.metadata as { result: string }).result])).toEqual([
      ['11111111-1111-4111-8111-111111111111', 'error'],
      [null, 'error'],
    ])
    await c.close()
  })

  // Code review R16: deactivating an account revokes its AI connections for good; reactivating it
  // does not bring the former tokens back — a new consent is needed.
  it('a deactivated then reactivated account cannot use its former OAuth tokens', async () => {
    const token = await connect('u-1', ['dossiers:read'])
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
    const admin = (action: string) =>
      fetch(`${base}/v1/admin/users/u-1/${action}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${adminJwt}` },
      })
    expect((await admin('deactivate')).status).toBe(200)
    expect((await admin('reactivate')).status).toBe(200)

    const call = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    })
    expect(call.status).toBe(401)
    const grants = [...fake.table('oAuthGrant').values()].filter((g) => g.userId === 'u-1')
    expect(grants.every((g) => g.revokedAt instanceof Date)).toBe(true)
  })

  // Code review R21: an application with several authorizations (one per device or conversation) is
  // listed once, and revoking it cuts every authorization off.
  it('connected applications: grouped by application, revoking one cuts all its connections', async () => {
    const token = await connect('u-1', ['dossiers:write'])
    const secondToken = await connect('u-1', ['dossiers:read'])
    const otherToken = await connect('u-2', ['dossiers:read'])
    const jwt = (sub: string, email: string) =>
      new JwtService().signAsync(
        { sub, email, role: 'entrepreneur' },
        { secret: process.env.JWT_SECRET },
      )
    const auth = { Authorization: `Bearer ${await jwt('u-1', 'sophie@biosensio.fr')}` }

    const c = await client(token)
    await c.callTool({ name: 'whoami', arguments: {} })
    await c.close()

    const list = (await (
      await fetch(`${base}/v1/oauth/applications`, { headers: auth })
    ).json()) as Array<{
      clientId: string
      application: { name: string }
      scopes: Array<{ scope: string }>
      connections: number
      lastUsedAt: string | null
    }>
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ clientId: 'client-claude', connections: 2 })
    expect(list[0].application.name).toBe('Claude')
    expect(list[0].scopes.map((s) => s.scope)).toEqual(['dossiers:read', 'dossiers:write'])
    expect(list[0].lastUsedAt).not.toBeNull()

    const unknown = await fetch(`${base}/v1/oauth/applications/client-inconnu`, {
      method: 'DELETE',
      headers: auth,
    })
    expect(unknown.status).toBe(404)

    const revoked = await fetch(
      `${base}/v1/oauth/applications/${encodeURIComponent('client-claude')}`,
      {
        method: 'DELETE',
        headers: auth,
      },
    )
    expect(revoked.status).toBe(204)
    for (const t of [token, secondToken]) {
      const after = await fetch(`${base}/mcp`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      })
      expect(after.status).toBe(401)
    }
    expect(await (await fetch(`${base}/v1/oauth/applications`, { headers: auth })).json()).toEqual(
      [],
    )
    // The other user's connection to the same application is untouched.
    const still = await client(otherToken)
    await expect(still.callTool({ name: 'whoami', arguments: {} })).resolves.toBeDefined()
    await still.close()
    expect(
      [...fake.table('auditLog').values()].filter((l) => l.actionType === 'oauth_grant_revoked'),
    ).toHaveLength(2)
  })
})
