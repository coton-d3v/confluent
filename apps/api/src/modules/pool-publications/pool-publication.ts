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
import type { Candidature, Dossier, PoolPublication, Prisma } from '@prisma/client'
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

// A publication listed in a pool, with what makes it listed.
export interface ListedPoolPublication {
  publication: PoolPublication
  candidature: Candidature
  dossier: Dossier
}

// E07.03: the publications listed in these workspaces' pools — what their investors read —, by THE
// rule of the pool (`poolPublicationState`, @confluent/shared) applied to each publication not
// withdrawn, with its candidature and request as they are now: a paused one (request no longer
// published, financing status closed, candidature not sent) is left out like a withdrawn one.
// `dossierId` narrows them to one request. In SQL terms: `withdrawn_at IS NULL`, the candidature in
// the same workspace with `submitted_at IS NOT NULL` and `financing_status IN ('preparing',
// 'in_committee')`, the request `publication_status = 'published'`; read by plain lookups (indexes
// `pool_publications (workspace_id, withdrawn_at)`, primary keys) so that the rule is the shared one.
export async function listedPoolPublications(
  db: Prisma.TransactionClient,
  workspaceIds: ReadonlyArray<string>,
  dossierId?: string,
): Promise<ListedPoolPublication[]> {
  if (workspaceIds.length === 0) return []
  const narrowed =
    dossierId === undefined
      ? null
      : await db.candidature.findMany({
          where: { dossierId, workspaceId: { in: [...workspaceIds] } },
          select: { id: true },
        })
  if (narrowed?.length === 0) return []
  const publications = await db.poolPublication.findMany({
    where: {
      workspaceId: { in: [...workspaceIds] },
      withdrawnAt: null,
      ...(narrowed ? { candidatureId: { in: narrowed.map((c) => c.id) } } : {}),
    },
  })
  if (publications.length === 0) return []
  const candidatures = await db.candidature.findMany({
    where: { id: { in: publications.map((p) => p.candidatureId) } },
  })
  const dossiers = await db.dossier.findMany({
    where: { id: { in: [...new Set(candidatures.map((c) => c.dossierId))] } },
  })
  const candidatureById = new Map(candidatures.map((c) => [c.id, c]))
  const dossierById = new Map(dossiers.map((d) => [d.id, d]))
  return publications.flatMap((publication) => {
    const candidature = candidatureById.get(publication.candidatureId)
    if (!candidature || candidature.workspaceId !== publication.workspaceId) return []
    if (dossierId !== undefined && candidature.dossierId !== dossierId) return []
    const dossier = dossierById.get(candidature.dossierId)
    if (!dossier) return []
    const { state } = poolPublicationState(publication, dossier, candidature)
    return state === 'listed' ? [{ publication, candidature, dossier }] : []
  })
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
