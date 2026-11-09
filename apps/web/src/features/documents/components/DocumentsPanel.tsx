import { useRef, useState } from 'react'
import type { DocumentGroup } from '@confluent/shared'
import { Button } from '@/components/ui/button'
import { ACCEPT_ATTRIBUTE, describeVersion, extensionOf } from '../upload-checks'
import { useDocumentUploads } from '../useDocumentUploads'
import { useDossierDocuments } from '../useDossierDocuments'
import { DocumentVersionAction } from './DocumentVersionAction'
import { UploadList } from './UploadList'

export function DocumentsPanel({
  dossierId,
  canUpload,
  fieldLabels,
}: {
  dossierId: string
  canUpload: boolean
  // Label of each attachment field of the dossier's form, to say which question a file answers.
  fieldLabels?: ReadonlyMap<string, string>
}) {
  const documents = useDossierDocuments(dossierId)
  const { refetch } = documents
  const { uploads, send, dismiss } = useDocumentUploads(dossierId, refetch)
  const picker = useRef<HTMLInputElement>(null)
  // Lost document the next picked file replaces (same name, same field), if any.
  const [replacing, setReplacing] = useState<DocumentGroup | null>(null)

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

  const groups = documents.data ?? []
  const lost = groups.filter((g) => g.current.availability === 'missing')

  return (
    <section aria-labelledby="documents-heading" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="documents-heading" className="font-heading text-xl font-semibold text-foreground md:text-2xl">
          Documents
        </h2>
        {canUpload && (
          <Button type="button" onClick={() => pick(null)}>
            Déposer des documents
          </Button>
        )}
      </div>
      {canUpload && (
        <p className="text-sm text-muted-foreground">
          PDF, images, documents Word, Excel, PowerPoint ou OpenDocument, CSV ou texte ; 20 Mo maximum
          par fichier. Déposer un fichier du même nom en crée une nouvelle version.
        </p>
      )}
      <input
        ref={picker}
        type="file"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? [])
          if (files.length > 0) {
            void send(files, { filename: replacing?.filename, fieldId: replacing?.fieldId })
          }
        }}
      />

      <UploadList uploads={uploads} onDismiss={dismiss} />

      {canUpload && lost.length > 0 && (
        <p role="status" className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-foreground">
          {lost.length === 1
            ? 'Un document n’a pas été conservé et doit être redéposé.'
            : `${lost.length} documents n’ont pas été conservés et doivent être redéposés.`}
        </p>
      )}

      {documents.isLoading && groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">Chargement des documents…</p>
      ) : documents.error ? (
        <div role="alert" className="flex items-center gap-3 text-sm text-destructive">
          Impossible de charger les documents.
          <Button type="button" variant="outline" size="sm" onClick={refetch}>
            Réessayer
          </Button>
        </div>
      ) : groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">Aucun document déposé.</p>
      ) : (
        <ul role="list" className="flex flex-col divide-y divide-border rounded-lg border border-border">
          {groups.map((group) => {
            const answers = group.fieldId ? fieldLabels?.get(group.fieldId) : undefined
            return (
              <li key={`${group.fieldId ?? ''}/${group.filename}`} className="flex flex-col gap-2 px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">{group.filename}</p>
                    {answers && (
                      <p className="text-xs text-muted-foreground">Pièce jointe : {answers}</p>
                    )}
                    <p className="text-xs text-muted-foreground">{describeVersion(group.current)}</p>
                  </div>
                  <DocumentVersionAction
                    version={group.current}
                    filename={group.filename}
                    onRetry={refetch}
                    onReplace={canUpload ? () => pick(group) : undefined}
                  />
                </div>
                {group.versions.length > 1 && (
                  <details className="text-sm">
                    <summary className="cursor-pointer text-muted-foreground">
                      Versions précédentes ({group.versions.length - 1})
                    </summary>
                    <ul role="list" className="mt-2 flex flex-col gap-2">
                      {group.versions.slice(1).map((v) => (
                        <li key={v.version} className="flex items-center justify-between gap-3">
                          <span className="text-xs text-muted-foreground">{describeVersion(v)}</span>
                          <DocumentVersionAction version={v} filename={group.filename} onRetry={refetch} />
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
