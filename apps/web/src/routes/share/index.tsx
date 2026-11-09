import { useParams } from 'react-router-dom'
import { LoaderCircleIcon } from 'lucide-react'
import { useSharedDossier } from '@/features/share-access/useSharedDossier'
import { AccessDeniedPage } from './AccessDeniedPage'
import { SharedDossierPage } from './dossier'
import { RecipientMismatchPage } from './RecipientMismatchPage'
import { ShareUnavailablePage } from './ShareUnavailablePage'
import { ShareAccessForm } from './ShareAccessForm'
import { ShareShell } from './ShareShell'

// Entry point of a share link (from the invitation email): resolves the access, then shows the
// dossier on the same page, so that one opening reads it — and counts it as viewed — once (R04).
export default function ShareRoute() {
  const { token } = useParams<{ token: string }>()
  if (!token) return <AccessDeniedPage />
  return <ShareResolver token={token} />
}

function ShareResolver({ token }: { token: string }) {
  const state = useSharedDossier(token)
  switch (state.status) {
    case 'anonymous':
      return <ShareAccessForm token={token} />
    case 'ok':
      return <SharedDossierPage data={state.data} />
    case 'mismatch':
      return <RecipientMismatchPage email={state.email} />
    case 'denied':
      return <AccessDeniedPage />
    case 'unavailable':
      return <ShareUnavailablePage retry={state.retry} retryAfter={state.retryAfter} />
    default:
      return (
        <ShareShell title="Accéder au dossier">
          <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />
            Vérification du lien…
          </p>
        </ShareShell>
      )
  }
}
