import { Injectable } from '@nestjs/common'
import {
  grantsAccess,
  poolPublicationBlocker,
  type AccessLevel,
  type PublishToPoolInput,
} from '@confluent/shared'
import { PrismaService } from '../../prisma/prisma.service'
import { SITE_ORIGIN, originMetadata } from '../audit/action-origin'
import { AuditService } from '../audit/audit.service'
import { CandidaturesService, type CandidatureView } from '../candidatures/candidatures.service'
import { grantedLevel } from '../dossiers/financeur-access'
import { DossiersService, lockDossier } from '../dossiers/dossiers.service'
import { poolPublicationBlocked, withdrawalEntry } from './pool-publication'

// ROADMAP E07.02: the publication of a financing request in the pool (« vivier ») of a workspace it
// is presented to — rules in @confluent/shared `pool-publication.schema.ts`.
//
// Only the owner of the request publishes and withdraws, through the owner access to its candidature
// (`CandidaturesService.findOwned`, 404 for anyone else — a workspace's conseillers and Confluent's
// administrators included); a company prepared by a conseiller is diffused by nobody (409, E05.08).
// Each change holds the request's lock, then the candidature's — the order of the archiving, which
// withdraws every publication of the request — and touches this candidature's publication only:
// never another workspace's, a nominative share, the candidature or the request's publication.
@Injectable()
export class PoolPublicationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly candidatures: CandidaturesService,
    private readonly dossiers: DossiersService,
    private readonly audit: AuditService,
  ) {}

  // The owner's explicit consent: publishes the request in the candidature's workspace pool at the
  // level they chose, publishes it again after a withdrawal, or changes the level of an active
  // publication. Publishing or widening needs the candidature sent, the request published and its
  // financing status open there (409 otherwise); narrowing an active publication is always possible.
  // Asking for the current level of an active publication changes nothing. Journaled
  // (`pool_publication_published`) with the levels before and after.
  async publish(
    candidatureId: string,
    userId: string,
    input: PublishToPoolInput,
  ): Promise<CandidatureView> {
    const { candidature } = await this.candidatures.findOwned(candidatureId, userId)
    await this.dossiers.getForDiffusion(candidature.dossierId, userId)
    const to = input.accessLevel
    const change = await this.prisma.$transaction(async (tx) => {
      const request = await lockDossier(tx, candidature.dossierId, userId)
      const current = await this.candidatures.lockAs(tx, { side: 'owner', userId }, candidature.id)
      const existing = await tx.poolPublication.findUnique({
        where: { candidatureId: current.id },
      })
      const from: AccessLevel | null =
        existing && existing.withdrawnAt === null ? grantedLevel(existing.accessLevel) : null
      if (from === to) return null
      if (from === null || grantsAccess(to, from)) {
        const blocker = poolPublicationBlocker(request, current)
        if (blocker) throw poolPublicationBlocked(blocker)
      }
      const consent = { accessLevel: to, consentedAt: new Date(), consentedById: userId }
      await tx.poolPublication.upsert({
        where: { candidatureId: current.id },
        create: { candidatureId: current.id, workspaceId: current.workspaceId, ...consent },
        update: { ...consent, withdrawnAt: null, withdrawnById: null, withdrawalReason: null },
      })
      return { workspaceId: current.workspaceId, from, republished: existing !== null && !from }
    })
    if (change) {
      await this.audit.record({
        actionType: 'pool_publication_published',
        actorId: userId,
        dossierId: candidature.dossierId,
        metadata: {
          // No MCP tool publishes in a pool yet (E07.10): the site.
          ...originMetadata(SITE_ORIGIN),
          candidatureId: candidature.id,
          workspaceId: change.workspaceId,
          from: change.from,
          to,
          republished: change.republished,
        },
      })
    }
    return this.candidatures.getForOwner(candidature.id, userId)
  }

  // The owner withdraws the publication from this workspace's pool, effective at the investors' next
  // request. Withdrawing a publication already withdrawn, or never made, changes nothing. Journaled
  // (`pool_publication_withdrawn`, reason `owner`).
  async withdraw(candidatureId: string, userId: string): Promise<CandidatureView> {
    const { candidature } = await this.candidatures.findOwned(candidatureId, userId)
    const withdrawn = await this.prisma.$transaction(async (tx) => {
      await lockDossier(tx, candidature.dossierId, userId)
      const current = await this.candidatures.lockAs(tx, { side: 'owner', userId }, candidature.id)
      const active = await tx.poolPublication.findFirst({
        where: { candidatureId: current.id, withdrawnAt: null },
      })
      if (!active) return null
      await tx.poolPublication.update({
        where: { id: active.id },
        data: { withdrawnAt: new Date(), withdrawnById: userId, withdrawalReason: 'owner' },
      })
      return active
    })
    if (withdrawn) {
      await this.audit.record(withdrawalEntry(withdrawn, candidature.dossierId, userId, 'owner'))
    }
    return this.candidatures.getForOwner(candidature.id, userId)
  }
}
