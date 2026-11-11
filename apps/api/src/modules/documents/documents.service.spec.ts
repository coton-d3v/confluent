import { HttpException, PayloadTooLargeException } from '@nestjs/common'
import { DocumentsService, sanitizeFilename } from './documents.service'
import type { PrismaService } from '../../prisma/prisma.service'
import type { AuditService } from '../audit/audit.service'
import { createFakePrisma, seedDocument } from '../../testing/fake-prisma'
import {
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

// A dossier and its company, whose library it presents (E05.05, E05.06).
const D1 = { id: 'd-1', companyId: 'c-1' }

async function setup(storage = fakeStorage()) {
  const fake = createFakePrisma()
  await fake.prisma.company.create({
    data: { id: 'c-1', ownerId: 'u-1', name: 'Biosensio', profileVersionId: 'v-1' },
  })
  await fake.prisma.dossier.create({
    data: { ...D1, userId: 'u-1', name: 'Biosensio', slug: 'b', questionnaireVersionId: 'v-1' },
  })
  const audit = { record: jest.fn().mockResolvedValue(undefined) }
  const svc = new DocumentsService(
    fake.prisma as unknown as PrismaService,
    storage,
    audit as unknown as AuditService,
  )
  return { svc, storage, audit, prisma: fake.prisma, table: fake.table }
}

// An attachment field of the profile's version (or of another one), with its read level.
const field = (
  prisma: ReturnType<typeof createFakePrisma>['prisma'],
  id: string,
  minAccessLevel: string,
  { versionId = 'v-1', fieldType = 'file' } = {},
) =>
  prisma.questionnaireField.create({
    data: {
      id,
      versionId,
      sectionId: 's-1',
      key: id,
      label: id,
      fieldType,
      orderIndex: 0,
      minAccessLevel,
    },
  })

describe('DocumentsService.upload', () => {
  it('creates version 1 of a new document, of type `other`, under an opaque key', async () => {
    const { svc, storage, table } = await setup()

    const doc = await svc.upload({ dossier: D1, filename: 'pitch.pdf', buffer: PDF })

    expect(doc).toMatchObject({
      version: 1,
      filename: 'pitch.pdf',
      mimetype: 'application/pdf',
      type: 'other',
      fieldId: null,
      restoredFromVersion: null,
    })
    expect(storage.upload).toHaveBeenCalledWith(
      expect.stringMatching(/^companies\/c-1\/[0-9a-f-]{36}$/),
      PDF,
      'application/pdf',
    )
    expect(table('libraryDocument').get(doc.libraryDocumentId)).toMatchObject({
      companyId: 'c-1',
      filename: 'pitch.pdf',
      fieldId: null,
      type: 'other',
    })
  })

  it('adds a version to the document of the same name, which keeps its type', async () => {
    const { svc, table } = await setup()
    const first = await svc.upload({
      dossier: D1,
      filename: 'pitch.pdf',
      buffer: PDF,
      type: 'pitch_deck',
    })
    await svc.upload({ dossier: D1, filename: 'pitch.pdf', buffer: PDF })
    const third = await svc.upload({
      dossier: D1,
      filename: 'pitch.pdf',
      buffer: PDF,
      type: 'other',
    })

    expect(third).toMatchObject({
      libraryDocumentId: first.libraryDocumentId,
      version: 3,
      type: 'pitch_deck',
    })
    expect(table('libraryDocument').size).toBe(1)
    expect(table('document').size).toBe(3)
  })

  it('stores the type recognised in the content, whatever the file name says', async () => {
    const { svc, storage } = await setup()
    const doc = await svc.upload({ dossier: D1, filename: 'photo.pdf', buffer: PNG })
    expect(doc.mimetype).toBe('image/png')
    expect(storage.upload).toHaveBeenCalledWith(expect.any(String), PNG, 'image/png')
  })

  it('refuses a format that is not accepted with 415, without storing anything', async () => {
    const { svc, storage, table } = await setup()
    const exe = Buffer.from('MZ\x90\x00 program')

    const err = await svc
      .upload({ dossier: D1, filename: 'statuts.pdf', buffer: exe })
      .catch((e: unknown) => e)

    expect(err).toBeInstanceOf(HttpException)
    expect((err as HttpException).getStatus()).toBe(415)
    expect(storage.upload).not.toHaveBeenCalled()
    expect(table('document').size).toBe(0)
    expect(table('libraryDocument').size).toBe(0)
  })

  it('rejects files larger than 20 MB with PayloadTooLargeException', async () => {
    const { svc, storage } = await setup()
    const oversized = Buffer.concat([PDF, Buffer.alloc(21 * 1024 * 1024)])
    await expect(
      svc.upload({ dossier: D1, filename: 'big.pdf', buffer: oversized }),
    ).rejects.toBeInstanceOf(PayloadTooLargeException)
    expect(storage.upload).not.toHaveBeenCalled()
  })

  it('answers 507 when the bucket quota is reached, and records no document', async () => {
    const { svc, table } = await setup(
      fakeStorage({ upload: jest.fn().mockRejectedValue(new StorageQuotaExceededError()) }),
    )

    const err = await svc
      .upload({ dossier: D1, filename: 'bp.pdf', buffer: PDF })
      .catch((e: unknown) => e)

    expect((err as HttpException).getStatus()).toBe(507)
    expect((err as HttpException).getResponse()).toMatchObject({ code: 'STORAGE_FULL' })
    expect(table('document').size).toBe(0)
  })

  it('answers 503 when the storage cannot be reached, and records no document', async () => {
    const { svc, table } = await setup(
      fakeStorage({ upload: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) }),
    )

    const err = await svc
      .upload({ dossier: D1, filename: 'bp.pdf', buffer: PDF })
      .catch((e: unknown) => e)

    expect((err as HttpException).getStatus()).toBe(503)
    expect(table('document').size).toBe(0)
  })

  it('stores under an opaque key, never derived from the client filename', async () => {
    const { svc, storage } = await setup()
    const doc = await svc.upload({
      dossier: D1,
      filename: '../../etc/passwd.txt',
      buffer: Buffer.from('root:x:0:0'),
    })
    const key = storage.upload.mock.calls[0][0] as string
    expect(key).toMatch(/^companies\/c-1\/[0-9a-f-]{36}$/)
    expect(doc).toMatchObject({ filename: 'passwd.txt', version: 1, storageKey: key })
  })

  // R48, E05.06: one document per question (or none) and name within the company, found and
  // numbered under the profile's lock (concurrency: test:pg).
  it('finds the document and numbers the version after locking the profile', async () => {
    const { svc, prisma } = await setup()
    await seedDocument(prisma, { companyId: 'c-1', filename: 'bp.pdf' })
    prisma.libraryDocument.findFirst.mockClear()

    const doc = await svc.upload({ dossier: D1, filename: 'bp.pdf', buffer: PDF })

    expect(doc.version).toBe(2)
    expect(prisma.libraryDocument.findFirst).toHaveBeenCalledWith({
      where: { companyId: 'c-1', fieldId: null, filename: 'bp.pdf' },
    })
    expect(prisma.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      prisma.libraryDocument.findFirst.mock.invocationCallOrder[0],
    )
  })

  it('deletes the stored object when the database write ultimately fails', async () => {
    const { svc, storage, prisma } = await setup()
    prisma.document.create.mockRejectedValueOnce(new Error('db down'))

    await expect(svc.upload({ dossier: D1, filename: 'bp.pdf', buffer: PDF })).rejects.toThrow(
      'db down',
    )
    expect(storage.delete).toHaveBeenCalledWith(storage.upload.mock.calls[0][0])
  })
})

describe('DocumentsService.upload — attachment field (E03.11)', () => {
  it('attaches the document to an attachment field of the company profile’s version', async () => {
    const { svc, prisma } = await setup()
    await field(prisma, 'f-kbis', 'partiel')

    const doc = await svc.upload({
      dossier: D1,
      filename: 'kbis.pdf',
      buffer: PDF,
      fieldId: 'f-kbis',
      type: 'company_registration',
    })

    expect(doc).toMatchObject({ fieldId: 'f-kbis', type: 'company_registration' })
  })

  it.each([
    ['a field that is not an attachment', { fieldType: 'text' }],
    ['an attachment field of another version', { versionId: 'v-0' }],
  ])('refuses %s, before storing anything', async (_case, options) => {
    const { svc, storage, prisma, table } = await setup()
    await field(prisma, 'f-other', 'public', options)

    await expect(
      svc.upload({ dossier: D1, filename: 'kbis.pdf', buffer: PDF, fieldId: 'f-other' }),
    ).rejects.toMatchObject({ status: 400 })
    expect(storage.upload).not.toHaveBeenCalled()
    expect(table('document').size).toBe(0)
  })

  // Code review R48: two questions answered by files of the same name each keep their own document.
  it('keeps files of the same name answering two questions apart, each with its own versions', async () => {
    const { svc, prisma } = await setup()
    await field(prisma, 'f-a', 'public')
    await field(prisma, 'f-b', 'public')
    const a = await svc.upload({ dossier: D1, filename: 'scan.pdf', buffer: PDF, fieldId: 'f-a' })
    const b = await svc.upload({ dossier: D1, filename: 'scan.pdf', buffer: PDF, fieldId: 'f-b' })
    const none = await svc.upload({ dossier: D1, filename: 'scan.pdf', buffer: PDF })
    const a2 = await svc.upload({ dossier: D1, filename: 'scan.pdf', buffer: PDF, fieldId: 'f-a' })

    expect(new Set([a, b, none].map((d) => d.libraryDocumentId)).size).toBe(3)
    expect([a.version, b.version, none.version, a2.version]).toEqual([1, 1, 1, 2])
    expect(a2.libraryDocumentId).toBe(a.libraryDocumentId)
  })
})

describe('DocumentsService.listForDossier', () => {
  it('lists each document with its type and its versions, newest first, signed under its name', async () => {
    const { svc, prisma, storage } = await setup()
    await seedDocument(prisma, {
      companyId: 'c-1',
      filename: 'pitch.pdf',
      type: 'pitch_deck',
      version: 1,
      storageKey: 'k-p1',
    })
    await seedDocument(prisma, {
      companyId: 'c-1',
      filename: 'pitch.pdf',
      version: 3,
      storageKey: 'k-p3',
    })
    await seedDocument(prisma, { companyId: 'c-1', filename: 'deck.pdf', storageKey: 'k-d1' })
    await seedDocument(prisma, { companyId: 'c-other', filename: 'foreign.pdf' })

    const groups = await svc.listForDossier(D1, 'complet')

    expect(groups.map((g) => [g.filename, g.type])).toEqual([
      ['deck.pdf', 'other'],
      ['pitch.pdf', 'pitch_deck'],
    ])
    const pitch = groups[1]
    expect(pitch.id).toEqual(expect.any(String))
    expect(pitch.current).toMatchObject({
      version: 3,
      availability: 'available',
      url: 'memory://k-p3',
      restoredFromVersion: null,
    })
    expect(pitch.versions.map((v) => v.version)).toEqual([3, 1])
    expect(storage.getSignedUrl).toHaveBeenCalledWith('k-p3', {
      filename: 'pitch.pdf',
      ttlSeconds: 900,
    })
  })

  it('says which version a restored version brought back', async () => {
    const { svc, prisma } = await setup()
    const v1 = await seedDocument(prisma, {
      companyId: 'c-1',
      filename: 'bp.pdf',
      storageKey: 'k-1',
    })
    await seedDocument(prisma, {
      companyId: 'c-1',
      filename: 'bp.pdf',
      version: 2,
      storageKey: 'k-2',
    })
    await prisma.document.create({
      data: {
        libraryDocumentId: v1.libraryDocumentId,
        companyId: 'c-1',
        filename: 'bp.pdf',
        version: 3,
        storageKey: 'k-1',
        mimetype: 'application/pdf',
        size: 10,
        restoredFromId: v1.id,
      },
    })

    const [bp] = await svc.listForDossier(D1, 'complet')

    expect(bp.versions.map((v) => [v.version, v.restoredFromVersion, v.url])).toEqual([
      [3, 1, 'memory://k-1'],
      [2, null, 'memory://k-2'],
      [1, null, 'memory://k-1'],
    ])
  })

  it('reports a lost file as missing and an unreachable storage as unavailable, without failing', async () => {
    const { svc, prisma } = await setup(
      fakeStorage({
        getSignedUrl: jest.fn((key: string) => {
          if (key === 'k-lost') return Promise.reject(new StoredObjectMissingError(key))
          if (key === 'k-down') return Promise.reject(new Error('socket hang up'))
          return Promise.resolve(`memory://${key}`)
        }),
      }),
    )
    for (const [filename, storageKey] of [
      ['deck.pdf', 'k-ok'],
      ['pitch.pdf', 'k-lost'],
      ['bp.pdf', 'k-down'],
    ]) {
      await seedDocument(prisma, { companyId: 'c-1', filename, storageKey })
    }

    const byName = Object.fromEntries(
      (await svc.listForDossier(D1, 'complet')).map((g) => [g.filename, g.current]),
    )

    expect(byName['deck.pdf']).toMatchObject({ availability: 'available', url: 'memory://k-ok' })
    expect(byName['pitch.pdf']).toMatchObject({ availability: 'missing', url: null })
    expect(byName['bp.pdf']).toMatchObject({ availability: 'unavailable', url: null })
  })
})

describe('DocumentsService.listForDossier — read levels (E03.11)', () => {
  async function library() {
    const ctx = await setup()
    const { prisma } = ctx
    await field(prisma, 'f-public', 'public')
    await field(prisma, 'f-partial', 'partiel')
    await field(prisma, 'f-full', 'complet')
    await field(prisma, 'f-odd', 'unexpected')
    for (const [filename, fieldId] of [
      ['kbis.pdf', 'f-public'],
      ['bilan.pdf', 'f-partial'],
      ['prev.pdf', 'f-full'],
      ['odd.pdf', 'f-odd'],
      ['annexe.pdf', null],
    ] as const) {
      await seedDocument(prisma, {
        companyId: 'c-1',
        filename,
        fieldId,
        storageKey: `k-${filename}`,
      })
    }
    // Every version of a document has its document's visibility.
    await seedDocument(prisma, {
      companyId: 'c-1',
      filename: 'kbis.pdf',
      fieldId: 'f-public',
      version: 2,
      storageKey: 'k-kbis-2',
    })
    return ctx
  }
  const names = async (level: 'public' | 'partiel' | 'complet') => {
    const { svc, storage } = await library()
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

  it('never signs a URL for a hidden document', async () => {
    const { storage, groups } = await names('public')
    expect(groups[0].versions).toHaveLength(2)
    expect(storage.getSignedUrl.mock.calls.map((c) => c[0]).sort()).toEqual([
      'k-kbis-2',
      'k-kbis.pdf',
    ])
  })

  it('gives each document the question it answers', async () => {
    const { groups } = await names('complet')
    expect(groups.find((g) => g.filename === 'bilan.pdf')).toMatchObject({
      fieldId: 'f-partial',
      current: { fieldId: 'f-partial' },
    })
    expect(groups.find((g) => g.filename === 'annexe.pdf')?.fieldId).toBeNull()
  })

  it('hides a document of the same name answering a question the level may not read', async () => {
    const { svc, prisma, storage } = await setup()
    await field(prisma, 'f-full', 'complet')
    await field(prisma, 'f-public', 'public')
    await seedDocument(prisma, { companyId: 'c-1', filename: 'statuts.pdf', fieldId: 'f-full' })
    await seedDocument(prisma, { companyId: 'c-1', filename: 'statuts.pdf', fieldId: 'f-public' })
    const groups = await svc.listForDossier(D1, 'public')
    expect(groups.map((g) => g.fieldId)).toEqual(['f-public'])
    expect(storage.getSignedUrl).toHaveBeenCalledTimes(1)
  })
})

describe('DocumentsService.readFile (E04.03)', () => {
  it('reads a version of this company the level may read, with its document’s field and type', async () => {
    const { svc, prisma, storage } = await setup()
    await field(prisma, 'f-public', 'public')
    const v = await seedDocument(prisma, {
      companyId: 'c-1',
      filename: 'kbis.pdf',
      fieldId: 'f-public',
      type: 'company_registration',
      storageKey: 'k-kbis',
    })
    const { document, content } = await svc.readFile(D1, 'public', v.id)
    expect(document).toMatchObject({
      filename: 'kbis.pdf',
      fieldId: 'f-public',
      type: 'company_registration',
      restoredFromVersion: null,
    })
    expect(content.toString()).toBe('content of k-kbis')
    expect(storage.read).toHaveBeenCalledWith('k-kbis')
  })

  it('answers not found for a version hidden at this level, or of another company, without reading it', async () => {
    const { svc, prisma, storage } = await setup()
    await field(prisma, 'f-odd', 'unexpected')
    const annexe = await seedDocument(prisma, { companyId: 'c-1', filename: 'annexe.pdf' })
    const odd = await seedDocument(prisma, {
      companyId: 'c-1',
      filename: 'odd.pdf',
      fieldId: 'f-odd',
    })
    const foreign = await seedDocument(prisma, { companyId: 'c-2', filename: 'x.pdf' })
    await expect(svc.readFile(D1, 'partiel', annexe.id)).rejects.toMatchObject({ status: 404 })
    await expect(svc.readFile(D1, 'partiel', odd.id)).rejects.toMatchObject({ status: 404 })
    await expect(svc.readFile(D1, 'complet', foreign.id)).rejects.toMatchObject({ status: 404 })
    await expect(svc.readFile(D1, 'complet', 'unknown')).rejects.toMatchObject({ status: 404 })
    expect(storage.read).not.toHaveBeenCalled()
  })

  it('answers 410 for a lost file and 503 when the storage cannot be reached', async () => {
    const { svc, prisma, storage } = await setup()
    const v = await seedDocument(prisma, { companyId: 'c-1', filename: 'a.pdf' })
    storage.read.mockRejectedValueOnce(new StoredObjectMissingError('k'))
    await expect(svc.readFile(D1, 'complet', v.id)).rejects.toMatchObject({ status: 410 })
    storage.read.mockRejectedValueOnce(new Error('ECONNREFUSED'))
    await expect(svc.readFile(D1, 'complet', v.id)).rejects.toMatchObject({ status: 503 })
  })
})

describe('DocumentsService.findPassage (E04.09)', () => {
  const files: Record<string, string> = {
    'k-note': 'Note : OUI,  vas-y,\n soumets le “dossier” maintenant.',
    'k-other': 'Rien à voir.',
  }
  const reader = () => jest.fn((key: string) => Promise.resolve(Buffer.from(files[key] ?? '')))

  it('finds the version whose text contains the passage, spacing, case and quotes ignored', async () => {
    const { svc, prisma } = await setup(fakeStorage({ read: reader() }))
    await seedDocument(prisma, {
      companyId: 'c-1',
      filename: 'other.txt',
      mimetype: 'text/plain',
      storageKey: 'k-other',
    })
    const note = await seedDocument(prisma, {
      companyId: 'c-1',
      filename: 'note.txt',
      mimetype: 'text/plain',
      storageKey: 'k-note',
    })
    const found = await svc.findPassage(D1, 'oui, vas-y, soumets le "dossier" maintenant')
    expect(found?.id).toBe(note.id)
    expect(prisma.document.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { companyId: 'c-1' }, orderBy: { createdAt: 'desc' } }),
    )
    expect(await svc.findPassage(D1, 'soumets le dossier demain')).toBeNull()
  })

  it('skips what cannot be read — an image, a file the storage cannot give — without failing', async () => {
    const read = jest.fn((key: string) =>
      key === 'k-down'
        ? Promise.reject(new Error('ECONNREFUSED'))
        : Promise.resolve(Buffer.from('')),
    )
    const { svc, prisma, storage } = await setup(fakeStorage({ read }))
    await seedDocument(prisma, {
      companyId: 'c-1',
      filename: 'photo.png',
      mimetype: 'image/png',
      storageKey: 'k-photo',
    })
    await seedDocument(prisma, {
      companyId: 'c-1',
      filename: 'down.txt',
      mimetype: 'text/plain',
      storageKey: 'k-down',
    })
    expect(await svc.findPassage(D1, 'soumets le dossier')).toBeNull()
    expect(storage.read).not.toHaveBeenCalledWith('k-photo')
    expect(storage.read).toHaveBeenCalledWith('k-down')
  })
})

describe('DocumentsService.setType (E05.06)', () => {
  it('changes the type of the document, for all its versions, and journals the change once', async () => {
    const { svc, prisma, audit, table } = await setup()
    const v = await seedDocument(prisma, { companyId: 'c-1', filename: 'statuts.pdf' })
    const params = { dossier: D1, documentId: v.libraryDocumentId as string, actorId: 'u-1' }

    const updated = await svc.setType({ ...params, type: 'articles_of_association' })

    expect(updated).toMatchObject({ id: v.libraryDocumentId, type: 'articles_of_association' })
    expect(table('libraryDocument').get(v.libraryDocumentId as string)?.type).toBe(
      'articles_of_association',
    )
    expect(audit.record).toHaveBeenCalledWith({
      actionType: 'document_type_changed',
      actorId: 'u-1',
      dossierId: 'd-1',
      metadata: {
        documentId: v.libraryDocumentId,
        filename: 'statuts.pdf',
        from: 'other',
        to: 'articles_of_association',
      },
    })
    await svc.setType({ ...params, type: 'articles_of_association' })
    expect(audit.record).toHaveBeenCalledTimes(1)
  })

  it('reads an unknown stored type as `other` (closed by default)', async () => {
    const { svc, prisma } = await setup()
    await seedDocument(prisma, { companyId: 'c-1', filename: 'x.pdf', type: 'legacy' })
    const [listed] = await svc.listForDossier(D1, 'complet')
    expect(listed.type).toBe('other')
  })

  it('answers not found for a document of another company, and changes nothing', async () => {
    const { svc, prisma, audit, table } = await setup()
    const foreign = await seedDocument(prisma, { companyId: 'c-2', filename: 'x.pdf' })
    await expect(
      svc.setType({
        dossier: D1,
        documentId: foreign.libraryDocumentId as string,
        type: 'cap_table',
        actorId: 'u-1',
      }),
    ).rejects.toMatchObject({ status: 404 })
    expect(table('libraryDocument').get(foreign.libraryDocumentId as string)?.type).toBe('other')
    expect(audit.record).not.toHaveBeenCalled()
  })
})

describe('DocumentsService.restoreVersion (E05.06)', () => {
  async function history() {
    const ctx = await setup()
    const v1 = await seedDocument(ctx.prisma, {
      companyId: 'c-1',
      filename: 'bp.pdf',
      type: 'business_plan',
      storageKey: 'k-1',
      size: 11,
    })
    const v2 = await seedDocument(ctx.prisma, {
      companyId: 'c-1',
      filename: 'bp.pdf',
      version: 2,
      storageKey: 'k-2',
      size: 22,
    })
    const restore = (versionId: string, documentId = v1.libraryDocumentId as string) =>
      ctx.svc.restoreVersion({ dossier: D1, documentId, versionId, actorId: 'u-1' })
    return { ...ctx, v1, v2, restore }
  }

  it('adds a new version with the earlier version’s file, leaving every version as it was', async () => {
    const { restore, v1, v2, table, audit, storage } = await history()
    const before = [...table('document').values()].map((r) => ({ ...r }))

    const restored = await restore(v1.id)

    expect(restored).toMatchObject({
      libraryDocumentId: v1.libraryDocumentId,
      version: 3,
      storageKey: 'k-1',
      size: 11,
      filename: 'bp.pdf',
      restoredFromId: v1.id,
      restoredFromVersion: 1,
      type: 'business_plan',
    })
    for (const row of before) expect(table('document').get(row.id)).toEqual(row)
    expect(table('document').size).toBe(3)
    expect(storage.upload).not.toHaveBeenCalled()
    expect(storage.delete).not.toHaveBeenCalled()
    expect(audit.record).toHaveBeenCalledWith({
      actionType: 'document_version_restored',
      actorId: 'u-1',
      dossierId: 'd-1',
      metadata: {
        documentId: v1.libraryDocumentId,
        filename: 'bp.pdf',
        restoredVersionId: v1.id,
        restoredVersion: 1,
        versionId: restored.id,
        version: 3,
      },
    })
    expect(v2.version).toBe(2)
  })

  it('numbers the new version after locking the profile', async () => {
    const { restore, v1, prisma } = await history()
    prisma.document.findFirst.mockClear()
    await restore(v1.id)
    const lock = prisma.$queryRaw.mock.invocationCallOrder[0]
    const reads = prisma.document.findFirst.mock.invocationCallOrder
    // First read: the version asked for (outside the lock); the newest version is read under it.
    expect(lock).toBeLessThan(reads[1])
  })

  it('refuses the version in force, or the one it already brought back, with 409', async () => {
    const { restore, v1, v2, audit } = await history()
    await expect(restore(v2.id)).rejects.toMatchObject({ status: 409 })
    const restored = await restore(v1.id)
    await expect(restore(v1.id)).rejects.toMatchObject({ status: 409 })
    await expect(restore(restored.id)).rejects.toMatchObject({ status: 409 })
    expect(audit.record).toHaveBeenCalledTimes(1)
  })

  it('refuses a lost file with 410 and an unreachable storage with 503, creating nothing', async () => {
    const { restore, v1, storage, table } = await history()
    storage.exists.mockResolvedValueOnce(false)
    await expect(restore(v1.id)).rejects.toMatchObject({ status: 410 })
    storage.exists.mockRejectedValueOnce(new Error('ECONNREFUSED'))
    await expect(restore(v1.id)).rejects.toMatchObject({ status: 503 })
    expect(table('document').size).toBe(2)
  })

  it('answers not found for a version of another document or of another company', async () => {
    const { restore, prisma, v1, table } = await history()
    const other = await seedDocument(prisma, { companyId: 'c-1', filename: 'annexe.pdf' })
    const foreign = await seedDocument(prisma, { companyId: 'c-2', filename: 'bp.pdf' })
    await expect(restore(other.id)).rejects.toMatchObject({ status: 404 })
    await expect(restore(v1.id, other.libraryDocumentId as string)).rejects.toMatchObject({
      status: 404,
    })
    await expect(restore(foreign.id, foreign.libraryDocumentId as string)).rejects.toMatchObject({
      status: 404,
    })
    expect(table('document').size).toBe(4)
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
