import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  listConnectedApplications,
  revokeConnectedApplication,
  type ConnectedApplication,
} from '@/features/oauth/api'
import { ConversationGuides } from '@/features/oauth/components/ConversationGuides'
import { CopyButton } from '@/features/oauth/components/CopyButton'
import { API_BASE_URL, type ApiError } from '@/lib/api-client'
import { useAsync } from '@/lib/useAsync'
import { readFailure } from '@/lib/read-failure'
import { LoadError } from '@/components/confluent/LoadError'

const MCP_URL = `${API_BASE_URL.replace(/\/+$/, '')}/mcp`

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
const formatMoment = (iso: string) =>
  new Date(iso).toLocaleString('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

function revokeFailure(err: unknown): string {
  const status = (err as Partial<ApiError> | undefined)?.status
  if (status === undefined) {
    return 'La révocation n’a pas pu être confirmée : le serveur ne répond pas. Vérifiez votre connexion, puis réessayez.'
  }
  if (status === 401) return 'Votre session a expiré : reconnectez-vous, puis réessayez.'
  return 'La révocation n’a pas pu être confirmée : le serveur est momentanément indisponible. Réessayez.'
}

// E01.08: connect Confluent to an AI client, see the authorized ones and revoke them. E10.10 (U06/U07):
// what each application can see and when it last acted; a revocation confirmed first, shown in
// progress (never sent twice), retried in place after an error, and confirmed once the server
// answered — the list read again afterwards, its failure shown with « Réessayer ».
export default function ApplicationsRoute() {
  const { data, isLoading, error, refetch } = useAsync(() => listConnectedApplications(), [])
  const [toRevoke, setToRevoke] = useState<ConnectedApplication | null>(null)
  const [revoking, setRevoking] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [confirmed, setConfirmed] = useState<string | null>(null)
  const inFlight = useRef(false)

  async function revoke(app: ConnectedApplication) {
    if (inFlight.current) return
    inFlight.current = true
    setRevoking(true)
    setFailure(null)
    try {
      await revokeConnectedApplication(app.clientId)
      setConfirmed(
        `${app.application.name} n’a plus accès à votre compte : ses connexions sont coupées depuis le ${formatMoment(new Date().toISOString())}.`,
      )
      setToRevoke(null)
      refetch()
    } catch (err) {
      setFailure(revokeFailure(err))
    } finally {
      inFlight.current = false
      setRevoking(false)
    }
  }

  return (
    <>
      <title>Applications IA · Confluent</title>
      <h1 className="font-heading text-2xl font-medium text-foreground md:text-[28px]">
        Applications IA
      </h1>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
        Utilisez Confluent depuis Claude, ChatGPT ou tout client compatible MCP : l’assistant lit vos
        dossiers et enregistre vos réponses, avec exactement vos droits.
      </p>

      <ConnectorAddress />

      <ConversationGuides />

      <section className="mt-10">
        <h2 className="font-heading text-xl font-semibold text-foreground">Applications connectées</h2>
        <div aria-live="polite">
          {confirmed && (
            <p
              role="status"
              className="mt-4 rounded-md border border-border bg-muted px-4 py-3 text-sm text-foreground"
            >
              {confirmed}
            </p>
          )}
        </div>
        {isLoading && !data ? (
          <p className="mt-4 text-sm text-muted-foreground">Chargement…</p>
        ) : error || !data ? (
          <LoadError
            className="mt-4"
            message={readFailure(error, 'Vos applications connectées n’ont pas pu être chargées.')}
            onRetry={refetch}
            retrying={isLoading}
          />
        ) : data.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">
            Aucune application n’a accès à votre compte.
          </p>
        ) : (
          <ul role="list" className="mt-4 flex flex-col divide-y divide-border rounded-lg border border-border bg-card">
            {data.map((app) => (
              <li key={app.clientId} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <h3 className="wrap-anywhere font-medium text-foreground">{app.application.name}</h3>
                  <p className="mt-2 text-sm font-medium text-foreground">Ce qu’elle peut voir et faire</p>
                  <ul className="mt-1 list-disc pl-5 text-sm text-muted-foreground">
                    {app.scopes.map((s) => (
                      <li key={s.scope}>{s.label}</li>
                    ))}
                  </ul>
                  {app.workspaces && (
                    <p className="mt-2 text-sm text-muted-foreground">
                      {app.workspaces.length === 0
                        ? 'Aucun workspace : vos dossiers personnels seulement.'
                        : `Workspaces : ${app.workspaces.map((w) => w.name).join(', ')}`}
                    </p>
                  )}
                  <p className="mt-2 text-sm text-muted-foreground">
                    {app.lastAction
                      ? <>Dernière action : <code className="rounded bg-muted px-1">{app.lastAction.tool}</code> le {formatMoment(app.lastAction.at)}{app.lastAction.succeeded ? '' : ' (en échec)'}</>
                      : 'Aucune action enregistrée pour le moment.'}
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {app.connections > 1 && `${app.connections} connexions · `}
                    Connectée le {formatDate(app.connectedAt)} ·{' '}
                    {app.lastUsedAt ? `dernière utilisation le ${formatMoment(app.lastUsedAt)}` : 'jamais utilisée'} ·
                    expire le {formatDate(app.expiresAt)}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  disabled={revoking}
                  onClick={() => {
                    setFailure(null)
                    setToRevoke(app)
                  }}
                >
                  Révoquer
                  <span className="sr-only"> {app.application.name}</span>
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <AlertDialog
        open={toRevoke !== null}
        onOpenChange={(open) => {
          if (!open && !revoking) {
            setToRevoke(null)
            setFailure(null)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Révoquer {toRevoke?.application.name} ?</AlertDialogTitle>
            <AlertDialogDescription>
              L’application ne pourra plus lire ni modifier vos dossiers
              {toRevoke && toRevoke.connections > 1
                ? ` : ses ${toRevoke.connections} connexions sont coupées`
                : ''}
              . Cette action est immédiate ; ce qu’elle a déjà reçu reste soumis aux conditions de son
              éditeur. Pour la réutiliser, il faudra la reconnecter.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div aria-live="assertive">
            {failure && (
              <p role="alert" className="text-sm text-destructive">
                {failure}
              </p>
            )}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={revoking}>Annuler</AlertDialogCancel>
            <AlertDialogAction
              disabled={revoking}
              aria-busy={revoking}
              onClick={() => toRevoke && void revoke(toRevoke)}
            >
              {revoking ? 'Révocation en cours…' : failure ? 'Réessayer la révocation' : 'Oui, révoquer'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function ConnectorAddress() {
  return (
    <section className="mt-8 max-w-2xl rounded-lg border border-border bg-card p-4">
      <h2 className="text-sm font-medium text-foreground">Adresse du connecteur</h2>
      {/* E10.07 (U12): shown whole and selected in one click or tap, to copy by hand if needed. */}
      <div className="mt-2 flex items-center gap-2">
        <code className="min-w-0 flex-1 rounded-md bg-muted px-3 py-2 text-sm break-all text-foreground select-all">
          {MCP_URL}
        </code>
        <CopyButton text={MCP_URL} label="Copier l’adresse du connecteur" />
      </div>
      <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
        <li>Dans Claude ou ChatGPT, ajoutez un connecteur personnalisé avec cette adresse.</li>
        <li>Choisissez « Se connecter » : vous arrivez sur Confluent, connectez-vous par email.</li>
        <li>Choisissez les permissions à accorder, puis revenez dans votre assistant.</li>
      </ol>
    </section>
  )
}
