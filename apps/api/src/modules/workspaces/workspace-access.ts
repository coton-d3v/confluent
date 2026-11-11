import { Injectable } from '@nestjs/common'
import type { Prisma, Workspace, WorkspaceMembership } from '@prisma/client'
import { WORKSPACE_MEMBER_ROLES } from '@confluent/shared'
import { PrismaService } from '../../prisma/prisma.service'
import { WorkspaceErrors } from './workspace-errors'

// Whoever creates or sets up workspaces: the account behind the site (or, later, an MCP tool).
// `role` is the account's global role (`users.role`), read from the database at each request.
export interface WorkspaceActor {
  id: string
  role: string
}

// What of the actor's membership in a workspace decides the right to manage it.
export interface ManagingMembership {
  role: string
  canManageWorkspace: boolean
  deactivatedAt: Date | null
}

// Creating workspaces, listing all of them and the settings that bound the managers themselves
// (the email domain their invitations must match): Confluent administrators only.
export function canAdministerAllWorkspaces(actor: Pick<WorkspaceActor, 'role'>): boolean {
  return actor.role === 'admin'
}

// THE rule of who manages one workspace — its settings, logo and members (E05.01, widened by
// E05.02): a Confluent administrator, or an active conseiller of this very workspace holding the
// right to manage it. Closed by default: no membership, a deactivated one, an investisseur, an
// unknown role or a missing right grant nothing, and the global role never does (admin aside).
export function canManageWorkspace(
  actor: Pick<WorkspaceActor, 'role'>,
  membership: ManagingMembership | null,
): boolean {
  if (canAdministerAllWorkspaces(actor)) return true
  return (
    membership !== null &&
    membership.deactivatedAt === null &&
    membership.role === 'conseiller' &&
    membership.canManageWorkspace === true
  )
}

export function assertCanAdministerAllWorkspaces(actor: WorkspaceActor): void {
  if (!canAdministerAllWorkspaces(actor)) throw WorkspaceErrors.administratorsOnly()
}

// A membership that still grants something: not deactivated, with a role this version knows.
export function isActiveMembership(membership: Pick<ManagingMembership, 'role' | 'deactivatedAt'>) {
  return (
    membership.deactivatedAt === null &&
    (WORKSPACE_MEMBER_ROLES as readonly string[]).includes(membership.role)
  )
}

// THE rule of who may act in a workspace at all (E05.03), before any finer rule (managing it,
// later its candidatures, committees…): a Confluent administrator, or an active member. Closed by
// default: no membership, a deactivated one or an unknown role grant nothing, the global role
// never does (admin aside).
export function canEnterWorkspace(
  actor: Pick<WorkspaceActor, 'role'>,
  membership: Pick<ManagingMembership, 'role' | 'deactivatedAt'> | null,
): boolean {
  return (
    canAdministerAllWorkspaces(actor) || (membership !== null && isActiveMembership(membership))
  )
}

// THE rule of who reads a workspace's pool (« vivier », E07.02) as an investor (E07.03): an active
// investisseur of this very workspace. Closed by default: a conseiller (who follows the pool from the
// candidatures), a deactivated membership, an unknown role and the global role — an administrator's
// included — read nothing of it.
export function readsPool(membership: Pick<ManagingMembership, 'role' | 'deactivatedAt'>): boolean {
  return isActiveMembership(membership) && membership.role === 'investisseur'
}

// The workspace a request acts in, as resolved for its actor at this request: what every
// workspace-scoped read or write starts from, and what it filters its rows by (`workspace.id`).
export interface WorkspaceScope {
  actor: WorkspaceActor
  workspace: Workspace
  // The actor's active membership; null for an administrator who is not a member.
  membership: WorkspaceMembership | null
}

// Resolves which workspace a request acts in from the database, at each request — whether it comes
// from the site, the REST API or (E05.10) an MCP tool, whose callers only name a workspace. A right
// withdrawn or a membership deactivated takes effect at the very next request.
@Injectable()
export class WorkspaceAccessService {
  constructor(private readonly prisma: PrismaService) {}

  // `404` alike for a workspace that does not exist and one the actor may not enter: its existence
  // is never told to whoever is not in it. `tx`: read inside a transaction (after its locks).
  async resolve(
    actor: WorkspaceActor,
    workspaceId: string,
    tx: Prisma.TransactionClient = this.prisma,
  ): Promise<WorkspaceScope> {
    const membership = await tx.workspaceMembership.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: actor.id } },
      include: { workspace: true },
    })
    if (membership && isActiveMembership(membership)) {
      const { workspace, ...own } = membership
      return { actor, workspace, membership: own }
    }
    if (!canAdministerAllWorkspaces(actor)) throw WorkspaceErrors.notFound()
    const workspace = await tx.workspace.findUnique({ where: { id: workspaceId } })
    if (!workspace) throw WorkspaceErrors.notFound()
    return { actor, workspace, membership: null }
  }

  // Managing a workspace — its settings, logo and members — is a finer right inside it: whoever is
  // not in the workspace gets the `404` of `resolve`, a member without the right `403`. `tx`: inside
  // a transaction that locked the workspace row first, the rule is read after the lock, so that it
  // cannot change between the check and the write (two managers demoting each other).
  async assertCanManage(
    actor: WorkspaceActor,
    workspaceId: string,
    tx: Prisma.TransactionClient = this.prisma,
  ): Promise<WorkspaceScope> {
    const scope = await this.resolve(actor, workspaceId, tx)
    if (!canManageWorkspace(actor, scope.membership)) throw WorkspaceErrors.forbidden()
    return scope
  }
}
