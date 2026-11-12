import { HttpException } from '@nestjs/common'
import { COMMITTEE_LIMITS } from '@confluent/shared'
import type { PrismaService } from '../../prisma/prisma.service'
import { createFakePrisma } from '../../testing/fake-prisma'
import { AuditService } from '../audit/audit.service'
import { MemoryStorageAdapter } from '../documents/storage/memory-storage.adapter'
import { WorkspaceAccessService } from '../workspaces/workspace-access'
import { WorkspacesService } from '../workspaces/workspaces.service'
import type { ConfigService } from '@nestjs/config'
import type { AppConfig } from '../../config/config.schema'
import type { EmailTransport } from '../auth/email/email-transport'
import { CommitteeNoticesService } from './committee-notices.service'
import { CommitteesService, type CommitteeInput } from './committees.service'

const ADMIN = { id: 'admin-1', role: 'admin' }
const MANAGER = { id: 'marie', role: 'financeur' }
const ADVISOR = { id: 'luc', role: 'financeur' }
const INVESTOR = { id: 'claire', role: 'financeur' }
const OUTSIDER = { id: 'paul', role: 'financeur' }
const ENTREPRENEUR = { id: 'sophie', role: 'entrepreneur' }

const JUNE: CommitteeInput = {
  name: 'Comité de juin',
  date: '2099-06-10',
  time: '14:00',
  timeZone: 'Europe/Paris',
  location: 'CCI Touraine, salle 2',
  meetingUrl: 'https://visio.example.org/j/123',
  internalNotes: 'Ordre du jour à envoyer.',
  sharedInfo: 'Accueil à 13 h 45, 10 minutes de pitch.',
}
const PAST: CommitteeInput = { ...JUNE, name: 'Comité de janvier', date: '2020-01-15' }

const failure = async (promise: Promise<unknown>) => {
  try {
    await promise
  } catch (err) {
    if (err instanceof HttpException) {
      return { status: err.getStatus(), code: (err.getResponse() as { code: string }).code }
    }
    throw err
  }
  throw new Error('expected a refusal')
}

// ROADMAP E08.01: who reads and who organises a workspace's committees, from which version, and what
// is journaled.
describe('CommitteesService', () => {
  let fake: ReturnType<typeof createFakePrisma>
  let service: CommitteesService
  let cci: string
  let club: string

  beforeEach(async () => {
    fake = createFakePrisma()
    const prisma = fake.prisma as unknown as PrismaService
    const audit = new AuditService(prisma)
    const access = new WorkspaceAccessService(prisma)
    const config = {
      get: () => 'https://confluent.example',
    } as unknown as ConfigService<AppConfig, true>
    const transport = { sendCommitteeChanged: jest.fn() } as unknown as EmailTransport
    service = new CommitteesService(
      prisma,
      access,
      audit,
      new CommitteeNoticesService(prisma, config, transport),
    )
    const workspaces = new WorkspacesService(prisma, audit, new MemoryStorageAdapter(), access)
    cci = (await workspaces.create(ADMIN, { name: 'CCI Touraine' })).id
    club = (await workspaces.create(ADMIN, { name: 'Club deal' })).id
    const member = (workspaceId: string, userId: string, fields: Record<string, unknown>) =>
      fake.prisma.workspaceMembership.create({
        data: { workspaceId, userId, role: 'conseiller', canManageWorkspace: false, ...fields },
      })
    await member(cci, MANAGER.id, { canManageWorkspace: true })
    await member(cci, ADVISOR.id, {})
    await member(cci, INVESTOR.id, { role: 'investisseur', investorType: 'business_angel' })
    await member(club, OUTSIDER.id, { canManageWorkspace: true })
    fake.table('auditLog').clear()
  })

  const journal = () =>
    [...fake.table('auditLog').values()].map((row) => ({
      actionType: row.actionType,
      actorId: row.actorId,
      metadata: row.metadata,
    }))

  describe('creating', () => {
    it('plans a committee at the instant its wall-clock time designates in its zone, journaled', async () => {
      const created = await service.create(MANAGER, cci, JUNE)
      expect(created).toEqual({
        id: expect.any(String),
        workspaceId: cci,
        name: 'Comité de juin',
        date: '2099-06-10',
        time: '14:00',
        timeZone: 'Europe/Paris',
        startsAt: new Date('2099-06-10T12:00:00.000Z'),
        location: 'CCI Touraine, salle 2',
        meetingUrl: 'https://visio.example.org/j/123',
        status: 'planned',
        internalNotes: 'Ordre du jour à envoyer.',
        sharedInfo: 'Accueil à 13 h 45, 10 minutes de pitch.',
        participationRequestsOpen: false,
        version: 1,
        createdAt: expect.any(Date),
        updatedAt: expect.any(Date),
      })
      // Stored as typed: a wall clock without zone, and the zone.
      expect(fake.table('committee').get(created.id)).toMatchObject({
        localStart: new Date('2099-06-10T14:00:00.000Z'),
        timeZone: 'Europe/Paris',
        startsAt: new Date('2099-06-10T12:00:00.000Z'),
      })
      expect(journal()).toEqual([
        {
          actionType: 'committee_created',
          actorId: MANAGER.id,
          metadata: {
            workspaceId: cci,
            committeeId: created.id,
            version: 1,
            name: 'Comité de juin',
            schedule: {
              date: '2099-06-10',
              time: '14:00',
              timeZone: 'Europe/Paris',
              startsAt: '2099-06-10T12:00:00.000Z',
            },
          },
        },
      ])
      // An administrator who is not a member organises too; place, link and information optional.
      const bare = await service.create(ADMIN, cci, {
        name: 'Comité',
        date: '2099-01-10',
        time: '09:00',
        timeZone: 'Pacific/Noumea',
      })
      expect(bare).toMatchObject({
        startsAt: new Date('2099-01-09T22:00:00.000Z'),
        location: null,
        meetingUrl: null,
        internalNotes: null,
        sharedInfo: null,
      })
    })

    it('refuses a time the API’s time zone data skips or repeats, whatever the client checked', async () => {
      expect(
        await failure(service.create(MANAGER, cci, { ...JUNE, date: '2027-03-28', time: '02:30' })),
      ).toEqual({ status: 400, code: 'VALIDATION_ERROR' })
      expect(
        await failure(service.create(MANAGER, cci, { ...JUNE, date: '2026-10-25', time: '02:30' })),
      ).toEqual({ status: 400, code: 'VALIDATION_ERROR' })
      expect(fake.table('committee').size).toBe(0)
    })

    it('is reserved to those who manage the workspace, closed to everybody else', async () => {
      for (const [as, status] of [
        [ADVISOR, 403],
        [INVESTOR, 403],
        [OUTSIDER, 404],
        [ENTREPRENEUR, 404],
      ] as const) {
        expect([as.id, (await failure(service.create(as, cci, JUNE))).status]).toEqual([
          as.id,
          status,
        ])
      }
      // A deactivated manager, a manager deprived of the right: refused at the next request.
      const marie = [...fake.table('workspaceMembership').values()].find(
        (m) => m.userId === MANAGER.id,
      )!
      marie.canManageWorkspace = false
      expect((await failure(service.create(MANAGER, cci, JUNE))).status).toBe(403)
      marie.canManageWorkspace = true
      marie.deactivatedAt = new Date()
      expect((await failure(service.create(MANAGER, cci, JUNE))).status).toBe(404)
      expect(fake.table('committee').size).toBe(0)
      expect(journal()).toEqual([])
      // Checked before anything is read of the request: a member who does not manage learns
      // nothing of what would be wrong with it.
      expect(
        (
          await failure(
            service.create(ADVISOR, cci, { ...JUNE, date: '2027-03-28', time: '02:30' }),
          )
        ).status,
      ).toBe(403)
    })

    it('holds a workspace to its cap of committees', async () => {
      for (let i = 0; i < COMMITTEE_LIMITS.perWorkspace; i++) {
        await fake.prisma.committee.create({
          data: { workspaceId: cci, name: `C${i}`, timeZone: 'UTC', startsAt: new Date() },
        })
      }
      expect(await failure(service.create(MANAGER, cci, JUNE))).toEqual({
        status: 409,
        code: 'COMMITTEE_LIMIT',
      })
      // Another workspace's count is its own.
      await service.create(OUTSIDER, club, JUNE)
    })

    it('reads the right again once the workspace is locked (R53): a manager deactivated meanwhile writes nothing', async () => {
      const committee = await service.create(MANAGER, cci, JUNE)
      const marie = [...fake.table('workspaceMembership').values()].find(
        (m) => m.userId === MANAGER.id,
      )!
      // The deactivation commits while the request waits for the workspace row.
      const deactivatedWhileWaiting = () => {
        fake.prisma.$queryRaw.mockImplementationOnce(() => {
          marie.deactivatedAt = new Date()
          return Promise.resolve([])
        })
      }
      deactivatedWhileWaiting()
      expect((await failure(service.create(MANAGER, cci, JUNE))).status).toBe(404)
      marie.deactivatedAt = null
      deactivatedWhileWaiting()
      expect(
        (
          await failure(
            service.update(MANAGER, cci, committee.id, { ...JUNE, name: 'X', version: 1 }),
          )
        ).status,
      ).toBe(404)
      marie.deactivatedAt = null
      deactivatedWhileWaiting()
      expect(
        (
          await failure(
            service.changeStatus(MANAGER, cci, committee.id, { status: 'cancelled', version: 1 }),
          )
        ).status,
      ).toBe(404)
      expect(fake.table('committee').size).toBe(1)
      expect(fake.table('committee').get(committee.id)).toMatchObject({
        name: 'Comité de juin',
        status: 'planned',
        version: 1,
      })
      expect(journal().map((e) => e.actionType)).toEqual(['committee_created'])
    })
  })

  describe('reading', () => {
    it('shows the workspace’s committees, earliest first, to its conseillers and administrators only', async () => {
      const june = await service.create(MANAGER, cci, JUNE)
      const january = await service.create(MANAGER, cci, PAST)
      await service.create(OUTSIDER, club, { ...JUNE, name: 'Comité du club' })
      for (const as of [MANAGER, ADVISOR, ADMIN]) {
        const list = await service.list(as, cci)
        expect([as.id, list.map((c) => c.name)]).toEqual([
          as.id,
          ['Comité de janvier', 'Comité de juin'],
        ])
        expect((await service.get(as, cci, june.id)).internalNotes).toBe('Ordre du jour à envoyer.')
      }
      // An investor of the workspace reads none of it (its information is internal).
      expect(await failure(service.list(INVESTOR, cci))).toEqual({
        status: 403,
        code: 'COMMITTEES_FORBIDDEN',
      })
      expect((await failure(service.get(INVESTOR, cci, june.id))).status).toBe(403)
      // Outside the workspace: its existence is not told.
      for (const as of [OUTSIDER, ENTREPRENEUR]) {
        expect((await failure(service.list(as, cci))).status).toBe(404)
        expect((await failure(service.get(as, cci, january.id))).status).toBe(404)
      }
      // A committee read through another workspace: not found, as an unknown one.
      expect(await failure(service.get(OUTSIDER, club, june.id))).toEqual({
        status: 404,
        code: 'COMMITTEE_NOT_FOUND',
      })
      expect(
        (await failure(service.get(MANAGER, cci, '00000000-0000-4000-8000-000000000000'))).status,
      ).toBe(404)
    })
  })

  describe('editing', () => {
    it('changes every field from the version read, journals which ones (never the texts), and writes nothing for the same values', async () => {
      const committee = await service.create(MANAGER, cci, JUNE)
      fake.table('auditLog').clear()
      const same = await service.update(MANAGER, cci, committee.id, { ...JUNE, version: 1 })
      expect(same.version).toBe(1)
      expect(journal()).toEqual([])

      const moved = await service.update(ADMIN, cci, committee.id, {
        name: 'Comité de juin (report)',
        date: '2099-12-10',
        time: '14:00',
        timeZone: 'Europe/Paris',
        location: null,
        meetingUrl: 'https://visio.example.org/j/456',
        internalNotes: 'Nouvel ordre du jour.',
        version: 1,
      })
      expect(moved).toMatchObject({
        name: 'Comité de juin (report)',
        date: '2099-12-10',
        // Winter: UTC+1.
        startsAt: new Date('2099-12-10T13:00:00.000Z'),
        location: null,
        meetingUrl: 'https://visio.example.org/j/456',
        internalNotes: 'Nouvel ordre du jour.',
        version: 2,
      })
      expect(journal()).toEqual([
        {
          actionType: 'committee_updated',
          actorId: ADMIN.id,
          metadata: {
            workspaceId: cci,
            committeeId: committee.id,
            version: 2,
            fields: ['name', 'schedule', 'location', 'meetingUrl', 'internalNotes'],
            name: { from: 'Comité de juin', to: 'Comité de juin (report)' },
            schedule: {
              from: {
                date: '2099-06-10',
                time: '14:00',
                timeZone: 'Europe/Paris',
                startsAt: '2099-06-10T12:00:00.000Z',
              },
              to: {
                date: '2099-12-10',
                time: '14:00',
                timeZone: 'Europe/Paris',
                startsAt: '2099-12-10T13:00:00.000Z',
              },
            },
          },
        },
      ])
      expect(JSON.stringify(journal())).not.toContain('ordre du jour')
      expect(JSON.stringify(journal())).not.toContain('j/456')

      // Only the zone changes: the same wall-clock time is another instant.
      const zoned = await service.update(MANAGER, cci, committee.id, {
        ...JUNE,
        name: moved.name,
        date: '2099-12-10',
        timeZone: 'America/Martinique',
        location: null,
        meetingUrl: moved.meetingUrl,
        internalNotes: moved.internalNotes,
        version: 2,
      })
      expect(zoned).toMatchObject({
        time: '14:00',
        timeZone: 'America/Martinique',
        startsAt: new Date('2099-12-10T18:00:00.000Z'),
        version: 3,
      })
    })

    it('refuses a change from a version that is no longer the committee’s, and a change by whoever does not manage', async () => {
      const committee = await service.create(MANAGER, cci, JUNE)
      await service.update(MANAGER, cci, committee.id, { ...JUNE, name: 'A', version: 1 })
      expect(
        await failure(service.update(ADMIN, cci, committee.id, { ...JUNE, name: 'B', version: 1 })),
      ).toEqual({ status: 409, code: 'COMMITTEE_CHANGED' })
      expect(
        await failure(
          service.changeStatus(ADMIN, cci, committee.id, { status: 'cancelled', version: 1 }),
        ),
      ).toEqual({ status: 409, code: 'COMMITTEE_CHANGED' })
      for (const [as, status] of [
        [ADVISOR, 403],
        [INVESTOR, 403],
        [OUTSIDER, 404],
      ] as const) {
        expect(
          (await failure(service.update(as, cci, committee.id, { ...JUNE, version: 2 }))).status,
        ).toBe(status)
        expect(
          (
            await failure(
              service.changeStatus(as, cci, committee.id, { status: 'cancelled', version: 2 }),
            )
          ).status,
        ).toBe(status)
      }
      // The club's manager cannot reach it through the club either.
      expect(
        await failure(service.update(OUTSIDER, club, committee.id, { ...JUNE, version: 2 })),
      ).toEqual({ status: 404, code: 'COMMITTEE_NOT_FOUND' })
      expect(fake.table('committee').get(committee.id)).toMatchObject({ name: 'A', version: 2 })
    })
  })

  describe('shared information (E08.02)', () => {
    it('edits the shared information apart from the internal notes: kept when absent, removed by null, named in the journal, never copied', async () => {
      const committee = await service.create(MANAGER, cci, JUNE)
      fake.table('auditLog').clear()

      // A client that predates it (no `sharedInfo`) keeps it as it is.
      const renamed = await service.update(MANAGER, cci, committee.id, {
        name: 'Comité de juin (salle 3)',
        date: JUNE.date,
        time: JUNE.time,
        timeZone: JUNE.timeZone,
        location: JUNE.location,
        meetingUrl: JUNE.meetingUrl,
        internalNotes: JUNE.internalNotes,
        version: 1,
      })
      expect(renamed).toMatchObject({
        version: 2,
        sharedInfo: 'Accueil à 13 h 45, 10 minutes de pitch.',
        internalNotes: 'Ordre du jour à envoyer.',
      })

      // Only the shared text changes: the notes stay, and the other way round.
      const shared = await service.update(MANAGER, cci, committee.id, {
        ...JUNE,
        name: renamed.name,
        sharedInfo: 'PARTAGE-2 Accueil à 13 h 30.',
        version: 2,
      })
      expect(shared).toMatchObject({
        version: 3,
        sharedInfo: 'PARTAGE-2 Accueil à 13 h 30.',
        internalNotes: 'Ordre du jour à envoyer.',
      })
      const noted = await service.update(ADMIN, cci, committee.id, {
        ...JUNE,
        name: renamed.name,
        internalNotes: 'INTERNE-3 Jury incomplet',
        sharedInfo: shared.sharedInfo,
        version: 3,
      })
      expect(noted).toMatchObject({
        version: 4,
        sharedInfo: 'PARTAGE-2 Accueil à 13 h 30.',
        internalNotes: 'INTERNE-3 Jury incomplet',
      })
      // Removed by null; the same values again write nothing.
      const removed = await service.update(MANAGER, cci, committee.id, {
        ...JUNE,
        name: renamed.name,
        internalNotes: noted.internalNotes,
        sharedInfo: null,
        version: 4,
      })
      expect(removed).toMatchObject({ version: 5, sharedInfo: null })
      expect(
        (
          await service.update(MANAGER, cci, committee.id, {
            ...JUNE,
            name: renamed.name,
            internalNotes: noted.internalNotes,
            sharedInfo: null,
            version: 5,
          })
        ).version,
      ).toBe(5)

      expect(journal().map((e) => (e.metadata as { fields: string[] }).fields)).toEqual([
        ['name'],
        ['sharedInfo'],
        ['internalNotes'],
        ['sharedInfo'],
      ])
      const written = JSON.stringify(journal())
      for (const text of ['Accueil', 'PARTAGE-2', 'INTERNE-3', 'Ordre du jour']) {
        expect([text, written.includes(text)]).toEqual([text, false])
      }
    })

    it('opens a committee to participation requests (E08.04): closed by default, kept when absent, journaled with its value', async () => {
      const committee = await service.create(MANAGER, cci, JUNE)
      expect(committee.participationRequestsOpen).toBe(false)
      fake.table('auditLog').clear()
      const opened = await service.update(MANAGER, cci, committee.id, {
        ...JUNE,
        participationRequestsOpen: true,
        version: 1,
      })
      expect(opened).toMatchObject({ version: 2, participationRequestsOpen: true })
      // A client that predates it (E08.01–E08.03) keeps it open.
      const renamed = await service.update(MANAGER, cci, committee.id, {
        ...JUNE,
        name: 'Comité de juin (salle 3)',
        version: 2,
      })
      expect(renamed).toMatchObject({ version: 3, participationRequestsOpen: true })
      const closed = await service.update(ADMIN, cci, committee.id, {
        ...JUNE,
        name: renamed.name,
        participationRequestsOpen: false,
        version: 3,
      })
      expect(closed).toMatchObject({ version: 4, participationRequestsOpen: false })
      expect(
        journal().map((e) => {
          const { fields, participationRequestsOpen } = e.metadata as {
            fields: string[]
            participationRequestsOpen?: unknown
          }
          return { fields, participationRequestsOpen }
        }),
      ).toEqual([
        {
          fields: ['participationRequestsOpen'],
          participationRequestsOpen: { from: false, to: true },
        },
        { fields: ['name'], participationRequestsOpen: undefined },
        {
          fields: ['participationRequestsOpen'],
          participationRequestsOpen: { from: true, to: false },
        },
      ])
      // Created open when asked.
      expect(
        (await service.create(MANAGER, cci, { ...JUNE, participationRequestsOpen: true }))
          .participationRequestsOpen,
      ).toBe(true)
    })

    it('keeps both texts from the workspace’s investors and from anyone outside it', async () => {
      const committee = await service.create(MANAGER, cci, JUNE)
      for (const [as, status] of [
        [INVESTOR, 403],
        [OUTSIDER, 404],
        [ENTREPRENEUR, 404],
      ] as const) {
        expect([as.id, (await failure(service.get(as, cci, committee.id))).status]).toEqual([
          as.id,
          status,
        ])
        expect([as.id, (await failure(service.list(as, cci))).status]).toEqual([as.id, status])
      }
      // Writing it is managing the committee: the same refusals as any other field.
      for (const [as, status] of [
        [ADVISOR, 403],
        [INVESTOR, 403],
        [OUTSIDER, 404],
      ] as const) {
        expect(
          (
            await failure(
              service.update(as, cci, committee.id, { ...JUNE, sharedInfo: 'X', version: 1 }),
            )
          ).status,
        ).toBe(status)
      }
      expect(fake.table('committee').get(committee.id)).toMatchObject({
        sharedInfo: JUNE.sharedInfo,
        version: 1,
      })
    })
  })

  describe('statuses', () => {
    it('cancels without deleting, restores, and keeps a cancelled committee from being edited', async () => {
      const committee = await service.create(MANAGER, cci, JUNE)
      fake.table('auditLog').clear()
      const cancelled = await service.changeStatus(MANAGER, cci, committee.id, {
        status: 'cancelled',
        version: 1,
      })
      expect(cancelled).toMatchObject({ status: 'cancelled', version: 2 })
      expect((await service.list(ADVISOR, cci)).map((c) => c.status)).toEqual(['cancelled'])
      expect(
        await failure(
          service.update(MANAGER, cci, committee.id, { ...JUNE, name: 'X', version: 2 }),
        ),
      ).toEqual({ status: 409, code: 'COMMITTEE_NOT_EDITABLE' })
      expect(
        await failure(
          service.changeStatus(MANAGER, cci, committee.id, { status: 'cancelled', version: 2 }),
        ),
      ).toEqual({ status: 409, code: 'COMMITTEE_STATUS_TRANSITION' })
      expect(
        await failure(
          service.changeStatus(MANAGER, cci, committee.id, { status: 'held', version: 2 }),
        ),
      ).toEqual({ status: 409, code: 'COMMITTEE_STATUS_TRANSITION' })
      const restored = await service.changeStatus(MANAGER, cci, committee.id, {
        status: 'planned',
        version: 2,
      })
      expect(restored).toMatchObject({ status: 'planned', version: 3 })
      expect(journal()).toEqual([
        {
          actionType: 'committee_status_changed',
          actorId: MANAGER.id,
          metadata: {
            workspaceId: cci,
            committeeId: committee.id,
            version: 2,
            from: 'planned',
            to: 'cancelled',
          },
        },
        {
          actionType: 'committee_status_changed',
          actorId: MANAGER.id,
          metadata: {
            workspaceId: cci,
            committeeId: committee.id,
            version: 3,
            from: 'cancelled',
            to: 'planned',
          },
        },
      ])
    })

    it('marks a committee held only once its start has passed, and puts it back to planned', async () => {
      const future = await service.create(MANAGER, cci, JUNE)
      expect(
        await failure(
          service.changeStatus(MANAGER, cci, future.id, { status: 'held', version: 1 }),
        ),
      ).toEqual({ status: 409, code: 'COMMITTEE_NOT_STARTED' })
      const past = await service.create(MANAGER, cci, PAST)
      const held = await service.changeStatus(MANAGER, cci, past.id, { status: 'held', version: 1 })
      expect(held).toMatchObject({ status: 'held', version: 2 })
      expect(
        await failure(service.update(MANAGER, cci, past.id, { ...PAST, name: 'X', version: 2 })),
      ).toEqual({ status: 409, code: 'COMMITTEE_NOT_EDITABLE' })
      expect(
        await failure(
          service.changeStatus(MANAGER, cci, past.id, { status: 'cancelled', version: 2 }),
        ),
      ).toEqual({ status: 409, code: 'COMMITTEE_STATUS_TRANSITION' })
      expect(
        await service.changeStatus(MANAGER, cci, past.id, { status: 'planned', version: 2 }),
      ).toMatchObject({ status: 'planned', version: 3 })
    })

    it('reads an unknown stored status as cancelled: nothing edits it', async () => {
      const committee = await service.create(MANAGER, cci, JUNE)
      fake.table('committee').get(committee.id)!.status = 'archived'
      expect((await service.get(MANAGER, cci, committee.id)).status).toBe('cancelled')
      expect(
        await failure(
          service.update(MANAGER, cci, committee.id, { ...JUNE, name: 'X', version: 1 }),
        ),
      ).toEqual({ status: 409, code: 'COMMITTEE_NOT_EDITABLE' })
      expect(
        await failure(
          service.changeStatus(MANAGER, cci, committee.id, { status: 'planned', version: 1 }),
        ),
      ).toEqual({ status: 409, code: 'COMMITTEE_STATUS_TRANSITION' })
    })
  })
})
