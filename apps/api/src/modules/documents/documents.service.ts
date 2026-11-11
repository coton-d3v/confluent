import { randomUUID } from 'node:crypto'
import {
  BadRequestException,
  GoneException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
  UnsupportedMediaTypeException,
} from '@nestjs/common'
import type { Document } from '@prisma/client'
import {
  ACCEPTED_DOCUMENT_FORMATS_LABEL,
  MAX_DOCUMENT_BYTES,
  grantsAccess,
  type AccessLevel,
  type DocumentAvailability,
} from '@confluent/shared'
import { PrismaService } from '../../prisma/prisma.service'
import { lockDossier } from '../dossiers/dossier-lock'
import { DOCUMENTS_MIN_LEVEL, fieldVisibleAt } from '../dossiers/financeur-access'
import { detectDocumentType } from './document-types'
import { DOCUMENT_TEXT_LIMITS, extractDocumentText, readingOf } from './text/document-text'
import { locateExcerpt } from './text/excerpt-location'
import {
  MAX_SIGNED_URL_SECONDS,
  STORAGE_TOKEN,
  StorageQuotaExceededError,
  StoredObjectMissingError,
  type StorageAdapter,
} from './storage/storage.adapter'

export const MAX_UPLOAD_BYTES = MAX_DOCUMENT_BYTES
// Storage checks of one listing run a few at a time, not one request per version at once.
const LISTING_CONCURRENCY = 8

// Display name only — never used to build a storage path. Strips any directory part and control
// characters a client may send, and bounds the length.
export function sanitizeFilename(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? ''
  const clean = [...base]
    .filter((ch) => ch.charCodeAt(0) > 0x1f && ch.charCodeAt(0) !== 0x7f)
    .join('')
    .trim()
    .slice(0, 255)
  return clean && clean !== '.' && clean !== '..' ? clean : 'document'
}

export interface DocumentVersionView {
  id: string
  version: number
  // `missing`: the file is lost and must be uploaded again; `unavailable`: the storage could not be
  // reached right now. In both cases the document is still listed, without a download URL.
  availability: DocumentAvailability
  url: string | null
  createdAt: Date
  mimetype: string
  size: number
  fieldId: string | null
}

export interface DocumentGroup {
  filename: string
  // The question the document answers (every version answers the same one, R48).
  fieldId: string | null
  current: DocumentVersionView
  versions: DocumentVersionView[]
}

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name)

  constructor(
    private readonly prisma: PrismaService,
    @Inject(STORAGE_TOKEN) private readonly storage: StorageAdapter,
  ) {}

  // The type announced by the browser is ignored: the stored and served type is the one recognised
  // in the content, and only accepted formats are stored.
  // `fieldId` attaches the file to an attachment field of the dossier's form (E03.11); it is checked
  // before anything is stored.
  async upload(params: {
    dossierId: string
    filename: string
    buffer: Buffer
    fieldId?: string | null
  }): Promise<Document> {
    // Normally enforced earlier by the multipart limit; kept for callers other than the controller.
    if (params.buffer.byteLength > MAX_UPLOAD_BYTES) {
      throw new PayloadTooLargeException({
        code: 'PAYLOAD_TOO_LARGE',
        message: 'Fichier trop volumineux : 20 Mo maximum.',
      })
    }
    const filename = sanitizeFilename(params.filename)
    const mimetype = detectDocumentType(params.buffer, filename)
    if (!mimetype) {
      throw new UnsupportedMediaTypeException({
        code: 'UNSUPPORTED_DOCUMENT_TYPE',
        message: `Format non accepté. Formats acceptés : ${ACCEPTED_DOCUMENT_FORMATS_LABEL}.`,
      })
    }
    const fieldId = params.fieldId
      ? await this.attachmentField(params.dossierId, params.fieldId)
      : null
    // Opaque key: the client-supplied name can neither escape the dossier prefix nor overwrite
    // another version's object.
    const storageKey = `dossiers/${params.dossierId}/${randomUUID()}`
    await this.store(storageKey, params.buffer, mimetype)
    try {
      // A document is versioned per question it answers (R48). Numbers are assigned under the
      // dossier's row lock, like every write that depends on the dossier's state (R40): two uploads
      // of the same name never get the same version, attached or not (the unique index cannot
      // protect files without a question, whose field id is NULL).
      return await this.prisma.$transaction(async (tx) => {
        await lockDossier(tx, params.dossierId)
        const previous = await tx.document.findFirst({
          where: { dossierId: params.dossierId, fieldId, filename },
          orderBy: { version: 'desc' },
          select: { version: true },
        })
        return tx.document.create({
          data: {
            dossierId: params.dossierId,
            filename,
            mimetype,
            storageKey,
            size: params.buffer.byteLength,
            version: (previous?.version ?? 0) + 1,
            fieldId,
          },
        })
      })
    } catch (err) {
      await this.storage.delete(storageKey).catch(() => undefined)
      throw err
    }
  }

  // The versions `level` may read (E03.11): a file attached to a field follows that field's read
  // level, any other file requires DOCUMENTS_MIN_LEVEL. Hidden versions are neither listed nor
  // signed; a group whose versions are all hidden is left out.
  async listForDossier(dossierId: string, level: AccessLevel): Promise<DocumentGroup[]> {
    const rows = (
      await this.prisma.document.findMany({
        where: { dossierId },
        orderBy: [{ filename: 'asc' }, { version: 'desc' }],
        include: { field: { select: { minAccessLevel: true } } },
      })
    ).filter((row) => versionVisibleAt(row, level))
    const downloads = await mapWithConcurrency(rows, LISTING_CONCURRENCY, (row) =>
      this.download(row.storageKey, row.filename),
    )
    // A document is a file name answering one question (or none): grouped and versioned apart (R48).
    const byDocument = new Map<string, { filename: string; versions: DocumentVersionView[] }>()
    rows.forEach((row, i) => {
      const view: DocumentVersionView = {
        id: row.id,
        version: row.version,
        ...downloads[i],
        createdAt: row.createdAt,
        mimetype: row.mimetype,
        size: row.size,
        fieldId: row.fieldId,
      }
      const key = `${row.fieldId ?? ''}/${row.filename}`
      const document = byDocument.get(key) ?? { filename: row.filename, versions: [] }
      document.versions.push(view)
      byDocument.set(key, document)
    })
    return [...byDocument.values()].map(({ filename, versions }) => ({
      filename,
      fieldId: versions[0].fieldId,
      current: versions[0],
      versions,
    }))
  }

  // The content of one version, if `level` may read it (same rule as the listing): a version that is
  // hidden or belongs to another dossier is reported as not found.
  async readFile(
    dossierId: string,
    level: AccessLevel,
    documentId: string,
  ): Promise<{ document: Document; content: Buffer }> {
    const row = await this.prisma.document.findFirst({
      where: { id: documentId, dossierId },
      include: { field: { select: { minAccessLevel: true } } },
    })
    if (!row || !versionVisibleAt(row, level)) {
      throw new NotFoundException({ code: 'DOCUMENT_NOT_FOUND', message: 'Document introuvable.' })
    }
    try {
      return { document: row, content: await this.storage.read(row.storageKey) }
    } catch (err) {
      if (err instanceof StoredObjectMissingError) {
        this.logger.warn(`document object missing: ${row.storageKey}`)
        throw new GoneException({
          code: 'DOCUMENT_MISSING',
          message: 'Le fichier de ce document est perdu : il doit être déposé de nouveau.',
        })
      }
      this.logger.warn(
        `document storage unreachable for ${row.storageKey}: ${(err as Error).message}`,
      )
      throw new ServiceUnavailableException({
        code: 'STORAGE_UNAVAILABLE',
        message:
          'Le stockage des documents est momentanément indisponible. Réessayez dans quelques instants.',
      })
    }
  }

  // E04.09: the document version of this dossier whose text — as read_document returns it — contains
  // `passage` (spacing, case and typography ignored, as for a cited excerpt), newest first. One
  // reading per readable version, each bounded in size and time. A version that cannot be read
  // now (format, lost file, storage unreachable) is skipped: this is a safety net, not a guarantee.
  async findPassage(dossierId: string, passage: string): Promise<Document | null> {
    const rows = await this.prisma.document.findMany({
      where: { dossierId },
      orderBy: { createdAt: 'desc' },
    })
    for (const row of rows) {
      if (!readingOf(row.mimetype).readable) continue
      let content: Buffer
      try {
        content = await this.storage.read(row.storageKey)
      } catch (err) {
        this.logger.warn(`document not checked (${row.storageKey}): ${(err as Error).message}`)
        continue
      }
      const text = await extractDocumentText(content, row.mimetype, DOCUMENT_TEXT_LIMITS)
      if (text.readable && locateExcerpt(text.units, passage).found) return row
    }
    return null
  }

  // A document may only answer an attachment field of the dossier's own form version.
  private async attachmentField(dossierId: string, fieldId: string): Promise<string> {
    const dossier = await this.prisma.dossier.findUnique({
      where: { id: dossierId },
      select: { questionnaireVersionId: true },
    })
    const field = dossier
      ? await this.prisma.questionnaireField.findFirst({
          where: { id: fieldId, versionId: dossier.questionnaireVersionId, fieldType: 'file' },
          select: { id: true },
        })
      : null
    if (!field) {
      throw new BadRequestException({
        code: 'INVALID_DOCUMENT_FIELD',
        message: 'Ce champ n’attend pas de document dans ce dossier.',
      })
    }
    return field.id
  }

  private async store(key: string, buffer: Buffer, mimetype: string): Promise<void> {
    try {
      await this.storage.upload(key, buffer, mimetype)
    } catch (err) {
      if (err instanceof StorageQuotaExceededError) {
        this.logger.error('document storage quota reached: upload refused')
        throw new HttpException(
          {
            code: 'STORAGE_FULL',
            message:
              "L'espace de stockage des documents est plein : le fichier n'a pas été enregistré. Contactez l'équipe Confluent.",
          },
          507,
        )
      }
      this.logger.error(`document upload failed: ${(err as Error).name} ${(err as Error).message}`)
      throw new ServiceUnavailableException({
        code: 'STORAGE_UNAVAILABLE',
        message:
          "Le stockage des documents est momentanément indisponible : le fichier n'a pas été enregistré. Réessayez dans quelques instants.",
      })
    }
  }

  // One lost or unreachable object must not fail the whole listing (and every page that embeds it).
  private async download(
    storageKey: string,
    filename: string,
  ): Promise<Pick<DocumentVersionView, 'availability' | 'url'>> {
    try {
      const url = await this.storage.getSignedUrl(storageKey, {
        filename,
        ttlSeconds: MAX_SIGNED_URL_SECONDS,
      })
      return { availability: 'available', url }
    } catch (err) {
      if (err instanceof StoredObjectMissingError) {
        this.logger.warn(`document object missing: ${storageKey}`)
        return { availability: 'missing', url: null }
      }
      this.logger.warn(`document storage unreachable for ${storageKey}: ${(err as Error).message}`)
      return { availability: 'unavailable', url: null }
    }
  }
}

// A version attached to a field follows that field's read level; any other file requires
// DOCUMENTS_MIN_LEVEL (E03.11).
function versionVisibleAt(row: { field: { minAccessLevel: string } | null }, level: AccessLevel) {
  return row.field ? fieldVisibleAt(row.field, level) : grantsAccess(level, DOCUMENTS_MIN_LEVEL)
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}
