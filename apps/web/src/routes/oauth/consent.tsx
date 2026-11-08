import { useState } from 'react'
import { Navigate, useLocation, useSearchParams } from 'react-router-dom'
import { LoaderCircleIcon, ShieldCheckIcon } from 'lucide-react'
import { ConfluentWordmark } from '@/components/confluent/ConfluentWordmark'
import { LegalLinks } from '@/components/confluent/LegalLinks'
import { Button } from '@/components/ui/button'
import { rememberReturnTo } from '@/features/auth/return-to'
import { useAuthState } from '@/features/current-user/context'
import {
  decideConsentRequest,
  getConsentRequest,
  type OAuthConsentRequest,
} from '@/features/oauth/api'
import { useAsync } from '@/lib/useAsync'

// OAuth consent screen for MCP clients (Claude, ChatGPT…), reached from the API's /authorize.
export default function OAuthConsentRoute() {
  const [params] = useSearchParams()
  const location = useLocation()
  const { user, loading } = useAuthState()
  const requestId = params.get('request')

  if (loading) {
    return (
      <Shell>
        <LoaderCircleIcon className="size-6 animate-spin text-muted-foreground" aria-hidden="true" />
      </Shell>
    )
  }
  if (!user) {
    // Log in with the usual magic link, then come back here (see verify.tsx).
    rememberReturnTo(`${location.pathname}${location.search}`)
    return <Navigate to="/auth" replace />
  }
  if (!requestId) return <Expired />
  return <ConsentForm requestId={requestId} email={user.email} />
}

function ConsentForm({ requestId, email }: { requestId: string; email: string }) {
  const { data, isLoading, error } = useAsync(() => getConsentRequest(requestId), [requestId])
  if (isLoading) {
    return (
      <Shell>
        <p className="text-sm text-muted-foreground">Chargement de la demande…</p>
      </Shell>
    )
  }
  if (error || !data) return <Expired />
  return <ConsentDecision request={data} email={email} />
}

const WRITE = 'dossiers:write'

interface AccessChoice {
  title: string
  scopes: string[]
}

// Writing implies reading on the server (R17): the screen offers whole levels — read and write, or
// read only — instead of permissions that look independent but are not.
function accessChoices(request: OAuthConsentRequest): AccessChoice[] {
  const requested = request.scopes.map((s) => s.scope)
  if (!requested.includes(WRITE)) return [{ title: 'Lecture seule', scopes: requested }]
  return [
    { title: 'Lire et modifier', scopes: requested },
    { title: 'Lecture seule', scopes: requested.filter((s) => s !== WRITE) },
  ]
}

function ConsentDecision({ request, email }: { request: OAuthConsentRequest; email: string }) {
  const choices = accessChoices(request)
  const [choiceIndex, setChoiceIndex] = useState(0)
  const selected = choices[choiceIndex].scopes
  const labelOf = (scope: string) => request.scopes.find((s) => s.scope === scope)?.label ?? scope
  const [pending, setPending] = useState<'approve' | 'deny' | null>(null)
  const [failure, setFailure] = useState<string | null>(null)

  async function decide(approve: boolean) {
    setPending(approve ? 'approve' : 'deny')
    setFailure(null)
    try {
      const { redirectUrl } = await decideConsentRequest(request.id, approve, selected)
      // Leave Confluent: the client finishes the flow on its own redirect URI.
      window.location.assign(redirectUrl)
    } catch {
      setPending(null)
      setFailure('La demande n’a pas pu être traitée. Relancez la connexion depuis l’application.')
    }
  }

  return (
    <Shell>
      <div className="flex w-full max-w-md flex-col gap-6">
        <header className="flex flex-col gap-2 text-center">
          <h1 className="font-heading text-2xl font-medium text-foreground">
            {request.client.name} souhaite accéder à votre compte Confluent
          </h1>
          <p className="text-sm text-muted-foreground">
            Connecté en tant que <span className="font-medium text-foreground">{email}</span>
          </p>
        </header>

        <fieldset className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
          <legend className="px-1 text-sm font-medium text-foreground">Accès demandé</legend>
          {choices.map((choice, index) => (
            <label key={choice.title} className="flex items-start gap-3 text-sm text-foreground">
              {choices.length > 1 && (
                <input
                  type="radio"
                  name="access-level"
                  className="mt-0.5 size-4 accent-primary"
                  checked={choiceIndex === index}
                  onChange={() => setChoiceIndex(index)}
                  disabled={pending !== null}
                />
              )}
              <span className="flex flex-col gap-1">
                <span className="font-medium">{choice.title}</span>
                <ul className="list-disc pl-5 text-muted-foreground">
                  {choice.scopes.map((scope) => (
                    <li key={scope}>{labelOf(scope)}</li>
                  ))}
                </ul>
              </span>
            </label>
          ))}
        </fieldset>

        <div className="flex flex-col gap-1 text-xs text-muted-foreground">
          <p className="flex items-center gap-1.5">
            <ShieldCheckIcon className="size-3.5" aria-hidden="true" />
            L’application agira avec vos droits, jamais au-delà, et chacune de ses actions sera
            inscrite à votre journal.
          </p>
          <p>
            Après votre choix, vous serez redirigé vers{' '}
            <span className="font-medium text-foreground">{request.client.redirectHost}</span>.
            Vous pourrez révoquer cet accès à tout moment.
          </p>
        </div>

        {failure && (
          <p role="alert" className="text-sm text-destructive">
            {failure}
          </p>
        )}

        <div className="flex flex-col gap-2 sm:flex-row-reverse">
          <Button
            size="lg"
            className="h-11 w-full sm:flex-1"
            disabled={pending !== null || selected.length === 0}
            onClick={() => void decide(true)}
          >
            {pending === 'approve' ? 'Autorisation…' : 'Autoriser'}
          </Button>
          <Button
            size="lg"
            variant="outline"
            className="h-11 w-full sm:flex-1"
            disabled={pending !== null}
            onClick={() => void decide(false)}
          >
            {pending === 'deny' ? 'Refus…' : 'Refuser'}
          </Button>
        </div>
      </div>
    </Shell>
  )
}

function Expired() {
  return (
    <Shell>
      <div className="flex w-full max-w-sm flex-col gap-2 text-center">
        <h1 className="font-heading text-2xl font-medium text-foreground">Demande expirée</h1>
        <p className="text-sm text-muted-foreground">
          Cette demande d’autorisation n’existe plus ou a déjà été traitée. Relancez la connexion à
          Confluent depuis votre application (Claude, ChatGPT…).
        </p>
      </div>
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <title>Autoriser une application · Confluent</title>
      <main className="flex min-h-screen flex-col items-center justify-center gap-8 bg-background px-6 py-12">
        <ConfluentWordmark className="h-7 w-auto text-foreground" />
        {children}
        <LegalLinks className="justify-center" />
      </main>
    </>
  )
}
