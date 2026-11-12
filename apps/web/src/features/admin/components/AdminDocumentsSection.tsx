import { useCallback, useEffect, useId, useRef, useState } from 'react'
import {
  DOCUMENT_TYPES,
  DOCUMENT_TYPE_LABELS,
  type DocumentGroup,
  type DocumentType,
} from '@confluent/shared'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { NativeSelect } from '@/components/ui/native-select'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { LoadError } from '@/components/confluent/LoadError'
import { DocumentVersionAction } from '@/features/documents/components/DocumentVersionAction'
import { UploadList } from '@/features/documents/components/UploadList'
import { ACCEPT_ATTRIBUTE, describeVersion, extensionOf } from '@/features/documents/upload-checks'
import { useDocumentUploads } from '@/features/documents/useDocumentUploads'
import { useAsync } from '@/lib/useAsync'
import { listAdminDocuments, uploadAdminDocument } from '../dossiers.api'
import { adminFailure } from '../failure'

// Download links are signed for 15 minutes: the list is read again before they expire.
const RELIST_EVERY_MS = 10 * 60 * 1000

// What the administrator picked, waiting for their confirmation: new documents of a type, or a new
// version of one document (same name, same question).
type Pending =
  | { kind: 'new'; files: File[]; type: DocumentType }
  | { kind: 'replace'; files: File[]; group: DocumentGroup }

// ROADMAP E10.05: the company's library as this request presents it, for an administrator — every
// document and version, downloadable — and the documents they deposit or replace on the owner's
// behalf: the same library, formats and limits as the owner's, each deposit journaled and shown to
// the owner in their request's history. A new document is not presented to the request's shares:
// the owner chooses. Nothing can be changed while the list could not be read.
export function AdminDocumentsSection({
  dossierId,
  fieldLabels,
  onChanged,
}: {
  dossierId: string
  // Label of each attachment question of the request's form, to say which one a file answers.
  fieldLabels: ReadonlyMap<string, string>
  // Called after a deposit: the request's other sections (journal, selection) are read again.
  onChanged: () => void
}) {
  const documents = useAsync(() => listAdminDocuments(dossierId), [dossierId])
  const { refetch } = documents
  useEffect(() => {
    const timer = window.setInterval(refetch, RELIST_EVERY_MS)
    return () => window.clearInterval(timer)
  }, [refetch])
  const uploaded = useCallback(() => {
    refetch()
    onChanged()
  }, [refetch, onChanged])
  const { uploads, send, dismiss, uploading } = useDocumentUploads(
    dossierId,
    uploaded,
    uploadAdminDocument,
  )
  const picker = useRef<HTMLInputElement>(null)
  const typeId = useId()
  const [newType, setNewType] = useState<DocumentType>('other')
  // Document the next picked file replaces, if any.
  const [replacing, setReplacing] = useState<DocumentGroup | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)

  const groups = documents.data ?? []
  // Changes wait for a successful reading of the list (the confirmation tells what exists).
  const blocked = Boolean(documents.error) || documents.data === undefined || uploading

  function pick(group: DocumentGroup | null) {
    setReplacing(group)
    if (picker.current) {
      picker.current.value = ''
      picker.current.accept = group ? `.${extensionOf(group.filename)}` : ACCEPT_ATTRIBUTE
      picker.current.multiple = group === null
      picker.current.click()
    }
  }

  function confirm() {
    if (!pending) return
    if (pending.kind === 'replace') {
      void send(pending.files, {
        filename: pending.group.filename,
        fieldId: pending.group.fieldId,
      })
    } else {
      void send(pending.files, { type: pending.type })
    }
    setPending(null)
  }

  // A new file under the name of a document without question becomes its new version (the
  // library's rule): said before anything is sent.
  const existingOf = (file: File) =>
    groups.find((g) => g.fieldId === null && g.filename === file.name) ?? null

  return (
    <section aria-labelledby="admin-documents-heading" className="mt-10 flex flex-col gap-4">
      <h2
        id="admin-documents-heading"
        className="font-heading text-xl font-semibold text-foreground md:text-2xl"
      >
        Documents de l’entreprise
      </h2>
      <p className="text-sm text-muted-foreground">
        La bibliothèque de l’entreprise, commune à ses demandes. Un document déposé ici est inscrit au
        journal et le porteur le voit dans l’historique de sa demande (« déposé » ou « remplacé par
        l’administration »). Un nouveau document n’est présenté aux partages de cette demande que si le
        porteur le choisit ; « Remplacer » en ajoute une nouvelle version, que voient les partages qui
        suivent la dernière version. PDF, images, documents Word, Excel, PowerPoint ou OpenDocument, CSV
        ou texte ; 20 Mo maximum par fichier.
      </p>

      {documents.error ? (
        <LoadError
          message={adminFailure(documents.error, 'Les documents n’ont pas pu être chargés.')}
          onRetry={refetch}
          retrying={documents.isLoading}
        />
      ) : (
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <label htmlFor={typeId} className="text-sm font-medium text-foreground">
              Type du document déposé
            </label>
            <NativeSelect
              id={typeId}
              className="h-11 w-full sm:w-64"
              value={newType}
              disabled={blocked}
              onChange={(e) => setNewType(e.target.value as DocumentType)}
            >
              {DOCUMENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {DOCUMENT_TYPE_LABELS[t]}
                </option>
              ))}
            </NativeSelect>
          </div>
          <Button type="button" className="h-11 px-4" disabled={blocked} onClick={() => pick(null)}>
            Déposer un document
          </Button>
        </div>
      )}

      <input
        ref={picker}
        type="file"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? [])
          if (files.length === 0) return
          setPending(
            replacing
              ? { kind: 'replace', files: files.slice(0, 1), group: replacing }
              : { kind: 'new', files, type: newType },
          )
        }}
      />

      <UploadList uploads={uploads} onDismiss={dismiss} />

      {documents.error ? null : documents.data === undefined ? (
        <p className="text-sm text-muted-foreground" role="status">
          Chargement des documents…
        </p>
      ) : groups.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
          Aucun document dans la bibliothèque de cette entreprise.
        </p>
      ) : (
        <ul role="list" className="flex flex-col divide-y divide-border rounded-lg border border-border">
          {groups.map((group) => (
            <AdminLibraryItem
              key={group.id}
              group={group}
              answers={group.fieldId ? fieldLabels.get(group.fieldId) : undefined}
              disabled={blocked}
              onRetry={refetch}
              onReplace={() => pick(group)}
            />
          ))}
        </ul>
      )}

      <AlertDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pending?.kind === 'replace'
                ? `Remplacer « ${pending.group.filename} » ?`
                : pending && pending.files.length > 1
                  ? `Déposer ${pending.files.length} documents ?`
                  : 'Déposer ce document ?'}
            </AlertDialogTitle>
            <AlertDialogDescription render={<div />}>
              {pending?.kind === 'replace' ? (
                <p>
                  « {pending.files[0]?.name} » deviendra la version {pending.group.current.version + 1}{' '}
                  de « {pending.group.filename} », en vigueur pour les partages qui suivent sa dernière
                  version. Les versions précédentes restent téléchargeables. Le porteur verra « Document
                  remplacé par l’administration » dans l’historique de cette demande.
                </p>
              ) : pending ? (
                <div className="flex flex-col gap-2">
                  <ul className="list-disc pl-5">
                    {pending.files.map((file, i) => {
                      const existing = existingOf(file)
                      return (
                        <li key={i} className="wrap-anywhere">
                          {existing
                            ? `« ${file.name} » : nouvelle version ${existing.current.version + 1} du document existant`
                            : `« ${file.name} » : nouveau document (${DOCUMENT_TYPE_LABELS[pending.type]})`}
                        </li>
                      )
                    })}
                  </ul>
                  <p>
                    Inscrit au journal ; le porteur le verra dans l’historique de cette demande. Un nouveau
                    document n’est présenté aux partages que si le porteur le choisit.
                  </p>
                </div>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={confirm}>
              {pending?.kind === 'replace' ? 'Remplacer' : 'Déposer'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}

function AdminLibraryItem({
  group,
  answers,
  disabled,
  onRetry,
  onReplace,
}: {
  group: DocumentGroup
  answers: string | undefined
  disabled: boolean
  onRetry: () => void
  onReplace: () => void
}) {
  const previous = group.versions.slice(1)
  const pinned = group.selection?.pinnedVersionId
    ? group.versions.find((v) => v.id === group.selection?.pinnedVersionId)
    : null
  const presented = !group.selection
    ? 'Non présenté dans cette demande'
    : pinned
      ? `Présenté dans cette demande : version ${pinned.version} figée`
      : 'Présenté dans cette demande : dernière version'
  return (
    <li className="flex flex-col gap-3 px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-sm font-medium wrap-anywhere text-foreground">{group.filename}</p>
          <div>
            <Badge variant="secondary">{DOCUMENT_TYPE_LABELS[group.type]}</Badge>
          </div>
          {answers && <p className="text-xs text-muted-foreground">Pièce jointe : {answers}</p>}
          <p className="text-xs text-muted-foreground">{describeVersion(group.current)}</p>
          <p className="text-xs text-muted-foreground">{presented}</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-3">
          <DocumentVersionAction
            version={group.current}
            filename={group.filename}
            onRetry={onRetry}
            onReplace={disabled ? undefined : onReplace}
          />
          {group.current.availability !== 'missing' && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={disabled}
              aria-label={`Remplacer ${group.filename}`}
              onClick={onReplace}
            >
              Remplacer
            </Button>
          )}
        </div>
      </div>
      {previous.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground">
            Historique :{' '}
            {previous.length === 1 ? '1 version précédente' : `${previous.length} versions précédentes`}
          </summary>
          <ul role="list" className="mt-2 flex flex-col gap-3">
            {previous.map((v) => (
              <li key={v.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <span className="min-w-0 text-xs text-muted-foreground">{describeVersion(v)}</span>
                <DocumentVersionAction version={v} filename={group.filename} onRetry={onRetry} />
              </li>
            ))}
          </ul>
        </details>
      )}
    </li>
  )
}
