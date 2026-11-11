import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
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
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger'
import {
  changeFinancingStatusSchema,
  createCandidatureSchema,
  receivedCandidaturesQuerySchema,
  upsertAnswersSchema,
} from '@confluent/shared'
import { createZodDto } from 'nestjs-zod'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy'
import { WorkspaceAccessGuard } from '../workspaces/workspace-access.guard'
import {
  CandidaturesService,
  type CandidatureAnswerView,
  type CandidatureSummaryView,
  type CandidatureView,
  type CandidatureWorkspaceView,
  type ReceivedCandidatureListItemView,
  type ReceivedCandidatureView,
} from './candidatures.service'

class CreateCandidatureDto extends createZodDto(createCandidatureSchema) {}
class UpsertCandidatureAnswersDto extends createZodDto(upsertAnswersSchema) {}
class ChangeFinancingStatusDto extends createZodDto(changeFinancingStatusSchema) {}
class ReceivedCandidaturesQueryDto extends createZodDto(receivedCandidaturesQuerySchema) {}

// E06.01 (decision D03, to be confirmed): what both sides' routes say of the financing status.
const FINANCING_STATUS_RULES =
  'Statuts : `preparing` (en préparation), `in_committee` (en comité), `funded` (financé), ' +
  '`refused` (refusé), `abandoned` (abandonné). Corps `{ from, to }` : `from` est le statut lu ' +
  'par le client ; s’il a changé entre-temps, `409` `FINANCING_STATUS_CHANGED` et rien n’est ' +
  'écrit. Chaque changement est daté et conservé (`statusHistory`) et journalisé ' +
  '(`candidature_status_changed`). Transition que personne ne fait : `409` ' +
  '`FINANCING_TRANSITION_IMPOSSIBLE` ; réservée à l’autre partie : `403` ' +
  '`FINANCING_TRANSITION_FORBIDDEN`.'

const uuid = new ParseUUIDPipe()

// The owner of a financing request presents it to workspaces (ROADMAP E05.09): the request's
// owner only (`404` alike for another account's candidature or request and an unknown one).
@ApiTags('Candidatures')
@ApiBearerAuth('jwt')
@ApiUnauthorizedResponse({ description: 'JWT manquant.' })
@Controller()
export class CandidaturesController {
  constructor(private readonly candidatures: CandidaturesService) {}

  @Get('candidature-workspaces')
  @ApiOperation({
    summary: 'Structures qui reçoivent des candidatures',
    description:
      'Les workspaces dont un formulaire publié est affecté aux candidatures, par leur identité ' +
      'publique (nom, programme, couleur, présentation), triés par nom. Réservé aux comptes qui ' +
      'peuvent posséder une entreprise.',
  })
  @ApiOkResponse({ description: 'Workspaces ouverts aux candidatures.' })
  @ApiForbiddenResponse({ description: 'Compte qui ne peut pas posséder d’entreprise.' })
  openWorkspaces(@CurrentUser() user: AuthenticatedUser): Promise<CandidatureWorkspaceView[]> {
    return this.candidatures.listOpenWorkspaces(user)
  }

  @Get('dossiers/:dossierId/candidatures')
  @ApiParam({ name: 'dossierId', description: 'UUID de la demande de financement' })
  @ApiOperation({
    summary: 'Candidatures d’une demande',
    description:
      'Les structures auxquelles la demande est présentée, la plus récente d’abord : brouillon ' +
      '(`draft`, invisible pour la structure) ou envoyée (`submitted`).',
  })
  @ApiOkResponse({ description: 'Candidatures de la demande.' })
  @ApiNotFoundResponse({ description: 'Demande inexistante ou d’un autre compte.' })
  list(
    @Param('dossierId', uuid) dossierId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<CandidatureSummaryView[]> {
    return this.candidatures.listForDossier(dossierId, user.id)
  }

  @Post('dossiers/:dossierId/candidatures')
  @ApiParam({ name: 'dossierId', description: 'UUID de la demande de financement' })
  @ApiOperation({
    summary: 'Présenter la demande à une structure',
    description:
      'Ouvre une candidature, en brouillon, auprès d’un workspace qui reçoit des candidatures : elle ' +
      'présentera le profil commun de l’entreprise tel quel (aucune ressaisie) et répond à la ' +
      'version publiée du formulaire complémentaire de la structure, conservée ensuite. Une seule ' +
      'candidature par demande et par structure. Journalisé (`candidature_created`).',
  })
  @ApiCreatedResponse({ description: 'Candidature créée, avec son formulaire.' })
  @ApiNotFoundResponse({
    description:
      'Demande inexistante ou d’un autre compte ; structure inconnue ou qui ne reçoit pas de ' +
      'candidatures (même réponse).',
  })
  @ApiConflictResponse({
    description:
      'Demande déjà présentée à cette structure, ou entreprise en préparation par un conseiller.',
  })
  create(
    @Param('dossierId', uuid) dossierId: string,
    @Body() body: CreateCandidatureDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<CandidatureView> {
    return this.candidatures.create(dossierId, user.id, body.workspaceId)
  }

  @Get('candidatures/:candidatureId')
  @ApiParam({ name: 'candidatureId', description: 'UUID de la candidature' })
  @ApiOperation({
    summary: 'Détail d’une candidature',
    description:
      'La structure (identité publique), la demande, la version du formulaire complémentaire et ' +
      'les réponses de la candidature, avec leur provenance et leur historique.',
  })
  @ApiOkResponse({ description: 'Candidature.' })
  @ApiNotFoundResponse({ description: 'Candidature inexistante ou d’un autre compte.' })
  get(
    @Param('candidatureId', uuid) candidatureId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<CandidatureView> {
    return this.candidatures.getForOwner(candidatureId, user.id)
  }

  @Put('candidatures/:candidatureId/answers')
  @ApiParam({ name: 'candidatureId', description: 'UUID de la candidature' })
  @ApiOperation({
    summary: 'Enregistrer des réponses au formulaire de la structure',
    description:
      'Mêmes règles que le profil : chaque champ appartient à la version du formulaire de la ' +
      'candidature et chaque valeur respecte son type, sinon `400` et rien n’est écrit ' +
      '(`error.details`) ; une candidature envoyée garde ses réponses obligatoires. Saisie humaine ' +
      'confirmée, faite dans le site par l’utilisateur connecté. Ces réponses sont propres à la ' +
      'candidature : ni le profil, ni une autre structure, ni un partage ne les voient.',
  })
  @ApiOkResponse({ description: 'Réponses enregistrées.' })
  @ApiBadRequestResponse({ description: 'Champ étranger au formulaire ou valeur invalide.' })
  @ApiNotFoundResponse({ description: 'Candidature inexistante ou d’un autre compte.' })
  saveAnswers(
    @Param('candidatureId', uuid) candidatureId: string,
    @Body() body: UpsertCandidatureAnswersDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<CandidatureAnswerView[]> {
    return this.candidatures.saveAnswers(candidatureId, user.id, body.answers, {
      userId: user.id,
      channel: 'site',
    })
  }

  @Post('candidatures/:candidatureId/submit')
  @HttpCode(200)
  @ApiParam({ name: 'candidatureId', description: 'UUID de la candidature' })
  @ApiOperation({
    summary: 'Envoyer la candidature à la structure',
    description:
      'Ses conseillers la lisent dès lors : présentation de la demande, profil commun, réponses au ' +
      'formulaire de la structure. Exige le profil de l’entreprise soumis pour cette demande et ' +
      'chaque question obligatoire du formulaire de la structure. Journalisé ' +
      '(`candidature_submitted`) ; un nouvel envoi ne change rien.',
  })
  @ApiOkResponse({ description: 'Candidature envoyée.' })
  @ApiUnprocessableEntityResponse({
    description: 'Profil non soumis, ou réponses obligatoires manquantes (`error.details`).',
  })
  @ApiNotFoundResponse({ description: 'Candidature inexistante ou d’un autre compte.' })
  submit(
    @Param('candidatureId', uuid) candidatureId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<CandidatureView> {
    return this.candidatures.submit(candidatureId, user.id)
  }

  @Post('candidatures/:candidatureId/financing-status')
  @HttpCode(200)
  @ApiParam({ name: 'candidatureId', description: 'UUID de la candidature' })
  @ApiOperation({
    summary: 'Changer le statut de financement (porteur de projet)',
    description:
      'Sur une candidature envoyée (`409` `CANDIDATURE_NOT_SENT` sinon), le porteur de projet ' +
      'abandonne sa demande auprès de cette structure (`preparing`/`in_committee` → `abandoned`) ' +
      'ou reprend un abandon (`abandoned` → `preparing`) ; le reste est décidé par la structure. ' +
      FINANCING_STATUS_RULES,
  })
  @ApiOkResponse({ description: 'Candidature, avec son nouveau statut et son historique.' })
  @ApiBadRequestResponse({ description: 'Statut inconnu, ou identique au statut lu.' })
  @ApiForbiddenResponse({ description: 'Statut décidé par la structure.' })
  @ApiConflictResponse({
    description: 'Candidature non envoyée, statut changé entre-temps ou transition impossible.',
  })
  @ApiNotFoundResponse({ description: 'Candidature inexistante ou d’un autre compte.' })
  changeFinancingStatus(
    @Param('candidatureId', uuid) candidatureId: string,
    @Body() body: ChangeFinancingStatusDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<CandidatureView> {
    return this.candidatures.changeFinancingStatusAsOwner(candidatureId, user.id, body)
  }

  @Delete('candidatures/:candidatureId')
  @HttpCode(204)
  @ApiParam({ name: 'candidatureId', description: 'UUID de la candidature' })
  @ApiOperation({
    summary: 'Retirer une candidature en brouillon',
    description:
      'La candidature et ses réponses sont supprimées. Journalisé (`candidature_withdrawn`). Une ' +
      'candidature envoyée est suivie et gardée par la structure : `409` `CANDIDATURE_SENT`, elle ' +
      's’abandonne par son statut de financement.',
  })
  @ApiNoContentResponse({ description: 'Candidature retirée.' })
  @ApiConflictResponse({ description: 'Candidature déjà envoyée.' })
  @ApiNotFoundResponse({ description: 'Candidature inexistante ou d’un autre compte.' })
  withdraw(
    @Param('candidatureId', uuid) candidatureId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    return this.candidatures.withdraw(candidatureId, user.id)
  }
}

// The candidatures a workspace receives (ROADMAP E05.09), for its conseillers and Confluent's
// administrators. The workspace is checked before anything else (guard, `404` outside it), then
// the service applies `canReviewCandidatures` (`403` for an investisseur).
@ApiTags('Candidatures reçues')
@ApiBearerAuth('jwt')
@ApiParam({ name: 'workspaceId', description: 'UUID du workspace' })
@ApiUnauthorizedResponse({ description: 'JWT manquant.' })
@ApiForbiddenResponse({ description: 'Membre du workspace qui n’en est pas conseiller.' })
@ApiNotFoundResponse({
  description:
    'Workspace inexistant ou dont le compte n’est pas membre actif (même réponse) ; candidature ' +
    'inexistante, d’un autre workspace ou encore en brouillon.',
})
@UseGuards(WorkspaceAccessGuard)
@Controller('workspaces/:workspaceId/candidatures')
export class ReceivedCandidaturesController {
  constructor(private readonly candidatures: CandidaturesService) {}

  @Get()
  @ApiOperation({
    summary: 'Candidatures reçues',
    description:
      'Les candidatures envoyées au workspace, la plus récente d’abord : entreprise, demande ' +
      '(titre, montant, types), statut de financement dans ce workspace et éligibilités aux ' +
      'dispositifs du workspace (`eligibilities`, informations déclaratives). Filtres facultatifs, ' +
      'combinés : `scheme` (UUID d’un dispositif du workspace ; tout autre identifiant ne trouve ' +
      'rien), `verified=true` (éligibilités vérifiées par la structure seulement), ' +
      '`financingStatus`. Les brouillons restent invisibles.',
  })
  @ApiOkResponse({ description: 'Candidatures reçues.' })
  @ApiBadRequestResponse({ description: 'Filtre inconnu ou invalide.' })
  list(
    @Param('workspaceId', uuid) workspaceId: string,
    @Query() query: ReceivedCandidaturesQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ReceivedCandidatureListItemView[]> {
    return this.candidatures.listReceived(user, workspaceId, query)
  }

  @Get(':candidatureId')
  @ApiParam({ name: 'candidatureId', description: 'UUID de la candidature' })
  @ApiOperation({
    summary: 'Lire une candidature reçue',
    description:
      'Le porteur de projet (nom, email), la présentation de la demande, le profil commun de ' +
      'l’entreprise (questions et réponses, pièces jointes exclues) et les réponses de la ' +
      'candidature au formulaire du workspace, sans provenance ni historique.',
  })
  @ApiOkResponse({ description: 'Candidature reçue.' })
  get(
    @Param('workspaceId', uuid) workspaceId: string,
    @Param('candidatureId', uuid) candidatureId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ReceivedCandidatureView> {
    return this.candidatures.getReceived(user, workspaceId, candidatureId)
  }

  @Post(':candidatureId/financing-status')
  @HttpCode(200)
  @ApiParam({ name: 'candidatureId', description: 'UUID de la candidature' })
  @ApiOperation({
    summary: 'Changer le statut de financement (structure)',
    description:
      'Conseillers actifs du workspace (droit de gestion non requis) et administrateurs, sur une ' +
      'candidature envoyée à ce workspace : passage en comité et retour en préparation, ' +
      'financement, refus, abandon constaté, réouverture d’un statut clos. ' +
      FINANCING_STATUS_RULES,
  })
  @ApiOkResponse({ description: 'Candidature reçue, avec son nouveau statut et son historique.' })
  @ApiBadRequestResponse({ description: 'Statut inconnu, ou identique au statut lu.' })
  @ApiConflictResponse({ description: 'Statut changé entre-temps ou transition impossible.' })
  changeFinancingStatus(
    @Param('workspaceId', uuid) workspaceId: string,
    @Param('candidatureId', uuid) candidatureId: string,
    @Body() body: ChangeFinancingStatusDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ReceivedCandidatureView> {
    return this.candidatures.changeFinancingStatusForWorkspace(
      user,
      workspaceId,
      candidatureId,
      body,
    )
  }
}
