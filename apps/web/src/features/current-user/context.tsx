// Current user resolution: the real session from `authStore`, restored at start from the refresh
// cookie. No other source: the early demo fixture that let a `?as=` parameter pose as an account was
// removed (ROADMAP E10.06).

import { createContext, use, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { CurrentUser } from '@confluent/shared'
import { getAuthState, subscribeAuth, type AuthUser } from '@/features/auth/auth-store'
import { initAuth } from '@/features/auth/api'

function fromAuth(authUser: AuthUser): CurrentUser {
  const first = authUser.firstName?.trim() ?? ''
  const last = authUser.lastName?.trim() ?? ''
  const name = [first, last].filter(Boolean).join(' ') || authUser.email
  return {
    id: authUser.id,
    name,
    firstName: authUser.firstName ?? null,
    email: authUser.email,
    role: authUser.role,
  }
}

function resolveCurrentUser(): CurrentUser | null {
  const { user } = getAuthState()
  return user ? fromAuth(user) : null
}

interface AuthContextValue {
  user: CurrentUser | null
  loading: boolean
  // ROADMAP E10.06: the session could not be restored for want of an answer from the server (offline,
  // server restarting): neither signed in nor known to be signed out.
  unreachable: boolean
  // Tries again to restore the session; also done when the browser comes back online.
  retry: () => void
}

const CurrentUserContext = createContext<AuthContextValue | undefined>(undefined)

export function CurrentUserProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [unreachable, setUnreachable] = useState(false)
  const restoring = useRef(false)

  // One restoration at a time: they share the single refresh call anyway (api-client).
  const run = useCallback(() => {
    if (restoring.current) return
    restoring.current = true
    initAuth()
      .then((outcome) => {
        setUser(resolveCurrentUser())
        setUnreachable(outcome === 'unreachable' && getAuthState().user === null)
      })
      .finally(() => {
        restoring.current = false
        setLoading(false)
      })
  }, [])
  const retry = useCallback(() => {
    setLoading(true)
    run()
  }, [run])

  useEffect(() => {
    run()
    const unsubscribe = subscribeAuth(() => {
      setUser(resolveCurrentUser())
      if (getAuthState().user) setUnreachable(false)
    })
    return () => {
      unsubscribe()
    }
  }, [run])

  useEffect(() => {
    if (!unreachable) return
    window.addEventListener('online', retry)
    return () => window.removeEventListener('online', retry)
  }, [unreachable, retry])

  return (
    <CurrentUserContext value={{ user, loading, unreachable, retry }}>
      {children}
    </CurrentUserContext>
  )
}

export function useCurrentUser(): CurrentUser {
  const ctx = use(CurrentUserContext)
  if (ctx === undefined) {
    throw new Error('useCurrentUser must be used within a CurrentUserProvider')
  }
  if (!ctx.user) {
    throw new Error('useCurrentUser called without an authenticated user')
  }
  return ctx.user
}

export function useAuthState(): AuthContextValue {
  const ctx = use(CurrentUserContext)
  if (ctx === undefined) {
    throw new Error('useAuthState must be used within a CurrentUserProvider')
  }
  return ctx
}
