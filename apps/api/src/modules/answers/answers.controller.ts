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
import { upsertAnswersSchema } from '@confluent/shared'
import { createZodDto } from 'nestjs-zod'
import { AnswersService, type AnswerView } from './answers.service'
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
      'Retourne les `dossier_answers` du dossier, triées par date de création. Propriétaire : toutes, ' +
      'chacune avec sa provenance (`provenance` : saisie humaine ou proposition IA, confirmation, ' +
      'canal, auteur, application IA, date, document source, emplacement et extrait ; `null` pour ' +
      'une réponse enregistrée avant E04.04). Financeur : seulement les champs autorisés par le ' +
      'niveau d’accès de son partage (`questionnaire_fields.min_access_level`), sans provenance.',
  })
  @ApiOkResponse({ description: 'Liste des réponses.' })
  async list(@Req() req: Request, @Param('dossierId') dossierId: string): Promise<AnswerView[]> {
    const user = currentUser(req)
    const { dossier, accessLevel } = await this.dossiers.resolveReadAccess(dossierId, user)
    const answers = await this.answers.listViews(dossierId, dossier.userId === user.id)
    if (accessLevel === 'complet') return answers
    const visible = await this.dossiers.visibleFieldIds(dossier, accessLevel)
    return answers.filter((a) => visible.has(a.fieldId))
  }

  @Put()
  @ApiOperation({
    summary: 'Upsert batch de réponses (auto-save)',
    description:
      'Upsert transactionnel par `(dossierId, fieldId)` — clé unique. Idempotent : rejouable sans ' +
      'duplication. Chaque champ doit appartenir à la version de questionnaire du dossier et chaque ' +
      'valeur respecter son type ; sinon `400` et rien n’est écrit (`error.details` : une entrée par ' +
      'champ fautif). Chaque valeur enregistrée est une saisie humaine confirmée, faite dans le site ' +
      'par l’utilisateur connecté : sa provenance remplace celle de la valeur précédente.',
  })
  @ApiOkResponse({ description: 'Réponses upserted, retournées en l’état final.' })
  async upsert(
    @Req() req: Request,
    @Param('dossierId') dossierId: string,
    @Body() body: UpsertAnswersDto,
  ): Promise<AnswerView[]> {
    const { id: userId } = currentUser(req)
    const dossier = await this.dossiers.getByIdForUser(dossierId, userId)
    const saved = await this.answers.saveForDossier(dossier, body.answers, {
      userId,
      channel: 'site',
    })
    return this.answers.views(dossier.id, saved, true)
  }
}
