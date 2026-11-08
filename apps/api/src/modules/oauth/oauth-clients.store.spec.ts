import { lookup } from 'node:dns/promises'
import {
  OAuthClientsStore,
  isAllowedRedirectUri,
  isMetadataDocumentClientId,
} from './oauth-clients.store'

jest.mock('node:dns/promises', () => ({ lookup: jest.fn() }))

const CLIENT_ID = 'https://claude.ai/oauth/mcp-oauth-client-metadata'

function store() {
  const rows = new Map<string, Record<string, unknown>>()
  const prisma = {
    oAuthClient: {
      findUnique: jest.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(rows.get(where.id) ?? null),
      ),
      upsert: jest.fn(
        ({ where, create, update }: { where: { id: string }; create: object; update: object }) => {
          const row = { ...(rows.get(where.id) ?? create), ...update, id: where.id }
          rows.set(where.id, row)
          return Promise.resolve(row)
        },
      ),
    },
  }
  return { svc: new OAuthClientsStore(prisma as never), rows, prisma }
}

function serve(doc: unknown, status = 200) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: status < 400,
    status,
    text: () => Promise.resolve(JSON.stringify(doc)),
  }) as never
}

const validDoc = {
  client_id: CLIENT_ID,
  client_name: 'Claude',
  redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
  token_endpoint_auth_method: 'none',
}

describe('redirect / client_id rules', () => {
  it('only allows HTTPS or loopback redirect URIs', () => {
    expect(isAllowedRedirectUri('https://chatgpt.com/connector_platform_oauth_redirect')).toBe(true)
    expect(isAllowedRedirectUri('http://localhost:6274/callback')).toBe(true)
    expect(isAllowedRedirectUri('http://example.com/cb')).toBe(false)
    expect(isAllowedRedirectUri('https://x.example/cb#frag')).toBe(false)
  })

  it('treats HTTPS URLs with a path as metadata-document client ids', () => {
    expect(isMetadataDocumentClientId(CLIENT_ID)).toBe(true)
    expect(isMetadataDocumentClientId('https://claude.ai/')).toBe(false)
    expect(isMetadataDocumentClientId('3f2b9c1e-uuid')).toBe(false)
  })
})

describe('OAuthClientsStore — Client ID Metadata Documents', () => {
  beforeEach(() => {
    ;(lookup as jest.Mock).mockResolvedValue([{ address: '160.79.104.10', family: 4 }])
  })

  it('fetches, validates and caches a valid document', async () => {
    serve(validDoc)
    const { svc } = store()
    const client = await svc.getClient(CLIENT_ID)
    expect(client).toMatchObject({ client_id: CLIENT_ID, client_name: 'Claude' })
    expect(global.fetch).toHaveBeenCalledWith(
      new URL(CLIENT_ID),
      expect.objectContaining({ redirect: 'error' }),
    )
    await svc.getClient(CLIENT_ID)
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })

  it('rejects a document that does not name itself', async () => {
    serve({ ...validDoc, client_id: 'https://evil.example/meta' })
    expect(await store().svc.getClient(CLIENT_ID)).toBeUndefined()
  })

  it('rejects non-HTTPS redirect URIs and confidential auth methods', async () => {
    serve({ ...validDoc, redirect_uris: ['http://evil.example/cb'] })
    expect(await store().svc.getClient(CLIENT_ID)).toBeUndefined()
    serve({ ...validDoc, token_endpoint_auth_method: 'private_key_jwt' })
    expect(await store().svc.getClient(CLIENT_ID)).toBeUndefined()
  })

  it('never fetches a host that resolves to a private address (SSRF)', async () => {
    ;(lookup as jest.Mock).mockResolvedValue([{ address: '10.0.0.5', family: 4 }])
    serve(validDoc)
    expect(await store().svc.getClient(CLIENT_ID)).toBeUndefined()
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('keeps serving the last validated document when the host is briefly down', async () => {
    serve(validDoc)
    const { svc, rows } = store()
    await svc.getClient(CLIENT_ID)
    rows.get(CLIENT_ID)!.fetchedAt = new Date(Date.now() - 2 * 60 * 60 * 1000)
    serve({}, 503)
    expect(await svc.getClient(CLIENT_ID)).toMatchObject({ client_name: 'Claude' })
  })
})
