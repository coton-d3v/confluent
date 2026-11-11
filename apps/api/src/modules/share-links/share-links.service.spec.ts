import { Test } from '@nestjs/testing'
import { ForbiddenException, NotFoundException } from '@nestjs/common'
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
  return {
    prisma: {
      shareLink: {
        create: overrides.shareCreate ?? jest.fn().mockResolvedValue({ id: 'sl-1' }),
        findUnique: overrides.shareFindUnique ?? jest.fn(),
        update: overrides.shareUpdate ?? jest.fn(),
        findMany: overrides.shareFindMany ?? jest.fn().mockResolvedValue([]),
      },
      dossier: { findUnique: overrides.dossierFindUnique ?? jest.fn() },
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
    },
    audit: { record: overrides.auditRecord ?? jest.fn().mockResolvedValue(undefined) },
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
      userId: 'u-1',
      recipientEmail: 'bob@invest.fr',
    })
    expect(result.shareUrl).toMatch(/^https:\/\/app\.confluent\/share\/[0-9a-f-]{36}$/)
    expect(mocks.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: 'share_link_created',
        dossierId: 'd-1',
        metadata: expect.objectContaining({
          recipientUserId: 'recipient-1',
          createdNewUser: true,
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

    await svc.create({ dossierId: 'd-1', userId: 'u-1', recipientEmail: 'bob@invest.fr' })

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

    await svc.create({ dossierId: 'd-1', userId: 'u-1', recipientEmail: 'lea@fund.io' })

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
    const mocks = buildModule({
      shareFindUnique: jest.fn().mockResolvedValue({ id: 'sl-2', dossierId: 'd-1' }),
      shareUpdate: jest.fn().mockResolvedValue({
        id: 'sl-2',
        status: 'revoked',
        revokedAt: new Date(),
      }),
    })
    const svc = await instantiate(mocks)

    const result = await svc.revoke('d-1', 'sl-2', 'u-1')
    expect(result.status).toBe('revoked')
    expect(mocks.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ actionType: 'share_link_revoked', shareLinkId: 'sl-2' }),
    )
  })

  it('revoke throws 404 when the link does not belong to the dossier', async () => {
    const mocks = buildModule({
      shareFindUnique: jest.fn().mockResolvedValue({ id: 'sl-2', dossierId: 'other' }),
    })
    const svc = await instantiate(mocks)
    await expect(svc.revoke('d-1', 'sl-2', 'u-1')).rejects.toBeInstanceOf(NotFoundException)
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
