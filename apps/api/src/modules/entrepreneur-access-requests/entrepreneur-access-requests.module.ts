import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { WorkspacesModule } from '../workspaces/workspaces.module'
import { EntrepreneurAccessDecisionsService } from './entrepreneur-access-decisions.service'
import { EntrepreneurAccessFormTokens } from './entrepreneur-access-form-token'
import {
  EntrepreneurAccessRequestsController,
  PublicEntrepreneurAccessController,
} from './entrepreneur-access-requests.controller'
import { EntrepreneurAccessRequestsService } from './entrepreneur-access-requests.service'

// ROADMAP E09.05: the public access request form of each workspace's page, the queue it feeds and
// its managers' decisions.
@Module({
  imports: [WorkspacesModule, AuthModule],
  controllers: [PublicEntrepreneurAccessController, EntrepreneurAccessRequestsController],
  providers: [
    EntrepreneurAccessRequestsService,
    EntrepreneurAccessDecisionsService,
    EntrepreneurAccessFormTokens,
  ],
})
export class EntrepreneurAccessRequestsModule {}
