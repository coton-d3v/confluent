import { useEffect } from 'react'
import {
  READING_HEARTBEAT_INTERVAL_SECONDS,
  READING_HEARTBEAT_MAX_MS,
  READING_IDLE_AFTER_SECONDS,
} from '@confluent/shared'
import { sendReadingHeartbeat } from './api'

const TICK_MS = 1_000
// A tick never counts more than this: a computer asleep, a throttled timer.
const MAX_STEP_MS = 2 * TICK_MS
const IDLE_MS = READING_IDLE_AFTER_SECONDS * 1_000
const INTERVAL_MS = READING_HEARTBEAT_INTERVAL_SECONDS * 1_000
const ACTIVITY = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'scroll'] as const

// ROADMAP E07.08 (@confluent/shared `reading.schema.ts`): measures the active time of the reading
// session `sessionId` — while the page is shown in the foreground and the reader interacted within
// the last minute — and sends it every 15 s, when the page is hidden and when it closes. Nothing is
// sent but a number of milliseconds; the API decides what it credits. `null`: not measured.
export function useReadingTracker(sessionId: string | null | undefined): void {
  useEffect(() => {
    if (!sessionId) return
    let closed = false
    let pendingMs = 0
    let visible = document.visibilityState === 'visible'
    let lastTick = performance.now()
    let lastSent = lastTick
    // Opening the page is the reader's doing.
    let lastActivity = lastTick

    const accumulate = () => {
      const now = performance.now()
      if (visible && now - lastActivity < IDLE_MS) {
        pendingMs += Math.min(now - lastTick, MAX_STEP_MS)
      }
      lastTick = now
    }
    const flush = (keepalive = false) => {
      accumulate()
      lastSent = performance.now()
      const activeMs = Math.min(Math.floor(pendingMs), READING_HEARTBEAT_MAX_MS)
      if (closed || activeMs <= 0) return
      pendingMs -= activeMs
      sendReadingHeartbeat(sessionId, activeMs, keepalive)
        .then((result) => {
          if (!result.open) closed = true
        })
        .catch(() => {
          // Lost: the next heartbeat carries on; the time elapsed bounds what it is credited.
        })
    }
    const onActivity = () => {
      lastActivity = performance.now()
    }
    const onVisibility = () => {
      accumulate()
      visible = document.visibilityState === 'visible'
      if (visible) onActivity()
      else flush(true)
    }
    const onPageHide = () => flush(true)

    const timer = window.setInterval(() => {
      accumulate()
      if (performance.now() - lastSent >= INTERVAL_MS) flush()
    }, TICK_MS)
    for (const type of ACTIVITY) {
      window.addEventListener(type, onActivity, { passive: true, capture: true })
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', onPageHide)
    return () => {
      window.clearInterval(timer)
      for (const type of ACTIVITY) window.removeEventListener(type, onActivity, { capture: true })
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', onPageHide)
      flush()
    }
  }, [sessionId])
}
