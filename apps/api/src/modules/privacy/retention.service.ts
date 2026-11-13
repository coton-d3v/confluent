import { Injectable, Logger } from '@nestjs/common'
import { RETENTION_DAYS } from '@confluent/shared'
import { PrismaService } from '../../prisma/prisma.service'
import { NETWORK_KEYS } from './pseudonymize'
import { StorageCleanupService, type StorageCleanupResult } from './storage-cleanup.service'

const DAY_MS = 24 * 60 * 60 * 1000
const PURGE_TIMEOUT_MS = 120_000

export interface PurgeResult {
  magicLinks: number
  webSessions: number
  oauthRequests: number
  oauthTokens: number
  oauthGrants: number
  readNotifications: number
  journalEntriesStripped: number
  refusedPublicRequests: number
  storage: StorageCleanupResult
}

// ROADMAP E10.10 — the retention job: what `RETENTION_DAYS` (@confluent/shared) says is expired, gone.
// One transaction under an advisory lock (two instances, or a run and a manual one, never purge at
// once: the second waits, then finds nothing left); idempotent — run again, it deletes nothing more.
// Then the storage cleanup of deleted documents' files, outside the transaction (no network call
// while rows are locked). `now` is a parameter for the tests.
@Injectable()
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly cleanup: StorageCleanupService,
  ) {}

  async purge(now: Date = new Date()): Promise<PurgeResult> {
    const before = (days: number) => new Date(now.getTime() - days * DAY_MS)
    const counts = await this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended('retention-purge', 0))`
        const magicLinks = await tx.magicLinkToken.deleteMany({
          where: { expiresAt: { lt: before(RETENTION_DAYS.magicLinksAfterExpiry) } },
        })
        const webSessions = await tx.refreshSession.deleteMany({
          where: { expiresAt: { lt: before(RETENTION_DAYS.webSessionsAfterExpiry) } },
        })
        const oauthRequests = await tx.oAuthAuthorizationRequest.deleteMany({
          where: { expiresAt: { lt: before(RETENTION_DAYS.oauthRequestsAfterExpiry) } },
        })
        const oauthTokens = await tx.oAuthToken.deleteMany({
          where: { expiresAt: { lt: before(RETENTION_DAYS.oauthTokensAfterExpiry) } },
        })
        // A connection ended — revoked or expired — that long ago, with whatever tokens it had left.
        const ended = before(RETENTION_DAYS.oauthGrantsAfterEnd)
        const oauthGrants = await tx.oAuthGrant.deleteMany({
          where: { OR: [{ revokedAt: { lt: ended } }, { expiresAt: { lt: ended } }] },
        })
        const readNotifications = await tx.notification.deleteMany({
          where: {
            readAt: { not: null },
            createdAt: { lt: before(RETENTION_DAYS.readNotifications) },
          },
        })
        const journalEntriesStripped = await tx.$executeRaw`
          UPDATE "audit_log" SET "metadata" = "metadata" - ${[...NETWORK_KEYS]}::text[]
          WHERE "created_at" < ${before(RETENTION_DAYS.journalNetworkDetails)}
            AND jsonb_exists_any("metadata", ${[...NETWORK_KEYS]}::text[])`
        const refused = {
          status: 'refused',
          decidedAt: { lt: before(RETENTION_DAYS.refusedPublicRequests) },
        }
        const participation = await tx.participationRequest.deleteMany({ where: refused })
        const access = await tx.entrepreneurAccessRequest.deleteMany({ where: refused })
        return {
          magicLinks: magicLinks.count,
          webSessions: webSessions.count,
          oauthRequests: oauthRequests.count,
          oauthTokens: oauthTokens.count,
          oauthGrants: oauthGrants.count,
          readNotifications: readNotifications.count,
          journalEntriesStripped,
          refusedPublicRequests: participation.count + access.count,
        }
      },
      { timeout: PURGE_TIMEOUT_MS },
    )
    const storage = await this.cleanup.drain()
    const result = { ...counts, storage }
    this.logger.log(`retention purge: ${JSON.stringify(result)}`)
    return result
  }
}
