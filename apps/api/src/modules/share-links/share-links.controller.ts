import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import {
  ApiAcceptedResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger'
import type { Request } from 'express'
import type { ShareLink } from '@prisma/client'
import { createShareLinkSchema, shareAccessRequestSchema } from '@confluent/shared'
import { createZodDto } from 'nestjs-zod'
import { Public } from '../../common/decorators/public.decorator'
import { ShareLinkGuard, type AugmentedRequest } from '../auth/guards/share-link.guard'
import { ShareLinksService, type FinanceurShareResponse } from './share-links.service'
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy'

class CreateShareLinkDto extends createZodDto(createShareLinkSchema) {}
class ShareAccessRequestDto extends createZodDto(shareAccessRequestSchema) {}

function currentUser(req: Request): AuthenticatedUser {
  return (req as Request & { user: AuthenticatedUser }).user
}

@ApiTags('Partages')
@Controller()
export class ShareLinksController {
  constructor(private readonly service: ShareLinksService) {}

  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @UseGuards(ShareLinkGuard)
  @ApiBearerAuth('jwt')
  @Get('shares/:token')
  @ApiOperation({
    summary: '[Financeur] Consulter un dossier via un lien de partage',
    description:
      'Exige la **session du destinataire** (JWT) en plus du token UUIDv4 de l’URL : sans session ' +
      '`401` (le visiteur passe par `POST /shares/:token/access-request`), autre compte `403` ' +
      '(`details.reason = "recipient_mismatch"`). Le `ShareLinkGuard` vérifie que le token existe et que `status === "active"` ; ' +
      'sinon `403` générique (pas de leak) + entrée `audit_log: share_link_access_denied` avec token hashé SHA-256. ' +
      'Les accès valides génèrent un `audit_log: share_link_viewed` pour les analytics entrepreneur (FR23).\n\n' +
      'Rate-limit 10 req/min/IP.',
  })
  @ApiParam({
    name: 'token',
    description: 'UUIDv4 du share link',
    example: '123e4567-e89b-42d3-a456-556642440000',
  })
  @ApiOkResponse({ description: 'Dossier scopé (id, name, slug) + métadonnées du partage.' })
  @ApiForbiddenResponse({
    description: 'Token inconnu, révoqué, expiré, ou erreur DB. Réponse générique `ACCESS_DENIED`.',
  })
  @ApiTooManyRequestsResponse({ description: 'Rate limit atteint (10/min).' })
  async getShare(@Req() req: Request): Promise<FinanceurShareResponse> {
    const aug = req as AugmentedRequest & { user: AuthenticatedUser }
    const shareLink = aug.shareLink!
    this.service.assertRecipient(shareLink, aug.user)
    await this.service.recordView(shareLink, req)
    return this.service.resolveForFinanceur(shareLink)
  }

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @UseGuards(ShareLinkGuard)
  @Post('shares/:token/access-request')
  @HttpCode(202)
  @ApiOperation({
    summary: '[Financeur] Demander un lien de connexion pour ouvrir un partage',
    description:
      'Le visiteur d’un lien de partage indique son adresse. Si c’est celle du destinataire du ' +
      'partage, le magic-link habituel lui est envoyé ; sinon rien n’est envoyé. La réponse est ' +
      'toujours la même (`202`) pour ne pas révéler l’adresse du destinataire. Tracé ' +
      '`share_link_access_requested`. Rate-limit 5 req/min/IP.',
  })
  @ApiParam({ name: 'token', description: 'UUIDv4 du share link' })
  @ApiAcceptedResponse({
    description: 'Demande prise en compte (réponse identique dans tous les cas).',
  })
  @ApiForbiddenResponse({ description: 'Lien inconnu, révoqué ou expiré.' })
  async requestAccess(@Req() req: Request, @Body() body: ShareAccessRequestDto) {
    const shareLink = (req as AugmentedRequest).shareLink!
    await this.service.requestAccess(shareLink, body.email, req)
    return { message: 'If this address is the recipient, a sign-in link has been sent.' }
  }

  @Post('dossiers/:id/shares')
  @HttpCode(201)
  @ApiBearerAuth('jwt')
  @ApiOperation({
    summary: 'Créer un lien de partage vers un financeur',
    description:
      'Génère un `share_link` avec un token UUIDv4 (`crypto.randomUUID()`), status `active`, ' +
      'envoie un mail d’invitation au `recipientEmail` avec l’URL `${FRONTEND_URL}/share/<token>`. ' +
      'Audit : `share_link_created`. L’échec d’envoi du mail n’annule pas la création (best-effort).',
  })
  @ApiParam({ name: 'id', description: 'UUID du dossier' })
  @ApiCreatedResponse({
    description: 'Share link créé + URL complète à présenter à l’utilisateur.',
  })
  @ApiUnauthorizedResponse({ description: 'JWT manquant.' })
  @ApiNotFoundResponse({ description: 'Dossier inexistant ou possédé par un autre user.' })
  create(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: CreateShareLinkDto,
  ): Promise<ShareLink & { shareUrl: string }> {
    const { accessLevel } = body as { recipientEmail: string; accessLevel?: string }
    return this.service.create({
      dossierId: id,
      userId: currentUser(req).id,
      recipientEmail: body.recipientEmail,
      accessLevel,
    })
  }

  @Get('dossiers/:id/shares')
  @ApiBearerAuth('jwt')
  @ApiOperation({
    summary: 'Lister les partages d’un dossier',
    description:
      'Retourne **tous** les share links (pending, active, revoked, expired) triés par date desc. ' +
      'Utilisé par le frontend entrepreneur pour afficher la liste des accès avec leur statut.',
  })
  @ApiParam({ name: 'id', description: 'UUID du dossier' })
  @ApiOkResponse({ description: 'Liste complète des share links.' })
  @ApiUnauthorizedResponse({ description: 'JWT manquant.' })
  @ApiNotFoundResponse({ description: 'Dossier inexistant ou possédé par un autre user.' })
  list(@Req() req: Request, @Param('id') id: string): Promise<ShareLink[]> {
    return this.service.listForDossier(id, currentUser(req).id)
  }

  @Delete('dossiers/:id/shares/:linkId')
  @ApiBearerAuth('jwt')
  @ApiOperation({
    summary: 'Révoquer un partage',
    description:
      'Passe `status → revoked` + stamp `revokedAt`. Effet **immédiat** sur la prochaine requête financeur ' +
      '(pas de cache côté guard — NFR4 : ≤5s). Audit : `share_link_revoked`.',
  })
  @ApiParam({ name: 'id', description: 'UUID du dossier' })
  @ApiParam({ name: 'linkId', description: 'UUID du share link à révoquer' })
  @ApiOkResponse({ description: 'Share link révoqué.' })
  @ApiUnauthorizedResponse({ description: 'JWT manquant.' })
  @ApiNotFoundResponse({
    description:
      'Dossier inexistant, share link inexistant, ou share link appartenant à un autre dossier.',
  })
  revoke(
    @Req() req: Request,
    @Param('id') id: string,
    @Param('linkId') linkId: string,
  ): Promise<ShareLink> {
    return this.service.revoke(id, linkId, currentUser(req).id)
  }
}
