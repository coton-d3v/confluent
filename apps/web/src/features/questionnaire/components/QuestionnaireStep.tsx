import { useState, type FormEvent, type KeyboardEvent } from 'react'
import {
  ANSWER_MAX_LENGTH,
  describeConstraints,
  readConstraints,
  validateAnswerValue,
  type Choice,
} from '@confluent/shared'
import { WizardInput, WizardTextarea } from '@/components/confluent/WizardInput'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { stripNonPrintable } from '@/lib/sanitize'
import type { QuestionMeta } from '@/data/questionnaire'

export interface QuestionnaireStepProps {
  question: QuestionMeta
  indicatorText: string
  value: string
  onChange: (next: string) => void
  onAdvance: (cleaned: string) => void
  onBack: () => void
  canGoBack: boolean
  returnToSummary?: { onReturn: () => void }
}

const CHECKBOX_CHOICES: Choice[] = [
  { key: 'true', label: 'Oui' },
  { key: 'false', label: 'Non' },
]

// Typed text inputs (E03.04): the right keyboard on mobile and the browser's own date picker.
const INPUT_PROPS: Partial<Record<QuestionMeta['fieldType'], Partial<Record<string, string>>>> = {
  email: { type: 'email', inputMode: 'email', autoComplete: 'email' },
  number: { type: 'text', inputMode: 'decimal' },
  date: { type: 'date' },
}

// Buttons for a list, Oui/Non for a checkbox, nothing for free input.
function choicesOf(question: QuestionMeta): readonly Choice[] {
  if (question.fieldType === 'checkbox') return CHECKBOX_CHOICES
  return question.choices ?? []
}

export function QuestionnaireStep({
  question,
  indicatorText,
  value,
  onChange,
  onAdvance,
  onBack,
  canGoBack,
  returnToSummary,
}: QuestionnaireStepProps) {
  const [error, setError] = useState<string | null>(null)
  const choices = choicesOf(question)
  const multiline = question.fieldType === 'textarea'
  const cleaned = stripNonPrintable(value, { multiline }).trim()
  const limits = describeConstraints(question)
  const headingId = 'questionnaire-current-question'
  const errorId = 'questionnaire-answer-error'
  const hintId = 'questionnaire-answer-hint'

  // The same rules as the API (shared package): an answer the API would refuse never leaves here.
  function submit(answer: string) {
    if (answer === '' && question.required) {
      setError('Cette question est obligatoire.')
      return
    }
    const problem = validateAnswerValue(
      { fieldType: question.fieldType, choices: question.choices ?? [], constraints: question.constraints },
      answer,
    )
    if (problem) {
      setError(problem)
      return
    }
    onAdvance(answer)
  }

  function handleChange(next: string) {
    setError(null)
    onChange(next)
  }

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    submit(cleaned)
  }

  function handleChoice(key: string) {
    handleChange(key)
    submit(key)
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) {
    if (e.nativeEvent.isComposing) {
      if (e.key === 'Enter') e.preventDefault()
      return
    }
    // Long text: Enter adds a line, Ctrl/Cmd + Enter validates.
    if (multiline && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      submit(cleaned)
      return
    }
    const plainArrowUp = e.key === 'ArrowUp' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey
    // In a textarea or a date input, ↑ moves the caret or changes the date.
    if (plainArrowUp && canGoBack && !multiline && question.fieldType !== 'date') {
      e.preventDefault()
      onBack()
    }
  }

  const describedBy = [limits ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined
  const maxLength = readConstraints(question.fieldType, question.constraints).maxLength ?? ANSWER_MAX_LENGTH

  return (
    <form onSubmit={handleSubmit} noValidate className="mx-auto flex max-w-xl flex-col gap-6 pt-8">
      <div className="text-xs text-muted-foreground">{indicatorText}</div>

      <h1
        id={headingId}
        className="font-heading text-[22px] font-bold leading-tight text-foreground md:text-[28px]"
      >
        {question.label}
        {!question.required && (
          <span className="ml-2 align-middle text-sm font-normal text-muted-foreground">(facultatif)</span>
        )}
      </h1>

      {question.hint && <p className="text-sm text-muted-foreground">{question.hint}</p>}

      {question.fieldType === 'file' ? (
        <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          Ce document se dépose depuis l’onglet « Documents » de votre dossier.
        </p>
      ) : choices.length > 0 ? (
        <div role="radiogroup" aria-labelledby={headingId} aria-describedby={describedBy} className="flex flex-col gap-2">
          {choices.map((choice) => (
            <button
              key={choice.key}
              type="button"
              role="radio"
              aria-checked={value === choice.key}
              onClick={() => handleChoice(choice.key)}
              className={cn(
                'rounded-lg border px-4 py-3 text-left text-sm transition-colors',
                'hover:border-foreground/40 hover:bg-muted/50',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]',
                value === choice.key
                  ? 'border-foreground bg-foreground text-background'
                  : 'border-border bg-card text-foreground',
              )}
            >
              {choice.label}
            </button>
          ))}
        </div>
      ) : multiline ? (
        <WizardTextarea
          key={question.id}
          autoFocus
          value={value}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={handleKeyDown}
          aria-labelledby={headingId}
          aria-describedby={describedBy}
          aria-invalid={error ? 'true' : undefined}
          maxLength={maxLength}
        />
      ) : (
        <WizardInput
          key={question.id}
          autoFocus
          value={value}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={handleKeyDown}
          aria-labelledby={headingId}
          aria-describedby={describedBy}
          aria-invalid={error ? 'true' : undefined}
          maxLength={maxLength}
          {...INPUT_PROPS[question.fieldType]}
        />
      )}

      {limits && (
        <p id={hintId} className="-mt-3 text-xs text-muted-foreground">
          {limits}
        </p>
      )}
      <div aria-live="assertive" className="-mt-3 min-h-[1em]">
        {error && (
          <p id={errorId} className="text-sm text-destructive">
            {error}
          </p>
        )}
      </div>

      {returnToSummary && (
        <button
          type="button"
          onClick={returnToSummary.onReturn}
          className="self-start min-h-11 text-xs text-muted-foreground hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
        >
          <span aria-hidden="true">←</span> Retour au récapitulatif
        </button>
      )}

      <div className="flex flex-wrap items-center gap-3">
        {choices.length === 0 && question.fieldType !== 'file' && (
          <>
            <Button
              type="submit"
              size="lg"
              className="h-11 px-4"
              disabled={question.required && cleaned.length === 0}
            >
              OK <span aria-hidden="true">→</span>
            </Button>
            <span className="text-xs text-muted-foreground" aria-hidden="true">
              {multiline ? 'ou Ctrl + Entrée' : 'ou Entrée ↵'}
            </span>
          </>
        )}
        {(question.fieldType === 'file' || (!question.required && cleaned.length === 0)) && (
          <Button type="button" variant="outline" size="lg" className="h-11 px-4" onClick={() => onAdvance('')}>
            {question.fieldType === 'file' ? 'Continuer' : 'Passer'} <span aria-hidden="true">→</span>
          </Button>
        )}
      </div>

      <div className="pt-2">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="h-11 w-11 md:h-7 md:w-7"
          onClick={onBack}
          disabled={!canGoBack}
          aria-label="Question précédente"
        >
          ‹
        </Button>
      </div>
    </form>
  )
}
