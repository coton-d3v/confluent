import { z } from 'zod'

export const documentVersionSchema = z.object({
  version: z.number().int().positive(),
  // null when the stored file cannot be reached (download unavailable, document still listed)
  url: z.string().min(1).nullable(),
  createdAt: z.string().datetime(),
  mimetype: z.string(),
  size: z.number().int().nonnegative(),
})

export const documentGroupSchema = z.object({
  filename: z.string(),
  current: documentVersionSchema,
  versions: z.array(documentVersionSchema),
})

export const uploadedDocumentSchema = z.object({
  id: z.string().uuid(),
  filename: z.string(),
  version: z.number().int().positive(),
  mimetype: z.string(),
  size: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
})

export type DocumentVersion = z.infer<typeof documentVersionSchema>
export type DocumentGroup = z.infer<typeof documentGroupSchema>
export type UploadedDocument = z.infer<typeof uploadedDocumentSchema>
