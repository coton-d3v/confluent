import { useCallback, useEffect, useRef, useState } from 'react'
import type { AnswerInput } from '@confluent/shared'
import { upsertAnswers } from '@/features/dossiers/answers.api'

const AUTOSAVE_DEBOUNCE_MS = 800

// What the person sees about their answers (code review U11): waiting for the debounce, being
// sent, all saved, or the last send failed.
export type SaveStatus = 'saved' | 'pending' | 'saving' | 'failed'

export interface AnswerAutosave {
  status: SaveStatus
  // Saves after a short pause in typing.
  schedule: (answers: Record<string, string>) => void
  // Saves now; resolves true once these answers are in the database, false if the send failed
  // (the difference stays pending and is sent again by the next save).
  flush: (answers: Record<string, string>) => Promise<boolean>
  // Something typed is not in the database yet (debounce pending, send in progress, or failed).
  isDirty: () => boolean
  latest: () => Record<string, string>
}

// Autosave of a dossier's answers, one send at a time (code review R23): what was typed is sent
// before the page goes away — on unmount, the pending answers are flushed; on reload or close, the
// browser asks for confirmation while something is unsaved.
export function useAnswerAutosave(
  dossierId: string,
  initialAnswers: Record<string, string>,
): AnswerAutosave {
  const lastSavedRef = useRef(initialAnswers)
  const latestRef = useRef(initialAnswers)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Sends are chained: overlapping requests could land out of order and keep an older value.
  const chainRef = useRef<Promise<boolean>>(Promise.resolve(true))
  const inFlightRef = useRef(0)
  const [status, setStatus] = useState<SaveStatus>('saved')

  const diffAgainstSaved = useCallback((current: Record<string, string>): AnswerInput[] => {
    const diff: AnswerInput[] = []
    for (const [fieldId, value] of Object.entries(current)) {
      const saved = lastSavedRef.current[fieldId]
      // A skipped optional question that was never answered has nothing to save.
      if (saved !== value && !(saved === undefined && value === '')) diff.push({ fieldId, value })
    }
    return diff
  }, [])

  const isDirty = useCallback(
    () =>
      timerRef.current !== null ||
      inFlightRef.current > 0 ||
      diffAgainstSaved(latestRef.current).length > 0,
    [diffAgainstSaved],
  )

  const flush = useCallback(
    (current: Record<string, string>): Promise<boolean> => {
      latestRef.current = current
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
      const send = async (): Promise<boolean> => {
        const diff = diffAgainstSaved(current)
        if (diff.length === 0) return true
        inFlightRef.current++
        setStatus('saving')
        try {
          await upsertAnswers(dossierId, diff)
          lastSavedRef.current = {
            ...lastSavedRef.current,
            ...Object.fromEntries(diff.map((a) => [a.fieldId, a.value])),
          }
          return true
        } catch {
          return false
        } finally {
          inFlightRef.current--
        }
      }
      const result = chainRef.current.then(send, send).then((ok) => {
        if (!ok) setStatus('failed')
        else if (inFlightRef.current === 0) setStatus(isDirty() ? 'pending' : 'saved')
        return ok
      })
      chainRef.current = result
      return result
    },
    [dossierId, diffAgainstSaved, isDirty],
  )

  const schedule = useCallback(
    (answers: Record<string, string>) => {
      latestRef.current = answers
      if (timerRef.current) clearTimeout(timerRef.current)
      setStatus('pending')
      timerRef.current = setTimeout(() => {
        timerRef.current = null
        void flush(answers)
      }, AUTOSAVE_DEBOUNCE_MS)
    },
    [flush],
  )

  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (!isDirty()) return
      void flush(latestRef.current)
      e.preventDefault()
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload)
      // Leaving the questionnaire inside the app: what is still waiting for the debounce is sent.
      if (timerRef.current) void flush(latestRef.current)
    }
  }, [flush, isDirty])

  // Stable, like `flush` and `isDirty`: effects may depend on them without re-running at each status.
  const latest = useCallback(() => latestRef.current, [])

  return { status, schedule, flush, isDirty, latest }
}
