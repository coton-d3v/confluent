import { ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common'
import { McpAccess, WORKSPACE_NOT_FOUND, serviceCall } from './mcp-access'
import type { McpCaller } from './mcp.tools'
import { ToolError, type ToolTrace } from './tool-kit'

const W1 = '5b0d6a10-0000-4000-8000-000000000001'
const W2 = '5b0d6a10-0000-4000-8000-000000000002'

function caller(workspaceIds: string[]): McpCaller {
  return {
    user: { id: 'u-1', email: 'claire@nord.fr', role: 'financeur' },
    scopes: ['dossiers:read'],
    clientId: 'client',
    clientName: 'Claude',
    grantId: 'g-1',
    workspaceIds,
  }
}

// ROADMAP E05.10: a workspace is reached only if this connection was allowed it AND the account may
// enter it now (the workspaces' single rule); both refusals read alike.
describe('McpAccess.workspace', () => {
  const scope = { workspace: { id: W1 }, membership: { role: 'conseiller' } }
  function access(resolve: jest.Mock) {
    const prisma = {
      workspace: {
        findUnique: jest.fn(({ where }: { where: { slug: string } }) =>
          Promise.resolve(
            where.slug === 'nord' ? { id: W1 } : where.slug === 'sud' ? { id: W2 } : null,
          ),
        ),
      },
    }
    return new McpAccess(prisma as never, {} as never, { resolve } as never)
  }

  it('resolves an allowed workspace by id or slug through the single access rule, noted in the trace', async () => {
    const resolve = jest.fn().mockResolvedValue(scope)
    for (const ref of [W1, 'nord']) {
      const trace: ToolTrace = { dossierId: null }
      await expect(access(resolve).workspace(caller([W1]), ref, trace)).resolves.toBe(scope)
      expect(trace.workspaceId).toBe(W1)
    }
    expect(resolve).toHaveBeenCalledWith(caller([W1]).user, W1)
  })

  it('refuses a workspace not allowed to the connection before asking whether one is a member', async () => {
    const resolve = jest.fn().mockResolvedValue(scope)
    for (const [allowed, ref] of [
      [[W1], W2],
      [[W1], 'sud'],
      [[], W1],
      [[W1], 'inconnu'],
    ] as const) {
      const trace: ToolTrace = { dossierId: null }
      await expect(access(resolve).workspace(caller([...allowed]), ref, trace)).rejects.toEqual(
        new ToolError(WORKSPACE_NOT_FOUND),
      )
      expect(trace.workspaceId).toBeUndefined()
    }
    expect(resolve).not.toHaveBeenCalled()
  })

  it('answers an allowed workspace the account may no longer enter like an unknown one', async () => {
    const resolve = jest.fn().mockRejectedValue(new NotFoundException())
    const trace: ToolTrace = { dossierId: null }
    await expect(access(resolve).workspace(caller([W1]), W1, trace)).rejects.toEqual(
      new ToolError(WORKSPACE_NOT_FOUND),
    )
    expect(trace.workspaceId).toBeUndefined()
  })

  it('allows content outside any workspace, and a workspace’s only if allowed', () => {
    const a = access(jest.fn())
    expect(a.allows(caller([]), null)).toBe(true)
    expect(a.allows(caller([]), W1)).toBe(false)
    expect(a.allows(caller([W1]), W1)).toBe(true)
    expect(a.allows(caller([W1]), W2)).toBe(false)
  })
})

describe('serviceCall', () => {
  it('passes the services’ refusals on as written, with what they list', async () => {
    const incomplete = new UnprocessableEntityException({
      code: 'DOSSIER_NOT_PUBLISHABLE',
      message: '2 information(s) manquante(s) avant de publier la demande.',
      details: [
        { item: 'summary', label: 'Résumé' },
        { fieldId: 'f-1', label: 'Nom du projet' },
      ],
    })
    await expect(serviceCall(() => Promise.reject(incomplete))).rejects.toEqual(
      new ToolError(
        '2 information(s) manquante(s) avant de publier la demande.\n- Résumé\n- Nom du projet (fieldId f-1)',
      ),
    )
    const conflict = new ConflictException({ code: 'X', message: 'Déjà présentée.' })
    await expect(serviceCall(() => Promise.reject(conflict))).rejects.toEqual(
      new ToolError('Déjà présentée.'),
    )
  })

  it('says where to look for what is not found, whatever the service’s wording', async () => {
    const notFound = new NotFoundException({
      code: 'DOSSIER_NOT_FOUND',
      message: 'Dossier not found.',
    })
    await expect(serviceCall(() => Promise.reject(notFound))).rejects.toThrow(
      'Dossier introuvable, ou vous n’y avez pas accès. Utilisez list_dossiers.',
    )
  })

  it('lets anything else through: an unexpected error stays unexpected', async () => {
    const boom = new Error('db down')
    await expect(serviceCall(() => Promise.reject(boom))).rejects.toBe(boom)
  })
})
