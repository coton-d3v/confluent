import { z } from 'zod'
import { isCalendarDate } from '../rules/calendar.js'
import type { FieldType } from './questionnaire.schema.js'

// Input limits of a field (ROADMAP E03.05), stored in `questionnaire_fields.constraints`. Which
// limits apply depends on the field type; every limit is optional.

const isoDate = z
  .string()
  .refine(isCalendarDate, 'Date attendue au format AAAA-MM-JJ (date réelle).')

export const textConstraintsSchema = z
  .object({
    minLength: z.number().int().min(1).max(10_000).optional(),
    maxLength: z.number().int().min(1).max(10_000).optional(),
  })
  .strict()

export const numberConstraintsSchema = z
  .object({
    min: z.number().finite().optional(),
    max: z.number().finite().optional(),
    integer: z.boolean().optional(),
  })
  .strict()

export const dateConstraintsSchema = z
  .object({ min: isoDate.optional(), max: isoDate.optional() })
  .strict()

// Any combination of limits, as sent by the form builder; `constraintsProblem` checks it fits
// the field type.
export const fieldConstraintsSchema = z
  .object({
    minLength: z.number().int().min(1).max(10_000).optional(),
    maxLength: z.number().int().min(1).max(10_000).optional(),
    min: z.union([z.number().finite(), isoDate]).optional(),
    max: z.union([z.number().finite(), isoDate]).optional(),
    integer: z.boolean().optional(),
  })
  .strict()

export type TextConstraints = z.infer<typeof textConstraintsSchema>
export type NumberConstraints = z.infer<typeof numberConstraintsSchema>
export type DateConstraints = z.infer<typeof dateConstraintsSchema>
export type FieldConstraints = z.infer<typeof fieldConstraintsSchema>

const SCHEMA_BY_TYPE: Partial<Record<FieldType, z.ZodType>> = {
  text: textConstraintsSchema,
  textarea: textConstraintsSchema,
  number: numberConstraintsSchema,
  date: dateConstraintsSchema,
}

// Why `constraints` cannot apply to a field of `fieldType`, in French; null when they can.
export function constraintsProblem(
  fieldType: FieldType,
  constraints: FieldConstraints,
): string | null {
  const keys = Object.keys(constraints)
  if (keys.length === 0) return null
  const schema = SCHEMA_BY_TYPE[fieldType]
  if (!schema || !schema.safeParse(constraints).success) {
    return 'Ces limites ne correspondent pas au type du champ.'
  }
  const { minLength, maxLength, min, max } = constraints
  if (minLength !== undefined && maxLength !== undefined && minLength > maxLength) {
    return 'La longueur minimale dépasse la longueur maximale.'
  }
  if (min !== undefined && max !== undefined && min > max) {
    return 'La valeur minimale dépasse la valeur maximale.'
  }
  // No answer could satisfy them (code review R38): e.g. an integer between 0.1 and 0.9.
  if (
    constraints.integer &&
    typeof min === 'number' &&
    typeof max === 'number' &&
    Math.ceil(min) > Math.floor(max)
  ) {
    return 'Aucun nombre entier ne respecte ces limites.'
  }
  return null
}

// Limits stored for a field, read defensively: anything that does not fit the type is ignored.
export function readConstraints(fieldType: FieldType, value: unknown): FieldConstraints {
  const schema = SCHEMA_BY_TYPE[fieldType]
  if (!schema) return {}
  const parsed = schema.safeParse(value)
  return parsed.success ? (parsed.data as FieldConstraints) : {}
}
