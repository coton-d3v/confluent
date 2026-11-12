import { useId, useState } from 'react'
import {
  OWNER_HISTORY_FILTER_LABELS,
  ownerHistoryFilterSchema,
  type OwnerHistoryEntry,
  type OwnerHistoryFilter,
} from '@confluent/shared'
import { Button } from '@/components/ui/button'
import { formatActiveTime, formatConsultedAt } from '@/features/analytics/format'
import { useAsync } from '@/lib/useAsync'
import { cn } from '@/lib/utils'
import { getDossierHistory } from '../api'

const FILTERS = ownerHistoryFilterSchema.options

const CHANNEL_LABELS = {
  share: 'la page du lien nominatif',
  opportunity: 'sa liste d’opportunités',
} as const

// ROADMAP E07.09, for the owner of a request: its history, the latest first — who consulted it
// through their direct shares, what happened to its accesses, what the administration changed on it
// and its own steps —, filtered and paginated by the server, which decides what it may show (rules in
// @confluent/shared `owner-history.schema.ts`).
export function DossierHistorySection({ dossierId }: { dossierId: string }) {
  const [filter, setFilter] = useState<OwnerHistoryFilter>('all')
  const [page, setPage] = useState(1)
  const query = useAsync(
    () => getDossierHistory(dossierId, filter, page),
    [dossierId, filter, page],
  )
  const data = query.data
  const countId = useId()
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1

  function choose(next: OwnerHistoryFilter) {
    setFilter(next)
    setPage(1)
  }

  return (
    <section className="mt-8" aria-labelledby="history-heading">
      <h2
        id="history-heading"
        className="font-heading text-xl font-semibold text-foreground md:text-2xl"
      >
        Historique
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Les consultations de vos liens nominatifs, les accès ouverts, modifiés ou révoqués, les
        interventions de l’administration sur cette demande et ses étapes, la plus récente d’abord.
        N’y figurent ni les adresses IP ni les navigateurs des lecteurs, ni le nom des
        administrateurs, ni les lectures et les choix des investisseurs d’un vivier, ni le suivi
        interne des structures.
      </p>
      <div role="group" aria-label="Filtrer l’historique" className="mt-4 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Button
            key={f}
            type="button"
            size="sm"
            variant={filter === f ? 'default' : 'outline'}
            aria-pressed={filter === f}
            onClick={() => choose(f)}
          >
            {OWNER_HISTORY_FILTER_LABELS[f]}
          </Button>
        ))}
      </div>
      <div className="mt-4 rounded-lg border border-border bg-card">
        {query.isLoading && !data ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">Chargement…</p>
        ) : query.error || !data ? (
          <div className="flex flex-wrap items-center gap-2 px-4 py-4">
            <p role="alert" className="text-sm text-destructive">
              Impossible de charger l’historique.
            </p>
            <Button type="button" variant="outline" size="sm" onClick={query.refetch}>
              Réessayer
            </Button>
          </div>
        ) : data.items.length === 0 ? (
          <div className="flex flex-wrap items-center gap-2 px-4 py-6">
            <p id={countId} role="status" className="text-sm text-muted-foreground">
              {data.total === 0
                ? 'Aucun événement pour le moment.'
                : 'Cette page ne contient plus d’événement.'}
            </p>
            {data.total > 0 && (
              <Button type="button" variant="outline" size="sm" onClick={() => setPage(1)}>
                Revenir à la première page
              </Button>
            )}
          </div>
        ) : (
          <>
            <p id={countId} role="status" className="sr-only">
              {`${data.total} événement${data.total > 1 ? 's' : ''}, page ${data.page} sur ${pages}.`}
            </p>
            <ol
              aria-describedby={countId}
              className={cn('m-0 list-none p-0', query.isLoading && 'opacity-60')}
            >
              {data.items.map((entry, i) => (
                <HistoryRow key={`${entry.occurredAt}-${i}`} entry={entry} />
              ))}
            </ol>
          </>
        )}
      </div>
      {data && pages > 1 && data.items.length > 0 && (
        <nav aria-label="Pages de l’historique" className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={data.page <= 1 || query.isLoading}
            onClick={() => setPage(data.page - 1)}
          >
            Plus récents
          </Button>
          <span className="text-sm text-muted-foreground" aria-current="page">
            Page {data.page} sur {pages}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={data.page >= pages || query.isLoading}
            onClick={() => setPage(data.page + 1)}
          >
            Plus anciens
          </Button>
        </nav>
      )}
    </section>
  )
}

function HistoryRow({ entry }: { entry: OwnerHistoryEntry }) {
  const { consultation } = entry
  return (
    <li className="flex flex-col gap-1 border-b border-border px-4 py-3 last:border-b-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="wrap-anywhere text-sm font-medium text-foreground">{entry.summary}</p>
        <time dateTime={entry.occurredAt} className="text-xs text-muted-foreground">
          {formatConsultedAt(entry.occurredAt)}
        </time>
      </div>
      {consultation && (
        <p className="wrap-anywhere text-sm text-muted-foreground">
          Depuis {CHANNEL_LABELS[consultation.channel]} · temps actif{' '}
          {consultation.activeSeconds === null
            ? 'non mesuré'
            : formatActiveTime(consultation.activeSeconds)}{' '}
          · dernière activité le {formatConsultedAt(consultation.lastSeenAt)}
        </p>
      )}
      {entry.details.length > 0 && (
        <dl className="flex flex-col gap-0.5 text-sm">
          {entry.details.map((d, i) => (
            <div key={i} className="flex flex-wrap gap-x-1">
              <dt className="text-muted-foreground">{d.label} :</dt>
              <dd className="wrap-anywhere text-foreground">{d.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </li>
  )
}
