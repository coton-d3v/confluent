import type {
  MarkAllNotificationsReadResult,
  Notification,
  NotificationPage,
  NotificationUnread,
} from '@confluent/shared'
import { apiRequest } from '@/lib/api-client'

// ROADMAP E10.03: the signed-in person's notifications. Only their own: the API takes no account
// identifier from the site.

export const listNotifications = (cursor?: string | null) =>
  apiRequest<NotificationPage>(
    `/v1/notifications${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
  )

export const getUnreadNotifications = () =>
  apiRequest<NotificationUnread>('/v1/notifications/unread-count')

export const markNotificationRead = (id: string) =>
  apiRequest<Notification>(`/v1/notifications/${encodeURIComponent(id)}/read`, { method: 'POST' })

// Up to the latest notification the person saw: one arrived since stays unread.
export const markAllNotificationsRead = (until: string) =>
  apiRequest<MarkAllNotificationsReadResult>('/v1/notifications/read-all', {
    method: 'POST',
    body: JSON.stringify({ until }),
  })
