import { useEffect, useId, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  ACCESS_LEVEL_LABELS,
  FINANCING_TYPE_LABELS,
  OPPORTUNITY_SORTS,
  OPPORTUNITY_SORT_LABELS,
  financingTypeSchema,
  isArchived,
  opportunitySortSchema,
  type FinancingType,
  type Opportunities,
  type OpportunitiesQuery,
  type OpportunityListItem,
  type OpportunitySort,
} from '@confluent/shared'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { formatAmount, financingTypeLabels, parseAmount } from '@/features/dossiers/presentation'
import { listOpportunities } from '@/features/opportunities/api'
import { sourceLabel } from '@/features/opportunities/presentation'
import { useAsync } from '@/lib/useAsync'

const dateFr = (iso: string) => new Date(iso).toLocaleDateString('fr-FR')
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface Filter {
  q: string
  sector: string
  financingType: FinancingType | ''
  amountMin: string
  amountMax: string
  // `''` every way, `share` the direct shares, `pool` every pool, `pool:<id>` one workspace's pool.
  provenance: string
  sort: OpportunitySort
  page: number
}

// The filters live in the address, so that going back from an opportunity finds the same view; an
// unknown value is dropped rather than sent.
function readFilter(params: URLSearchParams): Filter {
  const page = Number(params.get('page'))
  const amount = (key: string) => {
    const parsed = parseAmount(params.get(key) ?? '')
    return typeof parsed === 'number' ? String(parsed) : ''
  }
  const source = params.get('source')
  const workspace = params.get('workspace') ?? ''
  return {
    q: (params.get('q') ?? '').slice(0, 100),
    sector: (params.get('sector') ?? '').slice(0, 200),
    financingType: financingTypeSchema.safeParse(params.get('financingType')).data ?? '',
    amountMin: amount('amountMin'),
    amountMax: amount('amountMax'),
    provenance: UUID.test(workspace)
      ? `pool:${workspace}`
      : source === 'share' || source === 'pool'
        ? source
        : '',
    sort: opportunitySortSchema.safeParse(params.get('sort')).data ?? 'recent',
    page: Number.isInteger(page) && page > 1 ? page : 1,
  }
}

function writeFilter(filter: Filter): URLSearchParams {
  const params = new URLSearchParams()
  if (filter.q) params.set('q', filter.q)
  if (filter.sector) params.set('sector', filter.sector)
  if (filter.financingType) params.set('financingType', filter.financingType)
  if (filter.amountMin) params.set('amountMin', filter.amountMin)
  if (filter.amountMax) params.set('amountMax', filter.amountMax)
  if (filter.provenance.startsWith('pool:')) params.set('workspace', filter.provenance.slice(5))
  else if (filter.provenance) params.set('source', filter.provenance)
  if (filter.sort !== 'recent') params.set('sort', filter.sort)
  if (filter.page > 1) params.set('page', String(filter.page))
  return params
}

function toQuery(filter: Filter): OpportunitiesQuery {
  return {
    q: filter.q || undefined,
    sector: filter.sector || undefined,
    financingType: filter.financingType || undefined,
    amountMin: filter.amountMin ? Number(filter.amountMin) : undefined,
    amountMax: filter.amountMax ? Number(filter.amountMax) : undefined,
    source:
      filter.provenance === 'share' || filter.provenance === 'pool' ? filter.provenance : undefined,
    workspace: filter.provenance.startsWith('pool:') ? filter.provenance.slice(5) : undefined,
    sort: filter.sort === 'recent' ? undefined : filter.sort,
    page: filter.page > 1 ? filter.page : undefined,
  }
}

const narrowedBy = (f: Filter) =>
  Boolean(f.q || f.sector || f.financingType || f.amountMin || f.amountMax || f.provenance)

// ROADMAP E07.03: the signed-in investor's opportunities — the requests shared with them and those
// published in the pools of the structures where they are an investor —, searched, filtered,
// sorted and paged by the API, which decides what each of them may show.
export default function OpportunitiesRoute() {
  const headingRef = useRef<HTMLHeadingElement>(null)
  const [params, setParams] = useSearchParams()
  const filter = readFilter(params)
  const query = useAsync(() => listOpportunities(toQuery(filter)), [params.toString()])
  const data = query.data

  useEffect(() => headingRef.current?.focus(), [])

  // Any change of filter starts again from the first page.
  const change = (next: Partial<Filter>) =>
    setParams(writeFilter({ ...filter, page: 1, ...next }), { replace: true })

  return (
    <div className="mx-auto flex max-w-[880px] flex-col gap-5">
      <title>Opportunités · Confluent</title>
      <div>
        <h1
          ref={headingRef}
          tabIndex={-1}
          className="font-heading text-2xl font-semibold text-foreground md:text-[28px] focus-visible:outline-none"
        >
          Opportunités
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Les demandes de financement que des entrepreneurs partagent avec vous, et celles qu’ils
          publient dans le vivier des structures dont vous êtes investisseur. Chacune ne montre que
          ce que son niveau d’accès permet de lire.
        </p>
      </div>

      {data && data.counts.total === 0 && !narrowedBy(filter) ? (
        <div className="rounded-lg border border-dashed border-border bg-card px-4 py-8 text-center">
          <h2 className="text-base font-medium text-foreground">
            Aucune opportunité pour l’instant
          </h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            Les demandes qu’un entrepreneur partage avec votre adresse, ou publie dans le vivier
            d’une structure dont vous êtes investisseur, apparaîtront ici.
          </p>
        </div>
      ) : (
        <>
          <Filters
            filter={filter}
            data={data}
            onChange={change}
            onReset={() =>
              setParams(writeFilter({ ...readFilter(new URLSearchParams()), sort: filter.sort }), {
                replace: true,
              })
            }
          />
          {query.isLoading && !data ? (
            <p className="text-sm text-muted-foreground">Chargement…</p>
          ) : query.error || !data ? (
            <p role="alert" className="text-sm text-destructive">
              {(query.error as { status?: number } | null)?.status === 400
                ? 'Ces filtres ne sont pas valides : retirez-les pour revenir à la liste.'
                : 'Impossible de charger vos opportunités. Réessayez plus tard.'}
            </p>
          ) : (
            <Results
              data={data}
              filtered={narrowedBy(filter)}
              onPage={(page) => setParams(writeFilter({ ...filter, page }))}
            />
          )}
        </>
      )}
    </div>
  )
}

function Filters({
  filter,
  data,
  onChange,
  onReset,
}: {
  filter: Filter
  data: Opportunities | undefined
  onChange: (next: Partial<Filter>) => void
  onReset: () => void
}) {
  const ids = {
    q: useId(),
    provenance: useId(),
    sector: useId(),
    type: useId(),
    min: useId(),
    max: useId(),
    sort: useId(),
    amountError: useId(),
  }
  // Typed text and amounts apply on submit; the lists apply at once.
  const [q, setQ] = useState(filter.q)
  const [amountMin, setAmountMin] = useState(filter.amountMin)
  const [amountMax, setAmountMax] = useState(filter.amountMax)
  // Back to what the address says when it changes (filters removed, going back): what is typed and
  // not yet searched stays while another filter changes.
  const [applied, setApplied] = useState(filter)
  if (
    applied.q !== filter.q ||
    applied.amountMin !== filter.amountMin ||
    applied.amountMax !== filter.amountMax
  ) {
    setApplied(filter)
    setQ(filter.q)
    setAmountMin(filter.amountMin)
    setAmountMax(filter.amountMax)
  }
  const [amountError, setAmountError] = useState<string | null>(null)
  const counts = data?.counts

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const min = parseAmount(amountMin)
    const max = parseAmount(amountMax)
    if (min === 'invalid' || max === 'invalid') {
      setAmountError('Saisissez un montant en euros, sans centimes (par exemple 150 000).')
      return
    }
    if (min !== null && max !== null && min > max) {
      setAmountError('Le montant minimum dépasse le montant maximum.')
      return
    }
    setAmountError(null)
    onChange({
      q: q.trim(),
      amountMin: min === null ? '' : String(min),
      amountMax: max === null ? '' : String(max),
    })
  }

  return (
    <form
      aria-label="Rechercher et filtrer les opportunités"
      className="flex flex-col gap-3 rounded-lg border border-border bg-muted/30 p-3"
      onSubmit={submit}
    >
      <div className="flex min-w-0 flex-col gap-1.5">
        <Label htmlFor={ids.q}>Rechercher dans le titre et le résumé</Label>
        <Input
          id={ids.q}
          type="search"
          value={q}
          maxLength={100}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Par exemple : énergie"
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor={ids.provenance}>Provenance</Label>
          <NativeSelect
            id={ids.provenance}
            value={filter.provenance}
            disabled={!counts}
            onChange={(e) => onChange({ provenance: e.target.value })}
          >
            <option value="">Toutes ({counts?.total ?? 0})</option>
            <option value="share">Partagées avec vous ({counts?.shares ?? 0})</option>
            {(counts?.pools.length ?? 0) > 1 && <option value="pool">Tous vos viviers</option>}
            {(counts?.pools ?? []).map((p) => (
              <option key={p.workspace.id} value={`pool:${p.workspace.id}`}>
                Vivier de {p.workspace.name} ({p.count})
              </option>
            ))}
            {counts &&
              filter.provenance.startsWith('pool:') &&
              !counts.pools.some((p) => `pool:${p.workspace.id}` === filter.provenance) && (
                <option value={filter.provenance}>
                  Vivier d’une structure que vous ne suivez plus
                </option>
              )}
          </NativeSelect>
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor={ids.sector}>Secteur</Label>
          <NativeSelect
            id={ids.sector}
            value={filter.sector}
            disabled={!counts}
            onChange={(e) => onChange({ sector: e.target.value })}
          >
            <option value="">Tous</option>
            {(counts?.sectors ?? []).map((s) => (
              <option key={s.value} value={s.value}>
                {s.value} ({s.count})
              </option>
            ))}
            {counts && filter.sector && !counts.sectors.some((s) => s.value === filter.sector) && (
              <option value={filter.sector}>{filter.sector}</option>
            )}
          </NativeSelect>
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor={ids.type}>Type de financement</Label>
          <NativeSelect
            id={ids.type}
            value={filter.financingType}
            disabled={!counts}
            onChange={(e) => onChange({ financingType: e.target.value as FinancingType | '' })}
          >
            <option value="">Tous</option>
            {(counts?.financingTypes ?? []).map((t) => (
              <option key={t.value} value={t.value}>
                {FINANCING_TYPE_LABELS[t.value]} ({t.count})
              </option>
            ))}
            {counts &&
              filter.financingType &&
              !counts.financingTypes.some((t) => t.value === filter.financingType) && (
                <option value={filter.financingType}>
                  {FINANCING_TYPE_LABELS[filter.financingType]}
                </option>
              )}
          </NativeSelect>
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor={ids.min}>Montant minimum (€)</Label>
          <Input
            id={ids.min}
            inputMode="numeric"
            value={amountMin}
            aria-invalid={amountError ? true : undefined}
            aria-describedby={amountError ? ids.amountError : undefined}
            onChange={(e) => setAmountMin(e.target.value)}
            placeholder="Aucun"
          />
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor={ids.max}>Montant maximum (€)</Label>
          <Input
            id={ids.max}
            inputMode="numeric"
            value={amountMax}
            aria-invalid={amountError ? true : undefined}
            aria-describedby={amountError ? ids.amountError : undefined}
            onChange={(e) => setAmountMax(e.target.value)}
            placeholder="Aucun"
          />
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor={ids.sort}>Trier par</Label>
          <NativeSelect
            id={ids.sort}
            value={filter.sort}
            onChange={(e) => onChange({ sort: e.target.value as OpportunitySort })}
          >
            {OPPORTUNITY_SORTS.map((s) => (
              <option key={s} value={s}>
                {OPPORTUNITY_SORT_LABELS[s]}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>
      {amountError && (
        <p id={ids.amountError} role="alert" className="text-sm text-destructive">
          {amountError}
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        Les filtres ne portent que sur ce que chaque opportunité vous montre : une demande dont le
        secteur ou le montant ne vous est pas partagé n’y correspond pas.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm">
          Rechercher
        </Button>
        {narrowedBy(filter) && (
          <Button type="button" variant="outline" size="sm" onClick={onReset}>
            Retirer les filtres
          </Button>
        )}
      </div>
    </form>
  )
}

function Results({
  data,
  filtered,
  onPage,
}: {
  data: Opportunities
  filtered: boolean
  onPage: (page: number) => void
}) {
  const countId = useId()
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize))
  const first = (data.page - 1) * data.pageSize + 1
  const last = first + data.items.length - 1
  return (
    <>
      <p id={countId} role="status" className="text-sm text-muted-foreground">
        {data.total === 0
          ? filtered
            ? 'Aucune opportunité ne correspond à ces filtres.'
            : 'Aucune opportunité pour l’instant.'
          : `${data.total} opportunité${data.total > 1 ? 's' : ''}${filtered ? ' correspondant aux filtres' : ''}${
              pages > 1 && data.items.length > 0 ? ` — ${first} à ${last} affichées` : ''
            }.`}
      </p>
      {data.items.length > 0 && (
        <ul role="list" aria-describedby={countId} className="flex flex-col gap-3">
          {data.items.map((item) => (
            <OpportunityCard key={item.dossier.id} item={item} />
          ))}
        </ul>
      )}
      {data.total > 0 && data.items.length === 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm text-foreground">Cette page ne contient plus d’opportunité.</p>
          <Button type="button" variant="outline" size="sm" onClick={() => onPage(1)}>
            Revenir à la première page
          </Button>
        </div>
      )}
      {pages > 1 && data.items.length > 0 && (
        <nav aria-label="Pages des opportunités" className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={data.page <= 1}
            onClick={() => onPage(data.page - 1)}
          >
            Page précédente
          </Button>
          <span className="text-sm text-muted-foreground" aria-current="page">
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

function OpportunityCard({ item }: { item: OpportunityListItem }) {
  const { dossier } = item
  const amount = formatAmount(dossier.amountEur)
  const types = financingTypeLabels(dossier.financingTypes)
  return (
    <li className="flex flex-col gap-2 rounded-lg border border-border bg-card px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <Link
          to={`/opportunites/${encodeURIComponent(dossier.id)}`}
          className="min-w-0 wrap-anywhere text-base font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
        >
          {dossier.name}
        </Link>
        <Badge variant="outline">Accès {ACCESS_LEVEL_LABELS[item.accessLevel].toLowerCase()}</Badge>
      </div>
      {(dossier.sector || isArchived(dossier)) && (
        <div className="flex flex-wrap gap-2">
          {dossier.sector && (
            <Badge variant="secondary" className="max-w-full whitespace-normal wrap-anywhere">
              {dossier.sector}
            </Badge>
          )}
          {isArchived(dossier) && <Badge variant="outline">Demande archivée</Badge>}
        </div>
      )}
      {dossier.summary && (
        <p className="line-clamp-2 wrap-anywhere text-sm text-muted-foreground">
          {dossier.summary}
        </p>
      )}
      {(amount || types.length > 0) && (
        <p className="wrap-anywhere text-sm text-foreground">
          {[amount, types.join(', ')].filter(Boolean).join(' · ')}
        </p>
      )}
      <ul
        role="list"
        aria-label={`Provenance de ${dossier.name}`}
        className="flex flex-col gap-0.5 text-xs text-muted-foreground"
      >
        {item.sources.map((s) => (
          <li key={s.kind === 'pool' ? s.workspace.id : 'share'} className="wrap-anywhere">
            {sourceLabel(s)} — depuis le {dateFr(s.since)}
          </li>
        ))}
      </ul>
    </li>
  )
}
