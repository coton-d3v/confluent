import { z } from 'zod'
import type { CommitteeNoticeKind } from './committee-follow-up.schema.js'

// ROADMAP E10.03 — notifications (D05 still open: where it is silent, the most restrictive option).
// This file is the only place where these rules are described; the API applies them
// (`NotificationsService`), the site only shows them.
//
//  * One record per person told of one event (`notifications`): who (an account, never an address),
//    what (`kind`, a closed list), about which object, when, whether they read it, and what became of
//    its email. Written in the transaction of the event that causes it, under that event's locks: the
//    event commits with its notifications or not at all.
//  * Never twice: a natural key per person (the event, its object and, when the object has one, its
//    version — a pledge's revision, a committee's version, the change of status recorded…) is unique;
//    a retried request or a double click that would record the same event again records nothing.
//  * In-app always: every notification is listed to its recipient, the latest first, with an unread
//    count; they mark one or all of them read. Only their own: no identifier of another account is
//    ever taken from the client, and someone else's notification is answered like an unknown one.
//  * Email for the kinds of `NOTIFICATION_EMAILED` only, after the commit, never blocking the event:
//    `to_send` → `sending` (claimed, never sent twice) → `sent` | `failed`; `superseded` when a later
//    notification about the same object reaches the same person before the email left. No automatic
//    retry (no job runner): a failure stays recorded, the in-app notification holds the information.
//    The other kinds are in-app only (`none`): their event already sends and records its own email
//    (invitations, decisions on requests), or an email would be noise (a mark of interest) or open to
//    abuse (a request received from a public form).
//  * Transactional only: no preference turns them off in this version (in-app is always on; the
//    emails are the ones a person needs to act or to know what changed about their access).
//  * Each text is written from what its recipient may read: a request's own name for its owner or a
//    share's recipient, a workspace's name for its members… Never an investor's name, organisation or
//    amount (D05: the owner reads them only where each investor shows them), never an address, a
//    message from a public form, a place, a link or a note of a committee.
//
// The closed lists are kept equal to the CHECK constraints of migration 20261213000000_notifications.

export const NOTIFICATION_KINDS = [
  // To the recipient of a share (E07.01).
  'share_invited',
  'share_level_changed',
  'share_revoked',
  // To a person added to a workspace (E05.02).
  'workspace_invited',
  // Ownership of a prepared company (E05.08): to the invited entrepreneur, then to the conseiller.
  'company_transfer_proposed',
  'company_transfer_answered',
  // To the owner of a request (E07.05, E07.06).
  'interest_received',
  'pledge_received',
  // To the owner of a candidature, when the structure acts (E06.01, E08.03, E09.03).
  'candidature_status_changed',
  'committee_application_changed',
  'showcase_card_hidden',
  // To the account a manager's acceptance admitted (E08.05, E09.05).
  'participation_accepted',
  'entrepreneur_access_accepted',
  // To a workspace's managers (E08.04, E09.05).
  'participation_request_received',
  'entrepreneur_access_request_received',
  // To the people concerned by a committee (E08.06).
  'committee_rescheduled',
  'committee_cancelled',
  'committee_restored',
] as const
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number]
export const notificationKindSchema = z.enum(NOTIFICATION_KINDS)

// Closed by default: a kind this version does not know is not shown (nothing is written about it).
export function notificationKindOf(raw: string): NotificationKind | null {
  return (NOTIFICATION_KINDS as readonly string[]).includes(raw) ? (raw as NotificationKind) : null
}

export const COMMITTEE_NOTIFICATION_KINDS = {
  rescheduled: 'committee_rescheduled',
  cancelled: 'committee_cancelled',
  restored: 'committee_restored',
} as const satisfies Record<CommitteeNoticeKind, NotificationKind>

export function committeeNoticeKindOfNotification(kind: string): CommitteeNoticeKind | null {
  const found = Object.entries(COMMITTEE_NOTIFICATION_KINDS).find(([, k]) => k === kind)
  return found ? (found[0] as CommitteeNoticeKind) : null
}

// Whether a kind's email is sent and recorded with the notification. `false`: in-app only.
export const NOTIFICATION_EMAILED: Record<NotificationKind, boolean> = {
  // The invitation's own email (with the share's link) is sent by the share itself.
  share_invited: false,
  share_level_changed: true,
  share_revoked: true,
  // The invitation's own email is sent by the membership itself.
  workspace_invited: false,
  // The proposal's own email (with its expiry) is sent by the transfer itself.
  company_transfer_proposed: false,
  company_transfer_answered: true,
  // Frequent and reversible: read in the site.
  interest_received: false,
  pledge_received: true,
  candidature_status_changed: true,
  committee_application_changed: true,
  showcase_card_hidden: true,
  // The acceptance's own email is sent and recorded by the request itself (E08.05, E09.05).
  participation_accepted: false,
  entrepreneur_access_accepted: false,
  // Sent from public forms: no email a stranger could trigger at will.
  participation_request_received: false,
  entrepreneur_access_request_received: false,
  committee_rescheduled: true,
  committee_cancelled: true,
  committee_restored: true,
}

export const NOTIFICATION_EMAIL_STATES = [
  'none',
  'to_send',
  'sending',
  'sent',
  'failed',
  'superseded',
] as const
export type NotificationEmailState = (typeof NOTIFICATION_EMAIL_STATES)[number]

export const NOTIFICATION_LIMITS = {
  // Listed at once by default, and at most.
  pageSize: 20,
  maxPageSize: 50,
} as const

// One notification as its recipient reads it: a sentence written by the server from what they may
// read, and the page of the site it is about (a path of the site, or none when the object is gone
// from their reach — a revoked share).
export const notificationSchema = z
  .object({
    id: z.string().uuid(),
    kind: notificationKindSchema,
    title: z.string(),
    body: z.string().nullable(),
    href: z.string().nullable(),
    createdAt: z.string().datetime(),
    readAt: z.string().datetime().nullable(),
  })
  .strict()
export type Notification = z.infer<typeof notificationSchema>

export const notificationPageSchema = z
  .object({
    items: z.array(notificationSchema),
    // Opaque: the next page, null after the last one.
    nextCursor: z.string().nullable(),
    unreadCount: z.number().int().min(0),
  })
  .strict()
export type NotificationPage = z.infer<typeof notificationPageSchema>

export const notificationUnreadSchema = z.object({ unreadCount: z.number().int().min(0) }).strict()
export type NotificationUnread = z.infer<typeof notificationUnreadSchema>

export const notificationListQuerySchema = z.object({
  cursor: z
    .string()
    .max(200)
    .regex(/^[A-Za-z0-9_-]+$/, { message: 'Curseur invalide.' })
    .optional(),
  limit: z.coerce
    .number()
    .int({ message: 'Nombre de notifications invalide.' })
    .min(1, { message: 'Nombre de notifications invalide.' })
    .max(NOTIFICATION_LIMITS.maxPageSize, { message: 'Nombre de notifications invalide.' })
    .optional(),
})
export type NotificationListQuery = z.infer<typeof notificationListQuerySchema>

// « Tout marquer comme lu » up to the moment of the list the person read: a notification arrived
// since stays unread.
export const markAllNotificationsReadSchema = z
  .object({ until: z.string().datetime({ message: 'Date invalide.' }) })
  .strict()
export type MarkAllNotificationsReadInput = z.infer<typeof markAllNotificationsReadSchema>

export const markAllNotificationsReadResultSchema = z
  .object({ updated: z.number().int().min(0), unreadCount: z.number().int().min(0) })
  .strict()
export type MarkAllNotificationsReadResult = z.infer<typeof markAllNotificationsReadResultSchema>
