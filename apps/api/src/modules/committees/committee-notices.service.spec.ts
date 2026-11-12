import type { ConfigService } from '@nestjs/config'
import type { Committee, Prisma } from '@prisma/client'
import type { AppConfig } from '../../config/config.schema'
import type { PrismaService } from '../../prisma/prisma.service'
import { createFakePrisma } from '../../testing/fake-prisma'
import type { EmailTransport, SendCommitteeChangedInput } from '../auth/email/email-transport'
import { CommitteeNoticesService } from './committee-notices.service'

const WS = 'ws-cci'
const config = {
  get: (key: string) => (key === 'FRONTEND_URL' ? 'https://confluent.example' : undefined),
} as unknown as ConfigService<AppConfig, true>

// ROADMAP E08.06: who a change tells, what the email holds, and that a notice leaves once — never
// twice, never once superseded, a failure recorded without undoing anything.
describe('CommitteeNoticesService', () => {
  let fake: ReturnType<typeof createFakePrisma>
  let sent: SendCommitteeChangedInput[]
  let failFor: Set<string>
  let service: CommitteeNoticesService
  let committee: Committee
  const tx = () => fake.prisma as unknown as Prisma.TransactionClient

  beforeEach(async () => {
    fake = createFakePrisma()
    sent = []
    failFor = new Set()
    const transport = {
      sendCommitteeChanged: jest.fn((input: SendCommitteeChangedInput) => {
        if (failFor.has(input.to)) return Promise.reject(new Error('SMTP down'))
        sent.push(input)
        return Promise.resolve()
      }),
    } as unknown as EmailTransport
    service = new CommitteeNoticesService(
      fake.prisma as unknown as PrismaService,
      config,
      transport,
    )
    for (const [id, email] of [
      ['sophie', 'sophie@startup.fr'],
      ['karim', 'karim@startup.fr'],
      ['lea', 'lea@startup.fr'],
      ['nina', 'nina@startup.fr'],
      ['claire', 'claire@angels.fr'],
      ['bruno', 'bruno@fonds.fr'],
      ['eve', 'eve@fonds.fr'],
    ]) {
      await fake.prisma.user.create({ data: { id, email, role: 'financeur' } })
    }
    await fake.prisma.workspace.create({ data: { id: WS, name: 'CCI Touraine', slug: 'cci' } })
    committee = (await fake.prisma.committee.create({
      data: {
        id: 'june',
        workspaceId: WS,
        name: 'Comité de juin',
        localStart: new Date('2099-06-11T09:30:00.000Z'),
        timeZone: 'Europe/Paris',
        startsAt: new Date('2099-06-11T07:30:00.000Z'),
        location: 'LIEU-PRIVE salle 2',
        meetingUrl: 'https://visio.example.org/LIEN-PRIVE',
        internalNotes: 'NOTE-INTERNE',
        sharedInfo: 'INFO-DIFFUSEE',
        version: 2,
      },
    })) as Committee
    // Entries: sophie's two requests (one email), karim proposed, lea refused, nina withdrawn.
    const entry = async (owner: string, status: string, n: number) => {
      await fake.prisma.dossier.create({
        data: {
          id: `d-${owner}-${n}`,
          userId: owner,
          companyId: `co-${owner}`,
          name: `Demande ${n}`,
        },
      })
      await fake.prisma.candidature.create({
        data: { id: `c-${owner}-${n}`, dossierId: `d-${owner}-${n}`, workspaceId: WS },
      })
      await fake.prisma.committeeApplication.create({
        data: {
          id: `a-${owner}-${n}`,
          committeeId: 'june',
          candidatureId: `c-${owner}-${n}`,
          workspaceId: WS,
          status,
        },
      })
    }
    await entry('sophie', 'accepted', 1)
    await entry('sophie', 'applied', 2)
    await entry('karim', 'proposed', 1)
    await entry('lea', 'refused', 1)
    await entry('nina', 'withdrawn', 1)
    // Participants: claire accepted (active), bruno accepted but deactivated, eve pending; sophie
    // also accepted as a participant (one email).
    const request = async (id: string, status: string, member: string | null) => {
      await fake.prisma.participationRequest.create({
        data: { id, workspaceId: WS, email: `${id}@x.fr`, name: id, status, memberUserId: member },
      })
      await fake.prisma.participationRequestCommittee.create({
        data: { requestId: id, committeeId: 'june', workspaceId: WS },
      })
    }
    await request('r-claire', 'accepted', 'claire')
    await request('r-bruno', 'accepted', 'bruno')
    await request('r-eve', 'pending', null)
    await request('r-sophie', 'accepted', 'sophie')
    for (const [userId, deactivatedAt] of [
      ['claire', null],
      ['bruno', new Date()],
      ['sophie', null],
    ] as const) {
      await fake.prisma.workspaceMembership.create({
        data: { workspaceId: WS, userId, role: 'investisseur', deactivatedAt },
      })
    }
  })

  const notices = () => [...fake.table('committeeNotice').values()]
  const before = {
    localStart: new Date('2099-06-10T14:00:00.000Z'),
    startsAt: new Date('2099-06-10T12:00:00.000Z'),
  }
  const record = (kind: 'rescheduled' | 'cancelled' | 'restored', version = committee.version) =>
    service.recordIn(tx(), {
      workspace: { id: WS, name: 'CCI Touraine' },
      before: { ...committee, ...before },
      after: { ...committee, version },
      kind,
    })

  it('tells each concerned account once: owners of applied, proposed or accepted entries, and active participants', async () => {
    const batch = (await record('rescheduled'))!
    expect(
      notices()
        .map((n) => [n.recipientId, n.applicationId, n.participationRequestId, n.state])
        .sort(),
    ).toEqual([
      ['claire', null, 'r-claire', 'to_send'],
      ['karim', 'a-karim-1', null, 'to_send'],
      ['sophie', 'a-sophie-1', 'r-sophie', 'to_send'],
    ])
    await service.deliver(batch)
    expect(sent.map((s) => [s.to, s.audience]).sort()).toEqual([
      ['claire@angels.fr', 'participant'],
      ['karim@startup.fr', 'entrepreneur'],
      ['sophie@startup.fr', 'entrepreneur'],
    ])
    expect(notices().every((n) => n.state === 'sent')).toBe(true)
  })

  it('says the new and the previous date in the committee’s zone, never the place, link, texts or other people', async () => {
    await service.deliver((await record('rescheduled'))!)
    expect(sent[0]).toMatchObject({
      kind: 'rescheduled',
      workspaceName: 'CCI Touraine',
      committee: {
        name: 'Comité de juin',
        date: '2099-06-11',
        time: '09:30',
        timeZone: 'Europe/Paris',
      },
      previous: { date: '2099-06-10', time: '14:00', timeZone: 'Europe/Paris' },
      signInUrl: 'https://confluent.example/auth',
    })
    const json = JSON.stringify(sent)
    for (const secret of [
      'PRIVE',
      'NOTE-INTERNE',
      'INFO-DIFFUSEE',
      'Demande 1',
      'r-claire',
      'eve',
    ]) {
      expect([secret, json.includes(secret)]).toEqual([secret, false])
    }
    // A cancellation has no previous date.
    sent = []
    await service.deliver((await record('cancelled', 3))!)
    expect(sent.every((s) => s.kind === 'cancelled' && s.previous === null)).toBe(true)
  })

  it('never sends a notice twice, even delivered again or by two senders at once', async () => {
    const batch = (await record('cancelled'))!
    await Promise.all([service.deliver(batch), service.deliver(batch)])
    await service.deliver(batch)
    expect(sent).toHaveLength(3)
  })

  it('supersedes the unsent notices of an earlier change for the same people; the later one leaves', async () => {
    const first = (await record('rescheduled', 2))!
    const second = (await record('cancelled', 3))!
    await service.deliver(first)
    await service.deliver(second)
    expect(sent.map((s) => s.kind)).toEqual(['cancelled', 'cancelled', 'cancelled'])
    expect(
      notices()
        .map((n) => [n.committeeVersion, n.state])
        .sort(),
    ).toEqual([
      [2, 'superseded'],
      [2, 'superseded'],
      [2, 'superseded'],
      [3, 'sent'],
      [3, 'sent'],
      [3, 'sent'],
    ])
    // Already sent: a later change does not touch it.
    await record('restored', 4)
    expect(
      notices()
        .filter((n) => n.committeeVersion === 3)
        .every((n) => n.state === 'sent'),
    ).toBe(true)
  })

  it('records a failed email without stopping the others', async () => {
    failFor.add('karim@startup.fr')
    await service.deliver((await record('cancelled'))!)
    expect(
      notices()
        .map((n) => [n.recipientId, n.state])
        .sort(),
    ).toEqual([
      ['claire', 'sent'],
      ['karim', 'failed'],
      ['sophie', 'sent'],
    ])
  })

  it('records nothing when nobody is concerned', async () => {
    fake.table('committeeApplication').clear()
    fake.table('participationRequest').clear()
    expect(await record('cancelled')).toBeNull()
    expect(notices()).toHaveLength(0)
  })

  it('lists the notices for the managers by request, never by address', async () => {
    await fake.prisma.company.create({ data: { id: 'co-sophie', name: 'Start' } })
    await fake.prisma.company.create({ data: { id: 'co-karim', name: 'Kar' } })
    await service.deliver((await record('cancelled'))!)
    const listed = await service.listForCommittee(WS, 'june')
    expect(listed.map((n) => [n.audience, n.label, n.kind, n.state]).sort()).toEqual([
      ['entrepreneur', 'Kar — Demande 1', 'cancelled', 'sent'],
      ['entrepreneur', 'Start — Demande 1', 'cancelled', 'sent'],
      ['participant', 'r-claire', 'cancelled', 'sent'],
    ])
    expect(JSON.stringify(listed)).not.toMatch(/@/)
    expect(await service.listForCommittee('other-ws', 'june')).toEqual([])
  })
})
