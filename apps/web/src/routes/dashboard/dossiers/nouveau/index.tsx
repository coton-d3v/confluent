import { useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { canOwnCompanies } from '@confluent/shared'
import { WizardInput } from '@/components/confluent/WizardInput'
import { Button } from '@/components/ui/button'
import { stripNonPrintable } from '@/lib/sanitize'
import { createDossier } from '@/features/dossiers/api'
import type { ApiError } from '@/lib/api-client'
import { useCurrentUser } from '@/features/current-user/context'

const NAME_MAX_LENGTH = 120

export default function DossierNewRoute() {
  // Creating a dossier creates its company (E05.04): the API refuses it to any other account.
  if (!canOwnCompanies(useCurrentUser())) return <CreationNotAllowed />
  return <DossierNewForm />
}

function CreationNotAllowed() {
  return (
    <section className="mx-auto max-w-md pt-16 text-center">
      <title>Nouveau dossier · Confluent</title>
      <p className="text-sm text-muted-foreground">
        Seuls les porteurs de projet créent une entreprise et ses dossiers.
      </p>
      <Link
        to="/dashboard"
        className="mt-4 inline-block text-sm underline hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
      >
        Retour à mes dossiers
      </Link>
    </section>
  )
}

function DossierNewForm() {
  const navigate = useNavigate()
  const inputRef = useRef<HTMLInputElement>(null)
  const [name, setName] = useState('')
  const [showError, setShowError] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const cleaned = stripNonPrintable(name).trim()
    if (!cleaned) {
      setShowError(true)
      inputRef.current?.focus()
      return
    }
    setIsSubmitting(true)
    setErrorMessage(null)
    try {
      const dossier = await createDossier({ name: cleaned })
      navigate(
        `/dashboard/dossiers/nouveau/questionnaire?dossierId=${encodeURIComponent(dossier.id)}`,
      )
    } catch (err) {
      const apiErr = err as ApiError
      setErrorMessage(apiErr?.message ?? 'Impossible de créer le dossier. Réessayez.')
      setIsSubmitting(false)
    }
  }

  return (
    <>
      <title>Nouveau dossier · Confluent</title>
      <form
        onSubmit={handleSubmit}
        noValidate
        className="mx-auto flex max-w-md flex-col gap-6 pt-8"
      >
        <label
          htmlFor="dossier-name"
          className="font-heading text-2xl font-medium text-foreground"
        >
          Comment s&apos;appelle votre entreprise ou votre projet&nbsp;?
        </label>
        <WizardInput
          ref={inputRef}
          id="dossier-name"
          autoFocus
          maxLength={NAME_MAX_LENGTH}
          value={name}
          onChange={(e) => {
            setName(e.target.value)
            if (showError) setShowError(false)
          }}
          aria-invalid={showError || undefined}
          aria-describedby={showError ? 'dossier-name-error' : undefined}
        />
        <div
          aria-live="assertive"
          aria-atomic="true"
          className="min-h-[1em]"
        >
          {showError && (
            <p id="dossier-name-error" className="text-xs text-destructive">
              Le nom est requis.
            </p>
          )}
          {errorMessage && (
            <p className="text-xs text-destructive">{errorMessage}</p>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          Ce nom désigne votre entreprise et son dossier de financement.
        </p>
        <Button
          type="submit"
          size="lg"
          className="h-11 self-start px-4"
          disabled={isSubmitting}
        >
          {isSubmitting ? 'Création…' : 'Commencer →'}
        </Button>
      </form>
    </>
  )
}
