import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { ZodValidationPipe } from 'nestjs-zod'
import request from 'supertest'
import type { App } from 'supertest/types'
import {
  COMMITTEE_SHARED_FIELDS,
  candidateCommitteeSchema,
  committeeApplicationSchema,
} from '@confluent/shared'
import { AppModule } from './../src/app.module'
import { GlobalExceptionFilter } from './../src/common/filters/global-exception.filter'
import { PrismaService } from './../src/prisma/prisma.service'
import { EMAIL_TRANSPORT } from './../src/modules/auth/email/email-transport'
import { createFakePrisma } from '../src/testing/fake-prisma'

const user = (n: number, email: string, role: string) => ({
  id: `5e0803aa-0000-4000-8000-0000000000${n.toString().padStart(2, '0')}`,
  email,
  role,
})
// Marie manages the CCI; Jean is one of its conseillers (without the right to manage it); Claire is
// one of its investors; Paul manages the club deal. Sophie and Marc: entrepreneurs who present a
// request to the CCI. Bob: a financeur without any membership.
const MARIE = user(1, 'marie@cci.fr', 'financeur')
const JEAN = user(2, 'jean@cci.fr', 'financeur')
const CLAIRE = user(3, 'claire@angels.fr', 'financeur')
const PAUL = user(4, 'paul@club.fr', 'financeur')
const SOPHIE = user(5, 'sophie@biosensio.fr', 'entrepreneur')
const MARC = user(6, 'marc@agrotech.fr', 'entrepreneur')
const BOB = user(7, 'bob@banque.fr', 'financeur')
const ADMIN = user(8, 'admin@confluent.dev', 'admin')
const PEOPLE = [MARIE, JEAN, CLAIRE, PAUL, SOPHIE, MARC, BOB, ADMIN]
const PROFILE = '5e0803aa-0000-4000-8000-0000000000f1'
const INTERNAL = 'NOTE-INTERNE-SECRETE : Marc arrive en retard.'

const JUNE = {
  name: 'Comité de juin',
  date: '2099-06-10',
  time: '14:00',
  timeZone: 'Europe/Paris',
  location: 'CCI Touraine, salle 2',
  meetingUrl: 'https://visio.example.org/j/123',
  internalNotes: INTERNAL,
  sharedInfo: 'Pitch de 10 minutes.',
}

const valid = <T>(schema: { safeParse: (v: unknown) => { error?: { issues: T[] } } }, v: unknown) =>
  expect(schema.safeParse(v).error?.issues ?? []).toEqual([])

// ROADMAP E08.03 over HTTP on the stateful fake Prisma: a request presented at a committee of the
// workspace its candidature was sent to — the entrepreneur applies, a conseiller attaches it, the
// other side answers; one entry per candidature and committee, from the version read; the
// entrepreneur reads the committee's shared view only (the link once accepted); nobody else reads
// the entries. Concurrency and constraints: test/pg/committee-applications.pg-spec.ts.
describe('Committee applications (e2e)', () => {
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
      data: {
        id: '5e0803aa-0000-4000-8000-0000000000f0',
        slug: 'dossier',
        name: 'Profil',
        usage: 'dossier',
      },
    })
    await p.questionnaireVersion.create({
      data: {
        id: PROFILE,
        questionnaireId: '5e0803aa-0000-4000-8000-0000000000f0',
        version: 1,
        status: 'published',
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
    club = (await admin.post('/v1/admin/workspaces', { name: 'Club deal' }).expect(201)).body.id
    const invite = (workspaceId: string, body: object) =>
      admin.post(`/v1/admin/workspaces/${workspaceId}/members`, body).expect(201)
    await invite(cci, { email: MARIE.email, role: 'conseiller', canManageWorkspace: true })
    await invite(cci, { email: JEAN.email, role: 'conseiller' })
    await invite(cci, { email: CLAIRE.email, role: 'investisseur' })
    await invite(club, { email: PAUL.email, role: 'conseiller', canManageWorkspace: true })
    // Both workspaces receive candidatures: a published complementary form without question.
    for (const workspaceId of [cci, club]) {
      const form = await p.questionnaire.create({
        data: {
          slug: `form-${workspaceId}`,
          name: 'Candidature',
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
  })
  const managed = (workspaceId: string) => `/v1/admin/workspaces/${workspaceId}/committees`
  const ofCommittee = (workspaceId: string, committeeId: string) =>
    `/v1/workspaces/${workspaceId}/committees/${committeeId}/applications`
  const ofCandidature = (candidatureId: string) => `/v1/candidatures/${candidatureId}/committees`

  async function committee(workspaceId: string, body: object = JUNE) {
    const manager = workspaceId === cci ? MARIE : PAUL
    return (await as(manager).post(managed(workspaceId), body).expect(201)).body as {
      id: string
      version: number
    }
  }

  // A request of `owner`, its profile submitted, presented to the workspace — sent unless `draft`.
  async function candidature(
    owner: { id: string },
    name: string,
    workspaceId: string,
    draft = false,
  ) {
    const dossier = (await as(owner).post('/v1/dossiers', { name }).expect(201)).body
    fake.table('dossier').get(dossier.id)!.submittedAt = new Date()
    const created = (
      await as(owner).post(`/v1/dossiers/${dossier.id}/candidatures`, { workspaceId }).expect(201)
    ).body
    if (!draft) await as(owner).post(`/v1/candidatures/${created.id}/submit`).expect(200)
    return { id: created.id as string, dossierId: dossier.id as string }
  }

  const ownerChange = (
    owner: { id: string },
    candidatureId: string,
    committeeId: string,
    body: object,
  ) => as(owner).post(`${ofCandidature(candidatureId)}/${committeeId}/application`, body)
  const workspaceChange = (
    who: { id: string },
    workspaceId: string,
    committeeId: string,
    body: object,
  ) => as(who).post(ofCommittee(workspaceId, committeeId), body)

  it('lets the entrepreneur apply and a conseiller answer, from the version read, one entry per committee; the link once retained', async () => {
    const june = await committee(cci)
    const bio = await candidature(SOPHIE, 'Biosensio', cci)

    // The committee as Sophie reads it: its shared view, without the link nor the internal notes.
    const listed = (await as(SOPHIE).get(ofCandidature(bio.id)).expect(200)).body
    expect(listed).toHaveLength(1)
    valid(candidateCommitteeSchema, listed[0])
    expect(Object.keys(listed[0].committee).sort()).toEqual([...COMMITTEE_SHARED_FIELDS].sort())
    expect(listed[0]).toEqual({
      committee: {
        id: june.id,
        name: 'Comité de juin',
        date: '2099-06-10',
        time: '14:00',
        timeZone: 'Europe/Paris',
        startsAt: '2099-06-10T12:00:00.000Z',
        location: 'CCI Touraine, salle 2',
        meetingUrl: null,
        status: 'planned',
        sharedInfo: 'Pitch de 10 minutes.',
      },
      application: null,
    })

    // She applies; the same application again (a second tab, a double click) is refused.
    const applied = (
      await ownerChange(SOPHIE, bio.id, june.id, { to: 'applied', version: null }).expect(200)
    ).body
    expect(applied[0].application).toMatchObject({ status: 'applied', by: 'owner', version: 1 })
    const twice = await ownerChange(SOPHIE, bio.id, june.id, {
      to: 'applied',
      version: null,
    }).expect(409)
    expect(twice.body.error).toEqual({
      code: 'CONFLICT',
      message:
        'La participation de cette demande à ce comité a changé entre-temps : rechargez la page avant de la modifier.',
      details: { status: 'applied', version: 1 },
    })
    // A conseiller cannot attach it a second time either.
    await workspaceChange(JEAN, cci, june.id, {
      candidatureId: bio.id,
      to: 'proposed',
      version: null,
    }).expect(409)
    expect(fake.table('committeeApplication').size).toBe(1)

    // Jean — a conseiller, not a manager — reads the committee's requests and accepts hers.
    const received = (await as(JEAN).get(ofCommittee(cci, june.id)).expect(200)).body
    expect(received).toHaveLength(1)
    valid(committeeApplicationSchema, received[0])
    expect(received[0]).toMatchObject({
      committeeId: june.id,
      status: 'applied',
      by: 'owner',
      changedBy: { email: SOPHIE.email },
      version: 1,
      candidature: {
        id: bio.id,
        financingStatus: 'preparing',
        company: { name: 'Biosensio' },
        dossier: { name: 'Biosensio' },
      },
    })
    // Only the structure decides an application; only from the version read.
    await ownerChange(SOPHIE, bio.id, june.id, { to: 'accepted', version: 1 }).expect(403)
    await workspaceChange(JEAN, cci, june.id, {
      candidatureId: bio.id,
      to: 'accepted',
      version: 2,
    }).expect(409)
    const accepted = (
      await workspaceChange(JEAN, cci, june.id, {
        candidatureId: bio.id,
        to: 'accepted',
        version: 1,
      }).expect(200)
    ).body
    expect(accepted[0]).toMatchObject({ status: 'accepted', by: 'workspace', version: 2 })
    expect(accepted[0].changedBy).toMatchObject({ email: JEAN.email })

    // Retained: Sophie now reads the link — and never who decided among the structure.
    const mine = (await as(SOPHIE).get(ofCandidature(bio.id)).expect(200)).body
    valid(candidateCommitteeSchema, mine[0])
    expect(mine[0].committee.meetingUrl).toBe('https://visio.example.org/j/123')
    expect(mine[0].application).toEqual({
      id: accepted[0].id,
      status: 'accepted',
      by: 'workspace',
      changedAt: expect.any(String),
      version: 2,
      createdAt: expect.any(String),
    })
    expect(JSON.stringify(mine)).not.toContain(JEAN.email)
    expect(JSON.stringify(mine)).not.toContain('NOTE-INTERNE')

    // She withdraws, applies again (the same entry, its version growing), is refused, cannot apply
    // after the refusal; the structure proposes again, she confirms.
    let version = 2
    const step = async (who: 'owner' | 'workspace', to: string) => {
      const res =
        who === 'owner'
          ? await ownerChange(SOPHIE, bio.id, june.id, { to, version }).expect(200)
          : await workspaceChange(MARIE, cci, june.id, {
              candidatureId: bio.id,
              to,
              version,
            }).expect(200)
      version += 1
      return res.body
    }
    await step('owner', 'withdrawn')
    await step('owner', 'applied')
    await step('workspace', 'refused')
    const after = await ownerChange(SOPHIE, bio.id, june.id, { to: 'applied', version }).expect(409)
    expect(after.body.error.message).toBe(
      'Une participation « Refusée » ne peut pas passer à « Candidature en attente ».',
    )
    await step('workspace', 'proposed')
    const confirmed = await step('owner', 'accepted')
    expect(confirmed[0].application).toMatchObject({ status: 'accepted', by: 'owner', version: 7 })
    expect(fake.table('committeeApplication').size).toBe(1)

    // Journaled on the request, each change from → to by its side; kept out of the owner's history.
    const journal = [...fake.table('auditLog').values()].filter(
      (row) => row.actionType === 'committee_application_changed',
    )
    expect(
      journal.map((row) => {
        const m = row.metadata as { from: string | null; to: string; by: string; version: number }
        return [row.actorId, row.dossierId, m.from, m.to, m.by, m.version]
      }),
    ).toEqual([
      [SOPHIE.id, bio.dossierId, null, 'applied', 'owner', 1],
      [JEAN.id, bio.dossierId, 'applied', 'accepted', 'workspace', 2],
      [SOPHIE.id, bio.dossierId, 'accepted', 'withdrawn', 'owner', 3],
      [SOPHIE.id, bio.dossierId, 'withdrawn', 'applied', 'owner', 4],
      [MARIE.id, bio.dossierId, 'applied', 'refused', 'workspace', 5],
      [MARIE.id, bio.dossierId, 'refused', 'proposed', 'workspace', 6],
      [SOPHIE.id, bio.dossierId, 'proposed', 'accepted', 'owner', 7],
    ])
    const history = (await as(SOPHIE).get(`/v1/dossiers/${bio.dossierId}/history`).expect(200)).body
    expect(JSON.stringify(history)).not.toContain(june.id)
    expect(history.items.map((i: { kind: string }) => i.kind)).not.toContain(
      'committee_application_changed',
    )
  })

  it('lets a conseiller attach a request, which its entrepreneur confirms or declines; each side keeps to its transitions', async () => {
    const june = await committee(cci)
    const agro = await candidature(MARC, 'Agrotech', cci)
    const proposed = (
      await workspaceChange(JEAN, cci, june.id, {
        candidatureId: agro.id,
        to: 'proposed',
        version: null,
      }).expect(200)
    ).body
    expect(proposed[0]).toMatchObject({ status: 'proposed', by: 'workspace', version: 1 })
    // Proposed is not retained: no link yet; the structure cannot accept for him.
    const seen = (await as(MARC).get(ofCandidature(agro.id)).expect(200)).body
    expect(seen[0]).toMatchObject({
      committee: { meetingUrl: null },
      application: { status: 'proposed', by: 'workspace' },
    })
    const forbidden = await workspaceChange(JEAN, cci, june.id, {
      candidatureId: agro.id,
      to: 'accepted',
      version: 1,
    }).expect(403)
    expect(forbidden.body.error.message).toBe('« Retenue » est décidé par le porteur de projet.')
    // He does not refuse a proposal: he declines it.
    await ownerChange(MARC, agro.id, june.id, { to: 'refused', version: 1 }).expect(409)
    const declined = (
      await ownerChange(MARC, agro.id, june.id, { to: 'withdrawn', version: 1 }).expect(200)
    ).body
    expect(declined[0].application).toMatchObject({ status: 'withdrawn', by: 'owner', version: 2 })
    // Neither side moves an entry to where it is, nor anywhere the table does not lead.
    await ownerChange(MARC, agro.id, june.id, { to: 'withdrawn', version: 2 }).expect(409)
    await workspaceChange(JEAN, cci, june.id, {
      candidatureId: agro.id,
      to: 'refused',
      version: 2,
    }).expect(409)
  })

  it('keeps the entries to the request’s owner and the workspace’s conseillers: nothing to investors, other workspaces or other entrepreneurs', async () => {
    const june = await committee(cci)
    const clubCommittee = await committee(club, { ...JUNE, name: 'Comité du club' })
    const bio = await candidature(SOPHIE, 'Biosensio', cci)
    const agro = await candidature(MARC, 'Agrotech', cci)
    const draft = await candidature(SOPHIE, 'Brouillon', cci, true)
    const toClub = await candidature(SOPHIE, 'Pour le club', club)
    await ownerChange(SOPHIE, bio.id, june.id, { to: 'applied', version: null }).expect(200)

    // The workspace's investors: 403 on its committee's entries; outside it: the 404 of an unknown
    // workspace (before the body is read).
    await as(CLAIRE).get(ofCommittee(cci, june.id)).expect(403)
    await workspaceChange(CLAIRE, cci, june.id, {
      candidatureId: bio.id,
      to: 'accepted',
      version: 1,
    }).expect(403)
    for (const outsider of [PAUL, SOPHIE, MARC, BOB]) {
      await as(outsider).get(ofCommittee(cci, june.id)).expect(404)
      await workspaceChange(outsider, cci, june.id, {}).expect(404)
    }
    // Through its own workspace, the club's manager reaches neither the CCI's committee nor its
    // candidature; a CCI conseiller neither the club's committee nor a candidature sent to the club.
    await as(PAUL).get(ofCommittee(club, june.id)).expect(404)
    await workspaceChange(PAUL, club, clubCommittee.id, {
      candidatureId: bio.id,
      to: 'proposed',
      version: null,
    }).expect(404)
    await as(JEAN).get(ofCommittee(cci, clubCommittee.id)).expect(404)
    await workspaceChange(JEAN, cci, clubCommittee.id, {
      candidatureId: agro.id,
      to: 'proposed',
      version: null,
    }).expect(404)
    await workspaceChange(JEAN, cci, june.id, {
      candidatureId: toClub.id,
      to: 'proposed',
      version: null,
    }).expect(404)
    // A draft stays its owner's: the structure does not attach it, its owner applies once it is sent.
    await workspaceChange(JEAN, cci, june.id, {
      candidatureId: draft.id,
      to: 'proposed',
      version: null,
    }).expect(404)
    expect((await as(SOPHIE).get(ofCandidature(draft.id)).expect(200)).body).toEqual([])
    const unsent = await ownerChange(SOPHIE, draft.id, june.id, {
      to: 'applied',
      version: null,
    }).expect(409)
    expect(unsent.body.error.message).toContain('Envoyez d’abord la candidature')

    // Another entrepreneur, an investor, a financeur: Sophie's candidature is not theirs.
    for (const other of [MARC, CLAIRE, BOB, JEAN]) {
      await as(other).get(ofCandidature(bio.id)).expect(404)
      await ownerChange(other, bio.id, june.id, { to: 'withdrawn', version: 1 }).expect(404)
    }
    // Sophie reaches the CCI's committees from her CCI candidature only; Marc sees June, not her entry.
    await ownerChange(SOPHIE, bio.id, clubCommittee.id, { to: 'applied', version: null }).expect(
      404,
    )
    const fromClub = (await as(SOPHIE).get(ofCandidature(toClub.id)).expect(200)).body
    expect(fromClub.map((c: { committee: { id: string } }) => c.committee.id)).toEqual([
      clubCommittee.id,
    ])
    const marcs = (await as(MARC).get(ofCandidature(agro.id)).expect(200)).body
    expect(marcs).toEqual([expect.objectContaining({ application: null })])

    expect(
      (await as(JEAN).get(ofCommittee(cci, june.id)).expect(200)).body.map(
        (e: { candidature: { id: string } }) => e.candidature.id,
      ),
    ).toEqual([bio.id])
    expect(fake.table('committeeApplication').size).toBe(1)
  })

  it('opens a committee to entrepreneurs while planned and not started; a cancelled or held one keeps its entries as they were', async () => {
    const june = await committee(cci)
    const past = await committee(cci, { ...JUNE, name: 'Comité passé', date: '2001-06-10' })
    const later = await committee(cci, { ...JUNE, name: 'Comité annulé', date: '2099-09-10' })
    await as(MARIE)
      .post(`${managed(cci)}/${later.id}/status`, { status: 'cancelled', version: 1 })
      .expect(200)
    const bio = await candidature(SOPHIE, 'Biosensio', cci)

    // Only June is open to her: the past and the cancelled committees are neither listed nor reached.
    expect(
      (await as(SOPHIE).get(ofCandidature(bio.id)).expect(200)).body.map(
        (c: { committee: { name: string } }) => c.committee.name,
      ),
    ).toEqual(['Comité de juin'])
    for (const hidden of [past.id, later.id]) {
      const res = await ownerChange(SOPHIE, bio.id, hidden, { to: 'applied', version: null })
      expect(res.status).toBe(404)
      expect(res.body.error.message).toBe('Comité introuvable dans ce workspace.')
    }
    // The structure still attaches her request to the planned committee whose date has passed; she
    // sees it, but cannot confirm once it started.
    await workspaceChange(JEAN, cci, past.id, {
      candidatureId: bio.id,
      to: 'proposed',
      version: null,
    }).expect(200)
    const started = await ownerChange(SOPHIE, bio.id, past.id, {
      to: 'accepted',
      version: 1,
    }).expect(409)
    expect(started.body.error.message).toContain('Ce comité a commencé')
    await ownerChange(SOPHIE, bio.id, past.id, { to: 'withdrawn', version: 1 }).expect(200)

    // Retained at June, then June is cancelled: the entry stays as it was, read-only.
    await ownerChange(SOPHIE, bio.id, june.id, { to: 'applied', version: null }).expect(200)
    await workspaceChange(JEAN, cci, june.id, {
      candidatureId: bio.id,
      to: 'accepted',
      version: 1,
    }).expect(200)
    await as(MARIE)
      .post(`${managed(cci)}/${june.id}/status`, { status: 'cancelled', version: 1 })
      .expect(200)
    const cancelled = (await as(SOPHIE).get(ofCandidature(bio.id)).expect(200)).body
    expect(
      cancelled.map((c: { committee: { name: string; status: string } }) => [
        c.committee.name,
        c.committee.status,
      ]),
    ).toEqual([
      ['Comité passé', 'planned'],
      ['Comité de juin', 'cancelled'],
    ])
    expect(cancelled[1].application).toMatchObject({ status: 'accepted', version: 2 })
    const closed = await ownerChange(SOPHIE, bio.id, june.id, {
      to: 'withdrawn',
      version: 2,
    }).expect(409)
    expect(closed.body.error.message).toBe(
      'Ce comité est « Annulé » : ses participations ne changent plus tant qu’il n’est pas de nouveau programmé.',
    )
    await workspaceChange(JEAN, cci, june.id, {
      candidatureId: bio.id,
      to: 'withdrawn',
      version: 2,
    }).expect(409)
    // Restored: the entry resumes.
    await as(MARIE)
      .post(`${managed(cci)}/${june.id}/status`, { status: 'planned', version: 2 })
      .expect(200)
    await ownerChange(SOPHIE, bio.id, june.id, { to: 'withdrawn', version: 2 }).expect(200)
  })

  it('brings to a committee only a request still followed and not archived; withdrawing stays possible', async () => {
    const june = await committee(cci)
    const bio = await candidature(SOPHIE, 'Biosensio', cci)
    await ownerChange(SOPHIE, bio.id, june.id, { to: 'applied', version: null }).expect(200)
    await workspaceChange(JEAN, cci, june.id, {
      candidatureId: bio.id,
      to: 'accepted',
      version: 1,
    }).expect(200)
    await ownerChange(SOPHIE, bio.id, june.id, { to: 'withdrawn', version: 2 }).expect(200)

    // Funded in the CCI: closed, no new application nor proposal.
    await as(JEAN)
      .post(`/v1/workspaces/${cci}/candidatures/${bio.id}/financing-status`, {
        from: 'preparing',
        to: 'funded',
      })
      .expect(200)
    const funded = await ownerChange(SOPHIE, bio.id, june.id, { to: 'applied', version: 3 }).expect(
      409,
    )
    expect(funded.body.error.message).toBe(
      'La demande est « Financé » auprès de cette structure : elle n’est plus présentée en comité.',
    )
    await workspaceChange(JEAN, cci, june.id, {
      candidatureId: bio.id,
      to: 'proposed',
      version: 3,
    }).expect(409)
    await as(JEAN)
      .post(`/v1/workspaces/${cci}/candidatures/${bio.id}/financing-status`, {
        from: 'funded',
        to: 'preparing',
      })
      .expect(200)

    // Archived: closed too.
    await as(SOPHIE).post(`/v1/dossiers/${bio.dossierId}/archive`).expect(200)
    const archived = await ownerChange(SOPHIE, bio.id, june.id, {
      to: 'applied',
      version: 3,
    }).expect(409)
    expect(archived.body.error.message).toBe('Cette demande est archivée : désarchivez-la d’abord.')
    await as(SOPHIE).post(`/v1/dossiers/${bio.dossierId}/unarchive`).expect(200)
    await ownerChange(SOPHIE, bio.id, june.id, { to: 'applied', version: 3 }).expect(200)
  })

  it('validates what is sent', async () => {
    const june = await committee(cci)
    const bio = await candidature(SOPHIE, 'Biosensio', cci)
    for (const body of [
      {},
      { to: 'applied' },
      { to: 'applied', version: 0 },
      { to: 'presented', version: null },
      { to: 'applied', version: null, extra: true },
    ]) {
      await ownerChange(SOPHIE, bio.id, june.id, body).expect(400)
    }
    await workspaceChange(JEAN, cci, june.id, { to: 'proposed', version: null }).expect(400)
    await workspaceChange(JEAN, cci, june.id, {
      candidatureId: 'nope',
      to: 'proposed',
      version: null,
    }).expect(400)
    await as(SOPHIE).get(ofCandidature('not-a-uuid')).expect(400)
    await ownerChange(SOPHIE, bio.id, 'not-a-uuid', { to: 'applied', version: null }).expect(400)
    await as(JEAN).get(ofCommittee(cci, '00000000-0000-4000-8000-000000000000')).expect(404)
    expect(fake.table('committeeApplication').size).toBe(0)
  })
})
