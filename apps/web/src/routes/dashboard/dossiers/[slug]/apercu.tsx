import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useCurrentUser } from '@/features/current-user/context'
import { listDossiers } from '@/features/dossiers/api'
import { getSharePreview } from '@/features/shares/api'
import { RecipientPreview } from '@/features/shares/components/RecipientPreview'
import { PREVIEW_CANDIDATURE_PARAM } from '@/features/shares/preview'
import { useAsync } from '@/lib/useAsync'
import { readFailure } from '@/lib/read-failure'
import { LoadError } from '@/components/confluent/LoadError'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// E07.01 « Voir comme le destinataire », for the owner of the request; E07.02: opened from a
// candidature's pool panel, « Voir comme un investisseur du vivier », which it leads back to.
export default function DossierPreviewRoute() {
  const { slug } = useParams<{ slug: string }>()
  const [searchParams] = useSearchParams()
  const fromCandidature = searchParams.get(PREVIEW_CANDIDATURE_PARAM)
  const candidatureId = fromCandidature && UUID.test(fromCandidature) ? fromCandidature : null
  const user = useCurrentUser()
  const dossiers = useAsync(() => listDossiers(), [])
  if (dossiers.isLoading) return <p className="pt-8 text-sm text-muted-foreground">Chargement…</p>
  if (dossiers.error) {
    return (
      <LoadError
        className="mt-8"
        message={readFailure(dossiers.error, 'Vos dossiers n’ont pas pu être chargés.')}
        onRetry={dossiers.refetch}
      />
    )
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
      backHref={
        candidatureId
          ? `/dashboard/candidatures/${candidatureId}`
          : `/dashboard/dossiers/view/${encodeURIComponent(dossier.slug)}?tab=analytics`
      }
      backLabel={candidatureId ? 'Retour à la candidature' : 'Retour aux accès de la demande'}
      audience={candidatureId ? 'pool' : 'share'}
      load={(level) => getSharePreview(dossier.id, level)}
    />
  )
}
