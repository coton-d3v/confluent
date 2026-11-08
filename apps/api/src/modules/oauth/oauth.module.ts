import { Module } from '@nestjs/common'
import { OAuthConsentController } from './oauth.controller'
import { OAuthGrantsController } from './oauth-grants.controller'
import { OAuthClientsStore } from './oauth-clients.store'
import { OAuthGrantsService } from './oauth-grants.service'
import { ConfluentOAuthProvider } from './oauth.provider'

@Module({
  controllers: [OAuthConsentController, OAuthGrantsController],
  providers: [OAuthClientsStore, ConfluentOAuthProvider, OAuthGrantsService],
  exports: [ConfluentOAuthProvider],
})
export class OAuthModule {}
