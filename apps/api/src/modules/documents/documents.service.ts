import { randomUUID } from 'node:crypto'
import {
  BadRequestException,
  ConflictException,
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
import type { Document, LibraryDocument, Prisma } from '@prisma/client'
import {
  ACCEPTED_DOCUMENT_FORMATS_LABEL,
  MAX_DOCUMENT_BYTES,
  documentTypeOf,
  grantsAccess,
  type AccessLevel,
  type DocumentAvailability,
  type DocumentType,
} from '@confluent/shared'
import { PrismaService } from '../../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import { lockProfile, type DossierRef } from '../dossiers/dossier-profile'
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
  // Number of the earlier version this one brought back (E05.06), null for a deposit.
  restoredFromVersion: number | null
}

// A document of the company's library (E05.06) as a reader may see it.
export interface DocumentGroup {
  id: string
  filename: string
  // The question the document answers (every version answers the same one, R48).
  fieldId: string | null
  type: DocumentType
  current: DocumentVersionView
  versions: DocumentVersionView[]
}

// A version as stored, with what its document says about it.
export type StoredVersion = Document & {
  fieldId: string | null
  type: DocumentType
  restoredFromVersion: number | null
}

const documentNotFound = () =>
  new NotFoundException({ code: 'DOCUMENT_NOT_FOUND', message: 'Document introuvable.' })

const storageUnavailable = () =>
  new ServiceUnavailableException({
    code: 'STORAGE_UNAVAILABLE',
    message:
      'Le stockage des documents est momentanément indisponible. Réessayez dans quelques instants.',
  })

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name)

  constructor(
    private readonly prisma: PrismaService,
    @Inject(STORAGE_TOKEN) private readonly storage: StorageAdapter,
    private readonly audit: AuditService,
  ) {}

  // The type announced by the browser is ignored: the stored and served type is the one recognised
  // in the content, and only accepted formats are stored.
  // The file joins the library of the dossier's company (E05.05, E05.06): a new version of the
  // document of that name for that question, or a new document of type `type` (default `other`;
  // ignored for a new version, whose document keeps its type). `fieldId` attaches it to an
  // attachment field of the company-profile form (E03.11); it is checked before anything is stored.
  async upload(params: {
    dossier: DossierRef
    filename: string
    buffer: Buffer
    fieldId?: string | null
    type?: DocumentType
  }): Promise<StoredVersion> {
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
    const { companyId } = params.dossier
    const fieldId = params.fieldId ? await this.attachmentField(companyId, params.fieldId) : null
    // Opaque key: the client-supplied name can neither escape the company prefix nor overwrite
    // another version's object. Files stored before E05.05 keep their `dossiers/<id>/` key.
    const storageKey = `companies/${companyId}/${randomUUID()}`
    await this.store(storageKey, params.buffer, mimetype)
    try {
      // A document is a name per question it answers (R48). Documents and version numbers are
      // assigned under the profile's lock, like every write that depends on the profile's state
      // (R40): two uploads of the same name never make two documents nor get the same version,
      // attached or not (the unique index cannot protect files without a question, whose field id
      // is NULL).
      return await this.prisma.$transaction(async (tx) => {
        await lockProfile(tx, params.dossier.id)
        const document =
          (await tx.libraryDocument.findFirst({ where: { companyId, fieldId, filename } })) ??
          (await tx.libraryDocument.create({
            data: { companyId, fieldId, filename, type: params.type ?? 'other' },
          }))
        const version = await this.nextVersion(tx, document.id)
        const created = await tx.document.create({
          data: {
            libraryDocumentId: document.id,
            companyId,
            filename,
            mimetype,
            storageKey,
            size: params.buffer.byteLength,
            version,
          },
        })
        return storedVersion(created, document, null)
      })
    } catch (err) {
      await this.storage.delete(storageKey).catch(() => undefined)
      throw err
    }
  }

  // The documents `level` may read (E03.11), each with all its versions, newest first: a file
  // attached to a field follows that field's read level, any other file requires
  // DOCUMENTS_MIN_LEVEL. Hidden documents are neither listed nor signed. A dossier presents every
  // document of its company (E05.05) until a dossier selects its own (E05.07).
  async listForDossier(dossier: DossierRef, level: AccessLevel): Promise<DocumentGroup[]> {
    const documents = (
      await this.prisma.libraryDocument.findMany({
        where: { companyId: dossier.companyId },
        orderBy: [{ filename: 'asc' }, { createdAt: 'asc' }],
        include: {
          field: { select: { minAccessLevel: true } },
          versions: { orderBy: { version: 'desc' } },
        },
      })
    ).filter((document) => document.versions.length > 0 && documentVisibleAt(document, level))
    const rows = documents.flatMap((document) => document.versions)
    const downloads = await mapWithConcurrency(rows, LISTING_CONCURRENCY, (row) =>
      this.download(row.storageKey, row.filename),
    )
    const downloadOf = new Map(rows.map((row, i) => [row.id, downloads[i]]))
    return documents.map((document) => {
      const numbers = new Map(document.versions.map((v) => [v.id, v.version]))
      const versions = document.versions.map(
        (row): DocumentVersionView => ({
          id: row.id,
          version: row.version,
          ...downloadOf.get(row.id)!,
          createdAt: row.createdAt,
          mimetype: row.mimetype,
          size: row.size,
          fieldId: document.fieldId,
          restoredFromVersion: row.restoredFromId
            ? (numbers.get(row.restoredFromId) ?? null)
            : null,
        }),
      )
      return {
        id: document.id,
        filename: document.filename,
        fieldId: document.fieldId,
        type: documentTypeOf(document.type),
        current: versions[0],
        versions,
      }
    })
  }

  // The content of one version, if `level` may read it (same rule as the listing): a version that is
  // hidden or belongs to another company is reported as not found.
  async readFile(
    dossier: DossierRef,
    level: AccessLevel,
    documentId: string,
  ): Promise<{ document: StoredVersion; content: Buffer }> {
    const row = await this.prisma.document.findFirst({
      where: { id: documentId, companyId: dossier.companyId },
      include: { libraryDocument: { include: { field: { select: { minAccessLevel: true } } } } },
    })
    if (!row || !documentVisibleAt(row.libraryDocument, level)) throw documentNotFound()
    const { libraryDocument, ...version } = row
    const restoredFrom = version.restoredFromId
      ? await this.prisma.document.findUnique({
          where: { id: version.restoredFromId },
          select: { version: true },
        })
      : null
    const document = storedVersion(version, libraryDocument, restoredFrom?.version ?? null)
    try {
      return { document, content: await this.storage.read(row.storageKey) }
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
      throw storageUnavailable()
    }
  }

  // E05.06: the document's type, changed by its owner (the caller checks ownership). Recorded in the
  // dossier's journal when it changes.
  async setType(params: {
    dossier: DossierRef
    documentId: string
    type: DocumentType
    actorId: string
  }): Promise<LibraryDocument & { type: DocumentType }> {
    const { dossier, documentId, type } = params
    const found = await this.prisma.libraryDocument.findFirst({
      where: { id: documentId, companyId: dossier.companyId },
    })
    if (!found) throw documentNotFound()
    const previous = documentTypeOf(found.type)
    if (previous === type) return { ...found, type }
    const updated = await this.prisma.libraryDocument.update({
      where: { id: found.id },
      data: { type },
    })
    await this.audit.record({
      actionType: 'document_type_changed',
      actorId: params.actorId,
      dossierId: dossier.id,
      metadata: { documentId: found.id, filename: found.filename, from: previous, to: type },
    })
    return { ...updated, type }
  }

  // E05.06: brings an earlier version of a document back. Nothing is overwritten nor deleted: a new
  // version is added, newest of the document, pointing at the same stored object and saying which
  // version it restores; every version stays readable. A version whose file is lost cannot come
  // back (410), nor can the version in force (409). Numbered under the profile's lock, like a
  // deposit: a restoration and an upload (or two restorations) never get the same number.
  async restoreVersion(params: {
    dossier: DossierRef
    documentId: string
    versionId: string
    actorId: string
  }): Promise<StoredVersion> {
    const { dossier, documentId, versionId } = params
    const source = await this.prisma.document.findFirst({
      where: { id: versionId, libraryDocumentId: documentId, companyId: dossier.companyId },
    })
    if (!source) throw documentNotFound()
    let present: boolean
    try {
      present = await this.storage.exists(source.storageKey)
    } catch (err) {
      this.logger.warn(
        `document storage unreachable for ${source.storageKey}: ${(err as Error).message}`,
      )
      throw storageUnavailable()
    }
    if (!present) {
      throw new GoneException({
        code: 'DOCUMENT_MISSING',
        message: 'Le fichier de cette version est perdu : elle ne peut pas être restaurée.',
      })
    }
    const restored = await this.prisma.$transaction(async (tx) => {
      await lockProfile(tx, dossier.id)
      const document = await tx.libraryDocument.findFirst({
        where: { id: documentId, companyId: dossier.companyId },
      })
      if (!document) throw documentNotFound()
      const current = await tx.document.findFirst({
        where: { libraryDocumentId: document.id },
        orderBy: { version: 'desc' },
      })
      if (current?.storageKey === source.storageKey) {
        throw new ConflictException({
          code: 'DOCUMENT_VERSION_CURRENT',
          message: 'Cette version est déjà la version en vigueur du document.',
        })
      }
      const created = await tx.document.create({
        data: {
          libraryDocumentId: document.id,
          companyId: document.companyId,
          filename: document.filename,
          mimetype: source.mimetype,
          storageKey: source.storageKey,
          size: source.size,
          version: (current?.version ?? 0) + 1,
          restoredFromId: source.id,
        },
      })
      return storedVersion(created, document, source.version)
    })
    await this.audit.record({
      actionType: 'document_version_restored',
      actorId: params.actorId,
      dossierId: dossier.id,
      metadata: {
        documentId: restored.libraryDocumentId,
        filename: restored.filename,
        restoredVersionId: source.id,
        restoredVersion: source.version,
        versionId: restored.id,
        version: restored.version,
      },
    })
    return restored
  }

  private async nextVersion(tx: Prisma.TransactionClient, libraryDocumentId: string) {
    const previous = await tx.document.findFirst({
      where: { libraryDocumentId },
      orderBy: { version: 'desc' },
      select: { version: true },
    })
    return (previous?.version ?? 0) + 1
  }

  // E04.09: the document version of this dossier whose text — as read_document returns it — contains
  // `passage` (spacing, case and typography ignored, as for a cited excerpt), newest first. One
  // reading per readable version, each bounded in size and time. A version that cannot be read
  // now (format, lost file, storage unreachable) is skipped: this is a safety net, not a guarantee.
  async findPassage(dossier: DossierRef, passage: string): Promise<Document | null> {
    const rows = await this.prisma.document.findMany({
      where: { companyId: dossier.companyId },
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

  // A document may only answer an attachment field of the company's own profile version.
  private async attachmentField(companyId: string, fieldId: string): Promise<string> {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { profileVersionId: true },
    })
    const field = company
      ? await this.prisma.questionnaireField.findFirst({
          where: { id: fieldId, versionId: company.profileVersionId, fieldType: 'file' },
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

// A document attached to a field follows that field's read level; any other file requires
// DOCUMENTS_MIN_LEVEL (E03.11). Every version of a document has its document's visibility.
function documentVisibleAt(
  document: { field: { minAccessLevel: string } | null },
  level: AccessLevel,
) {
  return document.field
    ? fieldVisibleAt(document.field, level)
    : grantsAccess(level, DOCUMENTS_MIN_LEVEL)
}

function storedVersion(
  version: Document,
  document: Pick<LibraryDocument, 'fieldId' | 'type'>,
  restoredFromVersion: number | null,
): StoredVersion {
  return {
    ...version,
    fieldId: document.fieldId,
    type: documentTypeOf(document.type),
    restoredFromVersion,
  }
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
