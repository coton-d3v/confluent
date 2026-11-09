import type { CurrentUser } from '@confluent/shared'

export interface AuthUser {
  id: string
  email: string
  role: CurrentUser['role']
  firstName: string | null
  lastName: string | null
}

export interface AuthState {
  accessToken: string | null
  user: AuthUser | null
}

let state: AuthState = { accessToken: null, user: null }
// Incremented by every sign-in and sign-out (code review R06): a refresh started under an older
// generation must not write its result over a more recent decision.
let generation = 0
const listeners = new Set<() => void>()

export function sessionGeneration(): number {
  return generation
}

export function getAuthState(): AuthState {
  return state
}

export function setAuth(next: { accessToken: string; user: AuthUser } | null): void {
  generation++
  state = next === null ? { accessToken: null, user: null } : { ...next }
  listeners.forEach((l) => l())
}

export function setAccessToken(token: string | null): void {
  state = { ...state, accessToken: token }
  listeners.forEach((l) => l())
}

export function subscribeAuth(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
