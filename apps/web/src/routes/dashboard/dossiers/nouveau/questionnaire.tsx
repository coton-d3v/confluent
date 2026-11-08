import { useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { QuestionnaireProgress } from '@/features/questionnaire/components/QuestionnaireProgress'
import { QuestionnaireStep } from '@/features/questionnaire/components/QuestionnaireStep'
import { SectionSummary } from '@/features/questionnaire/components/SectionSummary'
import { buildDynamicQuestionnaire, type DynamicQuestionnaire } from '@/features/questionnaire/adapter'
import { listAnswers, upsertAnswers } from '@/features/dossiers/answers.api'
import { getDossier } from '@/features/dossiers/api'
import { Button } from '@/components/ui/button'
import { useAsync } from '@/lib/useAsync'
import type { AnswerInput } from '@confluent/shared'

const AUTOSAVE_DEBOUNCE_MS = 800

export default function QuestionnaireRoute() {
  const [searchParams] = useSearchParams()
  const dossierId = searchParams.get('dossierId')

  if (!dossierId) {
    return <Navigate to="/dashboard/dossiers/nouveau" replace />
  }

  return <QuestionnaireLoader dossierId={dossierId} />
}

function QuestionnaireLoader({ dossierId }: { dossierId: string }) {
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
  return (
    <QuestionnaireWizard
      dossierId={dossierId}
      questionnaire={dynamic}
      initialAnswers={initialAnswers}
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
}: {
  dossierId: string
  questionnaire: DynamicQuestionnaire
  initialAnswers: Record<string, string>
}) {
  const navigate = useNavigate()
  const { sections, flat, totalQuestions } = questionnaire
  const totalSections = sections.length

  const [state, setState] = useState<WizardState>({
    answers: initialAnswers,
    position: 1,
    view: 'question',
  })
  const [direction, setDirection] = useState<'forward' | 'backward'>('forward')
  const [editingFromSummary, setEditingFromSummary] = useState(false)
  const editingRef = useRef(editingFromSummary)
  useEffect(() => {
    editingRef.current = editingFromSummary
  }, [editingFromSummary])
  const { answers, position, view } = state

  const lastSavedRef = useRef<Record<string, string>>(initialAnswers)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Saves run one after the other: overlapping requests could otherwise land out of order and leave
  // an older value in the database.
  const saveChainRef = useRef<Promise<boolean>>(Promise.resolve(true))
  const advancingRef = useRef(false)
  const [saveFailed, setSaveFailed] = useState(false)
  const [retrying, setRetrying] = useState(false)

  function diffAgainstSaved(current: Record<string, string>): AnswerInput[] {
    const diff: AnswerInput[] = []
    for (const [fieldId, value] of Object.entries(current)) {
      const saved = lastSavedRef.current[fieldId]
      // A skipped optional question that was never answered has nothing to save.
      if (saved !== value && !(saved === undefined && value === '')) {
        diff.push({ fieldId, value })
      }
    }
    return diff
  }

  // Resolves true once `current` is persisted, false if the request failed (the diff stays pending
  // and is sent again by the next save or by "Réessayer").
  function flushSave(current: Record<string, string>): Promise<boolean> {
    const run = async (): Promise<boolean> => {
      const diff = diffAgainstSaved(current)
      if (diff.length === 0) return true
      try {
        await upsertAnswers(dossierId, diff)
        lastSavedRef.current = {
          ...lastSavedRef.current,
          ...Object.fromEntries(diff.map((a) => [a.fieldId, a.value])),
        }
        setSaveFailed(false)
        return true
      } catch {
        setSaveFailed(true)
        return false
      }
    }
    saveChainRef.current = saveChainRef.current.then(run, run)
    return saveChainRef.current
  }

  function scheduleSave(current: Record<string, string>) {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      void flushSave(current)
    }, AUTOSAVE_DEBOUNCE_MS)
  }

  async function retrySave() {
    setRetrying(true)
    await flushSave(answers)
    setRetrying(false)
  }

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    }
  }, [])

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
    // Ignore a second click while the previous one is still saving.
    if (advancingRef.current) return
    advancingRef.current = true
    const nextAnswers = { ...answers, [currentQuestion.id]: cleaned }
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    setState((prev) => ({ ...prev, answers: nextAnswers }))
    const saved = await flushSave(nextAnswers)
    advancingRef.current = false
    // Never move on — let alone reach the completion screen — with an answer that was not saved.
    if (!saved) return

    if (editingFromSummary) {
      setEditingFromSummary(false)
      setDirection('forward')
      setState({
        answers: nextAnswers,
        position: lastGlobalIndexOfCurrentSection,
        view: 'summary',
      })
      return
    }

    if (position >= totalQuestions) {
      setState({ answers: nextAnswers, position, view: 'question' })
      navigate(
        `/dashboard/dossiers/nouveau/recapitulatif?dossierId=${encodeURIComponent(dossierId)}`,
      )
      return
    }

    const isSectionBoundary =
      currentQuestion.positionInSection === currentSection.questions.length &&
      currentQuestion.sectionIndex < totalSections
    if (isSectionBoundary) {
      setDirection('forward')
      setState({ ...state, answers: nextAnswers, view: 'summary' })
      return
    }

    setDirection('forward')
    setState({ ...state, answers: nextAnswers, position: position + 1 })
  }

  function handleBack() {
    if (editingFromSummary) return
    if (position > 1) {
      setDirection('backward')
      setState({ ...state, position: position - 1 })
    }
  }

  function handleAnswerChange(next: string) {
    const nextAnswers = { ...answers, [currentQuestion.id]: next }
    setState({ ...state, answers: nextAnswers })
    scheduleSave(nextAnswers)
  }

  function handleEditFromSummary(targetGlobalIndex: number) {
    setEditingFromSummary(true)
    setDirection('backward')
    setState({ ...state, position: targetGlobalIndex, view: 'question' })
  }

  function handleReturnToSummary() {
    setEditingFromSummary(false)
    setDirection('forward')
    setState({
      ...state,
      position: lastGlobalIndexOfCurrentSection,
      view: 'summary',
    })
  }

  function handleValidateSection() {
    setDirection('forward')
    setState({
      ...state,
      position: position + 1,
      view: 'question',
    })
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
      {saveFailed && (
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
            canGoBack={!editingFromSummary && position > 1}
            returnToSummary={
              editingFromSummary
                ? { onReturn: handleReturnToSummary }
                : undefined
            }
          />
        )}
      </div>
    </>
  )
}
