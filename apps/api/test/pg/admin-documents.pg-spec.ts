import { randomUUID } from 'node:crypto'
import { AuditService } from '../../src/modules/audit/audit.service'
import { DocumentsService } from '../../src/modules/documents/documents.service'
import { MemoryStorageAdapter } from '../../src/modules/documents/storage/memory-storage.adapter'
import { companyOf, testDatabase } from './database'

// ROADMAP E10.05 on PostgreSQL: a document deposited by an administrator is numbered under the
// profile's lock like the owner's own deposits, and written with its journal entry in one
// transaction — a version never exists without its entry, nor an entry without its version, and the
// stored file is deleted when either fails. HTTP rules: test/admin.e2e-spec.ts.
describe('documents deposited by an administrator (PostgreSQL)', () => {
  const prisma = testDatabase()
  const audit = new AuditService(prisma)
  const storage = new MemoryStorageAdapter()
  const documents = new DocumentsService(prisma, storage, audit)
  const tag = randomUUID().slice(0, 8)
  const PDF = (body: string) => Buffer.from(`%PDF-1.4 ${body}`)
  const userIds: string[] = []
  let formId = ''

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { actorId: { in: userIds } } })
    await prisma.dossier.deleteMany({ where: { userId: { in: userIds } } })
    await prisma.company.deleteMany({ where: { ownerId: { in: userIds } } })
    await prisma.user.deleteMany({ where: { id: { in: userIds } } })
    await prisma.questionnaireVersion.deleteMany({ where: { questionnaireId: formId } })
    await prisma.questionnaire.deleteMany({ where: { id: formId } })
    await prisma.$disconnect()
  })

  async function request() {
    const n = userIds.length
    const owner = await prisma.user.create({
      data: { email: `owner-${n}-${tag}@pg-test.dev`, role: 'entrepreneur' },
    })
    const admin = await prisma.user.create({
      data: { email: `admin-${n}-${tag}@pg-test.dev`, role: 'admin' },
    })
    userIds.push(owner.id, admin.id)
    if (!formId) {
      formId = (
        await prisma.questionnaire.create({ data: { name: 'Profil', slug: `e1005-${tag}` } })
      ).id
    }
    const version =
      (await prisma.questionnaireVersion.findFirst({ where: { questionnaireId: formId } })) ??
      (await prisma.questionnaireVersion.create({
        data: { questionnaireId: formId, version: 1, status: 'published' },
      }))
    const dossier = await prisma.dossier.create({
      data: {
        userId: owner.id,
        companyId: await companyOf(prisma, owner.id, version.id),
        name: 'Recette E10.05',
        slug: `e1005-${n}-${tag}`,
        questionnaireVersionId: version.id,
      },
    })
    return { owner, admin, dossier }
  }

  const entriesOf = (dossierId: string) =>
    prisma.auditLog.findMany({
      where: { dossierId, actionType: 'admin_uploaded_document' },
      orderBy: { createdAt: 'asc' },
    })

  it('numbers simultaneous replacements by the owner and administrators apart, one entry each', async () => {
    const { owner, admin, dossier } = await request()
    const ref = { id: dossier.id, companyId: dossier.companyId }
    await documents.upload({
      dossier: { ...ref, userId: owner.id },
      filename: 'bp.pdf',
      buffer: PDF('v1'),
    })
    const sent = await Promise.all([
      ...Array.from({ length: 3 }, (_, i) =>
        documents.upload({
          dossier: ref,
          filename: 'bp.pdf',
          buffer: PDF(`admin ${i}`),
          byAdministrator: admin.id,
        }),
      ),
      ...Array.from({ length: 3 }, (_, i) =>
        documents.upload({
          dossier: { ...ref, userId: owner.id },
          filename: 'bp.pdf',
          buffer: PDF(`owner ${i}`),
        }),
      ),
    ])
    expect(sent.map((v) => v.version).sort((a, b) => a - b)).toEqual([2, 3, 4, 5, 6, 7])
    const entries = await entriesOf(dossier.id)
    const byAdmin = sent.slice(0, 3)
    expect(
      entries
        .map((e) => {
          const m = e.metadata as { versionId: string; version: number; newDocument: boolean }
          return [m.versionId, m.version, m.newDocument, e.actorId]
        })
        .sort(),
    ).toEqual(byAdmin.map((v) => [v.id, v.version, false, admin.id]).sort())
    // The owner's deposit was selected by the request; the administrators' versions changed nothing.
    expect(await prisma.dossierDocument.count({ where: { dossierId: dossier.id } })).toBe(1)
  })

  it('writes neither the document, the version nor the file when the journal entry fails', async () => {
    const { admin, dossier } = await request()
    const stored = () => (storage as unknown as { store: Map<string, unknown> }).store.size
    const before = stored()
    const recordIn = AuditService.prototype.recordIn
    const spy = jest.spyOn(audit, 'recordIn').mockImplementation(async (tx, entry) => {
      await recordIn.call(audit, tx, entry)
      throw new Error('journal unavailable')
    })
    try {
      await expect(
        documents.upload({
          dossier: { id: dossier.id, companyId: dossier.companyId },
          filename: 'statuts.pdf',
          buffer: PDF('statuts'),
          byAdministrator: admin.id,
        }),
      ).rejects.toThrow('journal unavailable')
    } finally {
      spy.mockRestore()
    }
    expect(await prisma.libraryDocument.count({ where: { companyId: dossier.companyId } })).toBe(0)
    expect(await prisma.document.count({ where: { companyId: dossier.companyId } })).toBe(0)
    expect(await entriesOf(dossier.id)).toEqual([])
    expect(stored()).toBe(before)
  })
})
