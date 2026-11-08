import type {
  ActiveQuestionnaire,
  AdminDossierList,
  AnswerInput,
  AuditLog,
  Dossier,
  ShareLink,
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
  questionnaireVersion: ActiveQuestionnaire | null
  answers: Array<{ id: string; dossierId: string; fieldId: string; value: string }>
  shareLinks: ShareLink[]
  documents: Array<{
    id: string
    filename: string
    version: number
    mimetype: string
    size: number
    createdAt: string
  }>
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

export function adminRevokeShare(dossierId: string, linkId: string): Promise<ShareLink> {
  return apiRequest<ShareLink>(
    `/v1/admin/dossiers/${encodeURIComponent(dossierId)}/shares/${encodeURIComponent(linkId)}`,
    { method: 'DELETE' },
  )
}
