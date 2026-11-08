import { Injectable, UnauthorizedException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PassportStrategy } from '@nestjs/passport'
import { ExtractJwt, Strategy } from 'passport-jwt'
import type { AppConfig } from '../../../config/config.schema'
import { PrismaService } from '../../../prisma/prisma.service'

export interface JwtPayload {
  sub: string
  email: string
  role: 'entrepreneur' | 'financeur' | 'admin'
}

export interface AuthenticatedUser {
  id: string
  email: string
  role: JwtPayload['role']
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService<AppConfig, true>,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get('JWT_SECRET', { infer: true }),
    })
  }

  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } })
    if (!user || !user.isActive || user.emailVerifiedAt === null) {
      throw new UnauthorizedException({
        code: 'INVALID_TOKEN',
        message: 'Token expired or invalid.',
      })
    }
    // Role and email come from the database, not the token: a role change or deactivation applies to
    // the next request instead of waiting for the access token to expire.
    return { id: user.id, email: user.email, role: user.role }
  }
}
