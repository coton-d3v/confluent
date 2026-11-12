import { useCallback, useEffect, useRef, useState } from 'react'
import { getUnreadNotifications } from './api'

// Read again every minute and whenever the page comes back to the foreground; a failure keeps the
// last count known (the bell is a hint, the list is the reference).
const EVERY_MS = 60_000

export function useUnreadCount(userId: string | null) {
  // Kept with the account it was read for: another account signed in meanwhile shows none.
  const [known, setKnown] = useState<{ userId: string; count: number } | null>(null)
  const generation = useRef(0)

  const refresh = useCallback(() => {
    if (!userId) return
    const mine = ++generation.current
    getUnreadNotifications()
      .then((res) => {
        if (mine === generation.current) setKnown({ userId, count: res.unreadCount })
      })
      .catch(() => undefined)
  }, [userId])

  useEffect(() => {
    if (!userId) return
    refresh()
    const timer = window.setInterval(refresh, EVERY_MS)
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [userId, refresh])

  return { count: known && known.userId === userId ? known.count : null, refresh }
}
