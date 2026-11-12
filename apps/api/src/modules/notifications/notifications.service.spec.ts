import type { ConfigService } from '@nestjs/config'
import type { Prisma } from '@prisma/client'
import { NOTIFICATION_EMAILED, NOTIFICATION_KINDS, type NotificationKind } from '@confluent/shared'
import type { AppConfig } from '../../config/config.schema'
import type { PrismaService } from '../../prisma/prisma.service'
import { createFakePrisma } from '../../testing/fake-prisma'
import type {
  EmailTransport,
  SendCommitteeChangedInput,
  SendNotificationInput,
} from '../auth/email/email-transport'
import { NOTIFICATION_PAYLOADS, notificationText } from './notification-payloads'
import { NotificationsService, type NotificationDraft } from './notifications.service'

const config = {
  get: (key: string) => (key === 'FRONTEND_URL' ? 'https://confluent.example' : undefined),
} as unknown as ConfigService<AppConfig, true>

const D = '7d3c1b0e-0000-4000-8000-000000010301'
const W = '7d3c1b0e-0000-4000-8000-000000010302'
const C = '7d3c1b0e-0000-4000-8000-000000010303'
const moment = { date: '2099-06-11', time: '09:30', timeZone: 'Europe/Paris' }
const committee = {
  workspaceId: W,
  workspaceName: 'CCI Touraine',
  committeeName: 'Comité de juin',
  ...moment,
  previous: { date: '2099-06-10', time: '14:00', timeZone: 'Europe/Paris' },
  audience: 'entrepreneur' as const,
  candidatureId: C,
}

// A payload of each kind, as its event writes it.
const SAMPLES: Record<NotificationKind, Record<string, unknown>> = {
  share_invited: { dossierId: D, dossierName: 'Biosensio' },
  share_level_changed: { dossierId: D, dossierName: 'Biosensio', level: 'partiel' },
  share_revoked: { dossierName: 'Biosensio' },
  workspace_invited: { workspaceId: W, workspaceName: 'CCI Touraine', role: 'investisseur' },
  company_transfer_proposed: { companyName: 'Biosensio', workspaceName: 'CCI Touraine' },
  company_transfer_answered: { workspaceId: W, companyName: 'Biosensio', decision: 'accepted' },
  interest_received: { dossierId: D, dossierName: 'Biosensio', dossierSlug: 'biosensio' },
  pledge_received: {
    dossierId: D,
    dossierName: 'Biosensio',
    dossierSlug: 'biosensio',
    change: 'new',
  },
  candidature_status_changed: {
    candidatureId: C,
    dossierName: 'Biosensio',
    workspaceName: 'CCI Touraine',
    to: 'funded',
  },
  committee_application_changed: {
    candidatureId: C,
    dossierName: 'Biosensio',
    workspaceName: 'CCI Touraine',
    committeeName: 'Comité de juin',
    to: 'proposed',
  },
  showcase_card_hidden: { candidatureId: C, dossierName: 'Biosensio', workspaceName: 'CCI' },
  participation_accepted: { workspaceId: W, workspaceName: 'CCI Touraine' },
  entrepreneur_access_accepted: { workspaceName: 'CCI Touraine' },
  participation_request_received: { workspaceId: W, workspaceName: 'CCI Touraine' },
  entrepreneur_access_request_received: { workspaceId: W, workspaceName: 'CCI Touraine' },
  committee_rescheduled: committee,
  committee_cancelled: { ...committee, previous: null },
  committee_restored: {
    ...committee,
    previous: null,
    audience: 'participant',
    candidatureId: null,
  },
}

// What an event's code could wrongly hand over: never recorded, never written.
const INTRUDERS = {
  investorName: 'Claire QX4242',
  investorEmail: 'claire@angels.fr',
  amountEur: 42_424,
  location: 'LIEU-PRIVE',
  message: 'MESSAGE-PRIVE',
}

// ROADMAP E10.03: the notifications' own rules on the stateful fake Prisma — once per event and
// person, nobody deactivated, the kind's fields only, an email claimed once and superseded by a later
// one about the same object, a failure recorded.
describe('NotificationsService', () => {
  let fake: ReturnType<typeof createFakePrisma>
  let service: NotificationsService
  let mailed: Array<SendNotificationInput | SendCommitteeChangedInput>
  let failFor: Set<string>
  const tx = () => fake.prisma as unknown as Prisma.TransactionClient
  const rows = () => [...fake.table('notification').values()]

  beforeEach(async () => {
    fake = createFakePrisma()
    mailed = []
    failFor = new Set()
    const send = (input: SendNotificationInput | SendCommitteeChangedInput) => {
      if (failFor.has(input.to)) return Promise.reject(new Error('SMTP down'))
      mailed.push(input)
      return Promise.resolve()
    }
    const transport = {
      sendNotification: jest.fn(send),
      sendCommitteeChanged: jest.fn(send),
    } as unknown as EmailTransport
    service = new NotificationsService(fake.prisma as unknown as PrismaService, config, transport)
    for (const [id, email, isActive] of [
      ['sophie', 'sophie@biosensio.fr', true],
      ['marc', 'marc@agrotech.fr', true],
      ['zoe', 'zoe@angels.fr', false],
    ] as const) {
      await fake.prisma.user.create({ data: { id, email, role: 'entrepreneur', isActive } })
    }
  })

  const draft = (over: Record<string, unknown> = {}): NotificationDraft =>
    ({
      recipientId: 'sophie',
      kind: 'pledge_received',
      key: 'pledge_received:p1:1',
      subject: 'pledge:p1',
      dossierId: D,
      payload: SAMPLES.pledge_received,
      ...over,
    }) as unknown as NotificationDraft

  it('records an event once per person: the same key again records and sends nothing', async () => {
    const first = await service.recordIn(tx(), [draft(), draft({ recipientId: 'marc' })])
    expect(first).toHaveLength(2)
    expect(await service.recordIn(tx(), [draft()])).toEqual([])
    // Twice in the same batch: once.
    expect(await service.recordIn(tx(), [draft({ key: 'k2' }), draft({ key: 'k2' })])).toHaveLength(
      1,
    )
    expect(
      rows()
        .map((r) => [r.recipientId, r.dedupKey])
        .sort(),
    ).toEqual([
      ['marc', 'pledge_received:p1:1'],
      ['sophie', 'k2'],
      ['sophie', 'pledge_received:p1:1'],
    ])
  })

  it('leaves the email of an event recorded again (a retry) to leave, never superseded by itself', async () => {
    const first = await service.recordIn(tx(), [draft()])
    expect(await service.recordIn(tx(), [draft()])).toEqual([])
    await service.deliver(first)
    expect(rows().map((r) => r.emailState)).toEqual(['sent'])
    expect(mailed).toHaveLength(1)
  })

  it('tells a deactivated account nothing', async () => {
    expect(await service.recordIn(tx(), [draft({ recipientId: 'zoe' })])).toEqual([])
    expect(rows()).toEqual([])
  })

  it('records in-app-only kinds without any email', async () => {
    const ids = await service.recordIn(tx(), [
      draft({ kind: 'interest_received', key: 'i1', payload: SAMPLES.interest_received }),
    ])
    expect(ids).toEqual([])
    expect(rows().map((r) => r.emailState)).toEqual(['none'])
    for (const kind of NOTIFICATION_KINDS) {
      expect([kind, NOTIFICATION_EMAILED[kind]]).toEqual([
        kind,
        !/^(share_invited|workspace_invited|company_transfer_proposed|interest_received|participation_accepted|entrepreneur_access_accepted|participation_request_received|entrepreneur_access_request_received)$/.test(
          kind,
        ),
      ])
    }
  })

  it('keeps only the kind’s fields of each payload, and writes nothing else', async () => {
    for (const kind of NOTIFICATION_KINDS) {
      await service.recordIn(tx(), [
        {
          recipientId: 'sophie',
          kind,
          key: `k-${kind}`,
          subject: `s-${kind}`,
          workspaceId: W,
          ...(kind.startsWith('committee_r') || kind === 'committee_cancelled'
            ? {
                committee: {
                  id: 'june',
                  version: 2,
                  applicationId: 'a1',
                  participationRequestId: null,
                },
              }
            : {}),
          payload: { ...SAMPLES[kind], ...INTRUDERS },
        } as unknown as NotificationDraft,
      ])
    }
    expect(rows()).toHaveLength(NOTIFICATION_KINDS.length)
    for (const row of rows()) {
      const kind = row.kind as NotificationKind
      expect([kind, Object.keys(row.payload as object).sort()]).toEqual([
        kind,
        Object.keys(NOTIFICATION_PAYLOADS[kind].shape).sort(),
      ])
    }
    const page = await service.list({ id: 'sophie' }, { limit: 50 })
    expect(page.items).toHaveLength(NOTIFICATION_KINDS.length)
    const raw = JSON.stringify(page)
    for (const trace of ['QX4242', 'claire@', '42424', '42 424', 'PRIVE']) {
      expect([trace, raw.includes(trace)]).toEqual([trace, false])
    }
    // A payload missing a field undoes the event rather than recording what cannot be read.
    await expect(
      service.recordIn(tx(), [draft({ key: 'broken', payload: { dossierName: 'x' } as never })]),
    ).rejects.toThrow()
  })

  it('writes each kind’s sentence and page from its payload, and a general sentence without link from one it cannot read', () => {
    for (const kind of NOTIFICATION_KINDS) {
      const text = notificationText(kind, SAMPLES[kind])
      expect(text.title.length).toBeGreaterThan(10)
      expect(text.href === null || /^\/[a-z]/.test(text.href)).toBe(true)
      const fallback = notificationText(kind, { nothing: true })
      expect(fallback).toEqual({ title: expect.any(String), body: null, href: null })
    }
    expect(notificationText('share_level_changed', SAMPLES.share_level_changed)).toEqual({
      title: 'Votre accès à « Biosensio » a changé',
      body: 'Niveau d’accès : Partiel.',
      href: `/opportunites/${D}`,
    })
    expect(notificationText('committee_rescheduled', committee)).toEqual({
      title: 'Le comité « Comité de juin » change de date',
      body: 'CCI Touraine — nouvelle date : jeudi 11 juin 2099 à 09:30 (Europe/Paris). Date précédente : mercredi 10 juin 2099 à 14:00 (Europe/Paris).',
      href: `/dashboard/candidatures/${C}`,
    })
    expect(notificationText('committee_restored', SAMPLES.committee_restored).href).toBe(
      `/workspaces/${W}`,
    )
  })

  it('sends each email once — even delivered again by two senders —, superseded by a later one about the same object, a failure recorded', async () => {
    const first = await service.recordIn(tx(), [draft()])
    const second = await service.recordIn(tx(), [
      draft({
        key: 'pledge_received:p1:2',
        payload: { ...SAMPLES.pledge_received, change: 'changed' },
      } as never),
    ])
    // Another object: untouched.
    const other = await service.recordIn(tx(), [draft({ key: 'p2', subject: 'pledge:p2' })])
    await Promise.all([service.deliver([...first, ...second]), service.deliver(second)])
    expect(mailed.map((m) => (m as SendNotificationInput).title)).toEqual([
      'Promesse modifiée pour « Biosensio »',
    ])
    expect(rows().map((r) => [r.dedupKey, r.emailState])).toEqual([
      ['pledge_received:p1:1', 'superseded'],
      ['pledge_received:p1:2', 'sent'],
      ['p2', 'to_send'],
    ])
    expect((mailed[0] as SendNotificationInput).actionUrl).toBe(
      'https://confluent.example/dashboard/dossiers/view/biosensio',
    )
    failFor.add('sophie@biosensio.fr')
    await service.deliver(other)
    expect(rows()[2].emailState).toBe('failed')
  })

  it('sends a committee’s change as E08.06’s own email', async () => {
    const ids = await service.recordIn(tx(), [
      {
        recipientId: 'sophie',
        kind: 'committee_rescheduled',
        key: 'committee_changed:june:2',
        subject: 'committee:june',
        workspaceId: W,
        committee: { id: 'june', version: 2, applicationId: 'a1', participationRequestId: null },
        payload: committee,
      },
    ])
    await service.deliver(ids)
    expect(mailed).toEqual([
      {
        to: 'sophie@biosensio.fr',
        kind: 'rescheduled',
        audience: 'entrepreneur',
        workspaceName: 'CCI Touraine',
        committee: { name: 'Comité de juin', ...moment },
        previous: committee.previous,
        signInUrl: 'https://confluent.example/auth',
        locale: 'fr',
      },
    ])
  })
})
