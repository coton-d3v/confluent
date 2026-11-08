import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import type { FormDetail, FormVersionStructure } from '@confluent/shared'
import { getDraft, getForm, getFormVersion } from '@/features/admin/forms.api'
import type { ApiError } from '@/lib/api-client'

export interface FormEditorData {
  detail: FormDetail
  // The draft when there is one, otherwise the published version (read-only), otherwise null.
  structure: FormVersionStructure | null
}

async function loadEditor(formId: string): Promise<FormEditorData> {
  const detail = await getForm(formId)
  const structure = detail.draft
    ? await getDraft(formId)
    : detail.published
      ? await getFormVersion(formId, detail.published.id)
      : null
  return { detail, structure }
}

export function errorMessage(err: unknown, fallback = 'L’opération a échoué.'): string {
  return (err as ApiError | undefined)?.message ?? fallback
}

// State of the form editor. `run` performs one change, then reloads from the API, which stays the
// only source of truth (keys, positions, problems); actions are disabled while `busy`.
export function useFormEditor(formId: string) {
  const [data, setData] = useState<FormEditorData | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)

  const reload = useCallback(async () => {
    try {
      setData(await loadEditor(formId))
      setError(null)
    } catch (err) {
      setError(err)
    }
  }, [formId])

  // Initial load; state is set from the promise callbacks, and ignored once the form changed.
  useEffect(() => {
    let cancelled = false
    loadEditor(formId).then(
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
  }, [formId])

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
      // Confirm only once the screen shows the result.
      await reload()
      setBusy(false)
      if (ok && success) toast.success(success)
      return ok
    },
    [reload],
  )

  return { data, error, busy, run }
}
