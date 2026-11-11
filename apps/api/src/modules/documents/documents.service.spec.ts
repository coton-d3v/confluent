import { Test } from '@nestjs/testing'
import { HttpException, PayloadTooLargeException } from '@nestjs/common'
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
    read: jest.fn((key: string) => Promise.resolve(Buffer.from(`content of ${key}`))),
    exists: jest.fn().mockResolvedValue(true),
    delete: jest.fn().mockResolvedValue(undefined),
    check: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  } satisfies StorageAdapter
}

// A dossier and its company, whose documents it presents (E05.05).
const D1 = { id: 'd-1', companyId: 'c-1' }

// The version is chosen inside a transaction holding the profile's lock (`$queryRaw`).
function creatingPrisma(previous: { version: number } | null = null) {
  const prisma: {
    $queryRaw: jest.Mock
    $transaction: jest.Mock
    dossier: { findUnique: jest.Mock }
    document: { findFirst: jest.Mock; create: jest.Mock; findMany: jest.Mock }
  } = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    $transaction: jest.fn((fn: (tx: unknown) => Promise<unknown>): Promise<unknown> => fn(prisma)),
    dossier: {
      findUnique: jest.fn().mockResolvedValue({ ...D1, questionnaireVersionId: 'v-1' }),
    },
    document: {
      findFirst: jest.fn().mockResolvedValue(previous),
      create: jest.fn(({ data }: { data: object }) =>
        Promise.resolve({ id: 'doc-1', createdAt: new Date(), ...data }),
      ),
      findMany: jest.fn(),
    },
  }
  return prisma
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

const row = (
  filename: string,
  version: number,
  storageKey: string,
  field: { id: string; minAccessLevel: string } | null = null,
) => ({
  id: `${filename}-${version}`,
  filename,
  version,
  storageKey,
  mimetype: 'application/pdf',
  size: 10,
  createdAt: new Date(`2026-01-0${version}`),
  fieldId: field?.id ?? null,
  field: field ? { minAccessLevel: field.minAccessLevel } : null,
})

describe('DocumentsService.upload', () => {
  it('creates a v1 document under an opaque key', async () => {
    const prisma = creatingPrisma()
    const storage = fakeStorage()
    const svc = await build(storage, prisma)

    const doc = await svc.upload({ dossier: D1, filename: 'pitch.pdf', buffer: PDF })

    expect(doc).toMatchObject({ version: 1, filename: 'pitch.pdf', mimetype: 'application/pdf' })
    expect(storage.upload).toHaveBeenCalledWith(
      expect.stringMatching(/^companies\/c-1\/[0-9a-f-]{36}$/),
      PDF,
      'application/pdf',
    )
  })

  it('bumps the version when a document with the same filename exists', async () => {
    const svc = await build(fakeStorage(), creatingPrisma({ version: 2 }))
    const doc = await svc.upload({ dossier: D1, filename: 'pitch.pdf', buffer: PDF })
    expect(doc.version).toBe(3)
  })

  it('stores the type recognised in the content, whatever the file name says', async () => {
    const storage = fakeStorage()
    const svc = await build(storage, creatingPrisma())
    const doc = await svc.upload({ dossier: D1, filename: 'photo.pdf', buffer: PNG })
    expect(doc.mimetype).toBe('image/png')
    expect(storage.upload).toHaveBeenCalledWith(expect.any(String), PNG, 'image/png')
  })

  it('refuses a format that is not accepted with 415, without storing anything', async () => {
    const prisma = creatingPrisma()
    const storage = fakeStorage()
    const svc = await build(storage, prisma)
    const exe = Buffer.from('MZ\x90\x00 program')

    const err = await svc
      .upload({ dossier: D1, filename: 'statuts.pdf', buffer: exe })
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
      svc.upload({ dossier: D1, filename: 'big.pdf', buffer: oversized }),
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
      .upload({ dossier: D1, filename: 'bp.pdf', buffer: PDF })
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
      .upload({ dossier: D1, filename: 'bp.pdf', buffer: PDF })
      .catch((e: unknown) => e)

    expect((err as HttpException).getStatus()).toBe(503)
    expect(prisma.document.create).not.toHaveBeenCalled()
  })

  it('stores under an opaque key, never derived from the client filename', async () => {
    const storage = fakeStorage()
    const svc = await build(storage, creatingPrisma())
    const doc = await svc.upload({
      dossier: D1,
      filename: '../../etc/passwd.txt',
      buffer: Buffer.from('root:x:0:0'),
    })
    const key = storage.upload.mock.calls[0][0] as string
    expect(key).toMatch(/^companies\/c-1\/[0-9a-f-]{36}$/)
    expect(doc).toMatchObject({ filename: 'passwd.txt', version: 1, storageKey: key })
  })

  // R48: numbered per question (or none) within the company, under the profile's lock
  // (concurrency: test:pg).
  it('numbers versions per question and file name, after locking the profile', async () => {
    const prisma = creatingPrisma({ version: 1 })
    const svc = await build(fakeStorage(), prisma)

    const doc = await svc.upload({ dossier: D1, filename: 'bp.pdf', buffer: PDF })

    expect(doc.version).toBe(2)
    expect(prisma.document.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { companyId: 'c-1', fieldId: null, filename: 'bp.pdf' } }),
    )
    expect(prisma.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      prisma.document.findFirst.mock.invocationCallOrder[0],
    )
  })

  it('deletes the stored object when the database write ultimately fails', async () => {
    const prisma = creatingPrisma()
    prisma.document.create.mockRejectedValue(new Error('db down'))
    const storage = fakeStorage()
    const svc = await build(storage, prisma)

    await expect(svc.upload({ dossier: D1, filename: 'bp.pdf', buffer: PDF })).rejects.toThrow(
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

    const groups = await svc.listForDossier(D1, 'complet')

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
      (await svc.listForDossier(D1, 'complet')).map((g) => [g.filename, g.current]),
    )

    expect(byName['deck.pdf']).toMatchObject({ availability: 'available', url: 'memory://k-ok' })
    expect(byName['pitch.pdf']).toMatchObject({ availability: 'missing', url: null })
    expect(byName['bp.pdf']).toMatchObject({ availability: 'unavailable', url: null })
  })
})

describe('DocumentsService.listForDossier — read levels (E03.11)', () => {
  const publicField = { id: 'f-public', minAccessLevel: 'public' }
  const partialField = { id: 'f-partial', minAccessLevel: 'partiel' }
  const fullField = { id: 'f-full', minAccessLevel: 'complet' }
  const oddField = { id: 'f-odd', minAccessLevel: 'unexpected' }
  const rows = [
    row('kbis.pdf', 1, 'k-kbis', publicField),
    row('bilan.pdf', 1, 'k-bilan', partialField),
    row('prev.pdf', 1, 'k-prev', fullField),
    row('odd.pdf', 1, 'k-odd', oddField),
    row('annexe.pdf', 1, 'k-annexe'),
  ]
  const names = async (level: 'public' | 'partiel' | 'complet') => {
    const storage = fakeStorage()
    const svc = await build(storage, { document: { findMany: jest.fn().mockResolvedValue(rows) } })
    const groups = await svc.listForDossier(D1, level)
    return { names: groups.map((g) => g.filename).sort(), storage, groups }
  }

  it('shows an attachment at its field level and other documents only at complet', async () => {
    expect((await names('public')).names).toEqual(['kbis.pdf'])
    expect((await names('partiel')).names).toEqual(['bilan.pdf', 'kbis.pdf'])
    expect((await names('complet')).names).toEqual([
      'annexe.pdf',
      'bilan.pdf',
      'kbis.pdf',
      'odd.pdf',
      'prev.pdf',
    ])
  })

  it('never signs a URL for a hidden version', async () => {
    const { storage } = await names('public')
    expect(storage.getSignedUrl).toHaveBeenCalledTimes(1)
    expect(storage.getSignedUrl).toHaveBeenCalledWith('k-kbis', expect.anything())
  })

  it('gives each document the question it answers', async () => {
    const { groups } = await names('complet')
    expect(groups.find((g) => g.filename === 'bilan.pdf')).toMatchObject({
      fieldId: 'f-partial',
      current: { fieldId: 'f-partial' },
    })
    expect(groups.find((g) => g.filename === 'annexe.pdf')?.fieldId).toBeNull()
  })

  // Code review R48: two questions answered by files of the same name each keep their own file.
  it('keeps files of the same name answering two questions apart, each with its own versions', async () => {
    const svc = await build(fakeStorage(), {
      document: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            row('kbis.pdf', 1, 'k-a', publicField),
            row('kbis.pdf', 1, 'k-b', partialField),
            row('kbis.pdf', 2, 'k-c'),
            row('kbis.pdf', 1, 'k-d'),
          ]),
      },
    })
    const groups = await svc.listForDossier(D1, 'complet')
    expect(groups.map((g) => [g.fieldId, g.filename, g.versions.map((v) => v.version)])).toEqual([
      ['f-public', 'kbis.pdf', [1]],
      ['f-partial', 'kbis.pdf', [1]],
      [null, 'kbis.pdf', [2, 1]],
    ])
  })

  it('hides a document of the same name answering a question the level may not read', async () => {
    const mixed = [
      row('statuts.pdf', 1, 'k-s-full', fullField),
      row('statuts.pdf', 1, 'k-s-public', publicField),
    ]
    const storage = fakeStorage()
    const svc = await build(storage, {
      document: { findMany: jest.fn().mockResolvedValue(mixed) },
    })
    const groups = await svc.listForDossier(D1, 'public')
    expect(groups.map((g) => g.fieldId)).toEqual(['f-public'])
    expect(storage.getSignedUrl).toHaveBeenCalledTimes(1)
  })
})

describe('DocumentsService.readFile (E04.03)', () => {
  const readable = async (level: 'public' | 'partiel' | 'complet', found: object | null) => {
    const storage = fakeStorage()
    const findFirst = jest.fn().mockResolvedValue(found)
    const svc = await build(storage, { document: { findFirst } })
    return { svc, storage, findFirst, read: () => svc.readFile(D1, level, 'doc-1') }
  }

  it('reads a version of this dossier the level may read', async () => {
    const { read, findFirst, storage } = await readable(
      'public',
      row('kbis.pdf', 1, 'k-kbis', { id: 'f-public', minAccessLevel: 'public' }),
    )
    const { document, content } = await read()
    expect(document.filename).toBe('kbis.pdf')
    expect(content.toString()).toBe('content of k-kbis')
    expect(storage.read).toHaveBeenCalledWith('k-kbis')
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'doc-1', companyId: 'c-1' } }),
    )
  })

  it('answers not found for a version hidden at this level, or of another dossier, without reading it', async () => {
    const hidden = await readable('partiel', row('annexe.pdf', 1, 'k-annexe'))
    await expect(hidden.read()).rejects.toMatchObject({ status: 404 })
    expect(hidden.storage.read).not.toHaveBeenCalled()
    const odd = await readable(
      'partiel',
      row('odd.pdf', 1, 'k-odd', { id: 'f-odd', minAccessLevel: 'unexpected' }),
    )
    await expect(odd.read()).rejects.toMatchObject({ status: 404 })
    await expect((await readable('complet', null)).read()).rejects.toMatchObject({ status: 404 })
  })

  it('answers 410 for a lost file and 503 when the storage cannot be reached', async () => {
    const lost = await readable('complet', row('a.pdf', 1, 'k-lost'))
    lost.storage.read.mockRejectedValue(new StoredObjectMissingError('k-lost'))
    await expect(lost.read()).rejects.toMatchObject({ status: 410 })
    const down = await readable('complet', row('a.pdf', 1, 'k-down'))
    down.storage.read.mockRejectedValue(new Error('ECONNREFUSED'))
    await expect(down.read()).rejects.toMatchObject({ status: 503 })
  })
})

describe('DocumentsService.findPassage (E04.09)', () => {
  const doc = (id: string, mimetype: string, storageKey: string) => ({
    ...row(`${id}.txt`, 1, storageKey),
    id,
    mimetype,
  })
  const files: Record<string, string> = {
    'k-note': 'Note : OUI,  vas-y,\n soumets le “dossier” maintenant.',
    'k-other': 'Rien à voir.',
  }

  async function finder(rows: object[], read?: jest.Mock) {
    const storage = fakeStorage({
      read: read ?? jest.fn((key: string) => Promise.resolve(Buffer.from(files[key] ?? ''))),
    })
    const findMany = jest.fn().mockResolvedValue(rows)
    const svc = await build(storage, { document: { findMany } })
    return { svc, storage, findMany }
  }

  it('finds the version whose text contains the passage, spacing, case and quotes ignored', async () => {
    const { svc, findMany } = await finder([
      doc('other', 'text/plain', 'k-other'),
      doc('note', 'text/plain', 'k-note'),
    ])
    const found = await svc.findPassage(D1, 'oui, vas-y, soumets le "dossier" maintenant')
    expect(found?.id).toBe('note')
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { companyId: 'c-1' }, orderBy: { createdAt: 'desc' } }),
    )
    expect(await svc.findPassage(D1, 'soumets le dossier demain')).toBeNull()
  })

  it('skips what cannot be read — an image, a file the storage cannot give — without failing', async () => {
    const read = jest.fn((key: string) =>
      key === 'k-down'
        ? Promise.reject(new Error('ECONNREFUSED'))
        : Promise.resolve(Buffer.from(files[key] ?? '')),
    )
    const { svc, storage } = await finder(
      [doc('photo', 'image/png', 'k-photo'), doc('down', 'text/plain', 'k-down')],
      read,
    )
    expect(await svc.findPassage(D1, 'soumets le dossier')).toBeNull()
    expect(storage.read).not.toHaveBeenCalledWith('k-photo')
    expect(storage.read).toHaveBeenCalledWith('k-down')
  })
})

describe('DocumentsService.upload — attachment field (E03.11)', () => {
  function attachingPrisma(field: { id: string } | null) {
    return {
      ...creatingPrisma(),
      // The company's profile version (E05.05).
      company: {
        findUnique: jest.fn().mockResolvedValue({ profileVersionId: 'v-1' }),
      },
      questionnaireField: { findFirst: jest.fn().mockResolvedValue(field) },
    }
  }

  it('attaches the document to an attachment field of the company profile’s version', async () => {
    const prisma = attachingPrisma({ id: 'f-kbis' })
    const svc = await build(fakeStorage(), prisma)

    const doc = await svc.upload({
      dossier: D1,
      filename: 'kbis.pdf',
      buffer: PDF,
      fieldId: 'f-kbis',
    })

    expect(doc.fieldId).toBe('f-kbis')
    expect(prisma.questionnaireField.findFirst).toHaveBeenCalledWith({
      where: { id: 'f-kbis', versionId: 'v-1', fieldType: 'file' },
      select: { id: true },
    })
  })

  it('refuses a field that is not an attachment field of this dossier, before storing anything', async () => {
    const storage = fakeStorage()
    const prisma = attachingPrisma(null)
    const svc = await build(storage, prisma)

    await expect(
      svc.upload({ dossier: D1, filename: 'kbis.pdf', buffer: PDF, fieldId: 'f-other' }),
    ).rejects.toMatchObject({ status: 400 })
    expect(storage.upload).not.toHaveBeenCalled()
    expect(prisma.document.create).not.toHaveBeenCalled()
  })

  it('keeps a document uploaded without field unattached', async () => {
    const prisma = creatingPrisma()
    const svc = await build(fakeStorage(), prisma)
    const doc = await svc.upload({ dossier: D1, filename: 'annexe.pdf', buffer: PDF })
    expect(doc.fieldId).toBeNull()
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
