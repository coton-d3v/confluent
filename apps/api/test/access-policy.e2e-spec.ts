import type { AddressInfo } from 'node:net'
import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { ZodValidationPipe } from 'nestjs-zod'
import request from 'supertest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import {
  financeurShareResponseSchema,
  opportunitiesSchema,
  opportunitySchema,
  sharePreviewSchema,
  type AccessLevel,
} from '@confluent/shared'
import { AppModule } from './../src/app.module'
import { GlobalExceptionFilter } from './../src/common/filters/global-exception.filter'
import { PrismaService } from './../src/prisma/prisma.service'
import { EMAIL_TRANSPORT } from './../src/modules/auth/email/email-transport'
import { mountOAuthServer } from './../src/modules/oauth/oauth.http'
import { mountMcpEndpoint } from './../src/modules/mcp/mcp.http'
import { hashToken } from './../src/modules/oauth/oauth.constants'
import { createFakePrisma, selectWholeLibrary } from '../src/testing/fake-prisma'
import { DEFAULT_CLASSIFICATION_RULES } from '../src/testing/classification-rules.fixture'
import { classificationSources } from '../src/modules/classification/classification-sources'

const id = (n: number) => `7d3c1b0e-0000-4000-8000-${n.toString().padStart(12, '0')}`
const FUTURE = new Date(Date.now() + 3600_000)
// Sophie owns Biosensio. Bob: a financeur she shares it with by a nominative link. Ivy: an
// investisseur of the CCI, whose pool Biosensio is published to. Eve: neither.
const SOPHIE = { id: id(1), email: 'sophie@biosensio.fr', role: 'entrepreneur' }
const BOB = { id: id(2), email: 'bob@invest.fr', role: 'financeur' }
const IVY = { id: id(3), email: 'ivy@angels.fr', role: 'financeur' }
const EVE = { id: id(4), email: 'eve@fonds.fr', role: 'financeur' }
const ADMIN = { id: id(5), email: 'admin@confluent.fr', role: 'admin' }
const PEOPLE = [SOPHIE, BOB, IVY, EVE, ADMIN]
const VERSION = id(100)
const OLD_VERSION = id(101)
const LEVELS: AccessLevel[] = ['public', 'partiel', 'complet']

// The profile's version: a question and an attachment question per level, each level in its own
// section, and the fields the classification rules read.
const SECTIONS = [
  { id: id(200), key: 'identite', title: 'Identité du projet', orderIndex: 0 },
  { id: id(201), key: 'projet', title: 'Projet', orderIndex: 1 },
  { id: id(202), key: 'financier', title: 'Stade financier', orderIndex: 2 },
]
const FIELDS = [
  { id: id(300), sectionId: id(200), key: 'nom', label: 'Nom', minAccessLevel: 'public' },
  { id: id(301), sectionId: id(200), key: 'secteur', label: 'Secteur', minAccessLevel: 'public' },
  {
    id: id(302),
    sectionId: id(201),
    key: 'stade_projet',
    label: 'Stade',
    minAccessLevel: 'partiel',
  },
  {
    id: id(303),
    sectionId: id(201),
    key: 'origine_projet',
    label: 'Origine',
    minAccessLevel: 'partiel',
  },
  {
    id: id(304),
    sectionId: id(202),
    key: 'stade_financement',
    label: 'Financement',
    minAccessLevel: 'complet',
  },
  { id: id(305), sectionId: id(200), key: 'kbis', label: 'Kbis', minAccessLevel: 'public' },
  { id: id(306), sectionId: id(201), key: 'brevet', label: 'Brevet', minAccessLevel: 'partiel' },
  {
    id: id(307),
    sectionId: id(202),
    key: 'previsionnel',
    label: 'Prévisionnel',
    minAccessLevel: 'complet',
  },
].map((f) => ({
  ...f,
  fieldType: ['kbis', 'brevet', 'previsionnel'].includes(f.key) ? 'file' : 'text',
}))
// A question of another version of the profile, answered before: no version of the request asks it.
const OLD_FIELD = id(399)

type Doc = { id: string; fieldId: string | null; current: { id: string }; versions: object[] }
type View = {
  dossier: Record<string, unknown>
  sections: Array<{ id: string; title: string }>
  fields: Array<{ id: string; sectionId: string; fieldType: string }>
  answers: Array<{ fieldId: string; value: string }>
  documents: Doc[]
}

// ROADMAP E07.04 — the recipe of the reading policy across every channel through which a financeur
// or an investor reads a funding request, over HTTP and the official MCP client on the stateful fake
// Prisma. The reference is the recipient's page of a nominative link (`GET /v1/shares/:token`, THE
// projection `ShareLinksService.recipientView`); at each level, every other channel shows exactly
// its questions, answers, classification, presentation and documents — nothing more — and stops at
// the next request once the access is revoked, the publication withdrawn or paused.
describe('Reading policy across channels (e2e, E07.04)', () => {
  let app: INestApplication
  let fake: ReturnType<typeof createFakePrisma>
  let base: string
  let cci: string
  const tokens: Record<string, string> = {}
  let tokenCount = 0

  beforeEach(async () => {
    fake = createFakePrisma()
    const p = fake.prisma
    for (const u of PEOPLE) await p.user.create({ data: { ...u, emailVerifiedAt: new Date() } })
    await p.oAuthClient.create({
      data: { id: 'client-claude', source: 'dcr', name: 'Claude', redirectUris: [], metadata: {} },
    })
    await p.questionnaire.create({
      data: { id: id(90), slug: 'dossier', name: 'Profil', usage: 'dossier' },
    })
    await p.questionnaireVersion.create({
      data: { id: OLD_VERSION, questionnaireId: id(90), version: 1, status: 'archived' },
    })
    await p.questionnaireVersion.create({
      data: { id: VERSION, questionnaireId: id(90), version: 2, status: 'published' },
    })
    for (const s of SECTIONS) {
      await p.questionnaireSection.create({ data: { ...s, versionId: VERSION } })
    }
    for (const [i, f] of FIELDS.entries()) {
      await p.questionnaireField.create({ data: { orderIndex: i, ...f, versionId: VERSION } })
    }
    await p.questionnaireSection.create({
      data: { id: id(203), versionId: OLD_VERSION, key: 'ancien', title: 'Ancien', orderIndex: 0 },
    })
    await p.questionnaireField.create({
      data: {
        id: OLD_FIELD,
        versionId: OLD_VERSION,
        sectionId: id(203),
        key: 'ancien_chiffre',
        label: 'Ancien chiffre',
        fieldType: 'text',
        minAccessLevel: 'public',
        orderIndex: 0,
      },
    })
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(p)
      .overrideProvider(EMAIL_TRANSPORT)
      .useValue({
        sendMagicLink: jest.fn(),
        sendShareInvite: jest.fn().mockResolvedValue(undefined),
        sendWorkspaceInvite: jest.fn().mockResolvedValue(undefined),
      })
      .compile()
    app = moduleFixture.createNestApplication()
    mountOAuthServer(app)
    mountMcpEndpoint(app)
    app.setGlobalPrefix('v1', { exclude: ['/'] })
    app.useGlobalPipes(new ZodValidationPipe())
    app.useGlobalFilters(new GlobalExceptionFilter())
    await app.listen(0)
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`
    for (const u of PEOPLE) {
      tokens[u.id] = await new JwtService().signAsync(
        { sub: u.id, email: u.email, role: u.role },
        { secret: process.env.JWT_SECRET },
      )
    }
    const admin = as(ADMIN)
    cci = (await admin.post('/v1/admin/workspaces', { name: 'CCI Touraine' }).expect(201)).body.id
    await admin
      .post(`/v1/admin/workspaces/${cci}/members`, { email: IVY.email, role: 'investisseur' })
      .expect(201)
    const form = await p.questionnaire.create({
      data: { slug: 'form-cci', name: 'Candidature CCI', workspaceId: cci, usage: 'candidature' },
    })
    await p.questionnaireVersion.create({
      data: { questionnaireId: form.id, version: 1, status: 'published' },
    })
  })

  afterEach(async () => {
    await app.close()
  })

  const as = (u: { id: string }) => {
    const auth = () => `Bearer ${tokens[u.id]}`
    return {
      get: (url: string) => request(app.getHttpServer()).get(url).set('Authorization', auth()),
      post: (url: string, body?: object) =>
        request(app.getHttpServer()).post(url).set('Authorization', auth()).send(body),
      put: (url: string, body: object) =>
        request(app.getHttpServer()).put(url).set('Authorization', auth()).send(body),
      patch: (url: string, body: object) =>
        request(app.getHttpServer()).patch(url).set('Authorization', auth()).send(body),
      delete: (url: string) =>
        request(app.getHttpServer()).delete(url).set('Authorization', auth()),
      upload: (dossierId: string, filename: string, fieldId?: string) => {
        const req = request(app.getHttpServer())
          .post(`/v1/dossiers/${dossierId}/documents`)
          .set('Authorization', auth())
        if (fieldId) void req.field('fieldId', fieldId)
        return req.attach('file', Buffer.from(`%PDF-1.4 ${filename}`), filename)
      },
    }
  }
  const sophie = as(SOPHIE)
  const valid = (
    schema: { safeParse: (v: unknown) => { error?: { issues: unknown[] } } },
    v: unknown,
  ) => expect(schema.safeParse(v).error?.issues ?? []).toEqual([])

  // An MCP connection of `user`, every reading scope, allowed to reach the CCI.
  async function mcp(user: { id: string }) {
    const token = `cfl_at_policy_${++tokenCount}`
    const scopes = ['dossiers:read', 'candidatures:read', 'candidatures:support']
    const grant = await fake.prisma.oAuthGrant.create({
      data: {
        userId: user.id,
        clientId: 'client-claude',
        scopes,
        workspaceIds: [cci],
        resource: 'http://localhost:3000/mcp',
        expiresAt: FUTURE,
      },
    })
    await fake.prisma.oAuthToken.create({
      data: {
        grantId: grant.id,
        kind: 'access',
        tokenHash: hashToken(token),
        scopes,
        expiresAt: FUTURE,
      },
    })
    const c = new Client({ name: 'policy-recipe', version: '1.0.0' })
    await c.connect(
      new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      }),
    )
    return async (name: string, args: Record<string, unknown> = {}) => {
      const res = (await c.callTool({ name, arguments: args })) as {
        isError?: boolean
        content: Array<{ text: string }>
      }
      return res.isError
        ? { error: res.content[0].text, result: null as never }
        : { error: null, result: JSON.parse(res.content[0].text) as Record<string, any> }
    }
  }

  // Biosensio: profile answered at every level (and a question of a former version), classified,
  // presented and published; five documents in its company's library — one per attachment question
  // (the Kbis in two versions, the request pinned to the first), one without question, and one the
  // request does not present. Sent to the CCI, its candidature published to the CCI's pool at
  // `poolLevel`.
  async function biosensio(poolLevel: AccessLevel) {
    const dossier = (await sophie.post('/v1/dossiers', { name: 'Biosensio' }).expect(201)).body
    const answers: Record<string, string> = {
      [id(300)]: 'NOM-Biosensio',
      [id(301)]: 'Biotech',
      [id(302)]: 'STADE-MVP',
      [id(303)]: 'ORIGINE-Spin-off',
      [id(304)]: 'FINANCEMENT-SECRET-Seed',
      [OLD_FIELD]: 'ANCIEN-CHIFFRE-SECRET',
    }
    for (const [fieldId, value] of Object.entries(answers)) {
      await fake.prisma.dossierAnswer.create({
        data: { companyId: dossier.companyId, fieldId, value },
      })
    }
    Object.assign(fake.table('dossier').get(dossier.id)!, {
      submittedAt: new Date(),
      sector: 'biotech',
      maturityStage: 'MVP',
      ancrageCvl: 'ancré',
      tagTechnologique: 'deeptech',
      axe1Projet: 3,
      axe2Financier: 4,
      axe3Origine: 3,
      deeptechScore: 3,
      preCreation: false,
      classificationSources: classificationSources(
        DEFAULT_CLASSIFICATION_RULES,
        new Set(['nom', 'secteur', 'stade_projet', 'origine_projet', 'stade_financement']),
      ),
    })
    await sophie
      .patch(`/v1/dossiers/${dossier.id}`, {
        summary: 'Capteurs pour l’agriculture.',
        objective: 'Industrialiser',
        description: 'Une levée pour la première usine.',
        amountEur: 300_000,
        financingTypes: ['equity'],
      })
      .expect(200)
    await sophie.post(`/v1/dossiers/${dossier.id}/publish`).expect(200)
    const kbis1 = (await sophie.upload(dossier.id, 'kbis.pdf', id(305)).expect(201)).body
    await sophie.upload(dossier.id, 'kbis.pdf', id(305)).expect(201)
    await sophie.upload(dossier.id, 'brevet.pdf', id(306)).expect(201)
    await sophie.upload(dossier.id, 'previsionnel.pdf', id(307)).expect(201)
    await sophie.upload(dossier.id, 'annexe.pdf').expect(201)
    const notes = (await sophie.upload(dossier.id, 'notes-internes.pdf').expect(201)).body
    await selectWholeLibrary(fake.prisma, dossier)
    for (const [key, row] of fake.table('dossierDocument')) {
      if (row.libraryDocumentId === notes.documentId) fake.table('dossierDocument').delete(key)
      if (row.libraryDocumentId === kbis1.documentId) row.pinnedVersionId = kbis1.id
    }
    const candidature = (
      await sophie.post(`/v1/dossiers/${dossier.id}/candidatures`, { workspaceId: cci }).expect(201)
    ).body
    await sophie.post(`/v1/candidatures/${candidature.id}/submit`).expect(200)
    await publishToPool(candidature.id, poolLevel)
    return {
      id: dossier.id as string,
      slug: dossier.slug as string,
      companyId: dossier.companyId as string,
      candidatureId: candidature.id as string,
    }
  }
  const publishToPool = (candidatureId: string, accessLevel: AccessLevel) =>
    sophie
      .put(`/v1/candidatures/${candidatureId}/pool-publication`, { accessLevel, consent: true })
      .expect(200)
  const invite = async (dossierId: string, accessLevel: AccessLevel) =>
    (
      await sophie
        .post(`/v1/dossiers/${dossierId}/shares`, { recipientEmail: BOB.email, accessLevel })
        .expect(201)
    ).body as { id: string; token: string }

  // What every channel must agree on, in one comparable shape: the request's classification and
  // presentation, its questions (by section), its answers and its documents at their version.
  const noUrl = (d: Doc) => ({
    ...d,
    current: { ...d.current, url: null },
    versions: d.versions.map((v) => ({ ...v, url: null })),
  })
  const contentOf = (view: View) => ({
    dossier: view.dossier,
    sections: view.sections.map((s) => s.id),
    fields: view.fields.map((f) => f.id),
    answers: [...view.answers].sort((a, b) => a.fieldId.localeCompare(b.fieldId)),
    documents: view.documents.map(noUrl),
  })
  const answersOf = (rows: Array<{ fieldId: string; value: string }>) =>
    rows
      .map((a) => ({ fieldId: a.fieldId, value: a.value }))
      .sort((a, b) => a.fieldId.localeCompare(b.fieldId))

  // The recipient's page of the link: THE reference.
  async function recipientPage(token: string): Promise<View> {
    const body = (await as(BOB).get(`/v1/shares/${token}`).expect(200)).body
    valid(financeurShareResponseSchema, body)
    const { share: _share, ...view } = body
    expect(Object.keys(body).sort()).toEqual([
      'answers',
      'documents',
      'dossier',
      'fields',
      'sections',
      'share',
    ])
    return view
  }

  // Every way a reader at `level` reads Biosensio — Bob through his link, Ivy through the pool —
  // compared with the recipient's page.
  async function expectSameEverywhere(
    dossier: Awaited<ReturnType<typeof biosensio>>,
    token: string,
    level: AccessLevel,
  ) {
    const reference = await recipientPage(token)
    const expected = contentOf(reference)
    const projected = reference.dossier

    // The owner's preview « Voir comme le destinataire » (no file delivered).
    const preview = (
      await sophie.get(`/v1/dossiers/${dossier.id}/share-preview?level=${level}`).expect(200)
    ).body
    valid(sharePreviewSchema, preview)
    expect(preview.preview.accessLevel).toBe(level)
    expect(contentOf(preview)).toEqual(expected)

    // The opportunity, through the direct share and through the pool.
    for (const reader of [BOB, IVY]) {
      const body = (await as(reader).get(`/v1/opportunities/${dossier.id}`).expect(200)).body
      valid(opportunitySchema, body)
      const { opportunity, ...view } = body
      expect(Object.keys(view).sort()).toEqual([
        'answers',
        'documents',
        'dossier',
        'fields',
        'sections',
      ])
      expect(opportunity.accessLevel).toBe(level)
      expect(contentOf(view)).toEqual(expected)
      // The opportunities list: its card is the same projection.
      const listed = (await as(reader).get('/v1/opportunities').expect(200)).body
      valid(opportunitiesSchema, listed)
      expect(listed.items).toHaveLength(1)
      const { dossier: card } = listed.items[0]
      for (const [key, value] of Object.entries(card))
        expect([key, value]).toEqual([key, projected[key]])
      expect(listed.counts.sectors).toEqual(
        projected.sector ? [{ value: projected.sector, count: 1 }] : [],
      )
    }

    // The site's REST reading of a shared request: detail, answers, documents and list.
    const bob = as(BOB)
    const detail = (await bob.get(`/v1/dossiers/${dossier.id}`).expect(200)).body
    const { questionnaireVersion, ...row } = detail
    for (const [key, value] of Object.entries(projected))
      expect([key, row[key]]).toEqual([key, value])
    // Besides the projection, only the request's technical identifiers and dates.
    expect(
      Object.keys(row)
        .filter((k) => !(k in projected))
        .sort(),
    ).toEqual([
      'archivedAt',
      'classificationSources',
      'companyId',
      'createdAt',
      'questionnaireVersionId',
      'submittedAt',
      'updatedAt',
      'userId',
    ])
    expect(row.classificationSources).toBeNull()
    expect(questionnaireVersion.fields.map((f: { id: string }) => f.id)).toEqual(expected.fields)
    expect(questionnaireVersion.sections.map((s: { id: string }) => s.id)).toEqual(
      expected.sections,
    )
    const answers = (await bob.get(`/v1/dossiers/${dossier.id}/answers`).expect(200)).body
    expect(answersOf(answers)).toEqual(expected.answers)
    for (const a of answers) {
      expect(Object.keys(a).sort()).toEqual([
        'createdAt',
        'dossierId',
        'fieldId',
        'id',
        'updatedAt',
        'value',
      ])
    }
    const documents = (await bob.get(`/v1/dossiers/${dossier.id}/documents`).expect(200)).body
    expect(documents.map(noUrl)).toEqual(expected.documents)
    const mine = (await bob.get('/v1/dossiers').expect(200)).body
    expect(mine).toHaveLength(1)
    const { ownerEmail, ownerName: _ownerName, ...entry } = mine[0]
    expect(ownerEmail).toBe(SOPHIE.email)
    for (const [key, value] of Object.entries(projected))
      expect([key, entry[key]]).toEqual([key, value])

    // MCP, for the recipient of the link.
    const call = await mcp(BOB)
    const read = await call('get_dossier', { dossier: dossier.slug })
    expect(read.error).toBeNull()
    const got = read.result
    expect(got.dossier).toMatchObject({ relation: 'partage', accessLevel: level })
    expect(got.dossier).not.toHaveProperty('companyId')
    expect(got.dossier.classification).toEqual({
      sector: projected.sector,
      maturityStage: projected.maturityStage,
      ancrageCvl: projected.ancrageCvl,
      tagTechnologique: projected.tagTechnologique,
    })
    expect(got.dossier.presentation).toMatchObject({
      summary: projected.summary,
      objective: projected.objective,
      description: projected.description,
      amountEur: projected.amountEur,
      financingTypes: projected.financingTypes,
    })
    expect(got.sections.map((s: { title: string }) => s.title)).toEqual(
      reference.sections.map((s) => s.title),
    )
    const mcpFields = got.sections.flatMap((s: { fields: object[] }) => s.fields) as Array<{
      fieldId: string
      answer?: string | null
      documents?: Array<{ documentId: string }>
      provenance?: unknown
      readLevel?: unknown
    }>
    expect(mcpFields.map((f) => f.fieldId)).toEqual(expected.fields)
    expect(
      answersOf(
        mcpFields.flatMap((f) => (f.answer ? [{ fieldId: f.fieldId, value: f.answer }] : [])),
      ),
    ).toEqual(expected.answers)
    for (const f of mcpFields) {
      expect(f).not.toHaveProperty('provenance')
      expect(f).not.toHaveProperty('readLevel')
      if (!f.documents) continue
      expect(f.documents.map((d) => d.documentId)).toEqual(
        reference.documents.filter((d) => d.fieldId === f.fieldId).map((d) => d.current.id),
      )
    }
    const listedDocs = await call('list_documents', { dossier: dossier.slug })
    expect(listedDocs.error).toBeNull()
    const mcpDocs = [
      ...listedDocs.result.expected.flatMap((q: { documents: object[] }) => q.documents),
      ...listedDocs.result.otherDocuments,
    ] as Array<{ documentId: string; previousVersions?: unknown }>
    expect(mcpDocs.map((d) => d.documentId).sort()).toEqual(
      reference.documents.map((d) => d.current.id).sort(),
    )
    for (const d of mcpDocs) expect(d).not.toHaveProperty('previousVersions')
    // Every version of the library: readable through MCP exactly when the page lists it.
    const shown = new Set(reference.documents.map((d) => d.current.id))
    for (const version of fake.table('document').values()) {
      const text = await call('read_document', { dossier: dossier.slug, documentId: version.id })
      expect([version.filename, version.version, text.error === null]).toEqual([
        version.filename,
        version.version,
        shown.has(version.id),
      ])
    }
    const dossiers = await call('list_dossiers')
    expect(dossiers.result.dossiers).toEqual([
      expect.objectContaining({
        id: dossier.id,
        relation: 'partage',
        sector: projected.sector,
        maturityStage: projected.maturityStage,
      }),
    ])
    return reference
  }

  it.each(LEVELS)(
    'shows the same projection at the %s level through every channel',
    async (level) => {
      const dossier = await biosensio(level)
      const link = await invite(dossier.id, level)
      const reference = await expectSameEverywhere(dossier, link.token, level)

      // What the level means, read on the reference itself.
      const fieldsAt: Record<AccessLevel, number[]> = {
        public: [300, 301, 305],
        partiel: [300, 301, 302, 303, 305, 306],
        complet: [300, 301, 302, 303, 304, 305, 306, 307],
      }
      expect(reference.fields.map((f) => f.id).sort()).toEqual(fieldsAt[level].map(id))
      // A section none of whose questions the level reads is not named either.
      expect(reference.sections.map((s) => s.title)).toEqual(
        ['Identité du projet', 'Projet', 'Stade financier'].slice(0, LEVELS.indexOf(level) + 1),
      )
      // Never an answer to a question the request's version does not ask, whatever the level.
      expect(reference.answers.map((a) => a.value)).not.toContain('ANCIEN-CHIFFRE-SECRET')
      // The document the request does not present, and the Kbis' unpinned version, never.
      const filenames = reference.documents.map(
        (d) => d.versions.length + ':' + (d as unknown as { filename: string }).filename,
      )
      expect(filenames.sort()).toEqual(
        {
          public: ['1:kbis.pdf'],
          partiel: ['1:brevet.pdf', '1:kbis.pdf'],
          complet: ['1:annexe.pdf', '1:brevet.pdf', '1:kbis.pdf', '1:previsionnel.pdf'],
        }[level],
      )
      expect(reference.dossier).toMatchObject({
        name: 'Biosensio',
        summary: 'Capteurs pour l’agriculture.',
        amountEur: 300_000,
        // Computed from a complete question: hidden below `complet`.
        axe2Financier: level === 'complet' ? 4 : null,
      })
    },
  )

  it('follows a change of the link’s level and of the pool’s at the next request, everywhere', async () => {
    const dossier = await biosensio('complet')
    const link = await invite(dossier.id, 'complet')
    await expectSameEverywhere(dossier, link.token, 'complet')
    await sophie
      .patch(`/v1/dossiers/${dossier.id}/shares/${link.id}`, { accessLevel: 'public' })
      .expect(200)
    await publishToPool(dossier.candidatureId, 'public')
    const reference = await expectSameEverywhere(dossier, link.token, 'public')
    expect(reference.fields.map((f) => f.id).sort()).toEqual([300, 301, 305].map(id))
  })

  it('reaches a link whatever the case of its stored address, through every channel', async () => {
    const dossier = await biosensio('partiel')
    const link = await invite(dossier.id, 'partiel')
    // An address stored before invitations were lowercased (E07.01): the link's own rule and the
    // opportunities compare addresses without case; the site's REST reading and MCP must too.
    fake.table('shareLink').get(link.id)!.recipientEmail = 'Bob@Invest.FR'
    await expectSameEverywhere(dossier, link.token, 'partiel')
  })

  it('stops every channel at the next request once the access is revoked, withdrawn or paused', async () => {
    const dossier = await biosensio('complet')
    const link = await invite(dossier.id, 'complet')
    const bobCalls = await mcp(BOB)
    expect((await bobCalls('get_dossier', { dossier: dossier.slug })).error).toBeNull()
    const kbis = [...fake.table('document').values()].find((d) => d.filename === 'brevet.pdf')!

    // E07.05: Bob marks his interest, by name; his mark counts while he reads the request.
    await as(BOB).put(`/v1/opportunities/${dossier.id}/interest`, { nameVisible: true }).expect(200)
    const interests = async () =>
      (await sophie.get(`/v1/dossiers/${dossier.id}/interests`).expect(200)).body.count
    expect(await interests()).toBe(1)
    // E07.06: and pledges, his amount hidden; his pledge counts while he reads the request.
    const pledge = { intention: 'likely', amountEur: 40_000, showName: true, showAmount: false }
    await as(BOB)
      .put(`/v1/opportunities/${dossier.id}/pledge`, { ...pledge, version: null })
      .expect(200)
    const pledges = async () => {
      const body = (await sophie.get(`/v1/dossiers/${dossier.id}/pledges`).expect(200)).body
      return [body.count, body.totalEur]
    }
    expect(await pledges()).toEqual([1, 40_000])

    // Revoked by the owner: nothing more for Bob, from the same MCP connection too.
    await sophie.delete(`/v1/dossiers/${dossier.id}/shares/${link.id}`).expect(200)
    expect(await interests()).toBe(0)
    expect(await pledges()).toEqual([0, 0])
    const bob = as(BOB)
    await bob.get(`/v1/shares/${link.token}`).expect(403)
    await bob.get(`/v1/opportunities/${dossier.id}`).expect(404)
    // E07.05: no mark of interest on what is no longer read.
    await bob.put(`/v1/opportunities/${dossier.id}/interest`, { nameVisible: false }).expect(404)
    // E07.06: no new pledge nor change on what is no longer read.
    await bob
      .put(`/v1/opportunities/${dossier.id}/pledge`, { ...pledge, amountEur: 50_000, version: 1 })
      .expect(404)
    expect((await bob.get('/v1/opportunities').expect(200)).body.total).toBe(0)
    await bob.get(`/v1/dossiers/${dossier.id}`).expect(404)
    await bob.get(`/v1/dossiers/${dossier.id}/answers`).expect(404)
    await bob.get(`/v1/dossiers/${dossier.id}/documents`).expect(404)
    expect((await bob.get('/v1/dossiers').expect(200)).body).toEqual([])
    for (const [tool, args] of [
      ['get_dossier', { dossier: dossier.slug }],
      ['get_dossier', { dossier: dossier.id }],
      ['list_documents', { dossier: dossier.slug }],
      ['read_document', { dossier: dossier.slug, documentId: kbis.id }],
    ] as const) {
      expect([tool, (await bobCalls(tool, args)).error]).toEqual([
        tool,
        expect.stringMatching(/introuvable/i),
      ])
    }
    expect((await bobCalls('list_dossiers')).result.dossiers).toEqual([])
    // The pool is another consent: Ivy still reads it.
    const ivy = as(IVY)
    await ivy.get(`/v1/opportunities/${dossier.id}`).expect(200)

    // Withdrawn from the pool, then published again.
    await sophie.delete(`/v1/candidatures/${dossier.candidatureId}/pool-publication`).expect(200)
    await ivy.get(`/v1/opportunities/${dossier.id}`).expect(404)
    await ivy.put(`/v1/opportunities/${dossier.id}/interest`, { nameVisible: false }).expect(404)
    await ivy
      .put(`/v1/opportunities/${dossier.id}/pledge`, { ...pledge, version: null })
      .expect(404)
    expect((await ivy.get('/v1/opportunities').expect(200)).body.total).toBe(0)
    await publishToPool(dossier.candidatureId, 'complet')
    await ivy.get(`/v1/opportunities/${dossier.id}`).expect(200)

    // Paused while the request is unpublished; listed again once it is published.
    await sophie.post(`/v1/dossiers/${dossier.id}/unpublish`).expect(200)
    await ivy.get(`/v1/opportunities/${dossier.id}`).expect(404)
    expect((await ivy.get('/v1/opportunities').expect(200)).body.total).toBe(0)
    await sophie.post(`/v1/dossiers/${dossier.id}/publish`).expect(200)
    await ivy.get(`/v1/opportunities/${dossier.id}`).expect(200)

    // Archived: withdrawn from every pool.
    await sophie.post(`/v1/dossiers/${dossier.id}/archive`).expect(200)
    await ivy.get(`/v1/opportunities/${dossier.id}`).expect(404)
  })

  it('opens nothing else of the request to its readers: neither the structure’s follow-up nor the owner’s tools', async () => {
    const dossier = await biosensio('complet')
    const link = await invite(dossier.id, 'complet')
    await recipientPage(link.token)
    const candidature = `/v1/candidatures/${dossier.candidatureId}`
    const received = `/v1/workspaces/${cci}/candidatures/${dossier.candidatureId}`
    const refused = [
      `/v1/dossiers/${dossier.id}/analytics`,
      `/v1/dossiers/${dossier.id}/audit-log`,
      `/v1/dossiers/${dossier.id}/candidatures`,
      `/v1/dossiers/${dossier.id}/shares`,
      `/v1/dossiers/${dossier.id}/share-preview?level=public`,
      // E07.05: the marks of interest are their owner's to read.
      `/v1/dossiers/${dossier.id}/interests`,
      // E07.06: and so are the pledges.
      `/v1/dossiers/${dossier.id}/pledges`,
      `/v1/companies/${dossier.companyId}`,
      candidature,
      `${candidature}/funding-plan`,
      `${candidature}/eligibilities`,
      `${candidature}/support-path`,
      `/v1/workspaces/${cci}/candidatures`,
      received,
      `${received}/funding-plan`,
      `${received}/eligibilities`,
      `${received}/support-path`,
      `${received}/interventions`,
      `/v1/workspaces/${cci}/portfolio`,
    ]
    for (const reader of [BOB, IVY, EVE]) {
      for (const url of refused) {
        const { status } = await as(reader).get(url)
        expect([reader.email, url, [403, 404].includes(status)]).toEqual([reader.email, url, true])
      }
    }
    // A pool's investors read it as an opportunity only (MCP: E07.10), never as a shared request.
    for (const reader of [IVY, EVE]) {
      for (const url of ['', '/answers', '/documents']) {
        await as(reader).get(`/v1/dossiers/${dossier.id}${url}`).expect(404)
      }
      expect((await as(reader).get('/v1/dossiers').expect(200)).body).toEqual([])
    }
    for (const reader of [BOB, IVY, EVE]) {
      const call = await mcp(reader)
      const reads = [
        ['list_candidatures', { dossier: dossier.slug }],
        ['get_candidature', { candidature: dossier.candidatureId }],
        ['list_received_candidatures', { workspace: cci }],
        ['get_received_candidature', { workspace: cci, candidature: dossier.candidatureId }],
        ['get_funding_plan', { candidature: dossier.candidatureId, workspace: cci }],
        ['list_eligibilities', { candidature: dossier.candidatureId, workspace: cci }],
        ['get_support_path', { candidature: dossier.candidatureId, workspace: cci }],
        ['get_portfolio', { workspace: cci }],
        ['get_intervention_journal', { candidature: dossier.candidatureId, workspace: cci }],
        ['next_questions', { dossier: dossier.slug }],
      ] as const
      for (const [tool, args] of reads) {
        const res = await call(tool, args)
        expect([reader.email, tool, res.error]).toEqual([reader.email, tool, expect.any(String)])
      }
      // Their own companies: none.
      expect((await call('list_companies')).result.companies).toEqual([])
      if (reader !== BOB) {
        expect((await call('get_dossier', { dossier: dossier.slug })).error).toMatch(/introuvable/i)
      }
    }
  })
})
