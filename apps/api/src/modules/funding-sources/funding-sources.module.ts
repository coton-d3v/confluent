import { Module } from '@nestjs/common'
import { WorkspacesModule } from '../workspaces/workspaces.module'
import {
  AdminFundingSourceCategoriesController,
  FundingSourceCategoriesController,
} from './funding-source-categories.controller'
import { FundingSourceCategoriesService } from './funding-source-categories.service'

// ROADMAP E06.02: the categories of sources each workspace splits financing plans into.
@Module({
  imports: [WorkspacesModule],
  controllers: [FundingSourceCategoriesController, AdminFundingSourceCategoriesController],
  providers: [FundingSourceCategoriesService],
  exports: [FundingSourceCategoriesService],
})
export class FundingSourcesModule {}
