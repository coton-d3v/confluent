import { randomUUID } from 'node:crypto'
import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { Notification, Prisma } from '@prisma/client'
import {
  NOTIFICATION_EMAILED,
  NOTIFICATION_KINDS,
  NOTIFICATION_LIMITS,
  committeeNoticeKindOfNotification,
  notificationKindOf,
  type NotificationKind,
} from '@confluent/shared'
import type { AppConfig } from '../../config/config.schema'
import { PrismaService } from '../../prisma/prisma.service'
import { EMAIL_TRANSPORT, type EmailTransport } from '../auth/email/email-transport'
import { allowedPayload, notificationText, type NotificationPayload } from './notification-payloads'

// What an event tells one person. `key`: the event among the others about the same object — with the
// object's version when it has one — unique per person (`dedupKey`); `subject`: the object itself,
// whose later notification supersedes an email still unsent.
export type NotificationDraft = {
  [K in NotificationKind]: {
    recipientId: string
    kind: K
    key: string
    subject: string
    payload: NotificationPayload<K>
    workspaceId?: string | null
    dossierId?: string | null
    // A committee's change (E08.06): the committee at the version it produced, and why the person
    // is told — the entry of their request and/or their accepted participation request.
    committee?: {
      id: string
      version: number
      applicationId: string | null
      participationRequestId: string | null
    }
  }
}[NotificationKind]

// @confluent/shared `notificationSchema`.
export interface NotificationView {
  id: string
  kind: NotificationKind
  title: string
  body: string | null
  href: string | null
  createdAt: Date
  readAt: Date | null
}

// Emails sent at once by one event.
const SENDING_AT_ONCE = 4

const KNOWN_KINDS = { in: [...NOTIFICATION_KINDS] }

const notFound = () =>
  new NotFoundException({ code: 'NOTIFICATION_NOT_FOUND', message: 'Notification introuvable.' })

const badCursor = () =>
  new BadRequestException({
    code: 'NOTIFICATION_CURSOR_INVALID',
    message: 'Page de notifications invalide : rechargez la liste.',
  })

// ROADMAP E10.03 — notifications (rules in @confluent/shared `notification.schema.ts`).
//
// `recordIn` runs inside the event's transaction, after its writes, under its locks: the event
// commits with its notifications or not at all. A notification already recorded for the same event
// and person (`dedupKey`) is not recorded again — read first, then inserted ON CONFLICT DO NOTHING for
// two transactions recording the same event at once (the unique index orders them). A deactivated
// account is told nothing. It returns the notifications whose email the caller sends after its commit.
//
// `deliver` runs after the commit and never throws (an SMTP failure never undoes nor blocks the
// event): each email is claimed (`to_send` → `sending`, conditional: never sent twice, even by two
// senders, nor once superseded), sent, then recorded `sent` or `failed`. A crash in between leaves
// `to_send` or `sending`, never shown as sent. No retry: the in-app notification holds the same
// information.
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<AppConfig, true>,
    @Inject(EMAIL_TRANSPORT) private readonly email: EmailTransport,
  ) {}

  async recordIn(tx: Prisma.TransactionClient, drafts: NotificationDraft[]): Promise<string[]> {
    if (drafts.length === 0) return []
    const active = new Set(
      (
        await tx.user.findMany({
          where: { id: { in: [...new Set(drafts.map((d) => d.recipientId))] }, isActive: true },
          select: { id: true },
        })
      ).map((u) => u.id),
    )
    const told = drafts.filter((d) => active.has(d.recipientId))
    if (told.length === 0) return []
    const recorded = await tx.notification.findMany({
      where: {
        recipientId: { in: told.map((d) => d.recipientId) },
        dedupKey: { in: told.map((d) => d.key) },
      },
      select: { recipientId: true, dedupKey: true },
    })
    const seen = new Set(recorded.map((r) => `${r.recipientId} ${r.dedupKey}`))
    const fresh = told.filter((d) => {
      const k = `${d.recipientId} ${d.key}`
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })
    if (fresh.length === 0) return []

    const now = new Date()
    const emailed = fresh.filter((d) => NOTIFICATION_EMAILED[d.kind])
    for (const subject of new Set(emailed.map((d) => d.subject))) {
      await tx.notification.updateMany({
        where: {
          subjectKey: subject,
          recipientId: {
            in: emailed.filter((d) => d.subject === subject).map((d) => d.recipientId),
          },
          emailState: 'to_send',
        },
        data: { emailState: 'superseded', emailStateAt: now },
      })
    }
    const rows = fresh.map((d) => ({
      id: randomUUID(),
      recipientId: d.recipientId,
      kind: d.kind,
      dedupKey: d.key,
      subjectKey: d.subject,
      workspaceId: d.workspaceId ?? null,
      dossierId: d.dossierId ?? null,
      committeeId: d.committee?.id ?? null,
      committeeVersion: d.committee?.version ?? null,
      applicationId: d.committee?.applicationId ?? null,
      participationRequestId: d.committee?.participationRequestId ?? null,
      payload: allowedPayload(d.kind, d.payload as never) as Prisma.InputJsonObject,
      emailState: NOTIFICATION_EMAILED[d.kind] ? 'to_send' : 'none',
      emailStateAt: now,
      createdAt: now,
    }))
    await tx.notification.createMany({ data: rows, skipDuplicates: true })
    const toSend = rows.filter((r) => r.emailState === 'to_send').map((r) => r.id)
    if (toSend.length === 0) return []
    // Those another transaction recorded first (same event at once) are its own to send.
    const inserted = await tx.notification.findMany({
      where: { id: { in: toSend } },
      select: { id: true },
    })
    const mine = new Set(inserted.map((r) => r.id))
    return toSend.filter((id) => mine.has(id))
  }

  async deliver(ids: string[]): Promise<void> {
    const pending = [...ids]
    const worker = async () => {
      for (let id = pending.shift(); id !== undefined; id = pending.shift()) {
        await this.deliverOne(id)
      }
    }
    await Promise.all(Array.from({ length: Math.min(SENDING_AT_ONCE, pending.length) }, worker))
  }

  // The signed-in person's notifications, the latest first, a page at a time, with their unread count.
  async list(
    user: { id: string },
    query: { cursor?: string; limit?: number },
  ): Promise<{ items: NotificationView[]; nextCursor: string | null; unreadCount: number }> {
    const limit = query.limit ?? NOTIFICATION_LIMITS.pageSize
    const after = query.cursor ? decodeCursor(query.cursor) : null
    const rows = await this.prisma.notification.findMany({
      where: {
        recipientId: user.id,
        kind: KNOWN_KINDS,
        ...(after
          ? {
              OR: [
                { createdAt: { lt: after.createdAt } },
                { createdAt: after.createdAt, id: { lt: after.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    })
    const page = rows.slice(0, limit)
    const last = page[page.length - 1]
    return {
      items: page.map(toView),
      nextCursor: rows.length > limit && last ? encodeCursor(last) : null,
      unreadCount: await this.unreadCount(user),
    }
  }

  async unreadCount(user: { id: string }): Promise<number> {
    return this.prisma.notification.count({
      where: { recipientId: user.id, readAt: null, kind: KNOWN_KINDS },
    })
  }

  // Someone else's notification is answered like an unknown one (404). Marking again changes nothing.
  async markRead(user: { id: string }, id: string): Promise<NotificationView> {
    await this.prisma.notification.updateMany({
      where: { id, recipientId: user.id, readAt: null },
      data: { readAt: new Date() },
    })
    const row = await this.prisma.notification.findFirst({
      where: { id, recipientId: user.id, kind: KNOWN_KINDS },
    })
    if (!row) throw notFound()
    return toView(row)
  }

  // Every unread notification recorded up to `until` (the list the person read): one arrived since
  // stays unread.
  async markAllRead(
    user: { id: string },
    until: Date,
  ): Promise<{ updated: number; unreadCount: number }> {
    const { count } = await this.prisma.notification.updateMany({
      where: { recipientId: user.id, readAt: null, createdAt: { lte: until } },
      data: { readAt: new Date() },
    })
    return { updated: count, unreadCount: await this.unreadCount(user) }
  }

  private async deliverOne(id: string): Promise<void> {
    try {
      const claimed = await this.prisma.notification.updateMany({
        where: { id, emailState: 'to_send' },
        data: { emailState: 'sending', emailStateAt: new Date() },
      })
      if (claimed.count !== 1) return
      const row = await this.prisma.notification.findUnique({ where: { id } })
      const recipient = row
        ? await this.prisma.user.findUnique({ where: { id: row.recipientId } })
        : null
      if (!row || !recipient) return
      let sent = true
      try {
        await this.send(row, recipient.email)
      } catch (err) {
        sent = false
        this.logger.warn(
          `notification email not sent (notification ${id}): ${(err as Error).message}`,
        )
      }
      await this.prisma.notification.updateMany({
        where: { id, emailState: 'sending' },
        data: { emailState: sent ? 'sent' : 'failed', emailStateAt: new Date() },
      })
    } catch (err) {
      // The event is recorded; the email stays `to_send` or `sending` (« non confirmé »).
      this.logger.warn(
        `notification email state not recorded (notification ${id}): ${(err as Error).message}`,
      )
    }
  }

  private async send(row: Notification, to: string): Promise<void> {
    const kind = notificationKindOf(row.kind)
    if (!kind) throw new Error(`unknown notification kind ${row.kind}`)
    const frontend = this.config.get('FRONTEND_URL', { infer: true })
    const committeeKind = committeeNoticeKindOfNotification(kind)
    if (committeeKind) {
      // E08.06's own email: the committee's name and when, never its place, link nor texts.
      const p = allowedPayload(
        kind,
        row.payload as never,
      ) as NotificationPayload<'committee_rescheduled'>
      await this.email.sendCommitteeChanged({
        to,
        kind: committeeKind,
        audience: p.audience,
        workspaceName: p.workspaceName,
        committee: { name: p.committeeName, date: p.date, time: p.time, timeZone: p.timeZone },
        previous: p.previous,
        signInUrl: `${frontend}/auth`,
        locale: 'fr',
      })
      return
    }
    const text = notificationText(kind, row.payload)
    await this.email.sendNotification({
      to,
      title: text.title,
      body: text.body,
      actionUrl: `${frontend}${text.href ?? '/dashboard'}`,
      locale: 'fr',
    })
  }
}

// The accounts managing a workspace now — the conditions of THE rule `canManageWorkspace`: an active
// conseiller holding the right; administrators aside, who are no member of it —, read in the caller's
// transaction, under the workspace's lock that membership writes take.
export async function workspaceManagers(
  tx: Prisma.TransactionClient,
  workspaceId: string,
): Promise<string[]> {
  const memberships = await tx.workspaceMembership.findMany({
    where: { workspaceId, role: 'conseiller', canManageWorkspace: true, deactivatedAt: null },
    orderBy: { createdAt: 'asc' },
  })
  return memberships.map((m) => m.userId)
}

function toView(row: Notification): NotificationView {
  const kind = notificationKindOf(row.kind)!
  return {
    id: row.id,
    kind,
    ...notificationText(kind, row.payload),
    createdAt: row.createdAt,
    readAt: row.readAt,
  }
}

// Opaque to the client: the position after which the next page starts.
function encodeCursor(row: Pick<Notification, 'createdAt' | 'id'>): string {
  return Buffer.from(`${row.createdAt.toISOString()}|${row.id}`).toString('base64url')
}

function decodeCursor(cursor: string): { createdAt: Date; id: string } {
  const [at, id, ...rest] = Buffer.from(cursor, 'base64url').toString('utf8').split('|')
  const createdAt = new Date(at ?? '')
  if (rest.length > 0 || Number.isNaN(createdAt.getTime()) || !/^[0-9a-f-]{36}$/i.test(id ?? '')) {
    throw badCursor()
  }
  return { createdAt, id }
}
