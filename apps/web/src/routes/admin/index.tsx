import { Navigate } from 'react-router-dom'
import { MetricCard } from '@/components/confluent/MetricCard'
import { useCurrentUser } from '@/features/current-user/context'
import { getPlatformAnalytics } from '@/features/analytics/api'
import { useAsync } from '@/lib/useAsync'

export default function AdminRoute() {
  const user = useCurrentUser()
  if (user.role !== 'admin') return <Navigate to="/dashboard" replace />
  return <AdminPipeline />
}

// Its own component: the analytics are requested for an admin only, hooks in the same order.
function AdminPipeline() {
  const { data, isLoading, error } = useAsync(() => getPlatformAnalytics(), [])

  return (
    <>
      <title>Pipeline · Confluent</title>
      <h1 className="font-heading text-2xl font-semibold text-foreground md:text-[28px]">
        Pipeline
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Vue d&apos;ensemble du pipeline régional.
      </p>

      {isLoading ? (
        <p className="mt-8 text-sm text-muted-foreground">Chargement…</p>
      ) : error || !data ? (
        <p className="mt-8 text-sm text-destructive">
          Impossible de charger le pipeline.
        </p>
      ) : (
        <>
          <section className="mt-8">
            <h2 className="sr-only">Statistiques</h2>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <MetricCard label="Dossiers total" value={data.totalDossiers.toString()} />
              <MetricCard label="Actifs ce mois" value={data.activeThisMonth.toString()} />
              <MetricCard
                label="Vues ce mois"
                value={data.totalViewsThisMonth.toString()}
              />
            </div>
          </section>

          <section className="mt-8">
            <h2 className="font-heading text-xl font-semibold text-foreground md:text-2xl">
              Répartition par secteur
            </h2>
            <div className="mt-4 overflow-hidden rounded-lg border border-border bg-card">
              {data.bySector.length === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                  Aucun dossier classifié pour le moment.
                </p>
              ) : (
                <ul role="list" className="m-0 list-none divide-y divide-border p-0">
                  {data.bySector.map((row) => (
                    <li
                      key={row.sector ?? '__null__'}
                      className="flex items-center justify-between gap-3 px-4 py-3 text-sm"
                    >
                      <span className="font-medium text-foreground">
                        {row.sector ?? 'Non classifié'}
                      </span>
                      <span className="text-muted-foreground tabular-nums">
                        {row.count} dossiers
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          <section className="mt-8">
            <h2 className="font-heading text-xl font-semibold text-foreground md:text-2xl">
              Répartition par maturité
            </h2>
            <div className="mt-4 overflow-hidden rounded-lg border border-border bg-card">
              {data.byMaturityStage.length === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                  Aucun dossier classifié pour le moment.
                </p>
              ) : (
                <ul role="list" className="m-0 list-none divide-y divide-border p-0">
                  {data.byMaturityStage.map((row) => (
                    <li
                      key={row.stage ?? '__null__'}
                      className="flex items-center justify-between gap-3 px-4 py-3 text-sm"
                    >
                      <span className="font-medium text-foreground">
                        {row.stage ?? 'Non classifié'}
                      </span>
                      <span className="text-muted-foreground tabular-nums">
                        {row.count} dossiers
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </>
      )}
    </>
  )
}
