import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export interface DossierFieldProps {
  label: string
  value: string
  className?: string
  // Shown instead of the text value when given (e.g. the files of an attachment question).
  children?: ReactNode
  // Shown under the value, e.g. where an answer comes from (E04.05).
  details?: ReactNode
}

export function DossierField({ label, value, className, children, details }: DossierFieldProps) {
  const hasValue = value.length > 0
  return (
    <div className={cn('flex flex-col', className)}>
      <dt className="text-[11px] uppercase tracking-wider text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1 whitespace-pre-line break-words text-[13px] font-medium leading-relaxed text-foreground">
        {children ?? (hasValue ? value : <span className="text-muted-foreground">—</span>)}
      </dd>
      {details && <dd className="mt-2">{details}</dd>}
    </div>
  )
}
