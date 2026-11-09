import { randomUUID } from 'node:crypto'
import { JwtService } from '@nestjs/jwt'
import { AuditService } from '../../src/modules/audit/audit.service'
import { AuthService } from '../../src/modules/auth/auth.service'
import { testDatabase } from './database'

// Code review R07/R08: rotation, logout and replays of a web session are serialized. A trigger
// slows down the creation of the successor session, so that the concurrent operation lands exactly
// between "token spent" and "successor created".
describe('web sessions under concurrency (PostgreSQL)', () => {
  const prisma = testDatabase()
  const secrets: Record<string, string> = {
    JWT_SECRET: 'access-secret-key-for-tests-0123456789',
    JWT_REFRESH_SECRET: 'refresh-secret-key-for-tests-0123456789',
    FRONTEND_URL: 'http://localhost:5173',
  }
  const auth = new AuthService(
    prisma,
    { get: (k: string) => secrets[k] } as never,
    new JwtService(),
    {} as never,
    new AuditService(prisma),
  )

  afterAll(async () => {
    await slowInserts(false)
    await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS r07_slow()')
    await prisma.$disconnect()
  })

  async function slowInserts(on: boolean) {
    await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS r07_slow ON refresh_sessions')
    if (!on) return
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION r07_slow() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN PERFORM pg_sleep(0.4); RETURN NEW; END $$`)
    await prisma.$executeRawUnsafe(
      'CREATE TRIGGER r07_slow BEFORE INSERT ON refresh_sessions FOR EACH ROW EXECUTE FUNCTION r07_slow()',
    )
  }

  async function signedIn() {
    const user = await prisma.user.create({
      data: {
        email: `r07-${randomUUID()}@localhost.dev`,
        role: 'entrepreneur',
        emailVerifiedAt: new Date(),
      },
    })
    const token = randomUUID()
    await prisma.magicLinkToken.create({
      data: { userId: user.id, token, expiresAt: new Date(Date.now() + 600_000) },
    })
    return { user, session: await auth.verifyMagicLink(token) }
  }
  const activeSessions = (userId: string) =>
    prisma.refreshSession.count({ where: { userId, revokedAt: null } })
  const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

  it('a logout during a rotation leaves no usable successor (R07)', async () => {
    const { user, session } = await signedIn()
    await slowInserts(true)
    const rotation = auth.refreshSession(session.refreshToken).catch(() => null)
    await pause(150) // the rotation has spent the token and is creating the successor
    await auth.revokeSession(session.refreshToken)
    const rotated = await rotation
    await slowInserts(false)
    expect(await activeSessions(user.id)).toBe(0)
    if (rotated) {
      await expect(auth.refreshSession(rotated.refreshToken)).rejects.toThrow()
    }
  })

  it('two concurrent refreshes of the same token share one successor and keep the login (R08, R05)', async () => {
    const { user, session } = await signedIn()
    await slowInserts(true)
    const first = auth.refreshSession(session.refreshToken)
    await pause(150)
    const second = auth.refreshSession(session.refreshToken)
    const [a, b] = await Promise.all([first, second])
    await slowInserts(false)
    const jti = (t: string) =>
      (JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString()) as { jti: string }).jti
    expect(jti(a.refreshToken)).toBe(jti(b.refreshToken))
    expect(await activeSessions(user.id)).toBe(1)
    await expect(auth.refreshSession(a.refreshToken)).resolves.toBeDefined()
  })
})
