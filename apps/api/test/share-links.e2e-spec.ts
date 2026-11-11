import { Test, TestingModule } from '@nestjs/testing'
import { INestApplication } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import request from 'supertest'
import type { App } from 'supertest/types'
import cookieParser from 'cookie-parser'
import { AppModule } from './../src/app.module'
import { PrismaService } from './../src/prisma/prisma.service'
import { EMAIL_TRANSPORT } from './../src/modules/auth/email/email-transport'
import { AuditService } from './../src/modules/audit/audit.service'
import { ZodValidationPipe } from 'nestjs-zod'
import { GlobalExceptionFilter } from './../src/common/filters/global-exception.filter'
import { DEFAULT_CLASSIFICATION_RULES } from '../src/testing/classification-rules.fixture'
import { classificationSources } from '../src/modules/classification/classification-sources'

describe('ShareLinksController (e2e)', () => {
  let app: INestApplication<App>
  let shareFindUnique: jest.Mock
  let dossierFindUnique: jest.Mock
  let documentFindMany: jest.Mock
  let fieldFindMany: jest.Mock
  let auditRecord: jest.Mock
  let sendMagicLink: jest.Mock
  const users = [
    {
      id: 'u-marc',
      email: 'bob@invest.fr',
      role: 'financeur',
      isActive: true,
      emailVerifiedAt: new Date(),
      locale: 'fr',
    },
    {
      id: 'u-eve',
      email: 'eve@other.fr',
      role: 'financeur',
      isActive: true,
      emailVerifiedAt: new Date(),
      locale: 'fr',
    },
  ]
  const userFindUnique = jest.fn(({ where }: { where: { id?: string; email?: string } }) =>
    Promise.resolve(users.find((u) => u.id === where.id || u.email === where.email) ?? null),
  )
  const jwtFor = (u: (typeof users)[number]) =>
    new JwtService().signAsync(
      { sub: u.id, email: u.email, role: u.role },
      { secret: process.env.JWT_SECRET },
    )

  beforeEach(async () => {
    shareFindUnique = jest.fn()
    dossierFindUnique = jest.fn()
    documentFindMany = jest.fn().mockResolvedValue([])
    fieldFindMany = jest.fn().mockResolvedValue(fields)
    auditRecord = jest.fn().mockResolvedValue(undefined)
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue({
        onModuleInit: async () => {},
        onModuleDestroy: async () => {},
        user: { findUnique: userFindUnique },
        magicLinkToken: {
          create: jest.fn().mockResolvedValue({}),
          findUnique: jest.fn(),
          update: jest.fn(),
        },
        shareLink: { findUnique: shareFindUnique },
        dossier: { findUnique: dossierFindUnique },
        // The answers of the company profile the dossier presents (E05.05).
        dossierAnswer: {
          findMany: jest.fn(({ where }: { where: { companyId: string } }) =>
            Promise.resolve(where.companyId === 'c-1' ? profileAnswers : []),
          ),
        },
        questionnaireVersion: {
          findUnique: jest.fn().mockResolvedValue({ id: 'v-2', version: 2 }),
        },
        questionnaireSection: { findMany: jest.fn().mockResolvedValue(sections) },
        questionnaireField: { findMany: fieldFindMany },
        classificationRule: { findMany: jest.fn().mockResolvedValue(DEFAULT_CLASSIFICATION_RULES) },
        // The company's library (E05.06): documents with their field and versions.
        libraryDocument: { findMany: documentFindMany },
        auditLog: { create: jest.fn() },
      })
      .overrideProvider(EMAIL_TRANSPORT)
      .useValue({
        sendMagicLink: (sendMagicLink = jest.fn().mockResolvedValue(undefined)),
        sendShareInvite: jest.fn(),
      })
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
    // Recorded when it was classified (code review R31): the version's fields read by the rules.
    classificationSources: classificationSources(
      DEFAULT_CLASSIFICATION_RULES,
      new Set(['nom', 'secteur', 'stade_projet', 'origine_projet', 'stade_financement']),
    ),
    companyId: 'c-1',
    questionnaireVersionId: 'v-2',
  }
  const profileAnswers = [
    { fieldId: 'f-name', value: 'Biosensio' },
    { fieldId: 'f-origine', value: 'Spin-off' },
    { fieldId: 'f-fin', value: 'Seed' },
  ]

  // The dossier's questionnaire version, read through QuestionnairesService.getVersion.
  const sections = [
    {
      id: 's-identite',
      versionId: 'v-2',
      key: 'identite',
      title: 'Identité du projet',
      orderIndex: 0,
    },
    {
      id: 's-origine',
      versionId: 'v-2',
      key: 'origine',
      title: 'Origine & technologie',
      orderIndex: 1,
    },
    { id: 's-fin', versionId: 'v-2', key: 'financier', title: 'Stade financier', orderIndex: 2 },
  ]
  const fields = [
    { id: 'f-name', sectionId: 's-identite', key: 'nom', label: 'Nom', minAccessLevel: 'public' },
    // Sources of the classification columns (rules seeded by the migration).
    {
      id: 'f-secteur',
      sectionId: 's-identite',
      key: 'secteur',
      label: 'Secteur',
      minAccessLevel: 'public',
    },
    {
      id: 'f-stade',
      sectionId: 's-origine',
      key: 'stade_projet',
      label: 'Stade',
      minAccessLevel: 'partiel',
    },
    {
      id: 'f-origine',
      sectionId: 's-origine',
      key: 'origine_projet',
      label: 'Origine',
      minAccessLevel: 'partiel',
    },
    {
      id: 'f-fin',
      sectionId: 's-fin',
      key: 'stade_financement',
      label: 'Financement',
      minAccessLevel: 'complet',
    },
  ]

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

  // A library document (E05.06) holding one version, as listed with its field and versions.
  const asDocument = (
    version: {
      id: string
      filename: string
      fieldId?: string | null
      field?: { minAccessLevel: string } | null
    } & Record<string, unknown>,
  ) => {
    const { fieldId = null, field = null, ...row } = version
    return {
      id: `lib-${version.id}`,
      companyId: 'c-1',
      filename: version.filename,
      fieldId,
      type: 'other',
      createdAt: new Date('2026-11-01'),
      field,
      versions: [{ restoredFromId: null, ...row }],
    }
  }

  // E03.11: a file attached to a field follows that field's level; any other file needs `complet`.
  const documentRows = [
    { field: 'f-name', level: 'public', filename: 'kbis.pdf' },
    { field: 'f-origine', level: 'partiel', filename: 'brevet.pdf' },
    { field: 'f-fin', level: 'complet', filename: 'previsionnel.xlsx' },
    { field: null, level: null, filename: 'annexe.pdf' },
  ]
    .map((d, i) => ({
      id: `doc-${i}`,
      companyId: 'c-1',
      filename: d.filename,
      version: 1,
      storageKey: `dossiers/d-1/k-${i}`,
      mimetype: 'application/pdf',
      size: 10,
      createdAt: new Date('2026-11-01'),
      fieldId: d.field,
      field: d.level ? { minAccessLevel: d.level } : null,
    }))
    .map(asDocument)
  const listedFiles = (body: { documents: Array<{ filename: string }> }) =>
    body.documents.map((d) => d.filename).sort()

  it('GET /v1/shares/:token — public: identity only, documents of public fields only + audit written', async () => {
    activeLink('public')
    documentFindMany.mockResolvedValue(documentRows)
    const res = await request(app.getHttpServer())
      .get('/v1/shares/abc')
      .set('Authorization', `Bearer ${await jwtFor(users[0])}`)
      .expect(200)

    expect(res.body.share).toEqual({
      recipientEmail: 'bob@invest.fr',
      status: 'active',
      accessLevel: 'public',
    })
    expect(res.body.fields.map((f: { id: string }) => f.id)).toEqual(['f-name', 'f-secteur'])
    expect(res.body.sections.map((sec: { id: string }) => sec.id)).toEqual(['s-identite'])
    expect(res.body.answers).toEqual([{ fieldId: 'f-name', value: 'Biosensio' }])
    expect(res.body.dossier).toMatchObject({ id: 'd-1', name: 'Biosensio', sector: 'biotech' })
    expect(res.body.dossier).toMatchObject({ axe1Projet: null, axe2Financier: null })
    expect(listedFiles(res.body)).toEqual(['kbis.pdf'])
    expect(res.body.documents[0]).toMatchObject({ fieldId: 'f-name' })
    // The link opens the dossier, which presents its company's documents (E05.05).
    expect(documentFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { companyId: 'c-1' } }),
    )
    expect(auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: 'share_link_viewed',
        shareLinkId: 'sl-1',
        dossierId: 'd-1',
      }),
    )
  })

  // Code review R31: a classification column must not reveal a field hidden at the share's level.
  it('GET /v1/shares/:token — public: a derived column follows the level of its source field', async () => {
    activeLink('public')
    fieldFindMany.mockResolvedValue(
      fields.map((f) => (f.key === 'secteur' ? { ...f, minAccessLevel: 'complet' } : f)),
    )
    const res = await request(app.getHttpServer())
      .get('/v1/shares/abc')
      .set('Authorization', `Bearer ${await jwtFor(users[0])}`)
      .expect(200)
    expect(res.body.fields.map((f: { id: string }) => f.id)).toEqual(['f-name'])
    expect(res.body.dossier.sector).toBeNull()
    // Deeptech tag: derived from the origin (partiel) among others — hidden from a public share.
    expect(res.body.dossier.tagTechnologique).toBeNull()
  })

  it('GET /v1/shares/:token — partiel: no financial answer, documents of visible fields only', async () => {
    activeLink('partiel')
    documentFindMany.mockResolvedValue(documentRows)
    const res = await request(app.getHttpServer())
      .get('/v1/shares/abc')
      .set('Authorization', `Bearer ${await jwtFor(users[0])}`)
      .expect(200)

    expect(res.body.answers.map((a: { fieldId: string }) => a.fieldId)).toEqual([
      'f-name',
      'f-origine',
    ])
    expect(res.body.dossier).toMatchObject({ axe1Projet: 3, axe2Financier: null })
    expect(listedFiles(res.body)).toEqual(['brevet.pdf', 'kbis.pdf'])
  })

  it('GET /v1/shares/:token — complet: every document, attached or not', async () => {
    activeLink('complet')
    documentFindMany.mockResolvedValue(documentRows)
    const res = await request(app.getHttpServer())
      .get('/v1/shares/abc')
      .set('Authorization', `Bearer ${await jwtFor(users[0])}`)
      .expect(200)
    expect(listedFiles(res.body)).toEqual([
      'annexe.pdf',
      'brevet.pdf',
      'kbis.pdf',
      'previsionnel.xlsx',
    ])
  })

  it('GET /v1/shares/:token — complet: everything + documents', async () => {
    activeLink('complet')
    const res = await request(app.getHttpServer())
      .get('/v1/shares/abc')
      .set('Authorization', `Bearer ${await jwtFor(users[0])}`)
      .expect(200)

    expect(res.body.answers).toHaveLength(3)
    expect(res.body.dossier.axe2Financier).toBe(4)
    expect(res.body.documents).toEqual([])
  })

  it('GET /v1/shares/:token — complet with a lost stored file still answers 200 (url null)', async () => {
    activeLink('complet')
    // Metadata survives in DB, the in-memory object is gone (API restarted).
    documentFindMany.mockResolvedValue([
      asDocument({
        id: 'doc-1',
        filename: 'bp.pdf',
        version: 1,
        storageKey: 'dossiers/d-1/bp.pdf-v1',
        mimetype: 'application/pdf',
        size: 42,
        createdAt: new Date('2026-11-01'),
      }),
    ])
    const res = await request(app.getHttpServer())
      .get('/v1/shares/abc')
      .set('Authorization', `Bearer ${await jwtFor(users[0])}`)
      .expect(200)

    expect(res.body.answers).toHaveLength(3)
    expect(res.body.documents).toHaveLength(1)
    expect(res.body.documents[0]).toMatchObject({ filename: 'bp.pdf', current: { url: null } })
  })

  describe('recipient identity (E02.08)', () => {
    it('the recipient’s session gets the content; another account gets 403 recipient_mismatch', async () => {
      activeLink('complet')
      await request(app.getHttpServer())
        .get('/v1/shares/abc')
        .set('Authorization', `Bearer ${await jwtFor(users[0])}`)
        .expect(200)
      const other = await request(app.getHttpServer())
        .get('/v1/shares/abc')
        .set('Authorization', `Bearer ${await jwtFor(users[1])}`)
        .expect(403)
      expect(other.body.error.details).toEqual({ reason: 'recipient_mismatch' })
      expect(other.body.answers).toBeUndefined()
    })

    it('without a session: 401, no content and no view counted (E02.08 3/3)', async () => {
      activeLink('complet')
      const res = await request(app.getHttpServer()).get('/v1/shares/abc').expect(401)
      expect(res.body.answers).toBeUndefined()
      expect(auditRecord).not.toHaveBeenCalledWith(
        expect.objectContaining({ actionType: 'share_link_viewed' }),
      )
    })

    it('an invalid token is a 401 (the client refreshes), never treated as anonymous', async () => {
      activeLink('complet')
      await request(app.getHttpServer())
        .get('/v1/shares/abc')
        .set('Authorization', 'Bearer not-a-jwt')
        .expect(401)
    })

    it('access-request sends a sign-in link only for the recipient’s address, same answer either way', async () => {
      activeLink('complet')
      const wrong = await request(app.getHttpServer())
        .post('/v1/shares/abc/access-request')
        .send({ email: 'eve@other.fr' })
        .expect(202)
      expect(sendMagicLink).not.toHaveBeenCalled()
      const right = await request(app.getHttpServer())
        .post('/v1/shares/abc/access-request')
        .send({ email: 'Bob@Invest.fr' })
        .expect(202)
      expect(right.body).toEqual(wrong.body)
      expect(sendMagicLink).toHaveBeenCalledWith(expect.objectContaining({ to: 'bob@invest.fr' }))
    })

    it('access-request on a revoked link is refused', async () => {
      shareFindUnique.mockResolvedValue({
        id: 'sl-9',
        token: 'rev',
        status: 'revoked',
        dossierId: 'd-1',
        recipientEmail: 'bob@invest.fr',
      })
      await request(app.getHttpServer())
        .post('/v1/shares/rev/access-request')
        .send({ email: 'bob@invest.fr' })
        .expect(403)
      expect(sendMagicLink).not.toHaveBeenCalled()
    })
  })

  it('GET /v1/shares/:token — unknown token: 403 + deny audit', async () => {
    shareFindUnique.mockResolvedValue(null)
    const res = await request(app.getHttpServer())
      .get('/v1/shares/unknown')
      .set('Authorization', `Bearer ${await jwtFor(users[0])}`)
      .expect(403)
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
    await request(app.getHttpServer())
      .get('/v1/shares/rev')
      .set('Authorization', `Bearer ${await jwtFor(users[0])}`)
      .expect(403)
    expect(auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: 'share_link_access_denied',
        metadata: expect.objectContaining({ reason: 'revoked' }),
      }),
    )
  })
})
