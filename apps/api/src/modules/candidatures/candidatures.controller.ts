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
import { createCandidatureSchema, upsertAnswersSchema } from '@confluent/shared'
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
  type ReceivedCandidatureSummaryView,
  type ReceivedCandidatureView,
} from './candidatures.service'

class CreateCandidatureDto extends createZodDto(createCandidatureSchema) {}
class UpsertCandidatureAnswersDto extends createZodDto(upsertAnswersSchema) {}

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

  @Delete('candidatures/:candidatureId')
  @HttpCode(204)
  @ApiParam({ name: 'candidatureId', description: 'UUID de la candidature' })
  @ApiOperation({
    summary: 'Retirer la candidature',
    description:
      'La candidature et ses réponses sont supprimées : la structure ne la lit plus. Journalisé ' +
      '(`candidature_withdrawn`).',
  })
  @ApiNoContentResponse({ description: 'Candidature retirée.' })
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
      '(titre, montant, types). Les brouillons restent invisibles.',
  })
  @ApiOkResponse({ description: 'Candidatures reçues.' })
  list(
    @Param('workspaceId', uuid) workspaceId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ReceivedCandidatureSummaryView[]> {
    return this.candidatures.listReceived(user, workspaceId)
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
}
