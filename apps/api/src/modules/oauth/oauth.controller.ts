import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Req,
} from '@nestjs/common'
import {
  ApiBearerAuth,
  ApiBadRequestResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger'
import { OAuthError } from '@modelcontextprotocol/sdk/server/auth/errors.js'
import type { Request } from 'express'
import { createZodDto } from 'nestjs-zod'
import { oauthConsentDecisionSchema } from '@confluent/shared'
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy'
import { ConfluentOAuthProvider } from './oauth.provider'

class DecisionDto extends createZodDto(oauthConsentDecisionSchema) {}

function currentUser(req: Request): AuthenticatedUser {
  return (req as Request & { user: AuthenticatedUser }).user
}

// Backs the web consent screen (/oauth/consent). The user is authenticated with their usual
// Confluent session (magic link), never by the third-party client.
@ApiTags('OAuth')
@ApiBearerAuth('jwt')
@Controller('oauth/requests')
export class OAuthConsentController {
  constructor(private readonly provider: ConfluentOAuthProvider) {}

  @Get(':id')
  @ApiOperation({
    summary: 'Demande d’autorisation en attente de consentement',
    description:
      'Ce que l’écran de consentement affiche : application, domaine de redirection, permissions ' +
      'demandées que ce compte peut accorder, workspaces que l’application peut être autorisée à ' +
      'voir (appartenances actives, E05.10). `404` si la demande est inconnue, expirée ou déjà traitée.',
  })
  @ApiOkResponse({ description: 'Demande à présenter à l’utilisateur.' })
  async get(@Req() req: Request, @Param('id') id: string) {
    const request = await this.provider.describeRequest(id, currentUser(req))
    if (!request) {
      throw new NotFoundException({
        code: 'OAUTH_REQUEST_NOT_FOUND',
        message: 'Authorization request expired or already handled.',
      })
    }
    return request
  }

  @Post(':id/decision')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Accepter ou refuser une demande d’autorisation',
    description:
      'Accepté : crée la connexion (grant) avec les permissions et les workspaces retenus (aucun ' +
      'par défaut, parmi les appartenances actives) et un code d’autorisation à usage unique. ' +
      'Refusé : `error=access_denied`. Renvoie l’URL de redirection vers l’application.',
  })
  @ApiOkResponse({ description: '`{ redirectUrl }` vers l’application cliente.' })
  @ApiBadRequestResponse({ description: 'Demande expirée, déjà traitée ou permissions invalides.' })
  async decide(@Req() req: Request, @Param('id') id: string, @Body() body: DecisionDto) {
    try {
      const redirectUrl = await this.provider.decide(
        id,
        currentUser(req),
        body.approve,
        body.scopes,
        body.workspaceIds,
      )
      return { redirectUrl }
    } catch (err) {
      if (err instanceof OAuthError) {
        throw new BadRequestException({ code: 'OAUTH_REQUEST_INVALID', message: err.message })
      }
      throw err
    }
  }
}
