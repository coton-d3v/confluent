import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common'
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger'
import {
  changeCommitteeApplicationSchema,
  changeWorkspaceCommitteeApplicationSchema,
} from '@confluent/shared'
import { createZodDto } from 'nestjs-zod'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy'
import { WorkspaceAccessGuard } from '../workspaces/workspace-access.guard'
import {
  CommitteeApplicationsService,
  type CandidateCommitteeView,
  type CommitteeApplicationView,
} from './committee-applications.service'

class ChangeCommitteeApplicationDto extends createZodDto(changeCommitteeApplicationSchema) {}
class ChangeWorkspaceCommitteeApplicationDto extends createZodDto(
  changeWorkspaceCommitteeApplicationSchema,
) {}

const uuid = new ParseUUIDPipe()

// E08.03: what both sides' routes say of an entry's statuses and transitions.
const RULES =
  'Statuts : `applied` (candidature du porteur, en attente de la structure), `proposed` ' +
  '(proposition de la structure, en attente du porteur), `accepted` (retenue : les deux parties ' +
  'ont accepté), `refused` (refusée par la structure), `withdrawn` (retirée). Le porteur candidate ' +
  '(aussi après un retrait, jamais après un refus), confirme une proposition et retire ; la ' +
  'structure propose (aussi après un retrait ou un refus), accepte ou refuse une candidature et ' +
  'retire. Corps `{ to, version }` : `version` est celle de la participation lue, `null` si aucune ' +
  '; si elle a changé entre-temps, `409` `COMMITTEE_APPLICATION_CHANGED` et rien n’est écrit (une ' +
  'seule participation par candidature et comité). Transition que personne ne fait : `409` ; ' +
  'réservée à l’autre partie : `403`. Seulement sur un comité programmé (`409` `COMMITTEE_CLOSED`) ' +
  'et une candidature envoyée ; candidater, proposer ou retenir exigent un statut de financement ' +
  'ouvert et une demande non archivée (`409`). Journalisé (`committee_application_changed`), hors ' +
  'de l’historique du porteur.'

// The owner of a request reads the committees of the workspace its candidature was sent to, and
// applies to them (ROADMAP E08.03): the request's owner only (`404` alike for another account's
// candidature and an unknown one).
@ApiTags('Candidatures')
@ApiBearerAuth('jwt')
@ApiUnauthorizedResponse({ description: 'JWT manquant.' })
@ApiParam({ name: 'candidatureId', description: 'UUID de la candidature' })
@Controller('candidatures/:candidatureId/committees')
export class CandidateCommitteesController {
  constructor(private readonly applications: CommitteeApplicationsService) {}

  @Get()
  @ApiOperation({
    summary: 'Comités de la structure, vus depuis une candidature',
    description:
      'Les comités programmés et pas encore commencés du workspace de la candidature (auxquels le ' +
      'porteur peut candidater), et ceux où la demande a une participation quel que soit leur ' +
      'statut, du plus proche au plus lointain. Chaque comité par sa vue partagée seulement (nom, ' +
      'date, heure, fuseau, lieu, statut, informations diffusées ; jamais les notes internes) ; le ' +
      'lien de visioconférence seulement une fois la participation retenue (`accepted`). ' +
      '`application` : la participation de la demande (statut, partie qui l’a changée en dernier, ' +
      'jamais le nom du conseiller, version), ou `null`. Liste vide pour un brouillon.',
  })
  @ApiOkResponse({ description: 'Comités et participations.' })
  @ApiNotFoundResponse({ description: 'Candidature inexistante ou d’un autre compte.' })
  list(
    @Param('candidatureId', uuid) candidatureId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<CandidateCommitteeView[]> {
    return this.applications.listForOwner(user.id, candidatureId)
  }

  @Post(':committeeId/application')
  @HttpCode(200)
  @ApiParam({ name: 'committeeId', description: 'UUID du comité' })
  @ApiOperation({
    summary: 'Candidater à un comité, confirmer une proposition ou retirer la demande',
    description:
      'Côté porteur : `to` vaut `applied` (candidater, avant le début du comité), `accepted` ' +
      '(confirmer la proposition de la structure, avant le début du comité) ou `withdrawn` (retirer ' +
      'ou décliner). ' +
      RULES +
      ' Renvoie la liste des comités de la candidature.',
  })
  @ApiOkResponse({ description: 'Participation changée ; comités de la candidature.' })
  @ApiBadRequestResponse({ description: 'Corps invalide.' })
  @ApiForbiddenResponse({ description: 'Transition réservée à la structure.' })
  @ApiNotFoundResponse({
    description:
      'Candidature inexistante ou d’un autre compte ; comité inconnu, d’un autre workspace, ou ' +
      'que le porteur ne voit pas (même réponse).',
  })
  @ApiConflictResponse({
    description:
      'Participation changée entre-temps, transition impossible, comité annulé, tenu ou commencé, ' +
      'candidature non envoyée, statut de financement clos ou demande archivée.',
  })
  change(
    @Param('candidatureId', uuid) candidatureId: string,
    @Param('committeeId', uuid) committeeId: string,
    @Body() body: ChangeCommitteeApplicationDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<CandidateCommitteeView[]> {
    return this.applications.changeAsOwner(user.id, candidatureId, committeeId, body)
  }
}

// The requests applied to, proposed for and retained at a committee, as the workspace's conseillers
// and Confluent administrators follow them (`canReviewCandidatures`). The workspace is checked
// before anything else (guard, `404` outside it), then the service applies the read rule (`403` for
// an investisseur).
@ApiTags('Comités')
@ApiBearerAuth('jwt')
@ApiParam({ name: 'workspaceId', description: 'UUID du workspace' })
@ApiParam({ name: 'committeeId', description: 'UUID du comité' })
@ApiUnauthorizedResponse({ description: 'JWT manquant.' })
@ApiForbiddenResponse({ description: 'Membre du workspace qui n’en est pas conseiller.' })
@ApiNotFoundResponse({
  description:
    'Workspace inexistant ou dont le compte n’est pas membre actif (même réponse), comité ' +
    'inexistant dans ce workspace, ou candidature qu’il n’a pas reçue.',
})
@UseGuards(WorkspaceAccessGuard)
@Controller('workspaces/:workspaceId/committees/:committeeId/applications')
export class CommitteeApplicationsController {
  constructor(private readonly applications: CommitteeApplicationsService) {}

  @Get()
  @ApiOperation({
    summary: 'Demandes rattachées à un comité',
    description:
      'Chaque participation au comité (tous statuts), la plus ancienne d’abord : candidature ' +
      '(entreprise, demande, statut de financement), statut, partie et personne qui l’ont changée ' +
      'en dernier, version.',
  })
  @ApiOkResponse({ description: 'Participations du comité.' })
  list(
    @Param('workspaceId', uuid) workspaceId: string,
    @Param('committeeId', uuid) committeeId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<CommitteeApplicationView[]> {
    return this.applications.listForCommittee(user, workspaceId, committeeId)
  }

  @Post()
  @HttpCode(200)
  @ApiOperation({
    summary: 'Rattacher une demande, accepter ou refuser une candidature, retirer',
    description:
      'Côté structure, sur une candidature envoyée au workspace (`candidatureId`) : `to` vaut ' +
      '`proposed` (rattacher la demande : le porteur confirme ou décline), `accepted` ou `refused` ' +
      '(répondre à sa candidature) ou `withdrawn` (retirer la proposition ou la demande retenue). ' +
      RULES +
      ' Renvoie les participations du comité.',
  })
  @ApiOkResponse({ description: 'Participation changée ; participations du comité.' })
  @ApiBadRequestResponse({ description: 'Corps invalide.' })
  @ApiConflictResponse({
    description:
      'Participation changée entre-temps, transition impossible, comité annulé ou tenu, statut de ' +
      'financement clos ou demande archivée.',
  })
  change(
    @Param('workspaceId', uuid) workspaceId: string,
    @Param('committeeId', uuid) committeeId: string,
    @Body() body: ChangeWorkspaceCommitteeApplicationDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<CommitteeApplicationView[]> {
    return this.applications.changeForWorkspace(user, workspaceId, committeeId, body)
  }
}
