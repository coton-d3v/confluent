import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import type {
  ClassificationCoverage,
  ClassificationRule,
  QuestionnaireField,
} from '@confluent/shared'
import { getCoverage, listRules } from '@/features/admin/classification.api'
import { confluentFormsApi } from '@/features/admin/forms.api'
import { getActiveQuestionnaire } from '@/features/questionnaire/api'
import type { ApiError } from '@/lib/api-client'

export interface ClassificationAdminData {
  rules: ClassificationRule[]
  coverage: ClassificationCoverage
  // Fields of the dossier form, published version then draft: labels and choices for the rules,
  // including a choice only added in the draft.
  fields: QuestionnaireField[]
}

async function dossierFormFields(): Promise<QuestionnaireField[]> {
  const [published, forms] = await Promise.all([getActiveQuestionnaire(), confluentFormsApi.listForms()])
  const dossierForm = forms.find((f) => f.usage === 'dossier')
  const draft = dossierForm?.draft ? await confluentFormsApi.getDraft(dossierForm.id) : null
  return [...published.fields, ...(draft?.fields ?? [])]
}

const load = async (): Promise<ClassificationAdminData> => {
  const [rules, coverage, fields] = await Promise.all([listRules(), getCoverage(), dossierFormFields()])
  return { rules, coverage, fields }
}

export const errorMessage = (err: unknown, fallback = 'L’opération a échoué.') =>
  (err as ApiError | undefined)?.message ?? fallback

// A change and the refresh that follows are told apart: a saved change whose refresh fails is
// reported as such, never as a plain success on a stale screen.
export function useClassificationAdmin() {
  const [data, setData] = useState<ClassificationAdminData | null>(null)
  const [loadError, setLoadError] = useState<unknown>(null)
  const [stale, setStale] = useState(false)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async (): Promise<boolean> => {
    try {
      setData(await load())
      setLoadError(null)
      setStale(false)
      return true
    } catch (err) {
      setLoadError(err)
      return false
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    load().then(
      (loaded) => !cancelled && setData(loaded),
      (err: unknown) => !cancelled && setLoadError(err),
    )
    return () => {
      cancelled = true
    }
  }, [])

  const run = useCallback(
    async (action: () => Promise<unknown>, success: string): Promise<boolean> => {
      setBusy(true)
      try {
        await action()
      } catch (err) {
        toast.error(errorMessage(err))
        setBusy(false)
        return false
      }
      const refreshed = await refresh()
      setBusy(false)
      if (refreshed) toast.success(success)
      else {
        setStale(true)
        toast.warning(`${success} L’affichage n’a pas pu être actualisé.`)
      }
      return true
    },
    [refresh],
  )

  return { data, loadError, stale, busy, run, refresh }
}
