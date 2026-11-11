import type {
  CreateFundingPlanLineInput,
  FundingPlan,
  UpdateFundingPlanLineInput,
} from '@confluent/shared'
import { apiRequest } from '@/lib/api-client'

// The financing plan of a candidature (ROADMAP E06.03), from either side: its owner, or the
// conseillers of the workspace it was sent to. The API decides at each call who reads and writes.
export type FundingPlanScope =
  | { side: 'owner'; candidatureId: string }
  | { side: 'workspace'; workspaceId: string; candidatureId: string }

const id = encodeURIComponent

const planPath = (scope: FundingPlanScope) =>
  scope.side === 'owner'
    ? `/v1/candidatures/${id(scope.candidatureId)}/funding-plan`
    : `/v1/workspaces/${id(scope.workspaceId)}/candidatures/${id(scope.candidatureId)}/funding-plan`

export const getFundingPlan = (scope: FundingPlanScope) => apiRequest<FundingPlan>(planPath(scope))

export const addFundingPlanLine = (scope: FundingPlanScope, input: CreateFundingPlanLineInput) =>
  apiRequest<FundingPlan>(`${planPath(scope)}/lines`, {
    method: 'POST',
    body: JSON.stringify(input),
  })

// From the version of the line the client saw: a line changed meanwhile is refused (409).
export const updateFundingPlanLine = (
  scope: FundingPlanScope,
  lineId: string,
  input: UpdateFundingPlanLineInput,
) =>
  apiRequest<FundingPlan>(`${planPath(scope)}/lines/${id(lineId)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  })

export const deleteFundingPlanLine = (scope: FundingPlanScope, lineId: string, version: number) =>
  apiRequest<FundingPlan>(`${planPath(scope)}/lines/${id(lineId)}?version=${version}`, {
    method: 'DELETE',
  })
