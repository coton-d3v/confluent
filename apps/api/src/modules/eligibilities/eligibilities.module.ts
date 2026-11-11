import { Module } from '@nestjs/common'
import { CandidaturesModule } from '../candidatures/candidatures.module'
import { WorkspacesModule } from '../workspaces/workspaces.module'
import {
  EligibilitiesController,
  ReceivedEligibilitiesController,
} from './eligibilities.controller'
import { EligibilitiesService } from './eligibilities.service'
import {
  AdminEligibilitySchemesController,
  EligibilitySchemesController,
} from './eligibility-schemes.controller'
import { EligibilitySchemesService } from './eligibility-schemes.service'

// ROADMAP E06.05: each workspace's schemes (JEIR, JEI, CIR…) and its candidatures' eligibilities to
// them — information and filters, never a tax simulation.
@Module({
  imports: [CandidaturesModule, WorkspacesModule],
  controllers: [
    EligibilitySchemesController,
    AdminEligibilitySchemesController,
    EligibilitiesController,
    ReceivedEligibilitiesController,
  ],
  providers: [EligibilitySchemesService, EligibilitiesService],
  // E06.09: used by the MCP tools.
  exports: [EligibilitiesService],
})
export class EligibilitiesModule {}
