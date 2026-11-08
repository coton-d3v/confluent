import { Module } from '@nestjs/common'
import { OAuthConsentController } from './oauth.controller'
import { OAuthClientsStore } from './oauth-clients.store'
import { ConfluentOAuthProvider } from './oauth.provider'

@Module({
  controllers: [OAuthConsentController],
  providers: [OAuthClientsStore, ConfluentOAuthProvider],
  exports: [ConfluentOAuthProvider],
})
export class OAuthModule {}
