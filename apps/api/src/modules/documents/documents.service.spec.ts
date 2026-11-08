import { Test } from '@nestjs/testing'
import { PayloadTooLargeException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { DocumentsService, sanitizeFilename } from './documents.service'
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
          storageKey: expect.stringMatching(/^dossiers\/d-1\/[0-9a-f-]{36}$/),
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

  it('stores under an opaque key, never derived from the client filename', async () => {
    const prisma = {
      document: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(({ data }: { data: object }) => Promise.resolve({ id: 'doc-1', ...data })),
      },
    }
    const storage: StorageAdapter = {
      upload: jest.fn().mockResolvedValue(undefined),
      getSignedUrl: jest.fn(),
      delete: jest.fn(),
    }
    const svc = (await build(storage, prisma)).get(DocumentsService)
    const doc = await svc.upload({
      dossierId: 'd-1',
      filename: '../../etc/passwd',
      mimetype: 'text/plain',
      buffer: Buffer.from('x'),
    })
    const key = (storage.upload as jest.Mock).mock.calls[0][0] as string
    expect(key).toMatch(/^dossiers\/d-1\/[0-9a-f-]{36}$/)
    expect(doc).toMatchObject({ filename: 'passwd', version: 1, storageKey: key })
  })

  it('retries with the next version when a concurrent upload took the same one', async () => {
    const conflict = new Prisma.PrismaClientKnownRequestError('unique', {
      code: 'P2002',
      clientVersion: 'test',
    })
    const prisma = {
      document: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce({ version: 1 })
          .mockResolvedValueOnce({ version: 2 }),
        create: jest
          .fn()
          .mockRejectedValueOnce(conflict)
          .mockImplementation(({ data }: { data: object }) =>
            Promise.resolve({ id: 'doc-3', ...data }),
          ),
      },
    }
    const storage: StorageAdapter = {
      upload: jest.fn().mockResolvedValue(undefined),
      getSignedUrl: jest.fn(),
      delete: jest.fn(),
    }
    const svc = (await build(storage, prisma)).get(DocumentsService)
    const doc = await svc.upload({
      dossierId: 'd-1',
      filename: 'bp.pdf',
      mimetype: 'application/pdf',
      buffer: Buffer.from('x'),
    })
    expect(doc.version).toBe(3)
    expect(storage.delete).not.toHaveBeenCalled()
  })

  it('deletes the stored object when the database write ultimately fails', async () => {
    const prisma = {
      document: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockRejectedValue(new Error('db down')),
      },
    }
    const storage: StorageAdapter = {
      upload: jest.fn().mockResolvedValue(undefined),
      getSignedUrl: jest.fn(),
      delete: jest.fn().mockResolvedValue(undefined),
    }
    const svc = (await build(storage, prisma)).get(DocumentsService)
    await expect(
      svc.upload({
        dossierId: 'd-1',
        filename: 'bp.pdf',
        mimetype: 'application/pdf',
        buffer: Buffer.from('x'),
      }),
    ).rejects.toThrow('db down')
    expect(storage.delete).toHaveBeenCalledWith((storage.upload as jest.Mock).mock.calls[0][0])
  })
})

describe('sanitizeFilename', () => {
  it.each([
    ['rapport.pdf', 'rapport.pdf'],
    ['C:\\Users\\x\\bilan 2025.xlsx', 'bilan 2025.xlsx'],
    ['../secret', 'secret'],
    ['..', 'document'],
    ['a\u0000b\nc', 'abc'],
  ])('%p → %p', (raw, expected) => {
    expect(sanitizeFilename(raw)).toBe(expected)
  })
})
