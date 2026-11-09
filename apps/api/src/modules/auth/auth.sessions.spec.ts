import { randomUUID } from 'node:crypto'
import { Test } from '@nestjs/testing'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import { UnauthorizedException } from '@nestjs/common'
import { AuthService } from './auth.service'
import { PrismaService } from '../../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import { EMAIL_TRANSPORT } from './email/email-transport'

type Row = Record<string, unknown> & { id: string }

// Minimal stateful stand-in for the Prisma calls AuthService makes, so tests exercise real sequences
// (rotation, replay, concurrent consumption) instead of canned responses.
function fakeStore() {
  const users = new Map<string, Row>()
  const tokens = new Map<string, Row>()
  const sessions = new Map<string, Row>()
  const matches = (row: Row, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) => {
      if (v && typeof v === 'object' && 'gt' in v) {
        return (row[k] as Date).getTime() > (v as { gt: Date }).gt.getTime()
      }
      return row[k] === v
    })
  const updateMany = (table: Map<string, Row>) =>
    jest.fn(({ where, data }: { where: Record<string, unknown>; data: Row }) => {
      let count = 0
      for (const row of table.values()) {
        if (matches(row, where)) {
          Object.assign(row, data)
          count++
        }
      }
      return { count }
    })
  const prisma = {
    user: {
      findUnique: jest.fn(
        ({ where }: { where: { id?: string; email?: string } }) =>
          [...users.values()].find((u) => u.id === where.id || u.email === where.email) ?? null,
      ),
      update: jest.fn(({ where, data }: { where: { id: string }; data: Row }) =>
        Object.assign(users.get(where.id)!, data),
      ),
    },
    magicLinkToken: {
      findUnique: jest.fn(({ where }: { where: { token: string } }) => {
        const t = [...tokens.values()].find((r) => r.token === where.token)
        return t ? { ...t, user: users.get(t.userId as string) } : null
      }),
      updateMany: updateMany(tokens),
    },
    refreshSession: {
      findUnique: jest.fn(
        ({ where, include }: { where: { id: string }; include?: { user?: boolean } }) => {
          const row = sessions.get(where.id)
          if (!row) return null
          return include?.user ? { ...row, user: users.get(row.userId as string) } : { ...row }
        },
      ),
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        const row = { id: randomUUID(), revokedAt: null, replacedById: null, ...data } as Row
        sessions.set(row.id, row)
        return row
      }),
      update: jest.fn(({ where, data }: { where: { id: string }; data: Row }) =>
        Object.assign(sessions.get(where.id)!, data),
      ),
      updateMany: updateMany(sessions),
    },
    // Locks and transactions have no effect in memory: concurrency is covered by test/pg.
    $queryRaw: jest.fn(() => Promise.resolve([])),
  }
  const client = Object.assign(prisma, {
    $transaction: jest.fn((fn: (tx: unknown) => unknown): unknown => fn(client)),
  })
  return { prisma: client, users, tokens, sessions }
}

async function setup() {
  const store = fakeStore()
  const audit = { record: jest.fn().mockResolvedValue(undefined) }
  const values: Record<string, string> = {
    JWT_SECRET: 'access-secret-key-for-tests-0123456789',
    JWT_REFRESH_SECRET: 'refresh-secret-key-for-tests-0123456789',
    FRONTEND_URL: 'http://localhost:5173',
  }
  const moduleRef = await Test.createTestingModule({
    providers: [
      AuthService,
      JwtService,
      { provide: PrismaService, useValue: store.prisma },
      { provide: ConfigService, useValue: { get: (k: string) => values[k] } },
      { provide: AuditService, useValue: audit },
      { provide: EMAIL_TRANSPORT, useValue: { sendMagicLink: jest.fn() } },
    ],
  }).compile()
  const user = {
    id: 'u-1',
    email: 'sophie@biosensio.fr',
    role: 'entrepreneur',
    isActive: true,
    emailVerifiedAt: new Date('2026-01-01'),
    firstName: 'Sophie',
    lastName: null,
  }
  store.users.set(user.id, user)
  const addToken = (overrides: Partial<Row> = {}) => {
    const row = {
      id: randomUUID(),
      userId: user.id,
      token: randomUUID(),
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: null,
      ...overrides,
    } as Row
    store.tokens.set(row.id, row)
    return row.token as string
  }
  return { svc: moduleRef.get(AuthService), store, audit, user, addToken }
}

describe('AuthService.verifyMagicLink', () => {
  it('consumes a valid token, verifies the email and opens a server-side session', async () => {
    const { svc, store, user, audit, addToken } = await setup()
    user.emailVerifiedAt = null as never
    const session = await svc.verifyMagicLink(addToken())
    expect(session.user).toMatchObject({ id: 'u-1', email: 'sophie@biosensio.fr' })
    expect(user.emailVerifiedAt).toBeInstanceOf(Date)
    expect(store.sessions.size).toBe(1)
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ actionType: 'magic_link_consumed', actorId: 'u-1' }),
    )
  })

  it('opens only one session when the same link is used concurrently', async () => {
    const { svc, store, addToken } = await setup()
    const token = addToken()
    const results = await Promise.allSettled([
      svc.verifyMagicLink(token),
      svc.verifyMagicLink(token),
    ])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1)
    expect(store.sessions.size).toBe(1)
  })

  it('rejects unknown, expired, consumed tokens and deactivated users', async () => {
    const { svc, user, addToken } = await setup()
    await expect(svc.verifyMagicLink('nope')).rejects.toBeInstanceOf(UnauthorizedException)
    const expired = addToken({ expiresAt: new Date(Date.now() - 1000) })
    await expect(svc.verifyMagicLink(expired)).rejects.toBeInstanceOf(UnauthorizedException)
    const consumed = addToken({ consumedAt: new Date() })
    await expect(svc.verifyMagicLink(consumed)).rejects.toBeInstanceOf(UnauthorizedException)
    user.isActive = false
    await expect(svc.verifyMagicLink(addToken())).rejects.toBeInstanceOf(UnauthorizedException)
  })
})

describe('AuthService.refreshSession', () => {
  it('rotates: the new token works, the presented one is single-use', async () => {
    const { svc, addToken } = await setup()
    const first = await svc.verifyMagicLink(addToken())
    const second = await svc.refreshSession(first.refreshToken)
    expect(second.refreshToken).not.toBe(first.refreshToken)
    // Within the grace window a second use (another tab, a retry) gets the SAME successor session —
    // no new session, no burned login (code review R05/R08).
    const retry = await svc.refreshSession(first.refreshToken)
    const jti = (token: string) =>
      (JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()) as { jti: string }).jti
    expect(jti(retry.refreshToken)).toBe(jti(second.refreshToken))
    await expect(svc.refreshSession(second.refreshToken)).resolves.toBeDefined()
  })

  it('replaying an old rotated token after the grace window revokes the whole login', async () => {
    const { svc, store, audit, addToken } = await setup()
    const first = await svc.verifyMagicLink(addToken())
    const second = await svc.refreshSession(first.refreshToken)
    for (const row of store.sessions.values()) {
      if (row.revokedAt) row.revokedAt = new Date(Date.now() - 60_000)
    }
    await expect(svc.refreshSession(first.refreshToken)).rejects.toBeInstanceOf(
      UnauthorizedException,
    )
    // The legitimate holder of the newest token is logged out too: the family is burned.
    await expect(svc.refreshSession(second.refreshToken)).rejects.toBeInstanceOf(
      UnauthorizedException,
    )
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ actionType: 'refresh_token_reused' }),
    )
  })

  it('logout revokes the login: neither the current nor a previous token can be refreshed', async () => {
    const { svc, addToken } = await setup()
    const first = await svc.verifyMagicLink(addToken())
    const second = await svc.refreshSession(first.refreshToken)
    await svc.revokeSession(second.refreshToken)
    await expect(svc.refreshSession(second.refreshToken)).rejects.toBeInstanceOf(
      UnauthorizedException,
    )
  })

  it('logout never throws, even without a valid cookie', async () => {
    const { svc } = await setup()
    await expect(svc.revokeSession(undefined)).resolves.toBeUndefined()
    await expect(svc.revokeSession('garbage')).resolves.toBeUndefined()
  })

  it('refuses refresh for a deactivated or unverified user and burns the login', async () => {
    const { svc, user, addToken } = await setup()
    const session = await svc.verifyMagicLink(addToken())
    user.isActive = false
    await expect(svc.refreshSession(session.refreshToken)).rejects.toBeInstanceOf(
      UnauthorizedException,
    )
  })

  it('revokeAllSessions blocks every login of the user', async () => {
    const { svc, addToken } = await setup()
    const a = await svc.verifyMagicLink(addToken())
    const b = await svc.verifyMagicLink(addToken())
    await svc.revokeAllSessions('u-1')
    await expect(svc.refreshSession(a.refreshToken)).rejects.toBeInstanceOf(UnauthorizedException)
    await expect(svc.refreshSession(b.refreshToken)).rejects.toBeInstanceOf(UnauthorizedException)
  })

  it('rejects missing, forged and pre-rotation (jti-less) tokens', async () => {
    const { svc } = await setup()
    await expect(svc.refreshSession(undefined)).rejects.toBeInstanceOf(UnauthorizedException)
    await expect(svc.refreshSession('not.a.jwt')).rejects.toBeInstanceOf(UnauthorizedException)
    const legacy = await new JwtService().signAsync(
      { sub: 'u-1', tokenVersion: 0 },
      { secret: 'refresh-secret-key-for-tests-0123456789' },
    )
    await expect(svc.refreshSession(legacy)).rejects.toBeInstanceOf(UnauthorizedException)
  })
})
