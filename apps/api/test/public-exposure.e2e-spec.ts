import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { ZodValidationPipe } from 'nestjs-zod'
import request from 'supertest'
import type { App } from 'supertest/types'
import {
  DEFAULT_PUBLIC_PAGE_BLOCKS,
  PUBLIC_CARD_FIELDS,
  PUBLIC_PAGE_BLOCKS,
  managedShowcaseCardSchema,
  type PublicPageBlock,
} from '@confluent/shared'
import { AppModule } from './../src/app.module'
import { GlobalExceptionFilter } from './../src/common/filters/global-exception.filter'
import { PrismaService } from './../src/prisma/prisma.service'
import { EMAIL_TRANSPORT } from './../src/modules/auth/email/email-transport'
import { EntrepreneurAccessFormTokens } from './../src/modules/entrepreneur-access-requests/entrepreneur-access-form-token'
import { ParticipationFormTokens } from './../src/modules/participation-requests/participation-form-token'
import { createFakePrisma } from '../src/testing/fake-prisma'

const id = (n: number) => `5e9a7c3d-0000-4000-8000-0000000e09${n.toString().padStart(2, '0')}`
// Sophie owns Biosensio, consents to its card; Marc owns Agrotech, sent and published in the same
// workspace, never consents. Marie: manager of the CCI; Jean: its conseiller; Claire: its investor;
// Bob: the recipient of a share.
const SOPHIE = { id: id(1), email: 'sophie.prive@biosensio.fr', role: 'entrepreneur' }
const MARC = { id: id(2), email: 'marc.prive@agrotech.fr', role: 'entrepreneur' }
const MARIE = { id: id(3), email: 'marie.prive@cci.fr', role: 'financeur' }
const JEAN = { id: id(4), email: 'jean.prive@cci.fr', role: 'financeur' }
const CLAIRE = { id: id(5), email: 'claire.prive@angels.fr', role: 'financeur' }
const BOB = { id: id(6), email: 'bob.prive@banque.fr', role: 'financeur' }
const ADMIN = { id: id(7), email: 'admin.prive@confluent.dev', role: 'admin' }
const PEOPLE = [SOPHIE, MARC, MARIE, JEAN, CLAIRE, BOB, ADMIN]
const VERSION = id(90)
const PROFILE_FORM = id(91)
const SECTION = id(92)
const FIELD = { sector: id(93), siren: id(94), address: id(95), partiel: id(96), complet: id(97) }
const CANDIDATURE_FIELD = id(98)

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
)
const PSEUDONYM = 'Projet Héron'

// Every value seeded below that the public must never read, in any state. Each text also carries
// `PRIVE`, checked on its own; identifiers, tokens and amounts are added as they are created.
const SECRET_TEXTS = [
  // The companies, their identity and the owners' contact.
  'Biosensio PRIVE',
  'Agrotech PRIVE',
  '552100554',
  'ADRESSE-PRIVEE 12 rue des Halles, 37000 Tours',
  '06 12 34 56 78',
  'Martin-PRIVE',
  'Durand-PRIVE',
  // The requests' titles and presentations.
  'TITRE-PRIVE capteurs',
  'TITRE-PRIVE semences',
  'RESUME-PRIVE',
  'OBJECTIF-PRIVE',
  'DESCRIPTION-PRIVEE',
  'STADE-PRIVE',
  // Answers, at every share level, and the candidature's.
  'REPONSE-PARTIELLE-PRIVEE',
  'REPONSE-COMPLETE-PRIVEE',
  'REPONSE-CANDIDATURE-PRIVEE',
  // Documents.
  'DOCUMENT-PRIVE-bilan-2025.pdf',
  'DOCUMENT-PRIVE-kbis.pdf',
  // The plan's sources and details.
  'PRECISION-PRIVEE',
  'Bpifrance',
  // Notes, committees' private details.
  'NOTE-CONSEILLER-PRIVEE',
  'LIEU-PRIVE salle 2',
  'visio.example.org/LIEN-PRIVE',
  'NOTE-COMITE-PRIVEE',
  'INFO-DIFFUSEE-PRIVEE',
  // Investors: names, organisations, pledges.
  'Investisseuse-PRIVE',
  'ORGANISATION-PRIVEE Angels',
  'PROMESSE-PRIVEE',
  // Participation requests.
  'Demandeur PRIVE',
  'demandeur.prive@externe.fr',
  'MESSAGE-PRIVE',
  // The workspace's internal settings.
  'membres-prive@cci.fr',
  'domaine-prive.fr',
  // Other public responses must not echo state words either.
  'withdrawn',
  'hidden',
  'consent',
  'preparing',
  'partiel',
  'complet',
]
// Amounts never shown one by one (the card shows the totals: obtained 257 914, requested 568 908).
const SECRET_AMOUNTS = ['123457', '134457', '456791', '112117', '567812', '678923', '777771']

// ROADMAP E09.03 — THE public exposure guard. A workspace and two requests full of sensitive data
// (identity, contact, addresses, answers at every level, documents, plan lines, notes, committees'
// place and link, investors' names, interests and pledges, shares, members, participation requests);
// then, through every state a card goes through — shown, hidden by the workspace, restored, request
// unpublished, follow-up closed, pseudonym invalid or matching a real name, page unpublished,
// withdrawn, consented again, archived —, every public route (enumerated from the router, so that a
// route added later fails this test until it is exercised here) is read and none of these values
// appears in any body or header; outside the shown states, not even the pseudonym. Every public answer
// forbids caching (`no-store`), the versioned logo excepted. A future projection that copies one more
// field fails here. E09.04: every block of the catalogue (enumerated from it, so that a block added
// later fails this test until it is described here), alone, all together, none, in another order —
// each shows its own content only, nothing private ever. E09.06: and none is indexed by search
// engines (`X-Robots-Tag: noindex, nofollow`).
describe('Public exposure guard (e2e)', () => {
  let app: INestApplication<App>
  let fake: ReturnType<typeof createFakePrisma>
  const tokens: Record<string, string> = {}
  let cci: string
  let ip = 0
  const secrets: string[] = []

  beforeEach(async () => {
    fake = createFakePrisma()
    const p = fake.prisma
    for (const u of PEOPLE) await p.user.create({ data: { ...u, emailVerifiedAt: new Date() } })
    const named = {
      [SOPHIE.id]: ['Sophie', 'Martin-PRIVE'],
      [CLAIRE.id]: ['Claire', 'Investisseuse-PRIVE'],
      [MARC.id]: ['Marc', 'Durand-PRIVE'],
    }
    for (const [userId, [firstName, lastName]] of Object.entries(named)) {
      await p.user.update({ where: { id: userId }, data: { firstName, lastName } })
    }
    await p.questionnaire.create({
      data: { id: PROFILE_FORM, slug: 'dossier', name: 'Profil', usage: 'dossier' },
    })
    await p.questionnaireVersion.create({
      data: { id: VERSION, questionnaireId: PROFILE_FORM, version: 1, status: 'published' },
    })
    await p.questionnaireSection.create({
      data: { id: SECTION, versionId: VERSION, key: 'identite', title: 'Identité', orderIndex: 0 },
    })
    const fields = [
      [FIELD.sector, 'secteur_activite', 'public'],
      [FIELD.siren, 'siren', 'public'],
      [FIELD.address, 'adresse', 'public'],
      [FIELD.partiel, 'marges', 'partiel'],
      [FIELD.complet, 'tresorerie', 'complet'],
    ] as const
    for (const [i, [fieldId, key, minAccessLevel]] of fields.entries()) {
      await p.questionnaireField.create({
        data: {
          id: fieldId,
          key,
          label: key,
          minAccessLevel,
          fieldType: 'text',
          orderIndex: i,
          sectionId: SECTION,
          versionId: VERSION,
        },
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
    secrets.length = 0
    secrets.push(...SECRET_TEXTS, ...SECRET_AMOUNTS, ...PEOPLE.flatMap((u) => [u.id, u.email]))
  })

  afterEach(async () => {
    await app.close()
  })

  const as = (u: { id: string }) => {
    return {
      get: (url: string) =>
        request(app.getHttpServer()).get(url).set('Authorization', `Bearer ${tokens[u.id]}`),
      post: (url: string, body?: object) =>
        request(app.getHttpServer())
          .post(url)
          .set('Authorization', `Bearer ${tokens[u.id]}`)
          .send(body),
      put: (url: string, body: object = {}) =>
        request(app.getHttpServer())
          .put(url)
          .set('Authorization', `Bearer ${tokens[u.id]}`)
          .send(body),
      delete: (url: string) =>
        request(app.getHttpServer()).delete(url).set('Authorization', `Bearer ${tokens[u.id]}`),
      upload: (dossierId: string, filename: string) =>
        request(app.getHttpServer())
          .post(`/v1/dossiers/${dossierId}/documents`)
          .set('Authorization', `Bearer ${tokens[u.id]}`)
          .attach('file', Buffer.from(`%PDF-1.4 ${filename}`), filename),
    }
  }
  const sophie = as(SOPHIE)
  const marie = as(MARIE)
  const cardOf = (candidatureId: string) => `/v1/candidatures/${candidatureId}/showcase-card`
  const moderation = (candidatureId: string) =>
    `/v1/admin/workspaces/${cci}/public-page/cards/${candidatureId}/hidden`
  const setPage = async (published: boolean) => {
    const path = `/v1/admin/workspaces/${cci}/public-page`
    const { version } = (await marie.get(path).expect(200)).body
    await marie
      .put(path, {
        published,
        criteria: 'Entreprises innovantes de moins de 5 ans.',
        contact: 'Écrivez à vitrine@cci.fr.',
        version,
      })
      .expect(200)
  }

  // A request full of everything the public may never read, sent to the CCI, published, presented
  // in its pool, shared, pledged on, noted, applied and retained for a committee.
  async function seededRequest(owner: typeof SOPHIE, n: 'bio' | 'agro') {
    const me = as(owner)
    const company = n === 'bio' ? 'Biosensio PRIVE' : 'Agrotech PRIVE'
    const title = n === 'bio' ? 'TITRE-PRIVE capteurs' : 'TITRE-PRIVE semences'
    const dossier = (await me.post('/v1/dossiers', { name: title }).expect(201)).body
    const row = fake.table('dossier').get(dossier.id)!
    Object.assign(row, {
      submittedAt: new Date(),
      summary: 'RESUME-PRIVE',
      objective: 'OBJECTIF-PRIVE',
      description: 'DESCRIPTION-PRIVEE',
      amountEur: 300_000,
      financingTypes: ['equity'],
      sector: 'Eau et environnement',
      maturityStage: 'STADE-PRIVE',
      classificationSources: { sector: ['secteur_activite'], maturityStage: ['marges'] },
    })
    const companyId = row.companyId as string
    Object.assign(fake.table('company').get(companyId)!, { name: company })
    for (const [fieldId, value] of [
      [FIELD.sector, 'Eau et environnement'],
      [FIELD.siren, '552100554'],
      [FIELD.address, 'ADRESSE-PRIVEE 12 rue des Halles, 37000 Tours — 06 12 34 56 78'],
      [FIELD.partiel, 'REPONSE-PARTIELLE-PRIVEE'],
      [FIELD.complet, 'REPONSE-COMPLETE-PRIVEE'],
    ]) {
      await fake.prisma.dossierAnswer.create({ data: { companyId, fieldId, value } })
    }
    for (const filename of ['DOCUMENT-PRIVE-bilan-2025.pdf', 'DOCUMENT-PRIVE-kbis.pdf']) {
      await me.upload(dossier.id, filename).expect(201)
    }
    for (const d of fake.table('document').values()) {
      secrets.push(String(d.id), String(d.libraryDocumentId), String(d.storageKey))
    }
    await me.post(`/v1/dossiers/${dossier.id}/publish`).expect(200)
    const candidature = (
      await me.post(`/v1/dossiers/${dossier.id}/candidatures`, { workspaceId: cci }).expect(201)
    ).body
    await fake.prisma.candidatureAnswer.create({
      data: {
        candidatureId: candidature.id,
        fieldId: CANDIDATURE_FIELD,
        value: 'REPONSE-CANDIDATURE-PRIVEE',
      },
    })
    await me.post(`/v1/candidatures/${candidature.id}/submit`).expect(200)
    await me
      .put(`/v1/candidatures/${candidature.id}/pool-publication`, {
        accessLevel: 'complet',
        consent: true,
      })
      .expect(200)
    const share = (
      await me
        .post(`/v1/dossiers/${dossier.id}/shares`, {
          recipientEmail: BOB.email,
          accessLevel: 'complet',
        })
        .expect(201)
    ).body
    const plan = (await me.get(`/v1/candidatures/${candidature.id}/funding-plan`).expect(200)).body
    const category = (key: string) =>
      plan.categories.find((c: { key: string }) => c.key === key)!.id as string
    for (const [key, amountEur, state] of [
      ['bpifrance', 123_457, 'obtained'],
      ['pret_bancaire', 134_457, 'obtained'],
      ['pret_honneur', 456_791, 'requested'],
      ['pret_bancaire', 112_117, 'requested'],
      ['business_angels_love_money', 567_812, 'planned'],
      ['fonds_investissement', 678_923, 'refused'],
    ] as const) {
      await me
        .post(`/v1/candidatures/${candidature.id}/funding-plan/lines`, {
          categoryId: category(key),
          amountEur,
          state,
          label: `PRECISION-PRIVEE ${key}`,
        })
        .expect(201)
    }
    await fake.prisma.candidatureNote.create({
      data: {
        candidatureId: candidature.id,
        workspaceId: cci,
        body: 'NOTE-CONSEILLER-PRIVEE',
        authorId: JEAN.id,
      },
    })
    await fake.prisma.investorInterest.create({
      data: { dossierId: dossier.id, investorId: CLAIRE.id, nameVisible: true },
    })
    await fake.prisma.investorPledge.create({
      data: {
        dossierId: dossier.id,
        investorId: CLAIRE.id,
        intention: 'strong',
        amountEur: 777_771,
        comment: 'PROMESSE-PRIVEE',
        showName: true,
        showAmount: true,
      },
    })
    const tokenOf = [...fake.table('shareLink').values()].find((s) => s.id === share.id)!.token
    secrets.push(dossier.id, dossier.slug, companyId, candidature.id, String(tokenOf))
    return { dossierId: dossier.id as string, candidatureId: candidature.id as string }
  }

  async function seedWorkspace() {
    const admin = as(ADMIN)
    cci = (
      await admin
        .post('/v1/admin/workspaces', {
          name: 'CCI Touraine',
          slug: 'cci-touraine',
          programName: 'MoneyPlace',
          presentation: 'La CCI accompagne les entreprises innovantes.',
          contactEmail: 'membres-prive@cci.fr',
        })
        .expect(201)
    ).body.id
    const invite = (body: object) =>
      admin.post(`/v1/admin/workspaces/${cci}/members`, body).expect(201)
    await invite({ email: MARIE.email, role: 'conseiller', canManageWorkspace: true })
    await invite({ email: JEAN.email, role: 'conseiller' })
    await invite({
      email: CLAIRE.email,
      role: 'investisseur',
      organization: 'ORGANISATION-PRIVEE Angels',
    })
    Object.assign(fake.table('workspace').get(cci)!, { emailDomain: 'domaine-prive.fr' })
    const form = await fake.prisma.questionnaire.create({
      data: { slug: `form-${cci}`, name: 'Formulaire', workspaceId: cci, usage: 'candidature' },
    })
    const version = await fake.prisma.questionnaireVersion.create({
      data: { questionnaireId: form.id, version: 1, status: 'published' },
    })
    await fake.prisma.questionnaireField.create({
      data: {
        id: CANDIDATURE_FIELD,
        key: 'besoin',
        label: 'Besoin',
        minAccessLevel: 'public',
        fieldType: 'text',
        orderIndex: 0,
        versionId: version.id,
      },
    })
    await request(app.getHttpServer())
      .post(`/v1/admin/workspaces/${cci}/logo`)
      .set('Authorization', `Bearer ${tokens[MARIE.id]}`)
      .attach('file', PNG, 'logo-prive.png')
      .expect(201)
    secrets.push(cci, String(fake.table('workspace').get(cci)!.logoKey), form.id, version.id)
    const june = (
      await marie
        .post(`/v1/admin/workspaces/${cci}/committees`, {
          name: 'Comité de juin',
          date: '2099-06-10',
          time: '14:00',
          timeZone: 'Europe/Paris',
          location: 'LIEU-PRIVE salle 2',
          meetingUrl: 'https://visio.example.org/LIEN-PRIVE',
          internalNotes: 'NOTE-COMITE-PRIVEE',
          sharedInfo: 'INFO-DIFFUSEE-PRIVEE',
          participationRequestsOpen: true,
        })
        .expect(201)
    ).body as { id: string }
    const asked = await fake.prisma.participationRequest.create({
      data: {
        workspaceId: cci,
        email: 'demandeur.prive@externe.fr',
        name: 'Demandeur PRIVE',
        organization: 'ORGANISATION-PRIVEE Angels',
        message: 'MESSAGE-PRIVE',
        lastSubmittedAt: new Date(),
      },
    })
    secrets.push(asked.id)
    // E09.05: an entrepreneur's pending request for access to the candidature path, and a decided one.
    for (const status of ['pending', 'refused']) {
      const access = await fake.prisma.entrepreneurAccessRequest.create({
        data: {
          workspaceId: cci,
          email: `porteur.${status}.prive@externe.fr`,
          name: 'Porteur PRIVE',
          companyName: 'ENTREPRISE-PRIVEE Hydrolia',
          message: 'MESSAGE-ACCES-PRIVE',
          status,
          lastSubmittedAt: new Date(),
          ...(status === 'refused' ? { decidedAt: new Date(), decidedById: MARIE.id } : {}),
        },
      })
      secrets.push(access.id)
    }
    return june
  }

  // ── Every public surface ────────────────────────────────────────────────────────────────────

  type Read = { route: string; status: number; headers: Record<string, unknown>; text: string }
  // Every public route of the API, as Express routes them: one more makes this list fail.
  const SURFACES = [
    'get /v1/public/workspaces/:slug',
    'get /v1/public/workspaces/:slug/logo',
    'get /v1/public/workspaces/:slug/participation-form',
    'post /v1/public/workspaces/:slug/participation-requests',
    'get /v1/public/workspaces/:slug/entrepreneur-access-form',
    'post /v1/public/workspaces/:slug/entrepreneur-access-requests',
  ]
  function publicRoutes(): string[] {
    const router = (
      app.getHttpAdapter().getInstance() as {
        router: { stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }> }
      }
    ).router
    return router.stack
      .flatMap(({ route }) =>
        // The no-store middleware is mounted as a wildcard route of its own.
        route && route.path.startsWith('/v1/public') && !route.path.includes('*')
          ? Object.keys(route.methods)
              .filter((m) => m !== '_all')
              .map((m) => `${m} ${route.path}`)
          : [],
      )
      .sort()
  }

  // Reads every public route, each from its own network address (their per-minute limits), for the
  // workspace and for an unknown slug.
  async function readEverything(): Promise<Read[]> {
    const reads: Read[] = []
    const keep = (route: string, res: request.Response) =>
      reads.push({
        route,
        status: res.status,
        headers: res.headers as Record<string, unknown>,
        // The logo's bytes are an image: its headers only.
        text: route.endsWith('/logo') ? '' : res.text,
      })
    for (const slug of ['cci-touraine', 'inconnu']) {
      const from = () => `198.51.100.${++ip % 250}`
      const server = () => request(app.getHttpServer())
      keep(
        SURFACES[0],
        await server().get(`/v1/public/workspaces/${slug}`).set('X-Forwarded-For', from()),
      )
      keep(
        SURFACES[1],
        await server().get(`/v1/public/workspaces/${slug}/logo`).set('X-Forwarded-For', from()),
      )
      const form = await server()
        .get(`/v1/public/workspaces/${slug}/participation-form`)
        .set('X-Forwarded-For', from())
      keep(SURFACES[2], form)
      const committeeIds =
        form.status === 200 ? form.body.committees.map((c: { id: string }) => c.id) : [id(99)]
      keep(
        SURFACES[3],
        await server()
          .post(`/v1/public/workspaces/${slug}/participation-requests`)
          .set('X-Forwarded-For', from())
          .send({
            name: 'Visiteur',
            email: `visiteur${ip}@exemple.fr`,
            committeeIds,
            formToken: app.get(ParticipationFormTokens).issue(cci, Date.now() - 5000),
            website: '',
          }),
      )
      // E09.05: the entrepreneurs' access request form, and a submission to it.
      keep(
        SURFACES[4],
        await server()
          .get(`/v1/public/workspaces/${slug}/entrepreneur-access-form`)
          .set('X-Forwarded-For', from()),
      )
      keep(
        SURFACES[5],
        await server()
          .post(`/v1/public/workspaces/${slug}/entrepreneur-access-requests`)
          .set('X-Forwarded-For', from())
          .send({
            name: 'Visiteuse',
            companyName: 'Projet',
            email: `porteuse${ip}@exemple.fr`,
            formToken: app.get(EntrepreneurAccessFormTokens).issue(cci, Date.now() - 5000),
            website: '',
          }),
      )
    }
    return reads
  }

  // Nothing secret anywhere; no cache anywhere (the logo's image aside); the cards as expected.
  async function expectExposure(label: string, shown: string[]) {
    const reads = await readEverything()
    for (const read of reads) {
      const everything = `${read.text}\n${JSON.stringify(read.headers)}`
      for (const secret of [...secrets, ...(shown.length ? [] : [PSEUDONYM])]) {
        expect([label, read.route, secret, everything.includes(secret)]).toEqual([
          label,
          read.route,
          secret,
          false,
        ])
      }
      expect([label, read.route, /PRIVE/.test(everything)]).toEqual([label, read.route, false])
      const cache =
        read.route === SURFACES[1] && read.status === 200 ? 'public, max-age=300' : 'no-store'
      expect([label, read.route, read.status, read.headers['cache-control']]).toEqual([
        label,
        read.route,
        read.status,
        cache,
      ])
      // E09.06: no answer of the API is a page for search engines.
      expect([label, read.route, read.status, read.headers['x-robots-tag']]).toEqual([
        label,
        read.route,
        read.status,
        'noindex, nofollow',
      ])
    }
    const page = reads[0]
    if (page.status === 200) {
      const cards = JSON.parse(page.text).cards as Array<Record<string, unknown>>
      expect([label, cards.map((c) => c.pseudonym)]).toEqual([label, shown])
      for (const card of cards) expect(Object.keys(card)).toEqual([...PUBLIC_CARD_FIELDS])
    } else {
      expect([label, page.status, shown]).toEqual([label, 404, []])
    }
    return reads
  }

  it('never lets anything private reach a public response, in any state of a card, and lets no cache keep one', async () => {
    const june = await seedWorkspace()
    const bio = await seededRequest(SOPHIE, 'bio')
    // Agrotech: everything Biosensio has, but no consent — never on the page.
    const agro = await seededRequest(MARC, 'agro')
    expect(publicRoutes()).toEqual([...SURFACES].sort())

    // Unpublished page, no consent: the page answers the 404 of an unknown slug.
    await expectExposure('page not published, no consent', [])
    await setPage(true)
    const opened = await expectExposure('page published, no consent', [])
    // E09.05: the access request form is offered (and read) on the published page, its submission
    // answered like any other; unknown slug, 404.
    expect(opened.map((r) => [r.route, r.status]).slice(4, 6)).toEqual([
      [SURFACES[4], 200],
      [SURFACES[5], 202],
    ])
    expect(opened.map((r) => r.status).slice(10, 12)).toEqual([404, 404])

    // Consented, retained for June: the card, by its closed list of fields only.
    await sophie
      .put(cardOf(bio.candidatureId), {
        pseudonym: PSEUDONYM,
        region: 'centre-val-de-loire',
        consent: true,
        version: null,
      })
      .expect(200)
    await sophie
      .post(`/v1/candidatures/${bio.candidatureId}/committees/${june.id}/application`, {
        to: 'applied',
        version: null,
      })
      .expect(200)
    await marie
      .post(`/v1/workspaces/${cci}/committees/${june.id}/applications`, {
        candidatureId: bio.candidatureId,
        to: 'accepted',
        version: 1,
      })
      .expect(200)
    const reads = await expectExposure('shown', [PSEUDONYM])
    expect(JSON.parse(reads[0].text).cards).toEqual([
      {
        pseudonym: PSEUDONYM,
        sector: 'Eau et environnement',
        region: 'centre-val-de-loire',
        amountEur: 300_000,
        fundingPlan: {
          obtainedEur: 123_457 + 134_457,
          requestedEur: 456_791 + 112_117,
          remainingEur: 300_000 - 123_457 - 134_457,
        },
        committee: {
          state: 'scheduled',
          session: {
            id: june.id,
            name: 'Comité de juin',
            date: '2099-06-10',
            time: '14:00',
            timeZone: 'Europe/Paris',
            startsAt: '2099-06-10T12:00:00.000Z',
          },
        },
      },
    ])

    // Hidden by the workspace's manager: gone at the next read; restored: back.
    const hidden = (await marie.put(moderation(bio.candidatureId)).expect(200)).body
    expect(managedShowcaseCardSchema.safeParse(hidden).success).toBe(true)
    await expectExposure('hidden by the workspace', [])
    await marie.delete(moderation(bio.candidatureId)).expect(200)
    await expectExposure('restored by the workspace', [PSEUDONYM])

    // The request unpublished; its follow-up closed; each time gone, back once lifted.
    await sophie.post(`/v1/dossiers/${bio.dossierId}/unpublish`).expect(200)
    await expectExposure('request unpublished', [])
    await sophie.post(`/v1/dossiers/${bio.dossierId}/publish`).expect(200)
    const status = (from: string, to: string) =>
      as(JEAN)
        .post(`/v1/workspaces/${cci}/candidatures/${bio.candidatureId}/financing-status`, {
          from,
          to,
        })
        .expect(200)
    await status('preparing', 'funded')
    await expectExposure('follow-up closed', [])
    await status('funded', 'preparing')
    await expectExposure('follow-up reopened', [PSEUDONYM])

    // A pseudonym the API would refuse now, stored by an older client or by hand — or a real name
    // that became equal to it: never shown (closed at read time too).
    const card = [...fake.table('showcaseCard').values()].find(
      (c) => c.candidatureId === bio.candidatureId,
    )!
    secrets.push(String(card.id))
    for (const pseudonym of [
      '',
      '   ',
      'H',
      ` ${PSEUDONYM}`,
      'Projet\nHéron',
      '<b>Héron</b>',
      'Écrire à sophie@héron.fr',
      'https://heron.example',
      'x'.repeat(61),
      'titre prive capteurs',
      'Sophie Martin-PRIVE',
    ]) {
      card.pseudonym = pseudonym
      await expectExposure(`stored pseudonym ${JSON.stringify(pseudonym)}`, [])
    }
    card.pseudonym = PSEUDONYM
    const company = fake
      .table('company')
      .get(String(fake.table('dossier').get(bio.dossierId)!.companyId))!
    company.name = 'PROJET HÉRON'
    await expectExposure('company renamed to the pseudonym', [])
    company.name = 'Biosensio PRIVE'
    await expectExposure('company named back', [PSEUDONYM])

    // The page unpublished: the 404 of an unknown slug, the logo too.
    await setPage(false)
    await expectExposure('page unpublished', [])
    await setPage(true)

    // Withdrawn by its owner: gone at the next read, back only by a new consent.
    await sophie.delete(cardOf(bio.candidatureId)).expect(200)
    await expectExposure('withdrawn', [])
    const withdrawn = (await sophie.get(cardOf(bio.candidatureId)).expect(200)).body
    await sophie
      .put(cardOf(bio.candidatureId), {
        pseudonym: PSEUDONYM,
        region: null,
        consent: true,
        version: withdrawn.version,
      })
      .expect(200)
    await expectExposure('consented again', [PSEUDONYM])

    // Withdrawn while hidden: the workspace cannot restore it (nothing to restore).
    await marie.put(moderation(bio.candidatureId)).expect(200)
    await sophie.delete(cardOf(bio.candidatureId)).expect(200)
    await expectExposure('withdrawn while hidden', [])
    await marie.delete(moderation(bio.candidatureId)).expect(404)
    const { version } = (await sophie.get(cardOf(bio.candidatureId)).expect(200)).body
    await sophie
      .put(cardOf(bio.candidatureId), {
        pseudonym: PSEUDONYM,
        region: null,
        consent: true,
        version,
      })
      .expect(200)
    // Consented again: still hidden by the workspace until a manager restores it.
    await expectExposure('consented again, still hidden', [])
    await marie.delete(moderation(bio.candidatureId)).expect(200)
    await expectExposure('consented again, restored', [PSEUDONYM])

    // Archived: withdrawn for good.
    await sophie.post(`/v1/dossiers/${bio.dossierId}/archive`).expect(200)
    await expectExposure('archived', [])
    expect(agro.candidatureId).not.toBe(bio.candidatureId)
  })
  // What the page sends for each block of the catalogue when it is shown; nothing of it otherwise.
  // A block added to the catalogue fails to compile here until it is described.
  const BLOCK_CONTENT = {
    presentation: (page) => page.workspace.presentation !== null,
    criteria: (page) => page.workspace.criteria !== null,
    contact: (page) => page.workspace.contact !== null,
    committees: (page) => page.committees.length > 0,
    cards: (page) => page.cards.length > 0,
    apply: (page) => page.receivesCandidatures === true,
    participate: (page) => page.receivesParticipationRequests === true,
  } satisfies Record<PublicPageBlock, (page: PageBody) => boolean>
  type PageBody = {
    workspace: Record<string, string | null>
    blocks: string[]
    committees: unknown[]
    cards: unknown[]
    receivesCandidatures: boolean
    receivesParticipationRequests: boolean
  }
  // The texts of the blocks, found nowhere else in the page.
  const BLOCK_TEXTS: Partial<Record<PublicPageBlock, string>> = {
    presentation: 'accompagne les entreprises',
    criteria: 'moins de 5 ans',
    contact: 'vitrine@cci.fr',
  }

  it('shows each block of the page with its own content only, in the managers’ order, and nothing private in any choice of blocks', async () => {
    const june = await seedWorkspace()
    const bio = await seededRequest(SOPHIE, 'bio')
    await seededRequest(MARC, 'agro')
    await sophie
      .put(cardOf(bio.candidatureId), {
        pseudonym: PSEUDONYM,
        region: 'centre-val-de-loire',
        consent: true,
        version: null,
      })
      .expect(200)
    await sophie
      .post(`/v1/candidatures/${bio.candidatureId}/committees/${june.id}/application`, {
        to: 'applied',
        version: null,
      })
      .expect(200)
    await marie
      .post(`/v1/workspaces/${cci}/committees/${june.id}/applications`, {
        candidatureId: bio.candidatureId,
        to: 'accepted',
        version: 1,
      })
      .expect(200)
    await setPage(true)
    expect(Object.keys(BLOCK_CONTENT).sort()).toEqual([...PUBLIC_PAGE_BLOCKS].sort())

    const path = `/v1/admin/workspaces/${cci}/public-page`
    const choices: Array<[string, PublicPageBlock[]]> = [
      ['default', [...DEFAULT_PUBLIC_PAGE_BLOCKS]],
      ['reversed', [...PUBLIC_PAGE_BLOCKS].reverse()],
      ['none', []],
      ...PUBLIC_PAGE_BLOCKS.map((block): [string, PublicPageBlock[]] => [
        `${block} alone`,
        [block],
      ]),
      [
        'all but cards and committees',
        PUBLIC_PAGE_BLOCKS.filter((b) => b !== 'cards' && b !== 'committees'),
      ],
    ]
    for (const [label, blocks] of choices) {
      const settings = (await marie.get(path).expect(200)).body
      const saved = (
        await marie
          .put(path, {
            published: true,
            criteria: settings.criteria,
            contact: settings.contact,
            blocks,
            version: settings.version,
          })
          .expect(200)
      ).body
      const reads = await expectExposure(label, blocks.includes('cards') ? [PSEUDONYM] : [])
      const page = JSON.parse(reads[0].text) as PageBody
      // Every block of this seed has something to show: all listed, in the managers' order.
      expect([label, page.blocks]).toEqual([label, blocks])
      for (const block of PUBLIC_PAGE_BLOCKS) {
        const shown = blocks.includes(block)
        expect([label, block, BLOCK_CONTENT[block](page)]).toEqual([label, block, shown])
        const text = BLOCK_TEXTS[block]
        if (text)
          expect([label, block, reads[0].text.includes(text)]).toEqual([label, block, shown])
      }
      // The sessions reach the page by the committees block, or as the cards' committee only.
      if (!blocks.includes('committees') && !blocks.includes('cards')) {
        expect([label, reads[0].text.includes(june.id)]).toEqual([label, false])
        expect([label, reads[0].text.includes('Comité de juin')]).toEqual([label, false])
      }
      // The managers' preview is this very page.
      expect([label, saved.preview]).toEqual([label, page])
    }
  })
})
