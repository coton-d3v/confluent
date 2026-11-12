import type { Company, Dossier, Prisma, ShowcaseCard, User } from '@prisma/client'
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

// @confluent/shared `managedShowcaseCardSchema` (E09.03).
export interface ManagedShowcaseCardView {
  candidatureId: string
  pseudonym: string
  region: ShowcaseRegion | null
  state: ShowcaseCardState
  pausedBecause: ShowcasePauseReason | null
  consentedAt: Date
  hiddenAt: Date | null
}

// A candidature's card as its owner and its workspace's conseillers read it (E09.02), null when never
// consented: where it stands by THE rule of the cards, given the request, the candidature, the
// workspace's page and the real names its pseudonym may not be (`showcaseRealNames`) as they are now.
// Closed by default: an unexpected region reads as none, an unexpected reason as none.
export function showcaseCardView(
  row: ShowcaseCard | null | undefined,
  request: { publicationStatus: string },
  candidature: { submittedAt: Date | null; financingStatus: string },
  page: { publicPagePublished: boolean },
  realNames: ReadonlyArray<string | null>,
): ShowcaseCardView | null {
  if (!row) return null
  const reason = showcaseWithdrawalReasonSchema.safeParse(row.withdrawalReason)
  return {
    pseudonym: row.pseudonym,
    region: showcaseRegionOf(row.region),
    ...showcaseCardState(row, request, candidature, page, realNames),
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
// candidature like the pool's, E07.09). E09.07: `origin`, a withdrawal asked through MCP.
export function showcaseWithdrawalEntry(
  card: ShowcaseCard,
  dossierId: string,
  actorId: string,
  reason: ShowcaseWithdrawalReason,
  origin: Record<string, string> = {},
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
      ...origin,
    },
  }
}

// The real names a request's pseudonym may not be (E09.02 at the consent, E09.03 at each read too):
// its company's name, its title and its owner's name, either way round.
export function showcaseRealNames(
  request: Pick<Dossier, 'name'>,
  company: Pick<Company, 'name'> | null | undefined,
  owner: Pick<User, 'firstName' | 'lastName'> | null | undefined,
): Array<string | null> {
  const first = owner?.firstName ?? null
  const last = owner?.lastName ?? null
  return [
    company?.name ?? null,
    request.name,
    first && last ? `${first} ${last}` : null,
    first && last ? `${last} ${first}` : null,
  ]
}

// The same for several requests at once, by request id (one read of their companies and owners).
export async function showcaseRealNamesOf(
  db: Prisma.TransactionClient,
  requests: ReadonlyArray<Pick<Dossier, 'id' | 'name' | 'companyId' | 'userId'>>,
): Promise<Map<string, Array<string | null>>> {
  if (requests.length === 0) return new Map()
  const [companies, owners] = await Promise.all([
    db.company.findMany({ where: { id: { in: [...new Set(requests.map((r) => r.companyId))] } } }),
    db.user.findMany({ where: { id: { in: [...new Set(requests.map((r) => r.userId))] } } }),
  ])
  const companyById = new Map(companies.map((c) => [c.id, c]))
  const ownerById = new Map(owners.map((u) => [u.id, u]))
  return new Map(
    requests.map((r) => [
      r.id,
      showcaseRealNames(r, companyById.get(r.companyId), ownerById.get(r.userId)),
    ]),
  )
}
