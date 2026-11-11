import { Module } from '@nestjs/common'
import { DocumentsModule } from '../documents/documents.module'
import { WorkspacesService } from './workspaces.service'

@Module({
  imports: [DocumentsModule],
  providers: [WorkspacesService],
  exports: [WorkspacesService],
})
export class WorkspacesModule {}
