import { Module } from '@nestjs/common'
import { CandidaturesModule } from '../candidatures/candidatures.module'
import { OpportunitiesModule } from '../opportunities/opportunities.module'
import { WorkspacesModule } from '../workspaces/workspaces.module'
import { FundingPlanController, ReceivedFundingPlanController } from './funding-plans.controller'
import { FundingPlansService } from './funding-plans.service'

// ROADMAP E06.03: the financing plan of a request in each workspace it is presented to; E06.04: the
// pledges each side reads (OpportunitiesModule's `PositionsService`), apart, and their confirmation.
@Module({
  imports: [CandidaturesModule, WorkspacesModule, OpportunitiesModule],
  controllers: [FundingPlanController, ReceivedFundingPlanController],
  providers: [FundingPlansService],
  exports: [FundingPlansService],
})
export class FundingPlansModule {}
