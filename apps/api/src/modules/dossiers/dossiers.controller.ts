import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Req } from '@nestjs/common'
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiUnprocessableEntityResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger'
import type { Request } from 'express'
import type { Dossier } from '@prisma/client'
import { createDossierSchema, updateDossierSchema } from '@confluent/shared'
import { createZodDto } from 'nestjs-zod'
import { DossiersService } from './dossiers.service'
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy'

class CreateDossierDto extends createZodDto(createDossierSchema) {}
class UpdateDossierDto extends createZodDto(updateDossierSchema) {}

function currentUser(req: Request): AuthenticatedUser {
  return (req as Request & { user: AuthenticatedUser }).user
}

@ApiTags('Dossiers')
@ApiBearerAuth('jwt')
@ApiUnauthorizedResponse({ description: 'JWT manquant, invalide, ou user désactivé.' })
@Controller('dossiers')
export class DossiersController {
  constructor(private readonly service: DossiersService) {}

  @Post()
  @HttpCode(201)
  @ApiOperation({
    summary: 'Créer un dossier',
    description:
      'Crée un dossier possédé par l’user JWT. Un slug URL-safe est dérivé du `name` (collision-free). ' +
      'Le dossier est automatiquement lié à la version active du questionnaire (snapshot immuable — FR14).',
  })
  @ApiCreatedResponse({ description: 'Dossier créé.' })
  create(@Req() req: Request, @Body() body: CreateDossierDto): Promise<Dossier> {
    return this.service.create({ userId: currentUser(req).id, name: body.name })
  }

  @Get()
  @ApiOperation({
    summary: 'Lister mes dossiers',
    description:
      'Retourne uniquement les dossiers possédés par l’user JWT, triés par date de création desc. ' +
      'Jamais les dossiers des autres — même pas en cas de bug : le filtre `userId` est appliqué systématiquement.',
  })
  @ApiOkResponse({ description: 'Liste des dossiers de l’user.' })
  list(@Req() req: Request): Promise<Dossier[]> {
    return this.service.listForUser(currentUser(req))
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Détail d’un dossier',
    description:
      'Retourne le dossier + sa version de questionnaire snapshot (structure des champs utilisée au moment ' +
      'de la création). Renvoie `404` si le dossier n’existe pas ou appartient à un autre user — ' +
      'pas de `403` pour éviter de confirmer l’existence.',
  })
  @ApiParam({ name: 'id', description: 'UUID du dossier' })
  @ApiOkResponse({ description: 'Dossier + snapshot de la version questionnaire.' })
  @ApiNotFoundResponse({ description: 'Dossier inexistant ou possédé par un autre user.' })
  getOne(@Req() req: Request, @Param('id') id: string) {
    return this.service.getWithQuestionnaire(id, currentUser(req))
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Renommer un dossier',
    description:
      'Met à jour le `name` et régénère le `slug` (collision-free). Seul le propriétaire peut éditer. ' +
      '404 sinon.',
  })
  @ApiOkResponse({ description: 'Dossier mis à jour.' })
  @ApiNotFoundResponse({ description: 'Dossier inexistant ou possédé par un autre user.' })
  update(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: UpdateDossierDto,
  ): Promise<Dossier> {
    return this.service.update({ userId: currentUser(req).id, id, name: body.name })
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Supprimer un dossier',
    description:
      'Cascade sur `dossier_answers`, `share_links`, `documents`. Les entrées `audit_log` sont conservées ' +
      '(append-only — `dossier_id` devient `null` via `ON DELETE SET NULL`). Seul le propriétaire peut supprimer.',
  })
  @ApiNoContentResponse({ description: 'Dossier supprimé.' })
  @ApiNotFoundResponse({ description: 'Dossier inexistant ou possédé par un autre user.' })
  async delete(@Req() req: Request, @Param('id') id: string): Promise<void> {
    await this.service.delete(id, currentUser(req).id)
  }

  @Post(':id/submit')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Soumettre un dossier',
    description:
      'Vérifie que toutes les questions obligatoires de la version du dossier ont une réponse (sinon 422, ' +
      '`error.details` liste les champs manquants), lance la classification puis renseigne `submittedAt`. ' +
      'Ré-appeler met à jour la classification sans changer la date de première soumission. Après ' +
      'soumission, les réponses restent corrigeables mais une réponse obligatoire ne peut plus être effacée.',
  })
  @ApiOkResponse({ description: 'Dossier soumis, classification appliquée.' })
  @ApiUnprocessableEntityResponse({ description: 'Réponses obligatoires manquantes.' })
  @ApiNotFoundResponse({ description: 'Dossier inexistant ou possédé par un autre user.' })
  submit(@Req() req: Request, @Param('id') id: string): Promise<Dossier> {
    return this.service.submit(id, currentUser(req).id)
  }
}
