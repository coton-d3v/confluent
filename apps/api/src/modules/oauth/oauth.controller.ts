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
import { z } from 'zod'
import { PrismaService } from '../../prisma/prisma.service'
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy'
import { ConfluentOAuthProvider } from './oauth.provider'
import { SCOPE_LABELS, expandScopes, grantableScopes } from './oauth.constants'

const decisionSchema = z.object({
  approve: z.boolean(),
  scopes: z.array(z.string().max(100)).max(20).optional(),
})
class DecisionDto extends createZodDto(decisionSchema) {}

function currentUser(req: Request): AuthenticatedUser {
  return (req as Request & { user: AuthenticatedUser }).user
}

// Backs the web consent screen (/oauth/consent). The user is authenticated with their usual
// Confluent session (magic link), never by the third-party client.
@ApiTags('OAuth')
@ApiBearerAuth('jwt')
@Controller('oauth/requests')
export class OAuthConsentController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly provider: ConfluentOAuthProvider,
  ) {}

  @Get(':id')
  @ApiOperation({
    summary: 'Demande d’autorisation en attente de consentement',
    description:
      'Ce que l’écran de consentement affiche : application, domaine de redirection, permissions ' +
      'demandées. `404` si la demande est inconnue, expirée ou déjà traitée.',
  })
  @ApiOkResponse({ description: 'Demande à présenter à l’utilisateur.' })
  async get(@Req() req: Request, @Param('id') id: string) {
    const request = await this.prisma.oAuthAuthorizationRequest.findUnique({
      where: { id },
      include: { client: true },
    })
    if (!request || request.decidedAt || request.expiresAt.getTime() <= Date.now()) {
      throw new NotFoundException({
        code: 'OAUTH_REQUEST_NOT_FOUND',
        message: 'Authorization request expired or already handled.',
      })
    }
    const metadata = request.client.metadata as { client_uri?: string; logo_uri?: string }
    return {
      id: request.id,
      client: {
        name: request.client.name,
        // MCP spec: the redirect hostname MUST be shown to the user.
        redirectHost: new URL(request.redirectUri).host,
        clientUri: typeof metadata.client_uri === 'string' ? metadata.client_uri : null,
        verifiedByMetadataDocument: request.client.source === 'cimd',
      },
      // Effective permissions: writing implies reading on the server, so both are shown (R17). Only
      // what this account may grant: `forms:write` is never offered to a non-administrator.
      scopes: grantableScopes(expandScopes(request.scopes), currentUser(req))
        .sort()
        .map((scope) => ({ scope, label: SCOPE_LABELS[scope] ?? scope })),
      expiresAt: request.expiresAt.toISOString(),
    }
  }

  @Post(':id/decision')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Accepter ou refuser une demande d’autorisation',
    description:
      'Accepté : crée la connexion (grant) avec les permissions retenues et un code d’autorisation ' +
      'à usage unique. Refusé : `error=access_denied`. Renvoie l’URL de redirection vers l’application.',
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
