import type {
  CreateDraftFieldInput,
  CreateDraftSectionInput,
  FormDetail,
  FormSummary,
  FormUsage,
  FormVersionStructure,
  UpdateDraftFieldInput,
  UpdateDraftSectionInput,
} from '@confluent/shared'
import { apiRequest } from '@/lib/api-client'

// Form builder (ROADMAP E03.02, E03.03). Every draft edit returns the whole draft.

const BASE = '/v1/admin/forms'
const form = (formId: string) => `${BASE}/${encodeURIComponent(formId)}`
const draft = (formId: string) => `${form(formId)}/draft`
const json = (method: string, body?: unknown): RequestInit => ({
  method,
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
})

export const listForms = () => apiRequest<FormSummary[]>(BASE)

export const getForm = (formId: string) => apiRequest<FormDetail>(form(formId))

export const createForm = (name: string) =>
  apiRequest<FormDetail>(BASE, json('POST', { name }))

export const renameForm = (formId: string, name: string) =>
  apiRequest<FormDetail>(form(formId), json('PATCH', { name }))

export const duplicateForm = (formId: string, name: string) =>
  apiRequest<FormDetail>(`${form(formId)}/duplicate`, json('POST', { name }))

export const assignFormUsage = (formId: string, usage: FormUsage) =>
  apiRequest<FormDetail>(`${form(formId)}/usage`, json('PUT', { usage }))

export const archiveForm = (formId: string) =>
  apiRequest<FormDetail>(`${form(formId)}/archive`, json('POST'))

export const restoreForm = (formId: string) =>
  apiRequest<FormDetail>(`${form(formId)}/restore`, json('POST'))

export const getFormVersion = (formId: string, versionId: string) =>
  apiRequest<FormVersionStructure>(`${form(formId)}/versions/${encodeURIComponent(versionId)}`)

export const getDraft = (formId: string) => apiRequest<FormVersionStructure>(draft(formId))

export const createDraft = (formId: string) =>
  apiRequest<FormVersionStructure>(draft(formId), json('POST'))

export const discardDraft = (formId: string) => apiRequest<void>(draft(formId), json('DELETE'))

export const publishDraft = (formId: string) =>
  apiRequest<FormVersionStructure>(`${draft(formId)}/publish`, json('POST'))

export const addSection = (formId: string, input: CreateDraftSectionInput) =>
  apiRequest<FormVersionStructure>(`${draft(formId)}/sections`, json('POST', input))

export const updateSection = (formId: string, sectionId: string, input: UpdateDraftSectionInput) =>
  apiRequest<FormVersionStructure>(
    `${draft(formId)}/sections/${encodeURIComponent(sectionId)}`,
    json('PATCH', input),
  )

export const removeSection = (formId: string, sectionId: string) =>
  apiRequest<FormVersionStructure>(
    `${draft(formId)}/sections/${encodeURIComponent(sectionId)}`,
    json('DELETE'),
  )

export const reorderSections = (formId: string, ids: string[]) =>
  apiRequest<FormVersionStructure>(`${draft(formId)}/sections/order`, json('PUT', { ids }))

export const addField = (formId: string, input: CreateDraftFieldInput) =>
  apiRequest<FormVersionStructure>(`${draft(formId)}/fields`, json('POST', input))

export const updateField = (formId: string, fieldId: string, input: UpdateDraftFieldInput) =>
  apiRequest<FormVersionStructure>(
    `${draft(formId)}/fields/${encodeURIComponent(fieldId)}`,
    json('PATCH', input),
  )

export const removeField = (formId: string, fieldId: string) =>
  apiRequest<FormVersionStructure>(
    `${draft(formId)}/fields/${encodeURIComponent(fieldId)}`,
    json('DELETE'),
  )

export const reorderFields = (formId: string, sectionId: string, ids: string[]) =>
  apiRequest<FormVersionStructure>(
    `${draft(formId)}/sections/${encodeURIComponent(sectionId)}/fields/order`,
    json('PUT', { ids }),
  )
