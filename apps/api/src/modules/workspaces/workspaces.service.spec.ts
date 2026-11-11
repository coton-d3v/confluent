import { HttpException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import type { PrismaService } from '../../prisma/prisma.service'
import { createFakePrisma } from '../../testing/fake-prisma'
import type { AuditService } from '../audit/audit.service'
import { MemoryStorageAdapter } from '../documents/storage/memory-storage.adapter'
import { StorageQuotaExceededError } from '../documents/storage/storage.adapter'
import {
  WorkspaceAccessService,
  canAdministerAllWorkspaces,
  canManageWorkspace,
} from './workspace-access'
import { detectLogoType } from './workspace-logo'
import { WorkspacesService } from './workspaces.service'

const ADMIN = { id: 'admin-1', role: 'admin' }
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
const WEBP = Buffer.from('RIFF\0\0\0\0WEBPVP8 ', 'latin1')

const statusOf = (err: unknown) => (err instanceof HttpException ? err.getStatus() : null)

describe('WorkspacesService', () => {
  let fake: ReturnType<typeof createFakePrisma>
  let storage: MemoryStorageAdapter
  let service: WorkspacesService

  beforeEach(() => {
    fake = createFakePrisma()
    storage = new MemoryStorageAdapter()
    const audit = { record: jest.fn() } as unknown as AuditService
    const prisma = fake.prisma as unknown as PrismaService
    service = new WorkspacesService(prisma, audit, storage, new WorkspaceAccessService(prisma))
  })

  // A membership of `workspaceId` for `userId`, as E05.02 stores it.
  const member = (
    workspaceId: string,
    userId: string,
    fields: Partial<{ role: string; canManageWorkspace: boolean; deactivatedAt: Date | null }>,
  ) =>
    fake.prisma.workspaceMembership.create({
      data: {
        workspaceId,
        userId,
        role: 'conseiller',
        canManageWorkspace: false,
        deactivatedAt: null,
        ...fields,
      },
    })

  describe('management rule', () => {
    it('keeps creating and listing all workspaces to administrators, closed for any other role', () => {
      expect(canAdministerAllWorkspaces({ role: 'admin' })).toBe(true)
      for (const role of ['entrepreneur', 'financeur', 'conseiller', 'ADMIN', '']) {
        expect(canAdministerAllWorkspaces({ role })).toBe(false)
      }
    })

    it('lets one workspace be managed by an administrator or an active conseiller holding the right', () => {
      const manager = { role: 'conseiller', canManageWorkspace: true, deactivatedAt: null }
      expect(canManageWorkspace({ role: 'admin' }, null)).toBe(true)
      expect(canManageWorkspace({ role: 'entrepreneur' }, manager)).toBe(true)
      expect(canManageWorkspace({ role: 'financeur' }, manager)).toBe(true)
      // Closed by default: no membership, no right, deactivated, investisseur or unknown role.
      for (const role of ['entrepreneur', 'financeur', 'ADMIN', '']) {
        expect(canManageWorkspace({ role }, null)).toBe(false)
      }
      const refused = [
        { ...manager, canManageWorkspace: false },
        { ...manager, deactivatedAt: new Date() },
        { ...manager, role: 'investisseur' },
        { ...manager, role: 'gestionnaire' },
        { ...manager, role: '' },
      ]
      for (const membership of refused) {
        expect(canManageWorkspace({ role: 'financeur' }, membership)).toBe(false)
      }
    })

    it('reads the membership of the workspace concerned at each call', async () => {
      const cci = await service.create(ADMIN, { name: 'CCI Touraine' })
      const club = await service.create(ADMIN, { name: 'Club deal' })
      const manager = { id: 'u-1', role: 'financeur' }
      const row = await member(cci.id, manager.id, { canManageWorkspace: true })
      await expect(service.get(manager, cci.id)).resolves.toMatchObject({ id: cci.id })
      // Another workspace is not even revealed; the list of all and creation stay out of reach.
      expect(statusOf(await service.get(manager, club.id).catch((e: unknown) => e))).toBe(404)
      expect(statusOf(await service.list(manager).catch((e: unknown) => e))).toBe(403)
      expect(
        statusOf(await service.create(manager, { name: 'Pirate' }).catch((e: unknown) => e)),
      ).toBe(403)
      // Deactivated: refused at the next call, as if the workspace did not exist.
      fake.table('workspaceMembership').get(row.id)!.deactivatedAt = new Date()
      expect(statusOf(await service.get(manager, cci.id).catch((e: unknown) => e))).toBe(404)
    })

    it('keeps the email domain to administrators: it bounds the managers’ own invitations', async () => {
      const ws = await service.create(ADMIN, { name: 'CCI Touraine', emailDomain: 'cci.fr' })
      const manager = { id: 'u-1', role: 'entrepreneur' }
      await member(ws.id, manager.id, { canManageWorkspace: true })
      const err = await service
        .update(manager, ws.id, { emailDomain: null })
        .catch((e: unknown) => e)
      expect(statusOf(err)).toBe(403)
      expect(fake.table('workspace').get(ws.id)?.emailDomain).toBe('cci.fr')
      // The same value sent back with other settings is not a change.
      await expect(
        service.update(manager, ws.id, {
          name: 'CCI Touraine-Val de Loire',
          emailDomain: 'cci.fr',
        }),
      ).resolves.toMatchObject({ name: 'CCI Touraine-Val de Loire', emailDomain: 'cci.fr' })
      await expect(service.update(ADMIN, ws.id, { emailDomain: null })).resolves.toMatchObject({
        emailDomain: null,
      })
    })

    it('is checked before anything is read, written or stored, whatever the caller', async () => {
      const ws = await service.create(ADMIN, { name: 'CCI Touraine' })
      // A member without the right, an investisseur flagged as manager by a direct write.
      await member(ws.id, 'u-2', { canManageWorkspace: false })
      await member(ws.id, 'u-3', { role: 'investisseur', canManageWorkspace: true })
      jest.clearAllMocks()
      const upload = jest.spyOn(storage, 'upload')
      // Outside the workspace: 404, as for a workspace that does not exist; a member without the
      // right: 403. Listing all and creating: 403 for both.
      for (const [someone, outside] of [
        [{ id: 'u-1', role: 'entrepreneur' }, 404],
        [{ id: 'u-2', role: 'financeur' }, 403],
        [{ id: 'u-3', role: 'financeur' }, 403],
      ] as const) {
        const calls = [
          [() => service.list(someone), 403],
          [() => service.get(someone, ws.id), outside],
          [() => service.create(someone, { name: 'Pirate' }), 403],
          [() => service.update(someone, ws.id, { name: 'Pirate' }), outside],
          [() => service.setLogo(someone, ws.id, PNG), outside],
          [() => service.removeLogo(someone, ws.id), outside],
        ] as const
        for (const [call, status] of calls) {
          expect(statusOf(await call().catch((e: unknown) => e))).toBe(status)
        }
      }
      expect(fake.prisma.workspace.findUnique).not.toHaveBeenCalled()
      expect(fake.prisma.workspace.findMany).not.toHaveBeenCalled()
      expect(fake.prisma.$transaction).not.toHaveBeenCalled()
      expect(upload).not.toHaveBeenCalled()
    })
  })

  it('reports a slug taken by a concurrent creation as a conflict', async () => {
    fake.prisma.workspace.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    )
    const err = await service.create(ADMIN, { name: 'Club deal' }).catch((e: unknown) => e)
    expect(statusOf(err)).toBe(409)
  })

  describe('logo', () => {
    it('deletes the new image when the workspace row cannot be updated', async () => {
      const ws = await service.create(ADMIN, { name: 'CCI Touraine' })
      fake.prisma.workspace.update.mockRejectedValueOnce(new Error('database down'))
      const upload = jest.spyOn(storage, 'upload')
      const remove = jest.spyOn(storage, 'delete')
      await expect(service.setLogo(ADMIN, ws.id, PNG)).rejects.toThrow('database down')
      const [key] = upload.mock.calls[0]
      expect(remove).toHaveBeenCalledWith(key)
      expect(await storage.exists(key)).toBe(false)
      expect(fake.table('workspace').get(ws.id)?.logoKey).toBeNull()
    })

    it('keeps the new logo when the previous image cannot be deleted', async () => {
      const ws = await service.create(ADMIN, { name: 'CCI Touraine' })
      const first = await service.setLogo(ADMIN, ws.id, PNG)
      jest.spyOn(storage, 'delete').mockRejectedValueOnce(new Error('timeout'))
      const second = await service.setLogo(ADMIN, ws.id, WEBP)
      expect(second.logo?.url).toMatch(/\.webp$/)
      expect(second.logo?.url).not.toBe(first.logo?.url)
    })

    it('reports a full or unreachable storage without touching the workspace', async () => {
      const ws = await service.create(ADMIN, { name: 'CCI Touraine' })
      jest.spyOn(storage, 'upload').mockRejectedValueOnce(new StorageQuotaExceededError())
      expect(statusOf(await service.setLogo(ADMIN, ws.id, PNG).catch((e: unknown) => e))).toBe(507)
      jest.spyOn(storage, 'upload').mockRejectedValueOnce(new Error('ECONNREFUSED'))
      expect(statusOf(await service.setLogo(ADMIN, ws.id, PNG).catch((e: unknown) => e))).toBe(503)
      expect(fake.table('workspace').get(ws.id)?.logoKey).toBeNull()
    })

    it('reports an unreachable storage when listing instead of failing', async () => {
      const ws = await service.create(ADMIN, { name: 'CCI Touraine' })
      await service.setLogo(ADMIN, ws.id, PNG)
      jest.spyOn(storage, 'getSignedUrl').mockRejectedValueOnce(new Error('ETIMEDOUT'))
      const [listed] = await service.list(ADMIN)
      expect(listed.logo).toEqual({ availability: 'unavailable', url: null })
    })

    it('accepts PNG, JPEG and WebP only, from the content', () => {
      expect(detectLogoType(PNG)).toEqual({ mimetype: 'image/png', extension: 'png' })
      expect(detectLogoType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))?.extension).toBe('jpg')
      expect(detectLogoType(WEBP)?.mimetype).toBe('image/webp')
      expect(detectLogoType(Buffer.from('\0\0\0\x18ftypheic', 'latin1'))).toBeNull()
      expect(detectLogoType(Buffer.from('%PDF-1.4'))).toBeNull()
      expect(detectLogoType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull()
      expect(detectLogoType(Buffer.from('GIF89a'))).toBeNull()
    })
  })
})
