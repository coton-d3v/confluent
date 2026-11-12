import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Info } from 'lucide-react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { useCurrentUser } from '@/features/current-user/context'
import {
  ACCESS_LEVELS,
  ACCESS_LEVEL_LABELS,
  DOSSIER_PUBLICATION_STATUS_LABELS,
  publicationStatusOf,
} from '@confluent/shared'
import {
  adminListShares,
  adminRevokeShare,
  getAdminDossier,
  getAdminDossierAuditLog,
  lookupAdminDossier,
  patchAdminAnswers,
} from '@/features/admin/dossiers.api'
import { AdminDocumentsSection } from '@/features/admin/components/AdminDocumentsSection'
import { adminFailure } from '@/features/admin/failure'
import { LoadError } from '@/components/confluent/LoadError'
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
import { AccessListRow } from '@/components/confluent/AccessListRow'
import { RevokeAccessDialog } from '@/components/confluent/RevokeAccessDialog'
import { buildAccessEntries } from '@/features/shares/build-access-entries'
import type { AccessEntry } from '@/features/shares/access-entry'
import { previewHref } from '@/features/shares/preview'

export default function AdminDossierDetailRoute() {
  const user = useCurrentUser()
  if (user.role !== 'admin') return <Navigate to="/dashboard" replace />
  return <AdminDossierByRef />
}

// E10.05: the request whose slug or identifier the address names, read by the server whatever the
// number of requests; an address by identifier (or by a slug's other case) is shown under its slug.
function AdminDossierByRef() {
  const { slug: ref = '' } = useParams<{ slug: string }>()
  const found = useAsync(() => lookupAdminDossier(ref), [ref])

  if (found.isLoading) {
    return (
      <p className="pt-8 text-sm text-muted-foreground" role="status">
        Chargement…
      </p>
    )
  }
  if (found.error) {
    if ((found.error as Partial<ApiError>).status === 404) return <NotFound reference={ref} />
    return (
      <LoadError
        className="mt-8"
        message={adminFailure(found.error, 'Le dossier n’a pas pu être chargé.')}
        onRetry={found.refetch}
      />
    )
  }
  const item = found.data
  if (!item) return <NotFound reference={ref} />
  if (item.slug !== ref) {
    return <Navigate to={`/admin/dossiers/${encodeURIComponent(item.slug)}`} replace />
  }
  return <AdminDossierDetailView dossierId={item.id} dossierName={item.name} slug={item.slug} />
}

function NotFound({ reference }: { reference: string }) {
  return (
    <section className="mx-auto max-w-md pt-16 text-center">
      <title>Dossier introuvable · Confluent</title>
      <p className="text-sm break-words text-foreground">
        Aucun dossier n’a le slug ni l’identifiant « {reference} ».
      </p>
      <p className="mt-2 text-sm text-muted-foreground">
        Le titre d’une demande change son slug : cherchez-la par son titre, son entreprise ou l’email
        de son porteur.
      </p>
      <div className="mt-4 flex flex-wrap justify-center gap-4 text-sm">
        <Link
          to={`/admin/dossiers?${new URLSearchParams({ q: reference }).toString()}`}
          className="break-all underline hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
        >
          Rechercher « {reference} »
        </Link>
        <Link
          to="/admin/dossiers"
          className="underline hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
        >
          Retour à la liste
        </Link>
      </div>
    </section>
  )
}

function AdminDossierDetailView({
  dossierId,
  dossierName,
  slug,
}: {
  dossierId: string
  dossierName: string
  slug: string
}) {
  const headingRef = useRef<HTMLHeadingElement>(null)
  const detailQuery = useAsync(() => getAdminDossier(dossierId), [dossierId])
  const auditQuery = useAsync(() => getAdminDossierAuditLog(dossierId), [dossierId])
  // E07.01: the list of accesses with who revoked each one, as its owner reads it.
  const sharesQuery = useAsync(() => adminListShares(dossierId), [dossierId])
  const accessEntries = useMemo(
    () => buildAccessEntries(sharesQuery.data ?? [], undefined, 'admin'),
    [sharesQuery.data],
  )
  const [entryToRevoke, setEntryToRevoke] = useState<AccessEntry | null>(null)
  const revokingRef = useRef(false)
  const basePath = `/admin/dossiers/${encodeURIComponent(slug)}`

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

  const { refetch: refetchDetail } = detailQuery
  const { refetch: refetchAudit } = auditQuery
  // After a change, the sections it affects are read again (R70): the request, its journal.
  const refreshRequest = useCallback(() => {
    refetchDetail()
    refetchAudit()
  }, [refetchDetail, refetchAudit])

  const handleSaveAnswer = useCallback(
    async (fieldId: string, value: string) => {
      await patchAdminAnswers(dossierId, [{ fieldId, value }])
      toast.success('Réponse mise à jour')
      refreshRequest()
    },
    [dossierId, refreshRequest],
  )

  // Questions of the request's own form, to say which one a document answers.
  const fieldLabels = useMemo(
    () => new Map((dynamic?.flat ?? []).map((q) => [q.id, q.label])),
    [dynamic],
  )

  async function handleConfirmRevoke(entry: AccessEntry) {
    if (revokingRef.current) return
    revokingRef.current = true
    try {
      await adminRevokeShare(dossierId, entry.id)
      toast.success('Accès révoqué')
    } catch (err) {
      toast.error(adminFailure(err, 'L’accès n’a pas été révoqué.'))
    }
    setEntryToRevoke(null)
    sharesQuery.refetch()
    refreshRequest()
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
          Demande : {DOSSIER_PUBLICATION_STATUS_LABELS[publicationStatusOf(detailQuery.data.publicationStatus)].toLowerCase()}
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

      {detailQuery.error ? (
        <LoadError
          className="mt-8"
          message={adminFailure(detailQuery.error, 'Le dossier n’a pas pu être chargé.')}
          onRetry={refetchDetail}
          retrying={detailQuery.isLoading}
        />
      ) : !detailQuery.data ? (
        <p className="mt-8 text-sm text-muted-foreground" role="status">
          Chargement…
        </p>
      ) : !dynamic ? (
        <p className="mt-8 text-sm text-muted-foreground">
          Ce dossier n’a pas de formulaire de profil : aucune réponse à afficher.
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

          <section className="mt-10" aria-labelledby="shares-heading">
            <h2
              id="shares-heading"
              className="font-heading text-xl font-semibold text-foreground md:text-2xl"
            >
              Accès par lien nominatif
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Vous pouvez révoquer un accès ; le porteur de projet le verra « révoqué par
              l’administration ». Le niveau d’un accès reste la décision du porteur.
            </p>
            <div className="mt-4 overflow-hidden rounded-lg border border-border bg-card">
              {sharesQuery.error ? (
                <LoadError
                  className="m-3"
                  message={adminFailure(sharesQuery.error, 'Les accès n’ont pas pu être chargés.')}
                  onRetry={sharesQuery.refetch}
                  retrying={sharesQuery.isLoading}
                />
              ) : !sharesQuery.data ? (
                <p className="px-4 py-6 text-center text-sm text-muted-foreground">Chargement…</p>
              ) : accessEntries.length === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                  Aucun partage pour ce dossier.
                </p>
              ) : (
                <ul role="list" className="m-0 list-none p-0">
                  {accessEntries.map((entry) => (
                    <AccessListRow
                      key={entry.id}
                      entry={entry}
                      onRevokeClick={(e) => {
                        revokingRef.current = false
                        setEntryToRevoke(e)
                      }}
                      previewHref={previewHref(basePath, entry.accessLevel)}
                    />
                  ))}
                </ul>
              )}
            </div>
            <h3 className="mt-6 text-sm font-medium text-foreground">Voir comme le destinataire</h3>
            <ul role="list" className="mt-2 flex flex-wrap gap-2">
              {ACCESS_LEVELS.map((level) => (
                <li key={level}>
                  <Link
                    to={previewHref(basePath, level)}
                    className="inline-flex min-h-11 items-center rounded-lg border border-border bg-card px-4 text-sm font-medium text-foreground hover:border-foreground/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
                  >
                    Accès {ACCESS_LEVEL_LABELS[level].toLowerCase()}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}

      {/* Its own reading: the library can be read, and documents deposited, even if the request's
          other sections could not be. */}
      <AdminDocumentsSection
        dossierId={dossierId}
        fieldLabels={fieldLabels}
        onChanged={refreshRequest}
      />

      <RevokeAccessDialog
        open={entryToRevoke !== null}
        entry={entryToRevoke}
        onOpenChange={(open) => {
          if (!open) setEntryToRevoke(null)
        }}
        onConfirm={handleConfirmRevoke}
      />

      <section className="mt-10">
        <h2 className="font-heading text-xl font-semibold text-foreground md:text-2xl">
          Journal d&apos;audit
        </h2>
        <div className="mt-4 overflow-hidden rounded-lg border border-border bg-card">
          {auditQuery.error ? (
            <LoadError
              className="m-3"
              message={adminFailure(auditQuery.error, 'Le journal n’a pas pu être chargé.')}
              onRetry={refetchAudit}
              retrying={auditQuery.isLoading}
            />
          ) : !auditQuery.data ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">Chargement…</p>
          ) : auditQuery.data.length === 0 ? (
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
            {/* `min-w-0` and `wrap-anywhere`: an answer made of one long word wraps (375 px). */}
            <p className="min-w-0 whitespace-pre-wrap wrap-anywhere text-sm text-foreground">
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
