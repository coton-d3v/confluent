import { randomUUID } from 'node:crypto'
import { HttpException } from '@nestjs/common'
import { AuditService } from '../../src/modules/audit/audit.service'
import { MemoryStorageAdapter } from '../../src/modules/documents/storage/memory-storage.adapter'
import { WorkspacesService } from '../../src/modules/workspaces/workspaces.service'
import { testDatabase } from './database'

const ADMIN = { id: 'admin-test', role: 'admin' }
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])

// E05.01: the slug's uniqueness and the settings' formats hold in the database itself, and two
// logo replacements at once leave exactly one image in the bucket.
describe('workspaces (PostgreSQL)', () => {
  const prisma = testDatabase()
  const storage = new MemoryStorageAdapter()
  const service = new WorkspacesService(prisma, new AuditService(prisma), storage)
  const created: string[] = []

  afterAll(async () => {
    await prisma.workspace.deleteMany({ where: { id: { in: created } } })
    await prisma.$disconnect()
  })

  const slug = () => `test-${randomUUID().slice(0, 8)}`

  it('creates one workspace when two creations race for the same slug', async () => {
    const wanted = slug()
    const results = await Promise.allSettled([
      service.create(ADMIN, { name: 'Premier', slug: wanted }),
      service.create(ADMIN, { name: 'Second', slug: wanted }),
    ])
    const ok = results.filter((r) => r.status === 'fulfilled')
    const refused = results.filter((r) => r.status === 'rejected')
    expect(ok).toHaveLength(1)
    expect(refused).toHaveLength(1)
    expect(((refused[0] as PromiseRejectedResult).reason as HttpException).getStatus()).toBe(409)
    const rows = await prisma.workspace.findMany({ where: { slug: wanted } })
    expect(rows).toHaveLength(1)
    created.push(rows[0].id)
  })

  it('refuses values the API would never write', async () => {
    const valid = { id: randomUUID(), slug: slug(), name: 'Direct' }
    const invalid: Array<Record<string, unknown>> = [
      { slug: 'Majuscules' },
      { slug: 'double--tiret' },
      { slug: 'a' },
      { name: '   ' },
      { color: '#ABCDEF' },
      { color: 'blue' },
      { presentation: 'a'.repeat(5001) },
      { contactEmail: 'Contact@CCI.fr' },
      { emailDomain: 'contact@cci.fr' },
      { logoKey: `workspaces/${randomUUID()}/logo/x.png` },
    ]
    for (const change of invalid) {
      await expect(prisma.workspace.create({ data: { ...valid, ...change } })).rejects.toThrow(
        /check constraint/i,
      )
    }
    const row = await prisma.workspace.create({
      data: { ...valid, logoKey: `workspaces/${valid.id}/logo/x.png`, emailDomain: 'cci.fr' },
    })
    created.push(row.id)
  })

  it('keeps exactly one logo in the bucket after two replacements at once', async () => {
    const ws = await service.create(ADMIN, { name: 'Logos', slug: slug() })
    created.push(ws.id)
    await Promise.all([
      service.setLogo(ADMIN, ws.id, PNG),
      service.setLogo(ADMIN, ws.id, PNG),
      service.setLogo(ADMIN, ws.id, PNG),
    ])
    const row = await prisma.workspace.findUniqueOrThrow({ where: { id: ws.id } })
    const stored = [...(storage as unknown as { store: Map<string, unknown> }).store.keys()].filter(
      (key) => key.startsWith(`workspaces/${ws.id}/`),
    )
    expect(stored).toEqual([row.logoKey])
  })
})
