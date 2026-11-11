import { Test } from '@nestjs/testing'
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { ShareLinksService } from './share-links.service'
import { PrismaService } from '../../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import { DossiersService } from '../dossiers/dossiers.service'
import { DocumentsService } from '../documents/documents.service'
import { AuthService } from '../auth/auth.service'
import { QuestionnairesService } from '../questionnaires/questionnaires.service'
import { EMAIL_TRANSPORT } from '../auth/email/email-transport'

function buildModule(overrides: {
  getByIdForUser?: jest.Mock
  shareCreate?: jest.Mock
  shareFindUnique?: jest.Mock
  shareUpdate?: jest.Mock
  shareUpdateMany?: jest.Mock
  shareFindMany?: jest.Mock
  userFindUnique?: jest.Mock
  userCreate?: jest.Mock
  sendShareInvite?: jest.Mock
  sendMagicLink?: jest.Mock
  auditRecord?: jest.Mock
  dossierFindUnique?: jest.Mock
  answerFindMany?: jest.Mock
  getVersion?: jest.Mock
  listDocuments?: jest.Mock
}) {
  const self: { prisma?: unknown } = {}
  const prisma = {
    // The dossier's lock (E07.01): the transaction runs on the same stand-in.
    $transaction: jest.fn((fn: (tx: unknown) => unknown): unknown => fn(self.prisma)),
    $queryRaw: jest.fn().mockResolvedValue([]),
    shareLink: {
      create: overrides.shareCreate ?? jest.fn().mockResolvedValue({ id: 'sl-1' }),
      findUnique: overrides.shareFindUnique ?? jest.fn(),
      update: overrides.shareUpdate ?? jest.fn(),
      updateMany: overrides.shareUpdateMany ?? jest.fn().mockResolvedValue({ count: 1 }),
      findMany: overrides.shareFindMany ?? jest.fn().mockResolvedValue([]),
    },
    auditLog: { findMany: jest.fn().mockResolvedValue([]) },
    questionnaireField: { count: jest.fn().mockResolvedValue(0) },
    dossier: {
      findUnique:
        overrides.dossierFindUnique ??
        jest.fn().mockResolvedValue({
          id: 'd-1',
          userId: 'u-1',
          name: 'Biosensio',
          publicationStatus: 'draft',
        }),
    },
    dossierAnswer: { findMany: overrides.answerFindMany ?? jest.fn().mockResolvedValue([]) },
    user: {
      findUnique: overrides.userFindUnique ?? jest.fn().mockResolvedValue(null),
      create:
        overrides.userCreate ??
        jest
          .fn()
          .mockImplementation(async (args: { data: Record<string, unknown> }) =>
            Promise.resolve({ id: 'recipient-1', locale: 'fr', ...args.data }),
          ),
    },
  }
  self.prisma = prisma
  return {
    prisma,
    audit: {
      record: overrides.auditRecord ?? jest.fn().mockResolvedValue(undefined),
      recordIn: jest.fn().mockResolvedValue(undefined),
    },
    config: {
      get: (k: string) =>
        ({
          FRONTEND_URL: 'https://app.confluent',
          SMTP_FROM: 'noreply@confluent.local',
        })[k],
    },
    dossiers: {
      // Derived data: projected by DossiersService (policy tested in financeur-access.spec.ts); here
      // a stand-in that hides the financial axis below `complet`, to check delegation.
      projectForLevel: jest.fn((d: Record<string, unknown>, level: string) =>
        Promise.resolve(level === 'complet' ? d : { ...d, axe2Financier: null }),
      ),
      getByIdForUser:
        overrides.getByIdForUser ??
        jest.fn().mockResolvedValue({ id: 'd-1', userId: 'u-1', name: 'Biosensio' }),
      // Creating a share is a diffusion (E05.08).
      getForDiffusion: jest.fn().mockResolvedValue({ id: 'd-1', userId: 'u-1', name: 'Biosensio' }),
    },
    auth: { requestMagicLink: jest.fn().mockResolvedValue(undefined) },
    questionnaires: { getVersion: overrides.getVersion ?? jest.fn().mockResolvedValue(null) },
    documents: {
      listForDossier: overrides.listDocuments ?? jest.fn().mockResolvedValue([]),
    },
    email: {
      sendMagicLink: overrides.sendMagicLink ?? jest.fn().mockResolvedValue(undefined),
      sendShareInvite: overrides.sendShareInvite ?? jest.fn().mockResolvedValue(undefined),
    },
  }
}

async function instantiate(mocks: ReturnType<typeof buildModule>): Promise<ShareLinksService> {
  const moduleRef = await Test.createTestingModule({
    providers: [
      ShareLinksService,
      { provide: PrismaService, useValue: mocks.prisma },
      { provide: AuditService, useValue: mocks.audit },
      { provide: ConfigService, useValue: mocks.config },
      { provide: DossiersService, useValue: mocks.dossiers },
      { provide: DocumentsService, useValue: mocks.documents },
      { provide: AuthService, useValue: mocks.auth },
      { provide: QuestionnairesService, useValue: mocks.questionnaires },
      { provide: EMAIL_TRANSPORT, useValue: mocks.email },
    ],
  }).compile()
  return moduleRef.get(ShareLinksService)
}

const OWNER = { id: 'u-1', email: 'sophie@biosensio.fr' }

describe('ShareLinksService', () => {
  it('creates a share link with a CSPRNG token + dispatches email + audits', async () => {
    const mocks = buildModule({
      shareCreate: jest
        .fn()
        .mockImplementation(async (args: { data: Record<string, unknown> }) =>
          Promise.resolve({ id: 'sl-1', createdAt: new Date(), revokedAt: null, ...args.data }),
        ),
    })
    const svc = await instantiate(mocks)

    const result = await svc.create({
      dossierId: 'd-1',
      user: OWNER,
      recipientEmail: 'bob@invest.fr',
      accessLevel: 'partiel',
    })
    expect(result.shareUrl).toMatch(/^https:\/\/app\.confluent\/share\/[0-9a-f-]{36}$/)
    expect(mocks.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: 'share_link_created',
        dossierId: 'd-1',
        metadata: expect.objectContaining({
          recipientUserId: 'recipient-1',
          createdNewUser: true,
          accessLevel: 'partiel',
        }),
      }),
    )
    expect(mocks.email.sendShareInvite).toHaveBeenCalledTimes(1)
    expect(mocks.email.sendShareInvite).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'bob@invest.fr',
        dossierName: 'Biosensio',
        locale: 'fr',
      }),
    )
  })

  it('upserts the recipient as a financeur user when unknown', async () => {
    const userCreate = jest.fn().mockResolvedValue({
      id: 'new-user',
      email: 'bob@invest.fr',
      role: 'financeur',
      isActive: true,
      emailVerifiedAt: null,
      locale: 'fr',
    })
    const mocks = buildModule({
      userFindUnique: jest.fn().mockResolvedValue(null),
      userCreate,
    })
    const svc = await instantiate(mocks)

    await svc.create({
      dossierId: 'd-1',
      user: OWNER,
      recipientEmail: 'bob@invest.fr',
      accessLevel: 'complet',
    })

    expect(userCreate).toHaveBeenCalledWith({
      data: {
        email: 'bob@invest.fr',
        role: 'financeur',
        isActive: true,
        emailVerifiedAt: null,
      },
    })
  })

  it('does not create the user when recipient already exists', async () => {
    const existing = {
      id: 'existing-1',
      email: 'lea@fund.io',
      role: 'admin',
      isActive: false,
      emailVerifiedAt: null,
      locale: 'fr',
    }
    const userCreate = jest.fn()
    const mocks = buildModule({
      userFindUnique: jest.fn().mockResolvedValue(existing),
      userCreate,
    })
    const svc = await instantiate(mocks)

    await svc.create({
      dossierId: 'd-1',
      user: OWNER,
      recipientEmail: 'lea@fund.io',
      accessLevel: 'public',
    })

    expect(userCreate).not.toHaveBeenCalled()
    expect(mocks.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          recipientUserId: 'existing-1',
          createdNewUser: false,
        }),
      }),
    )
  })

  it('revoke sets status + revokedAt and audits share_link_revoked', async () => {
    const shareFindUnique = jest
      .fn()
      .mockResolvedValue({ id: 'sl-2', dossierId: 'd-1', recipientEmail: 'bob@invest.fr' })
    const mocks = buildModule({
      shareFindUnique,
      shareFindMany: jest.fn().mockResolvedValue([{ id: 'sl-2', status: 'revoked' }]),
    })
    const svc = await instantiate(mocks)

    const result = await svc.revokeAsOwner('d-1', 'sl-2', 'u-1')
    expect(result.status).toBe('revoked')
    expect(mocks.prisma.shareLink.updateMany).toHaveBeenCalledWith({
      where: { id: 'sl-2', status: { not: 'revoked' } },
      data: { status: 'revoked', revokedAt: expect.any(Date) },
    })
    // Journaled in the revocation's transaction.
    expect(mocks.audit.recordIn).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ actionType: 'share_link_revoked', shareLinkId: 'sl-2' }),
    )
  })

  it('revoking a share already revoked journals nothing more', async () => {
    const mocks = buildModule({
      shareFindUnique: jest.fn().mockResolvedValue({ id: 'sl-2', dossierId: 'd-1' }),
      shareUpdateMany: jest.fn().mockResolvedValue({ count: 0 }),
      shareFindMany: jest.fn().mockResolvedValue([{ id: 'sl-2', status: 'revoked' }]),
    })
    const svc = await instantiate(mocks)
    await svc.revokeAsAdmin('d-1', 'sl-2', 'admin-1')
    expect(mocks.audit.record).not.toHaveBeenCalled()
    expect(mocks.audit.recordIn).not.toHaveBeenCalled()
  })

  it('revoke throws 404 when the link does not belong to the dossier', async () => {
    const mocks = buildModule({
      shareFindUnique: jest.fn().mockResolvedValue({ id: 'sl-2', dossierId: 'other' }),
    })
    const svc = await instantiate(mocks)
    await expect(svc.revokeAsOwner('d-1', 'sl-2', 'u-1')).rejects.toBeInstanceOf(NotFoundException)
    await expect(svc.revokeAsAdmin('d-1', 'sl-2', 'admin-1')).rejects.toBeInstanceOf(
      NotFoundException,
    )
    expect(mocks.prisma.shareLink.updateMany).not.toHaveBeenCalled()
  })

  describe('invitation and level rules (E07.01)', () => {
    const archived = () =>
      jest.fn().mockResolvedValue({
        id: 'd-1',
        userId: 'u-1',
        name: 'Biosensio',
        publicationStatus: 'archived',
      })
    const invite = (svc: ShareLinksService, recipientEmail: string) =>
      svc.create({ dossierId: 'd-1', user: OWNER, recipientEmail, accessLevel: 'public' })

    it('refuses to invite oneself, before any write', async () => {
      const mocks = buildModule({})
      const svc = await instantiate(mocks)
      await expect(invite(svc, ' Sophie@Biosensio.fr ')).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      )
      expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
    })

    it('refuses a new share on an archived request, read under its lock', async () => {
      const mocks = buildModule({ dossierFindUnique: archived() })
      const svc = await instantiate(mocks)
      await expect(invite(svc, 'bob@invest.fr')).rejects.toBeInstanceOf(ConflictException)
      expect(mocks.prisma.$queryRaw).toHaveBeenCalled()
      expect(mocks.prisma.shareLink.create).not.toHaveBeenCalled()
      expect(mocks.email.sendShareInvite).not.toHaveBeenCalled()
    })

    it('refuses a second active share to the same recipient, whatever the case', async () => {
      const mocks = buildModule({
        shareFindMany: jest
          .fn()
          .mockResolvedValue([{ id: 'sl-1', recipientEmail: 'bob@invest.fr', status: 'active' }]),
      })
      const svc = await instantiate(mocks)
      await expect(invite(svc, 'BOB@invest.fr')).rejects.toBeInstanceOf(ConflictException)
      expect(mocks.prisma.user.create).not.toHaveBeenCalled()
      expect(mocks.prisma.shareLink.create).not.toHaveBeenCalled()
    })

    const active = { id: 'sl-1', dossierId: 'd-1', status: 'active', recipientEmail: 'b@x.fr' }
    const change = (svc: ShareLinksService, accessLevel: 'public' | 'complet') =>
      svc.changeLevel({ dossierId: 'd-1', linkId: 'sl-1', userId: 'u-1', accessLevel })

    it('widens an archived request’s share never, restricts it always', async () => {
      const mocks = buildModule({
        dossierFindUnique: archived(),
        shareFindUnique: jest.fn().mockResolvedValue({ ...active, accessLevel: 'partiel' }),
        shareFindMany: jest.fn().mockResolvedValue([active]),
      })
      const svc = await instantiate(mocks)
      await expect(change(svc, 'complet')).rejects.toBeInstanceOf(ConflictException)
      expect(mocks.prisma.shareLink.updateMany).not.toHaveBeenCalled()
      await change(svc, 'public')
      expect(mocks.prisma.shareLink.updateMany).toHaveBeenCalledWith({
        where: { id: 'sl-1', status: 'active', accessLevel: 'partiel' },
        data: { accessLevel: 'public' },
      })
      expect(mocks.audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          actionType: 'share_link_level_changed',
          metadata: { recipientEmail: 'b@x.fr', from: 'partiel', to: 'public' },
        }),
      )
    })

    it('refuses to change a revoked share, or one changed meanwhile; the same level changes nothing', async () => {
      const revoked = buildModule({
        shareFindUnique: jest.fn().mockResolvedValue({ ...active, status: 'revoked' }),
      })
      await expect(change(await instantiate(revoked), 'complet')).rejects.toBeInstanceOf(
        ConflictException,
      )
      const meanwhile = buildModule({
        shareFindUnique: jest.fn().mockResolvedValue({ ...active, accessLevel: 'public' }),
        shareUpdateMany: jest.fn().mockResolvedValue({ count: 0 }),
      })
      await expect(change(await instantiate(meanwhile), 'complet')).rejects.toBeInstanceOf(
        ConflictException,
      )
      expect(meanwhile.audit.record).not.toHaveBeenCalled()
      const same = buildModule({
        shareFindUnique: jest.fn().mockResolvedValue({ ...active, accessLevel: 'public' }),
        shareFindMany: jest.fn().mockResolvedValue([active]),
      })
      await change(await instantiate(same), 'public')
      expect(same.prisma.shareLink.updateMany).not.toHaveBeenCalled()
      expect(same.audit.record).not.toHaveBeenCalled()
    })
  })

  describe('preview « Voir comme le destinataire » (E07.01)', () => {
    const version = (url: string | null) => ({
      id: 'v1',
      version: 1,
      availability: 'available',
      url,
    })
    const doc = {
      id: 'doc-1',
      filename: 'bp.pdf',
      current: version('https://s3/bp'),
      versions: [version('https://s3/bp')],
    }

    it('is the recipient’s view without any file, link nor view, for the owner only', async () => {
      const listDocuments = jest.fn().mockResolvedValue([doc])
      const mocks = buildModule({ listDocuments })
      mocks.prisma.questionnaireField.count.mockResolvedValue(7)
      const svc = await instantiate(mocks)
      const preview = await svc.previewForOwner('d-1', 'u-1', 'partiel')
      expect(mocks.dossiers.getByIdForUser).toHaveBeenCalledWith('d-1', 'u-1')
      // The recipient's documents at that level, then all the selected ones for the total.
      expect(listDocuments.mock.calls.map((c) => [c[1], c[2]])).toEqual(
        expect.arrayContaining([
          ['partiel', 'share'],
          ['complet', 'share'],
        ]),
      )
      expect(preview.documents).toEqual([
        { ...doc, current: version(null), versions: [version(null)] },
      ])
      expect(preview.preview).toEqual({
        accessLevel: 'partiel',
        totalQuestions: 7,
        totalDocuments: 1,
      })
      expect(mocks.audit.record).not.toHaveBeenCalled()
      expect(mocks.prisma.shareLink.create).not.toHaveBeenCalled()
    })

    it('answers like an unknown request to anyone but its owner', async () => {
      const mocks = buildModule({
        getByIdForUser: jest.fn().mockRejectedValue(new NotFoundException()),
      })
      const svc = await instantiate(mocks)
      await expect(svc.previewForOwner('d-1', 'u-2', 'complet')).rejects.toBeInstanceOf(
        NotFoundException,
      )
      expect(mocks.documents.listForDossier).not.toHaveBeenCalled()
    })
  })

  describe('resolveForFinanceur — access levels applied server-side', () => {
    const dossierRow = {
      id: 'd-1',
      name: 'Biosensio',
      slug: 'biosensio',
      sector: 'biotech',
      maturityStage: 'MVP',
      ancrageCvl: 'ancré',
      tagTechnologique: 'deeptech',
      axe1Projet: 3,
      axe2Financier: 4,
      axe3Origine: 3,
      deeptechScore: 3,
      preCreation: false,
      companyId: 'c-1',
      questionnaireVersionId: 'v-2',
    }
    // The company profile the dossier presents (E05.05).
    const answers = [
      { fieldId: 'f-name', value: 'Biosensio' },
      { fieldId: 'f-origine', value: 'Spin-off d’un laboratoire' },
      { fieldId: 'f-financement', value: 'Seed – investisseurs professionnels' },
    ]
    const structure = {
      version: { id: 'v-2' },
      sections: [
        { id: 's-identite', title: 'Identité du projet', orderIndex: 0 },
        { id: 's-origine', title: 'Origine & technologie', orderIndex: 1 },
        { id: 's-financier', title: 'Stade financier', orderIndex: 2 },
      ],
      fields: [
        { id: 'f-name', sectionId: 's-identite', minAccessLevel: 'public' },
        { id: 'f-origine', sectionId: 's-origine', minAccessLevel: 'partiel' },
        { id: 'f-financement', sectionId: 's-financier', minAccessLevel: 'complet' },
      ],
    }
    const docs = [{ filename: 'bp.pdf', current: {}, versions: [] }]

    async function resolve(accessLevel: string) {
      const mocks = buildModule({
        dossierFindUnique: jest.fn().mockResolvedValue(dossierRow),
        answerFindMany: jest.fn().mockResolvedValue(answers),
        getVersion: jest.fn().mockResolvedValue(structure),
        listDocuments: jest.fn().mockResolvedValue(docs),
      })
      const svc = await instantiate(mocks)
      const res = await svc.resolveForFinanceur({
        id: 'sl-1',
        dossierId: 'd-1',
        recipientEmail: 'marc@fund.fr',
        status: 'active',
        accessLevel,
      } as never)
      return { res, mocks }
    }

    it('public: identity answers + public classification only, documents read at that level', async () => {
      const { res, mocks } = await resolve('public')
      expect(res.share.accessLevel).toBe('public')
      expect(res.fields.map((f) => f.id)).toEqual(['f-name'])
      // Sections without any visible field are not sent either.
      expect(res.sections.map((sec) => sec.id)).toEqual(['s-identite'])
      expect(res.answers).toEqual([{ fieldId: 'f-name', value: 'Biosensio' }])
      // Derived data comes from DossiersService.projectForLevel, at the level of this link.
      expect(mocks.dossiers.projectForLevel).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'd-1' }),
        'public',
      )
      expect(res.dossier).toMatchObject({ sector: 'biotech', axe2Financier: null })
      // Documents are filtered by DocumentsService at the level of this link (E03.11).
      expect(mocks.documents.listForDossier).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'd-1', companyId: 'c-1' }),
        'public',
        'share',
      )
      // The answers are those of the dossier's company.
      expect(mocks.prisma.dossierAnswer.findMany).toHaveBeenCalledWith({
        where: { companyId: 'c-1' },
        select: { fieldId: true, value: true },
      })
      expect(res.documents).toEqual(docs)
    })

    it('partiel: everything but financial data, documents read at that level', async () => {
      const { res, mocks } = await resolve('partiel')
      expect(res.answers.map((a) => a.fieldId)).toEqual(['f-name', 'f-origine'])
      expect(res.dossier).toMatchObject({ axe1Projet: 3, axe2Financier: null })
      expect(mocks.documents.listForDossier).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'd-1' }),
        'partiel',
        'share',
      )
    })

    it('complet: all answers, all classification, documents', async () => {
      const { res } = await resolve('complet')
      expect(res.answers).toHaveLength(3)
      expect(res.dossier.axe2Financier).toBe(4)
      expect(res.documents).toEqual(docs)
    })

    it('an unknown stored level falls back to public (fail closed)', async () => {
      const { res } = await resolve('everything')
      expect(res.share.accessLevel).toBe('public')
      expect(res.answers.map((a) => a.fieldId)).toEqual(['f-name'])
    })
  })

  describe('recipient identity (E02.08)', () => {
    const link = {
      id: 'sl-1',
      dossierId: 'd-1',
      recipientEmail: 'marc@fund.fr',
      status: 'active',
      accessLevel: 'complet',
    } as never
    const req = { ip: '1.2.3.4' } as never

    it('lets the recipient (any case) through and refuses another account', async () => {
      const svc = await instantiate(buildModule({}))
      expect(() => svc.assertRecipient(link, { email: 'Marc@Fund.fr' })).not.toThrow()
      expect(() => svc.assertRecipient(link, { email: 'someone@else.fr' })).toThrow(
        ForbiddenException,
      )
    })

    it('sends the sign-in link only to the recipient, and always answers the same way', async () => {
      const mocks = buildModule({})
      const svc = await instantiate(mocks)
      await svc.requestAccess(link, 'intrus@else.fr', req)
      expect(mocks.auth.requestMagicLink).not.toHaveBeenCalled()
      await svc.requestAccess(link, 'MARC@fund.fr', req)
      expect(mocks.auth.requestMagicLink).toHaveBeenCalledWith('marc@fund.fr')
      expect(mocks.audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          actionType: 'share_link_access_requested',
          metadata: expect.objectContaining({ matched: false }),
        }),
      )
    })
  })
})
