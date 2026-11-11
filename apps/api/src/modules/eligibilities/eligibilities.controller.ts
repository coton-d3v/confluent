import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
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
  declareEligibilitySchema,
  declareReceivedEligibilitySchema,
  deleteEligibilityQuerySchema,
  updateEligibilitySchema,
  updateReceivedEligibilitySchema,
} from '@confluent/shared'
import { createZodDto } from 'nestjs-zod'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy'
import type { CandidatureParty } from '../candidatures/candidatures.service'
import { WorkspaceAccessGuard } from '../workspaces/workspace-access.guard'
import { EligibilitiesService, type EligibilitiesView } from './eligibilities.service'

class DeclareEligibilityDto extends createZodDto(declareEligibilitySchema) {}
class DeclareReceivedEligibilityDto extends createZodDto(declareReceivedEligibilitySchema) {}
class UpdateEligibilityDto extends createZodDto(updateEligibilitySchema) {}
class UpdateReceivedEligibilityDto extends createZodDto(updateReceivedEligibilitySchema) {}
class DeleteEligibilityQueryDto extends createZodDto(deleteEligibilityQuerySchema) {}

const uuid = new ParseUUIDPipe()

// What both sides' routes say of eligibilities (ROADMAP E06.05).
const ELIGIBILITIES =
  'Les éligibilités de la candidature aux dispositifs de son workspace (JEIR, JEI, CIR…) : ' +
  'informations déclaratives, sans aucune simulation ni montant d’avantage fiscal. Chacune dit qui ' +
  'l’a indiquée (`declaredBy` : porteur ou structure), une précision facultative et, une fois la ' +
  'structure l’ayant vérifiée, la date `verifiedAt`. `schemes` : les dispositifs actifs encore ' +
  'disponibles. Lues et modifiées par le porteur de projet et par les conseillers du workspace ; ' +
  'aucune autre structure, aucun investisseur, aucun partage.'

const WRITE =
  ' Chaque éligibilité porte une `version` : une éligibilité modifiée entre-temps est refusée ' +
  '(`409` `ELIGIBILITY_CHANGED`), jamais écrasée. Journalisé (`candidature_eligibility_updated`). ' +
  'Renvoie les éligibilités à jour.'

const DECLARE_ERRORS = {
  badRequest: 'Champ invalide, ou dispositif inconnu dans ce workspace.',
  conflict: 'Éligibilité déjà indiquée, ou dispositif désactivé.',
}

// The owner of the request keeps the eligibilities of each of its candidatures, a draft included
// (`404` alike for another account's candidature and an unknown one). The owner never verifies.
@ApiTags('Candidatures')
@ApiBearerAuth('jwt')
@ApiParam({ name: 'candidatureId', description: 'UUID de la candidature' })
@ApiUnauthorizedResponse({ description: 'JWT manquant.' })
@ApiNotFoundResponse({
  description: 'Candidature inexistante ou d’un autre compte ; éligibilité inconnue.',
})
@Controller('candidatures/:candidatureId/eligibilities')
export class EligibilitiesController {
  constructor(private readonly eligibilities: EligibilitiesService) {}

  private owner(user: AuthenticatedUser): CandidatureParty {
    return { side: 'owner', userId: user.id }
  }

  @Get()
  @ApiOperation({
    summary: 'Éligibilités aux dispositifs (porteur de projet)',
    description: ELIGIBILITIES,
  })
  @ApiOkResponse({ description: 'Éligibilités.' })
  get(
    @Param('candidatureId', uuid) candidatureId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<EligibilitiesView> {
    return this.eligibilities.get(this.owner(user), candidatureId)
  }

  @Post()
  @ApiOperation({
    summary: 'Indiquer une éligibilité (porteur de projet)',
    description:
      '`{ schemeId, note? }` : un dispositif actif du workspace, une fois par candidature.' + WRITE,
  })
  @ApiCreatedResponse({ description: 'Éligibilités à jour.' })
  @ApiBadRequestResponse({ description: DECLARE_ERRORS.badRequest })
  @ApiConflictResponse({ description: DECLARE_ERRORS.conflict })
  declare(
    @Param('candidatureId', uuid) candidatureId: string,
    @Body() body: DeclareEligibilityDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<EligibilitiesView> {
    return this.eligibilities.declare(this.owner(user), candidatureId, body)
  }

  @Patch(':eligibilityId')
  @ApiParam({ name: 'eligibilityId', description: 'UUID de l’éligibilité' })
  @ApiOperation({
    summary: 'Modifier la précision d’une éligibilité (porteur de projet)',
    description:
      '`{ version, note }` (`null` efface la précision). Une précision modifiée retire la ' +
      'vérification de la structure, qui portait sur la précédente.' +
      WRITE,
  })
  @ApiOkResponse({ description: 'Éligibilités à jour.' })
  @ApiBadRequestResponse({ description: 'Champ invalide.' })
  @ApiConflictResponse({ description: 'Éligibilité modifiée entre-temps.' })
  update(
    @Param('candidatureId', uuid) candidatureId: string,
    @Param('eligibilityId', uuid) eligibilityId: string,
    @Body() body: UpdateEligibilityDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<EligibilitiesView> {
    return this.eligibilities.update(this.owner(user), candidatureId, eligibilityId, body)
  }

  @Delete(':eligibilityId')
  @ApiParam({ name: 'eligibilityId', description: 'UUID de l’éligibilité' })
  @ApiOperation({
    summary: 'Retirer une éligibilité (porteur de projet)',
    description: '`?version=` : la version de l’éligibilité lue par le client.' + WRITE,
  })
  @ApiOkResponse({ description: 'Éligibilités à jour.' })
  @ApiConflictResponse({ description: 'Éligibilité modifiée entre-temps.' })
  remove(
    @Param('candidatureId', uuid) candidatureId: string,
    @Param('eligibilityId', uuid) eligibilityId: string,
    @Query() query: DeleteEligibilityQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<EligibilitiesView> {
    return this.eligibilities.remove(this.owner(user), candidatureId, eligibilityId, query.version)
  }
}

// The workspace's side: its active conseillers (the right to manage it is not required) and
// Confluent administrators, on a candidature sent to it; they alone verify. The workspace is checked
// before anything else (guard, `404` outside it), then the candidatures' read rule (`403` for an
// investisseur).
@ApiTags('Candidatures reçues')
@ApiBearerAuth('jwt')
@ApiParam({ name: 'workspaceId', description: 'UUID du workspace' })
@ApiParam({ name: 'candidatureId', description: 'UUID de la candidature' })
@ApiUnauthorizedResponse({ description: 'JWT manquant.' })
@ApiForbiddenResponse({ description: 'Membre du workspace qui n’en est pas conseiller.' })
@ApiNotFoundResponse({
  description:
    'Workspace inexistant ou dont le compte n’est pas membre actif (même réponse) ; candidature ' +
    'inexistante, d’un autre workspace ou encore en brouillon ; éligibilité inconnue.',
})
@UseGuards(WorkspaceAccessGuard)
@Controller('workspaces/:workspaceId/candidatures/:candidatureId/eligibilities')
export class ReceivedEligibilitiesController {
  constructor(private readonly eligibilities: EligibilitiesService) {}

  private workspace(user: AuthenticatedUser, workspaceId: string): CandidatureParty {
    return { side: 'workspace', actor: user, workspaceId }
  }

  @Get()
  @ApiOperation({ summary: 'Éligibilités aux dispositifs (structure)', description: ELIGIBILITIES })
  @ApiOkResponse({ description: 'Éligibilités.' })
  get(
    @Param('workspaceId', uuid) workspaceId: string,
    @Param('candidatureId', uuid) candidatureId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<EligibilitiesView> {
    return this.eligibilities.get(this.workspace(user, workspaceId), candidatureId)
  }

  @Post()
  @ApiOperation({
    summary: 'Indiquer une éligibilité (structure)',
    description:
      '`{ schemeId, note?, verified? }` : un dispositif actif du workspace, une fois par ' +
      'candidature ; `verified: true` la marque vérifiée par la structure.' +
      WRITE,
  })
  @ApiCreatedResponse({ description: 'Éligibilités à jour.' })
  @ApiBadRequestResponse({ description: DECLARE_ERRORS.badRequest })
  @ApiConflictResponse({ description: DECLARE_ERRORS.conflict })
  declare(
    @Param('workspaceId', uuid) workspaceId: string,
    @Param('candidatureId', uuid) candidatureId: string,
    @Body() body: DeclareReceivedEligibilityDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<EligibilitiesView> {
    return this.eligibilities.declare(this.workspace(user, workspaceId), candidatureId, body)
  }

  @Patch(':eligibilityId')
  @ApiParam({ name: 'eligibilityId', description: 'UUID de l’éligibilité' })
  @ApiOperation({
    summary: 'Vérifier une éligibilité ou modifier sa précision (structure)',
    description:
      '`{ version, note?, verified? }` : seuls les champs présents changent ; `verified: true` la ' +
      'marque vérifiée par la structure (date conservée), `false` retire la vérification.' +
      WRITE,
  })
  @ApiOkResponse({ description: 'Éligibilités à jour.' })
  @ApiBadRequestResponse({ description: 'Champ invalide, ou aucun champ.' })
  @ApiConflictResponse({ description: 'Éligibilité modifiée entre-temps.' })
  update(
    @Param('workspaceId', uuid) workspaceId: string,
    @Param('candidatureId', uuid) candidatureId: string,
    @Param('eligibilityId', uuid) eligibilityId: string,
    @Body() body: UpdateReceivedEligibilityDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<EligibilitiesView> {
    return this.eligibilities.update(
      this.workspace(user, workspaceId),
      candidatureId,
      eligibilityId,
      body,
    )
  }

  @Delete(':eligibilityId')
  @ApiParam({ name: 'eligibilityId', description: 'UUID de l’éligibilité' })
  @ApiOperation({
    summary: 'Retirer une éligibilité (structure)',
    description: '`?version=` : la version de l’éligibilité lue par le client.' + WRITE,
  })
  @ApiOkResponse({ description: 'Éligibilités à jour.' })
  @ApiConflictResponse({ description: 'Éligibilité modifiée entre-temps.' })
  remove(
    @Param('workspaceId', uuid) workspaceId: string,
    @Param('candidatureId', uuid) candidatureId: string,
    @Param('eligibilityId', uuid) eligibilityId: string,
    @Query() query: DeleteEligibilityQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<EligibilitiesView> {
    return this.eligibilities.remove(
      this.workspace(user, workspaceId),
      candidatureId,
      eligibilityId,
      query.version,
    )
  }
}
