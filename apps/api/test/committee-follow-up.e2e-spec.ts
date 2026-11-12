import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { ZodValidationPipe } from 'nestjs-zod'
import request from 'supertest'
import type { App } from 'supertest/types'
import {
  COMMITTEE_SHARED_FIELDS,
  committeeNoticeSchema,
  committeeParticipantSchema,
  committeeProgressSchema,
  sharedCommitteeSchema,
} from '@confluent/shared'
import { AppModule } from './../src/app.module'
import { GlobalExceptionFilter } from './../src/common/filters/global-exception.filter'
import { PrismaService } from './../src/prisma/prisma.service'
import {
  EMAIL_TRANSPORT,
  type SendCommitteeChangedInput,
} from './../src/modules/auth/email/email-transport'
import { ParticipationFormTokens } from './../src/modules/participation-requests/participation-form-token'
import { createFakePrisma } from '../src/testing/fake-prisma'

const user = (n: number, email: string, role: string) => ({
  id: `5e0806aa-0000-4000-8000-0000000000${n.toString().padStart(2, '0')}`,
  email,
  role,
})
// Marie manages the CCI; Jean is one of its conseillers; Claire one of its investors (never accepted
// for a session); Paul manages the club deal. Sophie (retained), Marc (applied) and Lea (refused):
// entrepreneurs presenting a request to the CCI's June committee. Nadia and Victor: accepted
// participants of it (Victor's membership then deactivated). Bob: a financeur without membership.
const MARIE = user(1, 'marie@cci.fr', 'financeur')
const JEAN = user(2, 'jean@cci.fr', 'financeur')
const CLAIRE = user(3, 'claire@angels.fr', 'financeur')
const PAUL = user(4, 'paul@club.fr', 'financeur')
const SOPHIE = user(5, 'sophie@biosensio.fr', 'entrepreneur')
const MARC = user(6, 'marc@agrotech.fr', 'entrepreneur')
const LEA = user(7, 'lea@solaire.fr', 'entrepreneur')
const NADIA = user(8, 'nadia@fonds.fr', 'financeur')
const VICTOR = user(9, 'victor@fonds.fr', 'financeur')
const BOB = user(10, 'bob@banque.fr', 'financeur')
const ADMIN = user(11, 'admin@confluent.dev', 'admin')
const PEOPLE = [MARIE, JEAN, CLAIRE, PAUL, SOPHIE, MARC, LEA, NADIA, VICTOR, BOB, ADMIN]
const PROFILE = '5e0806aa-0000-4000-8000-0000000000f1'
const UNKNOWN = '5e0806aa-0000-4000-8000-0000000000ff'

const JUNE = {
  name: 'Comité de juin',
  date: '2099-06-10',
  time: '14:00',
  timeZone: 'Europe/Paris',
  location: 'LIEU-PRIVE CCI Touraine, salle 2',
  meetingUrl: 'https://visio.example.org/LIEN-PRIVE',
  internalNotes: 'NOTE-INTERNE Marc arrive en retard.',
  sharedInfo: 'INFO-DIFFUSEE Pitch de 10 minutes.',
  participationRequestsOpen: true,
}

const valid = <T>(schema: { safeParse: (v: unknown) => { error?: { issues: T[] } } }, v: unknown) =>
  expect(schema.safeParse(v).error?.issues ?? []).toEqual([])

// ROADMAP E08.06 over HTTP on the stateful fake Prisma: each audience reads only the lists it is
// allowed (progress for conseillers, participants and notices for managers, the shared view of
// their sessions for participants, nothing for anyone else), and a new date, a cancellation or a
// restoration tells the people concerned once, without the place, link or texts. Concurrency and
// the migration: test/pg/committee-notices.pg-spec.ts.
describe('Committee follow-up (e2e)', () => {
  let app: INestApplication<App>
  let fake: ReturnType<typeof createFakePrisma>
  let changed: jest.Mock
  const tokens: Record<string, string> = {}
  let cci: string
  let club: string
  let ip = 0

  beforeEach(async () => {
    fake = createFakePrisma()
    const p = fake.prisma
    for (const u of PEOPLE) await p.user.create({ data: { ...u, emailVerifiedAt: new Date() } })
    await p.questionnaire.create({
      data: {
        id: '5e0806aa-0000-4000-8000-0000000000f0',
        slug: 'dossier',
        name: 'Profil',
        usage: 'dossier',
      },
    })
    await p.questionnaireVersion.create({
      data: {
        id: PROFILE,
        questionnaireId: '5e0806aa-0000-4000-8000-0000000000f0',
        version: 1,
        status: 'published',
      },
    })
    changed = jest.fn().mockResolvedValue(undefined)
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(p)
      .overrideProvider(EMAIL_TRANSPORT)
      .useValue({
        sendMagicLink: jest.fn(),
        sendShareInvite: jest.fn().mockResolvedValue(undefined),
        sendWorkspaceInvite: jest.fn().mockResolvedValue(undefined),
        sendParticipationAccepted: jest.fn().mockResolvedValue(undefined),
        sendCommitteeChanged: changed,
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
    cci = (await admin.post('/v1/admin/workspaces', { name: 'CCI Touraine' }).expect(201)).body.id
    club = (await admin.post('/v1/admin/workspaces', { name: 'Club deal' }).expect(201)).body.id
    const invite = (workspaceId: string, body: object) =>
      admin.post(`/v1/admin/workspaces/${workspaceId}/members`, body).expect(201)
    await invite(cci, { email: MARIE.email, role: 'conseiller', canManageWorkspace: true })
    await invite(cci, { email: JEAN.email, role: 'conseiller' })
    await invite(cci, { email: CLAIRE.email, role: 'investisseur' })
    await invite(club, { email: PAUL.email, role: 'conseiller', canManageWorkspace: true })
    const form = await p.questionnaire.create({
      data: { slug: `form-${cci}`, name: 'Candidature', workspaceId: cci, usage: 'candidature' },
    })
    await p.questionnaireVersion.create({
      data: { questionnaireId: form.id, version: 1, status: 'published' },
    })
  })

  afterEach(async () => {
    await app.close()
  })

  const auth = (u: { id: string }) => `Bearer ${tokens[u.id]}`
  const as = (u: { id: string }) => ({
    get: (url: string) => request(app.getHttpServer()).get(url).set('Authorization', auth(u)),
    post: (url: string, body?: object) =>
      request(app.getHttpServer()).post(url).set('Authorization', auth(u)).send(body),
    put: (url: string, body?: object) =>
      request(app.getHttpServer()).put(url).set('Authorization', auth(u)).send(body),
  })
  const managed = `/v1/admin/workspaces`
  const progressUrl = (ws = cci) => `/v1/workspaces/${ws}/committees/progress`
  const participantsUrl = (id: string, ws = cci) => `${managed}/${ws}/committees/${id}/participants`
  const noticesUrl = (id: string, ws = cci) => `${managed}/${ws}/committees/${id}/notices`
  const sessionsUrl = (ws = cci) => `/v1/workspaces/${ws}/committee-sessions`

  async function candidature(owner: { id: string }, name: string) {
    const dossier = (await as(owner).post('/v1/dossiers', { name }).expect(201)).body
    fake.table('dossier').get(dossier.id)!.submittedAt = new Date()
    const created = (
      await as(owner)
        .post(`/v1/dossiers/${dossier.id}/candidatures`, { workspaceId: cci })
        .expect(201)
    ).body
    await as(owner).post(`/v1/candidatures/${created.id}/submit`).expect(200)
    return created.id as string
  }

  const ask = (email: string, committeeIds: string[]) =>
    request(app.getHttpServer())
      .post('/v1/public/workspaces/cci-touraine/participation-requests')
      .set('X-Forwarded-For', `203.0.113.${++ip}`)
      .send({
        name: `Participant ${email.split('@')[0]}`,
        organization: 'Fonds',
        email,
        message: 'MESSAGE-PRIVE',
        committeeIds,
        formToken: app.get(ParticipationFormTokens).issue(cci, Date.now() - 5000),
      })
      .expect(202)

  // The June committee with Sophie retained, Marc applied, Lea refused; Nadia and Victor accepted
  // participants (Victor then deactivated), Eve still pending; a July committee beside it.
  async function scene() {
    const june = (await as(MARIE).post(`${managed}/${cci}/committees`, JUNE).expect(201)).body
    const july = (
      await as(MARIE)
        .post(`${managed}/${cci}/committees`, {
          ...JUNE,
          name: 'Comité de juillet',
          date: '2099-07-10',
        })
        .expect(201)
    ).body
    const apply = async (owner: { id: string }, name: string, answer?: 'accepted' | 'refused') => {
      const id = await candidature(owner, name)
      await as(owner)
        .post(`/v1/candidatures/${id}/committees/${june.id}/application`, {
          to: 'applied',
          version: null,
        })
        .expect(200)
      if (answer) {
        await as(MARIE)
          .post(`/v1/workspaces/${cci}/committees/${june.id}/applications`, {
            candidatureId: id,
            to: answer,
            version: 1,
          })
          .expect(200)
      }
      return id
    }
    const sophie = await apply(SOPHIE, 'Biosensio', 'accepted')
    const marc = await apply(MARC, 'Agrotech')
    await apply(LEA, 'Solaire', 'refused')
    for (const email of [NADIA.email, VICTOR.email, 'eve@fonds.fr']) await ask(email, [june.id])
    const queue = `${managed}/${cci}/participation-requests`
    const waiting = (await as(MARIE).get(queue).expect(200)).body as Array<{
      id: string
      email: string
      version: number
    }>
    for (const email of [NADIA.email, VICTOR.email]) {
      const r = waiting.find((w) => w.email === email)!
      await as(MARIE)
        .post(`${queue}/${r.id}/decision`, { decision: 'accepted', version: r.version })
        .expect(200)
    }
    const members = (await as(MARIE).get(`${managed}/${cci}/members`).expect(200)).body as Array<{
      id: string
      user: { id: string }
    }>
    const victor = members.find((m) => m.user.id === VICTOR.id)!
    await as(MARIE).post(`${managed}/${cci}/members/${victor.id}/deactivate`).expect(201)
    const current = (await as(MARIE).get(`/v1/workspaces/${cci}/committees/${june.id}`)).body
    changed.mockClear()
    return { june: current as { id: string; version: number }, july, sophie, marc }
  }

  const reschedule = (june: { id: string; version: number }, patch: object = {}) =>
    as(MARIE).put(`${managed}/${cci}/committees/${june.id}`, {
      ...JUNE,
      date: '2099-06-11',
      time: '09:30',
      version: june.version,
      ...patch,
    })

  it('shows the progress to conseillers and administrators, the participants and notices to managers, nothing to anyone else', async () => {
    const { june, july } = await scene()
    for (const reader of [MARIE, JEAN, ADMIN]) {
      const res = await as(reader).get(progressUrl()).expect(200)
      for (const row of res.body) valid(committeeProgressSchema, row)
      expect(res.body).toEqual([
        {
          committeeId: june.id,
          applications: { applied: 1, proposed: 0, accepted: 1, refused: 1, withdrawn: 0 },
          // Victor deactivated: no longer counted; Eve waiting.
          participants: { accepted: 1, pending: 1 },
        },
        {
          committeeId: july.id,
          applications: { applied: 0, proposed: 0, accepted: 0, refused: 0, withdrawn: 0 },
          participants: { accepted: 0, pending: 0 },
        },
      ])
      expect(JSON.stringify(res.body)).not.toMatch(/@|Participant|Biosensio/)
    }
    for (const manager of [MARIE, ADMIN]) {
      const res = await as(manager).get(participantsUrl(june.id)).expect(200)
      for (const row of res.body) valid(committeeParticipantSchema, row)
      expect(res.body.map((p: { email: string; access: string }) => [p.email, p.access])).toEqual([
        [NADIA.email, 'active'],
        [VICTOR.email, 'inactive'],
      ])
      await as(manager).get(noticesUrl(june.id)).expect(200).expect([])
    }
    // A conseiller without the right to manage, an investor, the accepted participant: 403.
    for (const reader of [JEAN, CLAIRE, NADIA]) {
      await as(reader).get(participantsUrl(june.id)).expect(403)
      await as(reader).get(noticesUrl(june.id)).expect(403)
    }
    for (const reader of [CLAIRE, NADIA]) await as(reader).get(progressUrl()).expect(403)
    // Outside the workspace (another workspace's manager, the entrepreneurs, a financeur, the
    // deactivated participant): the same 404 as an unknown workspace.
    for (const outsider of [PAUL, SOPHIE, MARC, BOB, VICTOR]) {
      for (const url of [
        progressUrl(),
        participantsUrl(june.id),
        noticesUrl(june.id),
        sessionsUrl(),
      ]) {
        const res = await as(outsider).get(url).expect(404)
        const unknown = await as(outsider).get(url.replace(cci, UNKNOWN)).expect(404)
        expect(res.body).toEqual(unknown.body)
      }
    }
    // Another workspace's committee through this one: 404.
    const other = (
      await as(PAUL)
        .post(`${managed}/${club}/committees`, { ...JUNE, name: 'Club' })
        .expect(201)
    ).body
    await as(MARIE).get(participantsUrl(other.id)).expect(404)
    await as(MARIE).get(noticesUrl(other.id)).expect(404)
  })

  it('shows a participant the shared view of their sessions, link included — not the agenda, the other participants nor the internal notes', async () => {
    const { june } = await scene()
    const res = await as(NADIA).get(sessionsUrl()).expect(200)
    expect(res.body).toHaveLength(1)
    valid(sharedCommitteeSchema, res.body[0])
    expect(Object.keys(res.body[0]).sort()).toEqual([...COMMITTEE_SHARED_FIELDS].sort())
    expect(res.body[0]).toMatchObject({
      id: june.id,
      location: JUNE.location,
      meetingUrl: JUNE.meetingUrl,
      sharedInfo: JUNE.sharedInfo,
    })
    expect(JSON.stringify(res.body)).not.toMatch(/NOTE-INTERNE|Biosensio|victor|eve@/)
    // The agenda and the committee as the conseillers read it stay closed to her.
    await as(NADIA).get(`/v1/workspaces/${cci}/committees`).expect(403)
    await as(NADIA).get(`/v1/workspaces/${cci}/committees/${june.id}`).expect(403)
    await as(NADIA).get(`/v1/workspaces/${cci}/committees/${june.id}/applications`).expect(403)
    // Other members are no participants: an empty list (an investor never accepted, conseillers,
    // an administrator outside it).
    for (const member of [CLAIRE, JEAN, MARIE, ADMIN]) {
      await as(member).get(sessionsUrl()).expect(200).expect([])
    }
    // A cancelled session stays listed, as cancelled.
    await as(MARIE)
      .post(`${managed}/${cci}/committees/${june.id}/status`, {
        status: 'cancelled',
        version: june.version,
      })
      .expect(200)
    const after = await as(NADIA).get(sessionsUrl()).expect(200)
    expect(after.body.map((c: { status: string }) => c.status)).toEqual(['cancelled'])
  })

  it('tells the entrepreneurs of retained, applied or proposed requests and the active participants of a new date, once, without place, link or texts', async () => {
    const { june, sophie } = await scene()
    // Marie proposes the July committee too — no notice concerns it.
    const updated = (await reschedule(june).expect(200)).body
    const told = changed.mock.calls.map(([input]: [SendCommitteeChangedInput]) => [
      input.to,
      input.audience,
    ])
    expect(told.sort()).toEqual([
      [MARC.email, 'entrepreneur'],
      [NADIA.email, 'participant'],
      [SOPHIE.email, 'entrepreneur'],
    ])
    const [first] = changed.mock.calls[0] as [SendCommitteeChangedInput]
    expect(first).toMatchObject({
      kind: 'rescheduled',
      workspaceName: 'CCI Touraine',
      committee: {
        name: 'Comité de juin',
        date: '2099-06-11',
        time: '09:30',
        timeZone: 'Europe/Paris',
      },
      previous: { date: '2099-06-10', time: '14:00', timeZone: 'Europe/Paris' },
    })
    expect(JSON.stringify(changed.mock.calls)).not.toMatch(
      /PRIVE|NOTE-INTERNE|INFO-DIFFUSEE|Biosensio|Agrotech|Solaire|lea@|victor@|eve@/,
    )
    const notices = (await as(MARIE).get(noticesUrl(june.id)).expect(200)).body
    for (const n of notices) valid(committeeNoticeSchema, n)
    expect(
      notices.map(
        (n: { audience: string; label: string; state: string; committeeVersion: number }) => [
          n.audience,
          n.label,
          n.state,
          n.committeeVersion,
        ],
      ),
    ).toEqual(
      expect.arrayContaining([
        ['entrepreneur', expect.stringContaining('Biosensio'), 'sent', updated.version],
        ['entrepreneur', expect.stringContaining('Agrotech'), 'sent', updated.version],
        ['participant', 'Participant nadia · Fonds', 'sent', updated.version],
      ]),
    )
    expect(notices).toHaveLength(3)
    expect(JSON.stringify(notices)).not.toMatch(/@/)

    // The same request again: refused (version read), nothing sent; the same values from the new
    // version: nothing changed, nothing sent; a new name or place only: nobody told.
    await reschedule(june).expect(409)
    await reschedule(updated, { version: updated.version }).expect(200)
    const renamed = (
      await reschedule(updated, {
        version: updated.version,
        name: 'Comité de juin (salle B)',
        location: 'Salle B',
      }).expect(200)
    ).body
    expect(changed).toHaveBeenCalledTimes(3)
    expect(
      [...fake.table('notification').values()].filter((n) => n.kind === 'committee_rescheduled'),
    ).toHaveLength(3)
    // E10.03: the same notice in the site, for its recipient only, without place, link or texts.
    const inApp = (await as(SOPHIE).get('/v1/notifications').expect(200)).body.items.filter(
      (i: { kind: string }) => i.kind === 'committee_rescheduled',
    )
    expect(inApp).toEqual([
      expect.objectContaining({
        title: 'Le comité « Comité de juin » change de date',
        body: expect.stringContaining('Date précédente : mercredi 10 juin 2099 à 14:00'),
        href: expect.stringMatching(/^\/dashboard\/candidatures\//),
      }),
    ])
    expect(JSON.stringify(inApp)).not.toMatch(/PRIVE|NOTE-INTERNE|INFO-DIFFUSEE|agrotech|solaire/)
    for (const someone of [LEA, CLAIRE, BOB]) {
      const theirs = (await as(someone).get('/v1/notifications').expect(200)).body.items
      expect(theirs.filter((i: { kind: string }) => i.kind.startsWith('committee_r'))).toEqual([])
    }

    // The entrepreneur reads the new date from their candidature, still without the others.
    const mine = (await as(SOPHIE).get(`/v1/candidatures/${sophie}/committees`).expect(200)).body
    const entry = mine.find((c: { committee: { id: string } }) => c.committee.id === june.id)
    expect(entry.committee).toMatchObject({ date: '2099-06-11', time: '09:30' })
    expect(renamed.version).toBe(updated.version + 1)
  })

  it('tells them of a cancellation and of a restoration; marking held tells nobody', async () => {
    const { june } = await scene()
    const cancelled = (
      await as(MARIE)
        .post(`${managed}/${cci}/committees/${june.id}/status`, {
          status: 'cancelled',
          version: june.version,
        })
        .expect(200)
    ).body
    expect(changed).toHaveBeenCalledTimes(3)
    expect(
      changed.mock.calls.every(
        ([i]: [SendCommitteeChangedInput]) => i.kind === 'cancelled' && i.previous === null,
      ),
    ).toBe(true)
    const restored = (
      await as(MARIE)
        .post(`${managed}/${cci}/committees/${june.id}/status`, {
          status: 'planned',
          version: cancelled.version,
        })
        .expect(200)
    ).body
    expect(changed).toHaveBeenCalledTimes(6)
    expect((changed.mock.calls[5] as [SendCommitteeChangedInput])[0].kind).toBe('restored')
    const kinds = (await as(MARIE).get(noticesUrl(june.id)).expect(200)).body.map(
      (n: { kind: string; committeeVersion: number }) => [n.committeeVersion, n.kind],
    )
    expect(kinds).toEqual([
      [restored.version, 'restored'],
      [restored.version, 'restored'],
      [restored.version, 'restored'],
      [cancelled.version, 'cancelled'],
      [cancelled.version, 'cancelled'],
      [cancelled.version, 'cancelled'],
    ])

    // A past committee marked held, then put back: nobody told.
    const past = (
      await as(MARIE)
        .post(`${managed}/${cci}/committees`, { ...JUNE, name: 'Passé', date: '2020-01-15' })
        .expect(201)
    ).body
    const held = (
      await as(MARIE)
        .post(`${managed}/${cci}/committees/${past.id}/status`, { status: 'held', version: 1 })
        .expect(200)
    ).body
    await as(MARIE)
      .post(`${managed}/${cci}/committees/${past.id}/status`, {
        status: 'planned',
        version: held.version,
      })
      .expect(200)
    expect(changed).toHaveBeenCalledTimes(6)
  })

  it('never lets a failing email block the change: recorded as failed for the managers', async () => {
    const { june } = await scene()
    changed.mockImplementation((input: SendCommitteeChangedInput) =>
      input.to === MARC.email ? Promise.reject(new Error('SMTP down')) : Promise.resolve(),
    )
    const updated = (await reschedule(june).expect(200)).body
    expect(updated).toMatchObject({ date: '2099-06-11', time: '09:30' })
    const states = (await as(MARIE).get(noticesUrl(june.id)).expect(200)).body.map(
      (n: { label: string; state: string }) => [n.label.includes('Agrotech'), n.state],
    )
    expect(states.sort()).toEqual([
      [false, 'sent'],
      [false, 'sent'],
      [true, 'failed'],
    ])
  })
})
