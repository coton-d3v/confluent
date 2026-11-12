import { HttpException } from '@nestjs/common'
import type { ConfigService } from '@nestjs/config'
import { ThrottlerStorageService } from '@nestjs/throttler'
import { PARTICIPATION_FORM_TIMING, PARTICIPATION_REQUEST_LIMITS } from '@confluent/shared'
import type { AppConfig } from '../../config/config.schema'
import type { PrismaService } from '../../prisma/prisma.service'
import { createFakePrisma } from '../../testing/fake-prisma'
import { AuditService } from '../audit/audit.service'
import type { EmailTransport } from '../auth/email/email-transport'
import { CommitteeNoticesService } from '../committees/committee-notices.service'
import { CommitteesService, type CommitteeInput } from '../committees/committees.service'
import { MemoryStorageAdapter } from '../documents/storage/memory-storage.adapter'
import { WorkspaceAccessService } from '../workspaces/workspace-access'
import { WorkspacesService } from '../workspaces/workspaces.service'
import { ParticipationFormTokens } from './participation-form-token'
import {
  PARTICIPATION_RATE_LIMITS,
  ParticipationRequestsService,
  type ParticipationRequestInput,
} from './participation-requests.service'
import { quietNotifications } from '../../testing/notifications'
import { NotificationsService } from '../notifications/notifications.service'

const ADMIN = { id: 'admin-1', role: 'admin' }
const MANAGER = { id: 'marie', role: 'financeur' }
const ADVISOR = { id: 'luc', role: 'financeur' }
const OUTSIDER = { id: 'paul', role: 'financeur' }

const JUNE: CommitteeInput = {
  name: 'Comité de juin',
  date: '2099-06-10',
  time: '14:00',
  timeZone: 'Europe/Paris',
  location: 'LIEU-PRIVE',
  meetingUrl: 'https://visio.example.org/LIEN-PRIVE',
  internalNotes: 'NOTE-INTERNE',
  sharedInfo: 'INFO-DIFFUSEE',
  participationRequestsOpen: true,
}

const failure = async (promise: Promise<unknown>) => {
  try {
    await promise
  } catch (err) {
    if (err instanceof HttpException) {
      const body = err.getResponse() as { code: string; details?: unknown }
      return { status: err.getStatus(), code: body.code, details: body.details }
    }
    throw err
  }
  throw new Error('expected a refusal')
}

const config = { get: () => 'k'.repeat(32) } as unknown as ConfigService<AppConfig, true>

// ROADMAP E08.04: the public form's rules, as the service applies them.
describe('ParticipationRequestsService', () => {
  let fake: ReturnType<typeof createFakePrisma>
  let service: ParticipationRequestsService
  let committees: CommitteesService
  let tokens: ParticipationFormTokens
  let storage: ThrottlerStorageService
  let cci: string
  let june: string

  beforeEach(async () => {
    fake = createFakePrisma()
    const prisma = fake.prisma as unknown as PrismaService
    const audit = new AuditService(prisma)
    const access = new WorkspaceAccessService(prisma)
    tokens = new ParticipationFormTokens(config)
    storage = new ThrottlerStorageService()
    service = new ParticipationRequestsService(
      prisma,
      access,
      audit,
      tokens,
      storage,
      quietNotifications(prisma),
    )
    committees = new CommitteesService(
      prisma,
      access,
      audit,
      new CommitteeNoticesService(
        prisma,
        new NotificationsService(prisma, config, {} as EmailTransport),
      ),
    )
    const workspaces = new WorkspacesService(prisma, audit, new MemoryStorageAdapter(), access)
    cci = (await workspaces.create(ADMIN, { name: 'CCI Touraine', slug: 'cci-touraine' })).id
    const club = (await workspaces.create(ADMIN, { name: 'Club deal', slug: 'club-deal' })).id
    for (const [workspaceId, userId, canManageWorkspace] of [
      [cci, MANAGER.id, true],
      [cci, ADVISOR.id, false],
      [club, OUTSIDER.id, true],
    ] as const) {
      await fake.prisma.workspaceMembership.create({
        data: { workspaceId, userId, role: 'conseiller', canManageWorkspace },
      })
    }
    june = (await committees.create(MANAGER, cci, JUNE)).id
    fake.table('auditLog').clear()
  })

  afterEach(() => storage.onApplicationShutdown())

  const ready = (workspaceId = cci) =>
    tokens.issue(workspaceId, Date.now() - PARTICIPATION_FORM_TIMING.minFillMs - 1)
  const input = (patch: Partial<ParticipationRequestInput> = {}): ParticipationRequestInput => ({
    name: 'Claire Martin',
    organization: 'Angels Touraine',
    email: 'claire@angels.fr',
    message: 'Bonjour.',
    committeeIds: [june],
    formToken: ready(),
    ...patch,
  })
  const journal = () =>
    [...fake.table('auditLog').values()].map((r) => ({
      actionType: r.actionType,
      actorId: r.actorId,
      metadata: r.metadata,
    }))

  describe('form token', () => {
    it('is valid for its workspace only, after the minimal fill time and before it expires', () => {
      const now = Date.now()
      const token = tokens.issue(cci, now)
      expect(tokens.check(token, cci, now + PARTICIPATION_FORM_TIMING.minFillMs)).toBe('valid')
      expect(tokens.check(token, cci, now + PARTICIPATION_FORM_TIMING.minFillMs - 1)).toBe(
        'too_fast',
      )
      expect(tokens.check(token, cci, now + PARTICIPATION_FORM_TIMING.maxAgeMs + 1)).toBe('expired')
      expect(tokens.check(token, 'another-workspace', now + 5000)).toBe('invalid')
      // A changed time or signature, or anything else, is not a token.
      const [issued, mac] = token.split('.')
      expect(tokens.check(`${Number(issued) - 10_000}.${mac}`, cci, now + 5000)).toBe('invalid')
      expect(tokens.check(`${issued}.${mac.slice(1)}A`, cci, now + 5000)).toBe('invalid')
      expect(tokens.check('', cci, now)).toBe('invalid')
      // Another key signs other tokens.
      const other = new ParticipationFormTokens({
        get: () => 'z'.repeat(32),
      } as unknown as ConfigService<AppConfig, true>)
      expect(other.check(token, cci, now + 5000)).toBe('invalid')
    })
  })

  it('records a pending request — no account, membership or email — journaled without what it says', async () => {
    const users = fake.table('user').size
    const memberships = fake.table('workspaceMembership').size
    await service.submit('cci-touraine', input(), { ip: '203.0.113.1' })
    const [request] = [...fake.table('participationRequest').values()]
    expect(request).toMatchObject({
      workspaceId: cci,
      email: 'claire@angels.fr',
      name: 'Claire Martin',
      status: 'pending',
      submissionCount: 1,
      version: 1,
    })
    expect([...fake.table('participationRequestCommittee').values()]).toEqual([
      expect.objectContaining({ requestId: request.id, committeeId: june, workspaceId: cci }),
    ])
    expect(fake.table('user').size).toBe(users)
    expect(fake.table('workspaceMembership').size).toBe(memberships)
    expect(journal()).toEqual([
      {
        actionType: 'participation_request_received',
        actorId: null,
        metadata: {
          workspaceId: cci,
          requestId: request.id,
          version: 1,
          merged: false,
          committeeIds: [june],
        },
      },
    ])
    const written = JSON.stringify(journal())
    for (const text of ['claire', 'Claire', 'Angels', 'Bonjour']) {
      expect([text, written.includes(text)]).toEqual([text, false])
    }
  })

  it('adds the sessions of a new submission to the pending request of the address, keeping what it said first', async () => {
    const july = (await committees.create(MANAGER, cci, { ...JUNE, date: '2099-07-10' })).id
    fake.table('auditLog').clear()
    await service.submit('cci-touraine', input(), { ip: null })
    await service.submit(
      'cci-touraine',
      input({ name: 'Usurpateur', message: 'AUTRE', committeeIds: [june, july] }),
      { ip: null },
    )
    expect([...fake.table('participationRequest').values()]).toEqual([
      expect.objectContaining({
        name: 'Claire Martin',
        message: 'Bonjour.',
        submissionCount: 2,
        version: 2,
      }),
    ])
    expect(
      [...fake.table('participationRequestCommittee').values()].map((l) => l.committeeId),
    ).toEqual([june, july])
    expect(journal().map((e) => e.metadata)).toEqual([
      expect.objectContaining({ merged: false, committeeIds: [june] }),
      expect.objectContaining({ merged: true, committeeIds: [july], version: 2 }),
    ])
  })

  it('sets aside what a robot fills, with the same answer, and records nothing', async () => {
    await expect(
      service.submit('cci-touraine', input({ website: 'https://spam.example' }), { ip: null }),
    ).resolves.toBeUndefined()
    expect(fake.table('participationRequest').size).toBe(0)
    expect(journal()).toEqual([
      {
        actionType: 'participation_request_discarded',
        actorId: null,
        metadata: { workspaceId: cci, reason: 'honeypot' },
      },
    ])
  })

  it('refuses a form sent too soon, too late, without its token or for another workspace', async () => {
    const now = Date.now()
    for (const [formToken, reason] of [
      [tokens.issue(cci, now), 'form_too_fast'],
      [tokens.issue(cci, now - PARTICIPATION_FORM_TIMING.maxAgeMs - 1000), 'form_expired'],
      ['', 'form_expired'],
      [tokens.issue('another', now - 5000), 'form_expired'],
    ] as const) {
      expect(
        await failure(service.submit('cci-touraine', input({ formToken }), { ip: null })),
      ).toEqual({
        status: 400,
        code: 'PARTICIPATION_FORM_REFUSED',
        details: { reason },
      })
    }
    expect(fake.table('participationRequest').size).toBe(0)
  })

  it('answers alike for an unknown workspace and one that offers no session; refuses a session not offered', async () => {
    const notFound = { status: 404, code: 'PARTICIPATION_FORM_NOT_FOUND', details: undefined }
    expect(await failure(service.form('inconnu'))).toEqual(notFound)
    expect(await failure(service.form('club-deal'))).toEqual(notFound)
    expect(await failure(service.form('Pas un slug'))).toEqual(notFound)
    expect(await failure(service.submit('club-deal', input(), { ip: null }))).toEqual(notFound)

    // Closed, cancelled, past, another workspace's, unknown: one answer, nothing recorded.
    const closed = (
      await committees.create(MANAGER, cci, { ...JUNE, participationRequestsOpen: false })
    ).id
    const cancelled = (await committees.create(MANAGER, cci, JUNE)).id
    await committees.changeStatus(MANAGER, cci, cancelled, { status: 'cancelled', version: 1 })
    const past = (await committees.create(MANAGER, cci, { ...JUNE, date: '2020-01-15' })).id
    const club = [...fake.table('workspace').values()].find((w) => w.slug === 'club-deal')!.id
    const theirs = (await committees.create(OUTSIDER, club, JUNE)).id
    for (const id of [closed, cancelled, past, theirs, '6f1c2a8e-0000-4000-8000-00000000dead']) {
      expect(
        await failure(
          service.submit('cci-touraine', input({ committeeIds: [june, id] }), { ip: null }),
        ),
      ).toEqual({
        status: 409,
        code: 'PARTICIPATION_COMMITTEES_CLOSED',
        details: { committeeIds: [id] },
      })
    }
    expect(fake.table('participationRequest').size).toBe(0)
    // Refused submissions do not count against the address: it is still recorded.
    await service.submit('cci-touraine', input(), { ip: null })
    expect(fake.table('participationRequest').size).toBe(1)
    const form = await service.form('cci-touraine')
    expect(form.committees.map((c) => c.id)).toEqual([june])
    expect(form.workspace).toEqual({ name: 'CCI Touraine', programName: null })
    expect(JSON.stringify(form)).not.toMatch(/PRIVE|NOTE-INTERNE|INFO-DIFFUSEE/)
  })

  it('limits each address and each network address per hour; an address over its limit is set aside alike', async () => {
    for (let i = 0; i < PARTICIPATION_RATE_LIMITS.perHourPerAddress; i++) {
      await service.submit('cci-touraine', input(), { ip: `198.51.100.${i}` })
    }
    await expect(
      service.submit('cci-touraine', input(), { ip: '198.51.100.250' }),
    ).resolves.toBeUndefined()
    expect([...fake.table('participationRequest').values()][0].submissionCount).toBe(
      PARTICIPATION_RATE_LIMITS.perHourPerAddress,
    )
    expect(journal().at(-1)).toMatchObject({
      actionType: 'participation_request_discarded',
      metadata: { reason: 'address_rate' },
    })

    for (let i = 0; i < PARTICIPATION_RATE_LIMITS.perHourPerNetwork; i++) {
      await service.submit('cci-touraine', input({ email: `p${i}@angels.fr` }), { ip: '192.0.2.7' })
    }
    expect(
      await failure(
        service.submit('cci-touraine', input({ email: 'last@angels.fr' }), { ip: '192.0.2.7' }),
      ),
    ).toMatchObject({ status: 429, code: 'PARTICIPATION_RATE_LIMIT' })
  })

  // Code review R66: a full queue answers alike whoever the address is — new, already pending, or
  // over its quota.
  it('turns every address away alike once the workspace’s queue is full', async () => {
    for (let i = 0; i < PARTICIPATION_REQUEST_LIMITS.pendingPerWorkspace; i++) {
      await fake.prisma.participationRequest.create({
        data: { workspaceId: cci, email: `p${i}@x.fr`, name: 'P', lastSubmittedAt: new Date() },
      })
    }
    expect(await failure(service.submit('cci-touraine', input(), { ip: null }))).toMatchObject({
      status: 503,
      code: 'PARTICIPATION_QUEUE_FULL',
    })
    // A pending address gets the same refusal: nothing tells it is in the queue.
    expect(
      await failure(service.submit('cci-touraine', input({ email: 'p0@x.fr' }), { ip: null })),
    ).toMatchObject({ status: 503, code: 'PARTICIPATION_QUEUE_FULL' })
    const pending0 = [...fake.table('participationRequest').values()].find(
      (r) => r.email === 'p0@x.fr',
    )!
    expect(pending0.submissionCount ?? 1).toBe(1)
  })

  it('lists the pending requests to the workspace’s managers only', async () => {
    await service.submit('cci-touraine', input(), { ip: null })
    const listed = await service.listForManagers(MANAGER, cci)
    expect(listed).toEqual([
      {
        id: expect.any(String),
        status: 'pending',
        name: 'Claire Martin',
        organization: 'Angels Touraine',
        email: 'claire@angels.fr',
        message: 'Bonjour.',
        committees: [
          {
            id: june,
            name: 'Comité de juin',
            date: '2099-06-10',
            time: '14:00',
            timeZone: 'Europe/Paris',
            startsAt: '2099-06-10T12:00:00.000Z',
            status: 'planned',
          },
        ],
        submissionCount: 1,
        lastSubmittedAt: expect.any(Date),
        createdAt: expect.any(Date),
        // E08.05: undecided.
        version: 1,
        decidedAt: null,
        decidedBy: null,
        admission: null,
        invitationEmail: null,
        invitationEmailAt: null,
      },
    ])
    expect(await service.listForManagers(ADMIN, cci)).toHaveLength(1)
    expect(await failure(service.listForManagers(ADVISOR, cci))).toMatchObject({ status: 403 })
    expect(await failure(service.listForManagers(OUTSIDER, cci))).toMatchObject({ status: 404 })
  })
})
