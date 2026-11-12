import { Inject, Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { ParticipationRequest, Workspace } from '@prisma/client'
import {
  PARTICIPATION_MEMBER_ROLE,
  committeeStatusOf,
  type ParticipationAdmission,
  type ParticipationDecision,
} from '@confluent/shared'
import type { AppConfig } from '../../config/config.schema'
import { PrismaService } from '../../prisma/prisma.service'
import { type ActionOrigin, channelMetadata } from '../audit/action-origin'
import { AuditService } from '../audit/audit.service'
import { EMAIL_TRANSPORT, type EmailTransport } from '../auth/email/email-transport'
import { scheduleOf } from '../committees/committee-views'
import { WorkspaceAccessService, type WorkspaceActor } from '../workspaces/workspace-access'
import { NotificationsService } from '../notifications/notifications.service'
import { WorkspaceMembersService } from '../workspaces/workspace-members.service'
import { lockWorkspaceRow } from '../workspaces/workspaces.service'
import { ParticipationRequestErrors } from './participation-request-errors'
import {
  ParticipationRequestsService,
  type ParticipationRequestView,
} from './participation-requests.service'

export interface DecideInput {
  decision: ParticipationDecision
  version: number
}

export interface ParticipationDecisionResult {
  request: ParticipationRequestView
  // Whether the acceptance email left; null when none was due (a refusal, or a decision this call
  // only repeated).
  invitationEmailSent: boolean | null
}

// ROADMAP E08.05: the workspace's managers decide the participation requests of its public form
// (rules in @confluent/shared `participation-request.schema.ts`).
//
// Who: `canManageWorkspace` (its managing conseillers and Confluent's administrators) — the right
// that adds members to the workspace (E05.02), which an acceptance does. Closed by default: other
// conseillers and investisseurs `403`, anyone outside the workspace `404`.
//
// How: one transaction locks the workspace row first (FOR UPDATE) — the first lock of every
// membership write of the workspace and of E08.04's submissions (FOR KEY SHARE, then the queue's
// advisory lock, committees, the request): no deadlock with them, none of them runs meanwhile, so the
// queue's advisory lock is not needed here (a decision only frees a slot of the pending cap) — then
// reads the right (R53) and the request. A request decided meanwhile by another manager is
// either the same decision (answered as done, nothing written or sent again: idempotent) or `409`; a
// request changed since the manager read it — a new submission added sessions — `409` (R63: its
// version only grows). Only the email's state is written later, without the lock, on a request
// already decided (final). Accepting creates or reuses
// the account and membership (`WorkspaceMembersService.admitIn`, the members' own rules), in the
// same transaction: nothing is granted unless the decision is recorded, and nothing before it.
//
// The acceptance email leaves after the transaction (an SMTP failure never undoes nor blocks a
// decision): `invitation_email` goes from `to_send` to `sent` or `failed`, read in the queue. A
// refusal sends nothing (the public form promised no email before an acceptance).
//
// Journal: `participation_request_decided` in the transaction — the decision, what the acceptance
// did, the sessions; never the name, address nor message (they stay in the request). Kept out of
// every request owner's history. E08.07: a decision asked through MCP is this same operation, its
// entry naming the channel and the application (`origin`), never the manager's words, which may
// name the person (they stay in the call's own entry, `mcp_tool_called`).
@Injectable()
export class ParticipationDecisionsService {
  private readonly logger = new Logger(ParticipationDecisionsService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WorkspaceAccessService,
    private readonly audit: AuditService,
    private readonly members: WorkspaceMembersService,
    private readonly requests: ParticipationRequestsService,
    private readonly config: ConfigService<AppConfig, true>,
    @Inject(EMAIL_TRANSPORT) private readonly email: EmailTransport,
    private readonly notifications: NotificationsService,
  ) {}

  async decide(
    actor: WorkspaceActor,
    workspaceId: string,
    requestId: string,
    input: DecideInput,
    origin?: ActionOrigin,
  ): Promise<ParticipationDecisionResult> {
    const outcome = await this.prisma.$transaction(async (tx) => {
      await lockWorkspaceRow(tx, workspaceId)
      const { workspace } = await this.access.assertCanManage(actor, workspaceId, tx)
      // Read under the workspace's lock, which every writer of a request takes first (submissions
      // FOR KEY SHARE, decisions FOR UPDATE): no lock of its own is needed, nor a second wait.
      const current = await tx.participationRequest.findFirst({
        where: { id: requestId, workspaceId },
      })
      if (!current) throw ParticipationRequestErrors.requestNotFound()
      if (current.status === input.decision) return { request: current, decided: null }
      if (current.status !== 'pending') {
        throw ParticipationRequestErrors.decided(
          current.status === 'accepted' ? 'accepted' : 'refused',
        )
      }
      if (current.version !== input.version) throw ParticipationRequestErrors.changed()

      const now = new Date()
      let admission: ParticipationAdmission | null = null
      let memberUserId: string | null = null
      if (input.decision === 'accepted') {
        const admitted = await this.members.admitIn(tx, actor.id, workspaceId, {
          email: current.email,
          role: PARTICIPATION_MEMBER_ROLE,
          organization: current.organization,
        })
        if (admitted.admission === 'deactivated') {
          throw ParticipationRequestErrors.memberDeactivated()
        }
        admission = admitted.admission
        memberUserId = admitted.userId
      }
      const request = await tx.participationRequest.update({
        where: { id: requestId },
        data: {
          status: input.decision,
          decidedAt: now,
          decidedById: actor.id,
          admission,
          memberUserId,
          invitationEmail: admission ? 'to_send' : null,
          invitationEmailAt: admission ? now : null,
          version: current.version + 1,
        },
      })
      // E10.03: in the site only — the acceptance's own email follows, recorded with the request.
      if (memberUserId) {
        await this.notifications.recordIn(tx, [
          {
            recipientId: memberUserId,
            kind: 'participation_accepted',
            key: `participation_accepted:${requestId}`,
            subject: `participation_request:${requestId}`,
            workspaceId,
            payload: { workspaceId, workspaceName: workspace.name },
          },
        ])
      }
      const committeeIds = (
        await tx.participationRequestCommittee.findMany({ where: { requestId, workspaceId } })
      ).map((l) => l.committeeId)
      await this.audit.recordIn(tx, {
        actionType: 'participation_request_decided',
        actorId: actor.id,
        metadata: {
          workspaceId,
          requestId,
          version: request.version,
          decision: input.decision,
          admission,
          memberUserId,
          committeeIds,
          ...(origin ? channelMetadata(origin) : {}),
        },
      })
      return { request, decided: { workspace, committeeIds } }
    })

    let invitationEmailSent: boolean | null = null
    let request = outcome.request
    if (outcome.decided && request.status === 'accepted') {
      invitationEmailSent = await this.sendAcceptance(
        request,
        outcome.decided.workspace,
        outcome.decided.committeeIds,
      )
      request = await this.recordEmail(request, invitationEmailSent)
    }
    const [view] = await this.requests.views(workspaceId, [request])
    return { request: view, invitationEmailSent }
  }

  // Best effort, like a membership invitation: the decision stands whether or not the email leaves;
  // the person can sign in with their address from the sign-in page anyway.
  private async sendAcceptance(
    request: ParticipationRequest,
    workspace: Workspace,
    committeeIds: string[],
  ): Promise<boolean> {
    try {
      const committees = await this.prisma.committee.findMany({
        where: { id: { in: committeeIds }, workspaceId: workspace.id },
        orderBy: [{ startsAt: 'asc' }, { createdAt: 'asc' }],
      })
      await this.email.sendParticipationAccepted({
        to: request.email,
        workspaceName: workspace.name,
        // What the public form showed of them — name and when —, and whether one was cancelled or
        // held since.
        sessions: committees.map((c) => {
          const { date, time, timeZone } = scheduleOf(c)
          return { name: c.name, date, time, timeZone, status: committeeStatusOf(c.status) }
        }),
        admission: request.admission as ParticipationAdmission,
        signInUrl: `${this.config.get('FRONTEND_URL', { infer: true })}/auth`,
        locale: 'fr',
      })
      return true
    } catch (err) {
      this.logger.warn(
        `participation acceptance email not sent (request ${request.id}): ${(err as Error).message}`,
      )
      return false
    }
  }

  // Only from `to_send`: the state of the email, never the decision.
  private async recordEmail(
    request: ParticipationRequest,
    sent: boolean,
  ): Promise<ParticipationRequest> {
    try {
      await this.prisma.participationRequest.updateMany({
        where: { id: request.id, invitationEmail: 'to_send' },
        data: { invitationEmail: sent ? 'sent' : 'failed', invitationEmailAt: new Date() },
      })
      const read = await this.prisma.participationRequest.findUnique({ where: { id: request.id } })
      return read ?? request
    } catch (err) {
      // The decision is recorded; the email stays `to_send` (« non confirmé ») in the queue.
      this.logger.warn(
        `participation email state not recorded (request ${request.id}): ${(err as Error).message}`,
      )
      return request
    }
  }
}
