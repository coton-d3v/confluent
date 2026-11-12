import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { CandidaturesModule } from '../candidatures/candidatures.module'
import { WorkspacesModule } from '../workspaces/workspaces.module'
import {
  CandidateCommitteesController,
  CommitteeApplicationsController,
} from './committee-applications.controller'
import { CommitteeApplicationsService } from './committee-applications.service'
import {
  AdminCommitteeFollowUpController,
  ParticipantCommitteesController,
} from './committee-follow-up.controller'
import { CommitteeFollowUpService } from './committee-follow-up.service'
import { CommitteeNoticesService } from './committee-notices.service'
import { AdminCommitteesController, CommitteesController } from './committees.controller'
import { CommitteesService } from './committees.service'

// ROADMAP E08.01: the committees each workspace organises; E08.03: the requests presented at them;
// E08.06: their lists, progress and notices.
@Module({
  imports: [WorkspacesModule, CandidaturesModule, AuthModule],
  controllers: [
    CommitteesController,
    AdminCommitteesController,
    CommitteeApplicationsController,
    CandidateCommitteesController,
    AdminCommitteeFollowUpController,
    ParticipantCommitteesController,
  ],
  providers: [
    CommitteesService,
    CommitteeApplicationsService,
    CommitteeNoticesService,
    CommitteeFollowUpService,
  ],
  exports: [CommitteesService, CommitteeApplicationsService],
})
export class CommitteesModule {}
