import { Inject, Injectable, Logger } from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js'
import { InvalidClientMetadataError } from '@modelcontextprotocol/sdk/server/auth/errors.js'
import type { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js'
import { PrismaService } from '../../prisma/prisma.service'
import { CimdInvalidError, CimdTransientError, fetchMetadataJson } from './cimd/cimd-fetcher'

const CIMD_REFRESH_MS = 60 * 60 * 1000
// Beyond this age, a document is not served any more, even while its host is unreachable (R12).
const CIMD_FALLBACK_MAX_MS = 24 * 60 * 60 * 1000
const CIMD_LIMITS = { timeoutMs: 5000, maxBytes: 64 * 1024 }

// Fetches a Client ID Metadata Document as JSON (pinned, size-limited: cimd/cimd-fetcher.ts).
export type CimdFetch = (url: URL) => Promise<unknown>
export const CIMD_FETCH = Symbol('CIMD_FETCH')
export const defaultCimdFetch: CimdFetch = (url) => fetchMetadataJson(url, CIMD_LIMITS)

// MCP spec: redirect URIs MUST be HTTPS or loopback.
export function isAllowedRedirectUri(uri: string): boolean {
  try {
    const url = new URL(uri)
    if (url.hash) return false
    if (url.protocol === 'https:') return true
    return (
      url.protocol === 'http:' &&
      (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]')
    )
  } catch {
    return false
  }
}

// A CIMD client_id is an HTTPS URL with a path (MCP spec, Client ID Metadata Documents).
export function isMetadataDocumentClientId(clientId: string): boolean {
  try {
    const url = new URL(clientId)
    return url.protocol === 'https:' && url.pathname !== '/' && !url.hash && !url.username
  } catch {
    return false
  }
}

type ClientRow = Prisma.OAuthClientGetPayload<object>

function toClientInformation(row: ClientRow): OAuthClientInformationFull {
  const metadata = row.metadata as Record<string, unknown>
  return {
    ...metadata,
    client_id: row.id,
    client_name: row.name,
    redirect_uris: row.redirectUris,
    token_endpoint_auth_method: row.tokenEndpointAuthMethod,
    ...(row.clientSecret ? { client_secret: row.clientSecret } : {}),
  } as OAuthClientInformationFull
}

@Injectable()
export class OAuthClientsStore implements OAuthRegisteredClientsStore {
  private readonly logger = new Logger(OAuthClientsStore.name)

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CIMD_FETCH) private readonly fetchJson: CimdFetch,
  ) {}

  async getClient(clientId: string): Promise<OAuthClientInformationFull | undefined> {
    const row = await this.prisma.oAuthClient.findUnique({ where: { id: clientId } })
    if (row?.source === 'dcr') return toClientInformation(row)
    if (!isMetadataDocumentClientId(clientId)) return undefined
    if (row && row.fetchedAt && Date.now() - row.fetchedAt.getTime() < CIMD_REFRESH_MS) {
      return toClientInformation(row)
    }
    try {
      return toClientInformation(await this.fetchMetadataDocument(clientId))
    } catch (err) {
      this.logger.warn(`CIMD fetch failed for ${clientId}: ${(err as Error).message}`)
      // A withdrawn or invalid document (404, other identity, bad content) invalidates the cache
      // durably: a later outage must not bring the old document back (R12). Only a new successful
      // validation makes the client usable again.
      if (err instanceof CimdInvalidError && row?.fetchedAt) {
        await this.prisma.oAuthClient.update({ where: { id: clientId }, data: { fetchedAt: null } })
        return undefined
      }
      // Only a temporary failure lets a recently validated document stand in, for a bounded time.
      const fallback =
        err instanceof CimdTransientError &&
        row?.fetchedAt &&
        Date.now() - row.fetchedAt.getTime() < CIMD_FALLBACK_MAX_MS
      return fallback ? toClientInformation(row) : undefined
    }
  }

  async registerClient(
    client: Omit<OAuthClientInformationFull, 'client_id' | 'client_id_issued_at'> &
      Partial<Pick<OAuthClientInformationFull, 'client_id' | 'client_id_issued_at'>>,
  ): Promise<OAuthClientInformationFull> {
    if (!client.client_id) throw new InvalidClientMetadataError('client_id generation failed')
    if (!client.redirect_uris.length || !client.redirect_uris.every(isAllowedRedirectUri)) {
      throw new InvalidClientMetadataError('redirect_uris must be HTTPS or loopback URLs')
    }
    const { client_secret: clientSecret, ...metadata } = client
    const row = await this.prisma.oAuthClient.create({
      data: {
        id: client.client_id,
        source: 'dcr',
        name: (client.client_name ?? 'Application sans nom').slice(0, 200),
        redirectUris: client.redirect_uris,
        tokenEndpointAuthMethod: client.token_endpoint_auth_method ?? 'client_secret_post',
        clientSecret: clientSecret ?? null,
        metadata: metadata as Prisma.InputJsonValue,
      },
    })
    return { ...toClientInformation(row), client_id_issued_at: client.client_id_issued_at }
  }

  // Fetch (SSRF-hardened, see cimd/) then validation: the document must name itself and declare
  // HTTPS/loopback redirect URIs for a public client.
  private async fetchMetadataDocument(clientId: string): Promise<ClientRow> {
    const raw = await this.fetchJson(new URL(clientId))
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new CimdInvalidError('metadata document is not a JSON object')
    }
    const doc = raw as Record<string, unknown>
    if (doc.client_id !== clientId) throw new CimdInvalidError('client_id mismatch')
    if (typeof doc.client_name !== 'string' || !doc.client_name.trim()) {
      throw new CimdInvalidError('client_name missing')
    }
    const redirectUris = doc.redirect_uris
    if (
      !Array.isArray(redirectUris) ||
      !redirectUris.length ||
      !redirectUris.every((u) => typeof u === 'string' && isAllowedRedirectUri(u))
    ) {
      throw new CimdInvalidError('redirect_uris missing or not HTTPS/loopback')
    }
    const method = (doc.token_endpoint_auth_method as string | undefined) ?? 'none'
    if (method !== 'none')
      throw new CimdInvalidError(`unsupported token_endpoint_auth_method ${method}`)
    const data = {
      source: 'cimd',
      name: doc.client_name.slice(0, 200),
      redirectUris: redirectUris as string[],
      tokenEndpointAuthMethod: 'none',
      clientSecret: null,
      metadata: doc as Prisma.InputJsonValue,
      fetchedAt: new Date(),
    }
    return this.prisma.oAuthClient.upsert({
      where: { id: clientId },
      create: { id: clientId, ...data },
      update: data,
    })
  }
}
