import { Module } from '@nestjs/common'
import { WorkspacesModule } from '../workspaces/workspaces.module'
import { ParticipationFormTokens } from './participation-form-token'
import {
  ParticipationRequestsController,
  PublicParticipationController,
} from './participation-requests.controller'
import { ParticipationRequestsService } from './participation-requests.service'

// ROADMAP E08.04: the public participation form of each workspace and the queue it feeds.
@Module({
  imports: [WorkspacesModule],
  controllers: [PublicParticipationController, ParticipationRequestsController],
  providers: [ParticipationRequestsService, ParticipationFormTokens],
  exports: [ParticipationRequestsService],
})
export class ParticipationRequestsModule {}
