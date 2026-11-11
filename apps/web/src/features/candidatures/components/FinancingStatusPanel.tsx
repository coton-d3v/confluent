import { useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import {
  CLOSED_FINANCING_STATUSES,
  FINANCING_STATUS_LABELS,
  financingActionLabel,
  financingTransitionsFor,
  type FinancingStatus,
  type FinancingStatusActor,
  type FinancingStatusChange,
} from '@confluent/shared'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ConfirmDialog, type ConfirmRequest } from '@/components/confluent/ConfirmDialog'
import type { ApiError } from '@/lib/api-client'

const dateFr = (iso: string) => new Date(iso).toLocaleDateString('fr-FR')

const BADGE: Record<FinancingStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  preparing: 'outline',
  in_committee: 'secondary',
  funded: 'default',
  refused: 'destructive',
  abandoned: 'outline',
}

export function FinancingStatusBadge({ status }: { status: FinancingStatus }) {
  return <Badge variant={BADGE[status]}>{FINANCING_STATUS_LABELS[status]}</Badge>
}

// ROADMAP E06.01 (decision D03, to be confirmed): the financing status of a request in one
// workspace, its history, and the transitions the viewer's side may make — the same table as the
// API (@confluent/shared), which decides at each call. A change made meanwhile by someone else is
// refused by the API: the viewer is told and the page reloads it.
export function FinancingStatusPanel<T extends FinancingStatusChange>({
  actor,
  status,
  changedAt,
  history,
  describeBy,
  intro,
  confirmText,
  onTransition,
  onStale,
}: {
  actor: FinancingStatusActor
  status: FinancingStatus
  changedAt: string
  history: T[]
  // Who made a change, as this viewer may know it.
  describeBy: (change: T) => string
  intro: ReactNode
  // What closing the follow-up means, for the confirmation.
  confirmText: (to: FinancingStatus) => string
  onTransition: (to: FinancingStatus) => Promise<void>
  onStale: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null)
  const targets = financingTransitionsFor(status, actor)

  async function apply(to: FinancingStatus) {
    setBusy(true)
    try {
      await onTransition(to)
      toast.success(`Statut : ${FINANCING_STATUS_LABELS[to].toLowerCase()}.`)
    } catch (err) {
      const e = err as Partial<ApiError> | undefined
      toast.error(
        e?.status === undefined
          ? 'Le statut n’a pas été changé. Vérifiez votre connexion puis réessayez.'
          : (e.message ?? 'Le statut n’a pas été changé.'),
      )
      if (e?.status === 409) onStale()
    } finally {
      setBusy(false)
    }
  }

  function ask(to: FinancingStatus) {
    if (!CLOSED_FINANCING_STATUSES.includes(to)) {
      void apply(to)
      return
    }
    setConfirm({
      title: `${financingActionLabel(status, to)} ?`,
      description: confirmText(to),
      confirmLabel: financingActionLabel(status, to),
      onConfirm: () => void apply(to),
    })
  }

  return (
    <section
      aria-labelledby="financing-status-title"
      className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2
          id="financing-status-title"
          className="font-heading text-lg font-semibold text-foreground"
        >
          Statut de financement
        </h2>
        <FinancingStatusBadge status={status} />
      </div>
      <p className="text-sm text-muted-foreground">
        {intro} Depuis le {dateFr(changedAt)}.
      </p>
      {targets.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {targets.map((to) => (
            <Button
              key={to}
              type="button"
              variant={CLOSED_FINANCING_STATUSES.includes(to) ? 'outline' : 'default'}
              className="h-11 px-4"
              disabled={busy}
              onClick={() => ask(to)}
            >
              {financingActionLabel(status, to)}
            </Button>
          ))}
        </div>
      )}
      {history.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-foreground">Historique</h3>
          <ol className="mt-1 flex flex-col gap-1 text-xs text-muted-foreground">
            {history.map((change) => (
              <li key={`${change.changedAt}-${change.to}`} className="wrap-anywhere">
                {dateFr(change.changedAt)} · {FINANCING_STATUS_LABELS[change.from]} →{' '}
                <span className="text-foreground">{FINANCING_STATUS_LABELS[change.to]}</span> ·{' '}
                {describeBy(change)}
              </li>
            ))}
          </ol>
        </div>
      )}
      <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
    </section>
  )
}
