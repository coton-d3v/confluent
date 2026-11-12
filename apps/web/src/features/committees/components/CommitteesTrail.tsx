import { Link } from 'react-router-dom'
import type { ApiError } from '@/lib/api-client'

// Trail of a workspace's committee pages (ROADMAP E08.01): Mes workspaces / workspace / Comités /
// committee.
export function CommitteesTrail({
  workspace,
  committee,
}: {
  workspace: { id: string; name: string }
  committee?: string
}) {
  return (
    <nav aria-label="Fil d’Ariane" className="wrap-anywhere text-xs text-muted-foreground">
      <Link to="/workspaces" className="hover:underline">
        Mes workspaces
      </Link>
      {' / '}
      <Link to={`/workspaces/${workspace.id}`} className="hover:underline">
        {workspace.name}
      </Link>
      {' / '}
      {committee === undefined ? (
        <span className="text-foreground">Comités</span>
      ) : (
        <>
          <Link to={`/workspaces/${workspace.id}/comites`} className="hover:underline">
            Comités
          </Link>
          {' / '}
          <span className="text-foreground">{committee}</span>
        </>
      )}
    </nav>
  )
}

// Why a committee page cannot be shown: the API's answer, in the site's words.
export function CommitteesUnavailable({ error }: { error: ApiError | null }) {
  const message =
    error?.status === 404 || error?.status === 400
      ? 'Ce workspace ou ce comité est introuvable, ou vous n’en êtes pas membre.'
      : error?.status === 403
        ? (error.message ?? 'Accès refusé.')
        : 'Impossible de charger les comités. Réessayez plus tard.'
  return (
    <div className="flex flex-col items-start gap-2 pt-8">
      <title>Comités · Confluent</title>
      <p role="alert" className="text-sm text-foreground">
        {message}
      </p>
      <Link to="/workspaces" className="text-sm text-foreground underline underline-offset-4">
        Voir mes workspaces
      </Link>
    </div>
  )
}
