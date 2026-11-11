import type {
  AnswerInput,
  Candidature,
  ChangeFinancingStatusInput,
  CandidatureAnswer,
  CandidatureSummary,
  CandidatureWorkspace,
  Portfolio,
  PortfolioQuery,
  ReceivedCandidature,
} from '@confluent/shared'
import { apiRequest } from '@/lib/api-client'

// Candidatures (ROADMAP E05.09): a financing request presented to a workspace, which answers the
// workspace's complementary form. The API decides at each call who reads and writes what.

const id = encodeURIComponent

// The structures a request can be presented to.
export const listCandidatureWorkspaces = () =>
  apiRequest<CandidatureWorkspace[]>('/v1/candidature-workspaces')

export const listDossierCandidatures = (dossierId: string) =>
  apiRequest<CandidatureSummary[]>(`/v1/dossiers/${id(dossierId)}/candidatures`)

export const createCandidature = (dossierId: string, workspaceId: string) =>
  apiRequest<Candidature>(`/v1/dossiers/${id(dossierId)}/candidatures`, {
    method: 'POST',
    body: JSON.stringify({ workspaceId }),
  })

export const getCandidature = (candidatureId: string) =>
  apiRequest<Candidature>(`/v1/candidatures/${id(candidatureId)}`)

export const saveCandidatureAnswers = (candidatureId: string, answers: AnswerInput[]) =>
  apiRequest<CandidatureAnswer[]>(`/v1/candidatures/${id(candidatureId)}/answers`, {
    method: 'PUT',
    body: JSON.stringify({ answers }),
  })

export const submitCandidature = (candidatureId: string) =>
  apiRequest<Candidature>(`/v1/candidatures/${id(candidatureId)}/submit`, { method: 'POST' })

// A draft only: once sent, the structure keeps it and its owner abandons it (E06.01).
export const withdrawCandidature = (candidatureId: string) =>
  apiRequest<void>(`/v1/candidatures/${id(candidatureId)}`, { method: 'DELETE' })

// E06.01: the financing status of a sent candidature, from the status the client saw.
export const changeFinancingStatus = (candidatureId: string, change: ChangeFinancingStatusInput) =>
  apiRequest<Candidature>(`/v1/candidatures/${id(candidatureId)}/financing-status`, {
    method: 'POST',
    body: JSON.stringify(change),
  })

// The workspace's side: its conseillers follow the candidatures it receives in its portfolio
// (E06.07) — counted by phase and current step, filtered by phase, step, financing status and
// scheme (E06.05), a page at a time.
export const getPortfolio = (workspaceId: string, filter: PortfolioQuery = {}) => {
  const query = new URLSearchParams(
    Object.entries(filter).flatMap(([key, value]) =>
      value === undefined || value === '' ? [] : [[key, String(value)]],
    ),
  ).toString()
  return apiRequest<Portfolio>(
    `/v1/workspaces/${id(workspaceId)}/portfolio${query ? `?${query}` : ''}`,
  )
}

export const getReceivedCandidature = (workspaceId: string, candidatureId: string) =>
  apiRequest<ReceivedCandidature>(
    `/v1/workspaces/${id(workspaceId)}/candidatures/${id(candidatureId)}`,
  )

export const changeReceivedFinancingStatus = (
  workspaceId: string,
  candidatureId: string,
  change: ChangeFinancingStatusInput,
) =>
  apiRequest<ReceivedCandidature>(
    `/v1/workspaces/${id(workspaceId)}/candidatures/${id(candidatureId)}/financing-status`,
    { method: 'POST', body: JSON.stringify(change) },
  )
