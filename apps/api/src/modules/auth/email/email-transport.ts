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

// ROADMAP E08.06: a committee someone is concerned by changed date, was cancelled or restored — told
// to the owners of the requests it brings and to its accepted participants. Only its name and when
// (and when it was before, for a new date): never its place, link, shared information nor internal
// notes, read in the site once signed in.
export interface SendCommitteeChangedInput {
  to: string
  kind: 'rescheduled' | 'cancelled' | 'restored'
  audience: 'entrepreneur' | 'participant'
  workspaceName: string
  committee: CommitteeMoment & { name: string }
  // A new date only: the schedule before the change.
  previous: CommitteeMoment | null
  signInUrl: string
  locale: Locale
}

export interface CommitteeMoment {
  date: string
  time: string
  timeZone: string
}

// ROADMAP E09.05: an entrepreneur's access request accepted by a workspace's manager — an invitation
// to sign in and present a request to the workspace. The link opens the sign-in page (magic link),
// never a session by itself. Nothing was created on the person's behalf.
export interface SendEntrepreneurAccessAcceptedInput {
  to: string
  workspaceName: string
  // What the acceptance did to the address's account (ENTREPRENEUR_ACCESS_ADMISSIONS).
  admission: 'account_created' | 'account_existing'
  signInUrl: string
  locale: Locale
}

// ROADMAP E10.03: a notification's email — the same sentence as in the site (written from what the
// recipient may read, `notifications/notification-payloads.ts`), and the page it is about. The link
// opens the site, where the person signs in (magic link) if they are not already.
export interface SendNotificationInput {
  to: string
  title: string
  body: string | null
  actionUrl: string
  locale: Locale
}

export interface EmailTransport {
  sendMagicLink(input: SendMagicLinkInput): Promise<void>
  sendShareInvite(input: SendShareInviteInput): Promise<void>
  sendWorkspaceInvite(input: SendWorkspaceInviteInput): Promise<void>
  sendCompanyTransferInvite(input: SendCompanyTransferInviteInput): Promise<void>
  sendParticipationAccepted(input: SendParticipationAcceptedInput): Promise<void>
  sendCommitteeChanged(input: SendCommitteeChangedInput): Promise<void>
  sendEntrepreneurAccessAccepted(input: SendEntrepreneurAccessAcceptedInput): Promise<void>
  sendNotification(input: SendNotificationInput): Promise<void>
}
