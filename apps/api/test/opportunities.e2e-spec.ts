import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { ZodValidationPipe } from 'nestjs-zod'
import request from 'supertest'
import type { App } from 'supertest/types'
import { opportunitiesSchema, opportunitySchema } from '@confluent/shared'
import { AppModule } from './../src/app.module'
import { GlobalExceptionFilter } from './../src/common/filters/global-exception.filter'
import { PrismaService } from './../src/prisma/prisma.service'
import { EMAIL_TRANSPORT } from './../src/modules/auth/email/email-transport'
import { createFakePrisma } from '../src/testing/fake-prisma'

const id = (n: number) => `7d3c1b0e-0000-4000-8000-0000000073${n.toString().padStart(2, '0')}`
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
  dossier: { id: string; name: string; sector: string | null; amountEur: number | null }
  accessLevel: string
  sources: Array<{ kind: string; accessLevel: string; workspace?: { id: string } }>
}

// ROADMAP E07.03 over HTTP on the stateful fake Prisma: an investor's opportunities — direct shares
// and the pools of the workspaces where they are an active investor —, one per request at the widest
// level, filtered, sorted and paged on what the share projection shows; the opportunity is that
// projection and nothing else; whatever the reader does not reach is the same 404.
describe('Opportunities (e2e)', () => {
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
    await invite(cci, { email: CLAIRE.email, role: 'investisseur' })
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
  const names = async (u: { id: string }, query = '') =>
    (await list(u, query)).items.map((i) => i.dossier.name)
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

  it('lists one opportunity per request, with each way it arrives and the widest level', async () => {
    const { bio, agro } = await world()
    const claire = await list(CLAIRE)
    expect(claire.counts).toEqual({
      total: 2,
      shares: 2,
      pools: [{ workspace: { id: cci, name: 'CCI Touraine' }, count: 1 }],
      // Agrotech's sector is computed from a partial question: hidden at the public level.
      sectors: [{ value: 'Secteur de Biosensio', count: 1 }],
      financingTypes: [{ value: 'equity', count: 1 }],
    })
    expect(claire.total).toBe(2)
    const byId = new Map(claire.items.map((i) => [i.dossier.id, i]))
    expect(byId.get(bio.id)).toMatchObject({
      accessLevel: 'partiel',
      sources: [
        { kind: 'share', accessLevel: 'public' },
        { kind: 'pool', accessLevel: 'partiel', workspace: { id: cci, name: 'CCI Touraine' } },
      ],
      dossier: {
        sector: 'Secteur de Biosensio',
        amountEur: 300_000,
        publicationStatus: 'published',
      },
    })
    // A draft shared directly: its title only, no presentation, no hidden sector.
    expect(byId.get(agro.id)).toMatchObject({
      accessLevel: 'public',
      sources: [{ kind: 'share', accessLevel: 'public' }],
      dossier: {
        name: 'Agrotech',
        sector: null,
        summary: null,
        amountEur: null,
        financingTypes: [],
      },
    })
    // Bob: his direct share and the club deal's pool, never the CCI's.
    const bob = await list(BOB)
    expect(bob.items).toEqual([
      expect.objectContaining({
        accessLevel: 'complet',
        sources: [
          expect.objectContaining({ kind: 'share', accessLevel: 'public' }),
          expect.objectContaining({
            kind: 'pool',
            accessLevel: 'complet',
            workspace: { id: club, name: 'Club deal' },
          }),
        ],
      }),
    ])
    expect(bob.counts.pools).toEqual([{ workspace: { id: club, name: 'Club deal' }, count: 1 }])
  })

  it('gives nothing to whoever reads no pool and has no share: conseillers, deactivated investors, administrators, owners', async () => {
    const { bio } = await world()
    await as(ADMIN).post(`/v1/admin/workspaces/${cci}/members/${zoeInCci}/deactivate`).expect(201)
    for (const someone of [ZOE, MARIE, PAUL, EVE, ADMIN]) {
      const body = await list(someone)
      expect(body).toMatchObject({
        total: 0,
        items: [],
        counts: { total: 0, shares: 0, pools: [] },
      })
      await as(someone).get(`/v1/opportunities/${bio.id}`).expect(404)
    }
    // The owner's own request, even in a pool where the owner would be an investor.
    await as(ADMIN)
      .post(`/v1/admin/workspaces/${cci}/members`, { email: SOPHIE.email, role: 'investisseur' })
      .expect(201)
    expect((await list(SOPHIE)).items).toEqual([])
    await sophie.get(`/v1/opportunities/${bio.id}`).expect(404)
    await request(app.getHttpServer()).get('/v1/opportunities').expect(401)
    await request(app.getHttpServer()).get(`/v1/opportunities/${bio.id}`).expect(401)
    expect(readings()).toEqual([])
  })

  it('reads an opportunity as the share projection at its level, nothing else, and journals it once', async () => {
    const { bio, toClaire } = await world()
    // What the structures keep for themselves, which no opportunity shows.
    const inCci = bio.candidatures[cci]
    await fake.prisma.candidatureNote.create({
      data: { candidatureId: inCci, workspaceId: cci, body: 'NOTE-INTERNE' },
    })
    await fake.prisma.candidatureAnswer.create({
      data: { candidatureId: inCci, fieldId: id(80), value: 'REPONSE-STRUCTURE' },
    })
    await fake.prisma.candidatureEligibility.create({
      data: { candidatureId: inCci, workspaceId: cci, schemeId: id(81), note: 'DISPOSITIF-JEI' },
    })

    const body = (await as(CLAIRE).get(`/v1/opportunities/${bio.id}`).expect(200)).body
    valid(opportunitySchema, body)
    expect(Object.keys(body).sort()).toEqual([
      'answers',
      'documents',
      'dossier',
      'fields',
      'opportunity',
      'sections',
    ])
    expect(body.opportunity).toMatchObject({
      accessLevel: 'partiel',
      sources: [{ kind: 'share' }, { kind: 'pool', workspace: { id: cci } }],
    })
    // Exactly what the owner previews at that level (one projection).
    const { preview, ...previewed } = (
      await sophie.get(`/v1/dossiers/${bio.id}/share-preview?level=partiel`).expect(200)
    ).body
    expect(preview.accessLevel).toBe('partiel')
    const { opportunity, ...view } = body
    expect(opportunity.accessLevel).toBe('partiel')
    expect(view).toEqual(previewed)
    expect(body.answers.map((a: { value: string }) => a.value).sort()).toEqual([
      'NOM-Biosensio',
      'SECTEUR-Biosensio',
    ])
    const text = JSON.stringify(body) + JSON.stringify(await list(CLAIRE))
    for (const hidden of [
      'CHIFFRE-SECRET',
      'NOTE-INTERNE',
      'REPONSE-STRUCTURE',
      'DISPOSITIF-JEI',
      'financingStatus',
      'candidature',
      'poolPublication',
      SOPHIE.email,
      BOB.email,
      club,
    ]) {
      expect(text).not.toContain(hidden)
    }

    // One reading, one entry, on Claire's direct share — counted as that share's view.
    expect(readings()).toEqual([
      expect.objectContaining({
        actorId: CLAIRE.id,
        dossierId: bio.id,
        shareLinkId: toClaire.id,
        metadata: { accessLevel: 'partiel', shareLinkIds: [toClaire.id], workspaceIds: [cci] },
      }),
    ])
    const analytics = (await sophie.get(`/v1/dossiers/${bio.id}/analytics`).expect(200)).body
    expect(analytics.totalViews).toBe(1)
    expect(
      analytics.perRecipient.find((r: { shareLinkId: string }) => r.shareLinkId === toClaire.id),
    ).toMatchObject({ viewCount: 1 })
    // Never named to the owner (D05); administrators see it.
    const journal = (await sophie.get(`/v1/dossiers/${bio.id}/audit-log`).expect(200)).body
    expect(journal.map((e: { actionType: string }) => e.actionType)).not.toContain(
      'opportunity_viewed',
    )
    const adminJournal = (await as(ADMIN).get(`/v1/admin/dossiers/${bio.id}/audit-log`).expect(200))
      .body
    expect(adminJournal.map((e: { actionType: string }) => e.actionType)).toContain(
      'opportunity_viewed',
    )
  })

  it('journals a pool investor’s reading without any share, and counts it as no share’s view', async () => {
    const bio = await request_(sophie, 'Biosensio', { workspaces: [cci] })
    await toPool(sophie, bio.candidatures[cci], 'public')
    const body = (await as(CLAIRE).get(`/v1/opportunities/${bio.id}`).expect(200)).body
    expect(body.opportunity.sources).toEqual([expect.objectContaining({ kind: 'pool' })])
    expect(body.answers.map((a: { value: string }) => a.value)).toEqual(['NOM-Biosensio'])
    expect(body.dossier.sector).toBeNull()
    expect(readings()).toEqual([expect.objectContaining({ actorId: CLAIRE.id, shareLinkId: null })])
    const analytics = (await sophie.get(`/v1/dossiers/${bio.id}/analytics`).expect(200)).body
    expect(analytics.totalViews).toBe(0)
  })

  it('drops a withdrawn or paused publication, a revoked share and a deactivated membership at the next request', async () => {
    const { bio, agro, agroToClaire } = await world()
    const inCci = bio.candidatures[cci]
    const levels = async () =>
      (await list(CLAIRE)).items.map((i) => `${i.dossier.name}:${i.accessLevel}`).sort()
    expect(await levels()).toEqual(['Agrotech:public', 'Biosensio:partiel'])

    // Paused while unpublished: Claire keeps her direct share only.
    await sophie.post(`/v1/dossiers/${bio.id}/unpublish`).expect(200)
    expect(await levels()).toEqual(['Agrotech:public', 'Biosensio:public'])
    await sophie.post(`/v1/dossiers/${bio.id}/publish`).expect(200)
    expect(await levels()).toEqual(['Agrotech:public', 'Biosensio:partiel'])

    // Paused once the structure closes its follow-up.
    await as(MARIE)
      .post(`/v1/workspaces/${cci}/candidatures/${inCci}/financing-status`, {
        from: 'preparing',
        to: 'refused',
      })
      .expect(200)
    expect(await levels()).toEqual(['Agrotech:public', 'Biosensio:public'])
    await as(MARIE)
      .post(`/v1/workspaces/${cci}/candidatures/${inCci}/financing-status`, {
        from: 'refused',
        to: 'preparing',
      })
      .expect(200)
    expect(await levels()).toEqual(['Agrotech:public', 'Biosensio:partiel'])

    // Narrowed, then withdrawn by its owner.
    await toPool(sophie, inCci, 'public')
    expect(await levels()).toEqual(['Agrotech:public', 'Biosensio:public'])
    await sophie.delete(`/v1/candidatures/${inCci}/pool-publication`).expect(200)
    const afterWithdrawal = (await list(CLAIRE)).items.find((i) => i.dossier.id === bio.id)!
    expect(afterWithdrawal.sources).toEqual([expect.objectContaining({ kind: 'share' })])

    // Revoked shares: nothing left of either request.
    const shares = (await sophie.get(`/v1/dossiers/${bio.id}/shares`).expect(200)).body
    const claireShare = shares.find(
      (s: { recipientEmail: string }) => s.recipientEmail === CLAIRE.email,
    )
    await sophie.delete(`/v1/dossiers/${bio.id}/shares/${claireShare.id}`).expect(200)
    await marc.delete(`/v1/dossiers/${agro.id}/shares/${agroToClaire.id}`).expect(200)
    expect(await levels()).toEqual([])
    await as(CLAIRE).get(`/v1/opportunities/${bio.id}`).expect(404)
    await as(CLAIRE).get(`/v1/opportunities/${agro.id}`).expect(404)

    // Bob: the club deal's pool until the archiving withdraws it; his share stays readable.
    expect((await list(BOB)).items[0].accessLevel).toBe('complet')
    await sophie.post(`/v1/dossiers/${bio.id}/archive`).expect(200)
    const archived = (await list(BOB)).items
    expect(archived).toEqual([
      expect.objectContaining({
        accessLevel: 'public',
        sources: [expect.objectContaining({ kind: 'share' })],
        dossier: expect.objectContaining({ publicationStatus: 'archived', summary: null }),
      }),
    ])
  })

  it('stops reading a pool once the membership is deactivated', async () => {
    const bio = await request_(sophie, 'Biosensio', { workspaces: [cci] })
    await toPool(sophie, bio.candidatures[cci], 'complet')
    expect((await list(ZOE)).total).toBe(1)
    await as(ZOE).get(`/v1/opportunities/${bio.id}`).expect(200)
    await as(ADMIN).post(`/v1/admin/workspaces/${cci}/members/${zoeInCci}/deactivate`).expect(201)
    expect((await list(ZOE)).total).toBe(0)
    await as(ZOE).get(`/v1/opportunities/${bio.id}`).expect(404)
  })

  it('filters, sorts and pages on what the projection shows', async () => {
    await world()
    const eau = await request_(marc, 'Hydro Énergie', {
      workspaces: [cci],
      amountEur: 1_200_000,
      types: ['bank_loan', 'grant'],
    })
    await toPool(marc, eau.candidatures[cci], 'partiel')

    expect(await names(CLAIRE, '?sort=name')).toEqual(['Agrotech', 'Biosensio', 'Hydro Énergie'])
    // Search: title and summary, accents and case ignored.
    expect(await names(CLAIRE, '?q=hydro%20energie')).toEqual(['Hydro Énergie'])
    expect(await names(CLAIRE, '?q=ENERGIE&sort=name')).toEqual(['Biosensio', 'Hydro Énergie'])
    // Sector: Agrotech's is hidden at its level, so it never matches.
    expect(await names(CLAIRE, '?sector=secteur%20de%20biosensio')).toEqual(['Biosensio'])
    expect(await names(CLAIRE, '?sector=Secteur%20de%20Agrotech')).toEqual([])
    // Amounts: a draft shows none, so it matches no bound.
    expect(await names(CLAIRE, '?amountMin=500000')).toEqual(['Hydro Énergie'])
    expect(await names(CLAIRE, '?amountMax=500000')).toEqual(['Biosensio'])
    expect(await names(CLAIRE, '?amountMin=300000&amountMax=300000')).toEqual(['Biosensio'])
    expect(await names(CLAIRE, '?financingType=grant')).toEqual(['Hydro Énergie'])
    expect(await names(CLAIRE, '?source=share&sort=name')).toEqual(['Agrotech', 'Biosensio'])
    expect(await names(CLAIRE, '?source=pool&sort=name')).toEqual(['Biosensio', 'Hydro Énergie'])
    expect(await names(CLAIRE, `?workspace=${cci}&sort=name`)).toEqual([
      'Biosensio',
      'Hydro Énergie',
    ])
    // A workspace she is no investor of matches nothing, without saying anything about it.
    expect(await names(CLAIRE, `?workspace=${club}`)).toEqual([])
    expect(await names(CLAIRE, '?sort=amount_desc')).toEqual([
      'Hydro Énergie',
      'Biosensio',
      'Agrotech',
    ])
    expect(await names(CLAIRE, '?sort=amount_asc')).toEqual([
      'Biosensio',
      'Hydro Énergie',
      'Agrotech',
    ])
    const filtered = await list(CLAIRE, '?financingType=grant')
    expect(filtered.total).toBe(1)
    expect(filtered.counts).toMatchObject({ total: 3, shares: 2 })
    expect(filtered.counts.financingTypes).toEqual([
      { value: 'equity', count: 1 },
      { value: 'bank_loan', count: 1 },
      { value: 'grant', count: 1 },
    ])

    for (const query of [
      '?unknown=1',
      '?amountMin=-1',
      '?amountMin=abc',
      '?amountMin=500&amountMax=100',
      '?financingType=lottery',
      '?source=mail',
      '?workspace=not-a-uuid',
      '?sort=random',
      '?page=0',
      `?q=${'x'.repeat(101)}`,
    ]) {
      await as(CLAIRE).get(`/v1/opportunities${query}`).expect(400)
    }
    await as(CLAIRE).get('/v1/opportunities/not-a-uuid').expect(400)
  })

  it('pages twenty at a time, the latest first, in a stable order', async () => {
    const created: string[] = []
    for (let i = 0; i < 23; i++) {
      const r = await request_(marc, `Projet ${i + 1}`, { publish: false })
      await share(marc, r.id, CLAIRE.email, 'public')
      created.push(`Projet ${i + 1}`)
    }
    const first = await list(CLAIRE)
    expect(first).toMatchObject({ total: 23, page: 1, pageSize: 20 })
    expect(first.items).toHaveLength(20)
    const second = await list(CLAIRE, '?page=2')
    expect(second.items).toHaveLength(3)
    const all = [...first.items, ...second.items] as Array<Item & { receivedAt: string }>
    expect(new Set(all.map((i) => i.dossier.name))).toEqual(new Set(created))
    const dates = all.map((i) => Date.parse(i.receivedAt))
    expect(dates).toEqual([...dates].sort((a, b) => b - a))
    expect(await list(CLAIRE, '?page=2')).toEqual(second)
    expect((await list(CLAIRE, '?page=3')).items).toEqual([])
  })
})
