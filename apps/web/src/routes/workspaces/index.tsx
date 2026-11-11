import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import {
  INVESTOR_TYPE_LABELS,
  WORKSPACE_MEMBER_ROLE_LABELS,
  type MyWorkspaceMembership,
} from '@confluent/shared'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { listMyWorkspaceMemberships } from '@/features/workspaces/api'
import { useAsync } from '@/lib/useAsync'

// The workspaces the signed-in person belongs to (ROADMAP E05.02), with their role in each: each one
// opens (E05.03); the ones they manage also lead to their settings and members.
export default function MyWorkspacesRoute() {
  const headingRef = useRef<HTMLHeadingElement>(null)
  const memberships = useAsync(() => listMyWorkspaceMemberships(), [])

  useEffect(() => {
    headingRef.current?.focus()
  }, [])

  return (
    <>
      <title>Mes workspaces · Confluent</title>
      <h1
        ref={headingRef}
        tabIndex={-1}
        className="font-heading text-2xl font-semibold text-foreground md:text-[28px] focus-visible:outline-none"
      >
        Mes workspaces
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Les structures dont vous êtes membre : CCI, incubateur, réseau d’investisseurs, club deal.
      </p>

      {memberships.isLoading && !memberships.data ? (
        <p className="mt-8 text-sm text-muted-foreground">Chargement…</p>
      ) : memberships.error ? (
        <p className="mt-8 text-sm text-destructive">Impossible de charger vos workspaces.</p>
      ) : memberships.data?.length === 0 ? (
        <p className="mt-8 text-sm text-muted-foreground">
          Vous n’êtes membre d’aucun workspace pour l’instant.
        </p>
      ) : (
        <ul role="list" className="mt-8 flex max-w-3xl flex-col gap-3">
          {memberships.data?.map((membership) => (
            <MembershipRow key={membership.id} membership={membership} />
          ))}
        </ul>
      )}
    </>
  )
}

function MembershipRow({ membership }: { membership: MyWorkspaceMembership }) {
  const { workspace } = membership
  const details = [
    membership.organization,
    membership.investorType ? INVESTOR_TYPE_LABELS[membership.investorType] : null,
  ].filter(Boolean)
  return (
    <li className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 md:flex-row md:items-center">
      <div
        aria-hidden="true"
        className="hidden size-10 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-sm font-semibold text-white md:flex"
        style={workspace.color ? { backgroundColor: workspace.color } : undefined}
      >
        <span className={workspace.color ? undefined : 'text-muted-foreground'}>
          {workspace.name.charAt(0).toUpperCase()}
        </span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="min-w-0 text-base font-medium text-foreground wrap-anywhere">
            {workspace.name}
          </span>
          {workspace.programName && (
            <Badge
              variant="outline"
              className="h-auto max-w-full whitespace-normal text-left wrap-anywhere"
            >
              {workspace.programName}
            </Badge>
          )}
        </div>
        <p className="mt-1 text-sm text-foreground">
          {WORKSPACE_MEMBER_ROLE_LABELS[membership.role]}
          {membership.canManageWorkspace ? ' · gestionnaire du workspace' : ''}
          {details.length > 0 ? ` · ${details.join(' · ')}` : ''}
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        <Link
          to={`/workspaces/${workspace.id}`}
          aria-label={`Ouvrir ${workspace.name}`}
          className={buttonVariants({ size: 'sm' })}
        >
          Ouvrir
        </Link>
        {membership.canManageWorkspace && (
          <>
            <Link
              to={`/admin/workspaces/${workspace.id}`}
              aria-label={`Réglages de ${workspace.name}`}
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              Réglages
            </Link>
            <Link
              to={`/admin/workspaces/${workspace.id}/membres`}
              aria-label={`Membres de ${workspace.name}`}
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              Membres
            </Link>
          </>
        )}
      </div>
    </li>
  )
}
