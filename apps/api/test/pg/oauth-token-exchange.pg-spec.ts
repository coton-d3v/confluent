import { randomUUID } from 'node:crypto'
import type { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js'
import { AuditService } from '../../src/modules/audit/audit.service'
import { hashToken, newOpaqueToken } from '../../src/modules/oauth/oauth.constants'
import { ConfluentOAuthProvider } from '../../src/modules/oauth/oauth.provider'
import { testDatabase } from './database'

// Code review R14: consuming a code or a refresh token and issuing its successors are one
// transaction. A failure while issuing (simulated by a trigger refusing the new refresh token)
// must leave the code/token usable and no partial token behind.
describe('OAuth token exchange atomicity (PostgreSQL)', () => {
  const prisma = testDatabase()
  const config = { get: () => 'http://localhost:3000' }
  const provider = new ConfluentOAuthProvider(
    prisma,
    config as never,
    new AuditService(prisma),
    {} as never,
    {} as never,
  )
  let client: OAuthClientInformationFull
  let grantId: string

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        email: `r14-${randomUUID()}@localhost.dev`,
        role: 'entrepreneur',
        emailVerifiedAt: new Date(),
      },
    })
    const clientId = `r14-${randomUUID()}`
    await prisma.oAuthClient.create({
      data: {
        id: clientId,
        source: 'dcr',
        name: 'R14',
        redirectUris: ['https://example.org/cb'],
        metadata: {},
      },
    })
    client = {
      client_id: clientId,
      redirect_uris: ['https://example.org/cb'],
    } as OAuthClientInformationFull
    const grant = await prisma.oAuthGrant.create({
      data: {
        userId: user.id,
        clientId,
        scopes: ['dossiers:read'],
        resource: 'http://localhost:3000/mcp',
        expiresAt: new Date(Date.now() + 3600_000),
      },
    })
    grantId = grant.id
  })

  afterAll(async () => {
    await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS r14_fail ON oauth_tokens')
    await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS r14_fail()')
    await prisma.$disconnect()
  })

  // One statement per call: prepared statements accept a single command.
  const failRefreshInserts = async () => {
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION r14_fail() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'simulated failure'; END $$`)
    await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS r14_fail ON oauth_tokens')
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER r14_fail BEFORE INSERT ON oauth_tokens FOR EACH ROW
      WHEN (NEW.kind = 'refresh') EXECUTE FUNCTION r14_fail()`)
  }
  const restoreInserts = () =>
    prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS r14_fail ON oauth_tokens')

  async function newToken(kind: 'code' | 'refresh') {
    const value = newOpaqueToken(kind === 'code' ? 'cfl_code' : 'cfl_rt')
    await prisma.oAuthToken.create({
      data: {
        grantId,
        kind,
        tokenHash: hashToken(value),
        scopes: ['dossiers:read'],
        expiresAt: new Date(Date.now() + 600_000),
        ...(kind === 'code' ? { codeChallenge: 'x', redirectUri: 'https://example.org/cb' } : {}),
      },
    })
    return value
  }
  const accessTokens = () => prisma.oAuthToken.count({ where: { grantId, kind: 'access' } })

  it('a failed code exchange leaves the code usable and no access token', async () => {
    const code = await newToken('code')
    const before = await accessTokens()
    await failRefreshInserts()
    await expect(provider.exchangeAuthorizationCode(client, code)).rejects.toThrow()
    await restoreInserts()
    expect(await accessTokens()).toBe(before)
    await expect(provider.exchangeAuthorizationCode(client, code)).resolves.toMatchObject({
      token_type: 'Bearer',
    })
  })

  it('a failed refresh leaves the refresh token usable', async () => {
    const refresh = await newToken('refresh')
    await failRefreshInserts()
    await expect(provider.exchangeRefreshToken(client, refresh)).rejects.toThrow()
    await restoreInserts()
    await expect(provider.exchangeRefreshToken(client, refresh)).resolves.toMatchObject({
      token_type: 'Bearer',
    })
  })
})
