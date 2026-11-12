import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { ZodValidationPipe } from 'nestjs-zod'
import request from 'supertest'
import type { App } from 'supertest/types'
import { ownerHistoryPageSchema, type OwnerHistoryEntry } from '@confluent/shared'
import { AppModule } from './../src/app.module'
import { GlobalExceptionFilter } from './../src/common/filters/global-exception.filter'
import { PrismaService } from './../src/prisma/prisma.service'
import { EMAIL_TRANSPORT } from './../src/modules/auth/email/email-transport'
import { createFakePrisma } from '../src/testing/fake-prisma'

const id = (n: number) => `7d3c1b0e-0000-4000-8000-0000000079${n.toString().padStart(2, '0')}`
// Sophie owns Biosensio. Bob and Claire: recipients of direct shares (Claire also an investor of the
// CCI's pool); Ivy: investor of the CCI's pool only; Marie: conseillère of the CCI; Eve: anyone else.
const SOPHIE = { id: id(1), email: 'sophie@biosensio.fr', role: 'entrepreneur' }
const CLAIRE = { id: id(2), email: 'claire@angels.fr', role: 'financeur' }
const IVY = { id: id(3), email: 'ivy@angels.fr', role: 'financeur' }
const BOB = { id: id(4), email: 'bob@banque.fr', role: 'financeur' }
const EVE = { id: id(5), email: 'eve@fonds.fr', role: 'financeur' }
const MARIE = { id: id(6), email: 'marie@cci.fr', role: 'financeur' }
const ADMIN = { id: id(9), email: 'admin@confluent.dev', role: 'admin' }
const PEOPLE = [SOPHIE, CLAIRE, IVY, BOB, EVE, MARIE, ADMIN]
const VERSION = id(90)
const CONFLUENT_FORM = id(91)
const SECTION = id(92)
const NAME_FIELD = id(93)
const STAGE_FIELD = id(94)

const MINUTE = 60_000
const T0 = Date.now() - 24 * 60 * MINUTE

const valid = <T>(schema: { safeParse: (v: unknown) => { error?: { issues: T[] } } }, v: unknown) =>
  expect(schema.safeParse(v).error?.issues ?? []).toEqual([])

type Row = Record<string, unknown> & { id: string }

// ROADMAP E07.09 over HTTP on the stateful fake Prisma: the history of a request its owner reads —
// the consultations of its direct shares, its accesses, the administration's interventions and its
// own steps, the latest first, filtered and paginated by the server — through a closed list of the
// journal's actions, described without anything the owner must not learn; and nobody else's to
// read. Ordering and pagination on PostgreSQL: test/pg/owner-history.pg-spec.ts.
describe('Owner history (e2e)', () => {
  let app: INestApplication<App>
  let fake: ReturnType<typeof createFakePrisma>
  const tokens: Record<string, string> = {}
  let cci: string

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
    await p.questionnaireField.create({
      data: {
        id: NAME_FIELD,
        key: 'nom',
        label: 'Nom du projet',
        minAccessLevel: 'public',
        fieldType: 'text',
        orderIndex: 0,
        sectionId: SECTION,
        versionId: VERSION,
      },
    })
    await p.questionnaireField.create({
      data: {
        id: STAGE_FIELD,
        key: 'stade',
        label: 'Stade',
        minAccessLevel: 'public',
        fieldType: 'select',
        choices: [
          { key: 'idee', label: 'Idée' },
          { key: 'mvp', label: 'Prototype' },
        ],
        orderIndex: 1,
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
    for (const u of [CLAIRE, IVY]) {
      await admin
        .post(`/v1/admin/workspaces/${cci}/members`, { email: u.email, role: 'investisseur' })
        .expect(201)
    }
    await admin
      .post(`/v1/admin/workspaces/${cci}/members`, { email: MARIE.email, role: 'conseiller' })
      .expect(201)
    const form = await p.questionnaire.create({
      data: { slug: `form-${cci}`, name: 'Formulaire', workspaceId: cci, usage: 'candidature' },
    })
    await p.questionnaireVersion.create({
      data: { questionnaireId: form.id, version: 1, status: 'published' },
    })
    stamped.clear()
    clock = 0
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

  // Every journal entry and reading session written since the last call is dated one minute after
  // the previous ones: the history's order is then the order of the steps, whatever the clock.
  const stamped = new Set<string>()
  let clock = 0
  const settle = () => {
    for (const name of ['auditLog', 'readingSession']) {
      for (const row of fake.table(name).values() as IterableIterator<Row>) {
        if (stamped.has(row.id)) continue
        stamped.add(row.id)
        const at = new Date(T0 + ++clock * MINUTE)
        if (name === 'auditLog') row.createdAt = at
        else Object.assign(row, { startedAt: at, lastSeenAt: new Date(at.getTime() + 5 * MINUTE) })
      }
    }
  }
  const entry = (data: Record<string, unknown>) => {
    const row = { id: crypto.randomUUID(), actorId: null, shareLinkId: null, metadata: {}, ...data }
    fake.table('auditLog').set(row.id, { createdAt: new Date(T0), ...row } as Row)
    settle()
  }

  // Biosensio, published, sent to the CCI and listed in its pool, shared with Bob and Claire.
  async function biosensio() {
    const dossier = (await sophie.post('/v1/dossiers', { name: 'Biosensio' }).expect(201)).body
    const row = fake.table('dossier').get(dossier.id)!
    Object.assign(row, {
      submittedAt: new Date(),
      summary: 'Capteurs pour l’énergie.',
      objective: 'Industrialiser',
      amountEur: 300_000,
      financingTypes: ['equity'],
    })
    for (const [fieldId, value] of [
      [NAME_FIELD, 'NOM-Biosensio'],
      [STAGE_FIELD, 'idee'],
    ]) {
      await fake.prisma.dossierAnswer.create({
        data: { companyId: row.companyId, fieldId, value },
      })
    }
    await sophie.post(`/v1/dossiers/${dossier.id}/publish`).expect(200)
    const candidature = (
      await sophie.post(`/v1/dossiers/${dossier.id}/candidatures`, { workspaceId: cci }).expect(201)
    ).body
    await sophie.post(`/v1/candidatures/${candidature.id}/submit`).expect(200)
    await sophie
      .put(`/v1/candidatures/${candidature.id}/pool-publication`, {
        accessLevel: 'public',
        consent: true,
      })
      .expect(200)
    settle()
    const share = async (email: string) => {
      const link = (
        await sophie
          .post(`/v1/dossiers/${dossier.id}/shares`, {
            recipientEmail: email,
            accessLevel: 'public',
          })
          .expect(201)
      ).body as { id: string; token: string }
      settle()
      return link
    }
    return {
      id: dossier.id as string,
      candidatureId: candidature.id as string,
      toBob: await share(BOB.email),
      toClaire: await share(CLAIRE.email),
    }
  }

  const history = async (dossierId: string, query = '') => {
    const body = (await sophie.get(`/v1/dossiers/${dossierId}/history${query}`).expect(200)).body
    valid(ownerHistoryPageSchema, body)
    return body as { total: number; page: number; pageSize: number; items: OwnerHistoryEntry[] }
  }
  const lines = (items: OwnerHistoryEntry[]) =>
    items.map((i) => [i.kind, i.summary, i.byAdministration])

  it('tells the owner, the latest first, who consulted the request, its accesses, the administration’s interventions and its steps', async () => {
    const bio = await biosensio()
    // Bob reads his link with an identifiable browser; his time is measured.
    await as(BOB)
      .get(`/v1/shares/${bio.toBob.token}`)
      .set('User-Agent', 'Mozilla/5.0 (Macintosh) BobBrowser/9.9')
      .set('X-Forwarded-For', '203.0.113.77')
      .expect(200)
    settle()
    for (const s of fake.table('readingSession').values()) s.activeMs = 125_000
    // Claire reads it as an opportunity, through the pool and her direct share: her share's view.
    await as(CLAIRE).get(`/v1/opportunities/${bio.id}`).expect(200)
    // Ivy, through the pool alone: never shown, not even counted. She marks her interest by name.
    await as(IVY).get(`/v1/opportunities/${bio.id}`).expect(200)
    await as(IVY).put(`/v1/opportunities/${bio.id}/interest`, { nameVisible: true }).expect(200)
    settle()
    await sophie
      .patch(`/v1/dossiers/${bio.id}/shares/${bio.toBob.id}`, { accessLevel: 'partiel' })
      .expect(200)
    settle()
    await as(ADMIN)
      .patch(`/v1/admin/dossiers/${bio.id}/answers`, {
        answers: [{ fieldId: STAGE_FIELD, value: 'mvp' }],
      })
      .expect(200)
    settle()
    await as(ADMIN).delete(`/v1/admin/dossiers/${bio.id}/shares/${bio.toClaire.id}`).expect(200)
    settle()
    entry({
      dossierId: bio.id,
      actorId: ADMIN.id,
      actionType: 'dossier_classified',
      metadata: {
        reason: 'classification_rules_updated',
        rulesRevision: 'r2',
        changes: [
          { column: 'sector', from: 'Biotech', to: 'Énergie' },
          { column: 'preCreation', from: null, to: false },
          { column: 'secretColumn', from: 'x', to: 'y' },
        ],
      },
    })
    await sophie.post(`/v1/dossiers/${bio.id}/archive`).expect(200)
    settle()

    const page = await history(bio.id)
    expect(page.total).toBe(page.items.length)
    expect(lines(page.items)).toEqual([
      ['request_archived', 'Demande archivée', false],
      [
        'classification_updated',
        'Classification de la demande mise à jour par l’administration, après un changement de ses règles',
        true,
      ],
      ['share_revoked', `Accès de ${CLAIRE.email} révoqué par l’administration`, true],
      ['answer_edited', 'Réponse à « Stade » modifiée par l’administration', true],
      ['share_level_changed', `Niveau d’accès de ${BOB.email} modifié`, false],
      ['consultation', `Consultation par ${CLAIRE.email}`, false],
      ['consultation', `Consultation par ${BOB.email}`, false],
      ['share_created', `Accès ouvert à ${CLAIRE.email}`, false],
      ['share_created', `Accès ouvert à ${BOB.email}`, false],
      [
        'request_published',
        'Demande publiée : sa présentation est montrée à ceux qui y ont accès',
        false,
      ],
    ])
    const of = (kind: string) => page.items.filter((i) => i.kind === kind)
    expect(of('classification_updated')[0].details).toEqual([
      { label: 'Secteur', value: 'Biotech → Énergie' },
      { label: 'Pré-création', value: '— → Non' },
    ])
    expect(of('answer_edited')[0].details).toEqual([
      { label: 'Avant', value: 'Idée' },
      { label: 'Après', value: 'Prototype' },
    ])
    expect(of('share_level_changed')[0]).toMatchObject({
      recipientEmail: BOB.email,
      details: [
        { label: 'Avant', value: 'Public' },
        { label: 'Après', value: 'Partiel' },
      ],
    })
    expect(of('share_created').map((i) => i.details)).toEqual([
      [{ label: 'Niveau', value: 'Public' }],
      [{ label: 'Niveau', value: 'Public' }],
    ])
    expect(of('consultation').map((i) => [i.recipientEmail, i.consultation])).toEqual([
      [CLAIRE.email, { channel: 'opportunity', lastSeenAt: expect.any(String), activeSeconds: 0 }],
      [BOB.email, { channel: 'share', lastSeenAt: expect.any(String), activeSeconds: 125 }],
    ])
    expect(of('request_published')[0].details).toEqual([{ label: 'Demandé via', value: 'le site' }])

    // Nothing the owner must not learn: neither Ivy nor anything of her, no reader's address or
    // browser, no administrator, no account identifier, no raw journal field.
    const text = JSON.stringify(page)
    for (const hidden of [
      IVY.email,
      IVY.id,
      ADMIN.email,
      ADMIN.id,
      BOB.id,
      CLAIRE.id,
      'BobBrowser',
      '203.0.113.77',
      '127.0.0.1',
      'secretColumn',
      'r2',
      'actorId',
      'metadata',
      'actionType',
      'shareLinkId',
      'readingSessionId',
      bio.toBob.token,
    ]) {
      expect([hidden, text.includes(hidden)]).toEqual([hidden, false])
    }
    // The administrators' raw journal keeps all of it.
    const raw = JSON.stringify(
      (await as(ADMIN).get(`/v1/admin/dossiers/${bio.id}/audit-log`).expect(200)).body,
    )
    for (const kept of [IVY.id, 'BobBrowser', 'opportunity_viewed', 'investor_interest_marked']) {
      expect([kept, raw.includes(kept)]).toEqual([kept, true])
    }
  })

  it('reads through a closed list: what is not classified for the owner stays out, whoever wrote it', async () => {
    const bio = await biosensio()
    // An application's calls (a recipient reading through MCP included), security traces, the
    // structure's notes, investors' choices — and an action no rule knows.
    for (const [actionType, actorId, metadata] of [
      ['mcp_tool_called', BOB.id, { tool: 'get_dossier', clientName: 'ChatGPT', grantId: 'g-1' }],
      ['share_link_access_requested', null, { matched: false, ip: '198.51.100.9' }],
      ['share_link_access_denied', null, { attemptedEmail: 'mallory@x.fr' }],
      ['rate_limit_exceeded', null, { ip: '198.51.100.9' }],
      ['candidature_note_updated', MARIE.id, { noteId: 'n-1' }],
      ['candidature_status_changed', MARIE.id, { to: 'in_committee' }],
      ['investor_pledge_set', IVY.id, { amountEur: 77_777 }],
      ['investor_position_disclosed', IVY.id, { workspaceId: cci }],
      ['share_link_viewed', BOB.id, { ip: '198.51.100.9', userAgent: 'Leaky/1.0' }],
      ['opportunity_viewed', IVY.id, { ip: '198.51.100.9' }],
      ['some_future_action', ADMIN.id, { secret: 'FUTURE-SECRET' }],
    ] as const) {
      entry({ dossierId: bio.id, actionType, actorId, metadata })
    }
    // A submission asked through an AI application: its name, never what it was asked.
    entry({
      dossierId: bio.id,
      actorId: SOPHIE.id,
      actionType: 'dossier_submitted',
      metadata: {
        channel: 'mcp',
        clientId: 'client-claude',
        clientName: 'Claude',
        grantId: 'g-2',
        instruction: 'Soumets Biosensio, INSTRUCTION-PRIVEE.',
        firstSubmission: true,
      },
    })
    // Another request's entries are not this one's.
    entry({ dossierId: id(77), actionType: 'admin_edited_field', actorId: ADMIN.id, metadata: {} })

    const page = await history(bio.id)
    expect(page.total).toBe(4)
    expect(page.items.map((i) => i.kind)).toEqual([
      'request_submitted',
      'share_created',
      'share_created',
      'request_published',
    ])
    expect(page.items[0]).toMatchObject({
      summary: 'Dossier soumis',
      details: [{ label: 'Demandé via', value: 'l’application Claude' }],
    })
    const text = JSON.stringify(page)
    for (const hidden of [
      'ChatGPT',
      'g-1',
      'g-2',
      'client-claude',
      'INSTRUCTION-PRIVEE',
      '198.51.100.9',
      'mallory',
      'Leaky',
      'n-1',
      'in_committee',
      '77777',
      '77 777',
      'FUTURE-SECRET',
      MARIE.id,
      IVY.id,
      BOB.id,
    ]) {
      expect([hidden, text.includes(hidden)]).toEqual([hidden, false])
    }
    // The raw route the owner read before E07.09 is gone; the administrators keep theirs.
    await sophie.get(`/v1/dossiers/${bio.id}/audit-log`).expect(404)
    await as(ADMIN).get(`/v1/admin/dossiers/${bio.id}/audit-log`).expect(200)
  })

  it('filters and paginates on the server, the latest first', async () => {
    const bio = await biosensio()
    // 23 consultations by Bob, then an administration's intervention and a change of level.
    for (let i = 0; i < 23; i++) {
      const sessionId = `00000000-0000-4000-8000-${i.toString().padStart(12, '0')}`
      fake.table('readingSession').set(sessionId, {
        id: sessionId,
        dossierId: bio.id,
        readerId: BOB.id,
        shareLinkId: bio.toBob.id,
        channel: 'share',
        activeMs: i * 1000,
      } as Row)
      settle()
    }
    await as(ADMIN).delete(`/v1/admin/dossiers/${bio.id}/shares/${bio.toClaire.id}`).expect(200)
    settle()
    await sophie
      .patch(`/v1/dossiers/${bio.id}/shares/${bio.toBob.id}`, { accessLevel: 'complet' })
      .expect(200)
    settle()
    // Ivy's reading through the pool counts nowhere.
    await as(IVY).get(`/v1/opportunities/${bio.id}`).expect(200)
    settle()

    const first = await history(bio.id)
    expect([first.total, first.page, first.pageSize, first.items.length]).toEqual([28, 1, 20, 20])
    expect(first.items.slice(0, 3).map((i) => i.kind)).toEqual([
      'share_level_changed',
      'share_revoked',
      'consultation',
    ])
    expect(first.items[2].consultation?.activeSeconds).toBe(22)
    const second = await history(bio.id, '?page=2')
    expect(second.items.map((i) => [i.kind, i.consultation?.activeSeconds ?? null])).toEqual([
      ['consultation', 4],
      ['consultation', 3],
      ['consultation', 2],
      ['consultation', 1],
      ['consultation', 0],
      ['share_created', null],
      ['share_created', null],
      ['request_published', null],
    ])
    expect((await history(bio.id, '?page=3')).items).toEqual([])
    // Every entry once, in order, across the pages.
    const dates = [...first.items, ...second.items].map((i) => Date.parse(i.occurredAt))
    expect(dates).toEqual([...dates].sort((a, b) => b - a))
    expect(new Set(dates).size).toBe(28)

    const consultations = await history(bio.id, '?filter=consultations&page=2')
    expect([consultations.total, consultations.items.length]).toEqual([23, 3])
    expect(consultations.items.every((i) => i.kind === 'consultation')).toBe(true)
    const access = await history(bio.id, '?filter=access')
    expect(lines(access.items)).toEqual([
      ['share_level_changed', `Niveau d’accès de ${BOB.email} modifié`, false],
      ['share_revoked', `Accès de ${CLAIRE.email} révoqué par l’administration`, true],
      ['share_created', `Accès ouvert à ${CLAIRE.email}`, false],
      ['share_created', `Accès ouvert à ${BOB.email}`, false],
    ])
    const administration = await history(bio.id, '?filter=administration')
    expect([administration.total, lines(administration.items)]).toEqual([
      1,
      [['share_revoked', `Accès de ${CLAIRE.email} révoqué par l’administration`, true]],
    ])
    const steps = await history(bio.id, '?filter=request')
    expect(steps.items.map((i) => i.kind)).toEqual(['request_published'])

    for (const query of ['?page=0', '?page=501', '?page=x', '?filter=journal', '?limit=100']) {
      const res = await sophie.get(`/v1/dossiers/${bio.id}/history${query}`)
      expect([query, res.status]).toEqual([query, 400])
    }
  })

  it('is its owner’s alone: no recipient, investor, conseiller, administrator or stranger reads it', async () => {
    const bio = await biosensio()
    await as(BOB).get(`/v1/shares/${bio.toBob.token}`).expect(200)
    await as(CLAIRE).get(`/v1/opportunities/${bio.id}`).expect(200)
    for (const u of [BOB, CLAIRE, IVY, MARIE, EVE, ADMIN]) {
      for (const query of ['', '?filter=consultations', '?filter=administration']) {
        await as(u).get(`/v1/dossiers/${bio.id}/history${query}`).expect(404)
      }
      await as(u).get(`/v1/dossiers/${bio.id}/audit-log`).expect(404)
    }
    await request(app.getHttpServer()).get(`/v1/dossiers/${bio.id}/history`).expect(401)
    await sophie.get(`/v1/dossiers/${id(77)}/history`).expect(404)
  })
})
