import type { Prisma, ShowcaseCard } from '@prisma/client'
import {
  showcaseCardState,
  showcaseRegionOf,
  showcaseWithdrawalReasonSchema,
  type ShowcaseCardState,
  type ShowcasePauseReason,
  type ShowcaseRegion,
  type ShowcaseWithdrawalReason,
} from '@confluent/shared'

// @confluent/shared `showcaseCardSchema`.
export interface ShowcaseCardView {
  pseudonym: string
  region: ShowcaseRegion | null
  state: ShowcaseCardState
  pausedBecause: ShowcasePauseReason | null
  consentedAt: Date
  withdrawnAt: Date | null
  withdrawnBecause: ShowcaseWithdrawalReason | null
}

// A candidature's card as its owner and its workspace's conseillers read it (E09.02), null when never
// consented: where it stands by THE rule of the cards, given the request, the candidature and the
// workspace's page as they are now. Closed by default: an unexpected region reads as none, an
// unexpected reason as none.
export function showcaseCardView(
  row: ShowcaseCard | null | undefined,
  request: { publicationStatus: string },
  candidature: { submittedAt: Date | null; financingStatus: string },
  page: { publicPagePublished: boolean },
): ShowcaseCardView | null {
  if (!row) return null
  const reason = showcaseWithdrawalReasonSchema.safeParse(row.withdrawalReason)
  return {
    pseudonym: row.pseudonym,
    region: showcaseRegionOf(row.region),
    ...showcaseCardState(row, request, candidature, page),
    consentedAt: row.consentedAt,
    withdrawnAt: row.withdrawnAt,
    withdrawnBecause: row.withdrawnAt && reason.success ? reason.data : null,
  }
}

// E09.02: archiving a request closes it (E06.01) — it is diffused no further —, so it withdraws its
// card from every workspace's page, in the archiving's transaction, under the request's lock taken by
// the caller (a consent waits for it, then finds the request archived). Unarchiving restores none.
// Each withdrawal gets a new version (never reused) and is returned for the journal.
export async function withdrawEveryShowcaseCard(
  tx: Prisma.TransactionClient,
  dossierId: string,
  actorId: string,
  at: Date,
): Promise<ShowcaseCard[]> {
  const candidatures = await tx.candidature.findMany({ where: { dossierId } })
  if (candidatures.length === 0) return []
  const active = await tx.showcaseCard.findMany({
    where: { candidatureId: { in: candidatures.map((c) => c.id) }, withdrawnAt: null },
  })
  const withdrawn: ShowcaseCard[] = []
  for (const card of active) {
    withdrawn.push(
      await tx.showcaseCard.update({
        where: { id: card.id },
        data: {
          withdrawnAt: at,
          withdrawnById: actorId,
          withdrawalReason: 'archived',
          version: card.version + 1,
        },
      }),
    )
  }
  return withdrawn
}

// The journal entry of a withdrawal: the request's (hidden from the owner's history, read on the
// candidature like the pool's, E07.09).
export function showcaseWithdrawalEntry(
  card: ShowcaseCard,
  dossierId: string,
  actorId: string,
  reason: ShowcaseWithdrawalReason,
) {
  return {
    actionType: 'showcase_card_withdrawn' as const,
    actorId,
    dossierId,
    metadata: {
      candidatureId: card.candidatureId,
      workspaceId: card.workspaceId,
      version: card.version,
      reason,
    },
  }
}
