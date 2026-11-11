import type {
  DocumentGroup,
  DocumentType,
  LibraryDocument,
  UploadedDocument,
} from '@confluent/shared'
import { apiRequest, apiUpload, type UploadOptions } from '@/lib/api-client'

const documentsPath = (dossierId: string) => `/v1/dossiers/${encodeURIComponent(dossierId)}/documents`

export function listDocuments(dossierId: string): Promise<DocumentGroup[]> {
  return apiRequest<DocumentGroup[]>(documentsPath(dossierId))
}

// `filename` replaces the name of the picked file: uploading under an existing name adds a version
// of that document (new version, or a lost file uploaded again). `fieldId` attaches the file to an
// attachment field of the dossier's form (E03.11). `type` is the type of a new document (E05.06);
// a new version keeps its document's type.
export function uploadDocument(
  dossierId: string,
  file: File,
  opts: UploadOptions & { filename?: string; fieldId?: string | null; type?: DocumentType } = {},
): Promise<UploadedDocument> {
  const formData = new FormData()
  if (opts.fieldId) formData.append('fieldId', opts.fieldId)
  if (opts.type) formData.append('type', opts.type)
  formData.append('file', file, opts.filename ?? file.name)
  return apiUpload<UploadedDocument>(documentsPath(dossierId), formData, opts)
}

// E05.06: the owner changes the type of a document of the library.
export function updateDocumentType(
  dossierId: string,
  documentId: string,
  type: DocumentType,
): Promise<LibraryDocument> {
  return apiRequest<LibraryDocument>(`${documentsPath(dossierId)}/${encodeURIComponent(documentId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ type }),
  })
}

// E05.06: brings an earlier version back as the document's newest version; no version is erased.
export function restoreDocumentVersion(
  dossierId: string,
  documentId: string,
  versionId: string,
): Promise<UploadedDocument> {
  return apiRequest<UploadedDocument>(
    `${documentsPath(dossierId)}/${encodeURIComponent(documentId)}/versions/${encodeURIComponent(versionId)}/restore`,
    { method: 'POST' },
  )
}
