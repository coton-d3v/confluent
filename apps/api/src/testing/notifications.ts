import type { ConfigService } from '@nestjs/config'
import type { AppConfig } from '../config/config.schema'
import type { EmailTransport } from '../modules/auth/email/email-transport'
import { NotificationsService } from '../modules/notifications/notifications.service'
import type { PrismaService } from '../prisma/prisma.service'

// E10.03: the notifications of a service under test, recorded in its database (fake or real) and
// their emails going nowhere — for the tests of other rules (the notifications' own tests read what
// they send).
export function quietNotifications(prisma: unknown): NotificationsService {
  const quiet = () => Promise.resolve()
  return new NotificationsService(
    prisma as PrismaService,
    { get: () => 'https://confluent.example' } as unknown as ConfigService<AppConfig, true>,
    { sendCommitteeChanged: quiet, sendNotification: quiet } as unknown as EmailTransport,
  )
}
