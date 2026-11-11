import type {
  ActiveQuestionnaire,
  AdminDossierList,
  AnswerInput,
  AuditLog,
  CompanySummary,
  AccessLevel,
  Dossier,
  DossierDocumentSelected,
  ShareAccess,
  ShareLink,
  SharePreview,
} from '@confluent/shared'
import { apiRequest } from '@/lib/api-client'

export function listAdminDossiers(page = 1, pageSize = 20): Promise<AdminDossierList> {
  const search = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
  })
  return apiRequest<AdminDossierList>(`/v1/admin/dossiers?${search.toString()}`)
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
