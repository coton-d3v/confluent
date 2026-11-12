import { Module } from '@nestjs/common'
import { CandidaturesModule } from '../candidatures/candidatures.module'
import { DossiersModule } from '../dossiers/dossiers.module'
import { ReadingSessionsModule } from '../reading-sessions/reading-sessions.module'
import { ShareLinksModule } from '../share-links/share-links.module'
import { WorkspacesModule } from '../workspaces/workspaces.module'
import { DossierInterestsController } from './dossier-interests.controller'
import { DossierPledgesController } from './dossier-pledges.controller'
import { InterestsService } from './interests.service'
import { OpportunitiesController } from './opportunities.controller'
import { OpportunitiesService } from './opportunities.service'
import { PledgesService } from './pledges.service'
import {
  DossierPositionsController,
  PositionsController,
  WorkspacePositionsController,
} from './positions.controller'
import { PositionsService } from './positions.service'

// ROADMAP E07.03: an investor's opportunities — direct shares and listed pool publications —, and
// E07.05: their marks of interest, and E07.06: their pledges, as their owners read them; E07.07: the
// positions as the investor, the owner and the structures they consented to read them.
@Module({
  imports: [
    DossiersModule,
    ShareLinksModule,
    CandidaturesModule,
    WorkspacesModule,
    ReadingSessionsModule,
  ],
  controllers: [
    OpportunitiesController,
    DossierInterestsController,
    DossierPledgesController,
    PositionsController,
    DossierPositionsController,
    WorkspacePositionsController,
  ],
  providers: [OpportunitiesService, InterestsService, PledgesService, PositionsService],
  // E07.10: the same services behind the MCP tools.
  exports: [OpportunitiesService, InterestsService, PledgesService, PositionsService],
})
export class OpportunitiesModule {}
