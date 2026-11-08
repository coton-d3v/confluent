import { Test } from '@nestjs/testing'
import { PayloadTooLargeException } from '@nestjs/common'
import { DocumentsService } from './documents.service'
import { PrismaService } from '../../prisma/prisma.service'
import { STORAGE_TOKEN, type StorageAdapter } from './storage/storage.adapter'

function build(storage: StorageAdapter, prisma: Record<string, unknown>) {
  return Test.createTestingModule({
    providers: [
      DocumentsService,
      { provide: PrismaService, useValue: prisma },
      { provide: STORAGE_TOKEN, useValue: storage },
    ],
  }).compile()
}

describe('DocumentsService', () => {
  it('creates a v1 document on first upload', async () => {
    const prisma = {
      document: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({
          id: 'doc-1',
          version: 1,
          filename: 'pitch.pdf',
          mimetype: 'application/pdf',
          size: 12,
          dossierId: 'd-1',
          storageKey: 'dossiers/d-1/pitch.pdf-v1',
          createdAt: new Date(),
        }),
        findMany: jest.fn(),
      },
    }
    const uploads: unknown[] = []
    const storage: StorageAdapter = {
      upload: jest.fn((...args) => {
        uploads.push(args)
        return Promise.resolve()
      }),
      getSignedUrl: jest.fn(),
      delete: jest.fn(),
    }
    const mod = await build(storage, prisma)
    const svc = mod.get(DocumentsService)

    const buffer = Buffer.from('hello world')
    const result = await svc.upload({
      dossierId: 'd-1',
      filename: 'pitch.pdf',
      mimetype: 'application/pdf',
      buffer,
    })

    expect(result.version).toBe(1)
    expect(prisma.document.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          version: 1,
          storageKey: 'dossiers/d-1/pitch.pdf-v1',
        }),
      }),
    )
    expect(uploads).toHaveLength(1)
  })

  it('bumps the version when a document with the same filename exists', async () => {
    const prisma = {
      document: {
        findFirst: jest.fn().mockResolvedValue({ version: 2 }),
        create: jest.fn().mockResolvedValue({
          id: 'doc-3',
          version: 3,
          filename: 'pitch.pdf',
          storageKey: 'dossiers/d-1/pitch.pdf-v3',
          mimetype: 'application/pdf',
          size: 9,
          dossierId: 'd-1',
          createdAt: new Date(),
        }),
        findMany: jest.fn(),
      },
    }
    const storage: StorageAdapter = {
      upload: jest.fn(),
      getSignedUrl: jest.fn(),
      delete: jest.fn(),
    }
    const mod = await build(storage, prisma)
    const svc = mod.get(DocumentsService)

    const result = await svc.upload({
      dossierId: 'd-1',
      filename: 'pitch.pdf',
      mimetype: 'application/pdf',
      buffer: Buffer.from('abc'),
    })
    expect(result.version).toBe(3)
  })

  it('rejects files larger than 20 MB with PayloadTooLargeException', async () => {
    const prisma = { document: { findFirst: jest.fn(), create: jest.fn(), findMany: jest.fn() } }
    const storage: StorageAdapter = {
      upload: jest.fn(),
      getSignedUrl: jest.fn(),
      delete: jest.fn(),
    }
    const mod = await build(storage, prisma)
    const svc = mod.get(DocumentsService)

    const oversized = Buffer.alloc(21 * 1024 * 1024)
    await expect(
      svc.upload({
        dossierId: 'd-1',
        filename: 'big.bin',
        mimetype: 'application/octet-stream',
        buffer: oversized,
      }),
    ).rejects.toBeInstanceOf(PayloadTooLargeException)
    expect(storage.upload).not.toHaveBeenCalled()
  })

  it('groups listForDossier by filename with signed URLs', async () => {
    const rows = [
      {
        id: 'doc-a3',
        filename: 'pitch.pdf',
        version: 3,
        storageKey: 'dossiers/d-1/pitch.pdf-v3',
        mimetype: 'application/pdf',
        size: 9,
        createdAt: new Date('2026-01-03'),
      },
      {
        id: 'doc-a1',
        filename: 'pitch.pdf',
        version: 1,
        storageKey: 'dossiers/d-1/pitch.pdf-v1',
        mimetype: 'application/pdf',
        size: 10,
        createdAt: new Date('2026-01-01'),
      },
      {
        id: 'doc-b1',
        filename: 'deck.pdf',
        version: 1,
        storageKey: 'dossiers/d-1/deck.pdf-v1',
        mimetype: 'application/pdf',
        size: 15,
        createdAt: new Date('2026-01-02'),
      },
    ]
    const prisma = {
      document: {
        findFirst: jest.fn(),
        create: jest.fn(),
        findMany: jest.fn().mockResolvedValue(rows),
      },
    }
    const storage: StorageAdapter = {
      upload: jest.fn(),
      getSignedUrl: jest.fn((key: string) => Promise.resolve(`memory://${key}`)),
      delete: jest.fn(),
    }
    const mod = await build(storage, prisma)
    const svc = mod.get(DocumentsService)

    const groups = await svc.listForDossier('d-1')
    expect(groups).toHaveLength(2)
    const pitch = groups.find((g) => g.filename === 'pitch.pdf')!
    expect(pitch.current.version).toBe(3)
    expect(pitch.versions.map((v) => v.version)).toEqual([3, 1])
  })

  it('keeps listing when a stored object is gone (url null instead of failing)', async () => {
    const rows = [
      {
        id: 'doc-ok',
        filename: 'deck.pdf',
        version: 1,
        storageKey: 'dossiers/d-1/deck.pdf-v1',
        mimetype: 'application/pdf',
        size: 15,
        createdAt: new Date('2026-01-02'),
      },
      {
        id: 'doc-lost',
        filename: 'pitch.pdf',
        version: 1,
        storageKey: 'dossiers/d-1/pitch.pdf-v1',
        mimetype: 'application/pdf',
        size: 10,
        createdAt: new Date('2026-01-01'),
      },
    ]
    const prisma = { document: { findMany: jest.fn().mockResolvedValue(rows) } }
    const storage: StorageAdapter = {
      upload: jest.fn(),
      // In-memory storage after an API restart: metadata survives in DB, the object does not.
      getSignedUrl: jest.fn((key: string) =>
        key.includes('pitch')
          ? Promise.reject(new Error(`Object not found: ${key}`))
          : Promise.resolve(`memory://${key}`),
      ),
      delete: jest.fn(),
    }
    const svc = (await build(storage, prisma)).get(DocumentsService)

    const groups = await svc.listForDossier('d-1')
    expect(groups.find((g) => g.filename === 'deck.pdf')!.current.url).toBe(
      'memory://dossiers/d-1/deck.pdf-v1',
    )
    expect(groups.find((g) => g.filename === 'pitch.pdf')!.current.url).toBeNull()
  })
})
