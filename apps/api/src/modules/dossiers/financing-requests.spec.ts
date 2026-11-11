import { HttpException } from '@nestjs/common'
import type { AuditService } from '../audit/audit.service'
import type { ClassificationService } from '../classification/classification.service'
import type { QuestionnairesService } from '../questionnaires/questionnaires.service'
import { CompaniesService } from '../companies/companies.service'
import { DocumentsService } from '../documents/documents.service'
import type { StorageAdapter } from '../documents/storage/storage.adapter'
import { createFakePrisma } from '../../testing/fake-prisma'
import { DossiersService } from './dossiers.service'

const SOPHIE = { id: 'u-sophie', email: 'sophie@biosensio.fr', role: 'entrepreneur' }
const MARC = { id: 'u-marc', email: 'marc@agrotech.fr', role: 'entrepreneur' }
const FINANCEUR = { id: 'u-fin', email: 'fin@fonds.fr', role: 'financeur' }
const PDF = (text: string) => Buffer.from(`%PDF-1.4 ${text}`)

function setup() {
  const fake = createFakePrisma()
  const p = fake.prisma
  const audit = { record: jest.fn().mockResolvedValue(undefined) }
  const companies = new CompaniesService(p as never)
  const dossiers = new DossiersService(
    p as never,
    {
      ensureBootstrap: jest.fn().mockResolvedValue({ id: 'qv-1', version: 1 }),
      getVersion: jest.fn().mockResolvedValue(null),
    } as unknown as QuestionnairesService,
    {} as ClassificationService,
    audit as unknown as AuditService,
    companies,
  )
  const objects = new Map<string, Buffer>()
  const storage = {
    upload: jest.fn((key: string, body: Buffer) => {
      objects.set(key, body)
      return Promise.resolve()
    }),
    getSignedUrl: jest.fn((key: string) => Promise.resolve(`memory://${key}`)),
    read: jest.fn((key: string) => Promise.resolve(objects.get(key)!)),
    exists: jest.fn().mockResolvedValue(true),
    delete: jest.fn().mockResolvedValue(undefined),
    check: jest.fn().mockResolvedValue(undefined),
  } satisfies StorageAdapter
  const documents = new DocumentsService(p as never, storage, audit as unknown as AuditService)
  return { fake, p, audit, dossiers, documents }
}

async function failure(promise: Promise<unknown>): Promise<{ status: number; body: unknown }> {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  )
  expect(err).toBeInstanceOf(HttpException)
  return { status: (err as HttpException).getStatus(), body: (err as HttpException).getResponse() }
}

const complete = {
  summary: 'Capteurs pour la qualité de l’eau',
  objective: 'Industrialiser la production',
  amountEur: 500_000,
  financingTypes: ['grant' as const, 'equity' as const],
}

// ROADMAP E05.07: several financing requests per company, each with its presentation, publication
// and selection of the company's documents; a share shows only what its request selects.
describe('financing requests', () => {
  describe('several requests per company', () => {
    it('creates another request of the owner’s company, presenting the same profile, selecting nothing', async () => {
      const { fake, dossiers } = setup()
      const first = await dossiers.create({ owner: SOPHIE, name: 'Biosensio' })
      const second = await dossiers.createForCompany({
        owner: SOPHIE,
        companyId: first.companyId,
        name: 'Biosensio',
      })
      expect(second).toMatchObject({
        companyId: first.companyId,
        userId: SOPHIE.id,
        questionnaireVersionId: first.questionnaireVersionId,
        slug: 'biosensio-2',
        publicationStatus: 'draft',
        company: { id: first.companyId, name: 'Biosensio' },
      })
      expect(fake.table('company').size).toBe(1)
      expect(fake.table('dossierDocument').size).toBe(0)
    })

    it('refuses a request in another account’s company exactly like in an unknown one, and to a financeur', async () => {
      const { fake, dossiers } = setup()
      const other = await dossiers.create({ owner: MARC, name: 'Agrotech' })
      const foreign = await failure(
        dossiers.createForCompany({ owner: SOPHIE, companyId: other.companyId, name: 'Vol' }),
      )
      const unknown = await failure(
        dossiers.createForCompany({ owner: SOPHIE, companyId: 'c-unknown', name: 'Vol' }),
      )
      expect(foreign).toEqual(unknown)
      expect(foreign).toEqual({
        status: 404,
        body: { code: 'COMPANY_NOT_FOUND', message: 'Entreprise introuvable.' },
      })
      for (const owner of [FINANCEUR, { ...MARC, role: 'conseiller' }]) {
        const refused = await failure(
          dossiers.createForCompany({ owner, companyId: other.companyId, name: 'Vol' }),
        )
        expect(refused.status).toBe(403)
      }
      expect(fake.table('dossier').size).toBe(1)
    })

    it('keeps the company while another request remains, and removes it with the last one', async () => {
      const { fake, dossiers } = setup()
      const first = await dossiers.create({ owner: SOPHIE, name: 'Biosensio' })
      const second = await dossiers.createForCompany({
        owner: SOPHIE,
        companyId: first.companyId,
        name: 'Croissance',
      })
      await dossiers.delete(first.id, SOPHIE.id)
      expect(fake.table('company').has(first.companyId)).toBe(true)
      await dossiers.delete(second.id, SOPHIE.id)
      expect(fake.table('company').has(first.companyId)).toBe(false)
    })
  })

  describe('presentation and publication', () => {
    it('stores the presentation, types in their canonical order, and clears a part with null', async () => {
      const { dossiers } = setup()
      const d = await dossiers.create({ owner: SOPHIE, name: 'Biosensio' })
      const updated = await dossiers.update({ userId: SOPHIE.id, id: d.id, changes: complete })
      expect(updated).toMatchObject({ ...complete, financingTypes: ['equity', 'grant'] })
      const cleared = await dossiers.update({
        userId: SOPHIE.id,
        id: d.id,
        changes: { amountEur: null, summary: null },
      })
      expect(cleared).toMatchObject({
        amountEur: null,
        summary: null,
        objective: complete.objective,
      })
      expect(
        (await failure(dossiers.update({ userId: MARC.id, id: d.id, changes: complete }))).status,
      ).toBe(404)
    })

    it('publishes only a complete request whose profile is submitted, says what is missing, and journals it', async () => {
      const { p, audit, dossiers } = setup()
      const d = await dossiers.create({ owner: SOPHIE, name: 'Biosensio' })
      const empty = await failure(dossiers.publish(d.id, SOPHIE.id))
      expect(empty.status).toBe(422)
      expect(empty.body).toMatchObject({
        code: 'DOSSIER_NOT_PUBLISHABLE',
        details: ['summary', 'objective', 'amountEur', 'financingTypes', 'submitted'].map((item) =>
          expect.objectContaining({ item }),
        ),
      })
      await dossiers.update({ userId: SOPHIE.id, id: d.id, changes: complete })
      const notSubmitted = await failure(dossiers.publish(d.id, SOPHIE.id))
      expect(notSubmitted.body).toMatchObject({
        details: [expect.objectContaining({ item: 'submitted' })],
      })
      expect(audit.record).not.toHaveBeenCalled()

      await p.dossier.update({ where: { id: d.id }, data: { submittedAt: new Date() } })
      const published = await dossiers.publish(d.id, SOPHIE.id)
      expect(published.publicationStatus).toBe('published')
      expect(published.publishedAt).toBeInstanceOf(Date)
      expect(audit.record).toHaveBeenCalledTimes(1)
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          actionType: 'dossier_published',
          actorId: SOPHIE.id,
          dossierId: d.id,
        }),
      )
      // Publishing again changes nothing, journals nothing.
      expect((await dossiers.publish(d.id, SOPHIE.id)).publishedAt).toEqual(published.publishedAt)
      expect(audit.record).toHaveBeenCalledTimes(1)
      // Another account cannot publish nor unpublish it.
      expect((await failure(dossiers.publish(d.id, MARC.id))).status).toBe(404)
      expect((await failure(dossiers.unpublish(d.id, MARC.id))).status).toBe(404)
    })

    it('keeps a published request complete: clearing what publication requires is refused, nothing written', async () => {
      const { p, audit, dossiers } = setup()
      const d = await dossiers.create({ owner: SOPHIE, name: 'Biosensio' })
      await dossiers.update({ userId: SOPHIE.id, id: d.id, changes: complete })
      await p.dossier.update({ where: { id: d.id }, data: { submittedAt: new Date() } })
      await dossiers.publish(d.id, SOPHIE.id)
      const refused = await failure(
        dossiers.update({ userId: SOPHIE.id, id: d.id, changes: { financingTypes: [] } }),
      )
      expect(refused).toMatchObject({ status: 422, body: { code: 'DOSSIER_NOT_PUBLISHABLE' } })
      expect((await p.dossier.findUnique({ where: { id: d.id } }))!.financingTypes).toEqual([
        'equity',
        'grant',
      ])
      // The description is not required: it may be cleared.
      await dossiers.update({ userId: SOPHIE.id, id: d.id, changes: { description: null } })
      // Unpublished, the request may be emptied again; journaled once.
      const draft = await dossiers.unpublish(d.id, SOPHIE.id)
      expect(draft).toMatchObject({ publicationStatus: 'draft', publishedAt: null })
      await dossiers.unpublish(d.id, SOPHIE.id)
      expect(audit.record.mock.calls.map(([e]) => e.actionType)).toEqual([
        'dossier_published',
        'dossier_unpublished',
      ])
      await dossiers.update({ userId: SOPHIE.id, id: d.id, changes: { financingTypes: [] } })
    })

    it('shows share recipients the presentation once published only; the owner always', async () => {
      const { p, dossiers } = setup()
      await p.user.create({ data: { ...SOPHIE } })
      const d = await dossiers.create({ owner: SOPHIE, name: 'Biosensio' })
      await dossiers.update({ userId: SOPHIE.id, id: d.id, changes: complete })
      await p.shareLink.create({
        data: {
          dossierId: d.id,
          recipientEmail: FINANCEUR.email,
          status: 'active',
          accessLevel: 'public',
        },
      })
      const hidden = { summary: null, objective: null, amountEur: null, financingTypes: [] }
      expect(await dossiers.getWithQuestionnaire(d.id, FINANCEUR)).toMatchObject({
        name: 'Biosensio',
        publicationStatus: 'draft',
        ...hidden,
      })
      expect((await dossiers.listForUser(FINANCEUR))[0]).toMatchObject(hidden)
      expect(await dossiers.getWithQuestionnaire(d.id, SOPHIE)).toMatchObject({
        summary: complete.summary,
      })

      await p.dossier.update({ where: { id: d.id }, data: { submittedAt: new Date() } })
      await dossiers.publish(d.id, SOPHIE.id)
      const shown = { ...complete, financingTypes: ['equity', 'grant'] }
      expect(await dossiers.getWithQuestionnaire(d.id, FINANCEUR)).toMatchObject(shown)
      expect((await dossiers.listForUser(FINANCEUR))[0]).toMatchObject(shown)
      // Closed by default: a status this code does not know is a draft.
      await p.dossier.update({ where: { id: d.id }, data: { publicationStatus: 'publiee' } })
      expect(await dossiers.getWithQuestionnaire(d.id, FINANCEUR)).toMatchObject(hidden)
    })
  })

  // ROADMAP E06.01 (D03 to be confirmed): `archived` closes a request, its owner reopens it as a
  // draft; every change goes through PUBLICATION_TRANSITIONS.
  describe('archiving', () => {
    async function publishedRequest(s: ReturnType<typeof setup>) {
      const d = await s.dossiers.create({ owner: SOPHIE, name: 'Biosensio' })
      await s.dossiers.update({ userId: SOPHIE.id, id: d.id, changes: complete })
      await s.p.dossier.update({ where: { id: d.id }, data: { submittedAt: new Date() } })
      await s.dossiers.publish(d.id, SOPHIE.id)
      return d
    }

    it('archives a published or draft request, closes it, and reopens it as a draft; journaled once each', async () => {
      const s = setup()
      const d = await publishedRequest(s)
      const archived = await s.dossiers.archive(d.id, SOPHIE.id)
      expect(archived).toMatchObject({ publicationStatus: 'archived', publishedAt: null })
      expect(archived.archivedAt).toBeInstanceOf(Date)
      // Archiving again changes nothing.
      expect((await s.dossiers.archive(d.id, SOPHIE.id)).archivedAt).toEqual(archived.archivedAt)

      // Closed: neither published, nor unpublished, nor edited — nothing written.
      for (const attempt of [
        () => s.dossiers.publish(d.id, SOPHIE.id),
        () => s.dossiers.unpublish(d.id, SOPHIE.id),
        () => s.dossiers.update({ userId: SOPHIE.id, id: d.id, changes: { summary: 'Autre' } }),
      ]) {
        expect(await failure(attempt())).toMatchObject({
          status: 409,
          body: { code: 'DOSSIER_ARCHIVED' },
        })
      }
      expect((await s.p.dossier.findUnique({ where: { id: d.id } }))!).toMatchObject({
        publicationStatus: 'archived',
        summary: complete.summary,
      })

      const reopened = await s.dossiers.unarchive(d.id, SOPHIE.id)
      expect(reopened).toMatchObject({
        publicationStatus: 'draft',
        publishedAt: null,
        archivedAt: null,
      })
      // Unarchiving a draft changes nothing; a published request is not unarchived but archived.
      await s.dossiers.unarchive(d.id, SOPHIE.id)
      await s.dossiers.publish(d.id, SOPHIE.id)
      expect(await failure(s.dossiers.unarchive(d.id, SOPHIE.id))).toMatchObject({
        status: 409,
        body: { code: 'PUBLICATION_TRANSITION_REFUSED' },
      })
      await s.dossiers.unpublish(d.id, SOPHIE.id)
      // A draft is archived too.
      expect((await s.dossiers.archive(d.id, SOPHIE.id)).publicationStatus).toBe('archived')
      expect(s.audit.record.mock.calls.map(([e]) => [e.actionType, e.metadata.from])).toEqual([
        ['dossier_published', 'draft'],
        ['dossier_archived', 'published'],
        ['dossier_unarchived', 'archived'],
        ['dossier_published', 'draft'],
        ['dossier_unpublished', 'published'],
        ['dossier_archived', 'draft'],
      ])
    })

    it('lets only the owner archive or unarchive a request', async () => {
      const s = setup()
      const d = await publishedRequest(s)
      expect((await failure(s.dossiers.archive(d.id, MARC.id))).status).toBe(404)
      await s.dossiers.archive(d.id, SOPHIE.id)
      expect((await failure(s.dossiers.unarchive(d.id, MARC.id))).status).toBe(404)
      expect((await failure(s.dossiers.unarchive(d.id, FINANCEUR.id))).status).toBe(404)
      expect((await s.p.dossier.findUnique({ where: { id: d.id } }))!.publicationStatus).toBe(
        'archived',
      )
    })

    it('hides an archived request’s presentation from share recipients, as a draft', async () => {
      const s = setup()
      await s.p.user.create({ data: { ...SOPHIE } })
      const d = await publishedRequest(s)
      await s.p.shareLink.create({
        data: {
          dossierId: d.id,
          recipientEmail: FINANCEUR.email,
          status: 'active',
          accessLevel: 'complet',
        },
      })
      expect(await s.dossiers.getWithQuestionnaire(d.id, FINANCEUR)).toMatchObject({
        summary: complete.summary,
      })
      await s.dossiers.archive(d.id, SOPHIE.id)
      expect(await s.dossiers.getWithQuestionnaire(d.id, FINANCEUR)).toMatchObject({
        publicationStatus: 'archived',
        summary: null,
        objective: null,
        amountEur: null,
        financingTypes: [],
      })
    })
  })

  describe('documents selected by each request', () => {
    async function twoRequests() {
      const ctx = setup()
      const { dossiers, documents } = ctx
      const a = await dossiers.create({ owner: SOPHIE, name: 'Amorçage' })
      const b = await dossiers.createForCompany({
        owner: SOPHIE,
        companyId: a.companyId,
        name: 'Croissance',
      })
      const bp1 = await documents.upload({ dossier: a, filename: 'bp.pdf', buffer: PDF('bp 1') })
      const deck = await documents.upload({ dossier: a, filename: 'deck.pdf', buffer: PDF('deck') })
      const bp2 = await documents.upload({ dossier: b, filename: 'bp.pdf', buffer: PDF('bp 2') })
      return { ...ctx, a, b, bp1, bp2, deck }
    }
    const files = (groups: Array<{ filename: string; versions: Array<{ version: number }> }>) =>
      Object.fromEntries(groups.map((g) => [g.filename, g.versions.map((v) => v.version)]))

    it('selects a new document for the request it is deposited through, and lets a new version change no selection', async () => {
      const { fake, a, b } = await twoRequests()
      const rows = [...fake.table('dossierDocument').values()]
      // bp.pdf and deck.pdf deposited through A; the new version of bp.pdf through B selects nothing.
      expect(rows.map((r) => r.dossierId)).toEqual([a.id, a.id])
      expect(rows.every((r) => r.pinnedVersionId === null)).toBe(true)
      expect(rows.some((r) => r.dossierId === b.id)).toBe(false)
    })

    it('shows each share only its request’s documents, the latest version or the pinned one', async () => {
      const { documents, audit, a, b, bp1, bp2, deck } = await twoRequests()
      // B pins the first version of the business plan and adds nothing else.
      await documents.select({
        dossier: b,
        documentId: bp1.libraryDocumentId,
        pinnedVersionId: bp1.id,
        actorId: SOPHIE.id,
      })
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          actionType: 'dossier_document_selected',
          dossierId: b.id,
          metadata: expect.objectContaining({ pinnedVersionId: bp1.id, pinnedVersion: 1 }),
        }),
      )
      expect(files(await documents.listForDossier(a, 'complet', 'share'))).toEqual({
        'bp.pdf': [2],
        'deck.pdf': [1],
      })
      expect(files(await documents.listForDossier(b, 'complet', 'share'))).toEqual({
        'bp.pdf': [1],
      })
      // The owner reads the whole library, every version, with each request's selection.
      const owned = await documents.listForDossier(b, 'complet', 'owner')
      expect(files(owned)).toEqual({ 'bp.pdf': [2, 1], 'deck.pdf': [1] })
      expect(owned.map((g) => [g.filename, g.selection])).toEqual([
        ['bp.pdf', { pinnedVersionId: bp1.id }],
        ['deck.pdf', null],
      ])
      // Reading a file follows the same rule.
      await expect(documents.readFile(b, 'complet', bp1.id, 'share')).resolves.toBeDefined()
      for (const [dossier, version] of [
        [b, bp2],
        [b, deck],
        [a, bp1],
      ] as const) {
        await expect(
          documents.readFile(dossier, 'complet', version.id, 'share'),
        ).rejects.toMatchObject({
          status: 404,
        })
        await expect(
          documents.readFile(dossier, 'complet', version.id, 'owner'),
        ).resolves.toBeDefined()
      }
    })

    it('still applies the share level to a selected document', async () => {
      const { documents, a } = await twoRequests()
      // Documents not attached to a question require `complet` (E03.11).
      expect(await documents.listForDossier(a, 'partiel', 'share')).toEqual([])
      const [listed] = await documents.listForDossier(a, 'complet', 'share')
      await expect(
        documents.readFile(a, 'partiel', listed.current.id, 'share'),
      ).rejects.toMatchObject({ status: 404 })
    })

    it('switches between following and pinning, unselects, and refuses what is not the company’s', async () => {
      const { p, documents, audit, dossiers, a, bp1, bp2, deck } = await twoRequests()
      await documents.select({
        dossier: a,
        documentId: bp1.libraryDocumentId,
        pinnedVersionId: bp1.id,
        actorId: SOPHIE.id,
      })
      expect(files(await documents.listForDossier(a, 'complet', 'share'))['bp.pdf']).toEqual([1])
      await documents.select({
        dossier: a,
        documentId: bp1.libraryDocumentId,
        pinnedVersionId: null,
        actorId: SOPHIE.id,
      })
      expect(files(await documents.listForDossier(a, 'complet', 'share'))['bp.pdf']).toEqual([2])
      // Selecting the same way again journals nothing.
      const before = audit.record.mock.calls.length
      await documents.select({
        dossier: a,
        documentId: bp1.libraryDocumentId,
        pinnedVersionId: null,
        actorId: SOPHIE.id,
      })
      expect(audit.record.mock.calls.length).toBe(before)

      await documents.unselect({
        dossier: a,
        documentId: deck.libraryDocumentId,
        actorId: SOPHIE.id,
      })
      expect(Object.keys(files(await documents.listForDossier(a, 'complet', 'share')))).toEqual([
        'bp.pdf',
      ])
      expect(audit.record).toHaveBeenLastCalledWith(
        expect.objectContaining({ actionType: 'dossier_document_unselected', dossierId: a.id }),
      )
      await documents.unselect({
        dossier: a,
        documentId: deck.libraryDocumentId,
        actorId: SOPHIE.id,
      })
      expect(audit.record).toHaveBeenCalledTimes(before + 1)

      // A version of another document, a document of another company: not found, nothing written.
      const wrongVersion = await failure(
        documents.select({
          dossier: a,
          documentId: deck.libraryDocumentId,
          pinnedVersionId: bp2.id,
          actorId: SOPHIE.id,
        }),
      )
      expect(wrongVersion).toMatchObject({
        status: 404,
        body: { code: 'DOCUMENT_VERSION_NOT_FOUND' },
      })
      const other = await dossiers.create({ owner: MARC, name: 'Agrotech' })
      const foreign = await documents.upload({
        dossier: other,
        filename: 'x.pdf',
        buffer: PDF('x'),
      })
      for (const attempt of [
        documents.select({
          dossier: a,
          documentId: foreign.libraryDocumentId,
          pinnedVersionId: null,
          actorId: SOPHIE.id,
        }),
        documents.unselect({
          dossier: a,
          documentId: foreign.libraryDocumentId,
          actorId: SOPHIE.id,
        }),
      ]) {
        expect(await failure(attempt)).toMatchObject({
          status: 404,
          body: { code: 'DOCUMENT_NOT_FOUND' },
        })
      }
      expect(await p.dossierDocument.count({ where: { dossierId: a.id } })).toBe(1)
    })
  })
})
