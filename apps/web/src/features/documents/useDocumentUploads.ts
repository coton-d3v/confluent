import { useCallback, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { DocumentType } from '@confluent/shared'
import { uploadDocument } from './api'
import { fileProblem, uploadErrorMessage } from './upload-checks'

export interface UploadItem {
  id: number
  name: string
  progress: number
  error: string | null
}

export interface SendOptions {
  // Name under which the file is uploaded (re-upload of a lost file), if not its own.
  filename?: string
  // Attachment field the files answer (E03.11).
  fieldId?: string | null
  // Type of the documents the files create (E05.06).
  type?: DocumentType
}

// Uploads of the Documents tab and of the attachment step: one file at a time, each with its own
// progress and its own error, checked here first and then by the API.
export function useDocumentUploads(dossierId: string, onUploaded: () => void) {
  const [uploads, setUploads] = useState<UploadItem[]>([])
  const nextId = useRef(0)

  const update = (id: number, patch: Partial<UploadItem>) =>
    setUploads((items) => items.map((u) => (u.id === id ? { ...u, ...patch } : u)))

  const send = useCallback(
    async (files: File[], opts: SendOptions = {}) => {
      for (const file of files) {
        const name = opts.filename ?? file.name
        const id = nextId.current++
        const problem = fileProblem(file)
        setUploads((items) => [...items, { id, name, progress: 0, error: problem }])
        if (problem) continue
        try {
          await uploadDocument(dossierId, file, {
            filename: opts.filename,
            fieldId: opts.fieldId,
            type: opts.type,
            onProgress: (fraction) => update(id, { progress: fraction }),
          })
          setUploads((items) => items.filter((u) => u.id !== id))
          toast.success(`« ${name} » enregistré.`)
          onUploaded()
        } catch (err) {
          update(id, { error: uploadErrorMessage(err, name) })
        }
      }
    },
    [dossierId, onUploaded],
  )

  const dismiss = useCallback(
    (id: number) => setUploads((items) => items.filter((u) => u.id !== id)),
    [],
  )

  return { uploads, send, dismiss, uploading: uploads.some((u) => u.error === null) }
}
