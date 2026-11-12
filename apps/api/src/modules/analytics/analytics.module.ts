import { Module } from '@nestjs/common'
import { AnalyticsController } from './analytics.controller'
import { AnalyticsService } from './analytics.service'
import { DossiersModule } from '../dossiers/dossiers.module'
import { ReadingSessionsModule } from '../reading-sessions/reading-sessions.module'

@Module({
  imports: [DossiersModule, ReadingSessionsModule],
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
