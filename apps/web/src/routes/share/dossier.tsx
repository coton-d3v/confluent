import { Navigate, useParams } from 'react-router-dom'
import type { FinanceurShareResponse } from '@confluent/shared'
import { ConfluentWordmark } from '@/components/confluent/ConfluentWordmark'
import { useReadingTracker } from '@/features/reading/useReadingTracker'
import { RecipientDossierView } from '@/features/share-access/components/RecipientDossierView'
import { AccessDeniedPage } from '@/routes/share/AccessDeniedPage'

// Former address of the shared dossier: the share link itself now shows it, read once (R04).
export default function ShareDossierRoute() {
  const { token } = useParams<{ token: string }>()
  if (!token) return <AccessDeniedPage />
  return <Navigate to={`/share/${encodeURIComponent(token)}`} replace />
}

export function SharedDossierPage({ data }: { data: FinanceurShareResponse }) {
  // E07.08: this consultation's active time, for the owner.
  useReadingTracker(data.share.reading?.id)
  return (
    <>
      <title>{`${data.dossier.name} · Confluent`}</title>
      <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-8 bg-background px-6 py-8 lg:max-w-3xl lg:px-10">
        <ConfluentWordmark className="h-6 w-auto text-foreground" />
        <RecipientDossierView
          view={data}
          accessLevel={data.share.accessLevel}
          recipientEmail={data.share.recipientEmail}
        />
        <ReadingNotice />
      </main>
    </>
  )
}

// E07.08: what the owner learns of this reading.
export function ReadingNotice() {
  return (
    <p className="border-t border-border pt-4 text-xs text-muted-foreground">
      Le porteur de projet voit vos consultations de ce lien : leur nombre, leurs dates et le temps
      pendant lequel la page est affichée au premier plan et utilisée. Ce temps est une mesure
      approximative, pas une appréciation de votre intérêt.
    </p>
  )
}
