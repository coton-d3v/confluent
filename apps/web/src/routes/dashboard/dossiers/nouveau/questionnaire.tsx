import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, useBlocker, useNavigate, useSearchParams } from 'react-router-dom'
import { QuestionnaireProgress } from '@/features/questionnaire/components/QuestionnaireProgress'
import { QuestionnaireStep } from '@/features/questionnaire/components/QuestionnaireStep'
import { SectionSummary } from '@/features/questionnaire/components/SectionSummary'
import { buildDynamicQuestionnaire, type DynamicQuestionnaire } from '@/features/questionnaire/adapter'
import { listAnswers } from '@/features/dossiers/answers.api'
import { getDossier } from '@/features/dossiers/api'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { useAsync } from '@/lib/useAsync'
import { isAnswered } from '@confluent/shared'
import { SaveStatusIndicator } from '@/features/questionnaire/components/SaveStatusIndicator'
import { useAnswerAutosave } from '@/features/questionnaire/useAnswerAutosave'

const recapPath = (dossierId: string) =>
  `/dashboard/dossiers/nouveau/recapitulatif?dossierId=${encodeURIComponent(dossierId)}`

export default function QuestionnaireRoute() {
  const [searchParams] = useSearchParams()
  const dossierId = searchParams.get('dossierId')
  // `question`: open this field directly, then go back to the final recap (edit from the recap).
  const questionId = searchParams.get('question')

  if (!dossierId) {
    return <Navigate to="/dashboard/dossiers/nouveau" replace />
  }

  return <QuestionnaireLoader key={questionId ?? ''} dossierId={dossierId} questionId={questionId} />
}

// Where to resume (E03.10): just after the furthest answered question; past the end → recap.
function resumePosition(questionnaire: DynamicQuestionnaire, answers: Record<string, string>): number {
  let furthest = 0
  questionnaire.flat.forEach((q, i) => {
    if (isAnswered(answers[q.id])) furthest = i + 1
  })
  return furthest + 1
}

function QuestionnaireLoader({ dossierId, questionId }: { dossierId: string; questionId: string | null }) {
  // The dossier's own questionnaire version (snapshot taken at creation), never the currently
  // active one: after a new version is published, resuming an older dossier must show — and save
  // into — the fields it was created with.
  const dossierQuery = useAsync(() => getDossier(dossierId), [dossierId])
  const answersQuery = useAsync(() => listAnswers(dossierId), [dossierId])

  if (dossierQuery.isLoading || answersQuery.isLoading) {
    return <p className="pt-8 text-sm text-muted-foreground">Chargement du questionnaire…</p>
  }
  const snapshot = dossierQuery.data?.questionnaireVersion
  if (dossierQuery.error || answersQuery.error || !snapshot) {
    return (
      <p className="pt-8 text-sm text-destructive">
        Impossible de charger le questionnaire. Réessayez plus tard.
      </p>
    )
  }
  const initialAnswers: Record<string, string> = {}
  for (const row of answersQuery.data ?? []) {
    initialAnswers[row.fieldId] = row.value
  }
  const dynamic = buildDynamicQuestionnaire(snapshot)
  if (dynamic.totalQuestions === 0) {
    return (
      <p className="pt-8 text-sm text-destructive">
        Aucune question disponible. Contactez un administrateur.
      </p>
    )
  }
  const target = questionId ? dynamic.flat.findIndex((q) => q.id === questionId) + 1 : 0
  const initialPosition = target > 0 ? target : resumePosition(dynamic, initialAnswers)
  if (initialPosition > dynamic.totalQuestions) return <Navigate to={recapPath(dossierId)} replace />
  return (
    <QuestionnaireWizard
      dossierId={dossierId}
      questionnaire={dynamic}
      initialAnswers={initialAnswers}
      initialPosition={initialPosition}
      backToRecap={target > 0}
    />
  )
}

interface WizardState {
  answers: Record<string, string>
  position: number
  view: 'question' | 'summary'
}

function QuestionnaireWizard({
  dossierId,
  questionnaire,
  initialAnswers,
  initialPosition,
  backToRecap,
}: {
  dossierId: string
  questionnaire: DynamicQuestionnaire
  initialAnswers: Record<string, string>
  initialPosition: number
  // Opened from the final recap for one question: return there once it is answered.
  backToRecap: boolean
}) {
  const navigate = useNavigate()
  const { sections, flat, totalQuestions } = questionnaire
  const totalSections = sections.length

  const [state, setState] = useState<WizardState>({
    answers: initialAnswers,
    position: initialPosition,
    view: 'question',
  })
  const [direction, setDirection] = useState<'forward' | 'backward'>('forward')
  const [editingFromSummary, setEditingFromSummary] = useState(false)
  const editingRef = useRef(editingFromSummary)
  useEffect(() => {
    editingRef.current = editingFromSummary
  }, [editingFromSummary])
  const { answers, position, view } = state

  const autosave = useAnswerAutosave(dossierId, initialAnswers)
  // A transition (advance after saving) is in progress: the step is read-only until it ends, so
  // nothing typed meanwhile can be overwritten by the answers captured before the save (R22).
  const [transitioning, setTransitioning] = useState(false)
  const [retrying, setRetrying] = useState(false)

  async function retrySave() {
    setRetrying(true)
    await autosave.flush(autosave.latest())
    setRetrying(false)
  }

  // Leaving the questionnaire inside the app while something is unsaved (R23): it is sent first;
  // if that fails, the person chooses to stay, retry or leave without saving.
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      currentLocation.pathname !== nextLocation.pathname && autosave.isDirty(),
  )
  const [leaveFailed, setLeaveFailed] = useState(false)
  const blockerRef = useRef(blocker)
  useEffect(() => {
    blockerRef.current = blocker
  })
  // Sends what is unsaved, including what was typed while a send was in progress; true once the
  // latest answers are in the database.
  const { flush, latest, isDirty } = autosave
  const saveEverything = useCallback(async () => {
    let ok = await flush(latest())
    while (ok && isDirty()) ok = await flush(latest())
    return ok
  }, [flush, latest, isDirty])
  // One attempt per blocked navigation (code review R23): after a failure, nothing is sent again
  // until the person chooses « Réessayer » in the dialog.
  const blockedKey = blocker.state === 'blocked' ? blocker.location.key : null
  useEffect(() => {
    if (blockedKey === null) return
    let cancelled = false
    void saveEverything().then((ok) => {
      if (cancelled) return
      if (ok) blockerRef.current.proceed?.()
      else setLeaveFailed(true)
    })
    return () => {
      cancelled = true
    }
  }, [blockedKey, saveEverything])

  useEffect(() => {
    function onDocumentKeyDown(e: KeyboardEvent) {
      if (e.key !== 'ArrowUp') return
      if (e.isComposing) return
      if (e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return
      if (editingRef.current) return
      const target = e.target as HTMLElement | null
      if (
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.tagName === 'SELECT' ||
        target?.isContentEditable
      ) {
        return
      }
      e.preventDefault()
      setState((prev) => {
        if (prev.view === 'summary') return prev
        if (prev.position <= 1) return prev
        setDirection('backward')
        return { ...prev, position: prev.position - 1 }
      })
    }
    window.addEventListener('keydown', onDocumentKeyDown)
    return () => window.removeEventListener('keydown', onDocumentKeyDown)
  }, [])

  const currentQuestion = flat[position - 1]
  const currentSection = useMemo(
    () => sections.find((s) => s.id === currentQuestion.sectionId)!,
    [sections, currentQuestion.sectionId],
  )
  const sectionMetas = useMemo(
    () => flat.filter((q) => q.sectionId === currentQuestion.sectionId),
    [flat, currentQuestion.sectionId],
  )
  const lastGlobalIndexOfCurrentSection = sectionMetas[sectionMetas.length - 1].globalIndex

  const indicatorText =
    view === 'summary'
      ? `Récapitulatif · Section ${currentQuestion.sectionIndex} · ${currentSection.title}`
      : `Section ${currentQuestion.sectionIndex} · Question ${currentQuestion.positionInSection} sur ${currentSection.questions.length}`

  async function handleAdvance(cleaned: string) {
    if (transitioning) return
    setTransitioning(true)
    const id = currentQuestion.id
    const nextAnswers = { ...autosave.latest(), [id]: cleaned }
    setState((prev) => ({ ...prev, answers: { ...prev.answers, [id]: cleaned } }))
    const saved = await autosave.flush(nextAnswers)
    setTransitioning(false)
    // Never move on — let alone reach the completion screen — with an answer that was not saved.
    if (!saved) return

    if (backToRecap) {
      navigate(recapPath(dossierId))
      return
    }
    setDirection('forward')
    if (editingFromSummary) {
      setEditingFromSummary(false)
      setState((prev) => ({ ...prev, position: lastGlobalIndexOfCurrentSection, view: 'summary' }))
      return
    }
    if (position >= totalQuestions) {
      navigate(recapPath(dossierId))
      return
    }
    const isSectionBoundary =
      currentQuestion.positionInSection === currentSection.questions.length &&
      currentQuestion.sectionIndex < totalSections
    setState((prev) =>
      isSectionBoundary ? { ...prev, view: 'summary' } : { ...prev, position: prev.position + 1 },
    )
  }

  function handleBack() {
    if (editingFromSummary) return
    if (position > 1) {
      setDirection('backward')
      setState((prev) => ({ ...prev, position: prev.position - 1 }))
    }
  }

  function handleAnswerChange(next: string) {
    if (transitioning) return
    const id = currentQuestion.id
    autosave.schedule({ ...autosave.latest(), [id]: next })
    setState((prev) => ({ ...prev, answers: { ...prev.answers, [id]: next } }))
  }

  function handleEditFromSummary(targetGlobalIndex: number) {
    setEditingFromSummary(true)
    setDirection('backward')
    setState((prev) => ({ ...prev, position: targetGlobalIndex, view: 'question' }))
  }

  function handleReturnToSummary() {
    setEditingFromSummary(false)
    setDirection('forward')
    setState((prev) => ({ ...prev, position: lastGlobalIndexOfCurrentSection, view: 'summary' }))
  }

  function handleValidateSection() {
    setDirection('forward')
    setState((prev) => ({ ...prev, position: prev.position + 1, view: 'question' }))
  }

  return (
    <>
      <title>Questionnaire · Confluent</title>
      <div className="-mx-6 -mt-8">
        <QuestionnaireProgress position={position} total={totalQuestions} />
      </div>
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {indicatorText}
      </div>
      <SaveStatusIndicator status={autosave.status} />
      {autosave.status === 'failed' && (
        <div
          role="alert"
          className="mt-6 flex flex-col gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive sm:flex-row sm:items-center sm:justify-between"
        >
          <span>Vos dernières réponses n’ont pas pu être enregistrées. Vérifiez votre connexion.</span>
          <Button size="sm" variant="outline" onClick={() => void retrySave()} disabled={retrying}>
            {retrying ? 'Enregistrement…' : 'Réessayer'}
          </Button>
        </div>
      )}
      <div
        key={`${view}-${position}`}
        className={
          direction === 'forward'
            ? 'motion-safe:animate-slide-up-in'
            : 'motion-safe:animate-slide-down-in'
        }
      >
        {view === 'summary' ? (
          <SectionSummary
            section={currentSection}
            sectionIndex={currentQuestion.sectionIndex}
            sectionMetas={sectionMetas}
            answers={answers}
            onEdit={handleEditFromSummary}
            onValidate={handleValidateSection}
          />
        ) : (
          <QuestionnaireStep
            question={currentQuestion}
            indicatorText={indicatorText}
            value={answers[currentQuestion.id] ?? ''}
            onChange={handleAnswerChange}
            onAdvance={handleAdvance}
            onBack={handleBack}
            busy={transitioning}
            canGoBack={!editingFromSummary && position > 1}
            returnToSummary={
              editingFromSummary
                ? { onReturn: handleReturnToSummary }
                : backToRecap
                  ? { onReturn: () => navigate(recapPath(dossierId)) }
                  : undefined
            }
          />
        )}
      </div>
      <LeaveWithoutSavingDialog
        open={leaveFailed}
        onStay={() => {
          setLeaveFailed(false)
          if (blocker.state === 'blocked') blocker.reset()
        }}
        onLeave={() => {
          setLeaveFailed(false)
          if (blocker.state === 'blocked') blocker.proceed()
        }}
        onRetry={async () => {
          if (!(await saveEverything())) return
          setLeaveFailed(false)
          blockerRef.current.proceed?.()
        }}
      />
    </>
  )
}

// Shown when leaving the questionnaire while the last answers could not be sent (R23).
function LeaveWithoutSavingDialog({
  open,
  onStay,
  onLeave,
  onRetry,
}: {
  open: boolean
  onStay: () => void
  onLeave: () => void
  onRetry: () => Promise<void>
}) {
  return (
    <AlertDialog open={open} onOpenChange={(next) => !next && onStay()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Vos dernières réponses ne sont pas enregistrées</AlertDialogTitle>
          <AlertDialogDescription>
            L’enregistrement a échoué. Réessayez avant de quitter, ou quittez en perdant ces réponses.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onStay}>Rester</AlertDialogCancel>
          <Button type="button" variant="outline" onClick={onLeave}>
            Quitter sans enregistrer
          </Button>
          <Button type="button" onClick={() => void onRetry()}>
            Réessayer
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
