import { lookup as dnsLookup } from 'node:dns/promises'
import type { IncomingMessage } from 'node:http'
import { request as httpsRequest, type RequestOptions } from 'node:https'
import { isIP, type LookupFunction } from 'node:net'
import { Writable, type Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib'
import { isPublicAddress } from './public-address'

// Fetch of a Client ID Metadata Document (MCP spec), hardened against SSRF (code review R09–R11).

// The client's host is unreachable for now (network, timeout, 429, 5xx): a document validated
// recently may still be used for a while.
export class CimdTransientError extends Error {}
// The document cannot be trusted (non-public address, redirect, 4xx, too large, not JSON, invalid
// content): it must never be served, not even from cache.
export class CimdInvalidError extends Error {}

export interface ResolvedAddress {
  address: string
  family: number
}

type Requester = (
  url: URL,
  options: RequestOptions,
  callback: (res: IncomingMessage) => void,
) => {
  on(event: 'error', listener: (err: Error) => void): unknown
  end(): unknown
  destroy(err?: Error): unknown
}

export interface CimdFetchDeps {
  resolve: (hostname: string) => Promise<ResolvedAddress[]>
  request: Requester
}

export const defaultCimdFetchDeps: CimdFetchDeps = {
  resolve: (hostname) => dnsLookup(hostname, { all: true, verbatim: true }),
  request: (url, options, callback) => httpsRequest(url, options, callback),
}

export interface CimdLimits {
  timeoutMs: number
  maxBytes: number
}

export async function fetchMetadataJson(
  url: URL,
  limits: CimdLimits,
  deps: CimdFetchDeps = defaultCimdFetchDeps,
): Promise<unknown> {
  const pinned = await resolvePublicAddress(url.hostname, deps)
  // The connection goes to the address checked above, never to a second resolution (R09);
  // TLS still checks the certificate against the hostname (SNI unchanged).
  const lookup: LookupFunction = (_hostname, options, callback) => {
    if (options.all) callback(null, [pinned])
    else callback(null, pinned.address, pinned.family)
  }
  return new Promise((resolve, reject) => {
    let settled = false
    // Settles once; on failure the request and its streams are destroyed (code review R43).
    const finish = (err: Error | null, document?: unknown) => {
      if (settled) return
      settled = true
      clearTimeout(deadline)
      if (!err) return resolve(document)
      req.destroy()
      reject(asCimdError(err))
    }
    // The deadline covers the whole exchange, body included: a host that stalls mid-body is cut.
    const deadline = setTimeout(
      () => finish(new CimdTransientError('metadata fetch timed out')),
      limits.timeoutMs,
    )
    const req = deps.request(
      url,
      {
        method: 'GET',
        lookup,
        servername: url.hostname,
        headers: { accept: 'application/json', 'accept-encoding': 'gzip, deflate, br' },
      },
      (res) => {
        readDocument(res, limits.maxBytes).then(
          (document) => finish(null, document),
          (err: Error) => finish(err),
        )
      },
    )
    req.on('error', (err) => finish(err))
    req.end()
  })
}

// A transport error (reset, truncated body, premature close) is temporary; a body that cannot be
// decoded is invalid.
function asCimdError(err: Error): Error {
  if (err instanceof CimdInvalidError || err instanceof CimdTransientError) return err
  const code = (err as NodeJS.ErrnoException).code ?? ''
  return code.startsWith('Z_')
    ? new CimdInvalidError(`unreadable body: ${err.message}`)
    : new CimdTransientError(err.message)
}

async function resolvePublicAddress(
  hostname: string,
  deps: CimdFetchDeps,
): Promise<ResolvedAddress> {
  let addresses: ResolvedAddress[]
  if (isIP(hostname)) {
    addresses = [{ address: hostname, family: isIP(hostname) }]
  } else {
    try {
      addresses = await deps.resolve(hostname)
    } catch (err) {
      throw new CimdTransientError(`DNS: ${(err as Error).message}`)
    }
  }
  // Every address must be public: a mixed answer could be used to reach a private one later.
  if (!addresses.length || addresses.some((a) => !isPublicAddress(a.address))) {
    throw new CimdInvalidError('metadata host resolves to a non-public address')
  }
  return addresses[0]
}

// Reads the body as a stream, counted after decompression and stopped as soon as it exceeds the
// limit (R11): nothing larger than `maxBytes` is ever held in memory.
function readDocument(res: IncomingMessage, maxBytes: number): Promise<unknown> {
  const status = res.statusCode ?? 0
  if (status !== 200) {
    res.resume()
    const transient = status === 429 || status >= 500
    return Promise.reject(
      transient ? new CimdTransientError(`HTTP ${status}`) : new CimdInvalidError(`HTTP ${status}`),
    )
  }
  if (Number(res.headers['content-length']) > maxBytes) {
    res.resume()
    return Promise.reject(new CimdInvalidError('metadata document too large'))
  }
  let decoder: Transform | null
  try {
    decoder = decoderFor(res)
  } catch (err) {
    return Promise.reject(err as Error)
  }
  const chunks: Buffer[] = []
  let size = 0
  const collector = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      size += chunk.length
      if (size > maxBytes) return callback(new CimdInvalidError('metadata document too large'))
      chunks.push(chunk)
      callback()
    },
  })
  // `pipeline` forwards an error or a premature close of any stage, and destroys them all: an
  // interrupted response always ends the reading (R43).
  const reading = decoder ? pipeline(res, decoder, collector) : pipeline(res, collector)
  return reading.then(() => {
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
    } catch {
      throw new CimdInvalidError('metadata document is not JSON')
    }
  })
}

function decoderFor(res: IncomingMessage): Transform | null {
  switch ((res.headers['content-encoding'] ?? '').toLowerCase()) {
    case '':
    case 'identity':
      return null
    case 'gzip':
    case 'x-gzip':
      return createGunzip()
    case 'deflate':
      return createInflate()
    case 'br':
      return createBrotliDecompress()
    default:
      res.resume()
      throw new CimdInvalidError('unsupported content-encoding')
  }
}
