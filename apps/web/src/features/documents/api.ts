import type { DocumentGroup, UploadedDocument } from '@confluent/shared'
import { apiRequest, apiUpload, type UploadOptions } from '@/lib/api-client'

export function listDocuments(dossierId: string): Promise<DocumentGroup[]> {
  return apiRequest<DocumentGroup[]>(`/v1/dossiers/${encodeURIComponent(dossierId)}/documents`)
}

// `filename` replaces the name of the picked file: uploading under an existing name adds a version
// of that document (used to upload a lost file again).
export function uploadDocument(
  dossierId: string,
  file: File,
  opts: UploadOptions & { filename?: string } = {},
): Promise<UploadedDocument> {
  const formData = new FormData()
  formData.append('file', file, opts.filename ?? file.name)
  return apiUpload<UploadedDocument>(
    `/v1/dossiers/${encodeURIComponent(dossierId)}/documents`,
    formData,
    opts,
  )
}
