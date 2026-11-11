import { Module } from '@nestjs/common'
import { DossiersModule } from '../dossiers/dossiers.module'
import { ShareLinksModule } from '../share-links/share-links.module'
import { OpportunitiesController } from './opportunities.controller'
import { OpportunitiesService } from './opportunities.service'

// ROADMAP E07.03: an investor's opportunities — direct shares and listed pool publications.
@Module({
  imports: [DossiersModule, ShareLinksModule],
  controllers: [OpportunitiesController],
  providers: [OpportunitiesService],
})
export class OpportunitiesModule {}
