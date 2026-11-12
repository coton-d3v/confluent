import { Controller, Get, Param, Req } from '@nestjs/common'
import {
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger'
import type { Request } from 'express'
import { AnalyticsService, type DossierAnalytics } from './analytics.service'
import { DossiersService } from '../dossiers/dossiers.service'
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy'
import { READING_SESSION_DOC } from '../reading-sessions/reading-session-doc'

function currentUser(req: Request): AuthenticatedUser {
  return (req as Request & { user: AuthenticatedUser }).user
}

@ApiTags('Analytics')
@ApiBearerAuth('jwt')
@ApiParam({ name: 'dossierId', description: 'UUID du dossier' })
@ApiUnauthorizedResponse({ description: 'JWT manquant.' })
@ApiNotFoundResponse({ description: 'Dossier inexistant ou possédé par un autre user.' })
@Controller('dossiers/:dossierId/analytics')
export class AnalyticsController {
  constructor(
    private readonly analytics: AnalyticsService,
    private readonly dossiers: DossiersService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Analytics d’un dossier',
    description:
      'Propriétaire seulement. Les consultations des **partages directs** de la demande ' +
      '(E07.08) ; les lectures par les seuls viviers n’y figurent pas, pas même en nombre (D05). ' +
      'Retourne :\n' +
      '- `activeRecipients` — nombre de partages au statut `active`\n' +
      '- `totalViews` — nombre de consultations (sessions) de tous les partages, révoqués compris\n' +
      '- `totalActiveSeconds`, `avgSessionDurationSeconds` — temps actif total et moyen par ' +
      'consultation, sur les seules consultations mesurées (`null` sans aucune)\n' +
      '- `perRecipient[]` — par partage : `shareLinkId, recipientEmail, status, viewCount, ' +
      'firstViewedAt, lastViewedAt` (dernière activité), `activeSeconds` et `measuredSessions`, ' +
      'et `sessions` : les dernières consultations (début, dernière activité, temps actif — `null` ' +
      'avant E07.08 —, page : `share` ou `opportunity`).\n\n' +
      'Les partages jamais consultés ont `viewCount: 0` et des dates `null`. Le temps actif mesure ' +
      'une page affichée au premier plan avec une activité récente du lecteur : une approximation ' +
      'de l’attention, pas de l’intérêt.\n\n' +
      READING_SESSION_DOC,
  })
  @ApiOkResponse({ description: 'Analytics agrégées du dossier.' })
  async forDossier(
    @Req() req: Request,
    @Param('dossierId') dossierId: string,
  ): Promise<DossierAnalytics> {
    await this.dossiers.getByIdForUser(dossierId, currentUser(req).id)
    return this.analytics.forDossier(dossierId)
  }
}
