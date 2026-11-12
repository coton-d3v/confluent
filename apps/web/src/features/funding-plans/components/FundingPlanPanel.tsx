import { useId, useState, type FormEvent, type ReactNode } from 'react'
import { toast } from 'sonner'
import {
  FUNDING_PLAN_LIMITS,
  FUNDING_PLAN_LINE_STATES,
  FUNDING_PLAN_LINE_STATE_HINTS,
  FUNDING_PLAN_LINE_STATE_LABELS,
  FUNDING_PLAN_PLEDGE_CONFIRMED_STATES,
  PLEDGE_NON_COMMITMENT,
  confirmsPledge,
  createFundingPlanLineSchema,
  createOwnerFundingPlanLineSchema,
  interestIdentityLabel,
  type FundingPlan,
  type FundingPlanLine,
  type FundingPlanLineState,
  type FundingPlanPledge,
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
  confirmFundingPlanPledge,
  deleteFundingPlanLine,
  getFundingPlan,
  releaseFundingPlanPledge,
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
// changed meanwhile by the other side is refused, the plan is then reloaded. E06.04: the pledges
// this side may read, apart from the totals (« promis, non engageant »), and for the owner their
// confirmation as financing by a line — after which the plan counts the line, not the pledge.
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
  const owner = scope.side === 'owner' ? scope : null

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

  function askRelease(line: FundingPlanLine) {
    if (!owner || !line.pledge) return
    setConfirm({
      title: 'Détacher la promesse de cette ligne ?',
      description: `« ${lineTitle(line)} » reste dans le plan ; la promesse de ${interestIdentityLabel(line.pledge.identity)} sera de nouveau comptée comme promise, non engageante.`,
      confirmLabel: 'Détacher',
      onConfirm: () =>
        void act(
          () => releaseFundingPlanPledge(owner, line.id, line.version),
          'Promesse détachée de la ligne.',
          'La promesse n’a pas été détachée.',
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
      <FundingPlanBar totals={totals} promisedEur={plan.pledges.totalEur} />
      <Legend totals={totals} promisedEur={plan.pledges.totalEur} />
      <PledgesBlock
        plan={plan}
        owner={owner !== null}
        busy={busy}
        onConfirm={(pledge, target) =>
          owner
            ? act(
                () =>
                  target.kind === 'line'
                    ? confirmFundingPlanPledge(owner, target.line.id, {
                        version: target.line.version,
                        pledge: { id: pledge.id, version: pledge.version! },
                      })
                    : addFundingPlanLine(owner, {
                        ...target.input,
                        pledge: { id: pledge.id, version: pledge.version! },
                      }),
                'Promesse confirmée : la ligne la remplace dans le plan.',
                'La promesse n’a pas été confirmée.',
              )
            : Promise.resolve(false)
        }
      />

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
                  owner={owner !== null}
                  onEdit={() => setEditing(line.id)}
                  onDelete={() => askDelete(line)}
                  onRelease={() => askRelease(line)}
                  onReconfirm={() => {
                    const pledge = line.pledge
                    if (!owner || pledge?.version == null) return
                    void act(
                      () =>
                        confirmFundingPlanPledge(owner, line.id, {
                          version: line.version,
                          pledge: { id: pledge.id, version: pledge.version! },
                        }),
                      'Promesse confirmée à nouveau.',
                      'La promesse n’a pas été confirmée.',
                    )
                  }}
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

function Legend({ totals, promisedEur }: { totals: FundingPlanTotals; promisedEur: number }) {
  const items: Array<[Parameters<typeof SegmentSwatch>[0]['kind'], string]> = [
    ['obtained', `Obtenu ${formatAmount(totals.obtainedEur)}`],
    ['requested', `En cours ${formatAmount(totals.requestedEur)}`],
    ['planned', `Envisagé ${formatAmount(totals.plannedEur)}`],
  ]
  if (promisedEur > 0) {
    items.push(['promised', `Promis, non engageant ${formatAmount(promisedEur)}`])
  }
  if (totals.uncoveredEur !== null) {
    const promisedInGap = Math.min(promisedEur, totals.uncoveredEur)
    items.push([
      'uncovered',
      `Sans source ${formatAmount(totals.uncoveredEur)}` +
        (promisedInGap > 0 ? ` (dont ${formatAmount(promisedInGap)} promis)` : ''),
    ])
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
        {promisedEur > 0 &&
          ' Les promesses ne sont ni des sources ni des financements : elles ne réduisent pas le reste à financer.'}
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
  owner,
  onEdit,
  onDelete,
  onRelease,
  onReconfirm,
}: {
  line: FundingPlanLine
  describeSide: (side: FundingPlanSide) => string
  busy: boolean
  owner: boolean
  onEdit: () => void
  onDelete: () => void
  onRelease: () => void
  onReconfirm: () => void
}) {
  const pledge = line.pledge
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="wrap-anywhere font-medium text-foreground">{line.category.label}</span>
          {!line.category.active && (
            <Badge variant="outline">Source plus proposée par la structure</Badge>
          )}
          {pledge?.current && <Badge variant="secondary">Promesse confirmée</Badge>}
        </div>
        {line.label && <p className="wrap-anywhere text-sm text-foreground">{line.label}</p>}
        {pledge &&
          (pledge.current ? (
            <p className="wrap-anywhere text-sm text-muted-foreground">
              Confirme la promesse de {interestIdentityLabel(pledge.identity)} (
              {formatAmount(pledge.amountEur)}) : elle n’est plus comptée comme promise.
            </p>
          ) : (
            <p
              role="status"
              className="wrap-anywhere rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100"
            >
              La promesse de {interestIdentityLabel(pledge.identity)} a changé depuis sa
              confirmation (aujourd’hui {formatAmount(pledge.amountEur)}) : elle est de nouveau
              comptée comme promise
              {owner ? ', jusqu’à ce que vous la confirmiez à nouveau.' : '.'}
            </p>
          ))}
        <p className="text-xs text-muted-foreground">
          Modifiée le {dateFr(line.updatedAt)} {describeSide(line.updatedBy)}
        </p>
        {owner && pledge && (
          <div className="mt-1 flex flex-wrap gap-2">
            {!pledge.current && confirmsPledge(line.state) && (
              <Button type="button" size="sm" disabled={busy} onClick={onReconfirm}>
                Confirmer à nouveau
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy}
              aria-label={`Détacher la promesse de « ${lineTitle(line)} »`}
              onClick={onRelease}
            >
              Détacher la promesse
            </Button>
          </div>
        )}
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

type ConfirmTarget = { kind: 'line'; line: FundingPlanLine } | { kind: 'new'; input: LineInput }

// E06.04: the pledges this side reads that no line confirms — how many, their total, said apart
// from the plan's figures —, and for the owner those they may confirm, each by a new line or one
// already in the plan, in progress or obtained.
function PledgesBlock({
  plan,
  owner,
  busy,
  onConfirm,
}: {
  plan: FundingPlan
  owner: boolean
  busy: boolean
  onConfirm: (pledge: FundingPlanPledge, target: ConfirmTarget) => Promise<boolean>
}) {
  const [confirming, setConfirming] = useState<string | null>(null)
  const { count, totalEur, confirmable } = plan.pledges
  const titleId = useId()
  return (
    <section
      aria-labelledby={titleId}
      className="flex flex-col gap-2 rounded-md border border-dashed border-border p-3"
    >
      <h3 id={titleId} className="text-sm font-semibold text-foreground">
        Promesses des investisseurs — non engageantes
      </h3>
      <p className="text-sm text-foreground">
        {count === 0
          ? owner
            ? 'Aucune promesse en attente de confirmation dans ce plan.'
            : 'Aucune promesse montrée à votre structure en attente de confirmation dans ce plan.'
          : `${count} ${count > 1 ? 'promesses' : 'promesse'} non ${count > 1 ? 'confirmées' : 'confirmée'} dans ce plan : ${formatAmount(totalEur)} promis.`}
      </p>
      <p className="text-xs text-muted-foreground">
        {PLEDGE_NON_COMMITMENT}{' '}
        {owner
          ? 'Les promesses des investisseurs qui lisent votre demande sont comptées à part : ni dans l’obtenu, ni dans le reste à financer. Quand l’une devient un financement, confirmez-la par une ligne en cours ou obtenue : la ligne la remplace, elle n’est plus comptée comme promise. Une promesse dont l’investisseur masque son nom ou son montant compte dans ce total sans pouvoir être confirmée ; modifiée après sa confirmation, une promesse redevient promise.'
          : 'Seules les promesses que des investisseurs ont choisi de montrer à votre structure sont comptées ici, à part : ni dans l’obtenu, ni dans le reste à financer. Le porteur de projet seul confirme une promesse comme financement.'}
      </p>
      {owner && confirmable.length > 0 && (
        <ul aria-label="Promesses à confirmer" className="flex flex-col divide-y divide-border">
          {confirmable.map((pledge) => (
            <li key={pledge.id} className="flex flex-col gap-2 py-2">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <span className="wrap-anywhere min-w-0 flex-1 text-sm text-foreground">
                  {interestIdentityLabel(pledge.identity)}
                </span>
                <span className="text-sm font-semibold text-foreground tabular-nums">
                  {formatAmount(pledge.amountEur)}
                </span>
                {confirming !== pledge.id && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    aria-label={`Confirmer en financement la promesse de ${interestIdentityLabel(pledge.identity)}`}
                    onClick={() => setConfirming(pledge.id)}
                  >
                    Confirmer en financement
                  </Button>
                )}
              </div>
              {confirming === pledge.id && (
                <ConfirmPledgeForm
                  plan={plan}
                  pledge={pledge}
                  busy={busy}
                  onCancel={() => setConfirming(null)}
                  onSubmit={async (target) => {
                    const done = await onConfirm(pledge, target)
                    if (done) setConfirming(null)
                    return done
                  }}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

// Confirming one pledge: a new line (amount proposed from the pledge, in progress or obtained), or
// a line of the plan already in progress or obtained that confirms no pledge the owner sees.
function ConfirmPledgeForm({
  plan,
  pledge,
  busy,
  onCancel,
  onSubmit,
}: {
  plan: FundingPlan
  pledge: FundingPlanPledge
  busy: boolean
  onCancel: () => void
  onSubmit: (target: ConfirmTarget) => Promise<boolean>
}) {
  const ids = {
    target: useId(),
    category: useId(),
    label: useId(),
    amount: useId(),
    state: useId(),
    error: useId(),
  }
  const lines = plan.lines.filter((l) => l.pledge === null && confirmsPledge(l.state))
  const [target, setTarget] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [label, setLabel] = useState('')
  const [amount, setAmount] = useState(String(pledge.amountEur))
  const [state, setState] = useState<FundingPlanLineState | ''>('')
  const [error, setError] = useState<string | null>(null)
  const who = interestIdentityLabel(pledge.identity)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (target !== '') {
      const line = lines.find((l) => l.id === target)
      if (line) await onSubmit({ kind: 'line', line })
      return
    }
    const amountEur = parseAmount(amount)
    if (amountEur === null || amountEur === 'invalid') {
      setError('Indiquez un montant en euros, sans centimes (par exemple 50 000).')
      return
    }
    const parsed = createOwnerFundingPlanLineSchema.safeParse({
      categoryId,
      amountEur,
      state,
      label,
      pledge: { id: pledge.id, version: pledge.version },
    })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Saisie invalide.')
      return
    }
    setError(null)
    const { categoryId: category, amountEur: confirmed, state: chosen, label: detail } = parsed.data
    await onSubmit({
      kind: 'new',
      input: { categoryId: category, amountEur: confirmed, state: chosen, label: detail ?? null },
    })
  }

  const described = error ? { 'aria-describedby': ids.error } : {}
  return (
    <form
      noValidate
      onSubmit={(e) => void submit(e)}
      aria-label={`Confirmer la promesse de ${who}`}
      className="flex flex-col gap-3 rounded-md border border-border bg-background p-3"
    >
      <p className="text-xs text-muted-foreground">
        La ligne apparaît dans le plan pour vous et pour les conseillers de la structure ; le nom de
        l’investisseur n’y est montré qu’à ceux à qui il l’a montré.
      </p>
      <div className="flex min-w-0 flex-col gap-1.5">
        <Label htmlFor={ids.target}>Ligne du plan</Label>
        <NativeSelect id={ids.target} value={target} onChange={(e) => setTarget(e.target.value)}>
          <option value="">Nouvelle source</option>
          {lines.map((l) => (
            <option key={l.id} value={l.id}>
              {lineTitle(l)} — {formatAmount(l.amountEur)} (
              {FUNDING_PLAN_LINE_STATE_LABELS[l.state].toLowerCase()})
            </option>
          ))}
        </NativeSelect>
      </div>
      {target === '' && (
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
              {plan.categories.map((c) => (
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
              placeholder="Visible des conseillers de la structure"
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>
          <div className="flex min-w-0 flex-col gap-1.5">
            <Label htmlFor={ids.amount}>Montant obtenu ou demandé (€)</Label>
            <Input
              id={ids.amount}
              value={amount}
              inputMode="numeric"
              autoComplete="off"
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
              {FUNDING_PLAN_PLEDGE_CONFIRMED_STATES.map((s) => (
                <option key={s} value={s}>
                  {FUNDING_PLAN_LINE_STATE_LABELS[s]} — {FUNDING_PLAN_LINE_STATE_HINTS[s]}
                </option>
              ))}
            </NativeSelect>
          </div>
        </div>
      )}
      {error && (
        <p id={ids.error} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy}>
          Confirmer
        </Button>
        <Button type="button" variant="outline" disabled={busy} onClick={onCancel}>
          Annuler
        </Button>
      </div>
    </form>
  )
}
