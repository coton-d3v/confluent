import { useId, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  DOCUMENT_TYPES,
  DOCUMENT_TYPE_LABELS,
  type DocumentGroup,
  type DocumentType,
  type DocumentVersion,
} from '@confluent/shared'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
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
import {
  restoreDocumentVersion,
  selectDocument,
  unselectDocument,
  updateDocumentType,
} from '../api'
import {
  holdsCurrentFile,
  restoreErrorMessage,
  selectionErrorMessage,
  typeChangeErrorMessage,
} from '../library'
import { ACCEPT_ATTRIBUTE, describeVersion, extensionOf } from '../upload-checks'
import { useDocumentUploads } from '../useDocumentUploads'
import { useDossierDocuments } from '../useDossierDocuments'
import { DocumentVersionAction } from './DocumentVersionAction'
import { UploadList } from './UploadList'

// The company's library as the dossier presents it (E05.06): typed documents, their versions and
// history. The owner deposits, adds versions, changes types and brings an earlier version back, and
// chooses which documents this request presents to its shares — following the latest version or
// pinned to one (E05.07); anyone else reads the documents the request selects, as their level allows.
export function DocumentsPanel({
  dossierId,
  canUpload,
  fieldLabels,
  requestName,
}: {
  dossierId: string
  canUpload: boolean
  // Label of each attachment field of the dossier's form, to say which question a file answers.
  fieldLabels?: ReadonlyMap<string, string>
  // Title of the request, to say what a document is selected for.
  requestName?: string
}) {
  const documents = useDossierDocuments(dossierId)
  const { refetch } = documents
  const { uploads, send, dismiss } = useDocumentUploads(dossierId, refetch)
  const picker = useRef<HTMLInputElement>(null)
  const typeId = useId()
  // Document the next picked file is a new version of (same name, same field), if any.
  const [extending, setExtending] = useState<DocumentGroup | null>(null)
  const [newType, setNewType] = useState<DocumentType>('other')
  const [restoring, setRestoring] = useState<{ group: DocumentGroup; version: DocumentVersion } | null>(
    null,
  )
  const [busy, setBusy] = useState(false)

  function pick(group: DocumentGroup | null) {
    setExtending(group)
    if (picker.current) {
      picker.current.value = ''
      // A new version is a file of the same kind, filed under the document's name.
      picker.current.accept = group ? `.${extensionOf(group.filename)}` : ACCEPT_ATTRIBUTE
      picker.current.multiple = group === null
      picker.current.click()
    }
  }

  async function changeType(group: DocumentGroup, type: DocumentType) {
    setBusy(true)
    try {
      await updateDocumentType(dossierId, group.id, type)
      toast.success(`« ${group.filename} » : ${DOCUMENT_TYPE_LABELS[type]}.`)
    } catch (err) {
      toast.error(typeChangeErrorMessage(err))
    } finally {
      setBusy(false)
      refetch()
    }
  }

  async function changeSelection(group: DocumentGroup, choice: string) {
    setBusy(true)
    try {
      if (choice === NOT_SELECTED) {
        await unselectDocument(dossierId, group.id)
        toast.success(`« ${group.filename} » n’est plus présenté dans cette demande.`)
      } else {
        const pinned = choice === LATEST ? null : choice
        await selectDocument(dossierId, group.id, pinned)
        const version = group.versions.find((v) => v.id === pinned)
        toast.success(
          version
            ? `« ${group.filename} » : la version ${version.version} est présentée dans cette demande.`
            : `« ${group.filename} » : sa dernière version est présentée dans cette demande.`,
        )
      }
    } catch (err) {
      toast.error(selectionErrorMessage(err))
    } finally {
      setBusy(false)
      refetch()
    }
  }

  async function confirmRestore() {
    if (!restoring) return
    const { group, version } = restoring
    setBusy(true)
    try {
      const created = await restoreDocumentVersion(dossierId, group.id, version.id)
      toast.success(
        `Version ${version.version} de « ${group.filename} » restaurée : elle est maintenant la version ${created.version}.`,
      )
    } catch (err) {
      toast.error(restoreErrorMessage(err))
    } finally {
      setBusy(false)
      setRestoring(null)
      refetch()
    }
  }

  const groups = documents.data ?? []
  const lost = groups.filter((g) => g.current.availability === 'missing')
  const selectedCount = groups.filter((g) => g.selection).length

  return (
    <section aria-labelledby="documents-heading" className="flex flex-col gap-4">
      <h2 id="documents-heading" className="font-heading text-xl font-semibold text-foreground md:text-2xl">
        Bibliothèque de documents
      </h2>
      {canUpload && (
        <>
          <p className="text-sm text-muted-foreground">
            Les documents de votre entreprise, communs à ses dossiers. Déposer un fichier du même nom, ou
            « Nouvelle version », en ajoute une version : les précédentes restent téléchargeables et
            peuvent être restaurées. PDF, images, documents Word, Excel, PowerPoint ou OpenDocument, CSV
            ou texte ; 20 Mo maximum par fichier.
          </p>
          <p className="text-sm text-muted-foreground">
            Les destinataires des partages de cette demande ne voient que les documents qu’elle présente
            (selon leur niveau d’accès) : la dernière version, qui suit vos mises à jour, ou une version
            figée. Un document déposé ici est présenté dans cette demande ; vos autres demandes le
            présentent si vous le choisissez.{' '}
            {groups.length > 0 && (
              <span className="font-medium text-foreground">
                {selectedCount === 0
                  ? 'Aucun document présenté dans cette demande.'
                  : selectedCount === 1
                    ? '1 document présenté dans cette demande.'
                    : `${selectedCount} documents présentés dans cette demande.`}
              </span>
            )}
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex min-w-0 flex-col gap-1">
              <label htmlFor={typeId} className="text-sm font-medium text-foreground">
                Type des documents déposés
              </label>
              <NativeSelect
                id={typeId}
                className="h-11 w-full sm:w-64"
                value={newType}
                onChange={(e) => setNewType(e.target.value as DocumentType)}
              >
                {DOCUMENT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {DOCUMENT_TYPE_LABELS[t]}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <Button type="button" className="h-11 px-4" onClick={() => pick(null)}>
              Déposer des documents
            </Button>
          </div>
        </>
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
          void send(
            files,
            extending
              ? { filename: extending.filename, fieldId: extending.fieldId }
              : { type: newType },
          )
        }}
      />

      <UploadList uploads={uploads} onDismiss={dismiss} />

      {canUpload && lost.length > 0 && (
        <p role="status" className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-foreground">
          {lost.length === 1
            ? 'Un document n’a pas été conservé : redéposez-le, ou restaurez une version antérieure disponible.'
            : `${lost.length} documents n’ont pas été conservés : redéposez-les, ou restaurez une version antérieure disponible.`}
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
            <LibraryItem
              key={group.id}
              group={group}
              answers={group.fieldId ? fieldLabels?.get(group.fieldId) : undefined}
              canEdit={canUpload}
              busy={busy}
              onRetry={refetch}
              onNewVersion={() => pick(group)}
              onTypeChange={(type) => void changeType(group, type)}
              onRestore={(version) => setRestoring({ group, version })}
              onSelectionChange={(choice) => void changeSelection(group, choice)}
              requestName={requestName}
            />
          ))}
        </ul>
      )}

      <AlertDialog
        open={restoring !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setRestoring(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Restaurer la version {restoring?.version.version} de « {restoring?.group.filename} » ?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Son fichier redevient la version en vigueur, sous le numéro{' '}
              {(restoring?.group.current.version ?? 0) + 1}. Aucune version n’est effacée : toutes
              restent téléchargeables dans l’historique.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Annuler</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={() => void confirmRestore()}>
              Restaurer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}

const NOT_SELECTED = ''
const LATEST = 'latest'

function LibraryItem({
  group,
  answers,
  canEdit,
  busy,
  onRetry,
  onNewVersion,
  onTypeChange,
  onRestore,
  onSelectionChange,
  requestName,
}: {
  group: DocumentGroup
  answers: string | undefined
  canEdit: boolean
  busy: boolean
  onRetry: () => void
  onNewVersion: () => void
  onTypeChange: (type: DocumentType) => void
  onRestore: (version: DocumentVersion) => void
  onSelectionChange: (choice: string) => void
  requestName: string | undefined
}) {
  const typeId = useId()
  const selectionId = useId()
  const selection = group.selection
  const choice = !selection ? NOT_SELECTED : (selection.pinnedVersionId ?? LATEST)
  const previous = group.versions.slice(1)
  return (
    <li className="flex flex-col gap-3 px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <p className="truncate text-sm font-medium text-foreground">{group.filename}</p>
          {canEdit ? (
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor={typeId} className="text-xs text-muted-foreground">
                Type
              </label>
              <NativeSelect
                id={typeId}
                className="h-9 w-auto max-w-full"
                value={group.type}
                disabled={busy}
                onChange={(e) => onTypeChange(e.target.value as DocumentType)}
              >
                {DOCUMENT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {DOCUMENT_TYPE_LABELS[t]}
                  </option>
                ))}
              </NativeSelect>
            </div>
          ) : (
            <Badge variant="secondary">{DOCUMENT_TYPE_LABELS[group.type]}</Badge>
          )}
          {answers && <p className="text-xs text-muted-foreground">Pièce jointe : {answers}</p>}
          <p className="text-xs text-muted-foreground">{describeVersion(group.current)}</p>
          {canEdit && selection !== undefined && (
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor={selectionId} className="text-xs text-muted-foreground">
                {requestName ? `Dans « ${requestName} »` : 'Dans cette demande'}
              </label>
              <NativeSelect
                id={selectionId}
                className="h-9 w-auto max-w-full"
                value={choice}
                disabled={busy}
                onChange={(e) => onSelectionChange(e.target.value)}
              >
                <option value={NOT_SELECTED}>Non présenté</option>
                <option value={LATEST}>Dernière version (suivie)</option>
                {group.versions.map((v) => (
                  <option key={v.id} value={v.id}>
                    Version {v.version} figée
                  </option>
                ))}
              </NativeSelect>
            </div>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-3">
          <DocumentVersionAction
            version={group.current}
            filename={group.filename}
            onRetry={onRetry}
            onReplace={canEdit ? onNewVersion : undefined}
          />
          {canEdit && group.current.availability !== 'missing' && (
            <Button type="button" size="sm" variant="outline" onClick={onNewVersion}>
              Nouvelle version
            </Button>
          )}
        </div>
      </div>
      {previous.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground">
            Historique : {previous.length === 1 ? '1 version précédente' : `${previous.length} versions précédentes`}
          </summary>
          <ul role="list" className="mt-2 flex flex-col gap-3">
            {previous.map((v) => (
              <li key={v.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <span className="min-w-0 text-xs text-muted-foreground">{describeVersion(v)}</span>
                <div className="flex shrink-0 flex-wrap items-center gap-3">
                  <DocumentVersionAction version={v} filename={group.filename} onRetry={onRetry} />
                  {canEdit &&
                    v.availability === 'available' &&
                    (holdsCurrentFile(group, v) ? (
                      <span className="text-xs text-muted-foreground">Identique à la version en vigueur</span>
                    ) : (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        aria-label={`Restaurer la version ${v.version} de ${group.filename}`}
                        onClick={() => onRestore(v)}
                      >
                        Restaurer
                      </Button>
                    ))}
                </div>
              </li>
            ))}
          </ul>
        </details>
      )}
    </li>
  )
}
