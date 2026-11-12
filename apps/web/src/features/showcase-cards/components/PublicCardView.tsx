import type { ReactNode } from 'react'
import {
  SHOWCASE_COMMITTEE_LABELS,
  SHOWCASE_REGION_LABELS,
  type PublicCard,
} from '@confluent/shared'
import { CommitteeWhen } from '@/features/committees/components/CommitteeSummary'
import { formatAmount } from '@/features/dossiers/presentation'

// ROADMAP E09.02: one request's anonymous card as the public reads it on a workspace's page — and as
// its owner previews it. Exactly the fields of the API's closed projection (`toPublicCard`):
// pseudonym, sector, region, amount sought, the plan in aggregate and the committee. Plain text,
// shown as typed.
export function PublicCardView({
  card,
  headingLevel = 3,
}: {
  // `pseudonym: null`: none chosen yet (the owner's preview).
  card: Omit<PublicCard, 'pseudonym'> & { pseudonym: string | null }
  headingLevel?: 2 | 3 | 4
}) {
  const Heading = `h${headingLevel}` as const
  const { fundingPlan, committee } = card
  const facts = [card.sector, card.region ? SHOWCASE_REGION_LABELS[card.region] : null].filter(
    (f): f is string => f !== null,
  )
  return (
    <article className="flex w-full min-w-0 flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <div className="flex min-w-0 flex-col gap-1">
        <Heading className="wrap-anywhere font-heading text-base font-semibold text-foreground">
          {card.pseudonym ?? 'Pseudonyme à choisir'}
        </Heading>
        <p className="wrap-anywhere text-sm text-muted-foreground">
          {facts.length > 0 ? facts.join(' · ') : 'Secteur et région non précisés'}
        </p>
      </div>
      <dl className="grid grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
        <Fact term="Montant recherché">{formatAmount(card.amountEur) ?? 'Non précisé'}</Fact>
        <Fact term="Obtenu">{formatAmount(fundingPlan.obtainedEur)}</Fact>
        <Fact term="En cours">{formatAmount(fundingPlan.requestedEur)}</Fact>
        <Fact term="Reste à financer">
          {formatAmount(fundingPlan.remainingEur) ?? 'Non calculé'}
        </Fact>
      </dl>
      <div className="flex min-w-0 flex-col gap-1 border-t border-border pt-3">
        <p className="text-sm font-medium text-foreground">
          {SHOWCASE_COMMITTEE_LABELS[committee.state]}
          {committee.state === 'scheduled' && (
            <span className="wrap-anywhere font-normal"> : {committee.session.name}</span>
          )}
        </p>
        {committee.state === 'scheduled' && <CommitteeWhen committee={committee.session} />}
      </div>
    </article>
  )
}

function Fact({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col">
      <dt className="text-xs text-muted-foreground">{term}</dt>
      <dd className="wrap-anywhere font-medium text-foreground tabular-nums">{children}</dd>
    </div>
  )
}
