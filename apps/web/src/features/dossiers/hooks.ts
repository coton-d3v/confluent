import { useCallback, useMemo, useState } from 'react'
import type { AnswerRow, Dossier } from '@confluent/shared'
import { useAsync, type QueryState } from '@/lib/useAsync'
import { listAnswers } from './answers.api'
import { getDossier, listDossiers } from './api'

export function useDossiers(): QueryState<Dossier[]> {
  return useAsync(() => listDossiers(), [])
}

export function useDossier(id: string | undefined): QueryState<Dossier> {
  return useAsync(
    () => (id ? getDossier(id) : Promise.reject(new Error('id required'))),
    [id],
  )
}

// A dossier's answers, including those changed here since they were loaded (a confirmed proposal,
// E04.05) — without reloading the page — until the next load.
export function useDossierAnswers(
  dossierId: string,
): QueryState<AnswerRow[]> & { replace: (row: AnswerRow) => void } {
  const query = useAsync(() => listAnswers(dossierId), [dossierId])
  const [changed, setChanged] = useState<{ base?: AnswerRow[]; rows: Record<string, AnswerRow> }>({
    rows: {},
  })
  const loaded = query.data
  const data = useMemo(
    () =>
      loaded && changed.base === loaded
        ? loaded.map((row) => changed.rows[row.fieldId] ?? row)
        : loaded,
    [loaded, changed],
  )
  const replace = useCallback(
    (row: AnswerRow) =>
      setChanged((prev) => ({
        base: loaded,
        rows: { ...(prev.base === loaded ? prev.rows : {}), [row.fieldId]: row },
      })),
    [loaded],
  )
  return { ...query, data, replace }
}
