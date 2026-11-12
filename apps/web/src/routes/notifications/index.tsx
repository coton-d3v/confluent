import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import type { Notification } from '@confluent/shared'
import { Button } from '@/components/ui/button'
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '@/features/notifications/api'
import { useUnreadNotifications } from '@/features/notifications/unread-context'
import type { ApiError } from '@/lib/api-client'
import { cn } from '@/lib/utils'

const when = (iso: string) =>
  new Date(iso).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })

function failure(err: unknown, what: string): string {
  const e = err as Partial<ApiError> | undefined
  if (e?.status === undefined) return `${what} Vérifiez votre connexion puis réessayez.`
  return e.message ?? what
}

type Load = { state: 'loading' } | { state: 'failed'; message: string } | { state: 'ready' }

// ROADMAP E10.03: the signed-in person's notifications, the latest first, a page at a time — what
// changed about their access, requests, candidatures, committees or workspaces, each linked to the
// page it is about. Reading one marks it read; « Tout marquer comme lu » marks those listed so far
// (one arrived since stays unread).
export default function NotificationsRoute() {
  const headingRef = useRef<HTMLHeadingElement>(null)
  const navigate = useNavigate()
  const unread = useUnreadNotifications()
  const [items, setItems] = useState<Notification[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [unreadCount, setUnreadCount] = useState(0)
  const [load, setLoad] = useState<Load>({ state: 'loading' })
  const [more, setMore] = useState<Load>({ state: 'ready' })
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => headingRef.current?.focus(), [])

  // Only the latest reading of the list is shown: an earlier one answering late is dropped.
  const generation = useRef(0)
  // Bumped by every reading recorded here (one or all): a page read before it no longer tells the
  // unread count (code review R74).
  const marks = useRef(0)
  const reload = useCallback(async () => {
    const mine = ++generation.current
    setLoad({ state: 'loading' })
    // A page still being read belongs to the previous list: never left « Chargement… ».
    setMore({ state: 'ready' })
    try {
      const page = await listNotifications()
      if (mine !== generation.current) return
      setItems(page.items)
      setCursor(page.nextCursor)
      setUnreadCount(page.unreadCount)
      setLoad({ state: 'ready' })
    } catch (err) {
      if (mine !== generation.current) return
      setLoad({
        state: 'failed',
        message: failure(err, 'Vos notifications n’ont pas pu être chargées.'),
      })
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  async function loadMore() {
    if (!cursor) return
    const mine = generation.current
    const marksBefore = marks.current
    setMore({ state: 'loading' })
    try {
      const page = await listNotifications(cursor)
      // Read for a list since replaced: dropped, the pagination of the new list left usable.
      if (mine !== generation.current) return
      setItems((known) => [...known, ...page.items.filter((i) => !known.some((k) => k.id === i.id))])
      setCursor(page.nextCursor)
      // Counted before a reading recorded meanwhile: the count kept here is the newer one.
      if (marksBefore === marks.current) setUnreadCount(page.unreadCount)
      setMore({ state: 'ready' })
    } catch (err) {
      if (mine !== generation.current) return
      setMore({
        state: 'failed',
        message: failure(err, 'Les notifications suivantes n’ont pas pu être chargées.'),
      })
    }
  }

  // Marked read on the server first: the list and the bell say so only once it is recorded.
  async function read(item: Notification): Promise<boolean> {
    if (item.readAt) return true
    setBusy(item.id)
    try {
      const done = await markNotificationRead(item.id)
      marks.current += 1
      setItems((known) => known.map((k) => (k.id === done.id ? done : k)))
      setUnreadCount((n) => Math.max(0, n - 1))
      unread.refresh()
      return true
    } catch (err) {
      toast.error(failure(err, 'La notification n’a pas pu être marquée comme lue.'))
      return false
    } finally {
      setBusy(null)
    }
  }

  async function open(item: Notification) {
    if (!item.href) return
    // Opened even if the reading could not be recorded: it stays unread, and says so.
    await read(item)
    navigate(item.href)
  }

  async function readAll() {
    const latest = items[0]
    if (!latest) return
    setBusy('all')
    try {
      await markAllNotificationsRead(latest.createdAt)
      marks.current += 1
      toast.success('Notifications marquées comme lues.')
      unread.refresh()
      await reload()
    } catch (err) {
      toast.error(failure(err, 'Les notifications n’ont pas pu être marquées comme lues.'))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="mx-auto flex max-w-[760px] flex-col gap-5">
      <title>Notifications · Confluent</title>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1
            ref={headingRef}
            tabIndex={-1}
            className="font-heading text-2xl font-semibold text-foreground md:text-[28px] focus-visible:outline-none"
          >
            Notifications
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Ce qui a changé pour vous : vos accès, vos demandes, vos candidatures, vos comités et
            vos workspaces. Certaines vous sont aussi envoyées par email.
          </p>
        </div>
        {load.state === 'ready' && unreadCount > 0 ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy !== null || more.state === 'loading'}
            onClick={() => void readAll()}
          >
            {busy === 'all' ? 'Enregistrement…' : 'Tout marquer comme lu'}
          </Button>
        ) : null}
      </div>

      {load.state === 'loading' && items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Chargement…</p>
      ) : load.state === 'failed' ? (
        <div role="alert" className="flex flex-col items-start gap-2">
          <p className="text-sm text-destructive">{load.message}</p>
          <Button type="button" variant="outline" size="sm" onClick={() => void reload()}>
            Réessayer
          </Button>
        </div>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Aucune notification pour le moment.</p>
      ) : (
        <>
          <p className="sr-only" aria-live="polite">
            {unreadCount === 0
              ? 'Toutes vos notifications sont lues.'
              : `${unreadCount} notification${unreadCount > 1 ? 's' : ''} non lue${unreadCount > 1 ? 's' : ''}.`}
          </p>
          <ul className="flex flex-col divide-y divide-border rounded-md border border-border bg-card">
            {items.map((item) => (
              <li
                key={item.id}
                className={cn('flex gap-3 px-4 py-3', !item.readAt && 'bg-accent/40')}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'mt-1.5 size-2 shrink-0 rounded-full',
                    item.readAt ? 'bg-transparent' : 'bg-primary',
                  )}
                />
                <div className="min-w-0 flex-1">
                  <p
                    className={cn(
                      'wrap-anywhere text-sm text-foreground',
                      !item.readAt && 'font-semibold',
                    )}
                  >
                    {!item.readAt ? <span className="sr-only">Non lue : </span> : null}
                    {item.title}
                  </p>
                  {item.body ? (
                    <p className="mt-1 wrap-anywhere text-sm text-muted-foreground">{item.body}</p>
                  ) : null}
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <time dateTime={item.createdAt} className="text-xs text-muted-foreground">
                      {when(item.createdAt)}
                    </time>
                    {item.href ? (
                      <Button
                        type="button"
                        variant="link"
                        size="sm"
                        className="h-auto min-h-11 px-0 md:min-h-0"
                        disabled={busy !== null || more.state === 'loading'}
                        onClick={() => void open(item)}
                      >
                        Ouvrir
                      </Button>
                    ) : null}
                    {!item.readAt ? (
                      <Button
                        type="button"
                        variant="link"
                        size="sm"
                        className="h-auto min-h-11 px-0 text-muted-foreground md:min-h-0"
                        disabled={busy !== null || more.state === 'loading'}
                        onClick={() => void read(item)}
                      >
                        {busy === item.id ? 'Enregistrement…' : 'Marquer comme lue'}
                      </Button>
                    ) : null}
                  </div>
                </div>
              </li>
            ))}
          </ul>
          {cursor ? (
            <div className="flex flex-col items-start gap-2">
              {more.state === 'failed' ? (
                <p role="alert" className="text-sm text-destructive">
                  {more.message}
                </p>
              ) : null}
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={more.state === 'loading' || busy !== null}
                onClick={() => void loadMore()}
              >
                {more.state === 'loading'
                  ? 'Chargement…'
                  : more.state === 'failed'
                    ? 'Réessayer'
                    : 'Voir plus'}
              </Button>
            </div>
          ) : null}
        </>
      )}
    </div>
  )
}
