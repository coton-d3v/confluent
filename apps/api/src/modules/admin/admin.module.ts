import { Module } from '@nestjs/common'
import { QuestionnairesModule } from '../questionnaires/questionnaires.module'
import { AdminDossiersController } from './admin-dossiers.controller'
import { AdminDossiersService } from './admin-dossiers.service'
import { AdminFormsController, WorkspaceFormsController } from './admin-forms.controller'
import { AdminClassificationController } from './admin-classification.controller'
import { ClassificationModule } from '../classification/classification.module'
import { OAuthModule } from '../oauth/oauth.module'
import { AdminUsersController } from './admin-users.controller'
import { AdminUsersService } from './admin-users.service'
import { AdminAnalyticsController } from './admin-analytics.controller'
import { AdminAnalyticsService } from './admin-analytics.service'
import { AdminSharesController } from './admin-shares.controller'
import { AnswersModule } from '../answers/answers.module'
import { DossiersModule } from '../dossiers/dossiers.module'
import { AuthModule } from '../auth/auth.module'
import { WorkspacesModule } from '../workspaces/workspaces.module'
import { ShareLinksModule } from '../share-links/share-links.module'
import { ReadingSessionsModule } from '../reading-sessions/reading-sessions.module'
import { DocumentsModule } from '../documents/documents.module'
import { AdminWorkspacesController } from './admin-workspaces.controller'
import { AdminWorkspaceMembersController } from './admin-workspace-members.controller'

@Module({
  imports: [
    AnswersModule,
    DossiersModule,
    AuthModule,
    QuestionnairesModule,
    ClassificationModule,
    OAuthModule,
    WorkspacesModule,
    ShareLinksModule,
    ReadingSessionsModule,
    DocumentsModule,
  ],
  controllers: [
    AdminDossiersController,
    AdminFormsController,
    WorkspaceFormsController,
    AdminClassificationController,
    AdminUsersController,
    AdminAnalyticsController,
    AdminSharesController,
    AdminWorkspacesController,
    AdminWorkspaceMembersController,
  ],
  providers: [AdminDossiersService, AdminUsersService, AdminAnalyticsService],
  exports: [AdminDossiersService, AdminUsersService, AdminAnalyticsService],
})
export class AdminModule {}
