import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common'
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
import { PORTFOLIO_PAGE_SIZE, portfolioQuerySchema } from '@confluent/shared'
import { createZodDto } from 'nestjs-zod'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy'
import { WorkspaceAccessGuard } from '../workspaces/workspace-access.guard'
import { PortfolioService, type PortfolioView } from './portfolio.service'

class PortfolioQueryDto extends createZodDto(portfolioQuerySchema) {}

const uuid = new ParseUUIDPipe()

// A workspace's portfolio (ROADMAP E06.07), for its conseillers and Confluent's administrators. The
// workspace is checked before anything else (guard, `404` outside it), then the service applies the
// candidatures' read rule (`403` for an investisseur).
@ApiTags('Candidatures reçues')
@ApiBearerAuth('jwt')
@ApiParam({ name: 'workspaceId', description: 'UUID du workspace' })
@ApiUnauthorizedResponse({ description: 'JWT manquant.' })
@ApiForbiddenResponse({ description: 'Membre du workspace qui n’en est pas conseiller.' })
@ApiNotFoundResponse({
  description: 'Workspace inexistant ou dont le compte n’est pas membre actif (même réponse).',
})
@UseGuards(WorkspaceAccessGuard)
@Controller('workspaces/:workspaceId/portfolio')
export class PortfolioController {
  constructor(private readonly portfolio: PortfolioService) {}

  @Get()
  @ApiOperation({
    summary: 'Portefeuille par phase',
    description:
      'Les candidatures envoyées au workspace avec leur phase d’avancement (`progress`), calculée ' +
      'à chaque lecture à partir des étapes actives du parcours d’accompagnement, dans leur ordre, ' +
      'et de leurs validations : `in_progress` (en préparation : au moins une étape active à ' +
      'valider ; `currentStep` est la première d’entre elles), `ready` (prête à lever : toutes les ' +
      'étapes actives validées), `no_path` (sans parcours : aucune étape active). Une étape ' +
      'désactivée ne compte pas. `counts` : nombre de candidatures, par phase et par étape en ' +
      'cours, selon les filtres `financingStatus`, `scheme` et `verified` (ceux de la liste des ' +
      'candidatures reçues), quels que soient `phase` et `step`. `total` et `items` : les ' +
      'candidatures qui répondent à tous les filtres, `phase` et `step` (UUID de l’étape en cours ; ' +
      'tout autre identifiant ne trouve rien) compris, la plus récente d’abord, par pages de ' +
      `${PORTFOLIO_PAGE_SIZE} (\`page\`, à partir de 1). Les brouillons restent invisibles.`,
  })
  @ApiOkResponse({ description: 'Portefeuille.' })
  @ApiBadRequestResponse({ description: 'Filtre inconnu ou invalide.' })
  get(
    @Param('workspaceId', uuid) workspaceId: string,
    @Query() query: PortfolioQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PortfolioView> {
    return this.portfolio.get(user, workspaceId, query)
  }
}
