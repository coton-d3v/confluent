import { Module } from '@nestjs/common'
import { DocumentsModule } from '../documents/documents.module'
import { WorkspacesModule } from '../workspaces/workspaces.module'
import {
  PublicWorkspacePagesController,
  WorkspacePageController,
} from './workspace-pages.controller'
import { WorkspacePagesService } from './workspace-pages.service'

// ROADMAP E09.01: each workspace's public page and its managers' settings.
@Module({
  imports: [WorkspacesModule, DocumentsModule],
  controllers: [PublicWorkspacePagesController, WorkspacePageController],
  providers: [WorkspacePagesService],
})
export class WorkspacePagesModule {}
