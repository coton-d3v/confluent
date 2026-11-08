import type { FormEvent, KeyboardEvent } from 'react'
import { WizardInput } from '@/components/confluent/WizardInput'
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

const ANSWER_MAX_LENGTH = 2000

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
  const choices = question.choices ?? []
  const hasChoices = choices.length > 0
  const cleaned = stripNonPrintable(value).trim()
  const canAdvance = cleaned.length > 0
  const headingId = 'questionnaire-current-question'

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.nativeEvent.isComposing) {
      if (e.key === 'Enter') e.preventDefault()
      return
    }
    if (
      e.key === 'ArrowUp' &&
      canGoBack &&
      !e.shiftKey &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.altKey
    ) {
      e.preventDefault()
      onBack()
    }
  }

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!canAdvance) return
    onAdvance(cleaned)
  }

  function handleChoiceClick(key: string) {
    onChange(key)
    onAdvance(key)
  }

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      className="mx-auto flex max-w-xl flex-col gap-6 pt-8"
    >
      <div className="text-xs text-muted-foreground">{indicatorText}</div>

      <h1
        id={headingId}
        className="font-heading text-[22px] font-bold leading-tight text-foreground md:text-[28px]"
      >
        {question.label}
      </h1>

      {question.hint && (
        <p className="text-sm text-muted-foreground">{question.hint}</p>
      )}

      {hasChoices ? (
        <div className="flex flex-col gap-2">
          {choices.map((choice) => (
            <button
              key={choice.key}
              type="button"
              aria-pressed={value === choice.key}
              onClick={() => handleChoiceClick(choice.key)}
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
      ) : (
        <WizardInput
          key={question.id}
          autoFocus
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          aria-labelledby={headingId}
          maxLength={ANSWER_MAX_LENGTH}
        />
      )}

      {returnToSummary && (
        <button
          type="button"
          onClick={returnToSummary.onReturn}
          className="self-start min-h-11 text-xs text-muted-foreground hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
        >
          <span aria-hidden="true">←</span> Retour au récapitulatif
        </button>
      )}

      {!hasChoices && (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="submit"
            size="lg"
            className="h-11 px-4"
            disabled={!canAdvance}
          >
            OK <span aria-hidden="true">→</span>
          </Button>
          <span
            className="text-xs text-muted-foreground"
            aria-hidden="true"
          >
            ou Entrée ↵
          </span>
        </div>
      )}

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
