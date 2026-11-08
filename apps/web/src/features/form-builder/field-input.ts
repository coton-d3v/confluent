import type {
  CreateDraftFieldInput,
  FieldConstraints,
  UpdateDraftFieldInput,
} from '@confluent/shared'
import type { FieldFormValues } from './components/FieldEditorSheet'

// Only a list keeps choices; a choice without key gets one derived by the API.
const choicesOf = (v: FieldFormValues) =>
  v.fieldType === 'select' ? v.choices.map(({ key, label }) => ({ key, label })) : undefined

const integer = (s: string) => (s === '' ? undefined : Number(s))
const decimal = (s: string) => (s === '' ? undefined : Number(s.replace(',', '.')))

// The limits of the field type only; `undefined` entries are dropped by JSON.
function constraintsOf(v: FieldFormValues): FieldConstraints {
  switch (v.fieldType) {
    case 'text':
    case 'textarea':
      return { minLength: integer(v.minLength), maxLength: integer(v.maxLength) }
    case 'number':
      return { min: decimal(v.min), max: decimal(v.max), integer: v.integer || undefined }
    case 'date':
      return { min: v.minDate || undefined, max: v.maxDate || undefined }
    default:
      return {}
  }
}

export function toCreateInput(v: FieldFormValues): CreateDraftFieldInput {
  return {
    sectionId: v.sectionId,
    label: v.label,
    key: v.key || undefined,
    helpText: v.helpText.trim() || null,
    fieldType: v.fieldType,
    required: v.required,
    minAccessLevel: v.minAccessLevel,
    choices: choicesOf(v),
    constraints: constraintsOf(v),
  }
}

// The key of an existing field is never sent: it stays as published (E03.06).
export function toUpdateInput(v: FieldFormValues): UpdateDraftFieldInput {
  return {
    sectionId: v.sectionId,
    label: v.label,
    helpText: v.helpText.trim() || null,
    fieldType: v.fieldType,
    required: v.required,
    minAccessLevel: v.minAccessLevel,
    choices: choicesOf(v),
    constraints: constraintsOf(v),
  }
}
