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

// ROADMAP E05.08: a company a conseiller prepared, offered to the entrepreneur who will own it. The
// link opens their pending proposals once signed in (magic link), never a session by itself.
export interface SendCompanyTransferInviteInput {
  to: string
  companyName: string
  workspaceName: string
  // The conseiller: « Marie Dupont (marie@cci.fr) », or the address alone.
  fromLabel: string
  expiresAt: Date
  // Whether the address already had an account before this invitation.
  existingAccount: boolean
  invitationsUrl: string
  locale: Locale
}

export interface EmailTransport {
  sendMagicLink(input: SendMagicLinkInput): Promise<void>
  sendShareInvite(input: SendShareInviteInput): Promise<void>
  sendWorkspaceInvite(input: SendWorkspaceInviteInput): Promise<void>
  sendCompanyTransferInvite(input: SendCompanyTransferInviteInput): Promise<void>
}
