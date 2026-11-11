import { useId, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import {
  DOSSIER_PRESENTATION_LIMITS,
  FINANCING_TYPES,
  FINANCING_TYPE_LABELS,
  PUBLICATION_REQUIREMENT_LABELS,
  isPublished,
  missingForPublication,
  updateDossierSchema,
  type Dossier,
  type FinancingType,
} from '@confluent/shared'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import type { ApiError } from '@/lib/api-client'
import { publishDossier, unpublishDossier, updateDossier } from '../api'
import { formatAmount, parseAmount } from '../presentation'

interface Draft {
  name: string
  summary: string
  objective: string
  description: string
  amount: string
  financingTypes: FinancingType[]
}

const draftOf = (d: Dossier): Draft => ({
  name: d.name,
  summary: d.summary ?? '',
  objective: d.objective ?? '',
  description: d.description ?? '',
  amount: d.amountEur === null ? '' : String(d.amountEur),
  financingTypes: [...d.financingTypes],
})

function errorMessage(err: unknown, fallback: string): string {
  const e = err as Partial<ApiError> | undefined
  if (e?.status === undefined) return `${fallback} Vérifiez votre connexion puis réessayez.`
  if (e.status === 404) return 'Cette demande n’existe plus ou vous ne pouvez pas la modifier.'
  if (e.status === 422 && Array.isArray(e.details)) {
    const labels = (e.details as Array<{ label?: string }>).map((d) => d.label).filter(Boolean)
    if (labels.length) return `${e.message} Manque : ${labels.join(', ').toLowerCase()}.`
  }
  return e.message ?? fallback
}

// The owner's financing request (E05.07): its title and presentation, then its publication. The
// presentation is plain text; recipients of the request's shares see it once it is published.
export function RequestEditor({
  dossier,
  onChange,
  inPreparation = false,
}: {
  dossier: Dossier
  onChange: (updated: Dossier) => void
  // E05.08: a company a conseiller prepares for an entrepreneur is published by that entrepreneur
  // only, once its owner.
  inPreparation?: boolean
}) {
  const [draft, setDraft] = useState<Draft>(() => draftOf(dossier))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const ids = {
    name: useId(),
    summary: useId(),
    objective: useId(),
    description: useId(),
    amount: useId(),
    types: useId(),
  }
  const published = isPublished(dossier)
  const missing = missingForPublication(dossier)
  const saved = JSON.stringify(draftOf(dossier)) === JSON.stringify(draft)

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }))
  }

  function toggleType(type: FinancingType, checked: boolean) {
    set(
      'financingTypes',
      checked
        ? FINANCING_TYPES.filter((t) => t === type || draft.financingTypes.includes(t))
        : draft.financingTypes.filter((t) => t !== type),
    )
  }

  async function save(e: FormEvent) {
    e.preventDefault()
    const amount = parseAmount(draft.amount)
    const nextErrors: Record<string, string> = {}
    if (amount === 'invalid') {
      nextErrors.amountEur = 'Indiquez un montant en euros, sans centimes (par exemple 750 000).'
    }
    const parsed = updateDossierSchema.safeParse({
      name: draft.name,
      summary: draft.summary,
      objective: draft.objective,
      description: draft.description,
      amountEur: amount === 'invalid' ? null : amount,
      financingTypes: draft.financingTypes,
    })
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? 'form')
        nextErrors[key] ??= issue.message
      }
    }
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0 || !parsed.success) return
    setBusy(true)
    try {
      const updated = await updateDossier(dossier.id, {
        name: draft.name,
        summary: draft.summary,
        objective: draft.objective,
        description: draft.description,
        amountEur: amount === 'invalid' ? null : amount,
        financingTypes: draft.financingTypes,
      })
      onChange(updated)
      setDraft(draftOf(updated))
      toast.success('Demande enregistrée.')
    } catch (err) {
      toast.error(errorMessage(err, 'La demande n’a pas été enregistrée.'))
    } finally {
      setBusy(false)
    }
  }

  async function togglePublication() {
    setBusy(true)
    try {
      const updated = published
        ? await unpublishDossier(dossier.id)
        : await publishDossier(dossier.id)
      onChange(updated)
      toast.success(
        published
          ? 'Demande repassée en brouillon : vos partages restent ouverts, sans sa présentation.'
          : 'Demande publiée : vos destinataires voient désormais sa présentation.',
      )
    } catch (err) {
      toast.error(
        errorMessage(
          err,
          published ? 'La demande n’a pas été dépubliée.' : 'La demande n’a pas été publiée.',
        ),
      )
    } finally {
      setBusy(false)
    }
  }

  const fieldError = (key: string, id: string) =>
    errors[key] ? (
      <p id={`${id}-error`} className="text-xs text-destructive">
        {errors[key]}
      </p>
    ) : null
  const described = (key: string, id: string) =>
    errors[key] ? { 'aria-invalid': true, 'aria-describedby': `${id}-error` } : {}

  return (
    <div className="flex flex-col gap-8">
      <section
        aria-labelledby="publication-heading"
        className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="publication-heading" className="font-heading text-lg font-semibold text-foreground">
            Publication
          </h2>
          <Badge variant={published ? 'default' : 'secondary'}>
            {published ? 'Publiée' : 'Brouillon'}
          </Badge>
        </div>
        {inPreparation ? (
          <p className="text-sm text-muted-foreground">
            Vous préparez cette entreprise pour un entrepreneur : seul son propriétaire pourra
            publier cette demande, après avoir accepté votre proposition.
          </p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              {published
                ? `Publiée le ${new Date(dossier.publishedAt ?? '').toLocaleDateString('fr-FR')}. Les destinataires de vos partages voient sa présentation ; elle pourra être proposée aux structures que vous choisirez.`
                : 'En brouillon, les destinataires de vos partages voient le profil et les documents choisis, pas encore la présentation de la demande. Publier n’ouvre ni ne ferme aucun partage.'}
            </p>
            {!published && missing.length > 0 && (
              <div className="text-sm">
                <p className="text-foreground">Avant de publier :</p>
                <ul className="mt-1 list-disc pl-5 text-muted-foreground">
                  {missing.map((item) => (
                    <li key={item}>
                      {PUBLICATION_REQUIREMENT_LABELS[item]}
                      {item === 'submitted' && (
                        <>
                          {' — '}
                          <Link
                            to={`/dashboard/dossiers/nouveau/recapitulatif?dossierId=${encodeURIComponent(dossier.id)}`}
                            className="underline underline-offset-4 hover:text-foreground"
                          >
                            vérifier et soumettre le profil
                          </Link>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div>
              <Button
                type="button"
                variant={published ? 'outline' : 'default'}
                className="h-11 px-4"
                disabled={busy || (!published && (missing.length > 0 || !saved))}
                onClick={() => void togglePublication()}
              >
                {published ? 'Repasser en brouillon' : 'Publier la demande'}
              </Button>
              {!published && !saved && missing.length === 0 && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Enregistrez d’abord vos modifications.
                </p>
              )}
            </div>
          </>
        )}
      </section>

      <form onSubmit={(e) => void save(e)} className="flex flex-col gap-5" noValidate>
        <h2 className="font-heading text-xl font-semibold text-foreground md:text-2xl">
          Présentation de la demande
        </h2>
        <div className="flex flex-col gap-1">
          <label htmlFor={ids.name} className="text-sm font-medium text-foreground">
            Titre
          </label>
          <Input
            id={ids.name}
            className="h-11"
            value={draft.name}
            maxLength={DOSSIER_PRESENTATION_LIMITS.name}
            onChange={(e) => set('name', e.target.value)}
            {...described('name', ids.name)}
          />
          {fieldError('name', ids.name)}
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={ids.summary} className="text-sm font-medium text-foreground">
            Résumé
          </label>
          <Textarea
            id={ids.summary}
            rows={2}
            value={draft.summary}
            maxLength={DOSSIER_PRESENTATION_LIMITS.summary}
            onChange={(e) => set('summary', e.target.value)}
            {...described('summary', ids.summary)}
          />
          <p className="text-xs text-muted-foreground">
            En une ou deux phrases ({draft.summary.length}/{DOSSIER_PRESENTATION_LIMITS.summary}).
          </p>
          {fieldError('summary', ids.summary)}
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={ids.objective} className="text-sm font-medium text-foreground">
            Objectif du financement
          </label>
          <Textarea
            id={ids.objective}
            rows={3}
            value={draft.objective}
            maxLength={DOSSIER_PRESENTATION_LIMITS.objective}
            onChange={(e) => set('objective', e.target.value)}
            {...described('objective', ids.objective)}
          />
          <p className="text-xs text-muted-foreground">À quoi servira-t-il ?</p>
          {fieldError('objective', ids.objective)}
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={ids.description} className="text-sm font-medium text-foreground">
            Description <span className="font-normal text-muted-foreground">(facultative)</span>
          </label>
          <Textarea
            id={ids.description}
            rows={6}
            value={draft.description}
            maxLength={DOSSIER_PRESENTATION_LIMITS.description}
            onChange={(e) => set('description', e.target.value)}
            {...described('description', ids.description)}
          />
          <p className="text-xs text-muted-foreground">
            Texte simple, sans mise en forme ({draft.description.length}/
            {DOSSIER_PRESENTATION_LIMITS.description}).
          </p>
          {fieldError('description', ids.description)}
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={ids.amount} className="text-sm font-medium text-foreground">
            Montant recherché (€)
          </label>
          <Input
            id={ids.amount}
            className="h-11 sm:w-64"
            inputMode="numeric"
            value={draft.amount}
            onChange={(e) => set('amount', e.target.value)}
            {...described('amountEur', ids.amount)}
          />
          {(() => {
            const parsed = parseAmount(draft.amount)
            return typeof parsed === 'number' ? (
              <p className="text-xs text-muted-foreground">{formatAmount(parsed)}</p>
            ) : null
          })()}
          {fieldError('amountEur', ids.amount)}
        </div>
        <fieldset className="flex flex-col gap-2" aria-describedby={errors.financingTypes ? `${ids.types}-error` : undefined}>
          <legend className="text-sm font-medium text-foreground">Types de financement</legend>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {FINANCING_TYPES.map((type) => (
              <label key={type} className="flex min-h-11 items-center gap-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  className="size-4"
                  checked={draft.financingTypes.includes(type)}
                  onChange={(e) => toggleType(type, e.target.checked)}
                />
                {FINANCING_TYPE_LABELS[type]}
              </label>
            ))}
          </div>
          {fieldError('financingTypes', ids.types)}
        </fieldset>
        <div>
          <Button type="submit" className="h-11 px-4" disabled={busy || saved}>
            Enregistrer
          </Button>
        </div>
      </form>
    </div>
  )
}
