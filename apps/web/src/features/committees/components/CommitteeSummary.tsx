import { Link } from 'react-router-dom'
import { COMMITTEE_STATUS_LABELS, type Committee, type CommitteeStatus } from '@confluent/shared'
import { Badge } from '@/components/ui/badge'
import { committeeWhen, committeeZone, isOverdue, placeLine, readerWhen } from '../format'

const STATUS_VARIANTS: Record<CommitteeStatus, 'outline' | 'secondary' | 'destructive'> = {
  planned: 'outline',
  held: 'secondary',
  cancelled: 'destructive',
}

export function CommitteeStatusBadge({ status }: { status: CommitteeStatus }) {
  return <Badge variant={STATUS_VARIANTS[status]}>{COMMITTEE_STATUS_LABELS[status]}</Badge>
}

// When a committee takes place, in its own zone (named), then at the reader's if it differs.
export function CommitteeWhen({
  committee,
}: {
  committee: Pick<Committee, 'date' | 'time' | 'timeZone' | 'startsAt'>
}) {
  const reader = readerWhen(committee)
  return (
    <div className="flex flex-col gap-0.5">
      <p className="text-sm text-foreground first-letter:uppercase">{committeeWhen(committee)}</p>
      <p className="text-xs text-muted-foreground wrap-anywhere">
        Heure de {committeeZone(committee)}
      </p>
      {reader && (
        <p className="text-xs text-muted-foreground wrap-anywhere">
          Soit {reader.when} à votre heure ({reader.zone})
        </p>
      )}
    </div>
  )
}

// One committee in a list: name, status, when and where; the name leads to its page.
export function CommitteeCard({
  workspaceId,
  committee,
  now,
}: {
  workspaceId: string
  committee: Committee
  // When the list was read.
  now: number
}) {
  return (
    <li className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Link
          to={`/workspaces/${workspaceId}/comites/${committee.id}`}
          className="wrap-anywhere text-base font-medium text-foreground underline-offset-4 hover:underline"
        >
          {committee.name}
        </Link>
        <CommitteeStatusBadge status={committee.status} />
        {isOverdue(committee, now) && (
          <span className="text-xs text-muted-foreground">Date passée</span>
        )}
      </div>
      <CommitteeWhen committee={committee} />
      <p className="text-xs text-muted-foreground wrap-anywhere">{placeLine(committee)}</p>
    </li>
  )
}
