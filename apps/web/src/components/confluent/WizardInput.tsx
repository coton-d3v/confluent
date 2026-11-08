import type { ComponentPropsWithRef } from 'react'
import { cn } from '@/lib/utils'

const WIZARD_FIELD =
  'w-full border-0 border-b border-border bg-transparent py-2 text-lg outline-none transition-colors placeholder:text-muted-foreground focus:border-foreground focus-visible:border-foreground aria-[invalid=true]:border-destructive'

export type WizardInputProps = Omit<ComponentPropsWithRef<'input'>, 'className'> & {
  className?: string
}

export function WizardInput({ className, type = 'text', ...rest }: WizardInputProps) {
  return <input type={type} className={cn(WIZARD_FIELD, className)} {...rest} />
}

export type WizardTextareaProps = Omit<ComponentPropsWithRef<'textarea'>, 'className'> & {
  className?: string
}

export function WizardTextarea({ className, rows = 5, ...rest }: WizardTextareaProps) {
  return <textarea rows={rows} className={cn(WIZARD_FIELD, 'resize-y leading-relaxed', className)} {...rest} />
}
