import { createServer, request as httpRequest, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { gzipSync } from 'node:zlib'
import {
  CimdInvalidError,
  CimdTransientError,
  fetchMetadataJson,
  type CimdFetchDeps,
  type ResolvedAddress,
} from './cimd-fetcher'

// A local HTTP server stands for the client's host; the injected transport connects to it through
// the `lookup` the fetcher gives, which must be the pinned, validated address.
const LIMITS = { timeoutMs: 2000, maxBytes: 64 * 1024 }
const URL_ = new URL('https://client.example/metadata.json')

describe('fetchMetadataJson (code review R09, R11)', () => {
  let server: Server
  let port: number
  let respond: (res: import('node:http').ServerResponse) => void

  beforeAll(async () => {
    server = createServer((_req, res) => respond(res))
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    port = (server.address() as AddressInfo).port
  })
  afterAll(() => new Promise<void>((r) => server.close(() => r())))

  function deps(answers: ResolvedAddress[][]) {
    const resolve = jest.fn(() => Promise.resolve(answers.shift() ?? []))
    const connectedTo: string[] = []
    const request: CimdFetchDeps['request'] = (_url, options, callback) => {
      // What the socket would connect to: the fetcher's lookup, never a fresh DNS query.
      ;(options.lookup as (h: string, o: object, cb: (e: null, a: string) => void) => void)(
        'client.example',
        {},
        (_e, address) => connectedTo.push(address),
      )
      return httpRequest(
        { host: '127.0.0.1', port, path: '/metadata.json', signal: options.signal },
        callback,
      )
    }
    return { deps: { resolve, request }, resolve, connectedTo }
  }

  it('connects to the address validated once, even if DNS would now answer a private one (R09)', async () => {
    respond = (res) => res.end(JSON.stringify({ client_id: 'x' }))
    const d = deps([
      [{ address: '93.184.216.34', family: 4 }],
      [{ address: '127.0.0.1', family: 4 }],
    ])
    await expect(fetchMetadataJson(URL_, LIMITS, d.deps)).resolves.toEqual({ client_id: 'x' })
    expect(d.resolve).toHaveBeenCalledTimes(1)
    expect(d.connectedTo).toEqual(['93.184.216.34'])
  })

  it('refuses a host resolving to a private address, without connecting', async () => {
    const d = deps([
      [
        { address: '93.184.216.34', family: 4 },
        { address: '::ffff:7f00:1', family: 6 },
      ],
    ])
    await expect(fetchMetadataJson(URL_, LIMITS, d.deps)).rejects.toBeInstanceOf(CimdInvalidError)
    expect(d.connectedTo).toEqual([])
  })

  it('stops a chunked body without Content-Length as soon as it exceeds the limit (R11)', async () => {
    let written = 0
    respond = (res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      const timer = setInterval(() => {
        if (res.destroyed || written > 10 * 1024 * 1024) return clearInterval(timer)
        written += 16 * 1024
        res.write('x'.repeat(16 * 1024))
      }, 1)
      res.on('close', () => clearInterval(timer))
    }
    const d = deps([[{ address: '93.184.216.34', family: 4 }]])
    await expect(fetchMetadataJson(URL_, LIMITS, d.deps)).rejects.toThrow('too large')
    expect(written).toBeLessThan(2 * 1024 * 1024)
  })

  it('counts the decompressed size of a compressed body (R11)', async () => {
    respond = (res) => {
      res.writeHead(200, { 'content-encoding': 'gzip' })
      res.end(gzipSync(JSON.stringify({ padding: 'x'.repeat(200 * 1024) })))
    }
    const d = deps([[{ address: '93.184.216.34', family: 4 }]])
    await expect(fetchMetadataJson(URL_, LIMITS, d.deps)).rejects.toThrow('too large')
  })

  it('reads a compressed document within the limit', async () => {
    respond = (res) => {
      res.writeHead(200, { 'content-encoding': 'gzip' })
      res.end(gzipSync(JSON.stringify({ client_id: 'ok' })))
    }
    const d = deps([[{ address: '93.184.216.34', family: 4 }]])
    await expect(fetchMetadataJson(URL_, LIMITS, d.deps)).resolves.toEqual({ client_id: 'ok' })
  })

  it('tells a temporary failure from an invalid document', async () => {
    const d = () => deps([[{ address: '93.184.216.34', family: 4 }]]).deps
    respond = (res) => res.writeHead(503).end()
    await expect(fetchMetadataJson(URL_, LIMITS, d())).rejects.toBeInstanceOf(CimdTransientError)
    respond = (res) => res.writeHead(404).end()
    await expect(fetchMetadataJson(URL_, LIMITS, d())).rejects.toBeInstanceOf(CimdInvalidError)
    respond = (res) => res.writeHead(302, { location: 'http://169.254.169.254/' }).end()
    await expect(fetchMetadataJson(URL_, LIMITS, d())).rejects.toBeInstanceOf(CimdInvalidError)
    respond = (res) => res.end('pas du json')
    await expect(fetchMetadataJson(URL_, LIMITS, d())).rejects.toBeInstanceOf(CimdInvalidError)
  })

  // Code review R43: an interrupted or stalled body must end the fetch, never leave it pending.
  describe('interrupted body (R43)', () => {
    const SHORT = { timeoutMs: 400, maxBytes: 64 * 1024 }
    const one = () => deps([[{ address: '93.184.216.34', family: 4 }]]).deps
    // Settles within `ms`, or reports « pending ».
    const within = (promise: Promise<unknown>, ms = 2500) =>
      Promise.race([
        promise.then(
          () => 'resolved',
          (err: Error) => err,
        ),
        new Promise((r) => setTimeout(() => r('pending'), ms)),
      ])
    const gzipped = gzipSync(JSON.stringify({ client_id: 'x', padding: 'y'.repeat(4000) }))

    it('rejects a compressed body cut after a fragment, as a temporary failure', async () => {
      respond = (res) => {
        res.writeHead(200, { 'content-encoding': 'gzip', 'content-length': gzipped.length })
        res.write(gzipped.subarray(0, 20))
        setTimeout(() => res.socket?.destroy(), 20)
      }
      expect(await within(fetchMetadataJson(URL_, SHORT, one()))).toBeInstanceOf(CimdTransientError)
    })

    it('rejects a plain body cut before its announced length', async () => {
      respond = (res) => {
        res.writeHead(200, { 'content-length': 1000 })
        res.write('{"client_id":')
        setTimeout(() => res.socket?.destroy(), 20)
      }
      expect(await within(fetchMetadataJson(URL_, SHORT, one()))).toBeInstanceOf(CimdTransientError)
    })

    it('rejects a reset right after the headers', async () => {
      respond = (res) => {
        res.writeHead(200, { 'content-encoding': 'gzip' })
        res.flushHeaders()
        setTimeout(() => res.socket?.destroy(), 20)
      }
      expect(await within(fetchMetadataJson(URL_, SHORT, one()))).toBeInstanceOf(CimdTransientError)
    })

    it('applies the deadline to the whole body and closes the connection', async () => {
      let closed = false
      respond = (res) => {
        res.writeHead(200, { 'content-encoding': 'gzip' })
        res.write(gzipped.subarray(0, 20))
        res.on('close', () => (closed = true))
      }
      const started = Date.now()
      const outcome = await within(fetchMetadataJson(URL_, SHORT, one()))
      expect(outcome).toBeInstanceOf(CimdTransientError)
      expect(Date.now() - started).toBeLessThan(1500)
      await new Promise((r) => setTimeout(r, 100))
      expect(closed).toBe(true)
    })

    it('rejects a compressed body that is corrupt as invalid', async () => {
      respond = (res) => {
        res.writeHead(200, { 'content-encoding': 'gzip' })
        res.end(Buffer.from('ceci n’est pas du gzip'))
      }
      expect(await within(fetchMetadataJson(URL_, SHORT, one()))).toBeInstanceOf(CimdInvalidError)
    })
  })
})
