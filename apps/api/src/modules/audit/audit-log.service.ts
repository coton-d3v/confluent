import { Injectable } from '@nestjs/common'
import type { AuditLog } from '@prisma/client'
import { PrismaService } from '../../prisma/prisma.service'

const OPS_ONLY_ACTIONS = ['rate_limit_exceeded', 'share_link_access_denied']
// What a workspace keeps for itself on a candidature (ROADMAP E06.08): its internal notes. Their
// entries carry no text, but the entrepreneur does not even learn that notes exist.
const WORKSPACE_INTERNAL_ACTIONS = ['candidature_note_updated']
// Who among a pool's investors read the request (ROADMAP E07.03): never named to its owner (D05);
// a reading through a direct share counts as that share's view (E07.08: one entry per reading
// session, `ReadingSessionsService`; the owner reads the share's sessions in `AnalyticsService`).
const INVESTOR_READINGS = ['opportunity_viewed']
// Who marked their interest, and whether they show their name (ROADMAP E07.05): the owner reads the
// count and the names shown (`InterestsService.forOwner`), never the entries, which name everyone.
const INVESTOR_INTERESTS = ['investor_interest_marked', 'investor_interest_withdrawn']
// Who pledged what (ROADMAP E07.06): the owner reads the count, the total and what each investor
// chose to show (`PledgesService.forOwner`), never the entries, which name everyone with an amount.
const INVESTOR_PLEDGES = ['investor_pledge_set', 'investor_pledge_withdrawn']
// Who showed their position to which structure (ROADMAP E07.07): the investor's choice towards that
// structure, none of the owner's business — their view is E07.05/E07.06's.
const INVESTOR_DISCLOSURES = [
  'investor_position_disclosed',
  'investor_position_disclosure_withdrawn',
]
const HIDDEN_FROM_OWNER = [
  ...OPS_ONLY_ACTIONS,
  ...WORKSPACE_INTERNAL_ACTIONS,
  ...INVESTOR_READINGS,
  ...INVESTOR_INTERESTS,
  ...INVESTOR_PLEDGES,
  ...INVESTOR_DISCLOSURES,
]

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
