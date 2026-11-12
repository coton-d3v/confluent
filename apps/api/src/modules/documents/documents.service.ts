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
  type DossierDocumentSelected,
} from '@confluent/shared'
import { PrismaService } from '../../prisma/prisma.service'
import { type ActionOrigin, SITE_ORIGIN, originMetadata } from '../audit/action-origin'
import { AuditService } from '../audit/audit.service'
import { lockProfile, type DossierRef } from '../dossiers/dossier-profile'
import {
  DOCUMENTS_MIN_LEVEL,
  fieldVisibleAt,
  type DossierRelation,
} from '../dossiers/financeur-access'
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
  // For the owner only: how the dossier selects the document (E05.07), null when it does not.
  selection?: { pinnedVersionId: string | null } | null
}

// A version as stored, with what its document says about it.
export type StoredVersion = Document & {
  fieldId: string | null
  type: DocumentType
  restoredFromVersion: number | null
}

const documentNotFound = () =>
  new NotFoundException({ code: 'DOCUMENT_NOT_FOUND', message: 'Document introuvable.' })

const versionNotFound = () =>
  new NotFoundException({
    code: 'DOCUMENT_VERSION_NOT_FOUND',
    message: 'Cette version n’appartient pas à ce document.',
  })

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
  // A new document is selected by the dossier it is deposited through, following its latest version
  // (E05.07: what is deposited for a request reaches its shares, as before); the company's other
  // dossiers select it only if their owner chooses to. A new version changes no selection.
  //
  // E10.05: deposited by an administrator (`byAdministrator`, their account) through a request, the
  // file goes through the same library and versions — a new document, or a new version replacing the
  // one in force — and is journaled on that request in the same transaction (`admin_uploaded_document`,
  // shown to its owner as an intervention of the administration): no version without its entry, and
  // the stored object is deleted if either fails. A new document is not selected: only its owner
  // decides what their requests present to their shares.
  async upload(params: {
    dossier: DossierRef
    filename: string
    buffer: Buffer
    fieldId?: string | null
    type?: DocumentType
    byAdministrator?: string
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
        await lockProfile(tx, params.dossier)
        let document = await tx.libraryDocument.findFirst({
          where: { companyId, fieldId, filename },
        })
        const newDocument = !document
        if (!document) {
          document = await tx.libraryDocument.create({
            data: { companyId, fieldId, filename, type: params.type ?? 'other' },
          })
          if (!params.byAdministrator) {
            await tx.dossierDocument.create({
              data: { dossierId: params.dossier.id, companyId, libraryDocumentId: document.id },
            })
          }
        }
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
        if (params.byAdministrator) {
          await this.audit.recordIn(tx, {
            actionType: 'admin_uploaded_document',
            actorId: params.byAdministrator,
            dossierId: params.dossier.id,
            metadata: {
              documentId: document.id,
              versionId: created.id,
              filename,
              version,
              newDocument,
              fieldId,
              type: documentTypeOf(document.type),
              size: created.size,
              mimetype,
            },
          })
        }
        return storedVersion(created, document, null)
      })
    } catch (err) {
      await this.storage.delete(storageKey).catch(() => undefined)
      throw err
    }
  }

  // The documents a reader may see (E03.11): a file attached to a field follows that field's read
  // level, any other file requires DOCUMENTS_MIN_LEVEL. Hidden documents are neither listed nor
  // signed. The owner reads the company's whole library (E05.05), every version, with the dossier's
  // selection of each document. A share recipient reads only the documents the dossier selects
  // (E05.07), each with the one version selected — its latest, or the pinned one — never the others.
  async listForDossier(
    dossier: DossierRef,
    level: AccessLevel,
    relation: DossierRelation,
  ): Promise<DocumentGroup[]> {
    const owner = relation === 'owner'
    const [library, selection] = await Promise.all([
      this.prisma.libraryDocument.findMany({
        where: { companyId: dossier.companyId },
        orderBy: [{ filename: 'asc' }, { createdAt: 'asc' }],
        include: {
          field: { select: { minAccessLevel: true } },
          versions: { orderBy: { version: 'desc' } },
        },
      }),
      this.selectionOf(dossier),
    ])
    const documents = library
      .filter((document) => owner || selection.has(document.id))
      .map((document) => ({
        ...document,
        shown: owner
          ? document.versions
          : selectedVersions(document.versions, selection.get(document.id)!),
      }))
      .filter((document) => document.shown.length > 0 && documentVisibleAt(document, level))
    const rows = documents.flatMap((document) => document.shown)
    const downloads = await mapWithConcurrency(rows, LISTING_CONCURRENCY, (row) =>
      this.download(row.storageKey, row.filename),
    )
    const downloadOf = new Map(rows.map((row, i) => [row.id, downloads[i]]))
    return documents.map((document) => {
      const numbers = new Map(document.versions.map((v) => [v.id, v.version]))
      const versions = document.shown.map(
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
        ...(owner
          ? {
              selection: selection.has(document.id)
                ? { pinnedVersionId: selection.get(document.id)!.pinnedVersionId }
                : null,
            }
          : {}),
      }
    })
  }

  // The content of one version, if the reader may read it (same rules as the listing): a version that
  // is hidden, not selected for a share recipient, or of another company is reported as not found.
  async readFile(
    dossier: DossierRef,
    level: AccessLevel,
    documentId: string,
    relation: DossierRelation,
  ): Promise<{ document: StoredVersion; content: Buffer }> {
    const row = await this.prisma.document.findFirst({
      where: { id: documentId, companyId: dossier.companyId },
      include: { libraryDocument: { include: { field: { select: { minAccessLevel: true } } } } },
    })
    if (!row || !documentVisibleAt(row.libraryDocument, level)) throw documentNotFound()
    if (relation !== 'owner' && !(await this.isShownToShares(dossier, row))) {
      throw documentNotFound()
    }
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
  // dossier's journal when it changes. Read and written under the profile's lock, like every write
  // of the library and of the selection: once a company changed hands (E05.08), a change its former
  // holder sent is refused, never applied to the new owner's library (code review R57).
  async setType(params: {
    dossier: DossierRef
    documentId: string
    type: DocumentType
    actorId: string
  }): Promise<LibraryDocument & { type: DocumentType }> {
    const { dossier, documentId, type } = params
    const { found, previous, updated } = await this.prisma.$transaction(async (tx) => {
      await lockProfile(tx, dossier)
      const found = await tx.libraryDocument.findFirst({
        where: { id: documentId, companyId: dossier.companyId },
      })
      if (!found) throw documentNotFound()
      const previous = documentTypeOf(found.type)
      if (previous === type) return { found, previous, updated: null }
      const updated = await tx.libraryDocument.update({ where: { id: found.id }, data: { type } })
      return { found, previous, updated }
    })
    if (!updated) return { ...found, type }
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
      await lockProfile(tx, dossier)
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

  // E05.07: the dossier selects a document of its company's library, following its latest version
  // (`pinnedVersionId` null) or pinned to one of its versions; selecting it again changes how.
  // Owner only (the caller checks it), under the profile's lock (R57, see `setType`). Journaled
  // when something changes.
  async select(params: {
    dossier: DossierRef
    documentId: string
    pinnedVersionId: string | null
    actorId: string
    // E05.10: the site, or an AI application on the owner's explicit instruction.
    origin?: ActionOrigin
  }): Promise<DossierDocumentSelected> {
    const { dossier, documentId, pinnedVersionId } = params
    const { document, pinned, before } = await this.prisma.$transaction(async (tx) => {
      await lockProfile(tx, dossier)
      const document = await tx.libraryDocument.findFirst({
        where: { id: documentId, companyId: dossier.companyId },
      })
      if (!document) throw documentNotFound()
      const pinned = pinnedVersionId
        ? await tx.document.findFirst({
            where: { id: pinnedVersionId, libraryDocumentId: document.id },
            select: { id: true, version: true },
          })
        : null
      if (pinnedVersionId && !pinned) throw versionNotFound()
      const key = { dossierId: dossier.id, libraryDocumentId: document.id }
      const before = await tx.dossierDocument.findUnique({
        where: { dossierId_libraryDocumentId: key },
      })
      await tx.dossierDocument.upsert({
        where: { dossierId_libraryDocumentId: key },
        create: { ...key, companyId: dossier.companyId, pinnedVersionId },
        update: { pinnedVersionId },
      })
      return { document, pinned, before }
    })
    if (!before || before.pinnedVersionId !== pinnedVersionId) {
      await this.audit.record({
        actionType: 'dossier_document_selected',
        actorId: params.actorId,
        dossierId: dossier.id,
        metadata: {
          ...originMetadata(params.origin ?? SITE_ORIGIN),
          documentId: document.id,
          filename: document.filename,
          pinnedVersionId,
          pinnedVersion: pinned?.version ?? null,
          previouslySelected: before !== null,
        },
      })
    }
    return { documentId: document.id, pinnedVersionId }
  }

  // The dossier no longer presents the document: its shares stop showing it at the next request.
  // The document stays in the library. Nothing happens for a document the dossier did not select.
  // Under the profile's lock (R57, see `setType`).
  async unselect(params: {
    dossier: DossierRef
    documentId: string
    actorId: string
  }): Promise<void> {
    const { dossier, documentId } = params
    const { document, count } = await this.prisma.$transaction(async (tx) => {
      await lockProfile(tx, dossier)
      const document = await tx.libraryDocument.findFirst({
        where: { id: documentId, companyId: dossier.companyId },
      })
      if (!document) throw documentNotFound()
      const { count } = await tx.dossierDocument.deleteMany({
        where: { dossierId: dossier.id, libraryDocumentId: document.id },
      })
      return { document, count }
    })
    if (count > 0) {
      await this.audit.record({
        actionType: 'dossier_document_unselected',
        actorId: params.actorId,
        dossierId: dossier.id,
        metadata: { documentId: document.id, filename: document.filename },
      })
    }
  }

  private async selectionOf(dossier: DossierRef): Promise<Map<string, Selection>> {
    const rows = await this.prisma.dossierDocument.findMany({
      where: { dossierId: dossier.id, companyId: dossier.companyId },
      select: { libraryDocumentId: true, pinnedVersionId: true },
    })
    return new Map(rows.map((r) => [r.libraryDocumentId, { pinnedVersionId: r.pinnedVersionId }]))
  }

  // Whether a version is the one the dossier shows its share recipients: its document is selected,
  // and the version is the pinned one or, when the document is followed, its latest.
  private async isShownToShares(dossier: DossierRef, version: Document): Promise<boolean> {
    const selected = (await this.selectionOf(dossier)).get(version.libraryDocumentId)
    if (!selected) return false
    if (selected.pinnedVersionId) return selected.pinnedVersionId === version.id
    const latest = await this.prisma.document.findFirst({
      where: { libraryDocumentId: version.libraryDocumentId },
      orderBy: { version: 'desc' },
      select: { id: true },
    })
    return latest?.id === version.id
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

interface Selection {
  pinnedVersionId: string | null
}

// The versions of a selected document a share recipient reads: the pinned one, or the latest
// (versions are ordered newest first). A pinned version that no longer exists shows nothing.
function selectedVersions<T extends { id: string }>(versions: T[], selection: Selection): T[] {
  if (selection.pinnedVersionId) return versions.filter((v) => v.id === selection.pinnedVersionId)
  return versions.slice(0, 1)
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
