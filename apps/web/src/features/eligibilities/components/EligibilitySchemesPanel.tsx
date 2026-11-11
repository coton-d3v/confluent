import { useId, useState, type FormEvent } from 'react'
import { ArrowDownIcon, ArrowUpIcon } from 'lucide-react'
import { toast } from 'sonner'
import {
  DEFAULT_ELIGIBILITY_SCHEMES,
  ELIGIBILITY_SCHEME_LIMITS,
  createEligibilitySchemeSchema,
  type EligibilityScheme,
} from '@confluent/shared'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { ApiError } from '@/lib/api-client'
import { createEligibilityScheme, reorderEligibilitySchemes, updateEligibilityScheme } from '../api'

const DEFAULT_KEYS = new Set(DEFAULT_ELIGIBILITY_SCHEMES.map((s) => s.key))
const DEFAULT_LABELS = DEFAULT_ELIGIBILITY_SCHEMES.map((s) => s.label).join(', ')

const messageOf = (err: unknown, fallback: string) => (err as ApiError)?.message ?? fallback

// ROADMAP E06.05: the schemes (« dispositifs ») of a workspace, for its managers and Confluent's
// administrators — rename, describe, order, deactivate/reactivate, add. A scheme's key never changes
// and a scheme is never deleted. Information and filters only: nothing here computes a tax
// benefit. The API decides at each request; the list is reloaded after every change (`onChange`).
export function EligibilitySchemesPanel({
  workspaceId,
  schemes,
  onChange,
}: {
  workspaceId: string
  schemes: EligibilityScheme[]
  onChange: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const active = schemes.filter((s) => s.active).length

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
    const ids = schemes.map((s) => s.id)
    ;[ids[index], ids[index + by]] = [ids[index + by], ids[index]]
    const moved = schemes[index]
    return act(
      () => reorderEligibilitySchemes(workspaceId, ids),
      `« ${moved.label} » ${by < 0 ? 'monte' : 'descend'} d’un rang.`,
      'Ordre non enregistré.',
    )
  }

  const setActive = (scheme: EligibilityScheme, value: boolean) =>
    act(
      () => updateEligibilityScheme(workspaceId, scheme.id, { active: value }),
      `« ${scheme.label} » est ${value ? 'réactivé' : 'désactivé'}.`,
      value ? 'Réactivation impossible.' : 'Désactivation impossible.',
    )

  return (
    <section aria-labelledby="ws-schemes-title" className="flex flex-col gap-4">
      <div>
        <h2 id="ws-schemes-title" className="font-heading text-lg font-semibold text-foreground">
          Dispositifs
        </h2>
        <p className="text-sm text-muted-foreground">
          {active} actif{active > 1 ? 's' : ''}
          {schemes.length > active
            ? `, ${schemes.length - active} désactivé${schemes.length - active > 1 ? 's' : ''}`
            : ''}
        </p>
      </div>
      <p className="text-sm text-muted-foreground">
        Les dispositifs auxquels les entreprises que suit votre structure peuvent indiquer être
        éligibles, et selon lesquels vous filtrez les candidatures reçues. Sont proposés par défaut
        : {DEFAULT_LABELS}. Renommez-les, décrivez-les, ordonnez-les, désactivez ceux que vous
        n’utilisez pas ou ajoutez les vôtres. Un dispositif n’est jamais supprimé : désactivé, il
        n’est plus proposé mais reste lisible là où il a servi.
      </p>
      <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-foreground">
        Ce sont des informations déclaratives : Confluent ne calcule aucun avantage fiscal et ne
        vérifie aucune condition. Vos conseillers peuvent indiquer avoir vérifié une éligibilité.
      </p>

      <ol aria-label="Dispositifs" className="flex flex-col gap-3">
        {schemes.map((scheme, index) => (
          <li
            key={scheme.id}
            className={
              'flex flex-col gap-3 rounded-lg border border-border bg-card p-4 md:flex-row md:items-center' +
              (scheme.active ? '' : ' opacity-70')
            }
          >
            <div className="min-w-0 flex-1">
              {editing === scheme.id ? (
                <EditForm
                  workspaceId={workspaceId}
                  scheme={scheme}
                  onCancel={() => setEditing(null)}
                  onSaved={() => {
                    setEditing(null)
                    onChange()
                  }}
                />
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="wrap-anywhere text-base font-medium text-foreground">
                      {scheme.label}
                    </span>
                    {!scheme.active && <Badge variant="destructive">Désactivé</Badge>}
                  </div>
                  {scheme.description && (
                    <p className="mt-1 wrap-anywhere text-sm text-foreground">
                      {scheme.description}
                    </p>
                  )}
                  <p className="mt-1 text-xs text-muted-foreground">
                    {DEFAULT_KEYS.has(scheme.key)
                      ? 'Proposé par défaut'
                      : 'Ajouté par la structure'}
                  </p>
                </>
              )}
            </div>
            {editing !== scheme.id && (
              <div className="flex shrink-0 flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  aria-label={`Monter « ${scheme.label} »`}
                  disabled={busy || index === 0}
                  onClick={() => void move(index, -1)}
                >
                  <ArrowUpIcon aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  aria-label={`Descendre « ${scheme.label} »`}
                  disabled={busy || index === schemes.length - 1}
                  onClick={() => void move(index, 1)}
                >
                  <ArrowDownIcon aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label={`Modifier « ${scheme.label} »`}
                  disabled={busy}
                  onClick={() => setEditing(scheme.id)}
                >
                  Modifier
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label={`${scheme.active ? 'Désactiver' : 'Réactiver'} « ${scheme.label} »`}
                  disabled={busy}
                  onClick={() => void setActive(scheme, !scheme.active)}
                >
                  {scheme.active ? 'Désactiver' : 'Réactiver'}
                </Button>
              </div>
            )}
          </li>
        ))}
      </ol>

      {schemes.length < ELIGIBILITY_SCHEME_LIMITS.perWorkspace ? (
        <AddForm workspaceId={workspaceId} onAdded={onChange} />
      ) : (
        <p className="text-sm text-muted-foreground">
          {ELIGIBILITY_SCHEME_LIMITS.perWorkspace} dispositifs au plus : renommez ou réactivez un
          dispositif existant.
        </p>
      )}
    </section>
  )
}

// Label and description, checked with the API's rules before sending.
function SchemeFields({
  ids,
  label,
  description,
  setLabel,
  setDescription,
  labelText,
  error,
}: {
  ids: { label: string; description: string; error: string }
  label: string
  description: string
  setLabel: (v: string) => void
  setDescription: (v: string) => void
  labelText: string
  error: string | null
}) {
  const described = error ? { 'aria-describedby': ids.error, 'aria-invalid': true } : {}
  return (
    <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
      <div className="flex min-w-0 flex-col gap-1.5">
        <Label htmlFor={ids.label}>{labelText}</Label>
        <Input
          id={ids.label}
          value={label}
          maxLength={ELIGIBILITY_SCHEME_LIMITS.label}
          placeholder="Par exemple : JEU"
          onChange={(e) => setLabel(e.target.value)}
          {...described}
        />
      </div>
      <div className="flex min-w-0 flex-col gap-1.5">
        <Label htmlFor={ids.description}>Description (facultatif)</Label>
        <Input
          id={ids.description}
          value={description}
          maxLength={ELIGIBILITY_SCHEME_LIMITS.description}
          placeholder="Ce qu’est ce dispositif, en une phrase"
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
    </div>
  )
}

function EditForm({
  workspaceId,
  scheme,
  onCancel,
  onSaved,
}: {
  workspaceId: string
  scheme: EligibilityScheme
  onCancel: () => void
  onSaved: () => void
}) {
  const ids = { label: useId(), description: useId(), error: useId() }
  const [label, setLabel] = useState(scheme.label)
  const [description, setDescription] = useState(scheme.description ?? '')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    const parsed = createEligibilitySchemeSchema.safeParse({ label, description })
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Saisie invalide.')
    setSaving(true)
    try {
      await updateEligibilityScheme(workspaceId, scheme.id, {
        label: parsed.data.label,
        description: parsed.data.description ?? null,
      })
      toast.success('Dispositif modifié.')
      onSaved()
    } catch (err) {
      setError(messageOf(err, 'Modification impossible.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form
      onSubmit={(e) => void submit(e)}
      aria-label={`Modifier « ${scheme.label} »`}
      className="flex flex-col gap-2"
      noValidate
    >
      <SchemeFields
        ids={ids}
        label={label}
        description={description}
        setLabel={(v) => {
          setLabel(v)
          setError(null)
        }}
        setDescription={(v) => {
          setDescription(v)
          setError(null)
        }}
        labelText="Libellé"
        error={error}
      />
      {error && (
        <p id={ids.error} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={saving}>
          Enregistrer
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={onCancel} disabled={saving}>
          Annuler
        </Button>
      </div>
    </form>
  )
}

function AddForm({ workspaceId, onAdded }: { workspaceId: string; onAdded: () => void }) {
  const ids = { label: useId(), description: useId(), error: useId(), title: useId() }
  const [label, setLabel] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    const parsed = createEligibilitySchemeSchema.safeParse({ label, description })
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Saisie invalide.')
    setSaving(true)
    try {
      const created = await createEligibilityScheme(workspaceId, parsed.data)
      toast.success(`« ${created.label} » ajouté.`)
      setLabel('')
      setDescription('')
      setError(null)
      onAdded()
    } catch (err) {
      setError(messageOf(err, 'Ajout impossible.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form
      onSubmit={(e) => void submit(e)}
      aria-labelledby={ids.title}
      className="flex flex-col gap-3 rounded-lg border border-dashed border-border p-4"
      noValidate
    >
      <h3 id={ids.title} className="text-sm font-medium text-foreground">
        Ajouter un dispositif
      </h3>
      <SchemeFields
        ids={ids}
        label={label}
        description={description}
        setLabel={(v) => {
          setLabel(v)
          setError(null)
        }}
        setDescription={(v) => {
          setDescription(v)
          setError(null)
        }}
        labelText="Libellé"
        error={error}
      />
      {error && (
        <p id={ids.error} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div>
        <Button type="submit" size="sm" disabled={saving}>
          Ajouter
        </Button>
      </div>
    </form>
  )
}
