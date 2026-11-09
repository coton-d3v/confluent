import { z } from 'zod'

// Same limits for the site (immediate feedback) and the API (authoritative, content-based check).
export const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024

export const ACCEPTED_DOCUMENT_EXTENSIONS = [
  'pdf',
  'png',
  'jpg',
  'jpeg',
  'webp',
  'heic',
  'heif',
  'docx',
  'xlsx',
  'pptx',
  'odt',
  'ods',
  'odp',
  'doc',
  'xls',
  'ppt',
  'csv',
  'txt',
] as const

export const ACCEPTED_DOCUMENT_FORMATS_LABEL =
  'PDF, image (PNG, JPEG, WebP, HEIC), Word, Excel, PowerPoint, OpenDocument, CSV ou texte'

// `missing`: the stored file is lost and must be uploaded again; `unavailable`: the storage could not
// be reached for now. Only an `available` version has a download URL.
export const documentAvailabilitySchema = z.enum(['available', 'missing', 'unavailable'])

export const documentVersionSchema = z.object({
  version: z.number().int().positive(),
  availability: documentAvailabilitySchema,
  // Signed URL (15 min) that downloads the file; null unless `availability` is `available`.
  url: z.string().min(1).nullable(),
  createdAt: z.string().datetime(),
  mimetype: z.string(),
  size: z.number().int().nonnegative(),
  // Attachment field of the form this version answers (E03.11); null for the Documents tab.
  fieldId: z.string().uuid().nullable(),
})

// A document is a file name answering one attachment question (or none), with its versions: the
// same name sent for two questions makes two documents (code review R48).
export const documentGroupSchema = z.object({
  filename: z.string(),
  fieldId: z.string().uuid().nullable(),
  current: documentVersionSchema,
  versions: z.array(documentVersionSchema),
})

export const uploadedDocumentSchema = z.object({
  id: z.string().uuid(),
  filename: z.string(),
  version: z.number().int().positive(),
  mimetype: z.string(),
  size: z.number().int().nonnegative(),
  fieldId: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
})

export type DocumentAvailability = z.infer<typeof documentAvailabilitySchema>
export type DocumentVersion = z.infer<typeof documentVersionSchema>
export type DocumentGroup = z.infer<typeof documentGroupSchema>
export type UploadedDocument = z.infer<typeof uploadedDocumentSchema>
