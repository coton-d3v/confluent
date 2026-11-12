import { Controller, Get, Param, UseGuards } from '@nestjs/common'
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger'
import type { AuditLog } from '@prisma/client'
import { AuditLogService } from './audit-log.service'
import { AdminGuard } from '../auth/guards/admin.guard'

@ApiTags('Audit')
@ApiBearerAuth('jwt')
@ApiUnauthorizedResponse({ description: 'JWT manquant.' })
@Controller()
export class AuditLogController {
  constructor(private readonly service: AuditLogService) {}

  @UseGuards(AdminGuard)
  @Get('admin/dossiers/:id/audit-log')
  @ApiOperation({
    summary: '[Admin] Journal d’audit complet d’un dossier',
    description:
      'Vue admin : inclut TOUS les événements dont les `rate_limit_exceeded` et `share_link_access_denied` ' +
      '(traces sécurité/ops). Aucun filtre — exige `role: admin` dans le JWT. Le porteur lit ' +
      'l’historique de sa demande (`GET /v1/dossiers/:id/history`, E07.09), jamais ce journal brut.',
  })
  @ApiParam({ name: 'id', description: 'UUID du dossier' })
  @ApiOkResponse({ description: 'Journal complet (ops + métier).' })
  @ApiForbiddenResponse({ description: 'JWT non-admin.' })
  forAdmin(@Param('id') id: string): Promise<AuditLog[]> {
    return this.service.listForAdmin(id)
  }
}
