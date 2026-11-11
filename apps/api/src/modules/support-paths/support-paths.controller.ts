import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, UseGuards } from '@nestjs/common'
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger'
import { setSupportStepValidationSchema } from '@confluent/shared'
import { createZodDto } from 'nestjs-zod'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy'
import { WorkspaceAccessGuard } from '../workspaces/workspace-access.guard'
import {
  SupportPathsService,
  type ReceivedSupportPathView,
  type SupportPathView,
} from './support-paths.service'

class SetSupportStepValidationDto extends createZodDto(setSupportStepValidationSchema) {}

const uuid = new ParseUUIDPipe()

// What both sides' routes say of a candidature's path (ROADMAP E06.06).
const PATH =
  'Le parcours d’accompagnement de la candidature : les étapes actives du parcours de son ' +
  'workspace dans leur ordre, avec leur explication, et pour chacune la date de sa validation par ' +
  'la structure (`validatedAt`, `null` sinon) et sa `version` (`0` : jamais validée) ; une étape ' +
  'désactivée n’apparaît plus que si sa validation tient (`active: false`). `progress` : la ' +
  'phase d’avancement calculée sur les seules étapes actives — `in_progress` (en préparation, ' +
  '`currentStep` = première étape active à valider), `ready` (prête à lever : toutes validées) ou ' +
  '`no_path` (aucune étape active) — et le nombre d’étapes actives validées sur leur total.'

// The owner of the request reads the path of each of its candidatures, a draft included (`404`
// alike for another account's candidature and an unknown one). The owner never validates, and never
// learns who among the structure's members validated.
@ApiTags('Candidatures')
@ApiBearerAuth('jwt')
@ApiParam({ name: 'candidatureId', description: 'UUID de la candidature' })
@ApiUnauthorizedResponse({ description: 'JWT manquant.' })
@ApiNotFoundResponse({ description: 'Candidature inexistante ou d’un autre compte.' })
@Controller('candidatures/:candidatureId/support-path')
export class SupportPathController {
  constructor(private readonly paths: SupportPathsService) {}

  @Get()
  @ApiOperation({
    summary: 'Parcours d’accompagnement (porteur de projet)',
    description:
      PATH +
      ' Lu par le porteur de projet dès le brouillon ; seule la structure valide, et le porteur ne ' +
      'voit pas qui, parmi ses membres, a validé.',
  })
  @ApiOkResponse({ description: 'Parcours.' })
  get(
    @Param('candidatureId', uuid) candidatureId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<SupportPathView> {
    return this.paths.getForOwner(user.id, candidatureId)
  }
}

// The workspace's side: its active conseillers (the right to manage it is not required) and
// Confluent administrators, on a candidature sent to it; they alone validate. The workspace is
// checked before anything else (guard, `404` outside it), then the candidatures' read rule (`403`
// for an investisseur).
@ApiTags('Candidatures reçues')
@ApiBearerAuth('jwt')
@ApiParam({ name: 'workspaceId', description: 'UUID du workspace' })
@ApiParam({ name: 'candidatureId', description: 'UUID de la candidature' })
@ApiUnauthorizedResponse({ description: 'JWT manquant.' })
@ApiForbiddenResponse({ description: 'Membre du workspace qui n’en est pas conseiller.' })
@ApiNotFoundResponse({
  description:
    'Workspace inexistant ou dont le compte n’est pas membre actif (même réponse) ; candidature ' +
    'inexistante, d’un autre workspace ou encore en brouillon ; étape inconnue dans ce workspace.',
})
@UseGuards(WorkspaceAccessGuard)
@Controller('workspaces/:workspaceId/candidatures/:candidatureId/support-path')
export class ReceivedSupportPathController {
  constructor(private readonly paths: SupportPathsService) {}

  @Get()
  @ApiOperation({
    summary: 'Parcours d’accompagnement (structure)',
    description:
      PATH +
      ' Pour la structure, chaque étape validée dit aussi qui l’a validée (`validatedBy`), et ' +
      '`history` liste chaque validation et chaque validation retirée, la plus récente d’abord, ' +
      'avec son auteur.',
  })
  @ApiOkResponse({ description: 'Parcours.' })
  get(
    @Param('workspaceId', uuid) workspaceId: string,
    @Param('candidatureId', uuid) candidatureId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ReceivedSupportPathView> {
    return this.paths.getReceived(user, workspaceId, candidatureId)
  }

  @Patch('steps/:stepId')
  @ApiParam({ name: 'stepId', description: 'UUID de l’étape du parcours' })
  @ApiOperation({
    summary: 'Valider une étape ou retirer sa validation (structure)',
    description:
      '`{ validated, version }` : `true` valide l’étape (datée, avec son validateur), `false` ' +
      'retire la validation (l’étape est rouverte) ; `version` : celle de l’étape lue par le ' +
      'client (`0` si jamais validée). Une étape modifiée entre-temps est refusée (`409` ' +
      '`SUPPORT_STEP_CHANGED`), jamais écrasée ; une étape désactivée ne change plus (`409`). Le ' +
      'même état ne change rien. Chaque changement est conservé dans l’historique et journalisé ' +
      '(`candidature_support_step_updated`). Renvoie le parcours à jour.',
  })
  @ApiOkResponse({ description: 'Parcours à jour.' })
  @ApiBadRequestResponse({ description: 'Champ invalide.' })
  @ApiConflictResponse({ description: 'Étape modifiée entre-temps, ou désactivée.' })
  setValidation(
    @Param('workspaceId', uuid) workspaceId: string,
    @Param('candidatureId', uuid) candidatureId: string,
    @Param('stepId', uuid) stepId: string,
    @Body() body: SetSupportStepValidationDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ReceivedSupportPathView> {
    return this.paths.setValidation(user, workspaceId, candidatureId, stepId, body)
  }
}
