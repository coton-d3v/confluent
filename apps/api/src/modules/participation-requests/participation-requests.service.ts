import { createHash } from 'node:crypto'
import { Inject, Injectable } from '@nestjs/common'
import { ThrottlerStorage } from '@nestjs/throttler'
import {
  Prisma,
  type Committee,
  type ParticipationRequest,
  type User,
  type Workspace,
} from '@prisma/client'
import {
  PARTICIPATION_ADMISSIONS,
  PARTICIPATION_HONEYPOT_FIELD,
  PARTICIPATION_INVITATION_EMAIL_STATUSES,
  PARTICIPATION_REQUEST_LIMITS,
  PARTICIPATION_REQUEST_STATUSES,
  committeeOpenToParticipationRequests,
  committeeStatusOf,
  toPublicCommittee,
  workspaceSlugSchema,
  type CommitteeStatus,
  type ListParticipationRequestsQuery,
  type ParticipationAdmission,
  type ParticipationInvitationEmailStatus,
  type ParticipationRequestStatus,
} from '@confluent/shared'
import { PrismaService } from '../../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import { scheduleOf, toView, type CommitteeView } from '../committees/committee-views'
import { WorkspaceAccessService, type WorkspaceActor } from '../workspaces/workspace-access'
import { ParticipationFormTokens } from './participation-form-token'
import { ParticipationRequestErrors } from './participation-request-errors'

// Beyond the per-minute limit of the route (ThrottlerGuard, per network address): per hour, per
// network address and per email address (whatever the workspace). Counted in the API's memory, like
// the route's limit (per instance, reset by a restart).
export const PARTICIPATION_RATE_LIMITS = {
  perHourPerNetwork: 30,
  perHourPerAddress: 5,
} as const
const HOUR = 60 * 60 * 1000

// @confluent/shared `participationFormSchema`.
export interface ParticipationFormView {
  workspace: { name: string; programName: string | null }
  committees: Array<Pick<CommitteeView, 'id' | 'name' | 'date' | 'time' | 'timeZone' | 'startsAt'>>
  formToken: string
}

// @confluent/shared `participationRequestSchema`.
export interface ParticipationRequestView {
  id: string
  status: ParticipationRequestStatus
  name: string
  organization: string | null
  email: string
  message: string | null
  committees: Array<{
    id: string
    name: string
    date: string
    time: string
    timeZone: string
    startsAt: string
    status: CommitteeStatus
  }>
  submissionCount: number
  lastSubmittedAt: Date
  createdAt: Date
  // E08.05.
  version: number
  decidedAt: Date | null
  decidedBy: { id: string; email: string; firstName: string | null; lastName: string | null } | null
  admission: ParticipationAdmission | null
  invitationEmail: ParticipationInvitationEmailStatus | null
  invitationEmailAt: Date | null
}

// What a valid submission brings, as validated by createParticipationRequestSchema.
export interface ParticipationRequestInput {
  name: string
  organization?: string | null
  email: string
  message?: string | null
  committeeIds: string[]
  formToken: string
  [PARTICIPATION_HONEYPOT_FIELD]?: string
}

const ORDER = [{ startsAt: 'asc' as const }, { createdAt: 'asc' as const }]

// THE sessions a workspace offers to participation requests now — opened by its managers, planned and
// not started —, soonest first: what its public form proposes, and its public page lists (E09.01).
export async function offeredCommittees(
  db: Pick<Prisma.TransactionClient, 'committee'>,
  workspaceId: string,
  now: number,
): Promise<Committee[]> {
  const rows = await db.committee.findMany({
    where: { workspaceId, participationRequestsOpen: true },
    orderBy: ORDER,
  })
  return rows.filter((c) => committeeOpenToParticipationRequests(c, now))
}

// The public participation form of a workspace (ROADMAP E08.04, rules in @confluent/shared
// `participation-request.schema.ts`), and the queue it feeds.
//
// The form offers the committees its managers opened to requests, planned and not started, each as
// `toPublicCommittee` (name and when); a workspace offering none — or none existing under that
// slug — answers the same `404`. A submission records a pending request, or adds its sessions to
// the pending request of the same address in that workspace (one at most, unique in the database:
// simultaneous first submissions end up in one). It creates no account, membership or right, sends
// no email, and is linked to no account even if the address is one's: E08.05 decides it, then only
// invites the address. Under a lock on the sessions chosen (FOR SHARE), so a session closed or
// cancelled meanwhile is either seen as such or closed after the request reached it.
//
// Every accepted submission gets the same answer — recorded, merged, or set aside because a robot
// filled the hidden field or the address sent too many —, so nobody learns from it whether an
// address already asked. Refused, with a reason that does not depend on the address: invalid
// fields, a form token missing, sent too soon or too old, a session no longer offered, too many
// submissions from one network address, a queue full — for every address alike, pending or not
// (R66), the cap held under concurrency (R67).
//
// Journal: `participation_request_received` (the request, the sessions added, whether merged) and
// `participation_request_discarded` (why), without the name, address or message (they live in the
// request, which E08.05 will keep or delete). Kept out of every request owner's history.
//
// The queue is read by the workspace's managers (`canManageWorkspace`): pending requests, or decided
// ones (E08.05, `ParticipationDecisionsService`), through MCP too (E08.07); submitting one is
// public, never through MCP.
@Injectable()
export class ParticipationRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WorkspaceAccessService,
    private readonly audit: AuditService,
    private readonly tokens: ParticipationFormTokens,
    @Inject(ThrottlerStorage) private readonly limits: ThrottlerStorage,
  ) {}

  // ── The public ───────────────────────────────────────────────────────────────────────────────

  async form(slug: string): Promise<ParticipationFormView> {
    const now = Date.now()
    const { workspace, committees } = await this.offered(slug, now)
    return {
      workspace: { name: workspace.name, programName: workspace.programName },
      committees: committees.map((c) => toPublicCommittee(toView(c))),
      formToken: this.tokens.issue(workspace.id, now),
    }
  }

  async submit(
    slug: string,
    input: ParticipationRequestInput,
    sender: { ip: string | null },
  ): Promise<void> {
    const now = Date.now()
    if (await this.exceeded(`participation:network:${sender.ip ?? 'unknown'}`, 'network')) {
      throw ParticipationRequestErrors.tooManyFromNetwork()
    }
    const { workspace, committees } = await this.offered(slug, now)
    if ((input[PARTICIPATION_HONEYPOT_FIELD] ?? '') !== '') {
      return this.discard(workspace.id, 'honeypot')
    }
    const token = this.tokens.check(input.formToken, workspace.id, now)
    if (token !== 'valid') throw ParticipationRequestErrors.form(token)
    const offered = new Set(committees.map((c) => c.id))
    const closed = input.committeeIds.filter((id) => !offered.has(id))
    if (closed.length > 0) throw ParticipationRequestErrors.committeesClosed(closed)
    // A full queue turns every valid submission away alike — new address, pending one, or one over
    // its quota —, before the address's quota is counted (code review R66: refusing only new
    // addresses told who already asked). Checked again, atomically, when recording (R67).
    if (await this.queueFull(this.prisma, workspace.id))
      throw ParticipationRequestErrors.queueFull()
    const address = createHash('sha256').update(input.email).digest('hex')
    if (await this.exceeded(`participation:address:${address}`, 'address')) {
      return this.discard(workspace.id, 'address_rate')
    }
    try {
      await this.record(workspace.id, input)
    } catch (err) {
      // Two first submissions of one address at once: the unique index let one through; the other
      // is recorded again, and now finds it pending.
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err
      await this.record(workspace.id, input)
    }
  }

  // ── The workspace's managers ─────────────────────────────────────────────────────────────────

  // The pending requests, oldest first — or the decided ones, latest decision first (at most
  // `decidedListed`) —, optionally only those asking for one committee, with the sessions each asks
  // for as they now are.
  async listForManagers(
    actor: WorkspaceActor,
    workspaceId: string,
    query: { status?: ListParticipationRequestsQuery['status']; committeeId?: string } = {},
  ): Promise<ParticipationRequestView[]> {
    await this.access.assertCanManage(actor, workspaceId)
    let only: string[] | undefined
    if (query.committeeId) {
      only = (
        await this.prisma.participationRequestCommittee.findMany({
          where: { committeeId: query.committeeId, workspaceId },
        })
      ).map((l) => l.requestId)
      if (only.length === 0) return []
    }
    const requests =
      (query.status ?? 'pending') === 'pending'
        ? await this.prisma.participationRequest.findMany({
            where: { workspaceId, status: 'pending', ...(only && { id: { in: only } }) },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          })
        : await this.prisma.participationRequest.findMany({
            where: {
              workspaceId,
              status: { in: ['accepted', 'refused'] },
              ...(only && { id: { in: only } }),
            },
            orderBy: [{ decidedAt: 'desc' }, { id: 'asc' }],
            take: PARTICIPATION_REQUEST_LIMITS.decidedListed,
          })
    return this.views(workspaceId, requests)
  }

  // Requests of one workspace as its managers read them.
  async views(
    workspaceId: string,
    requests: ParticipationRequest[],
    db: Prisma.TransactionClient = this.prisma,
  ): Promise<ParticipationRequestView[]> {
    if (requests.length === 0) return []
    const links = await db.participationRequestCommittee.findMany({
      where: { requestId: { in: requests.map((r) => r.id) }, workspaceId },
    })
    const committees = await db.committee.findMany({
      where: { id: { in: [...new Set(links.map((l) => l.committeeId))] }, workspaceId },
      orderBy: ORDER,
    })
    const deciderIds = [...new Set(requests.flatMap((r) => (r.decidedById ? [r.decidedById] : [])))]
    const deciders =
      deciderIds.length === 0 ? [] : await db.user.findMany({ where: { id: { in: deciderIds } } })
    return requests.map((request) => {
      const asked = new Set(
        links.filter((l) => l.requestId === request.id).map((l) => l.committeeId),
      )
      return requestView(
        request,
        committees.filter((c) => asked.has(c.id)),
        deciders.find((u) => u.id === request.decidedById) ?? null,
      )
    })
  }

  // ── Internals ────────────────────────────────────────────────────────────────────────────────

  // The workspace of a slug and the committees it offers now; `404` alike when there is no such
  // workspace or it offers none.
  private async offered(
    slug: string,
    now: number,
  ): Promise<{ workspace: Workspace; committees: Committee[] }> {
    if (!workspaceSlugSchema.safeParse(slug).success) throw ParticipationRequestErrors.notFound()
    const workspace = await this.prisma.workspace.findUnique({ where: { slug } })
    if (!workspace) throw ParticipationRequestErrors.notFound()
    const committees = await offeredCommittees(this.prisma, workspace.id, now)
    if (committees.length === 0) throw ParticipationRequestErrors.notFound()
    return { workspace, committees }
  }

  // Whether the workspace's queue holds as many pending requests as it may.
  private async queueFull(db: Prisma.TransactionClient, workspaceId: string): Promise<boolean> {
    const waiting = await db.participationRequest.count({
      where: { workspaceId, status: 'pending' },
    })
    return waiting >= PARTICIPATION_REQUEST_LIMITS.pendingPerWorkspace
  }

  // Counts one more submission under `key` for the hour; true once over the limit.
  private async exceeded(key: string, kind: 'network' | 'address'): Promise<boolean> {
    const limit =
      kind === 'network'
        ? PARTICIPATION_RATE_LIMITS.perHourPerNetwork
        : PARTICIPATION_RATE_LIMITS.perHourPerAddress
    const record = await this.limits.increment(key, HOUR, limit, HOUR, `participation-${kind}`)
    return record.isBlocked
  }

  private async discard(workspaceId: string, reason: 'honeypot' | 'address_rate'): Promise<void> {
    await this.audit.record({
      actionType: 'participation_request_discarded',
      metadata: { workspaceId, reason },
    })
  }

  private async record(workspaceId: string, input: ParticipationRequestInput): Promise<void> {
    const ids = input.committeeIds
    await this.prisma.$transaction(async (tx) => {
      // The workspace first — the lock the request's foreign key takes anyway —, in the order of the
      // managers' writes (workspace, then committee): taken after the committees, it would wait for
      // a manager holding the workspace while that manager waits for a committee held here.
      await tx.$queryRaw`SELECT 1 FROM "workspaces" WHERE "id" = ${workspaceId} FOR KEY SHARE`
      // Admissions to one workspace's queue one at a time (code review R67): the row locks above and
      // below are compatible between submissions, so counting then inserting let several through
      // past the cap. An advisory lock, taken by submissions only, right after the workspace's: the
      // managers never take it, the order workspace → committee stays.
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${`participation-requests:${workspaceId}`}, 0))`
      if (await this.queueFull(tx, workspaceId)) throw ParticipationRequestErrors.queueFull()
      // The sessions chosen, held against a change (closing, cancelling) until the request is in.
      await tx.$queryRaw`SELECT 1 FROM "committees" WHERE "workspace_id" = ${workspaceId} AND "id" IN (${Prisma.join(ids)}) FOR SHARE`
      const now = Date.now()
      const open = new Set(
        (await tx.committee.findMany({ where: { workspaceId, id: { in: ids } } }))
          .filter((c) => committeeOpenToParticipationRequests(c, now))
          .map((c) => c.id),
      )
      const closed = ids.filter((id) => !open.has(id))
      if (closed.length > 0) throw ParticipationRequestErrors.committeesClosed(closed)

      const pending = await lockPending(tx, workspaceId, input.email)
      let request: ParticipationRequest
      let added: string[]
      if (pending) {
        // What it said first is kept; the sessions are added.
        const asked = new Set(
          (
            await tx.participationRequestCommittee.findMany({
              where: { requestId: pending.id, workspaceId },
            })
          ).map((l) => l.committeeId),
        )
        added = ids.filter((id) => !asked.has(id))
        request = await tx.participationRequest.update({
          where: { id: pending.id },
          data: {
            submissionCount: pending.submissionCount + 1,
            lastSubmittedAt: new Date(now),
            version: pending.version + 1,
          },
        })
      } else {
        added = ids
        request = await tx.participationRequest.create({
          data: {
            workspaceId,
            email: input.email,
            name: input.name,
            organization: input.organization ?? null,
            message: input.message ?? null,
            status: 'pending',
            submissionCount: 1,
            lastSubmittedAt: new Date(now),
            version: 1,
          },
        })
      }
      if (added.length > 0) {
        await tx.participationRequestCommittee.createMany({
          data: added.map((committeeId) => ({ requestId: request.id, committeeId, workspaceId })),
        })
      }
      await this.audit.recordIn(tx, {
        actionType: 'participation_request_received',
        metadata: {
          workspaceId,
          requestId: request.id,
          version: request.version,
          merged: pending !== null,
          committeeIds: added,
        },
      })
    })
  }
}

// The pending request of an address in a workspace, locked and read after the lock (another
// submission adding to it waits, then reads what this one wrote); null when there is none — two
// first submissions at once then meet on the unique index.
async function lockPending(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  email: string,
): Promise<ParticipationRequest | null> {
  const found = await tx.participationRequest.findFirst({
    where: { workspaceId, email, status: 'pending' },
  })
  if (!found) return null
  await tx.$queryRaw`SELECT 1 FROM "participation_requests" WHERE "id" = ${found.id} FOR UPDATE`
  const locked = await tx.participationRequest.findUnique({ where: { id: found.id } })
  return locked?.status === 'pending' ? locked : null
}

// A value read from the database outside its closed list (ahead of this code): the most restrictive
// reading — an unknown status is shown as refused (nothing granted), unknown details as absent.
function oneOf<T extends string>(list: readonly T[], value: string | null, fallback: T | null) {
  return value !== null && (list as readonly string[]).includes(value) ? (value as T) : fallback
}

function requestView(
  request: ParticipationRequest,
  committees: Committee[],
  decider: User | null,
): ParticipationRequestView {
  return {
    id: request.id,
    status: oneOf(
      PARTICIPATION_REQUEST_STATUSES,
      request.status,
      'refused',
    ) as ParticipationRequestStatus,
    name: request.name,
    organization: request.organization,
    email: request.email,
    message: request.message,
    committees: committees.map((c) => {
      const { date, time, timeZone, startsAt } = scheduleOf(c)
      return {
        id: c.id,
        name: c.name,
        date,
        time,
        timeZone,
        startsAt,
        status: committeeStatusOf(c.status),
      }
    }),
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
    admission: oneOf(PARTICIPATION_ADMISSIONS, request.admission, null),
    invitationEmail: oneOf(PARTICIPATION_INVITATION_EMAIL_STATUSES, request.invitationEmail, null),
    invitationEmailAt: request.invitationEmailAt,
  }
}
