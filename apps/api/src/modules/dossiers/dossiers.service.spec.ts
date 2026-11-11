import { Test } from '@nestjs/testing'
import { NotFoundException } from '@nestjs/common'
import { DossiersService } from './dossiers.service'
import { AuditService } from '../audit/audit.service'
import { PrismaService } from '../../prisma/prisma.service'
import { QuestionnairesService } from '../questionnaires/questionnaires.service'
import { DEFAULT_CLASSIFICATION_RULES } from '../../testing/classification-rules.fixture'
import { ClassificationService } from '../classification/classification.service'

interface PrismaMock {
  dossier: {
    create: jest.Mock
    findMany: jest.Mock
    findUnique: jest.Mock
    update: jest.Mock
    delete: jest.Mock
  }
  questionnaireVersion: {
    findFirst: jest.Mock
    create: jest.Mock
  }
  shareLink: { findMany: jest.Mock }
  questionnaireField: { findMany: jest.Mock }
  classificationRule: { findMany: jest.Mock }
}

function buildPrisma(): PrismaMock {
  return {
    dossier: {
      create: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn().mockResolvedValue({}),
    },
    questionnaireVersion: {
      findFirst: jest.fn().mockResolvedValue({ id: 'qv-1', version: 1 }),
      create: jest.fn().mockResolvedValue({ id: 'qv-1', version: 1 }),
    },
    shareLink: { findMany: jest.fn().mockResolvedValue([]) },
    questionnaireField: { findMany: jest.fn().mockResolvedValue([]) },
    classificationRule: { findMany: jest.fn().mockResolvedValue(DEFAULT_CLASSIFICATION_RULES) },
  }
}

async function instantiate(
  prisma: PrismaMock,
  ensureBootstrap: jest.Mock = jest.fn().mockResolvedValue({ id: 'qv-1', version: 1 }),
): Promise<DossiersService> {
  const moduleRef = await Test.createTestingModule({
    providers: [
      DossiersService,
      { provide: PrismaService, useValue: prisma },
      {
        provide: QuestionnairesService,
        useValue: {
          ensureBootstrap,
          getVersion: jest.fn().mockResolvedValue(null),
        },
      },
      {
        provide: ClassificationService,
        useValue: {
          classify: jest.fn().mockResolvedValue({ sector: null, maturityStage: null }),
        },
      },
      { provide: AuditService, useValue: { record: jest.fn() } },
    ],
  }).compile()
  return moduleRef.get(DossiersService)
}

describe('DossiersService', () => {
  it('creates a dossier with a slugified name and resolves a unique slug', async () => {
    const prisma = buildPrisma()
    prisma.dossier.findMany.mockResolvedValue([{ id: 'd-0', slug: 'biosensio' }])
    prisma.dossier.create.mockImplementation(async (args: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: 'd-new', ...args.data }),
    )
    const svc = await instantiate(prisma)

    const result = await svc.create({ userId: 'u-1', name: 'Biosensio' })
    expect(prisma.dossier.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'u-1',
        name: 'Biosensio',
        slug: 'biosensio-2',
        questionnaireVersionId: 'qv-1',
      }),
    })
    expect(result.slug).toBe('biosensio-2')
  })

  it('uses the questionnaire bootstrap to resolve the version id', async () => {
    const prisma = buildPrisma()
    const ensureBootstrap = jest.fn().mockResolvedValue({ id: 'qv-bootstrap', version: 1 })
    prisma.dossier.create.mockImplementation(async (args: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: 'd-new', ...args.data }),
    )
    const svc = await instantiate(prisma, ensureBootstrap)

    await svc.create({ userId: 'u-1', name: 'Foo' })
    expect(ensureBootstrap).toHaveBeenCalled()
    expect(prisma.dossier.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ questionnaireVersionId: 'qv-bootstrap' }),
      }),
    )
  })

  it('scopes list to the authenticated entrepreneur user', async () => {
    const prisma = buildPrisma()
    prisma.dossier.findMany.mockResolvedValue([{ id: 'd-1' }])
    const svc = await instantiate(prisma)

    await svc.listForUser({ id: 'u-1', email: 'user@example.com', role: 'entrepreneur' })
    expect(prisma.dossier.findMany).toHaveBeenCalledWith({
      where: { userId: 'u-1' },
      orderBy: { createdAt: 'desc' },
    })
  })

  it('scopes list to shared dossiers for a financeur and projects by access level', async () => {
    const prisma = buildPrisma()
    prisma.dossier.findMany.mockResolvedValue([
      {
        id: 'd-2',
        sector: 'biotech',
        axe1Projet: 3,
        axe2Financier: 4,
        // Recorded when the dossier was classified (code review R31).
        classificationSources: {
          sector: ['secteur'],
          axe1Projet: ['stade_projet'],
          axe2Financier: ['stade_financement'],
        },
        user: { email: 'owner@example.com', firstName: 'Sophie', lastName: null },
        shareLinks: [{ accessLevel: 'public' }, { accessLevel: 'partiel' }],
      },
    ])
    // Source fields of the classification columns in the dossier's version.
    prisma.questionnaireField.findMany.mockResolvedValue([
      { key: 'secteur', minAccessLevel: 'public' },
      { key: 'stade_projet', minAccessLevel: 'partiel' },
      { key: 'stade_financement', minAccessLevel: 'complet' },
    ])
    const svc = await instantiate(prisma)

    const [row] = await svc.listForUser({ id: 'u-2', email: 'fin@example.com', role: 'financeur' })
    expect(prisma.dossier.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { shareLinks: { some: { recipientEmail: 'fin@example.com', status: 'active' } } },
        orderBy: { createdAt: 'desc' },
      }),
    )
    // Highest active level wins (partiel): financial axis hidden, the rest kept.
    expect(row).toMatchObject({ id: 'd-2', sector: 'biotech', axe1Projet: 3, axe2Financier: null })
    expect(row).toMatchObject({ ownerEmail: 'owner@example.com', ownerName: 'Sophie' })
    expect(row).not.toHaveProperty('shareLinks')
  })

  describe('resolveReadAccess', () => {
    const financeur = { id: 'u-2', email: 'fin@example.com', role: 'financeur' }

    it('grants complet to the owner', async () => {
      const prisma = buildPrisma()
      prisma.dossier.findUnique.mockResolvedValue({ id: 'd-1', userId: 'u-1' })
      const svc = await instantiate(prisma)
      const res = await svc.resolveReadAccess('d-1', {
        id: 'u-1',
        email: 'o@x.fr',
        role: 'entrepreneur',
      })
      expect(res.accessLevel).toBe('complet')
    })

    it('grants a financeur the highest level among their active links', async () => {
      const prisma = buildPrisma()
      prisma.dossier.findUnique.mockResolvedValue({ id: 'd-1', userId: 'u-1' })
      prisma.shareLink.findMany.mockResolvedValue([
        { accessLevel: 'public' },
        { accessLevel: 'complet' },
      ])
      const svc = await instantiate(prisma)
      const res = await svc.resolveReadAccess('d-1', financeur)
      expect(res.accessLevel).toBe('complet')
      expect(prisma.shareLink.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { dossierId: 'd-1', recipientEmail: 'fin@example.com', status: 'active' },
        }),
      )
    })

    it('returns 404 to a financeur without an active link', async () => {
      const prisma = buildPrisma()
      prisma.dossier.findUnique.mockResolvedValue({ id: 'd-1', userId: 'u-1' })
      const svc = await instantiate(prisma)
      await expect(svc.resolveReadAccess('d-1', financeur)).rejects.toBeInstanceOf(
        NotFoundException,
      )
    })

    it('lists only the field ids the level may read', async () => {
      const prisma = buildPrisma()
      prisma.questionnaireField.findMany.mockResolvedValue([
        { id: 'f-pub', minAccessLevel: 'public' },
        { id: 'f-part', minAccessLevel: 'partiel' },
        { id: 'f-fin', minAccessLevel: 'complet' },
        { id: 'f-bad', minAccessLevel: 'unknown' },
      ])
      const svc = await instantiate(prisma)
      const ids = await svc.visibleFieldIds({ questionnaireVersionId: 'qv-1' } as never, 'partiel')
      expect([...ids]).toEqual(['f-pub', 'f-part'])
    })
  })

  it('returns 404 when the dossier belongs to another user', async () => {
    const prisma = buildPrisma()
    prisma.dossier.findUnique.mockResolvedValue({ id: 'd-x', userId: 'u-other' })
    const svc = await instantiate(prisma)
    await expect(svc.getByIdForUser('d-x', 'u-1')).rejects.toBeInstanceOf(NotFoundException)
  })

  it('returns 404 when the dossier does not exist', async () => {
    const prisma = buildPrisma()
    prisma.dossier.findUnique.mockResolvedValue(null)
    const svc = await instantiate(prisma)
    await expect(svc.getByIdForUser('nope', 'u-1')).rejects.toBeInstanceOf(NotFoundException)
  })

  it('updates name and regenerates slug', async () => {
    const prisma = buildPrisma()
    prisma.dossier.findUnique.mockResolvedValue({
      id: 'd-1',
      userId: 'u-1',
      name: 'Old',
      slug: 'old',
    })
    prisma.dossier.findMany.mockResolvedValue([])
    prisma.dossier.update.mockResolvedValue({
      id: 'd-1',
      userId: 'u-1',
      name: 'New Name',
      slug: 'new-name',
    })
    const svc = await instantiate(prisma)

    const result = await svc.update({ userId: 'u-1', id: 'd-1', name: 'New Name' })
    expect(result.slug).toBe('new-name')
    expect(prisma.dossier.update).toHaveBeenCalledWith({
      where: { id: 'd-1' },
      data: { name: 'New Name', slug: 'new-name' },
    })
  })

  it('deletes the dossier and relies on prisma cascade for children', async () => {
    const prisma = buildPrisma()
    prisma.dossier.findUnique.mockResolvedValue({ id: 'd-1', userId: 'u-1' })
    const svc = await instantiate(prisma)

    await svc.delete('d-1', 'u-1')
    expect(prisma.dossier.delete).toHaveBeenCalledWith({ where: { id: 'd-1' } })
  })
})
