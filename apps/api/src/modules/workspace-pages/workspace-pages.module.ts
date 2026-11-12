import { Module } from '@nestjs/common'
import { DocumentsModule } from '../documents/documents.module'
import { ShowcaseCardsModule } from '../showcase-cards/showcase-cards.module'
import { WorkspacesModule } from '../workspaces/workspaces.module'
import {
  PublicWorkspacePagesController,
  WorkspacePageController,
} from './workspace-pages.controller'
import { WorkspacePagesService } from './workspace-pages.service'

// ROADMAP E09.01: each workspace's public page and its managers' settings; E09.02: with its cards.
@Module({
  imports: [WorkspacesModule, DocumentsModule, ShowcaseCardsModule],
  controllers: [PublicWorkspacePagesController, WorkspacePageController],
  providers: [WorkspacePagesService],
  // E09.07: the MCP tools of the page's managers.
  exports: [WorkspacePagesService],
})
export class WorkspacePagesModule {}
