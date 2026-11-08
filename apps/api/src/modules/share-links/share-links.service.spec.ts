import { Test } from '@nestjs/testing'
import { ForbiddenException, NotFoundException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { ShareLinksService } from './share-links.service'
import { PrismaService } from '../../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import { DossiersService } from '../dossiers/dossiers.service'
import { DocumentsService } from '../documents/documents.service'
import { AuthService } from '../auth/auth.service'
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
      getByIdForUser:
        overrides.getByIdForUser ??
        jest.fn().mockResolvedValue({ id: 'd-1', userId: 'u-1', name: 'Biosensio' }),
    },
    auth: { requestMagicLink: jest.fn().mockResolvedValue(undefined) },
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
      questionnaireVersion: {
        fields: [
          { id: 'f-name', section: 'Identité du projet', minAccessLevel: 'public' },
          { id: 'f-origine', section: 'Origine & technologie', minAccessLevel: 'partiel' },
          { id: 'f-financement', section: 'Stade financier', minAccessLevel: 'complet' },
        ],
      },
      answers: [
        { fieldId: 'f-name', value: 'Biosensio' },
        { fieldId: 'f-origine', value: 'Spin-off d’un laboratoire' },
        { fieldId: 'f-financement', value: 'Seed – investisseurs professionnels' },
      ],
    }
    const docs = [{ filename: 'bp.pdf', current: {}, versions: [] }]

    async function resolve(accessLevel: string) {
      const mocks = buildModule({
        dossierFindUnique: jest.fn().mockResolvedValue(dossierRow),
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

    it('public: identity answers + public classification only, no documents', async () => {
      const { res, mocks } = await resolve('public')
      expect(res.share.accessLevel).toBe('public')
      expect(res.fields.map((f) => f.id)).toEqual(['f-name'])
      expect(res.answers).toEqual([{ fieldId: 'f-name', value: 'Biosensio' }])
      expect(res.dossier).toMatchObject({ sector: 'biotech', tagTechnologique: 'deeptech' })
      expect(res.dossier).toMatchObject({
        axe1Projet: null,
        deeptechScore: null,
        axe2Financier: null,
      })
      expect(res.documents).toBeNull()
      expect(mocks.documents.listForDossier).not.toHaveBeenCalled()
    })

    it('partiel: everything but financial data, no documents', async () => {
      const { res } = await resolve('partiel')
      expect(res.answers.map((a) => a.fieldId)).toEqual(['f-name', 'f-origine'])
      expect(res.dossier).toMatchObject({ axe1Projet: 3, deeptechScore: 3, axe2Financier: null })
      expect(res.documents).toBeNull()
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
