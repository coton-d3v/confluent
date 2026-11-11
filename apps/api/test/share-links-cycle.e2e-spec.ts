import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { ZodValidationPipe } from 'nestjs-zod'
import request from 'supertest'
import type { App } from 'supertest/types'
import {
  financeurShareResponseSchema,
  shareAccessSchema,
  sharePreviewSchema,
  type AccessLevel,
} from '@confluent/shared'
import { AppModule } from './../src/app.module'
import { GlobalExceptionFilter } from './../src/common/filters/global-exception.filter'
import { PrismaService } from './../src/prisma/prisma.service'
import { EMAIL_TRANSPORT } from './../src/modules/auth/email/email-transport'
import { createFakePrisma, selectWholeLibrary } from '../src/testing/fake-prisma'
import { DEFAULT_CLASSIFICATION_RULES } from '../src/testing/classification-rules.fixture'
import { classificationSources } from '../src/modules/classification/classification-sources'

const id = (n: number) => `7d3c1b0e-0000-4000-8000-${n.toString().padStart(12, '0')}`
const SOPHIE = { id: id(1), email: 'sophie@biosensio.fr', role: 'entrepreneur' }
const MARC = { id: id(2), email: 'marc@agrotech.fr', role: 'entrepreneur' }
const BOB = { id: id(3), email: 'bob@invest.fr', role: 'financeur' }
const EVE = { id: id(4), email: 'eve@fonds.fr', role: 'financeur' }
const ADMIN = { id: id(5), email: 'admin@confluent.fr', role: 'admin' }
// A conseiller managing a workspace: no right on a request's shares (E07.01).
const CLAIRE = { id: id(6), email: 'claire@cci.fr', role: 'financeur' }
const VERSION = id(100)
const LEVELS: AccessLevel[] = ['public', 'partiel', 'complet']

// The profile's version: one question per level, an attachment question per level, and the fields
// the classification rules read.
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
  {
    id: id(305),
    sectionId: id(200),
    key: 'kbis',
    label: 'Kbis',
    minAccessLevel: 'public',
    fieldType: 'file',
  },
  {
    id: id(306),
    sectionId: id(201),
    key: 'brevet',
    label: 'Brevet',
    minAccessLevel: 'partiel',
    fieldType: 'file',
  },
  {
    id: id(307),
    sectionId: id(202),
    key: 'previsionnel',
    label: 'Prévisionnel',
    minAccessLevel: 'complet',
    fieldType: 'file',
  },
]

// ROADMAP E07.01, over HTTP on the stateful fake Prisma: the cycle of nominative shares —
// invitation, recipient, levels, list of accesses, revocation by the owner or an administrator —
// and the preview « Voir comme le destinataire », which must be exactly what a recipient reads.
describe('Nominative shares (e2e)', () => {
  let app: INestApplication<App>
  let fake: ReturnType<typeof createFakePrisma>
  const tokens: Record<string, string> = {}

  beforeEach(async () => {
    fake = createFakePrisma()
    const p = fake.prisma
    for (const u of [SOPHIE, MARC, BOB, EVE, ADMIN, CLAIRE]) {
      await p.user.create({ data: { ...u, emailVerifiedAt: new Date() } })
    }
    await p.questionnaire.create({
      data: { id: 'form-1', slug: 'dossier', name: 'Dossier', usage: 'dossier' },
    })
    await p.questionnaireVersion.create({
      data: { id: VERSION, questionnaireId: 'form-1', version: 1, status: 'published' },
    })
    for (const s of SECTIONS)
      await p.questionnaireSection.create({ data: { ...s, versionId: VERSION } })
    for (const [i, f] of FIELDS.entries()) {
      await p.questionnaireField.create({
        data: { fieldType: 'text', orderIndex: i, ...f, versionId: VERSION },
      })
    }
    await p.workspace.create({ data: { id: id(400), name: 'CCI Touraine', slug: 'cci' } })
    await p.workspaceMembership.create({
      data: {
        workspaceId: id(400),
        userId: CLAIRE.id,
        role: 'conseiller',
        canManageWorkspace: true,
      },
    })
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(p)
      .overrideProvider(EMAIL_TRANSPORT)
      .useValue({ sendMagicLink: jest.fn(), sendShareInvite: jest.fn() })
      .compile()
    app = moduleFixture.createNestApplication()
    app.setGlobalPrefix('v1', { exclude: ['/'] })
    app.useGlobalPipes(new ZodValidationPipe())
    app.useGlobalFilters(new GlobalExceptionFilter())
    await app.init()
    for (const u of [SOPHIE, MARC, BOB, EVE, ADMIN, CLAIRE]) {
      tokens[u.id] = await new JwtService().signAsync(
        { sub: u.id, email: u.email, role: u.role },
        { secret: process.env.JWT_SECRET },
      )
    }
  })

  afterEach(async () => {
    await app.close()
  })

  const auth = (user: { id: string }) => `Bearer ${tokens[user.id]}`
  const as = (user: { id: string }) => ({
    get: (url: string) => request(app.getHttpServer()).get(url).set('Authorization', auth(user)),
    post: (url: string, body?: object) =>
      request(app.getHttpServer()).post(url).set('Authorization', auth(user)).send(body),
    patch: (url: string, body: object) =>
      request(app.getHttpServer()).patch(url).set('Authorization', auth(user)).send(body),
    delete: (url: string) =>
      request(app.getHttpServer()).delete(url).set('Authorization', auth(user)),
    upload: (dossierId: string, filename: string, fieldId?: string) => {
      const req = request(app.getHttpServer())
        .post(`/v1/dossiers/${dossierId}/documents`)
        .set('Authorization', auth(user))
      if (fieldId) void req.field('fieldId', fieldId)
      return req.attach('file', Buffer.from(`%PDF-1.4 ${filename}`), filename)
    },
  })
  const sophie = as(SOPHIE)
  const journal = (actionType: string) =>
    [...fake.table('auditLog').values()].filter((e) => e.actionType === actionType)

  // Biosensio: profile answered, classified, four documents (one per attachment question and an
  // unattached one), all selected by the request.
  async function biosensio() {
    const dossier = (await sophie.post('/v1/dossiers', { name: 'Biosensio' }).expect(201)).body
    const answers: Record<string, string> = {
      [id(300)]: 'Biosensio',
      [id(301)]: 'Biotech',
      [id(302)]: 'MVP',
      [id(303)]: 'Spin-off',
      [id(304)]: 'Seed',
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
    await sophie.upload(dossier.id, 'kbis.pdf', id(305)).expect(201)
    await sophie.upload(dossier.id, 'brevet.pdf', id(306)).expect(201)
    await sophie.upload(dossier.id, 'previsionnel.pdf', id(307)).expect(201)
    await sophie.upload(dossier.id, 'annexe.pdf').expect(201)
    await selectWholeLibrary(fake.prisma, dossier)
    return dossier as { id: string; companyId: string }
  }

  const invite = (dossierId: string, recipientEmail: string, accessLevel: AccessLevel) =>
    sophie.post(`/v1/dossiers/${dossierId}/shares`, { recipientEmail, accessLevel })

  const read = async (token: string, user = BOB) => {
    const body = (await as(user).get(`/v1/shares/${token}`).expect(200)).body
    expect(financeurShareResponseSchema.safeParse(body).error?.issues ?? []).toEqual([])
    return body
  }
  const preview = async (who: typeof SOPHIE, url: string) => {
    const body = (await as(who).get(url).expect(200)).body
    expect(sharePreviewSchema.safeParse(body).error?.issues ?? []).toEqual([])
    return body
  }
  // The recipient's view without what only differs by design: the share itself and the files'
  // signed URLs (a preview delivers none).
  const comparable = (body: Record<string, unknown>) => {
    const {
      share: _share,
      preview: _preview,
      documents,
      ...rest
    } = body as {
      share?: unknown
      preview?: unknown
      documents: Array<{ current: object; versions: object[] }>
    }
    const noUrl = (v: object) => ({ ...v, url: null })
    return {
      ...rest,
      documents: documents.map((d) => ({
        ...d,
        current: noUrl(d.current),
        versions: d.versions.map(noUrl),
      })),
    }
  }

  async function sameAsRecipient(dossierId: string, token: string, level: AccessLevel) {
    const viewed = await read(token)
    const views = journal('share_link_viewed').length
    const links = fake.table('shareLink').size
    const owner = await preview(SOPHIE, `/v1/dossiers/${dossierId}/share-preview?level=${level}`)
    const admin = await preview(
      ADMIN,
      `/v1/admin/dossiers/${dossierId}/share-preview?level=${level}`,
    )
    expect(viewed.share.accessLevel).toBe(level)
    expect(comparable(owner)).toEqual(comparable(viewed))
    expect(comparable(admin)).toEqual(comparable(viewed))
    expect(owner.preview).toEqual({ accessLevel: level, totalQuestions: 8, totalDocuments: 4 })
    // No file delivered by a preview; the recipient's are.
    for (const doc of owner.documents) expect(doc.current.url).toBeNull()
    for (const doc of viewed.documents) expect(doc.current.url).toMatch(/^memory:\/\//)
    // Neither a link nor a view.
    expect(journal('share_link_viewed').length).toBe(views)
    expect(fake.table('shareLink').size).toBe(links)
    return viewed
  }

  it('previews exactly what the recipient reads at each level, whatever the publication', async () => {
    const dossier = await biosensio()
    const link = (await invite(dossier.id, BOB.email, 'public').expect(201)).body
    const seen: Record<string, { fields: string[]; documents: string[]; sector: unknown }> = {}
    for (const level of LEVELS) {
      // The recipient keeps the same link: its owner changes the level.
      await sophie
        .patch(`/v1/dossiers/${dossier.id}/shares/${link.id}`, { accessLevel: level })
        .expect(200)
      const viewed = await sameAsRecipient(dossier.id, link.token, level)
      seen[level] = {
        fields: viewed.fields.map((f: { key: string }) => f.key),
        documents: viewed.documents.map((d: { filename: string }) => d.filename).sort(),
        sector: viewed.dossier.axe2Financier,
      }
    }
    // The levels differ as the policy says: fields, attachments, classification.
    expect(seen).toEqual({
      public: { fields: ['nom', 'secteur', 'kbis'], documents: ['kbis.pdf'], sector: null },
      partiel: {
        fields: ['nom', 'secteur', 'kbis', 'stade_projet', 'origine_projet', 'brevet'],
        documents: ['brevet.pdf', 'kbis.pdf'],
        sector: null,
      },
      complet: {
        // By section, then within it.
        fields: [
          'nom',
          'secteur',
          'kbis',
          'stade_projet',
          'origine_projet',
          'brevet',
          'stade_financement',
          'previsionnel',
        ],
        documents: ['annexe.pdf', 'brevet.pdf', 'kbis.pdf', 'previsionnel.pdf'],
        sector: 4,
      },
    })

    // Published: the presentation reaches both; archived: neither.
    Object.assign(fake.table('dossier').get(dossier.id)!, {
      publicationStatus: 'published',
      publishedAt: new Date(),
      summary: 'Capteurs',
      objective: 'Industrialiser',
      amountEur: 750000,
      financingTypes: ['equity'],
    })
    expect((await sameAsRecipient(dossier.id, link.token, 'complet')).dossier.summary).toBe(
      'Capteurs',
    )
    Object.assign(fake.table('dossier').get(dossier.id)!, {
      publicationStatus: 'archived',
      archivedAt: new Date(),
    })
    const archived = await sameAsRecipient(dossier.id, link.token, 'complet')
    expect(archived.dossier).toMatchObject({ publicationStatus: 'archived', summary: null })
  })

  it('previews and lists the shares of a request for its owner and administrators only', async () => {
    const dossier = await biosensio()
    const link = (await invite(dossier.id, BOB.email, 'partiel').expect(201)).body
    for (const url of [
      `/v1/dossiers/${dossier.id}/share-preview?level=complet`,
      `/v1/dossiers/${dossier.id}/shares`,
    ]) {
      for (const other of [MARC, BOB, EVE, CLAIRE, ADMIN]) {
        const res = await as(other).get(url)
        expect({ url, who: other.email, status: res.status }).toEqual({
          url,
          who: other.email,
          status: 404,
        })
      }
    }
    for (const url of [
      `/v1/admin/dossiers/${dossier.id}/share-preview?level=complet`,
      `/v1/admin/dossiers/${dossier.id}/shares`,
    ]) {
      for (const other of [SOPHIE, MARC, BOB, CLAIRE]) {
        const res = await as(other).get(url)
        expect({ url, who: other.email, status: res.status }).toEqual({
          url,
          who: other.email,
          status: 403,
        })
      }
    }
    await as(ADMIN)
      .get(`/v1/admin/dossiers/${id(999)}/shares`)
      .expect(404)
    await as(ADMIN)
      .get(`/v1/admin/dossiers/${id(999)}/share-preview?level=public`)
      .expect(404)
    // A level is required, among the three (closed: nothing is assumed).
    for (const query of ['', '?level=', '?level=total', '?level=COMPLET']) {
      await sophie.get(`/v1/dossiers/${dossier.id}/share-preview${query}`).expect(400)
      await as(ADMIN).get(`/v1/admin/dossiers/${dossier.id}/share-preview${query}`).expect(400)
    }
    const list = (await sophie.get(`/v1/dossiers/${dossier.id}/shares`).expect(200)).body
    const adminList = (await as(ADMIN).get(`/v1/admin/dossiers/${dossier.id}/shares`).expect(200))
      .body
    expect(adminList).toEqual(list)
    for (const entry of list) {
      expect(shareAccessSchema.safeParse(entry).error?.issues ?? []).toEqual([])
    }
    expect(list).toMatchObject([
      {
        id: link.id,
        recipientEmail: BOB.email,
        accessLevel: 'partiel',
        status: 'active',
        revokedBy: null,
      },
    ])
  })

  it('invites at the chosen level, once per recipient, never to oneself nor on an archived request', async () => {
    const dossier = await biosensio()
    // No level assumed.
    await sophie
      .post(`/v1/dossiers/${dossier.id}/shares`, { recipientEmail: BOB.email })
      .expect(400)
    await invite(dossier.id, BOB.email, 'totalement' as AccessLevel).expect(400)
    const link = (await invite(dossier.id, BOB.email, 'partiel').expect(201)).body
    expect(journal('share_link_created')[0].metadata).toMatchObject({
      recipientEmail: BOB.email,
      accessLevel: 'partiel',
      createdNewUser: false,
    })
    // The same recipient, whatever the case: change the level instead.
    const again = await invite(dossier.id, 'Bob@Invest.FR', 'complet').expect(409)
    expect(again.body.error).toMatchObject({
      message: expect.stringMatching(/déjà un accès/),
      details: { shareLinkId: link.id },
    })
    // Oneself.
    const self = await invite(dossier.id, 'SOPHIE@biosensio.fr', 'complet').expect(422)
    expect(self.body.error.message).toMatch(/invitez une autre adresse/)
    // Another account's request, or a financeur: as unknown.
    await as(MARC)
      .post(`/v1/dossiers/${dossier.id}/shares`, {
        recipientEmail: EVE.email,
        accessLevel: 'public',
      })
      .expect(404)
    await as(CLAIRE)
      .post(`/v1/dossiers/${dossier.id}/shares`, {
        recipientEmail: EVE.email,
        accessLevel: 'public',
      })
      .expect(404)
    expect(fake.table('shareLink').size).toBe(1)

    // Revoked, the recipient can be invited again: a new link; the old one stays closed.
    await sophie.delete(`/v1/dossiers/${dossier.id}/shares/${link.id}`).expect(200)
    const renewed = (await invite(dossier.id, BOB.email, 'public').expect(201)).body
    expect(renewed.token).not.toBe(link.token)
    await as(BOB).get(`/v1/shares/${link.token}`).expect(403)
    expect((await read(renewed.token)).share.accessLevel).toBe('public')

    // Archived: no new share; the existing ones stay readable, without the presentation.
    await sophie.post(`/v1/dossiers/${dossier.id}/archive`).expect(200)
    const refused = await invite(dossier.id, EVE.email, 'public').expect(409)
    expect(refused.body.error.message).toMatch(/archivée/)
    expect((await read(renewed.token)).dossier).toMatchObject({
      publicationStatus: 'archived',
      summary: null,
    })
    // Its owner may still restrict or revoke, not widen.
    const widen = await sophie
      .patch(`/v1/dossiers/${dossier.id}/shares/${renewed.id}`, { accessLevel: 'complet' })
      .expect(409)
    expect(widen.body.error.message).toMatch(/archivée/)
    expect(fake.table('shareLink').get(renewed.id)!.accessLevel).toBe('public')
    await sophie.post(`/v1/dossiers/${dossier.id}/unarchive`).expect(200)
    await sophie
      .patch(`/v1/dossiers/${dossier.id}/shares/${renewed.id}`, { accessLevel: 'partiel' })
      .expect(200)
    await sophie.post(`/v1/dossiers/${dossier.id}/archive`).expect(200)
    await sophie
      .patch(`/v1/dossiers/${dossier.id}/shares/${renewed.id}`, { accessLevel: 'public' })
      .expect(200)
    await sophie.delete(`/v1/dossiers/${dossier.id}/shares/${renewed.id}`).expect(200)
  })

  it('changes the level of an active share for its owner only, journaled, effective at once', async () => {
    const dossier = await biosensio()
    const link = (await invite(dossier.id, BOB.email, 'complet').expect(201)).body
    const url = `/v1/dossiers/${dossier.id}/shares/${link.id}`
    for (const other of [MARC, BOB, CLAIRE, ADMIN]) {
      await as(other).patch(url, { accessLevel: 'public' }).expect(404)
    }
    await sophie.patch(url, { accessLevel: 'aucun' }).expect(400)
    await sophie.patch(url, {}).expect(400)
    const changed = (await sophie.patch(url, { accessLevel: 'public' }).expect(200)).body
    expect(shareAccessSchema.safeParse(changed).error?.issues ?? []).toEqual([])
    expect(changed).toMatchObject({ id: link.id, token: link.token, accessLevel: 'public' })
    expect((await read(link.token)).fields.map((f: { key: string }) => f.key)).toEqual([
      'nom',
      'secteur',
      'kbis',
    ])
    // The current level changes nothing, journals nothing.
    await sophie.patch(url, { accessLevel: 'public' }).expect(200)
    expect(journal('share_link_level_changed').map((e) => e.metadata)).toEqual([
      { recipientEmail: BOB.email, from: 'complet', to: 'public' },
    ])
    expect(journal('share_link_level_changed')[0]).toMatchObject({
      actorId: SOPHIE.id,
      dossierId: dossier.id,
      shareLinkId: link.id,
    })
    // A link of another request: unknown here.
    const other = (await sophie.post('/v1/dossiers', { name: 'Autre' }).expect(201)).body
    await sophie
      .patch(`/v1/dossiers/${other.id}/shares/${link.id}`, { accessLevel: 'partiel' })
      .expect(404)
    // Revoked: nothing to change.
    await sophie.delete(url).expect(200)
    const revoked = await sophie.patch(url, { accessLevel: 'complet' }).expect(409)
    expect(revoked.body.error.message).toMatch(/révoqué/)
    expect(fake.table('shareLink').get(link.id)!.accessLevel).toBe('public')
  })

  it('revokes for the owner or an administrator, once, with who revoked it in the list', async () => {
    const dossier = await biosensio()
    const bob = (await invite(dossier.id, BOB.email, 'complet').expect(201)).body
    const eve = (await invite(dossier.id, EVE.email, 'partiel').expect(201)).body
    // Nobody else revokes.
    for (const other of [MARC, BOB, CLAIRE, ADMIN]) {
      await as(other).delete(`/v1/dossiers/${dossier.id}/shares/${bob.id}`).expect(404)
    }
    for (const other of [SOPHIE, BOB, CLAIRE]) {
      await as(other).delete(`/v1/admin/dossiers/${dossier.id}/shares/${bob.id}`).expect(403)
    }
    // An administrator names the request the link belongs to.
    const foreign = (await as(MARC).post('/v1/dossiers', { name: 'Agrotech' }).expect(201)).body
    await as(ADMIN).delete(`/v1/admin/dossiers/${foreign.id}/shares/${bob.id}`).expect(404)
    await read(bob.token)

    const owner = (await sophie.delete(`/v1/dossiers/${dossier.id}/shares/${bob.id}`).expect(200))
      .body
    expect(owner).toMatchObject({ status: 'revoked', revokedBy: 'owner' })
    await as(BOB).get(`/v1/shares/${bob.token}`).expect(403)
    const admin = (
      await as(ADMIN).delete(`/v1/admin/dossiers/${dossier.id}/shares/${eve.id}`).expect(200)
    ).body
    expect(admin).toMatchObject({ status: 'revoked', revokedBy: 'admin' })
    await as(EVE).get(`/v1/shares/${eve.token}`).expect(403)
    // Again: as it was, journaled once.
    await sophie.delete(`/v1/dossiers/${dossier.id}/shares/${bob.id}`).expect(200)
    await as(ADMIN).delete(`/v1/admin/dossiers/${dossier.id}/shares/${bob.id}`).expect(200)
    await sophie.delete(`/v1/dossiers/${dossier.id}/shares/${eve.id}`).expect(200)
    expect(journal('share_link_revoked').map((e) => [e.shareLinkId, e.actorId])).toEqual([
      [bob.id, SOPHIE.id],
    ])
    expect(journal('admin_revoked_share_link').map((e) => [e.shareLinkId, e.actorId])).toEqual([
      [eve.id, ADMIN.id],
    ])
    expect(fake.table('shareLink').get(bob.id)!.revokedAt).toEqual(new Date(owner.revokedAt))
    const list = (await sophie.get(`/v1/dossiers/${dossier.id}/shares`).expect(200)).body
    expect(
      Object.fromEntries(
        list.map((l: { recipientEmail: string; revokedBy: string }) => [
          l.recipientEmail,
          l.revokedBy,
        ]),
      ),
    ).toEqual({ [BOB.email]: 'owner', [EVE.email]: 'admin' })
  })
})
