import { Module } from '@nestjs/common'
import { WorkspacesModule } from '../workspaces/workspaces.module'
import { AdminCommitteesController, CommitteesController } from './committees.controller'
import { CommitteesService } from './committees.service'

// ROADMAP E08.01: the committees each workspace organises.
@Module({
  imports: [WorkspacesModule],
  controllers: [CommitteesController, AdminCommitteesController],
  providers: [CommitteesService],
  exports: [CommitteesService],
})
export class CommitteesModule {}
