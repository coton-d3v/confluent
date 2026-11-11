import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { ZodValidationPipe } from 'nestjs-zod'
import request from 'supertest'
import type { App } from 'supertest/types'
import {
  dossierInterestsSchema,
  opportunitiesSchema,
  opportunityInterestSchema,
  opportunitySchema,
} from '@confluent/shared'
import { AppModule } from './../src/app.module'
import { GlobalExceptionFilter } from './../src/common/filters/global-exception.filter'
import { PrismaService } from './../src/prisma/prisma.service'
import { EMAIL_TRANSPORT } from './../src/modules/auth/email/email-transport'
import { createFakePrisma } from '../src/testing/fake-prisma'

const id = (n: number) => `7d3c1b0e-0000-4000-8000-0000000075${n.toString().padStart(2, '0')}`
// Sophie owns Biosensio, Marc owns Agrotech. Claire: investisseur of the CCI; Bob: investisseur of
// the club deal; Zoé: investisseur of the CCI, deactivated; Marie: conseillère of the CCI; Paul:
// conseiller of the club deal; Eve: an account without any share nor membership.
const SOPHIE = { id: id(1), email: 'sophie@biosensio.fr', role: 'entrepreneur' }
const MARC = { id: id(2), email: 'marc@agrotech.fr', role: 'entrepreneur' }
const CLAIRE = { id: id(3), email: 'claire@angels.fr', role: 'financeur' }
const BOB = { id: id(4), email: 'bob@banque.fr', role: 'financeur' }
const ZOE = { id: id(5), email: 'zoe@angels.fr', role: 'financeur' }
const MARIE = { id: id(6), email: 'marie@cci.fr', role: 'financeur' }
const PAUL = { id: id(7), email: 'paul@club.fr', role: 'financeur' }
const EVE = { id: id(8), email: 'eve@fonds.fr', role: 'financeur' }
const ADMIN = { id: id(9), email: 'admin@confluent.dev', role: 'admin' }
const PEOPLE = [SOPHIE, MARC, CLAIRE, BOB, ZOE, MARIE, PAUL, EVE, ADMIN]
const VERSION = id(90)
const CONFLUENT_FORM = id(91)
const SECTION = id(92)
// The profile's questions, one per level; the sector is computed from the partial one.
const NAME_FIELD = id(93)
const SECTOR_FIELD = id(94)
const FINANCE_FIELD = id(95)

const valid = <T>(schema: { safeParse: (v: unknown) => { error?: { issues: T[] } } }, v: unknown) =>
  expect(schema.safeParse(v).error?.issues ?? []).toEqual([])

type Item = {
  dossier: { id: string; name: string }
  interest: { markedAt: string; nameVisible: boolean } | null
}

// ROADMAP E07.05 over HTTP on the stateful fake Prisma: an investor marks their interest in a request
// they read as an opportunity (THE rule of E07.03), once; its owner sees how many investors who still
// read it marked it, and the names of those who chose to show theirs (D05) — nobody else sees
// anything; every change is journaled, out of the owner's journal.
describe('Marks of interest (e2e)', () => {
  let app: INestApplication<App>
  let fake: ReturnType<typeof createFakePrisma>
  const tokens: Record<string, string> = {}
  let cci: string
  let club: string
  let zoeInCci: string

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
    await p.questionnaireSection.create({
      data: { id: SECTION, versionId: VERSION, key: 'identite', title: 'Identité', orderIndex: 0 },
    })
    for (const [i, f] of [
      { id: NAME_FIELD, key: 'nom', label: 'Nom', minAccessLevel: 'public' },
      { id: SECTOR_FIELD, key: 'secteur_activite', label: 'Secteur', minAccessLevel: 'partiel' },
      { id: FINANCE_FIELD, key: 'chiffre', label: 'Chiffre', minAccessLevel: 'complet' },
    ].entries()) {
      await p.questionnaireField.create({
        data: { ...f, fieldType: 'text', orderIndex: i, sectionId: SECTION, versionId: VERSION },
      })
    }
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
    const invite = async (workspaceId: string, body: object) =>
      (await admin.post(`/v1/admin/workspaces/${workspaceId}/members`, body).expect(201)).body
    await invite(cci, { email: MARIE.email, role: 'conseiller', canManageWorkspace: true })
    await invite(cci, {
      email: CLAIRE.email,
      role: 'investisseur',
      organization: 'Angels Touraine',
    })
    zoeInCci = (await invite(cci, { email: ZOE.email, role: 'investisseur' })).member.id
    await invite(club, { email: PAUL.email, role: 'conseiller', canManageWorkspace: true })
    await invite(club, { email: BOB.email, role: 'investisseur' })
    for (const workspaceId of [cci, club]) {
      const form = await p.questionnaire.create({
        data: {
          slug: `form-${workspaceId}`,
          name: 'Formulaire',
          workspaceId,
          usage: 'candidature',
        },
      })
      await p.questionnaireVersion.create({
        data: { questionnaireId: form.id, version: 1, status: 'published' },
      })
    }
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
  const sophie = as(SOPHIE)
  const marc = as(MARC)
  const list = async (u: { id: string }, query = '') => {
    const body = (await as(u).get(`/v1/opportunities${query}`).expect(200)).body
    valid(opportunitiesSchema, body)
    return body as { total: number; items: Item[]; counts: Record<string, unknown> }
  }
  const readings = () =>
    [...fake.table('auditLog').values()].filter((e) => e.actionType === 'opportunity_viewed')

  // A request of `owner`, its profile answered at each level and classified from the partial
  // question, presented (published or not) and sent to the given workspaces.
  async function request_(
    owner: typeof sophie,
    name: string,
    opts: { publish?: boolean; workspaces?: string[]; amountEur?: number; types?: string[] } = {},
  ) {
    const dossier = (await owner.post('/v1/dossiers', { name }).expect(201)).body
    const row = fake.table('dossier').get(dossier.id)!
    Object.assign(row, {
      submittedAt: new Date(),
      summary: `Résumé de ${name} : capteurs pour l’énergie.`,
      objective: 'Industrialiser',
      amountEur: opts.amountEur ?? 300_000,
      financingTypes: opts.types ?? ['equity'],
      sector: `Secteur de ${name}`,
      classificationSources: { sector: ['secteur_activite'] },
    })
    for (const [fieldId, value] of [
      [NAME_FIELD, `NOM-${name}`],
      [SECTOR_FIELD, `SECTEUR-${name}`],
      [FINANCE_FIELD, `CHIFFRE-SECRET-${name}`],
    ]) {
      await fake.prisma.dossierAnswer.create({
        data: { companyId: row.companyId, fieldId, value },
      })
    }
    if (opts.publish !== false) await owner.post(`/v1/dossiers/${dossier.id}/publish`).expect(200)
    const candidatures: Record<string, string> = {}
    for (const workspaceId of opts.workspaces ?? []) {
      const created = (
        await owner.post(`/v1/dossiers/${dossier.id}/candidatures`, { workspaceId }).expect(201)
      ).body
      await owner.post(`/v1/candidatures/${created.id}/submit`).expect(200)
      candidatures[workspaceId] = created.id
    }
    return { id: dossier.id as string, candidatures }
  }
  const share = async (owner: typeof sophie, dossierId: string, email: string, level: string) =>
    (
      await owner
        .post(`/v1/dossiers/${dossierId}/shares`, { recipientEmail: email, accessLevel: level })
        .expect(201)
    ).body as { id: string; token: string }
  const toPool = (owner: typeof sophie, candidatureId: string, accessLevel: string) =>
    owner
      .put(`/v1/candidatures/${candidatureId}/pool-publication`, { accessLevel, consent: true })
      .expect(200)

  // Biosensio: in the CCI's pool (partial) and the club deal's (complete), shared with Claire
  // (public) and Bob (public). Agrotech: a draft shared with Claire (public).
  async function world() {
    const bio = await request_(sophie, 'Biosensio', { workspaces: [cci, club] })
    await toPool(sophie, bio.candidatures[cci], 'partiel')
    await toPool(sophie, bio.candidatures[club], 'complet')
    const toClaire = await share(sophie, bio.id, CLAIRE.email, 'public')
    const toBob = await share(sophie, bio.id, BOB.email, 'public')
    const agro = await request_(marc, 'Agrotech', { publish: false, amountEur: 80_000 })
    const agroToClaire = await share(marc, agro.id, CLAIRE.email, 'public')
    return { bio, agro, toClaire, toBob, agroToClaire }
  }

  const interestUrl = (dossierId: string) => `/v1/opportunities/${dossierId}/interest`
  const mark = async (u: { id: string }, dossierId: string, nameVisible: boolean) => {
    const body = (await as(u).put(interestUrl(dossierId), { nameVisible }).expect(200)).body
    valid(opportunityInterestSchema, body)
    return body as { markedAt: string; nameVisible: boolean }
  }
  const ownerView = async (owner: typeof sophie, dossierId: string) => {
    const body = (await owner.get(`/v1/dossiers/${dossierId}/interests`).expect(200)).body
    valid(dossierInterestsSchema, body)
    return body as {
      count: number
      named: Array<{ name: string | null; organizations: string[]; markedAt: string }>
    }
  }
  const journal = () =>
    [...fake.table('auditLog').values()].filter((e) =>
      String(e.actionType).startsWith('investor_interest_'),
    )
  const named = (name: string) => {
    const row = [...fake.table('user').values()].find((u) => u.email === name)!
    return (first: string, last: string) => Object.assign(row, { firstName: first, lastName: last })
  }

  it('marks once per investor and request; the owner counts every mark and names only the investors who chose so', async () => {
    const { bio } = await world()
    named(CLAIRE.email)('Claire', 'Martin')
    named(BOB.email)('Bob', 'Durand')

    const first = await mark(CLAIRE, bio.id, false)
    expect(first.nameVisible).toBe(false)
    expect(await ownerView(sophie, bio.id)).toEqual({ count: 1, named: [] })
    // The same answer again: the same mark, nothing journaled.
    expect(await mark(CLAIRE, bio.id, false)).toEqual(first)
    expect(fake.table('investorInterest').size).toBe(1)
    expect(journal()).toHaveLength(1)

    // Showing her name: the same mark (same date), now named with her organization in the CCI.
    const shown = await mark(CLAIRE, bio.id, true)
    expect(shown).toEqual({ markedAt: first.markedAt, nameVisible: true })
    await mark(BOB, bio.id, false)
    expect(await ownerView(sophie, bio.id)).toEqual({
      count: 2,
      named: [
        { name: 'Claire Martin', organizations: ['Angels Touraine'], markedAt: first.markedAt },
      ],
    })
    // Bob shows his: no organization recorded in the club deal.
    await mark(BOB, bio.id, true)
    const view = await ownerView(sophie, bio.id)
    expect(view.count).toBe(2)
    expect(view.named.map((n) => [n.name, n.organizations])).toEqual([
      ['Bob Durand', []],
      ['Claire Martin', ['Angels Touraine']],
    ])
    // Hidden again: counted, not named.
    await mark(BOB, bio.id, false)
    expect((await ownerView(sophie, bio.id)).named.map((n) => n.name)).toEqual(['Claire Martin'])

    expect(
      journal().map((e) => [e.actorId, e.actionType, (e.metadata as { change: string }).change]),
    ).toEqual([
      [CLAIRE.id, 'investor_interest_marked', 'marked'],
      [CLAIRE.id, 'investor_interest_marked', 'name_shown'],
      [BOB.id, 'investor_interest_marked', 'marked'],
      [BOB.id, 'investor_interest_marked', 'name_shown'],
      [BOB.id, 'investor_interest_marked', 'name_hidden'],
    ])
    expect(journal().every((e) => e.dossierId === bio.id)).toBe(true)
    // Out of the owner's journal, which would name every investor; in the administrators'.
    const ownerJournal = (await sophie.get(`/v1/dossiers/${bio.id}/audit-log`).expect(200)).body
    expect(
      ownerJournal.filter((e: { actionType: string }) => e.actionType.startsWith('investor_')),
    ).toEqual([])
    const adminJournal = (await as(ADMIN).get(`/v1/admin/dossiers/${bio.id}/audit-log`).expect(200))
      .body
    expect(
      adminJournal.filter((e: { actionType: string }) => e.actionType.startsWith('investor_')),
    ).toHaveLength(5)
  })

  it('shows the investor their own mark in the list and the opportunity, with who the owner would see', async () => {
    const { bio, agro } = await world()
    named(CLAIRE.email)('Claire', 'Martin')
    const before = (await as(CLAIRE).get(`/v1/opportunities/${bio.id}`).expect(200)).body
    valid(opportunitySchema, before)
    expect(before.opportunity.interest).toBeNull()
    expect(before.opportunity.shownAs).toEqual({
      name: 'Claire Martin',
      organizations: ['Angels Touraine'],
    })
    const readingsBefore = readings().length

    const marked = await mark(CLAIRE, bio.id, true)
    // Marking is no reading of the opportunity.
    expect(readings()).toHaveLength(readingsBefore)
    const after = (await as(CLAIRE).get(`/v1/opportunities/${bio.id}`).expect(200)).body
    expect(after.opportunity.interest).toEqual(marked)
    const items = (await list(CLAIRE)).items
    expect(items.map((i) => [i.dossier.name, i.interest])).toEqual(
      expect.arrayContaining([
        ['Biosensio', marked],
        ['Agrotech', null],
      ]),
    )
    // A direct share only: no organization. An account without a name: none, never its address.
    const agrotech = (await as(CLAIRE).get(`/v1/opportunities/${agro.id}`).expect(200)).body
    expect(agrotech.opportunity.shownAs).toEqual({ name: 'Claire Martin', organizations: [] })
    const bob = (await as(BOB).get(`/v1/opportunities/${bio.id}`).expect(200)).body
    expect(bob.opportunity.shownAs).toEqual({ name: null, organizations: [] })
    await mark(BOB, bio.id, true)
    expect((await ownerView(sophie, bio.id)).named.map((n) => n.name)).toEqual([
      null,
      'Claire Martin',
    ])
    expect(JSON.stringify(await ownerView(sophie, bio.id))).not.toContain('@')
  })

  it('refuses whoever does not read the request as an opportunity, and shows the marks to its owner only', async () => {
    const { bio } = await world()
    await as(ADMIN).post(`/v1/admin/workspaces/${cci}/members/${zoeInCci}/deactivate`).expect(201)
    // Eve: nothing; Marie, Paul: conseillers; Zoé: deactivated; the owner; an administrator.
    for (const someone of [EVE, MARIE, PAUL, ZOE, SOPHIE, ADMIN]) {
      await as(someone).put(interestUrl(bio.id), { nameVisible: true }).expect(404)
    }
    await as(CLAIRE)
      .put(interestUrl(id(99)), { nameVisible: true })
      .expect(404)
    await request(app.getHttpServer())
      .put(interestUrl(bio.id))
      .send({ nameVisible: true })
      .expect(401)
    for (const body of [{}, { nameVisible: 'yes' }, { nameVisible: true, extra: 1 }]) {
      await as(CLAIRE).put(interestUrl(bio.id), body).expect(400)
    }
    await as(CLAIRE).put('/v1/opportunities/not-a-uuid/interest', { nameVisible: true }).expect(400)
    expect(fake.table('investorInterest').size).toBe(0)
    expect(journal()).toEqual([])

    await mark(CLAIRE, bio.id, true)
    for (const someone of [MARC, CLAIRE, BOB, MARIE, PAUL, ADMIN]) {
      await as(someone).get(`/v1/dossiers/${bio.id}/interests`).expect(404)
    }
    await request(app.getHttpServer()).get(`/v1/dossiers/${bio.id}/interests`).expect(401)
    // Nothing of it in the other readers' views of the request.
    const bob = (await as(BOB).get(`/v1/opportunities/${bio.id}`).expect(200)).body
    expect(bob.opportunity.interest).toBeNull()
    expect(JSON.stringify(bob)).not.toContain('Angels')
  })

  it('counts a mark only while its investor reads the request: revoked share, withdrawn or paused publication, deactivated membership or account', async () => {
    const { bio, toClaire } = await world()
    const inCci = bio.candidatures[cci]
    named(CLAIRE.email)('Claire', 'Martin')
    await mark(CLAIRE, bio.id, true)
    await mark(BOB, bio.id, false)
    const zoe = await request_(marc, 'Hydro', { workspaces: [cci] })
    await toPool(marc, zoe.candidatures[cci], 'public')
    await mark(ZOE, zoe.id, true)
    const counts = async () => [
      (await ownerView(sophie, bio.id)).count,
      (await ownerView(sophie, bio.id)).named.length,
    ]
    expect(await counts()).toEqual([2, 1])

    // Claire keeps reading it through the CCI's pool after her share is revoked…
    await sophie.delete(`/v1/dossiers/${bio.id}/shares/${toClaire.id}`).expect(200)
    expect(await counts()).toEqual([2, 1])
    // …until the publication is withdrawn: neither counted nor named, unable to mark.
    await sophie.delete(`/v1/candidatures/${inCci}/pool-publication`).expect(200)
    expect(await counts()).toEqual([1, 0])
    await as(CLAIRE).put(interestUrl(bio.id), { nameVisible: false }).expect(404)
    // Published again: her mark, never withdrawn, counts again — hers to withdraw.
    await toPool(sophie, inCci, 'partiel')
    expect(await counts()).toEqual([2, 1])
    // Paused while the request is unpublished: Bob keeps his direct share, Claire has nothing.
    await sophie.post(`/v1/dossiers/${bio.id}/unpublish`).expect(200)
    expect(await counts()).toEqual([1, 0])
    await sophie.post(`/v1/dossiers/${bio.id}/publish`).expect(200)
    expect(await counts()).toEqual([2, 1])
    // An account deactivated.
    Object.assign(fake.table('user').get(BOB.id)!, { isActive: false })
    expect(await counts()).toEqual([1, 1])

    // A membership deactivated.
    expect((await ownerView(marc, zoe.id)).count).toBe(1)
    await as(ADMIN).post(`/v1/admin/workspaces/${cci}/members/${zoeInCci}/deactivate`).expect(201)
    expect(await ownerView(marc, zoe.id)).toEqual({ count: 0, named: [] })
    // The marks themselves stay, unchanged and unjournaled.
    expect(fake.table('investorInterest').size).toBe(3)
    expect(journal()).toHaveLength(3)
  })

  it('takes no new mark nor a name newly shown on an archived request; hiding and withdrawing stay possible', async () => {
    const { bio } = await world()
    await mark(BOB, bio.id, true)
    await sophie.post(`/v1/dossiers/${bio.id}/archive`).expect(200)
    // Bob and Claire still read it through their direct shares.
    await as(CLAIRE).get(`/v1/opportunities/${bio.id}`).expect(200)
    const refused = await as(CLAIRE).put(interestUrl(bio.id), { nameVisible: false }).expect(409)
    expect(refused.body.error.message).toMatch(/archivée par son porteur/)
    await mark(BOB, bio.id, false)
    await as(BOB).put(interestUrl(bio.id), { nameVisible: true }).expect(409)
    expect(await ownerView(sophie, bio.id)).toEqual({ count: 1, named: [] })
    await as(BOB).delete(interestUrl(bio.id)).expect(204)
    expect(await ownerView(sophie, bio.id)).toEqual({ count: 0, named: [] })
    await as(BOB).put(interestUrl(bio.id), { nameVisible: false }).expect(409)
  })

  it('withdraws a mark, journaled once; the same answer without a mark, whatever the request', async () => {
    const { bio, toClaire } = await world()
    await mark(CLAIRE, bio.id, true)
    await mark(BOB, bio.id, false)
    await as(CLAIRE).delete(interestUrl(bio.id)).expect(204)
    expect(await ownerView(sophie, bio.id)).toEqual({ count: 1, named: [] })
    const detail = (await as(CLAIRE).get(`/v1/opportunities/${bio.id}`).expect(200)).body
    expect(detail.opportunity.interest).toBeNull()
    // Again, on an unknown request, by someone who reads nothing: the same 204, nothing journaled.
    await as(CLAIRE).delete(interestUrl(bio.id)).expect(204)
    await as(CLAIRE)
      .delete(interestUrl(id(99)))
      .expect(204)
    await as(EVE).delete(interestUrl(bio.id)).expect(204)
    expect(journal().map((e) => [e.actorId, e.actionType])).toEqual([
      [CLAIRE.id, 'investor_interest_marked'],
      [BOB.id, 'investor_interest_marked'],
      [CLAIRE.id, 'investor_interest_withdrawn'],
    ])
    // Bob withdraws his after losing every access: only his own data goes.
    await sophie.delete(`/v1/dossiers/${bio.id}/shares/${toClaire.id}`).expect(200)
    const shares = (await sophie.get(`/v1/dossiers/${bio.id}/shares`).expect(200)).body
    const bobShare = shares.find((s: { recipientEmail: string }) => s.recipientEmail === BOB.email)
    await sophie.delete(`/v1/dossiers/${bio.id}/shares/${bobShare.id}`).expect(200)
    await sophie.delete(`/v1/candidatures/${bio.candidatures[club]}/pool-publication`).expect(200)
    await as(BOB).get(`/v1/opportunities/${bio.id}`).expect(404)
    await as(BOB).delete(interestUrl(bio.id)).expect(204)
    expect(fake.table('investorInterest').size).toBe(0)
    expect(journal()).toHaveLength(4)
  })
})
