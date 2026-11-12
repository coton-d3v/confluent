import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { ZodValidationPipe } from 'nestjs-zod'
import request from 'supertest'
import type { App } from 'supertest/types'
import {
  dossierInterestsSchema,
  dossierPledgesSchema,
  dossierPositionsSchema,
  myPositionsSchema,
  opportunitySchema,
  positionDisclosureSchema,
  workspacePositionsSchema,
} from '@confluent/shared'
import { AppModule } from './../src/app.module'
import { GlobalExceptionFilter } from './../src/common/filters/global-exception.filter'
import { PrismaService } from './../src/prisma/prisma.service'
import { EMAIL_TRANSPORT } from './../src/modules/auth/email/email-transport'
import { createFakePrisma } from '../src/testing/fake-prisma'

const id = (n: number) => `7d3c1b0e-0000-4000-8000-0000000077${n.toString().padStart(2, '0')}`
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

// ROADMAP E07.07 over HTTP on the stateful fake Prisma: « Mes positionnements » shows an investor
// their own marks, pledges and consents only, with where each request stands; a structure sees an
// investor's position only once that investor consented to show it this very structure, and only
// while they read the request through its pool — nothing otherwise, not even a count; the owner reads
// what E07.05/E07.06 open to them in one view, by consented visibility only.
describe('Positions (e2e)', () => {
  let app: INestApplication<App>
  let fake: ReturnType<typeof createFakePrisma>
  const tokens: Record<string, string> = {}
  let cci: string
  let club: string
  let zoeInCci: string
  let claireInCci: string

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
    claireInCci = (
      await invite(cci, {
        email: CLAIRE.email,
        role: 'investisseur',
        organization: 'Angels Touraine',
      })
    ).member.id
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
  // (public): Bob reads it through the club deal's pool only. Agrotech: a draft shared with Claire
  // (public).
  async function world() {
    const bio = await request_(sophie, 'Biosensio', { workspaces: [cci, club] })
    await toPool(sophie, bio.candidatures[cci], 'partiel')
    await toPool(sophie, bio.candidatures[club], 'complet')
    const toClaire = await share(sophie, bio.id, CLAIRE.email, 'public')
    const agro = await request_(marc, 'Agrotech', { publish: false, amountEur: 80_000 })
    const agroToClaire = await share(marc, agro.id, CLAIRE.email, 'public')
    return { bio, agro, toClaire, agroToClaire }
  }

  const named = (email: string) => {
    const row = [...fake.table('user').values()].find((u) => u.email === email)!
    return (first: string, last: string) => Object.assign(row, { firstName: first, lastName: last })
  }
  const BASE = { intention: 'likely', amountEur: 25_000, showName: false, showAmount: false }
  const pledge = (u: { id: string }, dossierId: string, body: object = {}) =>
    as(u)
      .put(`/v1/opportunities/${dossierId}/pledge`, { ...BASE, version: null, ...body })
      .expect(200)
  const interest = (u: { id: string }, dossierId: string, nameVisible = false) =>
    as(u).put(`/v1/opportunities/${dossierId}/interest`, { nameVisible }).expect(200)
  const mine = async (u: { id: string }) => {
    const body = (await as(u).get('/v1/positions').expect(200)).body
    valid(myPositionsSchema, body)
    return body as {
      items: Array<{
        dossierId: string
        readable: boolean
        closed: boolean
        dossier: { name: string } | null
        accessLevel: string | null
        interest: object | null
        pledge: { amountEur: number; comment: string | null } | null
        disclosures: Array<{ id: string; workspace: { id: string; name: string } }>
      }>
    }
  }
  const disclose = async (u: { id: string }, dossierId: string, workspaceId: string) => {
    const body = (
      await as(u)
        .put(`/v1/opportunities/${dossierId}/structures/${workspaceId}`, { consent: true })
        .expect(200)
    ).body
    valid(positionDisclosureSchema, body)
    return body as { id: string; workspace: { id: string; name: string }; disclosedAt: string }
  }
  const followUp = async (u: { id: string }, workspaceId: string) => {
    const body = (await as(u).get(`/v1/workspaces/${workspaceId}/positions`).expect(200)).body
    valid(workspacePositionsSchema, body)
    return body as {
      items: Array<{
        dossier: { id: string; name: string }
        company: { name: string }
        investors: Array<{
          identity: { name: string | null; organizations: string[] }
          interest: { markedAt: string } | null
          pledge: { intention: string; amountEur: number } | null
        }>
        pledgedEur: number
      }>
    }
  }
  const followed = async (u: { id: string }, workspaceId: string) =>
    (await followUp(u, workspaceId)).items.map((i) => [
      i.dossier.name,
      i.investors.map((x) => [x.identity.name, x.interest !== null, x.pledge?.amountEur ?? null]),
      i.pledgedEur,
    ])
  const ownerView = async (owner: typeof sophie, dossierId: string) => {
    const body = (await owner.get(`/v1/dossiers/${dossierId}/positions`).expect(200)).body
    valid(dossierPositionsSchema, body)
    return body
  }
  const journal = () =>
    [...fake.table('auditLog').values()].filter((e) =>
      String(e.actionType).startsWith('investor_position_'),
    )

  it('shows an investor their own positions only, with where each request stands, and nothing of a request they no longer read', async () => {
    const { bio, agro, agroToClaire } = await world()
    await interest(CLAIRE, bio.id)
    await pledge(CLAIRE, bio.id, { comment: 'Si le lead est confirmé.', amountEur: 40_000 })
    await interest(CLAIRE, agro.id, true)
    await pledge(BOB, bio.id, { amountEur: 100_000, comment: 'Ticket de Bob.' })
    const readingsBefore = readings().length

    const claire = await mine(CLAIRE)
    expect(
      claire.items.map((i) => [
        i.dossier?.name ?? null,
        i.readable,
        i.closed,
        i.accessLevel,
        i.interest !== null,
        i.pledge?.amountEur ?? null,
        i.pledge?.comment ?? null,
      ]),
    ).toEqual([
      ['Agrotech', true, false, 'public', true, null, null],
      ['Biosensio', true, false, 'partiel', true, 40_000, 'Si le lead est confirmé.'],
    ])
    // Never another investor's position.
    expect(JSON.stringify(claire)).not.toMatch(/100000|Ticket de Bob/)
    const bob = await mine(BOB)
    expect(
      bob.items.map((i) => [i.dossier?.name, i.accessLevel, i.pledge?.amountEur, i.interest]),
    ).toEqual([['Biosensio', 'complet', 100_000, null]])
    expect(JSON.stringify(bob)).not.toMatch(/40000|lead/)
    expect((await mine(EVE)).items).toEqual([])
    // Listing one's positions is no reading of the opportunities.
    expect(readings().length).toBe(readingsBefore)

    // A request no longer read: their own data only, nothing of the request.
    await marc.delete(`/v1/dossiers/${agro.id}/shares/${agroToClaire.id}`).expect(200)
    const lost = (await mine(CLAIRE)).items.find((i) => i.dossierId === agro.id)!
    expect(lost).toMatchObject({ readable: false, closed: false, dossier: null, accessLevel: null })
    expect(lost.interest).not.toBeNull()
    expect(JSON.stringify(await mine(CLAIRE))).not.toMatch(/Agrotech|80000/)
    // Withdrawn from there, gone from the list.
    await as(CLAIRE).delete(`/v1/opportunities/${agro.id}/interest`).expect(204)
    expect((await mine(CLAIRE)).items.map((i) => i.dossierId)).toEqual([bio.id])

    // Archived: closed; Claire still reads it by her share, Bob, through the club's pool only, no more.
    await sophie.post(`/v1/dossiers/${bio.id}/archive`).expect(200)
    expect((await mine(CLAIRE)).items.map((i) => [i.readable, i.closed])).toEqual([[true, true]])
    const archived = (await mine(BOB)).items[0]
    expect([archived.readable, archived.closed, archived.dossier]).toEqual([false, true, null])
    expect(archived.pledge?.amountEur).toBe(100_000)

    await request(app.getHttpServer()).get('/v1/positions').expect(401)
  })

  it('shows a structure nothing of an investor’s positions without their consent, then exactly what they consented', async () => {
    const { bio } = await world()
    named(CLAIRE.email)('Claire', 'Martin')
    named(BOB.email)('Bob', 'Durand')
    await interest(CLAIRE, bio.id)
    await pledge(CLAIRE, bio.id, { comment: 'Si le lead est confirmé.', intention: 'strong' })

    // Claire is an investor of the club deal too: she reads Biosensio through both pools.
    await as(ADMIN)
      .post(`/v1/admin/workspaces/${club}/members`, { email: CLAIRE.email, role: 'investisseur' })
      .expect(201)

    // No consent: each structure lists the request in its pool, with no position, not even a count.
    expect(await followed(MARIE, cci)).toEqual([['Biosensio', [], 0]])
    expect(await followed(PAUL, club)).toEqual([['Biosensio', [], 0]])

    // On her opportunity, the structures whose pool brings it — not her share —, who she would be to
    // each (her organization there), and no consent.
    const page = (await as(CLAIRE).get(`/v1/opportunities/${bio.id}`).expect(200)).body
    valid(opportunitySchema, page)
    expect(page.opportunity.structures).toEqual([
      {
        workspace: { id: cci, name: 'CCI Touraine' },
        shownAs: { name: 'Claire Martin', organizations: ['Angels Touraine'] },
        disclosure: null,
      },
      {
        workspace: { id: club, name: 'Club deal' },
        shownAs: { name: 'Claire Martin', organizations: [] },
        disclosure: null,
      },
    ])

    // An explicit consent, with no default; to a structure she is in and whose pool brings it.
    const url = `/v1/opportunities/${bio.id}/structures/${cci}`
    for (const body of [{}, { consent: false }, { consent: 'true' }, { consent: true, more: 1 }]) {
      await as(CLAIRE).put(url, body).expect(400)
    }
    await as(CLAIRE)
      .put(`/v1/opportunities/${bio.id}/structures/${id(98)}`, { consent: true })
      .expect(404)
    const given = await disclose(CLAIRE, bio.id, cci)
    expect(given.workspace).toEqual({ id: cci, name: 'CCI Touraine' })
    // Given again: the same consent, journaled once.
    expect((await disclose(CLAIRE, bio.id, cci)).id).toBe(given.id)
    expect(journal().map((e) => [e.actorId, e.actionType, e.metadata])).toEqual([
      [CLAIRE.id, 'investor_position_disclosed', { workspaceId: cci, accessLevel: 'complet' }],
    ])
    const after = (await as(CLAIRE).get(`/v1/opportunities/${bio.id}`).expect(200)).body
    expect(after.opportunity.structures[0].disclosure).toEqual({
      id: given.id,
      disclosedAt: given.disclosedAt,
    })

    // The CCI's conseillers — and administrators — see her name, organization there, mark and pledge;
    // never her comment nor her address. The club deal, whose pool she also reads it through, sees
    // nothing of her: she consented to the CCI only.
    const cciView = await followUp(MARIE, cci)
    expect(cciView.items[0].investors).toEqual([
      {
        identity: { name: 'Claire Martin', organizations: ['Angels Touraine'] },
        disclosedAt: given.disclosedAt,
        interest: { markedAt: expect.any(String) },
        pledge: { intention: 'strong', amountEur: 25_000, updatedAt: expect.any(String) },
      },
    ])
    expect(cciView.items[0].pledgedEur).toBe(25_000)
    expect(JSON.stringify(cciView)).not.toMatch(/lead|@/)
    expect(await followUp(ADMIN, cci)).toEqual(cciView)
    expect(await followed(PAUL, club)).toEqual([['Biosensio', [], 0]])
    // The owner still sees what Claire shows them: neither her name nor her amount.
    const owner = await ownerView(sophie, bio.id)
    expect([owner.named, owner.anonymousAmounts, owner.pledges]).toEqual([
      [],
      [],
      { count: 1, totalEur: 25_000 },
    ])

    // Nobody else reads a structure's follow-up: its investors (403), the other structure, the owner,
    // an account without membership (404).
    await as(ZOE).get(`/v1/workspaces/${cci}/positions`).expect(403)
    await as(CLAIRE).get(`/v1/workspaces/${cci}/positions`).expect(403)
    for (const u of [PAUL, SOPHIE, EVE, BOB]) {
      await as(u).get(`/v1/workspaces/${cci}/positions`).expect(404)
    }

    // Bob consents to the club deal with no position yet: nothing shown until he takes one.
    await disclose(BOB, bio.id, club)
    expect(await followed(PAUL, club)).toEqual([['Biosensio', [], 0]])
    await pledge(BOB, bio.id, { amountEur: 100_000, showName: true })
    expect(await followed(PAUL, club)).toEqual([
      ['Biosensio', [['Bob Durand', false, 100_000]], 100_000],
    ])
    expect(await followed(MARIE, cci)).toEqual([
      ['Biosensio', [['Claire Martin', true, 25_000]], 25_000],
    ])

    // Withdrawn by its id: only her own; the same 204 whatever the consent.
    await as(BOB).delete(`/v1/positions/disclosures/${given.id}`).expect(204)
    expect(await followed(MARIE, cci)).toEqual([
      ['Biosensio', [['Claire Martin', true, 25_000]], 25_000],
    ])
    await as(CLAIRE).delete(`/v1/positions/disclosures/${given.id}`).expect(204)
    await as(CLAIRE).delete(`/v1/positions/disclosures/${given.id}`).expect(204)
    await as(CLAIRE)
      .delete(`/v1/positions/disclosures/${id(99)}`)
      .expect(204)
    await as(CLAIRE).delete('/v1/positions/disclosures/pas-un-uuid').expect(400)
    expect(await followed(MARIE, cci)).toEqual([['Biosensio', [], 0]])
    expect(journal().map((e) => [e.actorId, e.actionType])).toEqual([
      [CLAIRE.id, 'investor_position_disclosed'],
      [BOB.id, 'investor_position_disclosed'],
      [CLAIRE.id, 'investor_position_disclosure_withdrawn'],
    ])
    // The consents stay out of the owner's journal.
    const ownerJournal = (await sophie.get(`/v1/dossiers/${bio.id}/audit-log`).expect(200)).body
    expect(JSON.stringify(ownerJournal)).not.toMatch(/investor_position_/)
  })

  it('shows a consented position only while the investor reads the request through that structure’s pool', async () => {
    const { bio } = await world()
    named(CLAIRE.email)('Claire', 'Martin')
    await pledge(CLAIRE, bio.id, { amountEur: 30_000 })
    const given = await disclose(CLAIRE, bio.id, cci)
    const shown = [['Biosensio', [['Claire Martin', false, 30_000]], 30_000]]
    expect(await followed(MARIE, cci)).toEqual(shown)

    // Withdrawn from the CCI's pool: the request leaves the follow-up; Claire still reads it by her
    // share, which is no structure's.
    await sophie.delete(`/v1/candidatures/${bio.candidatures[cci]}/pool-publication`).expect(200)
    expect(await followed(MARIE, cci)).toEqual([])
    const res = await as(CLAIRE)
      .put(`/v1/opportunities/${bio.id}/structures/${cci}`, { consent: true })
      .expect(409)
    expect(res.body.error.message).toMatch(/ne vous parvient pas par le vivier de cette structure/)
    // Zoé, of the CCI, reads it no more at all.
    await as(ZOE)
      .put(`/v1/opportunities/${bio.id}/structures/${cci}`, { consent: true })
      .expect(404)
    // Published again: the consent, kept, shows again.
    await toPool(sophie, bio.candidatures[cci], 'partiel')
    expect(await followed(MARIE, cci)).toEqual(shown)

    // Her membership deactivated: nothing more; she can still withdraw her consent.
    await as(ADMIN)
      .post(`/v1/admin/workspaces/${cci}/members/${claireInCci}/deactivate`)
      .expect(201)
    expect(await followed(MARIE, cci)).toEqual([['Biosensio', [], 0]])
    await as(CLAIRE)
      .put(`/v1/opportunities/${bio.id}/structures/${cci}`, { consent: true })
      .expect(404)
    expect((await mine(CLAIRE)).items[0].disclosures.map((d) => d.id)).toEqual([given.id])
    await as(CLAIRE).delete(`/v1/positions/disclosures/${given.id}`).expect(204)
    expect((await mine(CLAIRE)).items[0].disclosures).toEqual([])
  })

  it('gives the owner one view of the positions, by consented visibility only, equal to E07.05/E07.06’s counts', async () => {
    const { bio } = await world()
    named(CLAIRE.email)('Claire', 'Martin')
    named(BOB.email)('Bob', 'Durand')
    // Claire shows her name on her mark, only her amount on her pledge; Bob the reverse.
    await interest(CLAIRE, bio.id, true)
    await pledge(CLAIRE, bio.id, { amountEur: 40_000, showAmount: true, comment: 'Mot pour moi.' })
    await interest(BOB, bio.id, false)
    await pledge(BOB, bio.id, { amountEur: 100_000, showName: true, intention: 'strong' })

    const view = await ownerView(sophie, bio.id)
    expect(view).toEqual({
      interests: { count: 2 },
      pledges: { count: 2, totalEur: 140_000 },
      named: [
        {
          identity: { name: 'Bob Durand', organizations: [] },
          interest: null,
          pledge: { amountEur: null },
        },
        {
          identity: { name: 'Claire Martin', organizations: ['Angels Touraine'] },
          interest: { markedAt: expect.any(String) },
          pledge: null,
        },
      ],
      anonymousAmounts: [40_000],
    })
    expect(JSON.stringify(view)).not.toMatch(/strong|likely|Mot pour moi|@/)
    // The same counts as each view of E07.05 and E07.06.
    const interests = (await sophie.get(`/v1/dossiers/${bio.id}/interests`).expect(200)).body
    const pledges = (await sophie.get(`/v1/dossiers/${bio.id}/pledges`).expect(200)).body
    valid(dossierInterestsSchema, interests)
    valid(dossierPledgesSchema, pledges)
    expect([view.interests.count, view.pledges.count, view.pledges.totalEur]).toEqual([
      interests.count,
      pledges.count,
      pledges.totalEur,
    ])
    // The owner's alone.
    for (const u of [MARC, CLAIRE, BOB, MARIE, PAUL, EVE, ADMIN]) {
      await as(u).get(`/v1/dossiers/${bio.id}/positions`).expect(404)
    }
    // Bob's account deactivated: neither counted nor named.
    fake.table('user').get(BOB.id)!.isActive = false
    const without = await ownerView(sophie, bio.id)
    expect([without.interests, without.pledges, without.named.length]).toEqual([
      { count: 1 },
      { count: 1, totalEur: 40_000 },
      1,
    ])
  })
})
