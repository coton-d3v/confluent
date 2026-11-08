import { Navigate, useParams } from 'react-router-dom'
import { LoaderCircleIcon } from 'lucide-react'
import { useSharedDossier } from '@/features/share-access/useSharedDossier'
import { AccessDeniedPage } from './AccessDeniedPage'
import { RecipientMismatchPage } from './RecipientMismatchPage'
import { ShareAccessForm } from './ShareAccessForm'
import { ShareShell } from './ShareShell'

// Entry point of a share link (from the invitation email).
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
      return <Navigate to={`/share/${encodeURIComponent(token)}/dossier`} replace />
    case 'mismatch':
      return <RecipientMismatchPage email={state.email} />
    case 'denied':
      return <AccessDeniedPage />
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
