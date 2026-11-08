import { ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common'
import { AuthGuard } from '@nestjs/passport'
import type { Request } from 'express'

// For @Public routes that behave differently for a logged-in user: no Authorization header → anonymous
// (`req.user` stays undefined); a header with an invalid or expired token → 401, so the client
// refreshes its session instead of silently being treated as anonymous.
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<Request>()
    if (!req.headers.authorization) return true
    return super.canActivate(context)
  }

  handleRequest<TUser>(err: unknown, user: TUser | false): TUser {
    if (err || !user) {
      throw new UnauthorizedException({
        code: 'INVALID_TOKEN',
        message: 'Token expired or invalid.',
      })
    }
    return user
  }
}
