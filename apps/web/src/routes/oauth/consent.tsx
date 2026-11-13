import { useState } from 'react'
import { Navigate, useLocation, useSearchParams } from 'react-router-dom'
import { LoaderCircleIcon, ShieldCheckIcon } from 'lucide-react'
import { OAUTH_SCOPES, WORKSPACE_MEMBER_ROLE_LABELS } from '@confluent/shared'
import { ConfluentWordmark } from '@/components/confluent/ConfluentWordmark'
import { LegalLinks } from '@/components/confluent/LegalLinks'
import { Button } from '@/components/ui/button'
import { rememberReturnTo } from '@/features/auth/return-to'
import { ServerUnreachable } from '@/components/confluent/ServerUnreachable'
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
  const { user, loading, unreachable, retry } = useAuthState()
  const requestId = params.get('request')

  if (loading) {
    return (
      <Shell>
        <LoaderCircleIcon
          className="size-6 animate-spin text-muted-foreground"
          aria-hidden="true"
        />
      </Shell>
    )
  }
  if (!user && unreachable) return <ServerUnreachable onRetry={retry} />
  if (!user) {
    // Log in with the usual magic link, then come back here (see verify.tsx).
    rememberReturnTo(`${location.pathname}${location.search}`)
    return <Navigate to="/auth" replace />
  }
  if (!requestId) return <Expired />
  return (
    <ConsentForm
      requestId={requestId}
      email={user.email}
      name={user.name !== user.email ? user.name : ''}
    />
  )
}

function ConsentForm({
  requestId,
  email,
  name,
}: {
  requestId: string
  email: string
  name: string
}) {
  const { data, isLoading, error } = useAsync(() => getConsentRequest(requestId), [requestId])
  if (isLoading) {
    return (
      <Shell>
        <p className="text-sm text-muted-foreground">Chargement de la demande…</p>
      </Shell>
    )
  }
  if (error || !data) return <Expired />
  return <ConsentDecision request={data} email={email} name={name} />
}

const { write: WRITE } = OAUTH_SCOPES

// Permissions offered on top of the level, each consented to on its own (the API lists the form
// ones to whoever designs forms only, the presentation ones to whoever may own companies, following
// received candidatures to their workspaces' conseillers). Submitting, presenting, deciding and
// publishing act on the user's behalf: they start unticked, so that approving without reading never
// grants them (code review R52); so does following received candidatures, which reads the
// structure's internal notes. Listed here before the API offers them (E05.10, E06.09, E07.10): an
// unknown permission would otherwise join the access level. E07.10: following and sharing one's
// requests, reading one's opportunities and positions and taking a position start unticked too —
// they read or show what others see (investors' names and amounts, readers, pledges). E08.07: the
// committees too — reading them (internal notes, participants, the public form's requests),
// changing a request's entry on one, deciding a participation request (which adds a member). E09.07:
// the public pages too — reading one's workspaces' (and the access requests sent from them) or one's
// requests' cards, changing a page, publishing it or opening it to search engines, deciding an access
// request (which creates an account), showing a request's card to anyone.
const OPTIONAL_PERMISSIONS: Array<{ scope: string; title: string; ticked: boolean }> = [
  { scope: OAUTH_SCOPES.formsWrite, title: 'Concevoir des formulaires', ticked: true },
  { scope: OAUTH_SCOPES.submit, title: 'Soumettre un dossier', ticked: false },
  {
    scope: OAUTH_SCOPES.present,
    title: 'Présenter vos demandes de financement',
    ticked: false,
  },
  {
    scope: OAUTH_SCOPES.sharingRead,
    title: 'Suivre la diffusion de vos demandes',
    ticked: false,
  },
  { scope: OAUTH_SCOPES.sharingWrite, title: 'Partager vos demandes', ticked: false },
  { scope: OAUTH_SCOPES.opportunitiesRead, title: 'Lire vos opportunités', ticked: false },
  {
    scope: OAUTH_SCOPES.opportunitiesWrite,
    title: 'Vous positionner sur les opportunités',
    ticked: false,
  },
  {
    scope: OAUTH_SCOPES.support,
    title: 'Accompagner les candidatures reçues',
    ticked: false,
  },
  {
    scope: OAUTH_SCOPES.decide,
    title: 'Décider du suivi des candidatures',
    ticked: false,
  },
  { scope: OAUTH_SCOPES.committeesRead, title: 'Lire les comités', ticked: false },
  {
    scope: OAUTH_SCOPES.committeesWrite,
    title: 'Présenter des demandes aux comités',
    ticked: false,
  },
  {
    scope: OAUTH_SCOPES.participationRequestsDecide,
    title: 'Décider des demandes de participation',
    ticked: false,
  },
  { scope: OAUTH_SCOPES.publicPageRead, title: 'Lire la page publique', ticked: false },
  { scope: OAUTH_SCOPES.publicPageWrite, title: 'Modifier la page publique', ticked: false },
  { scope: OAUTH_SCOPES.publicPagePublish, title: 'Publier la page publique', ticked: false },
  {
    scope: OAUTH_SCOPES.accessRequestsDecide,
    title: 'Décider des demandes d’accès',
    ticked: false,
  },
  { scope: OAUTH_SCOPES.showcaseRead, title: 'Lire les cartes de vos demandes', ticked: false },
  {
    scope: OAUTH_SCOPES.showcaseWrite,
    title: 'Afficher vos demandes sur les pages publiques',
    ticked: false,
  },
  { scope: OAUTH_SCOPES.formsPublish, title: 'Publier un formulaire', ticked: false },
]
const OPTIONAL_SCOPES = new Set<string>(OPTIONAL_PERMISSIONS.map((p) => p.scope))

interface AccessChoice {
  title: string
  scopes: string[]
}

// Writing implies reading on the server (R17): the screen offers whole levels — read and write, or
// read only — instead of permissions that look independent but are not.
function accessChoices(dossierScopes: string[]): AccessChoice[] {
  if (dossierScopes.length === 0) return []
  if (!dossierScopes.includes(WRITE)) return [{ title: 'Lecture seule', scopes: dossierScopes }]
  return [
    { title: 'Lire et modifier', scopes: dossierScopes },
    { title: 'Lecture seule', scopes: dossierScopes.filter((s) => s !== WRITE) },
  ]
}

function ConsentDecision({
  request,
  email,
  name,
}: {
  request: OAuthConsentRequest
  email: string
  name: string
}) {
  const requested = request.scopes.map((s) => s.scope)
  const choices = accessChoices(requested.filter((s) => !OPTIONAL_SCOPES.has(s)))
  // Never implied by « Lire et modifier »: each is a choice of its own.
  const optional = OPTIONAL_PERMISSIONS.filter((p) => requested.includes(p.scope))
  const [choiceIndex, setChoiceIndex] = useState(0)
  const [ticked, setTicked] = useState(
    () => new Set(optional.filter((p) => p.ticked).map((p) => p.scope)),
  )
  const toggle = (scope: string, on: boolean) =>
    setTicked((current) => {
      const next = new Set(current)
      if (on) next.add(scope)
      else next.delete(scope)
      return next
    })
  const selected = [
    ...(choices[choiceIndex]?.scopes ?? []),
    ...optional.filter((p) => ticked.has(p.scope)).map((p) => p.scope),
  ]
  const labelOf = (scope: string) => request.scopes.find((s) => s.scope === scope)?.label ?? scope
  // E05.10: the workspaces the application may reach, none beforehand (closed by default).
  const workspaces = request.workspaces ?? []
  const [workspaceIds, setWorkspaceIds] = useState<Set<string>>(() => new Set())
  const toggleWorkspace = (id: string, on: boolean) =>
    setWorkspaceIds((current) => {
      const next = new Set(current)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })
  const [pending, setPending] = useState<'approve' | 'deny' | null>(null)
  const [failure, setFailure] = useState<string | null>(null)

  async function decide(approve: boolean) {
    setPending(approve ? 'approve' : 'deny')
    setFailure(null)
    try {
      const { redirectUrl } = await decideConsentRequest(request.id, {
        approve,
        scopes: selected,
        workspaceIds: workspaces.filter((w) => workspaceIds.has(w.id)).map((w) => w.id),
      })
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
        </header>

        {/* E10.10 (U05): who asks, for which account, and for how long. */}
        <dl className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 text-sm">
          <div>
            <dt className="font-medium text-foreground">Application</dt>
            <dd className="wrap-anywhere text-muted-foreground">
              {request.client.origin === 'verified' ? (
                <>
                  Identité <span className="font-medium text-foreground">vérifiée</span> : publiée
                  par <span className="font-medium text-foreground">{request.client.originHost}</span>.
                </>
              ) : (
                <>
                  Identité <span className="font-medium text-foreground">déclarée</span> par
                  l’application elle-même, non vérifiée par Confluent : seul son domaine de retour,{' '}
                  <span className="font-medium text-foreground">{request.client.redirectHost}</span>,
                  est connu.
                </>
              )}
            </dd>
          </div>
          <div>
            <dt className="font-medium text-foreground">Compte</dt>
            <dd className="wrap-anywhere text-muted-foreground">
              Elle agira pour {name ? <>{name} (</> : null}
              <span className="font-medium text-foreground">{email}</span>
              {name ? ')' : null}, avec vos droits, jamais au-delà.
            </dd>
          </div>
          {request.durations && (
            <div>
              <dt className="font-medium text-foreground">Durée</dt>
              <dd className="text-muted-foreground">
                Jusqu’à {request.durations.connectionDays} jours, puis il faudra la reconnecter. Chaque
                accès vaut {request.durations.accessTokenMinutes} minutes et se renouvelle pendant{' '}
                {request.durations.refreshTokenDays} jours sans nouvel usage. Révocable à tout moment
                dans « Applications IA ».
              </dd>
            </div>
          )}
        </dl>

        <fieldset className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
          <legend className="px-1 text-sm font-medium text-foreground">Accès demandé</legend>
          {choices.map((choice, index) => (
            <label key={choice.title} className="flex items-start gap-3 text-sm text-foreground">
              {choices.length > 1 && (
                <input
                  type="radio"
                  name="access-level"
                  className="mt-0.5 size-4 shrink-0 accent-primary"
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
          {optional.map((permission, index) => (
            <label
              key={permission.scope}
              className={`flex items-start gap-3 text-sm text-foreground ${
                choices.length > 0 || index > 0 ? 'border-t border-border pt-3' : ''
              }`}
            >
              <input
                type="checkbox"
                className="mt-0.5 size-4 shrink-0 accent-primary"
                checked={ticked.has(permission.scope)}
                onChange={(event) => toggle(permission.scope, event.target.checked)}
                disabled={pending !== null}
              />
              <span className="flex flex-col gap-1">
                <span className="font-medium">{permission.title}</span>
                <span className="text-muted-foreground">{labelOf(permission.scope)}</span>
              </span>
            </label>
          ))}
          {choices.length === 0 && optional.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Cette application ne demande aucune permission que votre compte peut accorder.
            </p>
          )}
        </fieldset>

        {workspaces.length > 0 && (
          <fieldset className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
            <legend className="px-1 text-sm font-medium text-foreground">Workspaces</legend>
            <p className="text-sm text-muted-foreground">
              Cochez les workspaces dont l’application pourra voir le contenu, selon votre rôle
              dans chacun. Sans case cochée, elle n’accède qu’à vos propres dossiers.
            </p>
            {workspaces.map((workspace) => (
              <label
                key={workspace.id}
                className="flex items-start gap-3 border-t border-border pt-3 text-sm text-foreground"
              >
                <input
                  type="checkbox"
                  className="mt-0.5 size-4 shrink-0 accent-primary"
                  checked={workspaceIds.has(workspace.id)}
                  onChange={(event) => toggleWorkspace(workspace.id, event.target.checked)}
                  disabled={pending !== null}
                />
                <span className="flex min-w-0 flex-col gap-1">
                  <span className="wrap-anywhere font-medium">{workspace.name}</span>
                  <span className="text-muted-foreground">
                    {WORKSPACE_MEMBER_ROLE_LABELS[workspace.role]}
                    {workspace.programName ? ` · ${workspace.programName}` : ''}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
        )}

        <div className="flex flex-col gap-1 text-xs text-muted-foreground">
          <p className="flex items-center gap-1.5">
            <ShieldCheckIcon className="size-3.5 shrink-0" aria-hidden="true" />
            <span>
              Chacune de ses actions sera inscrite à votre journal. Ce qu’elle reçoit est traité par
              son éditeur selon ses propres conditions (
              <a href="/confidentialite#applications-ia" className="underline underline-offset-4">
                confidentialité
              </a>
              ).
            </span>
          </p>
          <p>
            Après votre choix, vous serez redirigé vers{' '}
            <span className="font-medium text-foreground">{request.client.redirectHost}</span>. Vous
            pourrez révoquer cet accès à tout moment.
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
