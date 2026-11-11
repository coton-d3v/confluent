import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common'
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger'
import { opportunitiesQuerySchema } from '@confluent/shared'
import { createZodDto } from 'nestjs-zod'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy'
import { ACCESS_LEVELS_DOC } from '../dossiers/financeur-access'
import {
  OpportunitiesService,
  type OpportunitiesView,
  type OpportunityView,
} from './opportunities.service'

class OpportunitiesQueryDto extends createZodDto(opportunitiesQuerySchema) {}

const uuid = new ParseUUIDPipe()

// What an opportunity is and what it shows, said once for both routes.
const OPPORTUNITY_SCOPE =
  'Une opportunité est une demande de financement que le compte connecté peut lire : partagée ' +
  'avec son adresse par un lien nominatif actif (E07.01), ou publiée au vivier d’un workspace dont ' +
  'il est investisseur actif (E07.02 : publication ni retirée ni en pause). Une demande atteinte ' +
  'par plusieurs voies est une seule opportunité, lue au niveau le plus large, avec chacune de ses ' +
  'provenances. Elle montre exactement la vue d’un destinataire de lien nominatif à ce niveau ' +
  '(présentation une fois publiée, réponses du profil, classification et documents choisis que ce ' +
  'niveau permet de lire), rien d’autre : ni formulaire de la structure, plan, dispositifs, ' +
  'parcours, statut de financement ou notes. Ses propres demandes n’en sont pas. ' +
  ACCESS_LEVELS_DOC

// ROADMAP E07.03: the signed-in investor's opportunities (« inbox »), read from their account only.
@ApiTags('Opportunités')
@ApiBearerAuth('jwt')
@ApiUnauthorizedResponse({ description: 'JWT manquant.' })
@Controller('opportunities')
export class OpportunitiesController {
  constructor(private readonly opportunities: OpportunitiesService) {}

  @Get()
  @ApiOperation({
    summary: 'Mes opportunités',
    description:
      OPPORTUNITY_SCOPE +
      '\n\nFiltres, tous facultatifs et combinés : `q` (titre et résumé, sans tenir compte des ' +
      'accents ni de la casse), `sector`, `amountMin`/`amountMax` (euros ; une demande sans montant ' +
      'visible ne correspond à aucune borne), `financingType`, `source` (`share` | `pool`), ' +
      '`workspace` (le vivier d’un workspace ; un autre ne correspond à rien) — chacun porte sur ce ' +
      'que la vue au niveau de l’opportunité montre. Tri `sort` : `recent` (par défaut, la ' +
      'provenance la plus récente d’abord), `amount_desc`, `amount_asc`, `name`. Pages de ' +
      '20 (`page` à partir de 1). `counts` : toutes les opportunités, celles d’un partage direct, ' +
      'celles de chaque vivier lu, et les secteurs et types de financement proposés aux filtres.',
  })
  @ApiOkResponse({ description: 'Compteurs, total filtré et page d’opportunités.' })
  @ApiBadRequestResponse({ description: 'Paramètre inconnu ou invalide.' })
  list(
    @Query() query: OpportunitiesQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<OpportunitiesView> {
    return this.opportunities.list(user, query)
  }

  @Get(':dossierId')
  @ApiOperation({
    summary: 'Lire une opportunité',
    description:
      OPPORTUNITY_SCOPE +
      '\n\nLa vue de la demande au niveau de l’opportunité (même projection que ' +
      '`GET /v1/shares/:token`, documents téléchargeables à ce niveau) et `opportunity` (niveau, ' +
      'provenances). Chaque lecture est journalisée une fois (`opportunity_viewed`, invisible du ' +
      'porteur), sur le partage direct du lecteur s’il en a un : elle compte alors comme une ' +
      'consultation de ce partage, une seule fois.',
  })
  @ApiParam({ name: 'dossierId', description: 'UUID de la demande' })
  @ApiOkResponse({ description: 'La demande telle que l’opportunité permet de la lire.' })
  @ApiNotFoundResponse({
    description:
      'Demande inexistante, ou que le compte ne peut pas lire (partage révoqué ou d’un autre ' +
      'destinataire, vivier d’un workspace dont il n’est pas investisseur actif, publication retirée ' +
      'ou en pause, sa propre demande).',
  })
  get(
    @Param('dossierId', uuid) dossierId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<OpportunityView> {
    return this.opportunities.get(user, dossierId)
  }
}
