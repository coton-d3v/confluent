import { randomUUID } from 'node:crypto'
import {
  HttpException,
  Inject,
  Injectable,
  Logger,
  PayloadTooLargeException,
  ServiceUnavailableException,
  UnsupportedMediaTypeException,
} from '@nestjs/common'
import { Prisma, type Document } from '@prisma/client'
import {
  ACCEPTED_DOCUMENT_FORMATS_LABEL,
  MAX_DOCUMENT_BYTES,
  type DocumentAvailability,
} from '@confluent/shared'
import { PrismaService } from '../../prisma/prisma.service'
import { detectDocumentType } from './document-types'
import {
  MAX_SIGNED_URL_SECONDS,
  STORAGE_TOKEN,
  StorageQuotaExceededError,
  StoredObjectMissingError,
  type StorageAdapter,
} from './storage/storage.adapter'

export const MAX_UPLOAD_BYTES = MAX_DOCUMENT_BYTES
const MAX_VERSION_ATTEMPTS = 5
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
  version: number
  // `missing`: the file is lost and must be uploaded again; `unavailable`: the storage could not be
  // reached right now. In both cases the document is still listed, without a download URL.
  availability: DocumentAvailability
  url: string | null
  createdAt: Date
  mimetype: string
  size: number
}

export interface DocumentGroup {
  filename: string
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
  async upload(params: { dossierId: string; filename: string; buffer: Buffer }): Promise<Document> {
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
    // Opaque key: the client-supplied name can neither escape the dossier prefix nor overwrite
    // another version's object.
    const storageKey = `dossiers/${params.dossierId}/${randomUUID()}`
    await this.store(storageKey, params.buffer, mimetype)
    try {
      // Two uploads of the same name can race for the same version: the unique index
      // (dossier, filename, version) makes the loser retry with the next number.
      for (let attempt = 1; ; attempt++) {
        const previous = await this.prisma.document.findFirst({
          where: { dossierId: params.dossierId, filename },
          orderBy: { version: 'desc' },
          select: { version: true },
        })
        try {
          return await this.prisma.document.create({
            data: {
              dossierId: params.dossierId,
              filename,
              mimetype,
              storageKey,
              size: params.buffer.byteLength,
              version: (previous?.version ?? 0) + 1,
            },
          })
        } catch (err) {
          const conflict =
            err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
          if (!conflict || attempt >= MAX_VERSION_ATTEMPTS) throw err
        }
      }
    } catch (err) {
      await this.storage.delete(storageKey).catch(() => undefined)
      throw err
    }
  }

  async listForDossier(dossierId: string): Promise<DocumentGroup[]> {
    const rows = await this.prisma.document.findMany({
      where: { dossierId },
      orderBy: [{ filename: 'asc' }, { version: 'desc' }],
    })
    const downloads = await mapWithConcurrency(rows, LISTING_CONCURRENCY, (row) =>
      this.download(row.storageKey, row.filename),
    )
    const byName = new Map<string, DocumentVersionView[]>()
    rows.forEach((row, i) => {
      const view: DocumentVersionView = {
        version: row.version,
        ...downloads[i],
        createdAt: row.createdAt,
        mimetype: row.mimetype,
        size: row.size,
      }
      const bucket = byName.get(row.filename) ?? []
      bucket.push(view)
      byName.set(row.filename, bucket)
    })
    return [...byName.entries()].map(([filename, versions]) => ({
      filename,
      current: versions[0],
      versions,
    }))
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
