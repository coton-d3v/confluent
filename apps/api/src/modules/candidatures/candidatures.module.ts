import { Module } from '@nestjs/common'
import { AnswersModule } from '../answers/answers.module'
import { DossiersModule } from '../dossiers/dossiers.module'
import { WorkspacesModule } from '../workspaces/workspaces.module'
import { CandidaturesController, ReceivedCandidaturesController } from './candidatures.controller'
import { CandidaturesService } from './candidatures.service'

// ROADMAP E05.09: financing requests presented to workspaces, with each workspace's complementary
// form answered by the candidature alone.
@Module({
  imports: [AnswersModule, DossiersModule, WorkspacesModule],
  controllers: [CandidaturesController, ReceivedCandidaturesController],
  providers: [CandidaturesService],
  // E05.10: used by the MCP tools.
  exports: [CandidaturesService],
})
export class CandidaturesModule {}
