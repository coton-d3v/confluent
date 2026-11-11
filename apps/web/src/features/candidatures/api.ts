import type {
  AnswerInput,
  Candidature,
  CandidatureAnswer,
  CandidatureSummary,
  CandidatureWorkspace,
  ReceivedCandidature,
  ReceivedCandidatureSummary,
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

export const withdrawCandidature = (candidatureId: string) =>
  apiRequest<void>(`/v1/candidatures/${id(candidatureId)}`, { method: 'DELETE' })

// The workspace's side: its conseillers read the candidatures it receives.
export const listReceivedCandidatures = (workspaceId: string) =>
  apiRequest<ReceivedCandidatureSummary[]>(`/v1/workspaces/${id(workspaceId)}/candidatures`)

export const getReceivedCandidature = (workspaceId: string, candidatureId: string) =>
  apiRequest<ReceivedCandidature>(
    `/v1/workspaces/${id(workspaceId)}/candidatures/${id(candidatureId)}`,
  )
