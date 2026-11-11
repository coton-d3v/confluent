import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common'
import type { Request } from 'express'
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy'
import { WorkspaceAccessService } from './workspace-access'

// The workspace management rule applied before a request body is read (logo upload): an account
// that may not manage the workspace of the route is refused without the API buffering its file.
// WorkspacesService checks the same rule again for every caller.
@Injectable()
export class ManageWorkspacesGuard implements CanActivate {
  constructor(private readonly access: WorkspaceAccessService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request & { user: AuthenticatedUser }>()
    await this.access.assertCanManage(req.user, String(req.params.workspaceId ?? ''))
    return true
  }
}
