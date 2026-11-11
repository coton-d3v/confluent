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
  .regex(
    /^[a-z][a-z0-9_]*$/,
    'Clé attendue en snake_case : minuscules sans accent, chiffres et _, commençant par une lettre.',
  )

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

// A choice of a `select` field: answers store `key`, `label` is what people read (E03.06).
export const choiceSchema = z.object({
  key: fieldKeySchema,
  label: z.string(),
})

export const questionnaireFieldSchema = z.object({
  id: z.string().uuid(),
  versionId: z.string().uuid(),
  sectionId: z.string().uuid(),
  key: fieldKeySchema,
  label: z.string(),
  helpText: z.string().nullable(),
  fieldType: fieldTypeSchema,
  choices: z.array(choiceSchema).default([]),
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

// A choice as written by the form builder: without `key`, it is derived from the label. To rename
// a choice without changing classification or the meaning of answers, keep its key.
export const choiceInputSchema = z.object({
  key: fieldKeySchema.optional(),
  label: z.string().min(1).max(500),
})

export type FieldType = z.infer<typeof fieldTypeSchema>
export type QuestionnaireVersionStatus = z.infer<typeof questionnaireVersionStatusSchema>
export type QuestionnaireVersion = z.infer<typeof questionnaireVersionSchema>
export type QuestionnaireSection = z.infer<typeof questionnaireSectionSchema>
export type Choice = z.infer<typeof choiceSchema>
export type ChoiceInput = z.infer<typeof choiceInputSchema>
export type QuestionnaireField = z.infer<typeof questionnaireFieldSchema>
export type ActiveQuestionnaire = z.infer<typeof activeQuestionnaireSchema>
