import { Inject, Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Prisma, type User, type Workspace, type WorkspaceMembership } from '@prisma/client'
import {
  WORKSPACE_MEMBER_ROLE_LABELS,
  emailDomainOf,
  memberRuleViolation,
  type InvestorType,
  type WorkspaceMemberRole,
} from '@confluent/shared'
import type { AppConfig } from '../../config/config.schema'
import { PrismaService } from '../../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import { EMAIL_TRANSPORT, type EmailTransport } from '../auth/email/email-transport'
import {
  WorkspaceAccessService,
  canAdministerAllWorkspaces,
  isActiveMembership,
  type WorkspaceActor,
} from './workspace-access'
import { NotificationsService } from '../notifications/notifications.service'
import { WorkspaceErrors } from './workspace-errors'
import { lockWorkspaceRow } from './workspaces.service'

// As validated by inviteWorkspaceMemberSchema / updateWorkspaceMemberSchema.
export interface InviteMemberInput {
  email: string
  role: WorkspaceMemberRole
  organization?: string | null
  investorType?: InvestorType | null
  canManageWorkspace?: boolean
}

export type UpdateMemberInput = Partial<Omit<InviteMemberInput, 'email'>>

interface Person {
  id: string
  email: string
  firstName: string | null
  lastName: string | null
}

export interface WorkspaceMemberView {
  id: string
  workspaceId: string
  user: Person
  role: WorkspaceMemberRole
  organization: string | null
  investorType: InvestorType | null
  canManageWorkspace: boolean
  status: 'active' | 'deactivated'
  awaitingFirstSignIn: boolean
  invitedBy: Person | null
  invitedAt: Date
  deactivatedAt: Date | null
}

export interface MyMembershipView {
  id: string
  role: WorkspaceMemberRole
  organization: string | null
  investorType: InvestorType | null
  canManageWorkspace: boolean
  workspace: Pick<Workspace, 'id' | 'slug' | 'name' | 'programName' | 'color'>
}

type MembershipRow = WorkspaceMembership & { user: User; invitedBy: User | null }

const WITH_PEOPLE = { user: true, invitedBy: true } as const

// What changes when a membership is edited, as journaled.
const EDITABLE = ['role', 'organization', 'investorType', 'canManageWorkspace'] as const

// Members of a workspace (ROADMAP E05.02): invite conseillers and investisseurs, edit their
// organization, investor type and right to manage the workspace, deactivate and reactivate them.
// Every operation follows the single management rule, read after locking the workspace row: all
// membership writes of one workspace are serialized, so its last manager cannot be removed by two
// concurrent requests, nor a right used while another request withdraws it.
@Injectable()
export class WorkspaceMembersService {
  private readonly logger = new Logger(WorkspaceMembersService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: WorkspaceAccessService,
    private readonly config: ConfigService<AppConfig, true>,
    @Inject(EMAIL_TRANSPORT) private readonly email: EmailTransport,
    private readonly notifications: NotificationsService,
  ) {}

  async list(actor: WorkspaceActor, workspaceId: string): Promise<WorkspaceMemberView[]> {
    await this.access.assertCanManage(actor, workspaceId)
    const rows = await this.prisma.workspaceMembership.findMany({
      where: { workspaceId },
      include: WITH_PEOPLE,
    })
    // Active members first, then by address.
    return rows
      .map(toView)
      .sort(
        (a, b) =>
          Number(a.status === 'deactivated') - Number(b.status === 'deactivated') ||
          a.user.email.localeCompare(b.user.email),
      )
  }

  // The signed-in person's active memberships — the workspaces they may enter and switch between
  // (E05.03) — whatever their rights in them. Only their own: no identifier comes from the client.
  async listMine(actor: WorkspaceActor): Promise<MyMembershipView[]> {
    const rows = await this.prisma.workspaceMembership.findMany({
      where: { userId: actor.id, deactivatedAt: null },
      include: { workspace: true },
    })
    return rows
      .filter(isActiveMembership)
      .map((row) => ({
        id: row.id,
        role: row.role as WorkspaceMemberRole,
        organization: row.organization,
        investorType: row.investorType as InvestorType | null,
        canManageWorkspace: row.canManageWorkspace,
        workspace: {
          id: row.workspace.id,
          slug: row.workspace.slug,
          name: row.workspace.name,
          programName: row.workspace.programName,
          color: row.workspace.color,
        },
      }))
      .sort((a, b) => a.workspace.name.localeCompare(b.workspace.name, 'fr'))
  }

  // Adds a person to the workspace — creating their account when the address is unknown, as a
  // share invitation does — then tells them by email. The membership is effective at once: the
  // invitation is the workspace's decision, the person signs in with the usual magic link.
  async invite(
    actor: WorkspaceActor,
    workspaceId: string,
    input: InviteMemberInput,
  ): Promise<{ member: WorkspaceMemberView; invitationEmailSent: boolean }> {
    const email = input.email.trim().toLowerCase()
    let outcome: { member: MembershipRow; workspace: Workspace; createdAccount: boolean }
    try {
      outcome = await this.prisma.$transaction(async (tx) => {
        const workspace = await this.lockForManager(tx, actor, workspaceId)
        assertEmailAllowed(workspace, email, input.role)
        const { user, created } = await accountIn(tx, email)
        const existing = await tx.workspaceMembership.findUnique({
          where: { workspaceId_userId: { workspaceId, userId: user.id } },
        })
        if (existing) throw WorkspaceErrors.alreadyMember(existing.deactivatedAt !== null)
        const member = await tx.workspaceMembership.create({
          data: newMembership(workspaceId, user.id, actor.id, input),
          include: WITH_PEOPLE,
        })
        // E10.03: in the site only — the invitation's own email follows.
        await this.notifications.recordIn(tx, [
          {
            recipientId: user.id,
            kind: 'workspace_invited',
            key: `workspace_invited:${member.id}`,
            subject: `workspace_membership:${member.id}`,
            workspaceId,
            payload: {
              workspaceId,
              workspaceName: workspace.name,
              role: member.role as WorkspaceMemberRole,
            },
          },
        ])
        return { member, workspace, createdAccount: created }
      })
    } catch (err) {
      // Backstop of the workspace lock: the unique (workspace, user) index.
      if (isUniqueViolation(err)) throw WorkspaceErrors.alreadyMember(false)
      throw err
    }
    const { member, workspace, createdAccount } = outcome
    await this.audit.record({
      actionType: 'workspace_member_invited',
      actorId: actor.id,
      metadata: {
        workspaceId,
        membershipId: member.id,
        userId: member.userId,
        email,
        role: member.role,
        organization: member.organization,
        investorType: member.investorType,
        canManageWorkspace: member.canManageWorkspace,
        createdAccount,
      },
    })
    const invitationEmailSent = await this.sendInvitation(member, workspace)
    return { member: toView(member), invitationEmailSent }
  }

  // ROADMAP E08.05: the membership an accepted participation request gives its address, inside the
  // decision's transaction — which locked the workspace row and read the manager's right after the
  // lock, as every membership write does. The account is created when the address is unknown (as
  // for an invitation). An active membership is kept as it is, whatever its role and rights (never
  // narrowed nor widened); a deactivated one is left deactivated (`deactivated`: the caller refuses —
  // reactivating someone is a decision of the members' page). No email here: the decision sends its
  // own.
  async admitIn(
    tx: Prisma.TransactionClient,
    actorId: string,
    workspaceId: string,
    input: { email: string; role: WorkspaceMemberRole; organization: string | null },
  ): Promise<{
    userId: string
    admission: 'account_created' | 'membership_created' | 'already_member' | 'deactivated'
  }> {
    const { user, created } = await accountIn(tx, input.email)
    const existing = await tx.workspaceMembership.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: user.id } },
    })
    if (existing) {
      return {
        userId: user.id,
        admission: existing.deactivatedAt === null ? 'already_member' : 'deactivated',
      }
    }
    await tx.workspaceMembership.create({
      data: newMembership(workspaceId, user.id, actorId, input),
    })
    return { userId: user.id, admission: created ? 'account_created' : 'membership_created' }
  }

  // Only what is sent changes. A new role clears what it cannot hold; becoming a conseiller follows
  // the workspace's email domain like an invitation.
  async update(
    actor: WorkspaceActor,
    workspaceId: string,
    membershipId: string,
    input: UpdateMemberInput,
  ): Promise<WorkspaceMemberView> {
    const { member, changes } = await this.prisma.$transaction(async (tx) => {
      const workspace = await this.lockForManager(tx, actor, workspaceId)
      const current = await findMember(tx, workspaceId, membershipId)
      const next = nextState(current, input)
      if (next.role === 'conseiller' && current.role !== 'conseiller') {
        assertEmailAllowed(workspace, current.user.email, 'conseiller')
      }
      if (managesNow(current) && !next.canManageWorkspace) {
        await this.assertAnotherManagerRemains(tx, actor, current)
      }
      const changes: Record<string, { from: unknown; to: unknown }> = {}
      for (const key of EDITABLE) {
        if (next[key] !== current[key]) changes[key] = { from: current[key], to: next[key] }
      }
      if (Object.keys(changes).length === 0) return { member: current, changes }
      const member = await tx.workspaceMembership.update({
        where: { id: membershipId },
        data: next,
        include: WITH_PEOPLE,
      })
      return { member, changes }
    })
    if (Object.keys(changes).length > 0) {
      await this.audit.record({
        actionType: 'workspace_member_updated',
        actorId: actor.id,
        metadata: {
          workspaceId,
          membershipId,
          userId: member.userId,
          email: member.user.email,
          changes,
        },
      })
    }
    return toView(member)
  }

  // The membership and its history stay; what it grants stops at the next request. The account
  // itself is untouched (its other memberships, dossiers and shares go on).
  async deactivate(
    actor: WorkspaceActor,
    workspaceId: string,
    membershipId: string,
  ): Promise<WorkspaceMemberView> {
    const { member, changed } = await this.prisma.$transaction(async (tx) => {
      await this.lockForManager(tx, actor, workspaceId)
      const current = await findMember(tx, workspaceId, membershipId)
      if (current.deactivatedAt !== null) return { member: current, changed: false }
      if (managesNow(current)) await this.assertAnotherManagerRemains(tx, actor, current)
      const member = await tx.workspaceMembership.update({
        where: { id: membershipId },
        data: { deactivatedAt: new Date() },
        include: WITH_PEOPLE,
      })
      return { member, changed: true }
    })
    if (changed) await this.recordStatus('workspace_member_deactivated', actor, member)
    return toView(member)
  }

  // Gives back what the membership held, under today's email domain for a conseiller.
  async reactivate(
    actor: WorkspaceActor,
    workspaceId: string,
    membershipId: string,
  ): Promise<WorkspaceMemberView> {
    const { member, changed } = await this.prisma.$transaction(async (tx) => {
      const workspace = await this.lockForManager(tx, actor, workspaceId)
      const current = await findMember(tx, workspaceId, membershipId)
      if (current.deactivatedAt === null) return { member: current, changed: false }
      assertEmailAllowed(workspace, current.user.email, current.role as WorkspaceMemberRole)
      const member = await tx.workspaceMembership.update({
        where: { id: membershipId },
        data: { deactivatedAt: null },
        include: WITH_PEOPLE,
      })
      return { member, changed: true }
    })
    if (changed) await this.recordStatus('workspace_member_reactivated', actor, member)
    return toView(member)
  }

  // Lock first, then the rule (after the lock, see the class comment), which reads the workspace:
  // whoever is not in it learns nothing of its existence.
  private async lockForManager(
    tx: Prisma.TransactionClient,
    actor: WorkspaceActor,
    workspaceId: string,
  ): Promise<Workspace> {
    await lockWorkspaceRow(tx, workspaceId)
    return (await this.access.assertCanManage(actor, workspaceId, tx)).workspace
  }

  // A manager cannot give up the last management right of the workspace (theirs, since they act
  // with it): the workspace would be left to Confluent's administrators alone. An administrator
  // may, which brings the workspace back to its state at creation.
  private async assertAnotherManagerRemains(
    tx: Prisma.TransactionClient,
    actor: WorkspaceActor,
    leaving: WorkspaceMembership,
  ): Promise<void> {
    if (canAdministerAllWorkspaces(actor)) return
    const others = await tx.workspaceMembership.count({
      where: {
        workspaceId: leaving.workspaceId,
        id: { not: leaving.id },
        role: 'conseiller',
        canManageWorkspace: true,
        deactivatedAt: null,
      },
    })
    if (others === 0) throw WorkspaceErrors.lastManager()
  }

  private async recordStatus(
    actionType: 'workspace_member_deactivated' | 'workspace_member_reactivated',
    actor: WorkspaceActor,
    member: MembershipRow,
  ): Promise<void> {
    await this.audit.record({
      actionType,
      actorId: actor.id,
      metadata: {
        workspaceId: member.workspaceId,
        membershipId: member.id,
        userId: member.userId,
        email: member.user.email,
        role: member.role,
      },
    })
  }

  // Best effort, like a share invitation: the membership exists whether or not the email leaves.
  private async sendInvitation(member: MembershipRow, workspace: Workspace): Promise<boolean> {
    const role = WORKSPACE_MEMBER_ROLE_LABELS[member.role as WorkspaceMemberRole].toLowerCase()
    try {
      await this.email.sendWorkspaceInvite({
        to: member.user.email,
        workspaceName: workspace.name,
        roleLabel: member.canManageWorkspace ? `${role}, gestionnaire du workspace` : role,
        signInUrl: `${this.config.get('FRONTEND_URL', { infer: true })}/auth`,
        locale: 'fr',
      })
      return true
    } catch (err) {
      this.logger.warn(
        `workspace invitation email not sent (membership ${member.id}): ${(err as Error).message}`,
      )
      return false
    }
  }
}

// A workspace restricted to an email domain only takes conseillers — its own staff, who may manage
// it — from that domain (exact match). Investisseurs belong to the structure's community, outside
// it by nature: the restriction does not apply to them.
function assertEmailAllowed(workspace: Workspace, email: string, role: WorkspaceMemberRole): void {
  if (role !== 'conseiller' || !workspace.emailDomain) return
  if (emailDomainOf(email) !== workspace.emailDomain) {
    throw WorkspaceErrors.emailDomainMismatch(workspace.emailDomain)
  }
}

// The account of an address, created when unknown. The global role of a new account is the narrowest
// one (as for a share invitation), unverified until its first sign-in: the membership, not the
// global role, says what the person does in the workspace. An existing account keeps its global role.
async function accountIn(
  tx: Prisma.TransactionClient,
  email: string,
): Promise<{ user: User; created: boolean }> {
  const created = await tx.user.createMany({
    data: [{ email, role: 'financeur', isActive: true, emailVerifiedAt: null }],
    skipDuplicates: true,
  })
  const user = await tx.user.findUnique({ where: { email } })
  if (!user) throw new Error(`account ${email} neither created nor found`)
  return { user, created: created.count === 1 }
}

// A new membership: what its role may hold, nothing more.
function newMembership(
  workspaceId: string,
  userId: string,
  invitedById: string,
  input: Pick<InviteMemberInput, 'role' | 'organization' | 'investorType' | 'canManageWorkspace'>,
) {
  return {
    workspaceId,
    userId,
    role: input.role,
    organization: input.organization ?? null,
    investorType: input.role === 'investisseur' ? (input.investorType ?? null) : null,
    canManageWorkspace: input.role === 'conseiller' && input.canManageWorkspace === true,
    invitedById,
  }
}

async function findMember(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  membershipId: string,
): Promise<MembershipRow> {
  const member = await tx.workspaceMembership.findUnique({
    where: { id: membershipId },
    include: WITH_PEOPLE,
  })
  if (!member || member.workspaceId !== workspaceId) throw WorkspaceErrors.memberNotFound()
  return member
}

function managesNow(member: WorkspaceMembership): boolean {
  return member.role === 'conseiller' && member.canManageWorkspace && member.deactivatedAt === null
}

// The membership after an edit: what is sent, then what the (new) role cannot hold is cleared. An
// explicit contradiction (an investor type for a conseiller…) is refused rather than dropped.
function nextState(current: WorkspaceMembership, input: UpdateMemberInput) {
  const role = (input.role ?? current.role) as WorkspaceMemberRole
  const violation = memberRuleViolation({
    role,
    investorType: input.investorType,
    canManageWorkspace: input.canManageWorkspace,
  })
  if (violation) throw WorkspaceErrors.memberRule(violation.path, violation.message)
  return {
    role,
    organization: input.organization !== undefined ? input.organization : current.organization,
    investorType:
      role === 'investisseur'
        ? input.investorType !== undefined
          ? input.investorType
          : current.investorType
        : null,
    canManageWorkspace:
      role === 'conseiller' ? (input.canManageWorkspace ?? current.canManageWorkspace) : false,
  }
}

function person(user: User): Person {
  return { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName }
}

function toView(row: MembershipRow): WorkspaceMemberView {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    user: person(row.user),
    role: row.role as WorkspaceMemberRole,
    organization: row.organization,
    investorType: row.investorType as InvestorType | null,
    canManageWorkspace: row.canManageWorkspace,
    status: row.deactivatedAt === null ? 'active' : 'deactivated',
    awaitingFirstSignIn: row.user.emailVerifiedAt === null,
    invitedBy: row.invitedBy ? person(row.invitedBy) : null,
    invitedAt: row.createdAt,
    deactivatedAt: row.deactivatedAt,
  }
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
}
