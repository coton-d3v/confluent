import { BadRequestException } from '@nestjs/common'
import { documentTypeSchema, type DocumentType, type UploadedDocument } from '@confluent/shared'
import { MAX_UPLOAD_BYTES, type StoredVersion } from './documents.service'

// What a document upload's multipart request carries, read the same way by the owner's route and the
// administrators' (E10.05).

export interface MulterFile {
  originalname: string
  buffer: Buffer
  size: number
}

// The multipart limit aborts the upload while streaming (413) instead of buffering an oversized file
// in memory first. Browsers send the file name in UTF-8, multer reads it as latin1 by default
// (`defParamCharset` is a multer option missing from Nest's MulterOptions type).
export const UPLOAD_OPTIONS = {
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 10 },
  defParamCharset: 'utf8',
}

// A multipart field is text: an absent or empty `type` means none; any other value must be a known
// type (closed list, 400 otherwise).
export function documentTypeField(raw: unknown): DocumentType | undefined {
  if (raw === undefined || raw === '') return undefined
  const parsed = documentTypeSchema.safeParse(raw)
  if (!parsed.success) {
    throw new BadRequestException({
      code: 'INVALID_DOCUMENT_TYPE',
      message: 'Type de document inconnu.',
    })
  }
  return parsed.data
}

export function documentFieldIdField(raw: unknown): string | null {
  return typeof raw === 'string' && raw !== '' ? raw : null
}

export function requireFile(file: MulterFile | undefined): MulterFile {
  if (!file) {
    throw new BadRequestException({ code: 'FILE_REQUIRED', message: 'File is required.' })
  }
  return file
}

export function versionResponse(created: StoredVersion): UploadedDocument {
  return {
    id: created.id,
    documentId: created.libraryDocumentId,
    filename: created.filename,
    type: created.type,
    version: created.version,
    restoredFromVersion: created.restoredFromVersion,
    mimetype: created.mimetype,
    size: created.size,
    fieldId: created.fieldId,
    createdAt: created.createdAt.toISOString(),
  }
}
