import {
  COMMITTEE_APPLICATION_STATUS_LABELS,
  type CommitteeApplicationStatus,
} from '@confluent/shared'
import { Badge } from '@/components/ui/badge'

const VARIANTS: Record<
  CommitteeApplicationStatus,
  'default' | 'secondary' | 'outline' | 'destructive'
> = {
  applied: 'secondary',
  proposed: 'secondary',
  accepted: 'default',
  refused: 'destructive',
  withdrawn: 'outline',
}

// ROADMAP E08.03: where a request's participation in a committee stands.
export function CommitteeApplicationBadge({ status }: { status: CommitteeApplicationStatus }) {
  return <Badge variant={VARIANTS[status]}>{COMMITTEE_APPLICATION_STATUS_LABELS[status]}</Badge>
}
