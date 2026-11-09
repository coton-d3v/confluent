import { Test } from '@nestjs/testing'
import { HttpException, PayloadTooLargeException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { DocumentsService, sanitizeFilename } from './documents.service'
import { PrismaService } from '../../prisma/prisma.service'
import {
  STORAGE_TOKEN,
  StorageQuotaExceededError,
  StoredObjectMissingError,
  type StorageAdapter,
} from './storage/storage.adapter'

const PDF = Buffer.from('%PDF-1.4 test')
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0])

function fakeStorage(overrides: Partial<Record<keyof StorageAdapter, jest.Mock>> = {}) {
  return {
    upload: jest.fn().mockResolvedValue(undefined),
    getSignedUrl: jest.fn((key: string) => Promise.resolve(`memory://${key}`)),
    exists: jest.fn().mockResolvedValue(true),
    delete: jest.fn().mockResolvedValue(undefined),
    check: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  } satisfies StorageAdapter
}

function creatingPrisma(previous: { version: number } | null = null) {
  return {
    document: {
      findFirst: jest.fn().mockResolvedValue(previous),
      create: jest.fn(({ data }: { data: object }) =>
        Promise.resolve({ id: 'doc-1', createdAt: new Date(), ...data }),
      ),
      findMany: jest.fn(),
    },
  }
}

async function build(storage: StorageAdapter, prisma: Record<string, unknown>) {
  const mod = await Test.createTestingModule({
    providers: [
      DocumentsService,
      { provide: PrismaService, useValue: prisma },
      { provide: STORAGE_TOKEN, useValue: storage },
    ],
  }).compile()
  return mod.get(DocumentsService)
}

const row = (filename: string, version: number, storageKey: string) => ({
  id: `${filename}-${version}`,
  filename,
  version,
  storageKey,
  mimetype: 'application/pdf',
  size: 10,
  createdAt: new Date(`2026-01-0${version}`),
})

describe('DocumentsService.upload', () => {
  it('creates a v1 document under an opaque key', async () => {
    const prisma = creatingPrisma()
    const storage = fakeStorage()
    const svc = await build(storage, prisma)

    const doc = await svc.upload({ dossierId: 'd-1', filename: 'pitch.pdf', buffer: PDF })

    expect(doc).toMatchObject({ version: 1, filename: 'pitch.pdf', mimetype: 'application/pdf' })
    expect(storage.upload).toHaveBeenCalledWith(
      expect.stringMatching(/^dossiers\/d-1\/[0-9a-f-]{36}$/),
      PDF,
      'application/pdf',
    )
  })

  it('bumps the version when a document with the same filename exists', async () => {
    const svc = await build(fakeStorage(), creatingPrisma({ version: 2 }))
    const doc = await svc.upload({ dossierId: 'd-1', filename: 'pitch.pdf', buffer: PDF })
    expect(doc.version).toBe(3)
  })

  it('stores the type recognised in the content, whatever the file name says', async () => {
    const storage = fakeStorage()
    const svc = await build(storage, creatingPrisma())
    const doc = await svc.upload({ dossierId: 'd-1', filename: 'photo.pdf', buffer: PNG })
    expect(doc.mimetype).toBe('image/png')
    expect(storage.upload).toHaveBeenCalledWith(expect.any(String), PNG, 'image/png')
  })

  it('refuses a format that is not accepted with 415, without storing anything', async () => {
    const prisma = creatingPrisma()
    const storage = fakeStorage()
    const svc = await build(storage, prisma)
    const exe = Buffer.from('MZ\x90\x00 program')

    const err = await svc
      .upload({ dossierId: 'd-1', filename: 'statuts.pdf', buffer: exe })
      .catch((e: unknown) => e)

    expect(err).toBeInstanceOf(HttpException)
    expect((err as HttpException).getStatus()).toBe(415)
    expect(storage.upload).not.toHaveBeenCalled()
    expect(prisma.document.create).not.toHaveBeenCalled()
  })

  it('rejects files larger than 20 MB with PayloadTooLargeException', async () => {
    const storage = fakeStorage()
    const svc = await build(storage, creatingPrisma())
    const oversized = Buffer.concat([PDF, Buffer.alloc(21 * 1024 * 1024)])
    await expect(
      svc.upload({ dossierId: 'd-1', filename: 'big.pdf', buffer: oversized }),
    ).rejects.toBeInstanceOf(PayloadTooLargeException)
    expect(storage.upload).not.toHaveBeenCalled()
  })

  it('answers 507 when the bucket quota is reached, and records no document', async () => {
    const prisma = creatingPrisma()
    const storage = fakeStorage({
      upload: jest.fn().mockRejectedValue(new StorageQuotaExceededError()),
    })
    const svc = await build(storage, prisma)

    const err = await svc
      .upload({ dossierId: 'd-1', filename: 'bp.pdf', buffer: PDF })
      .catch((e: unknown) => e)

    expect((err as HttpException).getStatus()).toBe(507)
    expect((err as HttpException).getResponse()).toMatchObject({ code: 'STORAGE_FULL' })
    expect(prisma.document.create).not.toHaveBeenCalled()
  })

  it('answers 503 when the storage cannot be reached, and records no document', async () => {
    const prisma = creatingPrisma()
    const storage = fakeStorage({ upload: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) })
    const svc = await build(storage, prisma)

    const err = await svc
      .upload({ dossierId: 'd-1', filename: 'bp.pdf', buffer: PDF })
      .catch((e: unknown) => e)

    expect((err as HttpException).getStatus()).toBe(503)
    expect(prisma.document.create).not.toHaveBeenCalled()
  })

  it('stores under an opaque key, never derived from the client filename', async () => {
    const storage = fakeStorage()
    const svc = await build(storage, creatingPrisma())
    const doc = await svc.upload({
      dossierId: 'd-1',
      filename: '../../etc/passwd.txt',
      buffer: Buffer.from('root:x:0:0'),
    })
    const key = storage.upload.mock.calls[0][0] as string
    expect(key).toMatch(/^dossiers\/d-1\/[0-9a-f-]{36}$/)
    expect(doc).toMatchObject({ filename: 'passwd.txt', version: 1, storageKey: key })
  })

  it('retries with the next version when a concurrent upload took the same one', async () => {
    const conflict = new Prisma.PrismaClientKnownRequestError('unique', {
      code: 'P2002',
      clientVersion: 'test',
    })
    const prisma = creatingPrisma()
    prisma.document.findFirst
      .mockResolvedValueOnce({ version: 1 })
      .mockResolvedValueOnce({ version: 2 })
    prisma.document.create.mockRejectedValueOnce(conflict)
    const storage = fakeStorage()
    const svc = await build(storage, prisma)

    const doc = await svc.upload({ dossierId: 'd-1', filename: 'bp.pdf', buffer: PDF })
    expect(doc.version).toBe(3)
    expect(storage.delete).not.toHaveBeenCalled()
  })

  it('deletes the stored object when the database write ultimately fails', async () => {
    const prisma = creatingPrisma()
    prisma.document.create.mockRejectedValue(new Error('db down'))
    const storage = fakeStorage()
    const svc = await build(storage, prisma)

    await expect(svc.upload({ dossierId: 'd-1', filename: 'bp.pdf', buffer: PDF })).rejects.toThrow(
      'db down',
    )
    expect(storage.delete).toHaveBeenCalledWith(storage.upload.mock.calls[0][0])
  })
})

describe('DocumentsService.listForDossier', () => {
  it('groups by filename, newest version first, with download URLs under the original name', async () => {
    const rows = [
      row('pitch.pdf', 3, 'k-p3'),
      row('pitch.pdf', 1, 'k-p1'),
      row('deck.pdf', 1, 'k-d1'),
    ]
    const storage = fakeStorage()
    const svc = await build(storage, { document: { findMany: jest.fn().mockResolvedValue(rows) } })

    const groups = await svc.listForDossier('d-1')

    const pitch = groups.find((g) => g.filename === 'pitch.pdf')!
    expect(groups).toHaveLength(2)
    expect(pitch.current).toMatchObject({
      version: 3,
      availability: 'available',
      url: 'memory://k-p3',
    })
    expect(pitch.versions.map((v) => v.version)).toEqual([3, 1])
    expect(storage.getSignedUrl).toHaveBeenCalledWith('k-p3', {
      filename: 'pitch.pdf',
      ttlSeconds: 900,
    })
  })

  it('reports a lost file as missing and an unreachable storage as unavailable, without failing', async () => {
    const rows = [
      row('deck.pdf', 1, 'k-ok'),
      row('pitch.pdf', 1, 'k-lost'),
      row('bp.pdf', 1, 'k-down'),
    ]
    const storage = fakeStorage({
      getSignedUrl: jest.fn((key: string) => {
        if (key === 'k-lost') return Promise.reject(new StoredObjectMissingError(key))
        if (key === 'k-down') return Promise.reject(new Error('socket hang up'))
        return Promise.resolve(`memory://${key}`)
      }),
    })
    const svc = await build(storage, { document: { findMany: jest.fn().mockResolvedValue(rows) } })

    const byName = Object.fromEntries(
      (await svc.listForDossier('d-1')).map((g) => [g.filename, g.current]),
    )

    expect(byName['deck.pdf']).toMatchObject({ availability: 'available', url: 'memory://k-ok' })
    expect(byName['pitch.pdf']).toMatchObject({ availability: 'missing', url: null })
    expect(byName['bp.pdf']).toMatchObject({ availability: 'unavailable', url: null })
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
