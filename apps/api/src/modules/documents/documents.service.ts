import { Inject, Injectable, Logger, PayloadTooLargeException } from '@nestjs/common'
import type { Document } from '@prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { STORAGE_TOKEN, type StorageAdapter } from './storage/storage.adapter'

const MAX_BYTES = 20 * 1024 * 1024

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
    if (params.buffer.byteLength > MAX_BYTES) {
      throw new PayloadTooLargeException({
        code: 'PAYLOAD_TOO_LARGE',
        message: 'File exceeds the 20 MB limit.',
      })
    }
    const previous = await this.prisma.document.findFirst({
      where: { dossierId: params.dossierId, filename: params.filename },
      orderBy: { version: 'desc' },
      select: { version: true },
    })
    const nextVersion = (previous?.version ?? 0) + 1
    const storageKey = `dossiers/${params.dossierId}/${params.filename}-v${nextVersion}`
    await this.storage.upload(storageKey, params.buffer, params.mimetype)
    return this.prisma.document.create({
      data: {
        dossierId: params.dossierId,
        filename: params.filename,
        mimetype: params.mimetype,
        storageKey,
        size: params.buffer.byteLength,
        version: nextVersion,
      },
    })
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
