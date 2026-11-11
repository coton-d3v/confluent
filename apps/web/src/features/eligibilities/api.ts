import type {
  CandidatureEligibilities,
  CreateEligibilitySchemeInput,
  DeclareEligibilityInput,
  EligibilityScheme,
  UpdateEligibilityInput,
  UpdateEligibilitySchemeInput,
} from '@confluent/shared'
import { apiRequest } from '@/lib/api-client'

// ROADMAP E06.05: a workspace's schemes (JEIR, JEI, CIR…) — read by its conseillers, configured by
// its managers — and a candidature's eligibilities to them, from either side. Information only: no
// tax amount is computed anywhere. The API decides at each call who reads and writes what.

const id = encodeURIComponent
const managed = (workspaceId: string) =>
  `/v1/admin/workspaces/${id(workspaceId)}/eligibility-schemes`

export const listEligibilitySchemes = (workspaceId: string) =>
  apiRequest<EligibilityScheme[]>(`/v1/workspaces/${id(workspaceId)}/eligibility-schemes`)

export const createEligibilityScheme = (workspaceId: string, input: CreateEligibilitySchemeInput) =>
  apiRequest<EligibilityScheme>(managed(workspaceId), {
    method: 'POST',
    body: JSON.stringify(input),
  })

export const updateEligibilityScheme = (
  workspaceId: string,
  schemeId: string,
  input: UpdateEligibilitySchemeInput,
) =>
  apiRequest<EligibilityScheme>(`${managed(workspaceId)}/${id(schemeId)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  })

export const reorderEligibilitySchemes = (workspaceId: string, schemeIds: string[]) =>
  apiRequest<EligibilityScheme[]>(`${managed(workspaceId)}/order`, {
    method: 'PUT',
    body: JSON.stringify({ schemeIds }),
  })

export type EligibilityScope =
  | { side: 'owner'; candidatureId: string }
  | { side: 'workspace'; workspaceId: string; candidatureId: string }

const eligibilitiesPath = (scope: EligibilityScope) =>
  scope.side === 'owner'
    ? `/v1/candidatures/${id(scope.candidatureId)}/eligibilities`
    : `/v1/workspaces/${id(scope.workspaceId)}/candidatures/${id(scope.candidatureId)}/eligibilities`

export const getEligibilities = (scope: EligibilityScope) =>
  apiRequest<CandidatureEligibilities>(eligibilitiesPath(scope))

// `verified`: the workspace's side only (the owner's contract refuses it).
export const declareEligibility = (scope: EligibilityScope, input: DeclareEligibilityInput) =>
  apiRequest<CandidatureEligibilities>(eligibilitiesPath(scope), {
    method: 'POST',
    body: JSON.stringify(input),
  })

// From the version the client saw: an eligibility changed meanwhile is refused (409).
export const updateEligibility = (
  scope: EligibilityScope,
  eligibilityId: string,
  input: UpdateEligibilityInput,
) =>
  apiRequest<CandidatureEligibilities>(`${eligibilitiesPath(scope)}/${id(eligibilityId)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  })

export const removeEligibility = (
  scope: EligibilityScope,
  eligibilityId: string,
  version: number,
) =>
  apiRequest<CandidatureEligibilities>(
    `${eligibilitiesPath(scope)}/${id(eligibilityId)}?version=${version}`,
    { method: 'DELETE' },
  )
