import { Module } from '@nestjs/common'
import { CandidaturesModule } from '../candidatures/candidatures.module'
import { WorkspacesModule } from '../workspaces/workspaces.module'
import { ReceivedSupportPathController, SupportPathController } from './support-paths.controller'
import { SupportPathsService } from './support-paths.service'
import { AdminSupportStepsController, SupportStepsController } from './support-steps.controller'
import { SupportStepsService } from './support-steps.service'

// ROADMAP E06.06: each workspace's support path and the steps validated for its candidatures.
@Module({
  imports: [CandidaturesModule, WorkspacesModule],
  controllers: [
    SupportStepsController,
    AdminSupportStepsController,
    SupportPathController,
    ReceivedSupportPathController,
  ],
  providers: [SupportStepsService, SupportPathsService],
})
export class SupportPathsModule {}
