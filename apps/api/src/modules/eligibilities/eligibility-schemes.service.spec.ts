import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { HttpException } from '@nestjs/common'
import {
  DEFAULT_ELIGIBILITY_SCHEMES,
  ELIGIBILITY_SCHEME_KEY_PATTERN,
  ELIGIBILITY_SCHEME_LIMITS,
  createEligibilitySchemeSchema,
  declareEligibilitySchema,
  declareReceivedEligibilitySchema,
  receivedCandidaturesQuerySchema,
  reorderEligibilitySchemesSchema,
  updateEligibilitySchema,
  updateEligibilitySchemeSchema,
  updateReceivedEligibilitySchema,
} from '@confluent/shared'
import type { PrismaService } from '../../prisma/prisma.service'
import { createFakePrisma } from '../../testing/fake-prisma'
import type { AuditService } from '../audit/audit.service'
import { MemoryStorageAdapter } from '../documents/storage/memory-storage.adapter'
import { WorkspaceAccessService } from '../workspaces/workspace-access'
import { WorkspacesService } from '../workspaces/workspaces.service'
import { EligibilitySchemesService } from './eligibility-schemes.service'

const ADMIN = { id: 'admin-1', role: 'admin' }
const MANAGER = { id: 'marie', role: 'financeur' }
const ADVISOR = { id: 'luc', role: 'financeur' }
const INVESTOR = { id: 'claire', role: 'financeur' }
const OUTSIDER = { id: 'paul', role: 'financeur' }
const ENTREPRENEUR = { id: 'sophie', role: 'entrepreneur' }

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

const MIGRATION = join(
  __dirname,
  '../../../prisma/migrations/20261120000000_eligibilities/migration.sql',
)
const DOWN = join(__dirname, '../../../prisma/checks/20261120000000_eligibilities.down.sql')

// ROADMAP E06.05: the schemes of a workspace — the default list at its creation, read by its
// conseillers, configured by its managers — and the contracts that keep them information only.
describe('EligibilitySchemesService', () => {
  let fake: ReturnType<typeof createFakePrisma>
  let record: jest.Mock
  let service: EligibilitySchemesService
  let cci: string
  let club: string

  beforeEach(async () => {
    fake = createFakePrisma()
    record = jest.fn()
    const audit = { record } as unknown as AuditService
    const prisma = fake.prisma as unknown as PrismaService
    const access = new WorkspaceAccessService(prisma)
    service = new EligibilitySchemesService(prisma, access, audit)
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
    record.mockClear()
  })

  const labels = async (workspaceId: string, as = ADMIN) =>
    (await service.list(as, workspaceId)).map((s) => s.label)
  const schemeOf = async (workspaceId: string, key: string) =>
    (await service.list(ADMIN, workspaceId)).find((s) => s.key === key)!

  describe('defaults', () => {
    it('gives a new workspace the five default schemes, in order, active, described', async () => {
      const list = await service.list(ADMIN, cci)
      expect(
        list.map(({ key, label, position, active }) => [key, label, position, active]),
      ).toEqual([
        ['jeir', 'JEIR', 0, true],
        ['jei', 'JEI', 1, true],
        ['cir', 'CIR', 2, true],
        ['cii', 'CII', 3, true],
        ['ir_pme', 'IR-PME', 4, true],
      ])
      expect(list.every((s) => s.description && s.description.length > 0)).toBe(true)
      // Each workspace has its own rows.
      const other = await service.list(ADMIN, club)
      expect(other.map((s) => s.key)).toEqual(list.map((s) => s.key))
      expect(other.some((s) => list.some((c) => c.id === s.id))).toBe(false)
    })

    it('keeps the migration’s backfill and the revert’s check equal to the defaults, within the limits', () => {
      const pattern = /\('([a-z_]+)', '([^']+)', '([^']+)', (\d+)\)/g
      const parsed = (sql: string) =>
        [...sql.matchAll(pattern)].map(([, key, label, description, position]) => ({
          key,
          label,
          description,
          position: Number(position),
        }))
      const expected = DEFAULT_ELIGIBILITY_SCHEMES.map((s, position) => ({ ...s, position }))
      expect(parsed(readFileSync(MIGRATION, 'utf8'))).toEqual(expected)
      expect(parsed(readFileSync(DOWN, 'utf8'))).toEqual(expected)
      for (const s of DEFAULT_ELIGIBILITY_SCHEMES) {
        expect(s.key).toMatch(ELIGIBILITY_SCHEME_KEY_PATTERN)
        expect(
          createEligibilitySchemeSchema.parse({ label: s.label, description: s.description }),
        ).toEqual({
          label: s.label,
          description: s.description,
        })
      }
      const sql = readFileSync(MIGRATION, 'utf8')
      expect(sql).toContain(`char_length("key") <= ${ELIGIBILITY_SCHEME_LIMITS.key}`)
      expect(sql).toContain(`char_length("label") BETWEEN 1 AND ${ELIGIBILITY_SCHEME_LIMITS.label}`)
      expect(sql).toContain(
        `char_length("description") BETWEEN 1 AND ${ELIGIBILITY_SCHEME_LIMITS.description}`,
      )
      expect(sql).toContain(`char_length("note") BETWEEN 1 AND ${ELIGIBILITY_SCHEME_LIMITS.note}`)
    })

    it('describes what a scheme is, never an amount or a rate it would yield', () => {
      for (const s of DEFAULT_ELIGIBILITY_SCHEMES) {
        expect(s.description).not.toMatch(/\d|%|€/)
      }
    })
  })

  describe('reading', () => {
    it('is for the workspace’s active conseillers (managing it or not) and the administrators', async () => {
      expect(await labels(cci, MANAGER)).toHaveLength(5)
      expect(await labels(cci, ADVISOR)).toHaveLength(5)
      expect(await labels(cci, ADMIN)).toHaveLength(5)
    })

    it('is closed to an investisseur (403), and to whoever is not an active member (404)', async () => {
      expect(await failure(service.list(INVESTOR, cci))).toEqual({
        status: 403,
        code: 'ELIGIBILITY_SCHEMES_FORBIDDEN',
      })
      for (const actor of [OUTSIDER, ENTREPRENEUR]) {
        expect(await failure(service.list(actor, cci))).toMatchObject({ status: 404 })
      }
      const advisor = [...fake.table('workspaceMembership').values()].find(
        (m) => m.userId === ADVISOR.id,
      )!
      advisor.deactivatedAt = new Date()
      expect(await failure(service.list(ADVISOR, cci))).toMatchObject({ status: 404 })
      // A role this version does not know reads nothing (closed by default).
      advisor.deactivatedAt = null
      advisor.role = 'observateur'
      expect(await failure(service.list(ADVISOR, cci))).toMatchObject({ status: 404 })
    })
  })

  describe('configuring', () => {
    it('adds a scheme last, with a key derived once from its label, suffixed when taken', async () => {
      const jeu = await service.create(MANAGER, cci, {
        label: 'Jeune entreprise universitaire',
        description: 'JEU',
      })
      expect(jeu).toMatchObject({
        key: 'jeune_entreprise_universitaire',
        position: 5,
        active: true,
        description: 'JEU',
      })
      // Renamed, its key stays; a new scheme named like the old key is suffixed.
      await service.update(MANAGER, cci, jeu.id, { label: 'JEU' })
      const again = await service.create(MANAGER, cci, { label: 'Jeune entreprise universitaire' })
      expect(again.key).toBe('jeune_entreprise_universitaire_2')
      const blank = await service.create(MANAGER, cci, { label: '***' })
      expect(blank).toMatchObject({ key: 'dispositif', description: null })
      expect(record).toHaveBeenCalledWith(
        expect.objectContaining({
          actionType: 'eligibility_schemes_updated',
          actorId: MANAGER.id,
          metadata: expect.objectContaining({ workspaceId: cci, change: 'created' }),
        }),
      )
    })

    it('tells labels apart without regard to case, and caps the list', async () => {
      expect(await failure(service.create(MANAGER, cci, { label: 'jeir' }))).toEqual({
        status: 409,
        code: 'ELIGIBILITY_SCHEME_LABEL_TAKEN',
      })
      const cii = await schemeOf(cci, 'cii')
      expect(await failure(service.update(MANAGER, cci, cii.id, { label: 'Cir' }))).toEqual({
        status: 409,
        code: 'ELIGIBILITY_SCHEME_LABEL_TAKEN',
      })
      // Its own label in another case is a rename.
      expect((await service.update(MANAGER, cci, cii.id, { label: 'cii' })).label).toBe('cii')
      for (let n = 5; n < ELIGIBILITY_SCHEME_LIMITS.perWorkspace; n++) {
        await service.create(MANAGER, cci, { label: `Dispositif ${n}` })
      }
      expect(await failure(service.create(MANAGER, cci, { label: 'De trop' }))).toEqual({
        status: 409,
        code: 'ELIGIBILITY_SCHEME_LIMIT',
      })
    })

    it('describes, deactivates every scheme if wished, and writes nothing unchanged', async () => {
      for (const s of await service.list(ADMIN, cci)) {
        await service.update(MANAGER, cci, s.id, { active: false })
      }
      expect((await service.list(ADMIN, cci)).every((s) => !s.active)).toBe(true)
      const jei = await schemeOf(cci, 'jei')
      const described = await service.update(MANAGER, cci, jei.id, { description: null })
      expect(described.description).toBeNull()
      record.mockClear()
      await service.update(MANAGER, cci, jei.id, { label: 'JEI', description: null, active: false })
      expect(record).not.toHaveBeenCalled()
      expect(await failure(service.update(MANAGER, cci, 'unknown', { active: true }))).toEqual({
        status: 404,
        code: 'ELIGIBILITY_SCHEME_NOT_FOUND',
      })
    })

    it('reorders the whole list only', async () => {
      const ids = (await service.list(ADMIN, cci)).map((s) => s.id)
      const reversed = ids.slice().reverse()
      expect((await service.reorder(MANAGER, cci, reversed)).map((s) => s.key)).toEqual([
        'ir_pme',
        'cii',
        'cir',
        'jei',
        'jeir',
      ])
      for (const stale of [ids.slice(1), [...ids.slice(1), (await schemeOf(club, 'jei')).id]]) {
        expect(await failure(service.reorder(MANAGER, cci, stale))).toEqual({
          status: 409,
          code: 'ELIGIBILITY_SCHEME_ORDER_STALE',
        })
      }
      await service.create(MANAGER, cci, { label: 'JEU' })
      expect(await failure(service.reorder(MANAGER, cci, ids))).toMatchObject({ status: 409 })
    })

    it('is for the workspace’s managers and the administrators only, read again under the lock', async () => {
      const jei = await schemeOf(cci, 'jei')
      const ids = (await service.list(ADMIN, cci)).map((s) => s.id)
      const attempts = (actor: typeof ADMIN) => [
        service.create(actor, cci, { label: 'Pirate' }),
        service.update(actor, cci, jei.id, { label: 'Pirate' }),
        service.update(actor, cci, jei.id, { active: false }),
        service.reorder(actor, cci, ids.slice().reverse()),
      ]
      for (const actor of [ADVISOR, INVESTOR]) {
        for (const attempt of attempts(actor)) {
          expect(await failure(attempt)).toEqual({
            status: 403,
            code: 'WORKSPACE_MANAGEMENT_FORBIDDEN',
          })
        }
      }
      for (const actor of [OUTSIDER, ENTREPRENEUR]) {
        for (const attempt of attempts(actor)) {
          expect(await failure(attempt)).toMatchObject({ status: 404 })
        }
      }
      // The club's manager, through the club, cannot reach the CCI's scheme either.
      expect(await failure(service.update(OUTSIDER, club, jei.id, { label: 'Pirate' }))).toEqual({
        status: 404,
        code: 'ELIGIBILITY_SCHEME_NOT_FOUND',
      })
      expect(await labels(cci)).not.toContain('Pirate')
      expect(record).not.toHaveBeenCalled()
      // The right withdrawn while the write waits for the workspace's lock: nothing written.
      const marie = [...fake.table('workspaceMembership').values()].find(
        (m) => m.userId === MANAGER.id,
      )!
      fake.prisma.$queryRaw.mockImplementationOnce(() => {
        marie.canManageWorkspace = false
        return Promise.resolve([])
      })
      expect(await failure(service.update(MANAGER, cci, jei.id, { label: 'X' }))).toMatchObject({
        status: 403,
      })
      expect(await labels(cci)).toContain('JEI')
    })
  })

  describe('contracts', () => {
    it('validates schemes: label and description on one line, bounded; no key, no position', () => {
      expect(
        createEligibilitySchemeSchema.parse({ label: '  Label \n Green ', description: '   ' }),
      ).toEqual({ label: 'Label Green', description: null })
      for (const body of [
        { label: '   ' },
        { label: 'x'.repeat(81) },
        { label: 'X', description: 'x'.repeat(301) },
        { label: 'X', key: 'x' },
        { label: 'X', active: false },
      ]) {
        expect(createEligibilitySchemeSchema.safeParse(body).success).toBe(false)
      }
      for (const body of [{}, { key: 'x' }, { label: 'X', position: 2 }]) {
        expect(updateEligibilitySchemeSchema.safeParse(body).success).toBe(false)
      }
      const id = '00000000-0000-4000-8000-000000000001'
      expect(reorderEligibilitySchemesSchema.safeParse({ schemeIds: [id, id] }).success).toBe(false)
    })

    it('lets only the workspace verify, and carries no amount', () => {
      const schemeId = '00000000-0000-4000-8000-000000000001'
      expect(declareEligibilitySchema.safeParse({ schemeId, verified: true }).success).toBe(false)
      expect(declareReceivedEligibilitySchema.parse({ schemeId, verified: true })).toEqual({
        schemeId,
        verified: true,
      })
      expect(updateEligibilitySchema.safeParse({ version: 1, verified: true }).success).toBe(false)
      expect(updateEligibilitySchema.parse({ version: 1, note: ' ' })).toEqual({
        version: 1,
        note: null,
      })
      expect(updateReceivedEligibilitySchema.safeParse({ version: 1 }).success).toBe(false)
      for (const body of [
        { schemeId, amountEur: 1000 },
        { schemeId, note: 'x'.repeat(201) },
        { schemeId: 'jei' },
      ]) {
        expect(declareReceivedEligibilitySchema.safeParse(body).success).toBe(false)
      }
    })

    it('parses the received candidatures’ filters, closed to anything else', () => {
      const scheme = '00000000-0000-4000-8000-000000000001'
      expect(
        receivedCandidaturesQuerySchema.parse({
          scheme,
          verified: 'true',
          financingStatus: 'funded',
        }),
      ).toEqual({ scheme, verified: true, financingStatus: 'funded' })
      expect(receivedCandidaturesQuerySchema.parse({ verified: 'false' })).toEqual({
        verified: false,
      })
      for (const query of [
        { scheme: 'jeir' },
        { verified: '1' },
        { financingStatus: 'won' },
        { sector: 'bio' },
      ]) {
        expect(receivedCandidaturesQuerySchema.safeParse(query).success).toBe(false)
      }
    })
  })
})
