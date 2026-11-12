import { Module } from '@nestjs/common'
import { DossiersModule } from '../dossiers/dossiers.module'
import { ShareLinksModule } from '../share-links/share-links.module'
import { DossierInterestsController } from './dossier-interests.controller'
import { DossierPledgesController } from './dossier-pledges.controller'
import { InterestsService } from './interests.service'
import { OpportunitiesController } from './opportunities.controller'
import { OpportunitiesService } from './opportunities.service'
import { PledgesService } from './pledges.service'

// ROADMAP E07.03: an investor's opportunities — direct shares and listed pool publications —, and
// E07.05: their marks of interest, and E07.06: their pledges, as their owners read them.
@Module({
  imports: [DossiersModule, ShareLinksModule],
  controllers: [OpportunitiesController, DossierInterestsController, DossierPledgesController],
  providers: [OpportunitiesService, InterestsService, PledgesService],
})
export class OpportunitiesModule {}
