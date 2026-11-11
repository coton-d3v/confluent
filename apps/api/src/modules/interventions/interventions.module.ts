import { Module } from '@nestjs/common'
import { CandidaturesModule } from '../candidatures/candidatures.module'
import { WorkspacesModule } from '../workspaces/workspaces.module'
import { CandidatureNotesService } from './candidature-notes.service'
import { InterventionJournalService } from './intervention-journal.service'
import { InterventionsController } from './interventions.controller'

// ROADMAP E06.08: a workspace's internal notes on the candidatures it receives, and the journal of
// its interventions on each of them — kept to the workspace.
@Module({
  imports: [CandidaturesModule, WorkspacesModule],
  controllers: [InterventionsController],
  providers: [InterventionJournalService, CandidatureNotesService],
  // E06.09: used by the MCP tools.
  exports: [InterventionJournalService, CandidatureNotesService],
})
export class InterventionsModule {}
