import { Injectable } from '@nestjs/common'
import type { AuditLog } from '@prisma/client'
import { PrismaService } from '../../prisma/prisma.service'

// The raw journal of a request, for Confluent's administrators. Its owner reads its history instead
// (E07.09, `OwnerHistoryService`): the journal through a closed list of actions, described anew.
@Injectable()
export class AuditLogService {
  constructor(private readonly prisma: PrismaService) {}

  listForAdmin(dossierId: string): Promise<AuditLog[]> {
    return this.prisma.auditLog.findMany({
      where: { dossierId },
      orderBy: { createdAt: 'desc' },
    })
  }
}
