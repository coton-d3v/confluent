import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { Injectable, Logger } from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js'
import { InvalidClientMetadataError } from '@modelcontextprotocol/sdk/server/auth/errors.js'
import type { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js'
import { PrismaService } from '../../prisma/prisma.service'

const CIMD_REFRESH_MS = 60 * 60 * 1000
const CIMD_TIMEOUT_MS = 5000
const CIMD_MAX_BYTES = 64 * 1024

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

function isPrivateAddress(address: string): boolean {
  if (isIP(address) === 6) {
    const a = address.toLowerCase()
    if (a.startsWith('::ffff:')) return isPrivateAddress(a.slice(7))
    return (
      a === '::1' || a === '::' || a.startsWith('fc') || a.startsWith('fd') || a.startsWith('fe80')
    )
  }
  const [a, b] = address.split('.').map(Number)
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  )
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

  constructor(private readonly prisma: PrismaService) {}

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
      // A previously validated document stays usable if the client's host is briefly unreachable.
      return row ? toClientInformation(row) : undefined
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

  // SSRF-conscious fetch of a Client ID Metadata Document: HTTPS only, public addresses only, no
  // redirects, bounded time and size; the document must name itself and declare its redirect URIs.
  private async fetchMetadataDocument(clientId: string): Promise<ClientRow> {
    const url = new URL(clientId)
    const addresses = isIP(url.hostname)
      ? [{ address: url.hostname }]
      : await lookup(url.hostname, { all: true })
    if (!addresses.length || addresses.some((a) => isPrivateAddress(a.address))) {
      throw new Error('metadata host resolves to a non-public address')
    }
    const res = await fetch(url, {
      redirect: 'error',
      signal: AbortSignal.timeout(CIMD_TIMEOUT_MS),
      headers: { accept: 'application/json' },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const body = await res.text()
    if (body.length > CIMD_MAX_BYTES) throw new Error('metadata document too large')
    const doc = JSON.parse(body) as Record<string, unknown>
    if (doc.client_id !== clientId) throw new Error('client_id mismatch')
    if (typeof doc.client_name !== 'string' || !doc.client_name.trim()) {
      throw new Error('client_name missing')
    }
    const redirectUris = doc.redirect_uris
    if (
      !Array.isArray(redirectUris) ||
      !redirectUris.length ||
      !redirectUris.every((u) => typeof u === 'string' && isAllowedRedirectUri(u))
    ) {
      throw new Error('redirect_uris missing or not HTTPS/loopback')
    }
    const method = (doc.token_endpoint_auth_method as string | undefined) ?? 'none'
    if (method !== 'none') throw new Error(`unsupported token_endpoint_auth_method ${method}`)
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
