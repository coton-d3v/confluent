import { Injectable, NotFoundException } from '@nestjs/common'
import type { ConnectedApplication } from '@confluent/shared'
import { PrismaService } from '../../prisma/prisma.service'
import { SCOPE_LABELS, expandScopes } from './oauth.constants'
import { ConfluentOAuthProvider } from './oauth.provider'

// "Connected applications" (E01.08): the AI clients the user authorized, grouped by application —
// one application may hold several authorizations (one per device or conversation) — and how to
// cut an application off entirely (code review R21).
@Injectable()
export class OAuthGrantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly provider: ConfluentOAuthProvider,
  ) {}

  async listApplications(userId: string): Promise<ConnectedApplication[]> {
    const grants = await this.prisma.oAuthGrant.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      include: { client: true },
      orderBy: { createdAt: 'desc' },
    })
    const workspaces = await this.prisma.workspace.findMany({
      where: { id: { in: [...new Set(grants.flatMap((g) => g.workspaceIds))] } },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    })
    const lastActions = await this.lastActions(userId, [...new Set(grants.map((g) => g.clientId))])
    const byClient = new Map<string, typeof grants>()
    for (const grant of grants)
      byClient.set(grant.clientId, [...(byClient.get(grant.clientId) ?? []), grant])
    return [...byClient.values()].map((clientGrants) => {
      const { client } = clientGrants[0]
      const metadata = client.metadata as { client_uri?: unknown }
      const scopes = new Set(clientGrants.flatMap((g) => [...expandScopes(g.scopes)]))
      const workspaceIds = new Set(clientGrants.flatMap((g) => g.workspaceIds))
      const times = (pick: (g: (typeof clientGrants)[number]) => Date | null) =>
        clientGrants
          .map(pick)
          .filter((d): d is Date => d !== null)
          .map((d) => d.getTime())
      const lastUsed = times((g) => g.lastUsedAt)
      return {
        clientId: client.id,
        application: {
          name: client.name,
          clientUri: typeof metadata.client_uri === 'string' ? metadata.client_uri : null,
        },
        scopes: [...scopes].sort().map((scope) => ({ scope, label: SCOPE_LABELS[scope] ?? scope })),
        // E05.10: the workspaces it was allowed to reach (each still checked at every call).
        workspaces: workspaces
          .filter((w) => workspaceIds.has(w.id))
          .map((w) => ({ id: w.id, name: w.name })),
        connections: clientGrants.length,
        connectedAt: new Date(Math.min(...times((g) => g.createdAt))).toISOString(),
        lastUsedAt: lastUsed.length ? new Date(Math.max(...lastUsed)).toISOString() : null,
        lastAction: lastActions.get(client.id) ?? null,
        expiresAt: new Date(Math.max(...times((g) => g.expiresAt))).toISOString(),
      }
    })
  }

  // E10.10 (U06): the last tool each application called on the person's behalf, from their own
  // journal (`mcp_tool_called`: who, which client, which tool, its outcome). One read per
  // application, on the actor's index.
  private async lastActions(
    userId: string,
    clientIds: string[],
  ): Promise<Map<string, { tool: string; at: string; succeeded: boolean }>> {
    const found = new Map<string, { tool: string; at: string; succeeded: boolean }>()
    for (const clientId of clientIds) {
      const entry = await this.prisma.auditLog.findFirst({
        where: {
          actorId: userId,
          actionType: 'mcp_tool_called',
          metadata: { path: ['clientId'], equals: clientId },
        },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true, metadata: true },
      })
      const meta = (entry?.metadata ?? {}) as { tool?: unknown; result?: unknown }
      if (entry && typeof meta.tool === 'string') {
        found.set(clientId, {
          tool: meta.tool,
          at: entry.createdAt.toISOString(),
          succeeded: meta.result === 'ok',
        })
      }
    }
    return found
  }

  // Revokes every authorization of the application and all their tokens. E10.10 (U07): asked again
  // — a retry after a lost answer, a second click — it answers the same: the application has no
  // access any more. Only an application this account never connected is unknown (`404`).
  async revokeApplication(userId: string, clientId: string): Promise<number> {
    const grants = await this.prisma.oAuthGrant.findMany({
      where: { userId, clientId, revokedAt: null },
      select: { id: true },
    })
    if (grants.length === 0) {
      const known = await this.prisma.oAuthGrant.count({ where: { userId, clientId } })
      if (known > 0) return 0
      throw new NotFoundException({
        code: 'OAUTH_APPLICATION_NOT_FOUND',
        message: 'Cette application n’est pas connectée à votre compte.',
      })
    }
    let revoked = 0
    for (const { id } of grants) {
      if (await this.provider.revokeGrant(id, userId, 'user_revocation')) revoked++
    }
    return revoked
  }
}
