import { Inject, Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { STORAGE_TOKEN, type StorageAdapter } from '../documents/storage/storage.adapter'

// Files removed at once, per run.
const BATCH = 200

export interface StorageCleanupResult {
  deleted: number
  stillReferenced: number
  failed: number
}

// ROADMAP E10.10 — the files of deleted documents (`storage_deletions`, filled by the trigger of
// migration 20261215000000_privacy in the deleting transaction). After the commit, each queued key
// is deleted from the storage only if no document row refers to it any more (a version brought back
// shares its object), then its row goes; a failure is counted on the row and retried at the next
// run. Two runs at once delete the same object twice at worst — harmless, the storage's delete is
// idempotent.
@Injectable()
export class StorageCleanupService {
  private readonly logger = new Logger(StorageCleanupService.name)

  constructor(
    private readonly prisma: PrismaService,
    @Inject(STORAGE_TOKEN) private readonly storage: StorageAdapter,
  ) {}

  async drain(): Promise<StorageCleanupResult> {
    const queued = await this.prisma.storageDeletion.findMany({
      orderBy: { requestedAt: 'asc' },
      take: BATCH,
    })
    const result: StorageCleanupResult = { deleted: 0, stillReferenced: 0, failed: 0 }
    for (const { storageKey } of queued) {
      const used = await this.prisma.document.count({ where: { storageKey } })
      if (used > 0) {
        await this.prisma.storageDeletion.deleteMany({ where: { storageKey } })
        result.stillReferenced++
        continue
      }
      try {
        await this.storage.delete(storageKey)
        await this.prisma.storageDeletion.deleteMany({ where: { storageKey } })
        result.deleted++
      } catch (err) {
        result.failed++
        const message = (err instanceof Error ? err.message : String(err)).slice(0, 500)
        this.logger.warn(`stored file not deleted (${storageKey}): ${message}`)
        await this.prisma.storageDeletion
          .update({
            where: { storageKey },
            data: { attempts: { increment: 1 }, lastAttemptAt: new Date(), lastError: message },
          })
          .catch(() => undefined)
      }
    }
    return result
  }
}
