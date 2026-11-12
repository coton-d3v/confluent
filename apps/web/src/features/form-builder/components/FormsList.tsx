import { useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import type { FormSummary } from '@confluent/shared'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { ApiError } from '@/lib/api-client'
import { useAsync } from '@/lib/useAsync'
import { formatDate, USAGE_LABELS } from '../labels'
import type { FormsPlace } from '../place'
import { errorMessage } from '../useFormEditor'
import { NameSheet, type NameRequest } from './NameSheet'

// The forms of one place (Confluent's, or a workspace's — E05.09), with creation. `title`: the
// heading the page gives the list. The API decides at each request who may see them.
export function FormsList({
  place,
  title,
  onForbidden,
}: {
  place: FormsPlace
  title: ReactNode
  // Shown instead of the list when the API refuses the account (403).
  onForbidden?: ReactNode
}) {
  const navigate = useNavigate()
  const { api } = place
  const forms = useAsync(() => api.listForms(), [api])
  const [showArchived, setShowArchived] = useState(false)
  const [nameRequest, setNameRequest] = useState<NameRequest | null>(null)

  const all = forms.data ?? []
  const visible = all.filter((f) => showArchived || !f.archivedAt)
  const archivedCount = all.filter((f) => f.archivedAt).length

  function openCreate() {
    setNameRequest({
      title: 'Nouveau formulaire',
      description: place.texts.createDescription,
      submitLabel: 'Créer le formulaire',
      fieldLabel: 'Nom du formulaire',
      initialName: '',
      onSubmit: async (name) => {
        try {
          const created = await api.createForm(name)
          toast.success('Formulaire créé.')
          void navigate(place.editorPath(created.id))
          return true
        } catch (err) {
          toast.error(errorMessage(err, 'Création impossible.'))
          return false
        }
      },
    })
  }

  if (forms.error && (forms.error as ApiError).status === 403 && onForbidden) {
    return <>{onForbidden}</>
  }

  return (
    <>
      <div className="flex flex-col items-start justify-between gap-3 md:flex-row md:items-center">
        {title}
        <Button type="button" size="sm" onClick={openCreate}>
          Nouveau formulaire
        </Button>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">{place.texts.intro}</p>

      {forms.isLoading && !forms.data ? (
        <p className="mt-8 text-sm text-muted-foreground">Chargement…</p>
      ) : forms.error ? (
        <p className="mt-8 text-sm text-destructive">Impossible de charger les formulaires.</p>
      ) : (
        <>
          <ul role="list" className="mt-8 flex flex-col gap-3">
            {visible.map((form) => (
              <FormRow key={form.id} form={form} to={place.editorPath(form.id)} />
            ))}
            {visible.length === 0 && (
              <li className="text-sm text-muted-foreground">Aucun formulaire pour l’instant.</li>
            )}
          </ul>
          {archivedCount > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mt-4"
              aria-pressed={showArchived}
              onClick={() => setShowArchived((v) => !v)}
            >
              {showArchived
                ? 'Masquer les formulaires archivés'
                : `Afficher les formulaires archivés (${archivedCount})`}
            </Button>
          )}
        </>
      )}

      <NameSheet request={nameRequest} onClose={() => setNameRequest(null)} />
    </>
  )
}

function FormRow({ form, to }: { form: FormSummary; to: string }) {
  return (
    <li className="rounded-lg border border-border bg-card px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link
          to={to}
          className="min-w-0 wrap-anywhere text-base font-medium text-foreground underline-offset-4 hover:underline"
        >
          {form.name}
        </Link>
        <div className="flex flex-wrap items-center gap-1.5">
          {form.usage ? (
            <Badge>{USAGE_LABELS[form.usage] ?? form.usage}</Badge>
          ) : (
            <Badge variant="outline">Non affecté</Badge>
          )}
          {form.archivedAt && <Badge variant="secondary">Archivé</Badge>}
        </div>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {form.published
          ? `Version ${form.published.version} publiée le ${formatDate(form.published.publishedAt)}`
          : 'Jamais publié'}
        {form.draft && ` · brouillon en cours (version ${form.draft.version})`}
      </p>
    </li>
  )
}
