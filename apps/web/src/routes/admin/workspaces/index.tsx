import { useEffect, useRef } from 'react'
import { Link, Navigate } from 'react-router-dom'
import type { Workspace } from '@confluent/shared'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { useCurrentUser } from '@/features/current-user/context'
import { listWorkspaces } from '@/features/admin/workspaces.api'
import { useAsync } from '@/lib/useAsync'

export default function AdminWorkspacesRoute() {
  const me = useCurrentUser()
  if (me.role !== 'admin') return <Navigate to="/dashboard" replace />
  return <AdminWorkspacesList />
}

function AdminWorkspacesList() {
  const headingRef = useRef<HTMLHeadingElement>(null)
  const workspaces = useAsync(() => listWorkspaces(), [])

  useEffect(() => {
    headingRef.current?.focus()
  }, [])

  return (
    <>
      <title>Workspaces · Confluent</title>
      <div className="flex flex-col items-start justify-between gap-3 md:flex-row md:items-center">
        <h1
          ref={headingRef}
          tabIndex={-1}
          className="font-heading text-2xl font-semibold text-foreground md:text-[28px] focus-visible:outline-none"
        >
          Workspaces
        </h1>
        <Link to="/admin/workspaces/nouveau" className={buttonVariants({ size: 'sm' })}>
          Nouveau workspace
        </Link>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        Un workspace est l’espace d’une structure : CCI, incubateur, réseau d’investisseurs, club
        deal. Ses conseillers et investisseurs y sont invités ; ses gestionnaires en règlent les
        réglages et les membres. Ses dossiers arriveront dans une prochaine étape.
      </p>

      {workspaces.isLoading && !workspaces.data ? (
        <p className="mt-8 text-sm text-muted-foreground">Chargement…</p>
      ) : workspaces.error ? (
        <p className="mt-8 text-sm text-destructive">Impossible de charger les workspaces.</p>
      ) : workspaces.data?.length === 0 ? (
        <p className="mt-8 text-sm text-muted-foreground">Aucun workspace pour l’instant.</p>
      ) : (
        <ul role="list" className="mt-8 flex flex-col gap-3">
          {workspaces.data?.map((workspace) => (
            <WorkspaceRow key={workspace.id} workspace={workspace} />
          ))}
        </ul>
      )}
    </>
  )
}

function WorkspaceRow({ workspace }: { workspace: Workspace }) {
  return (
    <li className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3">
      <div
        aria-hidden="true"
        className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-muted text-sm font-semibold text-white"
        style={
          !workspace.logo?.url && workspace.color ? { backgroundColor: workspace.color } : undefined
        }
      >
        {workspace.logo?.url ? (
          <img src={workspace.logo.url} alt="" className="size-full object-contain p-0.5" />
        ) : (
          <span className={workspace.color ? undefined : 'text-muted-foreground'}>
            {workspace.name.charAt(0).toUpperCase()}
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Link
            to={`/admin/workspaces/${workspace.id}`}
            className="text-base font-medium text-foreground underline-offset-4 hover:underline"
          >
            {workspace.name}
          </Link>
          {workspace.programName && <Badge variant="secondary">{workspace.programName}</Badge>}
          {workspace.emailDomain && <Badge variant="outline">@{workspace.emailDomain}</Badge>}
        </div>
        <p className="mt-0.5 break-all font-mono text-xs text-muted-foreground">
          /w/{workspace.slug}
        </p>
      </div>
      <Link
        to={`/admin/workspaces/${workspace.id}/membres`}
        aria-label={`Membres de ${workspace.name}`}
        className={buttonVariants({ variant: 'outline', size: 'sm', className: 'shrink-0' })}
      >
        Membres
      </Link>
    </li>
  )
}
