import { HttpException } from '@nestjs/common'
import type { ConfigService } from '@nestjs/config'
import { PARTICIPATION_REQUEST_LIMITS } from '@confluent/shared'
import { ThrottlerStorageService } from '@nestjs/throttler'
import type { AppConfig } from '../../config/config.schema'
import type { PrismaService } from '../../prisma/prisma.service'
import { createFakePrisma } from '../../testing/fake-prisma'
import { AuditService } from '../audit/audit.service'
import type { EmailTransport } from '../auth/email/email-transport'
import { CommitteesService, type CommitteeInput } from '../committees/committees.service'
import { MemoryStorageAdapter } from '../documents/storage/memory-storage.adapter'
import { WorkspaceAccessService } from '../workspaces/workspace-access'
import { WorkspaceMembersService } from '../workspaces/workspace-members.service'
import { WorkspacesService } from '../workspaces/workspaces.service'
import { ParticipationDecisionsService } from './participation-decisions.service'
import { ParticipationFormTokens } from './participation-form-token'
import { ParticipationRequestsService } from './participation-requests.service'

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

const config = {
  get: (key: string) => (key === 'FRONTEND_URL' ? 'https://confluent.example' : 'k'.repeat(32)),
} as unknown as ConfigService<AppConfig, true>

// ROADMAP E08.05: the managers' decisions on participation requests, as the service applies them.
describe('ParticipationDecisionsService', () => {
  let fake: ReturnType<typeof createFakePrisma>
  let requests: ParticipationRequestsService
  let decisions: ParticipationDecisionsService
  let tokens: ParticipationFormTokens
  let storage: ThrottlerStorageService
  let email: { sendParticipationAccepted: jest.Mock }
  let cci: string
  let club: string
  let june: string
  let july: string
  let ip = 0

  beforeEach(async () => {
    fake = createFakePrisma()
    const prisma = fake.prisma as unknown as PrismaService
    const audit = new AuditService(prisma)
    const access = new WorkspaceAccessService(prisma)
    tokens = new ParticipationFormTokens(config)
    storage = new ThrottlerStorageService()
    email = { sendParticipationAccepted: jest.fn().mockResolvedValue(undefined) }
    const transport = email as unknown as EmailTransport
    requests = new ParticipationRequestsService(prisma, access, audit, tokens, storage)
    const members = new WorkspaceMembersService(prisma, audit, access, config, transport)
    decisions = new ParticipationDecisionsService(
      prisma,
      access,
      audit,
      members,
      requests,
      config,
      transport,
    )
    const committees = new CommitteesService(prisma, access, audit)
    const workspaces = new WorkspacesService(prisma, audit, new MemoryStorageAdapter(), access)
    cci = (await workspaces.create(ADMIN, { name: 'CCI Touraine', slug: 'cci-touraine' })).id
    club = (await workspaces.create(ADMIN, { name: 'Club deal', slug: 'club-deal' })).id
    for (const [id, email] of [
      [MANAGER.id, 'marie@cci.fr'],
      [ADVISOR.id, 'luc@cci.fr'],
      [OUTSIDER.id, 'paul@club.fr'],
      [ADMIN.id, 'admin@confluent.dev'],
    ]) {
      await fake.prisma.user.create({
        data: {
          id,
          email,
          role: id === ADMIN.id ? 'admin' : 'financeur',
          emailVerifiedAt: new Date(),
        },
      })
    }
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
    july = (
      await committees.create(MANAGER, cci, {
        ...JUNE,
        name: 'Comité de juillet',
        date: '2099-07-10',
      })
    ).id
    fake.table('auditLog').clear()
  })

  afterEach(() => storage.onApplicationShutdown())

  // A request sent from the public form; returns it as the managers read it.
  async function asked(patch: { email?: string; organization?: string | null } = {}) {
    await requests.submit(
      'cci-touraine',
      {
        name: 'Claire Martin',
        organization: patch.organization === undefined ? 'Angels Touraine' : patch.organization,
        email: patch.email ?? 'claire@angels.fr',
        message: 'MESSAGE-PRIVE Bonjour.',
        committeeIds: [june, july],
        formToken: tokens.issue(cci, Date.now() - 5000),
      },
      { ip: `198.51.100.${++ip}` },
    )
    const [request] = (await requests.listForManagers(MANAGER, cci)).filter(
      (r) => r.email === (patch.email ?? 'claire@angels.fr'),
    )
    return request
  }
  const membershipOf = (userId: string, workspaceId = cci) =>
    [...fake.table('workspaceMembership').values()].find(
      (m) => m.userId === userId && m.workspaceId === workspaceId,
    )
  const userOf = (address: string) =>
    [...fake.table('user').values()].find((u) => u.email === address)

  it('accepts: creates the unknown address’s account (unverified) as an investisseur of the workspace, then tells it by email', async () => {
    const request = await asked()
    expect(userOf('claire@angels.fr')).toBeUndefined()
    const result = await decisions.decide(MANAGER, cci, request.id, {
      decision: 'accepted',
      version: request.version,
    })
    const account = userOf('claire@angels.fr')!
    expect(account).toMatchObject({ role: 'financeur', emailVerifiedAt: null, isActive: true })
    expect(membershipOf(account.id)).toMatchObject({
      role: 'investisseur',
      organization: 'Angels Touraine',
      investorType: null,
      canManageWorkspace: false,
      invitedById: MANAGER.id,
      deactivatedAt: null,
    })
    expect(result.invitationEmailSent).toBe(true)
    expect(result.request).toMatchObject({
      status: 'accepted',
      version: request.version + 1,
      decidedAt: expect.any(Date),
      decidedBy: { id: MANAGER.id, email: 'marie@cci.fr' },
      admission: 'account_created',
      invitationEmail: 'sent',
      invitationEmailAt: expect.any(Date),
    })
    expect(fake.table('participationRequest').get(request.id)).toMatchObject({
      memberUserId: account.id,
      decidedById: MANAGER.id,
    })
    // The email: the sessions by name and when, never their place, link or information.
    expect(email.sendParticipationAccepted).toHaveBeenCalledTimes(1)
    const sent = email.sendParticipationAccepted.mock.calls[0][0]
    expect(sent).toEqual({
      to: 'claire@angels.fr',
      workspaceName: 'CCI Touraine',
      sessions: [
        {
          name: 'Comité de juin',
          date: '2099-06-10',
          time: '14:00',
          timeZone: 'Europe/Paris',
          status: 'planned',
        },
        {
          name: 'Comité de juillet',
          date: '2099-07-10',
          time: '14:00',
          timeZone: 'Europe/Paris',
          status: 'planned',
        },
      ],
      admission: 'account_created',
      signInUrl: 'https://confluent.example/auth',
      locale: 'fr',
    })
    expect(JSON.stringify(sent)).not.toMatch(/PRIVE|NOTE-INTERNE|INFO-DIFFUSEE/)
    // Journaled without the name, address or message.
    const journal = [...fake.table('auditLog').values()].filter(
      (e) => e.actionType === 'participation_request_decided',
    )
    expect(journal.map((e) => [e.actorId, e.metadata])).toEqual([
      [
        MANAGER.id,
        {
          workspaceId: cci,
          requestId: request.id,
          version: request.version + 1,
          decision: 'accepted',
          admission: 'account_created',
          memberUserId: account.id,
          committeeIds: [june, july],
        },
      ],
    ])
    expect(JSON.stringify(journal)).not.toMatch(/Claire|angels|MESSAGE-PRIVE/i)
  })

  it('accepts an existing account by adding it to the workspace, its global role unchanged', async () => {
    await fake.prisma.user.create({
      data: { id: 'eve', email: 'eve@fonds.fr', role: 'entrepreneur', emailVerifiedAt: new Date() },
    })
    const request = await asked({ email: 'eve@fonds.fr', organization: null })
    const result = await decisions.decide(MANAGER, cci, request.id, {
      decision: 'accepted',
      version: request.version,
    })
    expect(result.request.admission).toBe('membership_created')
    expect(userOf('eve@fonds.fr')).toMatchObject({ role: 'entrepreneur' })
    expect(membershipOf('eve')).toMatchObject({ role: 'investisseur', organization: null })
    expect(email.sendParticipationAccepted.mock.calls[0][0].admission).toBe('membership_created')
  })

  it('keeps an active membership as it is — never narrowed nor widened — and refuses to reactivate a deactivated one', async () => {
    // The workspace's managing conseillère asks with her own address.
    const own = await asked({ email: 'marie@cci.fr' })
    const kept = await decisions.decide(MANAGER, cci, own.id, {
      decision: 'accepted',
      version: own.version,
    })
    expect(kept.request.admission).toBe('already_member')
    expect(membershipOf(MANAGER.id)).toMatchObject({
      role: 'conseiller',
      canManageWorkspace: true,
      organization: null,
    })
    expect(fake.table('workspaceMembership').size).toBe(3)

    // A deactivated member: refused, nothing changed.
    await fake.prisma.user.create({
      data: { id: 'ivy', email: 'ivy@x.fr', role: 'financeur', emailVerifiedAt: new Date() },
    })
    await fake.prisma.workspaceMembership.create({
      data: {
        workspaceId: cci,
        userId: 'ivy',
        role: 'investisseur',
        deactivatedAt: new Date(),
      },
    })
    const gone = await asked({ email: 'ivy@x.fr' })
    expect(
      await failure(
        decisions.decide(MANAGER, cci, gone.id, { decision: 'accepted', version: gone.version }),
      ),
    ).toMatchObject({ status: 409, code: 'PARTICIPATION_MEMBER_DEACTIVATED' })
    expect(membershipOf('ivy')?.deactivatedAt).not.toBeNull()
    expect(fake.table('participationRequest').get(gone.id)).toMatchObject({
      status: 'pending',
      version: gone.version,
    })
    // Refusing it remains possible.
    await decisions.decide(MANAGER, cci, gone.id, { decision: 'refused', version: gone.version })
  })

  it('refuses: nothing created, nothing sent, the decision recorded', async () => {
    const users = fake.table('user').size
    const memberships = fake.table('workspaceMembership').size
    const request = await asked()
    const result = await decisions.decide(MANAGER, cci, request.id, {
      decision: 'refused',
      version: request.version,
    })
    expect(result).toEqual({
      invitationEmailSent: null,
      request: expect.objectContaining({
        status: 'refused',
        decidedBy: expect.objectContaining({ id: MANAGER.id }),
        admission: null,
        invitationEmail: null,
        invitationEmailAt: null,
      }),
    })
    expect(fake.table('user').size).toBe(users)
    expect(fake.table('workspaceMembership').size).toBe(memberships)
    expect(email.sendParticipationAccepted).not.toHaveBeenCalled()
    // The address may ask again: a new pending request.
    const again = await asked()
    expect(again.id).not.toBe(request.id)
    expect(again.status).toBe('pending')
  })

  it('is final and idempotent: the same decision again changes and sends nothing; another one, or a stale version, is refused', async () => {
    const request = await asked()
    await decisions.decide(MANAGER, cci, request.id, { decision: 'accepted', version: 1 })
    const again = await decisions.decide(MANAGER, cci, request.id, {
      decision: 'accepted',
      version: 1,
    })
    expect(again.invitationEmailSent).toBeNull()
    expect(again.request.version).toBe(2)
    expect(email.sendParticipationAccepted).toHaveBeenCalledTimes(1)
    expect(
      [...fake.table('auditLog').values()].filter(
        (e) => e.actionType === 'participation_request_decided',
      ),
    ).toHaveLength(1)
    expect(
      await failure(
        decisions.decide(MANAGER, cci, request.id, { decision: 'refused', version: 2 }),
      ),
    ).toEqual({
      status: 409,
      code: 'PARTICIPATION_REQUEST_DECIDED',
      details: { status: 'accepted' },
    })

    // A new submission since the manager read the request: its version moved on.
    const other = await asked({ email: 'bob@x.fr' })
    await asked({ email: 'bob@x.fr' })
    expect(
      await failure(
        decisions.decide(MANAGER, cci, other.id, { decision: 'accepted', version: other.version }),
      ),
    ).toMatchObject({ status: 409, code: 'PARTICIPATION_REQUEST_CHANGED' })
    expect(userOf('bob@x.fr')).toBeUndefined()
  })

  it('keeps the decision when the email cannot leave, and says so', async () => {
    email.sendParticipationAccepted.mockRejectedValueOnce(new Error('SMTP down'))
    const request = await asked()
    const result = await decisions.decide(MANAGER, cci, request.id, {
      decision: 'accepted',
      version: 1,
    })
    expect(result.invitationEmailSent).toBe(false)
    expect(result.request).toMatchObject({ status: 'accepted', invitationEmail: 'failed' })
    expect(membershipOf(userOf('claire@angels.fr')!.id)).toBeDefined()
  })

  it('lets the workspace’s managers and administrators decide, nobody else, and only their own workspace’s requests', async () => {
    const request = await asked()
    for (const [actor, status] of [
      [ADVISOR, 403],
      [OUTSIDER, 404],
      [{ id: 'nobody', role: 'financeur' }, 404],
    ] as const) {
      expect(
        await failure(
          decisions.decide(actor, cci, request.id, { decision: 'accepted', version: 1 }),
        ),
      ).toMatchObject({ status })
    }
    // Another workspace's manager, through their own workspace: not found.
    expect(
      await failure(
        decisions.decide(OUTSIDER, club, request.id, { decision: 'refused', version: 1 }),
      ),
    ).toMatchObject({ status: 404, code: 'PARTICIPATION_REQUEST_NOT_FOUND' })
    expect(fake.table('participationRequest').get(request.id)?.status).toBe('pending')
    expect(userOf('claire@angels.fr')).toBeUndefined()

    const decided = await decisions.decide(ADMIN, cci, request.id, {
      decision: 'refused',
      version: 1,
    })
    expect(decided.request.decidedBy?.id).toBe(ADMIN.id)
  })

  it('frees a slot of the full queue with each decision', async () => {
    const request = await asked()
    for (let i = 1; i < PARTICIPATION_REQUEST_LIMITS.pendingPerWorkspace; i++) {
      await fake.prisma.participationRequest.create({
        data: { workspaceId: cci, email: `p${i}@x.fr`, name: 'P', lastSubmittedAt: new Date() },
      })
    }
    expect(await failure(asked({ email: 'late@x.fr' }))).toMatchObject({ status: 503 })
    await decisions.decide(MANAGER, cci, request.id, { decision: 'refused', version: 1 })
    expect((await asked({ email: 'late@x.fr' })).status).toBe('pending')
  })

  it('lists the decided requests apart, latest first, and filters by committee', async () => {
    const first = await asked({ email: 'a@x.fr' })
    const second = await asked({ email: 'b@x.fr' })
    await asked({ email: 'c@x.fr' })
    await decisions.decide(MANAGER, cci, first.id, { decision: 'refused', version: 1 })
    await new Promise((resolve) => setTimeout(resolve, 5))
    await decisions.decide(MANAGER, cci, second.id, { decision: 'accepted', version: 1 })
    expect((await requests.listForManagers(MANAGER, cci)).map((r) => r.email)).toEqual(['c@x.fr'])
    expect(
      (await requests.listForManagers(MANAGER, cci, { status: 'decided' })).map((r) => [
        r.email,
        r.status,
      ]),
    ).toEqual([
      ['b@x.fr', 'accepted'],
      ['a@x.fr', 'refused'],
    ])
    expect(
      await requests.listForManagers(MANAGER, cci, {
        status: 'decided',
        committeeId: '6f1c2a8e-0000-4000-8000-0000000000aa',
      }),
    ).toEqual([])
    expect(
      await requests.listForManagers(MANAGER, cci, { status: 'pending', committeeId: july }),
    ).toHaveLength(1)
    expect(
      await failure(requests.listForManagers(ADVISOR, cci, { status: 'decided' })),
    ).toMatchObject({
      status: 403,
    })
  })
})
