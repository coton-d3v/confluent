import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Info } from 'lucide-react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { useCurrentUser } from '@/features/current-user/context'
import {
  adminRevokeShare,
  getAdminDossier,
  getAdminDossierAuditLog,
  listAdminDossiers,
  patchAdminAnswers,
} from '@/features/admin/dossiers.api'
import { buildDynamicQuestionnaire } from '@/features/questionnaire/adapter'
import { answerLabel } from '@/features/questionnaire/answer-label'
import type { Question } from '@/data/questionnaire'
import { useAsync } from '@/lib/useAsync'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect } from '@/components/ui/native-select'
import type { ApiError } from '@/lib/api-client'
import { RequestPresentation } from '@/features/dossiers/components/RequestPresentation'
import { hasPresentation } from '@/features/dossiers/presentation'
import type { AdminDossierDetail } from '@/features/admin/dossiers.api'

const SEARCH_PAGE_SIZE = 100

export default function AdminDossierDetailRoute() {
  const user = useCurrentUser()
  if (user.role !== 'admin') return <Navigate to="/dashboard" replace />
  return <AdminDossierBySlug />
}

function AdminDossierBySlug() {
  const { slug } = useParams<{ slug: string }>()
  // TODO: backend endpoint to resolve dossier id from slug. For V1, scan first page (max 100).
  const list = useAsync(() => listAdminDossiers(1, SEARCH_PAGE_SIZE), [])

  if (!slug) return <NotFound />
  if (list.isLoading) return <p className="pt-8 text-sm text-muted-foreground">Chargement…</p>
  if (list.error) {
    return (
      <p className="pt-8 text-sm text-destructive">
        Impossible de charger la liste des dossiers.
      </p>
    )
  }
  const item = list.data?.items.find((d) => d.slug === slug)
  if (!item) return <NotFound />
  return <AdminDossierDetailView dossierId={item.id} dossierName={item.name} />
}

function NotFound() {
  return (
    <section className="mx-auto max-w-md pt-16 text-center">
      <title>Dossier introuvable · Confluent</title>
      <p className="text-sm text-muted-foreground">Dossier introuvable.</p>
      <Link
        to="/admin/dossiers"
        className="mt-4 inline-block text-sm underline hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
      >
        Retour à la liste
      </Link>
    </section>
  )
}

function AdminDossierDetailView({
  dossierId,
  dossierName,
}: {
  dossierId: string
  dossierName: string
}) {
  const headingRef = useRef<HTMLHeadingElement>(null)
  const detailQuery = useAsync(() => getAdminDossier(dossierId), [dossierId])
  const auditQuery = useAsync(() => getAdminDossierAuditLog(dossierId), [dossierId])

  useEffect(() => {
    headingRef.current?.focus()
  }, [dossierId])

  const answersByFieldId = useMemo<Record<string, string>>(() => {
    const map: Record<string, string> = {}
    for (const a of detailQuery.data?.answers ?? []) map[a.fieldId] = a.value
    return map
  }, [detailQuery.data])

  // The dossier's own questionnaire version: answers and edits target the fields it was created with.
  const snapshot = detailQuery.data?.questionnaireVersion
  const dynamic = useMemo(() => (snapshot ? buildDynamicQuestionnaire(snapshot) : null), [snapshot])

  const handleSaveAnswer = useCallback(
    async (fieldId: string, value: string) => {
      await patchAdminAnswers(dossierId, [{ fieldId, value }])
      toast.success('Réponse mise à jour')
      detailQuery.refetch()
      auditQuery.refetch()
    },
    [dossierId, detailQuery, auditQuery],
  )

  async function handleRevokeShare(linkId: string) {
    try {
      await adminRevokeShare(dossierId, linkId)
      toast.success('Accès révoqué')
      detailQuery.refetch()
      auditQuery.refetch()
    } catch (err) {
      const apiErr = err as ApiError
      toast.error(apiErr?.message ?? 'Révocation impossible.')
    }
  }

  return (
    <div className="mx-auto max-w-[720px]">
      <title>{dossierName} · Confluent</title>

      <nav aria-label="Fil d'Ariane" className="mb-4">
        <ol className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <li>
            <Link
              to="/admin"
              className="rounded-sm hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
            >
              Admin
            </Link>
          </li>
          <li className="flex items-center gap-1.5">
            <span aria-hidden="true" className="text-muted-foreground/60">/</span>
            <Link
              to="/admin/dossiers"
              className="rounded-sm hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
            >
              Dossiers
            </Link>
          </li>
          <li className="flex items-center gap-1.5">
            <span aria-hidden="true" className="text-muted-foreground/60">/</span>
            <span aria-current="page" className="font-medium text-foreground">
              {dossierName}
            </span>
          </li>
        </ol>
      </nav>

      <h1
        ref={headingRef}
        tabIndex={-1}
        className="font-heading text-2xl font-semibold text-foreground md:text-[28px] focus-visible:outline-none"
      >
        {dossierName}
      </h1>
      {detailQuery.data && (
        <p className="mt-1 text-sm text-muted-foreground">
          Entreprise : {detailQuery.data.company.name} · {detailQuery.data.ownerEmail} ·{' '}
          {detailQuery.data.publicationStatus === 'published' ? 'Demande publiée' : 'Demande en brouillon'}
        </p>
      )}
      {detailQuery.data && <AdminRequest detail={detailQuery.data} />}

      <div
        role="note"
        className="mt-4 flex items-start gap-3 rounded-md border border-border bg-muted/50 px-4 py-3 text-sm text-muted-foreground"
      >
        <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-foreground" />
        <p>
          Vous consultez ce dossier en tant qu&apos;administrateur. Chaque modification est tracée
          dans le journal d&apos;audit ci-dessous.
        </p>
      </div>

      {detailQuery.isLoading ? (
        <p className="mt-8 text-sm text-muted-foreground">Chargement…</p>
      ) : detailQuery.error || !detailQuery.data || !dynamic ? (
        <p className="mt-8 text-sm text-destructive">
          Impossible de charger le dossier.
        </p>
      ) : (
        <>
          <div className="mt-8 flex flex-col gap-10">
            {dynamic.sections.map((section, i) => {
              const sectionMetas = dynamic.flat.filter((q) => q.sectionId === section.id)
              return (
                <section key={section.id}>
                  <h2 className="font-heading text-xl font-semibold text-foreground md:text-2xl">
                    {i + 1}. {section.title}
                  </h2>
                  <dl className="mt-4 flex flex-col gap-6">
                    {sectionMetas.map((q) => (
                      <AdminEditableField
                        key={q.id}
                        question={q}
                        value={answersByFieldId[q.id] ?? ''}
                        onSave={(value) => handleSaveAnswer(q.id, value)}
                      />
                    ))}
                  </dl>
                </section>
              )
            })}
          </div>

          <section className="mt-10">
            <h2 className="font-heading text-xl font-semibold text-foreground md:text-2xl">
              Partages
            </h2>
            <div className="mt-4 overflow-hidden rounded-lg border border-border bg-card">
              {detailQuery.data.shareLinks.length === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                  Aucun partage pour ce dossier.
                </p>
              ) : (
                <ul role="list" className="m-0 list-none divide-y divide-border p-0">
                  {detailQuery.data.shareLinks.map((s) => (
                    <li
                      key={s.id}
                      className="flex items-center justify-between gap-3 px-4 py-3 text-sm"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-foreground">{s.recipientEmail}</p>
                        <p className="text-xs text-muted-foreground">Statut : {s.status}</p>
                      </div>
                      {s.status !== 'revoked' && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => handleRevokeShare(s.id)}
                        >
                          Révoquer
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </>
      )}

      <section className="mt-10">
        <h2 className="font-heading text-xl font-semibold text-foreground md:text-2xl">
          Journal d&apos;audit
        </h2>
        <div className="mt-4 overflow-hidden rounded-lg border border-border bg-card">
          {auditQuery.isLoading ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">Chargement…</p>
          ) : (auditQuery.data ?? []).length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">
              Aucun événement à afficher.
            </p>
          ) : (
            <ul role="list" className="m-0 list-none divide-y divide-border p-0">
              {(auditQuery.data ?? []).map((event) => (
                <li key={event.id} className="px-4 py-3 text-sm">
                  <p className="font-mono text-xs text-muted-foreground">
                    {new Date(event.createdAt).toLocaleString('fr-FR')}
                  </p>
                  <p className="mt-1 text-foreground">{event.actionType}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  )
}

function AdminEditableField({
  question,
  value,
  onSave,
}: {
  question: Question
  value: string
  onSave: (next: string) => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!editing) setDraft(value)
  }, [value, editing])

  async function handleSave() {
    if (draft === value) {
      setEditing(false)
      return
    }
    setSaving(true)
    try {
      await onSave(draft)
      setEditing(false)
    } catch (err) {
      const apiErr = err as ApiError
      toast.error(apiErr?.message ?? 'Sauvegarde impossible.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <dt className="text-[11px] uppercase tracking-wider text-muted-foreground">
        {question.label}
      </dt>
      <dd>
        {editing ? (
          <div className="flex flex-col gap-2">
            {question.choices ? (
              <ChoiceSelect
                label={question.label}
                choices={question.choices}
                value={draft}
                onChange={setDraft}
                disabled={saving}
              />
            ) : (
              <Input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                disabled={saving}
                autoFocus
              />
            )}
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
        ) : (
          <div className="flex items-start justify-between gap-3">
            <p className="whitespace-pre-wrap break-words text-sm text-foreground">
              {value ? answerLabel(question, value) : <span className="text-muted-foreground">—</span>}
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setEditing(true)}
            >
              Modifier
            </Button>
          </div>
        )}
      </dd>
    </div>
  )
}

// The stored value is the choice key. A value matching no choice (answer given
// before choices had keys) stays selectable so that opening the editor never changes it silently.
function ChoiceSelect({
  label,
  choices,
  value,
  onChange,
  disabled,
}: {
  label: string
  choices: NonNullable<Question['choices']>
  value: string
  onChange: (next: string) => void
  disabled: boolean
}) {
  const unknown = value !== '' && !choices.some((c) => c.key === value)
  return (
    <NativeSelect
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      autoFocus
    >
      <option value="">—</option>
      {unknown && <option value={value}>{value}</option>}
      {choices.map((c) => (
        <option key={c.key} value={c.key}>
          {c.label}
        </option>
      ))}
    </NativeSelect>
  )
}

// E05.07: the request's presentation and the documents it presents to its shares, read-only.
function AdminRequest({ detail }: { detail: AdminDossierDetail }) {
  const selected = detail.documentSelection.map((s) => {
    const versions = detail.documents.filter((d) => d.libraryDocumentId === s.documentId)
    const pinned = versions.find((v) => v.id === s.pinnedVersionId)
    return {
      id: s.documentId,
      filename: versions[0]?.filename ?? 'Document',
      how: pinned ? `version ${pinned.version} figée` : 'dernière version',
    }
  })
  return (
    <section aria-labelledby="admin-request-heading" className="mt-6 flex flex-col gap-3">
      <h2 id="admin-request-heading" className="font-heading text-xl font-semibold text-foreground">
        Demande de financement
      </h2>
      {hasPresentation(detail) ? (
        <RequestPresentation dossier={detail} />
      ) : (
        <p className="text-sm text-muted-foreground">Présentation non renseignée.</p>
      )}
      <div className="text-sm">
        <p className="font-medium text-foreground">Documents présentés aux partages</p>
        {selected.length === 0 ? (
          <p className="text-muted-foreground">Aucun.</p>
        ) : (
          <ul className="mt-1 list-disc pl-5 text-muted-foreground">
            {selected.map((d) => (
              <li key={d.id} className="break-words">
                {d.filename} — {d.how}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
