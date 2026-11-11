import { Controller, Get, Param, UseGuards } from '@nestjs/common'
import {
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy'
import { WorkspaceAccessGuard } from './workspace-access.guard'
import { WorkspaceMembersService, type MyMembershipView } from './workspace-members.service'
import { WorkspacesService, type CurrentWorkspaceView } from './workspaces.service'

// The signed-in person's own workspaces and the one they enter (ROADMAP E05.02, E05.03); managing
// one is under admin/workspaces.
@ApiTags('Workspaces')
@ApiBearerAuth('jwt')
@ApiUnauthorizedResponse({ description: 'JWT manquant.' })
@UseGuards(WorkspaceAccessGuard)
@Controller('workspaces')
export class WorkspacesController {
  constructor(
    private readonly members: WorkspaceMembersService,
    private readonly workspaces: WorkspacesService,
  ) {}

  @Get('memberships')
  @ApiOperation({
    summary: 'Mes workspaces',
    description:
      'Les appartenances actives du compte connecté, triées par nom de workspace : rôle ' +
      '(`conseiller` ou `investisseur`), organisation, type d’investisseur, droit de gérer le ' +
      'workspace. Une appartenance désactivée n’y figure pas. Ce sont les workspaces entre lesquels ' +
      'le compte peut changer d’espace.',
  })
  @ApiOkResponse({ description: 'Appartenances actives.' })
  memberships(@CurrentUser() user: AuthenticatedUser): Promise<MyMembershipView[]> {
    return this.members.listMine(user)
  }

  @Get(':workspaceId')
  @ApiOperation({
    summary: 'Entrer dans un workspace',
    description:
      'Le workspace tel que le voit un membre actif (conseiller ou investisseur) ou un administrateur ' +
      'de Confluent : nom, programme, couleur, présentation, contact, logo (URL signée 15 min) ; ' +
      '`membership` : l’appartenance du compte (`null` pour un administrateur non membre) ; ' +
      '`canManageWorkspace` : droit de gérer réglages et membres. L’accès est vérifié à chaque ' +
      'requête : une appartenance désactivée cesse aussitôt de l’ouvrir. Choisir un workspace dans ' +
      'le site ne vaut pas autorisation.',
  })
  @ApiOkResponse({ description: 'Workspace courant.' })
  @ApiNotFoundResponse({
    description:
      'Workspace inexistant, ou dont le compte n’est pas membre actif : même réponse, pour ne pas ' +
      'révéler son existence.',
  })
  enter(
    @Param('workspaceId') workspaceId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<CurrentWorkspaceView> {
    return this.workspaces.enter(user, workspaceId)
  }
}
