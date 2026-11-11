import { useId } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  FINANCING_STATUSES,
  FINANCING_STATUS_LABELS,
  SUPPORT_PHASES,
  financingStatusSchema,
  supportPhaseSchema,
  type FinancingStatus,
  type Portfolio,
  type SupportPhase,
} from '@confluent/shared'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { formatAmount, financingTypeLabels } from '@/features/dossiers/presentation'
import { listEligibilitySchemes } from '@/features/eligibilities/api'
import { SupportPhaseBadge } from '@/features/support-paths/components/SupportPhase'
import { progressText } from '@/features/support-paths/presentation'
import { useAsync } from '@/lib/useAsync'
import { getPortfolio } from '../api'
import { FinancingStatusBadge } from './FinancingStatusPanel'

const dateFr = (iso: string) => new Date(iso).toLocaleDateString('fr-FR')

// The phases as the portfolio's tabs name them.
const PHASE_TABS: Record<SupportPhase, string> = {
  in_progress: 'En préparation',
  ready: 'Prêtes à lever',
  no_path: 'Sans parcours',
}

interface Filter {
  phase: SupportPhase | ''
  step: string
  scheme: string
  verified: boolean
  financingStatus: FinancingStatus | ''
  page: number
}

// The filters live in the address, so that going back from a candidature finds the same view; an
// unknown value is dropped rather than sent.
function readFilter(params: URLSearchParams): Filter {
  const page = Number(params.get('page'))
  return {
    phase: supportPhaseSchema.safeParse(params.get('phase')).data ?? '',
    step: params.get('step') ?? '',
    scheme: params.get('scheme') ?? '',
    verified: params.get('verified') === 'true',
    financingStatus: financingStatusSchema.safeParse(params.get('financingStatus')).data ?? '',
    page: Number.isInteger(page) && page > 1 ? page : 1,
  }
}

function writeFilter(filter: Filter): URLSearchParams {
  const params = new URLSearchParams()
  if (filter.phase) params.set('phase', filter.phase)
  if (filter.step) params.set('step', filter.step)
  if (filter.scheme) params.set('scheme', filter.scheme)
  if (filter.verified) params.set('verified', 'true')
  if (filter.financingStatus) params.set('financingStatus', filter.financingStatus)
  if (filter.page > 1) params.set('page', String(filter.page))
  return params
}

// ROADMAP E05.09 and E06.07, on a workspace's page for its conseillers (and Confluent's
// administrators): the portfolio of the candidatures sent to the workspace — counted by phase of
// their support path and by current step, filtered by phase, step, scheme, verification and
// financing status (E06.05), a page at a time. The API computes the phases and checks the right at
// each request.
export function ReceivedCandidaturesSection({ workspaceId }: { workspaceId: string }) {
  const ids = { step: useId(), scheme: useId(), status: useId(), count: useId() }
  const [params, setParams] = useSearchParams()
  const filter = readFilter(params)
  const query = useAsync(
    () =>
      getPortfolio(workspaceId, {
        phase: filter.phase || undefined,
        step: filter.step || undefined,
        scheme: filter.scheme || undefined,
        verified: filter.verified ? 'true' : undefined,
        financingStatus: filter.financingStatus || undefined,
        page: filter.page > 1 ? filter.page : undefined,
      }),
    [workspaceId, params.toString()],
  )
  const schemes = useAsync(() => listEligibilitySchemes(workspaceId), [workspaceId])
  // Any change of filter starts again from the first page.
  const change = (next: Partial<Filter>) =>
    setParams(writeFilter({ ...filter, page: 1, ...next }), { replace: true })
  const narrowed =
    filter.step !== '' || filter.scheme !== '' || filter.verified || filter.financingStatus !== ''
  const data = query.data

  return (
    <section aria-labelledby="received-title" className="flex flex-col gap-3">
      <div>
        <h2 id="received-title" className="font-heading text-lg font-semibold text-foreground">
          Candidatures reçues
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Le portefeuille des demandes de financement que des entreprises présentent à votre
          structure, par phase d’accompagnement : « en préparation » tant qu’une étape active du
          parcours reste à valider, « prête à lever » quand toutes le sont. Une candidature en
          brouillon reste invisible tant que l’entreprise ne l’a pas envoyée.
        </p>
      </div>

      {data && <PhaseTabs counts={data.counts} phase={filter.phase} onChange={change} />}

      <form
        aria-label="Filtrer les candidatures reçues"
        className="flex flex-col gap-3 rounded-lg border border-border bg-muted/30 p-3 sm:flex-row sm:flex-wrap sm:items-end"
        onSubmit={(e) => e.preventDefault()}
      >
        <div className="flex min-w-0 flex-col gap-1.5 sm:w-48">
          <Label htmlFor={ids.step}>Étape en cours</Label>
          <NativeSelect
            id={ids.step}
            value={filter.step}
            disabled={!data}
            onChange={(e) =>
              // A current step belongs to a candidature in preparation.
              change({
                step: e.target.value,
                ...(e.target.value && filter.phase !== 'in_progress' ? { phase: '' } : {}),
              })
            }
          >
            <option value="">Toutes</option>
            {(data?.counts.steps ?? []).map((s) => (
              <option key={s.stepId} value={s.stepId}>
                {s.label} ({s.count})
              </option>
            ))}
            {data && filter.step && !data.counts.steps.some((s) => s.stepId === filter.step) && (
              <option value={filter.step}>Étape retirée du parcours</option>
            )}
          </NativeSelect>
        </div>
        <div className="flex min-w-0 flex-col gap-1.5 sm:w-48">
          <Label htmlFor={ids.scheme}>Dispositif</Label>
          <NativeSelect
            id={ids.scheme}
            value={filter.scheme}
            disabled={!schemes.data}
            onChange={(e) => change({ scheme: e.target.value })}
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
            onChange={(e) => change({ verified: e.target.checked })}
          />
          Éligibilité vérifiée par la structure
        </label>
        <div className="flex min-w-0 flex-col gap-1.5 sm:w-48">
          <Label htmlFor={ids.status}>Statut de financement</Label>
          <NativeSelect
            id={ids.status}
            value={filter.financingStatus}
            onChange={(e) => change({ financingStatus: e.target.value as FinancingStatus | '' })}
          >
            <option value="">Tous</option>
            {FINANCING_STATUSES.map((s) => (
              <option key={s} value={s}>
                {FINANCING_STATUS_LABELS[s]}
              </option>
            ))}
          </NativeSelect>
        </div>
        {(narrowed || filter.phase !== '') && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="self-start sm:self-auto"
            onClick={() => setParams(new URLSearchParams(), { replace: true })}
          >
            Retirer les filtres
          </Button>
        )}
      </form>

      {query.isLoading && !data ? (
        <p className="text-sm text-muted-foreground">Chargement…</p>
      ) : query.error || !data ? (
        <p role="alert" className="text-sm text-destructive">
          {(query.error as { status?: number } | null)?.status === 400
            ? 'Ces filtres ne sont pas valides : retirez-les pour revenir à la liste.'
            : 'Impossible de charger les candidatures. Réessayez plus tard.'}
        </p>
      ) : (
        <Results
          workspaceId={workspaceId}
          data={data}
          filtered={narrowed || filter.phase !== ''}
          countId={ids.count}
          onPage={(page) => setParams(writeFilter({ ...filter, page }))}
        />
      )}
    </section>
  )
}

// The phases as toggles, each with its count over the other filters.
function PhaseTabs({
  counts,
  phase,
  onChange,
}: {
  counts: Portfolio['counts']
  phase: SupportPhase | ''
  onChange: (next: Partial<Filter>) => void
}) {
  const tabs: Array<{ value: SupportPhase | ''; label: string; count: number }> = [
    { value: '', label: 'Toutes', count: counts.total },
    // « Sans parcours » only when it applies: a workspace using its path never shows it.
    ...SUPPORT_PHASES.filter(
      (p) => p !== 'no_path' || counts.phases.no_path > 0 || phase === p,
    ).map((p) => ({ value: p, label: PHASE_TABS[p], count: counts.phases[p] })),
  ]
  return (
    <div role="group" aria-label="Phase d’accompagnement" className="flex flex-wrap gap-2">
      {tabs.map((tab) => (
        <Button
          key={tab.value || 'all'}
          type="button"
          size="sm"
          variant={phase === tab.value ? 'default' : 'outline'}
          aria-pressed={phase === tab.value}
          onClick={() =>
            onChange({ phase: tab.value, ...(tab.value === 'ready' ? { step: '' } : {}) })
          }
        >
          {tab.label} ({tab.count})
        </Button>
      ))}
    </div>
  )
}

function Results({
  workspaceId,
  data,
  filtered,
  countId,
  onPage,
}: {
  workspaceId: string
  data: Portfolio
  filtered: boolean
  countId: string
  onPage: (page: number) => void
}) {
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize))
  const first = (data.page - 1) * data.pageSize + 1
  const last = first + data.items.length - 1
  return (
    <>
      <p id={countId} role="status" className="text-sm text-muted-foreground">
        {data.total === 0
          ? filtered
            ? 'Aucune candidature ne correspond à ces filtres.'
            : 'Aucune candidature reçue pour l’instant.'
          : `${data.total} candidature${data.total > 1 ? 's' : ''}${filtered ? ' correspondant aux filtres' : ''}${
              pages > 1 && data.items.length > 0 ? ` — ${first} à ${last} affichées` : ''
            }.`}
      </p>
      {data.items.length > 0 && (
        <ul role="list" aria-describedby={countId} className="flex flex-col gap-3">
          {data.items.map((c) => {
            const amount = formatAmount(c.dossier.amountEur)
            const types = financingTypeLabels(c.dossier.financingTypes)
            const progress = progressText(c.progress)
            return (
              <li key={c.id} className="rounded-lg border border-border bg-card px-4 py-3">
                <Link
                  to={`/workspaces/${workspaceId}/candidatures/${c.id}`}
                  className="min-w-0 break-words text-base font-medium text-foreground underline-offset-4 hover:underline"
                >
                  {c.company.name} — {c.dossier.name}
                </Link>
                <p className="mt-1 text-xs text-muted-foreground wrap-anywhere">
                  {[`Reçue le ${dateFr(c.submittedAt)}`, amount, types.join(', ') || null]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
                <dl className="mt-2 grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1.5 text-sm">
                  <dt className="text-muted-foreground">Accompagnement</dt>
                  <dd className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                    <SupportPhaseBadge phase={c.progress.phase} />
                    {progress && (
                      <span className="wrap-anywhere text-xs text-foreground">{progress}</span>
                    )}
                  </dd>
                  <dt className="text-muted-foreground">Financement</dt>
                  <dd>
                    <FinancingStatusBadge status={c.financingStatus} />
                  </dd>
                </dl>
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
      {data.items.length === 0 && data.total > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm text-foreground">Cette page ne contient plus de candidature.</p>
          <Button type="button" variant="outline" size="sm" onClick={() => onPage(1)}>
            Revenir à la première page
          </Button>
        </div>
      )}
      {pages > 1 && data.items.length > 0 && (
        <nav aria-label="Pages des candidatures" className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={data.page <= 1}
            onClick={() => onPage(data.page - 1)}
          >
            Page précédente
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {data.page} sur {pages}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={data.page >= pages}
            onClick={() => onPage(data.page + 1)}
          >
            Page suivante
          </Button>
        </nav>
      )}
    </>
  )
}
