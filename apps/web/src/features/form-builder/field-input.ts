import type { CreateDraftFieldInput, UpdateDraftFieldInput } from '@confluent/shared'
import type { FieldFormValues } from './components/FieldEditorSheet'

// Only a list keeps choices; a choice without key gets one derived by the API.
const choicesOf = (v: FieldFormValues) =>
  v.fieldType === 'select' ? v.choices.map(({ key, label }) => ({ key, label })) : undefined

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
  }
}
