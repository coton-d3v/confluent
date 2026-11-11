import { Navigate, useParams } from 'react-router-dom'
import type { FinanceurShareResponse } from '@confluent/shared'
import { ConfluentWordmark } from '@/components/confluent/ConfluentWordmark'
import { RecipientDossierView } from '@/features/share-access/components/RecipientDossierView'
import { AccessDeniedPage } from '@/routes/share/AccessDeniedPage'

// Former address of the shared dossier: the share link itself now shows it, read once (R04).
export default function ShareDossierRoute() {
  const { token } = useParams<{ token: string }>()
  if (!token) return <AccessDeniedPage />
  return <Navigate to={`/share/${encodeURIComponent(token)}`} replace />
}

export function SharedDossierPage({ data }: { data: FinanceurShareResponse }) {
  return (
    <>
      <title>{data.dossier.name} · Confluent</title>
      <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-8 bg-background px-6 py-8 lg:max-w-3xl lg:px-10">
        <ConfluentWordmark className="h-6 w-auto text-foreground" />
        <RecipientDossierView
          view={data}
          accessLevel={data.share.accessLevel}
          recipientEmail={data.share.recipientEmail}
        />
      </main>
    </>
  )
}
