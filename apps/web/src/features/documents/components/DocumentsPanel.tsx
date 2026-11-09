import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { DocumentGroup, DocumentVersion } from '@confluent/shared'
import { Button } from '@/components/ui/button'
import { useAsync } from '@/lib/useAsync'
import { listDocuments, uploadDocument } from '../api'
import {
  ACCEPT_ATTRIBUTE,
  extensionOf,
  fileProblem,
  formatSize,
  uploadErrorMessage,
} from '../upload-checks'

// Download links are signed for 15 minutes: they are renewed before they expire.
const RELIST_EVERY_MS = 10 * 60 * 1000

interface UploadItem {
  id: number
  name: string
  progress: number
  error: string | null
}

export function DocumentsPanel({ dossierId, canUpload }: { dossierId: string; canUpload: boolean }) {
  const documents = useAsync(() => listDocuments(dossierId), [dossierId])
  const { refetch } = documents
  const [uploads, setUploads] = useState<UploadItem[]>([])
  const nextId = useRef(0)
  const picker = useRef<HTMLInputElement>(null)
  // Name under which the next picked file is uploaded (re-upload of a lost file), if any.
  const [replacing, setReplacing] = useState<DocumentGroup | null>(null)

  useEffect(() => {
    const timer = window.setInterval(refetch, RELIST_EVERY_MS)
    return () => window.clearInterval(timer)
  }, [refetch])

  function update(id: number, patch: Partial<UploadItem>) {
    setUploads((items) => items.map((u) => (u.id === id ? { ...u, ...patch } : u)))
  }

  async function send(files: File[], filename?: string) {
    // One at a time: each file gets its own progress and its own error.
    for (const file of files) {
      const name = filename ?? file.name
      const id = nextId.current++
      const problem = fileProblem(file)
      setUploads((items) => [...items, { id, name, progress: 0, error: problem }])
      if (problem) continue
      try {
        await uploadDocument(dossierId, file, {
          filename,
          onProgress: (fraction) => update(id, { progress: fraction }),
        })
        setUploads((items) => items.filter((u) => u.id !== id))
        toast.success(`« ${name} » enregistré.`)
        refetch()
      } catch (err) {
        update(id, { error: uploadErrorMessage(err, name) })
      }
    }
  }

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
          if (files.length > 0) void send(files, replacing?.filename)
        }}
      />

      {uploads.length > 0 && (
        <ul role="list" className="flex flex-col gap-2">
          {uploads.map((u) => (
            <li key={u.id} className="rounded-lg border border-border px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <p className="truncate text-sm font-medium text-foreground">{u.name}</p>
                {u.error && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setUploads((items) => items.filter((i) => i.id !== u.id))}
                  >
                    Fermer
                  </Button>
                )}
              </div>
              {u.error ? (
                <p role="alert" className="mt-1 text-sm text-destructive">
                  {u.error}
                </p>
              ) : (
                <div className="mt-2 flex items-center gap-3">
                  <progress
                    className="h-2 w-full"
                    max={1}
                    value={u.progress}
                    aria-label={`Envoi de ${u.name}`}
                  />
                  <span className="w-12 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                    {Math.round(u.progress * 100)} %
                  </span>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

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
          {groups.map((group) => (
            <li key={group.filename} className="flex flex-col gap-2 px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{group.filename}</p>
                  <p className="text-xs text-muted-foreground">{describe(group.current)}</p>
                </div>
                <VersionAction
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
                        <span className="text-xs text-muted-foreground">{describe(v)}</span>
                        <VersionAction version={v} filename={group.filename} onRetry={refetch} />
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function describe(v: DocumentVersion): string {
  const date = new Date(v.createdAt).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
  return `Version ${v.version} · ${formatSize(v.size)} · déposée le ${date}`
}

function VersionAction({
  version,
  filename,
  onRetry,
  onReplace,
}: {
  version: DocumentVersion
  filename: string
  onRetry: () => void
  onReplace?: () => void
}) {
  if (version.availability === 'available' && version.url) {
    return (
      <a
        href={version.url}
        className="shrink-0 text-sm font-medium text-foreground underline underline-offset-4"
        aria-label={`Télécharger ${filename}, version ${version.version}`}
      >
        Télécharger
      </a>
    )
  }
  if (version.availability === 'missing') {
    return (
      <div className="flex shrink-0 items-center gap-3">
        <span className="text-xs font-medium text-destructive">Fichier perdu</span>
        {onReplace && (
          <Button type="button" size="sm" variant="outline" onClick={onReplace}>
            Redéposer
          </Button>
        )}
      </div>
    )
  }
  return (
    <div className="flex shrink-0 items-center gap-3">
      <span className="text-xs text-muted-foreground">Momentanément indisponible</span>
      <Button type="button" size="sm" variant="ghost" onClick={onRetry}>
        Réessayer
      </Button>
    </div>
  )
}
