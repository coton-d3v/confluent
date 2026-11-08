import { cn } from '@/lib/utils'

export interface DossierFieldProps {
  label: string
  value: string
  className?: string
}

export function DossierField({ label, value, className }: DossierFieldProps) {
  const hasValue = value.length > 0
  return (
    <div className={cn('flex flex-col', className)}>
      <dt className="text-[11px] uppercase tracking-wider text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1 whitespace-pre-line break-words text-[13px] font-medium leading-relaxed text-foreground">
        {hasValue ? value : <span className="text-muted-foreground">—</span>}
      </dd>
    </div>
  )
}
