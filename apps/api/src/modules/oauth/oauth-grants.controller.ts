import { Controller, Delete, Get, HttpCode, Param } from '@nestjs/common'
import {
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger'
import type { ConnectedApplication } from '@confluent/shared'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy'
import { OAuthGrantsService } from './oauth-grants.service'

// "Connected applications" (E01.08).
@ApiTags('OAuth')
@ApiBearerAuth('jwt')
@Controller('oauth/applications')
export class OAuthGrantsController {
  constructor(private readonly grants: OAuthGrantsService) {}

  @Get()
  @ApiOperation({
    summary: 'Mes applications connectées',
    description:
      'Une entrée par application (client OAuth) ayant au moins une connexion active : permissions ' +
      'cumulées, nombre de connexions, première connexion, dernière utilisation, dernier outil ' +
      'appelé (`lastAction`, E10.10), expiration.',
  })
  @ApiOkResponse({ description: 'Applications connectées.' })
  list(@CurrentUser() user: AuthenticatedUser): Promise<ConnectedApplication[]> {
    return this.grants.listApplications(user.id)
  }

  @Delete(':clientId')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Retirer l’accès d’une application',
    description:
      'Révoque **toutes** les connexions de l’application et tous leurs jetons, immédiatement : ' +
      'le prochain appel de l’application au serveur MCP reçoit `401`. `clientId` encodé dans l’URL. ' +
      'Idempotent (E10.10) : une application déjà révoquée répond aussi `204`.',
  })
  @ApiNoContentResponse({ description: 'L’application n’a plus aucun accès au compte.' })
  @ApiNotFoundResponse({ description: 'Application jamais connectée à ce compte.' })
  async revoke(
    @CurrentUser() user: AuthenticatedUser,
    @Param('clientId') clientId: string,
  ): Promise<void> {
    await this.grants.revokeApplication(user.id, clientId)
  }
}
