import { Injectable } from '@nestjs/common'
import type { Prisma } from '@prisma/client'
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

// Applies the rule with the actor's membership as stored now: a right withdrawn or a membership
// deactivated takes effect at the very next request. Checked before anything else, so that a
// workspace's existence is never told to whoever may not manage it.
@Injectable()
export class WorkspaceAccessService {
  constructor(private readonly prisma: PrismaService) {}

  // `tx`: inside a transaction that locked the workspace row first, the rule is read after the lock,
  // so that it cannot change between the check and the write (two managers demoting each other).
  async assertCanManage(
    actor: WorkspaceActor,
    workspaceId: string,
    tx: Prisma.TransactionClient = this.prisma,
  ): Promise<void> {
    const membership = await tx.workspaceMembership.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: actor.id } },
    })
    if (!canManageWorkspace(actor, membership)) throw WorkspaceErrors.forbidden()
  }
}
