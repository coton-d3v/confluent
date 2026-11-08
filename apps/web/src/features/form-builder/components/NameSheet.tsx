import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'

export interface NameRequest {
  title: string
  description: string
  submitLabel: string
  // Label of the text input, e.g. « Nom du formulaire ».
  fieldLabel: string
  initialName: string
  // Resolves to true when the name was accepted (the sheet then closes).
  onSubmit: (name: string) => Promise<boolean>
}

// Asks for one name (form, section); closed when `request` is null.
export function NameSheet({
  request,
  onClose,
}: {
  request: NameRequest | null
  onClose: () => void
}) {
  return (
    <Sheet open={request !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-[360px] duration-150 sm:max-w-[360px]">
        {request && <NameForm key={request.title} request={request} onClose={onClose} />}
      </SheetContent>
    </Sheet>
  )
}

function NameForm({ request, onClose }: { request: NameRequest; onClose: () => void }) {
  const [name, setName] = useState(request.initialName)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) {
      setError('Ce champ est obligatoire.')
      return
    }
    setSubmitting(true)
    const accepted = await request.onSubmit(trimmed)
    setSubmitting(false)
    if (accepted) onClose()
  }

  return (
    <>
      <SheetHeader>
        <SheetTitle>{request.title}</SheetTitle>
        <SheetDescription>{request.description}</SheetDescription>
      </SheetHeader>
      <Separator />
      <form onSubmit={handleSubmit} noValidate>
        <div className="flex flex-col gap-2 px-4 py-3">
          <Label htmlFor="form-name">{request.fieldLabel}</Label>
          <Input
            id="form-name"
            autoFocus
            maxLength={200}
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              setError(null)
            }}
            aria-invalid={error ? 'true' : undefined}
            aria-describedby={error ? 'form-name-error' : undefined}
          />
          <div aria-live="assertive" className="min-h-[1em]">
            {error && (
              <p id="form-name-error" className="text-xs text-destructive">
                {error}
              </p>
            )}
          </div>
        </div>
        <SheetFooter className="flex-col gap-2 p-4 sm:flex-row-reverse sm:justify-start">
          <Button type="submit" size="lg" disabled={submitting}>
            {submitting ? 'Enregistrement…' : request.submitLabel}
          </Button>
          <SheetClose render={<Button type="button" variant="outline" size="lg" />}>
            Annuler
          </SheetClose>
        </SheetFooter>
      </form>
    </>
  )
}
