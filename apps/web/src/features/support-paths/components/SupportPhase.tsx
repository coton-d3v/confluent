import { SUPPORT_PHASE_LABELS, type SupportPhase } from '@confluent/shared'
import { Badge } from '@/components/ui/badge'

const VARIANT: Record<SupportPhase, 'default' | 'secondary' | 'outline'> = {
  in_progress: 'outline',
  ready: 'default',
  no_path: 'secondary',
}

// ROADMAP E06.07: the phase of a candidature, as computed by the API (`supportProgress`).
export function SupportPhaseBadge({ phase }: { phase: SupportPhase }) {
  return <Badge variant={VARIANT[phase]}>{SUPPORT_PHASE_LABELS[phase]}</Badge>
}
