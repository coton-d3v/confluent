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
  createEligibilitySchemeSchema,
  reorderEligibilitySchemesSchema,
  updateEligibilitySchemeSchema,
} from '@confluent/shared'
import { createZodDto } from 'nestjs-zod'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy'
import { WorkspaceAccessGuard } from '../workspaces/workspace-access.guard'
import {
  EligibilitySchemesService,
  type EligibilitySchemeView,
} from './eligibility-schemes.service'

class CreateEligibilitySchemeDto extends createZodDto(createEligibilitySchemeSchema) {}
class UpdateEligibilitySchemeDto extends createZodDto(updateEligibilitySchemeSchema) {}
class ReorderEligibilitySchemesDto extends createZodDto(reorderEligibilitySchemesSchema) {}

const uuid = new ParseUUIDPipe()

const NOT_FOUND =
  'Workspace inexistant ou dont le compte n’est pas membre actif (même réponse), ou dispositif ' +
  'inexistant dans ce workspace.'

// The schemes of a workspace (ROADMAP E06.05), as its conseillers read them. The workspace is
// checked before anything else (guard, `404` outside it), then the service applies the conseillers'
// read rule (`403` for an investisseur).
@ApiTags('Dispositifs')
@ApiBearerAuth('jwt')
@ApiParam({ name: 'workspaceId', description: 'UUID du workspace' })
@ApiUnauthorizedResponse({ description: 'JWT manquant.' })
@ApiForbiddenResponse({ description: 'Membre du workspace qui n’en est pas conseiller.' })
@ApiNotFoundResponse({ description: NOT_FOUND })
@UseGuards(WorkspaceAccessGuard)
@Controller('workspaces/:workspaceId/eligibility-schemes')
export class EligibilitySchemesController {
  constructor(private readonly schemes: EligibilitySchemesService) {}

  @Get()
  @ApiOperation({
    summary: 'Dispositifs (JEIR, JEI, CIR…)',
    description:
      'Les dispositifs du workspace dans son ordre, désactivés compris (`active`) : informations ' +
      'déclaratives et filtres des candidatures, sans aucune simulation fiscale. `key` : ' +
      'identifiant stable, jamais modifié. Lus par les conseillers actifs et les administrateurs ' +
      'de Confluent.',
  })
  @ApiOkResponse({ description: 'Dispositifs.' })
  list(
    @Param('workspaceId', uuid) workspaceId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<EligibilitySchemeView[]> {
    return this.schemes.list(user, workspaceId)
  }
}

// Configuring them: the workspace's managers and Confluent administrators (`canManageWorkspace`).
@ApiTags('Admin · Workspaces')
@ApiBearerAuth('jwt')
@ApiParam({ name: 'workspaceId', description: 'UUID du workspace' })
@ApiUnauthorizedResponse({ description: 'JWT manquant.' })
@ApiForbiddenResponse({ description: 'Membre du workspace sans le droit de le gérer.' })
@ApiNotFoundResponse({ description: NOT_FOUND })
@UseGuards(WorkspaceAccessGuard)
@Controller('admin/workspaces/:workspaceId/eligibility-schemes')
export class AdminEligibilitySchemesController {
  constructor(private readonly schemes: EligibilitySchemesService) {}

  @Post()
  @ApiOperation({
    summary: 'Ajouter un dispositif',
    description:
      'Ajoute en fin de liste, actif, un dispositif propre au workspace : `label` (unique dans le ' +
      'workspace sans tenir compte de la casse) et `description` facultative (≤ 300 caractères). ' +
      'La clé est déduite du libellé, une fois pour toutes. Au plus 30 dispositifs par workspace.',
  })
  @ApiCreatedResponse({ description: 'Dispositif créé.' })
  @ApiBadRequestResponse({ description: 'Libellé ou description invalide.' })
  @ApiConflictResponse({ description: 'Libellé déjà utilisé, ou nombre maximal atteint.' })
  create(
    @Param('workspaceId', uuid) workspaceId: string,
    @Body() body: CreateEligibilitySchemeDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<EligibilitySchemeView> {
    return this.schemes.create(user, workspaceId, body)
  }

  @Put('order')
  @ApiOperation({
    summary: 'Ordonner les dispositifs',
    description:
      '`schemeIds` : tous les dispositifs du workspace, désactivés compris, chacun une fois, dans ' +
      'le nouvel ordre. Une liste qui n’est plus celle du workspace est refusée (`409`). Renvoie la ' +
      'liste dans son nouvel ordre.',
  })
  @ApiOkResponse({ description: 'Dispositifs dans leur nouvel ordre.' })
  @ApiBadRequestResponse({ description: 'Liste invalide ou avec doublon.' })
  @ApiConflictResponse({ description: 'Liste périmée.' })
  reorder(
    @Param('workspaceId', uuid) workspaceId: string,
    @Body() body: ReorderEligibilitySchemesDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<EligibilitySchemeView[]> {
    return this.schemes.reorder(user, workspaceId, body.schemeIds)
  }

  @Patch(':schemeId')
  @ApiParam({ name: 'schemeId', description: 'UUID du dispositif' })
  @ApiOperation({
    summary: 'Renommer, décrire, désactiver ou réactiver un dispositif',
    description:
      'Seuls les champs présents changent (`label`, `description` — `null` l’efface —, `active`) ; ' +
      'la clé ne change jamais. Un dispositif n’est jamais supprimé : désactivé, il n’est plus ' +
      'proposé mais reste lisible et filtrable là où il a servi.',
  })
  @ApiOkResponse({ description: 'Dispositif modifié.' })
  @ApiBadRequestResponse({ description: 'Champ invalide, ou aucun champ.' })
  @ApiConflictResponse({ description: 'Libellé déjà utilisé.' })
  update(
    @Param('workspaceId', uuid) workspaceId: string,
    @Param('schemeId', uuid) schemeId: string,
    @Body() body: UpdateEligibilitySchemeDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<EligibilitySchemeView> {
    return this.schemes.update(user, workspaceId, schemeId, body)
  }
}
