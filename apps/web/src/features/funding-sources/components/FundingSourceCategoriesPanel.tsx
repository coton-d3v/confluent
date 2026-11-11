import { useId, useState, type FormEvent } from 'react'
import { ArrowDownIcon, ArrowUpIcon } from 'lucide-react'
import { toast } from 'sonner'
import {
  DEFAULT_FUNDING_SOURCE_CATEGORIES,
  FUNDING_SOURCE_CATEGORY_LIMITS,
  FUNDING_SOURCE_FAMILIES,
  FUNDING_SOURCE_FAMILY_LABELS,
  createFundingSourceCategorySchema,
  updateFundingSourceCategorySchema,
  type FundingSourceCategory,
  type FundingSourceFamily,
} from '@confluent/shared'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import type { ApiError } from '@/lib/api-client'
import {
  createFundingSourceCategory,
  reorderFundingSourceCategories,
  updateFundingSourceCategory,
} from '../api'

const DEFAULT_KEYS = new Set(DEFAULT_FUNDING_SOURCE_CATEGORIES.map((c) => c.key))
const DEFAULT_LABELS = DEFAULT_FUNDING_SOURCE_CATEGORIES.map((c) => c.label).join(', ')

const messageOf = (err: unknown, fallback: string) => (err as ApiError)?.message ?? fallback

// The categories of sources of a workspace's financing plans (ROADMAP E06.02), for its managers and
// Confluent's administrators: rename, order, deactivate/reactivate, add. Key and nature never
// change; a category is never deleted. The API decides, at each request; the list is reloaded after
// every change (`onChange`).
export function FundingSourceCategoriesPanel({
  workspaceId,
  categories,
  onChange,
}: {
  workspaceId: string
  categories: FundingSourceCategory[]
  onChange: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [renaming, setRenaming] = useState<string | null>(null)
  const active = categories.filter((c) => c.active).length

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
    const ids = categories.map((c) => c.id)
    ;[ids[index], ids[index + by]] = [ids[index + by], ids[index]]
    const moved = categories[index]
    return act(
      () => reorderFundingSourceCategories(workspaceId, ids),
      `« ${moved.label} » ${by < 0 ? 'monte' : 'descend'} d’un rang.`,
      'Ordre non enregistré.',
    )
  }

  const setActive = (category: FundingSourceCategory, value: boolean) =>
    act(
      () => updateFundingSourceCategory(workspaceId, category.id, { active: value }),
      `« ${category.label} » est ${value ? 'réactivée' : 'désactivée'}.`,
      value ? 'Réactivation impossible.' : 'Désactivation impossible.',
    )

  return (
    <section aria-labelledby="ws-sources-title" className="flex flex-col gap-4">
      <div>
        <h2 id="ws-sources-title" className="font-heading text-lg font-semibold text-foreground">
          Sources du plan de financement
        </h2>
        <p className="text-sm text-muted-foreground">
          {active} active{active > 1 ? 's' : ''}
          {categories.length > active
            ? `, ${categories.length - active} désactivée${categories.length - active > 1 ? 's' : ''}`
            : ''}
        </p>
      </div>
      <p className="text-sm text-muted-foreground">
        Les catégories dans lesquelles se répartit le plan de financement des demandes que suit
        votre structure. Sont proposées par défaut : {DEFAULT_LABELS}. Renommez-les, ordonnez-les,
        désactivez celles que vous n’utilisez pas ou ajoutez les vôtres. Une source n’est jamais
        supprimée : désactivée, elle n’est plus proposée mais reste lisible là où elle a servi. Sa
        nature, fixée à sa création, la rattache à une famille commune à toutes les structures.
      </p>

      <ol aria-label="Sources du plan de financement" className="flex flex-col gap-3">
        {categories.map((category, index) => (
          <li
            key={category.id}
            className={
              'flex flex-col gap-3 rounded-lg border border-border bg-card p-4 md:flex-row md:items-center' +
              (category.active ? '' : ' opacity-70')
            }
          >
            <div className="min-w-0 flex-1">
              {renaming === category.id ? (
                <RenameForm
                  category={category}
                  onCancel={() => setRenaming(null)}
                  onSaved={() => {
                    setRenaming(null)
                    onChange()
                  }}
                  workspaceId={workspaceId}
                />
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="wrap-anywhere text-base font-medium text-foreground">
                      {category.label}
                    </span>
                    {!category.active && <Badge variant="destructive">Désactivée</Badge>}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {FUNDING_SOURCE_FAMILY_LABELS[category.family]}
                    {' · '}
                    {DEFAULT_KEYS.has(category.key)
                      ? 'proposée par défaut'
                      : 'ajoutée par la structure'}
                  </p>
                </>
              )}
            </div>
            {renaming !== category.id && (
              <div className="flex shrink-0 flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  aria-label={`Monter « ${category.label} »`}
                  disabled={busy || index === 0}
                  onClick={() => void move(index, -1)}
                >
                  <ArrowUpIcon aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  aria-label={`Descendre « ${category.label} »`}
                  disabled={busy || index === categories.length - 1}
                  onClick={() => void move(index, 1)}
                >
                  <ArrowDownIcon aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label={`Renommer « ${category.label} »`}
                  disabled={busy}
                  onClick={() => setRenaming(category.id)}
                >
                  Renommer
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label={`${category.active ? 'Désactiver' : 'Réactiver'} « ${category.label} »`}
                  disabled={busy}
                  onClick={() => void setActive(category, !category.active)}
                >
                  {category.active ? 'Désactiver' : 'Réactiver'}
                </Button>
              </div>
            )}
          </li>
        ))}
      </ol>

      {categories.length < FUNDING_SOURCE_CATEGORY_LIMITS.perWorkspace ? (
        <AddForm workspaceId={workspaceId} onAdded={onChange} />
      ) : (
        <p className="text-sm text-muted-foreground">
          {FUNDING_SOURCE_CATEGORY_LIMITS.perWorkspace} sources au plus : renommez ou réactivez une
          source existante.
        </p>
      )}
    </section>
  )
}

function RenameForm({
  workspaceId,
  category,
  onCancel,
  onSaved,
}: {
  workspaceId: string
  category: FundingSourceCategory
  onCancel: () => void
  onSaved: () => void
}) {
  const inputId = useId()
  const [label, setLabel] = useState(category.label)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    const parsed = updateFundingSourceCategorySchema.safeParse({ label })
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Libellé invalide.')
    setSaving(true)
    try {
      await updateFundingSourceCategory(workspaceId, category.id, parsed.data)
      toast.success('Source renommée.')
      onSaved()
    } catch (err) {
      setError(messageOf(err, 'Renommage impossible.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-2" noValidate>
      <Label htmlFor={inputId}>Nouveau libellé de « {category.label} »</Label>
      <Input
        id={inputId}
        value={label}
        maxLength={FUNDING_SOURCE_CATEGORY_LIMITS.label}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${inputId}-error` : undefined}
        autoFocus
        onChange={(e) => {
          setLabel(e.target.value)
          setError(null)
        }}
      />
      {error && (
        <p id={`${inputId}-error`} role="alert" className="text-sm text-destructive">
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
  const labelId = useId()
  const familyId = useId()
  const [label, setLabel] = useState('')
  const [family, setFamily] = useState<FundingSourceFamily | ''>('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    const parsed = createFundingSourceCategorySchema.safeParse({ label, family })
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Saisie invalide.')
    setSaving(true)
    try {
      const created = await createFundingSourceCategory(workspaceId, parsed.data)
      toast.success(`« ${created.label} » ajoutée.`)
      setLabel('')
      setFamily('')
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
      aria-labelledby={`${labelId}-title`}
      className="flex flex-col gap-3 rounded-lg border border-dashed border-border p-4"
      noValidate
    >
      <h3 id={`${labelId}-title`} className="text-sm font-medium text-foreground">
        Ajouter une source
      </h3>
      <div className="flex flex-col gap-3 md:flex-row md:items-end">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <Label htmlFor={labelId}>Libellé</Label>
          <Input
            id={labelId}
            value={label}
            maxLength={FUNDING_SOURCE_CATEGORY_LIMITS.label}
            placeholder="Par exemple : Subvention régionale"
            onChange={(e) => {
              setLabel(e.target.value)
              setError(null)
            }}
          />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <Label htmlFor={familyId}>Nature</Label>
          <NativeSelect
            id={familyId}
            value={family}
            onChange={(e) => {
              setFamily(e.target.value as FundingSourceFamily | '')
              setError(null)
            }}
          >
            <option value="">Choisir…</option>
            {FUNDING_SOURCE_FAMILIES.map((f) => (
              <option key={f} value={f}>
                {FUNDING_SOURCE_FAMILY_LABELS[f]}
              </option>
            ))}
          </NativeSelect>
        </div>
        <Button type="submit" size="sm" disabled={saving} className="self-start md:self-auto">
          Ajouter
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </form>
  )
}
