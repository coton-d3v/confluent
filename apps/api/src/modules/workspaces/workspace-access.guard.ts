import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common'
import type { Request } from 'express'
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy'
import { WorkspaceAccessService } from './workspace-access'

// Put on every controller whose routes name a workspace (`:workspaceId`, E05.03): before the body is
// read or validated, an account that is not in the workspace gets the same `404` as for a workspace
// that does not exist — no validation error, no file buffered, nothing that tells it apart. Routes
// without the parameter do not act in a workspace and pass. The services resolve the workspace
// again, with their finer rules, for every caller (MCP tools included); the e2e inventory checks
// that no route naming a workspace escapes this guard.
@Injectable()
export class WorkspaceAccessGuard implements CanActivate {
  constructor(private readonly access: WorkspaceAccessService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request & { user: AuthenticatedUser }>()
    const workspaceId = req.params.workspaceId
    if (workspaceId === undefined) return true
    await this.access.resolve(req.user, String(workspaceId))
    return true
  }
}
