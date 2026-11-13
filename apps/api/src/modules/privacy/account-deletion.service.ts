import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { randomUUID } from 'node:crypto'
import type { AccountDeletionRequest, Prisma, User } from '@prisma/client'
import type {
  AccountDeletionImpact,
  AccountDeletionStatus,
  AdminDeletionRequest,
  MyDeletionRequest,
} from '@confluent/shared'
import type { AppConfig } from '../../config/config.schema'
import { PrismaService } from '../../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import { EMAIL_TRANSPORT, type EmailTransport } from '../auth/email/email-transport'
import { NotificationsService } from '../notifications/notifications.service'
import { deletionImpact } from './deletion-impact'
import { PERSONAL_KEYS, pseudonymousAddress, replaceWholeValue, subjectRefOf } from './pseudonymize'
import { StorageCleanupService } from './storage-cleanup.service'

type Db = Prisma.TransactionClient
type Person = { id: string; email: string; role: string }

const notFound = () =>
  new NotFoundException({
    code: 'DELETION_REQUEST_NOT_FOUND',
    message: 'Aucune demande de suppression en attente.',
  })
const alreadyDecided = () =>
  new ConflictException({
    code: 'DELETION_REQUEST_DECIDED',
    message: 'Cette demande a déjà été traitée ou retirée : rechargez la liste.',
  })
const ownRequest = () =>
  new ConflictException({
    code: 'DELETION_REQUEST_OWN',
    message: 'Un autre administrateur doit traiter la demande de votre propre compte.',
  })

const PROCESSING_TIMEOUT_MS = 60_000

// ROADMAP E10.10 — deletion of an account: the person's request, then an administrator's decision
// (rules in @confluent/shared `privacy.schema.ts`).
//
// Every change of a request runs under the account's row lock (`users … FOR UPDATE`, the lock its
// sessions take) and the request's: a request and its withdrawal, two administrators deciding, a
// decision and a withdrawal are serialized, and each reads the state again once the lock is held.
// Processing also holds the account's companies and requests (`FOR UPDATE`): nothing can be shared,
// published, presented or added to them meanwhile (those inserts wait for the row, then fail on the
// deleted key), so the blockers read after the locks are the ones the deletion meets.
@Injectable()
export class AccountDeletionService {
  private readonly logger = new Logger(AccountDeletionService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly cleanup: StorageCleanupService,
    private readonly config: ConfigService<AppConfig, true>,
    @Inject(EMAIL_TRANSPORT) private readonly email: EmailTransport,
  ) {}

  // ── The person ────────────────────────────────────────────────────────────────────────────────

  // Their latest request, with what it would delete and what blocks it while pending; `null`: none.
  async mine(user: Person): Promise<MyDeletionRequest | null> {
    const latest = await this.prisma.accountDeletionRequest.findFirst({
      where: { userId: user.id },
      orderBy: { requestedAt: 'desc' },
    })
    if (!latest) return null
    const impact = latest.status === 'pending' ? await deletionImpact(this.prisma, user) : null
    return myView(latest, impact)
  }

  // Asked twice (a double click, a retry), the same pending request: never a second one.
  async request(user: Person): Promise<MyDeletionRequest> {
    await this.prisma.$transaction(async (tx) => {
      await lockAccount(tx, user.id)
      const pending = await tx.accountDeletionRequest.findFirst({
        where: { userId: user.id, status: 'pending' },
      })
      if (pending) return
      const id = randomUUID()
      const created = await tx.accountDeletionRequest.create({
        data: { id, userId: user.id, subjectRef: subjectRefOf(id), status: 'pending' },
      })
      await this.audit.recordIn(tx, {
        actionType: 'account_deletion_requested',
        actorId: user.id,
        metadata: { requestId: created.id },
      })
    })
    return (await this.mine(user))!
  }

  async cancel(user: Person): Promise<MyDeletionRequest> {
    await this.prisma.$transaction(async (tx) => {
      await lockAccount(tx, user.id)
      const pending = await tx.accountDeletionRequest.findFirst({
        where: { userId: user.id, status: 'pending' },
      })
      if (!pending) throw notFound()
      const changed = await tx.accountDeletionRequest.updateMany({
        where: { id: pending.id, status: 'pending' },
        data: { status: 'cancelled', decidedAt: new Date() },
      })
      if (changed.count !== 1) throw notFound()
      await this.audit.recordIn(tx, {
        actionType: 'account_deletion_cancelled',
        actorId: user.id,
        metadata: { requestId: pending.id },
      })
    })
    return (await this.mine(user))!
  }

  // ── The administrators ────────────────────────────────────────────────────────────────────────

  // `pending`: the queue, oldest first, each with its impact read now. `decided`: the 100 latest
  // decisions (the pseudonym only, once the account is deleted).
  async list(filter: 'pending' | 'decided'): Promise<AdminDeletionRequest[]> {
    const rows = await this.prisma.accountDeletionRequest.findMany({
      where:
        filter === 'pending'
          ? { status: 'pending' }
          : { status: { in: ['completed', 'declined', 'cancelled'] } },
      orderBy: filter === 'pending' ? { requestedAt: 'asc' } : { decidedAt: 'desc' },
      take: filter === 'pending' ? undefined : 100,
    })
    const userIds = [...new Set(rows.map((r) => r.userId).filter((id): id is string => !!id))]
    const users = await this.prisma.user.findMany({ where: { id: { in: userIds } } })
    const userOf = new Map(users.map((u) => [u.id, u] as const))
    const views: AdminDeletionRequest[] = []
    for (const row of rows) {
      const account = row.userId ? (userOf.get(row.userId) ?? null) : null
      const impact =
        row.status === 'pending' && account ? await deletionImpact(this.prisma, account) : null
      views.push(adminView(row, account, impact))
    }
    return views
  }

  async decline(admin: Person, requestId: string, note: string): Promise<AdminDeletionRequest> {
    const held = await this.find(requestId)
    if (held.userId === admin.id) throw ownRequest()
    const emails = await this.prisma.$transaction(async (tx) => {
      if (held.userId) await lockAccount(tx, held.userId)
      const current = await lockRequest(tx, requestId)
      if (current.status !== 'pending' || !current.userId) throw alreadyDecided()
      await tx.accountDeletionRequest.update({
        where: { id: current.id },
        data: {
          status: 'declined',
          decidedAt: new Date(),
          decidedById: admin.id,
          declineNote: note.trim(),
        },
      })
      await this.audit.recordIn(tx, {
        actionType: 'account_deletion_declined',
        actorId: admin.id,
        metadata: { requestId: current.id, subjectRef: current.subjectRef },
      })
      return this.notifications.recordIn(tx, [
        {
          recipientId: current.userId,
          kind: 'account_deletion_declined',
          key: `account_deletion_declined:${current.id}`,
          subject: `account_deletion:${current.id}`,
          payload: { requestId: current.id },
        },
      ])
    })
    await this.notifications.deliver(emails)
    return this.adminOne(requestId)
  }

  // Deletes the account in one transaction (see the rules), then tells its former address and
  // empties the storage of its files. Refused while a blocker remains (`409 DELETION_BLOCKED`, the
  // blockers in `details`) or once decided.
  async complete(admin: Person, requestId: string): Promise<AdminDeletionRequest> {
    const held = await this.find(requestId)
    if (held.userId === admin.id) throw ownRequest()
    const done = await this.prisma.$transaction(
      async (tx) => {
        if (held.userId) await lockAccount(tx, held.userId)
        const current = await lockRequest(tx, requestId)
        if (current.status !== 'pending' || !current.userId) throw alreadyDecided()
        const user = await tx.user.findUnique({ where: { id: current.userId } })
        if (!user) throw alreadyDecided()
        await tx.$queryRaw`SELECT 1 FROM "companies" WHERE "owner_id" = ${user.id} FOR UPDATE`
        await tx.$queryRaw`SELECT 1 FROM "dossiers" WHERE "user_id" = ${user.id} FOR UPDATE`
        const impact = await deletionImpact(tx, user)
        if (impact.blockers.length > 0) {
          throw new ConflictException({
            code: 'DELETION_BLOCKED',
            message:
              'Ce compte ne peut pas encore être supprimé : des demandes sont encore partagées ou présentées à une structure.',
            details: impact.blockers,
          })
        }
        const summary = await this.erase(tx, user, current, impact, admin.id)
        await this.audit.recordIn(tx, {
          actionType: 'account_deleted',
          actorId: admin.id,
          metadata: { requestId: current.id, subjectRef: current.subjectRef, ...summary },
        })
        return { email: user.email }
      },
      { timeout: PROCESSING_TIMEOUT_MS },
    )
    await this.confirm(requestId, done.email)
    // The files of its documents: queued in the transaction, removed now (or at the next run).
    void this.cleanup.drain().catch((err: Error) => {
      this.logger.warn(`storage cleanup after an account deletion failed: ${err.message}`)
    })
    return this.adminOne(requestId)
  }

  // ── Internals ─────────────────────────────────────────────────────────────────────────────────

  private async erase(
    tx: Db,
    user: User,
    request: AccountDeletionRequest,
    impact: AccountDeletionImpact,
    adminId: string,
  ): Promise<Record<string, number>> {
    const now = new Date()
    const ref = request.subjectRef
    // The journal keeps its facts without naming the person: their own entries lose their network
    // details and the words they gave an assistant…
    await tx.$executeRaw`
      UPDATE "audit_log" SET "metadata" = "metadata" - ${[...PERSONAL_KEYS]}::text[]
      WHERE "actor_id" = ${user.id} AND jsonb_exists_any("metadata", ${[...PERSONAL_KEYS]}::text[])`
    // …and their address, wherever it is a whole value of an entry (R64), becomes the pseudonym.
    const cited = await tx.$queryRaw<Array<{ id: string; metadata: unknown }>>`
      SELECT "id", "metadata" FROM "audit_log"
      WHERE position(lower(${user.email}) IN lower("metadata"::text)) > 0`
    let journalEntries = 0
    for (const entry of cited) {
      const next = replaceWholeValue(entry.metadata, user.email, ref)
      if (next === entry.metadata) continue
      await tx.auditLog.update({
        where: { id: entry.id },
        data: { metadata: next as Prisma.InputJsonValue },
      })
      journalEntries++
    }
    // The shares addressed to them: closed, and their address replaced.
    const addressed = { recipientEmail: { equals: user.email, mode: 'insensitive' as const } }
    await tx.shareLink.updateMany({
      where: { ...addressed, status: { in: ['pending', 'active'] } },
      data: { status: 'revoked', revokedAt: now },
    })
    await tx.shareLink.updateMany({
      where: addressed,
      data: { recipientEmail: pseudonymousAddress(ref) },
    })
    // What they sent from public forms with their address.
    const sameAddress = { equals: user.email, mode: 'insensitive' as const }
    const participation = await tx.participationRequest.deleteMany({
      where: { OR: [{ email: sameAddress }, { memberUserId: user.id }] },
    })
    const access = await tx.entrepreneurAccessRequest.deleteMany({
      where: { OR: [{ email: sameAddress }, { accountUserId: user.id }] },
    })
    const summary = {
      companies: impact.companies,
      requests: impact.requests,
      documents: impact.documents,
      closedCandidatures: impact.closedCandidatures,
      investorPositions: impact.investorPositions,
      memberships: impact.memberships,
      connectedApplications: impact.connectedApplications,
      sharesReceived: impact.sharesReceived,
      publicFormRequests: participation.count + access.count,
      journalEntriesPseudonymized: journalEntries,
    }
    // The request first (a completed request never points to an account), then the account and
    // everything it alone holds (foreign keys: CASCADE; SET NULL for what others keep).
    await tx.accountDeletionRequest.update({
      where: { id: request.id },
      data: {
        status: 'completed',
        userId: null,
        decidedAt: now,
        decidedById: adminId,
        summary,
      },
    })
    await tx.user.delete({ where: { id: user.id } })
    return summary
  }

  // The last message to the former address, after the commit; its outcome recorded, never thrown.
  private async confirm(requestId: string, to: string): Promise<void> {
    let outcome: 'sent' | 'failed' = 'sent'
    try {
      await this.email.sendAccountDeleted({
        to,
        privacyUrl: `${this.config.get('FRONTEND_URL', { infer: true })}/confidentialite`,
        // The only language of this version (`Locale`).
        locale: 'fr',
      })
    } catch (err) {
      outcome = 'failed'
      this.logger.warn(
        `account deletion email not sent (request ${requestId}): ${(err as Error).message}`,
      )
    }
    await this.prisma.accountDeletionRequest
      .update({ where: { id: requestId }, data: { confirmationEmail: outcome } })
      .catch((err: Error) =>
        this.logger.warn(`account deletion email outcome not recorded: ${err.message}`),
      )
  }

  private async find(requestId: string): Promise<AccountDeletionRequest> {
    const row = await this.prisma.accountDeletionRequest.findUnique({ where: { id: requestId } })
    if (!row) throw notFound()
    return row
  }

  private async adminOne(requestId: string): Promise<AdminDeletionRequest> {
    const row = await this.find(requestId)
    const account = row.userId
      ? await this.prisma.user.findUnique({ where: { id: row.userId } })
      : null
    const impact =
      row.status === 'pending' && account ? await deletionImpact(this.prisma, account) : null
    return adminView(row, account, impact)
  }
}

// The account's row: the lock its sessions take (`AuthService`), and the key every new company,
// membership or position of the account refers to.
async function lockAccount(tx: Db, userId: string): Promise<void> {
  await tx.$queryRaw`SELECT 1 FROM "users" WHERE "id" = ${userId} FOR UPDATE`
}

async function lockRequest(tx: Db, requestId: string): Promise<AccountDeletionRequest> {
  await tx.$queryRaw`SELECT 1 FROM "account_deletion_requests" WHERE "id" = ${requestId} FOR UPDATE`
  const row = await tx.accountDeletionRequest.findUnique({ where: { id: requestId } })
  if (!row) throw notFound()
  return row
}

const statusOf = (raw: string): AccountDeletionStatus =>
  (['pending', 'completed', 'declined', 'cancelled'] as const).find((s) => s === raw) ??
  // Closed by default: an unknown status reads as decided, never as pending.
  'cancelled'

function myView(
  row: AccountDeletionRequest,
  impact: AccountDeletionImpact | null,
): MyDeletionRequest {
  return {
    id: row.id,
    status: statusOf(row.status),
    requestedAt: row.requestedAt.toISOString(),
    decidedAt: row.decidedAt?.toISOString() ?? null,
    declineNote: row.declineNote,
    impact,
  }
}

function adminView(
  row: AccountDeletionRequest,
  account: User | null,
  impact: AccountDeletionImpact | null,
): AdminDeletionRequest {
  const name = account ? [account.firstName, account.lastName].filter(Boolean).join(' ') : ''
  return {
    id: row.id,
    status: statusOf(row.status),
    subjectRef: row.subjectRef,
    account: account
      ? {
          id: account.id,
          email: account.email,
          name: name || null,
          role: account.role,
          createdAt: account.createdAt.toISOString(),
        }
      : null,
    requestedAt: row.requestedAt.toISOString(),
    decidedAt: row.decidedAt?.toISOString() ?? null,
    declineNote: row.declineNote,
    summary: (row.summary as Record<string, number> | null) ?? null,
    confirmationEmail:
      row.confirmationEmail === 'sent' || row.confirmationEmail === 'failed'
        ? row.confirmationEmail
        : null,
    impact,
  }
}
