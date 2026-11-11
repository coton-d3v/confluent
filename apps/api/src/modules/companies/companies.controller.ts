import { Controller, Get, Param } from '@nestjs/common'
import {
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy'
import { CompaniesService, type CompanyView } from './companies.service'

// The signed-in owner's companies (ROADMAP E05.04; E05.08: a conseiller's prepared ones). A company
// is created with a dossier
// (`POST /v1/dossiers`) and removed, with its profile (E05.05), with its last one until a company page
// and several financing requests (E05.07) let its owner reach it on its own.
@ApiTags('Entreprises')
@ApiBearerAuth('jwt')
@ApiUnauthorizedResponse({ description: 'JWT manquant, invalide, ou user désactivé.' })
@Controller('companies')
export class CompaniesController {
  constructor(private readonly companies: CompaniesService) {}

  @Get()
  @ApiOperation({
    summary: 'Mes entreprises',
    description:
      'Les entreprises dont le compte connecté est propriétaire, les plus récentes d’abord, avec ' +
      'leurs dossiers de financement (identifiant, slug, nom, date de soumission). Jamais celles ' +
      'd’un autre compte. E05.08 : pour un conseiller, celles qu’il prépare pour un entrepreneur, ' +
      'tant qu’il est conseiller actif du workspace où il les prépare (`preparation` : workspace et ' +
      'dernière invitation ; `null` pour une entreprise à soi).',
  })
  @ApiOkResponse({ description: 'Entreprises du compte.' })
  list(@CurrentUser() user: AuthenticatedUser): Promise<CompanyView[]> {
    return this.companies.listForOwner(user)
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Détail d’une entreprise',
    description: 'Une entreprise du compte connecté et ses dossiers de financement.',
  })
  @ApiParam({ name: 'id', description: 'UUID de l’entreprise' })
  @ApiOkResponse({ description: 'Entreprise et ses dossiers.' })
  @ApiNotFoundResponse({
    description:
      'Entreprise inexistante ou possédée par un autre compte : même réponse, pour ne pas révéler ' +
      'son existence.',
  })
  getOne(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser): Promise<CompanyView> {
    return this.companies.getForOwner(id, user)
  }
}
