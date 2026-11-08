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
const json = (method: string, body?: unknown, revision?: string): RequestInit => ({
  method,
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  // The draft revision this screen shows: the API refuses the change (409) if the draft changed since.
  ...(revision ? { headers: { 'If-Match': `"${revision}"` } } : {}),
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

export const discardDraft = (formId: string, revision?: string) =>
  apiRequest<void>(draft(formId), json('DELETE', undefined, revision))

export const publishDraft = (formId: string, revision?: string) =>
  apiRequest<FormVersionStructure>(`${draft(formId)}/publish`, json('POST', undefined, revision))

export const addSection = (formId: string, input: CreateDraftSectionInput, revision?: string) =>
  apiRequest<FormVersionStructure>(`${draft(formId)}/sections`, json('POST', input, revision))

export const updateSection = (
  formId: string,
  sectionId: string,
  input: UpdateDraftSectionInput,
  revision?: string,
) =>
  apiRequest<FormVersionStructure>(
    `${draft(formId)}/sections/${encodeURIComponent(sectionId)}`,
    json('PATCH', input, revision),
  )

export const removeSection = (formId: string, sectionId: string, revision?: string) =>
  apiRequest<FormVersionStructure>(
    `${draft(formId)}/sections/${encodeURIComponent(sectionId)}`,
    json('DELETE', undefined, revision),
  )

export const reorderSections = (formId: string, ids: string[], revision?: string) =>
  apiRequest<FormVersionStructure>(`${draft(formId)}/sections/order`, json('PUT', { ids }, revision))

export const addField = (formId: string, input: CreateDraftFieldInput, revision?: string) =>
  apiRequest<FormVersionStructure>(`${draft(formId)}/fields`, json('POST', input, revision))

export const updateField = (
  formId: string,
  fieldId: string,
  input: UpdateDraftFieldInput,
  revision?: string,
) =>
  apiRequest<FormVersionStructure>(
    `${draft(formId)}/fields/${encodeURIComponent(fieldId)}`,
    json('PATCH', input, revision),
  )

export const removeField = (formId: string, fieldId: string, revision?: string) =>
  apiRequest<FormVersionStructure>(
    `${draft(formId)}/fields/${encodeURIComponent(fieldId)}`,
    json('DELETE', undefined, revision),
  )

export const reorderFields = (formId: string, sectionId: string, ids: string[], revision?: string) =>
  apiRequest<FormVersionStructure>(
    `${draft(formId)}/sections/${encodeURIComponent(sectionId)}/fields/order`,
    json('PUT', { ids }, revision),
  )
