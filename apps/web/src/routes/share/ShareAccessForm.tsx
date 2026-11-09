import { useState, type FormEvent } from 'react'
import { LoaderCircleIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { rememberReturnTo } from '@/features/auth/return-to'
import { requestShareAccess } from '@/features/share-access/api'
import type { ApiError } from '@/lib/api-client'
import { AccessDeniedPage } from './AccessDeniedPage'
import { ShareShell } from './ShareShell'

// E02.08 / Q21: the visitor states their address; the API emails a sign-in link only if it is the
// recipient's. The answer never tells whether the address matched.
export function ShareAccessForm({ token }: { token: string }) {
  const [email, setEmail] = useState('')
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error' | 'denied'>('idle')

  async function submit(e: FormEvent) {
    e.preventDefault()
    setState('sending')
    try {
      await requestShareAccess(token, email.trim())
      // The sign-in link opens in another tab (mail client): come back to this dossier afterwards.
      rememberReturnTo(`/share/${encodeURIComponent(token)}`)
      setState('sent')
    } catch (err) {
      setState((err as ApiError | undefined)?.status === 403 ? 'denied' : 'error')
    }
  }

  if (state === 'denied') return <AccessDeniedPage />
  return (
    <ShareShell title="Accéder au dossier partagé">
      <h1 className="font-heading text-2xl font-medium text-foreground">Accéder au dossier partagé</h1>
      {state === 'sent' ? (
        <p role="status" className="rounded-lg border border-border bg-card p-4 text-sm text-foreground">
          Si cette adresse est celle à laquelle le dossier a été partagé, un lien de connexion vient de
          vous être envoyé. Ouvrez-le pour consulter le dossier.
        </p>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-3 text-left" noValidate>
          <p className="text-center text-sm text-muted-foreground">
            Ce dossier est réservé à la personne à qui il a été partagé. Indiquez votre adresse : si
            c’est la bonne, vous recevrez un lien de connexion.
          </p>
          <Label htmlFor="share-email" className="sr-only">
            Adresse email
          </Label>
          <Input
            id="share-email"
            type="email"
            autoComplete="email"
            required
            placeholder="votre@email.fr"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="h-11"
          />
          {state === 'error' && (
            <p role="alert" className="text-xs text-destructive">
              Impossible d’envoyer le lien pour le moment. Réessayez dans quelques instants.
            </p>
          )}
          <Button type="submit" size="lg" className="h-11 w-full" disabled={state === 'sending' || !email.includes('@')}>
            {state === 'sending' ? (
              <>
                <LoaderCircleIcon className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                Envoi…
              </>
            ) : (
              'Recevoir mon lien de connexion'
            )}
          </Button>
        </form>
      )}
    </ShareShell>
  )
}
