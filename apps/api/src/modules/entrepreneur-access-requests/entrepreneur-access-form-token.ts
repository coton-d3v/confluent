import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { AppConfig } from '../../config/config.schema'
import { SignedFormTokens } from '../participation-requests/participation-form-token'

// The access request form's tokens (ROADMAP E09.05): the participation form's rules, under a key of
// their own — a token of one form is refused by the other.
@Injectable()
export class EntrepreneurAccessFormTokens extends SignedFormTokens {
  constructor(config: ConfigService<AppConfig, true>) {
    super(config, 'confluent/entrepreneur-access-form/v1')
  }
}
