import { Global, Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { NotificationsController } from './notifications.controller'
import { NotificationsService } from './notifications.service'

// ROADMAP E10.03: notifications, recorded by every module's events like the journal — hence global.
@Global()
@Module({
  imports: [AuthModule],
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
