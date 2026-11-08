import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { missingRequiredAnswers } from '@confluent/shared'
import { Button } from '@/components/ui/button'
import { listAnswers } from '@/features/dossiers/answers.api'
import { getDossier, submitDossier } from '@/features/dossiers/api'
import { buildDynamicQuestionnaire } from '@/features/questionnaire/adapter'
import { answerLabel } from '@/features/questionnaire/answer-label'
import { useAsync } from '@/lib/useAsync'
import type { ApiError } from '@/lib/api-client'

export default function RecapitulatifRoute() {
  const [searchParams] = useSearchParams()
  const dossierId = searchParams.get('dossierId')
  if (!dossierId) {
    return <Navigate to="/dashboard" replace />
  }
  return <FinalReview dossierId={dossierId} />
}

const questionPath = (dossierId: string, fieldId: string) =>
  `/dashboard/dossiers/nouveau/questionnaire?dossierId=${encodeURIComponent(dossierId)}&question=${encodeURIComponent(fieldId)}`

// Final recap (E03.10): every answer, what is still required, then the submission — which the API
// verifies again.
function FinalReview({ dossierId }: { dossierId: string }) {
  const navigate = useNavigate()
  const headingRef = useRef<HTMLHeadingElement>(null)
  const dossierQuery = useAsync(() => getDossier(dossierId), [dossierId])
  const answersQuery = useAsync(() => listAnswers(dossierId), [dossierId])
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  useEffect(() => {
    headingRef.current?.focus()
  }, [dossierQuery.isLoading])

  const snapshot = dossierQuery.data?.questionnaireVersion
  const questionnaire = useMemo(() => (snapshot ? buildDynamicQuestionnaire(snapshot) : null), [snapshot])
  const answers = useMemo(
    () => Object.fromEntries((answersQuery.data ?? []).map((a) => [a.fieldId, a.value])),
    [answersQuery.data],
  )

  if (dossierQuery.isLoading || answersQuery.isLoading) {
    return <p className="pt-8 text-sm text-muted-foreground">Chargement…</p>
  }
  const dossier = dossierQuery.data
  if (dossierQuery.error || answersQuery.error || !dossier || !questionnaire) {
    return <p className="pt-8 text-sm text-destructive">Impossible de charger le dossier.</p>
  }

  const missing = missingRequiredAnswers(questionnaire.flat, answers)
  const submitted = dossier.submittedAt !== null

  async function handleSubmit() {
    setSubmitting(true)
    setSubmitError(null)
    try {
      const done = await submitDossier(dossierId)
      navigate(`/dashboard/dossiers/view/${done.slug}`)
    } catch (err) {
      // 422: answers changed elsewhere (another tab, an AI client); the refreshed list shows what is missing.
      setSubmitError((err as ApiError)?.message ?? 'La soumission a échoué. Réessayez.')
      answersQuery.refetch()
      setSubmitting(false)
    }
  }

  return (
    <>
      <title>Récapitulatif · Confluent</title>
      <section className="mx-auto flex max-w-2xl flex-col gap-8 pt-8">
        <header className="flex flex-col gap-2">
          <h1
            ref={headingRef}
            tabIndex={-1}
            className="font-heading text-2xl font-semibold text-foreground focus-visible:outline-none"
          >
            {submitted ? 'Dossier soumis' : 'Vérifiez votre dossier'}
          </h1>
          <p className="text-sm text-muted-foreground">
            {submitted
              ? `${dossier.name} a été soumis le ${new Date(dossier.submittedAt!).toLocaleDateString('fr-FR')}. Vous pouvez encore corriger vos réponses ; une réponse obligatoire ne peut plus être effacée.`
              : `Relisez les réponses de ${dossier.name} avant de le soumettre. Vous pourrez encore les corriger ensuite.`}
          </p>
        </header>

        {!submitted && missing.length > 0 && (
          <div role="status" className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm">
            <p className="font-medium text-foreground">
              {missing.length === 1
                ? 'Une question obligatoire reste sans réponse :'
                : `${missing.length} questions obligatoires restent sans réponse :`}
            </p>
            <ul className="mt-2 flex flex-col gap-1">
              {missing.map((q) => (
                <li key={q.id}>
                  <Link to={questionPath(dossierId, q.id)} className="text-foreground underline underline-offset-4">
                    {q.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}

        {questionnaire.sections.map((section, i) => (
          <section key={section.id}>
            <h2 className="font-heading text-lg font-semibold text-foreground">
              {i + 1}. {section.title}
            </h2>
            <dl className="mt-3 flex flex-col divide-y divide-border">
              {section.questions.map((q) => {
                const value = answers[q.id] ?? ''
                return (
                  <div key={q.id} className="flex flex-wrap items-start justify-between gap-4 py-3">
                    <div className="min-w-0 flex-1">
                      <dt className="text-[11px] uppercase tracking-wider text-muted-foreground">{q.label}</dt>
                      <dd className="mt-1 whitespace-pre-line break-words text-[13px] font-medium text-foreground">
                        {value.trim() ? (
                          answerLabel(q, value)
                        ) : (
                          <span className="text-muted-foreground">
                            {q.required && q.fieldType !== 'file' ? 'Réponse obligatoire manquante' : '—'}
                          </span>
                        )}
                      </dd>
                    </div>
                    {q.fieldType !== 'file' && (
                      <Link
                        to={questionPath(dossierId, q.id)}
                        aria-label={`Modifier la réponse : ${q.label}`}
                        className="min-h-11 shrink-0 px-2 text-xs text-muted-foreground hover:underline"
                      >
                        Modifier
                      </Link>
                    )}
                  </div>
                )
              })}
            </dl>
          </section>
        ))}

        <div className="flex flex-col gap-2 border-t border-border pt-6">
          {submitError && (
            <p className="text-sm text-destructive" role="alert">
              {submitError}
            </p>
          )}
          {submitted ? (
            <Button
              type="button"
              size="lg"
              className="h-11 self-start px-4"
              onClick={() => navigate(`/dashboard/dossiers/view/${dossier.slug}`)}
            >
              Voir mon dossier
            </Button>
          ) : (
            <Button
              type="button"
              size="lg"
              className="h-11 self-start px-4"
              onClick={() => void handleSubmit()}
              disabled={submitting || missing.length > 0}
            >
              {submitting ? 'Soumission…' : 'Soumettre le dossier'}
            </Button>
          )}
        </div>
      </section>
    </>
  )
}
