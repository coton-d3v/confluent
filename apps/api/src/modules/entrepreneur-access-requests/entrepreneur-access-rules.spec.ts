import { HttpException } from '@nestjs/common'
import type { ConfigService } from '@nestjs/config'
import { ThrottlerStorageService } from '@nestjs/throttler'
import { entrepreneurAccessDecisionNotice } from '@confluent/shared'
import type { AppConfig } from '../../config/config.schema'
import { ParticipationFormTokens } from '../participation-requests/participation-form-token'
import { EntrepreneurAccessFormTokens } from './entrepreneur-access-form-token'
import {
  ENTREPRENEUR_ACCESS_RATE_LIMITS,
  EntrepreneurAccessRequestsService,
  offersEntrepreneurAccess,
} from './entrepreneur-access-requests.service'
import { quietNotifications } from '../../testing/notifications'

// ROADMAP E09.05: when the access request form is offered, what its token proves, and what a manager
// is told after a decision.
describe('entrepreneur access rules', () => {
  const published = { id: 'w1', publicPagePublished: true, publicPageBlocks: ['apply'] }
  const db = (form: boolean) => ({
    questionnaire: { findFirst: jest.fn().mockResolvedValue(form ? { id: 'q1' } : null) },
    questionnaireVersion: { findFirst: jest.fn().mockResolvedValue(form ? { id: 'v1' } : null) },
  })

  it('offers the form only while the page shows how to apply: published, « apply » shown, a candidature form published', async () => {
    const offers = (workspace: typeof published, form = true) =>
      offersEntrepreneurAccess(db(form) as never, workspace)
    await expect(offers(published)).resolves.toBe(true)
    await expect(offers({ ...published, publicPagePublished: false })).resolves.toBe(false)
    await expect(offers({ ...published, publicPageBlocks: ['participate'] })).resolves.toBe(false)
    await expect(offers({ ...published, publicPageBlocks: [] })).resolves.toBe(false)
    await expect(offers(published, false)).resolves.toBe(false)
    // Read closed: a value no longer known does not stand for the block.
    await expect(offers({ ...published, publicPageBlocks: ['Apply'] })).resolves.toBe(false)
  })

  it('signs its tokens for this form only: a participation form’s token is refused, and the other way round', () => {
    const config = { get: () => 's'.repeat(32) } as unknown as ConfigService<AppConfig, true>
    const access = new EntrepreneurAccessFormTokens(config)
    const participation = new ParticipationFormTokens(config)
    const now = Date.now()
    const issued = now - 5000
    expect(access.check(access.issue('w1', issued), 'w1', now)).toBe('valid')
    expect(access.check(participation.issue('w1', issued), 'w1', now)).toBe('invalid')
    expect(participation.check(access.issue('w1', issued), 'w1', now)).toBe('invalid')
    expect(access.check(access.issue('w2', issued), 'w1', now)).toBe('invalid')
    expect(access.check(access.issue('w1', now - 1000), 'w1', now)).toBe('too_fast')
    expect(access.check(access.issue('w1', now - 13 * 3600_000), 'w1', now)).toBe('expired')
  })

  it('never announces an email that did not leave (R68)', () => {
    const answer = (sent: boolean | null, email: 'to_send' | 'sent' | 'failed' | null) => ({
      invitationEmailSent: sent,
      request: { invitationEmail: email },
    })
    expect(entrepreneurAccessDecisionNotice('Léa', 'accepted', answer(true, 'sent'))).toEqual({
      tone: 'success',
      text: 'Demande de Léa acceptée : la personne est invitée par email à présenter sa demande.',
    })
    expect(entrepreneurAccessDecisionNotice('Léa', 'accepted', answer(false, 'failed')).tone).toBe(
      'warning',
    )
    for (const email of ['failed', 'to_send', null] as const) {
      const notice = entrepreneurAccessDecisionNotice('Léa', 'accepted', answer(null, email))
      expect([email, notice.text]).toEqual([
        email,
        expect.not.stringMatching(/a été invitée|est invitée/),
      ])
      expect(notice.text).toContain('était déjà acceptée')
    }
    expect(
      entrepreneurAccessDecisionNotice('Léa', 'accepted', answer(null, 'sent')).text,
    ).toContain('a été invitée par email')
    expect(entrepreneurAccessDecisionNotice('Léa', 'refused', answer(null, null))).toEqual({
      tone: 'success',
      text: 'Demande de Léa refusée.',
    })
  })

  // Spread over minutes in reality (the route's per-minute limit is not what refuses here): counted
  // before the workspace is even looked up, whatever the slug.
  it('refuses a network address beyond its hourly quota, and only that one', async () => {
    const limits = new ThrottlerStorageService()
    const prisma = { workspace: { findUnique: jest.fn().mockResolvedValue(null) } }
    const service = new EntrepreneurAccessRequestsService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      limits,
      quietNotifications(prisma as never),
    )
    const send = (ip: string) =>
      service
        .submit('inconnu', {} as never, { ip })
        .then(() => 'sent')
        .catch((err: HttpException) => err.getStatus())
    for (let i = 0; i < ENTREPRENEUR_ACCESS_RATE_LIMITS.perHourPerNetwork; i++) {
      expect(await send('192.0.2.1')).toBe(404)
    }
    expect(await send('192.0.2.1')).toBe(429)
    expect(await send('192.0.2.2')).toBe(404)
    limits.onApplicationShutdown()
  })
})
