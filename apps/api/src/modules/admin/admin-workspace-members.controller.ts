import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common'
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger'
import { inviteWorkspaceMemberSchema, updateWorkspaceMemberSchema } from '@confluent/shared'
import { createZodDto } from 'nestjs-zod'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy'
import { WorkspaceAccessGuard } from '../workspaces/workspace-access.guard'
import {
  WorkspaceMembersService,
  type WorkspaceMemberView,
} from '../workspaces/workspace-members.service'

class InviteWorkspaceMemberDto extends createZodDto(inviteWorkspaceMemberSchema) {}
class UpdateWorkspaceMemberDto extends createZodDto(updateWorkspaceMemberSchema) {}

const uuid = new ParseUUIDPipe()

// Members of a workspace (ROADMAP E05.02). Who may manage them is decided by the service with the
// single workspace management rule: Confluent administrators and the workspace's own managers.
@ApiTags('Admin · Workspaces')
@ApiBearerAuth('jwt')
@ApiUnauthorizedResponse({ description: 'JWT manquant.' })
@ApiForbiddenResponse({
  description: 'Membre du workspace sans le droit de le gérer.',
})
@ApiNotFoundResponse({
  description:
    'Workspace inexistant ou dont le compte n’est pas membre actif (même réponse), ou membre inexistant.',
})
@UseGuards(WorkspaceAccessGuard)
@Controller('admin/workspaces/:workspaceId/members')
export class AdminWorkspaceMembersController {
  constructor(private readonly members: WorkspaceMembersService) {}

  @Get()
  @ApiOperation({
    summary: 'Lister les membres d’un workspace',
    description:
      'Membres actifs puis désactivés, par adresse. `awaitingFirstSignIn` : le compte invité ne s’est ' +
      'encore jamais connecté. `invitedBy` : qui a invité (null si son compte a été supprimé).',
  })
  @ApiOkResponse({ description: 'Membres.' })
  list(
    @Param('workspaceId', uuid) workspaceId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<WorkspaceMemberView[]> {
    return this.members.list(user, workspaceId)
  }

  @Post()
  @ApiOperation({
    summary: 'Inviter un conseiller ou un investisseur',
    description:
      'Ajoute la personne au workspace — son compte est créé si l’adresse est inconnue, sans changer le ' +
      'rôle global d’un compte existant — puis lui envoie un email d’invitation qui mène à la connexion ' +
      'par lien magique. `investorType` : investisseurs seulement ; `canManageWorkspace` : conseillers ' +
      'seulement. Si le workspace a un domaine email, un **conseiller** doit avoir une adresse de ce ' +
      'domaine (`400`). `invitationEmailSent: false` : l’appartenance est créée mais l’email n’est pas ' +
      'parti.',
  })
  @ApiCreatedResponse({ description: '{ member, invitationEmailSent }.' })
  @ApiBadRequestResponse({
    description: 'Champ invalide, ou adresse hors du domaine du workspace.',
  })
  @ApiConflictResponse({ description: 'Déjà membre (active ou désactivée).' })
  invite(
    @Param('workspaceId', uuid) workspaceId: string,
    @Body() body: InviteWorkspaceMemberDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.members.invite(user, workspaceId, body)
  }

  @Patch(':membershipId')
  @ApiOperation({
    summary: 'Modifier un membre',
    description:
      'Seuls les champs présents changent (`role`, `organization`, `investorType`, ' +
      '`canManageWorkspace`). Un nouveau rôle efface ce qu’il ne peut pas porter. Un gestionnaire ne ' +
      'peut pas retirer le dernier droit de gestion actif du workspace (`409`).',
  })
  @ApiOkResponse({ description: 'Membre modifié.' })
  @ApiBadRequestResponse({ description: 'Champ invalide ou incompatible avec le rôle.' })
  @ApiConflictResponse({ description: 'Dernier gestionnaire du workspace.' })
  update(
    @Param('workspaceId', uuid) workspaceId: string,
    @Param('membershipId', uuid) membershipId: string,
    @Body() body: UpdateWorkspaceMemberDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<WorkspaceMemberView> {
    return this.members.update(user, workspaceId, membershipId, body)
  }

  @Post(':membershipId/deactivate')
  @ApiOperation({
    summary: 'Désactiver un membre',
    description:
      'L’appartenance et son historique sont conservés ; ce qu’elle accorde cesse dès la requête ' +
      'suivante. Le compte n’est pas désactivé. Sans effet si elle l’est déjà.',
  })
  @ApiOkResponse({ description: 'Membre désactivé.' })
  @ApiConflictResponse({ description: 'Dernier gestionnaire du workspace.' })
  deactivate(
    @Param('workspaceId', uuid) workspaceId: string,
    @Param('membershipId', uuid) membershipId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<WorkspaceMemberView> {
    return this.members.deactivate(user, workspaceId, membershipId)
  }

  @Post(':membershipId/reactivate')
  @ApiOperation({
    summary: 'Réactiver un membre',
    description:
      'Rend ce que l’appartenance portait. Un conseiller doit toujours respecter le domaine email du ' +
      'workspace (`400`). Sans effet si elle est déjà active.',
  })
  @ApiOkResponse({ description: 'Membre réactivé.' })
  @ApiBadRequestResponse({ description: 'Adresse hors du domaine du workspace.' })
  reactivate(
    @Param('workspaceId', uuid) workspaceId: string,
    @Param('membershipId', uuid) membershipId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<WorkspaceMemberView> {
    return this.members.reactivate(user, workspaceId, membershipId)
  }
}
