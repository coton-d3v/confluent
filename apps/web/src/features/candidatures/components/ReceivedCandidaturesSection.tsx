import { useId, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  FINANCING_STATUSES,
  FINANCING_STATUS_LABELS,
  type FinancingStatus,
} from '@confluent/shared'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { formatAmount, financingTypeLabels } from '@/features/dossiers/presentation'
import { listEligibilitySchemes } from '@/features/eligibilities/api'
import { useAsync } from '@/lib/useAsync'
import { listReceivedCandidatures } from '../api'
import { FinancingStatusBadge } from './FinancingStatusPanel'

const dateFr = (iso: string) => new Date(iso).toLocaleDateString('fr-FR')

interface Filter {
  scheme: string
  verified: boolean
  financingStatus: FinancingStatus | ''
}
const NO_FILTER: Filter = { scheme: '', verified: false, financingStatus: '' }

// ROADMAP E05.09, on a workspace's page for its conseillers (and Confluent's administrators): the
// candidatures sent to the workspace, with their eligibilities to its schemes and filters by scheme,
// verification and financing status (E06.05) — applied by the API. The API checks the right at each
// request.
export function ReceivedCandidaturesSection({ workspaceId }: { workspaceId: string }) {
  const ids = { scheme: useId(), status: useId(), count: useId() }
  const [filter, setFilter] = useState<Filter>(NO_FILTER)
  const query = useAsync(
    () =>
      listReceivedCandidatures(workspaceId, {
        scheme: filter.scheme || undefined,
        verified: filter.verified ? 'true' : undefined,
        financingStatus: filter.financingStatus || undefined,
      }),
    [workspaceId, filter.scheme, filter.verified, filter.financingStatus],
  )
  const schemes = useAsync(() => listEligibilitySchemes(workspaceId), [workspaceId])
  const filtered = filter.scheme !== '' || filter.verified || filter.financingStatus !== ''
  const rows = query.data ?? []

  return (
    <section aria-labelledby="received-title" className="flex flex-col gap-3">
      <div>
        <h2 id="received-title" className="font-heading text-lg font-semibold text-foreground">
          Candidatures reçues
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Les demandes de financement que des entreprises présentent à votre structure : leur profil
          commun, leurs réponses à votre formulaire, leur statut de financement et les dispositifs
          auxquels elles se déclarent éligibles. Une candidature en brouillon reste invisible tant
          que l’entreprise ne l’a pas envoyée.
        </p>
      </div>

      <form
        aria-label="Filtrer les candidatures reçues"
        className="flex flex-col gap-3 rounded-lg border border-border bg-muted/30 p-3 sm:flex-row sm:flex-wrap sm:items-end"
        onSubmit={(e) => e.preventDefault()}
      >
        <div className="flex min-w-0 flex-col gap-1.5 sm:w-48">
          <Label htmlFor={ids.scheme}>Dispositif</Label>
          <NativeSelect
            id={ids.scheme}
            value={filter.scheme}
            disabled={!schemes.data}
            onChange={(e) => setFilter({ ...filter, scheme: e.target.value })}
          >
            <option value="">Tous</option>
            {(schemes.data ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
                {s.active ? '' : ' (désactivé)'}
              </option>
            ))}
          </NativeSelect>
        </div>
        <label className="flex min-h-9 items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            className="size-4"
            checked={filter.verified}
            onChange={(e) => setFilter({ ...filter, verified: e.target.checked })}
          />
          Éligibilité vérifiée par la structure
        </label>
        <div className="flex min-w-0 flex-col gap-1.5 sm:w-48">
          <Label htmlFor={ids.status}>Statut de financement</Label>
          <NativeSelect
            id={ids.status}
            value={filter.financingStatus}
            onChange={(e) =>
              setFilter({ ...filter, financingStatus: e.target.value as FinancingStatus | '' })
            }
          >
            <option value="">Tous</option>
            {FINANCING_STATUSES.map((s) => (
              <option key={s} value={s}>
                {FINANCING_STATUS_LABELS[s]}
              </option>
            ))}
          </NativeSelect>
        </div>
        {filtered && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="self-start sm:self-auto"
            onClick={() => setFilter(NO_FILTER)}
          >
            Retirer les filtres
          </Button>
        )}
      </form>

      {query.isLoading && !query.data ? (
        <p className="text-sm text-muted-foreground">Chargement…</p>
      ) : query.error ? (
        <p role="alert" className="text-sm text-destructive">
          Impossible de charger les candidatures. Réessayez plus tard.
        </p>
      ) : (
        <>
          <p id={ids.count} role="status" className="text-sm text-muted-foreground">
            {rows.length === 0
              ? filtered
                ? 'Aucune candidature ne correspond à ces filtres.'
                : 'Aucune candidature reçue pour l’instant.'
              : `${rows.length} candidature${rows.length > 1 ? 's' : ''}${filtered ? ' correspondant aux filtres' : ''}.`}
          </p>
          {rows.length > 0 && (
            <ul role="list" aria-describedby={ids.count} className="flex flex-col gap-3">
              {rows.map((c) => {
                const amount = formatAmount(c.dossier.amountEur)
                const types = financingTypeLabels(c.dossier.financingTypes)
                return (
                  <li key={c.id} className="rounded-lg border border-border bg-card px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Link
                        to={`/workspaces/${workspaceId}/candidatures/${c.id}`}
                        className="min-w-0 break-words text-base font-medium text-foreground underline-offset-4 hover:underline"
                      >
                        {c.company.name} — {c.dossier.name}
                      </Link>
                      <FinancingStatusBadge status={c.financingStatus} />
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground wrap-anywhere">
                      {[`Reçue le ${dateFr(c.submittedAt)}`, amount, types.join(', ') || null]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                    {c.eligibilities.length > 0 && (
                      <ul aria-label="Dispositifs indiqués" className="mt-2 flex flex-wrap gap-1.5">
                        {c.eligibilities.map((e) => (
                          <li key={e.schemeId}>
                            <Badge
                              variant={e.verified ? 'secondary' : 'outline'}
                              className="h-auto whitespace-normal wrap-anywhere"
                            >
                              {e.label}
                              {e.verified ? ' · vérifiée' : ' · déclarée'}
                            </Badge>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </>
      )}
    </section>
  )
}
