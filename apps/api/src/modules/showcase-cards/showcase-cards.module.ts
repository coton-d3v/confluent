import { Module } from '@nestjs/common'
import { CandidaturesModule } from '../candidatures/candidatures.module'
import { DossiersModule } from '../dossiers/dossiers.module'
import { WorkspacesModule } from '../workspaces/workspaces.module'
import {
  ReceivedShowcaseCardController,
  ShowcaseCardsController,
} from './showcase-cards.controller'
import { ShowcaseCardsService } from './showcase-cards.service'

// ROADMAP E09.02: the anonymous cards of financing requests on a workspace's public page, with their
// owner's explicit consent.
@Module({
  imports: [CandidaturesModule, DossiersModule, WorkspacesModule],
  controllers: [ShowcaseCardsController, ReceivedShowcaseCardController],
  providers: [ShowcaseCardsService],
  // E09.01: the public page lists the cards.
  exports: [ShowcaseCardsService],
})
export class ShowcaseCardsModule {}
