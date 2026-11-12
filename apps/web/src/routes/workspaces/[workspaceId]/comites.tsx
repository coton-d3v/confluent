import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import type { Committee } from '@confluent/shared'
import { buttonVariants } from '@/components/ui/button'
import { listCommittees } from '@/features/committees/api'
import { CommitteeCard } from '@/features/committees/components/CommitteeSummary'
import { isUpcoming } from '@/features/committees/format'
import {
  CommitteesTrail,
  CommitteesUnavailable,
} from '@/features/committees/components/CommitteesTrail'
import { enterWorkspace } from '@/features/workspaces/api'
import type { ApiError } from '@/lib/api-client'
import { useAsync } from '@/lib/useAsync'

// The committees of a workspace (ROADMAP E08.01), for its conseillers and Confluent's
// administrators; its managers plan them from here. The API decides who reads and who organises,
// at each request.
export default function WorkspaceCommitteesRoute() {
  const { workspaceId = '' } = useParams()
  return <WorkspaceCommittees key={workspaceId} workspaceId={workspaceId} />
}

function WorkspaceCommittees({ workspaceId }: { workspaceId: string }) {
  const entered = useAsync(() => enterWorkspace(workspaceId), [workspaceId])
  const committees = useAsync(() => listCommittees(workspaceId), [workspaceId])
  const [now] = useState(() => Date.now())
  const error = (entered.error ?? committees.error) as ApiError | null

  if (error) return <CommitteesUnavailable error={error} />
  if (!entered.data || !committees.data) {
    return <p className="pt-8 text-sm text-muted-foreground">Chargement…</p>
  }

  const { workspace, canManageWorkspace } = entered.data
  const upcoming = committees.data.filter((c) => isUpcoming(c, now))
  // The latest first.
  const past = committees.data
    .filter((c) => c.status !== 'cancelled' && !upcoming.includes(c))
    .reverse()
  const cancelled = committees.data.filter((c) => c.status === 'cancelled').reverse()

  return (
    <>
      <title>{`Comités · ${workspace.name} · Confluent`}</title>
      <CommitteesTrail workspace={workspace} />
      <div className="mt-4 flex max-w-3xl flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
        <h1 className="wrap-anywhere font-heading text-2xl font-semibold text-foreground md:text-[28px]">
          Comités
        </h1>
        {canManageWorkspace && (
          <Link
            to={`/workspaces/${workspace.id}/comites/nouveau`}
            className={buttonVariants({ size: 'sm' })}
          >
            Programmer un comité
          </Link>
        )}
      </div>
      <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
        Les sessions de pitch organisées par {workspace.name}. Chaque comité est affiché à l’heure
        de son fuseau, nommé.{' '}
        {canManageWorkspace
          ? 'Vous pouvez les programmer, les modifier et les annuler.'
          : 'Seuls les gestionnaires du workspace les programment, les modifient ou les annulent.'}
      </p>

      <div className="mt-6 flex max-w-3xl flex-col gap-6">
        <Group
          title="À venir"
          id="upcoming"
          committees={upcoming}
          now={now}
          workspaceId={workspace.id}
        >
          Aucun comité programmé à venir.
        </Group>
        <Group title="Passés" id="past" committees={past} now={now} workspaceId={workspace.id}>
          Aucun comité passé.
        </Group>
        {cancelled.length > 0 && (
          <Group
            title="Annulés"
            id="cancelled"
            committees={cancelled}
            now={now}
            workspaceId={workspace.id}
          >
            Aucun comité annulé.
          </Group>
        )}
      </div>
    </>
  )
}

function Group({
  title,
  id,
  committees,
  workspaceId,
  now,
  children,
}: {
  title: string
  id: string
  committees: Committee[]
  workspaceId: string
  now: number
  children: string
}) {
  return (
    <section aria-labelledby={`committees-${id}`} className="flex flex-col gap-3">
      <h2 id={`committees-${id}`} className="font-heading text-lg font-semibold text-foreground">
        {title}
        {committees.length > 0 && (
          <span className="ml-2 text-sm font-normal text-muted-foreground">
            ({committees.length})
          </span>
        )}
      </h2>
      {committees.length === 0 ? (
        <p className="text-sm text-muted-foreground">{children}</p>
      ) : (
        <ul aria-label={`Comités ${title.toLowerCase()}`} className="flex flex-col gap-2">
          {committees.map((committee) => (
            <CommitteeCard
              key={committee.id}
              workspaceId={workspaceId}
              committee={committee}
              now={now}
            />
          ))}
        </ul>
      )}
    </section>
  )
}
