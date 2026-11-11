import { Injectable, Logger } from '@nestjs/common'
import type { Prisma, audit_action } from '@prisma/client'
import { PrismaService } from '../../prisma/prisma.service'

export interface AuditLogEntry {
  actionType: audit_action
  actorId?: string | null
  dossierId?: string | null
  shareLinkId?: string | null
  metadata?: Record<string, unknown>
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name)

  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditLogEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({ data: auditRow(entry) })
    } catch (err) {
      this.logger.warn(
        `Audit write failed for ${entry.actionType}: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  // Written in the caller's transaction, with the change it journals: committed — or rolled back —
  // together, so a concurrent request that waited for the change also reads its entry (code review
  // follow-up of E07.01: a revocation's author is read back from the journal). Not swallowed: a
  // failure undoes the change.
  async recordIn(tx: Prisma.TransactionClient, entry: AuditLogEntry): Promise<void> {
    await tx.auditLog.create({ data: auditRow(entry) })
  }
}

function auditRow(entry: AuditLogEntry) {
  return {
    actionType: entry.actionType,
    actorId: entry.actorId ?? null,
    dossierId: entry.dossierId ?? null,
    shareLinkId: entry.shareLinkId ?? null,
    metadata: (entry.metadata ?? {}) as never,
  }
}
