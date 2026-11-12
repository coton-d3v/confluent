import { randomUUID } from 'node:crypto'
import { HttpException } from '@nestjs/common'
import type { ConfigService } from '@nestjs/config'
import type { AppConfig } from '../../src/config/config.schema'
import { AuditService } from '../../src/modules/audit/audit.service'
import type { EmailTransport } from '../../src/modules/auth/email/email-transport'
import { WorkspaceAccessService } from '../../src/modules/workspaces/workspace-access'
import { WorkspaceMembersService } from '../../src/modules/workspaces/workspace-members.service'
import { testDatabase } from './database'
import { quietNotifications } from '../../src/testing/notifications'

const statusOf = (result: PromiseSettledResult<unknown>) =>
  result.status === 'rejected' && result.reason instanceof HttpException
    ? result.reason.getStatus()
    : result.status

// E05.02: a person is a member of a workspace once, concurrent invitations create one account and
// one membership, and concurrent requests never leave a workspace without the manager they protect.
describe('workspace members (PostgreSQL)', () => {
  const prisma = testDatabase()
  const access = new WorkspaceAccessService(prisma)
  const config = { get: () => 'http://localhost:5173' } as unknown as ConfigService<AppConfig, true>
  const email = { sendWorkspaceInvite: () => Promise.resolve() } as unknown as EmailTransport
  const service = new WorkspaceMembersService(
    prisma,
    new AuditService(prisma),
    access,
    config,
    email,
    quietNotifications(prisma),
  )
  const tag = randomUUID().slice(0, 8)
  const address = (name: string) => `${name}-${tag}@pg-test.dev`
  const workspaces: string[] = []
  let admin: { id: string; role: string }

  beforeAll(async () => {
    const row = await prisma.user.create({
      data: { email: address('admin'), role: 'admin', emailVerifiedAt: new Date() },
    })
    admin = { id: row.id, role: row.role }
  })

  afterAll(async () => {
    const users = await prisma.user.findMany({
      where: { email: { endsWith: `-${tag}@pg-test.dev` } },
    })
    const ids = users.map((u) => u.id)
    await prisma.auditLog.deleteMany({ where: { actorId: { in: ids } } })
    await prisma.workspace.deleteMany({ where: { id: { in: workspaces } } })
    await prisma.user.deleteMany({ where: { id: { in: ids } } })
    await prisma.$disconnect()
  })

  const newWorkspace = async () => {
    const ws = await prisma.workspace.create({
      data: { slug: `pg-${randomUUID().slice(0, 12)}`, name: 'CCI test' },
    })
    workspaces.push(ws.id)
    return ws.id
  }
  // A manager invited by the administrator, as an account that has signed in.
  const manager = async (workspaceId: string, name: string) => {
    const { member } = await service.invite(admin, workspaceId, {
      email: address(name),
      role: 'conseiller',
      canManageWorkspace: true,
    })
    return { actor: { id: member.user.id, role: 'financeur' }, membershipId: member.id }
  }
  const activeManagers = (workspaceId: string) =>
    prisma.workspaceMembership.count({
      where: { workspaceId, canManageWorkspace: true, deactivatedAt: null },
    })

  it('refuses in the database a second membership and values the API would never write', async () => {
    const workspaceId = await newWorkspace()
    const user = await prisma.user.create({ data: { email: address('direct'), role: 'financeur' } })
    const valid = { workspaceId, userId: user.id, role: 'investisseur' }
    await prisma.workspaceMembership.create({ data: valid })
    await expect(prisma.workspaceMembership.create({ data: valid })).rejects.toThrow(
      /Unique constraint/i,
    )
    const other = await prisma.user.create({
      data: { email: address('direct2'), role: 'financeur' },
    })
    const invalid: Array<Record<string, unknown>> = [
      { role: 'admin' },
      { role: 'Conseiller' },
      { role: 'conseiller', investorType: 'banque' },
      { role: 'investisseur', canManageWorkspace: true },
      { investorType: 'crowdfunding' },
      { organization: '   ' },
      { organization: ' Angels ' },
      { organization: 'x'.repeat(121) },
    ]
    for (const change of invalid) {
      await expect(
        prisma.workspaceMembership.create({ data: { ...valid, userId: other.id, ...change } }),
      ).rejects.toThrow(/check constraint/i)
    }
  })

  it('creates one account and one membership when the same address is invited twice at once', async () => {
    const workspaceId = await newWorkspace()
    const invited = address('twice')
    const results = await Promise.allSettled([
      service.invite(admin, workspaceId, { email: invited, role: 'investisseur' }),
      service.invite(admin, workspaceId, { email: invited.toUpperCase(), role: 'conseiller' }),
    ])
    expect(results.map(statusOf).sort()).toEqual([409, 'fulfilled'])
    expect(await prisma.user.count({ where: { email: invited } })).toBe(1)
    expect(await prisma.workspaceMembership.count({ where: { workspaceId } })).toBe(1)
  })

  it('creates one account when two workspaces invite the same new address at once', async () => {
    const [first, second] = [await newWorkspace(), await newWorkspace()]
    const invited = address('shared')
    const results = await Promise.allSettled([
      service.invite(admin, first, { email: invited, role: 'investisseur' }),
      service.invite(admin, second, { email: invited, role: 'investisseur' }),
    ])
    expect(results.map(statusOf)).toEqual(['fulfilled', 'fulfilled'])
    const accounts = await prisma.user.findMany({ where: { email: invited } })
    expect(accounts).toHaveLength(1)
    expect(accounts[0].role).toBe('financeur')
    expect(await prisma.workspaceMembership.count({ where: { userId: accounts[0].id } })).toBe(2)
  })

  it('keeps one manager when the last two step down at once', async () => {
    for (let round = 0; round < 3; round++) {
      const workspaceId = await newWorkspace()
      const a = await manager(workspaceId, `a${round}`)
      const b = await manager(workspaceId, `b${round}`)
      const results = await Promise.allSettled([
        service.update(a.actor, workspaceId, a.membershipId, { canManageWorkspace: false }),
        service.deactivate(b.actor, workspaceId, b.membershipId),
      ])
      expect(results.map(statusOf).sort()).toEqual([409, 'fulfilled'])
      expect(await activeManagers(workspaceId)).toBe(1)
    }
  })

  it('keeps one manager when two managers remove each other at once', async () => {
    for (let round = 0; round < 3; round++) {
      const workspaceId = await newWorkspace()
      const a = await manager(workspaceId, `x${round}`)
      const b = await manager(workspaceId, `y${round}`)
      const results = await Promise.allSettled([
        service.deactivate(a.actor, workspaceId, b.membershipId),
        service.update(b.actor, workspaceId, a.membershipId, { canManageWorkspace: false }),
      ])
      // The second one no longer manages the workspace once the first is done: 403 when demoted,
      // 404 when deactivated (no longer in the workspace at all, E05.03).
      const [refused, done] = results.map(statusOf).sort()
      expect(done).toBe('fulfilled')
      expect([403, 404]).toContain(refused)
      expect(await activeManagers(workspaceId)).toBe(1)
    }
  })
})
