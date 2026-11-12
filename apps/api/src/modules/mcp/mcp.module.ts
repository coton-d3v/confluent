import { Module } from '@nestjs/common'
import { AnswersModule } from '../answers/answers.module'
import { CandidaturesModule } from '../candidatures/candidatures.module'
import { CommitteesModule } from '../committees/committees.module'
import { CompaniesModule } from '../companies/companies.module'
import { CompanyTransfersModule } from '../company-transfers/company-transfers.module'
import { DocumentsModule } from '../documents/documents.module'
import { DossiersModule } from '../dossiers/dossiers.module'
import { EntrepreneurAccessRequestsModule } from '../entrepreneur-access-requests/entrepreneur-access-requests.module'
import { EligibilitiesModule } from '../eligibilities/eligibilities.module'
import { FundingPlansModule } from '../funding-plans/funding-plans.module'
import { InterventionsModule } from '../interventions/interventions.module'
import { OAuthModule } from '../oauth/oauth.module'
import { OpportunitiesModule } from '../opportunities/opportunities.module'
import { OwnerHistoryModule } from '../owner-history/owner-history.module'
import { ParticipationRequestsModule } from '../participation-requests/participation-requests.module'
import { QuestionnairesModule } from '../questionnaires/questionnaires.module'
import { ShareLinksModule } from '../share-links/share-links.module'
import { ShowcaseCardsModule } from '../showcase-cards/showcase-cards.module'
import { SupportPathsModule } from '../support-paths/support-paths.module'
import { WorkspacePagesModule } from '../workspace-pages/workspace-pages.module'
import { WorkspacesModule } from '../workspaces/workspaces.module'
import { CandidatureTools } from './candidature.tools'
import { CommitteeTools } from './committee.tools'
import { ConversationGuidesController } from './conversation-guides.controller'
import { FinancingTools } from './financing.tools'
import { FollowUpTools } from './follow-up.tools'
import { FormDesignTools } from './form-design.tools'
import { McpAccess } from './mcp-access'
import { McpToolsFactory } from './mcp.tools'
import { OpportunityTools } from './opportunity.tools'
import { PublicPageTools } from './public-page.tools'
import { SharingTools } from './sharing.tools'
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
    // E07.10: opportunities, positions and the diffusion of a request.
    OpportunitiesModule,
    ShareLinksModule,
    OwnerHistoryModule,
    // E08.07: committees, the requests presented at them and the participation requests.
    CommitteesModule,
    ParticipationRequestsModule,
    // E09.07: a workspace's public page, its cards and its access requests.
    WorkspacePagesModule,
    ShowcaseCardsModule,
    EntrepreneurAccessRequestsModule,
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
    OpportunityTools,
    SharingTools,
    CommitteeTools,
    PublicPageTools,
  ],
  exports: [McpToolsFactory],
})
export class McpModule {}
