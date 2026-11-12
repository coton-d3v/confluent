import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { ZodValidationPipe } from 'nestjs-zod'
import request from 'supertest'
import type { App } from 'supertest/types'
import {
  adminDossierListItemSchema,
  adminDossierListSchema,
  documentGroupSchema,
  ownerHistoryPageSchema,
  platformAnalyticsSchema,
  uploadedDocumentSchema,
  type OwnerHistoryEntry,
} from '@confluent/shared'
import { AppModule } from './../src/app.module'
import { GlobalExceptionFilter } from './../src/common/filters/global-exception.filter'
import { PrismaService } from './../src/prisma/prisma.service'
import { EMAIL_TRANSPORT } from './../src/modules/auth/email/email-transport'
import { AuditService } from './../src/modules/audit/audit.service'
import { DocumentsService } from './../src/modules/documents/documents.service'
import {
  STORAGE_TOKEN,
  type StorageAdapter,
} from './../src/modules/documents/storage/storage.adapter'
import { createFakePrisma } from '../src/testing/fake-prisma'

const id = (prefix: string, n: number) =>
  `7d3c1b0e-0000-4000-8${prefix}-${n.toString().padStart(12, '0')}`
const user = (n: number, email: string, role: string) => ({ id: id('001', n), email, role })
// Sophie owns Biosensio; Marc owns AgroTech; Marie manages the CCI's workspace (a financeur with the
// right to manage it, never an administrator); Bob reads Sophie's request through a share.
const SOPHIE = user(1, 'sophie@biosensio.fr', 'entrepreneur')
const MARC = user(2, 'marc@agrotech.fr', 'entrepreneur')
const MARIE = user(3, 'marie@cci.fr', 'financeur')
const BOB = user(4, 'bob@banque.fr', 'financeur')
const ADMIN = user(9, 'admin@confluent.dev', 'admin')
const PEOPLE = [SOPHIE, MARC, MARIE, BOB, ADMIN]
const VERSION = id('002', 1)
const FORM = id('002', 2)
const SECTION = id('002', 3)
const FILE_FIELD = id('002', 4)
const SOPHIE_COMPANY = id('003', 1)
const MARC_COMPANY = id('003', 2)
const SOPHIE_REQUEST = id('004', 1)
// Marc's 130 requests: more than one page of 100.
const MANY = 130
const marcRequest = (n: number) => id('005', n)

const PDF = (body: string) => Buffer.from(`%PDF-1.4 ${body}`)
const valid = (
  schema: { safeParse: (v: unknown) => { error?: { issues: unknown[] } } },
  v: unknown,
) => expect(schema.safeParse(v).error?.issues ?? []).toEqual([])

type Row = Record<string, unknown> & { id: string }

// ROADMAP E10.05 over HTTP on the stateful fake Prisma: the administrators' search of the requests
// on the server past any page, « aller à » by exact slug or identifier, the documents an
// administrator deposits or replaces in a company's library — journaled and shown to its owner —,
// and the platform statistics, all for administrators only. SQL matching (case, wildcards) and the
// order on ties on PostgreSQL: test/pg/admin-search.pg-spec.ts.
describe('Administration (e2e)', () => {
  let app: INestApplication<App>
  let fake: ReturnType<typeof createFakePrisma>
  const tokens: Record<string, string> = {}

  beforeEach(async () => {
    fake = createFakePrisma()
    const p = fake.prisma
    for (const u of PEOPLE) await p.user.create({ data: { ...u, emailVerifiedAt: new Date() } })
    await p.questionnaire.create({
      data: { id: FORM, slug: 'dossier', name: 'Profil', usage: 'dossier' },
    })
    await p.questionnaireVersion.create({
      data: { id: VERSION, questionnaireId: FORM, version: 1, status: 'published' },
    })
    await p.questionnaireSection.create({
      data: { id: SECTION, versionId: VERSION, key: 'pieces', title: 'Pièces', orderIndex: 0 },
    })
    await p.questionnaireField.create({
      data: {
        id: FILE_FIELD,
        versionId: VERSION,
        sectionId: SECTION,
        key: 'kbis',
        label: 'Extrait Kbis',
        fieldType: 'file',
        orderIndex: 0,
        minAccessLevel: 'complet',
      },
    })
    await p.company.create({
      data: {
        id: SOPHIE_COMPANY,
        ownerId: SOPHIE.id,
        name: 'Biosensio SAS',
        profileVersionId: VERSION,
      },
    })
    await p.company.create({
      data: { id: MARC_COMPANY, ownerId: MARC.id, name: 'AgroTech', profileVersionId: VERSION },
    })
    // Sophie's request: created first, the last of every list.
    await p.dossier.create({
      data: {
        id: SOPHIE_REQUEST,
        userId: SOPHIE.id,
        companyId: SOPHIE_COMPANY,
        name: 'Levée QX amorçage',
        slug: 'qx-slug-biosensio',
        questionnaireVersionId: VERSION,
        createdAt: new Date('2026-01-01T00:00:00Z'),
      },
    })
    // Marc's requests, ten at each instant (the order on ties is by identifier), written in the
    // reverse order of their identifiers.
    for (let n = MANY; n >= 1; n--) {
      await p.dossier.create({
        data: {
          id: marcRequest(n),
          userId: MARC.id,
          companyId: MARC_COMPANY,
          name: `Tour ${n}`,
          slug: `tour-${n}`,
          questionnaireVersionId: VERSION,
          createdAt: new Date(Date.UTC(2026, 1, 1 + Math.floor(n / 10))),
        },
      })
    }
    await p.shareLink.create({
      data: {
        dossierId: SOPHIE_REQUEST,
        recipientEmail: BOB.email,
        token: 'qx-share',
        status: 'active',
        accessLevel: 'complet',
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
    app.setGlobalPrefix('v1', { exclude: ['/'] })
    app.useGlobalPipes(new ZodValidationPipe())
    app.useGlobalFilters(new GlobalExceptionFilter())
    await app.init()
    for (const u of PEOPLE) {
      tokens[u.id] = await new JwtService().signAsync(
        { sub: u.id, email: u.email, role: u.role },
        { secret: process.env.JWT_SECRET },
      )
    }
    // Marie manages a workspace: rights of her own, none of an administrator.
    const ws = (await as(ADMIN).post('/v1/admin/workspaces', { name: 'CCI Touraine' }).expect(201))
      .body.id as string
    await as(ADMIN)
      .post(`/v1/admin/workspaces/${ws}/members`, {
        email: MARIE.email,
        role: 'conseiller',
        canManageWorkspace: true,
      })
      .expect(201)
  })

  afterEach(async () => {
    jest.restoreAllMocks()
    await app.close()
  })

  const auth = (u: { id: string }) => `Bearer ${tokens[u.id]}`
  const as = (u: { id: string }) => ({
    get: (url: string) => request(app.getHttpServer()).get(url).set('Authorization', auth(u)),
    post: (url: string, body?: object) =>
      request(app.getHttpServer()).post(url).set('Authorization', auth(u)).send(body),
    upload: (dossierId: string, filename: string, content: Buffer, fields: object = {}) => {
      let req = request(app.getHttpServer())
        .post(`/v1/admin/dossiers/${dossierId}/documents`)
        .set('Authorization', auth(u))
      for (const [k, v] of Object.entries(fields)) req = req.field(k, v as string)
      return req.attach('file', content, filename)
    },
  })
  const search = (query: string) => as(ADMIN).get(`/v1/admin/dossiers?${query}`)
  const found = async (q: string) =>
    (await search(`q=${encodeURIComponent(q)}&pageSize=100`).expect(200)).body as {
      total: number
      exactMatch: { id: string } | null
      items: Array<{ id: string }>
    }
  const storage = () => app.get<StorageAdapter>(STORAGE_TOKEN)
  const storedObjects = () => (storage() as unknown as { store: Map<string, unknown> }).store.size
  const journal = (actionType: string) =>
    [...fake.table('auditLog').values()].filter((e) => e.actionType === actionType) as Row[]
  const history = async () => {
    const res = await as(SOPHIE)
      .get(`/v1/dossiers/${SOPHIE_REQUEST}/history?filter=administration`)
      .expect(200)
    valid(ownerHistoryPageSchema, res.body)
    return res.body.items as OwnerHistoryEntry[]
  }

  describe('search of the requests', () => {
    it('lists every request a page at a time past the first hundred, never twice nor skipped', async () => {
      const first = await search('pageSize=100').expect(200)
      valid(adminDossierListSchema, first.body)
      expect(first.body).toMatchObject({ page: 1, pageSize: 100, total: MANY + 1, q: null })
      expect(first.body.exactMatch).toBeNull()
      const second = (await search('pageSize=100&page=2').expect(200)).body
      const ids = [...first.body.items, ...second.items].map((d: { id: string }) => d.id)
      expect(second.items).toHaveLength(MANY + 1 - 100)
      expect(new Set(ids).size).toBe(MANY + 1)
      // The latest first; at the same instant, by identifier (descending).
      expect(ids[0]).toBe(marcRequest(130))
      expect(ids.slice(1, 11)).toEqual(
        [129, 128, 127, 126, 125, 124, 123, 122, 121, 120].map(marcRequest),
      )
      expect(ids.at(-1)).toBe(SOPHIE_REQUEST)
      // Past the last page: no item, the total still told.
      const past = (await search('pageSize=100&page=3').expect(200)).body
      expect(past).toMatchObject({ total: MANY + 1, items: [] })
    })

    it('finds a request beyond the first hundred by its title, its company, its owner or its slug', async () => {
      // Sophie's request is the last of 131: past any first page.
      expect((await found('qx amorçage')).items.map((d) => d.id)).toEqual([SOPHIE_REQUEST])
      expect((await found('LEVÉE QX')).items.map((d) => d.id)).toEqual([SOPHIE_REQUEST])
      expect((await found('biosensio sas')).items.map((d) => d.id)).toEqual([SOPHIE_REQUEST])
      expect((await found('SOPHIE@Biosensio.fr')).items.map((d) => d.id)).toEqual([SOPHIE_REQUEST])
      const bySlug = await found('QX-SLUG-BIOSENSIO')
      expect(bySlug.items.map((d) => d.id)).toEqual([SOPHIE_REQUEST])
      expect(bySlug.exactMatch?.id).toBe(SOPHIE_REQUEST)
      const byId = await found(SOPHIE_REQUEST.toUpperCase())
      expect(byId.items.map((d) => d.id)).toEqual([SOPHIE_REQUEST])
      expect(byId.exactMatch?.id).toBe(SOPHIE_REQUEST)
      // A company's identifier finds its requests, without being an exact « aller à ».
      const byCompany = await found(SOPHIE_COMPANY)
      expect(byCompany.items.map((d) => d.id)).toEqual([SOPHIE_REQUEST])
      expect(byCompany.exactMatch).toBeNull()
      // Many results, paginated like the whole list.
      const marc = (
        await search(`q=${encodeURIComponent('agrotech')}&pageSize=50&page=3`).expect(200)
      ).body
      expect(marc).toMatchObject({ total: MANY, page: 3 })
      expect(marc.items).toHaveLength(MANY - 100)
      // A title matching a slug's « aller à » keeps the other results.
      const tour = await found('tour-12')
      expect(tour.exactMatch?.id).toBe(marcRequest(12))
      expect(tour.items.map((d) => d.id)).toEqual([marcRequest(12)])
    })

    it('matches a slug, an identifier and an email address only as a whole (code review R64)', async () => {
      for (const part of [
        'qx-slug-bios',
        'slug-biosensio',
        SOPHIE_REQUEST.slice(0, 20),
        SOPHIE_REQUEST.slice(-12),
        'sophie@biosensio',
        'biosensio.fr',
        '@biosensio.fr',
      ]) {
        const res = await found(part)
        expect([part, res.total, res.exactMatch]).toEqual([part, 0, null])
      }
      // An empty search, or one of spaces, lists every request.
      expect((await found('   ')).total).toBe(MANY + 1)
      expect((await search('q=').expect(200)).body.q).toBeNull()
    })

    it('refuses out-of-bounds pages, sizes, searches and unknown parameters with 400', async () => {
      for (const query of [
        'page=0',
        'page=-1',
        'page=1.5',
        'page=abc',
        'page=10001',
        'pageSize=0',
        'pageSize=101',
        `q=${'x'.repeat(201)}`,
        'sort=name',
      ]) {
        const res = await search(query)
        expect([query, res.status]).toEqual([query, 400])
      }
      await search('page=10000&pageSize=100').expect(200)
      await search(`q=${'x'.repeat(200)}`).expect(200)
    })

    it('goes to a request by its exact slug or identifier, and nothing else', async () => {
      const bySlug = await as(ADMIN)
        .get('/v1/admin/dossiers/lookup?ref=QX-Slug-Biosensio')
        .expect(200)
      valid(adminDossierListItemSchema, bySlug.body)
      expect(bySlug.body).toMatchObject({
        id: SOPHIE_REQUEST,
        slug: 'qx-slug-biosensio',
        ownerEmail: SOPHIE.email,
        companyName: 'Biosensio SAS',
        activeShareLinksCount: 1,
      })
      const byId = await as(ADMIN).get(`/v1/admin/dossiers/lookup?ref=${marcRequest(125)}`)
      expect(byId.status).toBe(200)
      expect(byId.body.slug).toBe('tour-125')
      for (const ref of ['qx-slug', 'Levée QX amorçage', SOPHIE.email, SOPHIE_COMPANY]) {
        const res = await as(ADMIN).get(`/v1/admin/dossiers/lookup?ref=${encodeURIComponent(ref)}`)
        expect([ref, res.status, res.body.error?.message]).toEqual([
          ref,
          404,
          'Dossier introuvable.',
        ])
      }
      await as(ADMIN).get('/v1/admin/dossiers/lookup').expect(400)
      await as(ADMIN).get('/v1/admin/dossiers/lookup?ref=%20').expect(400)
      await as(ADMIN)
        .get(`/v1/admin/dossiers/lookup?ref=${'x'.repeat(201)}`)
        .expect(400)
    })

    it('is the administrators’ alone, whatever else the account may do', async () => {
      for (const u of [SOPHIE, MARIE, BOB]) {
        await as(u).get('/v1/admin/dossiers?q=biosensio').expect(403)
        await as(u).get('/v1/admin/dossiers/lookup?ref=qx-slug-biosensio').expect(403)
      }
      await request(app.getHttpServer()).get('/v1/admin/dossiers?q=biosensio').expect(401)
      // The role is read from the database at each request: a former administrator is refused.
      await fake.prisma.user.update({ where: { id: ADMIN.id }, data: { role: 'financeur' } })
      await as(ADMIN).get('/v1/admin/dossiers?q=biosensio').expect(403)
    })
  })

  describe('documents deposited by an administrator', () => {
    it('adds a new document to the company’s library, journaled, shown to the owner, not presented to the shares', async () => {
      const res = await as(ADMIN)
        .upload(SOPHIE_REQUEST, 'statuts QX.pdf', PDF('statuts'), {
          type: 'articles_of_association',
        })
        .expect(201)
      valid(uploadedDocumentSchema, res.body)
      expect(res.body).toMatchObject({
        filename: 'statuts QX.pdf',
        version: 1,
        type: 'articles_of_association',
      })
      // In the library, read the same way by the administrator and the owner; selected by no request.
      const adminList = (
        await as(ADMIN).get(`/v1/admin/dossiers/${SOPHIE_REQUEST}/documents`).expect(200)
      ).body
      for (const group of adminList) valid(documentGroupSchema, group)
      expect(adminList).toEqual([
        expect.objectContaining({
          id: res.body.documentId,
          filename: 'statuts QX.pdf',
          type: 'articles_of_association',
          selection: null,
          current: expect.objectContaining({ version: 1, availability: 'available' }),
        }),
      ])
      const ownerList = (
        await as(SOPHIE).get(`/v1/dossiers/${SOPHIE_REQUEST}/documents`).expect(200)
      ).body
      expect(ownerList.map((g: { id: string; selection: unknown }) => [g.id, g.selection])).toEqual(
        [[res.body.documentId, null]],
      )
      // The share's recipient does not read it until the owner presents it.
      expect(
        (await as(BOB).get(`/v1/dossiers/${SOPHIE_REQUEST}/documents`).expect(200)).body,
      ).toEqual([])
      // One entry, with the version, written by the administrator on this request.
      const entries = journal('admin_uploaded_document')
      expect(entries).toHaveLength(1)
      expect(entries[0]).toMatchObject({
        actorId: ADMIN.id,
        dossierId: SOPHIE_REQUEST,
        metadata: {
          documentId: res.body.documentId,
          versionId: res.body.id,
          filename: 'statuts QX.pdf',
          version: 1,
          newDocument: true,
          fieldId: null,
          type: 'articles_of_association',
        },
      })
      // The owner reads it as an intervention of the administration, never who.
      const items = await history()
      expect(items).toEqual([
        expect.objectContaining({
          kind: 'document_added',
          byAdministration: true,
          summary: 'Document déposé par l’administration',
          details: [
            { label: 'Document', value: 'statuts QX.pdf' },
            { label: 'Version', value: '1' },
          ],
        }),
      ])
      expect(JSON.stringify(items)).not.toContain(ADMIN.id)
      expect(JSON.stringify(items)).not.toContain(ADMIN.email)
      // Nothing about it for the other requests' owners.
      expect(journal('admin_uploaded_document').every((e) => e.dossierId === SOPHIE_REQUEST)).toBe(
        true,
      )
    })

    it('replaces a document by a new version under its name and question, the earlier ones kept', async () => {
      // Sophie's own deposit, answering the Kbis question: selected by her request, following.
      const own = (
        await request(app.getHttpServer())
          .post(`/v1/dossiers/${SOPHIE_REQUEST}/documents`)
          .set('Authorization', auth(SOPHIE))
          .field('fieldId', FILE_FIELD)
          .attach('file', PDF('kbis 2025'), 'kbis.pdf')
          .expect(201)
      ).body
      const replaced = await as(ADMIN)
        .upload(SOPHIE_REQUEST, 'kbis.pdf', PDF('kbis 2026'), {
          fieldId: FILE_FIELD,
          type: 'other',
        })
        .expect(201)
      expect(replaced.body).toMatchObject({
        documentId: own.documentId,
        version: 2,
        fieldId: FILE_FIELD,
      })
      const [group] = (
        await as(ADMIN).get(`/v1/admin/dossiers/${SOPHIE_REQUEST}/documents`).expect(200)
      ).body
      expect(group.versions.map((v: { version: number }) => v.version)).toEqual([2, 1])
      // The request's choice is unchanged: it follows the latest version, now the administrator's.
      expect(group.selection).toEqual({ pinnedVersionId: null })
      const bob = (await as(BOB).get(`/v1/dossiers/${SOPHIE_REQUEST}/documents`).expect(200)).body
      expect(bob.map((g: { current: { id: string } }) => g.current.id)).toEqual([replaced.body.id])
      expect(journal('admin_uploaded_document')).toEqual([
        expect.objectContaining({
          metadata: expect.objectContaining({
            documentId: own.documentId,
            versionId: replaced.body.id,
            version: 2,
            newDocument: false,
            fieldId: FILE_FIELD,
          }),
        }),
      ])
      expect(await history()).toEqual([
        expect.objectContaining({
          kind: 'document_added',
          summary: 'Document remplacé par l’administration : nouvelle version',
          details: [
            { label: 'Document', value: 'kbis.pdf' },
            { label: 'Version', value: '2' },
          ],
        }),
      ])
    })

    it('applies the owner’s limits: formats, size, question and type; nothing stored nor journaled', async () => {
      const refused = async (status: number, req: request.Test) => {
        const res = await req
        expect(res.status).toBe(status)
        return res
      }
      const unsupported = await refused(
        415,
        as(ADMIN).upload(SOPHIE_REQUEST, 'statuts.pdf', Buffer.from('MZ\x90\x00 program')),
      )
      expect(unsupported.body.error.message).toMatch(/Format non accepté/)
      await refused(
        413,
        as(ADMIN).upload(SOPHIE_REQUEST, 'gros.pdf', Buffer.alloc(21 * 1024 * 1024, 1)),
      )
      await refused(
        400,
        as(ADMIN).upload(SOPHIE_REQUEST, 'a.pdf', PDF('a'), { fieldId: id('009', 1) }),
      )
      await refused(
        400,
        as(ADMIN).upload(SOPHIE_REQUEST, 'a.pdf', PDF('a'), { type: 'qx-unknown' }),
      )
      await refused(
        400,
        request(app.getHttpServer())
          .post(`/v1/admin/dossiers/${SOPHIE_REQUEST}/documents`)
          .set('Authorization', auth(ADMIN))
          .field('type', 'other'),
      )
      expect(fake.table('document').size).toBe(0)
      expect(fake.table('libraryDocument').size).toBe(0)
      expect(storedObjects()).toBe(0)
      expect(journal('admin_uploaded_document')).toEqual([])
    })

    it('deletes the stored file when the version or its journal entry cannot be written', async () => {
      const recordIn = AuditService.prototype.recordIn
      jest.spyOn(AuditService.prototype, 'recordIn').mockImplementation(function (
        this: AuditService,
        tx,
        entry,
      ) {
        if (entry.actionType === 'admin_uploaded_document') {
          return Promise.reject(new Error('journal unavailable'))
        }
        return recordIn.call(this, tx, entry)
      })
      await as(ADMIN).upload(SOPHIE_REQUEST, 'bp.pdf', PDF('bp')).expect(500)
      expect(storedObjects()).toBe(0)
      expect(journal('admin_uploaded_document')).toEqual([])
    })

    it('is refused to anyone but an administrator, and on an unknown request', async () => {
      const upload = jest.spyOn(DocumentsService.prototype, 'upload')
      for (const u of [SOPHIE, MARIE, BOB, MARC]) {
        await as(u).upload(SOPHIE_REQUEST, 'bp.pdf', PDF('bp')).expect(403)
        await as(u).get(`/v1/admin/dossiers/${SOPHIE_REQUEST}/documents`).expect(403)
      }
      expect(upload).not.toHaveBeenCalled()
      const unknown = await as(ADMIN).upload(id('004', 99), 'bp.pdf', PDF('bp'))
      expect(unknown.status).toBe(404)
      expect(unknown.body.error.message).toBe('Dossier introuvable.')
      await as(ADMIN)
        .get(`/v1/admin/dossiers/${id('004', 99)}/documents`)
        .expect(404)
      expect(storedObjects()).toBe(0)
      expect(fake.table('document').size).toBe(0)
    })
  })

  describe('accounts', () => {
    it('invites, deactivates and reactivates an account, never the administrator’s own', async () => {
      const invited = await as(ADMIN)
        .post('/v1/admin/users/invite', {
          email: 'Nouveau@Recette-e1005.test',
          role: 'entrepreneur',
        })
        .expect(201)
      expect(invited.body).toMatchObject({
        email: 'nouveau@recette-e1005.test',
        role: 'entrepreneur',
      })
      await request(app.getHttpServer())
        .patch(`/v1/admin/users/${MARC.id}/deactivate`)
        .set('Authorization', auth(ADMIN))
        .expect(200)
      await as(MARC).get('/v1/dossiers').expect(401)
      await request(app.getHttpServer())
        .patch(`/v1/admin/users/${MARC.id}/reactivate`)
        .set('Authorization', auth(ADMIN))
        .expect(200)
      const self = await request(app.getHttpServer())
        .patch(`/v1/admin/users/${ADMIN.id}/deactivate`)
        .set('Authorization', auth(ADMIN))
      expect(self.status).toBe(409)
      expect(self.body.error.message).toBe('Vous ne pouvez pas désactiver votre propre compte.')
      await as(ADMIN).get('/v1/admin/users').expect(200)
      for (const u of [SOPHIE, MARIE]) {
        await as(u).get('/v1/admin/users').expect(403)
        await request(app.getHttpServer())
          .patch(`/v1/admin/users/${MARC.id}/deactivate`)
          .set('Authorization', auth(u))
          .expect(403)
      }
    })
  })

  describe('platform statistics', () => {
    it('counts the whole platform for an administrator, and nobody else reads them', async () => {
      const res = await as(ADMIN).get('/v1/admin/analytics').expect(200)
      valid(platformAnalyticsSchema, res.body)
      expect(res.body).toMatchObject({ totalDossiers: MANY + 1, totalShareLinks: 1 })
      for (const u of [SOPHIE, MARIE, BOB]) await as(u).get('/v1/admin/analytics').expect(403)
      await request(app.getHttpServer()).get('/v1/admin/analytics').expect(401)
      await fake.prisma.user.update({ where: { id: ADMIN.id }, data: { isActive: false } })
      await as(ADMIN).get('/v1/admin/analytics').expect(401)
    })
  })
})
