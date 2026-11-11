import { Module } from '@nestjs/common'
import { AnswersModule } from '../answers/answers.module'
import { DocumentsModule } from '../documents/documents.module'
import { DossiersModule } from '../dossiers/dossiers.module'
import { OAuthModule } from '../oauth/oauth.module'
import { QuestionnairesModule } from '../questionnaires/questionnaires.module'
import { FormDesignTools } from './form-design.tools'
import { McpToolsFactory } from './mcp.tools'

@Module({
  imports: [OAuthModule, DossiersModule, AnswersModule, QuestionnairesModule, DocumentsModule],
  providers: [McpToolsFactory, FormDesignTools],
  exports: [McpToolsFactory],
})
export class McpModule {}
