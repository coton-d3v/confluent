import type {
  ActiveQuestionnaire,
  AdminDossierList,
  AdminDossierListItem,
  AnswerInput,
  AuditLog,
  CompanySummary,
  AccessLevel,
  Dossier,
  DocumentGroup,
  DocumentType,
  DossierDocumentSelected,
  ShareAccess,
  ShareLink,
  SharePreview,
  UploadedDocument,
} from '@confluent/shared'
import { apiRequest, apiUpload, type UploadOptions } from '@/lib/api-client'

// E10.05: every request of the platform, or those `q` finds (searched by the server: title, company,
// owner's email, slug or identifier), a page at a time.
export function listAdminDossiers(
  params: { page?: number; pageSize?: number; q?: string } = {},
): Promise<AdminDossierList> {
  const search = new URLSearchParams({
    page: String(params.page ?? 1),
    pageSize: String(params.pageSize ?? 20),
  })
  if (params.q) search.set('q', params.q)
  return apiRequest<AdminDossierList>(`/v1/admin/dossiers?${search.toString()}`)
}

// E10.05 « aller à » : the request whose slug or identifier is exactly `ref` (404 otherwise).
export function lookupAdminDossier(ref: string): Promise<AdminDossierListItem> {
  return apiRequest<AdminDossierListItem>(
    `/v1/admin/dossiers/lookup?${new URLSearchParams({ ref }).toString()}`,
  )
}

// E10.05: the company's library as the request presents it, read by an administrator.
export function listAdminDocuments(dossierId: string): Promise<DocumentGroup[]> {
  return apiRequest<DocumentGroup[]>(`/v1/admin/dossiers/${encodeURIComponent(dossierId)}/documents`)
}

// E10.05: a document deposited by an administrator — a new document, or a new version of the
// document of that name and question (`filename`, `fieldId`), journaled and shown to the owner.
export function uploadAdminDocument(
  dossierId: string,
  file: File,
  opts: UploadOptions & { filename?: string; fieldId?: string | null; type?: DocumentType } = {},
): Promise<UploadedDocument> {
  const formData = new FormData()
  if (opts.fieldId) formData.append('fieldId', opts.fieldId)
  if (opts.type) formData.append('type', opts.type)
  formData.append('file', file, opts.filename ?? file.name)
  return apiUpload<UploadedDocument>(
    `/v1/admin/dossiers/${encodeURIComponent(dossierId)}/documents`,
    formData,
    opts,
  )
}

export interface AdminDossierDetail extends Dossier {
  ownerEmail: string
  // The company the dossier finances (E05.04).
  company: CompanySummary
  questionnaireVersion: ActiveQuestionnaire | null
  answers: Array<{ id: string; dossierId: string; fieldId: string; value: string }>
  shareLinks: ShareLink[]
  documents: Array<{
    id: string
    // The library document this version belongs to (E05.06).
    libraryDocumentId: string
    filename: string
    version: number
    mimetype: string
    size: number
    createdAt: string
  }>
  // E05.07: the documents of the library this request presents to its shares.
  documentSelection: DossierDocumentSelected[]
}

export function getAdminDossier(id: string): Promise<AdminDossierDetail> {
  return apiRequest<AdminDossierDetail>(
    `/v1/admin/dossiers/${encodeURIComponent(id)}`,
  )
}

export function patchAdminAnswers(
  id: string,
  answers: AnswerInput[],
): Promise<{ status: 'ok' }> {
  return apiRequest<{ status: 'ok' }>(
    `/v1/admin/dossiers/${encodeURIComponent(id)}/answers`,
    { method: 'PATCH', body: JSON.stringify({ answers }) },
  )
}

export function getAdminDossierAuditLog(id: string): Promise<AuditLog[]> {
  return apiRequest<AuditLog[]>(
    `/v1/admin/dossiers/${encodeURIComponent(id)}/audit-log`,
  )
}

// E07.01: the same list of accesses and preview as the owner's, on any request.
export function adminListShares(dossierId: string): Promise<ShareAccess[]> {
  return apiRequest<ShareAccess[]>(`/v1/admin/dossiers/${encodeURIComponent(dossierId)}/shares`)
}

export function adminSharePreview(dossierId: string, level: AccessLevel): Promise<SharePreview> {
  return apiRequest<SharePreview>(
    `/v1/admin/dossiers/${encodeURIComponent(dossierId)}/share-preview?level=${encodeURIComponent(level)}`,
  )
}

export function adminRevokeShare(dossierId: string, linkId: string): Promise<ShareAccess> {
  return apiRequest<ShareAccess>(
    `/v1/admin/dossiers/${encodeURIComponent(dossierId)}/shares/${encodeURIComponent(linkId)}`,
    { method: 'DELETE' },
  )
}
