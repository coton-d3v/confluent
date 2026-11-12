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

// ROADMAP E08.05: a participation request accepted by a workspace's manager. The link opens the
// sign-in page (magic link), never a session by itself. Only what the public form already showed of
// the sessions (name and when): never their place, link or information for participants.
export interface SendParticipationAcceptedInput {
  to: string
  workspaceName: string
  sessions: Array<{ name: string; date: string; time: string; timeZone: string; status: string }>
  // What the acceptance did to the address's account (PARTICIPATION_ADMISSIONS).
  admission: 'account_created' | 'membership_created' | 'already_member'
  signInUrl: string
  locale: Locale
}

export interface EmailTransport {
  sendMagicLink(input: SendMagicLinkInput): Promise<void>
  sendShareInvite(input: SendShareInviteInput): Promise<void>
  sendWorkspaceInvite(input: SendWorkspaceInviteInput): Promise<void>
  sendCompanyTransferInvite(input: SendCompanyTransferInviteInput): Promise<void>
  sendParticipationAccepted(input: SendParticipationAcceptedInput): Promise<void>
}
