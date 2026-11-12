import { Controller, Get, UseGuards } from '@nestjs/common'
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger'
import { AdminGuard } from '../auth/guards/admin.guard'
import { AdminAnalyticsService, type PlatformAnalytics } from './admin-analytics.service'

@ApiTags('Admin · Analytics')
@ApiBearerAuth('jwt')
@ApiUnauthorizedResponse({ description: 'JWT manquant.' })
@ApiForbiddenResponse({ description: 'JWT sans rôle `admin`.' })
@UseGuards(AdminGuard)
@Controller('admin/analytics')
export class AdminAnalyticsController {
  constructor(private readonly service: AdminAnalyticsService) {}

  @Get()
  @ApiOperation({
    summary: 'Statistiques plateforme (FR25, FR34)',
    description:
      'Agrégation globale pour le dashboard admin :\n' +
      '- `totalDossiers` — nombre total de dossiers\n' +
      '- `activeThisMonth` — dossiers créés ou modifiés ce mois (UTC)\n' +
      '- `bySector[]` / `byMaturityStage[]` — groupBy tri par count desc\n' +
      '- `totalShareLinks` — partages au statut `active`\n' +
      '- `totalViewsThisMonth` — consultations (sessions de lecture, E07.08) par un partage direct ' +
      'commencées ce mois\n\n' +
      'Empty-db safe : zéro counts / empty arrays, jamais de 500.',
  })
  @ApiOkResponse({ description: 'Statistiques plateforme agrégées.' })
  platform(): Promise<PlatformAnalytics> {
    return this.service.platform()
  }
}
