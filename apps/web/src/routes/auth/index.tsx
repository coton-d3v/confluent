import { useEffect, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { magicLinkRequestSchema, type MagicLinkRequest } from '@confluent/shared'
import { LoaderCircleIcon } from 'lucide-react'
import { ConfluentWordmark } from '@/components/confluent/ConfluentWordmark'
import { LegalLinks } from '@/components/confluent/LegalLinks'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { requestMagicLink } from '@/features/auth/api'

export default function AuthRoute() {
  const [sent, setSent] = useState(false)
  const [apiError, setApiError] = useState<string | null>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<MagicLinkRequest>({ resolver: zodResolver(magicLinkRequestSchema) })

  useEffect(() => {
    headingRef.current?.focus()
  }, [])

  const onSubmit = async (values: MagicLinkRequest) => {
    setApiError(null)
    try {
      await requestMagicLink(values.email)
      setSent(true)
    } catch {
      setApiError(
        "Impossible d'envoyer le lien pour le moment. Veuillez réessayer dans quelques instants.",
      )
    }
  }

  return (
    <>
      <title>Connexion · Confluent</title>
      <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-6 py-12">
        <ConfluentWordmark className="h-7 w-auto text-foreground" />
        <div className="flex w-full max-w-sm flex-col gap-2 text-center">
          <h1
            ref={headingRef}
            tabIndex={-1}
            className="font-heading text-2xl font-medium text-foreground sm:text-[28px] focus-visible:outline-none"
          >
            Connexion
          </h1>
          {!sent && (
            <p className="text-sm text-muted-foreground">
              Entrez votre adresse email pour recevoir un lien de connexion.
            </p>
          )}
        </div>

        {sent ? (
          <div
            role="status"
            aria-live="polite"
            className="w-full max-w-sm rounded-lg border border-border bg-card p-4 text-sm text-foreground"
          >
            Vérifiez votre boîte mail. Un lien de connexion vous a été envoyé.
          </div>
        ) : (
          <form
            onSubmit={handleSubmit(onSubmit)}
            noValidate
            className="flex w-full max-w-sm flex-col gap-3"
          >
            <Label htmlFor="auth-email" className="sr-only">
              Adresse email
            </Label>
            <Input
              id="auth-email"
              type="email"
              autoComplete="email"
              autoFocus
              placeholder="votre@email.fr"
              aria-invalid={errors.email ? 'true' : undefined}
              aria-describedby={errors.email ? 'auth-email-error' : undefined}
              {...register('email')}
              className="h-11 w-full"
            />
            <div aria-live="assertive" aria-atomic="true" className="min-h-[1em]">
              {errors.email && (
                <p id="auth-email-error" role="alert" className="text-xs text-destructive">
                  {errors.email.message}
                </p>
              )}
              {apiError && !errors.email && (
                <p role="alert" className="text-xs text-destructive">
                  {apiError}
                </p>
              )}
            </div>
            <Button type="submit" size="lg" disabled={isSubmitting} className="h-11 w-full">
              {isSubmitting ? (
                <>
                  <LoaderCircleIcon
                    data-icon="inline-start"
                    className="size-4 animate-spin motion-reduce:animate-none"
                    aria-hidden="true"
                  />
                  Envoi du lien…
                </>
              ) : (
                'Recevoir mon lien de connexion'
              )}
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              Pas de mot de passe — vérifiez votre boîte mail
            </p>
            <p className="text-center text-xs text-muted-foreground">
              Aucun compte n&apos;est créé automatiquement. Pour recevoir un lien, vous devez avoir
              été invité par un administrateur ou par un entrepreneur qui partage un dossier avec
              vous.
            </p>
          </form>
        )}
        <LegalLinks className="justify-center" />
      </main>
    </>
  )
}
