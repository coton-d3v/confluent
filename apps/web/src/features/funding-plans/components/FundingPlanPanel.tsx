import { useId, useState, type FormEvent, type ReactNode } from 'react'
import { toast } from 'sonner'
import {
  FUNDING_PLAN_LIMITS,
  FUNDING_PLAN_LINE_STATES,
  FUNDING_PLAN_LINE_STATE_HINTS,
  FUNDING_PLAN_LINE_STATE_LABELS,
  createFundingPlanLineSchema,
  type FundingPlan,
  type FundingPlanLine,
  type FundingPlanLineState,
  type FundingPlanSide,
  type FundingPlanTotals,
} from '@confluent/shared'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { ConfirmDialog, type ConfirmRequest } from '@/components/confluent/ConfirmDialog'
import { formatAmount, parseAmount } from '@/features/dossiers/presentation'
import type { ApiError } from '@/lib/api-client'
import { useAsync } from '@/lib/useAsync'
import {
  addFundingPlanLine,
  deleteFundingPlanLine,
  getFundingPlan,
  updateFundingPlanLine,
  type FundingPlanScope,
} from '../api'
import { FundingPlanBar, SegmentSwatch } from './FundingPlanBar'

const dateFr = (iso: string) => new Date(iso).toLocaleDateString('fr-FR')

const failure = (err: unknown, fallback: string) => {
  const e = err as Partial<ApiError> | undefined
  return e?.status === undefined
    ? `${fallback} Vérifiez votre connexion puis réessayez.`
    : (e.message ?? fallback)
}

// State badges carry their label: the colour only repeats it.
const STATE_BADGE: Record<
  FundingPlanLineState,
  'default' | 'secondary' | 'outline' | 'destructive'
> = {
  obtained: 'default',
  requested: 'secondary',
  planned: 'outline',
  refused: 'destructive',
}

// ROADMAP E06.03: the financing plan of a candidature — its totals against the request's amount
// sought, its segmented bar and its lines —, kept from either side. The API decides at each call who
// may read and write, and computes the totals (@confluent/shared `fundingPlanTotals`); a line
// changed meanwhile by the other side is refused, the plan is then reloaded.
export function FundingPlanPanel({
  scope,
  intro,
  describeSide,
  noObjective,
}: {
  scope: FundingPlanScope
  intro: ReactNode
  // Who wrote a line last, as this viewer may know it.
  describeSide: (side: FundingPlanSide) => string
  // What to do while the request states no amount sought.
  noObjective: ReactNode
}) {
  const query = useAsync(() => getFundingPlan(scope), [JSON.stringify(scope)])
  const [current, setCurrent] = useState<FundingPlan | null>(null)
  const plan = current ?? query.data ?? null

  return (
    <section
      aria-labelledby="funding-plan-title"
      className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4"
    >
      <h2 id="funding-plan-title" className="font-heading text-lg font-semibold text-foreground">
        Plan de financement
      </h2>
      <p className="text-sm text-muted-foreground">{intro}</p>
      {plan ? (
        <PlanBody
          scope={scope}
          plan={plan}
          describeSide={describeSide}
          noObjective={noObjective}
          onChange={setCurrent}
          onStale={() => {
            void getFundingPlan(scope).then(setCurrent, () => undefined)
          }}
        />
      ) : query.error ? (
        <p role="alert" className="text-sm text-foreground">
          {failure(query.error, 'Le plan de financement n’a pas pu être chargé.')}
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">Chargement…</p>
      )}
    </section>
  )
}

function PlanBody({
  scope,
  plan,
  describeSide,
  noObjective,
  onChange,
  onStale,
}: {
  scope: FundingPlanScope
  plan: FundingPlan
  describeSide: (side: FundingPlanSide) => string
  noObjective: ReactNode
  onChange: (plan: FundingPlan) => void
  onStale: () => void
}) {
  const [editing, setEditing] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null)
  const { totals } = plan

  // Runs a write; a refusal because the plan changed meanwhile reloads it.
  async function act(write: () => Promise<FundingPlan>, success: string, fallback: string) {
    setBusy(true)
    try {
      onChange(await write())
      toast.success(success)
      return true
    } catch (err) {
      toast.error(failure(err, fallback))
      const status = (err as Partial<ApiError> | undefined)?.status
      // The line shown is no longer the one edited: close the form on the reloaded plan.
      if (status === 409 || status === 404) {
        setEditing(null)
        onStale()
      }
      return false
    } finally {
      setBusy(false)
    }
  }

  function askDelete(line: FundingPlanLine) {
    setConfirm({
      title: 'Supprimer cette ligne ?',
      description: `« ${lineTitle(line)} », ${formatAmount(line.amountEur)} (${FUNDING_PLAN_LINE_STATE_LABELS[line.state].toLowerCase()}) sera retirée du plan. Pour garder la trace d’une source refusée, indiquez plutôt l’état « Refusé ».`,
      confirmLabel: 'Supprimer',
      onConfirm: () =>
        void act(
          () => deleteFundingPlanLine(scope, line.id, line.version),
          'Ligne supprimée.',
          'La ligne n’a pas été supprimée.',
        ),
    })
  }

  return (
    <>
      {totals.objectiveEur === null && (
        <p
          role="status"
          className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100"
        >
          {noObjective}
        </p>
      )}
      <PlanSummary totals={totals} />
      <FundingPlanBar totals={totals} />
      <Legend totals={totals} />

      {plan.lines.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Aucune source pour l’instant : ajoutez les financements envisagés, demandés ou obtenus.
        </p>
      ) : (
        <ul aria-label="Sources du plan" className="flex flex-col divide-y divide-border">
          {plan.lines.map((line) => (
            <li key={line.id} className="py-3">
              {editing === line.id ? (
                <LineForm
                  plan={plan}
                  line={line}
                  busy={busy}
                  onCancel={() => setEditing(null)}
                  onSubmit={async (input) => {
                    const done = await act(
                      () =>
                        updateFundingPlanLine(scope, line.id, { version: line.version, ...input }),
                      'Ligne modifiée.',
                      'La ligne n’a pas été modifiée.',
                    )
                    if (done) setEditing(null)
                    return done
                  }}
                />
              ) : (
                <LineRow
                  line={line}
                  describeSide={describeSide}
                  busy={busy}
                  onEdit={() => setEditing(line.id)}
                  onDelete={() => askDelete(line)}
                />
              )}
            </li>
          ))}
        </ul>
      )}

      {plan.lines.length < FUNDING_PLAN_LIMITS.linesPerPlan ? (
        <AddLine
          plan={plan}
          busy={busy}
          onSubmit={(input) =>
            act(
              () => addFundingPlanLine(scope, input),
              'Ligne ajoutée.',
              'La ligne n’a pas été ajoutée.',
            )
          }
        />
      ) : (
        <p className="text-sm text-muted-foreground">
          {FUNDING_PLAN_LIMITS.linesPerPlan} lignes au plus : regroupez ou supprimez des lignes.
        </p>
      )}
      <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
    </>
  )
}

// The figures, written out: what the bar shows, readable without it.
function PlanSummary({ totals }: { totals: FundingPlanTotals }) {
  const figure = (label: string, value: string, hint?: string) => (
    <div className="flex min-w-0 flex-col">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-base font-semibold text-foreground tabular-nums">{value}</dd>
      {hint && <dd className="text-xs text-muted-foreground">{hint}</dd>}
    </div>
  )
  const objective = totals.objectiveEur
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 lg:grid-cols-5">
      {figure('Objectif (montant recherché)', formatAmount(objective) ?? 'Non indiqué')}
      {figure(
        'Obtenu',
        formatAmount(totals.obtainedEur)!,
        totals.obtainedPercent === null ? undefined : `${totals.obtainedPercent} % de l’objectif`,
      )}
      {figure('En cours', formatAmount(totals.requestedEur)!)}
      {figure('Envisagé', formatAmount(totals.plannedEur)!)}
      {figure(
        'Reste à financer',
        totals.remainingEur === null ? '—' : formatAmount(totals.remainingEur)!,
        totals.remainingEur === null
          ? 'Sans objectif, pas de reste calculé'
          : totals.beyondObjectiveEur > 0
            ? `Objectif dépassé de ${formatAmount(totals.beyondObjectiveEur)}`
            : totals.remainingEur === 0
              ? 'Objectif atteint'
              : 'Objectif − obtenu',
      )}
    </dl>
  )
}

function Legend({ totals }: { totals: FundingPlanTotals }) {
  const items: Array<[Parameters<typeof SegmentSwatch>[0]['kind'], string]> = [
    ['obtained', `Obtenu ${formatAmount(totals.obtainedEur)}`],
    ['requested', `En cours ${formatAmount(totals.requestedEur)}`],
    ['planned', `Envisagé ${formatAmount(totals.plannedEur)}`],
  ]
  if (totals.uncoveredEur !== null) {
    items.push(['uncovered', `Sans source ${formatAmount(totals.uncoveredEur)}`])
  }
  return (
    <div className="flex flex-col gap-1">
      <ul aria-label="Légende" className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-foreground">
        {items.map(([kind, text]) => (
          <li key={kind} className="flex items-center gap-1.5">
            <SegmentSwatch kind={kind} />
            {text}
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">
        Le reste à financer ne compte que l’obtenu : les montants en cours ou envisagés n’y sont pas
        retranchés. Les sources refusées
        {totals.refusedEur > 0 ? ` (${formatAmount(totals.refusedEur)})` : ''} ne sont comptées
        nulle part.
      </p>
    </div>
  )
}

const lineTitle = (line: FundingPlanLine) =>
  line.label ? `${line.category.label} — ${line.label}` : line.category.label

function LineRow({
  line,
  describeSide,
  busy,
  onEdit,
  onDelete,
}: {
  line: FundingPlanLine
  describeSide: (side: FundingPlanSide) => string
  busy: boolean
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="wrap-anywhere font-medium text-foreground">{line.category.label}</span>
          {!line.category.active && (
            <Badge variant="outline">Source plus proposée par la structure</Badge>
          )}
        </div>
        {line.label && <p className="wrap-anywhere text-sm text-foreground">{line.label}</p>}
        <p className="text-xs text-muted-foreground">
          Modifiée le {dateFr(line.updatedAt)} {describeSide(line.updatedBy)}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2 sm:flex-col sm:items-end">
        <span className="font-semibold text-foreground tabular-nums">
          {formatAmount(line.amountEur)}
        </span>
        <Badge variant={STATE_BADGE[line.state]}>
          {FUNDING_PLAN_LINE_STATE_LABELS[line.state]}
        </Badge>
      </div>
      <div className="flex gap-2 sm:flex-col">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy}
          aria-label={`Modifier « ${lineTitle(line)} »`}
          onClick={onEdit}
        >
          Modifier
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={busy}
          aria-label={`Supprimer « ${lineTitle(line)} »`}
          onClick={onDelete}
        >
          Supprimer
        </Button>
      </div>
    </div>
  )
}

interface LineInput {
  categoryId: string
  amountEur: number
  state: FundingPlanLineState
  label: string | null
}

function AddLine({
  plan,
  busy,
  onSubmit,
}: {
  plan: FundingPlan
  busy: boolean
  onSubmit: (input: LineInput) => Promise<boolean>
}) {
  const [open, setOpen] = useState(false)
  if (!open) {
    return (
      <div>
        <Button type="button" variant="outline" disabled={busy} onClick={() => setOpen(true)}>
          Ajouter une source
        </Button>
      </div>
    )
  }
  return (
    <div className="rounded-lg border border-dashed border-border p-4">
      <LineForm
        plan={plan}
        busy={busy}
        onCancel={() => setOpen(false)}
        onSubmit={async (input) => {
          const done = await onSubmit(input)
          if (done) setOpen(false)
          return done
        }}
      />
    </div>
  )
}

// A line's source, detail, amount and state, checked with the API's rules before sending.
function LineForm({
  plan,
  line,
  busy,
  onCancel,
  onSubmit,
}: {
  plan: FundingPlan
  line?: FundingPlanLine
  busy: boolean
  onCancel: () => void
  onSubmit: (input: LineInput) => Promise<boolean>
}) {
  const ids = { category: useId(), label: useId(), amount: useId(), state: useId(), error: useId() }
  const [categoryId, setCategoryId] = useState(line?.category.id ?? '')
  const [label, setLabel] = useState(line?.label ?? '')
  const [amount, setAmount] = useState(line ? String(line.amountEur) : '')
  const [state, setState] = useState<FundingPlanLineState | ''>(line?.state ?? '')
  const [error, setError] = useState<string | null>(null)
  // A line already on a deactivated source keeps it; no other line can take it.
  const choices =
    line && !line.category.active ? [line.category, ...plan.categories] : plan.categories

  async function submit(event: FormEvent) {
    event.preventDefault()
    const amountEur = parseAmount(amount)
    if (amountEur === null || amountEur === 'invalid') {
      setError('Indiquez un montant en euros, sans centimes (par exemple 50 000).')
      return
    }
    const parsed = createFundingPlanLineSchema.safeParse({ categoryId, amountEur, state, label })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Saisie invalide.')
      return
    }
    setError(null)
    await onSubmit({ ...parsed.data, label: parsed.data.label ?? null })
  }

  const described = error ? { 'aria-describedby': ids.error } : {}
  return (
    <form
      noValidate
      onSubmit={(e) => void submit(e)}
      aria-label={line ? `Modifier « ${lineTitle(line)} »` : 'Nouvelle source'}
      className="flex flex-col gap-3"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor={ids.category}>Source</Label>
          <NativeSelect
            id={ids.category}
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            {...described}
          >
            <option value="">Choisir…</option>
            {choices.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor={ids.label}>Précision (facultatif)</Label>
          <Input
            id={ids.label}
            value={label}
            maxLength={FUNDING_PLAN_LIMITS.label}
            placeholder="Par exemple : BNP, Bourse French Tech"
            onChange={(e) => setLabel(e.target.value)}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor={ids.amount}>Montant (€)</Label>
          <Input
            id={ids.amount}
            value={amount}
            inputMode="numeric"
            autoComplete="off"
            placeholder="50 000"
            onChange={(e) => setAmount(e.target.value)}
            {...described}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor={ids.state}>État</Label>
          <NativeSelect
            id={ids.state}
            value={state}
            onChange={(e) => setState(e.target.value as FundingPlanLineState | '')}
            {...described}
          >
            <option value="">Choisir…</option>
            {FUNDING_PLAN_LINE_STATES.map((s) => (
              <option key={s} value={s}>
                {FUNDING_PLAN_LINE_STATE_LABELS[s]} — {FUNDING_PLAN_LINE_STATE_HINTS[s]}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>
      {error && (
        <p id={ids.error} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy}>
          {line ? 'Enregistrer' : 'Ajouter'}
        </Button>
        <Button type="button" variant="outline" disabled={busy} onClick={onCancel}>
          Annuler
        </Button>
      </div>
    </form>
  )
}
