import { createHash } from 'node:crypto'
import { Inject, Injectable } from '@nestjs/common'
import { ThrottlerStorage } from '@nestjs/throttler'
import { Prisma, type EntrepreneurAccessRequest, type User, type Workspace } from '@prisma/client'
import {
  ENTREPRENEUR_ACCESS_ADMISSIONS,
  ENTREPRENEUR_ACCESS_HONEYPOT_FIELD,
  ENTREPRENEUR_ACCESS_INVITATION_EMAIL_STATUSES,
  ENTREPRENEUR_ACCESS_REQUEST_LIMITS,
  ENTREPRENEUR_ACCESS_REQUEST_STATUSES,
  readPublicPageBlocks,
  workspaceSlugSchema,
  type EntrepreneurAccessAdmission,
  type EntrepreneurAccessInvitationEmailStatus,
  type EntrepreneurAccessRequestStatus,
  type ListEntrepreneurAccessRequestsQuery,
} from '@confluent/shared'
import { PrismaService } from '../../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import { openCandidatureFormVersion } from '../candidatures/candidatures.service'
import { WorkspaceAccessService, type WorkspaceActor } from '../workspaces/workspace-access'
import { EntrepreneurAccessErrors } from './entrepreneur-access-errors'
import { EntrepreneurAccessFormTokens } from './entrepreneur-access-form-token'

// Beyond the per-minute limit of the route (ThrottlerGuard, per network address): per hour, per
// network address and per email address (whatever the workspace). Counted in the API's memory, like
// the route's limit (per instance, reset by a restart).
export const ENTREPRENEUR_ACCESS_RATE_LIMITS = {
  perHourPerNetwork: 30,
  perHourPerAddress: 5,
} as const
const HOUR = 60 * 60 * 1000

// @confluent/shared `entrepreneurAccessFormSchema`.
export interface EntrepreneurAccessFormView {
  workspace: { name: string; programName: string | null }
  formToken: string
}

// @confluent/shared `entrepreneurAccessRequestSchema`.
export interface EntrepreneurAccessRequestView {
  id: string
  status: EntrepreneurAccessRequestStatus
  name: string
  companyName: string
  email: string
  message: string | null
  submissionCount: number
  lastSubmittedAt: Date
  createdAt: Date
  version: number
  decidedAt: Date | null
  decidedBy: { id: string; email: string; firstName: string | null; lastName: string | null } | null
  admission: EntrepreneurAccessAdmission | null
  invitationEmail: EntrepreneurAccessInvitationEmailStatus | null
  invitationEmailAt: Date | null
}

// What a valid submission brings, as validated by createEntrepreneurAccessRequestSchema.
export interface EntrepreneurAccessRequestInput {
  name: string
  companyName: string
  email: string
  message?: string | null
  formToken: string
  [ENTREPRENEUR_ACCESS_HONEYPOT_FIELD]?: string
}

// THE rule of when a workspace offers the access request form: exactly when its public page shows how
// to apply — the page published, its « apply » block shown, a candidature form published (E09.01,
// E09.04, E05.09). Closed by default: anything else, no form.
export async function offersEntrepreneurAccess(
  db: Pick<Prisma.TransactionClient, 'questionnaire' | 'questionnaireVersion'>,
  workspace: Pick<Workspace, 'id' | 'publicPagePublished' | 'publicPageBlocks'>,
): Promise<boolean> {
  if (workspace.publicPagePublished !== true) return false
  if (!readPublicPageBlocks(workspace.publicPageBlocks).includes('apply')) return false
  return (await openCandidatureFormVersion(db, workspace.id)) !== null
}

// ROADMAP E09.05 — the public entry of an entrepreneur into a workspace's candidature path, without a
// general sign-up (rules in @confluent/shared `entrepreneur-access-request.schema.ts`), and the queue
// it feeds.
//
// The form is offered only while the workspace's page shows how to apply (`offersEntrepreneurAccess`);
// any other workspace — or none under that slug — answers the same `404`. A submission records a
// pending request, or is counted on the pending request of the same address in that workspace (one
// at most, unique in the database: simultaneous first submissions end up in one). It creates no
// account, grants nothing, sends no email, and is linked to no account even if the address is one's:
// only a manager's acceptance (`EntrepreneurAccessDecisionsService`) creates or reuses an account.
//
// Every accepted submission gets the same answer — recorded, merged, or set aside because a robot
// filled the hidden field or the address sent too many —, so nobody learns from it whether an address
// already asked or holds an account. Refused, with a reason that does not depend on the address:
// invalid fields, a form token missing, sent too soon or too old, too many submissions from one
// network address, a queue full — for every address alike (R66), the cap held under concurrency by an
// advisory lock taken after the workspace's (R67).
//
// Journal: `entrepreneur_access_request_received` (the request, its version, whether merged) and
// `entrepreneur_access_request_discarded` (why), without the name, company, address or message.
// Kept out of every request owner's history.
//
// The queue is read by the workspace's managers (`canManageWorkspace`) only: other conseillers and
// investisseurs `403`, anyone outside it `404` — like the participation requests (E08.04). Not
// exposed through MCP (E09.07 decides).
@Injectable()
export class EntrepreneurAccessRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WorkspaceAccessService,
    private readonly audit: AuditService,
    private readonly tokens: EntrepreneurAccessFormTokens,
    @Inject(ThrottlerStorage) private readonly limits: ThrottlerStorage,
  ) {}

  // ── The public ───────────────────────────────────────────────────────────────────────────────

  async form(slug: string): Promise<EntrepreneurAccessFormView> {
    const now = Date.now()
    const workspace = await this.offering(slug)
    return {
      workspace: { name: workspace.name, programName: workspace.programName },
      formToken: this.tokens.issue(workspace.id, now),
    }
  }

  async submit(
    slug: string,
    input: EntrepreneurAccessRequestInput,
    sender: { ip: string | null },
  ): Promise<void> {
    const now = Date.now()
    if (await this.exceeded(`entrepreneur-access:network:${sender.ip ?? 'unknown'}`, 'network')) {
      throw EntrepreneurAccessErrors.tooManyFromNetwork()
    }
    const workspace = await this.offering(slug)
    if ((input[ENTREPRENEUR_ACCESS_HONEYPOT_FIELD] ?? '') !== '') {
      return this.discard(workspace.id, 'honeypot')
    }
    const token = this.tokens.check(input.formToken, workspace.id, now)
    if (token !== 'valid') throw EntrepreneurAccessErrors.form(token)
    // A full queue turns every valid submission away alike, before the address's quota is counted
    // (R66); checked again, atomically, when recording (R67).
    if (await this.queueFull(this.prisma, workspace.id)) throw EntrepreneurAccessErrors.queueFull()
    const address = createHash('sha256').update(input.email).digest('hex')
    if (await this.exceeded(`entrepreneur-access:address:${address}`, 'address')) {
      return this.discard(workspace.id, 'address_rate')
    }
    // Submissions to one workspace are recorded one at a time (the queue's advisory lock): a second
    // submission of an address finds the first one pending. The unique index stays the backstop.
    await this.record(workspace.id, input)
  }

  // ── The workspace's managers ─────────────────────────────────────────────────────────────────

  // The pending requests, oldest first — or the decided ones, latest decision first (at most
  // `decidedListed`).
  async listForManagers(
    actor: WorkspaceActor,
    workspaceId: string,
    query: { status?: ListEntrepreneurAccessRequestsQuery['status'] } = {},
  ): Promise<EntrepreneurAccessRequestView[]> {
    await this.access.assertCanManage(actor, workspaceId)
    const requests =
      (query.status ?? 'pending') === 'pending'
        ? await this.prisma.entrepreneurAccessRequest.findMany({
            where: { workspaceId, status: 'pending' },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          })
        : await this.prisma.entrepreneurAccessRequest.findMany({
            where: { workspaceId, status: { in: ['accepted', 'refused'] } },
            orderBy: [{ decidedAt: 'desc' }, { id: 'asc' }],
            take: ENTREPRENEUR_ACCESS_REQUEST_LIMITS.decidedListed,
          })
    return this.views(requests)
  }

  // Requests as the managers read them, with who decided them.
  async views(
    requests: EntrepreneurAccessRequest[],
    db: Prisma.TransactionClient = this.prisma,
  ): Promise<EntrepreneurAccessRequestView[]> {
    if (requests.length === 0) return []
    const deciderIds = [...new Set(requests.flatMap((r) => (r.decidedById ? [r.decidedById] : [])))]
    const deciders =
      deciderIds.length === 0 ? [] : await db.user.findMany({ where: { id: { in: deciderIds } } })
    return requests.map((request) =>
      requestView(request, deciders.find((u) => u.id === request.decidedById) ?? null),
    )
  }

  // ── Internals ────────────────────────────────────────────────────────────────────────────────

  // The workspace of a slug, if it offers the form now; `404` alike otherwise.
  private async offering(slug: string): Promise<Workspace> {
    if (!workspaceSlugSchema.safeParse(slug).success) throw EntrepreneurAccessErrors.notFound()
    const workspace = await this.prisma.workspace.findUnique({ where: { slug } })
    if (!workspace || !(await offersEntrepreneurAccess(this.prisma, workspace))) {
      throw EntrepreneurAccessErrors.notFound()
    }
    return workspace
  }

  private async queueFull(db: Prisma.TransactionClient, workspaceId: string): Promise<boolean> {
    const waiting = await db.entrepreneurAccessRequest.count({
      where: { workspaceId, status: 'pending' },
    })
    return waiting >= ENTREPRENEUR_ACCESS_REQUEST_LIMITS.pendingPerWorkspace
  }

  // Counts one more submission under `key` for the hour; true once over the limit.
  private async exceeded(key: string, kind: 'network' | 'address'): Promise<boolean> {
    const limit =
      kind === 'network'
        ? ENTREPRENEUR_ACCESS_RATE_LIMITS.perHourPerNetwork
        : ENTREPRENEUR_ACCESS_RATE_LIMITS.perHourPerAddress
    const record = await this.limits.increment(
      key,
      HOUR,
      limit,
      HOUR,
      `entrepreneur-access-${kind}`,
    )
    return record.isBlocked
  }

  private async discard(workspaceId: string, reason: 'honeypot' | 'address_rate'): Promise<void> {
    await this.audit.record({
      actionType: 'entrepreneur_access_request_discarded',
      metadata: { workspaceId, reason },
    })
  }

  private async record(workspaceId: string, input: EntrepreneurAccessRequestInput): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      // The workspace first — the lock the request's foreign key takes anyway, and the one its
      // managers' writes (page settings, decisions) take FOR UPDATE: the page read below is the one
      // in force while the request is recorded.
      await tx.$queryRaw`SELECT 1 FROM "workspaces" WHERE "id" = ${workspaceId} FOR KEY SHARE`
      // Admissions to one workspace's queue one at a time (R67): the row lock above is shared between
      // submissions, so counting then inserting would let several past the cap.
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${`entrepreneur-access-requests:${workspaceId}`}, 0))`
      const workspace = await tx.workspace.findUnique({ where: { id: workspaceId } })
      // Unpublished, block hidden or candidatures closed meanwhile: as if never offered.
      if (!workspace || !(await offersEntrepreneurAccess(tx, workspace))) {
        throw EntrepreneurAccessErrors.notFound()
      }
      if (await this.queueFull(tx, workspaceId)) throw EntrepreneurAccessErrors.queueFull()

      const now = new Date()
      const pending = await findPending(tx, workspaceId, input.email)
      // What it said first is kept; the new submission is counted.
      const request = pending
        ? await tx.entrepreneurAccessRequest.update({
            where: { id: pending.id },
            data: {
              submissionCount: pending.submissionCount + 1,
              lastSubmittedAt: now,
              version: pending.version + 1,
            },
          })
        : await tx.entrepreneurAccessRequest.create({
            data: {
              workspaceId,
              email: input.email,
              name: input.name,
              companyName: input.companyName,
              message: input.message ?? null,
              status: 'pending',
              submissionCount: 1,
              lastSubmittedAt: now,
              version: 1,
            },
          })
      await this.audit.recordIn(tx, {
        actionType: 'entrepreneur_access_request_received',
        metadata: {
          workspaceId,
          requestId: request.id,
          version: request.version,
          merged: pending !== null,
        },
      })
    })
  }
}

// The pending request of an address in a workspace, if any. Read under the queue's advisory lock,
// which every submission to the workspace holds, and the workspace's lock, which a decision holds
// against it: nothing else writes it meanwhile. Two first submissions at once meet on the unique
// index.
function findPending(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  email: string,
): Promise<EntrepreneurAccessRequest | null> {
  return tx.entrepreneurAccessRequest.findFirst({
    where: { workspaceId, email, status: 'pending' },
  })
}

// A value read from the database outside its closed list (ahead of this code): the most restrictive
// reading — an unknown status is shown as refused (nothing granted), unknown details as absent.
function oneOf<T extends string>(list: readonly T[], value: string | null, fallback: T | null) {
  return value !== null && (list as readonly string[]).includes(value) ? (value as T) : fallback
}

function requestView(
  request: EntrepreneurAccessRequest,
  decider: User | null,
): EntrepreneurAccessRequestView {
  return {
    id: request.id,
    status: oneOf(
      ENTREPRENEUR_ACCESS_REQUEST_STATUSES,
      request.status,
      'refused',
    ) as EntrepreneurAccessRequestStatus,
    name: request.name,
    companyName: request.companyName,
    email: request.email,
    message: request.message,
    submissionCount: request.submissionCount,
    lastSubmittedAt: request.lastSubmittedAt,
    createdAt: request.createdAt,
    version: request.version,
    decidedAt: request.decidedAt,
    decidedBy: decider
      ? {
          id: decider.id,
          email: decider.email,
          firstName: decider.firstName,
          lastName: decider.lastName,
        }
      : null,
    admission: oneOf(ENTREPRENEUR_ACCESS_ADMISSIONS, request.admission, null),
    invitationEmail: oneOf(
      ENTREPRENEUR_ACCESS_INVITATION_EMAIL_STATUSES,
      request.invitationEmail,
      null,
    ),
    invitationEmailAt: request.invitationEmailAt,
  }
}
