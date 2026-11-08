import { Controller, Delete, Get, HttpCode, NotFoundException, Param, Req } from '@nestjs/common'
import {
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger'
import type { Request } from 'express'
import { PrismaService } from '../../prisma/prisma.service'
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy'
import { ConfluentOAuthProvider } from './oauth.provider'
import { SCOPE_LABELS, expandScopes } from './oauth.constants'

function currentUser(req: Request): AuthenticatedUser {
  return (req as Request & { user: AuthenticatedUser }).user
}

// "Connected applications" (E01.08): the AI clients the user authorized, and how to cut them off.
@ApiTags('OAuth')
@ApiBearerAuth('jwt')
@Controller('oauth/grants')
export class OAuthGrantsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly provider: ConfluentOAuthProvider,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Mes applications connectées',
    description:
      'Connexions OAuth actives (non révoquées, non expirées) de l’utilisateur : application, ' +
      'permissions, date de connexion, dernière utilisation, expiration.',
  })
  @ApiOkResponse({ description: 'Liste des connexions actives.' })
  async list(@Req() req: Request) {
    const grants = await this.prisma.oAuthGrant.findMany({
      where: { userId: currentUser(req).id, revokedAt: null, expiresAt: { gt: new Date() } },
      include: { client: true },
      orderBy: { createdAt: 'desc' },
    })
    return grants.map((g) => {
      const metadata = g.client.metadata as { client_uri?: unknown }
      return {
        id: g.id,
        application: {
          name: g.client.name,
          clientUri: typeof metadata.client_uri === 'string' ? metadata.client_uri : null,
        },
        scopes: [...expandScopes(g.scopes)].map((scope) => ({
          scope,
          label: SCOPE_LABELS[scope] ?? scope,
        })),
        connectedAt: g.createdAt.toISOString(),
        lastUsedAt: g.lastUsedAt?.toISOString() ?? null,
        expiresAt: g.expiresAt.toISOString(),
      }
    })
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Révoquer une application connectée',
    description:
      'Révoque la connexion et tous ses jetons, immédiatement : le prochain appel de l’application ' +
      'au serveur MCP reçoit `401`.',
  })
  @ApiNoContentResponse({ description: 'Connexion révoquée.' })
  @ApiNotFoundResponse({
    description: 'Connexion inconnue, déjà révoquée ou d’un autre utilisateur.',
  })
  async revoke(@Req() req: Request, @Param('id') id: string): Promise<void> {
    const user = currentUser(req)
    const grant = await this.prisma.oAuthGrant.findUnique({ where: { id } })
    if (!grant || grant.userId !== user.id || grant.revokedAt) {
      throw new NotFoundException({
        code: 'OAUTH_GRANT_NOT_FOUND',
        message: 'Connection not found.',
      })
    }
    await this.provider.revokeGrant(grant.id, user.id, 'user_revocation')
  }
}
