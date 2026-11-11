import { Module } from '@nestjs/common'
import { AnswersModule } from '../answers/answers.module'
import { CandidaturesModule } from '../candidatures/candidatures.module'
import { CompaniesModule } from '../companies/companies.module'
import { CompanyTransfersModule } from '../company-transfers/company-transfers.module'
import { DocumentsModule } from '../documents/documents.module'
import { DossiersModule } from '../dossiers/dossiers.module'
import { EligibilitiesModule } from '../eligibilities/eligibilities.module'
import { FundingPlansModule } from '../funding-plans/funding-plans.module'
import { InterventionsModule } from '../interventions/interventions.module'
import { OAuthModule } from '../oauth/oauth.module'
import { QuestionnairesModule } from '../questionnaires/questionnaires.module'
import { SupportPathsModule } from '../support-paths/support-paths.module'
import { WorkspacesModule } from '../workspaces/workspaces.module'
import { CandidatureTools } from './candidature.tools'
import { ConversationGuidesController } from './conversation-guides.controller'
import { FinancingTools } from './financing.tools'
import { FollowUpTools } from './follow-up.tools'
import { FormDesignTools } from './form-design.tools'
import { McpAccess } from './mcp-access'
import { McpToolsFactory } from './mcp.tools'
import { StructureTools } from './structure.tools'
import { WorkspaceTools } from './workspace.tools'

@Module({
  imports: [
    OAuthModule,
    DossiersModule,
    AnswersModule,
    QuestionnairesModule,
    DocumentsModule,
    // E05.10: workspaces, companies, transfers and candidatures through MCP.
    WorkspacesModule,
    CompaniesModule,
    CompanyTransfersModule,
    CandidaturesModule,
    // E06.09: the financing and support follow-up of candidatures.
    FundingPlansModule,
    EligibilitiesModule,
    SupportPathsModule,
    InterventionsModule,
  ],
  controllers: [ConversationGuidesController],
  providers: [
    McpToolsFactory,
    McpAccess,
    FormDesignTools,
    WorkspaceTools,
    FinancingTools,
    CandidatureTools,
    FollowUpTools,
    StructureTools,
  ],
  exports: [McpToolsFactory],
})
export class McpModule {}
