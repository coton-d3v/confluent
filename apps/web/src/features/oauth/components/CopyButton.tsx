import { useState } from 'react'
import { CheckIcon, CopyIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'

// Copies `text` to the clipboard; the icon confirms for two seconds.
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
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('Copie impossible : sélectionnez le texte à la main.')
    }
  }
  const Icon = copied ? CheckIcon : CopyIcon
  return (
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
      {copied && <span className="sr-only">Copié</span>}
    </Button>
  )
}
