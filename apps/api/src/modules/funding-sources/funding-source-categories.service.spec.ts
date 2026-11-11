import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { HttpException } from '@nestjs/common'
import {
  DEFAULT_FUNDING_SOURCE_CATEGORIES,
  FUNDING_SOURCE_CATEGORY_KEY_PATTERN,
  FUNDING_SOURCE_CATEGORY_LIMITS,
  FUNDING_SOURCE_FAMILIES,
  createFundingSourceCategorySchema,
  fundingSourceFamilyOf,
  reorderFundingSourceCategoriesSchema,
  updateFundingSourceCategorySchema,
} from '@confluent/shared'
import type { PrismaService } from '../../prisma/prisma.service'
import { createFakePrisma } from '../../testing/fake-prisma'
import type { AuditService } from '../audit/audit.service'
import { MemoryStorageAdapter } from '../documents/storage/memory-storage.adapter'
import { WorkspaceAccessService } from '../workspaces/workspace-access'
import { WorkspacesService } from '../workspaces/workspaces.service'
import { FundingSourceCategoriesService, uniqueKey } from './funding-source-categories.service'

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

describe('FundingSourceCategoriesService', () => {
  let fake: ReturnType<typeof createFakePrisma>
  let record: jest.Mock
  let service: FundingSourceCategoriesService
  let workspaces: WorkspacesService
  let cci: string
  let club: string

  beforeEach(async () => {
    fake = createFakePrisma()
    record = jest.fn()
    const audit = { record } as unknown as AuditService
    const prisma = fake.prisma as unknown as PrismaService
    const access = new WorkspaceAccessService(prisma)
    service = new FundingSourceCategoriesService(prisma, access, audit)
    workspaces = new WorkspacesService(prisma, audit, new MemoryStorageAdapter(), access)
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
    (await service.list(as, workspaceId)).map((c) => c.label)
  const categoryOf = async (workspaceId: string, key: string) =>
    (await service.list(ADMIN, workspaceId)).find((c) => c.key === key)!

  describe('defaults (D04, to be confirmed)', () => {
    it('gives a new workspace D04’s six categories, in order, active, BA/love money apart from investment funds', async () => {
      const list = await service.list(ADMIN, cci)
      expect(
        list.map(({ key, label, family, position, active }) => [
          key,
          label,
          family,
          position,
          active,
        ]),
      ).toEqual([
        ['bpifrance', 'Bpifrance', 'aides_publiques', 0, true],
        ['pret_honneur', 'Prêt d’honneur', 'pret_honneur', 1, true],
        ['pret_bancaire', 'Prêt bancaire', 'pret_bancaire', 2, true],
        [
          'business_angels_love_money',
          'Business angels / love money',
          'business_angels_love_money',
          3,
          true,
        ],
        ['fonds_investissement', 'Fonds d’investissement', 'fonds_investissement', 4, true],
        ['fonds_propres', 'Fonds propres', 'fonds_propres', 5, true],
      ])
      // Each workspace has its own rows.
      const other = await service.list(ADMIN, club)
      expect(other.map((c) => c.key)).toEqual(list.map((c) => c.key))
      expect(other.map((c) => c.id).some((id) => list.some((c) => c.id === id))).toBe(false)
    })

    it('keeps the migration’s backfill equal to the defaults and its CHECK equal to the closed families', () => {
      const sql = readFileSync(
        join(
          __dirname,
          '../../../prisma/migrations/20261118000000_funding_source_categories/migration.sql',
        ),
        'utf8',
      )
      const rows = [...sql.matchAll(/\('([a-z_]+)', '([^']+)', '([a-z_]+)', (\d+)\)/g)].map(
        ([, key, label, family, position]) => ({ key, label, family, position: Number(position) }),
      )
      expect(rows).toEqual(
        DEFAULT_FUNDING_SOURCE_CATEGORIES.map((c, position) => ({ ...c, position })),
      )
      expect(sql).toContain(
        `"family" IN (${FUNDING_SOURCE_FAMILIES.map((f) => `'${f}'`).join(', ')})`,
      )
      for (const c of DEFAULT_FUNDING_SOURCE_CATEGORIES) {
        expect(c.key).toMatch(FUNDING_SOURCE_CATEGORY_KEY_PATTERN)
      }
    })
  })

  describe('reading', () => {
    it('is for the workspace’s active conseillers (managing it or not) and the administrators', async () => {
      expect(await labels(cci, MANAGER)).toHaveLength(6)
      expect(await labels(cci, ADVISOR)).toHaveLength(6)
      expect(await labels(cci, ADMIN)).toHaveLength(6)
    })

    it('is closed to an investisseur (403), and to whoever is not an active member (404, as an unknown workspace)', async () => {
      expect(await failure(service.list(INVESTOR, cci))).toEqual({
        status: 403,
        code: 'FUNDING_SOURCES_FORBIDDEN',
      })
      for (const actor of [OUTSIDER, ENTREPRENEUR]) {
        expect(await failure(service.list(actor, cci))).toMatchObject({ status: 404 })
      }
      expect(await failure(service.list(ADVISOR, club))).toMatchObject({ status: 404 })
      const membership = [...fake.table('workspaceMembership').values()].find(
        (m) => m.userId === ADVISOR.id,
      )!
      membership.deactivatedAt = new Date()
      expect(await failure(service.list(ADVISOR, cci))).toMatchObject({ status: 404 })
      // An unknown membership role grants nothing.
      membership.deactivatedAt = null
      membership.role = 'observateur'
      expect(await failure(service.list(ADVISOR, cci))).toMatchObject({ status: 404 })
    })
  })

  describe('configuring', () => {
    it('lets a manager add a category of the workspace’s own, last and active, with a key derived once from its label', async () => {
      const created = await service.create(MANAGER, cci, {
        label: 'Subvention Région',
        family: 'aides_publiques',
      })
      expect(created).toMatchObject({
        key: 'subvention_region',
        label: 'Subvention Région',
        family: 'aides_publiques',
        position: 6,
        active: true,
      })
      expect(record).toHaveBeenCalledWith({
        actionType: 'funding_source_categories_updated',
        actorId: MANAGER.id,
        metadata: expect.objectContaining({
          workspaceId: cci,
          change: 'created',
          key: 'subvention_region',
        }),
      })
      // The other workspace is untouched.
      expect(await labels(club)).toHaveLength(6)
      // Renamed, it keeps its key; a new category with the old label gets a suffixed key.
      await service.update(MANAGER, cci, created.id, { label: 'Aide régionale' })
      const again = await service.create(ADMIN, cci, {
        label: 'Subvention Région',
        family: 'autre',
      })
      expect((await categoryOf(cci, 'subvention_region')).label).toBe('Aide régionale')
      expect(again.key).toBe('subvention_region_2')
    })

    it('refuses a label already used in the workspace, whatever its case, but not one of another workspace', async () => {
      for (const label of ['Prêt bancaire', 'PRÊT BANCAIRE']) {
        expect(await failure(service.create(MANAGER, cci, { label, family: 'autre' }))).toEqual({
          status: 409,
          code: 'FUNDING_SOURCE_LABEL_TAKEN',
        })
      }
      const bpi = await categoryOf(cci, 'bpifrance')
      expect(
        await failure(service.update(MANAGER, cci, bpi.id, { label: 'fonds propres' })),
      ).toEqual({
        status: 409,
        code: 'FUNDING_SOURCE_LABEL_TAKEN',
      })
      // Its own label in another case is a rename, not a clash.
      await service.update(MANAGER, cci, bpi.id, { label: 'BPIFRANCE' })
      await service.create(OUTSIDER, club, { label: 'Crowdfunding', family: 'autre' })
      await service.create(MANAGER, cci, { label: 'Crowdfunding', family: 'autre' })
    })

    it('bounds the number of categories of a workspace', async () => {
      for (let i = 6; i < FUNDING_SOURCE_CATEGORY_LIMITS.perWorkspace; i++) {
        await service.create(MANAGER, cci, { label: `Source ${i}`, family: 'autre' })
      }
      expect(
        await failure(service.create(MANAGER, cci, { label: 'Une de trop', family: 'autre' })),
      ).toEqual({ status: 409, code: 'FUNDING_SOURCE_LIMIT' })
    })

    it('renames, deactivates and reactivates without changing key nor family, never below one active category', async () => {
      const list = await service.list(ADMIN, cci)
      const ba = list.find((c) => c.key === 'business_angels_love_money')!
      const renamed = await service.update(MANAGER, cci, ba.id, {
        label: 'Business angels',
        active: false,
      })
      expect(renamed).toMatchObject({
        id: ba.id,
        key: 'business_angels_love_money',
        family: 'business_angels_love_money',
        label: 'Business angels',
        active: false,
      })
      expect(record).toHaveBeenLastCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            change: 'updated',
            changes: [
              { field: 'label', from: 'Business angels / love money', to: 'Business angels' },
              { field: 'active', from: true, to: false },
            ],
          }),
        }),
      )
      // Deactivated, it is still listed (a plan entered against it keeps reading it).
      expect((await service.list(ADVISOR, cci)).find((c) => c.id === ba.id)?.active).toBe(false)
      for (const c of list.filter((c) => c.id !== ba.id).slice(1)) {
        await service.update(MANAGER, cci, c.id, { active: false })
      }
      expect(await failure(service.update(MANAGER, cci, list[0].id, { active: false }))).toEqual({
        status: 409,
        code: 'FUNDING_SOURCE_LAST_ACTIVE',
      })
      await service.update(MANAGER, cci, ba.id, { active: true })
      await service.update(MANAGER, cci, list[0].id, { active: false })
      // Sending what is already there changes nothing and journals nothing.
      record.mockClear()
      await service.update(MANAGER, cci, ba.id, { label: 'Business angels', active: true })
      expect(record).not.toHaveBeenCalled()
    })

    it('reorders the whole list, refusing a stale or foreign one', async () => {
      const list = await service.list(ADMIN, cci)
      const reversed = list.map((c) => c.id).reverse()
      const result = await service.reorder(MANAGER, cci, reversed)
      expect(result.map((c) => c.key)).toEqual(list.map((c) => c.key).reverse())
      expect(result.map((c) => c.position)).toEqual([0, 1, 2, 3, 4, 5])
      expect(record).toHaveBeenCalledTimes(1)
      record.mockClear()
      await service.reorder(MANAGER, cci, reversed)
      expect(record).not.toHaveBeenCalled()

      const foreign = (await service.list(ADMIN, club))[0].id
      for (const ids of [
        reversed.slice(1),
        [...reversed.slice(1), foreign],
        [...reversed, foreign],
        [...reversed.slice(1), reversed[1]],
      ]) {
        expect(await failure(service.reorder(MANAGER, cci, ids))).toEqual({
          status: 409,
          code: 'FUNDING_SOURCE_ORDER_STALE',
        })
      }
      // A category added meanwhile makes the list the site holds stale.
      await service.create(MANAGER, cci, { label: 'Crowdfunding', family: 'autre' })
      expect(await failure(service.reorder(MANAGER, cci, reversed))).toMatchObject({ status: 409 })
    })

    it('is for the workspace’s managers and the administrators only, and never reaches another workspace’s category', async () => {
      const bpi = await categoryOf(cci, 'bpifrance')
      const ids = (await service.list(ADMIN, cci)).map((c) => c.id)
      const attempts = (actor: typeof ADMIN) => [
        service.create(actor, cci, { label: 'Pirate', family: 'autre' }),
        service.update(actor, cci, bpi.id, { label: 'Pirate' }),
        service.update(actor, cci, bpi.id, { active: false }),
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
      // The club's manager, through the club, cannot reach the CCI's category either.
      expect(await failure(service.update(OUTSIDER, club, bpi.id, { label: 'Pirate' }))).toEqual({
        status: 404,
        code: 'FUNDING_SOURCE_CATEGORY_NOT_FOUND',
      })
      expect(await labels(cci)).toContain('Bpifrance')
      expect(await labels(cci)).not.toContain('Pirate')
      expect(record).not.toHaveBeenCalled()
      // A manager who lost the right is refused at the next request.
      const marie = [...fake.table('workspaceMembership').values()].find(
        (m) => m.userId === MANAGER.id,
      )!
      marie.canManageWorkspace = false
      expect(await failure(service.update(MANAGER, cci, bpi.id, { label: 'X' }))).toMatchObject({
        status: 403,
      })
    })
  })

  describe('contracts', () => {
    it('derives snake_case ASCII keys, unique in the workspace and bounded', () => {
      expect(uniqueKey('Prêt d’honneur Initiative', [])).toBe('pret_d_honneur_initiative')
      expect(uniqueKey('  ***  ', [])).toBe('source')
      expect(uniqueKey('Fonds', [{ key: 'fonds' }, { key: 'fonds_2' }])).toBe('fonds_3')
      const long = uniqueKey('x'.repeat(200), [{ key: 'x'.repeat(56) }])
      expect(long.length).toBeLessThanOrEqual(FUNDING_SOURCE_CATEGORY_LIMITS.key)
      for (const key of ['pret_d_honneur_initiative', 'source', 'fonds_3', long]) {
        expect(key).toMatch(FUNDING_SOURCE_CATEGORY_KEY_PATTERN)
      }
    })

    it('validates labels and families, and never accepts a key or a family change', () => {
      expect(
        createFundingSourceCategorySchema.parse({ label: '  Crowd\n  funding ', family: 'autre' }),
      ).toEqual({ label: 'Crowd funding', family: 'autre' })
      for (const body of [
        { label: '   ', family: 'autre' },
        { label: 'x'.repeat(81), family: 'autre' },
        { label: 'Crowdfunding', family: 'crowdfunding' },
        { label: 'Crowdfunding', family: 'autre', key: 'crowd' },
      ]) {
        expect(createFundingSourceCategorySchema.safeParse(body).success).toBe(false)
      }
      for (const body of [{}, { family: 'autre' }, { key: 'x' }, { label: 'X', position: 2 }]) {
        expect(updateFundingSourceCategorySchema.safeParse(body).success).toBe(false)
      }
      const id = '00000000-0000-4000-8000-000000000001'
      expect(
        reorderFundingSourceCategoriesSchema.safeParse({ categoryIds: [id, id] }).success,
      ).toBe(false)
      expect(reorderFundingSourceCategoriesSchema.safeParse({ categoryIds: [] }).success).toBe(
        false,
      )
    })

    it('reads an unknown family as « autre » (closed by default)', () => {
      expect(fundingSourceFamilyOf('fonds_investissement')).toBe('fonds_investissement')
      for (const raw of ['FONDS_INVESTISSEMENT', 'banque', '', null, undefined]) {
        expect(fundingSourceFamilyOf(raw)).toBe('autre')
      }
    })
  })
})
