import { ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import type { User, user_role } from '@prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { AuthService } from '../auth/auth.service'
import { AuditService } from '../audit/audit.service'

export interface InviteUserInput {
  email: string
  role: user_role
}

@Injectable()
export class AdminUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
  ) {}

  listUsers(): Promise<User[]> {
    return this.prisma.user.findMany({ orderBy: { createdAt: 'desc' } })
  }

  async invite(input: InviteUserInput, actorId: string): Promise<User> {
    const email = input.email.trim().toLowerCase()
    const existing = await this.prisma.user.findUnique({ where: { email } })
    if (existing && existing.isActive && existing.emailVerifiedAt !== null) {
      throw new ConflictException({
        code: 'USER_ALREADY_ACTIVE',
        message: 'User already active.',
      })
    }
    const user = existing
      ? await this.prisma.user.update({
          where: { id: existing.id },
          data: { role: input.role, isActive: true },
        })
      : await this.prisma.user.create({
          data: { email, role: input.role, isActive: true, emailVerifiedAt: null },
        })
    await this.audit.record({
      actionType: 'user_reactivated',
      actorId,
      metadata: { email, role: input.role, userId: user.id, kind: 'invite' },
    })
    await this.auth.requestMagicLink(email)
    return user
  }

  async deactivate(userId: string, actorId: string): Promise<User> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } })
    if (!user) {
      throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'User not found.' })
    }
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { isActive: false },
    })
    await this.auth.revokeAllSessions(userId)
    await this.audit.record({
      actionType: 'user_deactivated',
      actorId,
      metadata: { userId, email: user.email },
    })
    return updated
  }

  async reactivate(userId: string, actorId: string): Promise<User> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } })
    if (!user) {
      throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'User not found.' })
    }
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { isActive: true },
    })
    await this.audit.record({
      actionType: 'user_reactivated',
      actorId,
      metadata: { userId, email: user.email },
    })
    return updated
  }
}
