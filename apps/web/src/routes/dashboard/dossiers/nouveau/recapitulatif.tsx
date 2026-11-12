import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { missingRequiredAnswers } from '@confluent/shared'
import { Button } from '@/components/ui/button'
import { getDossier, submitDossier } from '@/features/dossiers/api'
import { useDossierAnswers } from '@/features/dossiers/hooks'
import { filenamesByField, useDossierDocuments } from '@/features/documents/useDossierDocuments'
import { buildDynamicQuestionnaire } from '@/features/questionnaire/adapter'
import { answerLabel } from '@/features/questionnaire/answer-label'
import { AnswerOrigin } from '@/features/questionnaire/components/AnswerProvenance'
import { hasOriginToShow, isPendingProposal } from '@/features/questionnaire/provenance'
import { useAsync } from '@/lib/useAsync'
import type { ApiError } from '@/lib/api-client'
import { readFailure } from '@/lib/read-failure'
import { LoadError } from '@/components/confluent/LoadError'

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
// verifies again. AI proposals not confirmed yet are counted and marked, to confirm or correct
// (E04.05); they do not block the submission (D02).
function FinalReview({ dossierId }: { dossierId: string }) {
  const navigate = useNavigate()
  const headingRef = useRef<HTMLHeadingElement>(null)
  const dossierQuery = useAsync(() => getDossier(dossierId), [dossierId])
  const answersQuery = useDossierAnswers(dossierId)
  // Attachment questions are answered by their files (E03.11).
  const documentsQuery = useDossierDocuments(dossierId)
  const attachedFiles = useMemo(() => filenamesByField(documentsQuery.data), [documentsQuery.data])
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
  const rows = useMemo(
    () => new Map((answersQuery.data ?? []).map((a) => [a.fieldId, a])),
    [answersQuery.data],
  )

  if (dossierQuery.isLoading || answersQuery.isLoading || (documentsQuery.isLoading && !documentsQuery.data)) {
    return <p className="pt-8 text-sm text-muted-foreground">Chargement…</p>
  }
  const dossier = dossierQuery.data
  if (dossierQuery.error || answersQuery.error || documentsQuery.error || !dossier || !questionnaire) {
    return (
      <LoadError
        className="mt-8"
        message={readFailure(
          dossierQuery.error ?? answersQuery.error ?? documentsQuery.error,
          'Le dossier n’a pas pu être chargé.',
        )}
        onRetry={() => {
          dossierQuery.refetch()
          answersQuery.refetch()
          documentsQuery.refetch()
        }}
      />
    )
  }

  const missing = missingRequiredAnswers(questionnaire.flat, answers, new Set(attachedFiles.keys()))
  const toConfirm = questionnaire.flat.filter((q) => q.fieldType !== 'file' && isPendingProposal(rows.get(q.id)))
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
      documentsQuery.refetch()
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
                ? 'Une question obligatoire reste sans réponse ou sans document :'
                : `${missing.length} questions obligatoires restent sans réponse ou sans document :`}
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

        {toConfirm.length > 0 && (
          <div
            role="status"
            className="rounded-md border border-status-pending/50 bg-status-pending/10 px-4 py-3 text-sm"
          >
            <p className="font-medium text-foreground">
              {toConfirm.length === 1
                ? 'Une réponse proposée par un assistant IA reste à confirmer :'
                : `${toConfirm.length} réponses proposées par un assistant IA restent à confirmer :`}
            </p>
            <ul className="mt-2 flex flex-col gap-1">
              {toConfirm.map((q) => (
                <li key={q.id}>
                  <a href={`#reponse-${q.id}`} className="text-foreground underline underline-offset-4">
                    {q.label}
                  </a>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-muted-foreground">
              Confirmez-les ou corrigez-les ci-dessous. Elles comptent déjà comme des réponses.
            </p>
          </div>
        )}

        {questionnaire.sections.map((section, i) => (
          <section key={section.id}>
            <h2 className="font-heading text-lg font-semibold text-foreground">
              {i + 1}. {section.title}
            </h2>
            <dl className="mt-3 flex flex-col divide-y divide-border">
              {section.questions.map((q) => {
                const isFile = q.fieldType === 'file'
                const value = isFile ? (attachedFiles.get(q.id) ?? []).join('\n') : (answers[q.id] ?? '')
                return (
                  // E10.07: the term and its descriptions are children of the row itself (a <dl>
                  // allows a <div> grouping them, nothing deeper); the edit link is one of them.
                  <div
                    key={q.id}
                    id={`reponse-${q.id}`}
                    className="grid scroll-mt-20 grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 py-3"
                  >
                    <dt className="col-start-1 text-[11px] uppercase tracking-wider text-muted-foreground">{q.label}</dt>
                    <dd className="col-start-1 mt-1 whitespace-pre-line wrap-anywhere text-[13px] font-medium text-foreground">
                      {value.trim() ? (
                        isFile ? value : answerLabel(q, value)
                      ) : (
                        <span className="text-muted-foreground">
                          {!q.required
                            ? '—'
                            : isFile
                              ? 'Document obligatoire manquant'
                              : 'Réponse obligatoire manquante'}
                        </span>
                      )}
                    </dd>
                    {!isFile && hasOriginToShow(rows.get(q.id)) && (
                      <dd className="col-start-1 mt-2">
                        <AnswerOrigin
                          dossierId={dossierId}
                          label={q.label}
                          row={rows.get(q.id)}
                          onConfirmed={answersQuery.replace}
                          correctHref={questionPath(dossierId, q.id)}
                          formatValue={(v) => answerLabel(q, v)}
                        />
                      </dd>
                    )}
                    <dd className="col-start-2 row-start-1 row-end-3">
                      <Link
                        to={questionPath(dossierId, q.id)}
                        aria-label={`${isFile ? 'Modifier les fichiers' : 'Modifier la réponse'} : ${q.label}`}
                        className="inline-flex min-h-11 items-center px-2 text-xs text-muted-foreground hover:underline"
                      >
                        Modifier
                      </Link>
                    </dd>
                  </div>
                )
              })}
            </dl>
          </section>
        ))}

        <div className="flex flex-col gap-2 border-t border-border pt-6">
          {!submitted && toConfirm.length > 0 && (
            <p className="text-sm text-muted-foreground">
              Vous pouvez soumettre sans les confirmer : les propositions non confirmées seront
              transmises telles quelles.
            </p>
          )}
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
