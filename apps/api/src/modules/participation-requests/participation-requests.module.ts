import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { WorkspacesModule } from '../workspaces/workspaces.module'
import { ParticipationDecisionsService } from './participation-decisions.service'
import { ParticipationFormTokens } from './participation-form-token'
import {
  ParticipationRequestsController,
  PublicParticipationController,
} from './participation-requests.controller'
import { ParticipationRequestsService } from './participation-requests.service'

// ROADMAP E08.04: the public participation form of each workspace and the queue it feeds; E08.05: the
// managers' decisions.
@Module({
  imports: [WorkspacesModule, AuthModule],
  controllers: [PublicParticipationController, ParticipationRequestsController],
  providers: [ParticipationRequestsService, ParticipationDecisionsService, ParticipationFormTokens],
  exports: [ParticipationRequestsService],
})
export class ParticipationRequestsModule {}
