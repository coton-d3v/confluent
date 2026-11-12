import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { ZodValidationPipe } from 'nestjs-zod'
import request from 'supertest'
import type { App } from 'supertest/types'
import { AppModule } from './../src/app.module'
import { GlobalExceptionFilter } from './../src/common/filters/global-exception.filter'
import { PrismaService } from './../src/prisma/prisma.service'
import { EMAIL_TRANSPORT } from './../src/modules/auth/email/email-transport'
import { createFakePrisma } from '../src/testing/fake-prisma'

// ROADMAP E08.01: a workspace's committees over HTTP — organised by its managers, read by its
// conseillers, refused to its investors and to everybody outside it; dates in a named time zone.
const ACCOUNTS = {
  admin: { role: 'admin', email: 'admin@confluent.dev' },
  manager: { role: 'financeur', email: 'marie@cci-touraine.fr' },
  advisor: { role: 'financeur', email: 'luc@cci-touraine.fr' },
  investor: { role: 'financeur', email: 'claire@angels.fr' },
  clubManager: { role: 'financeur', email: 'paul@club-deal.fr' },
  entrepreneur: { role: 'entrepreneur', email: 'sophie@biosensio.fr' },
} as const
type Account = keyof typeof ACCOUNTS

const JUNE = {
  name: 'Comité de juin',
  date: '2099-06-10',
  time: '14:00',
  timeZone: 'Europe/Paris',
  location: 'CCI Touraine, salle 2',
  meetingUrl: 'https://visio.example.org/j/123',
  internalNotes: 'Ordre du jour à envoyer.',
}

describe('committees (e2e)', () => {
  let app: INestApplication<App>
  let fake: ReturnType<typeof createFakePrisma>
  const jwt: Record<string, string> = {}
  let cci: string
  let club: string

  const call = (method: 'get' | 'post' | 'put', path: string, as: Account = 'admin') =>
    request(app.getHttpServer())[method](`/v1${path}`).set('Authorization', `Bearer ${jwt[as]}`)
  const read = (workspaceId: string) => `/workspaces/${workspaceId}/committees`
  const manage = (workspaceId: string) => `/admin/workspaces/${workspaceId}/committees`

  beforeEach(async () => {
    fake = createFakePrisma()
    for (const [id, { role, email }] of Object.entries(ACCOUNTS)) {
      await fake.prisma.user.create({ data: { id, email, role, emailVerifiedAt: new Date() } })
    }
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(fake.prisma)
      .overrideProvider(EMAIL_TRANSPORT)
      .useValue({
        sendMagicLink: jest.fn(),
        sendShareInvite: jest.fn(),
        sendWorkspaceInvite: jest.fn().mockResolvedValue(undefined),
      })
      .compile()
    app = moduleFixture.createNestApplication()
    app.setGlobalPrefix('v1', { exclude: ['/'] })
    app.useGlobalPipes(new ZodValidationPipe())
    app.useGlobalFilters(new GlobalExceptionFilter())
    await app.init()
    for (const [id, { role, email }] of Object.entries(ACCOUNTS)) {
      jwt[id] = await new JwtService().signAsync(
        { sub: id, email, role },
        { secret: process.env.JWT_SECRET },
      )
    }
    const invite = (workspaceId: string, body: Record<string, unknown>) =>
      call('post', `/admin/workspaces/${workspaceId}/members`).send(body).expect(201)
    cci = (await call('post', '/admin/workspaces').send({ name: 'CCI Touraine' }).expect(201)).body
      .id
    club = (await call('post', '/admin/workspaces').send({ name: 'Club deal' }).expect(201)).body.id
    await invite(cci, {
      email: ACCOUNTS.manager.email,
      role: 'conseiller',
      canManageWorkspace: true,
    })
    await invite(cci, { email: ACCOUNTS.advisor.email, role: 'conseiller' })
    await invite(cci, {
      email: ACCOUNTS.investor.email,
      role: 'investisseur',
      investorType: 'fonds_investissement',
    })
    await invite(club, {
      email: ACCOUNTS.clubManager.email,
      role: 'conseiller',
      canManageWorkspace: true,
    })
    fake.table('auditLog').clear()
  })

  afterEach(async () => {
    await app.close()
  })

  it('lets a manager plan, edit, cancel and restore a committee its conseillers read, in its time zone', async () => {
    const created = await call('post', manage(cci), 'manager').send(JUNE).expect(201)
    expect(created.body).toEqual({
      id: expect.any(String),
      workspaceId: cci,
      ...JUNE,
      sharedInfo: null,
      startsAt: '2099-06-10T12:00:00.000Z',
      status: 'planned',
      version: 1,
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    })
    const id = created.body.id as string

    const listed = await call('get', read(cci), 'advisor').expect(200)
    expect(listed.body).toEqual([created.body])
    await call('get', `${read(cci)}/${id}`, 'advisor')
      .expect(200)
      .expect(created.body)

    // Edited whole, from the version read: in winter, 14:00 in Paris is 13:00 UTC.
    const edited = await call('put', `${manage(cci)}/${id}`, 'manager')
      .send({
        name: 'Comité de décembre',
        date: '2099-12-10',
        time: '14:00',
        timeZone: 'Europe/Paris',
        version: 1,
      })
      .expect(200)
    expect(edited.body).toMatchObject({
      name: 'Comité de décembre',
      startsAt: '2099-12-10T13:00:00.000Z',
      location: null,
      meetingUrl: null,
      internalNotes: null,
      version: 2,
    })
    // A stale version is refused, nothing overwritten.
    const stale = await call('put', `${manage(cci)}/${id}`, 'admin')
      .send({ ...JUNE, version: 1 })
      .expect(409)
    expect(stale.body.error).toEqual({
      code: 'CONFLICT',
      message: 'Ce comité a été modifié entre-temps : rechargez-le avant de le modifier à nouveau.',
      details: { currentVersion: 2 },
    })

    // Cancelled: still listed, no longer edited; restored.
    const cancelled = await call('post', `${manage(cci)}/${id}/status`, 'manager')
      .send({ status: 'cancelled', version: 2 })
      .expect(200)
    expect(cancelled.body).toMatchObject({ status: 'cancelled', version: 3 })
    expect((await call('get', read(cci), 'advisor').expect(200)).body).toHaveLength(1)
    const frozen = await call('put', `${manage(cci)}/${id}`, 'manager')
      .send({ ...JUNE, version: 3 })
      .expect(409)
    expect(frozen.body.error.message).toContain('seul un comité programmé se modifie')
    const early = await call('post', `${manage(cci)}/${id}/status`, 'manager')
      .send({ status: 'held', version: 3 })
      .expect(409)
    expect(early.body.error.message).toBe(
      'Ce comité est « Annulé » : il ne peut pas passer à « Tenu ».',
    )
    await call('post', `${manage(cci)}/${id}/status`, 'manager')
      .send({ status: 'planned', version: 3 })
      .expect(200)
    const notYet = await call('post', `${manage(cci)}/${id}/status`, 'manager')
      .send({ status: 'held', version: 4 })
      .expect(409)
    expect(notYet.body.error.message).toBe(
      'Ce comité n’a pas encore commencé : il ne peut pas être marqué comme tenu.',
    )

    expect(
      [...fake.table('auditLog').values()].map((row) => [row.actionType, row.actorId]),
    ).toEqual([
      ['committee_created', 'manager'],
      ['committee_updated', 'manager'],
      ['committee_status_changed', 'manager'],
      ['committee_status_changed', 'manager'],
    ])
  })

  it('reserves organising to managers and administrators, reading to conseillers; nothing outside the workspace', async () => {
    const id = (await call('post', manage(cci), 'admin').send(JUNE).expect(201)).body.id as string
    const advisorWrite = await call('post', manage(cci), 'advisor').send(JUNE).expect(403)
    expect(advisorWrite.body.error.message).toContain('gestionnaires')
    await call('post', manage(cci), 'investor').send(JUNE).expect(403)
    await call('put', `${manage(cci)}/${id}`, 'advisor')
      .send({ ...JUNE, version: 1 })
      .expect(403)
    await call('post', `${manage(cci)}/${id}/status`, 'advisor')
      .send({ status: 'cancelled', version: 1 })
      .expect(403)

    // The investors of the workspace read none of it.
    const investorRead = await call('get', read(cci), 'investor').expect(403)
    expect(investorRead.body.error).toEqual({
      code: 'FORBIDDEN',
      message: 'Les comités d’un workspace sont lus par ses conseillers.',
    })
    await call('get', `${read(cci)}/${id}`, 'investor').expect(403)

    // Outside the workspace: the same 404 as an unknown workspace, before the body is validated.
    for (const as of ['clubManager', 'entrepreneur'] as const) {
      await call('get', read(cci), as).expect(404)
      await call('get', `${read(cci)}/${id}`, as).expect(404)
      await call('post', manage(cci), as).send({}).expect(404)
      await call('put', `${manage(cci)}/${id}`, as)
        .send({})
        .expect(404)
      await call('post', `${manage(cci)}/${id}/status`, as)
        .send({})
        .expect(404)
    }
    // Through its own workspace, the club's manager does not reach the CCI's committee.
    await call('get', `${read(club)}/${id}`, 'clubManager').expect(404)
    await call('put', `${manage(club)}/${id}`, 'clubManager')
      .send({ ...JUNE, version: 1 })
      .expect(404)
    await call('post', `${manage(club)}/${id}/status`, 'clubManager')
      .send({ status: 'cancelled', version: 1 })
      .expect(404)
    expect((await call('get', read(club), 'clubManager').expect(200)).body).toEqual([])
    expect(fake.table('committee').get(id)).toMatchObject({ status: 'planned', version: 1 })
  })

  // ROADMAP E08.02: the information shared with candidates and investors, beside the internal notes.
  it('keeps the shared information apart from the internal notes: written by managers, kept by an older client, named in the journal without its text', async () => {
    const created = await call('post', manage(cci), 'manager')
      .send({ ...JUNE, sharedInfo: '  Accueil à 13 h 45.\r\n\r\n\r\nPitch : 10 min ' })
      .expect(201)
    expect(created.body).toMatchObject({
      internalNotes: 'Ordre du jour à envoyer.',
      sharedInfo: 'Accueil à 13 h 45.\n\nPitch : 10 min',
    })
    const id = created.body.id as string
    // The conseillers read both, each in its own field.
    await call('get', `${read(cci)}/${id}`, 'advisor')
      .expect(200)
      .expect(created.body)

    // A client that predates the field (E08.01's site) edits the rest without erasing it.
    const older = await call('put', `${manage(cci)}/${id}`, 'manager')
      .send({ ...JUNE, name: 'Comité de juin (salle 3)', version: 1 })
      .expect(200)
    expect(older.body).toMatchObject({
      version: 2,
      sharedInfo: 'Accueil à 13 h 45.\n\nPitch : 10 min',
    })
    // Emptied explicitly, it is removed.
    const emptied = await call('put', `${manage(cci)}/${id}`, 'admin')
      .send({ ...JUNE, name: older.body.name, sharedInfo: '', version: 2 })
      .expect(200)
    expect(emptied.body).toMatchObject({ version: 3, sharedInfo: null })
    // Writing it is managing the committee; the investors read none of it.
    await call('put', `${manage(cci)}/${id}`, 'advisor')
      .send({ ...JUNE, sharedInfo: 'X', version: 3 })
      .expect(403)
    await call('get', `${read(cci)}/${id}`, 'investor').expect(403)

    const journal = [...fake.table('auditLog').values()]
    expect(
      journal.map((row) => [row.actionType, (row.metadata as { fields?: string[] }).fields]),
    ).toEqual([
      ['committee_created', undefined],
      ['committee_updated', ['name']],
      ['committee_updated', ['sharedInfo']],
    ])
    expect(JSON.stringify(journal)).not.toMatch(/Accueil|Ordre du jour/)
  })

  it('validates what is sent, the schedule included, with messages on the fields', async () => {
    const invalid = async (body: Record<string, unknown>, path: string) => {
      const res = await call('post', manage(cci), 'manager').send(body).expect(400)
      expect(res.body.error.code).toBe('VALIDATION_ERROR')
      expect(res.body.error.details.map((d: { path: string[] }) => d.path.join('.'))).toContain(
        path,
      )
      return res.body.error.details as Array<{ path: string[]; message: string }>
    }
    await invalid({ ...JUNE, name: ' ' }, 'name')
    await invalid({ ...JUNE, date: '2099-02-30' }, 'date')
    await invalid({ ...JUNE, time: '25:00' }, 'time')
    await invalid({ ...JUNE, timeZone: '+01:00' }, 'timeZone')
    await invalid({ ...JUNE, timeZone: 'Europe/Atlantis' }, 'timeZone')
    await invalid({ ...JUNE, meetingUrl: 'http://visio.example.org' }, 'meetingUrl')
    await invalid({ ...JUNE, internalNotes: '<script>x</script>' }, 'internalNotes')
    await invalid({ ...JUNE, sharedInfo: '<script>x</script>' }, 'sharedInfo')
    await invalid({ ...JUNE, sharedInfo: 'x'.repeat(3001) }, 'sharedInfo')
    await invalid({ ...JUNE, status: 'held' }, '')
    const gap = await invalid({ ...JUNE, date: '2027-03-28', time: '02:30' }, 'time')
    expect(gap[0].message).toContain('passage à l’heure d’été')
    const repeated = await invalid({ ...JUNE, date: '2026-10-25', time: '02:30' }, 'time')
    expect(repeated[0].message).toContain('retour à l’heure d’hiver')
    await call('get', `${read(cci)}/not-a-uuid`, 'manager').expect(400)
    await call('post', `${manage(cci)}/${'0'.repeat(8)}/status`, 'manager')
      .send({ status: 'cancelled', version: 1 })
      .expect(400)
    const unknown = await call(
      'post',
      `${manage(cci)}/00000000-0000-4000-8000-000000000000/status`,
      'manager',
    )
      .send({ status: 'cancelled', version: 1 })
      .expect(404)
    expect(unknown.body.error.message).toBe('Comité introuvable dans ce workspace.')
    expect(fake.table('committee').size).toBe(0)

    // Canonical zone name, trimmed texts; a time in a zone without summer time.
    const created = await call('post', manage(cci), 'manager')
      .send({
        name: '  Comité  Nouméa ',
        date: '2027-03-28',
        time: '02:30',
        timeZone: 'pacific/noumea',
        location: '',
      })
      .expect(201)
    expect(created.body).toMatchObject({
      name: 'Comité Nouméa',
      timeZone: 'Pacific/Noumea',
      startsAt: '2027-03-27T15:30:00.000Z',
      location: null,
    })
  })
})
