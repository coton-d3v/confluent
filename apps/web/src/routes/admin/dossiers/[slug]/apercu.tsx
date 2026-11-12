import { Link, Navigate, useParams } from 'react-router-dom'
import type { ApiError } from '@/lib/api-client'
import { useCurrentUser } from '@/features/current-user/context'
import { adminSharePreview, lookupAdminDossier } from '@/features/admin/dossiers.api'
import { adminFailure } from '@/features/admin/failure'
import { RecipientPreview } from '@/features/shares/components/RecipientPreview'
import { LoadError } from '@/components/confluent/LoadError'
import { useAsync } from '@/lib/useAsync'

// E07.01 « Voir comme le destinataire », for an administrator, on any request.
export default function AdminDossierPreviewRoute() {
  const user = useCurrentUser()
  if (user.role !== 'admin') return <Navigate to="/dashboard" replace />
  return <AdminDossierPreview />
}

function AdminDossierPreview() {
  const { slug: ref = '' } = useParams<{ slug: string }>()
  // Same resolution as the administration's page of the dossier (E10.05: by the server).
  const found = useAsync(() => lookupAdminDossier(ref), [ref])
  if (found.isLoading) return <p className="pt-8 text-sm text-muted-foreground">Chargement…</p>
  const item = found.data
  if (found.error && (found.error as Partial<ApiError>).status !== 404) {
    return (
      <LoadError
        className="mt-8"
        message={adminFailure(found.error, 'Le dossier n’a pas pu être chargé.')}
        onRetry={found.refetch}
      />
    )
  }
  if (found.error || !item) {
    return (
      <section className="mx-auto max-w-md pt-16 text-center">
        <title>Dossier introuvable · Confluent</title>
        <p className="text-sm wrap-anywhere text-muted-foreground">
          Aucun dossier n’a le slug ni l’identifiant « {ref} ».
        </p>
        <Link to="/admin/dossiers" className="mt-4 inline-block text-sm underline">
          Retour à la liste
        </Link>
      </section>
    )
  }
  return (
    <RecipientPreview
      dossierName={item.name}
      backHref={`/admin/dossiers/${encodeURIComponent(item.slug)}`}
      backLabel="Retour au dossier"
      load={(level) => adminSharePreview(item.id, level)}
    />
  )
}
