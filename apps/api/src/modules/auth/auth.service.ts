import { randomUUID } from 'node:crypto'
import { Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
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

  async refreshSession(refreshToken: string | undefined): Promise<IssuedSession> {
    const payload = await this.verifyRefreshToken(refreshToken)
    if (!payload) throw invalidToken()

    const row = await this.prisma.refreshSession.findUnique({ where: { id: payload.jti } })
    if (!row || row.userId !== payload.sub || row.expiresAt.getTime() <= Date.now()) {
      throw invalidToken()
    }
    if (row.revokedAt !== null) {
      await this.handleRevokedTokenUse(row)
      throw invalidToken()
    }

    // Claim the row atomically so a token can be rotated only once.
    const claimed = await this.prisma.refreshSession.updateMany({
      where: { id: row.id, revokedAt: null },
      data: { revokedAt: new Date() },
    })
    if (claimed.count !== 1) throw invalidToken()

    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } })
    if (!user || !user.isActive || user.emailVerifiedAt === null) {
      await this.revokeFamily(row.familyId)
      throw invalidToken()
    }
    const session = await this.issueSession(user, row.familyId)
    await this.prisma.refreshSession.update({
      where: { id: row.id },
      data: { replacedById: session.sessionId },
    })
    return session
  }

  // Logout: revoke every token of the presented login. Never throws — logging out must always succeed.
  async revokeSession(refreshToken: string | undefined): Promise<void> {
    const payload = await this.verifyRefreshToken(refreshToken)
    if (!payload) return
    const row = await this.prisma.refreshSession.findUnique({ where: { id: payload.jti } })
    if (!row || row.userId !== payload.sub) return
    await this.revokeFamily(row.familyId)
    await this.audit.record({
      actionType: 'session_revoked',
      actorId: row.userId,
      metadata: { familyId: row.familyId, reason: 'logout' },
    })
  }

  // Used when an account is deactivated: no refresh token of this user can be rotated any more.
  async revokeAllSessions(userId: string): Promise<void> {
    await this.prisma.refreshSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
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

  private async handleRevokedTokenUse(row: {
    id: string
    userId: string
    familyId: string
    revokedAt: Date | null
    replacedById: string | null
  }): Promise<void> {
    const sinceRevocation = Date.now() - (row.revokedAt?.getTime() ?? 0)
    if (row.replacedById !== null && sinceRevocation < REFRESH_REUSE_GRACE_MS) return
    await this.revokeFamily(row.familyId)
    this.logger.warn(`refresh_token_reused user=${row.userId} family=${row.familyId}`)
    await this.audit.record({
      actionType: 'refresh_token_reused',
      actorId: row.userId,
      metadata: { familyId: row.familyId, tokenId: row.id },
    })
  }

  private async revokeFamily(familyId: string): Promise<void> {
    await this.prisma.refreshSession.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    })
  }

  private async issueSession(
    user: {
      id: string
      email: string
      role: JwtPayload['role']
      firstName: string | null
      lastName: string | null
    },
    familyId: string,
  ): Promise<IssuedSession & { sessionId: string }> {
    const accessToken = await this.jwt.signAsync(
      { sub: user.id, email: user.email, role: user.role } satisfies JwtPayload,
      {
        secret: this.config.get('JWT_SECRET', { infer: true }),
        expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      },
    )
    const row = await this.prisma.refreshSession.create({
      data: {
        userId: user.id,
        familyId,
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000),
      },
    })
    const refreshToken = await this.jwt.signAsync(
      { sub: user.id, jti: row.id } satisfies RefreshPayload,
      {
        secret: this.config.get('JWT_REFRESH_SECRET', { infer: true }),
        expiresIn: REFRESH_TOKEN_TTL_SECONDS,
      },
    )
    return {
      accessToken,
      refreshToken,
      sessionId: row.id,
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
