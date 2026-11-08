import { z } from 'zod'
import { accessLevelSchema } from './access-level.schema.js'
import { fieldConstraintsSchema } from './field-constraints.schema.js'
import {
  choiceInputSchema,
  fieldKeySchema,
  fieldTypeSchema,
  hasUniqueKeys,
  questionnaireFieldSchema,
  questionnaireSectionSchema,
  questionnaireVersionSchema,
} from './questionnaire.schema.js'

// Form builder (ROADMAP E03.02, E03.03, E03.07, E03.08, E03.13). A form has at most one published
// version (used for new dossiers) and at most one draft; only the draft can be edited.

// Business usage a form is assigned to (E03.09); `null` = not assigned yet.
export const formUsageSchema = z.enum(['dossier'])

const versionRefSchema = z.object({
  id: z.string().uuid(),
  version: z.number().int().positive(),
})

export const formSummarySchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  name: z.string(),
  usage: formUsageSchema.nullable(),
  archivedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  published: versionRefSchema.extend({ publishedAt: z.string().datetime() }).nullable(),
  draft: versionRefSchema.extend({ updatedAt: z.string().datetime() }).nullable(),
})

export const formDetailSchema = formSummarySchema.extend({
  versions: z.array(questionnaireVersionSchema),
})

// Why a draft cannot be published yet; `sectionId`/`fieldId` point at what to fix.
export const draftProblemSchema = z.object({
  code: z.enum(['EMPTY_FORM', 'EMPTY_SECTION', 'SELECT_WITHOUT_CHOICES']),
  message: z.string(),
  sectionId: z.string().uuid().optional(),
  fieldId: z.string().uuid().optional(),
})

// A version with its ordered structure; `problems` is filled for a draft only.
export const formVersionStructureSchema = z.object({
  form: formSummarySchema,
  version: questionnaireVersionSchema,
  sections: z.array(questionnaireSectionSchema),
  fields: z.array(questionnaireFieldSchema),
  problems: z.array(draftProblemSchema),
})

const nameSchema = z.string().trim().min(1).max(200)

export const createFormSchema = z.object({ name: nameSchema })

// The form takes the usage over from the form that had it (E03.09).
export const assignFormUsageSchema = z.object({ usage: formUsageSchema })
export const renameFormSchema = z.object({ name: nameSchema })
export const duplicateFormSchema = z.object({ name: nameSchema })

export const createDraftSectionSchema = z.object({
  title: z.string().trim().min(1).max(200),
  key: fieldKeySchema.optional(),
})

export const updateDraftSectionSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    key: fieldKeySchema.optional(),
  })
  .refine((v) => v.title !== undefined || v.key !== undefined, {
    message: 'At least one property must be provided.',
  })

export const reorderSchema = z.object({
  ids: z
    .array(z.string().uuid())
    .min(1)
    .max(500)
    .refine((ids) => new Set(ids).size === ids.length, { message: 'Duplicate ids.' }),
})

const choicesSchema = z
  .array(choiceInputSchema)
  .max(200)
  .refine(hasUniqueKeys, { message: 'Each choice key must be unique within a field.' })

export const createDraftFieldSchema = z.object({
  sectionId: z.string().uuid(),
  label: z.string().trim().min(1).max(500),
  key: fieldKeySchema.optional(),
  helpText: z.string().trim().max(2000).nullable().optional(),
  fieldType: fieldTypeSchema,
  required: z.boolean().default(false),
  choices: choicesSchema.optional(),
  // Input limits that fit the field type (E03.05).
  constraints: fieldConstraintsSchema.optional(),
  // Omitted: the most restrictive level (E03.07).
  minAccessLevel: accessLevelSchema.optional(),
})

// `sectionId` moves the field to the end of another section of the same draft.
export const updateDraftFieldSchema = z
  .object({
    sectionId: z.string().uuid(),
    label: z.string().trim().min(1).max(500),
    key: fieldKeySchema,
    helpText: z.string().trim().max(2000).nullable(),
    fieldType: fieldTypeSchema,
    required: z.boolean(),
    choices: choicesSchema,
    constraints: fieldConstraintsSchema,
    minAccessLevel: accessLevelSchema,
  })
  .partial()
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: 'At least one property must be provided.',
  })

export type FormUsage = z.infer<typeof formUsageSchema>
export type FormSummary = z.infer<typeof formSummarySchema>
export type FormDetail = z.infer<typeof formDetailSchema>
export type DraftProblem = z.infer<typeof draftProblemSchema>
export type FormVersionStructure = z.infer<typeof formVersionStructureSchema>
export type CreateFormInput = z.infer<typeof createFormSchema>
export type AssignFormUsageInput = z.infer<typeof assignFormUsageSchema>
export type RenameFormInput = z.infer<typeof renameFormSchema>
export type DuplicateFormInput = z.infer<typeof duplicateFormSchema>
export type CreateDraftSectionInput = z.infer<typeof createDraftSectionSchema>
export type UpdateDraftSectionInput = z.infer<typeof updateDraftSectionSchema>
export type ReorderInput = z.infer<typeof reorderSchema>
export type CreateDraftFieldInput = z.infer<typeof createDraftFieldSchema>
export type UpdateDraftFieldInput = z.infer<typeof updateDraftFieldSchema>
