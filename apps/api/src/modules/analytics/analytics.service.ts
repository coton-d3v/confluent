import { Injectable } from '@nestjs/common'
import { READING_SESSIONS_LISTED, type ReadingChannel } from '@confluent/shared'
import type { ReadingSession, ShareLink } from '@prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { ReadingSessionsService } from '../reading-sessions/reading-sessions.service'

// @confluent/shared `readingSessionSummarySchema`.
export interface ReadingSessionSummary {
  startedAt: Date
  lastSeenAt: Date
  activeSeconds: number | null
  channel: ReadingChannel
}

// @confluent/shared `perRecipientAnalyticsSchema`.
export interface PerRecipientAnalytics {
  shareLinkId: string
  recipientEmail: string
  status: string
  viewCount: number
  firstViewedAt: Date | null
  lastViewedAt: Date | null
  activeSeconds: number | null
  measuredSessions: number
  sessions: ReadingSessionSummary[]
}

// @confluent/shared `dossierAnalyticsSchema`.
export interface DossierAnalytics {
  activeRecipients: number
  totalViews: number
  totalActiveSeconds: number | null
  avgSessionDurationSeconds: number | null
  perRecipient: PerRecipientAnalytics[]
}

const seconds = (ms: number) => Math.round(ms / 1000)
const channelOf = (channel: string): ReadingChannel =>
  channel === 'opportunity' ? 'opportunity' : 'share'

// What the owner reads of the readings of their request's direct shares (E07.08, @confluent/shared
// `reading.schema.ts`): per share, its sessions — a view each —, the first and last consultations,
// the active time of the measured sessions (those taken before E07.08 have none) and the latest
// sessions in detail; the readings through pools alone are not among them.
export function shareReadings(links: ShareLink[], sessions: ReadingSession[]): DossierAnalytics {
  const byLink = new Map<string, ReadingSession[]>()
  for (const s of sessions) {
    if (!s.shareLinkId) continue
    const own = byLink.get(s.shareLinkId) ?? []
    own.push(s)
    byLink.set(s.shareLinkId, own)
  }
  let measured = 0
  let measuredMs = 0
  const perRecipient = links.map((link): PerRecipientAnalytics => {
    const own = [...(byLink.get(link.id) ?? [])].sort(
      (a, b) => a.startedAt.getTime() - b.startedAt.getTime(),
    )
    const timed = own.filter((s) => s.activeMs !== null)
    const ownMs = timed.reduce((sum, s) => sum + (s.activeMs ?? 0), 0)
    measured += timed.length
    measuredMs += ownMs
    return {
      shareLinkId: link.id,
      recipientEmail: link.recipientEmail,
      status: link.status,
      viewCount: own.length,
      firstViewedAt: own[0]?.startedAt ?? null,
      lastViewedAt:
        own.length === 0 ? null : new Date(Math.max(...own.map((s) => s.lastSeenAt.getTime()))),
      activeSeconds: timed.length === 0 ? null : seconds(ownMs),
      measuredSessions: timed.length,
      sessions: own
        .slice(-READING_SESSIONS_LISTED)
        .reverse()
        .map((s) => ({
          startedAt: s.startedAt,
          lastSeenAt: s.lastSeenAt,
          activeSeconds: s.activeMs === null ? null : seconds(s.activeMs),
          channel: channelOf(s.channel),
        })),
    }
  })
  return {
    activeRecipients: links.filter((l) => l.status === 'active').length,
    totalViews: perRecipient.reduce((sum, r) => sum + r.viewCount, 0),
    totalActiveSeconds: measured === 0 ? null : seconds(measuredMs),
    avgSessionDurationSeconds: measured === 0 ? null : seconds(measuredMs / measured),
    perRecipient,
  }
}

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly readings: ReadingSessionsService,
  ) {}

  async forDossier(dossierId: string): Promise<DossierAnalytics> {
    const [links, sessions] = await Promise.all([
      this.prisma.shareLink.findMany({ where: { dossierId }, orderBy: { createdAt: 'desc' } }),
      this.readings.shareSessions(dossierId),
    ])
    return shareReadings(links, sessions)
  }
}
