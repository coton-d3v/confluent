import { useState } from 'react'
import { CheckIcon, CopyIcon } from 'lucide-react'
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
import { API_BASE_URL } from '@/lib/api-client'
import { useAsync } from '@/lib/useAsync'

const MCP_URL = `${API_BASE_URL.replace(/\/+$/, '')}/mcp`

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })

// E01.08: connect Confluent to an AI client, see the authorized ones and revoke them.
export default function ApplicationsRoute() {
  const { data, isLoading, error, refetch } = useAsync(() => listConnectedApplications(), [])
  const [toRevoke, setToRevoke] = useState<ConnectedApplication | null>(null)

  async function revoke(app: ConnectedApplication) {
    try {
      await revokeConnectedApplication(app.id)
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

      <section className="mt-10">
        <h2 className="font-heading text-xl font-semibold text-foreground">Applications connectées</h2>
        {isLoading ? (
          <p className="mt-4 text-sm text-muted-foreground">Chargement…</p>
        ) : error || !data ? (
          <p className="mt-4 text-sm text-destructive">Impossible de charger vos applications.</p>
        ) : data.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">
            Aucune application n’a accès à votre compte.
          </p>
        ) : (
          <ul role="list" className="mt-4 flex flex-col divide-y divide-border rounded-lg border border-border bg-card">
            {data.map((app) => (
              <li key={app.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="font-medium text-foreground">{app.application.name}</p>
                  <ul className="mt-1 list-disc pl-5 text-sm text-muted-foreground">
                    {app.scopes.map((s) => (
                      <li key={s.scope}>{s.label}</li>
                    ))}
                  </ul>
                  <p className="mt-2 text-xs text-muted-foreground">
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
              L’application ne pourra plus lire ni modifier vos dossiers. Cette action est immédiate ;
              pour la réutiliser, il faudra la reconnecter.
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
  const [copied, setCopied] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(MCP_URL)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('Copie impossible : sélectionnez l’adresse à la main.')
    }
  }
  return (
    <section className="mt-8 max-w-2xl rounded-lg border border-border bg-card p-4">
      <h2 className="text-sm font-medium text-foreground">Adresse du connecteur</h2>
      <div className="mt-2 flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-3 py-2 text-sm text-foreground">
          {MCP_URL}
        </code>
        <Button variant="outline" size="sm" onClick={() => void copy()} aria-label="Copier l’adresse du connecteur">
          {copied ? <CheckIcon className="size-4" aria-hidden="true" /> : <CopyIcon className="size-4" aria-hidden="true" />}
        </Button>
      </div>
      <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
        <li>Dans Claude ou ChatGPT, ajoutez un connecteur personnalisé avec cette adresse.</li>
        <li>Choisissez « Se connecter » : vous arrivez sur Confluent, connectez-vous par email.</li>
        <li>Choisissez les permissions à accorder, puis revenez dans votre assistant.</li>
      </ol>
    </section>
  )
}
