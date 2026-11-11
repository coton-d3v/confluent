import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { ZodValidationPipe } from 'nestjs-zod'
import request from 'supertest'
import type { App } from 'supertest/types'
import {
  candidatureEligibilitiesSchema,
  eligibilitySchemeSchema,
  receivedCandidatureListItemSchema,
} from '@confluent/shared'
import { AppModule } from './../src/app.module'
import { GlobalExceptionFilter } from './../src/common/filters/global-exception.filter'
import { PrismaService } from './../src/prisma/prisma.service'
import { EMAIL_TRANSPORT } from './../src/modules/auth/email/email-transport'
import { createFakePrisma } from '../src/testing/fake-prisma'

const user = (n: number, email: string, role: string) => ({
  id: `7d3c1b0e-0000-4000-8000-0000000012${n.toString().padStart(2, '0')}`,
  email,
  role,
})
// Marie: manager of the CCI; Jean: conseiller of the CCI without the right to manage it; Claire:
// investisseur of the CCI; Paul: manager of the club deal. Sophie and Marc: entrepreneurs. Bob:
// recipient of a share of Sophie's request.
const MARIE = user(1, 'marie@cci.fr', 'financeur')
const JEAN = user(2, 'jean@cci.fr', 'financeur')
const CLAIRE = user(3, 'claire@angels.fr', 'financeur')
const PAUL = user(4, 'paul@club.fr', 'financeur')
const SOPHIE = user(5, 'sophie@biosensio.fr', 'entrepreneur')
const MARC = user(6, 'marc@agrotech.fr', 'entrepreneur')
const BOB = user(7, 'bob@banque.fr', 'financeur')
const ADMIN = user(8, 'admin@confluent.dev', 'admin')
const PEOPLE = [MARIE, JEAN, CLAIRE, PAUL, SOPHIE, MARC, BOB, ADMIN]
const VERSION = '7d3c1b0e-0000-4000-8000-0000000012f1'
const CONFLUENT_FORM = '7d3c1b0e-0000-4000-8000-0000000012f2'

const valid =
  (schema: { safeParse: (v: unknown) => { error?: { issues: unknown[] } } }) => (v: unknown) =>
    expect(schema.safeParse(v).error?.issues ?? []).toEqual([])

// ROADMAP E06.05 over HTTP on the stateful fake Prisma: each workspace's schemes (JEIR, JEI, CIR…),
// configured by its managers; a candidature's eligibilities, declared by its owner or the workspace
// and verified by the workspace alone; the received candidatures filtered by scheme. Information
// only — no amount, no simulation — and nobody else reads it.
describe('Eligibility schemes and eligibilities (e2e)', () => {
  let app: INestApplication<App>
  let fake: ReturnType<typeof createFakePrisma>
  const tokens: Record<string, string> = {}
  let cci: string
  let club: string

  beforeEach(async () => {
    fake = createFakePrisma()
    const p = fake.prisma
    for (const u of PEOPLE) await p.user.create({ data: { ...u, emailVerifiedAt: new Date() } })
    await p.questionnaire.create({
      data: { id: CONFLUENT_FORM, slug: 'dossier', name: 'Profil', usage: 'dossier' },
    })
    await p.questionnaireVersion.create({
      data: { id: VERSION, questionnaireId: CONFLUENT_FORM, version: 1, status: 'published' },
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
    const admin = as(ADMIN)
    cci = (await admin.post('/v1/admin/workspaces', { name: 'CCI Touraine' }).expect(201)).body.id
    club = (await admin.post('/v1/admin/workspaces', { name: 'Club deal' }).expect(201)).body.id
    const invite = (workspaceId: string, body: object) =>
      admin.post(`/v1/admin/workspaces/${workspaceId}/members`, body).expect(201)
    await invite(cci, { email: MARIE.email, role: 'conseiller', canManageWorkspace: true })
    await invite(cci, { email: JEAN.email, role: 'conseiller' })
    await invite(cci, { email: CLAIRE.email, role: 'investisseur' })
    await invite(club, { email: PAUL.email, role: 'conseiller', canManageWorkspace: true })
  })

  afterEach(async () => {
    await app.close()
  })

  const auth = (u: { id: string }) => `Bearer ${tokens[u.id]}`
  const as = (u: { id: string }) => ({
    get: (url: string) => request(app.getHttpServer()).get(url).set('Authorization', auth(u)),
    post: (url: string, body?: object) =>
      request(app.getHttpServer()).post(url).set('Authorization', auth(u)).send(body),
    put: (url: string, body: object) =>
      request(app.getHttpServer()).put(url).set('Authorization', auth(u)).send(body),
    patch: (url: string, body: object) =>
      request(app.getHttpServer()).patch(url).set('Authorization', auth(u)).send(body),
    delete: (url: string) => request(app.getHttpServer()).delete(url).set('Authorization', auth(u)),
  })

  // A published complementary form without question, assigned to the workspace's candidatures.
  async function openToCandidatures(designer: { id: string }, workspaceId: string) {
    const d = as(designer)
    const forms = `/v1/admin/workspaces/${workspaceId}/forms`
    const form = (await d.post(forms, { name: 'Candidature' }).expect(201)).body
    const section = (
      await d.post(`${forms}/${form.id}/draft/sections`, { title: 'Candidature' }).expect(201)
    ).body.sections[0]
    await d
      .post(`${forms}/${form.id}/draft/fields`, {
        sectionId: section.id,
        label: 'Commentaire',
        fieldType: 'textarea',
        required: false,
      })
      .expect(201)
    await d.post(`${forms}/${form.id}/draft/publish`).expect(200)
    await d.put(`${forms}/${form.id}/usage`, { usage: 'candidature' }).expect(200)
  }

  // A request of `owner` presented to both workspaces (drafts).
  async function present(owner: { id: string }, name: string) {
    const o = as(owner)
    const dossier = (await o.post('/v1/dossiers', { name }).expect(201)).body
    const candidaturesOf = `/v1/dossiers/${dossier.id}/candidatures`
    const toCci = (await o.post(candidaturesOf, { workspaceId: cci }).expect(201)).body
    const toClub = (await o.post(candidaturesOf, { workspaceId: club }).expect(201)).body
    const send = async (...ids: string[]) => {
      await o.post(`/v1/dossiers/${dossier.id}/submit`).expect(200)
      for (const id of ids) await o.post(`/v1/candidatures/${id}/submit`).expect(200)
    }
    return { dossier, toCci: toCci.id as string, toClub: toClub.id as string, send }
  }

  const schemesOf = (workspaceId: string) => `/v1/workspaces/${workspaceId}/eligibility-schemes`
  const managed = (workspaceId: string) => `/v1/admin/workspaces/${workspaceId}/eligibility-schemes`
  const own = (candidatureId: string) => `/v1/candidatures/${candidatureId}/eligibilities`
  const received = (workspaceId: string, candidatureId: string) =>
    `/v1/workspaces/${workspaceId}/candidatures/${candidatureId}/eligibilities`
  const schemeId = async (workspaceId: string, key: string) =>
    (await as(ADMIN).get(schemesOf(workspaceId)).expect(200)).body.find(
      (s: { key: string }) => s.key === key,
    ).id as string

  it('gives each workspace the default schemes, read by its conseillers and configured by its managers', async () => {
    const list = (await as(JEAN).get(schemesOf(cci)).expect(200)).body
    list.forEach(valid(eligibilitySchemeSchema))
    expect(list.map((s: { key: string; label: string }) => [s.key, s.label])).toEqual([
      ['jeir', 'JEIR'],
      ['jei', 'JEI'],
      ['cir', 'CIR'],
      ['cii', 'CII'],
      ['ir_pme', 'IR-PME'],
    ])
    // Descriptions say what a scheme is, never what it yields.
    expect(JSON.stringify(list)).not.toMatch(/\d+ ?%|€/)
    await as(CLAIRE).get(schemesOf(cci)).expect(403)
    for (const outsider of [SOPHIE, PAUL, BOB]) await as(outsider).get(schemesOf(cci)).expect(404)

    // Jean reads, does not configure; the club's manager does not reach the CCI.
    await as(JEAN).post(managed(cci), { label: 'JEU' }).expect(403)
    await as(PAUL).post(managed(cci), { label: 'JEU' }).expect(404)
    const marie = as(MARIE)
    const added = (
      await marie
        .post(managed(cci), { label: '  Jeune  entreprise universitaire ', description: ' JEU ' })
        .expect(201)
    ).body
    valid(eligibilitySchemeSchema)(added)
    expect(added).toMatchObject({
      key: 'jeune_entreprise_universitaire',
      label: 'Jeune entreprise universitaire',
      description: 'JEU',
      position: 5,
      active: true,
    })
    const taken = await marie.post(managed(cci), { label: 'jei' }).expect(409)
    expect(taken.body.error.message).toBe('Un dispositif s’appelle déjà « JEI » dans ce workspace.')
    for (const body of [
      { label: '' },
      { label: 'x'.repeat(81) },
      { label: 'X', description: 'x'.repeat(301) },
      { label: 'X', key: 'x' },
    ]) {
      await marie.post(managed(cci), body).expect(400)
    }
    // Renamed and described; the key never changes; every scheme may be deactivated.
    const renamed = (
      await marie
        .patch(`${managed(cci)}/${added.id}`, { label: 'JEU', description: null })
        .expect(200)
    ).body
    expect(renamed).toMatchObject({ key: 'jeune_entreprise_universitaire', description: null })
    for (const s of list) {
      await marie.patch(`${managed(cci)}/${s.id}`, { active: false }).expect(200)
    }
    await marie.patch(`${managed(cci)}/${added.id}`, { key: 'jeu' }).expect(400)
    const reordered = (
      await marie
        .put(`${managed(cci)}/order`, {
          schemeIds: [added.id, ...list.map((s: { id: string }) => s.id)],
        })
        .expect(200)
    ).body
    expect(reordered.map((s: { label: string }) => s.label)).toEqual([
      'JEU',
      'JEIR',
      'JEI',
      'CIR',
      'CII',
      'IR-PME',
    ])
    await marie
      .put(`${managed(cci)}/order`, { schemeIds: list.map((s: { id: string }) => s.id) })
      .expect(409)
    // The club's list is its own, untouched.
    const clubList = (await as(PAUL).get(schemesOf(club)).expect(200)).body
    expect(clubList.map((s: { active: boolean }) => s.active)).toEqual([
      true,
      true,
      true,
      true,
      true,
    ])
    await as(PAUL)
      .patch(`${managed(club)}/${added.id}`, { label: 'Pirate' })
      .expect(404)
    const journal = [...fake.table('auditLog').values()].filter(
      (e) => e.actionType === 'eligibility_schemes_updated',
    )
    expect(journal.map((e) => (e.metadata as { change: string }).change)).toEqual([
      'created',
      'updated',
      'updated',
      'updated',
      'updated',
      'updated',
      'updated',
      'reordered',
    ])
  })

  it('lets the owner declare, the workspace verify, and never overwrites a change made meanwhile', async () => {
    await openToCandidatures(MARIE, cci)
    await openToCandidatures(PAUL, club)
    const { dossier, toCci, send } = await present(SOPHIE, 'Biosensio')
    const sophie = as(SOPHIE)

    // On the draft: the owner declares; the CCI sees nothing yet.
    const empty = (await sophie.get(own(toCci)).expect(200)).body
    valid(candidatureEligibilitiesSchema)(empty)
    expect(empty.eligibilities).toEqual([])
    expect(empty.schemes.map((s: { key: string }) => s.key)).toEqual([
      'jeir',
      'jei',
      'cir',
      'cii',
      'ir_pme',
    ])
    const jei = empty.schemes.find((s: { key: string }) => s.key === 'jei').id
    const cir = empty.schemes.find((s: { key: string }) => s.key === 'cir').id
    const declared = (
      await sophie
        .post(own(toCci), { schemeId: jei, note: '  Rescrit   obtenu en 2025 ' })
        .expect(201)
    ).body
    valid(candidatureEligibilitiesSchema)(declared)
    expect(declared.eligibilities).toEqual([
      expect.objectContaining({
        scheme: expect.objectContaining({ key: 'jei', label: 'JEI' }),
        note: 'Rescrit obtenu en 2025',
        declaredBy: 'owner',
        verifiedAt: null,
        version: 1,
        updatedBy: 'owner',
      }),
    ])
    expect(declared.schemes.map((s: { key: string }) => s.key)).not.toContain('jei')
    // The owner never verifies; a scheme is declared once.
    await sophie.post(own(toCci), { schemeId: cir, verified: true }).expect(400)
    const twice = await sophie.post(own(toCci), { schemeId: jei }).expect(409)
    expect(twice.body.error.message).toMatch(/déjà indiquée/)
    await as(MARIE).get(received(cci, toCci)).expect(404)
    await as(MARIE).post(received(cci, toCci), { schemeId: cir }).expect(404)

    // Sent: Jean (no right to manage) verifies; Marie declares the CIR, verified at once.
    await send(toCci)
    const eligibility = declared.eligibilities[0]
    const verified = (
      await as(JEAN)
        .patch(`${received(cci, toCci)}/${eligibility.id}`, { version: 1, verified: true })
        .expect(200)
    ).body
    expect(verified.eligibilities[0]).toMatchObject({
      verifiedAt: expect.any(String),
      version: 2,
      declaredBy: 'owner',
      updatedBy: 'workspace',
    })
    await as(MARIE).post(received(cci, toCci), { schemeId: cir, verified: true }).expect(201)
    const mine = (await sophie.get(own(toCci)).expect(200)).body
    expect(
      mine.eligibilities.map(
        (e: { scheme: { key: string }; declaredBy: string; verifiedAt: unknown }) => [
          e.scheme.key,
          e.declaredBy,
          e.verifiedAt !== null,
        ],
      ),
    ).toEqual([
      ['jei', 'owner', true],
      ['cir', 'workspace', true],
    ])
    // The owner reads which side, never who.
    expect(JSON.stringify(mine)).not.toMatch(/marie@|jean@|7d3c1b0e-0000-4000-8000-00000000120[12]/)

    // From a stale screen: refused, not written over Jean's verification.
    const stale = await sophie
      .patch(`${own(toCci)}/${eligibility.id}`, { version: 1, note: 'Autre' })
      .expect(409)
    expect(stale.body.error).toMatchObject({
      message: expect.stringMatching(/modifiée entre-temps/),
      details: { currentVersion: 2 },
    })
    // Unchanged: nothing written. Changed by the owner: the verification goes.
    const same = (
      await sophie
        .patch(`${own(toCci)}/${eligibility.id}`, { version: 2, note: 'Rescrit obtenu en 2025' })
        .expect(200)
    ).body
    expect(same.eligibilities[0]).toMatchObject({ version: 2, verifiedAt: expect.any(String) })
    const edited = (
      await sophie
        .patch(`${own(toCci)}/${eligibility.id}`, { version: 2, note: 'Rescrit de 2026' })
        .expect(200)
    ).body
    expect(edited.eligibilities[0]).toMatchObject({
      note: 'Rescrit de 2026',
      verifiedAt: null,
      version: 3,
      updatedBy: 'owner',
    })
    // The owner's update carries the note only; the workspace's needs something to change.
    for (const body of [
      { version: 3, verified: true },
      { version: 3 },
      { note: 'x' },
      { version: 3, note: 'x'.repeat(201) },
    ]) {
      await sophie.patch(`${own(toCci)}/${eligibility.id}`, body).expect(400)
    }
    await as(JEAN)
      .patch(`${received(cci, toCci)}/${eligibility.id}`, { version: 3 })
      .expect(400)
    // Withdrawn by the administrator, then removed from the version seen.
    const unverified = (
      await as(ADMIN)
        .patch(`${received(cci, toCci)}/${mine.eligibilities[1].id}`, {
          version: 1,
          verified: false,
        })
        .expect(200)
    ).body
    expect(unverified.eligibilities[1]).toMatchObject({ verifiedAt: null, version: 2 })
    await sophie.delete(`${own(toCci)}/${eligibility.id}?version=1`).expect(409)
    await sophie.delete(`${own(toCci)}/${eligibility.id}`).expect(400)
    const removed = (await sophie.delete(`${own(toCci)}/${eligibility.id}?version=3`).expect(200))
      .body
    expect(removed.eligibilities.map((e: { scheme: { key: string } }) => e.scheme.key)).toEqual([
      'cir',
    ])
    await sophie.delete(`${own(toCci)}/${eligibility.id}?version=3`).expect(404)

    // A scheme deactivated meanwhile: no new declaration, the existing one stays readable.
    await as(MARIE)
      .patch(`${managed(cci)}/${cir}`, { active: false })
      .expect(200)
    const after = (await as(JEAN).get(received(cci, toCci)).expect(200)).body
    expect(after.eligibilities[0].scheme).toMatchObject({ key: 'cir', active: false })
    await sophie.delete(`${own(toCci)}/${after.eligibilities[0].id}?version=2`).expect(200)
    const inactive = await sophie.post(own(toCci), { schemeId: cir }).expect(409)
    expect(inactive.body.error.message).toMatch(/n’est plus proposé/)

    // Each change is journaled with its side and author.
    const journal = [...fake.table('auditLog').values()].filter(
      (e) => e.actionType === 'candidature_eligibility_updated',
    )
    expect(
      journal.map((e) => [
        (e.metadata as { change: string }).change,
        (e.metadata as { side: string }).side,
        e.actorId,
      ]),
    ).toEqual([
      ['declared', 'owner', SOPHIE.id],
      ['updated', 'workspace', JEAN.id],
      ['declared', 'workspace', MARIE.id],
      ['updated', 'owner', SOPHIE.id],
      ['updated', 'workspace', ADMIN.id],
      ['removed', 'owner', SOPHIE.id],
      ['removed', 'owner', SOPHIE.id],
    ])
    expect(journal.every((e) => e.dossierId === dossier.id)).toBe(true)
  })

  it('filters the received candidatures by scheme, verification and financing status', async () => {
    await openToCandidatures(MARIE, cci)
    await openToCandidatures(PAUL, club)
    const bio = await present(SOPHIE, 'Biosensio')
    const agro = await present(MARC, 'Agrotech')
    const third = await present(SOPHIE, 'Troisième')
    await bio.send(bio.toCci, bio.toClub)
    await agro.send(agro.toCci)
    await third.send(third.toCci)
    const jeir = await schemeId(cci, 'jeir')
    const jei = await schemeId(cci, 'jei')
    const cir = await schemeId(cci, 'cir')
    // Biosensio: JEIR verified, CIR declared. Agrotech: JEI declared. The third: nothing. At the
    // club, Biosensio declares the club's JEIR.
    await as(SOPHIE).post(own(bio.toCci), { schemeId: cir }).expect(201)
    await as(MARIE).post(received(cci, bio.toCci), { schemeId: jeir, verified: true }).expect(201)
    await as(MARC).post(own(agro.toCci), { schemeId: jei }).expect(201)
    await as(SOPHIE)
      .post(own(bio.toClub), { schemeId: await schemeId(club, 'jeir') })
      .expect(201)
    await as(MARIE)
      .post(`/v1/workspaces/${cci}/candidatures/${agro.toCci}/financing-status`, {
        from: 'preparing',
        to: 'in_committee',
      })
      .expect(200)

    const list = async (query = '') => {
      const body = (await as(JEAN).get(`/v1/workspaces/${cci}/candidatures${query}`).expect(200))
        .body
      body.forEach(valid(receivedCandidatureListItemSchema))
      return body as Array<{
        dossier: { name: string }
        eligibilities: Array<{ label: string; verified: boolean }>
      }>
    }
    const names = async (query = '') => (await list(query)).map((c) => c.dossier.name).sort()

    const all = await list()
    expect(
      Object.fromEntries(
        all.map((c) => [c.dossier.name, c.eligibilities.map((e) => [e.label, e.verified])]),
      ),
    ).toEqual({
      // In the order of the CCI's schemes.
      Biosensio: [
        ['JEIR', true],
        ['CIR', false],
      ],
      Agrotech: [['JEI', false]],
      Troisième: [],
    })
    expect(await names(`?scheme=${jeir}`)).toEqual(['Biosensio'])
    expect(await names(`?scheme=${jei}`)).toEqual(['Agrotech'])
    expect(await names(`?scheme=${cir}&verified=true`)).toEqual([])
    expect(await names('?verified=true')).toEqual(['Biosensio'])
    expect(await names('?verified=false')).toEqual(['Agrotech', 'Biosensio', 'Troisième'])
    expect(await names('?financingStatus=in_committee')).toEqual(['Agrotech'])
    expect(await names(`?financingStatus=in_committee&scheme=${jeir}`)).toEqual([])
    // Another workspace's scheme, an unknown one: nothing, never the other workspace's data.
    expect(await names(`?scheme=${await schemeId(club, 'jeir')}`)).toEqual([])
    expect(await names('?scheme=7d3c1b0e-0000-4000-8000-0000000012ff')).toEqual([])
    for (const query of [
      '?scheme=jeir',
      '?verified=yes',
      '?financingStatus=won',
      '?sector=biotech',
      `?scheme=${jeir}&scheme=${jei}`,
    ]) {
      await as(JEAN).get(`/v1/workspaces/${cci}/candidatures${query}`).expect(400)
    }
    // The club lists its own eligibilities only; the CCI's investor and outsiders get nothing.
    const clubList = (await as(PAUL).get(`/v1/workspaces/${club}/candidatures`).expect(200)).body
    expect(clubList.map((c: { eligibilities: unknown[] }) => c.eligibilities)).toEqual([
      [expect.objectContaining({ label: 'JEIR', verified: false })],
    ])
    await as(CLAIRE).get(`/v1/workspaces/${cci}/candidatures?scheme=${jeir}`).expect(403)
    await as(PAUL).get(`/v1/workspaces/${cci}/candidatures?scheme=${jeir}`).expect(404)
  })

  it('keeps each workspace’s eligibilities to its parties: no other workspace, investor, account or share recipient', async () => {
    await openToCandidatures(MARIE, cci)
    await openToCandidatures(PAUL, club)
    const { dossier, toCci, toClub, send } = await present(SOPHIE, 'Biosensio')
    await send(toCci, toClub)
    const sophie = as(SOPHIE)
    const jeir = await schemeId(cci, 'jeir')
    const added = (
      await sophie
        .post(own(toCci), { schemeId: jeir, note: 'Qualification Tours 4242' })
        .expect(201)
    ).body
    const id = added.eligibilities[0].id
    const body = { schemeId: await schemeId(cci, 'cir') }

    // The club reads its own, empty, and never the CCI's.
    expect((await as(PAUL).get(received(club, toClub)).expect(200)).body.eligibilities).toEqual([])
    for (const path of [received(club, toCci), received(cci, toCci)]) {
      await as(PAUL).get(path).expect(404)
      await as(PAUL).post(path, body).expect(404)
    }
    await as(PAUL)
      .patch(`${received(club, toCci)}/${id}`, { version: 1, verified: true })
      .expect(404)
    // A CCI eligibility is unknown through the club's candidature, even to the owner; a CCI scheme
    // cannot be declared for the club.
    await sophie.patch(`${own(toClub)}/${id}`, { version: 1, note: null }).expect(404)
    await sophie.delete(`${own(toClub)}/${id}?version=1`).expect(404)
    const foreign = await sophie.post(own(toClub), body).expect(400)
    expect(foreign.body.error.message).toBe(
      'Choisissez un des dispositifs proposés par la structure.',
    )

    // An investisseur of the CCI: 403; another entrepreneur, the owner on the workspace side, a
    // share recipient: 404.
    await as(CLAIRE).get(received(cci, toCci)).expect(403)
    await as(CLAIRE).post(received(cci, toCci), body).expect(403)
    for (const outsider of [MARC, SOPHIE, BOB]) {
      await as(outsider).get(received(cci, toCci)).expect(404)
    }
    for (const outsider of [MARC, BOB, MARIE, PAUL]) {
      await as(outsider).get(own(toCci)).expect(404)
      await as(outsider).post(own(toCci), body).expect(404)
    }
    const token = (
      await sophie
        .post(`/v1/dossiers/${dossier.id}/shares`, {
          recipientEmail: BOB.email,
          accessLevel: 'complet',
        })
        .expect(201)
    ).body.token as string
    for (const read of [
      (await as(BOB).get(`/v1/shares/${token}`).expect(200)).body,
      (await as(BOB).get(`/v1/dossiers/${dossier.id}`).expect(200)).body,
      (await as(BOB).get('/v1/dossiers').expect(200)).body,
      (await as(PAUL).get(`/v1/workspaces/${club}/candidatures/${toClub}`).expect(200)).body,
      (await as(PAUL).get(`/v1/workspaces/${club}/candidatures`).expect(200)).body,
    ]) {
      expect(JSON.stringify(read)).not.toMatch(/4242|Qualification|JEIR/)
    }
    // A received candidature's page carries none: its own route does (with the same rules).
    const page = (await as(MARIE).get(`/v1/workspaces/${cci}/candidatures/${toCci}`).expect(200))
      .body
    expect(JSON.stringify(page)).not.toMatch(/4242|Qualification|JEIR|eligibilit/i)
    // Nothing was written by the refused calls.
    expect(fake.table('candidatureEligibility').size).toBe(1)
  })
})
