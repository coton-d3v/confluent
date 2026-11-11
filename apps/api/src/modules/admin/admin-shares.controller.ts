import { Controller, Delete, Get, Param, Query, Req, UseGuards } from '@nestjs/common'
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger'
import type { Request } from 'express'
import { createZodDto } from 'nestjs-zod'
import { sharePreviewQuerySchema } from '@confluent/shared'
import { AdminGuard } from '../auth/guards/admin.guard'
import {
  ShareLinksService,
  type ShareAccess,
  type SharePreview,
} from '../share-links/share-links.service'
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy'

class SharePreviewQueryDto extends createZodDto(sharePreviewQuerySchema) {}

function currentUser(req: Request): AuthenticatedUser {
  return (req as Request & { user: AuthenticatedUser }).user
}

// E07.01: the administrator authorized to act on a request's shares besides its owner is the global
// administrator (role read from the database at each request). Workspace managers are not: a share
// is the owner's own diffusion, apart from what is presented to their structure.
@ApiTags('Admin · Partages')
@ApiBearerAuth('jwt')
@ApiUnauthorizedResponse({ description: 'JWT manquant.' })
@ApiForbiddenResponse({ description: 'Compte sans rôle `admin`.' })
@UseGuards(AdminGuard)
@Controller('admin/dossiers/:dossierId')
export class AdminSharesController {
  constructor(private readonly shares: ShareLinksService) {}

  @Get('shares')
  @ApiOperation({
    summary: 'Liste des accès d’un dossier (admin)',
    description:
      'Même liste que celle du propriétaire (`GET /v1/dossiers/:id/shares`), sur n’importe quel ' +
      'dossier : niveau, statut et, pour un partage révoqué, `revokedBy` (`owner` ou `admin`).',
  })
  @ApiParam({ name: 'dossierId', description: 'UUID du dossier' })
  @ApiOkResponse({ description: 'Liste des accès.' })
  @ApiNotFoundResponse({ description: 'Dossier inexistant.' })
  list(@Param('dossierId') dossierId: string): Promise<ShareAccess[]> {
    return this.shares.listForAdmin(dossierId)
  }

  @Get('share-preview')
  @ApiOperation({
    summary: 'Voir comme le destinataire (admin)',
    description:
      'Même aperçu que celui du propriétaire (`GET /v1/dossiers/:id/share-preview`), sur ' +
      'n’importe quel dossier : ce que lirait un destinataire au niveau `level`, sans lien, sans ' +
      'consultation comptée et sans fichier délivré.',
  })
  @ApiParam({ name: 'dossierId', description: 'UUID du dossier' })
  @ApiOkResponse({ description: 'Vue du destinataire au niveau demandé.' })
  @ApiBadRequestResponse({ description: 'Niveau absent ou inconnu.' })
  @ApiNotFoundResponse({ description: 'Dossier inexistant.' })
  preview(
    @Param('dossierId') dossierId: string,
    @Query() query: SharePreviewQueryDto,
  ): Promise<SharePreview> {
    return this.shares.previewForAdmin(dossierId, query.level)
  }

  @Delete('shares/:linkId')
  @ApiOperation({
    summary: 'Révocation admin transversale d’un partage (FR22)',
    description:
      'Équivalent admin de `DELETE /v1/dossiers/:id/shares/:linkId` — l’admin peut révoquer un partage ' +
      'sur **n’importe quel dossier** de la plateforme, sans ownership requis. Audit : ' +
      '`admin_revoked_share_link` avec `actorId` (admin) + `recipientEmail` + `revokedAt` ; le ' +
      'propriétaire voit l’accès « révoqué par l’administration ». Un partage déjà révoqué reste tel ' +
      'quel, sans nouvelle entrée. Effet immédiat côté financeur.',
  })
  @ApiParam({ name: 'dossierId', description: 'UUID du dossier' })
  @ApiParam({ name: 'linkId', description: 'UUID du share link' })
  @ApiOkResponse({ description: 'Partage révoqué.' })
  @ApiNotFoundResponse({
    description:
      'Dossier ou share link inexistant, ou share link n’appartenant pas au dossier ciblé.',
  })
  revoke(
    @Req() req: Request,
    @Param('dossierId') dossierId: string,
    @Param('linkId') linkId: string,
  ): Promise<ShareAccess> {
    return this.shares.revokeAsAdmin(dossierId, linkId, currentUser(req).id)
  }
}
