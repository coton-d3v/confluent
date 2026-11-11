import type {
  CompanyInvitationSent,
  CompanyTransferDecision,
  CompanyTransferOffer,
  PrepareCompanyInput,
  PreparedCompany,
  PreparedCompanyCreated,
} from '@confluent/shared'
import { apiRequest } from '@/lib/api-client'

// ROADMAP E05.08: companies a workspace's conseillers prepare for entrepreneurs, and the
// entrepreneur's answer. The API decides at each call who may do what.

const preparedPath = (workspaceId: string) =>
  `/v1/workspaces/${encodeURIComponent(workspaceId)}/prepared-companies`

export const listPreparedCompanies = (workspaceId: string) =>
  apiRequest<PreparedCompany[]>(preparedPath(workspaceId))

export const prepareCompany = (workspaceId: string, input: PrepareCompanyInput) =>
  apiRequest<PreparedCompanyCreated>(preparedPath(workspaceId), {
    method: 'POST',
    body: JSON.stringify(input),
  })

// A new invitation, replacing the one waiting for an answer.
export const inviteCompanyOwner = (workspaceId: string, companyId: string, email: string) =>
  apiRequest<CompanyInvitationSent>(
    `${preparedPath(workspaceId)}/${encodeURIComponent(companyId)}/invitation`,
    { method: 'POST', body: JSON.stringify({ email }) },
  )

export const withdrawCompanyInvitation = (workspaceId: string, companyId: string) =>
  apiRequest<PreparedCompany>(
    `${preparedPath(workspaceId)}/${encodeURIComponent(companyId)}/invitation`,
    { method: 'DELETE' },
  )

// The companies offered to the signed-in person, waiting for their answer.
export const listCompanyOffers = () => apiRequest<CompanyTransferOffer[]>('/v1/company-transfers')

export const answerCompanyOffer = (id: string, answer: 'accept' | 'decline') =>
  apiRequest<CompanyTransferDecision>(`/v1/company-transfers/${encodeURIComponent(id)}/${answer}`, {
    method: 'POST',
  })
