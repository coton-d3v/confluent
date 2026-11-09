import { CimdInvalidError, CimdTransientError } from './cimd/cimd-fetcher'
import {
  OAuthClientsStore,
  isAllowedRedirectUri,
  isMetadataDocumentClientId,
} from './oauth-clients.store'

// The network part (pinning, size limit, address policy) is tested in cimd/; here, what the store
// does with a fetched document or a failure.
let fetchJson: jest.Mock

const CLIENT_ID = 'https://claude.ai/oauth/mcp-oauth-client-metadata'

function store() {
  const rows = new Map<string, Record<string, unknown>>()
  const prisma = {
    oAuthClient: {
      findUnique: jest.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(rows.get(where.id) ?? null),
      ),
      update: jest.fn(({ where, data }: { where: { id: string }; data: object }) => {
        const row = { ...rows.get(where.id), ...data }
        rows.set(where.id, row)
        return Promise.resolve(row)
      }),
      upsert: jest.fn(
        ({ where, create, update }: { where: { id: string }; create: object; update: object }) => {
          const row = { ...(rows.get(where.id) ?? create), ...update, id: where.id }
          rows.set(where.id, row)
          return Promise.resolve(row)
        },
      ),
    },
  }
  // Reads `fetchJson` at call time: tests switch the simulated answer after caching.
  const current = (url: URL) => fetchJson(url) as Promise<unknown>
  return { svc: new OAuthClientsStore(prisma as never, current), rows, prisma }
}

const serve = (doc: unknown) => (fetchJson = jest.fn().mockResolvedValue(doc))
const fail = (err: Error) => (fetchJson = jest.fn().mockRejectedValue(err))
const HOURS = 60 * 60 * 1000

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
  it('fetches, validates and caches a valid document', async () => {
    serve(validDoc)
    const { svc } = store()
    const client = await svc.getClient(CLIENT_ID)
    expect(client).toMatchObject({ client_id: CLIENT_ID, client_name: 'Claude' })
    expect(fetchJson).toHaveBeenCalledWith(new URL(CLIENT_ID))
    await svc.getClient(CLIENT_ID)
    expect(fetchJson).toHaveBeenCalledTimes(1)
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

  // Code review R12: the cache only stands in for a temporary failure, and only for a while.
  async function cachedThen(ageMs: number) {
    serve(validDoc)
    const s = store()
    await s.svc.getClient(CLIENT_ID)
    s.rows.get(CLIENT_ID)!.fetchedAt = new Date(Date.now() - ageMs)
    return s.svc
  }

  it('keeps serving a recently validated document when the host is briefly down', async () => {
    const svc = await cachedThen(2 * HOURS)
    fail(new CimdTransientError('HTTP 503'))
    expect(await svc.getClient(CLIENT_ID)).toMatchObject({ client_name: 'Claude' })
  })

  it('stops serving it after the fallback period', async () => {
    const svc = await cachedThen(25 * HOURS)
    fail(new CimdTransientError('timeout'))
    expect(await svc.getClient(CLIENT_ID)).toBeUndefined()
  })

  it('never serves the cache once the document is withdrawn or invalid', async () => {
    let svc = await cachedThen(2 * HOURS)
    fail(new CimdInvalidError('HTTP 404'))
    expect(await svc.getClient(CLIENT_ID)).toBeUndefined()

    svc = await cachedThen(2 * HOURS)
    serve({ ...validDoc, client_id: 'https://other.example/meta' })
    expect(await svc.getClient(CLIENT_ID)).toBeUndefined()

    svc = await cachedThen(2 * HOURS)
    serve({ ...validDoc, redirect_uris: [] })
    expect(await svc.getClient(CLIENT_ID)).toBeUndefined()
  })

  // Recontrôle R12: a withdrawn document followed by an outage must not bring the old one back.
  it('keeps refusing after an invalid document, even when the host then fails temporarily', async () => {
    const svc = await cachedThen(2 * HOURS)
    fail(new CimdInvalidError('HTTP 404'))
    expect(await svc.getClient(CLIENT_ID)).toBeUndefined()
    fail(new CimdTransientError('HTTP 503'))
    expect(await svc.getClient(CLIENT_ID)).toBeUndefined()
    // Until a new successful validation.
    serve(validDoc)
    expect(await svc.getClient(CLIENT_ID)).toMatchObject({ client_name: 'Claude' })
    fail(new CimdTransientError('HTTP 503'))
    expect(await svc.getClient(CLIENT_ID)).toMatchObject({ client_name: 'Claude' })
  })
})
