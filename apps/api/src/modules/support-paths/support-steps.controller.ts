import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common'
import {
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
  ApiUnauthorizedResponse,
} from '@nestjs/swagger'
import {
  createSupportStepSchema,
  reorderSupportStepsSchema,
  updateSupportStepSchema,
} from '@confluent/shared'
import { createZodDto } from 'nestjs-zod'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy'
import { WorkspaceAccessGuard } from '../workspaces/workspace-access.guard'
import { SupportStepsService, type SupportStepView } from './support-steps.service'

class CreateSupportStepDto extends createZodDto(createSupportStepSchema) {}
class UpdateSupportStepDto extends createZodDto(updateSupportStepSchema) {}
class ReorderSupportStepsDto extends createZodDto(reorderSupportStepsSchema) {}

const uuid = new ParseUUIDPipe()

const NOT_FOUND =
  'Workspace inexistant ou dont le compte n’est pas membre actif (même réponse), ou étape ' +
  'inexistante dans ce workspace.'

// The support path of a workspace (ROADMAP E06.06), as its conseillers read it. The workspace is
// checked before anything else (guard, `404` outside it), then the service applies the conseillers'
// read rule (`403` for an investisseur).
@ApiTags('Parcours d’accompagnement')
@ApiBearerAuth('jwt')
@ApiParam({ name: 'workspaceId', description: 'UUID du workspace' })
@ApiUnauthorizedResponse({ description: 'JWT manquant.' })
@ApiForbiddenResponse({ description: 'Membre du workspace qui n’en est pas conseiller.' })
@ApiNotFoundResponse({ description: NOT_FOUND })
@UseGuards(WorkspaceAccessGuard)
@Controller('workspaces/:workspaceId/support-steps')
export class SupportStepsController {
  constructor(private readonly steps: SupportStepsService) {}

  @Get()
  @ApiOperation({
    summary: 'Étapes du parcours d’accompagnement',
    description:
      'Les étapes du parcours du workspace dans leur ordre, désactivées comprises (`active`), avec ' +
      'l’explication donnée aux porteurs de projet. `key` : identifiant stable, jamais modifié. ' +
      'Lues par les conseillers actifs et les administrateurs de Confluent.',
  })
  @ApiOkResponse({ description: 'Étapes.' })
  list(
    @Param('workspaceId', uuid) workspaceId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<SupportStepView[]> {
    return this.steps.list(user, workspaceId)
  }
}

// Configuring it: the workspace's managers and Confluent administrators (`canManageWorkspace`).
@ApiTags('Admin · Workspaces')
@ApiBearerAuth('jwt')
@ApiParam({ name: 'workspaceId', description: 'UUID du workspace' })
@ApiUnauthorizedResponse({ description: 'JWT manquant.' })
@ApiForbiddenResponse({ description: 'Membre du workspace sans le droit de le gérer.' })
@ApiNotFoundResponse({ description: NOT_FOUND })
@UseGuards(WorkspaceAccessGuard)
@Controller('admin/workspaces/:workspaceId/support-steps')
export class AdminSupportStepsController {
  constructor(private readonly steps: SupportStepsService) {}

  @Post()
  @ApiOperation({
    summary: 'Ajouter une étape au parcours',
    description:
      'Ajoute en fin de parcours, active, une étape propre au workspace : `label` (unique dans le ' +
      'workspace sans tenir compte de la casse) et `explanation` facultative (texte simple en ' +
      'paragraphes, sans balise HTML, ≤ 1 000 caractères). La clé est déduite du libellé, une fois ' +
      'pour toutes. Au plus 30 étapes par workspace.',
  })
  @ApiCreatedResponse({ description: 'Étape créée.' })
  @ApiBadRequestResponse({ description: 'Libellé ou explication invalide.' })
  @ApiConflictResponse({ description: 'Libellé déjà utilisé, ou nombre maximal atteint.' })
  create(
    @Param('workspaceId', uuid) workspaceId: string,
    @Body() body: CreateSupportStepDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<SupportStepView> {
    return this.steps.create(user, workspaceId, body)
  }

  @Put('order')
  @ApiOperation({
    summary: 'Ordonner les étapes du parcours',
    description:
      '`stepIds` : toutes les étapes du workspace, désactivées comprises, chacune une fois, dans le ' +
      'nouvel ordre. Une liste qui n’est plus celle du workspace est refusée (`409`). Les ' +
      'validations suivent leur étape. Renvoie le parcours dans son nouvel ordre.',
  })
  @ApiOkResponse({ description: 'Étapes dans leur nouvel ordre.' })
  @ApiBadRequestResponse({ description: 'Liste invalide ou avec doublon.' })
  @ApiConflictResponse({ description: 'Liste périmée.' })
  reorder(
    @Param('workspaceId', uuid) workspaceId: string,
    @Body() body: ReorderSupportStepsDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<SupportStepView[]> {
    return this.steps.reorder(user, workspaceId, body.stepIds)
  }

  @Patch(':stepId')
  @ApiParam({ name: 'stepId', description: 'UUID de l’étape' })
  @ApiOperation({
    summary: 'Renommer, expliquer, désactiver ou réactiver une étape',
    description:
      'Seuls les champs présents changent (`label`, `explanation` — `null` l’efface —, `active`) ; ' +
      'la clé ne change jamais. Une étape n’est jamais supprimée : désactivée, elle sort du ' +
      'parcours ; ses validations sont conservées, figées, et reviennent si elle est réactivée.',
  })
  @ApiOkResponse({ description: 'Étape modifiée.' })
  @ApiBadRequestResponse({ description: 'Champ invalide, ou aucun champ.' })
  @ApiConflictResponse({ description: 'Libellé déjà utilisé.' })
  update(
    @Param('workspaceId', uuid) workspaceId: string,
    @Param('stepId', uuid) stepId: string,
    @Body() body: UpdateSupportStepDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<SupportStepView> {
    return this.steps.update(user, workspaceId, stepId, body)
  }
}
