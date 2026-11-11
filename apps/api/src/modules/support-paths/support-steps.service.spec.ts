import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { HttpException } from '@nestjs/common'
import {
  DEFAULT_SUPPORT_STEPS,
  SUPPORT_STEP_KEY_PATTERN,
  SUPPORT_STEP_LIMITS,
  createSupportStepSchema,
  reorderSupportStepsSchema,
  setSupportStepValidationSchema,
  updateSupportStepSchema,
} from '@confluent/shared'
import type { PrismaService } from '../../prisma/prisma.service'
import { createFakePrisma } from '../../testing/fake-prisma'
import type { AuditService } from '../audit/audit.service'
import { MemoryStorageAdapter } from '../documents/storage/memory-storage.adapter'
import { WorkspaceAccessService } from '../workspaces/workspace-access'
import { WorkspacesService } from '../workspaces/workspaces.service'
import { SupportStepsService } from './support-steps.service'

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
  '../../../prisma/migrations/20261121000000_support_paths/migration.sql',
)
const DOWN = join(__dirname, '../../../prisma/checks/20261121000000_support_paths.down.sql')

// ROADMAP E06.06: the support path of a workspace — the default steps at its creation, read by its
// conseillers, configured by its managers — and the contracts that keep explanations plain text.
describe('SupportStepsService', () => {
  let fake: ReturnType<typeof createFakePrisma>
  let record: jest.Mock
  let service: SupportStepsService
  let cci: string
  let club: string

  beforeEach(async () => {
    fake = createFakePrisma()
    record = jest.fn()
    const audit = { record } as unknown as AuditService
    const prisma = fake.prisma as unknown as PrismaService
    const access = new WorkspaceAccessService(prisma)
    service = new SupportStepsService(prisma, access, audit)
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
  const stepOf = async (workspaceId: string, key: string) =>
    (await service.list(ADMIN, workspaceId)).find((s) => s.key === key)!

  describe('defaults', () => {
    it('gives a new workspace the three default steps, in order, active, explained', async () => {
      const list = await service.list(ADMIN, cci)
      expect(
        list.map(({ key, label, position, active }) => [key, label, position, active]),
      ).toEqual([
        ['diagnostic', 'Diagnostic', 0, true],
        ['business_plan', 'Business plan', 1, true],
        ['pitch', 'Pitch', 2, true],
      ])
      expect(list.every((s) => s.explanation && s.explanation.length > 0)).toBe(true)
      // Each workspace has its own rows.
      const other = await service.list(ADMIN, club)
      expect(other.map((s) => s.key)).toEqual(list.map((s) => s.key))
      expect(other.some((s) => list.some((c) => c.id === s.id))).toBe(false)
    })

    it('keeps the migration’s backfill and the revert’s check equal to the defaults, within the limits', () => {
      const pattern = /\('([a-z_]+)', '([^']+)', '([^']+)', (\d+)\)/g
      const parsed = (sql: string) =>
        [...sql.matchAll(pattern)].map(([, key, label, explanation, position]) => ({
          key,
          label,
          explanation,
          position: Number(position),
        }))
      const expected = DEFAULT_SUPPORT_STEPS.map((s, position) => ({ ...s, position }))
      expect(parsed(readFileSync(MIGRATION, 'utf8'))).toEqual(expected)
      expect(parsed(readFileSync(DOWN, 'utf8'))).toEqual(expected)
      for (const s of DEFAULT_SUPPORT_STEPS) {
        expect(s.key).toMatch(SUPPORT_STEP_KEY_PATTERN)
        expect(
          createSupportStepSchema.parse({ label: s.label, explanation: s.explanation }),
        ).toEqual({ label: s.label, explanation: s.explanation })
      }
      const sql = readFileSync(MIGRATION, 'utf8')
      expect(sql).toContain(`char_length("key") <= ${SUPPORT_STEP_LIMITS.key}`)
      expect(sql).toContain(`char_length("label") BETWEEN 1 AND ${SUPPORT_STEP_LIMITS.label}`)
      expect(sql).toContain(
        `char_length("explanation") BETWEEN 1 AND ${SUPPORT_STEP_LIMITS.explanation}`,
      )
    })
  })

  describe('reading', () => {
    it('is for the workspace’s active conseillers (managing it or not) and the administrators', async () => {
      expect(await labels(cci, MANAGER)).toHaveLength(3)
      expect(await labels(cci, ADVISOR)).toHaveLength(3)
      expect(await labels(cci, ADMIN)).toHaveLength(3)
    })

    it('is closed to an investisseur (403), and to whoever is not an active member (404)', async () => {
      expect(await failure(service.list(INVESTOR, cci))).toEqual({
        status: 403,
        code: 'SUPPORT_STEPS_FORBIDDEN',
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
    it('adds a step last, with a key derived once from its label, suffixed when taken', async () => {
      const committee = await service.create(MANAGER, cci, {
        label: 'Passage en comité',
        explanation: 'Le projet est présenté au comité.\n\nVotre conseiller vous y prépare.',
      })
      expect(committee).toMatchObject({
        key: 'passage_en_comite',
        position: 3,
        active: true,
        explanation: 'Le projet est présenté au comité.\n\nVotre conseiller vous y prépare.',
      })
      // Renamed, its key stays; a new step named like the old label is suffixed.
      await service.update(MANAGER, cci, committee.id, { label: 'Comité' })
      const again = await service.create(MANAGER, cci, { label: 'Passage en comité' })
      expect(again.key).toBe('passage_en_comite_2')
      const blank = await service.create(MANAGER, cci, { label: '***' })
      expect(blank).toMatchObject({ key: 'etape', explanation: null })
      expect(record).toHaveBeenCalledWith(
        expect.objectContaining({
          actionType: 'support_steps_updated',
          actorId: MANAGER.id,
          metadata: expect.objectContaining({ workspaceId: cci, change: 'created' }),
        }),
      )
    })

    it('tells labels apart without regard to case, and caps the path', async () => {
      expect(await failure(service.create(MANAGER, cci, { label: 'PITCH' }))).toEqual({
        status: 409,
        code: 'SUPPORT_STEP_LABEL_TAKEN',
      })
      const pitch = await stepOf(cci, 'pitch')
      expect(
        await failure(service.update(MANAGER, cci, pitch.id, { label: 'diagnostic' })),
      ).toEqual({ status: 409, code: 'SUPPORT_STEP_LABEL_TAKEN' })
      // Its own label in another case is a rename.
      expect((await service.update(MANAGER, cci, pitch.id, { label: 'pitch' })).label).toBe('pitch')
      for (let n = 3; n < SUPPORT_STEP_LIMITS.perWorkspace; n++) {
        await service.create(MANAGER, cci, { label: `Étape ${n}` })
      }
      expect(await failure(service.create(MANAGER, cci, { label: 'De trop' }))).toEqual({
        status: 409,
        code: 'SUPPORT_STEP_LIMIT',
      })
    })

    it('explains, deactivates every step if wished, and writes nothing unchanged', async () => {
      for (const s of await service.list(ADMIN, cci)) {
        await service.update(MANAGER, cci, s.id, { active: false })
      }
      expect((await service.list(ADMIN, cci)).every((s) => !s.active)).toBe(true)
      const pitch = await stepOf(cci, 'pitch')
      const cleared = await service.update(MANAGER, cci, pitch.id, { explanation: null })
      expect(cleared.explanation).toBeNull()
      record.mockClear()
      fake.prisma.supportStep.update.mockClear()
      await service.update(MANAGER, cci, pitch.id, {
        label: 'Pitch',
        explanation: null,
        active: false,
      })
      expect(record).not.toHaveBeenCalled()
      expect(fake.prisma.supportStep.update).not.toHaveBeenCalled()
      expect(await failure(service.update(MANAGER, cci, 'unknown', { active: true }))).toEqual({
        status: 404,
        code: 'SUPPORT_STEP_NOT_FOUND',
      })
    })

    it('reorders the whole path only', async () => {
      const ids = (await service.list(ADMIN, cci)).map((s) => s.id)
      const reversed = ids.slice().reverse()
      expect((await service.reorder(MANAGER, cci, reversed)).map((s) => s.key)).toEqual([
        'pitch',
        'business_plan',
        'diagnostic',
      ])
      for (const stale of [ids.slice(1), [...ids.slice(1), (await stepOf(club, 'pitch')).id]]) {
        expect(await failure(service.reorder(MANAGER, cci, stale))).toEqual({
          status: 409,
          code: 'SUPPORT_STEP_ORDER_STALE',
        })
      }
      await service.create(MANAGER, cci, { label: 'Comité' })
      expect(await failure(service.reorder(MANAGER, cci, ids))).toMatchObject({ status: 409 })
    })

    it('is for the workspace’s managers and the administrators only, read again under the lock', async () => {
      const pitch = await stepOf(cci, 'pitch')
      const ids = (await service.list(ADMIN, cci)).map((s) => s.id)
      const attempts = (actor: typeof ADMIN) => [
        service.create(actor, cci, { label: 'Pirate' }),
        service.update(actor, cci, pitch.id, { label: 'Pirate' }),
        service.update(actor, cci, pitch.id, { active: false }),
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
      // The club's manager, through the club, cannot reach the CCI's step either.
      expect(await failure(service.update(OUTSIDER, club, pitch.id, { label: 'Pirate' }))).toEqual({
        status: 404,
        code: 'SUPPORT_STEP_NOT_FOUND',
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
      expect(await failure(service.update(MANAGER, cci, pitch.id, { label: 'X' }))).toMatchObject({
        status: 403,
      })
      expect(await labels(cci)).toContain('Pitch')
    })
  })

  describe('contracts', () => {
    it('keeps the label on one line and the explanation in plain paragraphs, bounded; no key, no position', () => {
      expect(
        createSupportStepSchema.parse({
          label: '  Passage \n en  comité ',
          explanation: '  Première\tligne  \r\n\r\n\r\n\r\n  Seconde\u0007 ligne \n',
        }),
      ).toEqual({ label: 'Passage en comité', explanation: 'Première ligne\n\nSeconde ligne' })
      expect(createSupportStepSchema.parse({ label: 'X', explanation: ' \n ' })).toEqual({
        label: 'X',
        explanation: null,
      })
      // Shown as written, never interpreted: markup is refused, a « < » in a sentence is not.
      expect(
        createSupportStepSchema.parse({ label: 'X', explanation: 'Moins de 10 salariés (< 10)' })
          .explanation,
      ).toBe('Moins de 10 salariés (< 10)')
      for (const body of [
        { label: '   ' },
        { label: 'x'.repeat(81) },
        { label: 'X', explanation: 'x'.repeat(1001) },
        { label: 'X', explanation: 'Voir <a href="https://exemple.fr">le guide</a>' },
        { label: 'X', explanation: '<script>alert(1)</script>' },
        { label: 'X', explanation: 'Fin <br/>' },
        { label: 'X', key: 'x' },
        { label: 'X', active: false },
      ]) {
        expect([body, createSupportStepSchema.safeParse(body).success]).toEqual([body, false])
      }
      for (const body of [{}, { key: 'x' }, { label: 'X', position: 2 }]) {
        expect(updateSupportStepSchema.safeParse(body).success).toBe(false)
      }
      const id = '00000000-0000-4000-8000-000000000001'
      expect(reorderSupportStepsSchema.safeParse({ stepIds: [id, id] }).success).toBe(false)
    })

    it('validates a step from the version read, and nothing else', () => {
      expect(setSupportStepValidationSchema.parse({ validated: true, version: 0 })).toEqual({
        validated: true,
        version: 0,
      })
      for (const body of [
        { validated: true },
        { version: 1 },
        { validated: 'oui', version: 1 },
        { validated: true, version: -1 },
        { validated: true, version: 1.5 },
        { validated: true, version: 1, validatedById: 'x' },
        { validated: true, version: 1, validatedAt: '2026-01-01T00:00:00.000Z' },
      ]) {
        expect(setSupportStepValidationSchema.safeParse(body).success).toBe(false)
      }
    })
  })
})
