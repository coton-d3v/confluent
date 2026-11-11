import { useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import type {
  CandidatureSupportPath,
  ReceivedSupportPath,
  ReceivedSupportStep,
  SupportStepHistoryEntry,
} from '@confluent/shared'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ConfirmDialog, type ConfirmRequest } from '@/components/confluent/ConfirmDialog'
import type { ApiError } from '@/lib/api-client'
import { useAsync } from '@/lib/useAsync'
import { getReceivedSupportPath, getSupportPath, setSupportStepValidation } from '../api'

export type SupportPathScope =
  | { side: 'owner'; candidatureId: string }
  | { side: 'workspace'; workspaceId: string; candidatureId: string }

type Path = CandidatureSupportPath | ReceivedSupportPath
// A step as either side reads it: the workspace also learns who validated it.
type Step = CandidatureSupportPath['steps'][number] &
  Partial<Pick<ReceivedSupportStep, 'validatedBy'>>

const dateFr = (iso: string) => new Date(iso).toLocaleDateString('fr-FR')
const dateTimeFr = (iso: string) =>
  new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })

const nameOf = (member: { email: string; firstName: string | null; lastName: string | null }) =>
  [member.firstName, member.lastName].filter(Boolean).join(' ') || member.email

const failure = (err: unknown, fallback: string) => {
  const e = err as Partial<ApiError> | undefined
  return e?.status === undefined
    ? `${fallback} Vérifiez votre connexion puis réessayez.`
    : (e.message ?? fallback)
}

const load = (scope: SupportPathScope): Promise<Path> =>
  scope.side === 'owner'
    ? getSupportPath(scope.candidatureId)
    : getReceivedSupportPath(scope.workspaceId, scope.candidatureId)

// ROADMAP E06.06: a candidature's support path — the steps of its workspace's path in their order,
// with their explanation and whether the structure validated them. The owner reads it (from the
// draft on, never learning which conseiller validated); the workspace's conseillers validate a step
// or withdraw its validation, see who validated and the history. A step changed meanwhile by
// someone else is refused by the API: the path is then reloaded, nothing overwritten.
export function SupportPathPanel({ scope, intro }: { scope: SupportPathScope; intro: ReactNode }) {
  const query = useAsync(() => load(scope), [JSON.stringify(scope)])
  const [current, setCurrent] = useState<Path | null>(null)
  const data = current ?? query.data ?? null

  return (
    <section
      aria-labelledby="support-path-title"
      className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4"
    >
      <h2 id="support-path-title" className="font-heading text-lg font-semibold text-foreground">
        Parcours d’accompagnement
      </h2>
      <p className="text-sm text-muted-foreground">{intro}</p>
      {data ? (
        <Body
          scope={scope}
          data={data}
          onChange={setCurrent}
          onStale={() => {
            void load(scope).then(setCurrent, () => undefined)
          }}
        />
      ) : query.error ? (
        <p role="alert" className="text-sm text-foreground">
          {failure(query.error, 'Le parcours d’accompagnement n’a pas pu être chargé.')}
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">Chargement…</p>
      )}
    </section>
  )
}

function Body({
  scope,
  data,
  onChange,
  onStale,
}: {
  scope: SupportPathScope
  data: Path
  onChange: (data: Path) => void
  onStale: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null)
  const steps = data.steps as Step[]
  const inPath = steps.filter((s) => s.active)
  const validated = inPath.filter((s) => s.validatedAt !== null).length
  const history = 'history' in data ? data.history : null

  async function set(step: Step, value: boolean) {
    if (scope.side !== 'workspace') return
    setBusy(true)
    try {
      onChange(
        await setSupportStepValidation(scope.workspaceId, scope.candidatureId, step.id, {
          validated: value,
          version: step.version,
        }),
      )
      toast.success(
        value ? `Étape « ${step.label} » validée.` : `Validation de « ${step.label} » retirée.`,
      )
    } catch (err) {
      toast.error(failure(err, 'Le changement n’a pas été enregistré.'))
      const status = (err as Partial<ApiError> | undefined)?.status
      if (status === 409 || status === 404) onStale()
    } finally {
      setBusy(false)
    }
  }

  function askReopen(step: Step) {
    setConfirm({
      title: `Retirer la validation de « ${step.label} » ?`,
      description:
        'L’étape redevient à valider ; l’entreprise ne verra plus de date de validation. Le retrait est conservé dans l’historique.',
      confirmLabel: 'Retirer la validation',
      onConfirm: () => void set(step, false),
    })
  }

  if (steps.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {scope.side === 'owner'
          ? 'Cette structure n’a pas défini de parcours d’accompagnement.'
          : 'Votre structure n’a pas défini de parcours d’accompagnement : ses gestionnaires le configurent dans l’onglet « Parcours d’accompagnement » du workspace.'}
      </p>
    )
  }

  return (
    <>
      <p role="status" className="text-sm font-medium text-foreground">
        {validated} étape{validated > 1 ? 's' : ''} validée{validated > 1 ? 's' : ''} sur{' '}
        {inPath.length}
      </p>
      <ol aria-label="Étapes du parcours" className="flex flex-col divide-y divide-border">
        {steps.map((step, index) => (
          <li key={step.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-sm text-muted-foreground">{index + 1}.</span>
                <span className="wrap-anywhere font-medium text-foreground">{step.label}</span>
                {step.validatedAt !== null ? (
                  <Badge>
                    Validée le {dateFr(step.validatedAt)}
                    {scope.side === 'owner' ? ' par la structure' : ''}
                  </Badge>
                ) : (
                  <Badge variant="outline">À valider</Badge>
                )}
                {!step.active && (
                  <Badge variant="outline">Étape retirée du parcours par la structure</Badge>
                )}
              </div>
              {step.explanation && (
                <p className="mt-1 wrap-anywhere whitespace-pre-line text-sm text-foreground">
                  {step.explanation}
                </p>
              )}
              {scope.side === 'workspace' && step.validatedAt !== null && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Validée le {dateTimeFr(step.validatedAt)} par{' '}
                  {step.validatedBy ? nameOf(step.validatedBy) : 'un compte supprimé'}
                </p>
              )}
            </div>
            {scope.side === 'workspace' && step.active && (
              <div className="flex shrink-0 flex-wrap gap-2">
                {step.validatedAt === null ? (
                  <Button
                    type="button"
                    size="sm"
                    disabled={busy}
                    aria-label={`Valider l’étape « ${step.label} »`}
                    onClick={() => void set(step, true)}
                  >
                    Valider l’étape
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    aria-label={`Retirer la validation de « ${step.label} »`}
                    onClick={() => askReopen(step)}
                  >
                    Retirer la validation
                  </Button>
                )}
              </div>
            )}
          </li>
        ))}
      </ol>
      {history && <History entries={history} />}
      <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
    </>
  )
}

function History({ entries }: { entries: SupportStepHistoryEntry[] }) {
  if (entries.length === 0) {
    return <p className="text-xs text-muted-foreground">Aucune étape validée pour l’instant.</p>
  }
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-muted-foreground">
        Historique des validations ({entries.length})
      </summary>
      <ul aria-label="Historique des validations" className="mt-2 flex flex-col gap-1">
        {entries.map((entry, i) => (
          <li key={`${entry.stepId}-${entry.changedAt}-${i}`} className="wrap-anywhere">
            <span className="text-muted-foreground">{dateTimeFr(entry.changedAt)}</span> — «{' '}
            {entry.stepLabel} » {entry.change === 'validated' ? 'validée' : 'validation retirée'}{' '}
            par {entry.actor ? nameOf(entry.actor) : 'un compte supprimé'}
          </li>
        ))}
      </ul>
    </details>
  )
}
