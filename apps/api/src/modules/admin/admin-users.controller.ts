import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common'
import {
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
import type { Request } from 'express'
import { createZodDto } from 'nestjs-zod'
import { z } from 'zod'
import { AdminGuard } from '../auth/guards/admin.guard'
import { AdminUsersService } from './admin-users.service'
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy'

const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  role: z.enum(['entrepreneur', 'financeur', 'admin']),
})
class InviteDto extends createZodDto(inviteSchema) {}

function currentUser(req: Request): AuthenticatedUser {
  return (req as Request & { user: AuthenticatedUser }).user
}

@ApiTags('Admin · Utilisateurs')
@ApiBearerAuth('jwt')
@ApiUnauthorizedResponse({ description: 'JWT manquant.' })
@ApiForbiddenResponse({ description: 'JWT sans rôle `admin`.' })
@UseGuards(AdminGuard)
@Controller('admin/users')
export class AdminUsersController {
  constructor(private readonly service: AdminUsersService) {}

  @Get()
  @ApiOperation({
    summary: 'Lister tous les utilisateurs',
    description:
      'Retourne tous les users (entrepreneur, financeur, admin), tri par `createdAt` desc.',
  })
  @ApiOkResponse({ description: 'Liste complète des users.' })
  list() {
    return this.service.listUsers()
  }

  @Post('invite')
  @ApiOperation({
    summary: 'Inviter un nouvel utilisateur (FR32)',
    description:
      'Crée un user `isActive: false` ou réactive une invitation pour un user existant inactif. ' +
      'Envoie un magic-link par mail qui activera le compte au premier login. Audit trace l’invitation.',
  })
  @ApiCreatedResponse({ description: 'User créé ou mis à jour, mail dispatché.' })
  @ApiConflictResponse({
    description:
      'User déjà actif — l’invitation est refusée pour éviter les re-invites accidentels.',
  })
  invite(@Req() req: Request, @Body() body: InviteDto) {
    return this.service.invite({ email: body.email, role: body.role }, currentUser(req).id)
  }

  @Patch(':id/deactivate')
  @ApiOperation({
    summary: 'Désactiver un utilisateur (FR33)',
    description:
      '`isActive: false`. **Effet sur les JWT existants** : le `JwtStrategy.validate` vérifie `isActive` en DB ' +
      'à chaque requête, donc les tokens existants sont immédiatement rejetés (401) — pas besoin de blacklist. ' +
      'Audit : `user_deactivated`.',
  })
  @ApiParam({ name: 'id', description: 'UUID de l’utilisateur' })
  @ApiOkResponse({ description: 'User désactivé.' })
  @ApiNotFoundResponse({ description: 'User inexistant.' })
  @ApiConflictResponse({ description: 'Son propre compte : jamais désactivé (E10.05).' })
  deactivate(@Req() req: Request, @Param('id') id: string) {
    return this.service.deactivate(id, currentUser(req).id)
  }

  @Patch(':id/reactivate')
  @ApiOperation({
    summary: 'Réactiver un utilisateur',
    description: '`isActive: true`. Audit : `user_reactivated`.',
  })
  @ApiParam({ name: 'id', description: 'UUID de l’utilisateur' })
  @ApiOkResponse({ description: 'User réactivé.' })
  @ApiNotFoundResponse({ description: 'User inexistant.' })
  reactivate(@Req() req: Request, @Param('id') id: string) {
    return this.service.reactivate(id, currentUser(req).id)
  }
}
