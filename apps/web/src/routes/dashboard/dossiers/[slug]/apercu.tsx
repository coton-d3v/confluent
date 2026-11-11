import { Link, useParams } from 'react-router-dom'
import { useCurrentUser } from '@/features/current-user/context'
import { listDossiers } from '@/features/dossiers/api'
import { getSharePreview } from '@/features/shares/api'
import { RecipientPreview } from '@/features/shares/components/RecipientPreview'
import { useAsync } from '@/lib/useAsync'

// E07.01 « Voir comme le destinataire », for the owner of the request.
export default function DossierPreviewRoute() {
  const { slug } = useParams<{ slug: string }>()
  const user = useCurrentUser()
  const dossiers = useAsync(() => listDossiers(), [])
  if (dossiers.isLoading) return <p className="pt-8 text-sm text-muted-foreground">Chargement…</p>
  if (dossiers.error) {
    return <p className="pt-8 text-sm text-destructive">Impossible de charger vos dossiers.</p>
  }
  const dossier = dossiers.data?.find((d) => d.slug === slug && d.userId === user.id)
  if (!dossier) {
    return (
      <section className="mx-auto max-w-md pt-16 text-center">
        <title>Dossier introuvable · Confluent</title>
        <p className="text-sm text-muted-foreground">Dossier introuvable.</p>
        <Link to="/dashboard" className="mt-4 inline-block text-sm underline">
          Retour au tableau de bord
        </Link>
      </section>
    )
  }
  return (
    <RecipientPreview
      dossierName={dossier.name}
      backHref={`/dashboard/dossiers/view/${encodeURIComponent(dossier.slug)}?tab=analytics`}
      backLabel="Retour aux accès de la demande"
      load={(level) => getSharePreview(dossier.id, level)}
    />
  )
}
