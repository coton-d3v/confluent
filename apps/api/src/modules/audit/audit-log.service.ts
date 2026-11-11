import { Injectable } from '@nestjs/common'
import type { AuditLog } from '@prisma/client'
import { PrismaService } from '../../prisma/prisma.service'

const OPS_ONLY_ACTIONS = ['rate_limit_exceeded', 'share_link_access_denied']
// What a workspace keeps for itself on a candidature (ROADMAP E06.08): its internal notes. Their
// entries carry no text, but the entrepreneur does not even learn that notes exist.
const WORKSPACE_INTERNAL_ACTIONS = ['candidature_note_updated']
// Who among a pool's investors read the request (ROADMAP E07.03): never named to its owner (D05);
// a reading through a direct share counts as that share's view (`AnalyticsService`).
const INVESTOR_READINGS = ['opportunity_viewed']
const HIDDEN_FROM_OWNER = [...OPS_ONLY_ACTIONS, ...WORKSPACE_INTERNAL_ACTIONS, ...INVESTOR_READINGS]

@Injectable()
export class AuditLogService {
  constructor(private readonly prisma: PrismaService) {}

  listForEntrepreneur(dossierId: string): Promise<AuditLog[]> {
    return this.prisma.auditLog.findMany({
      where: { dossierId, actionType: { notIn: HIDDEN_FROM_OWNER as never } },
      orderBy: { createdAt: 'desc' },
    })
  }

  listForAdmin(dossierId: string): Promise<AuditLog[]> {
    return this.prisma.auditLog.findMany({
      where: { dossierId },
      orderBy: { createdAt: 'desc' },
    })
  }
}
