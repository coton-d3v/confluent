import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { DossiersModule } from '../dossiers/dossiers.module'
import { WorkspacesModule } from '../workspaces/workspaces.module'
import {
  CompanyTransfersController,
  PreparedCompaniesController,
} from './company-transfers.controller'
import { CompanyTransfersService } from './company-transfers.service'

// ROADMAP E05.08: companies prepared by conseillers for entrepreneurs, and their transfer.
@Module({
  imports: [AuthModule, DossiersModule, WorkspacesModule],
  controllers: [PreparedCompaniesController, CompanyTransfersController],
  providers: [CompanyTransfersService],
})
export class CompanyTransfersModule {}
