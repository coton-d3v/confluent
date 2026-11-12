import { createHmac, timingSafeEqual } from 'node:crypto'
import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PARTICIPATION_FORM_TIMING } from '@confluent/shared'
import type { AppConfig } from '../../config/config.schema'

export type FormTokenCheck = 'valid' | 'invalid' | 'too_fast' | 'expired'

// The token a workspace's public form hands out with its page (ROADMAP E08.04, and E09.05 for the
// entrepreneurs' access requests): when it was issued and for which workspace, signed by the API. A
// submission must bring one, at least `minFillMs` after it was issued (a robot posting straight away
// is refused) and at most `maxAgeMs` after (a token is not collected once and replayed for days).
// Nothing is stored: the signature is the proof. Its key is derived from the API's JWT secret for one
// form only (`purpose`), so it signs nothing else — a participation form's token is no access
// request's; changing that secret invalidates the forms open at that moment (their page is reloaded).
export class SignedFormTokens {
  private readonly key: Buffer

  constructor(config: ConfigService<AppConfig, true>, purpose: string) {
    this.key = createHmac('sha256', config.get('JWT_SECRET', { infer: true }))
      .update(purpose)
      .digest()
  }

  issue(workspaceId: string, now: number): string {
    return `${now}.${this.mac(workspaceId, now)}`
  }

  check(token: string, workspaceId: string, now: number): FormTokenCheck {
    const match = /^(\d{13})\.([A-Za-z0-9_-]{43})$/.exec(token)
    if (!match) return 'invalid'
    const issuedAt = Number(match[1])
    const expected = Buffer.from(this.mac(workspaceId, issuedAt))
    const given = Buffer.from(match[2])
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return 'invalid'
    const age = now - issuedAt
    if (age < PARTICIPATION_FORM_TIMING.minFillMs) return 'too_fast'
    if (age > PARTICIPATION_FORM_TIMING.maxAgeMs) return 'expired'
    return 'valid'
  }

  private mac(workspaceId: string, issuedAt: number): string {
    return createHmac('sha256', this.key).update(`${workspaceId}.${issuedAt}`).digest('base64url')
  }
}

// The participation form's (E08.04).
@Injectable()
export class ParticipationFormTokens extends SignedFormTokens {
  constructor(config: ConfigService<AppConfig, true>) {
    super(config, 'confluent/participation-form/v1')
  }
}
