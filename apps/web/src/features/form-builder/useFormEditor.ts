import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import type { FormDetail, FormVersionStructure } from '@confluent/shared'
import type { FormsApi } from '@/features/admin/forms.api'
import type { ApiError } from '@/lib/api-client'

export interface FormEditorData {
  detail: FormDetail
  // The draft when there is one, otherwise the published version (read-only), otherwise null.
  structure: FormVersionStructure | null
}

async function loadEditor(api: FormsApi, formId: string): Promise<FormEditorData> {
  const detail = await api.getForm(formId)
  const structure = detail.draft
    ? await api.getDraft(formId)
    : detail.published
      ? await api.getFormVersion(formId, detail.published.id)
      : null
  return { detail, structure }
}

export function errorMessage(err: unknown, fallback = 'L’opération a échoué.'): string {
  return (err as ApiError | undefined)?.message ?? fallback
}

// State of the form editor. `run` performs one change, then reloads from the API, which stays the
// only source of truth (keys, positions, problems); actions are disabled while `busy`. A change and
// the reload that follows are told apart (code review R37): a saved change whose reload fails is
// reported as saved with an out-of-date screen (`stale`), never as a plain success, and `refresh`
// retries the reading only, without sending the change again.
export function useFormEditor(api: FormsApi, formId: string) {
  const [data, setData] = useState<FormEditorData | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [stale, setStale] = useState(false)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async (): Promise<boolean> => {
    try {
      setData(await loadEditor(api, formId))
      setError(null)
      setStale(false)
      return true
    } catch (err) {
      setError(err)
      setStale(true)
      return false
    }
  }, [api, formId])

  // Initial load; state is set from the promise callbacks, and ignored once the form changed.
  useEffect(() => {
    let cancelled = false
    loadEditor(api, formId).then(
      (loaded) => {
        if (!cancelled) setData(loaded)
      },
      (err: unknown) => {
        if (!cancelled) setError(err)
      },
    )
    return () => {
      cancelled = true
    }
  }, [api, formId])

  const run = useCallback(
    async (action: () => Promise<unknown>, success?: string): Promise<boolean> => {
      setBusy(true)
      let ok = false
      try {
        await action()
        ok = true
      } catch (err) {
        toast.error(errorMessage(err))
      }
      // Confirm only once the screen shows the result; a failed change is reloaded too, so that a
      // « modifié entre-temps » shows what changed.
      const refreshed = await refresh()
      setBusy(false)
      if (ok && success) {
        if (refreshed) toast.success(success)
        else toast.warning(`${success} L’affichage n’a pas pu être actualisé.`)
      } else if (ok && !refreshed) {
        toast.warning('Modification enregistrée, mais l’affichage n’a pas pu être actualisé.')
      }
      return ok
    },
    [refresh],
  )

  const retryRefresh = useCallback(async () => {
    setBusy(true)
    const refreshed = await refresh()
    setBusy(false)
    if (!refreshed) toast.error('L’affichage n’a toujours pas pu être actualisé.')
  }, [refresh])

  return { data, error, stale, busy, run, refresh: retryRefresh }
}
