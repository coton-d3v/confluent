import { useState } from 'react'
import { toast } from 'sonner'
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
import { API_BASE_URL } from '@/lib/api-client'
import { useAsync } from '@/lib/useAsync'
import { readFailure } from '@/lib/read-failure'
import { LoadError } from '@/components/confluent/LoadError'

const MCP_URL = `${API_BASE_URL.replace(/\/+$/, '')}/mcp`

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })

// E01.08: connect Confluent to an AI client, see the authorized ones and revoke them.
export default function ApplicationsRoute() {
  const { data, isLoading, error, refetch } = useAsync(() => listConnectedApplications(), [])
  const [toRevoke, setToRevoke] = useState<ConnectedApplication | null>(null)

  async function revoke(app: ConnectedApplication) {
    try {
      await revokeConnectedApplication(app.clientId)
      toast.success(`${app.application.name} n’a plus accès à votre compte.`)
      refetch()
    } catch {
      toast.error('La révocation a échoué. Réessayez.')
    } finally {
      setToRevoke(null)
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
        {isLoading ? (
          <p className="mt-4 text-sm text-muted-foreground">Chargement…</p>
        ) : error || !data ? (
          <LoadError
            className="mt-4"
            message={readFailure(error, 'Vos applications connectées n’ont pas pu être chargées.')}
            onRetry={refetch}
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
                  <p className="font-medium text-foreground">{app.application.name}</p>
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
                  <p className="mt-2 text-xs text-muted-foreground">
                    {app.connections > 1 && `${app.connections} connexions · `}
                    Connectée le {formatDate(app.connectedAt)} ·{' '}
                    {app.lastUsedAt ? `dernière utilisation le ${formatDate(app.lastUsedAt)}` : 'jamais utilisée'} ·
                    expire le {formatDate(app.expiresAt)}
                  </p>
                </div>
                <Button variant="outline" size="sm" className="shrink-0" onClick={() => setToRevoke(app)}>
                  Révoquer
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <AlertDialog open={toRevoke !== null} onOpenChange={(open) => !open && setToRevoke(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Révoquer {toRevoke?.application.name} ?</AlertDialogTitle>
            <AlertDialogDescription>
              L’application ne pourra plus lire ni modifier vos dossiers
              {toRevoke && toRevoke.connections > 1
                ? ` : ses ${toRevoke.connections} connexions sont coupées`
                : ''}
              . Cette action est immédiate ; pour la réutiliser, il faudra la reconnecter.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={() => toRevoke && void revoke(toRevoke)}>Oui, révoquer</AlertDialogAction>
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
