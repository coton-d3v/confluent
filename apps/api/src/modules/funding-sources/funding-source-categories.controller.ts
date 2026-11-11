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
  createFundingSourceCategorySchema,
  reorderFundingSourceCategoriesSchema,
  updateFundingSourceCategorySchema,
} from '@confluent/shared'
import { createZodDto } from 'nestjs-zod'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy'
import { WorkspaceAccessGuard } from '../workspaces/workspace-access.guard'
import {
  FundingSourceCategoriesService,
  type FundingSourceCategoryView,
} from './funding-source-categories.service'

class CreateFundingSourceCategoryDto extends createZodDto(createFundingSourceCategorySchema) {}
class UpdateFundingSourceCategoryDto extends createZodDto(updateFundingSourceCategorySchema) {}
class ReorderFundingSourceCategoriesDto extends createZodDto(
  reorderFundingSourceCategoriesSchema,
) {}

const uuid = new ParseUUIDPipe()

const NOT_FOUND =
  'Workspace inexistant ou dont le compte n’est pas membre actif (même réponse), ou source ' +
  'inexistante dans ce workspace.'

// The categories of sources of a workspace's financing plans (ROADMAP E06.02), as its conseillers
// read them. The workspace is checked before anything else (guard, `404` outside it), then the
// service applies the conseillers' read rule (`403` for an investisseur).
@ApiTags('Sources de financement')
@ApiBearerAuth('jwt')
@ApiParam({ name: 'workspaceId', description: 'UUID du workspace' })
@ApiUnauthorizedResponse({ description: 'JWT manquant.' })
@ApiForbiddenResponse({ description: 'Membre du workspace qui n’en est pas conseiller.' })
@ApiNotFoundResponse({ description: NOT_FOUND })
@UseGuards(WorkspaceAccessGuard)
@Controller('workspaces/:workspaceId/funding-source-categories')
export class FundingSourceCategoriesController {
  constructor(private readonly categories: FundingSourceCategoriesService) {}

  @Get()
  @ApiOperation({
    summary: 'Sources du plan de financement',
    description:
      'Les catégories de sources du workspace dans son ordre, désactivées comprises (`active`). ' +
      '`key` : identifiant stable, jamais modifié ; `family` : nature de la source (liste fermée, ' +
      'D04 à confirmer). Lues par les conseillers actifs et les administrateurs de Confluent.',
  })
  @ApiOkResponse({ description: 'Sources de financement.' })
  list(
    @Param('workspaceId', uuid) workspaceId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<FundingSourceCategoryView[]> {
    return this.categories.list(user, workspaceId)
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
@Controller('admin/workspaces/:workspaceId/funding-source-categories')
export class AdminFundingSourceCategoriesController {
  constructor(private readonly categories: FundingSourceCategoriesService) {}

  @Post()
  @ApiOperation({
    summary: 'Ajouter une source de financement',
    description:
      'Ajoute en fin de liste, active, une source propre au workspace : `label` (unique dans le ' +
      'workspace sans tenir compte de la casse) et `family` (nature, fixée à la création). La clé ' +
      'est déduite du libellé, une fois pour toutes. Au plus 30 sources par workspace.',
  })
  @ApiCreatedResponse({ description: 'Source créée.' })
  @ApiBadRequestResponse({ description: 'Libellé ou nature invalide.' })
  @ApiConflictResponse({ description: 'Libellé déjà utilisé, ou nombre maximal atteint.' })
  create(
    @Param('workspaceId', uuid) workspaceId: string,
    @Body() body: CreateFundingSourceCategoryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<FundingSourceCategoryView> {
    return this.categories.create(user, workspaceId, body)
  }

  @Put('order')
  @ApiOperation({
    summary: 'Ordonner les sources de financement',
    description:
      '`categoryIds` : toutes les sources du workspace, désactivées comprises, chacune une fois, ' +
      'dans le nouvel ordre. Une liste qui n’est plus celle du workspace (source ajoutée entre-temps) ' +
      'est refusée (`409`). Renvoie la liste dans son nouvel ordre.',
  })
  @ApiOkResponse({ description: 'Sources dans leur nouvel ordre.' })
  @ApiBadRequestResponse({ description: 'Liste invalide ou avec doublon.' })
  @ApiConflictResponse({ description: 'Liste périmée.' })
  reorder(
    @Param('workspaceId', uuid) workspaceId: string,
    @Body() body: ReorderFundingSourceCategoriesDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<FundingSourceCategoryView[]> {
    return this.categories.reorder(user, workspaceId, body.categoryIds)
  }

  @Patch(':categoryId')
  @ApiParam({ name: 'categoryId', description: 'UUID de la source' })
  @ApiOperation({
    summary: 'Renommer, désactiver ou réactiver une source',
    description:
      'Seuls les champs présents changent (`label`, `active`) ; la clé et la nature ne changent ' +
      'jamais. Une source n’est jamais supprimée : désactivée, elle n’est plus proposée mais reste ' +
      'lisible. Le workspace garde au moins une source active (`409`).',
  })
  @ApiOkResponse({ description: 'Source modifiée.' })
  @ApiBadRequestResponse({ description: 'Champ invalide, ou aucun champ.' })
  @ApiConflictResponse({ description: 'Libellé déjà utilisé, ou dernière source active.' })
  update(
    @Param('workspaceId', uuid) workspaceId: string,
    @Param('categoryId', uuid) categoryId: string,
    @Body() body: UpdateFundingSourceCategoryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<FundingSourceCategoryView> {
    return this.categories.update(user, workspaceId, categoryId, body)
  }
}
