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
import { type DossierInterestsView, InterestsService } from './interests.service'
import { INTEREST_SCOPE } from './opportunities.controller'

// ROADMAP E07.05: what the owner of a request reads of the investors' marks of interest (D05).
@ApiTags('Opportunités')
@ApiBearerAuth('jwt')
@ApiUnauthorizedResponse({ description: 'JWT manquant.' })
@Controller('dossiers/:dossierId/interests')
export class DossierInterestsController {
  constructor(private readonly interests: InterestsService) {}

  @Get()
  @ApiOperation({
    summary: '[Entrepreneur] Marques d’intérêt d’une demande',
    description:
      INTEREST_SCOPE +
      '\n\nRéservé au porteur de la demande. `count` : investisseurs qui lisent la demande et y ont ' +
      'marqué leur intérêt ; `named` : ceux d’entre eux qui montrent leur nom (`name`, `null` si le ' +
      'compte n’en a pas, `organizations`, `markedAt`), les plus récents d’abord. Rien sur les autres.',
  })
  @ApiParam({ name: 'dossierId', description: 'UUID de la demande' })
  @ApiOkResponse({ description: 'Nombre de marques et noms montrés.' })
  @ApiNotFoundResponse({
    description: 'Demande inexistante ou dont le compte n’est pas le porteur.',
  })
  forOwner(
    @Param('dossierId', new ParseUUIDPipe()) dossierId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<DossierInterestsView> {
    return this.interests.forOwner(dossierId, user.id)
  }
}
