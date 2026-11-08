import { z } from 'zod'
import { accessLevelSchema } from './access-level.schema.js'

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

// draft: editable, unused · published: the one version used for new dossiers, immutable ·
// archived: kept for the dossiers created with it (ROADMAP E03.02, E03.08).
export const questionnaireVersionStatusSchema = z.enum(['draft', 'published', 'archived'])

export const questionnaireVersionSchema = z.object({
  id: z.string().uuid(),
  questionnaireId: z.string().uuid(),
  version: z.number().int().positive(),
  status: questionnaireVersionStatusSchema,
  publishedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
})

export const questionnaireSectionSchema = z.object({
  id: z.string().uuid(),
  versionId: z.string().uuid(),
  key: fieldKeySchema,
  title: z.string(),
  orderIndex: z.number().int().nonnegative(),
})

export const questionnaireFieldSchema = z.object({
  id: z.string().uuid(),
  versionId: z.string().uuid(),
  sectionId: z.string().uuid(),
  key: fieldKeySchema,
  label: z.string(),
  helpText: z.string().nullable(),
  fieldType: fieldTypeSchema,
  options: z.array(z.string()).default([]),
  required: z.boolean(),
  orderIndex: z.number().int().nonnegative(),
  constraints: z.record(z.string(), z.unknown()).default({}),
  minAccessLevel: accessLevelSchema,
})

// A version with its ordered sections and fields (fields ordered by section, then position).
export const activeQuestionnaireSchema = z.object({
  version: questionnaireVersionSchema,
  sections: z.array(questionnaireSectionSchema),
  fields: z.array(questionnaireFieldSchema),
})

export const createQuestionnaireVersionFieldSchema = z.object({
  section: z.string().min(1).max(200),
  key: fieldKeySchema.optional(),
  label: z.string().min(1).max(500),
  fieldType: fieldTypeSchema,
  options: z.array(z.string().min(1).max(500)).max(200).optional(),
  required: z.boolean(),
  minAccessLevel: accessLevelSchema.optional(),
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
export type QuestionnaireVersionStatus = z.infer<typeof questionnaireVersionStatusSchema>
export type QuestionnaireVersion = z.infer<typeof questionnaireVersionSchema>
export type QuestionnaireSection = z.infer<typeof questionnaireSectionSchema>
export type QuestionnaireField = z.infer<typeof questionnaireFieldSchema>
export type ActiveQuestionnaire = z.infer<typeof activeQuestionnaireSchema>
export type CreateQuestionnaireVersionFieldInput = z.infer<
  typeof createQuestionnaireVersionFieldSchema
>
export type CreateQuestionnaireVersionInput = z.infer<typeof createQuestionnaireVersionSchema>
export type PatchQuestionnaireFieldInput = z.infer<typeof patchQuestionnaireFieldSchema>
