import { useCallback, useEffect, useState } from 'react'
import { isTemporaryFailure } from './api-client'

export interface QueryState<T> {
  data: T | undefined
  isLoading: boolean
  error: unknown
  refetch: () => void
}

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): QueryState<T> {
  const [data, setData] = useState<T | undefined>(undefined)
  const [error, setError] = useState<unknown>(null)
  const [isLoading, setLoading] = useState<boolean>(true)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fn()
      .then((res) => {
        if (!cancelled) {
          setData(res)
          setError(null)
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick])

  const refetch = useCallback(() => setTick((n) => n + 1), [])

  // ROADMAP E10.06: a reading that failed for want of an answer is tried again once when the browser
  // comes back online — on that event only, never on a timer.
  useEffect(() => {
    if (!error || !isTemporaryFailure(error)) return
    window.addEventListener('online', refetch)
    return () => window.removeEventListener('online', refetch)
  }, [error, refetch])

  return { data, isLoading, error, refetch }
}
