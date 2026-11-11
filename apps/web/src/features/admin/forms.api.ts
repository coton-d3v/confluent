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

// Form builder (ROADMAP E03.02, E03.03). Every draft edit returns the whole draft. The same
// operations serve Confluent's own forms and, E05.09, each workspace's (`workspaceFormsApi`): the
// API keeps each place to its own forms.

const json = (method: string, body?: unknown, revision?: string): RequestInit => ({
  method,
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  // The draft revision this screen shows: the API refuses the change (409) if the draft changed since.
  ...(revision ? { headers: { 'If-Match': `"${revision}"` } } : {}),
})

export function formsApi(base: string) {
  const form = (formId: string) => `${base}/${encodeURIComponent(formId)}`
  const draft = (formId: string) => `${form(formId)}/draft`

  const listForms = () => apiRequest<FormSummary[]>(base)

  const getForm = (formId: string) => apiRequest<FormDetail>(form(formId))

  const createForm = (name: string) =>
    apiRequest<FormDetail>(base, json('POST', { name }))

  const renameForm = (formId: string, name: string) =>
    apiRequest<FormDetail>(form(formId), json('PATCH', { name }))

  const duplicateForm = (formId: string, name: string) =>
    apiRequest<FormDetail>(`${form(formId)}/duplicate`, json('POST', { name }))

  const assignFormUsage = (formId: string, usage: FormUsage) =>
    apiRequest<FormDetail>(`${form(formId)}/usage`, json('PUT', { usage }))

  const archiveForm = (formId: string) =>
    apiRequest<FormDetail>(`${form(formId)}/archive`, json('POST'))

  const restoreForm = (formId: string) =>
    apiRequest<FormDetail>(`${form(formId)}/restore`, json('POST'))

  const getFormVersion = (formId: string, versionId: string) =>
    apiRequest<FormVersionStructure>(`${form(formId)}/versions/${encodeURIComponent(versionId)}`)

  const getDraft = (formId: string) => apiRequest<FormVersionStructure>(draft(formId))

  const createDraft = (formId: string) =>
    apiRequest<FormVersionStructure>(draft(formId), json('POST'))

  const discardDraft = (formId: string, revision?: string) =>
    apiRequest<void>(draft(formId), json('DELETE', undefined, revision))

  const publishDraft = (formId: string, revision?: string) =>
    apiRequest<FormVersionStructure>(`${draft(formId)}/publish`, json('POST', undefined, revision))

  const addSection = (formId: string, input: CreateDraftSectionInput, revision?: string) =>
    apiRequest<FormVersionStructure>(`${draft(formId)}/sections`, json('POST', input, revision))

  const updateSection = (
    formId: string,
    sectionId: string,
    input: UpdateDraftSectionInput,
    revision?: string,
  ) =>
    apiRequest<FormVersionStructure>(
      `${draft(formId)}/sections/${encodeURIComponent(sectionId)}`,
      json('PATCH', input, revision),
    )

  const removeSection = (formId: string, sectionId: string, revision?: string) =>
    apiRequest<FormVersionStructure>(
      `${draft(formId)}/sections/${encodeURIComponent(sectionId)}`,
      json('DELETE', undefined, revision),
    )

  const reorderSections = (formId: string, ids: string[], revision?: string) =>
    apiRequest<FormVersionStructure>(`${draft(formId)}/sections/order`, json('PUT', { ids }, revision))

  const addField = (formId: string, input: CreateDraftFieldInput, revision?: string) =>
    apiRequest<FormVersionStructure>(`${draft(formId)}/fields`, json('POST', input, revision))

  const updateField = (
    formId: string,
    fieldId: string,
    input: UpdateDraftFieldInput,
    revision?: string,
  ) =>
    apiRequest<FormVersionStructure>(
      `${draft(formId)}/fields/${encodeURIComponent(fieldId)}`,
      json('PATCH', input, revision),
    )

  const removeField = (formId: string, fieldId: string, revision?: string) =>
    apiRequest<FormVersionStructure>(
      `${draft(formId)}/fields/${encodeURIComponent(fieldId)}`,
      json('DELETE', undefined, revision),
    )

  const reorderFields = (formId: string, sectionId: string, ids: string[], revision?: string) =>
    apiRequest<FormVersionStructure>(
      `${draft(formId)}/sections/${encodeURIComponent(sectionId)}/fields/order`,
      json('PUT', { ids }, revision),
    )

  return {
    listForms,
    getForm,
    createForm,
    renameForm,
    duplicateForm,
    assignFormUsage,
    archiveForm,
    restoreForm,
    getFormVersion,
    getDraft,
    createDraft,
    discardDraft,
    publishDraft,
    addSection,
    updateSection,
    removeSection,
    reorderSections,
    addField,
    updateField,
    removeField,
    reorderFields,
  }
}

export type FormsApi = ReturnType<typeof formsApi>

// Confluent's own forms (the company profile…), for its administrators.
export const confluentFormsApi = formsApi('/v1/admin/forms')

// E05.09: a workspace's own forms (its complementary form for candidatures), for its managers.
export const workspaceFormsApi = (workspaceId: string) =>
  formsApi(`/v1/admin/workspaces/${encodeURIComponent(workspaceId)}/forms`)
