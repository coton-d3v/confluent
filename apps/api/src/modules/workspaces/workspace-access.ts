import { WorkspaceErrors } from './workspace-errors'

// Whoever creates or sets up workspaces: the account behind the site (or, later, an MCP tool).
export interface WorkspaceActor {
  id: string
  role: string
}

// The single rule of who may list, create and set up workspaces (E05.01). Until memberships exist
// (E05.02 adds the « manage the workspace » right of a member), only Confluent administrators may.
// Closed by default: any other role, or an unknown one, is refused.
export function canManageWorkspaces(actor: Pick<WorkspaceActor, 'role'>): boolean {
  return actor.role === 'admin'
}

// Checked first by every read and write of WorkspacesService: a workspace's existence is never told
// to whoever may not manage workspaces.
export function assertCanManageWorkspaces(actor: WorkspaceActor): void {
  if (!canManageWorkspaces(actor)) throw WorkspaceErrors.forbidden()
}
