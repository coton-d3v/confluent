export const EMAIL_TRANSPORT = Symbol('EMAIL_TRANSPORT')

export type Locale = 'fr'

export interface SendMagicLinkInput {
  to: string
  magicLinkUrl: string
  locale: Locale
}

export interface SendShareInviteInput {
  to: string
  dossierName: string
  shareUrl: string
  locale: Locale
}

// ROADMAP E05.02: a person added to a workspace. The link opens the sign-in page (magic link), never
// a session by itself: an invitation stays readable for days, a sign-in link for 15 minutes.
export interface SendWorkspaceInviteInput {
  to: string
  workspaceName: string
  // In the sentence « Votre rôle : conseiller ».
  roleLabel: string
  signInUrl: string
  locale: Locale
}

export interface EmailTransport {
  sendMagicLink(input: SendMagicLinkInput): Promise<void>
  sendShareInvite(input: SendShareInviteInput): Promise<void>
  sendWorkspaceInvite(input: SendWorkspaceInviteInput): Promise<void>
}
