import { ConflictException } from '@nestjs/common'
import {
  POOL_PUBLICATION_BLOCKER_LABELS,
  poolPublicationState,
  poolWithdrawalReasonSchema,
  type AccessLevel,
  type PoolPauseReason,
  type PoolPublicationBlocker,
  type PoolPublicationState,
  type PoolWithdrawalReason,
} from '@confluent/shared'
import type { Candidature, PoolPublication, Prisma } from '@prisma/client'
import { grantedLevel } from '../dossiers/financeur-access'

// @confluent/shared `poolPublicationSchema`.
export interface PoolPublicationView {
  accessLevel: AccessLevel
  state: PoolPublicationState
  pausedBecause: PoolPauseReason | null
  consentedAt: Date
  withdrawnAt: Date | null
  withdrawnBecause: PoolWithdrawalReason | null
}

// A candidature's pool publication as its owner and its workspace's conseillers read it (E07.02),
// null when never published: where it stands by THE rule of the pool, given the request's
// publication and the candidature's financing status as they are now. Closed by default: an
// unexpected level reads as `public`, an unexpected reason as none.
export function poolPublicationView(
  row: PoolPublication | null | undefined,
  request: { publicationStatus: string },
  candidature: Pick<Candidature, 'submittedAt' | 'financingStatus'>,
): PoolPublicationView | null {
  if (!row) return null
  const reason = poolWithdrawalReasonSchema.safeParse(row.withdrawalReason)
  return {
    accessLevel: grantedLevel(row.accessLevel),
    ...poolPublicationState(row, request, candidature),
    consentedAt: row.consentedAt,
    withdrawnAt: row.withdrawnAt,
    withdrawnBecause: row.withdrawnAt && reason.success ? reason.data : null,
  }
}

// The pool publications of these candidatures, by candidature.
export async function poolPublicationsOf(
  db: Prisma.TransactionClient,
  candidatureIds: string[],
): Promise<Map<string, PoolPublication>> {
  if (candidatureIds.length === 0) return new Map()
  const rows = await db.poolPublication.findMany({
    where: { candidatureId: { in: candidatureIds } },
  })
  return new Map(rows.map((r) => [r.candidatureId, r]))
}

// E07.02: archiving a request closes it (E06.01) — it is diffused no further —, so it withdraws its
// active publication in every pool, in the archiving's transaction, under the request's lock taken by
// the caller (a publication waits for it, then finds the request archived). Its shares and
// candidatures stay as they are. Returns the publications withdrawn, for the journal.
export async function withdrawFromEveryPool(
  tx: Prisma.TransactionClient,
  dossierId: string,
  actorId: string,
  at: Date,
): Promise<PoolPublication[]> {
  const candidatures = await tx.candidature.findMany({ where: { dossierId } })
  if (candidatures.length === 0) return []
  const active = await tx.poolPublication.findMany({
    where: { candidatureId: { in: candidatures.map((c) => c.id) }, withdrawnAt: null },
  })
  if (active.length === 0) return []
  await tx.poolPublication.updateMany({
    where: { id: { in: active.map((p) => p.id) }, withdrawnAt: null },
    data: { withdrawnAt: at, withdrawnById: actorId, withdrawalReason: 'archived' },
  })
  return active
}

// The journal entry of a withdrawal: the request's, read by its owner.
export function withdrawalEntry(
  publication: PoolPublication,
  dossierId: string,
  actorId: string,
  reason: PoolWithdrawalReason,
) {
  return {
    actionType: 'pool_publication_withdrawn' as const,
    actorId,
    dossierId,
    metadata: {
      candidatureId: publication.candidatureId,
      workspaceId: publication.workspaceId,
      accessLevel: grantedLevel(publication.accessLevel),
      reason,
    },
  }
}

const BLOCKER_CODES: Record<PoolPublicationBlocker, string> = {
  candidature_not_sent: 'CANDIDATURE_NOT_SENT',
  request_archived: 'DOSSIER_ARCHIVED',
  request_not_published: 'DOSSIER_NOT_PUBLISHED',
  financing_closed: 'FINANCING_CLOSED',
}

// What stands in the way of a publication (or of widening its level), as the site shows it.
export const poolPublicationBlocked = (blocker: PoolPublicationBlocker) =>
  new ConflictException({
    code: BLOCKER_CODES[blocker],
    message: POOL_PUBLICATION_BLOCKER_LABELS[blocker],
  })
