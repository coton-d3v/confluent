import { useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import type { QuestionMeta, Section } from '@/data/questionnaire'
import { answerLabel } from '@/features/questionnaire/answer-label'

export interface SectionSummaryProps {
  section: Section
  sectionIndex: number
  sectionMetas: QuestionMeta[]
  answers: Record<string, string>
  onEdit: (globalIndex: number) => void
  onValidate: () => void
}

export function SectionSummary({
  section,
  sectionIndex,
  sectionMetas,
  answers,
  onEdit,
  onValidate,
}: SectionSummaryProps) {
  const headingRef = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    headingRef.current?.focus()
  }, [])

  return (
    <section className="mx-auto flex max-w-xl flex-col gap-8 pt-8">
      <h2
        ref={headingRef}
        tabIndex={-1}
        className="font-heading text-xl font-semibold text-foreground md:text-2xl focus-visible:outline-none"
      >
        Section {sectionIndex} — {section.title}
      </h2>
      <dl className="flex flex-col">
        {sectionMetas.map((q, i) => {
          const answer = answers[q.id] ?? ''
          return (
            <div
              key={q.id}
              className={
                'flex flex-wrap items-start justify-between gap-4 py-3 ' +
                (i < sectionMetas.length - 1 ? 'border-b border-border' : '')
              }
            >
              <div className="min-w-0 flex-1">
                <dt className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  {q.label}
                </dt>
                <dd className="mt-1 text-[13px] font-medium text-foreground">
                  {answer.length > 0 ? (
                    answerLabel(q, answer)
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </dd>
              </div>
              <button
                type="button"
                onClick={() => onEdit(q.globalIndex)}
                aria-label={`Modifier la réponse : ${q.label}`}
                className="min-h-11 min-w-11 shrink-0 px-2 text-xs text-muted-foreground hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
              >
                Modifier
              </button>
            </div>
          )
        })}
      </dl>
      <div className="pt-2">
        <Button
          type="button"
          size="lg"
          className="h-11 px-4"
          onClick={onValidate}
        >
          Valider cette section <span aria-hidden="true">→</span>
        </Button>
      </div>
    </section>
  )
}
