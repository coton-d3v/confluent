import { Inject, Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { EntrepreneurAccessRequest, Prisma, User, Workspace } from '@prisma/client'
import {
  canOwnCompanies,
  type EntrepreneurAccessAdmission,
  type EntrepreneurAccessDecision,
} from '@confluent/shared'
import type { AppConfig } from '../../config/config.schema'
import { PrismaService } from '../../prisma/prisma.service'
import { type ActionOrigin, channelMetadata } from '../audit/action-origin'
import { AuditService } from '../audit/audit.service'
import { EMAIL_TRANSPORT, type EmailTransport } from '../auth/email/email-transport'
import { openCandidatureFormVersion } from '../candidatures/candidatures.service'
import { WorkspaceAccessService, type WorkspaceActor } from '../workspaces/workspace-access'
import { lockWorkspaceRow } from '../workspaces/workspaces.service'
import { EntrepreneurAccessErrors } from './entrepreneur-access-errors'
import {
  EntrepreneurAccessRequestsService,
  type EntrepreneurAccessRequestView,
} from './entrepreneur-access-requests.service'

export interface DecideEntrepreneurAccessInput {
  decision: EntrepreneurAccessDecision
  version: number
}

export interface EntrepreneurAccessDecisionResult {
  request: EntrepreneurAccessRequestView
  // Whether the invitation email left; null when none was due (a refusal, or a decision this call
  // only repeated).
  invitationEmailSent: boolean | null
}

// ROADMAP E09.05: the workspace's managers decide the access requests of its public page (rules in
// @confluent/shared `entrepreneur-access-request.schema.ts`) — E08.05's decision, for entrepreneurs.
//
// Who: `canManageWorkspace` (its managing conseillers and Confluent's administrators), the people
// who already decide who joins the workspace. Closed by default: other conseillers and investisseurs
// `403`, anyone outside the workspace `404`.
//
// How: one transaction locks the workspace row first (FOR UPDATE) — the first lock of the
// submissions (FOR KEY SHARE) and of every manager's write: none of them runs meanwhile — then reads
// the right (R53) and the request. A request decided meanwhile by another manager is either the same
// decision (answered as done, nothing written or sent again: idempotent) or `409`; a request changed
// since the manager read it (a new submission counted on it) `409` (R63: its version only grows).
//
// Accepting creates the address's account when it is unknown — an entrepreneur's (the role that
// owns companies and presents requests, E05.04), unverified until its first sign-in, like the
// accounts of a company transfer (E05.08) —, or keeps an existing account as it is when it may
// already present requests. It never changes an account: one that may not (an investor's, a
// deactivated one) makes the acceptance `409`. Nothing is created on the person's behalf — no
// company, request, candidature nor membership: entrepreneurs present requests to the workspace like
// any other (E05.09). The workspace must still receive candidatures (`409` otherwise: the invitation
// would point to a closed door). All of it in the same transaction as the decision: nothing granted
// unless it is recorded, and nothing before.
//
// The invitation email leaves after the transaction (an SMTP failure never undoes nor blocks a
// decision): `invitation_email` goes from `to_send` to `sent` or `failed`, read in the queue. A
// refusal sends nothing (the public form promised no email before an acceptance).
//
// Journal: `entrepreneur_access_request_decided` in the transaction — the decision, what the
// acceptance did, the account; never the name, company, address nor message (they stay in the
// request). Kept out of every request owner's history. E09.07: a decision asked through MCP is this
// same operation, its entry naming the channel and the application (`origin`), never the manager's
// words, which may name the person (they stay in the call's own entry, `mcp_tool_called`).
@Injectable()
export class EntrepreneurAccessDecisionsService {
  private readonly logger = new Logger(EntrepreneurAccessDecisionsService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WorkspaceAccessService,
    private readonly audit: AuditService,
    private readonly requests: EntrepreneurAccessRequestsService,
    private readonly config: ConfigService<AppConfig, true>,
    @Inject(EMAIL_TRANSPORT) private readonly email: EmailTransport,
  ) {}

  async decide(
    actor: WorkspaceActor,
    workspaceId: string,
    requestId: string,
    input: DecideEntrepreneurAccessInput,
    origin?: ActionOrigin,
  ): Promise<EntrepreneurAccessDecisionResult> {
    const outcome = await this.prisma.$transaction(async (tx) => {
      await lockWorkspaceRow(tx, workspaceId)
      const { workspace } = await this.access.assertCanManage(actor, workspaceId, tx)
      // Read under the workspace's lock, which every writer of a request takes first.
      const current = await tx.entrepreneurAccessRequest.findFirst({
        where: { id: requestId, workspaceId },
      })
      if (!current) throw EntrepreneurAccessErrors.requestNotFound()
      if (current.status === input.decision) return { request: current, workspace: null }
      if (current.status !== 'pending') {
        throw EntrepreneurAccessErrors.decided(
          current.status === 'accepted' ? 'accepted' : 'refused',
        )
      }
      if (current.version !== input.version) throw EntrepreneurAccessErrors.changed()

      const now = new Date()
      let admission: EntrepreneurAccessAdmission | null = null
      let accountUserId: string | null = null
      if (input.decision === 'accepted') {
        if ((await openCandidatureFormVersion(tx, workspaceId)) === null) {
          throw EntrepreneurAccessErrors.candidaturesClosed()
        }
        const { user, created } = await entrepreneurAccountIn(tx, current.email)
        if (!created && !(user.isActive && canOwnCompanies(user))) {
          throw EntrepreneurAccessErrors.accountUnsuitable()
        }
        admission = created ? 'account_created' : 'account_existing'
        accountUserId = user.id
      }
      const request = await tx.entrepreneurAccessRequest.update({
        where: { id: requestId },
        data: {
          status: input.decision,
          decidedAt: now,
          decidedById: actor.id,
          admission,
          accountUserId,
          invitationEmail: admission ? 'to_send' : null,
          invitationEmailAt: admission ? now : null,
          version: current.version + 1,
        },
      })
      await this.audit.recordIn(tx, {
        actionType: 'entrepreneur_access_request_decided',
        actorId: actor.id,
        metadata: {
          workspaceId,
          requestId,
          version: request.version,
          decision: input.decision,
          admission,
          accountUserId,
          ...(origin ? channelMetadata(origin) : {}),
        },
      })
      return { request, workspace }
    })

    let invitationEmailSent: boolean | null = null
    let request = outcome.request
    if (outcome.workspace && request.status === 'accepted') {
      invitationEmailSent = await this.sendInvitation(request, outcome.workspace)
      request = await this.recordEmail(request, invitationEmailSent)
    }
    const [view] = await this.requests.views([request])
    return { request: view, invitationEmailSent }
  }

  // Best effort, like a membership invitation: the decision stands whether or not the email leaves;
  // the person can sign in with their address from the sign-in page anyway.
  private async sendInvitation(
    request: EntrepreneurAccessRequest,
    workspace: Workspace,
  ): Promise<boolean> {
    try {
      await this.email.sendEntrepreneurAccessAccepted({
        to: request.email,
        workspaceName: workspace.name,
        admission: request.admission as EntrepreneurAccessAdmission,
        signInUrl: `${this.config.get('FRONTEND_URL', { infer: true })}/auth`,
        locale: 'fr',
      })
      return true
    } catch (err) {
      this.logger.warn(
        `entrepreneur access email not sent (request ${request.id}): ${(err as Error).message}`,
      )
      return false
    }
  }

  // Only from `to_send`: the state of the email, never the decision.
  private async recordEmail(
    request: EntrepreneurAccessRequest,
    sent: boolean,
  ): Promise<EntrepreneurAccessRequest> {
    try {
      await this.prisma.entrepreneurAccessRequest.updateMany({
        where: { id: request.id, invitationEmail: 'to_send' },
        data: { invitationEmail: sent ? 'sent' : 'failed', invitationEmailAt: new Date() },
      })
      const read = await this.prisma.entrepreneurAccessRequest.findUnique({
        where: { id: request.id },
      })
      return read ?? request
    } catch (err) {
      // The decision is recorded; the email stays `to_send` (« non confirmé ») in the queue.
      this.logger.warn(
        `entrepreneur access email state not recorded (request ${request.id}): ${(err as Error).message}`,
      )
      return request
    }
  }
}

// The account of an address, created when unknown as an entrepreneur's, unverified until its first
// sign-in (as for a company transfer, E05.08). An existing account is returned untouched.
async function entrepreneurAccountIn(
  tx: Prisma.TransactionClient,
  email: string,
): Promise<{ user: User; created: boolean }> {
  const created = await tx.user.createMany({
    data: [{ email, role: 'entrepreneur', isActive: true, emailVerifiedAt: null }],
    skipDuplicates: true,
  })
  const user = await tx.user.findUnique({ where: { email } })
  if (!user) throw new Error('account neither created nor found')
  return { user, created: created.count === 1 }
}
