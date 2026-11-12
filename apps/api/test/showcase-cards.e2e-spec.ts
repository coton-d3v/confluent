import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { ZodValidationPipe } from 'nestjs-zod'
import request from 'supertest'
import type { App } from 'supertest/types'
import {
  PUBLIC_CARD_FIELDS,
  managedShowcaseCardSchema,
  ownerShowcaseCardSchema,
  publicWorkspacePageSchema,
  receivedShowcaseCardSchema,
  workspacePageSettingsSchema,
} from '@confluent/shared'
import { AppModule } from './../src/app.module'
import { GlobalExceptionFilter } from './../src/common/filters/global-exception.filter'
import { PrismaService } from './../src/prisma/prisma.service'
import { EMAIL_TRANSPORT } from './../src/modules/auth/email/email-transport'
import { createFakePrisma } from '../src/testing/fake-prisma'

const id = (n: number) => `7d3c1b0e-0000-4000-8000-0000000009${n.toString().padStart(2, '0')}`
// Sophie Martin owns Biosensio; Marc is another entrepreneur. Marie: manager of the CCI; Jean:
// conseiller of the CCI; Claire: investisseur of the CCI; Paul: manager of the club deal; Bob:
// recipient of a share.
const SOPHIE = { id: id(1), email: 'sophie@biosensio.fr', role: 'entrepreneur' }
const MARC = { id: id(2), email: 'marc@agrotech.fr', role: 'entrepreneur' }
const MARIE = { id: id(3), email: 'marie@cci.fr', role: 'financeur' }
const JEAN = { id: id(4), email: 'jean@cci.fr', role: 'financeur' }
const CLAIRE = { id: id(5), email: 'claire@angels.fr', role: 'financeur' }
const PAUL = { id: id(6), email: 'paul@club.fr', role: 'financeur' }
const BOB = { id: id(7), email: 'bob@banque.fr', role: 'financeur' }
const ADMIN = { id: id(8), email: 'admin@confluent.dev', role: 'admin' }
const PEOPLE = [SOPHIE, MARC, MARIE, JEAN, CLAIRE, PAUL, BOB, ADMIN]
const VERSION = id(90)
const CONFLUENT_FORM = id(91)
const SECTION = id(92)
const SECTOR_FIELD = id(93)

const valid = <T>(schema: { safeParse: (v: unknown) => { error?: { issues: T[] } } }, v: unknown) =>
  expect(schema.safeParse(v).error?.issues ?? []).toEqual([])

const JUNE = {
  name: 'Comité de juin',
  date: '2099-06-10',
  time: '14:00',
  timeZone: 'Europe/Paris',
  location: 'LIEU-PRIVE CCI Touraine, salle 2',
  meetingUrl: 'https://visio.example.org/LIEN-PRIVE',
  internalNotes: 'NOTE-INTERNE trésorerie fragile',
  sharedInfo: 'INFO-DIFFUSEE pitch de 10 minutes',
}
const JUNE_PUBLIC = {
  name: 'Comité de juin',
  date: '2099-06-10',
  time: '14:00',
  timeZone: 'Europe/Paris',
  startsAt: '2099-06-10T12:00:00.000Z',
}
const CONSENT = {
  pseudonym: 'Projet Héron',
  region: 'centre-val-de-loire',
  consent: true,
  version: null,
} as const

// ROADMAP E09.02 over HTTP on the stateful fake Prisma: the owner of a request consents, for one
// workspace, to show an anonymous card on its public page, under a pseudonym they choose; the public
// reads a closed list of fields — pseudonym, sector, region, amount, plan in aggregate, committee —
// only while the page is published and the request diffusable there, the card gone at the next read
// once the consent is withdrawn; nothing else of the request, its company, its plan or its
// committees ever reaches it. Concurrency, constraints and the migration:
// test/pg/showcase-cards.pg-spec.ts.
describe('Showcase cards (e2e)', () => {
  let app: INestApplication<App>
  let fake: ReturnType<typeof createFakePrisma>
  const tokens: Record<string, string> = {}
  let cci: string
  let club: string
  let ip = 0

  beforeEach(async () => {
    fake = createFakePrisma()
    const p = fake.prisma
    for (const u of PEOPLE) await p.user.create({ data: { ...u, emailVerifiedAt: new Date() } })
    await p.user.update({
      where: { id: SOPHIE.id },
      data: { firstName: 'Sophie', lastName: 'Martin' },
    })
    await p.questionnaire.create({
      data: { id: CONFLUENT_FORM, slug: 'dossier', name: 'Profil', usage: 'dossier' },
    })
    await p.questionnaireVersion.create({
      data: { id: VERSION, questionnaireId: CONFLUENT_FORM, version: 1, status: 'published' },
    })
    await p.questionnaireSection.create({
      data: { id: SECTION, versionId: VERSION, key: 'identite', title: 'Identité', orderIndex: 0 },
    })
    // The sector comes from a field readable at the narrowest level.
    await p.questionnaireField.create({
      data: {
        id: SECTOR_FIELD,
        key: 'secteur_activite',
        label: 'Secteur',
        minAccessLevel: 'public',
        fieldType: 'text',
        orderIndex: 0,
        sectionId: SECTION,
        versionId: VERSION,
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
        sendCommitteeNotice: jest.fn().mockResolvedValue(undefined),
      })
      .compile()
    app = moduleFixture.createNestApplication()
    ;(app.getHttpAdapter().getInstance() as { set: (k: string, v: unknown) => void }).set(
      'trust proxy',
      1,
    )
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
    cci = (
      await admin
        .post('/v1/admin/workspaces', { name: 'CCI Touraine', slug: 'cci-touraine' })
        .expect(201)
    ).body.id
    club = (
      await admin.post('/v1/admin/workspaces', { name: 'Club deal', slug: 'club-deal' }).expect(201)
    ).body.id
    const invite = (workspaceId: string, body: object) =>
      admin.post(`/v1/admin/workspaces/${workspaceId}/members`, body).expect(201)
    await invite(cci, { email: MARIE.email, role: 'conseiller', canManageWorkspace: true })
    await invite(cci, { email: JEAN.email, role: 'conseiller' })
    await invite(cci, { email: CLAIRE.email, role: 'investisseur' })
    await invite(club, { email: PAUL.email, role: 'conseiller', canManageWorkspace: true })
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
    delete: (url: string) => request(app.getHttpServer()).delete(url).set('Authorization', auth(u)),
  })
  const sophie = as(SOPHIE)
  const cardOf = (candidatureId: string) => `/v1/candidatures/${candidatureId}/showcase-card`
  const receivedCardOf = (workspaceId: string, candidatureId: string) =>
    `/v1/workspaces/${workspaceId}/candidatures/${candidatureId}/showcase-card`
  // Each public read from its own network address (the page's per-minute limit).
  const publicPage = (slug = 'cci-touraine') =>
    request(app.getHttpServer())
      .get(`/v1/public/workspaces/${slug}`)
      .set('X-Forwarded-For', `203.0.113.${++ip}`)
  const cards = async (slug = 'cci-touraine') => {
    const res = await publicPage(slug).expect(200)
    valid(publicWorkspacePageSchema, res.body)
    return res.body.cards as Array<Record<string, unknown>>
  }
  const setPage = async (workspaceId: string, published: boolean) => {
    const manager = as(workspaceId === cci ? MARIE : PAUL)
    const path = `/v1/admin/workspaces/${workspaceId}/public-page`
    const { version } = (await manager.get(path).expect(200)).body
    await manager.put(path, { published, criteria: null, contact: null, version }).expect(200)
  }
  const journal = () =>
    [...fake.table('auditLog').values()].filter((e) =>
      String(e.actionType).startsWith('showcase_card_'),
    )

  // Biosensio, its profile submitted and its presentation complete, published, sent to both
  // workspaces, shared with Bob and published in the CCI's pool — none of which is a consent to a
  // card. In the CCI, a plan of five lines.
  async function biosensio() {
    const dossier = (await sophie.post('/v1/dossiers', { name: 'Biosensio' }).expect(201)).body
    Object.assign(fake.table('dossier').get(dossier.id)!, {
      submittedAt: new Date(),
      summary: 'RESUME-PRIVE capteurs pour la qualité de l’eau',
      objective: 'OBJECTIF-PRIVE industrialiser',
      description: 'DESCRIPTION-PRIVEE',
      amountEur: 300_000,
      financingTypes: ['equity'],
      sector: 'Eau et environnement',
      maturityStage: 'STADE-PRIVE',
      classificationSources: { sector: ['secteur_activite'], maturityStage: ['secteur_activite'] },
    })
    await sophie.post(`/v1/dossiers/${dossier.id}/publish`).expect(200)
    const send = async (workspaceId: string) => {
      const created = (
        await sophie.post(`/v1/dossiers/${dossier.id}/candidatures`, { workspaceId }).expect(201)
      ).body
      await sophie.post(`/v1/candidatures/${created.id}/submit`).expect(200)
      return created.id as string
    }
    const inCci = await send(cci)
    const inClub = await send(club)
    await sophie
      .post(`/v1/dossiers/${dossier.id}/shares`, {
        recipientEmail: BOB.email,
        accessLevel: 'public',
      })
      .expect(201)
    await sophie
      .put(`/v1/candidatures/${inCci}/pool-publication`, { accessLevel: 'public', consent: true })
      .expect(200)
    const plan = (await sophie.get(`/v1/candidatures/${inCci}/funding-plan`).expect(200)).body
    const category = (key: string) =>
      plan.categories.find((c: { key: string }) => c.key === key)!.id as string
    for (const [key, amountEur, state] of [
      ['bpifrance', 123_457, 'obtained'],
      ['pret_bancaire', 34_568, 'obtained'],
      ['pret_honneur', 45_679, 'requested'],
      ['business_angels_love_money', 56_781, 'planned'],
      ['fonds_investissement', 67_892, 'refused'],
    ] as const) {
      await sophie
        .post(`/v1/candidatures/${inCci}/funding-plan/lines`, {
          categoryId: category(key),
          amountEur,
          state,
          label: `PRECISION-PRIVEE ${key}`,
        })
        .expect(201)
    }
    return { dossierId: dossier.id as string, slug: dossier.slug as string, inCci, inClub }
  }

  const EXPECTED_CARD = {
    pseudonym: 'Projet Héron',
    sector: 'Eau et environnement',
    region: 'centre-val-de-loire',
    amountEur: 300_000,
    fundingPlan: {
      obtainedEur: 123_457 + 34_568,
      requestedEur: 45_679,
      remainingEur: 300_000 - 123_457 - 34_568,
    },
    committee: { state: 'awaiting' },
  }

  it('shows a card only by its owner’s consent, under a pseudonym, on the published page, by a closed list of fields; gone at once once withdrawn', async () => {
    const { dossierId, slug, inCci, inClub } = await biosensio()
    await setPage(club, true)

    // Before any consent: nothing on the page — neither the pool publication nor the share is one.
    const before = (await sophie.get(cardOf(inCci)).expect(200)).body
    valid(ownerShowcaseCardSchema, before)
    expect(before).toEqual({
      workspace: { name: 'CCI Touraine', slug: 'cci-touraine' },
      pagePublished: false,
      card: null,
      version: null,
      blocker: null,
      preview: { ...EXPECTED_CARD, pseudonym: null, region: null },
    })
    await publicPage().expect(404)
    await setPage(cci, true)
    expect(await cards()).toEqual([])

    // An explicit consent, a pseudonym, a known region, the version read: nothing else.
    for (const body of [
      {},
      { ...CONSENT, consent: false },
      { ...CONSENT, consent: undefined },
      { ...CONSENT, pseudonym: '' },
      { ...CONSENT, pseudonym: undefined },
      { ...CONSENT, pseudonym: 'Écrivez à sophie@biosensio.fr' },
      { ...CONSENT, pseudonym: '<b>Héron</b>' },
      { ...CONSENT, region: 'Tours' },
      { ...CONSENT, region: undefined },
      { ...CONSENT, version: undefined },
      { ...CONSENT, sector: 'Autre' },
    ]) {
      await sophie.put(cardOf(inCci), body).expect(400)
    }
    // Never a real name in its place: the company's, the request's title, the owner's.
    for (const pseudonym of ['BIOSENSIO', 'Bio-sensio', 'Sophie Martin', 'martin sophie']) {
      const refused = await sophie.put(cardOf(inCci), { ...CONSENT, pseudonym }).expect(400)
      expect(refused.body.error.message).toBe(
        'Choisissez un pseudonyme différent du nom de l’entreprise, du titre de la demande et de votre nom.',
      )
    }
    expect(fake.table('showcaseCard').size).toBe(0)
    expect(journal()).toEqual([])
    await request(app.getHttpServer()).put(cardOf(inCci)).send(CONSENT).expect(401)

    const given = (await sophie.put(cardOf(inCci), CONSENT).expect(200)).body
    valid(ownerShowcaseCardSchema, given)
    expect(given).toMatchObject({
      pagePublished: true,
      card: {
        pseudonym: 'Projet Héron',
        region: 'centre-val-de-loire',
        state: 'shown',
        pausedBecause: null,
        withdrawnAt: null,
        withdrawnBecause: null,
      },
      version: 1,
      blocker: null,
      preview: EXPECTED_CARD,
    })
    expect(journal()).toEqual([
      expect.objectContaining({
        actionType: 'showcase_card_published',
        actorId: SOPHIE.id,
        dossierId,
        metadata: {
          channel: 'site',
          candidatureId: inCci,
          workspaceId: cci,
          version: 1,
          pseudonym: 'Projet Héron',
          region: 'centre-val-de-loire',
          republished: false,
        },
      }),
    ])

    // The public reads exactly the card — on this workspace's page only.
    const page = (await publicPage().expect(200)).body
    expect(page.cards).toEqual([EXPECTED_CARD])
    expect(Object.keys(page.cards[0])).toEqual([...PUBLIC_CARD_FIELDS])
    expect(await cards('club-deal')).toEqual([])
    // Nothing excluded reaches the page: neither the request nor its company, owner, answers,
    // documents, plan's sources and amounts, pool, share, committee details or identifiers.
    const text = JSON.stringify(page)
    for (const secret of [
      'Biosensio',
      slug,
      'PRIVE',
      'PRECISION',
      'STADE',
      'Sophie',
      'Martin',
      ...PEOPLE.map((u) => u.email),
      dossierId,
      inCci,
      inClub,
      cci,
      club,
      SOPHIE.id,
      '123457',
      '34568',
      '56781',
      '67892',
      'equity',
      'partiel',
      'complet',
      'Bpifrance',
      'consent',
      'version',
      'withdrawn',
      'preparing',
    ]) {
      expect([secret, text.includes(secret)]).toEqual([secret, false])
    }
    // The managers' preview is built by the same projection.
    const settings = (await as(MARIE).get(`/v1/admin/workspaces/${cci}/public-page`).expect(200))
      .body
    valid(workspacePageSettingsSchema, settings)
    expect(settings.preview.cards).toEqual(page.cards)

    // From the version read only; the same values change nothing.
    const stale = await sophie.put(cardOf(inCci), { ...CONSENT, pseudonym: 'Autre' }).expect(409)
    expect(stale.body.error).toEqual({
      code: 'CONFLICT',
      message:
        'La carte de la page publique a été modifiée entre-temps : rechargez-la avant de la modifier.',
      details: { currentVersion: 1 },
    })
    await sophie.put(cardOf(inCci), { ...CONSENT, version: 1 }).expect(200)
    expect(journal()).toHaveLength(1)
    const renamed = (
      await sophie
        .put(cardOf(inCci), { ...CONSENT, pseudonym: 'Héron bleu', region: null, version: 1 })
        .expect(200)
    ).body
    expect(renamed).toMatchObject({ version: 2, card: { pseudonym: 'Héron bleu', region: null } })
    expect(await cards()).toEqual([{ ...EXPECTED_CARD, pseudonym: 'Héron bleu', region: null }])

    // Withdrawn: gone at the next read; again, nothing changes.
    const withdrawn = (await sophie.delete(cardOf(inCci)).expect(200)).body
    expect(withdrawn).toMatchObject({
      version: 3,
      card: { state: 'withdrawn', withdrawnBecause: 'owner' },
    })
    expect(await cards()).toEqual([])
    await sophie.delete(cardOf(inCci)).expect(200)
    expect(
      journal().map((e) => [e.actionType, (e.metadata as { version: number }).version]),
    ).toEqual([
      ['showcase_card_published', 1],
      ['showcase_card_published', 2],
      ['showcase_card_withdrawn', 3],
    ])
    expect(journal()[2]).toMatchObject({
      metadata: { candidatureId: inCci, workspaceId: cci, version: 3, reason: 'owner' },
    })
    // Consenting again is a new consent, on the same row, from the version read.
    await sophie.put(cardOf(inCci), { ...CONSENT, version: 2 }).expect(409)
    const again = (await sophie.put(cardOf(inCci), { ...CONSENT, version: 3 }).expect(200)).body
    expect(again).toMatchObject({ version: 4, card: { state: 'shown' } })
    expect(journal()[3].metadata).toMatchObject({ republished: true, version: 4 })
    expect(fake.table('showcaseCard').size).toBe(1)
    expect(await cards()).toEqual([EXPECTED_CARD])

    // Nothing else changed: the pool publication, the share, the club's candidature.
    expect(
      [...fake.table('poolPublication').values()].map((p) => [p.candidatureId, p.withdrawnAt]),
    ).toEqual([[inCci, null]])
    expect((await sophie.get(cardOf(inClub)).expect(200)).body.card).toBeNull()
  })

  it('shows the sector only when every field it comes from is readable at the narrowest level', async () => {
    const { inCci } = await biosensio()
    await setPage(cci, true)
    await sophie.put(cardOf(inCci), CONSENT).expect(200)
    expect((await cards())[0].sector).toBe('Eau et environnement')
    fake.table('questionnaireField').get(SECTOR_FIELD)!.minAccessLevel = 'partiel'
    expect(await cards()).toEqual([{ ...EXPECTED_CARD, sector: null }])
  })

  it('names the next committee once the request is retained for a planned session; « en attente » otherwise, never telling a refusal apart', async () => {
    const { inCci } = await biosensio()
    await setPage(cci, true)
    await sophie.put(cardOf(inCci), CONSENT).expect(200)
    const marie = as(MARIE)
    const plan = async (body: object) =>
      (await marie.post(`/v1/admin/workspaces/${cci}/committees`, { ...JUNE, ...body }).expect(201))
        .body as { id: string; version: number }
    const june = await plan({})
    const march = await plan({ name: 'Comité de mars', date: '2099-03-12' })
    const april = await plan({ name: 'Comité d’avril', date: '2099-04-09' })
    const apply = (committeeId: string, to: string, version: number | null) =>
      sophie
        .post(`/v1/candidatures/${inCci}/committees/${committeeId}/application`, { to, version })
        .expect(200)
    const decide = (committeeId: string, to: string, version: number) =>
      marie
        .post(`/v1/workspaces/${cci}/committees/${committeeId}/applications`, {
          candidatureId: inCci,
          to,
          version,
        })
        .expect(200)
    const awaiting = JSON.stringify(await cards())
    expect(JSON.parse(awaiting)).toEqual([EXPECTED_CARD])

    // Applied, then refused (April); applied and pending (March): « en attente », exactly as without
    // any entry.
    await apply(april.id, 'applied', null)
    expect(JSON.stringify(await cards())).toBe(awaiting)
    await decide(april.id, 'refused', 1)
    await apply(march.id, 'applied', null)
    expect(JSON.stringify(await cards())).toBe(awaiting)

    // Retained for June (both sides agreed): June, by name and when only.
    await apply(june.id, 'applied', null)
    await decide(june.id, 'accepted', 1)
    const named = await cards()
    expect(named).toEqual([
      {
        ...EXPECTED_CARD,
        committee: { state: 'scheduled', session: { id: june.id, ...JUNE_PUBLIC } },
      },
    ])
    for (const secret of [
      'LIEU-PRIVE',
      'LIEN-PRIVE',
      'NOTE-INTERNE',
      'INFO-DIFFUSEE',
      'mars',
      'avril',
    ]) {
      expect([secret, JSON.stringify(named).includes(secret)]).toEqual([secret, false])
    }
    // Retained for March too: the sooner one.
    await decide(march.id, 'accepted', 1)
    expect((await cards())[0].committee).toEqual({
      state: 'scheduled',
      session: expect.objectContaining({ id: march.id, name: 'Comité de mars' }),
    })
    // March cancelled: June again; June cancelled too: « en attente » again.
    const status = (committeeId: string, to: string) =>
      marie
        .post(`/v1/admin/workspaces/${cci}/committees/${committeeId}/status`, {
          status: to,
          version: 1,
        })
        .expect(200)
    await status(march.id, 'cancelled')
    expect((await cards())[0].committee).toMatchObject({ session: { id: june.id } })
    await status(june.id, 'cancelled')
    expect(JSON.stringify(await cards())).toBe(awaiting)
  })

  it('pauses the card while the page, the request or its follow-up stops it, back without a new consent; archiving withdraws it', async () => {
    const { dossierId, inCci } = await biosensio()
    // Before the page is published: consented, paused.
    const paused = (await sophie.put(cardOf(inCci), CONSENT).expect(200)).body
    expect(paused.card).toMatchObject({ state: 'paused', pausedBecause: 'page_not_published' })
    await setPage(cci, true)
    expect(await cards()).toHaveLength(1)

    // The request unpublished: hidden, back once published again.
    await sophie.post(`/v1/dossiers/${dossierId}/unpublish`).expect(200)
    expect(await cards()).toEqual([])
    expect((await sophie.get(cardOf(inCci)).expect(200)).body).toMatchObject({
      card: { state: 'paused', pausedBecause: 'request_not_published' },
      blocker: 'request_not_published',
    })
    // No consent meanwhile (the pool's conditions).
    const blocked = await sophie.put(cardOf(inCci), { ...CONSENT, pseudonym: 'Autre', version: 1 })
    expect([blocked.status, blocked.body.error.message]).toEqual([
      409,
      'Publiez d’abord la demande (onglet « Demande »).',
    ])
    await sophie.post(`/v1/dossiers/${dossierId}/publish`).expect(200)
    expect(await cards()).toHaveLength(1)

    // Its follow-up closed in the CCI: hidden; reopened: back.
    const status = (from: string, to: string) =>
      as(JEAN)
        .post(`/v1/workspaces/${cci}/candidatures/${inCci}/financing-status`, { from, to })
        .expect(200)
    await status('preparing', 'funded')
    expect(await cards()).toEqual([])
    expect((await sophie.get(cardOf(inCci)).expect(200)).body.card).toMatchObject({
      state: 'paused',
      pausedBecause: 'financing_closed',
    })
    await status('funded', 'preparing')
    expect(await cards()).toHaveLength(1)

    // The page unpublished: the page itself is gone (the same 404).
    await setPage(cci, false)
    await publicPage().expect(404)
    await setPage(cci, true)

    // Archived: withdrawn (journaled), not restored by unarchiving and publishing again.
    await sophie.post(`/v1/dossiers/${dossierId}/archive`).expect(200)
    expect(await cards()).toEqual([])
    const archived = (await sophie.get(cardOf(inCci)).expect(200)).body
    expect(archived).toMatchObject({
      version: 2,
      card: { state: 'withdrawn', withdrawnBecause: 'archived' },
      blocker: 'request_archived',
    })
    expect(journal().at(-1)).toMatchObject({
      actionType: 'showcase_card_withdrawn',
      actorId: SOPHIE.id,
      dossierId,
      metadata: { candidatureId: inCci, workspaceId: cci, version: 2, reason: 'archived' },
    })
    await sophie.post(`/v1/dossiers/${dossierId}/unarchive`).expect(200)
    await sophie.post(`/v1/dossiers/${dossierId}/publish`).expect(200)
    expect(await cards()).toEqual([])
  })

  it('refuses a consent for a candidature not sent, and lets nobody but the owner consent or withdraw; the workspace’s conseillers read where it stands', async () => {
    const { inCci } = await biosensio()
    await setPage(cci, true)
    // A draft candidature (another request of hers): not sent.
    const other = (await sophie.post('/v1/dossiers', { name: 'Hydrosens' }).expect(201)).body
    const draft = (
      await sophie.post(`/v1/dossiers/${other.id}/candidatures`, { workspaceId: cci }).expect(201)
    ).body
    const notSent = await sophie.put(cardOf(draft.id), CONSENT).expect(409)
    expect(notSent.body.error.message).toBe('Envoyez d’abord la candidature à la structure.')

    await sophie.put(cardOf(inCci), CONSENT).expect(200)
    const before = JSON.stringify([...fake.table('showcaseCard').values()])
    // Every other account: the 404 of an unknown candidature, on every owner route.
    for (const someone of [MARC, MARIE, JEAN, CLAIRE, PAUL, BOB, ADMIN]) {
      const them = as(someone)
      await them.get(cardOf(inCci)).expect(404)
      await them.put(cardOf(inCci), { ...CONSENT, version: 1 }).expect(404)
      await them.delete(cardOf(inCci)).expect(404)
    }
    await sophie.get(cardOf('7d3c1b0e-0000-4000-8000-000000000000')).expect(404)
    await sophie.get('/v1/candidatures/not-a-uuid/showcase-card').expect(400)
    expect(JSON.stringify([...fake.table('showcaseCard').values()])).toBe(before)
    expect(await cards()).toHaveLength(1)

    // The CCI's conseillers and the administrators read it, without its version; its investor
    // cannot; another workspace's manager and a draft get the 404 of an unknown candidature.
    for (const reader of [MARIE, JEAN, ADMIN]) {
      const seen = (await as(reader).get(receivedCardOf(cci, inCci)).expect(200)).body
      valid(receivedShowcaseCardSchema, seen)
      expect(seen).toMatchObject({
        pagePublished: true,
        card: { pseudonym: 'Projet Héron', region: 'centre-val-de-loire', state: 'shown' },
      })
    }
    await as(CLAIRE).get(receivedCardOf(cci, inCci)).expect(403)
    await as(PAUL).get(receivedCardOf(cci, inCci)).expect(404)
    await as(MARC).get(receivedCardOf(cci, inCci)).expect(404)
    await as(MARIE).get(receivedCardOf(cci, draft.id)).expect(404)
    await as(PAUL).get(receivedCardOf(club, inCci)).expect(404)
  })
  // ROADMAP E09.03.
  it('lets the workspace’s managers hide a card from their page and restore it — never change it —, journaled; its owner reads it hidden and may still withdraw it', async () => {
    const { dossierId, inCci, inClub } = await biosensio()
    await setPage(cci, true)
    await sophie.put(cardOf(inCci), CONSENT).expect(200)
    const list = `/v1/admin/workspaces/${cci}/public-page/cards`
    const hiddenPath = (workspaceId: string, candidatureId: string) =>
      `/v1/admin/workspaces/${workspaceId}/public-page/cards/${candidatureId}/hidden`
    const marie = as(MARIE)
    const before = JSON.stringify([...fake.table('showcaseCard').values()])

    // Only the workspace's managers and the administrators: its conseiller and investor 403,
    // anyone outside it 404 — on every route, nothing written.
    for (const [someone, status] of [
      [JEAN, 403],
      [CLAIRE, 403],
      [PAUL, 404],
      [SOPHIE, 404],
      [BOB, 404],
    ] as const) {
      const them = as(someone)
      await them.get(list).expect(status)
      await them.put(hiddenPath(cci, inCci), {}).expect(status)
      await them.delete(hiddenPath(cci, inCci)).expect(status)
    }
    expect(JSON.stringify([...fake.table('showcaseCard').values()])).toBe(before)
    // No card for that candidature on this workspace's page, or never consented: 404 alike.
    for (const [workspaceId, candidatureId] of [
      [cci, inClub],
      [club, inCci],
      [cci, '7d3c1b0e-0000-4000-8000-000000000000'],
    ]) {
      const manager = as(workspaceId === cci ? MARIE : PAUL)
      const missing = await manager.put(hiddenPath(workspaceId, candidatureId), {}).expect(404)
      expect(missing.body.error.message).toBe(
        'Aucune carte consentie pour cette candidature sur la page publique.',
      )
      await manager.delete(hiddenPath(workspaceId, candidatureId)).expect(404)
    }
    await marie
      .put(`/v1/admin/workspaces/${cci}/public-page/cards/not-a-uuid/hidden`, {})
      .expect(400)

    const listed = (await marie.get(list).expect(200)).body
    expect(listed).toHaveLength(1)
    valid(managedShowcaseCardSchema, listed[0])
    expect(listed[0]).toMatchObject({
      candidatureId: inCci,
      pseudonym: 'Projet Héron',
      region: 'centre-val-de-loire',
      state: 'shown',
      pausedBecause: null,
      hiddenAt: null,
    })
    // Never a title or a name of the request.
    expect(JSON.stringify(listed)).not.toMatch(/Biosensio|Sophie|Martin/)

    // Hidden: gone from the page at the next read, from the preview too; the card itself unchanged.
    const hidden = (await marie.put(hiddenPath(cci, inCci), {}).expect(200)).body
    valid(managedShowcaseCardSchema, hidden)
    expect(hidden).toMatchObject({
      state: 'paused',
      pausedBecause: 'hidden_by_workspace',
      hiddenAt: expect.any(String),
    })
    expect(await cards()).toEqual([])
    const settings = (await marie.get(`/v1/admin/workspaces/${cci}/public-page`).expect(200)).body
    expect(settings.preview.cards).toEqual([])
    const row = [...fake.table('showcaseCard').values()][0]
    expect(row).toMatchObject({
      pseudonym: 'Projet Héron',
      region: 'centre-val-de-loire',
      withdrawnAt: null,
      hiddenById: MARIE.id,
      version: 2,
    })
    // Again: nothing changes, no entry.
    await marie.put(hiddenPath(cci, inCci), {}).expect(200)
    expect(journal().map((e) => [e.actionType, e.actorId, e.metadata])).toEqual([
      ['showcase_card_published', SOPHIE.id, expect.anything()],
      [
        'showcase_card_hidden',
        MARIE.id,
        { channel: 'site', candidatureId: inCci, workspaceId: cci, version: 2 },
      ],
    ])
    expect(journal()[1].dossierId).toBe(dossierId)

    // The owner and the conseillers read it hidden, never who hid it.
    const owner = (await sophie.get(cardOf(inCci)).expect(200)).body
    expect(owner).toMatchObject({
      version: 2,
      card: { state: 'paused', pausedBecause: 'hidden_by_workspace' },
    })
    expect(JSON.stringify(owner)).not.toContain(MARIE.id)
    expect((await as(JEAN).get(receivedCardOf(cci, inCci)).expect(200)).body.card).toMatchObject({
      state: 'paused',
      pausedBecause: 'hidden_by_workspace',
    })
    // A change of pseudonym from the version read: applied, still hidden.
    await sophie.put(cardOf(inCci), { ...CONSENT, version: 1 }).expect(409)
    await sophie.put(cardOf(inCci), { ...CONSENT, pseudonym: 'Héron bleu', version: 2 }).expect(200)
    expect(await cards()).toEqual([])
    expect((await marie.get(list).expect(200)).body[0]).toMatchObject({
      pseudonym: 'Héron bleu',
      pausedBecause: 'hidden_by_workspace',
    })

    // Restored by another manager (an administrator here): back; again, nothing changes.
    const restored = (await as(ADMIN).delete(hiddenPath(cci, inCci)).expect(200)).body
    expect(restored).toMatchObject({ state: 'shown', hiddenAt: null })
    expect(await cards()).toEqual([{ ...EXPECTED_CARD, pseudonym: 'Héron bleu' }])
    await marie.delete(hiddenPath(cci, inCci)).expect(200)
    expect(
      journal().map((e) => [e.actionType, (e.metadata as { version: number }).version]),
    ).toEqual([
      ['showcase_card_published', 1],
      ['showcase_card_hidden', 2],
      ['showcase_card_published', 3],
      ['showcase_card_unhidden', 4],
    ])

    // Hidden, the owner withdraws it: gone from the managers' list, nothing left to restore; a new
    // consent finds it still hidden.
    await marie.put(hiddenPath(cci, inCci), {}).expect(200)
    await sophie.delete(cardOf(inCci)).expect(200)
    expect((await marie.get(list).expect(200)).body).toEqual([])
    await marie.delete(hiddenPath(cci, inCci)).expect(404)
    const version = (await sophie.get(cardOf(inCci)).expect(200)).body.version
    const again = (await sophie.put(cardOf(inCci), { ...CONSENT, version }).expect(200)).body
    expect(again.card).toMatchObject({ state: 'paused', pausedBecause: 'hidden_by_workspace' })
    expect(await cards()).toEqual([])

    // E10.03: the owner is told of each hiding — once per hiding, not of a restoration, never who
    // hid it —, by email too; nobody else.
    const told = (await sophie.get('/v1/notifications').expect(200)).body.items.filter(
      (i: { kind: string }) => i.kind === 'showcase_card_hidden',
    )
    expect(told).toHaveLength(2)
    expect(told[0]).toMatchObject({
      title: 'La carte de « Biosensio » est masquée',
      href: `/dashboard/candidatures/${inCci}`,
    })
    expect(JSON.stringify(told)).not.toMatch(/Marie|marie@|Héron/)
    for (const someone of [MARIE, JEAN, CLAIRE, PAUL, BOB]) {
      const theirs = (await as(someone).get('/v1/notifications').expect(200)).body.items
      expect(theirs.filter((i: { kind: string }) => i.kind === 'showcase_card_hidden')).toEqual([])
    }
  })

  it('never shows a stored pseudonym that would be refused now; its owner reads why and chooses another', async () => {
    const { dossierId, inCci } = await biosensio()
    await setPage(cci, true)
    await sophie.put(cardOf(inCci), CONSENT).expect(200)
    const row = [...fake.table('showcaseCard').values()][0]
    // Written by an older client or by hand.
    row.pseudonym = 'Écrivez à sophie@biosensio.fr'
    expect(await cards()).toEqual([])
    expect((await sophie.get(cardOf(inCci)).expect(200)).body.card).toMatchObject({
      state: 'paused',
      pausedBecause: 'pseudonym_invalid',
    })
    row.pseudonym = 'Projet Héron'
    expect(await cards()).toHaveLength(1)
    // The request renamed to its pseudonym after the consent: no real name in its place (D06).
    fake.table('dossier').get(dossierId)!.name = 'Projet HÉRON'
    expect(await cards()).toEqual([])
    const owner = (await sophie.get(cardOf(inCci)).expect(200)).body
    expect(owner.card).toMatchObject({ state: 'paused', pausedBecause: 'pseudonym_invalid' })
    // The same pseudonym again is refused; another one shows the card again.
    await sophie.put(cardOf(inCci), { ...CONSENT, version: 1 }).expect(400)
    await sophie.put(cardOf(inCci), { ...CONSENT, pseudonym: 'Aigrette', version: 1 }).expect(200)
    expect(await cards()).toEqual([{ ...EXPECTED_CARD, pseudonym: 'Aigrette' }])
  })
})
