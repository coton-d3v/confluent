import { Module } from '@nestjs/common'
import { OAuthConsentController } from './oauth.controller'
import { OAuthGrantsController } from './oauth-grants.controller'
import { OAuthClientsStore } from './oauth-clients.store'
import { ConfluentOAuthProvider } from './oauth.provider'

@Module({
  controllers: [OAuthConsentController, OAuthGrantsController],
  providers: [OAuthClientsStore, ConfluentOAuthProvider],
  exports: [ConfluentOAuthProvider],
})
export class OAuthModule {}
