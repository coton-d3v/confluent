import { Controller, Get, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common'
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy'
import { WorkspaceAccessGuard } from '../workspaces/workspace-access.guard'
import {
  CommitteeFollowUpService,
  type CommitteeParticipantView,
} from './committee-follow-up.service'
import type { CommitteeNoticeView } from './committee-notices.service'
import type { SharedCommitteeView } from './committee-views'

const uuid = new ParseUUIDPipe()

const NOT_FOUND =
  'Workspace inexistant ou dont le compte n’est pas membre actif (même réponse), ou comité ' +
  'inexistant dans ce workspace.'

// ROADMAP E08.06: the participants of a committee by name, and who was told of its changes — for the
// workspace's managers (`canManageWorkspace`), who decide the participation requests.
@ApiTags('Admin · Workspaces')
@ApiBearerAuth('jwt')
@ApiParam({ name: 'workspaceId', description: 'UUID du workspace' })
@ApiParam({ name: 'committeeId', description: 'UUID du comité' })
@ApiUnauthorizedResponse({ description: 'JWT manquant.' })
@ApiForbiddenResponse({ description: 'Membre du workspace sans le droit de le gérer.' })
@ApiNotFoundResponse({ description: NOT_FOUND })
@UseGuards(WorkspaceAccessGuard)
@Controller('admin/workspaces/:workspaceId/committees/:committeeId')
export class AdminCommitteeFollowUpController {
  constructor(private readonly followUp: CommitteeFollowUpService) {}

  @Get('participants')
  @ApiOperation({
    summary: 'Participants d’un comité',
    description:
      'Les demandes de participation acceptées pour ce comité, la plus ancienne décision ' +
      'd’abord : nom, organisation, adresse, date de la décision, et `access` — `active` si le ' +
      'compte admis est encore membre actif du workspace (il lit alors le comité et est prévenu ' +
      'de ses changements), `inactive` sinon.',
  })
  @ApiOkResponse({ description: 'Participants.' })
  participants(
    @Param('workspaceId', uuid) workspaceId: string,
    @Param('committeeId', uuid) committeeId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<CommitteeParticipantView[]> {
    return this.followUp.participants(user, workspaceId, committeeId)
  }

  @Get('notices')
  @ApiOperation({
    summary: 'Notifications des changements d’un comité',
    description:
      'Une ligne par personne prévenue d’un changement de date (`rescheduled`), d’une annulation ' +
      '(`cancelled`) ou d’un rétablissement (`restored`), le changement le plus récent d’abord ' +
      '(`committeeVersion` : la version du comité qu’il a produite) : porteur d’une demande ' +
      'inscrite (`entrepreneur`, libellé « entreprise — demande ») ou participant accepté ' +
      '(`participant`, nom et organisation), jamais d’adresse ; `state` : `to_send` ou `sending` ' +
      '(envoi non confirmé), `sent`, `failed`, ou `superseded` (un changement plus récent l’a ' +
      'prévenue avant le départ de celle-ci). Au plus 500 lignes.',
  })
  @ApiOkResponse({ description: 'Notifications.' })
  notices(
    @Param('workspaceId', uuid) workspaceId: string,
    @Param('committeeId', uuid) committeeId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<CommitteeNoticeView[]> {
    return this.followUp.noticesOf(user, workspaceId, committeeId)
  }
}

// ROADMAP E08.06: the sessions a member of the workspace was accepted for (E08.05), as their shared
// view — whatever the member's role; an empty list for anyone who is no participant.
@ApiTags('Comités')
@ApiBearerAuth('jwt')
@ApiParam({ name: 'workspaceId', description: 'UUID du workspace' })
@ApiUnauthorizedResponse({ description: 'JWT manquant.' })
@ApiNotFoundResponse({
  description: 'Workspace inexistant ou dont le compte n’est pas membre actif (même réponse).',
})
@UseGuards(WorkspaceAccessGuard)
@Controller('workspaces/:workspaceId/committee-sessions')
export class ParticipantCommitteesController {
  constructor(private readonly followUp: CommitteeFollowUpService) {}

  @Get()
  @ApiOperation({
    summary: 'Mes sessions de comité dans ce workspace',
    description:
      'Les comités pour lesquels une demande de participation du compte connecté a été acceptée, ' +
      'tant qu’il est membre actif du workspace, du plus proche au plus lointain, annulés et tenus ' +
      'compris : vue partagée seulement (nom, date, heure, fuseau, lieu, lien de visioconférence, ' +
      'statut, informations diffusées) — jamais les notes internes, ni les demandes inscrites, ni ' +
      'les autres participants. Liste vide pour tout autre membre.',
  })
  @ApiOkResponse({ description: 'Sessions.' })
  list(
    @Param('workspaceId', uuid) workspaceId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<SharedCommitteeView[]> {
    return this.followUp.sessions(user, workspaceId)
  }
}
