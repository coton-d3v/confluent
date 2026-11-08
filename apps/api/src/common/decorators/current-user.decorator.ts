import { createParamDecorator, type ExecutionContext } from '@nestjs/common'
import type { Request } from 'express'
import type { AuthenticatedUser } from '../../modules/auth/strategies/jwt.strategy'

// The user authenticated by the global JWT guard, never an identifier supplied by the client.
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser =>
    (ctx.switchToHttp().getRequest<Request>() as Request & { user: AuthenticatedUser }).user,
)
