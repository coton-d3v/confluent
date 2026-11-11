import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { createTransport, type Transporter } from 'nodemailer'
import type { AppConfig } from '../../../config/config.schema'
import type {
  EmailTransport,
  SendMagicLinkInput,
  SendShareInviteInput,
  SendWorkspaceInviteInput,
} from './email-transport'
import { render } from './template-renderer'

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
