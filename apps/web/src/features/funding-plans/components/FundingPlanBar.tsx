import type { CSSProperties } from 'react'
import {
  FUNDING_PLAN_SEGMENT_LABELS,
  fundingPlanBar,
  type FundingPlanSegmentKind,
  type FundingPlanTotals,
} from '@confluent/shared'
import { formatAmount } from '@/features/dossiers/presentation'

// Colour AND pattern tell the segments apart (never colour alone): plain for obtained, stripes for
// in progress, dots for envisaged, thin hatching for promised, an empty dashed track for what no
// source covers.
const SEGMENT_STYLE: Record<FundingPlanSegmentKind, CSSProperties> = {
  obtained: { backgroundColor: 'var(--status-active)' },
  requested: {
    backgroundColor: 'var(--status-pending)',
    backgroundImage:
      'repeating-linear-gradient(135deg, rgba(255,255,255,0.55) 0 3px, transparent 3px 7px)',
  },
  planned: {
    backgroundColor: 'var(--chart-4)',
    backgroundImage: 'radial-gradient(var(--chart-2) 1px, transparent 1.4px)',
    backgroundSize: '5px 5px',
  },
  // E06.04: thin hatching inside the gap — a non-binding share of it, never a source.
  promised: {
    backgroundColor: 'transparent',
    backgroundImage:
      'repeating-linear-gradient(45deg, var(--chart-1) 0 1.5px, transparent 1.5px 6px)',
  },
  uncovered: { backgroundColor: 'transparent' },
}

const percent = (share: number) => `${share * 100}%`

export function SegmentSwatch({ kind }: { kind: FundingPlanSegmentKind }) {
  return (
    <span
      aria-hidden="true"
      className={
        'inline-block h-3 w-5 shrink-0 rounded-sm border ' +
        (kind === 'uncovered' ? 'border-dashed border-muted-foreground' : 'border-border')
      }
      style={SEGMENT_STYLE[kind]}
    />
  )
}

// The sentence a screen reader hears for the bar; the same figures are also written out next to it.
function describeBar(totals: FundingPlanTotals): string {
  const { segments, objectiveAt } = fundingPlanBar(totals)
  const parts = segments.map(
    (s) => `${FUNDING_PLAN_SEGMENT_LABELS[s.kind].toLowerCase()} ${formatAmount(s.amountEur)}`,
  )
  const scale =
    totals.objectiveEur === null
      ? 'sans objectif indiqué'
      : `sur un objectif de ${formatAmount(totals.objectiveEur)}`
  const beyond = objectiveAt !== null ? ', sources au-delà de l’objectif' : ''
  return `Répartition du plan ${scale} : ${parts.join(', ')}${beyond}.`
}

// ROADMAP E06.03: the segmented bar of a plan — obtained, in progress, envisaged, without source —
// on the scale `fundingPlanBar` (@confluent/shared) computes: the objective, or the sources
// identified when they exceed it, the objective then marked by a line.
export function FundingPlanBar({ totals }: { totals: FundingPlanTotals }) {
  const { segments, objectiveAt } = fundingPlanBar(totals)
  if (segments.length === 0) return null
  return (
    <div role="img" aria-label={describeBar(totals)} className="relative py-1">
      <div className="flex h-5 w-full overflow-hidden rounded-md border border-border bg-background">
        {segments.map((s) => (
          <div
            key={s.kind}
            data-segment={s.kind}
            className={
              s.kind === 'uncovered'
                ? 'border border-dashed border-muted-foreground/60 first:rounded-l-md last:rounded-r-md'
                : 'border-r border-background last:border-r-0'
            }
            style={{ ...SEGMENT_STYLE[s.kind], width: percent(s.share) }}
          />
        ))}
      </div>
      {objectiveAt !== null && (
        <div
          data-objective-marker
          className="absolute top-0 bottom-0 w-0.5 -translate-x-1/2 bg-foreground"
          style={{ left: percent(objectiveAt) }}
        />
      )}
    </div>
  )
}
