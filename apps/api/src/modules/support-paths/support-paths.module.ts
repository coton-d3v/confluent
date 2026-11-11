import { Module } from '@nestjs/common'
import { CandidaturesModule } from '../candidatures/candidatures.module'
import { WorkspacesModule } from '../workspaces/workspaces.module'
import { PortfolioController } from './portfolio.controller'
import { PortfolioService } from './portfolio.service'
import { ReceivedSupportPathController, SupportPathController } from './support-paths.controller'
import { SupportPathsService } from './support-paths.service'
import { AdminSupportStepsController, SupportStepsController } from './support-steps.controller'
import { SupportStepsService } from './support-steps.service'

// ROADMAP E06.06: each workspace's support path and the steps validated for its candidatures; E06.07:
// the phase they compute and the workspace's portfolio by phase.
@Module({
  imports: [CandidaturesModule, WorkspacesModule],
  controllers: [
    SupportStepsController,
    AdminSupportStepsController,
    SupportPathController,
    ReceivedSupportPathController,
    PortfolioController,
  ],
  providers: [SupportStepsService, SupportPathsService, PortfolioService],
  // E06.09: used by the MCP tools.
  exports: [SupportPathsService, PortfolioService],
})
export class SupportPathsModule {}
