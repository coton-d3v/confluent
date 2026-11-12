import { Module } from '@nestjs/common'
import { DossiersModule } from '../dossiers/dossiers.module'
import { ReadingSessionsModule } from '../reading-sessions/reading-sessions.module'
import { OwnerHistoryController } from './owner-history.controller'
import { OwnerHistoryService } from './owner-history.service'

// ROADMAP E07.09: the history of a request, its owner's to read.
@Module({
  imports: [DossiersModule, ReadingSessionsModule],
  controllers: [OwnerHistoryController],
  providers: [OwnerHistoryService],
})
export class OwnerHistoryModule {}
