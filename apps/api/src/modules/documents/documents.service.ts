import { randomUUID } from 'node:crypto'
import { Inject, Injectable, Logger, PayloadTooLargeException } from '@nestjs/common'
import { Prisma, type Document } from '@prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { STORAGE_TOKEN, type StorageAdapter } from './storage/storage.adapter'

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024
const MAX_VERSION_ATTEMPTS = 5

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
  // null when the stored object cannot be reached (e.g. in-memory storage after a restart): the
  // document is still listed, only its download is unavailable.
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

  async upload(params: {
    dossierId: string
    filename: string
    mimetype: string
    buffer: Buffer
  }): Promise<Document> {
    // Normally enforced earlier by the multipart limit; kept for callers other than the controller.
    if (params.buffer.byteLength > MAX_UPLOAD_BYTES) {
      throw new PayloadTooLargeException({
        code: 'PAYLOAD_TOO_LARGE',
        message: 'File exceeds the 20 MB limit.',
      })
    }
    const filename = sanitizeFilename(params.filename)
    // Opaque key: the client-supplied name can neither escape the dossier prefix nor overwrite
    // another version's object.
    const storageKey = `dossiers/${params.dossierId}/${randomUUID()}`
    await this.storage.upload(storageKey, params.buffer, params.mimetype)
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
              mimetype: params.mimetype,
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
    const byName = new Map<string, DocumentVersionView[]>()
    for (const row of rows) {
      const url = await this.signedUrlOrNull(row.storageKey)
      const view: DocumentVersionView = {
        version: row.version,
        url,
        createdAt: row.createdAt,
        mimetype: row.mimetype,
        size: row.size,
      }
      const bucket = byName.get(row.filename) ?? []
      bucket.push(view)
      byName.set(row.filename, bucket)
    }
    return [...byName.entries()].map(([filename, versions]) => ({
      filename,
      current: versions[0],
      versions,
    }))
  }

  // One missing object must not fail the whole listing (and every page that embeds it).
  private async signedUrlOrNull(storageKey: string): Promise<string | null> {
    try {
      return await this.storage.getSignedUrl(storageKey, 900)
    } catch (err) {
      this.logger.warn(`document object unavailable: ${storageKey} (${(err as Error).message})`)
      return null
    }
  }
}
