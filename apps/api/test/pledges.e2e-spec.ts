import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { ZodValidationPipe } from 'nestjs-zod'
import request from 'supertest'
import type { App } from 'supertest/types'
import {
  dossierPledgesSchema,
  opportunitiesSchema,
  opportunityPledgeSchema,
  opportunitySchema,
} from '@confluent/shared'
import { AppModule } from './../src/app.module'
import { GlobalExceptionFilter } from './../src/common/filters/global-exception.filter'
import { PrismaService } from './../src/prisma/prisma.service'
import { EMAIL_TRANSPORT } from './../src/modules/auth/email/email-transport'
import { createFakePrisma } from '../src/testing/fake-prisma'

const id = (n: number) => `7d3c1b0e-0000-4000-8000-0000000076${n.toString().padStart(2, '0')}`
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

type Pledge = {
  intention: string
  amountEur: number
  comment: string | null
  showName: boolean
  showAmount: boolean
  version: number
  pledgedAt: string
  updatedAt: string
}
type Item = { dossier: { id: string; name: string }; pledge: Pledge | null }
type OwnerView = {
  count: number
  totalEur: number
  shown: Array<{
    identity: { name: string | null; organizations: string[] } | null
    amountEur: number | null
  }>
}

// ROADMAP E07.06 over HTTP on the stateful fake Prisma: an investor pledges on a request they read as
// an opportunity (THE rule of E07.03), once, and changes it from the version they read until the
// request is closed (archived); its owner sees the count and total of the pledges of investors who
// still read it, and the name and amount each chose to show — nobody else sees anything; every change
// is journaled, out of the owner's journal.
describe('Pledges (e2e)', () => {
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

  const CHANGED = /a changé entre-temps/
  const pledgeUrl = (dossierId: string) => `/v1/opportunities/${dossierId}/pledge`
  const BASE = { intention: 'likely', amountEur: 25_000, showName: false, showAmount: false }
  const pledge = async (u: { id: string }, dossierId: string, body: object) => {
    const res = (
      await as(u)
        .put(pledgeUrl(dossierId), { ...BASE, version: null, ...body })
        .expect(200)
    ).body
    valid(opportunityPledgeSchema, res)
    return res as Pledge
  }
  const refused = async (u: { id: string }, dossierId: string, body: object, status: number) =>
    (
      await as(u)
        .put(pledgeUrl(dossierId), { ...BASE, version: null, ...body })
        .expect(status)
    ).body.error as { code?: string; message: string }
  const ownerView = async (owner: typeof sophie, dossierId: string) => {
    const body = (await owner.get(`/v1/dossiers/${dossierId}/pledges`).expect(200)).body
    valid(dossierPledgesSchema, body)
    return body as OwnerView
  }
  const totals = async (dossierId: string) => {
    const view = await ownerView(sophie, dossierId)
    return [view.count, view.totalEur]
  }
  const journal = () =>
    [...fake.table('auditLog').values()].filter((e) =>
      String(e.actionType).startsWith('investor_pledge_'),
    )
  const named = (email: string) => {
    const row = [...fake.table('user').values()].find((u) => u.email === email)!
    return (first: string, last: string) => Object.assign(row, { firstName: first, lastName: last })
  }

  it('takes one pledge per investor and request; the owner sees the count and total, and only the names and amounts chosen', async () => {
    const { bio } = await world()
    named(CLAIRE.email)('Claire', 'Martin')
    named(BOB.email)('Bob', 'Durand')

    const first = await pledge(CLAIRE, bio.id, { comment: '  Si le lead est confirmé.  ' })
    expect(first).toMatchObject({
      intention: 'likely',
      amountEur: 25_000,
      comment: 'Si le lead est confirmé.',
      showName: false,
      showAmount: false,
      version: 1,
    })
    // Counted in the total, nothing else.
    expect(await ownerView(sophie, bio.id)).toEqual({ count: 1, totalEur: 25_000, shown: [] })
    expect(fake.table('investorPledge').size).toBe(1)

    // The amount shown: an anonymous line with it.
    const second = await pledge(CLAIRE, bio.id, {
      comment: 'Si le lead est confirmé.',
      showAmount: true,
      version: 1,
    })
    expect(second).toMatchObject({ version: 2, pledgedAt: first.pledgedAt, showAmount: true })
    expect((await ownerView(sophie, bio.id)).shown).toEqual([{ identity: null, amountEur: 25_000 }])

    // Bob shows his name, not his amount; Claire then her name too.
    await pledge(BOB, bio.id, { intention: 'strong', amountEur: 100_000, showName: true })
    await pledge(CLAIRE, bio.id, {
      comment: 'Si le lead est confirmé.',
      showName: true,
      showAmount: true,
      version: 2,
    })
    const view = await ownerView(sophie, bio.id)
    expect(view).toEqual({
      count: 2,
      totalEur: 125_000,
      shown: [
        {
          identity: { name: 'Claire Martin', organizations: ['Angels Touraine'] },
          amountEur: 25_000,
        },
        { identity: { name: 'Bob Durand', organizations: [] }, amountEur: null },
      ],
    })
    // Never the intention, the comment, a date or an address.
    const raw = JSON.stringify(view)
    for (const hidden of ['strong', 'likely', 'lead', 'At', '@']) expect(raw).not.toContain(hidden)

    expect(
      journal().map((e) => [e.actorId, e.actionType, (e.metadata as { change: string }).change]),
    ).toEqual([
      [CLAIRE.id, 'investor_pledge_set', 'pledged'],
      [CLAIRE.id, 'investor_pledge_set', 'changed'],
      [BOB.id, 'investor_pledge_set', 'pledged'],
      [CLAIRE.id, 'investor_pledge_set', 'changed'],
    ])
    // The comment's text stays out of the journal.
    expect(JSON.stringify(journal())).not.toContain('lead')
    expect(journal()[0].metadata).toMatchObject({ amountEur: 25_000, hasComment: true, version: 1 })
    // Out of the owner's history (E07.09), in the administrators'.
    const ownerHistory = (await sophie.get(`/v1/dossiers/${bio.id}/history`).expect(200)).body
    expect(JSON.stringify(ownerHistory)).not.toMatch(/investor_|pledge|25000|25 000/i)
    const adminJournal = (await as(ADMIN).get(`/v1/admin/dossiers/${bio.id}/audit-log`).expect(200))
      .body
    expect(
      adminJournal.filter((e: { actionType: string }) =>
        e.actionType.startsWith('investor_pledge'),
      ),
    ).toHaveLength(4)
  })

  it('changes a pledge only from the version read: a double click changes nothing, a stale tab is refused', async () => {
    const { bio } = await world()
    const first = await pledge(CLAIRE, bio.id, {})
    // The same pledge again (a double click, whatever version it carries): unchanged, unjournaled.
    expect(await pledge(CLAIRE, bio.id, {})).toEqual(first)
    expect(await pledge(CLAIRE, bio.id, { version: 1 })).toEqual(first)
    expect(journal()).toHaveLength(1)

    // Another first pledge (a second tab): refused, never overwritten.
    const twice = await refused(CLAIRE, bio.id, { amountEur: 30_000 }, 409)
    expect(twice.message).toMatch(CHANGED)
    // Tab A changes it; tab B, still on version 1, is refused.
    const changed = await pledge(CLAIRE, bio.id, { amountEur: 30_000, version: 1 })
    expect(changed.version).toBe(2)
    const stale = await refused(CLAIRE, bio.id, { amountEur: 40_000, version: 1 }, 409)
    expect(stale.message).toMatch(CHANGED)
    expect(stale.message).toMatch(/rechargez la page/)
    // A version of a pledge that is no more.
    await as(CLAIRE).delete(pledgeUrl(bio.id)).expect(204)
    expect((await refused(CLAIRE, bio.id, { version: 2 }, 409)).message).toMatch(CHANGED)
    expect(fake.table('investorPledge').size).toBe(0)
    expect(journal()).toHaveLength(3)
  })

  // Code review R63: a pledge withdrawn, then made again, gets a revision never given before — the
  // tab still holding the withdrawn pledge's revision cannot overwrite the new one, its amount or
  // the visibilities taken back.
  it('refuses a tab holding a withdrawn pledge, after a new pledge is made', async () => {
    const { bio } = await world()
    named(CLAIRE.email)('Claire', 'Martin')
    const open = { intention: 'likely', showName: true, showAmount: true }
    const old = await pledge(CLAIRE, bio.id, { ...open, amountEur: 25_000 })
    // Another tab: withdrawn, then made again, nothing shown.
    await as(CLAIRE).delete(pledgeUrl(bio.id)).expect(204)
    const again = await pledge(CLAIRE, bio.id, { amountEur: 90_000 })
    expect(again.version).not.toBe(old.version)
    // The first tab, from the withdrawn pledge's revision.
    const stale = await refused(
      CLAIRE,
      bio.id,
      { ...open, amountEur: 35_000, version: old.version },
      409,
    )
    expect(stale.message).toMatch(CHANGED)
    expect(await ownerView(sophie, bio.id)).toEqual({ count: 1, totalEur: 90_000, shown: [] })
    // From the revision read, the change goes through; the same pledge again changes nothing.
    const shown = await pledge(CLAIRE, bio.id, {
      amountEur: 90_000,
      showAmount: true,
      version: again.version,
    })
    expect(
      await pledge(CLAIRE, bio.id, { amountEur: 90_000, showAmount: true, version: again.version }),
    ).toEqual(shown)
  })

  it('validates the whole pledge, with no default for either visibility', async () => {
    const { bio } = await world()
    const url = pledgeUrl(bio.id)
    const full = { ...BASE, version: null }
    for (const body of [
      {},
      { ...full, showName: undefined },
      { ...full, showAmount: undefined },
      { ...full, showName: 'yes' },
      { ...full, version: undefined },
      { ...full, version: 0 },
      { ...full, intention: undefined },
      { ...full, intention: 'firm' },
      { ...full, amountEur: undefined },
      { ...full, amountEur: 0 },
      { ...full, amountEur: 1000.5 },
      { ...full, amountEur: 1_000_000_001 },
      { ...full, amountEur: '25000' },
      { ...full, comment: 'x'.repeat(1001) },
      { ...full, comment: 'Voir <b>ici</b>' },
      { ...full, extra: 1 },
    ]) {
      const res = await as(CLAIRE).put(url, body)
      expect([body, res.status]).toEqual([body, 400])
    }
    await as(CLAIRE).put('/v1/opportunities/not-a-uuid/pledge', full).expect(400)
    expect(fake.table('investorPledge').size).toBe(0)

    // The bounds themselves, and a blank comment meaning none.
    expect((await pledge(CLAIRE, bio.id, { amountEur: 1, comment: ' \n ' })).comment).toBeNull()
    expect(
      (
        await pledge(CLAIRE, bio.id, {
          amountEur: 1_000_000_000,
          comment: 'x'.repeat(1000),
          version: 1,
        })
      ).amountEur,
    ).toBe(1_000_000_000)
    expect(journal()).toHaveLength(2)
  })

  it('refuses whoever does not read the request as an opportunity, and shows the pledges to its owner only', async () => {
    const { bio } = await world()
    await as(ADMIN).post(`/v1/admin/workspaces/${cci}/members/${zoeInCci}/deactivate`).expect(201)
    // Eve: nothing; Marie, Paul: conseillers; Zoé: deactivated; the owner; an administrator.
    for (const someone of [EVE, MARIE, PAUL, ZOE, SOPHIE, ADMIN]) {
      const res = await as(someone).put(pledgeUrl(bio.id), { ...BASE, version: null })
      expect([someone.email, res.status]).toEqual([someone.email, 404])
    }
    await as(CLAIRE)
      .put(pledgeUrl(id(99)), { ...BASE, version: null })
      .expect(404)
    await request(app.getHttpServer())
      .put(pledgeUrl(bio.id))
      .send({ ...BASE, version: null })
      .expect(401)
    expect(fake.table('investorPledge').size).toBe(0)
    expect(journal()).toEqual([])

    await pledge(CLAIRE, bio.id, { showName: true, showAmount: true })
    for (const someone of [MARC, CLAIRE, BOB, MARIE, PAUL, ADMIN]) {
      await as(someone).get(`/v1/dossiers/${bio.id}/pledges`).expect(404)
    }
    await request(app.getHttpServer()).get(`/v1/dossiers/${bio.id}/pledges`).expect(401)
    // Nothing of it in another investor's view of the request.
    const bob = (await as(BOB).get(`/v1/opportunities/${bio.id}`).expect(200)).body
    expect(bob.opportunity.pledge).toBeNull()
    expect(JSON.stringify(bob)).not.toContain('25000')
  })

  it('shows the investor their own pledge in the list and the opportunity, without counting a reading', async () => {
    const { bio, agro } = await world()
    const before = (await as(CLAIRE).get(`/v1/opportunities/${bio.id}`).expect(200)).body
    valid(opportunitySchema, before)
    expect(before.opportunity.pledge).toBeNull()
    const readingsBefore = readings().length

    const made = await pledge(CLAIRE, bio.id, { comment: 'Ticket ferme si BPI suit.' })
    expect(readings()).toHaveLength(readingsBefore)
    const after = (await as(CLAIRE).get(`/v1/opportunities/${bio.id}`).expect(200)).body
    valid(opportunitySchema, after)
    expect(after.opportunity.pledge).toEqual(made)
    const items = (await list(CLAIRE)).items
    expect(items.map((i) => [i.dossier.name, i.pledge])).toEqual(
      expect.arrayContaining([
        ['Biosensio', made],
        ['Agrotech', null],
      ]),
    )
    expect(
      (await as(CLAIRE).get(`/v1/opportunities/${agro.id}`).expect(200)).body.opportunity.pledge,
    ).toBeNull()
  })

  it('counts a pledge only while its investor reads the request; changing it then is refused, hiding or withdrawing it is not', async () => {
    const { bio, toClaire } = await world()
    const inCci = bio.candidatures[cci]
    named(CLAIRE.email)('Claire', 'Martin')
    const claire = await pledge(CLAIRE, bio.id, {
      amountEur: 20_000,
      showName: true,
      showAmount: true,
    })
    await pledge(BOB, bio.id, { amountEur: 50_000 })
    const zoe = await request_(marc, 'Hydro', { workspaces: [cci] })
    await toPool(marc, zoe.candidatures[cci], 'public')
    await pledge(ZOE, zoe.id, { amountEur: 9_000 })
    expect(await totals(bio.id)).toEqual([2, 70_000])

    // Claire keeps reading it through the CCI's pool after her share is revoked…
    await sophie.delete(`/v1/dossiers/${bio.id}/shares/${toClaire.id}`).expect(200)
    expect(await totals(bio.id)).toEqual([2, 70_000])
    // …until the publication is withdrawn: neither counted nor shown, unable to change it.
    await sophie.delete(`/v1/candidatures/${inCci}/pool-publication`).expect(200)
    expect(await ownerView(sophie, bio.id)).toEqual({ count: 1, totalEur: 50_000, shown: [] })
    await refused(
      CLAIRE,
      bio.id,
      { amountEur: 30_000, showName: true, showAmount: true, version: claire.version },
      404,
    )
    // Hiding her name stays hers to do.
    const hidden = await pledge(CLAIRE, bio.id, {
      amountEur: 20_000,
      showName: false,
      showAmount: true,
      version: claire.version,
    })
    expect(hidden.version).toBeGreaterThan(claire.version)
    // Published again: her pledge, never withdrawn, counts again, as she now shows it.
    await toPool(sophie, inCci, 'partiel')
    expect(await ownerView(sophie, bio.id)).toEqual({
      count: 2,
      totalEur: 70_000,
      shown: [{ identity: null, amountEur: 20_000 }],
    })
    // Paused while the request is unpublished: Bob keeps his direct share, Claire has nothing.
    await sophie.post(`/v1/dossiers/${bio.id}/unpublish`).expect(200)
    expect(await totals(bio.id)).toEqual([1, 50_000])
    await sophie.post(`/v1/dossiers/${bio.id}/publish`).expect(200)
    // An account deactivated.
    Object.assign(fake.table('user').get(BOB.id)!, { isActive: false })
    expect(await totals(bio.id)).toEqual([1, 20_000])
    // A membership deactivated.
    expect((await ownerView(marc, zoe.id)).totalEur).toBe(9_000)
    await as(ADMIN).post(`/v1/admin/workspaces/${cci}/members/${zoeInCci}/deactivate`).expect(201)
    expect(await ownerView(marc, zoe.id)).toEqual({ count: 0, totalEur: 0, shown: [] })
    // Withdrawn without any access left: only her own data goes.
    await as(ZOE).get(`/v1/opportunities/${zoe.id}`).expect(404)
    await as(ZOE).delete(pledgeUrl(zoe.id)).expect(204)
    expect(fake.table('investorPledge').size).toBe(2)
    expect(journal().map((e) => e.actionType)).toEqual([
      'investor_pledge_set',
      'investor_pledge_set',
      'investor_pledge_set',
      'investor_pledge_set',
      'investor_pledge_withdrawn',
    ])
    expect((journal()[3].metadata as { change: string }).change).toBe('hidden')
  })

  it('closes the pledges with the request: once archived, no new pledge, change or withdrawal — hiding stays possible — until unarchived', async () => {
    const { bio } = await world()
    await pledge(BOB, bio.id, { amountEur: 50_000, showName: true, showAmount: true })
    await sophie.post(`/v1/dossiers/${bio.id}/archive`).expect(200)
    // Bob and Claire still read it through their direct shares.
    await as(CLAIRE).get(`/v1/opportunities/${bio.id}`).expect(200)
    const closedNew = await refused(CLAIRE, bio.id, {}, 409)
    expect(closedNew.message).toMatch(/ne reçoit plus de promesse/)
    const change = { amountEur: 60_000, showName: true, showAmount: true, version: 1 }
    expect((await refused(BOB, bio.id, change, 409)).message).toMatch(/promesse est close/)
    const withdrawal = await as(BOB).delete(pledgeUrl(bio.id)).expect(409)
    expect(withdrawal.body.error.message).toMatch(/promesse est close/)
    // Hiding the amount, then the name: possible; showing them again is not.
    await pledge(BOB, bio.id, { amountEur: 50_000, showName: true, version: 1 })
    await pledge(BOB, bio.id, { amountEur: 50_000, version: 2 })
    expect(
      (await refused(BOB, bio.id, { amountEur: 50_000, showName: true, version: 3 }, 409)).message,
    ).toMatch(/promesse est close/)
    expect(await ownerView(sophie, bio.id)).toEqual({ count: 1, totalEur: 50_000, shown: [] })
    // Unarchived: open again (Bob reads the draft through his share).
    await sophie.post(`/v1/dossiers/${bio.id}/unarchive`).expect(200)
    await pledge(BOB, bio.id, { amountEur: 60_000, showAmount: true, version: 3 })
    await as(BOB).delete(pledgeUrl(bio.id)).expect(204)
    expect(await ownerView(sophie, bio.id)).toEqual({ count: 0, totalEur: 0, shown: [] })
  })

  it('withdraws a pledge, journaled once; the same answer without a pledge, whatever the request', async () => {
    const { bio } = await world()
    await pledge(CLAIRE, bio.id, { amountEur: 10_000 })
    await pledge(BOB, bio.id, { amountEur: 15_000 })
    await as(CLAIRE).delete(pledgeUrl(bio.id)).expect(204)
    expect(await totals(bio.id)).toEqual([1, 15_000])
    const detail = (await as(CLAIRE).get(`/v1/opportunities/${bio.id}`).expect(200)).body
    expect(detail.opportunity.pledge).toBeNull()
    // Again, on an unknown request, by someone who reads nothing: the same 204, nothing journaled.
    await as(CLAIRE).delete(pledgeUrl(bio.id)).expect(204)
    await as(CLAIRE)
      .delete(pledgeUrl(id(99)))
      .expect(204)
    await as(EVE).delete(pledgeUrl(bio.id)).expect(204)
    expect(journal().map((e) => [e.actorId, e.actionType])).toEqual([
      [CLAIRE.id, 'investor_pledge_set'],
      [BOB.id, 'investor_pledge_set'],
      [CLAIRE.id, 'investor_pledge_withdrawn'],
    ])
    const withdrawn = journal()[2].metadata as { version: number }
    expect(withdrawn).toMatchObject({ amountEur: 10_000 })
    // A new pledge after a withdrawal gets a revision never given before (code review R63).
    expect((await pledge(CLAIRE, bio.id, { amountEur: 12_000 })).version).toBeGreaterThan(
      withdrawn.version,
    )
  })
})
