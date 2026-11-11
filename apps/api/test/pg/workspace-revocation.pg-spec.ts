import { randomUUID } from 'node:crypto'
import { HttpException } from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import { AuditService } from '../../src/modules/audit/audit.service'
import { MemoryStorageAdapter } from '../../src/modules/documents/storage/memory-storage.adapter'
import { WorkspaceAccessService } from '../../src/modules/workspaces/workspace-access'
import { WorkspacesService } from '../../src/modules/workspaces/workspaces.service'
import { testDatabase } from './database'

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])

// Code review R53: a manager's right is read again once the workspace row is locked. A request
// already past its first check, then waiting for the lock while the manager is deactivated, writes
// nothing — settings, logo replaced or removed.
describe('workspace settings after a concurrent revocation (PostgreSQL)', () => {
  const prisma = testDatabase()
  // Records every object put in the bucket, to check none is left behind.
  const uploaded: string[] = []
  const storage = new (class extends MemoryStorageAdapter {
    upload(key: string, buffer: Buffer, mimetype: string) {
      uploaded.push(key)
      return super.upload(key, buffer, mimetype)
    }
  })()
  const service = new WorkspacesService(
    prisma,
    new AuditService(prisma),
    storage,
    new WorkspaceAccessService(prisma),
  )
  const tag = randomUUID().slice(0, 8)
  const workspaces: string[] = []
  const users: string[] = []

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { actorId: { in: users } } })
    await prisma.workspace.deleteMany({ where: { id: { in: workspaces } } })
    await prisma.user.deleteMany({ where: { id: { in: users } } })
    await prisma.$disconnect()
  })

  // A workspace with one active managing conseiller, and its logo when `logoKey` is given.
  async function managedWorkspace(logoKey?: (id: string) => string) {
    const ws = await prisma.workspace.create({
      data: { slug: `pg-${randomUUID().slice(0, 12)}`, name: 'Avant révocation' },
    })
    workspaces.push(ws.id)
    if (logoKey) {
      const key = logoKey(ws.id)
      await storage.upload(key, PNG, 'image/png')
      await prisma.workspace.update({ where: { id: ws.id }, data: { logoKey: key } })
    }
    const user = await prisma.user.create({
      data: { email: `m-${randomUUID().slice(0, 8)}-${tag}@pg-test.dev`, role: 'financeur' },
    })
    users.push(user.id)
    const membership = await prisma.workspaceMembership.create({
      data: { workspaceId: ws.id, userId: user.id, role: 'conseiller', canManageWorkspace: true },
    })
    return { workspaceId: ws.id, actor: { id: user.id, role: 'financeur' }, membership }
  }

  // Holds the workspace row while `attempt` runs: once the attempt waits for the lock (its first
  // check passed), `revoke` runs in the holding transaction, which then commits.
  async function revokedWhileWaiting(
    workspaceId: string,
    attempt: () => Promise<unknown>,
    revoke: (tx: Prisma.TransactionClient) => Promise<unknown>,
  ): Promise<number | 'fulfilled'> {
    let outcome!: Promise<number | 'fulfilled'>
    await prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT 1 FROM "workspaces" WHERE "id" = ${workspaceId} FOR UPDATE`
        outcome = attempt().then(
          () => 'fulfilled' as const,
          (err: unknown) => {
            if (err instanceof HttpException) return err.getStatus()
            throw err
          },
        )
        await waitForBlockedQuery()
        await revoke(tx)
      },
      { timeout: 20_000 },
    )
    return outcome
  }

  async function waitForBlockedQuery() {
    for (let i = 0; i < 100; i++) {
      const [{ waiting }] = await prisma.$queryRaw<Array<{ waiting: bigint }>>`
        SELECT count(*) AS waiting FROM pg_locks WHERE NOT granted`
      if (waiting > 0n) return
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    throw new Error('the attempt never waited for the workspace lock')
  }

  const deactivate = (id: string) => (tx: Prisma.TransactionClient) =>
    tx.workspaceMembership.update({ where: { id }, data: { deactivatedAt: new Date() } })

  it('refuses the settings of a manager deactivated while the request waited', async () => {
    const { workspaceId, actor, membership } = await managedWorkspace()
    const outcome = await revokedWhileWaiting(
      workspaceId,
      () => service.update(actor, workspaceId, { name: 'Après révocation' }),
      deactivate(membership.id),
    )
    expect(outcome).toBe(403)
    const row = await prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } })
    expect(row.name).toBe('Avant révocation')
  })

  it('keeps the logo when its manager loses the right while the removal waited', async () => {
    const { workspaceId, actor, membership } = await managedWorkspace(
      (id) => `workspaces/${id}/logo/${randomUUID()}.png`,
    )
    const before = await prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } })
    const outcome = await revokedWhileWaiting(
      workspaceId,
      () => service.removeLogo(actor, workspaceId),
      (tx) =>
        tx.workspaceMembership.update({
          where: { id: membership.id },
          data: { canManageWorkspace: false },
        }),
    )
    expect(outcome).toBe(403)
    const after = await prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } })
    expect(after.logoKey).toBe(before.logoKey)
    expect(await storage.exists(before.logoKey!)).toBe(true)
  })

  it('keeps the previous logo and deletes the uploaded one when the replacement is refused', async () => {
    const { workspaceId, actor, membership } = await managedWorkspace(
      (id) => `workspaces/${id}/logo/${randomUUID()}.png`,
    )
    const before = await prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } })
    uploaded.length = 0
    const outcome = await revokedWhileWaiting(
      workspaceId,
      () => service.setLogo(actor, workspaceId, PNG),
      deactivate(membership.id),
    )
    expect(outcome).toBe(403)
    const after = await prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } })
    expect(after.logoKey).toBe(before.logoKey)
    expect(await storage.exists(before.logoKey!)).toBe(true)
    // The image sent with the refused request was stored, then removed.
    expect(uploaded).toHaveLength(1)
    expect(await storage.exists(uploaded[0])).toBe(false)
  })
})
