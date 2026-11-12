import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common'
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
import { PLEDGE_SCOPE } from './opportunities.controller'
import { type DossierPledgesView, PledgesService } from './pledges.service'

// ROADMAP E07.06: what the owner of a request reads of the investors' pledges.
@ApiTags('Opportunités')
@ApiBearerAuth('jwt')
@ApiUnauthorizedResponse({ description: 'JWT manquant.' })
@Controller('dossiers/:dossierId/pledges')
export class DossierPledgesController {
  constructor(private readonly pledges: PledgesService) {}

  @Get()
  @ApiOperation({
    summary: '[Entrepreneur] Promesses d’une demande',
    description:
      PLEDGE_SCOPE +
      '\n\nRéservé au porteur de la demande. `count` et `totalEur` : promesses des investisseurs ' +
      'qui lisent la demande ; `shown` : une ligne par promesse dont l’investisseur montre son nom ' +
      'ou son montant — `identity` (`name`, `null` si le compte n’en a pas, `organizations`) ou ' +
      '`null`, `amountEur` ou `null` —, les plus gros montants montrés d’abord, puis par nom.',
  })
  @ApiParam({ name: 'dossierId', description: 'UUID de la demande' })
  @ApiOkResponse({ description: 'Nombre, total et ce que chaque investisseur montre.' })
  @ApiNotFoundResponse({
    description: 'Demande inexistante ou dont le compte n’est pas le porteur.',
  })
  forOwner(
    @Param('dossierId', new ParseUUIDPipe()) dossierId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<DossierPledgesView> {
    return this.pledges.forOwner(dossierId, user.id)
  }
}
