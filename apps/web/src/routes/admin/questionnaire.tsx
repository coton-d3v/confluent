import { useEffect, useRef, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { useCurrentUser } from '@/features/current-user/context'
import type { QuestionnaireVersionStatus } from '@confluent/shared'
import { getActiveQuestionnaire } from '@/features/questionnaire/api'
import {
  listQuestionnaireVersions,
  patchQuestionnaireField,
} from '@/features/admin/questionnaire.api'
import { buildDynamicQuestionnaire } from '@/features/questionnaire/adapter'
import { useAsync } from '@/lib/useAsync'
import type { ApiError } from '@/lib/api-client'

export default function AdminQuestionnaireRoute() {
  const me = useCurrentUser()
  if (me.role !== 'admin') return <Navigate to="/dashboard" replace />
  return <AdminQuestionnaireBuilder />
}

const VERSION_STATUS: Record<
  QuestionnaireVersionStatus,
  { label: string; variant: 'default' | 'secondary' | 'outline' }
> = {
  draft: { label: 'Brouillon', variant: 'outline' },
  published: { label: 'Publiée', variant: 'default' },
  archived: { label: 'Archivée', variant: 'secondary' },
}

function AdminQuestionnaireBuilder() {
  const headingRef = useRef<HTMLHeadingElement>(null)
  const versions = useAsync(() => listQuestionnaireVersions(), [])
  const active = useAsync(() => getActiveQuestionnaire(), [])

  useEffect(() => {
    headingRef.current?.focus()
  }, [])

  const dynamic = active.data ? buildDynamicQuestionnaire(active.data) : null
  const totalFields = active.data?.fields.length ?? 0

  async function handleSaveField(fieldId: string, label: string) {
    if (!active.data) return
    try {
      await patchQuestionnaireField(active.data.version.id, fieldId, { label })
      toast.success('Champ mis à jour')
      active.refetch()
    } catch (err) {
      const apiErr = err as ApiError
      toast.error(apiErr?.message ?? 'Modification impossible.')
    }
  }

  return (
    <>
      <title>Questionnaire · Confluent</title>
      <h1
        ref={headingRef}
        tabIndex={-1}
        className="font-heading text-2xl font-semibold text-foreground md:text-[28px] focus-visible:outline-none"
      >
        Questionnaire
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Modifier les libellés des champs de la version publiée. La création d&apos;une
        nouvelle version reste à venir.
      </p>

      <section className="mt-8">
        <h2 className="font-heading text-xl font-semibold text-foreground md:text-2xl">
          Versions
        </h2>
        <div className="mt-4 overflow-hidden rounded-lg border border-border bg-card">
          {versions.isLoading ? (
            <p className="px-4 py-3 text-sm text-muted-foreground">Chargement…</p>
          ) : versions.error ? (
            <p className="px-4 py-3 text-sm text-destructive">
              Impossible de charger les versions.
            </p>
          ) : (versions.data ?? []).length === 0 ? (
            <p className="px-4 py-3 text-sm text-muted-foreground">
              Aucune version publiée.
            </p>
          ) : (
            <ul role="list" className="m-0 list-none divide-y divide-border p-0">
              {(versions.data ?? []).map((v) => (
                <li
                  key={v.id}
                  className="flex items-center justify-between gap-3 px-4 py-3 text-sm"
                >
                  <span className="text-foreground">Version {v.version}</span>
                  <Badge variant={VERSION_STATUS[v.status].variant}>
                    {VERSION_STATUS[v.status].label}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="mt-8">
        <div className="mb-4 flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
          <div>
            <h2 className="font-heading text-xl font-semibold text-foreground md:text-2xl">
              Champs de la version active
            </h2>
            {dynamic && (
              <p className="mt-1 text-xs text-muted-foreground">
                {dynamic.sections.length} sections · {totalFields} champs
              </p>
            )}
          </div>
        </div>

        {active.isLoading ? (
          <p className="text-sm text-muted-foreground">Chargement…</p>
        ) : active.error || !dynamic ? (
          <p className="text-sm text-destructive">Impossible de charger les champs.</p>
        ) : (
          <ul role="list" className="flex flex-col gap-6">
            {dynamic.sections.map((section, i) => (
              <li key={section.id}>
                <div className="rounded-lg border border-border bg-card">
                  <div className="border-b border-border px-4 py-3">
                    <h3 className="text-sm font-semibold text-foreground">
                      {i + 1}. {section.title}
                    </h3>
                  </div>
                  <ul role="list" className="m-0 list-none divide-y divide-border p-0">
                    {section.questions.map((q) => (
                      <li key={q.id} className="px-4 py-3">
                        <FieldEditor
                          fieldId={q.id}
                          label={q.label}
                          onSave={(label) => handleSaveField(q.id, label)}
                        />
                      </li>
                    ))}
                  </ul>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  )
}

function FieldEditor({
  fieldId,
  label,
  onSave,
}: {
  fieldId: string
  label: string
  onSave: (label: string) => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(label)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!editing) setDraft(label)
  }, [label, editing])

  async function handleSave() {
    if (draft.trim() === label) {
      setEditing(false)
      return
    }
    setSaving(true)
    try {
      await onSave(draft.trim())
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  if (editing) {
    return (
      <div className="flex flex-col gap-2">
        <Input
          aria-label={`Modifier le libellé du champ ${fieldId}`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={saving}
          autoFocus
        />
        <div className="flex gap-2">
          <Button type="button" size="sm" onClick={handleSave} disabled={saving}>
            {saving ? 'Sauvegarde…' : 'Enregistrer'}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setEditing(false)}
            disabled={saving}
          >
            Annuler
          </Button>
        </div>
      </div>
    )
  }
  return (
    <div className="flex items-center justify-between gap-3">
      <p className="text-sm text-foreground">{label}</p>
      <Button type="button" size="sm" variant="outline" onClick={() => setEditing(true)}>
        Modifier
      </Button>
    </div>
  )
}
