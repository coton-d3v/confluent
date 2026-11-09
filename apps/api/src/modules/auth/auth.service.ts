import { randomUUID } from 'node:crypto'
import { Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import type { Prisma } from '@prisma/client'
import type { AppConfig } from '../../config/config.schema'
import { PrismaService } from '../../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import { ACCESS_TOKEN_TTL_SECONDS, REFRESH_TOKEN_TTL_SECONDS } from './auth.constants'
import { EMAIL_TRANSPORT, type EmailTransport } from './email/email-transport'
import type { JwtPayload } from './strategies/jwt.strategy'

const MAGIC_LINK_TTL_MS = 15 * 60 * 1000

export interface IssuedSession {
  accessToken: string
  refreshToken: string
  user: {
    id: string
    email: string
    role: JwtPayload['role']
    firstName: string | null
    lastName: string | null
  }
}

interface RefreshPayload {
  sub: string
  // id of the `refresh_sessions` row backing this token
  jti: string
}

// A rotated token presented again within this window is treated as a benign race (two tabs refreshing
// at once) and simply refused; after it, it is treated as a replay and the whole login is revoked.
const REFRESH_REUSE_GRACE_MS = 30 * 1000

const invalidToken = () =>
  new UnauthorizedException({ code: 'INVALID_TOKEN', message: 'Token expired or invalid.' })

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly jwt: JwtService,
    @Inject(EMAIL_TRANSPORT) private readonly email: EmailTransport,
    private readonly audit: AuditService,
  ) {}

  async requestMagicLink(rawEmail: string): Promise<void> {
    const email = rawEmail.trim().toLowerCase()
    const user = await this.prisma.user.findUnique({ where: { email } })
    if (!user) {
      this.logger.debug(`magic_link.unknown_email emailLen=${email.length}`)
      return
    }

    const token = randomUUID()
    const expiresAt = new Date(Date.now() + MAGIC_LINK_TTL_MS)
    await this.prisma.magicLinkToken.create({
      data: { userId: user.id, token, expiresAt },
    })

    const frontendUrl = this.config.get('FRONTEND_URL', { infer: true })
    const verifyUrl = `${frontendUrl}/auth/verify?token=${token}`

    try {
      await this.email.sendMagicLink({
        to: email,
        magicLinkUrl: verifyUrl,
        locale: (user.locale as 'fr') ?? 'fr',
      })
    } catch (err) {
      this.logger.warn(
        `Magic link email dispatch failed for user ${user.id}: ` +
          (err instanceof Error ? err.message : String(err)),
      )
    }
  }

  async verifyMagicLink(token: string): Promise<IssuedSession> {
    const record = await this.prisma.magicLinkToken.findUnique({
      where: { token },
      include: { user: true },
    })
    if (!record) throw invalidToken()

    // Consume atomically: only one of two concurrent requests can flip `consumedAt` from null.
    const now = new Date()
    const consumed = await this.prisma.magicLinkToken.updateMany({
      where: { id: record.id, consumedAt: null, expiresAt: { gt: now } },
      data: { consumedAt: now },
    })
    if (consumed.count !== 1) throw invalidToken()
    if (!record.user.isActive) throw invalidToken()

    if (record.user.emailVerifiedAt === null) {
      await this.prisma.user.update({
        where: { id: record.user.id },
        data: { emailVerifiedAt: now },
      })
    }

    await this.audit.record({
      actionType: 'magic_link_consumed',
      actorId: record.user.id,
      metadata: { tokenId: record.id },
    })

    return this.issueSession(record.user, randomUUID())
  }

  // Rotation, logout and deactivation of a user's sessions are serialized on the user row (code
  // review R07): a logout can no longer slip between spending a refresh token and creating its
  // successor. A request replaying the token just rotated (another tab, a retry) within the grace
  // period gets the SAME successor session instead of burning the family (R08, R05).
  async refreshSession(refreshToken: string | undefined): Promise<IssuedSession> {
    const payload = await this.verifyRefreshToken(refreshToken)
    if (!payload) throw invalidToken()

    const outcome = await this.prisma.$transaction(async (tx) => {
      await lockUserSessions(tx, payload.sub)
      const row = await tx.refreshSession.findUnique({ where: { id: payload.jti } })
      if (!row || row.userId !== payload.sub || row.expiresAt.getTime() <= Date.now()) {
        return { kind: 'invalid' as const }
      }
      if (row.revokedAt !== null) {
        const successor = await this.recentSuccessor(tx, row)
        return successor
          ? { kind: 'session' as const, user: successor.user, rowId: successor.id }
          : { kind: 'reused' as const, row }
      }
      const user = await tx.user.findUnique({ where: { id: payload.sub } })
      if (!user || !user.isActive || user.emailVerifiedAt === null) {
        await revokeFamily(tx, row.familyId)
        return { kind: 'invalid' as const }
      }
      const successor = await createSessionRow(tx, user.id, row.familyId)
      await tx.refreshSession.update({
        where: { id: row.id },
        data: { revokedAt: new Date(), replacedById: successor.id },
      })
      return { kind: 'session' as const, user, rowId: successor.id }
    })

    if (outcome.kind === 'reused') {
      await this.handleRevokedTokenUse(outcome.row)
      throw invalidToken()
    }
    if (outcome.kind === 'invalid') throw invalidToken()
    return this.signSession(outcome.user, outcome.rowId)
  }

  // Logout: revoke every token of the presented login. Never throws — logging out must always succeed.
  async revokeSession(refreshToken: string | undefined): Promise<void> {
    const payload = await this.verifyRefreshToken(refreshToken)
    if (!payload) return
    const row = await this.prisma.$transaction(async (tx) => {
      await lockUserSessions(tx, payload.sub)
      const found = await tx.refreshSession.findUnique({ where: { id: payload.jti } })
      if (!found || found.userId !== payload.sub) return null
      await revokeFamily(tx, found.familyId)
      return found
    })
    if (!row) return
    await this.audit.record({
      actionType: 'session_revoked',
      actorId: row.userId,
      metadata: { familyId: row.familyId, reason: 'logout' },
    })
  }

  // Used when an account is deactivated: no refresh token of this user can be rotated any more.
  async revokeAllSessions(userId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await lockUserSessions(tx, userId)
      await tx.refreshSession.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      })
    })
  }

  async updateProfile(
    userId: string,
    firstName: string,
    lastName: string,
  ): Promise<{ firstName: string; lastName: string }> {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { firstName: firstName.trim(), lastName: lastName.trim() },
    })
    return { firstName: user.firstName!, lastName: user.lastName! }
  }

  private async verifyRefreshToken(token: string | undefined): Promise<RefreshPayload | null> {
    if (!token) return null
    try {
      const payload = await this.jwt.verifyAsync<RefreshPayload>(token, {
        secret: this.config.get('JWT_REFRESH_SECRET', { infer: true }),
      })
      return typeof payload.jti === 'string' && typeof payload.sub === 'string' ? payload : null
    } catch {
      return null
    }
  }

  // A spent token: the session it was rotated into, if this is a retry within the grace period and
  // that session is still alive; null means a real replay.
  private async recentSuccessor(
    tx: Prisma.TransactionClient,
    row: { revokedAt: Date | null; replacedById: string | null },
  ) {
    const sinceRotation = Date.now() - (row.revokedAt?.getTime() ?? 0)
    if (row.replacedById === null || sinceRotation >= REFRESH_REUSE_GRACE_MS) return null
    const successor = await tx.refreshSession.findUnique({
      where: { id: row.replacedById },
      include: { user: true },
    })
    if (!successor || successor.revokedAt !== null || successor.expiresAt.getTime() <= Date.now()) {
      return null
    }
    if (!successor.user.isActive || successor.user.emailVerifiedAt === null) return null
    return successor
  }

  private async handleRevokedTokenUse(row: {
    id: string
    userId: string
    familyId: string
  }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await lockUserSessions(tx, row.userId)
      await revokeFamily(tx, row.familyId)
    })
    this.logger.warn(`refresh_token_reused user=${row.userId} family=${row.familyId}`)
    await this.audit.record({
      actionType: 'refresh_token_reused',
      actorId: row.userId,
      metadata: { familyId: row.familyId, tokenId: row.id },
    })
  }

  private async issueSession(user: SessionUser, familyId: string): Promise<IssuedSession> {
    const row = await createSessionRow(this.prisma, user.id, familyId)
    return this.signSession(user, row.id)
  }

  // Tokens of an existing session row: the refresh JWT only carries the row id, so signing it again
  // gives the same session (used for a retry within the grace period).
  private async signSession(user: SessionUser, sessionId: string): Promise<IssuedSession> {
    const accessToken = await this.jwt.signAsync(
      { sub: user.id, email: user.email, role: user.role } satisfies JwtPayload,
      {
        secret: this.config.get('JWT_SECRET', { infer: true }),
        expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      },
    )
    const refreshToken = await this.jwt.signAsync(
      { sub: user.id, jti: sessionId } satisfies RefreshPayload,
      {
        secret: this.config.get('JWT_REFRESH_SECRET', { infer: true }),
        expiresIn: REFRESH_TOKEN_TTL_SECONDS,
      },
    )
    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        firstName: user.firstName,
        lastName: user.lastName,
      },
    }
  }
}

interface SessionUser {
  id: string
  email: string
  role: JwtPayload['role']
  firstName: string | null
  lastName: string | null
}

// Serializes every change to a user's sessions (rotation, logout, deactivation): R07, R08.
async function lockUserSessions(tx: Prisma.TransactionClient, userId: string): Promise<void> {
  await tx.$queryRaw`SELECT 1 FROM "users" WHERE "id" = ${userId} FOR UPDATE`
}

async function revokeFamily(db: Prisma.TransactionClient, familyId: string): Promise<void> {
  await db.refreshSession.updateMany({
    where: { familyId, revokedAt: null },
    data: { revokedAt: new Date() },
  })
}

function createSessionRow(db: Prisma.TransactionClient, userId: string, familyId: string) {
  return db.refreshSession.create({
    data: {
      userId,
      familyId,
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000),
    },
  })
}
