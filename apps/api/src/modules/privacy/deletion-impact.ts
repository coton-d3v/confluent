import type { Prisma } from '@prisma/client'
import {
  CLOSED_FINANCING_STATUSES,
  financingStatusOf,
  type AccountDeletionBlockerView,
  type AccountDeletionImpact,
} from '@confluent/shared'

type Db = Prisma.TransactionClient

const OPEN_SHARE_STATUSES = ['pending', 'active'] as const

// ROADMAP E10.10: what processing a deletion request would delete, and what blocks it now (rules in
// @confluent/shared `privacy.schema.ts`). Read in the caller's transaction: the processing reads it
// again under the account's locks, after any wait (R53/R65), and refuses while a blocker remains.
// Counts and blockers only — never another person's data: the subjects are the account's own
// requests and companies.
export async function deletionImpact(
  db: Db,
  user: { id: string; email: string; role: string },
): Promise<AccountDeletionImpact> {
  const [companies, dossiers] = await Promise.all([
    db.company.findMany({
      where: { ownerId: user.id },
      select: { id: true, name: true, preparedInWorkspaceId: true },
      orderBy: { createdAt: 'asc' },
    }),
    db.dossier.findMany({
      where: { userId: user.id },
      select: { id: true, name: true, slug: true },
      orderBy: { createdAt: 'asc' },
    }),
  ])
  const companyIds = companies.map((c) => c.id)
  const dossierIds = dossiers.map((d) => d.id)
  const dossierOf = new Map(dossiers.map((d) => [d.id, d] as const))
  const [
    documents,
    openShares,
    candidatures,
    interests,
    pledges,
    memberships,
    grants,
    sharesReceived,
  ] = await Promise.all([
    db.document.count({ where: { companyId: { in: companyIds } } }),
    db.shareLink.findMany({
      where: { dossierId: { in: dossierIds }, status: { in: [...OPEN_SHARE_STATUSES] } },
      select: { dossierId: true },
    }),
    db.candidature.findMany({
      where: { dossierId: { in: dossierIds } },
      select: { id: true, dossierId: true, submittedAt: true, financingStatus: true },
      orderBy: { createdAt: 'asc' },
    }),
    db.investorInterest.count({ where: { investorId: user.id } }),
    db.investorPledge.count({ where: { investorId: user.id } }),
    db.workspaceMembership.count({ where: { userId: user.id } }),
    db.oAuthGrant.findMany({
      where: { userId: user.id, revokedAt: null, expiresAt: { gt: new Date() } },
      select: { clientId: true },
    }),
    db.shareLink.count({
      where: { recipientEmail: { equals: user.email, mode: 'insensitive' } },
    }),
  ])
  const candidatureIds = candidatures.map((c) => c.id)
  const [publications, cards, otherAdmins] = await Promise.all([
    db.poolPublication.findMany({
      where: { candidatureId: { in: candidatureIds }, withdrawnAt: null },
      select: { candidatureId: true },
    }),
    db.showcaseCard.findMany({
      where: { candidatureId: { in: candidatureIds }, withdrawnAt: null },
      select: { candidatureId: true },
    }),
    user.role === 'admin'
      ? db.user.count({ where: { role: 'admin', isActive: true, id: { not: user.id } } })
      : Promise.resolve(1),
  ])

  const blockers: AccountDeletionBlockerView[] = []
  if (user.role === 'admin' && otherAdmins === 0) {
    blockers.push({ kind: 'last_admin', subject: null, href: null })
  }
  for (const c of companies) {
    if (c.preparedInWorkspaceId) {
      blockers.push({
        kind: 'prepared_company',
        subject: c.name,
        href: `/dashboard/entreprises/${c.id}`,
      })
    }
  }
  const requestHref = (dossierId: string) =>
    `/dashboard/dossiers/view/${dossierOf.get(dossierId)?.slug ?? ''}`
  for (const dossierId of new Set(openShares.map((s) => s.dossierId))) {
    blockers.push({
      kind: 'open_share',
      subject: dossierOf.get(dossierId)?.name ?? null,
      href: requestHref(dossierId),
    })
  }
  const candidatureOf = new Map(candidatures.map((c) => [c.id, c] as const))
  const candidatureBlocker = (
    kind: 'pool_publication' | 'showcase_card' | 'open_candidature',
    candidatureId: string,
  ): AccountDeletionBlockerView => ({
    kind,
    subject: dossierOf.get(candidatureOf.get(candidatureId)?.dossierId ?? '')?.name ?? null,
    href: `/dashboard/candidatures/${candidatureId}`,
  })
  for (const p of publications)
    blockers.push(candidatureBlocker('pool_publication', p.candidatureId))
  for (const c of cards) blockers.push(candidatureBlocker('showcase_card', c.candidatureId))
  const closed = (c: (typeof candidatures)[number]) =>
    CLOSED_FINANCING_STATUSES.includes(financingStatusOf(c.financingStatus))
  for (const c of candidatures) {
    if (c.submittedAt && !closed(c)) blockers.push(candidatureBlocker('open_candidature', c.id))
  }

  return {
    companies: companies.length,
    requests: dossiers.length,
    documents,
    closedCandidatures: candidatures.filter((c) => c.submittedAt && closed(c)).length,
    investorPositions: interests + pledges,
    memberships,
    connectedApplications: new Set(grants.map((g) => g.clientId)).size,
    sharesReceived,
    blockers,
  }
}
