import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common'
import type { Request } from 'express'
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy'
import { assertCanManageWorkspaces } from './workspace-access'

// The workspace management rule applied before a request body is read (logo upload): an account
// that may not manage workspaces is refused without the API buffering its file. WorkspacesService
// checks the same rule again for every caller.
@Injectable()
export class ManageWorkspacesGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request & { user: AuthenticatedUser }>()
    assertCanManageWorkspaces(req.user)
    return true
  }
}
