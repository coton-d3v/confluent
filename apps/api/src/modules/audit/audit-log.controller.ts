import { Controller, Get, Param, Req, UseGuards } from '@nestjs/common'
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
import type { Request } from 'express'
import type { AuditLog } from '@prisma/client'
import { AuditLogService } from './audit-log.service'
import { DossiersService } from '../dossiers/dossiers.service'
import { AdminGuard } from '../auth/guards/admin.guard'
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy'

function currentUser(req: Request): AuthenticatedUser {
  return (req as Request & { user: AuthenticatedUser }).user
}

@ApiTags('Audit')
@ApiBearerAuth('jwt')
@ApiUnauthorizedResponse({ description: 'JWT manquant.' })
@Controller()
export class AuditLogController {
  constructor(
    private readonly service: AuditLogService,
    private readonly dossiers: DossiersService,
  ) {}

  @Get('dossiers/:id/audit-log')
  @ApiOperation({
    summary: '[Entrepreneur] Journal d’audit d’un dossier',
    description:
      'Trace append-only des événements métier du dossier (création/modification, partages, consultations). ' +
      'Les entrées **ops-only** (`rate_limit_exceeded`, `share_link_access_denied`) sont **filtrées** ' +
      'de cette vue — réservées aux admins (`GET /v1/admin/dossiers/:id/audit-log`), comme les ' +
      'entrées des notes internes des structures (`candidature_note_updated`). Tri par `createdAt` desc.',
  })
  @ApiParam({ name: 'id', description: 'UUID du dossier' })
  @ApiOkResponse({ description: 'Journal filtré pour l’entrepreneur propriétaire.' })
  @ApiNotFoundResponse({ description: 'Dossier inexistant ou possédé par un autre user.' })
  async forEntrepreneur(@Req() req: Request, @Param('id') id: string): Promise<AuditLog[]> {
    await this.dossiers.getByIdForUser(id, currentUser(req).id)
    return this.service.listForEntrepreneur(id)
  }

  @UseGuards(AdminGuard)
  @Get('admin/dossiers/:id/audit-log')
  @ApiOperation({
    summary: '[Admin] Journal d’audit complet d’un dossier',
    description:
      'Vue admin : inclut TOUS les événements dont les `rate_limit_exceeded` et `share_link_access_denied` ' +
      '(traces sécurité/ops). Aucun filtre — exige `role: admin` dans le JWT.',
  })
  @ApiParam({ name: 'id', description: 'UUID du dossier' })
  @ApiOkResponse({ description: 'Journal complet (ops + métier).' })
  @ApiForbiddenResponse({ description: 'JWT non-admin.' })
  forAdmin(@Param('id') id: string): Promise<AuditLog[]> {
    return this.service.listForAdmin(id)
  }
}
