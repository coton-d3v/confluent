import { z } from 'zod'

export const fieldTypeSchema = z.enum([
  'text',
  'textarea',
  'email',
  'number',
  'date',
  'select',
  'checkbox',
  'file',
])

// Technical key of a field, read by the classification (e.g. `stade_financement`). Immutable:
// labels can be renamed freely, keys cannot.
export const fieldKeySchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9_]*$/, 'Key must be snake_case (a-z, 0-9, _).')

export function hasUniqueKeys(fields: ReadonlyArray<{ key?: string | null }>): boolean {
  const keys = fields.flatMap((f) => (f.key ? [f.key] : []))
  return new Set(keys).size === keys.length
}

export const questionnaireVersionSchema = z.object({
  id: z.string().uuid(),
  version: z.number().int().positive(),
  isPublished: z.boolean(),
  createdAt: z.string().datetime(),
})

export const questionnaireFieldSchema = z.object({
  id: z.string().uuid(),
  versionId: z.string().uuid(),
  section: z.string(),
  key: fieldKeySchema.nullable(),
  label: z.string(),
  fieldType: fieldTypeSchema,
  options: z.array(z.string()).default([]),
  required: z.boolean(),
  orderIndex: z.number().int().nonnegative(),
})

export const activeQuestionnaireSchema = z.object({
  version: questionnaireVersionSchema,
  fields: z.array(questionnaireFieldSchema),
})

export const createQuestionnaireVersionFieldSchema = z.object({
  section: z.string().min(1).max(200),
  key: fieldKeySchema.optional(),
  label: z.string().min(1).max(500),
  fieldType: fieldTypeSchema,
  options: z.array(z.string().min(1).max(500)).max(200).optional(),
  required: z.boolean(),
  orderIndex: z.number().int().nonnegative(),
})

export const createQuestionnaireVersionSchema = z.object({
  fields: z
    .array(createQuestionnaireVersionFieldSchema)
    .min(1)
    .max(500)
    .refine(hasUniqueKeys, { message: 'Each field key must be unique within a version.' }),
})

export const patchQuestionnaireFieldSchema = z
  .object({
    label: z.string().min(1).max(500).optional(),
    fieldType: fieldTypeSchema.optional(),
    required: z.boolean().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: 'At least one field must be provided.',
  })

export type FieldType = z.infer<typeof fieldTypeSchema>
export type QuestionnaireVersion = z.infer<typeof questionnaireVersionSchema>
export type QuestionnaireField = z.infer<typeof questionnaireFieldSchema>
export type ActiveQuestionnaire = z.infer<typeof activeQuestionnaireSchema>
export type CreateQuestionnaireVersionFieldInput = z.infer<
  typeof createQuestionnaireVersionFieldSchema
>
export type CreateQuestionnaireVersionInput = z.infer<typeof createQuestionnaireVersionSchema>
export type PatchQuestionnaireFieldInput = z.infer<typeof patchQuestionnaireFieldSchema>
