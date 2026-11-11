import { Module } from '@nestjs/common'
import { WorkspacesModule } from '../workspaces/workspaces.module'
import { OAuthConsentController } from './oauth.controller'
import { OAuthGrantsController } from './oauth-grants.controller'
import { CIMD_FETCH, OAuthClientsStore, defaultCimdFetch } from './oauth-clients.store'
import { OAuthGrantsService } from './oauth-grants.service'
import { ConfluentOAuthProvider } from './oauth.provider'

@Module({
  // E05.10: the consent screen offers the account's active memberships.
  imports: [WorkspacesModule],
  controllers: [OAuthConsentController, OAuthGrantsController],
  providers: [
    OAuthClientsStore,
    ConfluentOAuthProvider,
    OAuthGrantsService,
    { provide: CIMD_FETCH, useValue: defaultCimdFetch },
  ],
  exports: [ConfluentOAuthProvider],
})
export class OAuthModule {}
