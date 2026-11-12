import { Module } from '@nestjs/common'
import { CandidaturesModule } from '../candidatures/candidatures.module'
import { WorkspacesModule } from '../workspaces/workspaces.module'
import {
  CandidateCommitteesController,
  CommitteeApplicationsController,
} from './committee-applications.controller'
import { CommitteeApplicationsService } from './committee-applications.service'
import { AdminCommitteesController, CommitteesController } from './committees.controller'
import { CommitteesService } from './committees.service'

// ROADMAP E08.01: the committees each workspace organises; E08.03: the requests presented at them.
@Module({
  imports: [WorkspacesModule, CandidaturesModule],
  controllers: [
    CommitteesController,
    AdminCommitteesController,
    CommitteeApplicationsController,
    CandidateCommitteesController,
  ],
  providers: [CommitteesService, CommitteeApplicationsService],
  exports: [CommitteesService, CommitteeApplicationsService],
})
export class CommitteesModule {}
