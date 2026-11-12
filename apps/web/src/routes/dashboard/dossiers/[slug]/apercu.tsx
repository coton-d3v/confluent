import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useCurrentUser } from '@/features/current-user/context'
import { getDossierBySlug } from '@/features/dossiers/api'
import type { ApiError } from '@/lib/api-client'
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
  // ROADMAP E10.08: found by its address, not in the list of the account's dossiers.
  const found = useAsync(() => getDossierBySlug(slug ?? ''), [slug])
  if (found.isLoading) return <p className="pt-8 text-sm text-muted-foreground">Chargement…</p>
  if (found.error && (found.error as ApiError).status !== 404) {
    return (
      <LoadError
        className="mt-8"
        message={readFailure(found.error, 'Ce dossier n’a pas pu être chargé.')}
        onRetry={found.refetch}
      />
    )
  }
  // The owner's preview only: a dossier shared with the account is not theirs to preview.
  const dossier = found.data?.userId === user.id ? found.data : undefined
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
