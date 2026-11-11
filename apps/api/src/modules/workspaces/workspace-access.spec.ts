import { HttpException } from '@nestjs/common'
import type { PrismaService } from '../../prisma/prisma.service'
import { createFakePrisma } from '../../testing/fake-prisma'
import type { AuditService } from '../audit/audit.service'
import { MemoryStorageAdapter } from '../documents/storage/memory-storage.adapter'
import { WorkspaceAccessService, canEnterWorkspace, isActiveMembership } from './workspace-access'
import { WorkspacesService } from './workspaces.service'

const ADMIN = { id: 'admin-1', role: 'admin' }
const UNKNOWN = '00000000-0000-4000-8000-000000000000'

const failure = (promise: Promise<unknown>) =>
  promise.then(
    () => null,
    (e: unknown) => e,
  )
const answerOf = (err: unknown) =>
  err instanceof HttpException ? { status: err.getStatus(), body: err.getResponse() } : err

// ROADMAP E05.03: which workspace a request acts in, resolved for its actor at each request.
describe('workspace access', () => {
  let fake: ReturnType<typeof createFakePrisma>
  let access: WorkspaceAccessService
  let workspaces: WorkspacesService
  let cci: string
  let club: string

  beforeEach(async () => {
    fake = createFakePrisma()
    const prisma = fake.prisma as unknown as PrismaService
    access = new WorkspaceAccessService(prisma)
    workspaces = new WorkspacesService(
      prisma,
      { record: jest.fn() } as unknown as AuditService,
      new MemoryStorageAdapter(),
      access,
    )
    cci = (await workspaces.create(ADMIN, { name: 'CCI Touraine', emailDomain: 'cci.fr' })).id
    club = (await workspaces.create(ADMIN, { name: 'Club deal' })).id
  })

  const member = (
    workspaceId: string,
    userId: string,
    fields: Partial<{ role: string; canManageWorkspace: boolean; deactivatedAt: Date | null }> = {},
  ) =>
    fake.prisma.workspaceMembership.create({
      data: {
        workspaceId,
        userId,
        role: 'investisseur',
        canManageWorkspace: false,
        deactivatedAt: null,
        ...fields,
      },
    })

  it('lets an administrator or an active member enter, closed for anything else', () => {
    const active = { role: 'investisseur', deactivatedAt: null }
    expect(canEnterWorkspace({ role: 'admin' }, null)).toBe(true)
    expect(canEnterWorkspace({ role: 'entrepreneur' }, active)).toBe(true)
    expect(canEnterWorkspace({ role: 'financeur' }, { ...active, role: 'conseiller' })).toBe(true)
    // The global role never opens a workspace (admin aside), nor a membership that grants nothing.
    for (const role of ['entrepreneur', 'financeur', 'ADMIN', '']) {
      expect(canEnterWorkspace({ role }, null)).toBe(false)
    }
    for (const membership of [
      { ...active, deactivatedAt: new Date() },
      { ...active, role: 'gestionnaire' },
      { ...active, role: '' },
    ]) {
      expect(isActiveMembership(membership)).toBe(false)
      expect(canEnterWorkspace({ role: 'financeur' }, membership)).toBe(false)
    }
  })

  it('resolves each workspace of a person with several memberships, and none other', async () => {
    const claire = { id: 'claire', role: 'financeur' }
    await member(cci, claire.id)
    await member(club, claire.id, { role: 'conseiller', canManageWorkspace: true })
    const inCci = await access.resolve(claire, cci)
    expect(inCci.workspace.id).toBe(cci)
    expect(inCci.membership).toMatchObject({ role: 'investisseur', workspaceId: cci })
    const inClub = await access.resolve(claire, club)
    expect(inClub.membership).toMatchObject({ role: 'conseiller', workspaceId: club })
    // Managing is a finer right inside: she manages the club, not the CCI.
    await expect(access.assertCanManage(claire, club)).resolves.toMatchObject({
      workspace: { id: club },
    })
    expect(answerOf(await failure(access.assertCanManage(claire, cci)))).toMatchObject({
      status: 403,
    })

    const third = (await workspaces.create(ADMIN, { name: 'Réseau Entreprendre' })).id
    expect(answerOf(await failure(access.resolve(claire, third)))).toMatchObject({ status: 404 })
  })

  it('answers the same for a workspace that does not exist and one the account is not in', async () => {
    const luc = { id: 'luc', role: 'entrepreneur' }
    await member(club, luc.id, { role: 'conseiller', canManageWorkspace: true })
    const notIn = answerOf(await failure(access.resolve(luc, cci)))
    const missing = answerOf(await failure(access.resolve(luc, UNKNOWN)))
    expect(notIn).toEqual({
      status: 404,
      body: {
        code: 'WORKSPACE_NOT_FOUND',
        message: 'Workspace introuvable, ou vous n’en êtes pas membre.',
      },
    })
    expect(missing).toEqual(notIn)
    // The management check gives no more away.
    expect(answerOf(await failure(access.assertCanManage(luc, cci)))).toEqual(notIn)
    expect(answerOf(await failure(access.assertCanManage(luc, UNKNOWN)))).toEqual(notIn)
  })

  it('reads the membership at each call: deactivated, the workspace closes at once', async () => {
    const luc = { id: 'luc', role: 'financeur' }
    const row = await member(cci, luc.id)
    await expect(access.resolve(luc, cci)).resolves.toMatchObject({ workspace: { id: cci } })
    fake.table('workspaceMembership').get(row.id)!.deactivatedAt = new Date()
    expect(answerOf(await failure(access.resolve(luc, cci)))).toMatchObject({ status: 404 })
    fake.table('workspaceMembership').get(row.id)!.deactivatedAt = null
    fake.table('workspaceMembership').get(row.id)!.role = 'observateur'
    expect(answerOf(await failure(access.resolve(luc, cci)))).toMatchObject({ status: 404 })
  })

  it('opens every workspace to an administrator, without a membership, but not a missing one', async () => {
    const inCci = await access.resolve(ADMIN, cci)
    expect(inCci).toMatchObject({ workspace: { id: cci }, membership: null })
    // A deactivated membership of an administrator is not theirs to use either.
    await member(club, ADMIN.id, { deactivatedAt: new Date() })
    await expect(access.resolve(ADMIN, club)).resolves.toMatchObject({ membership: null })
    expect(answerOf(await failure(access.resolve(ADMIN, UNKNOWN)))).toMatchObject({ status: 404 })
  })

  it('shows a member the workspace they enter, without its management settings', async () => {
    const claire = { id: 'claire', role: 'financeur' }
    await member(cci, claire.id, { role: 'investisseur' })
    const view = await workspaces.enter(claire, cci)
    expect(view).toEqual({
      workspace: expect.objectContaining({ id: cci, name: 'CCI Touraine', logo: null }),
      membership: {
        id: expect.any(String),
        role: 'investisseur',
        organization: null,
        investorType: null,
        canManageWorkspace: false,
      },
      canManageWorkspace: false,
    })
    expect(view.workspace).not.toHaveProperty('emailDomain')
    await expect(workspaces.enter(ADMIN, cci)).resolves.toMatchObject({
      membership: null,
      canManageWorkspace: true,
    })
    expect(answerOf(await failure(workspaces.enter(claire, club)))).toMatchObject({ status: 404 })
  })
})
