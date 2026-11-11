import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'

export interface PerRecipientAnalytics {
  shareLinkId: string
  recipientEmail: string
  status: string
  viewCount: number
  lastViewedAt: Date | null
}

export interface DossierAnalytics {
  activeRecipients: number
  totalViews: number
  avgSessionDurationSeconds: number | null
  perRecipient: PerRecipientAnalytics[]
}

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async forDossier(dossierId: string): Promise<DossierAnalytics> {
    const [shareLinks, events] = await Promise.all([
      this.prisma.shareLink.findMany({
        where: { dossierId },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.auditLog.findMany({
        where: { dossierId, actionType: { in: ['share_link_viewed', 'opportunity_viewed'] } },
        orderBy: { createdAt: 'asc' },
      }),
    ])
    // The views of the shares: through their links, and the readings of an opportunity by its
    // recipient (E07.03), each journaled once on the share — never a pool investor's reading.
    const viewEvents = events.filter(
      (e) => e.actionType === 'share_link_viewed' || e.shareLinkId !== null,
    )

    const totalViews = viewEvents.length
    const activeRecipients = shareLinks.filter((l) => l.status === 'active').length

    const viewsByLink = new Map<string, typeof viewEvents>()
    for (const event of viewEvents) {
      if (!event.shareLinkId) continue
      const bucket = viewsByLink.get(event.shareLinkId) ?? []
      bucket.push(event)
      viewsByLink.set(event.shareLinkId, bucket)
    }

    const perRecipient: PerRecipientAnalytics[] = shareLinks.map((link) => {
      const events = viewsByLink.get(link.id) ?? []
      const lastViewedAt = events.length > 0 ? events[events.length - 1].createdAt : null
      return {
        shareLinkId: link.id,
        recipientEmail: link.recipientEmail,
        status: link.status,
        viewCount: events.length,
        lastViewedAt,
      }
    })

    return {
      activeRecipients,
      totalViews,
      avgSessionDurationSeconds: null,
      perRecipient,
    }
  }
}
