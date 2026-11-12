import { Body, Controller, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger'
import {
  READING_HEARTBEAT_INTERVAL_SECONDS,
  READING_HEARTBEAT_MAX_MS,
  READING_IDLE_AFTER_SECONDS,
  READING_SESSION_GAP_MINUTES,
  READING_SESSION_MAX_ACTIVE_SECONDS,
  readingHeartbeatSchema,
  type ReadingHeartbeatResult,
} from '@confluent/shared'
import { createZodDto } from 'nestjs-zod'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy'
import { READING_SESSION_DOC } from './reading-session-doc'
import { ReadingSessionsService } from './reading-sessions.service'

class ReadingHeartbeatDto extends createZodDto(readingHeartbeatSchema) {}

const uuid = new ParseUUIDPipe()

@ApiTags('Consultations')
@ApiBearerAuth('jwt')
@ApiUnauthorizedResponse({ description: 'JWT manquant.' })
@Controller('reading-sessions')
export class ReadingSessionsController {
  constructor(private readonly sessions: ReadingSessionsService) {}

  @Post(':id/heartbeat')
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  @ApiOperation({
    summary: 'Signaler le temps actif d’une consultation',
    description:
      READING_SESSION_DOC +
      '\n\n' +
      `La page envoie toutes les ${READING_HEARTBEAT_INTERVAL_SECONDS} s (et en se fermant) ` +
      '`activeMs`, le temps passé au premier plan avec une activité du lecteur depuis moins de ' +
      `${READING_IDLE_AFTER_SECONDS} s depuis l’envoi précédent — jamais un total. Le serveur ` +
      'crédite au plus le temps écoulé depuis la dernière activité de la session (deux onglets, ' +
      `une répétition ou un envoi forgé n’ajoutent rien de plus) et au plus ${READING_HEARTBEAT_MAX_MS} ms ` +
      `par envoi, dans la limite de ${READING_SESSION_MAX_ACTIVE_SECONDS / 3600} h par session. ` +
      'Réponse `{ open: false }` (rien n’est crédité) quand la session est close : dernière activité ' +
      `il y a plus de ${READING_SESSION_GAP_MINUTES} minutes, partage révoqué ou adressé à un autre ` +
      'compte, lecture non mesurée. Seul le lecteur de la session l’alimente : `404` identique pour ' +
      'tout autre compte et pour une session inconnue. Rate-limit 60 req/min/IP.',
  })
  @ApiParam({ name: 'id', description: 'Identifiant de la consultation (`reading.id`)' })
  @ApiOkResponse({ description: '`{ open }` : la session reste-t-elle mesurée ?' })
  @ApiBadRequestResponse({
    description: 'Identifiant ou `activeMs` invalide (entier, 0 à 30 000).',
  })
  @ApiNotFoundResponse({ description: 'Session inconnue ou d’un autre lecteur.' })
  @ApiTooManyRequestsResponse({ description: 'Rate limit atteint (60/min).' })
  heartbeat(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuid) id: string,
    @Body() body: ReadingHeartbeatDto,
  ): Promise<ReadingHeartbeatResult> {
    return this.sessions.heartbeat(user, id, body.activeMs)
  }
}
