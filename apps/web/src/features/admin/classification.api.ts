import type {
  ClassificationCoverage,
  ClassificationRule,
  CreateClassificationRuleInput,
  ReclassificationPreview,
  UpdateClassificationRuleInput,
} from '@confluent/shared'
import { apiRequest } from '@/lib/api-client'

// Classification rules (ROADMAP E03.12).
const BASE = '/v1/admin/classification'

export const listRules = () => apiRequest<ClassificationRule[]>(`${BASE}/rules`)

export const createRule = (input: CreateClassificationRuleInput) =>
  apiRequest<ClassificationRule>(`${BASE}/rules`, { method: 'POST', body: JSON.stringify(input) })

export const updateRule = (id: string, input: UpdateClassificationRuleInput) =>
  apiRequest<ClassificationRule>(`${BASE}/rules/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  })

export const deleteRule = (id: string) =>
  apiRequest<void>(`${BASE}/rules/${encodeURIComponent(id)}`, { method: 'DELETE' })

export const getCoverage = () => apiRequest<ClassificationCoverage>(`${BASE}/coverage`)

export const previewReclassification = () =>
  apiRequest<ReclassificationPreview>(`${BASE}/reclassification`)

export const applyReclassification = () =>
  apiRequest<ReclassificationPreview>(`${BASE}/reclassification`, { method: 'POST' })
