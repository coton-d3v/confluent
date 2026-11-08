import { useEffect, useRef, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import type { FormSummary } from '@confluent/shared'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useCurrentUser } from '@/features/current-user/context'
import { createForm, listForms } from '@/features/admin/forms.api'
import { NameSheet, type NameRequest } from '@/features/form-builder/components/NameSheet'
import { formatDate, USAGE_LABELS } from '@/features/form-builder/labels'
import { errorMessage } from '@/features/form-builder/useFormEditor'
import { useAsync } from '@/lib/useAsync'

export default function AdminFormsRoute() {
  const me = useCurrentUser()
  if (me.role !== 'admin') return <Navigate to="/dashboard" replace />
  return <AdminFormsList />
}

function AdminFormsList() {
  const headingRef = useRef<HTMLHeadingElement>(null)
  const navigate = useNavigate()
  const forms = useAsync(() => listForms(), [])
  const [showArchived, setShowArchived] = useState(false)
  const [nameRequest, setNameRequest] = useState<NameRequest | null>(null)

  useEffect(() => {
    headingRef.current?.focus()
  }, [])

  const all = forms.data ?? []
  const visible = all.filter((f) => showArchived || !f.archivedAt)
  const archivedCount = all.filter((f) => f.archivedAt).length

  function openCreate() {
    setNameRequest({
      title: 'Nouveau formulaire',
      description:
        'Le formulaire est créé avec un brouillon vide, non affecté : il ne sert à aucun dossier tant qu’il n’est pas publié et affecté.',
      submitLabel: 'Créer le formulaire',
      fieldLabel: 'Nom du formulaire',
      initialName: '',
      onSubmit: async (name) => {
        try {
          const created = await createForm(name)
          toast.success('Formulaire créé.')
          void navigate(`/admin/formulaires/${created.id}`)
          return true
        } catch (err) {
          toast.error(errorMessage(err, 'Création impossible.'))
          return false
        }
      },
    })
  }

  return (
    <>
      <title>Formulaires · Confluent</title>
      <div className="flex flex-col items-start justify-between gap-3 md:flex-row md:items-center">
        <h1
          ref={headingRef}
          tabIndex={-1}
          className="font-heading text-2xl font-semibold text-foreground md:text-[28px] focus-visible:outline-none"
        >
          Formulaires
        </h1>
        <Button type="button" size="sm" onClick={openCreate}>
          Nouveau formulaire
        </Button>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        Chaque formulaire évolue par brouillon puis publication. Un dossier garde toujours la version
        avec laquelle il a été créé.
      </p>

      {forms.isLoading && !forms.data ? (
        <p className="mt-8 text-sm text-muted-foreground">Chargement…</p>
      ) : forms.error ? (
        <p className="mt-8 text-sm text-destructive">Impossible de charger les formulaires.</p>
      ) : (
        <>
          <ul role="list" className="mt-8 flex flex-col gap-3">
            {visible.map((form) => (
              <FormRow key={form.id} form={form} />
            ))}
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

function FormRow({ form }: { form: FormSummary }) {
  return (
    <li className="rounded-lg border border-border bg-card px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link
          to={`/admin/formulaires/${form.id}`}
          className="text-base font-medium text-foreground underline-offset-4 hover:underline"
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
