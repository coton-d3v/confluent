import { Controller, Get } from '@nestjs/common'
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy'
import { WorkspaceMembersService, type MyMembershipView } from './workspace-members.service'

// The signed-in person's own workspaces (ROADMAP E05.02); managing one is under admin/workspaces.
@ApiTags('Workspaces')
@ApiBearerAuth('jwt')
@ApiUnauthorizedResponse({ description: 'JWT manquant.' })
@Controller('workspaces')
export class WorkspacesController {
  constructor(private readonly members: WorkspaceMembersService) {}

  @Get('memberships')
  @ApiOperation({
    summary: 'Mes workspaces',
    description:
      'Les appartenances actives du compte connecté, triées par nom de workspace : rôle ' +
      '(`conseiller` ou `investisseur`), organisation, type d’investisseur, droit de gérer le ' +
      'workspace. Une appartenance désactivée n’y figure pas.',
  })
  @ApiOkResponse({ description: 'Appartenances actives.' })
  memberships(@CurrentUser() user: AuthenticatedUser): Promise<MyMembershipView[]> {
    return this.members.listMine(user)
  }
}
