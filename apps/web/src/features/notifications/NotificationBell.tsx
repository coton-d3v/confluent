import { NavLink } from 'react-router-dom'
import { Bell } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useUnreadNotifications } from './unread-context'

function unreadLabel(count: number | null): string {
  if (!count) return 'Notifications'
  return `Notifications, ${count} non lue${count > 1 ? 's' : ''}`
}

// ROADMAP E10.03: the way to the notifications page, with the number of unread ones.
export function NotificationBell({ className }: { className?: string }) {
  const { count } = useUnreadNotifications()
  const label = unreadLabel(count)
  return (
    <NavLink
      to="/notifications"
      aria-label={label}
      title={label}
      className={({ isActive }) =>
        cn(
          'relative inline-flex size-11 items-center justify-center rounded-md text-sidebar-foreground transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]',
          isActive ? 'bg-sidebar-accent' : 'hover:bg-sidebar-accent/60',
          className,
        )
      }
    >
      <Bell className="size-5" aria-hidden="true" />
      {count ? (
        <span
          aria-hidden="true"
          className="absolute top-1 right-1 flex min-w-[18px] items-center justify-center rounded-full bg-destructive px-1 text-[11px] leading-[18px] font-semibold text-white"
        >
          {count > 99 ? '99+' : count}
        </span>
      ) : null}
    </NavLink>
  )
}
