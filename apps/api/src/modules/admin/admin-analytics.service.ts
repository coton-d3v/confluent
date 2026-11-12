import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { ReadingSessionsService } from '../reading-sessions/reading-sessions.service'

export interface PlatformAnalytics {
  totalDossiers: number
  activeThisMonth: number
  bySector: Array<{ sector: string | null; count: number }>
  byMaturityStage: Array<{ stage: string | null; count: number }>
  totalShareLinks: number
  totalViewsThisMonth: number
}

function startOfMonth(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0))
}

@Injectable()
export class AdminAnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly readings: ReadingSessionsService,
  ) {}

  async platform(): Promise<PlatformAnalytics> {
    const som = startOfMonth()
    const [
      totalDossiers,
      activeThisMonth,
      sectorGroups,
      maturityGroups,
      totalShareLinks,
      totalViewsThisMonth,
    ] = await Promise.all([
      this.prisma.dossier.count(),
      this.prisma.dossier.count({
        where: { OR: [{ createdAt: { gte: som } }, { updatedAt: { gte: som } }] },
      }),
      this.prisma.dossier.groupBy({
        by: ['sector'],
        _count: { _all: true },
      }),
      this.prisma.dossier.groupBy({
        by: ['maturityStage'],
        _count: { _all: true },
      }),
      this.prisma.shareLink.count({ where: { status: 'active' } }),
      // E07.08: a view is a reading session through a share (`reading.schema.ts`).
      this.readings.countShareViewsSince(som),
    ])

    const bySector = sectorGroups
      .map((g) => ({ sector: g.sector, count: g._count._all }))
      .sort((a, b) => b.count - a.count)
    const byMaturityStage = maturityGroups
      .map((g) => ({ stage: g.maturityStage, count: g._count._all }))
      .sort((a, b) => b.count - a.count)
    return {
      totalDossiers,
      activeThisMonth,
      bySector,
      byMaturityStage,
      totalShareLinks,
      totalViewsThisMonth,
    }
  }
}
