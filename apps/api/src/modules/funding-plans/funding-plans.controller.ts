import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
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
  confirmFundingPlanPledgeSchema,
  createFundingPlanLineSchema,
  createOwnerFundingPlanLineSchema,
  deleteFundingPlanLineQuerySchema,
  updateFundingPlanLineSchema,
} from '@confluent/shared'
import { createZodDto } from 'nestjs-zod'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy'
import { WorkspaceAccessGuard } from '../workspaces/workspace-access.guard'
import {
  FundingPlansService,
  type FundingPlanParty,
  type FundingPlanView,
} from './funding-plans.service'

class CreateFundingPlanLineDto extends createZodDto(createFundingPlanLineSchema) {}
class CreateOwnerFundingPlanLineDto extends createZodDto(createOwnerFundingPlanLineSchema) {}
class ConfirmFundingPlanPledgeDto extends createZodDto(confirmFundingPlanPledgeSchema) {}
class ReleaseFundingPlanPledgeQueryDto extends createZodDto(deleteFundingPlanLineQuerySchema) {}
class UpdateFundingPlanLineDto extends createZodDto(updateFundingPlanLineSchema) {}
class DeleteFundingPlanLineQueryDto extends createZodDto(deleteFundingPlanLineQuerySchema) {}

const uuid = new ParseUUIDPipe()

// What both sides' routes say of a plan (ROADMAP E06.03).
const PLAN =
  'Le plan de financement de la demande dans ce workspace, porté par la candidature : ses lignes ' +
  '(source du workspace, précision facultative, montant en euros entiers, état `planned` envisagé, ' +
  '`requested` en cours, `obtained` obtenu, `refused` refusé), les sources proposées pour une ' +
  'nouvelle ligne et les totaux (`totals`) : objectif = montant recherché de la demande, obtenu, ' +
  'en cours, envisagé, reste à financer (objectif − obtenu), sans source, dépassement. Lu et ' +
  'modifié par le porteur de projet et par les conseillers du workspace ; aucune autre structure, ' +
  'aucun investisseur, aucun partage. À part (E06.04), `pledges` : les promesses d’investisseurs ' +
  'que cette partie peut lire (le porteur : celles des investisseurs qui lisent la demande ; la ' +
  'structure : celles qu’un investisseur a consenti à lui montrer) et qu’aucune ligne ne confirme ' +
  '— nombre et total « promis, non engageant », jamais comptés dans les totaux —, et pour le ' +
  'porteur celles qu’il peut confirmer ; `lines[].pledge` : la promesse confirmée par la ligne, si ' +
  'cette partie la lit (`current: false` si l’investisseur l’a modifiée depuis : de nouveau promise).'

const WRITE =
  ' Chaque ligne porte une `version` : une ligne modifiée entre-temps est refusée (`409` ' +
  '`FUNDING_PLAN_LINE_CHANGED`), jamais écrasée. Journalisé (`funding_plan_updated`). Renvoie le ' +
  'plan à jour.'

const PLEDGE_CONFLICT =
  ' E06.04 : promesse modifiée, retirée ou plus montrée (`FUNDING_PLAN_PLEDGE_CHANGED`, même ' +
  'réponse pour une promesse inconnue), déjà confirmée par une autre ligne ' +
  '(`FUNDING_PLAN_PLEDGE_HELD`), ligne ni en cours ni obtenue (`FUNDING_PLAN_PLEDGE_STATE`).'

const LINE_ERRORS = {
  badRequest: 'Champ invalide, ou source inconnue dans ce workspace.',
  conflict: 'Ligne modifiée entre-temps, source désactivée, ou 50 lignes déjà.',
}

// The owner of the request keeps the plan of each of its candidatures, a draft included (`404`
// alike for another account's candidature and an unknown one).
@ApiTags('Candidatures')
@ApiBearerAuth('jwt')
@ApiParam({ name: 'candidatureId', description: 'UUID de la candidature' })
@ApiUnauthorizedResponse({ description: 'JWT manquant.' })
@ApiNotFoundResponse({
  description: 'Candidature inexistante ou d’un autre compte ; ligne inconnue.',
})
@Controller('candidatures/:candidatureId/funding-plan')
export class FundingPlanController {
  constructor(private readonly plans: FundingPlansService) {}

  private owner(user: AuthenticatedUser): FundingPlanParty {
    return { side: 'owner', userId: user.id }
  }

  @Get()
  @ApiOperation({ summary: 'Plan de financement (porteur de projet)', description: PLAN })
  @ApiOkResponse({ description: 'Plan de financement.' })
  get(
    @Param('candidatureId', uuid) candidatureId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<FundingPlanView> {
    return this.plans.get(this.owner(user), candidatureId)
  }

  @Post('lines')
  @ApiOperation({
    summary: 'Ajouter une ligne au plan (porteur de projet)',
    description:
      '`{ categoryId, amountEur, state, label?, pledge? }` : une source active du workspace. ' +
      '`pledge: { id, version }` (E06.04) : la ligne, en cours ou obtenue, confirme cette promesse ' +
      '(parmi `pledges.confirmable`, à la version lue) ; elle n’est plus comptée comme promise.' +
      WRITE,
  })
  @ApiCreatedResponse({ description: 'Plan à jour.' })
  @ApiBadRequestResponse({ description: LINE_ERRORS.badRequest })
  @ApiConflictResponse({ description: LINE_ERRORS.conflict + PLEDGE_CONFLICT })
  add(
    @Param('candidatureId', uuid) candidatureId: string,
    @Body() body: CreateOwnerFundingPlanLineDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<FundingPlanView> {
    return this.plans.addLine(this.owner(user), candidatureId, body)
  }

  @Put('lines/:lineId/pledge')
  @ApiParam({ name: 'lineId', description: 'UUID de la ligne' })
  @ApiOperation({
    summary: 'Confirmer une promesse par une ligne du plan (porteur de projet)',
    description:
      '`{ version, pledge: { id, version } }` (E06.04) : la ligne (à sa version lue, en cours ou ' +
      'obtenue) confirme cette promesse à la version lue — une promesse dont l’investisseur montre ' +
      'nom et montant et lit la demande —, à la place de celle qu’elle confirmait. Dès lors le plan ' +
      'compte la ligne et plus la promesse, tant que l’investisseur ne la modifie pas ; modifiée, ' +
      'elle se confirme de nouveau ici. Réservé au porteur ; la structure n’a pas cette route.' +
      WRITE,
  })
  @ApiOkResponse({ description: 'Plan à jour.' })
  @ApiConflictResponse({ description: 'Ligne modifiée entre-temps.' + PLEDGE_CONFLICT })
  confirmPledge(
    @Param('candidatureId', uuid) candidatureId: string,
    @Param('lineId', uuid) lineId: string,
    @Body() body: ConfirmFundingPlanPledgeDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<FundingPlanView> {
    return this.plans.confirmPledge(this.owner(user), candidatureId, lineId, body)
  }

  @Delete('lines/:lineId/pledge')
  @ApiParam({ name: 'lineId', description: 'UUID de la ligne' })
  @ApiOperation({
    summary: 'Détacher la promesse d’une ligne du plan (porteur de projet)',
    description:
      '`?version=` : la version de la ligne lue (E06.04). La ligne reste ; la promesse est de ' +
      'nouveau comptée comme promise. Sans promesse confirmée, rien ne change.' +
      WRITE,
  })
  @ApiOkResponse({ description: 'Plan à jour.' })
  @ApiConflictResponse({ description: 'Ligne modifiée entre-temps.' })
  releasePledge(
    @Param('candidatureId', uuid) candidatureId: string,
    @Param('lineId', uuid) lineId: string,
    @Query() query: ReleaseFundingPlanPledgeQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<FundingPlanView> {
    return this.plans.releasePledge(this.owner(user), candidatureId, lineId, query.version)
  }

  @Patch('lines/:lineId')
  @ApiParam({ name: 'lineId', description: 'UUID de la ligne' })
  @ApiOperation({
    summary: 'Modifier une ligne du plan (porteur de projet)',
    description:
      '`{ version, categoryId?, amountEur?, state?, label? }` : seuls les champs présents changent ' +
      '(`label: null` efface la précision).' +
      WRITE,
  })
  @ApiOkResponse({ description: 'Plan à jour.' })
  @ApiBadRequestResponse({ description: LINE_ERRORS.badRequest })
  @ApiConflictResponse({ description: LINE_ERRORS.conflict })
  update(
    @Param('candidatureId', uuid) candidatureId: string,
    @Param('lineId', uuid) lineId: string,
    @Body() body: UpdateFundingPlanLineDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<FundingPlanView> {
    return this.plans.updateLine(this.owner(user), candidatureId, lineId, body)
  }

  @Delete('lines/:lineId')
  @ApiParam({ name: 'lineId', description: 'UUID de la ligne' })
  @ApiOperation({
    summary: 'Supprimer une ligne du plan (porteur de projet)',
    description: '`?version=` : la version de la ligne lue par le client.' + WRITE,
  })
  @ApiOkResponse({ description: 'Plan à jour.' })
  @ApiConflictResponse({ description: 'Ligne modifiée entre-temps.' })
  remove(
    @Param('candidatureId', uuid) candidatureId: string,
    @Param('lineId', uuid) lineId: string,
    @Query() query: DeleteFundingPlanLineQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<FundingPlanView> {
    return this.plans.deleteLine(this.owner(user), candidatureId, lineId, query.version)
  }
}

// The workspace's side: its active conseillers (the right to manage it is not required) and
// Confluent administrators, on a candidature sent to it. The workspace is checked before anything
// else (guard, `404` outside it), then the candidatures' read rule (`403` for an investisseur).
@ApiTags('Candidatures reçues')
@ApiBearerAuth('jwt')
@ApiParam({ name: 'workspaceId', description: 'UUID du workspace' })
@ApiParam({ name: 'candidatureId', description: 'UUID de la candidature' })
@ApiUnauthorizedResponse({ description: 'JWT manquant.' })
@ApiForbiddenResponse({ description: 'Membre du workspace qui n’en est pas conseiller.' })
@ApiNotFoundResponse({
  description:
    'Workspace inexistant ou dont le compte n’est pas membre actif (même réponse) ; candidature ' +
    'inexistante, d’un autre workspace ou encore en brouillon ; ligne inconnue.',
})
@UseGuards(WorkspaceAccessGuard)
@Controller('workspaces/:workspaceId/candidatures/:candidatureId/funding-plan')
export class ReceivedFundingPlanController {
  constructor(private readonly plans: FundingPlansService) {}

  private workspace(user: AuthenticatedUser, workspaceId: string): FundingPlanParty {
    return { side: 'workspace', actor: user, workspaceId }
  }

  @Get()
  @ApiOperation({ summary: 'Plan de financement (structure)', description: PLAN })
  @ApiOkResponse({ description: 'Plan de financement.' })
  get(
    @Param('workspaceId', uuid) workspaceId: string,
    @Param('candidatureId', uuid) candidatureId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<FundingPlanView> {
    return this.plans.get(this.workspace(user, workspaceId), candidatureId)
  }

  @Post('lines')
  @ApiOperation({
    summary: 'Ajouter une ligne au plan (structure)',
    description:
      '`{ categoryId, amountEur, state, label? }` : une source active du workspace.' + WRITE,
  })
  @ApiCreatedResponse({ description: 'Plan à jour.' })
  @ApiBadRequestResponse({ description: LINE_ERRORS.badRequest })
  @ApiConflictResponse({ description: LINE_ERRORS.conflict })
  add(
    @Param('workspaceId', uuid) workspaceId: string,
    @Param('candidatureId', uuid) candidatureId: string,
    @Body() body: CreateFundingPlanLineDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<FundingPlanView> {
    return this.plans.addLine(this.workspace(user, workspaceId), candidatureId, body)
  }

  @Patch('lines/:lineId')
  @ApiParam({ name: 'lineId', description: 'UUID de la ligne' })
  @ApiOperation({
    summary: 'Modifier une ligne du plan (structure)',
    description:
      '`{ version, categoryId?, amountEur?, state?, label? }` : seuls les champs présents changent ' +
      '(`label: null` efface la précision).' +
      WRITE,
  })
  @ApiOkResponse({ description: 'Plan à jour.' })
  @ApiBadRequestResponse({ description: LINE_ERRORS.badRequest })
  @ApiConflictResponse({ description: LINE_ERRORS.conflict })
  update(
    @Param('workspaceId', uuid) workspaceId: string,
    @Param('candidatureId', uuid) candidatureId: string,
    @Param('lineId', uuid) lineId: string,
    @Body() body: UpdateFundingPlanLineDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<FundingPlanView> {
    return this.plans.updateLine(this.workspace(user, workspaceId), candidatureId, lineId, body)
  }

  @Delete('lines/:lineId')
  @ApiParam({ name: 'lineId', description: 'UUID de la ligne' })
  @ApiOperation({
    summary: 'Supprimer une ligne du plan (structure)',
    description: '`?version=` : la version de la ligne lue par le client.' + WRITE,
  })
  @ApiOkResponse({ description: 'Plan à jour.' })
  @ApiConflictResponse({ description: 'Ligne modifiée entre-temps.' })
  remove(
    @Param('workspaceId', uuid) workspaceId: string,
    @Param('candidatureId', uuid) candidatureId: string,
    @Param('lineId', uuid) lineId: string,
    @Query() query: DeleteFundingPlanLineQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<FundingPlanView> {
    return this.plans.deleteLine(
      this.workspace(user, workspaceId),
      candidatureId,
      lineId,
      query.version,
    )
  }
}
