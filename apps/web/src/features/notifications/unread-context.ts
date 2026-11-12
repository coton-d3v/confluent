import { createContext, use } from 'react'

interface UnreadNotifications {
  // Null until known (or while the count cannot be read): no badge rather than a wrong one.
  count: number | null
  // Reads it again, e.g. after notifications were marked read.
  refresh: () => void
}

// The signed-in person's unread notifications, kept by the application shell.
export const UnreadNotificationsContext = createContext<UnreadNotifications>({
  count: null,
  refresh: () => undefined,
})

export function useUnreadNotifications(): UnreadNotifications {
  return use(UnreadNotificationsContext)
}
