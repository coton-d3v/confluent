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

// Types of a document of the company's library (ROADMAP E05.06), a closed list kept equal to the
// `library_documents_type_check` constraint. A document's type says what it is, for its owner and
// later for choosing the documents of a financing request (E05.07); it grants no access.
export const DOCUMENT_TYPES = [
  'business_plan',
  'pitch_deck',
  'financial_forecast',
  'financial_statements',
  'cap_table',
  'company_registration',
  'articles_of_association',
  'team_resumes',
  'bank_details',
  'other',
] as const

export const documentTypeSchema = z.enum(DOCUMENT_TYPES)
export type DocumentType = z.infer<typeof documentTypeSchema>

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  business_plan: 'Business plan',
  pitch_deck: 'Présentation (pitch deck)',
  financial_forecast: 'Prévisionnel financier',
  financial_statements: 'Comptes annuels',
  cap_table: 'Table de capitalisation',
  company_registration: 'Extrait Kbis',
  articles_of_association: 'Statuts',
  team_resumes: 'CV de l’équipe',
  bank_details: 'RIB',
  other: 'Autre document',
}

// Closed by default: a value this code does not know is read as `other`.
export function documentTypeOf(raw: string | null | undefined): DocumentType {
  const parsed = documentTypeSchema.safeParse(raw)
  return parsed.success ? parsed.data : 'other'
}

export const documentVersionSchema = z.object({
  // Identifies this version (e.g. to read its content through MCP, E04.03).
  id: z.string().uuid(),
  version: z.number().int().positive(),
  availability: documentAvailabilitySchema,
  // Signed URL (15 min) that downloads the file; null unless `availability` is `available`.
  url: z.string().min(1).nullable(),
  createdAt: z.string().datetime(),
  mimetype: z.string(),
  size: z.number().int().nonnegative(),
  // Attachment field of the form this version answers (E03.11); null for the Documents tab.
  fieldId: z.string().uuid().nullable(),
  // E05.06: number of the earlier version this one brought back (same file), null for a deposit.
  restoredFromVersion: z.number().int().positive().nullable(),
})

// E05.07: how a dossier (financing request) selects a document of its company's library — its
// latest version (`pinnedVersionId` null: the request follows the document), or one version pinned.
// Only the selected documents, at that version, reach the recipients of the dossier's shares.
export const dossierDocumentSelectionSchema = z
  .object({ pinnedVersionId: z.string().uuid().nullable() })
  .strict()

export const dossierDocumentSelectedSchema = z.object({
  documentId: z.string().uuid(),
  pinnedVersionId: z.string().uuid().nullable(),
})

// A document of the company's library: a file name answering one attachment question (or none),
// with its type and its versions, newest first; `current` is the newest. The same name sent for two
// questions makes two documents (code review R48). `id` identifies the document across its versions.
// The owner lists the whole library, with the dossier's `selection` of each document (null: not
// selected); a share recipient lists the selected documents only, each with the one version
// selected (E05.07), without `selection`.
export const documentGroupSchema = z.object({
  id: z.string().uuid(),
  filename: z.string(),
  fieldId: z.string().uuid().nullable(),
  type: documentTypeSchema,
  current: documentVersionSchema,
  versions: z.array(documentVersionSchema),
  selection: dossierDocumentSelectionSchema.nullable().optional(),
})

// A version just created, by a deposit or by bringing back an earlier version (E05.06).
export const uploadedDocumentSchema = z.object({
  id: z.string().uuid(),
  // The document this version belongs to (`documentGroupSchema.id`).
  documentId: z.string().uuid(),
  filename: z.string(),
  type: documentTypeSchema,
  version: z.number().int().positive(),
  restoredFromVersion: z.number().int().positive().nullable(),
  mimetype: z.string(),
  size: z.number().int().nonnegative(),
  fieldId: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
})

// PATCH body: the document's new type.
export const updateDocumentSchema = z.object({ type: documentTypeSchema }).strict()

export const libraryDocumentSchema = z.object({
  id: z.string().uuid(),
  filename: z.string(),
  fieldId: z.string().uuid().nullable(),
  type: documentTypeSchema,
})

export type DocumentAvailability = z.infer<typeof documentAvailabilitySchema>
export type DocumentVersion = z.infer<typeof documentVersionSchema>
export type DocumentGroup = z.infer<typeof documentGroupSchema>
export type UploadedDocument = z.infer<typeof uploadedDocumentSchema>
export type UpdateDocument = z.infer<typeof updateDocumentSchema>
export type LibraryDocument = z.infer<typeof libraryDocumentSchema>
export type DossierDocumentSelection = z.infer<typeof dossierDocumentSelectionSchema>
export type DossierDocumentSelected = z.infer<typeof dossierDocumentSelectedSchema>
