import { createHmac, timingSafeEqual } from 'node:crypto'
import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PARTICIPATION_FORM_TIMING } from '@confluent/shared'
import type { AppConfig } from '../../config/config.schema'

export type FormTokenCheck = 'valid' | 'invalid' | 'too_fast' | 'expired'

// The token a workspace's public participation page hands out with its form (ROADMAP E08.04): when
// it was issued and for which workspace, signed by the API. A submission must bring one, at least
// `minFillMs` after it was issued (a robot posting straight away is refused) and at most `maxAgeMs`
// after (a token is not collected once and replayed for days). Nothing is stored: the signature is
// the proof. Its key is derived from the API's JWT secret for this use only, so it signs nothing
// else; changing that secret invalidates the forms open at that moment (their page is reloaded).
@Injectable()
export class ParticipationFormTokens {
  private readonly key: Buffer

  constructor(config: ConfigService<AppConfig, true>) {
    this.key = createHmac('sha256', config.get('JWT_SECRET', { infer: true }))
      .update('confluent/participation-form/v1')
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
