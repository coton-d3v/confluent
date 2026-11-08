import { Test, TestingModule } from '@nestjs/testing'
import { INestApplication } from '@nestjs/common'
import request from 'supertest'
import type { App } from 'supertest/types'
import cookieParser from 'cookie-parser'
import { AppModule } from './../src/app.module'
import { PrismaService } from './../src/prisma/prisma.service'
import { EMAIL_TRANSPORT } from './../src/modules/auth/email/email-transport'
import { AuditService } from './../src/modules/audit/audit.service'
import { ZodValidationPipe } from 'nestjs-zod'
import { GlobalExceptionFilter } from './../src/common/filters/global-exception.filter'

describe('ShareLinksController (e2e)', () => {
  let app: INestApplication<App>
  let shareFindUnique: jest.Mock
  let dossierFindUnique: jest.Mock
  let documentFindMany: jest.Mock
  let auditRecord: jest.Mock

  beforeEach(async () => {
    shareFindUnique = jest.fn()
    dossierFindUnique = jest.fn()
    documentFindMany = jest.fn().mockResolvedValue([])
    auditRecord = jest.fn().mockResolvedValue(undefined)
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue({
        onModuleInit: async () => {},
        onModuleDestroy: async () => {},
        user: { findUnique: jest.fn() },
        magicLinkToken: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
        shareLink: { findUnique: shareFindUnique },
        dossier: { findUnique: dossierFindUnique },
        document: { findMany: documentFindMany },
        auditLog: { create: jest.fn() },
      })
      .overrideProvider(EMAIL_TRANSPORT)
      .useValue({ sendMagicLink: jest.fn(), sendShareInvite: jest.fn() })
      .overrideProvider(AuditService)
      .useValue({ record: auditRecord })
      .compile()

    app = moduleFixture.createNestApplication()
    app.use(cookieParser())
    app.setGlobalPrefix('v1', { exclude: ['/'] })
    app.useGlobalPipes(new ZodValidationPipe())
    app.useGlobalFilters(new GlobalExceptionFilter())
    await app.init()
  })

  afterEach(async () => {
    await app.close()
  })

  // A V2-like dossier with one field per access level (story 12.1).
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
        { id: 'f-name', section: 'Identité du projet', label: 'Nom', minAccessLevel: 'public' },
        {
          id: 'f-origine',
          section: 'Origine & technologie',
          label: 'Origine',
          minAccessLevel: 'partiel',
        },
        {
          id: 'f-fin',
          section: 'Stade financier',
          label: 'Financement',
          minAccessLevel: 'complet',
        },
      ],
    },
    answers: [
      { fieldId: 'f-name', value: 'Biosensio' },
      { fieldId: 'f-origine', value: 'Spin-off' },
      { fieldId: 'f-fin', value: 'Seed' },
    ],
  }

  function activeLink(accessLevel: string) {
    shareFindUnique.mockResolvedValue({
      id: 'sl-1',
      token: 'abc',
      status: 'active',
      dossierId: 'd-1',
      recipientEmail: 'bob@invest.fr',
      accessLevel,
    })
    dossierFindUnique.mockResolvedValue(dossierRow)
  }

  it('GET /v1/shares/:token — public: identity only, no documents + audit written', async () => {
    activeLink('public')
    const res = await request(app.getHttpServer()).get('/v1/shares/abc').expect(200)

    expect(res.body.share).toEqual({
      recipientEmail: 'bob@invest.fr',
      status: 'active',
      accessLevel: 'public',
    })
    expect(res.body.fields.map((f: { id: string }) => f.id)).toEqual(['f-name'])
    expect(res.body.answers).toEqual([{ fieldId: 'f-name', value: 'Biosensio' }])
    expect(res.body.dossier).toMatchObject({ id: 'd-1', name: 'Biosensio', sector: 'biotech' })
    expect(res.body.dossier).toMatchObject({ axe1Projet: null, axe2Financier: null })
    expect(res.body.documents).toBeNull()
    expect(documentFindMany).not.toHaveBeenCalled()
    expect(auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: 'share_link_viewed',
        shareLinkId: 'sl-1',
        dossierId: 'd-1',
      }),
    )
  })

  it('GET /v1/shares/:token — partiel: no financial answer, no documents', async () => {
    activeLink('partiel')
    const res = await request(app.getHttpServer()).get('/v1/shares/abc').expect(200)

    expect(res.body.answers.map((a: { fieldId: string }) => a.fieldId)).toEqual([
      'f-name',
      'f-origine',
    ])
    expect(res.body.dossier).toMatchObject({ axe1Projet: 3, axe2Financier: null })
    expect(res.body.documents).toBeNull()
  })

  it('GET /v1/shares/:token — complet: everything + documents', async () => {
    activeLink('complet')
    const res = await request(app.getHttpServer()).get('/v1/shares/abc').expect(200)

    expect(res.body.answers).toHaveLength(3)
    expect(res.body.dossier.axe2Financier).toBe(4)
    expect(res.body.documents).toEqual([])
  })

  it('GET /v1/shares/:token — complet with a lost stored file still answers 200 (url null)', async () => {
    activeLink('complet')
    // Metadata survives in DB, the in-memory object is gone (API restarted).
    documentFindMany.mockResolvedValue([
      {
        id: 'doc-1',
        filename: 'bp.pdf',
        version: 1,
        storageKey: 'dossiers/d-1/bp.pdf-v1',
        mimetype: 'application/pdf',
        size: 42,
        createdAt: new Date('2026-11-01'),
      },
    ])
    const res = await request(app.getHttpServer()).get('/v1/shares/abc').expect(200)

    expect(res.body.answers).toHaveLength(3)
    expect(res.body.documents).toHaveLength(1)
    expect(res.body.documents[0]).toMatchObject({ filename: 'bp.pdf', current: { url: null } })
  })

  it('GET /v1/shares/:token — unknown token: 403 + deny audit', async () => {
    shareFindUnique.mockResolvedValue(null)
    const res = await request(app.getHttpServer()).get('/v1/shares/unknown').expect(403)
    expect(res.body.error.code).toBe('FORBIDDEN')
    expect(auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: 'share_link_access_denied',
        metadata: expect.objectContaining({ reason: 'not_found' }),
      }),
    )
  })

  it('GET /v1/shares/:token — revoked: 403 + deny audit', async () => {
    shareFindUnique.mockResolvedValue({
      id: 'sl-2',
      token: 'rev',
      status: 'revoked',
      dossierId: 'd-1',
      recipientEmail: 'bob@invest.fr',
    })
    await request(app.getHttpServer()).get('/v1/shares/rev').expect(403)
    expect(auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: 'share_link_access_denied',
        metadata: expect.objectContaining({ reason: 'revoked' }),
      }),
    )
  })
})
