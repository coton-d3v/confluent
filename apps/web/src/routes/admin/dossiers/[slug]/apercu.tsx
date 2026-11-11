import { Link, Navigate, useParams } from 'react-router-dom'
import { useCurrentUser } from '@/features/current-user/context'
import { adminSharePreview, listAdminDossiers } from '@/features/admin/dossiers.api'
import { RecipientPreview } from '@/features/shares/components/RecipientPreview'
import { useAsync } from '@/lib/useAsync'

const SEARCH_PAGE_SIZE = 100

// E07.01 « Voir comme le destinataire », for an administrator, on any request.
export default function AdminDossierPreviewRoute() {
  const user = useCurrentUser()
  if (user.role !== 'admin') return <Navigate to="/dashboard" replace />
  return <AdminDossierPreview />
}

function AdminDossierPreview() {
  const { slug } = useParams<{ slug: string }>()
  // Same resolution as the administration's page of the dossier (first page of 100).
  const list = useAsync(() => listAdminDossiers(1, SEARCH_PAGE_SIZE), [])
  if (list.isLoading) return <p className="pt-8 text-sm text-muted-foreground">Chargement…</p>
  if (list.error) {
    return (
      <p className="pt-8 text-sm text-destructive">Impossible de charger la liste des dossiers.</p>
    )
  }
  const item = list.data?.items.find((d) => d.slug === slug)
  if (!item) {
    return (
      <section className="mx-auto max-w-md pt-16 text-center">
        <title>Dossier introuvable · Confluent</title>
        <p className="text-sm text-muted-foreground">Dossier introuvable.</p>
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
