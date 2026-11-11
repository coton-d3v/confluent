import { useId, useState, type FormEvent } from 'react'
import { ArrowDownIcon, ArrowUpIcon } from 'lucide-react'
import { toast } from 'sonner'
import {
  DEFAULT_SUPPORT_STEPS,
  SUPPORT_STEP_LIMITS,
  createSupportStepSchema,
  type SupportStep,
} from '@confluent/shared'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { ApiError } from '@/lib/api-client'
import { createSupportStep, reorderSupportSteps, updateSupportStep } from '../api'

const DEFAULT_KEYS = new Set(DEFAULT_SUPPORT_STEPS.map((s) => s.key))
const DEFAULT_LABELS = DEFAULT_SUPPORT_STEPS.map((s) => s.label).join(', ')

const messageOf = (err: unknown, fallback: string) => (err as ApiError)?.message ?? fallback

// ROADMAP E06.06: the support path (« parcours d'accompagnement ») of a workspace, for its managers
// and Confluent's administrators — rename, explain, order, deactivate/reactivate, add steps. A
// step's key never changes and a step is never deleted (its validations refer to it). The API
// decides at each request; the list is reloaded after every change (`onChange`).
export function SupportStepsPanel({
  workspaceId,
  steps,
  onChange,
}: {
  workspaceId: string
  steps: SupportStep[]
  onChange: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const active = steps.filter((s) => s.active).length

  async function act(action: () => Promise<unknown>, success: string, failure: string) {
    setBusy(true)
    try {
      await action()
      toast.success(success)
    } catch (err) {
      toast.error(messageOf(err, failure))
    } finally {
      setBusy(false)
      onChange()
    }
  }

  const move = (index: number, by: -1 | 1) => {
    const ids = steps.map((s) => s.id)
    ;[ids[index], ids[index + by]] = [ids[index + by], ids[index]]
    const moved = steps[index]
    return act(
      () => reorderSupportSteps(workspaceId, ids),
      `« ${moved.label} » ${by < 0 ? 'monte' : 'descend'} d’un rang.`,
      'Ordre non enregistré.',
    )
  }

  const setActive = (step: SupportStep, value: boolean) =>
    act(
      () => updateSupportStep(workspaceId, step.id, { active: value }),
      `« ${step.label} » est ${value ? 'réactivée' : 'désactivée'}.`,
      value ? 'Réactivation impossible.' : 'Désactivation impossible.',
    )

  return (
    <section aria-labelledby="ws-path-title" className="flex flex-col gap-4">
      <div>
        <h2 id="ws-path-title" className="font-heading text-lg font-semibold text-foreground">
          Parcours d’accompagnement
        </h2>
        <p className="text-sm text-muted-foreground">
          {active} étape{active > 1 ? 's' : ''} active{active > 1 ? 's' : ''}
          {steps.length > active
            ? `, ${steps.length - active} désactivée${steps.length - active > 1 ? 's' : ''}`
            : ''}
        </p>
      </div>
      <p className="text-sm text-muted-foreground">
        Les étapes par lesquelles votre structure accompagne chaque candidature, dans leur ordre.
        Vos conseillers valident chaque étape sur la candidature, avec la date et leur nom ;
        l’entreprise voit ses étapes, leur explication et la date de validation, sans le nom du
        conseiller. Sont proposées par défaut : {DEFAULT_LABELS}. Renommez-les, expliquez-les,
        ordonnez-les, désactivez celles que vous n’utilisez pas ou ajoutez les vôtres.
      </p>
      <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-foreground">
        Une étape n’est jamais supprimée : désactivée, elle sort du parcours et ne peut plus être
        validée ; les validations déjà données sont conservées et restent affichées. Renommer ou
        déplacer une étape garde ses validations.
      </p>

      <ol aria-label="Étapes du parcours" className="flex flex-col gap-3">
        {steps.map((step, index) => (
          <li
            key={step.id}
            className={
              'flex flex-col gap-3 rounded-lg border border-border bg-card p-4 md:flex-row md:items-start' +
              (step.active ? '' : ' opacity-70')
            }
          >
            <div className="min-w-0 flex-1">
              {editing === step.id ? (
                <EditForm
                  workspaceId={workspaceId}
                  step={step}
                  onCancel={() => setEditing(null)}
                  onSaved={() => {
                    setEditing(null)
                    onChange()
                  }}
                />
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-sm text-muted-foreground">{index + 1}.</span>
                    <span className="wrap-anywhere text-base font-medium text-foreground">
                      {step.label}
                    </span>
                    {!step.active && <Badge variant="destructive">Désactivée</Badge>}
                  </div>
                  {step.explanation ? (
                    <p className="mt-1 wrap-anywhere whitespace-pre-line text-sm text-foreground">
                      {step.explanation}
                    </p>
                  ) : (
                    <p className="mt-1 text-sm text-muted-foreground">Sans explication.</p>
                  )}
                  <p className="mt-1 text-xs text-muted-foreground">
                    {DEFAULT_KEYS.has(step.key)
                      ? 'Proposée par défaut'
                      : 'Ajoutée par la structure'}
                  </p>
                </>
              )}
            </div>
            {editing !== step.id && (
              <div className="flex shrink-0 flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  aria-label={`Monter « ${step.label} »`}
                  disabled={busy || index === 0}
                  onClick={() => void move(index, -1)}
                >
                  <ArrowUpIcon aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  aria-label={`Descendre « ${step.label} »`}
                  disabled={busy || index === steps.length - 1}
                  onClick={() => void move(index, 1)}
                >
                  <ArrowDownIcon aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label={`Modifier « ${step.label} »`}
                  disabled={busy}
                  onClick={() => setEditing(step.id)}
                >
                  Modifier
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label={`${step.active ? 'Désactiver' : 'Réactiver'} « ${step.label} »`}
                  disabled={busy}
                  onClick={() => void setActive(step, !step.active)}
                >
                  {step.active ? 'Désactiver' : 'Réactiver'}
                </Button>
              </div>
            )}
          </li>
        ))}
      </ol>

      {steps.length < SUPPORT_STEP_LIMITS.perWorkspace ? (
        <AddForm workspaceId={workspaceId} onAdded={onChange} />
      ) : (
        <p className="text-sm text-muted-foreground">
          {SUPPORT_STEP_LIMITS.perWorkspace} étapes au plus : renommez ou réactivez une étape
          existante.
        </p>
      )}
    </section>
  )
}

// Label and explanation, checked with the API's rules before sending.
function StepFields({
  ids,
  label,
  explanation,
  setLabel,
  setExplanation,
  error,
}: {
  ids: { label: string; explanation: string; hint: string; error: string }
  label: string
  explanation: string
  setLabel: (v: string) => void
  setExplanation: (v: string) => void
  error: string | null
}) {
  const invalid = error ? { 'aria-invalid': true } : {}
  return (
    <div className="flex flex-col gap-3">
      <div className="flex min-w-0 flex-col gap-1.5">
        <Label htmlFor={ids.label}>Libellé</Label>
        <Input
          id={ids.label}
          value={label}
          maxLength={SUPPORT_STEP_LIMITS.label}
          placeholder="Par exemple : Passage en comité"
          onChange={(e) => setLabel(e.target.value)}
          aria-describedby={error ? ids.error : undefined}
          {...invalid}
        />
      </div>
      <div className="flex min-w-0 flex-col gap-1.5">
        <Label htmlFor={ids.explanation}>Explication pour l’entreprise (facultatif)</Label>
        <Textarea
          id={ids.explanation}
          value={explanation}
          rows={4}
          maxLength={SUPPORT_STEP_LIMITS.explanation}
          placeholder="Ce que recouvre cette étape et ce qui est attendu de l’entreprise"
          onChange={(e) => setExplanation(e.target.value)}
          aria-describedby={error ? `${ids.hint} ${ids.error}` : ids.hint}
        />
        <p id={ids.hint} className="text-xs text-muted-foreground">
          Texte simple, affiché tel quel : les sauts de ligne sont conservés, aucune mise en forme
          ni balise HTML. {SUPPORT_STEP_LIMITS.explanation} caractères au plus.
        </p>
      </div>
    </div>
  )
}

function useStepForm(initial: { label: string; explanation: string }) {
  const ids = { label: useId(), explanation: useId(), hint: useId(), error: useId() }
  const [label, setLabel] = useState(initial.label)
  const [explanation, setExplanation] = useState(initial.explanation)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const fields = (
    <StepFields
      ids={ids}
      label={label}
      explanation={explanation}
      setLabel={(v) => {
        setLabel(v)
        setError(null)
      }}
      setExplanation={(v) => {
        setExplanation(v)
        setError(null)
      }}
      error={error}
    />
  )
  const errorText = error && (
    <p id={ids.error} role="alert" className="text-sm text-destructive">
      {error}
    </p>
  )
  const parse = () => {
    const parsed = createSupportStepSchema.safeParse({ label, explanation })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Saisie invalide.')
      return null
    }
    return parsed.data
  }
  const reset = () => {
    setLabel('')
    setExplanation('')
    setError(null)
  }
  return { fields, errorText, parse, reset, saving, setSaving, setError }
}

function EditForm({
  workspaceId,
  step,
  onCancel,
  onSaved,
}: {
  workspaceId: string
  step: SupportStep
  onCancel: () => void
  onSaved: () => void
}) {
  const form = useStepForm({ label: step.label, explanation: step.explanation ?? '' })

  async function submit(event: FormEvent) {
    event.preventDefault()
    const data = form.parse()
    if (!data) return
    form.setSaving(true)
    try {
      await updateSupportStep(workspaceId, step.id, {
        label: data.label,
        explanation: data.explanation ?? null,
      })
      toast.success('Étape modifiée.')
      onSaved()
    } catch (err) {
      form.setError(messageOf(err, 'Modification impossible.'))
    } finally {
      form.setSaving(false)
    }
  }

  return (
    <form
      onSubmit={(e) => void submit(e)}
      aria-label={`Modifier « ${step.label} »`}
      className="flex flex-col gap-2"
      noValidate
    >
      {form.fields}
      {form.errorText}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={form.saving}>
          Enregistrer
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={onCancel} disabled={form.saving}>
          Annuler
        </Button>
      </div>
    </form>
  )
}

function AddForm({ workspaceId, onAdded }: { workspaceId: string; onAdded: () => void }) {
  const title = useId()
  const form = useStepForm({ label: '', explanation: '' })

  async function submit(event: FormEvent) {
    event.preventDefault()
    const data = form.parse()
    if (!data) return
    form.setSaving(true)
    try {
      const created = await createSupportStep(workspaceId, data)
      toast.success(`« ${created.label} » ajoutée au parcours.`)
      form.reset()
      onAdded()
    } catch (err) {
      form.setError(messageOf(err, 'Ajout impossible.'))
    } finally {
      form.setSaving(false)
    }
  }

  return (
    <form
      onSubmit={(e) => void submit(e)}
      aria-labelledby={title}
      className="flex flex-col gap-3 rounded-lg border border-dashed border-border p-4"
      noValidate
    >
      <h3 id={title} className="text-sm font-medium text-foreground">
        Ajouter une étape
      </h3>
      {form.fields}
      {form.errorText}
      <div>
        <Button type="submit" size="sm" disabled={form.saving}>
          Ajouter
        </Button>
      </div>
    </form>
  )
}
