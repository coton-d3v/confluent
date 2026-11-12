import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { ZodValidationPipe } from 'nestjs-zod'
import { AppModule } from './../src/app.module'
import { GlobalExceptionFilter } from './../src/common/filters/global-exception.filter'
import { PrismaService } from './../src/prisma/prisma.service'
import { EMAIL_TRANSPORT } from './../src/modules/auth/email/email-transport'
import {
  STORAGE_TOKEN,
  type StorageAdapter,
} from './../src/modules/documents/storage/storage.adapter'
import { uploadSlots } from './../src/modules/documents/upload-slots.interceptor'
import { createFakePrisma } from '../src/testing/fake-prisma'

// ROADMAP E10.08 (U10), review R76: an upload keeps its slot until nothing holds its file any more —
// a client that leaves after sending it neither stops its handling nor frees its buffer, so the
// accounts' (3) and the process's (8) bounds count it until its storage ends. On a real HTTP server
// with real multipart bodies, the storage held back.
describe('Upload slots until the end of the handling (e2e, real HTTP)', () => {
  let app: INestApplication
  let port = 0
  let fake: ReturnType<typeof createFakePrisma>
  const tokens = new Map<string, string>()
  // The storage holds every upload until `open()`.
  let active = 0
  let gate: Promise<void>
  let open = () => {}
  const storage: StorageAdapter = {
    upload: async () => {
      active++
      try {
        await gate
      } finally {
        active--
      }
    },
    getSignedUrl: async (key: string) => `memory://${key}`,
    read: async () => Buffer.alloc(0),
    exists: async () => true,
    delete: async () => undefined,
    check: async () => undefined,
  } as unknown as StorageAdapter
  const ACCOUNTS = ['a', 'b', 'c', 'd', 'e']
  const clients: http.ClientRequest[] = []

  beforeAll(async () => {
    gate = new Promise((resolve) => (open = resolve))
    fake = createFakePrisma()
    for (const name of ACCOUNTS) {
      await fake.prisma.user.create({
        data: {
          id: `u-${name}`,
          email: `${name}@slots.test`,
          role: 'entrepreneur',
          emailVerifiedAt: new Date(),
        },
      })
      await fake.prisma.company.create({
        data: { id: `c-${name}`, ownerId: `u-${name}`, name, profileVersionId: 'v-1' },
      })
      await fake.prisma.dossier.create({
        data: {
          id: `d-${name}`,
          userId: `u-${name}`,
          companyId: `c-${name}`,
          name,
          slug: `slots-${name}`,
          questionnaireVersionId: 'v-1',
        },
      })
      tokens.set(
        name,
        await new JwtService().signAsync(
          { sub: `u-${name}`, email: `${name}@slots.test`, role: 'entrepreneur' },
          { secret: process.env.JWT_SECRET },
        ),
      )
    }
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(fake.prisma)
      .overrideProvider(EMAIL_TRANSPORT)
      .useValue({ sendMagicLink: jest.fn(), sendShareInvite: jest.fn() })
      .overrideProvider(STORAGE_TOKEN)
      .useValue(storage)
      .compile()
    app = moduleFixture.createNestApplication()
    app.setGlobalPrefix('v1', { exclude: ['/'] })
    app.useGlobalPipes(new ZodValidationPipe())
    app.useGlobalFilters(new GlobalExceptionFilter())
    await app.listen(0)
    port = (app.getHttpServer().address() as AddressInfo).port
  })

  afterAll(async () => {
    open()
    for (const c of clients) c.destroy()
    await app.close()
  })

  const BOUNDARY = 'slots-boundary'
  const multipart = (filename: string) =>
    Buffer.concat([
      Buffer.from(
        `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
          'Content-Type: application/pdf\r\n\r\n%PDF-1.4 slots ',
      ),
      Buffer.alloc(64 * 1024, 32),
      Buffer.from(`\r\n--${BOUNDARY}--\r\n`),
    ])

  // One upload of `account`, the whole multipart sent; its status, or null if it got no answer.
  function upload(account: string, filename: string) {
    const body = multipart(filename)
    let request!: http.ClientRequest
    const status = new Promise<number | null>((resolve) => {
      request = http.request(
        {
          port,
          method: 'POST',
          path: `/v1/dossiers/d-${account}/documents`,
          headers: {
            Authorization: `Bearer ${tokens.get(account)}`,
            'Content-Type': `multipart/form-data; boundary=${BOUNDARY}`,
            'Content-Length': body.length,
          },
        },
        (res) => {
          res.resume()
          resolve(res.statusCode ?? null)
        },
      )
      request.on('error', () => resolve(null))
      request.end(body)
    })
    clients.push(request)
    return { request, status }
  }

  async function until(condition: () => boolean, what: string) {
    for (let i = 0; i < 200 && !condition(); i++) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    if (!condition()) throw new Error(`timed out: ${what}`)
  }
  const settle = () => new Promise((resolve) => setTimeout(resolve, 150))

  it('counts the uploads of clients gone after sending them until their storage ends', async () => {
    // Account a: three files received, held by the storage, then its clients leave.
    const first = [1, 2, 3].map((i) => upload('a', `a-${i}.pdf`))
    await until(() => active === 3, 'three uploads at the storage')
    expect(uploadSlots.inFlight).toBe(3)
    for (const { request } of first) request.destroy()
    await settle()
    expect(active).toBe(3)
    expect(uploadSlots.inFlight).toBe(3)

    // Their files are still held: a 4th upload of the account is refused, without reaching storage.
    expect(await upload('a', 'a-4.pdf').status).toBe(429)
    expect(active).toBe(3)

    // The process's bound counts them too: 3 (a, gone) + 3 (b) + 2 (c) = 8, then d is refused.
    const others = [
      ...[1, 2, 3].map((i) => upload('b', `b-${i}.pdf`)),
      ...[1, 2].map((i) => upload('c', `c-${i}.pdf`)),
    ]
    await until(() => active === 8, 'eight uploads at the storage')
    expect(uploadSlots.inFlight).toBe(8)
    for (const { request } of others) request.destroy()
    await settle()
    expect(await upload('d', 'd-1.pdf').status).toBe(429)
    expect(active).toBe(8)
    expect(uploadSlots.inFlight).toBe(8)

    // The storage ends: every slot comes back, and the accounts upload again.
    open()
    await until(() => active === 0 && uploadSlots.inFlight === 0, 'every slot back')
    expect(await upload('a', 'a-5.pdf').status).toBe(201)
    expect(await upload('d', 'd-2.pdf').status).toBe(201)
    await until(() => uploadSlots.inFlight === 0, 'slots of the last uploads back')
  })

  it('gives the slot back when the client leaves before its multipart is received', async () => {
    const body = multipart('e-1.pdf')
    const request = http.request({
      port,
      method: 'POST',
      path: '/v1/dossiers/d-e/documents',
      headers: {
        Authorization: `Bearer ${tokens.get('e')}`,
        'Content-Type': `multipart/form-data; boundary=${BOUNDARY}`,
        'Content-Length': body.length,
      },
    })
    request.on('error', () => undefined)
    clients.push(request)
    request.write(body.subarray(0, 1024))
    await until(() => uploadSlots.inFlight === 1, 'the slot taken')
    request.destroy()
    await until(() => uploadSlots.inFlight === 0, 'the slot back')
    expect(active).toBe(0)
  })
})
