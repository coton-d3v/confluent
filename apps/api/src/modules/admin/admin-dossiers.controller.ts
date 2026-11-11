import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common'
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger'
import type { Request } from 'express'
import { createZodDto } from 'nestjs-zod'
import { upsertAnswersSchema } from '@confluent/shared'
import { AdminGuard } from '../auth/guards/admin.guard'
import { AdminDossiersService } from './admin-dossiers.service'
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy'

class UpsertAnswersDto extends createZodDto(upsertAnswersSchema) {}

function currentUser(req: Request): AuthenticatedUser {
  return (req as Request & { user: AuthenticatedUser }).user
}

@ApiTags('Admin · Dossiers')
@ApiBearerAuth('jwt')
@ApiUnauthorizedResponse({ description: 'JWT manquant.' })
@ApiForbiddenResponse({ description: 'JWT sans rôle `admin`.' })
@UseGuards(AdminGuard)
@Controller('admin/dossiers')
export class AdminDossiersController {
  constructor(private readonly service: AdminDossiersService) {}

  @Get()
  @ApiOperation({
    summary: 'Lister TOUS les dossiers (paginé)',
    description:
      'Retourne les dossiers de **toute la plateforme** — aucun filtre ownership. Pagination `page/pageSize` ' +
      '(défaut 1/20, max 100/page). Inclut `ownerEmail`, `companyName` (entreprise du dossier, E05.04) + ' +
      '`activeShareLinksCount` dérivé pour la vue admin.',
  })
  @ApiQuery({ name: 'page', required: false, description: 'Numéro de page (défaut 1)' })
  @ApiQuery({
    name: 'pageSize',
    required: false,
    description: 'Taille de page (défaut 20, max 100)',
  })
  @ApiOkResponse({ description: 'Page de dossiers + métadonnées (`total`, `page`, `pageSize`).' })
  list(@Query('page') pageQ?: string, @Query('pageSize') pageSizeQ?: string) {
    const page = Math.max(1, Number(pageQ) || 1)
    const pageSize = Math.min(100, Math.max(1, Number(pageSizeQ) || 20))
    return this.service.list(page, pageSize)
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Détail admin d’un dossier',
    description:
      'Retourne le dossier avec relations complètes : `answers`, `shareLinks`, `documents`, `ownerEmail`, ' +
      '`company` (entreprise du dossier, E05.04). ' +
      'Plus riche que la vue entrepreneur `GET /v1/dossiers/:id`.',
  })
  @ApiParam({ name: 'id', description: 'UUID du dossier' })
  @ApiOkResponse({ description: 'Dossier complet (scope admin).' })
  @ApiNotFoundResponse({ description: 'Dossier inexistant.' })
  detail(@Param('id') id: string) {
    return this.service.detail(id)
  }

  @Patch(':id/answers')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Admin — éditer les réponses d’un dossier',
    description:
      'Upsert des réponses + trace **par champ modifié** dans `audit_log`: `action_type: admin_edited_field`, ' +
      '`metadata: { fieldId, oldValue, newValue }`. Traçabilité totale pour FR24 / FR35.',
  })
  @ApiParam({ name: 'id', description: 'UUID du dossier' })
  @ApiOkResponse({ description: 'Réponses mises à jour. Body : `{ status: "ok" }`.' })
  @ApiNotFoundResponse({ description: 'Dossier inexistant.' })
  async editAnswers(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: UpsertAnswersDto,
  ): Promise<{ status: 'ok' }> {
    await this.service.editAnswers(id, currentUser(req).id, body.answers)
    return { status: 'ok' }
  }
}
