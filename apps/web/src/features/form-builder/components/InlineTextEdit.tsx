import { useState, type FormEvent, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

// A title with a « Renommer » action that turns it into an input.
export function InlineTextEdit({
  value,
  label,
  disabled,
  onSave,
  children,
}: {
  value: string
  // Accessible name of the input and of the rename button, e.g. « titre de la section ».
  label: string
  disabled?: boolean
  onSave: (next: string) => Promise<boolean>
  children: ReactNode
}) {
  const [draft, setDraft] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const next = draft?.trim() ?? ''
    if (!next || next === value) {
      setDraft(null)
      return
    }
    if (await onSave(next)) setDraft(null)
  }

  if (draft === null) {
    return (
      <div className="flex min-w-0 items-center gap-2">
        {children}
        {!disabled && (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => setDraft(value)}
            aria-label={`Renommer : ${label}`}
          >
            Renommer
          </Button>
        )}
      </div>
    )
  }
  return (
    <form onSubmit={handleSubmit} className="flex min-w-0 flex-1 items-center gap-2">
      <Input
        autoFocus
        aria-label={label}
        maxLength={200}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && setDraft(null)}
      />
      <Button type="submit" size="sm">
        Enregistrer
      </Button>
      <Button type="button" size="sm" variant="outline" onClick={() => setDraft(null)}>
        Annuler
      </Button>
    </form>
  )
}
