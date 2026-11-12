import { useState } from 'react'
import { CheckIcon, CopyIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'

// The browser's former way, for a page without the Clipboard API (served over http, older
// browsers, permission refused): copies through a hidden field.
function copyThroughSelection(text: string): boolean {
  const field = document.createElement('textarea')
  field.value = text
  field.setAttribute('readonly', '')
  field.style.position = 'fixed'
  field.style.opacity = '0'
  document.body.appendChild(field)
  const focused = document.activeElement as HTMLElement | null
  field.select()
  let copied = false
  try {
    copied = document.execCommand('copy')
  } catch {
    copied = false
  }
  field.remove()
  focused?.focus()
  return copied
}

// Copies `text` to the clipboard; the icon confirms for two seconds, and screen readers hear it
// (E10.07: a live region next to the button, the button's own content is not announced).
export function CopyButton({
  text,
  label,
  children,
}: {
  text: string
  // Accessible name, also the tooltip of an icon-only button.
  label: string
  children?: React.ReactNode
}) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    let done = false
    try {
      await navigator.clipboard.writeText(text)
      done = true
    } catch {
      done = copyThroughSelection(text)
    }
    if (!done) {
      toast.error('Copie impossible : sélectionnez le texte à la main.')
      return
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  const Icon = copied ? CheckIcon : CopyIcon
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="shrink-0"
        onClick={() => void copy()}
        aria-label={children ? undefined : label}
        title={label}
      >
        <Icon className="size-4" aria-hidden="true" />
        {children}
      </Button>
      <span aria-live="polite" className="sr-only">
        {copied ? 'Copié dans le presse-papiers.' : ''}
      </span>
    </>
  )
}
