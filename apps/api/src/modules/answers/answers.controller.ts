import { Body, Controller, Get, Param, Put, Req } from '@nestjs/common'
import {
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger'
import type { Request } from 'express'
import type { DossierAnswer } from '@prisma/client'
import { upsertAnswersSchema } from '@confluent/shared'
import { createZodDto } from 'nestjs-zod'
import { AnswersService } from './answers.service'
import { DossiersService } from '../dossiers/dossiers.service'
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy'

class UpsertAnswersDto extends createZodDto(upsertAnswersSchema) {}

function currentUser(req: Request): AuthenticatedUser {
  return (req as Request & { user: AuthenticatedUser }).user
}

@ApiTags('Questionnaire')
@ApiBearerAuth('jwt')
@ApiParam({ name: 'dossierId', description: 'UUID du dossier' })
@ApiUnauthorizedResponse({ description: 'JWT manquant, invalide, ou user désactivé.' })
@ApiNotFoundResponse({ description: 'Dossier inexistant ou possédé par un autre user.' })
@Controller('dossiers/:dossierId/answers')
export class AnswersController {
  constructor(
    private readonly answers: AnswersService,
    private readonly dossiers: DossiersService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Lister les réponses d’un dossier',
    description:
      'Retourne les `dossier_answers` du dossier, triées par date de création. Propriétaire : toutes. ' +
      'Financeur : seulement les champs autorisés par le niveau d’accès de son partage ' +
      '(`questionnaire_fields.min_access_level`).',
  })
  @ApiOkResponse({ description: 'Liste des réponses.' })
  async list(@Req() req: Request, @Param('dossierId') dossierId: string): Promise<DossierAnswer[]> {
    const { dossier, accessLevel } = await this.dossiers.resolveReadAccess(
      dossierId,
      currentUser(req),
    )
    const answers = await this.answers.listForDossier(dossierId)
    if (accessLevel === 'complet') return answers
    const visible = await this.dossiers.visibleFieldIds(dossier, accessLevel)
    return answers.filter((a) => visible.has(a.fieldId))
  }

  @Put()
  @ApiOperation({
    summary: 'Upsert batch de réponses (auto-save)',
    description:
      'Upsert transactionnel par `(dossierId, fieldId)` — clé unique. Idempotent : rejouable sans ' +
      'duplication. Typiquement appelé depuis le frontend avec un debounce de 500ms à chaque ' +
      'modification d’un champ (auto-save silencieux).',
  })
  @ApiOkResponse({ description: 'Réponses upserted, retournées en l’état final.' })
  async upsert(
    @Req() req: Request,
    @Param('dossierId') dossierId: string,
    @Body() body: UpsertAnswersDto,
  ): Promise<DossierAnswer[]> {
    await this.dossiers.getByIdForUser(dossierId, currentUser(req).id)
    return this.answers.upsertMany(dossierId, body.answers)
  }
}
