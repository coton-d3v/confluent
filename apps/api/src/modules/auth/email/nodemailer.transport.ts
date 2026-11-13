import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { createTransport, type Transporter } from 'nodemailer'
import type { AppConfig } from '../../../config/config.schema'
import type {
  CommitteeMoment,
  EmailTransport,
  SendCommitteeChangedInput,
  SendCompanyTransferInviteInput,
  SendMagicLinkInput,
  SendEntrepreneurAccessAcceptedInput,
  SendNotificationInput,
  SendAccountDeletedInput,
  SendParticipationAcceptedInput,
  SendShareInviteInput,
  SendWorkspaceInviteInput,
} from './email-transport'
import { render, templateString } from './template-renderer'

@Injectable()
export class NodemailerTransport implements EmailTransport {
  private readonly logger = new Logger(NodemailerTransport.name)
  private readonly transporter: Transporter
  private readonly from: string

  constructor(private readonly config: ConfigService<AppConfig, true>) {
    const host = this.config.get('SMTP_HOST', { infer: true })
    const port = this.config.get('SMTP_PORT', { infer: true })
    const user = this.config.get('SMTP_USER', { infer: true })
    const pass = this.config.get('SMTP_PASSWORD', { infer: true })
    this.from = this.config.get('SMTP_FROM', { infer: true })
    this.transporter = createTransport({
      host,
      port,
      secure: port === 465,
      requireTLS: port !== 25 && port !== 465,
      auth: user ? { user, pass } : undefined,
    })
  }

  async sendMagicLink(input: SendMagicLinkInput): Promise<void> {
    const { subject, html, text } = render('magic-link', input.locale, {
      magicLinkUrl: input.magicLinkUrl,
    })
    await this.send({ to: input.to, subject, html, text })
  }

  async sendShareInvite(input: SendShareInviteInput): Promise<void> {
    const { subject, html, text } = render('share-invite', input.locale, {
      dossierName: input.dossierName,
      shareUrl: input.shareUrl,
    })
    await this.send({ to: input.to, subject, html, text })
  }

  async sendWorkspaceInvite(input: SendWorkspaceInviteInput): Promise<void> {
    const { subject, html, text } = render('workspace-invite', input.locale, {
      workspaceName: input.workspaceName,
      roleLabel: input.roleLabel,
      signInUrl: input.signInUrl,
    })
    await this.send({ to: input.to, subject, html, text })
  }

  async sendCompanyTransferInvite(input: SendCompanyTransferInviteInput): Promise<void> {
    const { subject, html, text } = render('company-transfer-invite', input.locale, {
      companyName: input.companyName,
      workspaceName: input.workspaceName,
      fromLabel: input.fromLabel,
      expiresOn: new Intl.DateTimeFormat('fr-FR', {
        dateStyle: 'long',
        timeZone: 'Europe/Paris',
      }).format(input.expiresAt),
      accountLine: templateString(
        'company-transfer-invite',
        input.locale,
        input.existingAccount ? 'accountExisting' : 'accountCreated',
      ),
      invitationsUrl: input.invitationsUrl,
    })
    await this.send({ to: input.to, subject, html, text })
  }

  async sendParticipationAccepted(input: SendParticipationAcceptedInput): Promise<void> {
    const { subject, html, text } = render('participation-accepted', input.locale, {
      workspaceName: input.workspaceName,
      sessions: participationSessionLines(input.sessions),
      accountLine: templateString(
        'participation-accepted',
        input.locale,
        ADMISSION_LINES[input.admission],
      ),
      signInUrl: input.signInUrl,
    })
    await this.send({ to: input.to, subject, html, text })
  }

  async sendCommitteeChanged(input: SendCommitteeChangedInput): Promise<void> {
    const key = COMMITTEE_KIND_KEYS[input.kind]
    const line = (name: string) => templateString('committee-changed', input.locale, name)
    const when = [`${line(`when${key}`)} ${committeeMomentLine(input.committee)}`]
    if (input.previous) when.push(`${line('whenPrevious')} ${committeeMomentLine(input.previous)}`)
    const rendered = render('committee-changed', input.locale, {
      title: line(`title${key}`),
      body: line(`body${key}`),
      workspaceName: input.workspaceName,
      committeeName: input.committee.name,
      when: when.join('\n'),
      audienceLine: line(
        input.audience === 'entrepreneur' ? 'entrepreneurLine' : 'participantLine',
      ),
      signInUrl: input.signInUrl,
    })
    await this.send({
      to: input.to,
      subject: line(`subject${key}`),
      html: rendered.html,
      text: rendered.text,
    })
  }

  async sendEntrepreneurAccessAccepted(input: SendEntrepreneurAccessAcceptedInput): Promise<void> {
    const { subject, html, text } = render('entrepreneur-access-accepted', input.locale, {
      workspaceName: input.workspaceName,
      accountLine: templateString(
        'entrepreneur-access-accepted',
        input.locale,
        input.admission === 'account_created' ? 'accountCreated' : 'accountExisting',
      ),
      signInUrl: input.signInUrl,
    })
    await this.send({ to: input.to, subject, html, text })
  }

  async sendNotification(input: SendNotificationInput): Promise<void> {
    const { html, text } = render('notification', input.locale, {
      title: input.title,
      preheader: input.body ?? input.title,
      body: input.body ?? '',
      actionUrl: input.actionUrl,
    })
    await this.send({ to: input.to, subject: input.title, html, text })
  }

  async sendAccountDeleted(input: SendAccountDeletedInput): Promise<void> {
    const { subject, html, text } = render('account-deleted', input.locale, {
      actionUrl: input.privacyUrl,
    })
    await this.send({ to: input.to, subject, html, text })
  }

  private async send(payload: {
    to: string
    subject: string
    html: string
    text: string
  }): Promise<void> {
    try {
      await this.transporter.sendMail({ from: this.from, ...payload })
    } catch (err) {
      this.logger.warn(
        `Failed to send email to ${payload.to}: ${err instanceof Error ? err.message : String(err)}`,
      )
      throw err
    }
  }
}

const ADMISSION_LINES = {
  account_created: 'accountCreated',
  membership_created: 'membershipCreated',
  already_member: 'alreadyMember',
} as const

const SESSION_STATUS_SUFFIX: Record<string, string> = { cancelled: ' (annulée)', held: ' (tenue)' }

// « • Comité de juin — mercredi 10 juin 2099 à 14:00 (Europe/Paris) », one session per line, at the
// wall-clock time of the committee's own time zone, as the public form showed it.
export function participationSessionLines(
  sessions: SendParticipationAcceptedInput['sessions'],
): string {
  const day = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'full', timeZone: 'UTC' })
  return sessions
    .map(
      (s) =>
        `• ${s.name} — ${day.format(new Date(`${s.date}T00:00:00Z`))} à ${s.time} (${s.timeZone})` +
        (SESSION_STATUS_SUFFIX[s.status] ?? ''),
    )
    .join('\n')
}

const COMMITTEE_KIND_KEYS = {
  rescheduled: 'Rescheduled',
  cancelled: 'Cancelled',
  restored: 'Restored',
} as const

// « mercredi 10 juin 2099 à 14:00 (Europe/Paris) »: the wall-clock time of the committee's own zone.
export function committeeMomentLine(moment: CommitteeMoment): string {
  const day = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'full', timeZone: 'UTC' })
  return `${day.format(new Date(`${moment.date}T00:00:00Z`))} à ${moment.time} (${moment.timeZone})`
}
