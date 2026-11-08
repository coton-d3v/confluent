import { Module } from '@nestjs/common'
import { AnswersModule } from '../answers/answers.module'
import { DossiersModule } from '../dossiers/dossiers.module'
import { OAuthModule } from '../oauth/oauth.module'
import { QuestionnairesModule } from '../questionnaires/questionnaires.module'
import { McpToolsFactory } from './mcp.tools'

@Module({
  imports: [OAuthModule, DossiersModule, AnswersModule, QuestionnairesModule],
  providers: [McpToolsFactory],
  exports: [McpToolsFactory],
})
export class McpModule {}
