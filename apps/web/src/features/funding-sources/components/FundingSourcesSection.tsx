import { Link } from 'react-router-dom'
import { FUNDING_SOURCE_FAMILY_LABELS } from '@confluent/shared'
import { buttonVariants } from '@/components/ui/button'
import { useAsync } from '@/lib/useAsync'
import { listFundingSourceCategories } from '../api'

// ROADMAP E06.02, on a workspace's page for its conseillers (and Confluent's administrators): the
// sources its financing plans are split into, in its order. Its managers configure them on the
// workspace's « Sources de financement » page. The API checks the right at each request.
export function FundingSourcesSection({
  workspaceId,
  canManage,
}: {
  workspaceId: string
  canManage: boolean
}) {
  const query = useAsync(() => listFundingSourceCategories(workspaceId), [workspaceId])
  const active = (query.data ?? []).filter((c) => c.active)
  const inactive = (query.data ?? []).length - active.length
  return (
    <section aria-labelledby="ws-funding-sources-title" className="flex flex-col gap-3">
      <div className="flex flex-col items-start justify-between gap-2 sm:flex-row sm:items-center">
        <h2
          id="ws-funding-sources-title"
          className="font-heading text-lg font-semibold text-foreground"
        >
          Sources du plan de financement
        </h2>
        {canManage && (
          <Link
            to={`/admin/workspaces/${workspaceId}/sources`}
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            Configurer
          </Link>
        )}
      </div>
      <p className="text-sm text-muted-foreground">
        Les catégories dans lesquelles votre structure répartit le plan de financement des demandes
        qu’elle suit.
      </p>
      {query.isLoading && !query.data ? (
        <p className="text-sm text-muted-foreground">Chargement…</p>
      ) : query.error ? (
        <p role="alert" className="text-sm text-destructive">
          Impossible de charger les sources de financement. Réessayez plus tard.
        </p>
      ) : (
        <>
          <ol aria-label="Sources du plan de financement" className="flex flex-col gap-2">
            {active.map((c) => (
              <li
                key={c.id}
                className="flex flex-col gap-0.5 rounded-lg border border-border bg-card px-4 py-2 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3"
              >
                <span className="wrap-anywhere text-sm font-medium text-foreground">{c.label}</span>
                <span className="text-xs text-muted-foreground">
                  {FUNDING_SOURCE_FAMILY_LABELS[c.family]}
                </span>
              </li>
            ))}
          </ol>
          {inactive > 0 && (
            <p className="text-xs text-muted-foreground">
              {inactive} source{inactive > 1 ? 's' : ''} désactivée{inactive > 1 ? 's' : ''}.
            </p>
          )}
        </>
      )}
    </section>
  )
}
