import { Module } from '@nestjs/common'
import { ReadingSessionsController } from './reading-sessions.controller'
import { ReadingSessionsService } from './reading-sessions.service'

// ROADMAP E07.08: reading sessions — opened by the pages that deliver a request to its readers (share
// links, opportunities), timed by their heartbeats, read by the request's owner (analytics).
@Module({
  controllers: [ReadingSessionsController],
  providers: [ReadingSessionsService],
  exports: [ReadingSessionsService],
})
export class ReadingSessionsModule {}
