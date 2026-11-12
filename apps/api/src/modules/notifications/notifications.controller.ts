import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common'
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger'
import {
  NOTIFICATION_LIMITS,
  markAllNotificationsReadSchema,
  notificationListQuerySchema,
} from '@confluent/shared'
import { createZodDto } from 'nestjs-zod'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy'
import { NotificationsService, type NotificationView } from './notifications.service'

class NotificationListQueryDto extends createZodDto(notificationListQuerySchema) {}
class MarkAllNotificationsReadDto extends createZodDto(markAllNotificationsReadSchema) {}

const uuid = new ParseUUIDPipe()

// ROADMAP E10.03: the signed-in person's notifications — only their own, no account identifier taken
// from the client.
@ApiTags('Notifications')
@ApiBearerAuth('jwt')
@ApiUnauthorizedResponse({ description: 'JWT manquant.' })
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @ApiOperation({
    summary: 'Mes notifications',
    description:
      'Les notifications du compte connecté, la plus récente d’abord, par pages de ' +
      `${NOTIFICATION_LIMITS.pageSize} (\`limit\` jusqu’à ${NOTIFICATION_LIMITS.maxPageSize}, ` +
      '`cursor` = `nextCursor` de la page précédente), avec le nombre de non lues. Chacune : une ' +
      'phrase écrite par le serveur à partir de ce que le compte peut lire (`title`, `body`), la ' +
      'page du site qu’elle concerne (`href`, ou `null` quand l’objet n’est plus à sa portée) et ' +
      'sa lecture (`readAt`). Jamais le nom, l’organisation ni le montant d’un investisseur, ni ' +
      'une adresse, ni le lieu, le lien ou les notes d’un comité.',
  })
  @ApiOkResponse({ description: '`{ items, nextCursor, unreadCount }`.' })
  @ApiBadRequestResponse({ description: 'Curseur ou nombre invalide.' })
  list(@Query() query: NotificationListQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.notifications.list(user, query)
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Nombre de notifications non lues' })
  @ApiOkResponse({ description: '`{ unreadCount }`.' })
  async unread(@CurrentUser() user: AuthenticatedUser): Promise<{ unreadCount: number }> {
    return { unreadCount: await this.notifications.unreadCount(user) }
  }

  @Post('read-all')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Tout marquer comme lu',
    description:
      'Marque lues les notifications du compte connecté enregistrées jusqu’à `until` (le moment ' +
      'de la liste lue) : une notification arrivée depuis reste non lue.',
  })
  @ApiOkResponse({ description: '`{ updated, unreadCount }`.' })
  @ApiBadRequestResponse({ description: 'Date invalide.' })
  readAll(@Body() body: MarkAllNotificationsReadDto, @CurrentUser() user: AuthenticatedUser) {
    return this.notifications.markAllRead(user, new Date(body.until))
  }

  @Post(':id/read')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Marquer une notification comme lue',
    description: 'Marquer de nouveau ne change rien (sa première lecture reste).',
  })
  @ApiOkResponse({ description: 'La notification lue.' })
  @ApiNotFoundResponse({
    description: 'Notification inconnue ou d’un autre compte (même réponse).',
  })
  read(
    @Param('id', uuid) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<NotificationView> {
    return this.notifications.markRead(user, id)
  }
}
