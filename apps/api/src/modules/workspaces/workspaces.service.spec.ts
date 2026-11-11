import { HttpException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import type { PrismaService } from '../../prisma/prisma.service'
import { createFakePrisma } from '../../testing/fake-prisma'
import type { AuditService } from '../audit/audit.service'
import { MemoryStorageAdapter } from '../documents/storage/memory-storage.adapter'
import { StorageQuotaExceededError } from '../documents/storage/storage.adapter'
import { canManageWorkspaces } from './workspace-access'
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
    service = new WorkspacesService(fake.prisma as unknown as PrismaService, audit, storage)
  })

  describe('management rule', () => {
    it('is reserved to administrators and closed for any other or unknown role', () => {
      expect(canManageWorkspaces({ role: 'admin' })).toBe(true)
      for (const role of ['entrepreneur', 'financeur', 'conseiller', 'ADMIN', '']) {
        expect(canManageWorkspaces({ role })).toBe(false)
      }
    })

    it('is checked before anything is read, written or stored, whatever the caller', async () => {
      const ws = await service.create(ADMIN, { name: 'CCI Touraine' })
      jest.clearAllMocks()
      const upload = jest.spyOn(storage, 'upload')
      const someone = { id: 'u-1', role: 'entrepreneur' }
      const calls = [
        () => service.list(someone),
        () => service.get(someone, ws.id),
        () => service.create(someone, { name: 'Pirate' }),
        () => service.update(someone, ws.id, { name: 'Pirate' }),
        () => service.setLogo(someone, ws.id, PNG),
        () => service.removeLogo(someone, ws.id),
      ]
      for (const call of calls) {
        expect(statusOf(await call().catch((e: unknown) => e))).toBe(403)
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
