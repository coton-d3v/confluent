import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import {
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger'
import type { Request } from 'express'
import type { ShareLink } from '@prisma/client'
import {
  createShareLinkSchema,
  shareAccessRequestSchema,
  sharePreviewQuerySchema,
  updateShareLinkSchema,
} from '@confluent/shared'
import { createZodDto } from 'nestjs-zod'
import { Public } from '../../common/decorators/public.decorator'
import { ShareLinkGuard, type AugmentedRequest } from '../auth/guards/share-link.guard'
import {
  ShareLinksService,
  type FinanceurShareResponse,
  type ShareAccess,
  type SharePreview,
} from './share-links.service'
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy'

class CreateShareLinkDto extends createZodDto(createShareLinkSchema) {}
class ShareAccessRequestDto extends createZodDto(shareAccessRequestSchema) {}
class UpdateShareLinkDto extends createZodDto(updateShareLinkSchema) {}
class SharePreviewQueryDto extends createZodDto(sharePreviewQuerySchema) {}

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
    summary: 'Inviter un destinataire (lien nominatif)',
    description:
      'Propriétaire de la demande seulement. Crée un partage `active` au niveau choisi ' +
      '(`accessLevel` obligatoire : `public`, `partiel` ou `complet`), avec un token UUIDv4, et ' +
      'envoie l’invitation à `recipientEmail` avec l’URL `${FRONTEND_URL}/share/<token>` ; un ' +
      'compte est créé pour une adresse inconnue. Le destinataire ne lira le dossier qu’une fois ' +
      'connecté avec cette adresse (E02.08). Refus : demande archivée ou entreprise en préparation ' +
      '(`409`), adresse ayant déjà un accès actif à cette demande (`409`, `details.shareLinkId` : ' +
      'changer son niveau), sa propre adresse (`422`). Journal ' +
      '`share_link_created` (niveau compris). L’échec d’envoi du mail n’annule pas la création.',
  })
  @ApiParam({ name: 'id', description: 'UUID du dossier' })
  @ApiCreatedResponse({
    description: 'Share link créé + URL complète à présenter à l’utilisateur.',
  })
  @ApiUnauthorizedResponse({ description: 'JWT manquant.' })
  @ApiNotFoundResponse({ description: 'Dossier inexistant ou possédé par un autre user.' })
  @ApiConflictResponse({
    description: 'Demande archivée, entreprise en préparation ou accès déjà actif.',
  })
  @ApiUnprocessableEntityResponse({ description: 'Invitation à sa propre adresse.' })
  create(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: CreateShareLinkDto,
  ): Promise<ShareLink & { shareUrl: string }> {
    return this.service.create({
      dossierId: id,
      user: currentUser(req),
      recipientEmail: body.recipientEmail,
      accessLevel: body.accessLevel,
    })
  }

  @Get('dossiers/:id/shares')
  @ApiBearerAuth('jwt')
  @ApiOperation({
    summary: 'Liste des accès d’un dossier',
    description:
      'Propriétaire seulement. **Tous** les partages (actifs et révoqués), le plus récent ' +
      'd’abord, avec leur niveau et, pour un partage révoqué, `revokedBy` : `owner` (le ' +
      'propriétaire) ou `admin` (un administrateur).',
  })
  @ApiParam({ name: 'id', description: 'UUID du dossier' })
  @ApiOkResponse({ description: 'Liste des accès.' })
  @ApiUnauthorizedResponse({ description: 'JWT manquant.' })
  @ApiNotFoundResponse({ description: 'Dossier inexistant ou possédé par un autre user.' })
  list(@Req() req: Request, @Param('id') id: string): Promise<ShareAccess[]> {
    return this.service.listForOwner(id, currentUser(req).id)
  }

  @Patch('dossiers/:id/shares/:linkId')
  @ApiBearerAuth('jwt')
  @ApiOperation({
    summary: 'Changer le niveau d’un accès',
    description:
      'Propriétaire seulement. Le destinataire garde le même lien et lit le nouveau niveau dès sa ' +
      'requête suivante. Élargir l’accès est refusé sur une demande archivée (`409`) ; le ' +
      'restreindre reste possible. Accès révoqué, ou modifié/révoqué entre-temps : `409`. ' +
      'Journal `share_link_level_changed` ' +
      '(`from`, `to`) ; demander le niveau actuel ne change rien.',
  })
  @ApiParam({ name: 'id', description: 'UUID du dossier' })
  @ApiParam({ name: 'linkId', description: 'UUID du share link' })
  @ApiOkResponse({ description: 'L’accès, à son nouveau niveau.' })
  @ApiBadRequestResponse({ description: 'Niveau inconnu.' })
  @ApiNotFoundResponse({
    description: 'Dossier ou partage inexistant, ou d’un autre propriétaire.',
  })
  @ApiConflictResponse({ description: 'Accès révoqué, modifié entre-temps ou demande archivée.' })
  changeLevel(
    @Req() req: Request,
    @Param('id') id: string,
    @Param('linkId') linkId: string,
    @Body() body: UpdateShareLinkDto,
  ): Promise<ShareAccess> {
    return this.service.changeLevel({
      dossierId: id,
      linkId,
      userId: currentUser(req).id,
      accessLevel: body.accessLevel,
    })
  }

  @Get('dossiers/:id/share-preview')
  @ApiBearerAuth('jwt')
  @ApiOperation({
    summary: 'Voir comme le destinataire',
    description:
      'Propriétaire seulement. Exactement ce que lirait un destinataire au niveau `level` ' +
      '(même projection que `GET /v1/shares/:token` : questions, réponses, classification, ' +
      'documents sélectionnés à leur version, présentation selon la publication), sans créer de ' +
      'lien ni compter de consultation. Aucun fichier n’est délivré (`url` nulle). `preview` : ' +
      'le niveau et ce que la demande pourrait montrer au total (questions de sa version, ' +
      'documents sélectionnés).',
  })
  @ApiParam({ name: 'id', description: 'UUID du dossier' })
  @ApiOkResponse({ description: 'Vue du destinataire au niveau demandé.' })
  @ApiBadRequestResponse({ description: 'Niveau absent ou inconnu.' })
  @ApiNotFoundResponse({ description: 'Dossier inexistant ou possédé par un autre user.' })
  preview(
    @Req() req: Request,
    @Param('id') id: string,
    @Query() query: SharePreviewQueryDto,
  ): Promise<SharePreview> {
    return this.service.previewForOwner(id, currentUser(req).id, query.level)
  }

  @Delete('dossiers/:id/shares/:linkId')
  @ApiBearerAuth('jwt')
  @ApiOperation({
    summary: 'Révoquer un partage',
    description:
      'Propriétaire seulement. Passe `status → revoked` + `revokedAt`. Effet **immédiat** sur la ' +
      'prochaine requête du destinataire (pas de cache côté guard). Un partage déjà révoqué reste ' +
      'tel quel, sans nouvelle entrée de journal. Journal : `share_link_revoked`.',
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
  ): Promise<ShareAccess> {
    return this.service.revokeAsOwner(id, linkId, currentUser(req).id)
  }
}
