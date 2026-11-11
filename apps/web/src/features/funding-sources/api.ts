import type {
  CreateFundingSourceCategoryInput,
  FundingSourceCategory,
  UpdateFundingSourceCategoryInput,
} from '@confluent/shared'
import { apiRequest } from '@/lib/api-client'

// The categories of sources of a workspace's financing plans (ROADMAP E06.02): read by its
// conseillers, configured by its managers. The API checks the rights at each call.

const id = (workspaceId: string) => encodeURIComponent(workspaceId)
const managed = (workspaceId: string) =>
  `/v1/admin/workspaces/${id(workspaceId)}/funding-source-categories`

export const listFundingSourceCategories = (workspaceId: string) =>
  apiRequest<FundingSourceCategory[]>(`/v1/workspaces/${id(workspaceId)}/funding-source-categories`)

export const createFundingSourceCategory = (
  workspaceId: string,
  input: CreateFundingSourceCategoryInput,
) =>
  apiRequest<FundingSourceCategory>(managed(workspaceId), {
    method: 'POST',
    body: JSON.stringify(input),
  })

export const updateFundingSourceCategory = (
  workspaceId: string,
  categoryId: string,
  input: UpdateFundingSourceCategoryInput,
) =>
  apiRequest<FundingSourceCategory>(`${managed(workspaceId)}/${encodeURIComponent(categoryId)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  })

export const reorderFundingSourceCategories = (workspaceId: string, categoryIds: string[]) =>
  apiRequest<FundingSourceCategory[]>(`${managed(workspaceId)}/order`, {
    method: 'PUT',
    body: JSON.stringify({ categoryIds }),
  })
