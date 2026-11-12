import { Injectable, Logger, NotFoundException } from '@nestjs/common'
import {
  READING_HEARTBEAT_MAX_MS,
  READING_SESSION_GAP_MINUTES,
  READING_SESSION_MAX_ACTIVE_SECONDS,
  type Reading,
  type ReadingChannel,
  type ReadingHeartbeatResult,
} from '@confluent/shared'
import type { Prisma, ReadingSession, ShareLink } from '@prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'

export const SESSION_GAP_MS = READING_SESSION_GAP_MINUTES * 60_000
export const SESSION_MAX_ACTIVE_MS = READING_SESSION_MAX_ACTIVE_SECONDS * 1000

const sameEmail = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

const sessionNotFound = () =>
  new NotFoundException({
    code: 'READING_SESSION_NOT_FOUND',
    message: 'Consultation introuvable.',
  })

// Who reads: the signed-in account, its email read from the database at each request (`JwtStrategy`).
export interface Reader {
  id: string
  email: string
}

// What a load reads through: the page (`channel`) and the reader's direct share of the request, if
// any (the only readings measured, E07.08). `journal`: what the view's journal entry records.
export interface ReadingOpening {
  reader: Reader
  dossierId: string
  shareLinkId: string | null
  channel: ReadingChannel
  journal: Record<string, unknown>
}

// The reader and the request, held for the rest of the transaction: two loads at the same moment —
// two tabs, a redirection racing a reload — decide one after the other whether a session is open,
// and open at most one. Nothing else takes this lock.
async function lockReading(
  tx: Prisma.TransactionClient,
  readerId: string,
  dossierId: string,
): Promise<void> {
  const key = `reading:${readerId}:${dossierId}`
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`
}

// The share still opens the request to this reader: THE rule of the share link (E02.08, E07.01).
const stillShared = (link: ShareLink | null, reader: Reader) =>
  link !== null && link.status === 'active' && sameEmail(link.recipientEmail, reader.email)

// ROADMAP E07.08 — reading sessions (rules in @confluent/shared `reading.schema.ts`): what counts as a
// view, and the active time of each, decided here only.
@Injectable()
export class ReadingSessionsService {
  private readonly logger = new Logger(ReadingSessionsService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // A load of the request by its reader, whose access the caller checked: resumes the reader's
  // session through the same share (or none) while its last activity is recent, otherwise opens one —
  // a view, journaled once, its last activity its start. Returns the session to measure, `null` for a reading through pools alone
  // (never timed). Measuring never refuses a reading: a failure leaves it unmeasured.
  async open(opening: ReadingOpening): Promise<Reading | null> {
    const { reader, dossierId, shareLinkId, channel } = opening
    try {
      const session = await this.prisma.$transaction(async (tx) => {
        await lockReading(tx, reader.id, dossierId)
        const now = new Date()
        const current = await tx.readingSession.findFirst({
          where: {
            readerId: reader.id,
            dossierId,
            shareLinkId,
            lastSeenAt: { gt: new Date(now.getTime() - SESSION_GAP_MS) },
          },
          orderBy: { lastSeenAt: 'desc' },
        })
        // Resumed as it is: its last activity moves with the page's heartbeats only, so that the
        // heartbeat a closing page sends after the reload still finds the time it reports.
        if (current) return current
        const opened = await tx.readingSession.create({
          data: {
            dossierId,
            readerId: reader.id,
            shareLinkId,
            channel,
            startedAt: now,
            lastSeenAt: now,
            activeMs: shareLinkId === null ? null : 0,
          },
        })
        await this.audit.recordIn(tx, {
          actionType: channel === 'share' ? 'share_link_viewed' : 'opportunity_viewed',
          actorId: reader.id,
          dossierId,
          shareLinkId,
          metadata: { ...opening.journal, readingSessionId: opened.id },
        })
        return opened
      })
      return session.activeMs === null ? null : { id: session.id }
    } catch (err) {
      this.logger.warn(
        `Reading session not opened: ${err instanceof Error ? err.message : String(err)}`,
      )
      return null
    }
  }

  // A heartbeat of the reader's page: `activeMs` of foreground, active reading since the previous one.
  // Credited at most the time elapsed since the session's last activity — two tabs, a retry or a
  // forged heartbeat add no more than wall-clock time — and at most `READING_HEARTBEAT_MAX_MS` (the
  // schema's bound), up to the session's maximum. Only from the session's reader (anyone else: the
  // same 404 as an unknown session), on an open, measured session they still read through its share;
  // otherwise nothing is credited and the page is told the session is closed. No lock: the values are
  // written whole from the ones read, so simultaneous heartbeats keep one credit, each bounded by the
  // time elapsed — never more than wall-clock time (test/pg/reading-sessions.pg-spec.ts).
  async heartbeat(
    reader: Reader,
    sessionId: string,
    activeMs: number,
  ): Promise<ReadingHeartbeatResult> {
    const session = await this.prisma.readingSession.findUnique({ where: { id: sessionId } })
    if (!session || session.readerId !== reader.id) throw sessionNotFound()
    const now = new Date()
    const elapsed = now.getTime() - session.lastSeenAt.getTime()
    if (session.activeMs === null || session.shareLinkId === null || elapsed > SESSION_GAP_MS) {
      return { open: false }
    }
    const link = await this.prisma.shareLink.findUnique({ where: { id: session.shareLinkId } })
    if (!stillShared(link, reader)) return { open: false }
    if (activeMs > 0) {
      const credit = Math.min(activeMs, Math.max(0, elapsed), READING_HEARTBEAT_MAX_MS)
      await this.prisma.readingSession.update({
        where: { id: session.id },
        data: {
          activeMs: Math.min(SESSION_MAX_ACTIVE_MS, session.activeMs + credit),
          lastSeenAt: now > session.lastSeenAt ? now : session.lastSeenAt,
        },
      })
    }
    return { open: true }
  }

  // Every session through one of the request's direct shares, the earliest first: what its owner
  // reads (`AnalyticsService`). Never the readings through pools alone.
  shareSessions(dossierId: string): Promise<ReadingSession[]> {
    return this.prisma.readingSession.findMany({
      where: { dossierId, shareLinkId: { not: null } },
      orderBy: { startedAt: 'asc' },
    })
  }

  // The platform's views through shares since `since` (administrators' dashboard).
  countShareViewsSince(since: Date): Promise<number> {
    return this.prisma.readingSession.count({
      where: { shareLinkId: { not: null }, startedAt: { gte: since } },
    })
  }
}
