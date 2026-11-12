import { useState } from 'react'
import { Link } from 'react-router-dom'
import { buttonVariants } from '@/components/ui/button'
import { useAsync } from '@/lib/useAsync'
import { listCommittees } from '../api'
import { isUpcoming } from '../format'
import { CommitteeCard } from './CommitteeSummary'

const SHOWN = 3

// ROADMAP E08.01, on a workspace's page for its conseillers (and Confluent's administrators): its
// next committees, the way to all of them and, for its managers, to plan one. The API checks the
// right at each request.
export function CommitteesSection({
  workspaceId,
  canManage,
}: {
  workspaceId: string
  canManage: boolean
}) {
  const query = useAsync(() => listCommittees(workspaceId), [workspaceId])
  const [now] = useState(() => Date.now())
  const upcoming = (query.data ?? []).filter((c) => isUpcoming(c, now))
  return (
    <section aria-labelledby="ws-committees-title" className="flex flex-col gap-3">
      <div className="flex flex-col items-start justify-between gap-2 sm:flex-row sm:items-center">
        <h2 id="ws-committees-title" className="font-heading text-lg font-semibold text-foreground">
          Comités
        </h2>
        <div className="flex flex-wrap gap-2">
          {canManage && (
            <Link
              to={`/workspaces/${workspaceId}/comites/nouveau`}
              className={buttonVariants({ size: 'sm' })}
            >
              Programmer un comité
            </Link>
          )}
          <Link
            to={`/workspaces/${workspaceId}/comites`}
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            Tous les comités
          </Link>
        </div>
      </div>
      {query.isLoading && !query.data ? (
        <p className="text-sm text-muted-foreground">Chargement…</p>
      ) : query.error ? (
        <p role="alert" className="text-sm text-destructive">
          Impossible de charger les comités. Réessayez plus tard.
        </p>
      ) : upcoming.length === 0 ? (
        <p className="text-sm text-muted-foreground">Aucun comité programmé à venir.</p>
      ) : (
        <>
          <ul aria-label="Prochains comités" className="flex flex-col gap-2">
            {upcoming.slice(0, SHOWN).map((committee) => (
              <CommitteeCard
                key={committee.id}
                workspaceId={workspaceId}
                committee={committee}
                now={now}
              />
            ))}
          </ul>
          {upcoming.length > SHOWN && (
            <p className="text-xs text-muted-foreground">
              Et {upcoming.length - SHOWN} autre{upcoming.length - SHOWN > 1 ? 's' : ''} à venir.
            </p>
          )}
        </>
      )}
    </section>
  )
}
