import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { DocumentsModule } from '../documents/documents.module'
import { WorkspaceAccessService } from './workspace-access'
import { WorkspaceMembersService } from './workspace-members.service'
import { WorkspacesController } from './workspaces.controller'
import { WorkspacesService } from './workspaces.service'

@Module({
  imports: [DocumentsModule, AuthModule],
  controllers: [WorkspacesController],
  providers: [WorkspacesService, WorkspaceAccessService, WorkspaceMembersService],
  exports: [WorkspacesService, WorkspaceAccessService, WorkspaceMembersService],
})
export class WorkspacesModule {}
