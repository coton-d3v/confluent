import { Body, Controller, Get, HttpCode, Param, Post, Put, Req } from '@nestjs/common'
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger'
import type { Request } from 'express'
import { confirmAnswerSchema, upsertAnswersSchema } from '@confluent/shared'
import { createZodDto } from 'nestjs-zod'
import { AnswersService, type AnswerView } from './answers.service'
import { DossiersService } from '../dossiers/dossiers.service'
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy'

class UpsertAnswersDto extends createZodDto(upsertAnswersSchema) {}
class ConfirmAnswerDto extends createZodDto(confirmAnswerSchema) {}

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
      'Retourne les réponses du profil de l’entreprise du dossier (E05.05), triées par date de création. Propriétaire : toutes, ' +
      'chacune avec sa provenance (`provenance` : saisie humaine ou proposition IA, confirmation, ' +
      'canal, auteur, application IA, date, document source, emplacement et extrait ; `null` pour ' +
      'une réponse enregistrée avant E04.04) et son historique (`history`, du plus récent au plus ' +
      'ancien : les états remplacés quand une IA est en jeu — proposition corrigée, remplacée ou ' +
      'confirmée, ou valeur remplacée par une proposition). Financeur : seulement les champs autorisés par le ' +
      'niveau d’accès de son partage (`questionnaire_fields.min_access_level`), sans provenance ni ' +
      'historique.',
  })
  @ApiOkResponse({ description: 'Liste des réponses.' })
  async list(@Req() req: Request, @Param('dossierId') dossierId: string): Promise<AnswerView[]> {
    const user = currentUser(req)
    const { dossier, accessLevel } = await this.dossiers.resolveReadAccess(dossierId, user)
    const answers = await this.answers.listViews(
      dossier,
      dossier.userId === user.id ? 'history' : 'value',
    )
    if (accessLevel === 'complet') return answers
    const visible = await this.dossiers.visibleFieldIds(dossier, accessLevel)
    return answers.filter((a) => visible.has(a.fieldId))
  }

  @Put()
  @ApiOperation({
    summary: 'Upsert batch de réponses (auto-save)',
    description:
      'Upsert transactionnel par champ dans le profil de l’entreprise du dossier (E05.05) — clé unique ' +
      '`(entreprise, fieldId)`. Idempotent : rejouable sans duplication. Chaque champ doit appartenir à ' +
      'la version de questionnaire du profil et chaque ' +
      'valeur respecter son type ; sinon `400` et rien n’est écrit (`error.details` : une entrée par ' +
      'champ fautif). Chaque valeur enregistrée est une saisie humaine confirmée, faite dans le site ' +
      'par l’utilisateur connecté : sa provenance remplace celle de la valeur précédente. Une ' +
      'proposition IA ainsi corrigée reste dans l’historique.',
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
    return this.answers.views(dossier, saved, 'history')
  }

  @Post(':fieldId/confirm')
  @HttpCode(200)
  @ApiParam({ name: 'fieldId', description: 'UUID de la question' })
  @ApiOperation({
    summary: 'Confirmer une proposition IA',
    description:
      'Le propriétaire confirme, sans la modifier, une réponse proposée par une IA et encore à ' +
      'confirmer, telle qu’elle lui a été affichée : `value` et `updatedAt` de la réponse lue. ' +
      'La réponse devient une proposition IA confirmée dans le site par l’utilisateur (source ' +
      'conservée) ; l’état « à confirmer » rejoint l’historique. Pour corriger, enregistrer la ' +
      'bonne valeur avec `PUT`.',
  })
  @ApiOkResponse({ description: 'Réponse confirmée, avec sa provenance et son historique.' })
  @ApiConflictResponse({
    description:
      'La réponse a changé depuis son affichage, ou n’est pas une proposition à confirmer ' +
      '(message en français dans `error.message`). Rien n’est modifié.',
  })
  async confirm(
    @Req() req: Request,
    @Param('dossierId') dossierId: string,
    @Param('fieldId') fieldId: string,
    @Body() body: ConfirmAnswerDto,
  ): Promise<AnswerView> {
    const { id: userId } = currentUser(req)
    const dossier = await this.dossiers.getByIdForUser(dossierId, userId)
    const confirmed = await this.answers.confirmProposal(
      dossier,
      fieldId,
      { value: body.value, updatedAt: new Date(body.updatedAt) },
      { userId, channel: 'site' },
    )
    const [view] = await this.answers.views(dossier, [confirmed], 'history')
    return view
  }
}
