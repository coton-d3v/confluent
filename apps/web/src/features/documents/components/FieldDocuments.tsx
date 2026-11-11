import { useEffect, useRef, useState } from 'react'
import { ACCEPTED_DOCUMENT_FORMATS_LABEL, type DocumentGroup } from '@confluent/shared'
import { Button } from '@/components/ui/button'
import type { QueryState } from '@/lib/useAsync'
import { ACCEPT_ATTRIBUTE, describeVersion, extensionOf } from '../upload-checks'
import { useDocumentUploads } from '../useDocumentUploads'
import { DocumentVersionAction } from './DocumentVersionAction'
import { UploadList } from './UploadList'

// Attachment step of the filling journey (E03.11): the files that answer this field, and the upload
// with its progress and errors, without leaving the questionnaire.
export function FieldDocuments({
  dossierId,
  fieldId,
  documents,
  labelledBy,
  describedBy,
  onUploadingChange,
}: {
  dossierId: string
  fieldId: string
  // The dossier's documents, shared with the page (section summary, attachment count).
  documents: QueryState<DocumentGroup[]>
  labelledBy: string
  describedBy?: string
  // A file is still being sent: leaving the step now would hide its outcome.
  onUploadingChange: (uploading: boolean) => void
}) {
  const { refetch } = documents
  const { uploads, send, dismiss, uploading } = useDocumentUploads(dossierId, refetch)
  const picker = useRef<HTMLInputElement>(null)
  const [replacing, setReplacing] = useState<DocumentGroup | null>(null)
  const groups = (documents.data ?? []).filter((g) => g.fieldId === fieldId)

  useEffect(() => onUploadingChange(uploading), [uploading, onUploadingChange])
  useEffect(() => () => onUploadingChange(false), [onUploadingChange])

  function pick(group: DocumentGroup | null) {
    setReplacing(group)
    if (picker.current) {
      picker.current.value = ''
      // A lost file is replaced by a file of the same kind, under its original name.
      picker.current.accept = group ? `.${extensionOf(group.filename)}` : ACCEPT_ATTRIBUTE
      picker.current.multiple = group === null
      picker.current.click()
    }
  }

  return (
    <div role="group" aria-labelledby={labelledBy} aria-describedby={describedBy} className="flex flex-col gap-3">
      <input
        ref={picker}
        type="file"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? [])
          if (files.length > 0) void send(files, { filename: replacing?.filename, fieldId })
        }}
      />

      {documents.isLoading && !documents.data ? (
        <p className="text-sm text-muted-foreground">Chargement des fichiers…</p>
      ) : documents.error ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-destructive">
          Impossible de charger les fichiers déjà déposés.
          <Button type="button" variant="outline" size="sm" onClick={refetch}>
            Réessayer
          </Button>
        </div>
      ) : (
        groups.length > 0 && (
          <ul role="list" className="flex flex-col divide-y divide-border rounded-lg border border-border">
            {groups.map((group) => (
              <li key={group.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{group.filename}</p>
                  <p className="text-xs text-muted-foreground">{describeVersion(group.current)}</p>
                </div>
                <DocumentVersionAction
                  version={group.current}
                  filename={group.filename}
                  onRetry={refetch}
                  onReplace={() => pick(group)}
                />
              </li>
            ))}
          </ul>
        )
      )}

      <UploadList uploads={uploads} onDismiss={dismiss} />

      <div className="flex flex-col gap-1">
        <Button type="button" variant="outline" className="h-11 self-start px-4" onClick={() => pick(null)}>
          {groups.length > 0 ? 'Ajouter un fichier' : 'Déposer un fichier'}
        </Button>
        <p className="text-xs text-muted-foreground">
          {ACCEPTED_DOCUMENT_FORMATS_LABEL} ; 20 Mo maximum par fichier.
        </p>
      </div>
    </div>
  )
}
