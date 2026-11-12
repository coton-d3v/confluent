import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { ZodValidationPipe } from 'nestjs-zod'
import request from 'supertest'
import type { App } from 'supertest/types'
import { interventionJournalSchema } from '@confluent/shared'
import { AppModule } from './../src/app.module'
import { GlobalExceptionFilter } from './../src/common/filters/global-exception.filter'
import { PrismaService } from './../src/prisma/prisma.service'
import { EMAIL_TRANSPORT } from './../src/modules/auth/email/email-transport'
import { createFakePrisma } from '../src/testing/fake-prisma'

const user = (n: number, email: string, role: string, firstName?: string) => ({
  id: `7d3c1b0e-0000-4000-8000-0000000014${n.toString().padStart(2, '0')}`,
  email,
  role,
  ...(firstName ? { firstName, lastName: 'Conseil' } : {}),
})
// Marie: manager of the CCI; Jean: conseiller of the CCI without the right to manage it; Claire:
// investisseur of the CCI; Paul: manager of the club deal. Sophie and Marc: entrepreneurs. Bob:
// recipient of a share of Sophie's request.
const MARIE = user(1, 'marie@cci.fr', 'financeur', 'Marie')
const JEAN = user(2, 'jean@cci.fr', 'financeur', 'Jean')
const CLAIRE = user(3, 'claire@angels.fr', 'financeur')
const PAUL = user(4, 'paul@club.fr', 'financeur')
const SOPHIE = user(5, 'sophie@biosensio.fr', 'entrepreneur')
const MARC = user(6, 'marc@agrotech.fr', 'entrepreneur')
const BOB = user(7, 'bob@banque.fr', 'financeur')
const ADMIN = user(8, 'admin@confluent.dev', 'admin')
const PEOPLE = [MARIE, JEAN, CLAIRE, PAUL, SOPHIE, MARC, BOB, ADMIN]
const VERSION = '7d3c1b0e-0000-4000-8000-0000000014f1'
const CONFLUENT_FORM = '7d3c1b0e-0000-4000-8000-0000000014f2'
// What only the structure may ever read.
const SECRET = 'Fondateur fragile, à revoir — QX7319'

const valid = (v: unknown) =>
  expect(interventionJournalSchema.safeParse(v).error?.issues ?? []).toEqual([])

// ROADMAP E06.08 over HTTP on the stateful fake Prisma: the internal notes the conseillers of a
// workspace keep on a candidature they received — rewritten or deleted by their author only, from
// the version read — and the journal of the structure's interventions on it; nobody outside the
// structure reads either, not even that they exist.
describe('Internal notes and journal of interventions (e2e)', () => {
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

  // Sophie's request, presented to both workspaces and sent to both.
  async function sent() {
    await openToCandidatures(MARIE, cci)
    await openToCandidatures(PAUL, club)
    const o = as(SOPHIE)
    const dossier = (await o.post('/v1/dossiers', { name: 'Biosensio' }).expect(201)).body
    const candidaturesOf = `/v1/dossiers/${dossier.id}/candidatures`
    const toCci = (await o.post(candidaturesOf, { workspaceId: cci }).expect(201)).body.id as string
    const toClub = (await o.post(candidaturesOf, { workspaceId: club }).expect(201)).body
      .id as string
    await o.post(`/v1/dossiers/${dossier.id}/submit`).expect(200)
    for (const id of [toCci, toClub]) await o.post(`/v1/candidatures/${id}/submit`).expect(200)
    return { dossierId: dossier.id as string, toCci, toClub }
  }

  const base = (workspaceId: string, candidatureId: string) =>
    `/v1/workspaces/${workspaceId}/candidatures/${candidatureId}`
  const journalOf = (workspaceId: string, candidatureId: string) =>
    `${base(workspaceId, candidatureId)}/interventions`
  const notesOf = (workspaceId: string, candidatureId: string) =>
    `${base(workspaceId, candidatureId)}/notes`

  it('lets the workspace’s conseillers keep notes, rewritten or deleted by their author only, from the version read', async () => {
    const { toCci } = await sent()
    const notes = notesOf(cci, toCci)
    const created = (
      await as(JEAN)
        .post(notes, { body: '  Premier  échange.\r\n\r\n\r\nÀ relancer  en mars. ' })
        .expect(201)
    ).body
    valid(created)
    expect(created.entries).toEqual([
      {
        kind: 'note',
        id: expect.any(String),
        at: expect.any(String),
        actor: { email: JEAN.email, firstName: 'Jean', lastName: 'Conseil' },
        note: {
          id: expect.any(String),
          body: 'Premier échange.\n\nÀ relancer en mars.',
          version: 1,
          createdAt: expect.any(String),
          editedAt: null,
          deletedAt: null,
          mine: true,
        },
      },
    ])
    const noteId = created.entries[0].note.id as string
    for (const body of [
      {},
      { body: '' },
      { body: ' \n ' },
      { body: 'x'.repeat(4001) },
      { body: 'Voir <a href="x">ici</a>' },
      { body: 'Note', authorId: MARIE.id },
    ]) {
      await as(JEAN).post(notes, body).expect(400)
    }
    const markup = await as(JEAN).post(notes, { body: '<script>x</script>' }).expect(400)
    expect(JSON.stringify(markup.body)).toContain('balises HTML')
    // « < 10 salariés » is text, not markup.
    await as(JEAN).post(notes, { body: 'Moins de 10 salariés (< 10).' }).expect(201)

    // Marie reads it, not hers to change; an administrator neither.
    const read = (await as(MARIE).get(journalOf(cci, toCci)).expect(200)).body
    valid(read)
    expect(read.entries.map((e: { note: { mine: boolean } }) => e.note.mine)).toEqual([
      false,
      false,
    ])
    for (const other of [MARIE, ADMIN]) {
      const refused = await as(other)
        .patch(`${notes}/${noteId}`, { body: 'Réécrite.', version: 1 })
        .expect(403)
      expect(refused.body.error.message).toBe(
        'Seul l’auteur d’une note peut la modifier ou la supprimer.',
      )
      await as(other).delete(`${notes}/${noteId}?version=1`).expect(403)
    }

    const edited = (
      await as(JEAN).patch(`${notes}/${noteId}`, { body: 'Échange relu.', version: 1 }).expect(200)
    ).body
    valid(edited)
    expect(
      edited.entries.find((e: { note: { id: string } }) => e.note.id === noteId).note,
    ).toMatchObject({ body: 'Échange relu.', version: 2, editedAt: expect.any(String) })
    const stale = await as(JEAN)
      .patch(`${notes}/${noteId}`, { body: 'Autre.', version: 1 })
      .expect(409)
    expect(stale.body.error.message).toBe(
      'Cette note a été modifiée entre-temps : rechargez le journal avant de la modifier à nouveau.',
    )
    await as(JEAN).delete(`${notes}/${noteId}?version=1`).expect(409)
    await as(JEAN).delete(`${notes}/${noteId}`).expect(400)
    const removed = (await as(JEAN).delete(`${notes}/${noteId}?version=2`).expect(200)).body
    valid(removed)
    expect(
      removed.entries.find((e: { note: { id: string } }) => e.note.id === noteId),
    ).toMatchObject({
      actor: { email: JEAN.email },
      note: { body: null, version: 3, deletedAt: expect.any(String) },
    })
    await as(JEAN).patch(`${notes}/${noteId}`, { body: 'Encore.', version: 3 }).expect(409)
    // The text is gone from the database and was never journaled.
    expect(JSON.stringify([...fake.table('candidatureNote').values()])).not.toMatch(/relu/)
    expect(
      JSON.stringify([...fake.table('auditLog').values()]).match(/relu|Premier échange/),
    ).toBeNull()
  })

  it('lists the structure’s interventions — statuses, steps, plan lines, eligibilities, notes —, never the entrepreneur’s', async () => {
    const { toCci } = await sent()
    const owner = as(SOPHIE)
    const jean = as(JEAN)
    const categories = (await jean.get(`/v1/workspaces/${cci}/funding-source-categories`)).body
    const schemes = (await jean.get(`/v1/workspaces/${cci}/eligibility-schemes`)).body
    const steps = (await jean.get(`/v1/workspaces/${cci}/support-steps`)).body
    const id = (rows: Array<{ key: string; id: string }>, key: string) =>
      rows.find((r) => r.key === key)!.id
    // The entrepreneur's own actions.
    await owner
      .post(`/v1/candidatures/${toCci}/funding-plan/lines`, {
        categoryId: id(categories, 'pret_honneur'),
        amountEur: 20_000,
        state: 'planned',
      })
      .expect(201)
    await owner
      .post(`/v1/candidatures/${toCci}/eligibilities`, { schemeId: id(schemes, 'jei') })
      .expect(201)
    // The structure's.
    await jean
      .post(`${base(cci, toCci)}/financing-status`, { from: 'preparing', to: 'in_committee' })
      .expect(200)
    await jean
      .patch(`${base(cci, toCci)}/support-path/steps/${id(steps, 'diagnostic')}`, {
        validated: true,
        version: 0,
      })
      .expect(200)
    await as(MARIE)
      .post(`${base(cci, toCci)}/funding-plan/lines`, {
        categoryId: id(categories, 'bpifrance'),
        amountEur: 40_000,
        state: 'requested',
      })
      .expect(201)
    await as(MARIE)
      .post(`${base(cci, toCci)}/eligibilities`, { schemeId: id(schemes, 'cir'), verified: true })
      .expect(201)
    await jean.post(notesOf(cci, toCci), { body: 'Comité le 12.' }).expect(201)
    // Another workspace's interventions on its own candidature.
    const clubCandidature = (await as(PAUL).get(`/v1/workspaces/${club}/candidatures`)).body[0]
    await as(PAUL)
      .post(`${base(club, clubCandidature.id)}/financing-status`, {
        from: 'preparing',
        to: 'refused',
      })
      .expect(200)

    const view = (await as(MARIE).get(journalOf(cci, toCci)).expect(200)).body
    valid(view)
    expect(
      view.entries
        .map((e: { kind: string; actor: { email: string } | null }) => [e.kind, e.actor?.email])
        .sort(),
    ).toEqual(
      [
        ['note', JEAN.email],
        ['eligibility', MARIE.email],
        ['funding_plan', MARIE.email],
        ['support_step', JEAN.email],
        ['financing_status', JEAN.email],
      ].sort(),
    )
    expect(view.entries.find((e: { kind: string }) => e.kind === 'funding_plan')).toMatchObject({
      change: 'created',
      category: 'Bpifrance',
      line: { amountEur: 40_000, state: 'requested' },
    })
    expect(view.entries.find((e: { kind: string }) => e.kind === 'eligibility')).toMatchObject({
      change: 'declared',
      scheme: 'CIR',
      verified: true,
    })
    expect(view.entries.find((e: { kind: string }) => e.kind === 'financing_status')).toMatchObject(
      { from: 'preparing', to: 'in_committee' },
    )
    expect(JSON.stringify(view)).not.toMatch(/sophie@|20000|JEI"|refused/)
  })

  it('never lets the notes, nor the journal, leave the structure: entrepreneur, investor, other workspace, share recipient', async () => {
    const { dossierId, toCci, toClub } = await sent()
    await as(MARIE).post(notesOf(cci, toCci), { body: SECRET }).expect(201)
    const noteId = [...fake.table('candidatureNote').values()][0].id
    const body = { body: 'x', version: 1 }

    // An investisseur of the CCI: 403; whoever is not in it, the owner included: 404.
    for (const outsider of [SOPHIE, MARC, BOB, PAUL, CLAIRE]) {
      const status = outsider === CLAIRE ? 403 : 404
      await as(outsider).get(journalOf(cci, toCci)).expect(status)
      await as(outsider).post(notesOf(cci, toCci), { body: 'x' }).expect(status)
      await as(outsider)
        .patch(`${notesOf(cci, toCci)}/${noteId}`, body)
        .expect(status)
      await as(outsider)
        .delete(`${notesOf(cci, toCci)}/${noteId}?version=1`)
        .expect(status)
    }
    // The club's conseiller, through its own workspace: the CCI's candidature is unknown; its own
    // candidature carries none of the CCI's notes, and the note is unknown there.
    await as(PAUL).get(journalOf(club, toCci)).expect(404)
    const clubView = (await as(PAUL).get(journalOf(club, toClub)).expect(200)).body
    expect(clubView.entries).toEqual([])
    await as(PAUL)
      .patch(`${notesOf(club, toClub)}/${noteId}`, body)
      .expect(404)

    // Everything the entrepreneur, a share recipient and the other workspace read.
    const token = (
      await as(SOPHIE)
        .post(`/v1/dossiers/${dossierId}/shares`, {
          recipientEmail: BOB.email,
          accessLevel: 'complet',
        })
        .expect(201)
    ).body.token as string
    const reads = [
      () => as(SOPHIE).get(`/v1/candidatures/${toCci}`),
      () => as(SOPHIE).get(`/v1/candidatures/${toCci}/support-path`),
      () => as(SOPHIE).get(`/v1/candidatures/${toCci}/funding-plan`),
      () => as(SOPHIE).get(`/v1/candidatures/${toCci}/eligibilities`),
      () => as(SOPHIE).get(`/v1/dossiers/${dossierId}/candidatures`),
      () => as(SOPHIE).get(`/v1/dossiers/${dossierId}`),
      () => as(SOPHIE).get('/v1/dossiers'),
      () => as(SOPHIE).get(`/v1/dossiers/${dossierId}/history`),
      () => as(BOB).get(`/v1/shares/${token}`),
      () => as(BOB).get(`/v1/dossiers/${dossierId}`),
      () => as(PAUL).get(`/v1/workspaces/${club}/candidatures/${toClub}`),
      () => as(PAUL).get(`/v1/workspaces/${club}/candidatures`),
      () => as(PAUL).get(`/v1/workspaces/${club}/portfolio`),
      () => as(MARIE).get(`/v1/workspaces/${cci}/candidatures/${toCci}`),
    ]
    for (const read of reads) {
      const res = await read().expect(200)
      expect(JSON.stringify(res.body)).not.toMatch(/QX7319|Fondateur fragile|candidature_note/)
    }
    // Confluent's administrators keep the trace — without the text.
    const adminLog = (await as(ADMIN).get(`/v1/admin/dossiers/${dossierId}/audit-log`).expect(200))
      .body as Array<{ actionType: string }>
    expect(adminLog.map((e) => e.actionType)).toContain('candidature_note_updated')
    expect(JSON.stringify(adminLog)).not.toMatch(/QX7319|Fondateur fragile/)
    // Nothing was written by the refused calls.
    expect([...fake.table('candidatureNote').values()]).toEqual([
      expect.objectContaining({ body: SECRET, version: 1 }),
    ])
  })
})
