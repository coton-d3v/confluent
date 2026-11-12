import { HttpException } from '@nestjs/common'
import type { ConfigService } from '@nestjs/config'
import { Prisma } from '@prisma/client'
import type { AppConfig } from '../../config/config.schema'
import type { PrismaService } from '../../prisma/prisma.service'
import { createFakePrisma } from '../../testing/fake-prisma'
import type { AuditService } from '../audit/audit.service'
import type { EmailTransport } from '../auth/email/email-transport'
import { MemoryStorageAdapter } from '../documents/storage/memory-storage.adapter'
import { WorkspaceAccessService } from './workspace-access'
import { WorkspaceMembersService } from './workspace-members.service'
import { WorkspacesService } from './workspaces.service'
import { quietNotifications } from '../../testing/notifications'

const ADMIN = { id: 'admin-1', role: 'admin' }
const MANAGER = { id: 'manager-1', role: 'financeur' }

const statusOf = (err: unknown) => (err instanceof HttpException ? err.getStatus() : null)
const failure = (promise: Promise<unknown>) =>
  promise.then(
    () => null,
    (e: unknown) => e,
  )

describe('WorkspaceMembersService', () => {
  let fake: ReturnType<typeof createFakePrisma>
  let audit: { record: jest.Mock }
  let email: { sendWorkspaceInvite: jest.Mock }
  let workspaces: WorkspacesService
  let service: WorkspaceMembersService
  let workspaceId: string

  beforeEach(async () => {
    fake = createFakePrisma()
    audit = { record: jest.fn() }
    email = { sendWorkspaceInvite: jest.fn().mockResolvedValue(undefined) }
    const prisma = fake.prisma as unknown as PrismaService
    const access = new WorkspaceAccessService(prisma)
    const config = {
      get: () => 'https://confluent.example',
    } as unknown as ConfigService<AppConfig, true>
    workspaces = new WorkspacesService(
      prisma,
      audit as unknown as AuditService,
      new MemoryStorageAdapter(),
      access,
    )
    service = new WorkspaceMembersService(
      prisma,
      audit as unknown as AuditService,
      access,
      config,
      email as unknown as EmailTransport,
      quietNotifications(prisma),
    )
    for (const [id, role] of [
      [ADMIN.id, 'admin'],
      [MANAGER.id, 'financeur'],
    ]) {
      await fake.prisma.user.create({
        data: { id, email: `${id}@cci-touraine.fr`, role, emailVerifiedAt: new Date() },
      })
    }
    workspaceId = (await workspaces.create(ADMIN, { name: 'CCI Touraine' })).id
    await service.invite(ADMIN, workspaceId, {
      email: 'manager-1@cci-touraine.fr',
      role: 'conseiller',
      canManageWorkspace: true,
    })
    jest.clearAllMocks()
  })

  const memberships = () => [...fake.table('workspaceMembership').values()]
  const membershipOf = (userId: string) => memberships().find((m) => m.userId === userId)!
  const restrictTo = (domain: string) =>
    workspaces.update(ADMIN, workspaceId, { emailDomain: domain })

  describe('invitation', () => {
    it('creates the account of an unknown address with the narrowest global role, then emails it', async () => {
      const { member, invitationEmailSent } = await service.invite(MANAGER, workspaceId, {
        email: 'Claire@Business-Angels.fr',
        role: 'investisseur',
        organization: 'Angels Touraine',
        investorType: 'business_angel',
      })
      expect(member).toMatchObject({
        role: 'investisseur',
        organization: 'Angels Touraine',
        investorType: 'business_angel',
        canManageWorkspace: false,
        status: 'active',
        awaitingFirstSignIn: true,
        user: { email: 'claire@business-angels.fr' },
        invitedBy: { id: MANAGER.id },
      })
      const account = [...fake.table('user').values()].find(
        (u) => u.email === 'claire@business-angels.fr',
      )
      expect(account).toMatchObject({ role: 'financeur', isActive: true, emailVerifiedAt: null })
      expect(invitationEmailSent).toBe(true)
      expect(email.sendWorkspaceInvite).toHaveBeenCalledWith({
        to: 'claire@business-angels.fr',
        workspaceName: 'CCI Touraine',
        roleLabel: 'investisseur',
        // The sign-in page, never a session link: an invitation is read days later.
        signInUrl: 'https://confluent.example/auth',
        locale: 'fr',
      })
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          actionType: 'workspace_member_invited',
          actorId: MANAGER.id,
          metadata: expect.objectContaining({ workspaceId, createdAccount: true }),
        }),
      )
    })

    it('never changes the global role of an existing account', async () => {
      await fake.prisma.user.create({
        data: { id: 'admin-2', email: 'paul@cci-touraine.fr', role: 'admin' },
      })
      await fake.prisma.user.create({
        data: {
          id: 'ent-1',
          email: 'sophie@biosensio.fr',
          role: 'entrepreneur',
          emailVerifiedAt: null,
        },
      })
      await service.invite(MANAGER, workspaceId, {
        email: 'paul@cci-touraine.fr',
        role: 'conseiller',
      })
      const { member } = await service.invite(MANAGER, workspaceId, {
        email: 'sophie@biosensio.fr',
        role: 'investisseur',
      })
      expect(fake.table('user').get('admin-2')?.role).toBe('admin')
      expect(fake.table('user').get('ent-1')?.role).toBe('entrepreneur')
      expect(member.awaitingFirstSignIn).toBe(true)
      expect(audit.record).toHaveBeenLastCalledWith(
        expect.objectContaining({ metadata: expect.objectContaining({ createdAccount: false }) }),
      )
    })

    it('names the management right in the email of a manager', async () => {
      await service.invite(ADMIN, workspaceId, {
        email: 'luc@cci-touraine.fr',
        role: 'conseiller',
        canManageWorkspace: true,
      })
      expect(email.sendWorkspaceInvite).toHaveBeenCalledWith(
        expect.objectContaining({ roleLabel: 'conseiller, gestionnaire du workspace' }),
      )
    })

    it('keeps the membership when the email cannot be sent', async () => {
      email.sendWorkspaceInvite.mockRejectedValueOnce(new Error('SMTP down'))
      const result = await service.invite(MANAGER, workspaceId, {
        email: 'luc@cci-touraine.fr',
        role: 'conseiller',
      })
      expect(result.invitationEmailSent).toBe(false)
      expect(memberships()).toHaveLength(2)
    })

    it('refuses an address already member, active or deactivated', async () => {
      const first = await service.invite(MANAGER, workspaceId, {
        email: 'luc@cci-touraine.fr',
        role: 'conseiller',
      })
      const again = await failure(
        service.invite(MANAGER, workspaceId, {
          email: 'LUC@cci-touraine.fr',
          role: 'investisseur',
        }),
      )
      expect(statusOf(again)).toBe(409)
      await service.deactivate(MANAGER, workspaceId, first.member.id)
      const deactivated = await failure(
        service.invite(MANAGER, workspaceId, { email: 'luc@cci-touraine.fr', role: 'conseiller' }),
      )
      expect(statusOf(deactivated)).toBe(409)
      expect((deactivated as HttpException).message).toContain('réactivez-la')
      expect(memberships()).toHaveLength(2)
    })

    it('reports a membership created by a concurrent invitation as a conflict', async () => {
      fake.prisma.workspaceMembership.create.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      )
      const err = await failure(
        service.invite(MANAGER, workspaceId, { email: 'luc@cci-touraine.fr', role: 'conseiller' }),
      )
      expect(statusOf(err)).toBe(409)
      expect(email.sendWorkspaceInvite).not.toHaveBeenCalled()
    })

    it('takes conseillers only from the workspace email domain, investisseurs from anywhere', async () => {
      await restrictTo('cci-touraine.fr')
      for (const address of [
        'luc@gmail.com',
        'luc@tours.cci-touraine.fr',
        'luc@cci-touraine.fr.evil.com',
      ]) {
        const err = await failure(
          service.invite(MANAGER, workspaceId, { email: address, role: 'conseiller' }),
        )
        expect(statusOf(err)).toBe(400)
        expect((err as HttpException).message).toContain('@cci-touraine.fr')
      }
      await service.invite(MANAGER, workspaceId, {
        email: 'LUC@CCI-Touraine.fr',
        role: 'conseiller',
      })
      await service.invite(MANAGER, workspaceId, {
        email: 'claire@gmail.com',
        role: 'investisseur',
      })
      expect(memberships()).toHaveLength(3)
      // Nothing created for the refused addresses.
      expect([...fake.table('user').values()].some((u) => u.email === 'luc@gmail.com')).toBe(false)
    })
  })

  describe('management rule', () => {
    it('refuses every operation to whoever does not manage this workspace, before any write', async () => {
      const { member: investor } = await service.invite(ADMIN, workspaceId, {
        email: 'claire@gmail.com',
        role: 'investisseur',
      })
      const { member: advisor } = await service.invite(ADMIN, workspaceId, {
        email: 'luc@cci-touraine.fr',
        role: 'conseiller',
      })
      const other = await workspaces.create(ADMIN, { name: 'Club deal' })
      const otherManager = { id: 'club-manager', role: 'financeur' }
      await fake.prisma.workspaceMembership.create({
        data: {
          workspaceId: other.id,
          userId: otherManager.id,
          role: 'conseiller',
          canManageWorkspace: true,
        },
      })
      jest.clearAllMocks()
      // Not in the workspace (another workspace's manager included): 404, as for a workspace that
      // does not exist. A member without the right: 403.
      const outsiders = [
        [{ id: 'nobody', role: 'entrepreneur' }, 404],
        [{ id: investor.user.id, role: 'financeur' }, 403],
        [{ id: advisor.user.id, role: 'financeur' }, 403],
        [otherManager, 404],
      ] as const
      for (const [actor, status] of outsiders) {
        const calls = [
          () => service.list(actor, workspaceId),
          () =>
            service.invite(actor, workspaceId, { email: 'x@cci-touraine.fr', role: 'conseiller' }),
          () => service.update(actor, workspaceId, advisor.id, { canManageWorkspace: true }),
          () => service.deactivate(actor, workspaceId, membershipOf(MANAGER.id).id),
          () => service.reactivate(actor, workspaceId, advisor.id),
        ]
        for (const call of calls) expect(statusOf(await failure(call()))).toBe(status)
      }
      expect(
        statusOf(
          await failure(service.list(outsiders[0][0], '00000000-0000-4000-8000-000000000000')),
        ),
      ).toBe(404)
      expect(fake.prisma.workspaceMembership.create).not.toHaveBeenCalled()
      expect(fake.prisma.workspaceMembership.update).not.toHaveBeenCalled()
      expect(fake.prisma.user.createMany).not.toHaveBeenCalled()
      expect(email.sendWorkspaceInvite).not.toHaveBeenCalled()
      expect(membershipOf(advisor.user.id).canManageWorkspace).toBe(false)
    })

    it('stops what a deactivated membership granted at the next call, without touching the account', async () => {
      const { member: second } = await service.invite(ADMIN, workspaceId, {
        email: 'luc@cci-touraine.fr',
        role: 'conseiller',
        canManageWorkspace: true,
      })
      const luc = { id: second.user.id, role: 'financeur' }
      await expect(service.list(luc, workspaceId)).resolves.toHaveLength(2)
      const deactivated = await service.deactivate(MANAGER, workspaceId, second.id)
      expect(deactivated).toMatchObject({ status: 'deactivated', canManageWorkspace: true })
      expect(statusOf(await failure(service.list(luc, workspaceId)))).toBe(404)
      expect(statusOf(await failure(workspaces.get(luc, workspaceId)))).toBe(404)
      expect(statusOf(await failure(workspaces.enter(luc, workspaceId)))).toBe(404)
      expect(fake.table('user').get(luc.id)?.isActive).toBe(true)
      expect(await service.listMine(luc)).toEqual([])
      // Reactivated: the right it held comes back.
      await service.reactivate(MANAGER, workspaceId, second.id)
      await expect(service.list(luc, workspaceId)).resolves.toHaveLength(2)
      expect(audit.record.mock.calls.map(([e]) => e.actionType)).toEqual([
        'workspace_member_invited',
        'workspace_member_deactivated',
        'workspace_member_reactivated',
      ])
    })

    it('lets a manager neither remove nor deactivate the last management right', async () => {
      const own = membershipOf(MANAGER.id).id
      const demote = await failure(
        service.update(MANAGER, workspaceId, own, { canManageWorkspace: false }),
      )
      expect(statusOf(demote)).toBe(409)
      expect((demote as HttpException).message).toContain('dernier gestionnaire')
      expect(statusOf(await failure(service.deactivate(MANAGER, workspaceId, own)))).toBe(409)
      expect(
        statusOf(
          await failure(service.update(MANAGER, workspaceId, own, { role: 'investisseur' })),
        ),
      ).toBe(409)
      expect(membershipOf(MANAGER.id)).toMatchObject({
        canManageWorkspace: true,
        deactivatedAt: null,
      })

      // With another manager, they may step down — and then manage nothing.
      await service.invite(MANAGER, workspaceId, {
        email: 'luc@cci-touraine.fr',
        role: 'conseiller',
        canManageWorkspace: true,
      })
      await service.update(MANAGER, workspaceId, own, { canManageWorkspace: false })
      expect(statusOf(await failure(service.list(MANAGER, workspaceId)))).toBe(403)
    })

    it('lets an administrator remove the last manager: the workspace is back to its state at creation', async () => {
      const own = membershipOf(MANAGER.id).id
      await expect(service.deactivate(ADMIN, workspaceId, own)).resolves.toMatchObject({
        status: 'deactivated',
      })
      await expect(service.list(ADMIN, workspaceId)).resolves.toHaveLength(1)
    })

    it('does not reach a membership of another workspace', async () => {
      const other = await workspaces.create(ADMIN, { name: 'Club deal' })
      const { member } = await service.invite(ADMIN, other.id, {
        email: 'claire@gmail.com',
        role: 'investisseur',
      })
      for (const call of [
        () => service.update(MANAGER, workspaceId, member.id, { organization: 'Pirate' }),
        () => service.deactivate(MANAGER, workspaceId, member.id),
      ]) {
        expect(statusOf(await failure(call()))).toBe(404)
      }
      expect(membershipOf(member.user.id)).toMatchObject({
        organization: null,
        deactivatedAt: null,
      })
    })
  })

  describe('edition', () => {
    it('changes only what is sent and journals each change', async () => {
      const { member } = await service.invite(MANAGER, workspaceId, {
        email: 'claire@gmail.com',
        role: 'investisseur',
        investorType: 'banque',
      })
      jest.clearAllMocks()
      const updated = await service.update(MANAGER, workspaceId, member.id, {
        organization: 'Crédit Touraine',
        investorType: 'fonds_investissement',
      })
      expect(updated).toMatchObject({
        organization: 'Crédit Touraine',
        investorType: 'fonds_investissement',
        role: 'investisseur',
      })
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          actionType: 'workspace_member_updated',
          metadata: expect.objectContaining({
            changes: {
              organization: { from: null, to: 'Crédit Touraine' },
              investorType: { from: 'banque', to: 'fonds_investissement' },
            },
          }),
        }),
      )
      jest.clearAllMocks()
      await service.update(MANAGER, workspaceId, member.id, { organization: 'Crédit Touraine' })
      expect(audit.record).not.toHaveBeenCalled()
    })

    it('clears what a new role cannot hold and refuses an explicit contradiction', async () => {
      const { member } = await service.invite(MANAGER, workspaceId, {
        email: 'claire@cci-touraine.fr',
        role: 'investisseur',
        investorType: 'banque',
      })
      const advisor = await service.update(MANAGER, workspaceId, member.id, {
        role: 'conseiller',
        canManageWorkspace: true,
      })
      expect(advisor).toMatchObject({
        role: 'conseiller',
        investorType: null,
        canManageWorkspace: true,
      })
      const investor = await service.update(MANAGER, workspaceId, member.id, {
        role: 'investisseur',
      })
      expect(investor).toMatchObject({ role: 'investisseur', canManageWorkspace: false })
      for (const input of [
        { canManageWorkspace: true },
        { role: 'conseiller' as const, investorType: 'banque' as const },
      ]) {
        expect(
          statusOf(await failure(service.update(MANAGER, workspaceId, member.id, input))),
        ).toBe(400)
      }
    })

    it('applies the email domain to whoever becomes a conseiller, or is reactivated as one', async () => {
      const { member: investor } = await service.invite(MANAGER, workspaceId, {
        email: 'claire@gmail.com',
        role: 'investisseur',
      })
      const { member: advisor } = await service.invite(MANAGER, workspaceId, {
        email: 'luc@gmail.com',
        role: 'conseiller',
      })
      await service.deactivate(MANAGER, workspaceId, advisor.id)
      await restrictTo('cci-touraine.fr')
      expect(
        statusOf(
          await failure(service.update(MANAGER, workspaceId, investor.id, { role: 'conseiller' })),
        ),
      ).toBe(400)
      expect(statusOf(await failure(service.reactivate(MANAGER, workspaceId, advisor.id)))).toBe(
        400,
      )
      // Not retroactive: members invited before the restriction stay as they are.
      expect(membershipOf(investor.user.id).role).toBe('investisseur')
      await service.update(MANAGER, workspaceId, investor.id, { organization: 'Angels' })
    })
  })

  it('lists the signed-in person’s active memberships only, by workspace name', async () => {
    const club = await workspaces.create(ADMIN, { name: 'Angels Club', color: '#0f766e' })
    const { member } = await service.invite(ADMIN, club.id, {
      email: MANAGER.id + '@cci-touraine.fr',
      role: 'investisseur',
      investorType: 'business_angel',
    })
    const third = await workspaces.create(ADMIN, { name: 'Zébre Incubateur' })
    const inThird = await service.invite(ADMIN, third.id, {
      email: MANAGER.id + '@cci-touraine.fr',
      role: 'conseiller',
    })
    await service.deactivate(ADMIN, third.id, inThird.member.id)
    const mine = await service.listMine(MANAGER)
    expect(mine.map((m) => [m.workspace.name, m.role, m.canManageWorkspace])).toEqual([
      ['Angels Club', 'investisseur', false],
      ['CCI Touraine', 'conseiller', true],
    ])
    expect(mine[0]).toMatchObject({ id: member.id, workspace: { color: '#0f766e' } })
    // A role this version does not know grants nothing, so it is not offered to switch to (E05.03).
    fake.table('workspaceMembership').get(member.id)!.role = 'observateur'
    expect((await service.listMine(MANAGER)).map((m) => m.workspace.name)).toEqual(['CCI Touraine'])
  })
})
