import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Put,
  Query,
} from '@nestjs/common'
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger'
import {
  PLEDGE_NON_COMMITMENT,
  markInterestSchema,
  opportunitiesQuerySchema,
  pledgeInputSchema,
} from '@confluent/shared'
import { createZodDto } from 'nestjs-zod'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy'
import { ACCESS_LEVELS_DOC } from '../dossiers/financeur-access'
import { InterestsService } from './interests.service'
import { PledgesService } from './pledges.service'
import {
  OpportunitiesService,
  type OpportunitiesView,
  type OpportunityInterestView,
  type OpportunityPledgeView,
  type OpportunityView,
} from './opportunities.service'

class OpportunitiesQueryDto extends createZodDto(opportunitiesQuerySchema) {}
class MarkInterestDto extends createZodDto(markInterestSchema) {}
class PledgeDto extends createZodDto(pledgeInputSchema) {}

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

// What a mark of interest is and who sees what of it (E07.05, D05), said once for both routes.
export const INTEREST_SCOPE =
  'Une marque d’intérêt par investisseur et demande, posée sur une opportunité que le compte ' +
  'connecté lit maintenant (même règle que `GET /v1/opportunities/:dossierId`). Le porteur voit ' +
  'toujours le nombre de marques des investisseurs qui lisent encore la demande, et le nom d’un ' +
  'investisseur seulement si celui-ci l’a choisi (`nameVisible`) : nom du compte et organisation ' +
  'enregistrée dans les structures dont le vivier lui apporte la demande, jamais son adresse. ' +
  'Personne d’autre ne lit les marques (ni conseillers, ni autres investisseurs). Une marque d’un ' +
  'investisseur qui ne lit plus la demande (partage révoqué, publication retirée ou en pause, ' +
  'adhésion ou compte désactivés) n’est ni comptée ni nommée tant que cela dure.'

// What a pledge is and who sees what of it (E07.06), said once for every route.
export const PLEDGE_SCOPE =
  PLEDGE_NON_COMMITMENT +
  ' Une promesse par investisseur et demande, distincte de la marque d’intérêt, faite sur une ' +
  'opportunité que le compte connecté lit maintenant (même règle que ' +
  '`GET /v1/opportunities/:dossierId`) : intention (`exploring` à l’étude, `likely` probable, ' +
  '`strong` forte), montant en euros entiers (1 € à 1 Md€), commentaire facultatif (texte simple, ' +
  '1 000 caractères au plus), et deux choix sans valeur par défaut : montrer son nom ' +
  '(`showName`) et montrer son montant (`showAmount`) au porteur. Modifiable et retirable jusqu’à ' +
  'la clôture de la demande (son archivage par le porteur) ; masquer son nom ou son montant reste ' +
  'toujours possible. Le porteur voit toujours le nombre et le total des promesses des ' +
  'investisseurs qui lisent encore la demande, et pour chacune le nom et le montant que ' +
  'l’investisseur a choisi de montrer — jamais l’intention, le commentaire ni une date. Personne ' +
  'd’autre ne lit les promesses (ni conseillers, ni autres investisseurs).'

// ROADMAP E07.03: the signed-in investor's opportunities (« inbox »), read from their account only.
@ApiTags('Opportunités')
@ApiBearerAuth('jwt')
@ApiUnauthorizedResponse({ description: 'JWT manquant.' })
@Controller('opportunities')
export class OpportunitiesController {
  constructor(
    private readonly opportunities: OpportunitiesService,
    private readonly interests: InterestsService,
    private readonly pledges: PledgesService,
  ) {}

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

  @Put(':dossierId/interest')
  @ApiOperation({
    summary: 'Marquer mon intérêt pour une opportunité',
    description:
      INTEREST_SCOPE +
      '\n\nCorps `{ nameVisible }`, sans valeur par défaut : `true` autorise le porteur à voir qui ' +
      'vous êtes. Marquer à nouveau ne change que ce choix ; la même réponse ne change rien. ' +
      'Journalisé (`investor_interest_marked`, invisible du porteur). Ne compte pas comme une ' +
      'lecture de l’opportunité.',
  })
  @ApiParam({ name: 'dossierId', description: 'UUID de la demande' })
  @ApiOkResponse({ description: 'La marque : `markedAt` (première marque), `nameVisible`.' })
  @ApiBadRequestResponse({ description: '`nameVisible` absent ou invalide.' })
  @ApiNotFoundResponse({ description: 'Demande que le compte ne lit pas comme opportunité.' })
  @ApiConflictResponse({
    description:
      'Demande archivée : ni nouvelle marque ni nom nouvellement montré (masquer son nom reste ' +
      'possible).',
  })
  markInterest(
    @Param('dossierId', uuid) dossierId: string,
    @Body() body: MarkInterestDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<OpportunityInterestView> {
    return this.interests.mark(user, dossierId, body)
  }

  @Delete(':dossierId/interest')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Retirer ma marque d’intérêt',
    description:
      INTEREST_SCOPE +
      '\n\nRetire la marque du compte connecté, qu’il lise encore la demande ou non ; même réponse ' +
      'sans marque. Journalisé (`investor_interest_withdrawn`, invisible du porteur).',
  })
  @ApiParam({ name: 'dossierId', description: 'UUID de la demande' })
  @ApiNoContentResponse({ description: 'Plus aucune marque de ce compte sur cette demande.' })
  withdrawInterest(
    @Param('dossierId', uuid) dossierId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    return this.interests.withdraw(user, dossierId)
  }

  @Put(':dossierId/pledge')
  @ApiOperation({
    summary: 'Faire ou modifier ma promesse sur une opportunité',
    description:
      PLEDGE_SCOPE +
      '\n\nCorps : la promesse entière `{ intention, amountEur, comment?, showName, showAmount, ' +
      'version }` ; `version` est celle de la promesse lue (`null` pour une première promesse) : une ' +
      'promesse changée entre-temps n’est jamais écrasée (`409`). La promesse déjà ' +
      'enregistrée ne change rien. Journalisé (`investor_pledge_set`, sans le texte du commentaire, ' +
      'invisible du porteur). Ne compte pas comme une lecture de l’opportunité.',
  })
  @ApiParam({ name: 'dossierId', description: 'UUID de la demande' })
  @ApiOkResponse({
    description:
      'La promesse : `intention`, `amountEur`, `comment`, `showName`, `showAmount`, `version`, ' +
      '`pledgedAt` (première promesse), `updatedAt`.',
  })
  @ApiBadRequestResponse({ description: 'Champ absent, inconnu ou invalide.' })
  @ApiNotFoundResponse({ description: 'Demande que le compte ne lit pas comme opportunité.' })
  @ApiConflictResponse({
    description:
      'La promesse a changé depuis la version lue ; ou demande archivée : ni nouvelle promesse ni ' +
      'modification (masquer son nom ou son montant reste possible).',
  })
  setPledge(
    @Param('dossierId', uuid) dossierId: string,
    @Body() body: PledgeDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<OpportunityPledgeView> {
    return this.pledges.set(user, dossierId, body)
  }

  @Delete(':dossierId/pledge')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Retirer ma promesse',
    description:
      PLEDGE_SCOPE +
      '\n\nRetire la promesse du compte connecté, qu’il lise encore la demande ou non ; même ' +
      'réponse sans promesse. Journalisé (`investor_pledge_withdrawn`, invisible du porteur).',
  })
  @ApiParam({ name: 'dossierId', description: 'UUID de la demande' })
  @ApiNoContentResponse({ description: 'Plus aucune promesse de ce compte sur cette demande.' })
  @ApiConflictResponse({
    description: 'Demande archivée : la promesse est conservée telle quelle.',
  })
  withdrawPledge(
    @Param('dossierId', uuid) dossierId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    return this.pledges.withdraw(user, dossierId)
  }
}
